import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, Play, Pause, Square, GripVertical, Palette, SlidersHorizontal,
  Zap, Copy, Settings, ChevronDown, ChevronRight, Monitor, Hand, Layers,
  Speaker, SkipForward, X, Save, Edit2, Mic, Radio, Activity, Music
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  useFixtureStore, type FixtureInstance, type FixtureDefinition,
  getFixtureTypeIcon,
} from '@/store/fixtureStore';

// ── Types ──

type ControlMode = 'video' | 'buttons' | 'both';

interface FixtureAssignment {
  instanceId: string;
  mode: ControlMode;
}

type WidgetType = 'button' | 'slider' | 'color-wheel' | 'xy-pad';

// ── Audio / BPM Types ──
type AudioSource = 'none' | 'wled-analog' | 'wled-i2s-inmp441' | 'wled-i2s-max98357' | 'wled-i2s-sph0645' | 'wled-udp-sync' | 'browser-mic';

interface AudioConfig {
  source: AudioSource;
  squelch: number;    // noise gate 0-255
  gain: number;       // input gain 0-255
  udpPort: number;    // WLED UDP sync port
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
  { value: 'browser-mic', label: 'Browser Microphone', description: 'Use this device\'s microphone via Web Audio API' },
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
  // Button-specific
  flash?: boolean; // true = only active while pressed
  // Slider-specific
  value?: number;
  min?: number;
  max?: number;
  // Color wheel
  colorValue?: { r: number; g: number; b: number };
  // Linked fixtures
  linkedFixtureIds: string[];
  // Linked channel function
  linkedFunction?: string;
}

interface ScriptStep {
  id: string;
  type: 'set-color' | 'set-dimmer' | 'set-position' | 'wait' | 'fade';
  params: Record<string, number | string>;
  duration: number; // ms
}

interface DJScript {
  id: string;
  name: string;
  steps: ScriptStep[];
  loop: boolean;
  linkedFixtureIds: string[];
}

type Tab = 'controller' | 'assignments' | 'scripts';

// ── Constants ──

const WIDGET_PRESETS: { type: WidgetType; label: string; icon: typeof Zap; w: number; h: number }[] = [
  { type: 'button', label: 'Flash Button', icon: Zap, w: 80, h: 80 },
  { type: 'slider', label: 'Fader', icon: SlidersHorizontal, w: 60, h: 160 },
  { type: 'color-wheel', label: 'Color Pick', icon: Palette, w: 120, h: 120 },
  { type: 'xy-pad', label: 'XY Pad', icon: Plus, w: 140, h: 140 },
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

// ── Draggable Widget ──

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
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPressed, setIsPressed] = useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) return; // right click
    onSelect();
    // Check if grip handle area (top 16px)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relY = e.clientY - rect.top;
    if (relY <= 18) {
      dragRef.current = { startX: e.clientX, startY: e.clientY, origX: widget.x, origY: widget.y };
      setIsDragging(true);
      e.preventDefault();
    }
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    onUpdate({
      x: Math.max(0, dragRef.current.origX + dx),
      y: Math.max(0, dragRef.current.origY + dy),
    });
  }, [onUpdate]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  // Attach global listeners when dragging
  useState(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  });

  return (
    <div
      className={`absolute select-none transition-shadow ${isSelected ? 'ring-1 ring-primary/50' : ''} ${isDragging ? 'z-50' : 'z-10'}`}
      style={{ left: widget.x, top: widget.y, width: widget.width, height: widget.height }}
      onMouseDown={handleMouseDown}
    >
      {/* Drag handle */}
      <div className="absolute -top-0.5 left-0 right-0 h-4 flex items-center justify-center cursor-grab active:cursor-grabbing">
        <GripVertical size={10} className="text-muted-foreground/40" />
      </div>

      {/* Widget body */}
      {widget.type === 'button' && (
        <motion.button
          className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col items-center justify-center gap-1 transition-all"
          style={{
            borderColor: isPressed ? widget.color : undefined,
            boxShadow: isPressed ? `0 0 20px ${widget.color}40, inset 0 0 15px ${widget.color}20` : undefined,
            background: isPressed ? `radial-gradient(circle at center, ${widget.color}15, transparent)` : undefined,
          }}
          whileTap={{ scale: 0.95 }}
          onMouseDown={() => { setIsPressed(true); onPress(); }}
          onMouseUp={() => { setIsPressed(false); onRelease(); }}
          onMouseLeave={() => { if (isPressed) { setIsPressed(false); onRelease(); } }}
        >
          <Zap size={16} style={{ color: widget.color }} />
          <span className="text-[8px] text-muted-foreground font-semibold truncate px-1">{widget.label}</span>
        </motion.button>
      )}

      {widget.type === 'slider' && (
        <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col items-center justify-center p-2 gap-1">
          <span className="text-[7px] text-muted-foreground font-semibold truncate">{widget.label}</span>
          <div className="flex-1 w-8 rounded fader-track border border-border/20 relative">
            <motion.div
              className="absolute bottom-0 left-0 w-full rounded-b"
              style={{ backgroundColor: widget.color + '60' }}
              animate={{ height: `${widget.value || 0}%` }}
            />
            <input
              type="range" min={0} max={100} value={widget.value || 0}
              onChange={e => onUpdate({ value: Number(e.target.value) })}
              className="absolute inset-0 w-full h-full opacity-0 cursor-ns-resize"
              style={{ writingMode: 'vertical-lr', direction: 'rtl' } as React.CSSProperties}
            />
          </div>
          <span className="text-[8px] font-mono text-muted-foreground">{widget.value || 0}%</span>
        </div>
      )}

      {widget.type === 'color-wheel' && (
        <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col items-center justify-center p-2 gap-1">
          <span className="text-[7px] text-muted-foreground font-semibold truncate">{widget.label}</span>
          <div className="flex-1 flex items-center justify-center">
            <div
              className="rounded-full border-2 border-border/30 cursor-pointer"
              style={{
                width: Math.min(widget.width, widget.height) - 30,
                height: Math.min(widget.width, widget.height) - 30,
                background: `conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)`,
              }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left - rect.width / 2;
                const y = e.clientY - rect.top - rect.height / 2;
                const hue = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
                // Simple HSV→RGB at full sat
                const c = 1, xx = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = 0;
                let r = 0, g = 0, b = 0;
                if (hue < 60) { r = c; g = xx; } else if (hue < 120) { r = xx; g = c; }
                else if (hue < 180) { g = c; b = xx; } else if (hue < 240) { g = xx; b = c; }
                else if (hue < 300) { r = xx; b = c; } else { r = c; b = xx; }
                onUpdate({ colorValue: { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) } });
              }}
            >
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

      {widget.type === 'xy-pad' && (
        <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col items-center p-2 gap-1">
          <span className="text-[7px] text-muted-foreground font-semibold truncate">{widget.label}</span>
          <div className="flex-1 w-full relative border border-border/20 rounded cursor-crosshair"
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = Math.round(((e.clientX - rect.left) / rect.width) * 255);
              const y = Math.round(((e.clientY - rect.top) / rect.height) * 255);
              onUpdate({ colorValue: { r: x, g: y, b: 128 } }); // reusing colorValue for pan/tilt
            }}
          >
            <div className="absolute left-1/2 top-0 w-px h-full bg-border/20" />
            <div className="absolute top-1/2 left-0 w-full h-px bg-border/20" />
            {widget.colorValue && (
              <div className="absolute w-3 h-3 rounded-full bg-primary border border-foreground -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: `${(widget.colorValue.r / 255) * 100}%`,
                  top: `${(widget.colorValue.g / 255) * 100}%`,
                  boxShadow: '0 0 8px hsl(var(--primary))',
                }} />
            )}
            <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[6px] text-muted-foreground/40">PAN</span>
            <span className="absolute left-0.5 top-1/2 -translate-y-1/2 text-[6px] text-muted-foreground/40 -rotate-90">TILT</span>
          </div>
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
              {/* Controls */}
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

              {/* Linked fixtures */}
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

              {/* Steps timeline */}
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

                    {(step.type === 'wait' || step.type === 'fade') && (
                      <div className="flex-1" />
                    )}

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

// ── Main LIVE DJ Component ──

export function LiveDJ() {
  const store = useFixtureStore();
  const [tab, setTab] = useState<Tab>('controller');
  const [assignments, setAssignments] = useState<FixtureAssignment[]>(() =>
    store.instances.map(inst => ({ instanceId: inst.id, mode: 'buttons' as ControlMode }))
  );
  const [widgets, setWidgets] = useState<DJWidget[]>([
    {
      id: 'w1', type: 'button', label: 'STROBE', x: 20, y: 30, width: 80, height: 80,
      color: '#ff2d78', flash: true, linkedFixtureIds: [], linkedFunction: 'strobe',
    },
    {
      id: 'w2', type: 'button', label: 'BLACKOUT', x: 110, y: 30, width: 80, height: 80,
      color: '#ffffff', flash: true, linkedFixtureIds: [], linkedFunction: 'dimmer',
    },
    {
      id: 'w3', type: 'slider', label: 'MASTER', x: 210, y: 20, width: 60, height: 160,
      color: '#00ff66', value: 100, min: 0, max: 100, linkedFixtureIds: [], linkedFunction: 'dimmer',
    },
    {
      id: 'w4', type: 'color-wheel', label: 'COLOR', x: 290, y: 20, width: 120, height: 120,
      color: '#00e5ff', colorValue: { r: 255, g: 0, b: 100 }, linkedFixtureIds: [],
    },
    {
      id: 'w5', type: 'xy-pad', label: 'PAN/TILT', x: 430, y: 20, width: 140, height: 140,
      color: '#00e5ff', colorValue: { r: 128, g: 128, b: 128 }, linkedFixtureIds: [],
    },
  ]);
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
      const taps = [...prev.tapTimes, now].filter(t => now - t < 5000); // keep last 5s of taps
      if (taps.length >= 2) {
        const intervals = taps.slice(1).map((t, i) => t - taps[i]);
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const bpm = Math.round(60000 / avgInterval);
        return { ...prev, tapTimes: taps, bpm: Math.max(20, Math.min(300, bpm)), isSynced: true };
      }
      return { ...prev, tapTimes: taps };
    });
  };

  // BPM flash indicator
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
    }]);
  };

  const removeWidget = (id: string) => {
    setWidgets(prev => prev.filter(w => w.id !== id));
    if (selectedWidget === id) setSelectedWidget(null);
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

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Speaker size={16} className="text-stokio-pink" />
          <h2 className="text-sm font-semibold tracking-wider">LIVE DJ</h2>
        </div>
        <div className="flex gap-1">
          {(['controller', 'assignments', 'scripts'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold rounded transition-colors ${
                tab === t ? 'bg-primary/10 text-primary border border-primary/30' : 'text-muted-foreground hover:text-foreground'
              }`}>
              {t === 'controller' ? '🎛 Controller' : t === 'assignments' ? '📡 Assignments' : '📜 Scripts'}
            </button>
          ))}
        </div>
      </div>

      {/* ── CONTROLLER TAB ── */}
      {tab === 'controller' && (
        <div className="flex-1 flex overflow-hidden">
          {/* Widget surface */}
          <div className="flex-1 relative overflow-hidden" ref={surfaceRef}>
            {/* Grid background */}
            <div className="absolute inset-0"
              style={{ backgroundImage: 'radial-gradient(circle, hsl(var(--border) / 0.15) 1px, transparent 1px)', backgroundSize: '20px 20px' }} />

            {widgets.map(w => (
              <ControlWidget
                key={w.id}
                widget={w}
                isSelected={selectedWidget === w.id}
                onSelect={() => setSelectedWidget(w.id)}
                onUpdate={(updates) => updateWidget(w.id, updates)}
                onPress={() => { /* future: send DMX values */ }}
                onRelease={() => { /* future: release override */ }}
              />
            ))}

            {widgets.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground/40">
                <SlidersHorizontal size={32} />
                <span className="text-sm mt-2">Drop widgets here</span>
              </div>
            )}
          </div>

          {/* Widget palette + properties */}
          <div className="w-56 border-l border-border/30 flex flex-col overflow-y-auto">
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
                  <label className="text-[7px] uppercase text-muted-foreground">Color</label>
                  <div className="flex gap-1">
                    <Input type="color" value={selectedWidgetData.color}
                      onChange={e => updateWidget(selectedWidgetData.id, { color: e.target.value })}
                      className="h-6 w-10 p-0 bg-transparent border-0 cursor-pointer" />
                    <Input value={selectedWidgetData.color}
                      onChange={e => updateWidget(selectedWidgetData.id, { color: e.target.value })}
                      className="h-6 text-[10px] bg-muted/20 border-border/20 font-mono flex-1" />
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

                {selectedWidgetData.type === 'button' && (
                  <div>
                    <label className="text-[7px] uppercase text-muted-foreground">Behavior</label>
                    <select value={selectedWidgetData.flash ? 'flash' : 'toggle'}
                      onChange={e => updateWidget(selectedWidgetData.id, { flash: e.target.value === 'flash' })}
                      className="w-full h-6 rounded bg-muted/20 border border-border/20 text-[10px] px-1 text-foreground">
                      <option value="flash">Flash (hold)</option>
                      <option value="toggle">Toggle</option>
                    </select>
                  </div>
                )}

                {/* Link fixtures */}
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
                          }`}
                        >
                          <span>{getFixtureTypeIcon(def.type)}</span>
                          <span>{inst.name}</span>
                          {linked && <span className="ml-auto text-[7px]">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {!selectedWidgetData && (
              <div className="flex-1 flex items-center justify-center text-[10px] text-muted-foreground/40 p-4 text-center">
                Select a widget to edit its properties
              </div>
            )}
          </div>
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
