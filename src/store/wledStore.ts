import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { broadcastState, isSyncingFromRemote, onSyncState } from '@/lib/wsSync';
import { getWledState, type WledFullState, type WledInfo, type WledState, type WledSegment } from '@/lib/wledApi';

// ── Types ──

export interface WledDevice {
  id: string;
  ip: string;
  name: string;
  online: boolean;
  lastSeen: number | null;
  // Live state from device
  info?: WledInfo;
  state?: WledState;
  effects?: string[];
  palettes?: string[];
}

/** A WLED Fixture is a logical fixture mapped to a segment on a physical WLED device */
export interface WledFixture {
  id: string;
  deviceId: string;       // reference to WledDevice.id
  name: string;
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

async function fetchDeviceState(ip: string): Promise<Partial<WledDevice>> {
  try {
    const data: WledFullState = await getWledState(ip);
    return {
      online: true,
      lastSeen: Date.now(),
      info: data.info,
      state: data.state,
      effects: data.effects,
      palettes: data.palettes,
    };
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
        };
        // Add immediately, then fetch state
        set((s) => ({ devices: [...s.devices, newDev] }));
        const liveState = await fetchDeviceState(ip.trim());
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
        const liveState = await fetchDeviceState(dev.ip);
        set((s) => ({
          devices: s.devices.map((d) => (d.id === id ? { ...d, ...liveState } : d)),
        }));
      },

      refreshAll: async () => {
        set({ _polling: true });
        const { devices } = get();
        const results = await Promise.all(
          devices.map(async (dev) => {
            const liveState = await fetchDeviceState(dev.ip);
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
