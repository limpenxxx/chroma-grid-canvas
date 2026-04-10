import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { broadcastState, isSyncingFromRemote, onSyncState, sendRawMessage } from '@/lib/wsSync';

// ── Types ──

export interface CueChannelValue {
  universe: number;
  channel: number;
  value: number;
}

export interface CueWledState {
  deviceIp: string;
  preset?: number;
  color?: { r: number; g: number; b: number };
  brightness?: number;
}

export interface CueHueState {
  bridgeId: string;
  lightId: string;
  on?: boolean;
  brightness?: number;
  color?: { r: number; g: number; b: number };
}

export interface Cue {
  id: string;
  name: string;
  color: string;
  fadeIn: number;    // seconds
  fadeOut: number;   // seconds
  hold: number;      // seconds (0 = manual GO)
  delay: number;     // seconds delay before start
  trigger: 'manual' | 'follow' | 'time';
  followTime: number; // seconds after previous cue ends
  dmxValues: CueChannelValue[];
  wledStates: CueWledState[];
  hueStates: CueHueState[];
  // Effects active during this cue
  activeEffectIds: string[];
}

export interface CueSequence {
  id: string;
  name: string;
  cues: Cue[];
  loop: boolean;
}

export type CuePlaybackStatus = 'stopped' | 'playing' | 'paused';

interface CueStore {
  sequences: CueSequence[];
  activeSequenceId: string | null;
  activeCueIndex: number;
  playbackStatus: CuePlaybackStatus;

  // Sequence CRUD
  addSequence: (name: string) => string;
  removeSequence: (id: string) => void;
  renameSequence: (id: string, name: string) => void;
  setActiveSequence: (id: string | null) => void;

  // Cue CRUD
  addCue: (sequenceId: string, cue: Cue) => void;
  updateCue: (sequenceId: string, cueId: string, updates: Partial<Cue>) => void;
  removeCue: (sequenceId: string, cueId: string) => void;
  reorderCue: (sequenceId: string, fromIndex: number, toIndex: number) => void;

  // Playback — sends commands to engine
  go: () => void;
  goBack: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  jumpToCue: (index: number) => void;

  // Store current programmer state into a cue
  storeCue: (sequenceId: string, name: string, dmxValues: CueChannelValue[]) => void;
}

function createCueId() {
  return `cue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export const useCueStore = create<CueStore>()(
  persist(
    (set, get) => ({
      sequences: [{
        id: 'seq-default',
        name: 'Main Show',
        loop: false,
        cues: [
          {
            id: 'cue-1', name: 'Blackout', color: '#333333',
            fadeIn: 0, fadeOut: 2, hold: 0, delay: 0,
            trigger: 'manual', followTime: 0,
            dmxValues: [], wledStates: [], hueStates: [], activeEffectIds: [],
          },
          {
            id: 'cue-2', name: 'House Lights Down', color: '#00e5ff',
            fadeIn: 3, fadeOut: 0, hold: 0, delay: 0,
            trigger: 'manual', followTime: 0,
            dmxValues: [], wledStates: [], hueStates: [], activeEffectIds: [],
          },
          {
            id: 'cue-3', name: 'Scene 1 — Full Color', color: '#ff2d78',
            fadeIn: 2, fadeOut: 1, hold: 30, delay: 0,
            trigger: 'follow', followTime: 0.5,
            dmxValues: [], wledStates: [], hueStates: [], activeEffectIds: [],
          },
        ],
      }],
      activeSequenceId: 'seq-default',
      activeCueIndex: -1,
      playbackStatus: 'stopped',

      addSequence: (name) => {
        const id = `seq-${Date.now()}`;
        set(s => ({ sequences: [...s.sequences, { id, name, cues: [], loop: false }] }));
        return id;
      },
      removeSequence: (id) => set(s => ({
        sequences: s.sequences.filter(sq => sq.id !== id),
        ...(s.activeSequenceId === id ? { activeSequenceId: null, activeCueIndex: -1 } : {}),
      })),
      renameSequence: (id, name) => set(s => ({
        sequences: s.sequences.map(sq => sq.id === id ? { ...sq, name } : sq),
      })),
      setActiveSequence: (id) => set({ activeSequenceId: id, activeCueIndex: -1, playbackStatus: 'stopped' }),

      addCue: (sequenceId, cue) => set(s => ({
        sequences: s.sequences.map(sq =>
          sq.id === sequenceId ? { ...sq, cues: [...sq.cues, cue] } : sq
        ),
      })),
      updateCue: (sequenceId, cueId, updates) => set(s => ({
        sequences: s.sequences.map(sq =>
          sq.id === sequenceId
            ? { ...sq, cues: sq.cues.map(c => c.id === cueId ? { ...c, ...updates } : c) }
            : sq
        ),
      })),
      removeCue: (sequenceId, cueId) => set(s => ({
        sequences: s.sequences.map(sq =>
          sq.id === sequenceId ? { ...sq, cues: sq.cues.filter(c => c.id !== cueId) } : sq
        ),
      })),
      reorderCue: (sequenceId, fromIndex, toIndex) => set(s => ({
        sequences: s.sequences.map(sq => {
          if (sq.id !== sequenceId) return sq;
          const cues = [...sq.cues];
          const [moved] = cues.splice(fromIndex, 1);
          cues.splice(toIndex, 0, moved);
          return { ...sq, cues };
        }),
      })),

      // Playback commands — sent to engine for execution
      go: () => {
        const { activeSequenceId, activeCueIndex, sequences } = get();
        const seq = sequences.find(s => s.id === activeSequenceId);
        if (!seq) return;
        const nextIndex = activeCueIndex + 1;
        if (nextIndex >= seq.cues.length) {
          if (seq.loop) {
            set({ activeCueIndex: 0, playbackStatus: 'playing' });
            sendRawMessage({ type: 'cue-go', sequenceId: activeSequenceId, cueIndex: 0, cue: seq.cues[0] });
          }
          return;
        }
        set({ activeCueIndex: nextIndex, playbackStatus: 'playing' });
        sendRawMessage({ type: 'cue-go', sequenceId: activeSequenceId, cueIndex: nextIndex, cue: seq.cues[nextIndex] });
      },
      goBack: () => {
        const { activeSequenceId, activeCueIndex, sequences } = get();
        const seq = sequences.find(s => s.id === activeSequenceId);
        if (!seq || activeCueIndex <= 0) return;
        const prevIndex = activeCueIndex - 1;
        set({ activeCueIndex: prevIndex, playbackStatus: 'playing' });
        sendRawMessage({ type: 'cue-go', sequenceId: activeSequenceId, cueIndex: prevIndex, cue: seq.cues[prevIndex] });
      },
      stop: () => {
        set({ playbackStatus: 'stopped', activeCueIndex: -1 });
        sendRawMessage({ type: 'cue-stop' });
      },
      pause: () => {
        set({ playbackStatus: 'paused' });
        sendRawMessage({ type: 'cue-pause' });
      },
      resume: () => {
        set({ playbackStatus: 'playing' });
        sendRawMessage({ type: 'cue-resume' });
      },
      jumpToCue: (index) => {
        const { activeSequenceId, sequences } = get();
        const seq = sequences.find(s => s.id === activeSequenceId);
        if (!seq || index < 0 || index >= seq.cues.length) return;
        set({ activeCueIndex: index, playbackStatus: 'playing' });
        sendRawMessage({ type: 'cue-go', sequenceId: activeSequenceId, cueIndex: index, cue: seq.cues[index] });
      },

      storeCue: (sequenceId, name, dmxValues) => {
        const cue: Cue = {
          id: createCueId(),
          name,
          color: '#00e5ff',
          fadeIn: 2,
          fadeOut: 1,
          hold: 0,
          delay: 0,
          trigger: 'manual',
          followTime: 0,
          dmxValues,
          wledStates: [],
          hueStates: [],
          activeEffectIds: [],
        };
        get().addCue(sequenceId, cue);
      },
    }),
    {
      name: 'stokio-cues-v1',
      partialize: (s) => ({
        sequences: s.sequences,
        activeSequenceId: s.activeSequenceId,
      }),
    }
  )
);

// Sync
useCueStore.subscribe((state) => {
  if (!isSyncingFromRemote()) {
    broadcastState('cues', {
      sequences: state.sequences,
      activeSequenceId: state.activeSequenceId,
      activeCueIndex: state.activeCueIndex,
      playbackStatus: state.playbackStatus,
    });
  }
});

onSyncState((incoming) => {
  const c = incoming.cues as Record<string, unknown> | undefined;
  if (c) {
    useCueStore.setState({
      ...(c.sequences !== undefined && { sequences: c.sequences as CueSequence[] }),
      ...(c.activeSequenceId !== undefined && { activeSequenceId: c.activeSequenceId as string | null }),
      ...(c.activeCueIndex !== undefined && { activeCueIndex: c.activeCueIndex as number }),
      ...(c.playbackStatus !== undefined && { playbackStatus: c.playbackStatus as CuePlaybackStatus }),
    });
  }
});
