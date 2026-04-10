import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { broadcastState, isSyncingFromRemote, onSyncState, sendRawMessage } from '@/lib/wsSync';

// ── Effect Types ──

export type EffectWaveform = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'random';
export type EffectTarget = 'dimmer' | 'red' | 'green' | 'blue' | 'white' | 'pan' | 'tilt' | 'all-color';

export interface EffectDefinition {
  id: string;
  name: string;
  type: 'phaser' | 'chaser' | 'rainbow' | 'strobe-fx';

  // Common params
  speed: number;       // BPM
  intensity: number;   // 0-100 % (amplitude)
  waveform: EffectWaveform;
  target: EffectTarget;

  // Per-fixture phase offset (degrees: 0-360)
  fixtureOffset: number;

  // Which fixtures are included
  fixtureIds: string[];  // FixtureInstance IDs

  // Phaser-specific
  phaseSpread: number;  // 0-360 degrees spread across all fixtures

  // Chaser-specific
  chaserSteps?: { values: Record<string, number>; holdMs: number }[];

  // Rainbow-specific
  rainbowSpread: number; // hue spread across fixtures (0-360)
}

interface EffectStore {
  effects: EffectDefinition[];
  activeEffectIds: string[];

  // CRUD
  addEffect: (effect: EffectDefinition) => void;
  updateEffect: (id: string, updates: Partial<EffectDefinition>) => void;
  removeEffect: (id: string) => void;

  // Activation — tells engine to run the effect
  activateEffect: (id: string) => void;
  deactivateEffect: (id: string) => void;
  toggleEffect: (id: string) => void;
  deactivateAll: () => void;
}

const DEFAULT_EFFECTS: EffectDefinition[] = [
  {
    id: 'fx-dimmer-sine',
    name: 'Dimmer Wave',
    type: 'phaser',
    speed: 60,
    intensity: 100,
    waveform: 'sine',
    target: 'dimmer',
    fixtureOffset: 0,
    fixtureIds: [],
    phaseSpread: 120,
    rainbowSpread: 360,
  },
  {
    id: 'fx-rainbow',
    name: 'Rainbow Sweep',
    type: 'rainbow',
    speed: 30,
    intensity: 100,
    waveform: 'sine',
    target: 'all-color',
    fixtureOffset: 0,
    fixtureIds: [],
    phaseSpread: 0,
    rainbowSpread: 360,
  },
  {
    id: 'fx-pan-tilt-circle',
    name: 'Pan/Tilt Circle',
    type: 'phaser',
    speed: 20,
    intensity: 50,
    waveform: 'sine',
    target: 'pan',
    fixtureOffset: 0,
    fixtureIds: [],
    phaseSpread: 90,
    rainbowSpread: 0,
  },
];

export const useEffectStore = create<EffectStore>()(
  persist(
    (set, get) => ({
      effects: DEFAULT_EFFECTS,
      activeEffectIds: [],

      addEffect: (effect) => set(s => ({ effects: [...s.effects, effect] })),
      updateEffect: (id, updates) => set(s => ({
        effects: s.effects.map(e => e.id === id ? { ...e, ...updates } : e),
      })),
      removeEffect: (id) => set(s => ({
        effects: s.effects.filter(e => e.id !== id),
        activeEffectIds: s.activeEffectIds.filter(eid => eid !== id),
      })),

      activateEffect: (id) => {
        const effect = get().effects.find(e => e.id === id);
        if (!effect) return;
        set(s => ({
          activeEffectIds: s.activeEffectIds.includes(id) ? s.activeEffectIds : [...s.activeEffectIds, id],
        }));
        sendRawMessage({ type: 'effect-start', effectId: id, effect });
      },
      deactivateEffect: (id) => {
        set(s => ({ activeEffectIds: s.activeEffectIds.filter(eid => eid !== id) }));
        sendRawMessage({ type: 'effect-stop', effectId: id });
      },
      toggleEffect: (id) => {
        const { activeEffectIds } = get();
        if (activeEffectIds.includes(id)) {
          get().deactivateEffect(id);
        } else {
          get().activateEffect(id);
        }
      },
      deactivateAll: () => {
        set({ activeEffectIds: [] });
        sendRawMessage({ type: 'effect-stop-all' });
      },
    }),
    {
      name: 'stokio-effects-v1',
      partialize: (s) => ({ effects: s.effects }),
    }
  )
);

// Sync
useEffectStore.subscribe((state) => {
  if (!isSyncingFromRemote()) {
    broadcastState('effects', {
      effects: state.effects,
      activeEffectIds: state.activeEffectIds,
    });
  }
});

onSyncState((incoming) => {
  const e = incoming.effects as Record<string, unknown> | undefined;
  if (e) {
    useEffectStore.setState({
      ...(e.effects !== undefined && { effects: e.effects as EffectDefinition[] }),
      ...(e.activeEffectIds !== undefined && { activeEffectIds: e.activeEffectIds as string[] }),
    });
  }
});
