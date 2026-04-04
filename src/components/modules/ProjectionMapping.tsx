import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Plus, Trash2, Circle, Square, Move, Maximize2, Copy,
  Play, Pause, Film, Palette, Settings2, Eye, EyeOff,
  RotateCcw, Lock, Unlock, Layers, ChevronDown
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';

// ── Types ──

type ShapeType = 'circle' | 'rect' | 'triangle' | 'quad';

interface ControlPoint {
  x: number;
  y: number;
}

interface ProjectionShape {
  id: string;
  type: ShapeType;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  // Bezier warp — 4 corner control points for quad distortion
  corners: [ControlPoint, ControlPoint, ControlPoint, ControlPoint];
  // Visual
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  // BPM sync
  bpmSync: boolean;
  bpmEffect: 'color-pulse' | 'opacity-pulse' | 'scale-pulse' | 'strobe' | 'rotate' | 'none';
  bpmColor1: string;
  bpmColor2: string;
  bpmIntensity: number; // 0-100
  // Video
  videoSrc: string | null;
  videoOpacity: number;
  videoBpmSync: boolean;
  videoFilter: 'none' | 'invert' | 'hue-rotate' | 'saturate' | 'contrast' | 'grayscale' | 'sepia';
  videoFilterIntensity: number; // 0-100
  videoPlaybackRate: number;
  // Blend
  blendMode: string;
  zIndex: number;
}

const DEFAULT_CORNERS: [ControlPoint, ControlPoint, ControlPoint, ControlPoint] = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
];

let shapeCounter = 0;

function createShape(type: ShapeType, x: number, y: number): ProjectionShape {
  shapeCounter++;
  return {
    id: `proj-${Date.now()}-${shapeCounter}`,
    type,
    label: `${type}-${shapeCounter}`,
    x, y,
    width: type === 'circle' ? 150 : 200,
    height: type === 'circle' ? 150 : 150,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    corners: JSON.parse(JSON.stringify(DEFAULT_CORNERS)),
    fillColor: '#00ccff',
    strokeColor: '#ffffff',
    strokeWidth: 2,
    opacity: 100,
    visible: true,
    locked: false,
    bpmSync: false,
    bpmEffect: 'none',
    bpmColor1: '#00ccff',
    bpmColor2: '#ff0066',
    bpmIntensity: 80,
    videoSrc: null,
    videoOpacity: 100,
    videoBpmSync: false,
    videoFilter: 'none',
    videoFilterIntensity: 50,
    videoPlaybackRate: 1,
    blendMode: 'normal',
    zIndex: shapeCounter,
  };
}

const BLEND_MODES = ['normal', 'screen', 'multiply', 'overlay', 'color-dodge', 'hard-light', 'soft-light', 'difference', 'exclusion', 'add'];

const SHAPE_PRESETS: { type: ShapeType; icon: typeof Circle; label: string }[] = [
  { type: 'rect', icon: Square, label: 'Rektangel' },
  { type: 'circle', icon: Circle, label: 'Cirkel' },
  { type: 'triangle', icon: Play, label: 'Triangel' },
  { type: 'quad', icon: Maximize2, label: 'Quad Warp' },
];

interface ProjectionMappingProps {
  bpm: number;
  beatFlash: boolean;
}

export function ProjectionMapping({ bpm, beatFlash }: ProjectionMappingProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [shapes, setShapes] = useState<ProjectionShape[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    type: 'move' | 'resize' | 'corner';
    shapeId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW?: number;
    origH?: number;
    cornerIdx?: number;
    origCorner?: ControlPoint;
  } | null>(null);
  const [showProps, setShowProps] = useState(true);
  const animFrameRef = useRef<number>(0);
  const videoRefs = useRef<Record<string, HTMLVideoElement>>({});
  const beatPhaseRef = useRef(0);
  const lastBeatRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = shapes.find(s => s.id === selectedId) || null;

  // ── BPM phase tracking ──
  useEffect(() => {
    if (beatFlash) {
      lastBeatRef.current = performance.now();
    }
  }, [beatFlash]);

  // ── Canvas render loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Dark background
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);

      // Grid
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
      for (let gy = 0; gy < h; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }

      const now = performance.now();
      const beatInterval = bpm > 0 ? 60000 / bpm : 1000;
      const beatPhase = ((now - lastBeatRef.current) % beatInterval) / beatInterval;
      beatPhaseRef.current = beatPhase;

      // Sort by zIndex
      const sorted = [...shapes].sort((a, b) => a.zIndex - b.zIndex);

      for (const shape of sorted) {
        if (!shape.visible) continue;

        ctx.save();
        ctx.globalAlpha = shape.opacity / 100;
        ctx.globalCompositeOperation = shape.blendMode as GlobalCompositeOperation;

        // BPM effects
        let fillColor = shape.fillColor;
        let currentOpacity = shape.opacity / 100;
        let scale = 1;
        let rot = shape.rotation;

        if (shape.bpmSync && bpm > 0) {
          const intensity = shape.bpmIntensity / 100;
          const pulse = Math.max(0, 1 - beatPhase * 3); // sharp attack, fast decay

          switch (shape.bpmEffect) {
            case 'color-pulse': {
              const r1 = parseInt(shape.bpmColor1.slice(1, 3), 16);
              const g1 = parseInt(shape.bpmColor1.slice(3, 5), 16);
              const b1 = parseInt(shape.bpmColor1.slice(5, 7), 16);
              const r2 = parseInt(shape.bpmColor2.slice(1, 3), 16);
              const g2 = parseInt(shape.bpmColor2.slice(3, 5), 16);
              const b2 = parseInt(shape.bpmColor2.slice(5, 7), 16);
              const t = pulse * intensity;
              const r = Math.round(r1 + (r2 - r1) * t);
              const g = Math.round(g1 + (g2 - g1) * t);
              const b = Math.round(b1 + (b2 - b1) * t);
              fillColor = `rgb(${r},${g},${b})`;
              break;
            }
            case 'opacity-pulse':
              currentOpacity = (shape.opacity / 100) * (1 - pulse * intensity * 0.8);
              currentOpacity = Math.max(0.05, currentOpacity);
              break;
            case 'scale-pulse':
              scale = 1 + pulse * intensity * 0.3;
              break;
            case 'strobe':
              currentOpacity = pulse > 0.5 ? shape.opacity / 100 : 0;
              break;
            case 'rotate':
              rot += beatPhase * 360 * intensity;
              break;
          }
        }

        ctx.globalAlpha = currentOpacity;

        const cx = shape.x + shape.width / 2;
        const cy = shape.y + shape.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((rot * Math.PI) / 180);
        ctx.scale(shape.scaleX * scale, shape.scaleY * scale);
        ctx.translate(-shape.width / 2, -shape.height / 2);

        // Draw shape
        if (shape.type === 'quad') {
          // Quad warp — draw as distorted quadrilateral using corners
          const pts = shape.corners.map(c => ({
            x: c.x * shape.width,
            y: c.y * shape.height,
          }));
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[1].x, pts[1].y);
          ctx.lineTo(pts[2].x, pts[2].y);
          ctx.lineTo(pts[3].x, pts[3].y);
          ctx.closePath();
        } else if (shape.type === 'circle') {
          ctx.beginPath();
          ctx.ellipse(shape.width / 2, shape.height / 2, shape.width / 2, shape.height / 2, 0, 0, Math.PI * 2);
        } else if (shape.type === 'triangle') {
          ctx.beginPath();
          ctx.moveTo(shape.width / 2, 0);
          ctx.lineTo(shape.width, shape.height);
          ctx.lineTo(0, shape.height);
          ctx.closePath();
        } else {
          ctx.beginPath();
          ctx.rect(0, 0, shape.width, shape.height);
        }

        // Video fill
        const vid = videoRefs.current[shape.id];
        if (shape.videoSrc && vid && vid.readyState >= 2) {
          ctx.save();
          ctx.clip();
          // Video filter
          if (shape.videoFilter !== 'none') {
            const fi = shape.videoFilterIntensity;
            switch (shape.videoFilter) {
              case 'invert': ctx.filter = `invert(${fi}%)`; break;
              case 'hue-rotate': ctx.filter = `hue-rotate(${fi * 3.6}deg)`; break;
              case 'saturate': ctx.filter = `saturate(${fi * 3}%)`; break;
              case 'contrast': ctx.filter = `contrast(${50 + fi * 2}%)`; break;
              case 'grayscale': ctx.filter = `grayscale(${fi}%)`; break;
              case 'sepia': ctx.filter = `sepia(${fi}%)`; break;
            }
          }
          ctx.globalAlpha = (shape.videoOpacity / 100) * currentOpacity;
          ctx.drawImage(vid, 0, 0, shape.width, shape.height);
          ctx.filter = 'none';
          ctx.restore();
        } else {
          ctx.fillStyle = fillColor;
          ctx.fill();
        }

        if (shape.strokeWidth > 0) {
          ctx.strokeStyle = shape.strokeColor;
          ctx.lineWidth = shape.strokeWidth;
          ctx.stroke();
        }

        // Selection indicator
        if (shape.id === selectedId) {
          ctx.strokeStyle = '#00ff88';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 3]);
          ctx.strokeRect(-4, -4, shape.width + 8, shape.height + 8);
          ctx.setLineDash([]);

          // Corner handles for quad warp
          if (shape.type === 'quad') {
            shape.corners.forEach((c, i) => {
              const px = c.x * shape.width;
              const py = c.y * shape.height;
              ctx.fillStyle = i === 0 ? '#ff0' : '#0ff';
              ctx.fillRect(px - 5, py - 5, 10, 10);
            });
          }

          // Resize handle
          ctx.fillStyle = '#00ff88';
          ctx.fillRect(shape.width - 6, shape.height - 6, 12, 12);
        }

        ctx.restore();
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [shapes, selectedId, bpm, beatFlash]);

  // ── Resize canvas ──
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // ── Mouse handlers for drag/resize/warp ──
  const getCanvasPos = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const pos = getCanvasPos(e);

    // Check shapes in reverse z-order (top first)
    const sorted = [...shapes].sort((a, b) => b.zIndex - a.zIndex);
    for (const shape of sorted) {
      if (!shape.visible || shape.locked) continue;

      const cx = shape.x + shape.width / 2;
      const cy = shape.y + shape.height / 2;
      // Simple AABB check
      const lx = pos.x - shape.x;
      const ly = pos.y - shape.y;

      // Resize handle (bottom-right corner)
      if (lx >= shape.width - 10 && lx <= shape.width + 10 && ly >= shape.height - 10 && ly <= shape.height + 10) {
        setSelectedId(shape.id);
        setDragState({
          type: 'resize', shapeId: shape.id,
          startX: pos.x, startY: pos.y,
          origX: shape.x, origY: shape.y,
          origW: shape.width, origH: shape.height,
        });
        return;
      }

      // Quad corner warp
      if (shape.type === 'quad' && shape.id === selectedId) {
        for (let i = 0; i < 4; i++) {
          const cpx = shape.x + shape.corners[i].x * shape.width;
          const cpy = shape.y + shape.corners[i].y * shape.height;
          if (Math.abs(pos.x - cpx) < 12 && Math.abs(pos.y - cpy) < 12) {
            setDragState({
              type: 'corner', shapeId: shape.id,
              startX: pos.x, startY: pos.y,
              origX: shape.x, origY: shape.y,
              cornerIdx: i,
              origCorner: { ...shape.corners[i] },
            });
            return;
          }
        }
      }

      // Move
      if (lx >= 0 && lx <= shape.width && ly >= 0 && ly <= shape.height) {
        setSelectedId(shape.id);
        setDragState({
          type: 'move', shapeId: shape.id,
          startX: pos.x, startY: pos.y,
          origX: shape.x, origY: shape.y,
        });
        return;
      }
    }

    setSelectedId(null);
  }, [shapes, selectedId, getCanvasPos]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState) return;
    const pos = getCanvasPos(e);
    const dx = pos.x - dragState.startX;
    const dy = pos.y - dragState.startY;

    setShapes(prev => prev.map(s => {
      if (s.id !== dragState.shapeId) return s;
      if (dragState.type === 'move') {
        return { ...s, x: dragState.origX + dx, y: dragState.origY + dy };
      }
      if (dragState.type === 'resize') {
        return {
          ...s,
          width: Math.max(30, (dragState.origW || 100) + dx),
          height: Math.max(30, (dragState.origH || 100) + dy),
        };
      }
      if (dragState.type === 'corner' && dragState.cornerIdx !== undefined && dragState.origCorner) {
        const newCorners = [...s.corners] as [ControlPoint, ControlPoint, ControlPoint, ControlPoint];
        newCorners[dragState.cornerIdx] = {
          x: Math.max(-0.5, Math.min(1.5, dragState.origCorner.x + dx / s.width)),
          y: Math.max(-0.5, Math.min(1.5, dragState.origCorner.y + dy / s.height)),
        };
        return { ...s, corners: newCorners };
      }
      return s;
    }));
  }, [dragState, getCanvasPos]);

  const onMouseUp = useCallback(() => setDragState(null), []);

  // ── Actions ──
  const addShape = (type: ShapeType) => {
    const canvas = canvasRef.current;
    const cx = canvas ? canvas.width / 2 - 75 : 200;
    const cy = canvas ? canvas.height / 2 - 75 : 200;
    const newShape = createShape(type, cx, cy);
    setShapes(prev => [...prev, newShape]);
    setSelectedId(newShape.id);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setShapes(prev => prev.filter(s => s.id !== selectedId));
    setSelectedId(null);
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const dup = { ...selected, id: `proj-${Date.now()}-dup`, x: selected.x + 20, y: selected.y + 20, label: `${selected.label}-copy` };
    setShapes(prev => [...prev, dup]);
    setSelectedId(dup.id);
  };

  const updateSelected = (patch: Partial<ProjectionShape>) => {
    if (!selectedId) return;
    setShapes(prev => prev.map(s => s.id === selectedId ? { ...s, ...patch } : s));
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedId || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    const url = URL.createObjectURL(file);
    updateSelected({ videoSrc: url });

    // Create video element
    const vid = document.createElement('video');
    vid.src = url;
    vid.loop = true;
    vid.muted = true;
    vid.playsInline = true;
    vid.play();
    videoRefs.current[selectedId] = vid;
  };

  // ── Manage video playback rate BPM sync ──
  useEffect(() => {
    shapes.forEach(s => {
      const vid = videoRefs.current[s.id];
      if (!vid) return;
      if (s.videoBpmSync && bpm > 0) {
        // Scale playback rate relative to BPM (120bpm = 1x)
        vid.playbackRate = Math.max(0.25, Math.min(4, bpm / 120));
      } else {
        vid.playbackRate = s.videoPlaybackRate;
      }
    });
  }, [shapes, bpm]);

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Toolbar */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wider text-primary mr-2">📐 Projection</span>
        {SHAPE_PRESETS.map(sp => (
          <Button key={sp.type} variant="ghost" size="sm" className="h-7 text-[9px] gap-1" onClick={() => addShape(sp.type)}>
            <sp.icon size={12} /> {sp.label}
          </Button>
        ))}
        <div className="flex-1" />
        {selected && (
          <>
            <Button variant="ghost" size="sm" className="h-7 text-[9px] gap-1" onClick={duplicateSelected}>
              <Copy size={11} /> Kopiera
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-[9px] gap-1 text-destructive" onClick={deleteSelected}>
              <Trash2 size={11} /> Ta bort
            </Button>
          </>
        )}
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowProps(!showProps)}>
          <Settings2 size={14} />
        </Button>
      </div>

      <div className="flex flex-1 gap-2 min-h-0">
        {/* Canvas */}
        <div ref={containerRef} className="flex-1 rounded-lg overflow-hidden border border-border/30 relative bg-black">
          <canvas
            ref={canvasRef}
            className="w-full h-full cursor-crosshair"
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          />
          {/* BPM indicator */}
          {bpm > 0 && (
            <div className={`absolute top-2 right-2 px-2 py-0.5 rounded text-[9px] font-mono transition-colors ${
              beatFlash ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground'
            }`}>
              {bpm.toFixed(1)} BPM
            </div>
          )}
        </div>

        {/* Properties Panel */}
        {showProps && (
          <div className="w-56 flex-shrink-0 overflow-y-auto space-y-2 pr-1 text-[10px]">
            {/* Layer list */}
            <div className="bg-card/40 rounded-lg p-2 border border-border/20">
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Lager</div>
              {shapes.length === 0 && <div className="text-muted-foreground text-center py-2">Lägg till former ↑</div>}
              {[...shapes].sort((a, b) => b.zIndex - a.zIndex).map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={`w-full flex items-center gap-1 px-2 py-1 rounded text-left transition-colors ${
                    s.id === selectedId ? 'bg-primary/20 text-primary' : 'hover:bg-muted/30 text-foreground'
                  }`}
                >
                  {s.visible ? <Eye size={10} /> : <EyeOff size={10} />}
                  <span className="truncate flex-1">{s.label}</span>
                  {s.locked && <Lock size={9} />}
                  <span className="text-muted-foreground">{s.type}</span>
                </button>
              ))}
            </div>

            {/* Selected shape properties */}
            {selected && (
              <>
                {/* Transform */}
                <div className="bg-card/40 rounded-lg p-2 border border-border/20 space-y-1.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Transform</div>
                  <div className="flex gap-1">
                    <Input
                      className="h-6 text-[9px] bg-background/50"
                      value={selected.label}
                      onChange={e => updateSelected({ label: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <label className="text-muted-foreground">W</label>
                    <Input type="number" className="h-5 text-[9px] bg-background/50" value={selected.width}
                      onChange={e => updateSelected({ width: +e.target.value })} />
                    <label className="text-muted-foreground">H</label>
                    <Input type="number" className="h-5 text-[9px] bg-background/50" value={selected.height}
                      onChange={e => updateSelected({ height: +e.target.value })} />
                    <label className="text-muted-foreground">Rot°</label>
                    <Input type="number" className="h-5 text-[9px] bg-background/50" value={selected.rotation}
                      onChange={e => updateSelected({ rotation: +e.target.value })} />
                  </div>
                  <div className="flex gap-1">
                    <Button variant={selected.visible ? 'ghost' : 'destructive'} size="sm" className="h-6 text-[9px] flex-1"
                      onClick={() => updateSelected({ visible: !selected.visible })}>
                      {selected.visible ? <Eye size={10} /> : <EyeOff size={10} />}
                    </Button>
                    <Button variant={selected.locked ? 'secondary' : 'ghost'} size="sm" className="h-6 text-[9px] flex-1"
                      onClick={() => updateSelected({ locked: !selected.locked })}>
                      {selected.locked ? <Lock size={10} /> : <Unlock size={10} />}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 text-[9px] flex-1"
                      onClick={() => updateSelected({ corners: JSON.parse(JSON.stringify(DEFAULT_CORNERS)) })}>
                      <RotateCcw size={10} />
                    </Button>
                  </div>
                </div>

                {/* Appearance */}
                <div className="bg-card/40 rounded-lg p-2 border border-border/20 space-y-1.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Utseende</div>
                  <div className="flex items-center gap-1">
                    <label className="text-muted-foreground w-10">Fyll</label>
                    <input type="color" className="w-6 h-5 rounded cursor-pointer border-0"
                      value={selected.fillColor} onChange={e => updateSelected({ fillColor: e.target.value })} />
                    <input type="color" className="w-6 h-5 rounded cursor-pointer border-0"
                      value={selected.strokeColor} onChange={e => updateSelected({ strokeColor: e.target.value })} />
                    <label className="text-muted-foreground ml-1">Kant</label>
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-muted-foreground w-10">Opac</label>
                    <Slider min={0} max={100} step={1} value={[selected.opacity]}
                      onValueChange={([v]) => updateSelected({ opacity: v })} className="flex-1" />
                    <span className="w-7 text-right">{selected.opacity}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-muted-foreground w-10">Blend</label>
                    <select className="flex-1 bg-background/50 text-[9px] rounded px-1 h-5 border border-border/30"
                      value={selected.blendMode} onChange={e => updateSelected({ blendMode: e.target.value })}>
                      {BLEND_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-muted-foreground w-10">Stroke</label>
                    <Slider min={0} max={10} step={1} value={[selected.strokeWidth]}
                      onValueChange={([v]) => updateSelected({ strokeWidth: v })} className="flex-1" />
                    <span className="w-5 text-right">{selected.strokeWidth}</span>
                  </div>
                </div>

                {/* BPM Sync */}
                <div className="bg-card/40 rounded-lg p-2 border border-border/20 space-y-1.5">
                  <div className="flex items-center gap-1">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground flex-1">BPM Sync</div>
                    <button
                      className={`w-8 h-4 rounded-full transition-colors ${selected.bpmSync ? 'bg-primary' : 'bg-muted'}`}
                      onClick={() => updateSelected({ bpmSync: !selected.bpmSync })}
                    >
                      <div className={`w-3 h-3 rounded-full bg-white transition-transform ${selected.bpmSync ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                  {selected.bpmSync && (
                    <>
                      <select className="w-full bg-background/50 text-[9px] rounded px-1 h-5 border border-border/30"
                        value={selected.bpmEffect} onChange={e => updateSelected({ bpmEffect: e.target.value as ProjectionShape['bpmEffect'] })}>
                        <option value="none">Ingen</option>
                        <option value="color-pulse">Färgpuls</option>
                        <option value="opacity-pulse">Opacitetspuls</option>
                        <option value="scale-pulse">Storlekspuls</option>
                        <option value="strobe">Strobe</option>
                        <option value="rotate">Rotation</option>
                      </select>
                      {selected.bpmEffect === 'color-pulse' && (
                        <div className="flex items-center gap-1">
                          <input type="color" className="w-5 h-5 rounded cursor-pointer border-0"
                            value={selected.bpmColor1} onChange={e => updateSelected({ bpmColor1: e.target.value })} />
                          <span className="text-muted-foreground">→</span>
                          <input type="color" className="w-5 h-5 rounded cursor-pointer border-0"
                            value={selected.bpmColor2} onChange={e => updateSelected({ bpmColor2: e.target.value })} />
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <label className="text-muted-foreground w-12">Intensitet</label>
                        <Slider min={0} max={100} step={1} value={[selected.bpmIntensity]}
                          onValueChange={([v]) => updateSelected({ bpmIntensity: v })} className="flex-1" />
                      </div>
                    </>
                  )}
                </div>

                {/* Video */}
                <div className="bg-card/40 rounded-lg p-2 border border-border/20 space-y-1.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Video</div>
                  <Button variant="ghost" size="sm" className="h-6 text-[9px] w-full gap-1" onClick={() => fileInputRef.current?.click()}>
                    <Film size={10} /> {selected.videoSrc ? 'Byt video' : 'Ladda video'}
                  </Button>
                  <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoUpload} />
                  {selected.videoSrc && (
                    <>
                      <div className="flex items-center gap-1">
                        <label className="text-muted-foreground w-10">Opac</label>
                        <Slider min={0} max={100} step={1} value={[selected.videoOpacity]}
                          onValueChange={([v]) => updateSelected({ videoOpacity: v })} className="flex-1" />
                      </div>
                      <div className="flex items-center gap-1">
                        <label className="text-muted-foreground w-10">Filter</label>
                        <select className="flex-1 bg-background/50 text-[9px] rounded px-1 h-5 border border-border/30"
                          value={selected.videoFilter} onChange={e => updateSelected({ videoFilter: e.target.value as ProjectionShape['videoFilter'] })}>
                          <option value="none">Ingen</option>
                          <option value="invert">Invertera</option>
                          <option value="hue-rotate">Hue Rotate</option>
                          <option value="saturate">Saturate</option>
                          <option value="contrast">Kontrast</option>
                          <option value="grayscale">Gråskala</option>
                          <option value="sepia">Sepia</option>
                        </select>
                      </div>
                      {selected.videoFilter !== 'none' && (
                        <div className="flex items-center gap-1">
                          <label className="text-muted-foreground w-10">Styrka</label>
                          <Slider min={0} max={100} step={1} value={[selected.videoFilterIntensity]}
                            onValueChange={([v]) => updateSelected({ videoFilterIntensity: v })} className="flex-1" />
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <label className="text-muted-foreground flex-1">BPM-synk hastighet</label>
                        <button
                          className={`w-8 h-4 rounded-full transition-colors ${selected.videoBpmSync ? 'bg-primary' : 'bg-muted'}`}
                          onClick={() => updateSelected({ videoBpmSync: !selected.videoBpmSync })}
                        >
                          <div className={`w-3 h-3 rounded-full bg-white transition-transform ${selected.videoBpmSync ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                      {!selected.videoBpmSync && (
                        <div className="flex items-center gap-1">
                          <label className="text-muted-foreground w-10">Fart</label>
                          <Slider min={25} max={400} step={25} value={[selected.videoPlaybackRate * 100]}
                            onValueChange={([v]) => updateSelected({ videoPlaybackRate: v / 100 })} className="flex-1" />
                          <span className="w-8 text-right">{selected.videoPlaybackRate}x</span>
                        </div>
                      )}
                      <Button variant="ghost" size="sm" className="h-5 text-[8px] w-full text-destructive"
                        onClick={() => {
                          const vid = videoRefs.current[selectedId!];
                          if (vid) { vid.pause(); vid.src = ''; delete videoRefs.current[selectedId!]; }
                          updateSelected({ videoSrc: null });
                        }}>
                        Ta bort video
                      </Button>
                    </>
                  )}
                </div>
              </>
            )}

            {!selected && (
              <div className="text-center text-muted-foreground py-8">
                <Layers size={24} className="mx-auto mb-2 opacity-30" />
                <div className="text-[10px]">Välj en form för att redigera</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
