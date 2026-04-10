import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { broadcastState, isSyncingFromRemote, onSyncState, sendMasterDimmer, sendBlackout } from '@/lib/wsSync';

export type ModuleId = 'stage' | 'media' | 'text' | 'fixtures' | 'nodes' | 'devices' | 'livedj' | 'systemlog' | 'files' | 'stage3d' | 'showrunner' | 'effects';
export type UserRole = 'admin' | 'user';
export type LayoutMode = 'desktop' | 'tablet' | 'mobile';

const USER_MODULES: ModuleId[] = ['media', 'text', 'livedj', 'stage'];

const getDefaultLayoutMode = (): LayoutMode => {
  if (typeof window === 'undefined') return 'desktop';
  if (window.innerWidth < 768) return 'mobile';
  if (window.innerWidth < 1100) return 'tablet';
  return 'desktop';
};

interface AppState {
  activeModule: ModuleId;
  setActiveModule: (m: ModuleId) => void;
  masterDimmer: number;
  setMasterDimmer: (v: number) => void;
  blackout: boolean;
  toggleBlackout: () => void;
  // Role system
  userRole: UserRole | null;
  setUserRole: (r: UserRole) => void;
  logout: () => void;
  userName: string;
  adminName: string;
  setUserName: (n: string) => void;
  setAdminName: (n: string) => void;
  isModuleAllowed: (m: ModuleId) => boolean;
  // Layout mode
  layoutMode: LayoutMode;
  hasManualLayoutMode: boolean;
  setLayoutMode: (m: LayoutMode, options?: { manual?: boolean }) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeModule: 'stage',
      setActiveModule: (m) => set({ activeModule: m }),
      masterDimmer: 100,
      setMasterDimmer: (v) => {
        set({ masterDimmer: v });
        sendMasterDimmer(v);
      },
      blackout: false,
      toggleBlackout: () => {
        const newVal = !get().blackout;
        set({ blackout: newVal });
        sendBlackout(newVal);
      },
      userRole: null,
      setUserRole: (r) => set({ userRole: r, activeModule: r === 'user' ? 'media' : 'stage' }),
      logout: () => set({ userRole: null }),
      userName: 'User',
      adminName: 'Admin',
      setUserName: (n) => set({ userName: n }),
      setAdminName: (n) => set({ adminName: n }),
      isModuleAllowed: (m) => {
        const role = get().userRole;
        if (role === 'admin' || !role) return true;
        return USER_MODULES.includes(m);
      },
      layoutMode: getDefaultLayoutMode(),
      hasManualLayoutMode: false,
      setLayoutMode: (m, options) => set({
        layoutMode: m,
        hasManualLayoutMode: options?.manual ?? true,
      }),
    }),
    {
      name: 'stokio-app-v1',
      partialize: (s) => ({
        userName: s.userName,
        adminName: s.adminName,
        layoutMode: s.layoutMode,
        hasManualLayoutMode: s.hasManualLayoutMode,
      }),
    }
  )
);

// Sync: broadcast changes
useAppStore.subscribe((state) => {
  if (!isSyncingFromRemote()) {
    const { activeModule, masterDimmer, blackout, userRole, userName, adminName } = state;
    broadcastState('app', { activeModule, masterDimmer, blackout, userRole, userName, adminName });
  }
});

// Sync: receive remote updates
onSyncState((incoming) => {
  const appState = incoming.app as Record<string, unknown> | undefined;
  if (appState) {
    useAppStore.setState({
      ...(appState.activeModule !== undefined && { activeModule: appState.activeModule as ModuleId }),
      ...(appState.masterDimmer !== undefined && { masterDimmer: appState.masterDimmer as number }),
      ...(appState.blackout !== undefined && { blackout: appState.blackout as boolean }),
      ...(appState.userRole !== undefined && { userRole: appState.userRole as UserRole | null }),
      ...(appState.userName !== undefined && { userName: appState.userName as string }),
      ...(appState.adminName !== undefined && { adminName: appState.adminName as string }),
    });
  }
});
