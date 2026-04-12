import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type HueBridge, type HueLight, type HueGroup, type HueScene } from '@/lib/hueApi';
import {
  sendHueBridge, sendHueLight, sendHueGroupAction, sendHueScene,
  engineHueDiscover, engineHuePair, engineHueRefresh, isEngineConnected, onEngineConnect, removeHueBridgeFromEngine,
} from '@/lib/wsSync';
import { rgbToXy } from '@/lib/hueApi';

interface HueStore {
  bridges: HueBridge[];
  lights: Record<string, HueLight[]>;   // keyed by bridge id
  groups: Record<string, HueGroup[]>;
  scenes: Record<string, HueScene[]>;
  discovering: boolean;

  // Bridge management
  discover: () => Promise<void>;
  addBridge: (ip: string, name?: string) => void;
  removeBridge: (id: string) => void;
  pair: (bridgeId: string) => Promise<{ success: boolean; error?: string }>;
  refreshBridge: (bridgeId: string) => Promise<void>;
  refreshAll: () => Promise<void>;

  // Light control (all via engine)
  setColor: (bridgeId: string, lightId: string, r: number, g: number, b: number) => void;
  setBrightness: (bridgeId: string, lightId: string, bri: number) => void;
  setPower: (bridgeId: string, lightId: string, on: boolean) => void;
  setLight: (bridgeId: string, lightId: string, state: Record<string, unknown>) => void;

  // Group control (via engine)
  setGroupAction: (bridgeId: string, groupId: string, state: Record<string, unknown>) => void;
  triggerScene: (bridgeId: string, groupId: string, sceneId: string) => void;
}

function parseLights(data: Record<string, any> | null): HueLight[] {
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data).map(([id, light]) => ({
    id,
    name: light.name,
    type: light.type,
    modelId: light.modelid || '',
    manufacturerName: light.manufacturername || 'Philips',
    uniqueId: light.uniqueid || '',
    state: {
      on: light.state?.on ?? false,
      bri: light.state?.bri ?? 0,
      hue: light.state?.hue,
      sat: light.state?.sat,
      ct: light.state?.ct,
      xy: light.state?.xy,
      colormode: light.state?.colormode,
      reachable: light.state?.reachable ?? false,
    },
    capabilities: {
      hasColor: light.type?.toLowerCase().includes('color') ?? false,
      hasColorTemp: light.type?.toLowerCase().includes('temperature') || light.type?.toLowerCase().includes('color') || false,
    },
  }));
}

function parseGroups(data: Record<string, any> | null): HueGroup[] {
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data).map(([id, g]) => ({
    id,
    name: g.name,
    type: g.type || 'LightGroup',
    lights: g.lights || [],
    state: g.state || { all_on: false, any_on: false },
    action: g.action || {},
  }));
}

function parseScenes(data: Record<string, any> | null): HueScene[] {
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data).map(([id, s]) => ({
    id,
    name: s.name,
    type: s.type || 'LightScene',
    group: s.group,
    lights: s.lights || [],
  }));
}

export const useHueStore = create<HueStore>()(
  persist(
    (set, get) => ({
      bridges: [],
      lights: {},
      groups: {},
      scenes: {},
      discovering: false,

      discover: async () => {
        set({ discovering: true });
        try {
          const result = await engineHueDiscover();
          const found = result.bridges || [];
          const existing = get().bridges;
          const newBridges = found
            .filter((b: any) => !existing.some(e => e.ip === b.internalipaddress))
            .map((b: any) => ({
              id: b.id || crypto.randomUUID(),
              ip: b.internalipaddress,
              name: `Hue Bridge`,
              apiKey: null,
            }));
          if (newBridges.length > 0) {
            set({ bridges: [...existing, ...newBridges] });
          }
        } catch (err) {
          console.error('[HUE] Discovery failed:', err);
        } finally {
          set({ discovering: false });
        }
      },

      addBridge: (ip, name) => {
        const id = crypto.randomUUID();
        set((s) => ({
          bridges: [...s.bridges, { id, ip, name: name || `Hue Bridge (${ip})`, apiKey: null }],
        }));
      },

      removeBridge: (id) => {
        removeHueBridgeFromEngine(id);
        set((s) => {
          const { [id]: _l, ...lights } = s.lights;
          const { [id]: _g, ...groups } = s.groups;
          const { [id]: _s, ...scenes } = s.scenes;
          return {
            bridges: s.bridges.filter(b => b.id !== id),
            lights, groups, scenes,
          };
        });
      },

      pair: async (bridgeId) => {
        const bridge = get().bridges.find(b => b.id === bridgeId);
        if (!bridge) return { success: false, error: 'Bridge not found' };
        try {
          const result = await engineHuePair(bridge.ip);
          if (result.success && result.apiKey) {
            set((s) => ({
              bridges: s.bridges.map(b => b.id === bridgeId ? { ...b, apiKey: result.apiKey! } : b),
            }));
            // Register bridge with engine for persistent output
            sendHueBridge(bridgeId, bridge.ip, result.apiKey);
            // Auto-refresh after pairing
            setTimeout(() => get().refreshBridge(bridgeId), 500);
          }
          return result;
        } catch (err) {
          return { success: false, error: String(err) };
        }
      },

      refreshBridge: async (bridgeId) => {
        const bridge = get().bridges.find(b => b.id === bridgeId);
        if (!bridge?.apiKey) return;

        try {
          const result = await engineHueRefresh(bridgeId, bridge.ip, bridge.apiKey);
          if (result.error) {
            console.error('[HUE] Refresh failed:', result.error);
            return;
          }

          set((s) => ({
            lights: { ...s.lights, [bridgeId]: parseLights(result.lights) },
            groups: { ...s.groups, [bridgeId]: parseGroups(result.groups) },
            scenes: { ...s.scenes, [bridgeId]: parseScenes(result.scenes) },
            bridges: s.bridges.map(b => b.id === bridgeId ? {
              ...b,
              name: result.config?.name || b.name,
              modelId: result.config?.modelid,
              swVersion: result.config?.swversion,
            } : b),
          }));
        } catch (err) {
          console.error('[HUE] Refresh timeout:', err);
        }
      },

      refreshAll: async () => {
        const bridges = get().bridges.filter(b => b.apiKey);
        await Promise.all(bridges.map(b => get().refreshBridge(b.id)));
      },

      setColor: (bridgeId, lightId, r, g, b) => {
        const xy = rgbToXy(r, g, b);
        sendHueLight(bridgeId, lightId, { xy, on: true });
      },

      setBrightness: (bridgeId, lightId, bri) => {
        const briVal = Math.max(1, Math.min(254, Math.round(bri * 2.54)));
        sendHueLight(bridgeId, lightId, { bri: briVal });
      },

      setPower: (bridgeId, lightId, on) => {
        sendHueLight(bridgeId, lightId, { on });
      },

      setLight: (bridgeId, lightId, state) => {
        sendHueLight(bridgeId, lightId, state);
      },

      setGroupAction: (bridgeId, groupId, state) => {
        sendHueGroupAction(bridgeId, groupId, state);
      },

      triggerScene: (bridgeId, groupId, sceneId) => {
        sendHueScene(bridgeId, groupId, sceneId);
      },
    }),
    {
      name: 'stokio-hue-v1',
      onRehydrateStorage: () => (state) => {
        if (!state || !isEngineConnected()) return;
        const paired = state.bridges.filter((bridge) => bridge.apiKey);
        for (const bridge of paired) {
          sendHueBridge(bridge.id, bridge.ip, bridge.apiKey!);
        }
        if (paired.length > 0) {
          void state.refreshAll();
        }
      },
      partialize: (s) => ({
        bridges: s.bridges, // persist bridge configs with API keys
      }),
    }
  )
);

// ── Auto-register bridges & refresh when engine connects ──
onEngineConnect(() => {
  const { bridges, refreshAll } = useHueStore.getState();
  const paired = bridges.filter(b => b.apiKey);
  if (paired.length > 0) {
    console.log('[HUE] Engine connected — registering', paired.length, 'bridges');
    for (const b of paired) {
      sendHueBridge(b.id, b.ip, b.apiKey!);
    }
    setTimeout(() => refreshAll(), 800);
  }
});
