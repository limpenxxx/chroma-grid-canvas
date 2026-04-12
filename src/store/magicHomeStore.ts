import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type MagicHomeDevice, type MagicHomeDeviceState, type MagicHomePattern } from '@/lib/magicHomeApi';
import {
  sendMagicColor, sendMagicPower, sendMagicPattern, sendMagicWarmWhite,
  engineMagicDiscover, engineMagicRefresh,
} from '@/lib/wsSync';

interface StoredDevice extends MagicHomeDevice {
  mac?: string;
  state: MagicHomeDeviceState | null;
  online: boolean;
}

interface MagicHomeStore {
  proxyUrl: string;
  devices: StoredDevice[];
  discovering: boolean;

  setProxyUrl: (url: string) => void;
  discover: () => Promise<void>;
  addDevice: (address: string, name?: string, mac?: string) => void;
  removeDevice: (id: string) => void;
  renameDevice: (id: string, name: string) => void;
  refreshDevice: (id: string) => Promise<void>;
  refreshAll: () => Promise<void>;

  // Control (all via engine)
  setPower: (id: string, on: boolean) => void;
  setColor: (id: string, r: number, g: number, b: number) => void;
  setBrightness: (id: string, brightness: number) => void;
  setWarmWhite: (id: string, level: number) => void;
  setPattern: (id: string, pattern: MagicHomePattern, speed?: number) => void;
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
          const result = await engineMagicDiscover(get().proxyUrl);
          const found = result.devices || [];
          const existing = get().devices;
          const newDevices: StoredDevice[] = found
            .filter((d: any) => !existing.some(e => e.id === d.id))
            .map((d: any) => ({ ...d, state: null, online: true }));
          if (newDevices.length > 0) {
            set({ devices: [...existing, ...newDevices] });
          }
          // Refresh all
          const all = [...existing, ...newDevices];
          await Promise.all(all.map(d => get().refreshDevice(d.id)));
        } catch (err) {
          console.error('[MAGIC] Discovery failed:', err);
        } finally {
          set({ discovering: false });
        }
      },

      addDevice: (address, name, mac) => {
        const id = mac ? mac.replace(/[:\-\.]/g, '').toUpperCase() : address.replace(/\./g, '');
        if (get().devices.some(d => d.id === id || d.address === address)) return;
        const device: StoredDevice = {
          id,
          address,
          mac: mac?.replace(/[:\-\.]/g, '').toUpperCase() || '',
          model: '',
          name: name || `MagicHome (${mac || address})`,
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
        try {
          const result = await engineMagicRefresh(device.id, get().proxyUrl);
          set(s => ({
            devices: s.devices.map(d => d.id === id ? {
              ...d,
              state: result.state || d.state,
              online: result.online ?? !!result.state,
            } : d),
          }));
        } catch {
          set(s => ({
            devices: s.devices.map(d => d.id === id ? { ...d, online: false } : d),
          }));
        }
      },

      refreshAll: async () => {
        await Promise.all(get().devices.map(d => get().refreshDevice(d.id)));
      },

      setPower: (id, on) => {
        const device = get().devices.find(d => d.id === id);
        if (!device) return;
        sendMagicPower(device.id, get().proxyUrl, on);
        set(s => ({
          devices: s.devices.map(d => d.id === id && d.state ? {
            ...d, state: { ...d.state, on },
          } : d),
        }));
      },

      setColor: (id, r, g, b) => {
        const device = get().devices.find(d => d.id === id);
        if (!device) return;
        sendMagicColor(device.id, get().proxyUrl, r, g, b);
        set(s => ({
          devices: s.devices.map(d => d.id === id && d.state ? {
            ...d, state: { ...d.state, color: { r, g, b }, on: true },
          } : d),
        }));
      },

      setBrightness: (id, brightness) => {
        const device = get().devices.find(d => d.id === id);
        if (!device?.state) return;
        const { r, g, b } = device.state.color;
        const max = Math.max(r, g, b, 1);
        const nr = Math.round((r / max) * 255);
        const ng = Math.round((g / max) * 255);
        const nb = Math.round((b / max) * 255);
        sendMagicColor(device.id, get().proxyUrl, nr, ng, nb);
      },

      setWarmWhite: (id, level) => {
        const device = get().devices.find(d => d.id === id);
        if (!device) return;
        sendMagicWarmWhite(device.id, get().proxyUrl, level);
      },

      setPattern: (id, pattern, speed = 50) => {
        const device = get().devices.find(d => d.id === id);
        if (!device) return;
        sendMagicPattern(device.id, get().proxyUrl, pattern, speed);
      },
    }),
    {
      name: 'stokio-magichome-v1',
      partialize: (s) => ({
        proxyUrl: s.proxyUrl,
        devices: s.devices.map(d => ({ ...d, state: null, online: false })),
      }),
    }
  )
);
