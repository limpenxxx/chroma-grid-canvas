import { useState } from 'react';
import { motion } from 'framer-motion';
import { Upload, Play, Pause, SkipForward, GripVertical, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

interface MediaItem {
  id: string;
  name: string;
  type: 'video' | 'image' | 'gif';
  duration: string;
  crossfade: number;
}

const MOCK_MEDIA: MediaItem[] = [
  { id: '1', name: 'Rainbow Wave.mp4', type: 'video', duration: '2:30', crossfade: 2 },
  { id: '2', name: 'Fire Effect.gif', type: 'gif', duration: 'Loop', crossfade: 1 },
  { id: '3', name: 'Ocean Blue.mp4', type: 'video', duration: '1:45', crossfade: 3 },
  { id: '4', name: 'Logo Static.png', type: 'image', duration: '∞', crossfade: 0 },
];

export function MediaServer() {
  const [playlist, setPlaylist] = useState<MediaItem[]>(MOCK_MEDIA);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  const removeItem = (id: string) => {
    setPlaylist(prev => prev.filter(item => item.id !== id));
  };

  const updateCrossfade = (id: string, value: number) => {
    setPlaylist(prev => prev.map(item =>
      item.id === id ? { ...item, crossfade: value } : item
    ));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="h-full flex flex-col"
    >
      <div className="flex items-center justify-between p-3 border-b border-border/30">
        <h2 className="text-sm font-semibold tracking-wider">MEDIA SERVER</h2>
        <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1">
          <Upload size={12} /> Import Media
        </Button>
      </div>

      {/* Playback Controls */}
      <div className="p-4 border-b border-border/30 glass-panel m-4 rounded-lg">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsPlaying(!isPlaying)}
            className="h-10 w-10 rounded-full control-glossy border border-border/30"
          >
            {isPlaying ? <Pause size={18} className="text-primary" /> : <Play size={18} className="text-primary" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full control-glossy border border-border/30"
            onClick={() => setActiveIndex(i => (i + 1) % playlist.length)}>
            <SkipForward size={14} />
          </Button>
          <div className="flex-1">
            <div className="text-xs font-medium">{playlist[activeIndex]?.name || 'No media'}</div>
            <div className="text-[10px] text-muted-foreground">{playlist[activeIndex]?.duration}</div>
          </div>
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse-glow" />
        </div>
        {/* Progress */}
        <div className="mt-3 h-1 bg-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary rounded-full"
            animate={{ width: isPlaying ? '100%' : '35%' }}
            transition={{ duration: isPlaying ? 8 : 0, ease: 'linear', repeat: Infinity }}
          />
        </div>
      </div>

      {/* Playlist */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1">
        {playlist.map((item, idx) => (
          <motion.div
            key={item.id}
            layout
            className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
              idx === activeIndex
                ? 'border-primary/40 bg-primary/5 glow-green'
                : 'border-border/20 bg-card/40 hover:bg-card/60'
            }`}
            onClick={() => setActiveIndex(idx)}
          >
            <GripVertical size={14} className="text-muted-foreground/30 cursor-grab" />
            <div className={`w-8 h-8 rounded flex items-center justify-center text-[9px] uppercase font-bold ${
              item.type === 'video' ? 'bg-stokio-cyan/20 text-stokio-cyan' :
              item.type === 'gif' ? 'bg-stokio-pink/20 text-stokio-pink' :
              'bg-muted text-muted-foreground'
            }`}>
              {item.type}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{item.name}</div>
              <div className="text-[10px] text-muted-foreground">{item.duration}</div>
            </div>
            <div className="flex items-center gap-2 w-32">
              <span className="text-[9px] text-muted-foreground">XF</span>
              <Slider
                value={[item.crossfade]}
                onValueChange={([v]) => updateCrossfade(item.id, v)}
                max={10}
                step={0.5}
                className="flex-1"
              />
              <span className="text-[9px] font-mono text-muted-foreground w-5">{item.crossfade}s</span>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}>
              <Trash2 size={12} className="text-muted-foreground hover:text-destructive" />
            </Button>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
