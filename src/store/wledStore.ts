import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { broadcastState, isSyncingFromRemote, onSyncState, engineWledRefresh } from '@/lib/wsSync';
import { type WledInfo, type WledState, type WledSegment } from '@/lib/wledApi';

// ── Types ──

/** WLED output protocol — determines how STOKIO sends data to the node */
export type WledProtocol = 'json' | 'dnrgb' | 'ddp';

export const WLED_PROTOCOL_OPTIONS: { value: WledProtocol; label: string; description: string }[] = [
  { value: 'dnrgb', label: 'DNRGB (Realtime UDP)', description: 'Temporär override – WLED återgår till sin preset när STOKIO slutar sända' },
  { value: 'ddp',   label: 'DDP (Realtime UDP)',    description: 'Temporär override – snabbare för stora LED-strips, auto-release' },
  { value: 'json',  label: 'JSON API (HTTP)',        description: 'Permanent – skriver över WLED:s aktiva preset' },
];

export interface WledDevice {
  id: string;
  ip: string;
  name: string;
  online: boolean;
  lastSeen: number | null;
  /** Output protocol: dnrgb (default, auto-releases), ddp, or json (permanent) */
  protocol: WledProtocol;
  /** Realtime timeout in seconds (0 = use WLED default, typically 2.5s) */
  realtimeTimeout: number;
  // Live state from device
  info?: WledInfo;
  state?: WledState;
  effects?: string[];
  palettes?: string[];
}

import type { FixtureIcon } from '@/store/fixtureStore';

/** A WLED Fixture is a logical fixture mapped to a segment on a physical WLED device */
export interface WledFixture {
  id: string;
  deviceId: string;       // reference to WledDevice.id
  name: string;
  icon?: FixtureIcon;
  segmentId: number;      // WLED segment index
  ledStart: number;       // first LED in this fixture
  ledEnd: number;         // last LED in this fixture
  // Cached from device for quick access
  deviceIp: string;
  deviceName: string;
}

interface WledStore {
  devices: WledDevice[];
  fixtures: WledFixture[];

  // Device management
  addDevice: (ip: string, name?: string) => Promise<void>;
  removeDevice: (id: string) => void;
  updateDevice: (id: string, updates: Partial<WledDevice>) => void;
  refreshDevice: (id: string) => Promise<void>;
  refreshAll: () => Promise<void>;

  // Fixture management
  addFixture: (fixture: Omit<WledFixture, 'id' | 'deviceIp' | 'deviceName'>) => void;
  removeFixture: (id: string) => void;
  updateFixture: (id: string, updates: Partial<WledFixture>) => void;

  // Helpers
  getDeviceForFixture: (fixtureId: string) => WledDevice | undefined;
  getFixturesForDevice: (deviceId: string) => WledFixture[];
  getOnlineDevices: () => WledDevice[];

  // Polling
  _polling: boolean;
  _setPolling: (v: boolean) => void;
}

async function fetchDeviceState(id: string, ip: string): Promise<Partial<WledDevice>> {
  try {
    const result = await engineWledRefresh(id, ip);
    if (result.online && result.data) {
      return {
        online: true,
        lastSeen: Date.now(),
        info: result.data.info,
        state: result.data.state,
        effects: result.data.effects,
        palettes: result.data.palettes,
      };
    }
    return { online: false };
  } catch {
    return { online: false };
  }
}

export const useWledStore = create<WledStore>()(
  persist(
    (set, get) => ({
      devices: [],
      fixtures: [],
      _polling: false,
      _setPolling: (v) => set({ _polling: v }),

      addDevice: async (ip, name) => {
        const id = `wled-dev-${Date.now()}`;
        const newDev: WledDevice = {
          id,
          ip: ip.trim(),
          name: name?.trim() || ip.trim(),
          online: false,
          lastSeen: null,
          protocol: 'dnrgb',
          realtimeTimeout: 0,
        };
        // Add immediately, then fetch state
        set((s) => ({ devices: [...s.devices, newDev] }));
        const liveState = await fetchDeviceState(id, ip.trim());
        set((s) => ({
          devices: s.devices.map((d) =>
            d.id === id
              ? {
                  ...d,
                  ...liveState,
                  name: name?.trim() || liveState.info?.name || ip.trim(),
                }
              : d
          ),
        }));
      },

      removeDevice: (id) =>
        set((s) => ({
          devices: s.devices.filter((d) => d.id !== id),
          fixtures: s.fixtures.filter((f) => f.deviceId !== id),
        })),

      updateDevice: (id, updates) =>
        set((s) => ({
          devices: s.devices.map((d) => (d.id === id ? { ...d, ...updates } : d)),
        })),

      refreshDevice: async (id) => {
        const dev = get().devices.find((d) => d.id === id);
        if (!dev) return;
        const liveState = await fetchDeviceState(dev.id, dev.ip);
        set((s) => ({
          devices: s.devices.map((d) => (d.id === id ? { ...d, ...liveState } : d)),
        }));
      },

      refreshAll: async () => {
        set({ _polling: true });
        const { devices } = get();
        const results = await Promise.all(
          devices.map(async (dev) => {
            const liveState = await fetchDeviceState(dev.id, dev.ip);
            return { id: dev.id, ...liveState };
          })
        );
        set((s) => ({
          _polling: false,
          devices: s.devices.map((d) => {
            const res = results.find((r) => r.id === d.id);
            return res ? { ...d, ...res } : d;
          }),
        }));
      },

      addFixture: (fixture) => {
        const dev = get().devices.find((d) => d.id === fixture.deviceId);
        if (!dev) return;
        const id = `wled-fix-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const newFixture: WledFixture = {
          ...fixture,
          id,
          deviceIp: dev.ip,
          deviceName: dev.name,
        };
        set((s) => ({ fixtures: [...s.fixtures, newFixture] }));
      },

      removeFixture: (id) =>
        set((s) => ({ fixtures: s.fixtures.filter((f) => f.id !== id) })),

      updateFixture: (id, updates) =>
        set((s) => ({
          fixtures: s.fixtures.map((f) => (f.id === id ? { ...f, ...updates } : f)),
        })),

      getDeviceForFixture: (fixtureId) => {
        const fixture = get().fixtures.find((f) => f.id === fixtureId);
        if (!fixture) return undefined;
        return get().devices.find((d) => d.id === fixture.deviceId);
      },

      getFixturesForDevice: (deviceId) =>
        get().fixtures.filter((f) => f.deviceId === deviceId),

      getOnlineDevices: () => get().devices.filter((d) => d.online),
    }),
    {
      name: 'stokio-wled-v1',
      partialize: (state) => ({
        devices: state.devices.map((d) => ({
          id: d.id,
          ip: d.ip,
          name: d.name,
          online: false,
          lastSeen: d.lastSeen,
        })),
        fixtures: state.fixtures,
      }),
    }
  )
);

// ── Sync ──
useWledStore.subscribe((state) => {
  if (!isSyncingFromRemote()) {
    broadcastState('wled', {
      devices: state.devices,
      fixtures: state.fixtures,
    });
  }
});

onSyncState((incoming) => {
  const w = incoming.wled as Record<string, unknown> | undefined;
  if (w) {
    useWledStore.setState({
      ...(w.devices !== undefined && { devices: w.devices as WledDevice[] }),
      ...(w.fixtures !== undefined && { fixtures: w.fixtures as WledFixture[] }),
    });
  }
});
