import { useState } from 'react';
import { motion } from 'framer-motion';
import { Type, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';

interface TextOverlay {
  id: string;
  text: string;
  font: string;
  color: string;
  size: number;
  scrollSpeed: number;
}

const FONTS = ['Inter', 'Arial', 'Georgia', 'Courier New', 'Impact', 'Comic Sans MS'];
const EMOJIS = ['🔥', '⚡', '🎵', '💡', '🌈', '✨', '🎸', '🎤', '🎹', '🎧', '💥', '🌟', '❤️', '🎶', '🎪', '🎭'];

export function TextOverlays() {
  const [overlays, setOverlays] = useState<TextOverlay[]>([
    { id: '1', text: 'STOKIO FX', font: 'Impact', color: '#00e5ff', size: 48, scrollSpeed: 0 },
  ]);
  const [selectedId, setSelectedId] = useState<string | null>('1');

  const selected = overlays.find(o => o.id === selectedId);

  const addOverlay = () => {
    const newO: TextOverlay = {
      id: String(Date.now()),
      text: 'New Text',
      font: 'Inter',
      color: '#ffffff',
      size: 32,
      scrollSpeed: 0,
    };
    setOverlays(prev => [...prev, newO]);
    setSelectedId(newO.id);
  };

  const updateOverlay = (id: string, updates: Partial<TextOverlay>) => {
    setOverlays(prev => prev.map(o => o.id === id ? { ...o, ...updates } : o));
  };

  const removeOverlay = (id: string) => {
    setOverlays(prev => prev.filter(o => o.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-border/30">
        <h2 className="text-sm font-semibold tracking-wider">TEXT OVERLAYS</h2>
        <Button variant="outline" size="sm" onClick={addOverlay} className="h-7 text-[10px] gap-1">
          <Plus size={12} /> Add Text
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* List */}
        <div className="w-48 border-r border-border/30 overflow-y-auto p-2 space-y-1">
          {overlays.map(o => (
            <div
              key={o.id}
              onClick={() => setSelectedId(o.id)}
              className={`flex items-center gap-2 p-2 rounded cursor-pointer text-xs ${
                selectedId === o.id ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50'
              }`}
            >
              <Type size={12} className="text-stokio-cyan shrink-0" />
              <span className="truncate flex-1">{o.text}</span>
              <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={(e) => { e.stopPropagation(); removeOverlay(o.id); }}>
                <Trash2 size={10} />
              </Button>
            </div>
          ))}
        </div>

        {/* Editor */}
        {selected ? (
          <div className="flex-1 p-4 space-y-4 overflow-y-auto">
            {/* Preview */}
            <div className="aspect-video bg-[#0a0a0a] rounded-lg border border-border/30 flex items-center justify-center overflow-hidden">
              <motion.span
                style={{
                  fontFamily: selected.font,
                  fontSize: selected.size,
                  color: selected.color,
                }}
                animate={selected.scrollSpeed > 0 ? { x: [300, -300] } : {}}
                transition={selected.scrollSpeed > 0 ? { duration: 10 / selected.scrollSpeed, repeat: Infinity, ease: 'linear' } : {}}
                className="whitespace-nowrap font-bold"
              >
                {selected.text}
              </motion.span>
            </div>

            <Input
              value={selected.text}
              onChange={(e) => updateOverlay(selected.id, { text: e.target.value })}
              placeholder="Enter text..."
              className="bg-muted/30 border-border/30"
            />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">Font</label>
                <select
                  value={selected.font}
                  onChange={(e) => updateOverlay(selected.id, { font: e.target.value })}
                  className="w-full h-8 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground"
                >
                  {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">Color</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={selected.color}
                    onChange={(e) => updateOverlay(selected.id, { color: e.target.value })}
                    className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
                  />
                  <span className="text-[10px] font-mono text-muted-foreground">{selected.color}</span>
                </div>
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">Size: {selected.size}px</label>
              <Slider value={[selected.size]} onValueChange={([v]) => updateOverlay(selected.id, { size: v })} min={12} max={120} step={1} />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">Scroll Speed: {selected.scrollSpeed}</label>
              <Slider value={[selected.scrollSpeed]} onValueChange={([v]) => updateOverlay(selected.id, { scrollSpeed: v })} min={0} max={10} step={1} />
            </div>

            {/* Emoji Picker */}
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 block">Insert Emoji</label>
              <div className="flex flex-wrap gap-1">
                {EMOJIS.map(e => (
                  <button
                    key={e}
                    onClick={() => updateOverlay(selected.id, { text: selected.text + e })}
                    className="w-8 h-8 rounded hover:bg-muted/50 flex items-center justify-center text-lg transition-transform hover:scale-125"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Select a text overlay to edit
          </div>
        )}
      </div>
    </motion.div>
  );
}
