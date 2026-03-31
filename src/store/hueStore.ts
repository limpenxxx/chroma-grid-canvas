import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type HueBridge, type HueLight, type HueGroup, type HueScene,
  discoverBridges, pairBridge, getLights, getGroups, getScenes,
  setLightState, setLightColor, setLightBrightness, setLightPower,
  setGroupState, activateScene, getBridgeConfig,
} from '@/lib/hueApi';
import { sendHueBridge, sendHueLight } from '@/lib/wsSync';

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

  // Light control (proxied to API)
  setColor: (bridgeId: string, lightId: string, r: number, g: number, b: number) => Promise<void>;
  setBrightness: (bridgeId: string, lightId: string, bri: number) => Promise<void>;
  setPower: (bridgeId: string, lightId: string, on: boolean) => Promise<void>;
  setLight: (bridgeId: string, lightId: string, state: Record<string, unknown>) => Promise<void>;

  // Group control
  setGroupAction: (bridgeId: string, groupId: string, state: Record<string, unknown>) => Promise<void>;
  triggerScene: (bridgeId: string, groupId: string, sceneId: string) => Promise<void>;
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
          const found = await discoverBridges();
          const existing = get().bridges;
          const newBridges = found
            .filter(b => !existing.some(e => e.ip === b.internalipaddress))
            .map(b => ({
              id: b.id || crypto.randomUUID(),
              ip: b.internalipaddress,
              name: `Hue Bridge`,
              apiKey: null,
            }));
          if (newBridges.length > 0) {
            set({ bridges: [...existing, ...newBridges] });
          }
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
        const result = await pairBridge(bridge.ip);
        if (result.success && result.apiKey) {
          set((s) => ({
            bridges: s.bridges.map(b => b.id === bridgeId ? { ...b, apiKey: result.apiKey! } : b),
          }));
          // Register bridge with engine
          sendHueBridge(bridgeId, bridge.ip, result.apiKey);
          // Auto-refresh after pairing
          setTimeout(() => get().refreshBridge(bridgeId), 500);
        }
        return result;
      },

      refreshBridge: async (bridgeId) => {
        const bridge = get().bridges.find(b => b.id === bridgeId);
        if (!bridge?.apiKey) return;

        const [lightsData, groupsData, scenesData, config] = await Promise.all([
          getLights(bridge.ip, bridge.apiKey),
          getGroups(bridge.ip, bridge.apiKey),
          getScenes(bridge.ip, bridge.apiKey),
          getBridgeConfig(bridge.ip, bridge.apiKey),
        ]);

        set((s) => ({
          lights: { ...s.lights, [bridgeId]: lightsData },
          groups: { ...s.groups, [bridgeId]: groupsData },
          scenes: { ...s.scenes, [bridgeId]: scenesData },
          bridges: s.bridges.map(b => b.id === bridgeId ? {
            ...b,
            name: (config as any)?.name || b.name,
            modelId: (config as any)?.modelid,
            swVersion: (config as any)?.swversion,
          } : b),
        }));
      },

      refreshAll: async () => {
        const bridges = get().bridges.filter(b => b.apiKey);
        await Promise.all(bridges.map(b => get().refreshBridge(b.id)));
      },

      setColor: async (bridgeId, lightId, r, g, b) => {
        const bridge = get().bridges.find(br => br.id === bridgeId);
        if (!bridge?.apiKey) return;
        await setLightColor(bridge.ip, bridge.apiKey, lightId, r, g, b);
        // Also send to engine for persistent output
        const { rgbToXy } = await import('@/lib/hueApi');
        const xy = rgbToXy(r, g, b);
        sendHueLight(bridgeId, lightId, { xy, on: true });
      },

      setBrightness: async (bridgeId, lightId, bri) => {
        const bridge = get().bridges.find(b => b.id === bridgeId);
        if (!bridge?.apiKey) return;
        const briVal = Math.max(1, Math.min(254, Math.round(bri * 2.54)));
        await setLightBrightness(bridge.ip, bridge.apiKey, lightId, bri);
        sendHueLight(bridgeId, lightId, { bri: briVal });
      },

      setPower: async (bridgeId, lightId, on) => {
        const bridge = get().bridges.find(b => b.id === bridgeId);
        if (!bridge?.apiKey) return;
        await setLightPower(bridge.ip, bridge.apiKey, lightId, on);
        sendHueLight(bridgeId, lightId, { on });
      },

      setLight: async (bridgeId, lightId, state) => {
        const bridge = get().bridges.find(b => b.id === bridgeId);
        if (!bridge?.apiKey) return;
        await setLightState(bridge.ip, bridge.apiKey, lightId, state);
        sendHueLight(bridgeId, lightId, state);
      },

      setGroupAction: async (bridgeId, groupId, state) => {
        const bridge = get().bridges.find(b => b.id === bridgeId);
        if (!bridge?.apiKey) return;
        await setGroupState(bridge.ip, bridge.apiKey, groupId, state);
      },

      triggerScene: async (bridgeId, groupId, sceneId) => {
        const bridge = get().bridges.find(b => b.id === bridgeId);
        if (!bridge?.apiKey) return;
        await activateScene(bridge.ip, bridge.apiKey, groupId, sceneId);
      },
    }),
    {
      name: 'stokio-hue-v1',
      partialize: (s) => ({
        bridges: s.bridges, // persist bridge configs with API keys
      }),
    }
  )
);
