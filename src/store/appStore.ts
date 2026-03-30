import { create } from 'zustand';

export type ModuleId = 'stage' | 'media' | 'text' | 'fixtures' | 'nodes' | 'devices' | 'livedj';

interface AppState {
  activeModule: ModuleId;
  setActiveModule: (m: ModuleId) => void;
  masterDimmer: number;
  setMasterDimmer: (v: number) => void;
  blackout: boolean;
  toggleBlackout: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeModule: 'stage',
  setActiveModule: (m) => set({ activeModule: m }),
  masterDimmer: 100,
  setMasterDimmer: (v) => set({ masterDimmer: v }),
  blackout: false,
  toggleBlackout: () => set((s) => ({ blackout: !s.blackout })),
}));
