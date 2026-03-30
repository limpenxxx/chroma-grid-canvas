import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Home, Crosshair } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

interface Fixture {
  id: string;
  name: string;
  type: 'moving-head' | 'par' | 'strip';
  color: { r: number; g: number; b: number; w: number };
  pan: number;
  tilt: number;
  dimmer: number;
}

const MOCK_FIXTURES: Fixture[] = [
  { id: '1', name: 'MH-1', type: 'moving-head', color: { r: 255, g: 0, b: 100, w: 0 }, pan: 50, tilt: 50, dimmer: 80 },
  { id: '2', name: 'MH-2', type: 'moving-head', color: { r: 0, g: 200, b: 255, w: 0 }, pan: 30, tilt: 70, dimmer: 100 },
  { id: '3', name: 'PAR-1', type: 'par', color: { r: 255, g: 100, b: 0, w: 128 }, pan: 0, tilt: 0, dimmer: 60 },
  { id: '4', name: 'STRIP-1', type: 'strip', color: { r: 0, g: 255, b: 50, w: 255 }, pan: 0, tilt: 0, dimmer: 90 },
];

function ColorWheel({ color, onChange }: { color: { r: number; g: number; b: number; w: number }; onChange: (c: typeof color) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = 180;

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;
    const angle = Math.atan2(y, x);
    const dist = Math.min(Math.sqrt(x * x + y * y), size / 2 - 10);
    const hue = ((angle * 180 / Math.PI) + 360) % 360;
    const sat = dist / (size / 2 - 10);

    // HSV to RGB
    const c = sat;
    const xx = c * (1 - Math.abs((hue / 60) % 2 - 1));
    const m = 1 - c;
    let r1 = 0, g1 = 0, b1 = 0;
    if (hue < 60) { r1 = c; g1 = xx; }
    else if (hue < 120) { r1 = xx; g1 = c; }
    else if (hue < 180) { g1 = c; b1 = xx; }
    else if (hue < 240) { g1 = xx; b1 = c; }
    else if (hue < 300) { r1 = xx; b1 = c; }
    else { r1 = c; b1 = xx; }

    onChange({
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255),
      w: color.w,
    });
  }, [color.w, onChange]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Outer color ring */}
      <div
        className="absolute inset-0 rounded-full control-glossy"
        style={{
          background: `conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)`,
          padding: 6,
        }}
      >
        <div className="w-full h-full rounded-full bg-[#0a0a0a] flex items-center justify-center">
          {/* Inner white ring */}
          <div
            className="w-16 h-16 rounded-full border-2 border-border/30"
            style={{
              background: `radial-gradient(circle, rgba(255,255,255,${color.w / 255}) 0%, rgba(255,255,255,0) 70%)`,
            }}
          />
        </div>
      </div>
      {/* Active color indicator */}
      <div
        className="absolute top-1/2 left-1/2 w-4 h-4 rounded-full border-2 border-foreground -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{ backgroundColor: `rgb(${color.r}, ${color.g}, ${color.b})`, boxShadow: `0 0 12px rgb(${color.r}, ${color.g}, ${color.b})` }}
      />
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="absolute inset-0 rounded-full cursor-crosshair opacity-0"
        onClick={handleClick}
      />
    </div>
  );
}

function XYPad({ pan, tilt, onPanChange, onTiltChange }: { pan: number; tilt: number; onPanChange: (v: number) => void; onTiltChange: (v: number) => void }) {
  const padRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging && e.type !== 'click') return;
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    onPanChange(Math.round(x));
    onTiltChange(Math.round(y));
  }, [isDragging, onPanChange, onTiltChange]);

  return (
    <div className="space-y-2">
      <div
        ref={padRef}
        className="w-44 h-44 rounded-lg control-glossy border border-border/30 relative cursor-crosshair select-none"
        onMouseDown={(e) => { setIsDragging(true); handleMove(e); }}
        onMouseMove={handleMove}
        onMouseUp={() => setIsDragging(false)}
        onMouseLeave={() => setIsDragging(false)}
        onClick={handleMove}
      >
        {/* Grid lines */}
        <div className="absolute inset-0 rounded-lg overflow-hidden pointer-events-none">
          <div className="absolute left-1/2 top-0 w-px h-full bg-border/20" />
          <div className="absolute top-1/2 left-0 w-full h-px bg-border/20" />
        </div>
        {/* Crosshair */}
        <motion.div
          className="absolute w-4 h-4 rounded-full border-2 border-primary -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{ left: `${pan}%`, top: `${tilt}%`, boxShadow: '0 0 8px hsl(155, 100%, 50%)' }}
          animate={{ left: `${pan}%`, top: `${tilt}%` }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        />
        {/* Labels */}
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] text-muted-foreground/50">PAN</span>
        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[8px] text-muted-foreground/50 -rotate-90">TILT</span>
      </div>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" className="h-6 text-[9px] flex-1" onClick={() => { onPanChange(50); onTiltChange(50); }}>
          <Crosshair size={10} /> Center
        </Button>
        <Button variant="outline" size="sm" className="h-6 text-[9px] flex-1" onClick={() => { onPanChange(50); onTiltChange(0); }}>
          <Home size={10} /> Home
        </Button>
      </div>
    </div>
  );
}

export function FixtureControls() {
  const [fixtures, setFixtures] = useState<Fixture[]>(MOCK_FIXTURES);
  const [selectedId, setSelectedId] = useState<string>('1');
  const selected = fixtures.find(f => f.id === selectedId)!;

  const updateFixture = (id: string, updates: Partial<Fixture>) => {
    setFixtures(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
      <div className="p-3 border-b border-border/30">
        <h2 className="text-sm font-semibold tracking-wider">FIXTURE CONTROLS</h2>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Fixture List */}
        <div className="w-40 border-r border-border/30 p-2 space-y-1 overflow-y-auto">
          {fixtures.map(f => (
            <button
              key={f.id}
              onClick={() => setSelectedId(f.id)}
              className={`w-full flex items-center gap-2 p-2 rounded text-xs transition-all ${
                selectedId === f.id ? 'bg-primary/10 border border-primary/30 text-primary' : 'hover:bg-muted/50 text-muted-foreground'
              }`}
            >
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `rgb(${f.color.r},${f.color.g},${f.color.b})`, boxShadow: `0 0 6px rgb(${f.color.r},${f.color.g},${f.color.b})` }} />
              {f.name}
            </button>
          ))}
        </div>

        {/* Controls */}
        <div className="flex-1 p-6 overflow-y-auto">
          <div className="flex flex-wrap gap-8 items-start">
            {/* Color Wheel */}
            <div className="space-y-3">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block text-center">RGBW COLOR</label>
              <ColorWheel
                color={selected.color}
                onChange={(c) => updateFixture(selected.id, { color: c })}
              />
              {/* White channel */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-muted-foreground w-4">W</span>
                <Slider
                  value={[selected.color.w]}
                  onValueChange={([v]) => updateFixture(selected.id, { color: { ...selected.color, w: v } })}
                  max={255}
                  className="flex-1"
                />
                <span className="text-[9px] font-mono text-muted-foreground w-6">{selected.color.w}</span>
              </div>
              {/* Color readout */}
              <div className="text-[9px] font-mono text-muted-foreground text-center">
                R:{selected.color.r} G:{selected.color.g} B:{selected.color.b} W:{selected.color.w}
              </div>
            </div>

            {/* XY Pad */}
            {selected.type === 'moving-head' && (
              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground block text-center">PAN / TILT</label>
                <XYPad
                  pan={selected.pan}
                  tilt={selected.tilt}
                  onPanChange={(v) => updateFixture(selected.id, { pan: v })}
                  onTiltChange={(v) => updateFixture(selected.id, { tilt: v })}
                />
                <div className="text-[9px] font-mono text-muted-foreground text-center">
                  P:{selected.pan}° T:{selected.tilt}°
                </div>
              </div>
            )}

            {/* Dimmer */}
            <div className="space-y-3">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block text-center">DIMMER</label>
              <div className="h-44 w-12 rounded-lg fader-track border border-border/30 relative mx-auto">
                <motion.div
                  className="absolute bottom-0 left-0 w-full rounded-b-lg bg-gradient-to-t from-primary/60 to-primary/20"
                  animate={{ height: `${selected.dimmer}%` }}
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={selected.dimmer}
                  onChange={(e) => updateFixture(selected.id, { dimmer: Number(e.target.value) })}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-ns-resize"
                  style={{ writingMode: 'vertical-lr', direction: 'rtl' } as React.CSSProperties}
                />
              </div>
              <div className="text-[9px] font-mono text-muted-foreground text-center">{selected.dimmer}%</div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
