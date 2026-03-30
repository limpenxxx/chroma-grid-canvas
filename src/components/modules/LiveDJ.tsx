import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, Play, Square, GripVertical, Palette, SlidersHorizontal,
  Zap, ChevronDown, ChevronRight, Monitor, Hand, Layers,
  Speaker, X, Save, Mic, Activity, Sparkles, Wifi,
  ImagePlus, Lock, Unlock, Move, FolderOpen, Download, Upload, FileText, Users,
  Bookmark, Settings2, CircleDot, Maximize2, Minimize2, Film
} from 'lucide-react';
import { AudioVisualizerEngine, PRESET_LABELS, type VisualizerPreset } from '@/lib/audioVisualizer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  useFixtureStore, type FixtureInstance, type FixtureDefinition,
  getFixtureTypeIcon,
} from '@/store/fixtureStore';
import stokioLogo from '@/assets/stokio-logo-color.png';
import { useMediaStore } from '@/store/mediaStore';

// ── Types ──

type ControlMode = 'video' | 'buttons' | 'both';

interface FixtureAssignment {
  instanceId: string;
  mode: ControlMode;
}

type WidgetType = 'button' | 'slider' | 'color-wheel' | 'xy-pad' | 'preset' | 'fixed-color' | 'media-trigger' | 'vfx' | 'wled-preset';

// ── Preset Scene Entry ──
interface PresetSceneEntry {
  targetId: string; // fixture instance ID or group ID
  targetType: 'fixture' | 'group' | 'wled';
  dimmer: number; // 0-255
  color?: { r: number; g: number; b: number };
  strobe?: number; // 0-255
  pan?: number;
  tilt?: number;
  // WLED-specific
  wledPresetId?: number; // trigger a saved preset from the WLED device
  wledPresetName?: string;
}

// ── MH Movement Programs ──
type MHPattern = 'circle' | 'figure8' | 'zigzag' | 'sweep-h' | 'sweep-v' | 'random' | 'square' | 'triangle' | 'bounce';

const MH_PATTERNS: { value: MHPattern; label: string }[] = [
  { value: 'circle', label: '⭕ Circle' },
  { value: 'figure8', label: '♾ Figure 8' },
  { value: 'zigzag', label: '⚡ Zigzag' },
  { value: 'sweep-h', label: '↔ Sweep H' },
  { value: 'sweep-v', label: '↕ Sweep V' },
  { value: 'random', label: '🎲 Random' },
  { value: 'square', label: '◻ Square' },
  { value: 'triangle', label: '△ Triangle' },
  { value: 'bounce', label: '⬆ Bounce' },
];

interface MHFixtureConfig {
  fixtureId: string;
  reversePan: boolean;
  reverseTilt: boolean;
  mirrorPan: boolean;
  mirrorTilt: boolean;
  delayMs: number; // delay offset per fixture
}

interface MHProgram {
  pattern: MHPattern;
  speed: number; // 1-100
  size: number; // 1-100 (movement range)
  bpmSync: boolean;
  running: boolean;
  fixtureConfigs: MHFixtureConfig[];
}

// ── Audio / BPM Types ──
type AudioSource = 'none' | 'wled-analog' | 'wled-i2s-inmp441' | 'wled-i2s-max98357' | 'wled-i2s-sph0645' | 'wled-udp-sync' | 'browser-mic';

interface AudioConfig {
  source: AudioSource;
  squelch: number;
  gain: number;
  udpPort: number;
}

interface BPMState {
  bpm: number;
  tapTimes: number[];
  isSynced: boolean;
  linkedWidgetIds: string[];
  flashOn: boolean;
}

const AUDIO_SOURCES: { value: AudioSource; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'No audio input' },
  { value: 'wled-analog', label: 'WLED Analog Mic', description: 'MAX4466 / MAX9814 analog microphone on WLED ESP32' },
  { value: 'wled-i2s-inmp441', label: 'WLED I2S INMP441', description: 'Digital I2S MEMS microphone (recommended)' },
  { value: 'wled-i2s-max98357', label: 'WLED I2S MAX98357', description: 'I2S line-in via MAX98357 amplifier' },
  { value: 'wled-i2s-sph0645', label: 'WLED I2S SPH0645', description: 'SPH0645 I2S digital microphone' },
  { value: 'wled-udp-sync', label: 'WLED UDP Sound Sync', description: 'Receive audio data from another WLED instance via UDP' },
  { value: 'browser-mic', label: 'Browser Microphone', description: "Use this device's microphone via Web Audio API" },
];

interface DJWidget {
  id: string;
  type: WidgetType;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  bgImage?: string | null;
  bgOpacity?: number; // 0-100, default 70
  flash?: boolean;
  toggled?: boolean; // for toggle mode state
  value?: number;
  min?: number;
  max?: number;
  colorValue?: { r: number; g: number; b: number };
  linkedFixtureIds: string[];
  linkedFunction?: string;
  lockAxis?: 'none' | 'x' | 'y';
  // MH program (xy-pad only)
  mhProgram?: MHProgram;
  // Preset scene entries (preset only)
  presetEntries?: PresetSceneEntry[];
  presetShowSubmenu?: boolean;
  // Color sync: link this widget to another widget's color output
  syncColorWidgetId?: string | null;
  // Fixed color: selected slot DMX value
  fixedColorSlotValue?: number;
  // RGB sync mode for fixed-color widget
  rgbSyncEnabled?: boolean;
  // Media trigger
  mediaItemId?: string | null;
  mediaPlaylistId?: string | null;
  mediaPlayMode?: 'play-once' | 'loop' | 'loop-random'; // default: loop
  mediaFlash?: boolean; // true = flash (hold to play), false = toggle
  // VFX
  vfxPreset?: VisualizerPreset;
  vfxRunning?: boolean;
  // WLED Preset
  wledPresetId?: number;
  wledPresetName?: string;
  wledIp?: string;
  wledPresets?: { id: number; name: string }[];
}

interface ScriptStep {
  id: string;
  type: 'set-color' | 'set-dimmer' | 'set-position' | 'wait' | 'fade';
  params: Record<string, number | string>;
  duration: number;
}

interface DJScript {
  id: string;
  name: string;
  steps: ScriptStep[];
  loop: boolean;
  linkedFixtureIds: string[];
}

// ── Fixture Group ──
interface FixtureGroup {
  id: string;
  name: string;
  color: string;
  fixtureIds: string[]; // instance IDs
}

// ── Layout Page ──
interface LayoutPage {
  id: string;
  name: string;
  widgets: DJWidget[];
  bgImage?: string | null;
  bgOpacity?: number; // 0-100
  bgFit?: 'fill' | 'fit'; // fill = cover, fit = contain
}

// ── Saved Layout ──
interface SavedLayout {
  id: string;
  name: string;
  createdAt: string;
  pages: LayoutPage[];
  groups: FixtureGroup[];
  assignments: FixtureAssignment[];
  scripts: DJScript[];
  audioConfig: AudioConfig;
}

type Tab = 'controller' | 'assignments' | 'scripts' | 'groups';

const WIDGET_PRESETS: { type: WidgetType; label: string; icon: typeof Zap; w: number; h: number }[] = [
  { type: 'button', label: 'Flash Button', icon: Zap, w: 100, h: 100 },
  { type: 'slider', label: 'Fader', icon: SlidersHorizontal, w: 70, h: 200 },
  { type: 'color-wheel', label: 'Color Pick', icon: Palette, w: 140, h: 140 },
  { type: 'xy-pad', label: 'XY Pad', icon: Plus, w: 180, h: 180 },
  { type: 'preset', label: 'Pre Set', icon: Bookmark, w: 120, h: 120 },
  { type: 'fixed-color', label: 'Fixed Color', icon: CircleDot, w: 150, h: 150 },
  { type: 'media-trigger', label: 'Media', icon: Film, w: 120, h: 120 },
  { type: 'vfx', label: 'Audio VFX', icon: Sparkles, w: 200, h: 200 },
  { type: 'wled-preset', label: 'WLED Preset', icon: Wifi, w: 120, h: 120 },
];

// ── Color distance helper (Euclidean in RGB space) ──
function rgbDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function findClosestSlot(rgb: { r: number; g: number; b: number }, slots: { color: string; dmxValue: number; name: string }[]) {
  let best = slots[0];
  let bestDist = Infinity;
  for (const slot of slots) {
    const d = rgbDistance(rgb, hexToRgb(slot.color));
    if (d < bestDist) { bestDist = d; best = slot; }
  }
  return best;
}

const STEP_TYPES: { value: ScriptStep['type']; label: string }[] = [
  { value: 'set-color', label: 'Set Color' },
  { value: 'set-dimmer', label: 'Set Dimmer' },
  { value: 'set-position', label: 'Set Pan/Tilt' },
  { value: 'wait', label: 'Wait' },
  { value: 'fade', label: 'Fade' },
];

// ── Sub-components ──

function ModeIcon({ mode }: { mode: ControlMode }) {
  if (mode === 'video') return <Monitor size={12} className="text-stokio-cyan" />;
  if (mode === 'buttons') return <Hand size={12} className="text-stokio-pink" />;
  return <Layers size={12} className="text-stokio-green" />;
}

function ModeBadge({ mode }: { mode: ControlMode }) {
  const labels: Record<ControlMode, string> = { video: 'VIDEO', buttons: 'BUTTONS', both: 'BOTH' };
  const colors: Record<ControlMode, string> = {
    video: 'bg-stokio-cyan/10 text-stokio-cyan border-stokio-cyan/20',
    buttons: 'bg-stokio-pink/10 text-stokio-pink border-stokio-pink/20',
    both: 'bg-primary/10 text-primary border-primary/20',
  };
  return (
    <span className={`text-[7px] px-1.5 py-0.5 rounded border font-semibold ${colors[mode]}`}>
      {labels[mode]}
    </span>
  );
}

// ── Draggable + Resizable Widget ──

type DragMode = 'none' | 'move' | 'resize-br' | 'resize-bl' | 'resize-tr' | 'resize-tl';

function ControlWidget({
  widget, isSelected, onSelect, onUpdate, onPress, onRelease, allWidgets, fixtureData,
}: {
  widget: DJWidget;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<DJWidget>) => void;
  onPress: () => void;
  onRelease: () => void;
  allWidgets: DJWidget[];
  fixtureData: { inst: FixtureInstance; def: FixtureDefinition }[];
}) {
  const dragRef = useRef<{
    mode: DragMode;
    startX: number; startY: number;
    origX: number; origY: number;
    origW: number; origH: number;
  } | null>(null);
  const [isPressed, setIsPressed] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const MIN_SIZE = 40;
  const LONG_PRESS_MS = 500;

  // Strobe sync: check if any active strobe widget shares linked fixtures with this widget
  const isStrobeSynced = widget.type !== 'button' || widget.linkedFunction !== 'strobe' ? (() => {
    const myFixtures = new Set(widget.linkedFixtureIds);
    if (myFixtures.size === 0) return false;
    return allWidgets.some(w =>
      w.id !== widget.id &&
      w.linkedFunction === 'strobe' &&
      (w.toggled || false) &&
      w.linkedFixtureIds.some(fid => myFixtures.has(fid))
    );
  })() : false;

  // MH pattern animation — animate the joystick dot when a pattern is running
  const [patternPos, setPatternPos] = useState<{ x: number; y: number } | null>(null);
  const patternAnimRef = useRef<number | null>(null);

  useEffect(() => {
    if (widget.type !== 'xy-pad' || !widget.mhProgram?.running) {
      setPatternPos(null);
      if (patternAnimRef.current) cancelAnimationFrame(patternAnimRef.current);
      return;
    }

    const prog = widget.mhProgram;
    const sizeScale = (prog.size || 50) / 100;
    const speedMs = Math.max(200, 6000 - (prog.speed || 50) * 50); // period in ms
    const startTime = performance.now();

    const computePos = (t: number): { x: number; y: number } => {
      const phase = ((t - startTime) / speedMs) * Math.PI * 2;
      const cx = 128, cy = 128;
      const range = 110 * sizeScale;
      switch (prog.pattern) {
        case 'circle': return { x: cx + Math.cos(phase) * range, y: cy + Math.sin(phase) * range };
        case 'figure8': return { x: cx + Math.sin(phase) * range, y: cy + Math.sin(phase * 2) * range * 0.6 };
        case 'zigzag': {
          const p = ((phase / (Math.PI * 2)) % 1);
          const seg = p * 4;
          const xPos = seg < 1 ? seg : seg < 2 ? 1 : seg < 3 ? 3 - seg : 0;
          const yPos = seg < 1 ? 0 : seg < 2 ? seg - 1 : seg < 3 ? 1 : 4 - seg;
          return { x: cx + (xPos - 0.5) * range * 2, y: cy + (yPos - 0.5) * range * 2 };
        }
        case 'sweep-h': return { x: cx + Math.sin(phase) * range, y: cy };
        case 'sweep-v': return { x: cx, y: cy + Math.sin(phase) * range };
        case 'random': return { x: cx + (Math.sin(phase * 3.7) * 0.6 + Math.sin(phase * 1.3) * 0.4) * range, y: cy + (Math.cos(phase * 2.9) * 0.6 + Math.cos(phase * 1.7) * 0.4) * range };
        case 'square': {
          const p = ((phase / (Math.PI * 2)) % 1);
          const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
          const c2 = corners[Math.floor(p * 4) % 4];
          return { x: cx + c2[0] * range * 0.7, y: cy + c2[1] * range * 0.7 };
        }
        case 'triangle': {
          const p = ((phase / (Math.PI * 2)) % 1);
          const pts = [[0, -1], [0.87, 0.5], [-0.87, 0.5]];
          const pt = pts[Math.floor(p * 3) % 3];
          return { x: cx + pt[0] * range, y: cy + pt[1] * range };
        }
        case 'bounce': return { x: cx, y: cy + Math.abs(Math.sin(phase)) * range - range * 0.5 };
        default: return { x: cx, y: cy };
      }
    };

    const animate = (t: number) => {
      const pos = computePos(t);
      setPatternPos({ x: Math.max(0, Math.min(255, pos.x)), y: Math.max(0, Math.min(255, pos.y)) });
      patternAnimRef.current = requestAnimationFrame(animate);
    };
    patternAnimRef.current = requestAnimationFrame(animate);
    return () => { if (patternAnimRef.current) cancelAnimationFrame(patternAnimRef.current); };
  }, [widget.type, widget.mhProgram?.running, widget.mhProgram?.pattern, widget.mhProgram?.speed, widget.mhProgram?.size]);

  const startInteraction = useCallback((e: React.MouseEvent, mode: DragMode) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    dragRef.current = {
      mode, startX: e.clientX, startY: e.clientY,
      origX: widget.x, origY: widget.y, origW: widget.width, origH: widget.height,
    };
    setInteracting(true);

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const ref = dragRef.current;
      const dx = ev.clientX - ref.startX;
      const dy = ev.clientY - ref.startY;
      const lock = widget.lockAxis || 'none';
      if (ref.mode === 'move') {
        onUpdate({ x: Math.max(0, ref.origX + (lock === 'y' ? 0 : dx)), y: Math.max(0, ref.origY + (lock === 'x' ? 0 : dy)) });
      } else if (ref.mode === 'resize-br') {
        onUpdate({ width: Math.max(MIN_SIZE, ref.origW + dx), height: Math.max(MIN_SIZE, ref.origH + dy) });
      } else if (ref.mode === 'resize-bl') {
        const nw = Math.max(MIN_SIZE, ref.origW - dx);
        onUpdate({ x: ref.origX + ref.origW - nw, width: nw, height: Math.max(MIN_SIZE, ref.origH + dy) });
      } else if (ref.mode === 'resize-tr') {
        const nh = Math.max(MIN_SIZE, ref.origH - dy);
        onUpdate({ y: ref.origY + ref.origH - nh, width: Math.max(MIN_SIZE, ref.origW + dx), height: nh });
      } else if (ref.mode === 'resize-tl') {
        const nw = Math.max(MIN_SIZE, ref.origW - dx);
        const nh = Math.max(MIN_SIZE, ref.origH - dy);
        onUpdate({ x: ref.origX + ref.origW - nw, y: ref.origY + ref.origH - nh, width: nw, height: nh });
      }
    };
    const handleUp = () => {
      dragRef.current = null;
      setInteracting(false);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [widget, onUpdate, onSelect]);

  const ResizeHandle = ({ corner, cursor }: { corner: DragMode; cursor: string }) => {
    const pos: Record<string, string> = { 'resize-br': 'bottom-0 right-0', 'resize-bl': 'bottom-0 left-0', 'resize-tr': 'top-0 right-0', 'resize-tl': 'top-0 left-0' };
    return (
      <div className={`absolute ${pos[corner]} w-3 h-3 ${cursor} z-30 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'} transition-opacity`}
        onMouseDown={e => startInteraction(e, corner)}>
        <div className="absolute inset-0.5 rounded-sm border border-primary/60 bg-primary/20" />
      </div>
    );
  };

  const bgStyle: React.CSSProperties = widget.bgImage ? { backgroundImage: `url(${widget.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {};

  // Button: flash = play while held, toggle = click to toggle on/off
  const handleButtonDown = () => {
    onSelect();
    if (widget.flash) {
      setIsPressed(true); onPress();
    } else {
      const ns = !widget.toggled;
      onUpdate({ toggled: ns }); setIsPressed(ns);
      if (ns) onPress(); else onRelease();
    }
  };
  const handleButtonUp = () => {
    if (widget.flash) { setIsPressed(false); onRelease(); }
  };
  const isButtonActive = widget.flash ? isPressed : !!widget.toggled;

  return (
    <div className={`absolute select-none group transition-shadow ${isSelected ? 'ring-1 ring-primary/60 z-30' : 'z-10'} ${interacting ? 'z-50' : ''}`}
      style={{ left: widget.x, top: widget.y, width: widget.width, height: widget.height }}>

      {/* Strobe sync flash overlay */}
      {isStrobeSynced && (
        <div className="absolute inset-0 rounded-lg z-[35] pointer-events-none animate-strobe-flash"
          style={{ background: `radial-gradient(circle, ${widget.color || '#fff'}90, transparent)` }} />
      )}

      {/* Top drag handle — larger, more visible */}
      <div className="absolute -top-3 left-0 right-0 h-6 z-40 cursor-grab active:cursor-grabbing flex items-center justify-center"
        onMouseDown={e => startInteraction(e, 'move')}>
        <div className="bg-muted/40 group-hover:bg-muted/70 rounded-t px-3 py-0.5 transition-colors">
          <GripVertical size={12} className="text-muted-foreground/40 group-hover:text-muted-foreground/80 transition-colors" />
        </div>
      </div>

      <ResizeHandle corner="resize-br" cursor="cursor-se-resize" />
      <ResizeHandle corner="resize-bl" cursor="cursor-sw-resize" />
      <ResizeHandle corner="resize-tr" cursor="cursor-ne-resize" />
      <ResizeHandle corner="resize-tl" cursor="cursor-nw-resize" />

      {/* BUTTON */}
      {widget.type === 'button' && (
        <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col items-center justify-center gap-1 transition-all overflow-hidden relative cursor-pointer"
          style={{ ...bgStyle, borderColor: isButtonActive ? widget.color : undefined,
            boxShadow: isButtonActive ? `0 0 24px ${widget.color}50, inset 0 0 20px ${widget.color}25` : undefined }}
          onMouseDown={handleButtonDown} onMouseUp={handleButtonUp}
          onMouseLeave={() => { if (widget.flash && isPressed) handleButtonUp(); }}>
          {/* Gradient overlay — always shown (on bg image too) */}
          <div className="absolute inset-0 rounded-lg opacity-15" style={{ backgroundColor: widget.color }} />
          {widget.bgImage && <div className="absolute inset-0 rounded-lg z-[1]" style={{ background: `linear-gradient(to top, rgba(0,0,0,${(widget.bgOpacity ?? 70) / 100}), rgba(0,0,0,${(widget.bgOpacity ?? 70) / 300}), transparent)` }} />}
          {isButtonActive && <div className="absolute inset-0 rounded-lg z-[2]" style={{ background: `radial-gradient(circle at center, ${widget.color}30, transparent)` }} />}
          <Zap size={Math.min(widget.width, widget.height) * 0.25} style={{ color: widget.color, textShadow: '0 1px 4px rgba(0,0,0,0.8)' }} className="relative z-10 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]" />
          <span className="text-muted-foreground font-semibold truncate px-1 relative z-10"
            style={{ fontSize: Math.max(8, Math.min(14, widget.width * 0.12)), textShadow: '0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)' }}>{widget.label}</span>
          {!widget.flash && <div className={`absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full transition-all z-10 ${widget.toggled ? 'bg-primary shadow-[0_0_6px_hsl(var(--primary))]' : 'bg-muted-foreground/20'}`} />}
          
        </div>
      )}

      {/* SLIDER */}
      {widget.type === 'slider' && (
        <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col items-center justify-center p-3 gap-1 overflow-hidden" style={bgStyle}>
          <span className="text-muted-foreground font-semibold truncate" style={{ fontSize: Math.max(8, Math.min(12, widget.width * 0.14)) }}>{widget.label}</span>
          <div className="flex-1 w-10 rounded fader-track border border-border/20 relative">
            <motion.div className="absolute bottom-0 left-0 w-full rounded-b" style={{ backgroundColor: widget.color + '60' }} animate={{ height: `${widget.value || 0}%` }} />
            <input type="range" min={0} max={100} value={widget.value || 0} onChange={e => { onSelect(); onUpdate({ value: Number(e.target.value) }); }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-ns-resize" style={{ writingMode: 'vertical-lr', direction: 'rtl' } as React.CSSProperties} />
          </div>
          <span className="font-mono text-muted-foreground" style={{ fontSize: Math.max(8, Math.min(12, widget.width * 0.14)) }}>{widget.value || 0}%</span>
        </div>
      )}

      {/* COLOR WHEEL */}
      {widget.type === 'color-wheel' && (
        <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col items-center justify-center p-3 gap-1 overflow-hidden" style={bgStyle}>
          <span className="text-muted-foreground font-semibold truncate" style={{ fontSize: Math.max(8, Math.min(12, widget.width * 0.1)) }}>{widget.label}</span>
          <div className="flex-1 flex items-center justify-center">
            <div className="rounded-full border-2 border-border/30 cursor-pointer"
              style={{ width: Math.min(widget.width, widget.height) - 40, height: Math.min(widget.width, widget.height) - 40,
                background: `conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)` }}
              onClick={(e) => {
                onSelect();
                const rect = e.currentTarget.getBoundingClientRect();
                const cx = e.clientX - rect.left - rect.width / 2, cy = e.clientY - rect.top - rect.height / 2;
                const hue = ((Math.atan2(cy, cx) * 180 / Math.PI) + 360) % 360;
                const c = 1, xx = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = 0;
                let r = 0, g = 0, b = 0;
                if (hue < 60) { r = c; g = xx; } else if (hue < 120) { r = xx; g = c; }
                else if (hue < 180) { g = c; b = xx; } else if (hue < 240) { g = xx; b = c; }
                else if (hue < 300) { r = xx; b = c; } else { r = c; b = xx; }
                onUpdate({ colorValue: { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) } });
              }}>
              {widget.colorValue && (
                <div className="w-full h-full rounded-full flex items-center justify-center">
                  <div className="w-6 h-6 rounded-full border border-foreground/50"
                    style={{ backgroundColor: `rgb(${widget.colorValue.r},${widget.colorValue.g},${widget.colorValue.b})`,
                      boxShadow: `0 0 10px rgb(${widget.colorValue.r},${widget.colorValue.g},${widget.colorValue.b})` }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* XY PAD */}
      {widget.type === 'xy-pad' && (
        <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col items-center p-3 gap-1 overflow-hidden" style={bgStyle}>
          <span className="text-muted-foreground font-semibold truncate" style={{ fontSize: Math.max(8, Math.min(12, widget.width * 0.08)) }}>{widget.label}</span>
          {widget.mhProgram?.running && (
            <div className="absolute top-1 right-1 text-[6px] px-1 py-0.5 rounded bg-primary/20 text-primary border border-primary/30 animate-pulse font-semibold z-20">
              {MH_PATTERNS.find(p => p.value === widget.mhProgram?.pattern)?.label}
            </div>
          )}
          <div className="flex-1 w-full relative border border-border/20 rounded cursor-crosshair"
            onClick={e => {
              onSelect();
              const rect = e.currentTarget.getBoundingClientRect();
              const x = Math.round(((e.clientX - rect.left) / rect.width) * 255);
              const y = Math.round(((e.clientY - rect.top) / rect.height) * 255);
              onUpdate({ colorValue: { r: x, g: y, b: 128 } });
            }}>
            <div className="absolute left-1/2 top-0 w-px h-full bg-border/20" />
            <div className="absolute top-1/2 left-0 w-full h-px bg-border/20" />
            {(() => {
              const syncWidget = widget.syncColorWidgetId ? allWidgets.find(w => w.id === widget.syncColorWidgetId) : null;
              const dotColor = syncWidget?.colorValue
                ? `rgb(${syncWidget.colorValue.r},${syncWidget.colorValue.g},${syncWidget.colorValue.b})`
                : 'hsl(var(--primary))';
              const dotX = patternPos ? patternPos.x : (widget.colorValue?.r ?? 128);
              const dotY = patternPos ? patternPos.y : (widget.colorValue?.g ?? 128);
              return (
                <>
                  <div className="absolute w-4 h-4 rounded-full border border-foreground -translate-x-1/2 -translate-y-1/2 transition-none"
                    style={{ left: `${(dotX / 255) * 100}%`, top: `${(dotY / 255) * 100}%`,
                      backgroundColor: dotColor, boxShadow: `0 0 10px ${dotColor}` }} />
                  {patternPos && (
                    <div className="absolute inset-0 pointer-events-none overflow-hidden rounded">
                      <div className="absolute w-1 h-1 rounded-full bg-primary/30 -translate-x-1/2 -translate-y-1/2"
                        style={{ left: `${(dotX / 255) * 100}%`, top: `${(dotY / 255) * 100}%`,
                          boxShadow: `0 0 20px 6px ${dotColor}` }} />
                    </div>
                  )}
                </>
              );
            })()}
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] text-muted-foreground/40">PAN</span>
            <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[8px] text-muted-foreground/40 -rotate-90">TILT</span>
          </div>
        </div>
      )}

      {/* PRESET */}
      {widget.type === 'preset' && (
        <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col items-center justify-center gap-1 transition-all overflow-hidden relative cursor-pointer"
          style={{ ...bgStyle, borderColor: isButtonActive ? widget.color : undefined,
            boxShadow: isButtonActive ? `0 0 24px ${widget.color}50, inset 0 0 20px ${widget.color}25` : undefined }}
          onMouseDown={handleButtonDown} onMouseUp={handleButtonUp}
          onMouseLeave={() => { if (widget.flash && isPressed) handleButtonUp(); }}>
          <div className="absolute inset-0 rounded-lg opacity-15" style={{ backgroundColor: widget.color }} />
          {widget.bgImage && <div className="absolute inset-0 rounded-lg z-[1]" style={{ background: `linear-gradient(to top, rgba(0,0,0,${(widget.bgOpacity ?? 70) / 100}), rgba(0,0,0,${(widget.bgOpacity ?? 70) / 300}), transparent)` }} />}
          {isButtonActive && <div className="absolute inset-0 rounded-lg z-[2]" style={{ background: `radial-gradient(circle at center, ${widget.color}30, transparent)` }} />}
          <Bookmark size={Math.min(widget.width, widget.height) * 0.15} style={{ color: widget.color }} className="absolute top-1.5 left-1.5 z-10 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]" />
          <span className="text-muted-foreground font-semibold truncate px-1 relative z-10"
            style={{ fontSize: Math.max(8, Math.min(14, widget.width * 0.12)), textShadow: '0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)' }}>{widget.label}</span>
          <div className={`absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full transition-all z-10 ${widget.toggled ? 'bg-primary shadow-[0_0_6px_hsl(var(--primary))]' : 'bg-muted-foreground/20'}`} />
          {(widget.presetEntries?.length || 0) > 0 && (
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[7px] text-muted-foreground/50 z-10"
              style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
              {widget.presetEntries!.length} scene(s)
            </span>
          )}
        </div>
      )}

      {/* FIXED COLOR PICKER */}
      {widget.type === 'fixed-color' && (() => {
        // Gather color wheel slots from linked fixtures, OR from all available fixtures if none linked
        const slots: { color: string; dmxValue: number; name: string }[] = [];
        const sourceFixtures = widget.linkedFixtureIds.length > 0
          ? widget.linkedFixtureIds
          : fixtureData.filter(f => f.def.colorWheelSlots && f.def.colorWheelSlots.length > 0).map(f => f.inst.id);
        
        sourceFixtures.forEach(fid => {
          const fd = fixtureData.find(f => f.inst.id === fid);
          if (fd?.def.colorWheelSlots) {
            fd.def.colorWheelSlots.forEach(s => {
              if (!slots.find(x => x.dmxValue === s.dmxValue && x.color === s.color)) {
                slots.push({ color: s.color, dmxValue: s.dmxValue, name: s.name });
              }
            });
          }
        });

        // If RGB sync enabled, find synced color widget and auto-select closest slot
        const syncWidget = widget.rgbSyncEnabled && widget.syncColorWidgetId
          ? allWidgets.find(w => w.id === widget.syncColorWidgetId)
          : null;
        const syncedSlot = syncWidget?.colorValue && slots.length > 0
          ? findClosestSlot(syncWidget.colorValue, slots)
          : null;
        const activeSlotValue = syncedSlot ? syncedSlot.dmxValue : widget.fixedColorSlotValue;

        const wheelSize = Math.min(widget.width, widget.height) - 50;
        const slotAngle = slots.length > 0 ? 360 / slots.length : 0;

        return (
          <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col items-center p-2 gap-1 overflow-hidden" style={bgStyle}>
            <span className="text-muted-foreground font-semibold truncate uppercase tracking-wider" style={{ fontSize: Math.max(8, Math.min(11, widget.width * 0.08)) }}>{widget.label}</span>
            {widget.rgbSyncEnabled && (
              <div className="text-[6px] px-1.5 py-0.5 rounded bg-stokio-cyan/10 text-stokio-cyan border border-stokio-cyan/20 font-semibold">
                RGB SYNC
              </div>
            )}

            {/* Color Wheel Visual — matches fixture controller */}
            {slots.length > 0 && (
              <div className="relative flex-shrink-0 rounded-full control-glossy border border-border/20 overflow-hidden"
                style={{ width: wheelSize, height: wheelSize }}>
                {slots.map((slot, i) => {
                  const startAngle = i * slotAngle - 90;
                  const isActive = activeSlotValue === slot.dmxValue;
                  return (
                    <button key={`wheel-${slot.dmxValue}-${slot.color}`}
                      className="absolute inset-0 w-full h-full"
                      onClick={() => onUpdate({ fixedColorSlotValue: slot.dmxValue })}
                      style={{
                        clipPath: `polygon(50% 50%, ${50 + 50 * Math.cos((startAngle) * Math.PI / 180)}% ${50 + 50 * Math.sin((startAngle) * Math.PI / 180)}%, ${50 + 50 * Math.cos((startAngle + slotAngle) * Math.PI / 180)}% ${50 + 50 * Math.sin((startAngle + slotAngle) * Math.PI / 180)}%)`,
                      }}>
                      <div className="w-full h-full transition-all" style={{
                        backgroundColor: slot.color,
                        opacity: isActive ? 1 : 0.6,
                        boxShadow: isActive ? 'inset 0 0 20px rgba(255,255,255,0.4)' : 'none',
                      }} />
                    </button>
                  );
                })}
                {/* Center dot */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0a0a0a] border border-border/30 flex items-center justify-center"
                  style={{ width: wheelSize * 0.22, height: wheelSize * 0.22 }}>
                  {activeSlotValue !== undefined && (() => {
                    const activeSlot = slots.find(s => s.dmxValue === activeSlotValue);
                    return activeSlot ? (
                      <div className="rounded-full" style={{
                        width: wheelSize * 0.14, height: wheelSize * 0.14,
                        backgroundColor: activeSlot.color,
                        boxShadow: `0 0 12px ${activeSlot.color}`,
                      }} />
                    ) : null;
                  })()}
                </div>
              </div>
            )}

            {/* Color grid — 4 columns like fixture controller */}
            {slots.length > 0 && (
              <div className="grid gap-1 overflow-y-auto px-1" style={{ gridTemplateColumns: `repeat(${Math.min(4, slots.length)}, 1fr)`, maxHeight: widget.height * 0.38 }}>
                {slots.map(slot => {
                  const isActive = activeSlotValue === slot.dmxValue;
                  const btnSize = Math.max(16, Math.min(28, (widget.width - 24) / Math.min(4, slots.length) - 8));
                  return (
                    <button key={`btn-${slot.dmxValue}-${slot.color}`}
                      onClick={() => onUpdate({ fixedColorSlotValue: slot.dmxValue })}
                      className={`flex flex-col items-center gap-0.5 p-0.5 rounded transition-all ${isActive ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-muted/30'}`}>
                      <div className="rounded-full border-2 transition-all" style={{
                        width: btnSize, height: btnSize,
                        backgroundColor: slot.color,
                        borderColor: isActive ? 'hsl(var(--primary))' : 'transparent',
                        boxShadow: isActive ? `0 0 10px ${slot.color}` : 'none',
                      }} />
                      <span className="text-muted-foreground truncate w-full text-center" style={{ fontSize: Math.max(6, Math.min(8, widget.width * 0.055)) }}>
                        {slot.name}
                      </span>
                      <span className="text-muted-foreground/50 font-mono" style={{ fontSize: Math.max(5, Math.min(7, widget.width * 0.04)) }}>
                        DMX:{slot.dmxValue}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {slots.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center gap-2">
                <CircleDot size={Math.min(widget.width, widget.height) * 0.2} className="text-muted-foreground/20" />
                <span className="text-[9px] text-muted-foreground/40 text-center px-2">
                  No fixed color wheel fixtures found.
                  <br />Add fixtures with color wheels in Devices first.
                </span>
              </div>
            )}
          </div>
        );
      })()}

      {/* MEDIA TRIGGER */}
      {widget.type === 'media-trigger' && (() => {
        const mediaStore = useMediaStore.getState();
        const linkedItem = widget.mediaItemId ? mediaStore.items.find(i => i.id === widget.mediaItemId) : null;
        const linkedPlaylist = widget.mediaPlaylistId ? mediaStore.playlists.find(p => p.id === widget.mediaPlaylistId) : null;
        const isActive = linkedItem
          ? mediaStore.activeItemId === linkedItem.id && mediaStore.isPlaying
          : linkedPlaylist
            ? mediaStore.activePlaylistId === linkedPlaylist.id && mediaStore.isPlaying
            : false;
        const displayName = linkedItem?.name || linkedPlaylist?.name || 'No media linked';
        const playMode = widget.mediaPlayMode || 'loop';
        const isFlash = widget.mediaFlash ?? false;
        const modeLabel = playMode === 'play-once' ? '1×' : playMode === 'loop-random' ? '🔀' : '🔁';

        const triggerPlay = () => {
          const ms = useMediaStore.getState();
          if (linkedPlaylist) {
            if (playMode === 'loop-random') {
              ms.updatePlaylist(linkedPlaylist.id, { loopMode: 'shuffle' });
            } else if (playMode === 'loop') {
              ms.updatePlaylist(linkedPlaylist.id, { loopMode: 'loop-all' });
            } else {
              ms.updatePlaylist(linkedPlaylist.id, { loopMode: 'none' });
            }
            ms.playPlaylist(linkedPlaylist.id);
          } else if (linkedItem) {
            ms.playItem(linkedItem.id);
          }
        };

        const triggerStop = () => {
          useMediaStore.getState().setIsPlaying(false);
        };

        return (
          <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col items-center justify-center gap-1 transition-all overflow-hidden relative cursor-pointer"
            style={{ ...bgStyle, borderColor: isActive ? '#00e5ff' : undefined,
              boxShadow: isActive ? '0 0 24px rgba(0,229,255,0.3), inset 0 0 20px rgba(0,229,255,0.15)' : undefined }}
            onMouseDown={() => {
              onSelect();
              if (isFlash) {
                triggerPlay();
              } else {
                if (isActive) triggerStop(); else triggerPlay();
              }
            }}
            onMouseUp={() => { if (isFlash) triggerStop(); }}
            onMouseLeave={() => { if (isFlash && isActive) triggerStop(); }}>
            <div className="absolute inset-0 rounded-lg opacity-15" style={{ backgroundColor: '#00e5ff' }} />
            {isActive && <div className="absolute inset-0 rounded-lg z-[2]" style={{ background: 'radial-gradient(circle at center, rgba(0,229,255,0.2), transparent)' }} />}
            {/* Mode badge */}
            <div className="absolute top-1 left-1 text-[7px] px-1 py-0.5 rounded bg-muted/40 text-muted-foreground z-10 font-mono">
              {modeLabel}
            </div>
            {isFlash && <div className="absolute top-1 right-8 text-[6px] px-1 py-0.5 rounded bg-stokio-pink/20 text-stokio-pink border border-stokio-pink/30 z-10 font-semibold">FLASH</div>}
            <Film size={Math.min(widget.width, widget.height) * 0.2} className="text-stokio-cyan relative z-10 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]" />
            <span className="text-muted-foreground font-semibold truncate px-2 relative z-10 text-center"
              style={{ fontSize: Math.max(7, Math.min(11, widget.width * 0.1)), textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
              {widget.label}
            </span>
            <span className="text-muted-foreground/50 truncate px-2 relative z-10 text-center"
              style={{ fontSize: Math.max(6, Math.min(9, widget.width * 0.07)) }}>
              {displayName}
            </span>
            {isActive && <div className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))] animate-pulse z-10" />}
          </div>
        );
      })()}

      {/* VFX AUDIO VISUALIZER */}
      {widget.type === 'vfx' && (() => {
        const canvasRef = useRef<HTMLCanvasElement>(null);
        const engineRef = useRef<AudioVisualizerEngine | null>(null);
        const animRef = useRef<number | null>(null);

        useEffect(() => {
          const engine = new AudioVisualizerEngine();
          engineRef.current = engine;
          engine.preset = widget.vfxPreset || 'plasma-wave';

          if (widget.vfxRunning) {
            engine.start('microphone').catch(() => {});
          }

          const animate = () => {
            if (canvasRef.current && engineRef.current) {
              const ctx = canvasRef.current.getContext('2d');
              if (ctx) engineRef.current.render(ctx, canvasRef.current.width, canvasRef.current.height);
            }
            animRef.current = requestAnimationFrame(animate);
          };
          animRef.current = requestAnimationFrame(animate);

          return () => {
            engine.stop();
            if (animRef.current) cancelAnimationFrame(animRef.current);
          };
        }, []);

        useEffect(() => {
          if (engineRef.current) engineRef.current.preset = widget.vfxPreset || 'plasma-wave';
        }, [widget.vfxPreset]);

        useEffect(() => {
          if (!engineRef.current) return;
          if (widget.vfxRunning && !engineRef.current.isRunning) {
            engineRef.current.start('microphone').catch(() => {});
          } else if (!widget.vfxRunning && engineRef.current.isRunning) {
            engineRef.current.stop();
          }
        }, [widget.vfxRunning]);

        return (
          <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col overflow-hidden relative"
            style={bgStyle} onClick={onSelect}>
            <div className="absolute top-1 left-1 z-10 flex items-center gap-1">
              <span className="text-[7px] px-1 py-0.5 rounded bg-muted/60 text-muted-foreground backdrop-blur-sm">
                {PRESET_LABELS[widget.vfxPreset || 'plasma-wave']}
              </span>
            </div>
            <div className="absolute top-1 right-1 z-10">
              <button
                onClick={(e) => { e.stopPropagation(); onUpdate({ vfxRunning: !widget.vfxRunning }); }}
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                  widget.vfxRunning ? 'bg-primary/20 text-primary shadow-[0_0_8px_hsl(var(--primary)/0.4)]' : 'bg-muted/40 text-muted-foreground'
                }`}>
                {widget.vfxRunning ? <Square size={10} /> : <Play size={10} />}
              </button>
            </div>
            <canvas ref={canvasRef} className="w-full h-full rounded-lg" width={widget.width} height={widget.height} />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2 flex items-end justify-center">
              <span className="text-muted-foreground font-semibold truncate"
                style={{ fontSize: Math.max(8, Math.min(12, widget.width * 0.08)), textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
                {widget.label}
              </span>
            </div>
          </div>
        );
      })()}

      {/* WLED PRESET */}
      {widget.type === 'wled-preset' && (() => {
        const presets = widget.wledPresets || [];
        const isActive = widget.wledPresetId !== undefined && widget.wledPresetId >= 0;

        const activatePreset = (presetId: number) => {
          onSelect();
          onUpdate({ wledPresetId: presetId });
          // In real mode: fetch(`http://${widget.wledIp}/json/state`, { method: 'POST', body: JSON.stringify({ ps: presetId }) });
        };

        const fetchPresetsFromDevice = async () => {
          if (!widget.wledIp) return;
          try {
            // Mock presets — in production this would be: fetch(`http://${ip}/json/presets`)
            const mockPresets = [
              { id: 1, name: 'Rainbow' }, { id: 2, name: 'Fire' }, { id: 3, name: 'Ocean' },
              { id: 4, name: 'Forest' }, { id: 5, name: 'Twinkle' }, { id: 6, name: 'Meteor' },
              { id: 7, name: 'Breathe' }, { id: 8, name: 'Scanner' }, { id: 9, name: 'Chase' },
              { id: 10, name: 'Fireworks' }, { id: 11, name: 'Sunrise' }, { id: 12, name: 'Party' },
            ];
            onUpdate({ wledPresets: mockPresets });
          } catch {}
        };

        useEffect(() => {
          if (widget.wledIp && presets.length === 0) fetchPresetsFromDevice();
        }, [widget.wledIp]);

        return (
          <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col overflow-hidden relative"
            style={{ ...bgStyle, borderColor: isActive ? '#ff6600' : undefined,
              boxShadow: isActive ? '0 0 20px rgba(255,102,0,0.3)' : undefined }}
            onClick={onSelect}>
            <div className="px-2 py-1.5 flex items-center gap-1.5 border-b border-border/20" style={{ background: 'rgba(255,102,0,0.08)' }}>
              <Wifi size={10} className="text-[#ff6600]" />
              <span className="text-[9px] font-semibold truncate" style={{ color: '#ff6600' }}>{widget.label}</span>
              {widget.wledIp && <span className="text-[7px] text-muted-foreground/50 ml-auto font-mono">{widget.wledIp}</span>}
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 grid gap-1"
              style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.floor(widget.width / 65))}, 1fr)` }}>
              {presets.map(p => (
                <button key={p.id}
                  onClick={(e) => { e.stopPropagation(); activatePreset(p.id); }}
                  className={`px-1.5 py-1 rounded text-[8px] font-medium border transition-all truncate ${
                    widget.wledPresetId === p.id
                      ? 'bg-[#ff6600]/20 border-[#ff6600]/40 text-[#ff6600] shadow-[0_0_8px_rgba(255,102,0,0.3)]'
                      : 'border-border/20 text-muted-foreground hover:border-[#ff6600]/30 hover:bg-[#ff6600]/5'
                  }`}>
                  {p.name}
                </button>
              ))}
              {presets.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center py-4 gap-1">
                  <Wifi size={16} className="text-muted-foreground/20" />
                  <span className="text-[8px] text-muted-foreground/40">Set WLED IP in properties</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Script Editor ──

function ScriptEditor({
  script, onUpdate, onDelete, fixtures,
}: {
  script: DJScript;
  onUpdate: (s: DJScript) => void;
  onDelete: () => void;
  fixtures: { inst: FixtureInstance; def: FixtureDefinition }[];
}) {
  const [expanded, setExpanded] = useState(true);
  const [running, setRunning] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);

  const addStep = () => {
    onUpdate({
      ...script,
      steps: [...script.steps, {
        id: `step-${Date.now()}`,
        type: 'set-dimmer',
        params: { value: 255 },
        duration: 500,
      }],
    });
  };

  const updateStep = (stepId: string, updates: Partial<ScriptStep>) => {
    onUpdate({
      ...script,
      steps: script.steps.map(s => s.id === stepId ? { ...s, ...updates } : s),
    });
  };

  const removeStep = (stepId: string) => {
    onUpdate({ ...script, steps: script.steps.filter(s => s.id !== stepId) });
  };

  const runScript = () => {
    if (script.steps.length === 0) return;
    setRunning(true);
    setActiveStep(0);
    let idx = 0;
    const advance = () => {
      idx++;
      if (idx >= script.steps.length) {
        if (script.loop) { idx = 0; } else { setRunning(false); setActiveStep(-1); return; }
      }
      setActiveStep(idx);
      setTimeout(advance, script.steps[idx].duration);
    };
    setTimeout(advance, script.steps[0].duration);
  };

  const stopScript = () => { setRunning(false); setActiveStep(-1); };

  return (
    <div className="glass-panel border border-border/20 rounded-lg overflow-hidden">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/20 transition-colors">
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="text-xs font-semibold flex-1">{script.name}</span>
        <span className="text-[8px] text-muted-foreground">{script.steps.length} steps</span>
        {script.loop && <span className="text-[7px] px-1 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">LOOP</span>}
        {running && <span className="text-[7px] px-1 py-0.5 rounded bg-stokio-green/10 text-stokio-green border border-stokio-green/20 animate-pulse">RUNNING</span>}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="px-3 pb-3 space-y-2 border-t border-border/20 pt-2">
              <div className="flex items-center gap-1">
                {!running ? (
                  <Button size="sm" className="h-6 text-[9px] gap-1" onClick={runScript}>
                    <Play size={10} /> Run
                  </Button>
                ) : (
                  <Button size="sm" variant="destructive" className="h-6 text-[9px] gap-1" onClick={stopScript}>
                    <Square size={10} /> Stop
                  </Button>
                )}
                <Button variant="outline" size="sm" className="h-6 text-[9px] gap-1"
                  onClick={() => onUpdate({ ...script, loop: !script.loop })}>
                  {script.loop ? '🔁 Loop ON' : '➡ Loop OFF'}
                </Button>
                <div className="flex-1" />
                <Button variant="ghost" size="sm" className="h-6 text-[9px] gap-1" onClick={addStep}>
                  <Plus size={10} /> Step
                </Button>
                <Button variant="ghost" size="sm" className="h-6 text-[9px] text-destructive" onClick={onDelete}>
                  <Trash2 size={10} />
                </Button>
              </div>

              <div className="flex flex-wrap gap-1">
                <span className="text-[7px] text-muted-foreground uppercase self-center">Fixtures:</span>
                {fixtures.map(({ inst, def }) => {
                  const linked = script.linkedFixtureIds.includes(inst.id);
                  return (
                    <button key={inst.id}
                      onClick={() => onUpdate({
                        ...script,
                        linkedFixtureIds: linked
                          ? script.linkedFixtureIds.filter(id => id !== inst.id)
                          : [...script.linkedFixtureIds, inst.id],
                      })}
                      className={`text-[8px] px-1.5 py-0.5 rounded border transition-all ${
                        linked ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border/20 text-muted-foreground hover:border-border/40'
                      }`}
                    >
                      {getFixtureTypeIcon(def.type)} {inst.name}
                    </button>
                  );
                })}
              </div>

              <div className="space-y-1">
                {script.steps.map((step, idx) => (
                  <div key={step.id}
                    className={`flex items-center gap-2 p-2 rounded text-[9px] border transition-all ${
                      activeStep === idx
                        ? 'border-primary/40 bg-primary/5 glow-green'
                        : 'border-border/10 bg-card/30'
                    }`}
                  >
                    <span className="font-mono text-muted-foreground/50 w-4">{idx + 1}</span>
                    <select value={step.type}
                      onChange={e => updateStep(step.id, { type: e.target.value as ScriptStep['type'] })}
                      className="h-5 rounded bg-muted/20 border border-border/20 text-[9px] px-1 text-foreground">
                      {STEP_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>

                    {step.type === 'set-dimmer' && (
                      <div className="flex items-center gap-1 flex-1">
                        <span className="text-muted-foreground">Val:</span>
                        <Input type="number" min={0} max={255} value={step.params.value || 0}
                          onChange={e => updateStep(step.id, { params: { ...step.params, value: Number(e.target.value) } })}
                          className="h-5 w-14 text-[9px] bg-muted/20 border-border/20 font-mono px-1" />
                      </div>
                    )}

                    {step.type === 'set-color' && (
                      <div className="flex items-center gap-1 flex-1">
                        <Input type="color" value={String(step.params.color || '#ff0000')}
                          onChange={e => updateStep(step.id, { params: { ...step.params, color: e.target.value } })}
                          className="h-5 w-8 p-0 bg-transparent border-0 cursor-pointer" />
                        <span className="text-muted-foreground font-mono">{step.params.color || '#ff0000'}</span>
                      </div>
                    )}

                    {step.type === 'set-position' && (
                      <div className="flex items-center gap-1 flex-1">
                        <span className="text-muted-foreground">P:</span>
                        <Input type="number" min={0} max={255} value={step.params.pan || 128}
                          onChange={e => updateStep(step.id, { params: { ...step.params, pan: Number(e.target.value) } })}
                          className="h-5 w-12 text-[9px] bg-muted/20 border-border/20 font-mono px-1" />
                        <span className="text-muted-foreground">T:</span>
                        <Input type="number" min={0} max={255} value={step.params.tilt || 128}
                          onChange={e => updateStep(step.id, { params: { ...step.params, tilt: Number(e.target.value) } })}
                          className="h-5 w-12 text-[9px] bg-muted/20 border-border/20 font-mono px-1" />
                      </div>
                    )}

                    {(step.type === 'wait' || step.type === 'fade') && <div className="flex-1" />}

                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">ms:</span>
                      <Input type="number" min={0} step={100} value={step.duration}
                        onChange={e => updateStep(step.id, { duration: Number(e.target.value) })}
                        className="h-5 w-16 text-[9px] bg-muted/20 border-border/20 font-mono px-1" />
                    </div>
                    <button onClick={() => removeStep(step.id)} className="text-muted-foreground hover:text-destructive">
                      <X size={10} />
                    </button>
                  </div>
                ))}
                {script.steps.length === 0 && (
                  <div className="text-[9px] text-muted-foreground/50 text-center py-3">No steps — click "+ Step" to add</div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Storage helpers ──
const STORAGE_KEY = 'stokio-dj-layouts';

function loadSavedLayouts(): SavedLayout[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function persistLayouts(layouts: SavedLayout[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
}

// ── Main LIVE DJ Component ──

export function LiveDJ() {
  const store = useFixtureStore();
  const [tab, setTab] = useState<Tab>('controller');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editingPageName, setEditingPageName] = useState('');

  // ── Pages ──
  const [pages, setPages] = useState<LayoutPage[]>([
    {
      id: 'page-1', name: 'Main',
      widgets: [
        { id: 'w1', type: 'button', label: 'STROBE', x: 20, y: 30, width: 100, height: 100, color: '#ff2d78', flash: true, linkedFixtureIds: [], linkedFunction: 'strobe', lockAxis: 'none' },
        { id: 'w2', type: 'button', label: 'BLACKOUT', x: 140, y: 30, width: 100, height: 100, color: '#ffffff', flash: true, linkedFixtureIds: [], linkedFunction: 'dimmer', lockAxis: 'none' },
        { id: 'w3', type: 'slider', label: 'MASTER', x: 260, y: 20, width: 70, height: 200, color: '#00ff66', value: 100, min: 0, max: 100, linkedFixtureIds: [], linkedFunction: 'dimmer', lockAxis: 'none' },
        { id: 'w4', type: 'color-wheel', label: 'COLOR', x: 350, y: 20, width: 140, height: 140, color: '#00e5ff', colorValue: { r: 255, g: 0, b: 100 }, linkedFixtureIds: [], lockAxis: 'none' },
        { id: 'w5', type: 'xy-pad', label: 'PAN/TILT', x: 510, y: 20, width: 180, height: 180, color: '#00e5ff', colorValue: { r: 128, g: 128, b: 128 }, linkedFixtureIds: [], lockAxis: 'none' },
      ],
    },
  ]);
  const [activePageId, setActivePageId] = useState('page-1');
  const activePage = pages.find(p => p.id === activePageId) || pages[0];
  const widgets = activePage?.widgets || [];

  const setWidgets = (updater: DJWidget[] | ((prev: DJWidget[]) => DJWidget[])) => {
    setPages(prev => prev.map(p => p.id === activePageId
      ? { ...p, widgets: typeof updater === 'function' ? updater(p.widgets) : updater }
      : p
    ));
  };

  // ── Groups ──
  const [groups, setGroups] = useState<FixtureGroup[]>([]);

  // ── Assignments & Scripts ──
  const [assignments, setAssignments] = useState<FixtureAssignment[]>(() =>
    store.instances.map(inst => ({ instanceId: inst.id, mode: 'buttons' as ControlMode }))
  );
  const [scripts, setScripts] = useState<DJScript[]>([
    {
      id: 'sc1', name: 'Strobe Sequence', loop: true, linkedFixtureIds: [],
      steps: [
        { id: 's1', type: 'set-dimmer', params: { value: 255 }, duration: 100 },
        { id: 's2', type: 'set-dimmer', params: { value: 0 }, duration: 100 },
      ],
    },
    {
      id: 'sc2', name: 'Color Chase', loop: true, linkedFixtureIds: [],
      steps: [
        { id: 's1', type: 'set-color', params: { color: '#ff0000' }, duration: 500 },
        { id: 's2', type: 'set-color', params: { color: '#00ff00' }, duration: 500 },
        { id: 's3', type: 'set-color', params: { color: '#0000ff' }, duration: 500 },
      ],
    },
  ]);

  const [selectedWidget, setSelectedWidget] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const tabBgInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // ── Saved Layouts ──
  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>(() => loadSavedLayouts());
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [saveName, setSaveName] = useState('');

  // ── Audio & BPM ──
  const [audioConfig, setAudioConfig] = useState<AudioConfig>({
    source: 'none', squelch: 10, gain: 128, udpPort: 11988,
  });
  const [bpmState, setBpmState] = useState<BPMState>({
    bpm: 120, tapTimes: [], isSynced: false, linkedWidgetIds: [], flashOn: false,
  });
  const bpmFlashRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleTap = () => {
    const now = Date.now();
    setBpmState(prev => {
      const taps = [...prev.tapTimes, now].filter(t => now - t < 5000);
      if (taps.length >= 2) {
        const intervals = taps.slice(1).map((t, i) => t - taps[i]);
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const bpm = Math.round(60000 / avgInterval);
        return { ...prev, tapTimes: taps, bpm: Math.max(20, Math.min(300, bpm)), isSynced: true };
      }
      return { ...prev, tapTimes: taps };
    });
  };

  useEffect(() => {
    if (bpmFlashRef.current) clearInterval(bpmFlashRef.current);
    if (bpmState.bpm > 0 && bpmState.isSynced) {
      const interval = 60000 / bpmState.bpm;
      bpmFlashRef.current = setInterval(() => {
        setBpmState(prev => ({ ...prev, flashOn: true }));
        setTimeout(() => setBpmState(prev => ({ ...prev, flashOn: false })), Math.min(100, interval / 3));
      }, interval);
    }
    return () => { if (bpmFlashRef.current) clearInterval(bpmFlashRef.current); };
  }, [bpmState.bpm, bpmState.isSynced]);

  const toggleBpmWidgetLink = (widgetId: string) => {
    setBpmState(prev => ({
      ...prev,
      linkedWidgetIds: prev.linkedWidgetIds.includes(widgetId)
        ? prev.linkedWidgetIds.filter(id => id !== widgetId)
        : [...prev.linkedWidgetIds, widgetId],
    }));
  };

  const getAssignment = (instId: string) => assignments.find(a => a.instanceId === instId);
  const setAssignmentMode = (instId: string, mode: ControlMode) => {
    setAssignments(prev => {
      const existing = prev.find(a => a.instanceId === instId);
      if (existing) return prev.map(a => a.instanceId === instId ? { ...a, mode } : a);
      return [...prev, { instanceId: instId, mode }];
    });
  };

  const updateWidget = (id: string, updates: Partial<DJWidget>) => {
    if (snapToGrid) {
      const gridSize = 20;
      if (updates.x !== undefined) updates.x = Math.round(updates.x / gridSize) * gridSize;
      if (updates.y !== undefined) updates.y = Math.round(updates.y / gridSize) * gridSize;
      if (updates.width !== undefined) updates.width = Math.round(updates.width / gridSize) * gridSize;
      if (updates.height !== undefined) updates.height = Math.round(updates.height / gridSize) * gridSize;
    }
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, ...updates } : w));
  };

  const addWidget = (type: WidgetType) => {
    const preset = WIDGET_PRESETS.find(p => p.type === type)!;
    setWidgets(prev => [...prev, {
      id: `w-${Date.now()}`,
      type,
      label: preset.label,
      x: 20 + Math.random() * 200,
      y: 20 + Math.random() * 100,
      width: preset.w,
      height: preset.h,
      color: '#00e5ff',
      flash: type === 'button',
      value: type === 'slider' ? 50 : undefined,
      linkedFixtureIds: [],
      lockAxis: 'none',
      presetEntries: type === 'preset' ? [] : undefined,
      fixedColorSlotValue: type === 'fixed-color' ? undefined : undefined,
      rgbSyncEnabled: type === 'fixed-color' ? false : undefined,
      vfxPreset: type === 'vfx' ? 'plasma-wave' : undefined,
      vfxRunning: type === 'vfx' ? false : undefined,
      wledIp: type === 'wled-preset' ? '' : undefined,
      wledPresets: type === 'wled-preset' ? [] : undefined,
      wledPresetId: type === 'wled-preset' ? -1 : undefined,
    }]);
  };

  const removeWidget = (id: string) => {
    setWidgets(prev => prev.filter(w => w.id !== id));
    if (selectedWidget === id) setSelectedWidget(null);
  };

  const duplicateWidget = (id: string) => {
    const source = widgets.find(w => w.id === id);
    if (!source) return;
    const clone: DJWidget = {
      ...source,
      id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      x: source.x + 20,
      y: source.y + 20,
      label: `${source.label} (copy)`,
    };
    setWidgets(prev => [...prev, clone]);
    setSelectedWidget(clone.id);
  };

  const handleWidgetBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedWidget) return;
    const reader = new FileReader();
    reader.onload = () => updateWidget(selectedWidget, { bgImage: reader.result as string });
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleTabBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPages(prev => prev.map(p => p.id === activePageId ? { ...p, bgImage: reader.result as string } : p));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const updatePageBg = (updates: Partial<LayoutPage>) => {
    setPages(prev => prev.map(p => p.id === activePageId ? { ...p, ...updates } : p));
  };

  const addPage = () => {
    const newPage: LayoutPage = {
      id: `page-${Date.now()}`,
      name: `Page ${pages.length + 1}`,
      widgets: [],
    };
    setPages(prev => [...prev, newPage]);
    setActivePageId(newPage.id);
  };

  const renamePage = (pageId: string, name: string) => {
    setPages(prev => prev.map(p => p.id === pageId ? { ...p, name } : p));
  };

  const deletePage = (pageId: string) => {
    if (pages.length <= 1) return;
    setPages(prev => prev.filter(p => p.id !== pageId));
    if (activePageId === pageId) setActivePageId(pages.find(p => p.id !== pageId)!.id);
  };

  const duplicatePage = (pageId: string) => {
    const source = pages.find(p => p.id === pageId);
    if (!source) return;
    const newId = `page-${Date.now()}`;
    const clonedWidgets = source.widgets.map(w => ({
      ...w,
      id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    }));
    const newPage: LayoutPage = {
      ...source,
      id: newId,
      name: `${source.name} (copy)`,
      widgets: clonedWidgets,
    };
    setPages(prev => [...prev, newPage]);
    setActivePageId(newId);
  };

  // ── Group management ──
  const addGroup = () => {
    setGroups(prev => [...prev, {
      id: `grp-${Date.now()}`,
      name: `Group ${prev.length + 1}`,
      color: '#00e5ff',
      fixtureIds: [],
    }]);
  };

  const updateGroup = (id: string, updates: Partial<FixtureGroup>) => {
    setGroups(prev => prev.map(g => g.id === id ? { ...g, ...updates } : g));
  };

  const deleteGroup = (id: string) => {
    setGroups(prev => prev.filter(g => g.id !== id));
  };

  const toggleGroupFixture = (groupId: string, fixtureId: string) => {
    setGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      return {
        ...g,
        fixtureIds: g.fixtureIds.includes(fixtureId)
          ? g.fixtureIds.filter(id => id !== fixtureId)
          : [...g.fixtureIds, fixtureId],
      };
    }));
  };

  // ── Save / Load ──
  const saveLayout = () => {
    if (!saveName.trim()) return;
    const layout: SavedLayout = {
      id: `layout-${Date.now()}`,
      name: saveName.trim(),
      createdAt: new Date().toISOString(),
      pages,
      groups,
      assignments,
      scripts,
      audioConfig,
    };
    const updated = [...savedLayouts, layout];
    setSavedLayouts(updated);
    persistLayouts(updated);
    setSaveName('');
    setShowSaveDialog(false);
  };

  const loadLayout = (layout: SavedLayout) => {
    setPages(layout.pages);
    setActivePageId(layout.pages[0]?.id || 'page-1');
    setGroups(layout.groups);
    setAssignments(layout.assignments);
    setScripts(layout.scripts);
    setAudioConfig(layout.audioConfig);
    setShowLoadDialog(false);
  };

  const deleteLayout = (id: string) => {
    const updated = savedLayouts.filter(l => l.id !== id);
    setSavedLayouts(updated);
    persistLayouts(updated);
  };

  const exportLayout = () => {
    const layout: SavedLayout = {
      id: `layout-${Date.now()}`,
      name: 'Export',
      createdAt: new Date().toISOString(),
      pages, groups, assignments, scripts, audioConfig,
    };
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'stokio-dj-layout.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const importLayout = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const layout = JSON.parse(reader.result as string) as SavedLayout;
        loadLayout(layout);
      } catch { /* invalid file */ }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const addScript = () => {
    setScripts(prev => [...prev, {
      id: `sc-${Date.now()}`,
      name: `Script ${prev.length + 1}`,
      steps: [],
      loop: false,
      linkedFixtureIds: [],
    }]);
  };

  const fixturesWithDefs = store.instances.map(inst => ({
    inst,
    def: store.definitions.find(d => d.id === inst.definitionId)!,
  })).filter(f => f.def);

  const selectedWidgetData = widgets.find(w => w.id === selectedWidget);

  // ── Link group to widget helper ──
  const linkGroupToWidget = (groupId: string) => {
    if (!selectedWidget) return;
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    updateWidget(selectedWidget, { linkedFixtureIds: [...new Set([...selectedWidgetData!.linkedFixtureIds, ...group.fixtureIds])] });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className={`${isFullscreen ? 'fixed inset-0 z-[100] bg-background' : 'h-full'} flex flex-col`}>
      {/* Header */}
      {!isFullscreen && (
      <div className="flex items-center justify-between p-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Speaker size={16} className="text-stokio-pink" />
          <h2 className="text-sm font-semibold tracking-wider">LIVE DJ</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Save / Load / Export / Import */}
          <div className="flex gap-1 mr-2 border-r border-border/20 pr-2">
            <Button variant="ghost" size="sm" className="h-7 text-[9px] gap-1" onClick={() => { setSaveName(''); setShowSaveDialog(true); }}>
              <Save size={11} /> Save
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-[9px] gap-1" onClick={() => setShowLoadDialog(true)}>
              <FolderOpen size={11} /> Open
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-[9px] gap-1" onClick={exportLayout}>
              <Download size={11} /> Export
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-[9px] gap-1" onClick={() => importInputRef.current?.click()}>
              <Upload size={11} /> Import
            </Button>
            <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={importLayout} />
          </div>

          {/* Tabs */}
          <div className="flex gap-1">
            {([
              { id: 'controller' as Tab, label: '🎛 Controller' },
              { id: 'assignments' as Tab, label: '📡 Assign' },
              { id: 'groups' as Tab, label: '👥 Groups' },
              { id: 'scripts' as Tab, label: '📜 Scripts' },
            ]).map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold rounded transition-colors ${
                  tab === t.id ? 'bg-primary/10 text-primary border border-primary/30' : 'text-muted-foreground hover:text-foreground'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setIsFullscreen(true)}>
            <Maximize2 size={14} />
          </Button>
        </div>
      </div>
      )}

      {/* Fullscreen minimal header */}
      {isFullscreen && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 bg-background">
          <div className="flex items-center gap-2">
            <Speaker size={14} className="text-stokio-pink" />
            <span className="text-xs font-semibold tracking-wider text-muted-foreground">LIVE DJ</span>
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setIsFullscreen(false)}>
            <Minimize2 size={14} />
          </Button>
        </div>
      )}
      <AnimatePresence>
        {showSaveDialog && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center"
            onClick={() => setShowSaveDialog(false)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="glass-panel-strong border border-border/30 rounded-xl p-6 w-96 space-y-4"
              onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-semibold flex items-center gap-2"><Save size={14} /> Save Layout</h3>
              <div>
                <label className="text-[9px] uppercase text-muted-foreground">Layout Name</label>
                <Input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="My DJ Setup..."
                  className="mt-1 bg-muted/20 border-border/20" autoFocus
                  onKeyDown={e => e.key === 'Enter' && saveLayout()} />
              </div>
              <div className="text-[9px] text-muted-foreground">
                Saves: {pages.length} page(s), {groups.length} group(s), {scripts.length} script(s), all assignments & audio config
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowSaveDialog(false)}>Cancel</Button>
                <Button size="sm" onClick={saveLayout} disabled={!saveName.trim()}>Save</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Load Dialog ── */}
      <AnimatePresence>
        {showLoadDialog && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center"
            onClick={() => setShowLoadDialog(false)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="glass-panel-strong border border-border/30 rounded-xl p-6 w-[28rem] space-y-4 max-h-[70vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-semibold flex items-center gap-2"><FolderOpen size={14} /> Open Layout</h3>
              {savedLayouts.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">No saved layouts yet</div>
              ) : (
                <div className="space-y-2">
                  {savedLayouts.map(layout => (
                    <div key={layout.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border/20 hover:border-primary/30 hover:bg-primary/5 transition-all cursor-pointer group"
                      onClick={() => loadLayout(layout)}>
                      <FileText size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold">{layout.name}</div>
                        <div className="text-[9px] text-muted-foreground">
                          {layout.pages.length} pages · {layout.groups.length} groups · {new Date(layout.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="h-6 text-[8px] text-destructive opacity-0 group-hover:opacity-100"
                        onClick={(e) => { e.stopPropagation(); deleteLayout(layout.id); }}>
                        <Trash2 size={10} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowLoadDialog(false)}>Close</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── CONTROLLER TAB ── */}
      {(tab === 'controller' || isFullscreen) && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Page tabs */}
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/20 bg-card/30">
            <span className="text-[8px] uppercase tracking-widest text-muted-foreground/50 mr-1">Pages:</span>
            {pages.map((page, idx) => (
              <div key={page.id} className="flex items-center">
                {editingPageId === page.id ? (
                  <input
                    autoFocus
                    value={editingPageName}
                    onChange={e => setEditingPageName(e.target.value)}
                    onBlur={() => { if (editingPageName.trim()) renamePage(page.id, editingPageName.trim()); setEditingPageId(null); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { if (editingPageName.trim()) renamePage(page.id, editingPageName.trim()); setEditingPageId(null); }
                      if (e.key === 'Escape') setEditingPageId(null);
                    }}
                    className="px-2 py-0.5 text-[10px] font-semibold bg-primary/10 text-primary border border-primary/30 rounded-t outline-none w-20"
                  />
                ) : (
                  <button
                    onClick={() => setActivePageId(page.id)}
                    onDoubleClick={() => { setEditingPageId(page.id); setEditingPageName(page.name); }}
                    className={`px-3 py-1 text-[10px] font-semibold rounded-t transition-all ${
                      activePageId === page.id
                        ? 'bg-primary/10 text-primary border border-primary/30 border-b-0'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/20'
                    }`}
                  >
                    {page.name}
                  </button>
                )}
                {activePageId === page.id && (
                  <>
                    <button onClick={() => duplicatePage(page.id)} className="ml-0.5 text-muted-foreground/40 hover:text-primary" title="Duplicate tab">
                      <Copy size={10} />
                    </button>
                    {pages.length > 1 && (
                      <button onClick={() => deletePage(page.id)} className="ml-0.5 text-muted-foreground/40 hover:text-destructive">
                        <X size={10} />
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
            <button onClick={addPage}
              className="px-2 py-1 text-[10px] text-muted-foreground hover:text-primary border border-dashed border-border/20 hover:border-primary/30 rounded transition-all">
              <Plus size={10} />
            </button>

            <div className="ml-auto flex items-center gap-2">
              {/* Tab Background */}
              <input ref={tabBgInputRef} type="file" accept="image/*" className="hidden" onChange={handleTabBgUpload} />
              <Button variant="outline" size="sm" className="h-6 text-[8px] gap-1"
                onClick={() => tabBgInputRef.current?.click()}>
                <ImagePlus size={9} /> BG
              </Button>
              {activePage?.bgImage && (
                <>
                  <div className="flex items-center gap-1">
                    <span className="text-[7px] text-muted-foreground">Opacity</span>
                    <input type="range" min={0} max={100} value={activePage.bgOpacity ?? 30}
                      onChange={e => updatePageBg({ bgOpacity: Number(e.target.value) })}
                      className="w-16 h-3 accent-primary" />
                    <span className="text-[7px] font-mono text-muted-foreground w-6">{activePage.bgOpacity ?? 30}%</span>
                  </div>
                  <select value={activePage.bgFit || 'fill'}
                    onChange={e => updatePageBg({ bgFit: e.target.value as 'fill' | 'fit' })}
                    className="h-6 text-[8px] bg-muted/30 border border-border/30 rounded px-1 text-foreground">
                    <option value="fill">Fill</option>
                    <option value="fit">Fit</option>
                  </select>
                  <Button variant="ghost" size="sm" className="h-6 text-[8px] text-destructive p-1"
                    onClick={() => updatePageBg({ bgImage: null })}>
                    <X size={9} />
                  </Button>
                </>
              )}

              {/* Snap to Grid */}
              <Button variant={snapToGrid ? 'secondary' : 'outline'} size="sm" className="h-6 text-[8px] gap-1"
                onClick={() => setSnapToGrid(!snapToGrid)}>
                <Grid3X3 size={9} /> Snap {snapToGrid ? 'ON' : 'OFF'}
              </Button>
            </div>
          </div>

          <div className="flex-1 flex overflow-hidden">
            {/* Widget surface */}
            <div className="flex-1 relative overflow-hidden" ref={surfaceRef}
              onClick={(e) => {
                if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.surface) {
                  setSelectedWidget(null);
                }
              }}
            >
              <div className="absolute inset-0" data-surface="true"
                style={{ backgroundImage: 'radial-gradient(circle, hsl(var(--border) / 0.15) 1px, transparent 1px)', backgroundSize: '20px 20px' }} />

              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <img src={stokioLogo} alt="" className="w-[300px] h-[300px] object-contain opacity-[0.04]" />
              </div>

              {widgets.map(w => (
                <ControlWidget
                  key={w.id}
                  widget={w}
                  isSelected={selectedWidget === w.id}
                  onSelect={() => setSelectedWidget(w.id)}
                  onUpdate={(updates) => updateWidget(w.id, updates)}
                  onPress={() => {
                    // Preset recall: apply stored scene values to all other widgets
                    if (w.type === 'preset' && w.presetEntries && w.presetEntries.length > 0) {
                      w.presetEntries.forEach(entry => {
                        // WLED preset: trigger device preset via API
                        if (entry.targetType === 'wled') {
                          const wledInst = fixturesWithDefs.find(f => f.inst.id === entry.targetId);
                          const wledIp = wledInst?.def.wledConfig?.ip;
                          if (wledIp && entry.wledPresetId !== undefined) {
                            // In production: fetch(`http://${wledIp}/json/state`, { method: 'POST', body: JSON.stringify({ ps: entry.wledPresetId }) });
                          }
                          // Also apply color if set
                          if (wledIp && entry.color) {
                            // In production: fetch(`http://${wledIp}/json/state`, { method: 'POST', body: JSON.stringify({ seg: [{ col: [[entry.color.r, entry.color.g, entry.color.b]] }] }) });
                          }
                          // Apply to WLED preset widgets linked to this fixture
                          widgets.forEach(ow => {
                            if (ow.type === 'wled-preset' && ow.linkedFixtureIds.includes(entry.targetId) && entry.wledPresetId !== undefined) {
                              updateWidget(ow.id, { wledPresetId: entry.wledPresetId });
                            }
                          });
                          return;
                        }

                        // Find matching widgets linked to this fixture/group and apply values
                        const targetFixtureIds = entry.targetType === 'group'
                          ? (groups.find(g => g.id === entry.targetId)?.fixtureIds || [])
                          : [entry.targetId];

                        widgets.forEach(ow => {
                          if (ow.id === w.id) return;
                          const hasLink = ow.linkedFixtureIds.some(fid => targetFixtureIds.includes(fid));
                          if (!hasLink && ow.linkedFixtureIds.length > 0) return;

                          // Apply dimmer to linked sliders
                          if (ow.type === 'slider' && (ow.linkedFunction === 'dimmer' || !ow.linkedFunction)) {
                            updateWidget(ow.id, { value: Math.round(entry.dimmer / 255 * 100) });
                          }
                          // Apply color to linked color wheels
                          if (ow.type === 'color-wheel' && entry.color) {
                            updateWidget(ow.id, { colorValue: entry.color });
                          }
                          // Apply pan/tilt to XY pads
                          if (ow.type === 'xy-pad' && (entry.pan !== undefined || entry.tilt !== undefined)) {
                            updateWidget(ow.id, { colorValue: { r: entry.pan ?? 128, g: entry.tilt ?? 128, b: 128 } });
                          }
                          // Apply strobe to strobe buttons
                          if (ow.type === 'button' && ow.linkedFunction === 'strobe' && entry.strobe) {
                            updateWidget(ow.id, { toggled: entry.strobe > 0 });
                          }
                        });
                      });
                    }
                  }}
                  onRelease={() => { }}
                  allWidgets={widgets}
                  fixtureData={fixturesWithDefs}
                />
              ))}

              {widgets.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground/40">
                  <SlidersHorizontal size={32} />
                  <span className="text-sm mt-2">Add widgets from the right panel</span>
                </div>
              )}
            </div>

            {/* Right panel — hidden in fullscreen */}
            {!isFullscreen && (
            <div className="w-72 border-l border-border/30 flex flex-col overflow-y-auto">
              <input ref={imgInputRef} type="file" accept="image/*" className="hidden" onChange={handleWidgetBgUpload} />

              {/* Audio Input */}
              <div className="p-3 border-b border-border/20 space-y-2">
                <span className="text-[9px] uppercase tracking-widest text-stokio-cyan font-semibold flex items-center gap-1">
                  <Mic size={10} /> Audio Input
                </span>
                <select value={audioConfig.source}
                  onChange={e => setAudioConfig(prev => ({ ...prev, source: e.target.value as AudioSource }))}
                  className="w-full h-7 rounded bg-muted/30 border border-border/30 text-[10px] px-2 text-foreground">
                  {AUDIO_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                {audioConfig.source !== 'none' && (
                  <div className="text-[8px] text-muted-foreground/60 bg-muted/10 rounded p-1.5">
                    {AUDIO_SOURCES.find(s => s.value === audioConfig.source)?.description}
                  </div>
                )}
                {audioConfig.source.startsWith('wled') && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <label className="text-[7px] uppercase text-muted-foreground">Squelch</label>
                      <Slider value={[audioConfig.squelch]} onValueChange={([v]) => setAudioConfig(prev => ({ ...prev, squelch: v }))} max={255} className="mt-1" />
                      <span className="text-[7px] font-mono text-muted-foreground/50">{audioConfig.squelch}</span>
                    </div>
                    <div>
                      <label className="text-[7px] uppercase text-muted-foreground">Gain</label>
                      <Slider value={[audioConfig.gain]} onValueChange={([v]) => setAudioConfig(prev => ({ ...prev, gain: v }))} max={255} className="mt-1" />
                      <span className="text-[7px] font-mono text-muted-foreground/50">{audioConfig.gain}</span>
                    </div>
                  </div>
                )}
                {audioConfig.source === 'wled-udp-sync' && (
                  <div>
                    <label className="text-[7px] uppercase text-muted-foreground">UDP Port</label>
                    <Input type="number" value={audioConfig.udpPort}
                      onChange={e => setAudioConfig(prev => ({ ...prev, udpPort: Number(e.target.value) }))}
                      className="h-6 text-[10px] bg-muted/20 border-border/20 font-mono" />
                  </div>
                )}
              </div>

              {/* BPM / Tap Tempo */}
              <div className="p-3 border-b border-border/20 space-y-2">
                <span className="text-[9px] uppercase tracking-widest text-stokio-pink font-semibold flex items-center gap-1">
                  <Activity size={10} /> BPM / Tap Tempo
                </span>
                <div className="flex items-center gap-2">
                  <motion.button whileTap={{ scale: 0.9 }} onClick={handleTap}
                    className="w-16 h-16 rounded-full control-glossy border-2 flex flex-col items-center justify-center transition-all"
                    style={{
                      borderColor: bpmState.flashOn ? '#ff2d78' : 'hsl(var(--border) / 0.3)',
                      boxShadow: bpmState.flashOn ? '0 0 25px #ff2d7860, inset 0 0 15px #ff2d7820' : 'none',
                      background: bpmState.flashOn ? 'radial-gradient(circle at center, #ff2d7815, transparent)' : undefined,
                    }}>
                    <span className="text-[8px] uppercase tracking-wider text-muted-foreground font-semibold">TAP</span>
                    <span className="text-xs font-bold text-primary font-mono">{bpmState.bpm}</span>
                  </motion.button>
                  <div className="flex-1 space-y-1">
                    <div className="text-lg font-bold font-mono text-foreground flex items-center gap-1">
                      {bpmState.bpm} <span className="text-[9px] text-muted-foreground font-normal">BPM</span>
                      {bpmState.isSynced && (
                        <motion.div className="w-2.5 h-2.5 rounded-full"
                          animate={{ backgroundColor: bpmState.flashOn ? '#ff2d78' : '#00ff66', boxShadow: bpmState.flashOn ? '0 0 10px #ff2d78' : '0 0 6px #00ff6660' }}
                          transition={{ duration: 0.05 }} />
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" className="h-5 text-[8px] px-1.5"
                        onClick={() => setBpmState(prev => ({ ...prev, bpm: Math.max(20, prev.bpm - 1) }))}>-1</Button>
                      <Button variant="outline" size="sm" className="h-5 text-[8px] px-1.5"
                        onClick={() => setBpmState(prev => ({ ...prev, bpm: Math.min(300, prev.bpm + 1) }))}>+1</Button>
                      <Button variant="outline" size="sm" className="h-5 text-[8px] px-1.5"
                        onClick={() => setBpmState(prev => ({ ...prev, tapTimes: [], isSynced: false }))}>Reset</Button>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-[7px] uppercase text-muted-foreground">Sync to Widgets</label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {widgets.map(w => {
                      const linked = bpmState.linkedWidgetIds.includes(w.id);
                      return (
                        <button key={w.id} onClick={() => toggleBpmWidgetLink(w.id)}
                          className={`text-[8px] px-1.5 py-0.5 rounded border transition-all ${
                            linked ? 'bg-stokio-pink/10 border-stokio-pink/30 text-stokio-pink' : 'border-border/20 text-muted-foreground hover:border-border/40'
                          }`}>{w.label}</button>
                      );
                    })}
                    {widgets.length === 0 && <span className="text-[8px] text-muted-foreground/40">No widgets</span>}
                  </div>
                </div>
              </div>

              {/* Add widget buttons */}
              <div className="p-3 border-b border-border/20 space-y-2">
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">Add Widget</span>
                <div className="grid grid-cols-2 gap-1">
                  {WIDGET_PRESETS.map(p => (
                    <button key={p.type} onClick={() => addWidget(p.type)}
                      className="flex flex-col items-center gap-1 p-2 rounded border border-border/20 hover:border-primary/30 hover:bg-primary/5 transition-all">
                      <p.icon size={14} className="text-muted-foreground" />
                      <span className="text-[8px] text-muted-foreground">{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Selected widget properties */}
              {selectedWidgetData && (
                <div className="p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] uppercase tracking-widest text-primary font-semibold">Properties</span>
                    <Button variant="ghost" size="sm" className="h-5 text-[8px] text-destructive" onClick={() => removeWidget(selectedWidgetData.id)}>
                      <Trash2 size={10} />
                    </Button>
                  </div>

                  <div>
                    <label className="text-[7px] uppercase text-muted-foreground">Label</label>
                    <Input value={selectedWidgetData.label}
                      onChange={e => updateWidget(selectedWidgetData.id, { label: e.target.value })}
                      className="h-6 text-[10px] bg-muted/20 border-border/20" />
                  </div>

                  <div>
                    <label className="text-[7px] uppercase text-muted-foreground">Background Color</label>
                    <div className="flex gap-1">
                      <Input type="color" value={selectedWidgetData.color}
                        onChange={e => updateWidget(selectedWidgetData.id, { color: e.target.value })}
                        className="h-6 w-10 p-0 bg-transparent border-0 cursor-pointer" />
                      <Input value={selectedWidgetData.color}
                        onChange={e => updateWidget(selectedWidgetData.id, { color: e.target.value })}
                        className="h-6 text-[10px] bg-muted/20 border-border/20 font-mono flex-1" />
                    </div>
                  </div>

                  <div>
                    <label className="text-[7px] uppercase text-muted-foreground">Background Image</label>
                    <div className="flex gap-1 mt-1">
                      <Button variant="outline" size="sm" className="h-6 text-[8px] gap-1 flex-1"
                        onClick={() => imgInputRef.current?.click()}>
                        <ImagePlus size={10} /> Upload
                      </Button>
                      {selectedWidgetData.bgImage && (
                        <Button variant="ghost" size="sm" className="h-6 text-[8px] text-destructive"
                          onClick={() => updateWidget(selectedWidgetData.id, { bgImage: null })}>
                          <X size={10} />
                        </Button>
                      )}
                    </div>
                    {selectedWidgetData.bgImage && (
                      <div className="mt-1 h-10 rounded border border-border/20 overflow-hidden">
                        <img src={selectedWidgetData.bgImage} alt="" className="w-full h-full object-cover" />
                      </div>
                    )}
                  </div>

                  {selectedWidgetData.bgImage && (
                    <div>
                      <label className="text-[7px] uppercase text-muted-foreground">Image Overlay Opacity</label>
                      <div className="flex items-center gap-2 mt-1">
                        <Slider value={[selectedWidgetData.bgOpacity ?? 70]}
                          onValueChange={([v]) => updateWidget(selectedWidgetData.id, { bgOpacity: v })}
                          max={100} className="flex-1" />
                        <span className="text-[8px] font-mono text-muted-foreground/60 w-8 text-right">{selectedWidgetData.bgOpacity ?? 70}%</span>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-1">
                    <div>
                      <label className="text-[7px] uppercase text-muted-foreground">X</label>
                      <Input type="number" value={Math.round(selectedWidgetData.x)}
                        onChange={e => updateWidget(selectedWidgetData.id, { x: Number(e.target.value) })}
                        className="h-6 text-[10px] bg-muted/20 border-border/20 font-mono" />
                    </div>
                    <div>
                      <label className="text-[7px] uppercase text-muted-foreground">Y</label>
                      <Input type="number" value={Math.round(selectedWidgetData.y)}
                        onChange={e => updateWidget(selectedWidgetData.id, { y: Number(e.target.value) })}
                        className="h-6 text-[10px] bg-muted/20 border-border/20 font-mono" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1">
                    <div>
                      <label className="text-[7px] uppercase text-muted-foreground">Width</label>
                      <Input type="number" value={selectedWidgetData.width}
                        onChange={e => updateWidget(selectedWidgetData.id, { width: Number(e.target.value) })}
                        className="h-6 text-[10px] bg-muted/20 border-border/20 font-mono" />
                    </div>
                    <div>
                      <label className="text-[7px] uppercase text-muted-foreground">Height</label>
                      <Input type="number" value={selectedWidgetData.height}
                        onChange={e => updateWidget(selectedWidgetData.id, { height: Number(e.target.value) })}
                        className="h-6 text-[10px] bg-muted/20 border-border/20 font-mono" />
                    </div>
                  </div>

                  <div>
                    <label className="text-[7px] uppercase text-muted-foreground flex items-center gap-1">
                      <Move size={9} /> Movement Axis Lock
                    </label>
                    <div className="flex gap-1 mt-1">
                      {(['none', 'x', 'y'] as const).map(axis => (
                        <button key={axis}
                          onClick={() => updateWidget(selectedWidgetData.id, { lockAxis: axis })}
                          className={`flex-1 h-6 rounded text-[9px] font-semibold border transition-all flex items-center justify-center gap-1 ${
                            selectedWidgetData.lockAxis === axis
                              ? 'bg-primary/10 border-primary/30 text-primary'
                              : 'border-border/20 text-muted-foreground hover:border-border/40'
                          }`}>
                          {axis === 'none' ? <><Unlock size={9} /> Free</> :
                           axis === 'x' ? <><Lock size={9} /> Lock Y</> :
                           <><Lock size={9} /> Lock X</>}
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedWidgetData.type === 'button' && (
                    <div className="space-y-2">
                      <div>
                        <label className="text-[7px] uppercase text-muted-foreground">Behavior</label>
                        <select value={selectedWidgetData.flash ? 'flash' : 'toggle'}
                          onChange={e => updateWidget(selectedWidgetData.id, { flash: e.target.value === 'flash' })}
                          className="w-full h-6 rounded bg-muted/20 border border-border/20 text-[10px] px-1 text-foreground">
                          <option value="flash">Flash (hold) · long-press to lock</option>
                          <option value="toggle">Toggle (click on/off)</option>
                        </select>
                      </div>
                      <div className="text-[8px] text-muted-foreground/50 bg-muted/10 rounded p-1.5">
                        {selectedWidgetData.flash
                          ? '💡 Click & hold = momentary flash. Long-press (0.5s) = lock ON/OFF.'
                          : '💡 Click to toggle on/off.'}
                      </div>
                    </div>
                  )}

                  {/* Preset Scene Config */}
                  {selectedWidgetData.type === 'preset' && (
                    <div className="space-y-2 border-t border-border/20 pt-2">
                      <label className="text-[8px] uppercase tracking-widest text-stokio-cyan font-semibold flex items-center gap-1">
                        <Settings2 size={10} /> Scene Configuration
                      </label>
                      <div className="text-[8px] text-muted-foreground/50 bg-muted/10 rounded p-1.5">
                        💡 Toggle mode: click to activate/deactivate all scene entries at once.
                      </div>

                      {/* Add fixture or group to scene */}
                      <div>
                        <label className="text-[7px] uppercase text-muted-foreground">Add to Scene</label>
                        <div className="space-y-1 mt-1">
                          {/* Individual fixtures */}
                          {fixturesWithDefs.length > 0 && (
                            <div>
                              <span className="text-[7px] text-muted-foreground/60">Fixtures:</span>
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {fixturesWithDefs.map(({ inst, def }) => {
                                  const inScene = selectedWidgetData.presetEntries?.some(e => e.targetId === inst.id && e.targetType === 'fixture');
                                  return (
                                    <button key={inst.id}
                                      onClick={() => {
                                        const entries = selectedWidgetData.presetEntries || [];
                                        if (inScene) {
                                          updateWidget(selectedWidgetData.id, { presetEntries: entries.filter(e => !(e.targetId === inst.id && e.targetType === 'fixture')) });
                                        } else {
                                          updateWidget(selectedWidgetData.id, { presetEntries: [...entries, { targetId: inst.id, targetType: 'fixture', dimmer: 255 }] });
                                        }
                                      }}
                                      className={`text-[8px] px-1.5 py-0.5 rounded border transition-all ${
                                        inScene ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border/20 text-muted-foreground hover:border-border/40'
                                      }`}>
                                      {getFixtureTypeIcon(def.type)} {inst.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {/* Groups */}
                          {groups.length > 0 && (
                            <div>
                              <span className="text-[7px] text-muted-foreground/60">Groups:</span>
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {groups.map(g => {
                                  const inScene = selectedWidgetData.presetEntries?.some(e => e.targetId === g.id && e.targetType === 'group');
                                  return (
                                    <button key={g.id}
                                      onClick={() => {
                                        const entries = selectedWidgetData.presetEntries || [];
                                        if (inScene) {
                                          updateWidget(selectedWidgetData.id, { presetEntries: entries.filter(e => !(e.targetId === g.id && e.targetType === 'group')) });
                                        } else {
                                          updateWidget(selectedWidgetData.id, { presetEntries: [...entries, { targetId: g.id, targetType: 'group', dimmer: 255 }] });
                                        }
                                      }}
                                      className={`text-[8px] px-1.5 py-0.5 rounded border transition-all flex items-center gap-1 ${
                                        inScene ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border/20 text-muted-foreground hover:border-border/40'
                                      }`}>
                                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: g.color }} />
                                      {g.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {/* WLED Fixtures */}
                          {fixturesWithDefs.filter(f => f.def.category === 'wled').length > 0 && (
                            <div>
                              <span className="text-[7px] text-muted-foreground/60">WLED Fixtures:</span>
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {fixturesWithDefs.filter(f => f.def.category === 'wled').map(({ inst, def }) => {
                                  const inScene = selectedWidgetData.presetEntries?.some(e => e.targetId === inst.id && e.targetType === 'wled');
                                  return (
                                    <button key={inst.id}
                                      onClick={() => {
                                        const entries = selectedWidgetData.presetEntries || [];
                                        if (inScene) {
                                          updateWidget(selectedWidgetData.id, { presetEntries: entries.filter(e => !(e.targetId === inst.id && e.targetType === 'wled')) });
                                        } else {
                                          updateWidget(selectedWidgetData.id, { presetEntries: [...entries, { targetId: inst.id, targetType: 'wled', dimmer: 255 }] });
                                        }
                                      }}
                                      className={`text-[8px] px-1.5 py-0.5 rounded border transition-all flex items-center gap-1 ${
                                        inScene ? 'bg-[#ff6600]/10 border-[#ff6600]/30 text-[#ff6600]' : 'border-border/20 text-muted-foreground hover:border-border/40'
                                      }`}>
                                      💡 {inst.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Scene entries detail */}
                      {(selectedWidgetData.presetEntries || []).length > 0 && (
                        <div className="space-y-1.5">
                          <label className="text-[7px] uppercase text-muted-foreground">Scene Values</label>
                          {(selectedWidgetData.presetEntries || []).map((entry, idx) => {
                            const isFixture = entry.targetType === 'fixture';
                            const isWled = entry.targetType === 'wled';
                            const wledDef = isWled ? fixturesWithDefs.find(f => f.inst.id === entry.targetId)?.def : null;
                            const name = isFixture
                              ? fixturesWithDefs.find(f => f.inst.id === entry.targetId)?.inst.name || entry.targetId
                              : isWled
                                ? fixturesWithDefs.find(f => f.inst.id === entry.targetId)?.inst.name || entry.targetId
                                : groups.find(g => g.id === entry.targetId)?.name || entry.targetId;
                            const icon = isFixture
                              ? getFixtureTypeIcon(fixturesWithDefs.find(f => f.inst.id === entry.targetId)?.def.type || 'other')
                              : isWled ? '💡' : '👥';
                            const updateEntry = (updates: Partial<PresetSceneEntry>) => {
                              const entries = [...(selectedWidgetData.presetEntries || [])];
                              entries[idx] = { ...entries[idx], ...updates };
                              updateWidget(selectedWidgetData.id, { presetEntries: entries });
                            };
                            return (
                              <div key={`${entry.targetType}-${entry.targetId}`} className="glass-panel p-2 rounded space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-[8px] font-semibold flex items-center gap-1">
                                    {icon} {name}
                                    <span className="text-[7px] text-muted-foreground/50 uppercase">{entry.targetType}</span>
                                  </span>
                                  <button onClick={() => {
                                    const entries = (selectedWidgetData.presetEntries || []).filter((_, i) => i !== idx);
                                    updateWidget(selectedWidgetData.id, { presetEntries: entries });
                                  }} className="text-muted-foreground hover:text-destructive"><X size={10} /></button>
                                </div>
                                {/* Dimmer */}
                                <div className="flex items-center gap-1">
                                  <label className="text-[7px] text-muted-foreground w-10">Dimmer</label>
                                  <Slider value={[entry.dimmer]} onValueChange={([v]) => updateEntry({ dimmer: v })} max={255} className="flex-1" />
                                  <span className="text-[7px] font-mono text-muted-foreground/50 w-6 text-right">{entry.dimmer}</span>
                                </div>
                                {/* Color */}
                                <div className="flex items-center gap-1">
                                  <label className="text-[7px] text-muted-foreground w-10">Color</label>
                                  <Input type="color"
                                    value={entry.color ? `#${entry.color.r.toString(16).padStart(2,'0')}${entry.color.g.toString(16).padStart(2,'0')}${entry.color.b.toString(16).padStart(2,'0')}` : '#ffffff'}
                                    onChange={e => {
                                      const hex = e.target.value;
                                      updateEntry({ color: { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) } });
                                    }}
                                    className="h-5 w-8 p-0 bg-transparent border-0 cursor-pointer" />
                                  <span className="text-[7px] font-mono text-muted-foreground/50">
                                    {entry.color ? `R${entry.color.r} G${entry.color.g} B${entry.color.b}` : 'None'}
                                  </span>
                                </div>
                                {/* Strobe */}
                                <div className="flex items-center gap-1">
                                  <label className="text-[7px] text-muted-foreground w-10">Strobe</label>
                                  <Slider value={[entry.strobe || 0]} onValueChange={([v]) => updateEntry({ strobe: v })} max={255} className="flex-1" />
                                  <span className="text-[7px] font-mono text-muted-foreground/50 w-6 text-right">{entry.strobe || 0}</span>
                                </div>
                                {/* Pan / Tilt */}
                                <div className="grid grid-cols-2 gap-1">
                                  <div className="flex items-center gap-1">
                                    <label className="text-[7px] text-muted-foreground">Pan</label>
                                    <Input type="number" min={0} max={255} value={entry.pan ?? ''}
                                      onChange={e => updateEntry({ pan: e.target.value ? Number(e.target.value) : undefined })}
                                      placeholder="—"
                                      className="h-5 text-[9px] bg-muted/20 border-border/20 font-mono px-1 flex-1" />
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <label className="text-[7px] text-muted-foreground">Tilt</label>
                                    <Input type="number" min={0} max={255} value={entry.tilt ?? ''}
                                      onChange={e => updateEntry({ tilt: e.target.value ? Number(e.target.value) : undefined })}
                                      placeholder="—"
                                      className="h-5 text-[9px] bg-muted/20 border-border/20 font-mono px-1 flex-1" />
                                  </div>
                                </div>
                                {/* WLED Preset selector */}
                                {isWled && wledDef?.wledConfig && (
                                  <div className="space-y-1 border-t border-border/10 pt-1.5 mt-1">
                                    <label className="text-[7px] text-[#ff6600] font-semibold uppercase">WLED Preset</label>
                                    <select
                                      value={entry.wledPresetId ?? ''}
                                      onChange={e => updateEntry({ wledPresetId: e.target.value ? Number(e.target.value) : undefined, wledPresetName: wledDef.wledConfig?.presets.find(p => p.id === Number(e.target.value))?.name })}
                                      className="w-full h-6 rounded bg-muted/20 border border-border/20 text-[9px] px-1 text-foreground">
                                      <option value="">Color only (no preset)</option>
                                      {(wledDef.wledConfig.presets || []).map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                      ))}
                                    </select>
                                    {(wledDef.wledConfig.presets || []).length === 0 && (
                                      <div className="text-[7px] text-muted-foreground/40">
                                        No presets loaded. Fetch them in Fixtures → WLED tab first.
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {(selectedWidgetData.presetEntries || []).length === 0 && (
                        <div className="text-[8px] text-muted-foreground/40 text-center py-3">
                          Add fixtures or groups above to build your preset scene
                        </div>
                      )}
                    </div>
                  )}

                  {/* Color Sync + MH for XY Pad */}
                  {selectedWidgetData.type === 'xy-pad' && (
                    <div className="space-y-2 border-t border-border/20 pt-2">
                      {/* Color Sync */}
                      <div>
                        <label className="text-[7px] uppercase text-muted-foreground">Sync Dot Color From Widget</label>
                        <select
                          value={selectedWidgetData.syncColorWidgetId || ''}
                          onChange={e => updateWidget(selectedWidgetData.id, { syncColorWidgetId: e.target.value || null })}
                          className="w-full h-6 rounded bg-muted/20 border border-border/20 text-[10px] px-1 text-foreground mt-1">
                          <option value="">None (default)</option>
                          {widgets.filter(w => (w.type === 'color-wheel' || w.type === 'fixed-color') && w.id !== selectedWidgetData.id).map(w => (
                            <option key={w.id} value={w.id}>🎨 {w.label}</option>
                          ))}
                        </select>
                        <div className="text-[8px] text-muted-foreground/50 bg-muted/10 rounded p-1.5 mt-1">
                          💡 Links the XY pad cursor color to a Color Wheel or Fixed Color widget.
                        </div>
                      </div>

                      <label className="text-[8px] uppercase tracking-widest text-stokio-cyan font-semibold">MH Movement Program</label>

                      {/* Pattern selector */}
                      <div>
                        <label className="text-[7px] uppercase text-muted-foreground">Pattern</label>
                        <select
                          value={selectedWidgetData.mhProgram?.pattern || 'circle'}
                          onChange={e => updateWidget(selectedWidgetData.id, {
                            mhProgram: {
                              ...(selectedWidgetData.mhProgram || { pattern: 'circle', speed: 50, size: 50, bpmSync: false, running: false, fixtureConfigs: [] }),
                              pattern: e.target.value as MHPattern,
                            },
                          })}
                          className="w-full h-6 rounded bg-muted/20 border border-border/20 text-[10px] px-1 text-foreground">
                          {MH_PATTERNS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                      </div>

                      {/* Speed & Size */}
                      <div className="grid grid-cols-2 gap-1">
                        <div>
                          <label className="text-[7px] uppercase text-muted-foreground">Speed</label>
                          <Slider value={[selectedWidgetData.mhProgram?.speed || 50]}
                            onValueChange={([v]) => updateWidget(selectedWidgetData.id, {
                              mhProgram: { ...(selectedWidgetData.mhProgram || { pattern: 'circle', speed: 50, size: 50, bpmSync: false, running: false, fixtureConfigs: [] }), speed: v },
                            })} max={100} className="mt-1" />
                          <span className="text-[7px] font-mono text-muted-foreground/50">{selectedWidgetData.mhProgram?.speed || 50}%</span>
                        </div>
                        <div>
                          <label className="text-[7px] uppercase text-muted-foreground">Size</label>
                          <Slider value={[selectedWidgetData.mhProgram?.size || 50]}
                            onValueChange={([v]) => updateWidget(selectedWidgetData.id, {
                              mhProgram: { ...(selectedWidgetData.mhProgram || { pattern: 'circle', speed: 50, size: 50, bpmSync: false, running: false, fixtureConfigs: [] }), size: v },
                            })} max={100} className="mt-1" />
                          <span className="text-[7px] font-mono text-muted-foreground/50">{selectedWidgetData.mhProgram?.size || 50}%</span>
                        </div>
                      </div>

                      {/* Controls */}
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant={selectedWidgetData.mhProgram?.running ? 'destructive' : 'default'}
                          className="h-6 text-[9px] gap-1 flex-1"
                          onClick={() => updateWidget(selectedWidgetData.id, {
                            mhProgram: { ...(selectedWidgetData.mhProgram || { pattern: 'circle', speed: 50, size: 50, bpmSync: false, running: false, fixtureConfigs: [] }),
                              running: !selectedWidgetData.mhProgram?.running },
                          })}>
                          {selectedWidgetData.mhProgram?.running ? <><Square size={9} /> Stop</> : <><Play size={9} /> Run</>}
                        </Button>
                        <Button size="sm" variant="outline" className={`h-6 text-[9px] gap-1 ${selectedWidgetData.mhProgram?.bpmSync ? 'bg-stokio-pink/10 text-stokio-pink border-stokio-pink/30' : ''}`}
                          onClick={() => updateWidget(selectedWidgetData.id, {
                            mhProgram: { ...(selectedWidgetData.mhProgram || { pattern: 'circle', speed: 50, size: 50, bpmSync: false, running: false, fixtureConfigs: [] }),
                              bpmSync: !selectedWidgetData.mhProgram?.bpmSync },
                          })}>
                          {selectedWidgetData.mhProgram?.bpmSync ? '🎵 BPM Sync ON' : '🎵 BPM Sync'}
                        </Button>
                      </div>

                      {/* Per-fixture configs: mirror, reverse, delay */}
                      <div className="border-t border-border/10 pt-2">
                        <label className="text-[7px] uppercase text-muted-foreground">Per-Fixture Settings</label>
                        <div className="space-y-1 mt-1">
                          {selectedWidgetData.linkedFixtureIds.map(fid => {
                            const inst = fixturesWithDefs.find(f => f.inst.id === fid);
                            if (!inst) return null;
                            const cfg = selectedWidgetData.mhProgram?.fixtureConfigs?.find(c => c.fixtureId === fid) || {
                              fixtureId: fid, reversePan: false, reverseTilt: false, mirrorPan: false, mirrorTilt: false, delayMs: 0,
                            };
                            const updateCfg = (updates: Partial<MHFixtureConfig>) => {
                              const existing = selectedWidgetData.mhProgram?.fixtureConfigs || [];
                              const updated = existing.find(c => c.fixtureId === fid)
                                ? existing.map(c => c.fixtureId === fid ? { ...c, ...updates } : c)
                                : [...existing, { ...cfg, ...updates }];
                              updateWidget(selectedWidgetData.id, {
                                mhProgram: { ...(selectedWidgetData.mhProgram || { pattern: 'circle', speed: 50, size: 50, bpmSync: false, running: false, fixtureConfigs: [] }),
                                  fixtureConfigs: updated },
                              });
                            };
                            return (
                              <div key={fid} className="glass-panel p-2 rounded space-y-1">
                                <div className="text-[8px] font-semibold flex items-center gap-1">
                                  <span>{getFixtureTypeIcon(inst.def.type)}</span> {inst.inst.name}
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {[
                                    { key: 'reversePan', label: '↔ Rev Pan', val: cfg.reversePan },
                                    { key: 'reverseTilt', label: '↕ Rev Tilt', val: cfg.reverseTilt },
                                    { key: 'mirrorPan', label: '🪞 Mirror Pan', val: cfg.mirrorPan },
                                    { key: 'mirrorTilt', label: '🪞 Mirror Tilt', val: cfg.mirrorTilt },
                                  ].map(opt => (
                                    <button key={opt.key}
                                      onClick={() => updateCfg({ [opt.key]: !opt.val })}
                                      className={`text-[7px] px-1.5 py-0.5 rounded border transition-all ${
                                        opt.val ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border/20 text-muted-foreground hover:border-border/40'
                                      }`}>{opt.label}</button>
                                  ))}
                                </div>
                                <div className="flex items-center gap-1">
                                  <label className="text-[7px] text-muted-foreground">Delay:</label>
                                  <Input type="number" min={0} step={50} value={cfg.delayMs}
                                    onChange={e => updateCfg({ delayMs: Number(e.target.value) })}
                                    className="h-5 w-16 text-[9px] bg-muted/20 border-border/20 font-mono px-1" />
                                  <span className="text-[7px] text-muted-foreground/50">ms</span>
                                </div>
                              </div>
                            );
                          })}
                          {selectedWidgetData.linkedFixtureIds.length === 0 && (
                            <div className="text-[8px] text-muted-foreground/40 text-center py-2">Link fixtures above to configure per-fixture MH settings</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Fixed Color Widget Config */}
                  {selectedWidgetData.type === 'fixed-color' && (
                    <div className="space-y-2 border-t border-border/20 pt-2">
                      <label className="text-[8px] uppercase tracking-widest text-stokio-cyan font-semibold flex items-center gap-1">
                        <CircleDot size={10} /> Fixed Color Config
                      </label>
                      <div>
                        <label className="text-[7px] uppercase text-muted-foreground">RGB Sync</label>
                        <div className="flex items-center gap-2 mt-1">
                          <button
                            onClick={() => updateWidget(selectedWidgetData.id, { rgbSyncEnabled: !selectedWidgetData.rgbSyncEnabled })}
                            className={`flex-1 h-6 rounded text-[9px] font-semibold border transition-all flex items-center justify-center gap-1 ${
                              selectedWidgetData.rgbSyncEnabled
                                ? 'bg-stokio-cyan/10 border-stokio-cyan/30 text-stokio-cyan'
                                : 'border-border/20 text-muted-foreground hover:border-border/40'
                            }`}>
                            {selectedWidgetData.rgbSyncEnabled ? '🔗 RGB Sync ON' : '🔗 RGB Sync OFF'}
                          </button>
                        </div>
                        {selectedWidgetData.rgbSyncEnabled && (
                          <div className="mt-1">
                            <label className="text-[7px] uppercase text-muted-foreground">Sync From Color Widget</label>
                            <select
                              value={selectedWidgetData.syncColorWidgetId || ''}
                              onChange={e => updateWidget(selectedWidgetData.id, { syncColorWidgetId: e.target.value || null })}
                              className="w-full h-6 rounded bg-muted/20 border border-border/20 text-[10px] px-1 text-foreground mt-0.5">
                              <option value="">Select widget...</option>
                              {widgets.filter(w => w.type === 'color-wheel' && w.id !== selectedWidgetData.id).map(w => (
                                <option key={w.id} value={w.id}>🎨 {w.label}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="text-[8px] text-muted-foreground/50 bg-muted/10 rounded p-1.5 mt-1">
                          💡 When RGB Sync is ON, incoming RGB color auto-selects the closest fixed color slot. Works with RGB DMX fixtures and WLED devices.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Also add RGB sync option on color-wheel widget for fixed-color fixtures */}
                  {selectedWidgetData.type === 'color-wheel' && (() => {
                    const hasFixedColorFixtures = selectedWidgetData.linkedFixtureIds.some(fid => {
                      const fd = fixturesWithDefs.find(f => f.inst.id === fid);
                      return fd?.def.colorSystem === 'color-wheel';
                    });
                    if (!hasFixedColorFixtures) return null;
                    return (
                      <div className="space-y-2 border-t border-border/20 pt-2">
                        <label className="text-[8px] uppercase tracking-widest text-stokio-pink font-semibold">Fixed Color Sync</label>
                        <div className="text-[8px] text-muted-foreground/50 bg-muted/10 rounded p-1.5">
                          💡 Linked fixtures with fixed color wheels will auto-match to the closest color slot when you pick an RGB color.
                        </div>
                      </div>
                    );
                  })()}

                  {/* Link fixtures — individual */}
                  <div>
                    <label className="text-[7px] uppercase text-muted-foreground">Linked Fixtures</label>
                    <div className="space-y-0.5 mt-1">
                      {fixturesWithDefs.map(({ inst, def }) => {
                        const linked = selectedWidgetData.linkedFixtureIds.includes(inst.id);
                        return (
                          <button key={inst.id}
                            onClick={() => updateWidget(selectedWidgetData.id, {
                              linkedFixtureIds: linked
                                ? selectedWidgetData.linkedFixtureIds.filter(id => id !== inst.id)
                                : [...selectedWidgetData.linkedFixtureIds, inst.id],
                            })}
                            className={`w-full flex items-center gap-1.5 p-1 rounded text-[9px] transition-all ${
                              linked ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/20'
                            }`}>
                            <span>{getFixtureTypeIcon(def.type)}</span>
                            <span>{inst.name}</span>
                            {linked && <span className="ml-auto text-[7px]">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Link by group */}
                  {groups.length > 0 && (
                    <div>
                      <label className="text-[7px] uppercase text-muted-foreground">Link Group</label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {groups.map(g => (
                          <button key={g.id} onClick={() => linkGroupToWidget(g.id)}
                            className="text-[8px] px-2 py-0.5 rounded border border-border/20 hover:border-primary/30 hover:bg-primary/5 transition-all flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: g.color }} />
                            {g.name} ({g.fixtureIds.length})
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Media Trigger properties */}
                  {selectedWidgetData.type === 'media-trigger' && (
                    <div className="p-3 border-t border-border/20 space-y-2">
                      <label className="text-[8px] uppercase tracking-widest text-stokio-cyan font-semibold">Media Link</label>
                      <div>
                        <label className="text-[7px] uppercase text-muted-foreground">Trigger Video</label>
                        <select value={selectedWidgetData.mediaItemId || ''}
                          onChange={e => updateWidget(selectedWidgetData.id, {
                            mediaItemId: e.target.value || null,
                            mediaPlaylistId: e.target.value ? null : selectedWidgetData.mediaPlaylistId,
                          })}
                          className="w-full h-7 rounded bg-muted/30 border border-border/30 text-[10px] px-2 text-foreground mt-1">
                          <option value="">— None —</option>
                          {useMediaStore.getState().items.map(item => (
                            <option key={item.id} value={item.id}>🎬 {item.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[7px] uppercase text-muted-foreground">Trigger Playlist</label>
                        <select value={selectedWidgetData.mediaPlaylistId || ''}
                          onChange={e => updateWidget(selectedWidgetData.id, {
                            mediaPlaylistId: e.target.value || null,
                            mediaItemId: e.target.value ? null : selectedWidgetData.mediaItemId,
                          })}
                          className="w-full h-7 rounded bg-muted/30 border border-border/30 text-[10px] px-2 text-foreground mt-1">
                          <option value="">— None —</option>
                          {useMediaStore.getState().playlists.map(pl => (
                            <option key={pl.id} value={pl.id}>📋 {pl.name} ({pl.itemIds.length} items)</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[7px] uppercase text-muted-foreground">Play Mode</label>
                        <select value={selectedWidgetData.mediaPlayMode || 'loop'}
                          onChange={e => updateWidget(selectedWidgetData.id, { mediaPlayMode: e.target.value as any })}
                          className="w-full h-7 rounded bg-muted/30 border border-border/30 text-[10px] px-2 text-foreground mt-1">
                          <option value="play-once">Play Once (1×)</option>
                          <option value="loop">Loop (🔁)</option>
                          <option value="loop-random">Loop Random (🔀)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[7px] uppercase text-muted-foreground">Trigger Type</label>
                        <div className="flex gap-1 mt-1">
                          <button onClick={() => updateWidget(selectedWidgetData.id, { mediaFlash: false })}
                            className={`flex-1 h-7 text-[9px] rounded border font-semibold transition-all ${
                              !(selectedWidgetData.mediaFlash) ? 'bg-primary/10 text-primary border-primary/30' : 'text-muted-foreground border-border/30 hover:text-foreground'
                            }`}>Toggle</button>
                          <button onClick={() => updateWidget(selectedWidgetData.id, { mediaFlash: true })}
                            className={`flex-1 h-7 text-[9px] rounded border font-semibold transition-all ${
                              selectedWidgetData.mediaFlash ? 'bg-stokio-pink/10 text-stokio-pink border-stokio-pink/30' : 'text-muted-foreground border-border/30 hover:text-foreground'
                            }`}>Flash (Hold)</button>
                        </div>
                      </div>
                      <div className="text-[8px] text-muted-foreground/50 bg-muted/10 rounded p-1.5">
                        💡 Toggle: click to play/stop. Flash: hold to play, release to stop.
                      </div>
                    </div>
                  )}

                  {/* VFX Widget Config */}
                  {selectedWidgetData.type === 'vfx' && (
                    <div className="space-y-2 border-t border-border/20 pt-2">
                      <label className="text-[8px] uppercase tracking-widest font-semibold flex items-center gap-1" style={{ color: '#aa44ff' }}>
                        <Sparkles size={10} /> Audio VFX Config
                      </label>
                      <div>
                        <label className="text-[7px] uppercase text-muted-foreground">Visualizer Preset</label>
                        <select value={selectedWidgetData.vfxPreset || 'plasma-wave'}
                          onChange={e => updateWidget(selectedWidgetData.id, { vfxPreset: e.target.value as VisualizerPreset })}
                          className="w-full h-7 rounded bg-muted/30 border border-border/30 text-[10px] px-2 text-foreground mt-1">
                          {(Object.entries(PRESET_LABELS) as [VisualizerPreset, string][]).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant={selectedWidgetData.vfxRunning ? 'destructive' : 'default'}
                          className="h-7 text-[10px] gap-1 flex-1"
                          onClick={() => updateWidget(selectedWidgetData.id, { vfxRunning: !selectedWidgetData.vfxRunning })}>
                          {selectedWidgetData.vfxRunning ? <><Square size={10} /> Stop</> : <><Play size={10} /> Start</>}
                        </Button>
                      </div>
                      <div className="text-[8px] text-muted-foreground/50 bg-muted/10 rounded p-1.5">
                        💡 Audio VFX renders Winamp-style visualizations driven by microphone input. Choose a preset and hit Start.
                      </div>
                    </div>
                  )}

                  {/* WLED Preset Widget Config */}
                  {selectedWidgetData.type === 'wled-preset' && (
                    <div className="space-y-2 border-t border-border/20 pt-2">
                      <label className="text-[8px] uppercase tracking-widest font-semibold flex items-center gap-1" style={{ color: '#ff6600' }}>
                        <Wifi size={10} /> WLED Device Config
                      </label>
                      <div>
                        <label className="text-[7px] uppercase text-muted-foreground">WLED IP Address</label>
                        <Input value={selectedWidgetData.wledIp || ''}
                          onChange={e => updateWidget(selectedWidgetData.id, { wledIp: e.target.value })}
                          className="h-7 text-[10px] bg-muted/30 border-border/30 font-mono"
                          placeholder="192.168.1.100" />
                      </div>
                      <Button variant="outline" size="sm" className="w-full h-7 text-[10px] gap-1"
                        onClick={() => {
                          const mockPresets = [
                            { id: 1, name: 'Rainbow' }, { id: 2, name: 'Fire' }, { id: 3, name: 'Ocean' },
                            { id: 4, name: 'Forest' }, { id: 5, name: 'Twinkle' }, { id: 6, name: 'Meteor' },
                            { id: 7, name: 'Breathe' }, { id: 8, name: 'Scanner' }, { id: 9, name: 'Chase' },
                            { id: 10, name: 'Fireworks' }, { id: 11, name: 'Sunrise' }, { id: 12, name: 'Party' },
                          ];
                          updateWidget(selectedWidgetData.id, { wledPresets: mockPresets });
                        }}>
                        <Wifi size={10} /> Fetch Presets from Device
                      </Button>
                      {(selectedWidgetData.wledPresets || []).length > 0 && (
                        <div className="text-[8px] text-muted-foreground/50">
                          {selectedWidgetData.wledPresets!.length} presets loaded
                        </div>
                      )}
                      <div className="text-[8px] text-muted-foreground/50 bg-muted/10 rounded p-1.5">
                        💡 Enter your WLED device IP and fetch presets. Click a preset on the widget to activate it via WLED JSON API.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!selectedWidgetData && (
                <div className="flex-1 flex items-center justify-center text-[10px] text-muted-foreground/40 p-4 text-center">
                  Select a widget to edit its properties
                </div>
              )}
            </div>
            )}
          </div>
        </div>
      )}

      {/* ── GROUPS TAB ── */}
      {tab === 'groups' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1">
              <Users size={12} /> Fixture Groups
            </div>
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={addGroup}>
              <Plus size={12} /> New Group
            </Button>
          </div>

          <div className="glass-panel p-3 mb-3">
            <div className="text-[9px] text-muted-foreground">
              Create pre-made groups of fixtures and WLED devices. Use groups to quickly link multiple fixtures to controller widgets, scripts, or scenes.
            </div>
          </div>

          {groups.map(group => (
            <div key={group.id} className="glass-panel border border-border/20 rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 p-3 border-b border-border/10">
                <div className="w-4 h-4 rounded-full border border-border/30" style={{ backgroundColor: group.color }} />
                <Input value={group.name}
                  onChange={e => updateGroup(group.id, { name: e.target.value })}
                  className="h-6 text-xs bg-transparent border-0 font-semibold flex-1 p-0 focus-visible:ring-0" />
                <Input type="color" value={group.color}
                  onChange={e => updateGroup(group.id, { color: e.target.value })}
                  className="h-6 w-8 p-0 bg-transparent border-0 cursor-pointer" />
                <Button variant="ghost" size="sm" className="h-6 text-[8px] text-destructive" onClick={() => deleteGroup(group.id)}>
                  <Trash2 size={10} />
                </Button>
              </div>
              <div className="p-3 space-y-1">
                <span className="text-[8px] text-muted-foreground uppercase">
                  {group.fixtureIds.length} fixture(s) selected
                </span>
                <div className="grid grid-cols-2 gap-1">
                  {fixturesWithDefs.map(({ inst, def }) => {
                    const inGroup = group.fixtureIds.includes(inst.id);
                    return (
                      <button key={inst.id}
                        onClick={() => toggleGroupFixture(group.id, inst.id)}
                        className={`flex items-center gap-1.5 p-1.5 rounded text-[9px] border transition-all ${
                          inGroup
                            ? 'border-primary/30 bg-primary/10 text-primary'
                            : 'border-border/15 text-muted-foreground hover:border-border/30 hover:bg-muted/10'
                        }`}>
                        <span>{getFixtureTypeIcon(def.type)}</span>
                        <span className="truncate">{inst.name}</span>
                        {inGroup && <span className="ml-auto">✓</span>}
                      </button>
                    );
                  })}
                </div>
                {fixturesWithDefs.length === 0 && (
                  <div className="text-[9px] text-muted-foreground/50 text-center py-2">No fixtures available — add them in Devices first</div>
                )}
              </div>
            </div>
          ))}

          {groups.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Users size={24} className="text-muted-foreground/30 mb-2" />
              <span className="text-sm">No groups yet</span>
              <span className="text-[10px] text-muted-foreground/50 mt-1">Create a group to organize fixtures together</span>
            </div>
          )}
        </div>
      )}

      {/* ── ASSIGNMENTS TAB ── */}
      {tab === 'assignments' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="glass-panel p-3 space-y-1 mb-4">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">Control Mode Legend</div>
            <div className="flex gap-4">
              <div className="flex items-center gap-1.5">
                <Monitor size={12} className="text-stokio-cyan" />
                <span className="text-[9px] text-muted-foreground"><strong className="text-stokio-cyan">VIDEO</strong> — Controlled by stage builder video matrix-mapping</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Hand size={12} className="text-stokio-pink" />
                <span className="text-[9px] text-muted-foreground"><strong className="text-stokio-pink">BUTTONS</strong> — Manual control via controller widgets</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Layers size={12} className="text-primary" />
                <span className="text-[9px] text-muted-foreground"><strong className="text-primary">BOTH</strong> — Video background + button override while pressed/scripted</span>
              </div>
            </div>
          </div>

          {fixturesWithDefs.map(({ inst, def }) => {
            const assignment = getAssignment(inst.id);
            const mode = assignment?.mode || 'buttons';
            return (
              <div key={inst.id} className="glass-panel p-3 flex items-center gap-3">
                <span className="text-lg">{getFixtureTypeIcon(def.type)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold">{inst.name}</div>
                  <div className="text-[9px] text-muted-foreground">{def.manufacturer} {def.model} — {def.colorSystem.toUpperCase()}</div>
                </div>
                <ModeBadge mode={mode} />
                <div className="flex rounded-lg overflow-hidden border border-border/20">
                  {(['video', 'buttons', 'both'] as ControlMode[]).map(m => (
                    <button key={m} onClick={() => setAssignmentMode(inst.id, m)}
                      className={`px-3 py-1.5 text-[9px] uppercase font-semibold transition-all ${
                        mode === m
                          ? m === 'video' ? 'bg-stokio-cyan/20 text-stokio-cyan' : m === 'buttons' ? 'bg-stokio-pink/20 text-stokio-pink' : 'bg-primary/20 text-primary'
                          : 'text-muted-foreground/50 hover:text-muted-foreground'
                      }`}>
                      <ModeIcon mode={m} />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          {fixturesWithDefs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <span className="text-sm">No fixtures patched</span>
              <span className="text-[10px] text-muted-foreground/50 mt-1">Go to Devices to add fixtures first</span>
            </div>
          )}
        </div>
      )}

      {/* ── SCRIPTS TAB ── */}
      {tab === 'scripts' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">Script Builder</div>
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={addScript}>
              <Plus size={12} /> New Script
            </Button>
          </div>

          <div className="glass-panel p-3 mb-3">
            <div className="text-[9px] text-muted-foreground">
              Scripts are step-based sequences (like QLC+ functions). Each step sets a fixture property and waits a specified duration before the next step.
              Link fixtures to a script, then run it — steps execute in order. Enable <strong>Loop</strong> for continuous playback.
            </div>
          </div>

          {scripts.map(script => (
            <ScriptEditor
              key={script.id}
              script={script}
              onUpdate={updated => setScripts(prev => prev.map(s => s.id === updated.id ? updated : s))}
              onDelete={() => setScripts(prev => prev.filter(s => s.id !== script.id))}
              fixtures={fixturesWithDefs}
            />
          ))}

          {scripts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <span className="text-sm">No scripts yet</span>
              <span className="text-[10px] text-muted-foreground/50 mt-1">Create a script to automate fixture sequences</span>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
