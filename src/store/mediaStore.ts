import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { broadcastState, isSyncingFromRemote, onSyncState } from '@/lib/wsSync';

export type MediaSourceType = 'file' | 'youtube' | 'vimeo' | 'url';
export type LoopMode = 'none' | 'loop-all' | 'loop-one' | 'shuffle';

export interface MediaItem {
  id: string;
  name: string;
  type: 'video' | 'image' | 'gif';
  sourceType: MediaSourceType;
  /** For file uploads: object URL / data URL; for external: the URL */
  src: string;
  /** Original URL for YouTube/Vimeo (for embed) */
  externalUrl?: string;
  thumbnailUrl?: string;
  duration: number; // seconds, 0 = unknown
  crossfade: number; // seconds
  createdAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  itemIds: string[];
  loopMode: LoopMode;
  createdAt: number;
}

interface MediaStore {
  items: MediaItem[];
  playlists: Playlist[];
  // Currently playing state
  activePlaylistId: string | null;
  activeItemId: string | null;
  isPlaying: boolean;

  addItem: (item: MediaItem) => void;
  removeItem: (id: string) => void;
  updateItem: (id: string, updates: Partial<MediaItem>) => void;

  addPlaylist: (playlist: Playlist) => void;
  removePlaylist: (id: string) => void;
  updatePlaylist: (id: string, updates: Partial<Playlist>) => void;

  setActivePlaylist: (id: string | null) => void;
  setActiveItem: (id: string | null) => void;
  setIsPlaying: (playing: boolean) => void;

  // Play a specific item standalone
  playItem: (itemId: string) => void;
  // Play a playlist from start
  playPlaylist: (playlistId: string) => void;
  // Advance to next item in playlist
  nextInPlaylist: () => void;
}

export const useMediaStore = create<MediaStore>()(
  persist(
    (set, get) => ({
      items: [],
      playlists: [],
      activePlaylistId: null,
      activeItemId: null,
      isPlaying: false,

      addItem: (item) => set(s => ({ items: [...s.items, item] })),
      removeItem: (id) => set(s => ({
        items: s.items.filter(i => i.id !== id),
        playlists: s.playlists.map(p => ({ ...p, itemIds: p.itemIds.filter(iid => iid !== id) })),
      })),
      updateItem: (id, updates) => set(s => ({
        items: s.items.map(i => i.id === id ? { ...i, ...updates } : i),
      })),

      addPlaylist: (pl) => set(s => ({ playlists: [...s.playlists, pl] })),
      removePlaylist: (id) => set(s => ({
        playlists: s.playlists.filter(p => p.id !== id),
        activePlaylistId: s.activePlaylistId === id ? null : s.activePlaylistId,
      })),
      updatePlaylist: (id, updates) => set(s => ({
        playlists: s.playlists.map(p => p.id === id ? { ...p, ...updates } : p),
      })),

      setActivePlaylist: (id) => set({ activePlaylistId: id }),
      setActiveItem: (id) => set({ activeItemId: id }),
      setIsPlaying: (playing) => set({ isPlaying: playing }),

      playItem: (itemId) => set({ activePlaylistId: null, activeItemId: itemId, isPlaying: true }),

      playPlaylist: (playlistId) => {
        const pl = get().playlists.find(p => p.id === playlistId);
        if (!pl || pl.itemIds.length === 0) return;
        const firstId = pl.loopMode === 'shuffle'
          ? pl.itemIds[Math.floor(Math.random() * pl.itemIds.length)]
          : pl.itemIds[0];
        set({ activePlaylistId: playlistId, activeItemId: firstId, isPlaying: true });
      },

      nextInPlaylist: () => {
        const { activePlaylistId, activeItemId, playlists } = get();
        if (!activePlaylistId) return;
        const pl = playlists.find(p => p.id === activePlaylistId);
        if (!pl || pl.itemIds.length === 0) return;

        if (pl.loopMode === 'loop-one') {
          // restart same item
          set({ isPlaying: true });
          return;
        }

        const currentIdx = pl.itemIds.indexOf(activeItemId || '');
        let nextIdx: number;

        if (pl.loopMode === 'shuffle') {
          nextIdx = Math.floor(Math.random() * pl.itemIds.length);
        } else {
          nextIdx = currentIdx + 1;
          if (nextIdx >= pl.itemIds.length) {
            if (pl.loopMode === 'loop-all') {
              nextIdx = 0;
            } else {
              set({ isPlaying: false });
              return;
            }
          }
        }

        set({ activeItemId: pl.itemIds[nextIdx], isPlaying: true });
      },
    }),
    {
      name: 'stokio-media-v1',
      partialize: (state) => ({
        items: state.items.filter(i => i.sourceType !== 'file'), // Don't persist blob URLs
        playlists: state.playlists,
      }),
    }
  )
);

// Helpers
export function parseYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

export function parseVimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? m[1] : null;
}

export function getEmbedUrl(item: MediaItem): string | null {
  if (item.sourceType === 'youtube' && item.externalUrl) {
    const id = parseYouTubeId(item.externalUrl);
    return id ? `https://www.youtube.com/embed/${id}?autoplay=1&controls=0` : null;
  }
  if (item.sourceType === 'vimeo' && item.externalUrl) {
    const id = parseVimeoId(item.externalUrl);
    return id ? `https://player.vimeo.com/video/${id}?autoplay=1&background=1` : null;
  }
  return null;
}
