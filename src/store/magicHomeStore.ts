import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type MagicHomeDevice, type MagicHomeDeviceState,
  discoverDevices, getDeviceState,
  setDeviceOn, setDeviceOff, setDeviceColor, setDeviceWarmWhite,
  setDeviceColorWithBrightness, setDevicePattern,
  type MagicHomePattern,
} from '@/lib/magicHomeApi';
import { sendMagicSet } from '@/lib/wsSync';

interface StoredDevice extends MagicHomeDevice {
  state: MagicHomeDeviceState | null;
  online: boolean;
}

interface MagicHomeStore {
  proxyUrl: string;
  devices: StoredDevice[];
  discovering: boolean;

  setProxyUrl: (url: string) => void;
  discover: () => Promise<void>;
  addDevice: (address: string, name?: string) => void;
  removeDevice: (id: string) => void;
  renameDevice: (id: string, name: string) => void;
  refreshDevice: (id: string) => Promise<void>;
  refreshAll: () => Promise<void>;

  // Control
  setPower: (id: string, on: boolean) => Promise<void>;
  setColor: (id: string, r: number, g: number, b: number) => Promise<void>;
  setBrightness: (id: string, brightness: number) => Promise<void>;
  setWarmWhite: (id: string, level: number) => Promise<void>;
  setPattern: (id: string, pattern: MagicHomePattern, speed?: number) => Promise<void>;
}

export const useMagicHomeStore = create<MagicHomeStore>()(
  persist(
    (set, get) => ({
      proxyUrl: 'http://localhost:3000',
      devices: [],
      discovering: false,

      setProxyUrl: (url) => set({ proxyUrl: url }),

      discover: async () => {
        set({ discovering: true });
        try {
          const found = await discoverDevices(get().proxyUrl);
          const existing = get().devices;
          const newDevices: StoredDevice[] = found
            .filter(d => !existing.some(e => e.id === d.id))
            .map(d => ({ ...d, state: null, online: true }));
          if (newDevices.length > 0) {
            set({ devices: [...existing, ...newDevices] });
          }
          // Refresh existing
          const all = [...existing, ...newDevices];
          await Promise.all(all.map(d => get().refreshDevice(d.id)));
        } finally {
          set({ discovering: false });
        }
      },

      addDevice: (address, name) => {
        const id = address.replace(/\./g, '');
        if (get().devices.some(d => d.address === address)) return;
        const device: StoredDevice = {
          id,
          address,
          model: '',
          name: name || `MagicHome (${address})`,
          state: null,
          online: false,
        };
        set(s => ({ devices: [...s.devices, device] }));
        get().refreshDevice(id);
      },

      removeDevice: (id) => set(s => ({ devices: s.devices.filter(d => d.id !== id) })),

      renameDevice: (id, name) => set(s => ({
        devices: s.devices.map(d => d.id === id ? { ...d, name } : d),
      })),

      refreshDevice: async (id) => {
        const device = get().devices.find(d => d.id === id);
        if (!device) return;
        const state = await getDeviceState(device.id, get().proxyUrl);
        set(s => ({
          devices: s.devices.map(d => d.id === id ? {
            ...d,
            state: state || d.state,
            online: !!state,
          } : d),
        }));
      },

      refreshAll: async () => {
        await Promise.all(get().devices.map(d => get().refreshDevice(d.id)));
      },

      setPower: async (id, on) => {
        const device = get().devices.find(d => d.id === id);
        if (!device) return;
        const ok = on
          ? await setDeviceOn(device.id, get().proxyUrl)
          : await setDeviceOff(device.id, get().proxyUrl);
        if (ok) {
          set(s => ({
            devices: s.devices.map(d => d.id === id && d.state ? {
              ...d, state: { ...d.state, on },
            } : d),
          }));
        }
        // Send to engine for persistent output
        const color = device.state?.color || { r: 0, g: 0, b: 0 };
        sendMagicSet(id, get().proxyUrl, on, color.r, color.g, color.b);
      },

      setColor: async (id, r, g, b) => {
        const device = get().devices.find(d => d.id === id);
        if (!device) return;
        await setDeviceColor(device.id, r, g, b, get().proxyUrl);
        set(s => ({
          devices: s.devices.map(d => d.id === id && d.state ? {
            ...d, state: { ...d.state, color: { r, g, b }, on: true },
          } : d),
        }));
        // Send to engine for persistent output
        sendMagicSet(id, get().proxyUrl, true, r, g, b);
      },

      setBrightness: async (id, brightness) => {
        const device = get().devices.find(d => d.id === id);
        if (!device?.state) return;
        const { r, g, b } = device.state.color;
        // Find max channel to normalize
        const max = Math.max(r, g, b, 1);
        const nr = r / max;
        const ng = g / max;
        const nb = b / max;
        await setDeviceColorWithBrightness(device.id, Math.round(nr * 255), Math.round(ng * 255), Math.round(nb * 255), brightness, get().proxyUrl);
      },

      setWarmWhite: async (id, level) => {
        const device = get().devices.find(d => d.id === id);
        if (!device) return;
        await setDeviceWarmWhite(device.id, level, get().proxyUrl);
      },

      setPattern: async (id, pattern, speed = 50) => {
        const device = get().devices.find(d => d.id === id);
        if (!device) return;
        await setDevicePattern(device.id, pattern, speed, get().proxyUrl);
      },
    }),
    {
      name: 'stokio-magichome-v1',
      partialize: (s) => ({
        proxyUrl: s.proxyUrl,
        devices: s.devices.map(d => ({ ...d, state: null, online: false })), // don't persist runtime state
      }),
    }
  )
);
