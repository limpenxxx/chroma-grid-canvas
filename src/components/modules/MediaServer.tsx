import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, Play, Pause, SkipForward, SkipBack, GripVertical, Trash2,
  Plus, Link, Film, Image, Repeat, Repeat1, Shuffle, ListMusic,
  ChevronDown, ChevronRight, X, Edit2, Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  useMediaStore, type MediaItem, type Playlist, type LoopMode,
  parseYouTubeId, parseVimeoId, getEmbedUrl,
} from '@/store/mediaStore';

const LOOP_MODES: { value: LoopMode; label: string; icon: typeof Repeat }[] = [
  { value: 'none', label: 'No Loop', icon: Repeat },
  { value: 'loop-all', label: 'Loop All', icon: Repeat },
  { value: 'loop-one', label: 'Loop One', icon: Repeat1 },
  { value: 'shuffle', label: 'Shuffle', icon: Shuffle },
];

export function MediaServer() {
  const store = useMediaStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = useState('');
  const [showUrlDialog, setShowUrlDialog] = useState(false);
  const [expandedPlaylist, setExpandedPlaylist] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [tab, setTab] = useState<'library' | 'playlists'>('library');

  // Upload video files
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');
      const isGif = file.type === 'image/gif';

      if (!isVideo && !isImage) return;

      // Check video resolution via video element
      const objectUrl = URL.createObjectURL(file);

      if (isVideo) {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
          if (video.videoHeight > 1080) {
            alert(`${file.name}: Max resolution is 1080p. This video is ${video.videoHeight}p.`);
            URL.revokeObjectURL(objectUrl);
            return;
          }
          store.addItem({
            id: crypto.randomUUID(),
            name: file.name,
            type: 'video',
            sourceType: 'file',
            src: objectUrl,
            duration: Math.round(video.duration),
            crossfade: 2,
            createdAt: Date.now(),
          });
        };
        video.src = objectUrl;
      } else {
        store.addItem({
          id: crypto.randomUUID(),
          name: file.name,
          type: isGif ? 'gif' : 'image',
          sourceType: 'file',
          src: objectUrl,
          duration: 0,
          crossfade: 1,
          createdAt: Date.now(),
        });
      }
    });
    e.target.value = '';
  }, [store]);

  // Add URL (YouTube, Vimeo, or direct)
  const handleAddUrl = () => {
    const url = urlInput.trim();
    if (!url) return;

    const ytId = parseYouTubeId(url);
    const vimeoId = parseVimeoId(url);

    if (ytId) {
      store.addItem({
        id: crypto.randomUUID(),
        name: `YouTube: ${ytId}`,
        type: 'video',
        sourceType: 'youtube',
        src: `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`,
        externalUrl: url,
        thumbnailUrl: `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`,
        duration: 0,
        crossfade: 2,
        createdAt: Date.now(),
      });
    } else if (vimeoId) {
      store.addItem({
        id: crypto.randomUUID(),
        name: `Vimeo: ${vimeoId}`,
        type: 'video',
        sourceType: 'vimeo',
        src: url,
        externalUrl: url,
        duration: 0,
        crossfade: 2,
        createdAt: Date.now(),
      });
    } else {
      store.addItem({
        id: crypto.randomUUID(),
        name: url.split('/').pop() || 'External Video',
        type: 'video',
        sourceType: 'url',
        src: url,
        duration: 0,
        crossfade: 2,
        createdAt: Date.now(),
      });
    }

    setUrlInput('');
    setShowUrlDialog(false);
  };

  const createPlaylist = () => {
    if (!newPlaylistName.trim()) return;
    store.addPlaylist({
      id: crypto.randomUUID(),
      name: newPlaylistName.trim(),
      itemIds: [],
      loopMode: 'loop-all',
      createdAt: Date.now(),
    });
    setNewPlaylistName('');
    setShowNewPlaylist(false);
  };

  const addItemToPlaylist = (playlistId: string, itemId: string) => {
    const pl = store.playlists.find(p => p.id === playlistId);
    if (!pl) return;
    if (pl.itemIds.includes(itemId)) return;
    store.updatePlaylist(playlistId, { itemIds: [...pl.itemIds, itemId] });
  };

  const removeItemFromPlaylist = (playlistId: string, itemId: string) => {
    const pl = store.playlists.find(p => p.id === playlistId);
    if (!pl) return;
    store.updatePlaylist(playlistId, { itemIds: pl.itemIds.filter(id => id !== itemId) });
  };

  const activeItem = store.items.find(i => i.id === store.activeItemId);
  const activePlaylist = store.playlists.find(p => p.id === store.activePlaylistId);

  const formatDuration = (s: number) => {
    if (s <= 0) return '—';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const typeColors: Record<string, string> = {
    video: 'bg-stokio-cyan/20 text-stokio-cyan',
    image: 'bg-muted text-muted-foreground',
    gif: 'bg-stokio-pink/20 text-stokio-pink',
  };

  const sourceIcon = (item: MediaItem) => {
    if (item.sourceType === 'youtube') return '▶ YT';
    if (item.sourceType === 'vimeo') return '▶ VM';
    if (item.sourceType === 'url') return '🔗';
    return item.type.toUpperCase();
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border/30">
        <h2 className="text-sm font-semibold tracking-wider">MEDIA SERVER</h2>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1"
            onClick={() => fileInputRef.current?.click()}>
            <Upload size={12} /> Upload
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1"
            onClick={() => setShowUrlDialog(true)}>
            <Link size={12} /> Add URL
          </Button>
          <input ref={fileInputRef} type="file" accept="video/*,image/*" multiple className="hidden"
            onChange={handleFileUpload} />
        </div>
      </div>

      {/* Now Playing Bar */}
      <div className="p-3 border-b border-border/30 glass-panel mx-3 mt-3 rounded-lg">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full control-glossy border border-border/30"
            onClick={() => store.setIsPlaying(!store.isPlaying)}>
            {store.isPlaying ? <Pause size={14} className="text-primary" /> : <Play size={14} className="text-primary" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full control-glossy border border-border/30"
            onClick={() => store.nextInPlaylist()}>
            <SkipForward size={12} />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{activeItem?.name || 'No media selected'}</div>
            <div className="text-[9px] text-muted-foreground">
              {activePlaylist ? `Playlist: ${activePlaylist.name}` : activeItem ? 'Single' : '—'}
              {activeItem && activeItem.duration > 0 && ` • ${formatDuration(activeItem.duration)}`}
            </div>
          </div>
          {store.isPlaying && <div className="w-2 h-2 rounded-full bg-primary animate-pulse-glow" />}
        </div>

        {/* Preview area */}
        {activeItem && store.isPlaying && (
          <div className="mt-2 rounded-lg overflow-hidden bg-black aspect-video max-h-40">
            {activeItem.sourceType === 'file' && activeItem.type === 'video' && (
              <video src={activeItem.src} autoPlay loop muted className="w-full h-full object-contain" />
            )}
            {(activeItem.sourceType === 'youtube' || activeItem.sourceType === 'vimeo') && (
              <iframe src={getEmbedUrl(activeItem) || ''} className="w-full h-full border-0" allow="autoplay" />
            )}
            {activeItem.sourceType === 'url' && activeItem.type === 'video' && (
              <video src={activeItem.src} autoPlay loop muted className="w-full h-full object-contain" />
            )}
            {(activeItem.type === 'image' || activeItem.type === 'gif') && (
              <img src={activeItem.src} className="w-full h-full object-contain" alt={activeItem.name} />
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 pt-3">
        {(['library', 'playlists'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold rounded transition-colors ${
              tab === t ? 'bg-primary/10 text-primary border border-primary/30' : 'text-muted-foreground hover:text-foreground'
            }`}>
            {t === 'library' ? '📁 Library' : '📋 Playlists'}
          </button>
        ))}
      </div>

      {/* ── LIBRARY TAB ── */}
      {tab === 'library' && (
        <div className="flex-1 overflow-y-auto px-3 pb-3 pt-2 space-y-1">
          {store.items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/40">
              <Film size={32} />
              <span className="text-sm mt-2">No media yet</span>
              <span className="text-[10px] mt-1">Upload files or add YouTube/Vimeo URLs</span>
            </div>
          )}
          {store.items.map(item => (
            <div key={item.id}
              className={`flex items-center gap-2 p-2 rounded-lg border transition-all cursor-pointer ${
                store.activeItemId === item.id
                  ? 'border-primary/40 bg-primary/5 glow-green'
                  : 'border-border/20 bg-card/40 hover:bg-card/60'
              }`}
              onClick={() => store.playItem(item.id)}>
              {/* Thumbnail */}
              <div className={`w-10 h-10 rounded flex items-center justify-center text-[7px] uppercase font-bold shrink-0 ${typeColors[item.type] || 'bg-muted text-muted-foreground'}`}>
                {item.thumbnailUrl
                  ? <img src={item.thumbnailUrl} className="w-full h-full object-cover rounded" alt="" />
                  : sourceIcon(item)
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-medium truncate">{item.name}</div>
                <div className="text-[9px] text-muted-foreground flex items-center gap-2">
                  <span>{item.sourceType === 'file' ? 'Local' : item.sourceType.toUpperCase()}</span>
                  {item.duration > 0 && <span>{formatDuration(item.duration)}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 w-24 shrink-0">
                <span className="text-[8px] text-muted-foreground">XF</span>
                <Slider value={[item.crossfade]} onValueChange={([v]) => store.updateItem(item.id, { crossfade: v })}
                  max={10} step={0.5} className="flex-1" />
                <span className="text-[8px] font-mono text-muted-foreground w-4">{item.crossfade}s</span>
              </div>
              {/* Add to playlist dropdown */}
              {store.playlists.length > 0 && (
                <select className="h-6 text-[8px] bg-muted/30 border border-border/30 rounded px-1 text-muted-foreground"
                  value="" onChange={e => { e.stopPropagation(); addItemToPlaylist(e.target.value, item.id); }}
                  onClick={e => e.stopPropagation()}>
                  <option value="" disabled>+ Playlist</option>
                  {store.playlists.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
                </select>
              )}
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0"
                onClick={e => { e.stopPropagation(); store.removeItem(item.id); }}>
                <Trash2 size={11} className="text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* ── PLAYLISTS TAB ── */}
      {tab === 'playlists' && (
        <div className="flex-1 overflow-y-auto px-3 pb-3 pt-2 space-y-2">
          {/* Create new playlist */}
          {showNewPlaylist ? (
            <div className="flex gap-1">
              <Input value={newPlaylistName} onChange={e => setNewPlaylistName(e.target.value)}
                placeholder="Playlist name..." className="h-7 text-[10px] bg-muted/20 border-border/20 flex-1"
                autoFocus onKeyDown={e => { if (e.key === 'Enter') createPlaylist(); if (e.key === 'Escape') setShowNewPlaylist(false); }} />
              <Button size="sm" className="h-7 text-[9px]" onClick={createPlaylist}>Create</Button>
              <Button size="sm" variant="ghost" className="h-7 text-[9px]" onClick={() => setShowNewPlaylist(false)}>
                <X size={10} />
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-full h-7 text-[9px] gap-1" onClick={() => setShowNewPlaylist(true)}>
              <Plus size={10} /> New Playlist
            </Button>
          )}

          {store.playlists.length === 0 && !showNewPlaylist && (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/40">
              <ListMusic size={24} />
              <span className="text-[11px] mt-2">No playlists yet</span>
            </div>
          )}

          {store.playlists.map(pl => {
            const isExpanded = expandedPlaylist === pl.id;
            const isActive = store.activePlaylistId === pl.id;
            const loopInfo = LOOP_MODES.find(m => m.value === pl.loopMode);
            const LoopIcon = loopInfo?.icon || Repeat;

            return (
              <div key={pl.id} className={`rounded-lg border transition-all ${
                isActive ? 'border-primary/40 bg-primary/5' : 'border-border/20 bg-card/40'
              }`}>
                {/* Playlist header */}
                <div className="flex items-center gap-2 p-2 cursor-pointer" onClick={() => setExpandedPlaylist(isExpanded ? null : pl.id)}>
                  {isExpanded ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
                  {editingPlaylistId === pl.id ? (
                    <input value={editingName} onChange={e => setEditingName(e.target.value)}
                      onBlur={() => { if (editingName.trim()) store.updatePlaylist(pl.id, { name: editingName.trim() }); setEditingPlaylistId(null); }}
                      onKeyDown={e => { if (e.key === 'Enter') { if (editingName.trim()) store.updatePlaylist(pl.id, { name: editingName.trim() }); setEditingPlaylistId(null); } }}
                      className="text-[11px] font-semibold bg-transparent border-b border-primary outline-none flex-1 px-1"
                      autoFocus onClick={e => e.stopPropagation()} />
                  ) : (
                    <span className="text-[11px] font-semibold flex-1 truncate">{pl.name}</span>
                  )}
                  <span className="text-[8px] text-muted-foreground">{pl.itemIds.length} items</span>

                  {/* Loop mode cycle */}
                  <button onClick={e => {
                    e.stopPropagation();
                    const modes: LoopMode[] = ['none', 'loop-all', 'loop-one', 'shuffle'];
                    const next = modes[(modes.indexOf(pl.loopMode) + 1) % modes.length];
                    store.updatePlaylist(pl.id, { loopMode: next });
                  }}
                    className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${
                      pl.loopMode !== 'none' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'
                    }`}
                    title={loopInfo?.label}>
                    <LoopIcon size={12} />
                  </button>

                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); store.playPlaylist(pl.id); }}>
                    <Play size={11} className="text-primary" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); setEditingPlaylistId(pl.id); setEditingName(pl.name); }}>
                    <Edit2 size={10} className="text-muted-foreground" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); store.removePlaylist(pl.id); }}>
                    <Trash2 size={10} className="text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>

                {/* Expanded: show items */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="px-2 pb-2 space-y-0.5">
                        {pl.itemIds.map((itemId, idx) => {
                          const item = store.items.find(i => i.id === itemId);
                          if (!item) return null;
                          const isCurrent = isActive && store.activeItemId === itemId;
                          return (
                            <div key={`${pl.id}-${itemId}-${idx}`}
                              className={`flex items-center gap-2 px-2 py-1 rounded text-[10px] transition-all ${
                                isCurrent ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/20'
                              }`}>
                              <span className="w-4 text-[8px] text-muted-foreground/50">{idx + 1}</span>
                              <span className="flex-1 truncate">{item.name}</span>
                              {item.duration > 0 && <span className="text-[8px]">{formatDuration(item.duration)}</span>}
                              <button onClick={() => removeItemFromPlaylist(pl.id, itemId)} className="text-muted-foreground/40 hover:text-destructive">
                                <X size={10} />
                              </button>
                            </div>
                          );
                        })}
                        {pl.itemIds.length === 0 && (
                          <div className="text-[9px] text-muted-foreground/40 text-center py-3">
                            Drag media from Library or use the "+ Playlist" button on items
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {/* URL Dialog */}
      <AnimatePresence>
        {showUrlDialog && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center"
            onClick={() => setShowUrlDialog(false)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="glass-panel-strong border border-border/30 rounded-xl p-6 w-96 space-y-4"
              onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-semibold flex items-center gap-2"><Link size={14} /> Add Video URL</h3>
              <div>
                <label className="text-[9px] uppercase text-muted-foreground">YouTube, Vimeo, or direct video URL</label>
                <Input value={urlInput} onChange={e => setUrlInput(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..." className="mt-1 bg-muted/20 border-border/20"
                  autoFocus onKeyDown={e => { if (e.key === 'Enter') handleAddUrl(); }} />
              </div>
              <div className="text-[8px] text-muted-foreground/60 space-y-0.5">
                <div>✅ YouTube: youtube.com/watch?v=... or youtu.be/...</div>
                <div>✅ Vimeo: vimeo.com/123456</div>
                <div>✅ Direct: https://example.com/video.mp4</div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowUrlDialog(false)}>Cancel</Button>
                <Button size="sm" onClick={handleAddUrl} disabled={!urlInput.trim()}>Add</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
