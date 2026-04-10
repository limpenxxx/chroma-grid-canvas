import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { broadcastState, isSyncingFromRemote, onSyncState, sendRawMessage } from '@/lib/wsSync';

export interface ScenePreset {
  id: string;
  name: string;
  image: string; // import path or data URL
  description?: string;
  // DMX snapshot
  dmxValues?: Record<string, number>; // "universe:channel" -> value
  // Effect IDs to activate
  effectIds?: string[];
  // Custom color (for simple color presets)
  color?: { r: number; g: number; b: number };
  // Master dimmer override
  masterDimmer?: number;
  // Sort order
  order: number;
  // User-created vs built-in
  builtIn: boolean;
}

interface PresetStore {
  presets: ScenePreset[];
  activePresetId: string | null;
  presetScale: number; // 0.5 - 2.0 for button size scaling

  activatePreset: (id: string) => void;
  deactivatePreset: () => void;
  addPreset: (preset: ScenePreset) => void;
  updatePreset: (id: string, updates: Partial<ScenePreset>) => void;
  removePreset: (id: string) => void;
  setPresetScale: (scale: number) => void;
  reorderPresets: (fromIndex: number, toIndex: number) => void;
}

export const usePresetStore = create<PresetStore>()(
  persist(
    (set, get) => ({
      presets: [],
      activePresetId: null,
      presetScale: 1,

      activatePreset: (id) => {
        const preset = get().presets.find(p => p.id === id);
        if (!preset) return;
        set({ activePresetId: id });
        // Send to engine for execution
        sendRawMessage({ type: 'preset-activate', presetId: id, preset });
      },
      deactivatePreset: () => {
        set({ activePresetId: null });
        sendRawMessage({ type: 'preset-deactivate' });
      },
      addPreset: (preset) => set(s => ({ presets: [...s.presets, preset] })),
      updatePreset: (id, updates) => set(s => ({
        presets: s.presets.map(p => p.id === id ? { ...p, ...updates } : p),
      })),
      removePreset: (id) => set(s => ({
        presets: s.presets.filter(p => p.id !== id),
        ...(s.activePresetId === id ? { activePresetId: null } : {}),
      })),
      setPresetScale: (scale) => set({ presetScale: Math.max(0.5, Math.min(2, scale)) }),
      reorderPresets: (fromIndex, toIndex) => set(s => {
        const presets = [...s.presets];
        const [moved] = presets.splice(fromIndex, 1);
        presets.splice(toIndex, 0, moved);
        return { presets: presets.map((p, i) => ({ ...p, order: i })) };
      }),
    }),
    {
      name: 'stokio-presets-v1',
      partialize: (s) => ({
        presets: s.presets,
        presetScale: s.presetScale,
      }),
    }
  )
);

// Sync
usePresetStore.subscribe((state) => {
  if (!isSyncingFromRemote()) {
    broadcastState('presets', {
      presets: state.presets,
      activePresetId: state.activePresetId,
      presetScale: state.presetScale,
    });
  }
});

onSyncState((incoming) => {
  const p = incoming.presets as Record<string, unknown> | undefined;
  if (p) {
    usePresetStore.setState({
      ...(p.presets !== undefined && { presets: p.presets as ScenePreset[] }),
      ...(p.activePresetId !== undefined && { activePresetId: p.activePresetId as string | null }),
      ...(p.presetScale !== undefined && { presetScale: p.presetScale as number }),
    });
  }
});
