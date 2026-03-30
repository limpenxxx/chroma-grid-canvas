import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, Play, Square, GripVertical, Palette, SlidersHorizontal,
  Zap, ChevronDown, ChevronRight, Monitor, Hand, Layers,
  Speaker, X, Save, Mic, Activity,
  ImagePlus, Lock, Unlock, Move, FolderOpen, Download, Upload, FileText, Users,
  Bookmark, Settings2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  useFixtureStore, type FixtureInstance, type FixtureDefinition,
  getFixtureTypeIcon,
} from '@/store/fixtureStore';
import stokioLogo from '@/assets/stokio-logo-color.png';

// ── Types ──

type ControlMode = 'video' | 'buttons' | 'both';

interface FixtureAssignment {
  instanceId: string;
  mode: ControlMode;
}

type WidgetType = 'button' | 'slider' | 'color-wheel' | 'xy-pad' | 'preset';

// ── Preset Scene Entry ──
interface PresetSceneEntry {
  targetId: string; // fixture instance ID or group ID
  targetType: 'fixture' | 'group';
  dimmer: number; // 0-255
  color?: { r: number; g: number; b: number };
  strobe?: number; // 0-255
  pan?: number;
  tilt?: number;
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
];

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
  widget, isSelected, onSelect, onUpdate, onPress, onRelease,
}: {
  widget: DJWidget;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<DJWidget>) => void;
  onPress: () => void;
  onRelease: () => void;
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

  // Button: short click = flash/toggle, long press in flash mode = lock toggle
  const handleButtonDown = () => {
    if (widget.flash) {
      setIsPressed(true); onPress();
      longPressTimer.current = setTimeout(() => {
        onUpdate({ toggled: !widget.toggled });
        longPressTimer.current = null;
      }, LONG_PRESS_MS);
    } else {
      const ns = !widget.toggled;
      onUpdate({ toggled: ns }); setIsPressed(ns);
      if (ns) onPress(); else onRelease();
    }
  };
  const handleButtonUp = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    if (widget.flash) { setIsPressed(false); onRelease(); }
  };
  const isButtonActive = widget.flash ? (isPressed || !!widget.toggled) : !!widget.toggled;

  return (
    <div className={`absolute select-none group transition-shadow ${isSelected ? 'ring-1 ring-primary/60 z-30' : 'z-10'} ${interacting ? 'z-50' : ''}`}
      style={{ left: widget.x, top: widget.y, width: widget.width, height: widget.height }}>

      {/* Top drag handle */}
      <div className="absolute -top-1 left-2 right-2 h-5 z-40 cursor-grab active:cursor-grabbing flex items-center justify-center rounded-t"
        onMouseDown={e => startInteraction(e, 'move')}>
        <GripVertical size={10} className="text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
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
          {!widget.bgImage && <div className="absolute inset-0 rounded-lg opacity-15" style={{ backgroundColor: widget.color }} />}
          {isButtonActive && <div className="absolute inset-0 rounded-lg" style={{ background: `radial-gradient(circle at center, ${widget.color}30, transparent)` }} />}
          <Zap size={Math.min(widget.width, widget.height) * 0.25} style={{ color: widget.color }} className="relative z-10" />
          <span className="text-muted-foreground font-semibold truncate px-1 relative z-10"
            style={{ fontSize: Math.max(8, Math.min(14, widget.width * 0.12)) }}>{widget.label}</span>
          {!widget.flash && <div className={`absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full transition-all ${widget.toggled ? 'bg-primary shadow-[0_0_6px_hsl(var(--primary))]' : 'bg-muted-foreground/20'}`} />}
          {widget.flash && widget.toggled && <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[7px] text-primary font-bold uppercase tracking-wider">LOCKED</div>}
        </div>
      )}

      {/* SLIDER */}
      {widget.type === 'slider' && (
        <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col items-center justify-center p-3 gap-1 overflow-hidden" style={bgStyle}>
          <span className="text-muted-foreground font-semibold truncate" style={{ fontSize: Math.max(8, Math.min(12, widget.width * 0.14)) }}>{widget.label}</span>
          <div className="flex-1 w-10 rounded fader-track border border-border/20 relative">
            <motion.div className="absolute bottom-0 left-0 w-full rounded-b" style={{ backgroundColor: widget.color + '60' }} animate={{ height: `${widget.value || 0}%` }} />
            <input type="range" min={0} max={100} value={widget.value || 0} onChange={e => onUpdate({ value: Number(e.target.value) })}
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
              const rect = e.currentTarget.getBoundingClientRect();
              const x = Math.round(((e.clientX - rect.left) / rect.width) * 255);
              const y = Math.round(((e.clientY - rect.top) / rect.height) * 255);
              onUpdate({ colorValue: { r: x, g: y, b: 128 } });
            }}>
            <div className="absolute left-1/2 top-0 w-px h-full bg-border/20" />
            <div className="absolute top-1/2 left-0 w-full h-px bg-border/20" />
            {widget.colorValue && (
              <div className="absolute w-4 h-4 rounded-full bg-primary border border-foreground -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${(widget.colorValue.r / 255) * 100}%`, top: `${(widget.colorValue.g / 255) * 100}%`, boxShadow: '0 0 10px hsl(var(--primary))' }} />
            )}
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
          {!widget.bgImage && <div className="absolute inset-0 rounded-lg opacity-15" style={{ backgroundColor: widget.color }} />}
          {isButtonActive && <div className="absolute inset-0 rounded-lg" style={{ background: `radial-gradient(circle at center, ${widget.color}30, transparent)` }} />}
          <Bookmark size={Math.min(widget.width, widget.height) * 0.2} style={{ color: widget.color }} className="relative z-10" />
          <span className="text-muted-foreground font-semibold truncate px-1 relative z-10"
            style={{ fontSize: Math.max(8, Math.min(14, widget.width * 0.12)) }}>{widget.label}</span>
          <div className={`absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full transition-all ${widget.toggled ? 'bg-primary shadow-[0_0_6px_hsl(var(--primary))]' : 'bg-muted-foreground/20'}`} />
          {(widget.presetEntries?.length || 0) > 0 && (
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[7px] text-muted-foreground/50 z-10">
              {widget.presetEntries!.length} scene(s)
            </span>
          )}
        </div>
      )}
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
  const surfaceRef = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
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
    }]);
  };

  const removeWidget = (id: string) => {
    setWidgets(prev => prev.filter(w => w.id !== id));
    if (selectedWidget === id) setSelectedWidget(null);
  };

  const handleWidgetBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedWidget) return;
    const reader = new FileReader();
    reader.onload = () => updateWidget(selectedWidget, { bgImage: reader.result as string });
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ── Page management ──
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
      {/* Header */}
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
        </div>
      </div>

      {/* ── Save Dialog ── */}
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
      {tab === 'controller' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Page tabs */}
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/20 bg-card/30">
            <span className="text-[8px] uppercase tracking-widest text-muted-foreground/50 mr-1">Pages:</span>
            {pages.map((page, idx) => (
              <div key={page.id} className="flex items-center">
                <button
                  onClick={() => setActivePageId(page.id)}
                  onDoubleClick={() => {
                    const name = prompt('Rename page:', page.name);
                    if (name) renamePage(page.id, name);
                  }}
                  className={`px-3 py-1 text-[10px] font-semibold rounded-t transition-all ${
                    activePageId === page.id
                      ? 'bg-primary/10 text-primary border border-primary/30 border-b-0'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/20'
                  }`}
                >
                  {page.name}
                </button>
                {pages.length > 1 && activePageId === page.id && (
                  <button onClick={() => deletePage(page.id)} className="ml-0.5 text-muted-foreground/40 hover:text-destructive">
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
            <button onClick={addPage}
              className="px-2 py-1 text-[10px] text-muted-foreground hover:text-primary border border-dashed border-border/20 hover:border-primary/30 rounded transition-all">
              <Plus size={10} />
            </button>
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
                  onPress={() => { }}
                  onRelease={() => { }}
                />
              ))}

              {widgets.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground/40">
                  <SlidersHorizontal size={32} />
                  <span className="text-sm mt-2">Add widgets from the right panel</span>
                </div>
              )}
            </div>

            {/* Right panel */}
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

                  {/* MH Movement Programs (XY Pad only) */}
                  {selectedWidgetData.type === 'xy-pad' && (
                    <div className="space-y-2 border-t border-border/20 pt-2">
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
                </div>
              )}

              {!selectedWidgetData && (
                <div className="flex-1 flex items-center justify-center text-[10px] text-muted-foreground/40 p-4 text-center">
                  Select a widget to edit its properties
                </div>
              )}
            </div>
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
