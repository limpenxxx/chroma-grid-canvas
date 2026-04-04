import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, Play, Square, GripVertical, Palette, SlidersHorizontal,
  Zap, ChevronDown, ChevronRight, Monitor, Hand, Layers,
  Speaker, X, Save, Mic, Activity, Sparkles, Wifi, Radio,
  ImagePlus, Lock, Unlock, Move, FolderOpen, Download, Upload, FileText, Users,
  Bookmark, Settings2, CircleDot, Maximize2, Minimize2, Film, Copy, Grid3X3, Monitor
} from 'lucide-react';
import { AudioVisualizerEngine, PRESET_LABELS, type VisualizerPreset } from '@/lib/audioVisualizer';
import { DmxMixer } from './DmxMixer';
import { EqTriggerWidget, type EqTriggerZone, type EqColorOutput } from './EqTriggerWidget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  useFixtureStore, type FixtureInstance, type FixtureDefinition,
  getFixtureTypeIcon,
} from '@/store/fixtureStore';
import stokioLogo from '@/assets/stokio-logo-color.png';
import { useMediaStore } from '@/store/mediaStore';
import { useWledStore, type WledDevice, type WledFixture } from '@/store/wledStore';
import { setWledPreset, setWledState } from '@/lib/wledApi';
import { fetchWledPresets, isWledDeviceTargetId, wledDeviceToFixture } from '@/lib/wledUtils';
import { sendDmxChannel, onPioneerData, type PioneerData } from '@/lib/wsSync';

// ── Types ──

type ControlMode = 'video' | 'buttons' | 'both';

interface FixtureAssignment {
  instanceId: string;
  mode: ControlMode;
}

type WidgetType = 'button' | 'slider' | 'color-wheel' | 'xy-pad' | 'preset' | 'fixed-color' | 'media-trigger' | 'vfx' | 'wled-preset' | 'wled-fixture' | 'dmx-reset' | 'audio-reactive' | 'tap-bpm' | 'eq-trigger';

// ── Audio Reactive Effect Types ──
type AudioReactiveEffectType =
  | 'color-pulse'     // Pump a color on beat
  | 'dimmer-pump'     // Dimmer pulses to beat
  | 'strobe-beat'     // Strobe on each beat
  | 'pos-alternate'   // MH alternates between 2 positions on beat
  | 'color-cycle'     // Cycle through colors each beat
  | 'bass-color-shift'// Shift hue with bass intensity
  | 'wled-preset-cycle'// Cycle WLED presets each beat
  | 'wled-pixel-chase' // Color travels along strip per beat with fade
  | 'intensity-map'   // Map audio level to brightness
  | 'hue-sweep'       // Sweep through hue based on frequency
  | 'size-pulse';     // Pulse zoom/iris on beat

interface AudioReactiveFixtureEffect {
  fixtureId: string;
  effect: AudioReactiveEffectType;
  enabled: boolean;
  // Effect params
  color1?: { r: number; g: number; b: number };
  color2?: { r: number; g: number; b: number };
  intensity?: number;  // 0-255 effect strength
  decay?: number;      // 0-255 how fast it fades
  posA?: { pan: number; tilt: number };
  posB?: { pan: number; tilt: number };
  wledPresets?: number[];    // preset IDs to cycle
  triggerBand?: 'bass' | 'mid' | 'high' | 'all'; // which frequency reacts
}

interface AudioReactiveConfig {
  running: boolean;
  effects: AudioReactiveFixtureEffect[];
  globalDecay: number;  // 0-255
  sensitivity: number;  // 0-255
}

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
  speed: number; // 0-255 (DMX-style)
  size: number; // 1-100 (movement range)
  bpmSync: boolean;
  running: boolean;
  fixtureConfigs: MHFixtureConfig[];
}

// ── Audio / BPM Types ──
type AudioSource = 'none' | 'tap-tempo' | 'pioneer-dj' | 'wled-analog' | 'wled-i2s-inmp441' | 'wled-i2s-max98357' | 'wled-i2s-sph0645' | 'wled-udp-sync' | 'browser-mic' | 'system-audio';

interface AudioConfig {
  source: AudioSource;
  squelch: number;
  gain: number;
  udpPort: number;
  wledIp: string;
  sensitivity: number;   // 0-255, beat detection threshold
  freqLow: number;       // Hz, low cutoff for frequency filter
  freqHigh: number;      // Hz, high cutoff for frequency filter
}

interface PioneerDeckLocal {
  name: string;
  deviceNumber: number;
  bpm: number;
  beat: number;
  playing: boolean;
  master: boolean;
  ip: string;
  lastSeen: number;
}

interface BPMState {
  bpm: number;
  tapTimes: number[];
  isSynced: boolean;
  linkedWidgetIds: string[];
  flashOn: boolean;
  bpmMode: 'manual' | 'auto';
  autoBpm: number;    // BPM detected by audio analysis
  audioLevel: number; // 0-255 current audio input level
  pioneerDecks: Record<number, PioneerDeckLocal>;
  pioneerSyncDeck: number; // which deck to sync BPM from (0 = master)
}

const AUDIO_SOURCES: { value: AudioSource; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'No audio input' },
  { value: 'tap-tempo', label: 'TAP-TEMPO', description: 'Manual tap tempo for BPM sync' },
  { value: 'pioneer-dj', label: '🎛 Pioneer DJ (ProDJ Link)', description: 'Receive BPM and beat sync from Pioneer CDJ/DJM/XDJ equipment on the same network via ProDJ Link protocol' },
  { value: 'system-audio', label: 'System Audio', description: 'Capture audio from Chrome, Spotify, or any app on this computer via screen/tab sharing' },
  { value: 'browser-mic', label: 'Browser Microphone', description: "Use this device's microphone via Web Audio API" },
  { value: 'wled-analog', label: 'WLED Analog Mic', description: 'MAX4466 / MAX9814 analog microphone on WLED ESP32' },
  { value: 'wled-i2s-inmp441', label: 'WLED I2S INMP441', description: 'Digital I2S MEMS microphone (recommended)' },
  { value: 'wled-i2s-max98357', label: 'WLED I2S MAX98357', description: 'I2S line-in via MAX98357 amplifier' },
  { value: 'wled-i2s-sph0645', label: 'WLED I2S SPH0645', description: 'SPH0645 I2S digital microphone' },
  { value: 'wled-udp-sync', label: 'WLED UDP Sound Sync', description: 'Receive audio data from another WLED instance via UDP' },
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
  bgOpacity?: number;
  flash?: boolean;
  toggled?: boolean;
  value?: number;
  min?: number;
  max?: number;
  colorValue?: { r: number; g: number; b: number };
  linkedFixtureIds: string[];
  linkedFunction?: string;
  lockAxis?: 'none' | 'x' | 'y';
  mhProgram?: MHProgram;
  presetEntries?: PresetSceneEntry[];
  presetShowSubmenu?: boolean;
  syncColorWidgetId?: string | null;
  fixedColorSlotValue?: number;
  rgbSyncEnabled?: boolean;
  mediaItemId?: string | null;
  mediaPlaylistId?: string | null;
  mediaPlayMode?: 'play-once' | 'loop' | 'loop-random';
  mediaFlash?: boolean;
  vfxPreset?: VisualizerPreset;
  vfxRunning?: boolean;
  wledPresetId?: number;
  wledPresetName?: string;
  wledIp?: string;
  wledPresets?: { id: number; name: string }[];
  resetUniverse?: number;
  // Color program (color-wheel)
  colorProgram?: ColorProgram;
  // Fader-specific
  bgColor?: string;              // separate background color for fader widget
  faderColorSyncWidgetId?: string | null; // sync fader color with a color-wheel widget
  faderFixtureFunction?: string;  // what the fader controls: 'dimmer', 'preset', 'color', 'brightness', 'pan', 'strobe', etc.
  // XY pad: per-fixture positions and selected fixture for individual control
  selectedFixtureId?: string | null;
  fixturePositions?: Record<string, { x: number; y: number }>;
  // WLED Fixture widget
  wledFixtureDeviceId?: string;
  wledFixtureBrightness?: number;
  wledFixtureColor?: { r: number; g: number; b: number };
  wledFixtureActivePresetId?: number;
  // Audio Reactive widget
  audioReactive?: AudioReactiveConfig;
  // EQ Trigger widget
  eqTriggerZones?: EqTriggerZone[];
}

type ColorProgramMode = 'static' | 'switch' | 'fade';

interface ColorProgram {
  mode: ColorProgramMode;
  colors: { r: number; g: number; b: number }[];
  speed: number; // 0-255
  bpmSync: boolean;
  running: boolean;
}

const COLOR_PROGRAM_PRESETS: { label: string; mode: ColorProgramMode; colors: { r: number; g: number; b: number }[] }[] = [
  { label: 'R/B Switch', mode: 'switch', colors: [{ r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 }] },
  { label: 'R/G/B', mode: 'switch', colors: [{ r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 }] },
  { label: 'Rainbow Fade', mode: 'fade', colors: [{ r: 255, g: 0, b: 0 }, { r: 255, g: 255, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 255, b: 255 }] },
  { label: 'Warm Fade', mode: 'fade', colors: [{ r: 255, g: 60, b: 0 }, { r: 255, g: 180, b: 50 }, { r: 255, g: 100, b: 20 }] },
  { label: 'Cool Fade', mode: 'fade', colors: [{ r: 0, g: 100, b: 255 }, { r: 0, g: 255, b: 255 }, { r: 100, g: 0, b: 255 }] },
  { label: 'Police', mode: 'switch', colors: [{ r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 }, { r: 255, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }] },
  { label: 'Purple/Pink', mode: 'fade', colors: [{ r: 128, g: 0, b: 255 }, { r: 255, g: 50, b: 150 }] },
  { label: 'Fire', mode: 'fade', colors: [{ r: 255, g: 60, b: 0 }, { r: 255, g: 0, b: 0 }, { r: 255, g: 160, b: 0 }] },
];

const QUICK_COLORS: { label: string; color: { r: number; g: number; b: number } }[] = [
  { label: 'R', color: { r: 255, g: 0, b: 0 } },
  { label: 'G', color: { r: 0, g: 255, b: 0 } },
  { label: 'B', color: { r: 0, g: 0, b: 255 } },
  { label: 'W', color: { r: 255, g: 255, b: 255 } },
  { label: 'CY', color: { r: 0, g: 255, b: 255 } },
  { label: 'PU', color: { r: 128, g: 0, b: 255 } },
  { label: 'AM', color: { r: 255, g: 160, b: 0 } },
  { label: 'PK', color: { r: 255, g: 50, b: 150 } },
  { label: '⬛', color: { r: 0, g: 0, b: 0 } },
];

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

type Tab = 'controller' | 'assignments' | 'scripts' | 'groups' | 'mixer';

const WIDGET_PRESETS: { type: WidgetType; label: string; icon: typeof Zap; w: number; h: number }[] = [
  { type: 'button', label: 'Flash Button', icon: Zap, w: 100, h: 100 },
  { type: 'slider', label: 'Fader', icon: SlidersHorizontal, w: 70, h: 200 },
  { type: 'color-wheel', label: 'Color Pick', icon: Palette, w: 160, h: 180 },
  { type: 'xy-pad', label: 'XY Pad', icon: Plus, w: 200, h: 260 },
  { type: 'preset', label: 'Pre Set', icon: Bookmark, w: 120, h: 120 },
  { type: 'fixed-color', label: 'Fixed Color', icon: CircleDot, w: 150, h: 150 },
  { type: 'media-trigger', label: 'Media', icon: Film, w: 120, h: 120 },
  { type: 'vfx', label: 'Audio VFX', icon: Sparkles, w: 200, h: 200 },
  { type: 'wled-preset', label: 'WLED Preset', icon: Wifi, w: 120, h: 120 },
  { type: 'wled-fixture', label: 'WLED Fixture', icon: Wifi, w: 200, h: 260 },
  { type: 'dmx-reset', label: 'DMX Reset', icon: Square, w: 120, h: 80 },
  { type: 'audio-reactive', label: 'Audio Reactive', icon: Radio, w: 260, h: 320 },
  { type: 'tap-bpm', label: 'Tap / Audio In', icon: Activity, w: 220, h: 200 },
  { type: 'eq-trigger', label: 'EQ Trigger', icon: Activity, w: 320, h: 280 },
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

// ── 16x16 Pixel Matrix Preview for Audio Reactive Effects ──

function PixelMatrixPreview({ fx, arConfig, bpm }: {
  fx: AudioReactiveFixtureEffect;
  arConfig: AudioReactiveConfig;
  bpm: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const stateRef = useRef({ phase: 0, chasePos: 0, colorIdx: 0, lastBeat: 0, beatToggle: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fx.enabled || !arConfig.running) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const GRID = 16;
    const PX = 3;
    canvas.width = GRID * PX;
    canvas.height = GRID * PX;

    const st = stateRef.current;
    const beatMs = bpm > 0 ? 60000 / bpm : 500;
    const decay = (fx.decay || arConfig.globalDecay) / 255;
    const c1 = fx.color1 || { r: 255, g: 0, b: 0 };
    const c2 = fx.color2 || { r: 0, g: 0, b: 255 };

    const draw = (now: number) => {
      const isBeat = now - st.lastBeat >= beatMs;
      if (isBeat) {
        st.lastBeat = now;
        st.beatToggle = !st.beatToggle;
        st.chasePos = (st.chasePos + 1) % GRID;
        st.colorIdx = (st.colorIdx + 1) % 2;
      }
      const beatProgress = Math.min(1, (now - st.lastBeat) / beatMs);
      const pulse = Math.max(0, 1 - beatProgress * (1 + (1 - decay) * 3));

      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          let r = 0, g = 0, b = 0, a = 0.08;
          switch (fx.effect) {
            case 'color-pulse':
            case 'dimmer-pump': {
              r = c1.r; g = c1.g; b = c1.b;
              a = 0.05 + pulse * 0.95;
              break;
            }
            case 'strobe-beat': {
              r = 255; g = 255; b = 255;
              a = pulse > 0.5 ? 1 : 0.03;
              break;
            }
            case 'color-cycle': {
              const cc = st.colorIdx === 0 ? c1 : c2;
              r = cc.r; g = cc.g; b = cc.b;
              a = 0.15 + pulse * 0.85;
              break;
            }
            case 'bass-color-shift': {
              r = Math.round(255 * (1 - pulse));
              g = Math.round(255 * pulse);
              b = 0;
              a = 0.3 + pulse * 0.7;
              break;
            }
            case 'hue-sweep': {
              const hue = ((x + y * GRID) / (GRID * GRID) * 360 + now * 0.1) % 360;
              const hp = hue / 60;
              const ch = 1 - Math.abs(hp % 2 - 1);
              if (hp < 1) { r = 255; g = Math.round(ch * 255); }
              else if (hp < 2) { r = Math.round(ch * 255); g = 255; }
              else if (hp < 3) { g = 255; b = Math.round(ch * 255); }
              else if (hp < 4) { g = Math.round(ch * 255); b = 255; }
              else if (hp < 5) { r = Math.round(ch * 255); b = 255; }
              else { r = 255; b = Math.round(ch * 255); }
              a = 0.3 + pulse * 0.7;
              break;
            }
            case 'wled-pixel-chase': {
              const pixIdx = y * GRID + x;
              const totalPx = GRID * GRID;
              const headPos = (st.chasePos / GRID) * totalPx + beatProgress * (totalPx / GRID);
              const dist = (pixIdx - headPos + totalPx) % totalPx;
              const trail = Math.max(0, 1 - dist / (totalPx * 0.25));
              r = c1.r; g = c1.g; b = c1.b;
              a = trail * 0.95 + 0.02;
              break;
            }
            case 'intensity-map': {
              const barH = Math.round(pulse * GRID);
              const rowFromBottom = GRID - 1 - y;
              if (rowFromBottom < barH) {
                const t = rowFromBottom / GRID;
                r = Math.round(50 + t * 200); g = Math.round(255 * (1 - t)); b = 50;
                a = 0.5 + pulse * 0.5;
              }
              break;
            }
            case 'pos-alternate': {
              const isLeft = x < GRID / 2;
              const active = st.beatToggle ? isLeft : !isLeft;
              const cc = active ? c1 : c2;
              r = cc.r; g = cc.g; b = cc.b;
              a = active ? (0.4 + pulse * 0.6) : 0.08;
              break;
            }
            case 'wled-preset-cycle': {
              const checker = (x + y) % 2 === st.colorIdx;
              r = checker ? c1.r : 40; g = checker ? c1.g : 40; b = checker ? c1.b : 40;
              a = 0.2 + (checker ? pulse * 0.8 : 0);
              break;
            }
            case 'size-pulse': {
              const cx = GRID / 2, cy = GRID / 2;
              const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
              const radius = 2 + pulse * (GRID / 2 - 2);
              if (dist < radius) {
                r = c1.r; g = c1.g; b = c1.b;
                a = 0.3 + (1 - dist / radius) * pulse * 0.7;
              }
              break;
            }
          }
          ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
          ctx.fillRect(x * PX, y * PX, PX - 0.5, PX - 0.5);
        }
      }
      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [fx.effect, fx.enabled, fx.color1, fx.color2, fx.decay, arConfig.running, arConfig.globalDecay, bpm]);

  if (!fx.enabled || !arConfig.running) return null;

  return (
    <canvas
      ref={canvasRef}
      className="mt-1 rounded-sm border border-border/10"
      style={{ width: 48, height: 48, imageRendering: 'pixelated' }}
    />
  );
}

// ── Draggable + Resizable Widget ──

type DragMode = 'none' | 'move' | 'resize-br' | 'resize-bl' | 'resize-tr' | 'resize-tl';

function ControlWidget({
  widget, isSelected, onSelect, onUpdate, onPress, onRelease, allWidgets, fixtureData, isFullscreen = false, bpm = 120,
  bpmState: bpmStateProp, audioConfig: audioConfigProp, handleTap: handleTapProp, setBpmState: setBpmStateProp, setAudioConfig: setAudioConfigProp,
  analyserNode, sampleRate: sampleRateProp,
}: {
  widget: DJWidget;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<DJWidget>) => void;
  onPress: () => void;
  onRelease: () => void;
  allWidgets: DJWidget[];
  fixtureData: { inst: FixtureInstance; def: FixtureDefinition }[];
  isFullscreen?: boolean;
  bpm?: number;
  bpmState?: BPMState;
  audioConfig?: AudioConfig;
  handleTap?: () => void;
  setBpmState?: React.Dispatch<React.SetStateAction<BPMState>>;
  setAudioConfig?: React.Dispatch<React.SetStateAction<AudioConfig>>;
  analyserNode?: AnalyserNode | null;
  sampleRate?: number;
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
  // patternPos = main dot position (no delay), perFixturePos = per-fixture delayed positions
  const [patternPos, setPatternPos] = useState<{ x: number; y: number } | null>(null);
  const [perFixturePos, setPerFixturePos] = useState<Record<string, { x: number; y: number }>>({});
  const patternAnimRef = useRef<number | null>(null);

  useEffect(() => {
    if (widget.type !== 'xy-pad' || !widget.mhProgram?.running) {
      setPatternPos(null);
      setPerFixturePos({});
      if (patternAnimRef.current) cancelAnimationFrame(patternAnimRef.current);
      return;
    }

    const prog = widget.mhProgram;
    const sizeScale = (prog.size || 50) / 100;
    const speedMs = prog.bpmSync && bpm > 0
      ? (60000 / bpm)
      : Math.max(800, 1000 + (255 - (prog.speed || 128)) * 100);
    const startTime = performance.now();
    const configs = prog.fixtureConfigs || [];

    const computePos = (t: number, delayMs: number = 0, mirrorPan = false, mirrorTilt = false, reversePan = false, reverseTilt = false): { x: number; y: number } => {
      const phase = (((t - startTime - delayMs) / speedMs) * Math.PI * 2);
      const cx = 128, cy = 128;
      const range = 110 * sizeScale;
      let pos: { x: number; y: number };
      switch (prog.pattern) {
        case 'circle': pos = { x: cx + Math.cos(phase) * range, y: cy + Math.sin(phase) * range }; break;
        case 'figure8': pos = { x: cx + Math.sin(phase) * range, y: cy + Math.sin(phase * 2) * range * 0.6 }; break;
        case 'zigzag': {
          const p = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
          const seg = p * 4;
          const xPos = seg < 1 ? seg : seg < 2 ? 1 : seg < 3 ? 3 - seg : 0;
          const yPos = seg < 1 ? 0 : seg < 2 ? seg - 1 : seg < 3 ? 1 : 4 - seg;
          pos = { x: cx + (xPos - 0.5) * range * 2, y: cy + (yPos - 0.5) * range * 2 }; break;
        }
        case 'sweep-h': pos = { x: cx + Math.sin(phase) * range, y: cy }; break;
        case 'sweep-v': pos = { x: cx, y: cy + Math.sin(phase) * range }; break;
        case 'random': pos = { x: cx + (Math.sin(phase * 3.7) * 0.6 + Math.sin(phase * 1.3) * 0.4) * range, y: cy + (Math.cos(phase * 2.9) * 0.6 + Math.cos(phase * 1.7) * 0.4) * range }; break;
        case 'square': {
          const p = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
          const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
          const idx = Math.min(Math.floor(p * 4), 3);
          pos = { x: cx + corners[idx][0] * range * 0.7, y: cy + corners[idx][1] * range * 0.7 }; break;
        }
        case 'triangle': {
          const p = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
          const pts: [number, number][] = [[0, -1], [0.87, 0.5], [-0.87, 0.5]];
          const idx = Math.min(Math.floor(p * 3), 2);
          pos = { x: cx + pts[idx][0] * range, y: cy + pts[idx][1] * range }; break;
        }
        case 'bounce': pos = { x: cx, y: cy + Math.abs(Math.sin(phase)) * range - range * 0.5 }; break;
        default: pos = { x: cx, y: cy };
      }
      // Apply mirror/reverse transforms
      if (mirrorPan) pos.x = 256 - pos.x;
      if (mirrorTilt) pos.y = 256 - pos.y;
      if (reversePan) pos.x = cx - (pos.x - cx);
      if (reverseTilt) pos.y = cy - (pos.y - cy);
      return pos;
    };

    const animate = (t: number) => {
      // Main dot (no delay, no transforms)
      const mainPos = computePos(t);
      setPatternPos({ x: Math.max(0, Math.min(255, mainPos.x)), y: Math.max(0, Math.min(255, mainPos.y)) });

      // Per-fixture positions with individual delay + mirror/reverse
      if (widget.linkedFixtureIds.length > 0 && configs.length > 0) {
        const fxPositions: Record<string, { x: number; y: number }> = {};
        widget.linkedFixtureIds.forEach(fid => {
          const cfg = configs.find(c => c.fixtureId === fid);
          if (cfg && (cfg.delayMs > 0 || cfg.mirrorPan || cfg.mirrorTilt || cfg.reversePan || cfg.reverseTilt)) {
            const p = computePos(t, cfg.delayMs, cfg.mirrorPan, cfg.mirrorTilt, cfg.reversePan, cfg.reverseTilt);
            fxPositions[fid] = { x: Math.max(0, Math.min(255, p.x)), y: Math.max(0, Math.min(255, p.y)) };
          }
        });
        setPerFixturePos(fxPositions);
      }

      if (document.hidden) {
        patternAnimRef.current = window.setTimeout(animate, 33) as unknown as number;
      } else {
        patternAnimRef.current = requestAnimationFrame(animate);
      }
    };
    patternAnimRef.current = requestAnimationFrame(animate);
    return () => { if (patternAnimRef.current) { cancelAnimationFrame(patternAnimRef.current); clearTimeout(patternAnimRef.current); } };
  }, [widget.type, widget.mhProgram?.running, widget.mhProgram?.pattern, widget.mhProgram?.speed, widget.mhProgram?.size, widget.mhProgram?.bpmSync, widget.mhProgram?.fixtureConfigs, widget.linkedFixtureIds, bpm]);

  // Color program animation
  const colorProgAnimRef = useRef<number | null>(null);
  useEffect(() => {
    if (widget.type !== 'color-wheel' || !widget.colorProgram?.running || widget.colorProgram.colors.length < 2) {
      if (colorProgAnimRef.current) cancelAnimationFrame(colorProgAnimRef.current);
      return;
    }
    const prog = widget.colorProgram;
    const colors = [...prog.colors]; // snapshot to avoid stale refs
    const n = colors.length;
    // BPM sync: use beat interval; otherwise use speed slider
    const speedMs = prog.bpmSync && bpm > 0
      ? (60000 / bpm) // one color per beat
      : Math.max(200, 300 + (255 - (prog.speed || 128)) * 40);
    const startTime = performance.now();

    const animate = (t: number) => {
      const elapsed = t - startTime;
      const totalCycle = speedMs * n;
      const pos = (elapsed % totalCycle) / speedMs;
      const idx = Math.floor(pos) % n;
      const c = colors[idx];
      if (!c) { colorProgAnimRef.current = requestAnimationFrame(animate); return; }

      if (prog.mode === 'switch') {
        onUpdate({ colorValue: { r: c.r, g: c.g, b: c.b } });
      } else if (prog.mode === 'fade') {
        const frac = pos - idx;
        const cn = colors[(idx + 1) % n];
        if (!cn) { colorProgAnimRef.current = requestAnimationFrame(animate); return; }
        onUpdate({
          colorValue: {
            r: Math.round(c.r + (cn.r - c.r) * frac),
            g: Math.round(c.g + (cn.g - c.g) * frac),
            b: Math.round(c.b + (cn.b - c.b) * frac),
          },
        });
      }
      if (document.hidden) {
        colorProgAnimRef.current = window.setTimeout(animate, 33) as unknown as number;
      } else {
        colorProgAnimRef.current = requestAnimationFrame(animate);
      }
    };
    colorProgAnimRef.current = requestAnimationFrame(animate);
    return () => { if (colorProgAnimRef.current) { cancelAnimationFrame(colorProgAnimRef.current); clearTimeout(colorProgAnimRef.current); } };
  }, [widget.type, widget.colorProgram?.running, widget.colorProgram?.mode, widget.colorProgram?.speed, widget.colorProgram?.bpmSync, widget.colorProgram?.colors?.length, bpm]);

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
    <div className={`absolute select-none group transition-shadow ${isSelected ? 'ring-2 ring-primary/80 z-30' : 'z-10'} ${interacting ? 'z-50' : ''}`}
      style={{ left: widget.x, top: widget.y, width: widget.width, height: widget.height,
        boxShadow: isSelected ? '0 0 20px hsl(155 100% 50% / 0.4), 0 0 40px hsl(155 100% 50% / 0.15)' : undefined }}>

      {/* Strobe sync flash overlay */}
      {isStrobeSynced && (
        <div className="absolute inset-0 rounded-lg z-[35] pointer-events-none animate-strobe-flash"
          style={{ background: `radial-gradient(circle, ${widget.color || '#fff'}90, transparent)` }} />
      )}

      {/* Top drag handle — larger, more visible (hidden in fullscreen) */}
      {!isFullscreen && (
      <div className="absolute -top-3 left-0 right-0 h-6 z-40 cursor-grab active:cursor-grabbing flex items-center justify-center"
        onMouseDown={e => startInteraction(e, 'move')}>
        <div className="bg-muted/40 group-hover:bg-muted/70 rounded-t px-3 py-0.5 transition-colors">
          <GripVertical size={12} className="text-muted-foreground/40 group-hover:text-muted-foreground/80 transition-colors" />
        </div>
      </div>
      )}

      {!isFullscreen && <>
      <ResizeHandle corner="resize-br" cursor="cursor-se-resize" />
      <ResizeHandle corner="resize-bl" cursor="cursor-sw-resize" />
      <ResizeHandle corner="resize-tr" cursor="cursor-ne-resize" />
      <ResizeHandle corner="resize-tl" cursor="cursor-nw-resize" />
      </>}

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
      {widget.type === 'slider' && (() => {
        // Determine fader fill color: sync with color widget or use widget.color
        let faderColor = widget.color;
        if (widget.faderColorSyncWidgetId) {
          const syncW = allWidgets.find(w => w.id === widget.faderColorSyncWidgetId);
          if (syncW?.colorValue) {
            faderColor = `rgb(${syncW.colorValue.r},${syncW.colorValue.g},${syncW.colorValue.b})`;
          }
        }
        const sliderBg = widget.bgColor || undefined;
        const sliderBgStyle: React.CSSProperties = sliderBg
          ? { ...bgStyle, background: `radial-gradient(ellipse at 30% 20%, ${sliderBg}cc 0%, ${sliderBg}40 70%)` }
          : bgStyle;
        return (
        <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col items-center justify-center p-3 gap-1 overflow-hidden" style={sliderBgStyle}>
          <span className="text-muted-foreground font-semibold truncate" style={{ fontSize: Math.max(8, Math.min(12, widget.width * 0.14)) }}>{widget.label}</span>
          <div className="flex-1 w-10 rounded fader-track border border-border/20 relative">
            <motion.div className="absolute bottom-0 left-0 w-full rounded-b" style={{ backgroundColor: faderColor + (faderColor.startsWith('rgb') ? '' : '60') }} animate={{ height: `${widget.value || 0}%` }} />
            <input type="range" min={0} max={100} value={widget.value || 0} onChange={e => { onSelect(); onUpdate({ value: Number(e.target.value) }); }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-ns-resize" style={{ writingMode: 'vertical-lr', direction: 'rtl' } as React.CSSProperties} />
          </div>
          <span className="font-mono text-muted-foreground" style={{ fontSize: Math.max(8, Math.min(12, widget.width * 0.14)) }}>{widget.value || 0}%</span>
        </div>
        );
      })()}

      {/* COLOR WHEEL */}
      {widget.type === 'color-wheel' && (() => {
        const cv = widget.colorValue || { r: 0, g: 0, b: 0 };
        const s = Math.min(widget.width, widget.height);
        const previewSize = Math.max(16, Math.min(32, s * 0.15));
        return (
        <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col items-center p-2 gap-0.5 overflow-hidden relative" style={bgStyle}>
          <span className="text-muted-foreground font-semibold truncate shrink-0" style={{ fontSize: Math.max(8, Math.min(11, widget.width * 0.08)) }}>{widget.label}</span>

          {/* Live color preview square — top right */}
          <div className="absolute top-1.5 right-1.5 z-20 rounded border border-foreground/30"
            style={{ width: previewSize, height: previewSize,
              backgroundColor: `rgb(${cv.r},${cv.g},${cv.b})`,
              boxShadow: `0 0 8px rgb(${cv.r},${cv.g},${cv.b}), inset 0 0 4px rgba(255,255,255,0.1)` }} />

          {/* Color program indicator */}
          {widget.colorProgram?.running && (
            <div className="absolute top-1 left-1 text-[6px] px-1 py-0.5 rounded bg-primary/20 text-primary border border-primary/30 animate-pulse font-semibold z-20">
              {widget.colorProgram.mode === 'fade' ? '🌈' : '⚡'}
            </div>
          )}

          <div className="flex-1 flex items-center justify-center min-h-0">
            <div className="rounded-full border-2 border-border/30 cursor-pointer"
              style={{ width: Math.min(widget.width, widget.height) - 60, height: Math.min(widget.width, widget.height) - 60,
                background: `conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)` }}
              onClick={(e) => {
                onSelect();
                const rect = e.currentTarget.getBoundingClientRect();
                const cx2 = e.clientX - rect.left - rect.width / 2, cy2 = e.clientY - rect.top - rect.height / 2;
                const hue = ((Math.atan2(cx2, -cy2) * 180 / Math.PI) + 360) % 360;
                const c = 1, xx = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = 0;
                let r = 0, g = 0, b = 0;
                if (hue < 60) { r = c; g = xx; } else if (hue < 120) { r = xx; g = c; }
                else if (hue < 180) { g = c; b = xx; } else if (hue < 240) { g = xx; b = c; }
                else if (hue < 300) { r = xx; b = c; } else { r = c; b = xx; }
                onUpdate({ colorValue: { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) } });
              }}>
              {widget.colorValue && (
                <div className="w-full h-full rounded-full flex items-center justify-center">
                  <div className="rounded-full border border-foreground/50"
                    style={{ width: Math.max(12, (Math.min(widget.width, widget.height) - 60) * 0.3),
                      height: Math.max(12, (Math.min(widget.width, widget.height) - 60) * 0.3),
                      backgroundColor: `rgb(${cv.r},${cv.g},${cv.b})`,
                      boxShadow: `0 0 12px rgb(${cv.r},${cv.g},${cv.b})` }} />
                </div>
              )}
            </div>
          </div>

          {/* Quick color buttons */}
          {(() => {
            const btnSize = Math.max(14, Math.min(24, s * 0.1));
            const fs = Math.max(6, Math.min(10, s * 0.045));
            return (
              <div className="w-full shrink-0 flex flex-wrap justify-center gap-0.5">
                {QUICK_COLORS.map(qc => {
                  const isActive = cv.r === qc.color.r && cv.g === qc.color.g && cv.b === qc.color.b;
                  const isBlack = qc.color.r === 0 && qc.color.g === 0 && qc.color.b === 0;
                  return (
                    <button key={qc.label}
                      onClick={e => { e.stopPropagation(); onSelect(); onUpdate({ colorValue: qc.color }); }}
                      className={`rounded border transition-all font-bold ${
                        isActive ? 'border-foreground/60 ring-1 ring-primary/50 scale-110' : 'border-border/30 hover:border-border/60'
                      }`}
                      style={{
                        width: btnSize, height: btnSize, fontSize: fs,
                        backgroundColor: isBlack ? '#111' : `rgb(${qc.color.r},${qc.color.g},${qc.color.b})`,
                        color: (qc.color.r + qc.color.g + qc.color.b) > 400 ? '#000' : '#fff',
                        textShadow: (qc.color.r + qc.color.g + qc.color.b) > 400 ? 'none' : '0 1px 2px rgba(0,0,0,0.8)',
                      }}
                      title={qc.label}>
                      {qc.label}
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* Color program quick dropdown on widget */}
          {(() => {
            const dropFs = Math.max(7, Math.min(10, s * 0.045));
            const allPresets = [...COLOR_PROGRAM_PRESETS];
            return (
              <div className="w-full shrink-0">
                <select
                  value=""
                  onClick={e => e.stopPropagation()}
                  onChange={e => {
                    e.stopPropagation();
                    onSelect();
                    const val = e.target.value;
                    if (val === 'stop') {
                      if (widget.colorProgram) onUpdate({ colorProgram: { ...widget.colorProgram, running: false } });
                      return;
                    }
                    const idx = Number(val);
                    if (isNaN(idx)) return;
                    const preset = allPresets[idx];
                    if (preset) {
                      onUpdate({ colorProgram: { mode: preset.mode, colors: [...preset.colors], speed: widget.colorProgram?.speed ?? 128, bpmSync: widget.colorProgram?.bpmSync ?? false, running: true } });
                    }
                  }}
                  className="w-full rounded bg-muted/20 border border-border/20 text-muted-foreground cursor-pointer px-1"
                  style={{ fontSize: dropFs, height: Math.max(18, s * 0.09) }}>
                  <option value="">🎨 Color Program...</option>
                  {allPresets.map((p, i) => (
                    <option key={i} value={i}>{p.mode === 'fade' ? '🌈' : '⚡'} {p.label}</option>
                  ))}
                  <option value="" disabled>───</option>
                  <option value="stop">⬛ Stop Program</option>
                </select>
              </div>
            );
          })()}
        </div>
        );
      })()}

      {/* XY PAD */}
      {widget.type === 'xy-pad' && (
        <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col items-center p-2 gap-0.5 overflow-hidden" style={bgStyle}>
          <span className="text-muted-foreground font-semibold truncate shrink-0" style={{ fontSize: Math.max(8, Math.min(11, widget.width * 0.07)) }}>{widget.label}</span>

          {/* XY area */}
          <div className="flex-1 w-full relative border border-border/20 rounded cursor-crosshair min-h-0"
            onClick={e => {
              onSelect();
              const rect = e.currentTarget.getBoundingClientRect();
              const x = Math.round(((e.clientX - rect.left) / rect.width) * 255);
              const y = Math.round(((e.clientY - rect.top) / rect.height) * 255);
              if (widget.selectedFixtureId && widget.linkedFixtureIds.includes(widget.selectedFixtureId)) {
                // Only update the selected fixture's position
                const newPositions = { ...(widget.fixturePositions || {}), [widget.selectedFixtureId]: { x, y } };
                onUpdate({ fixturePositions: newPositions });
              } else {
                // Update all (global position)
                onUpdate({ colorValue: { r: x, g: y, b: 128 } });
              }
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
                  {/* Per-fixture delayed/mirrored dots (pattern mode) */}
                  {Object.entries(perFixturePos).map(([fid, fpos]) => {
                    const fxColors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff6fff', '#ff9f43'];
                    const fIdx = widget.linkedFixtureIds.indexOf(fid);
                    const fColor = fxColors[fIdx % fxColors.length];
                    return (
                      <div key={fid} className="absolute w-2.5 h-2.5 rounded-full border border-foreground/50 -translate-x-1/2 -translate-y-1/2 transition-none pointer-events-none"
                        style={{ left: `${(fpos.x / 255) * 100}%`, top: `${(fpos.y / 255) * 100}%`,
                          backgroundColor: fColor, boxShadow: `0 0 6px ${fColor}`, opacity: 0.8 }} />
                    );
                  })}
                  {/* Per-fixture manual position dots (non-pattern mode) */}
                  {!patternPos && widget.fixturePositions && Object.entries(widget.fixturePositions).map(([fid, fpos]) => {
                    const fxColors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff6fff', '#ff9f43'];
                    const fIdx = widget.linkedFixtureIds.indexOf(fid);
                    if (fIdx < 0) return null;
                    const fColor = fxColors[fIdx % fxColors.length];
                    const isSelected = widget.selectedFixtureId === fid;
                    return (
                      <div key={`manual-${fid}`} className={`absolute rounded-full border -translate-x-1/2 -translate-y-1/2 transition-none pointer-events-none ${isSelected ? 'w-4 h-4 border-2 border-foreground' : 'w-2.5 h-2.5 border border-foreground/50'}`}
                        style={{ left: `${(fpos.x / 255) * 100}%`, top: `${(fpos.y / 255) * 100}%`,
                          backgroundColor: fColor, boxShadow: `0 0 ${isSelected ? 12 : 6}px ${fColor}`, opacity: isSelected ? 1 : 0.7 }} />
                    );
                  })}
                </>
              );
            })()}
            <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[7px] text-muted-foreground/40">PAN</span>
            <span className="absolute left-0.5 top-1/2 -translate-y-1/2 text-[7px] text-muted-foreground/40 -rotate-90">TILT</span>
          </div>

          {/* Zero fixture button + MH controls */}
          {(() => {
            const s = Math.min(widget.width, widget.height);
            const btnFs = Math.max(10, Math.min(16, s * 0.07));
            const btnPx = Math.max(4, Math.min(10, s * 0.03));
            const btnPy = Math.max(2, Math.min(6, s * 0.02));
            const lblFs = Math.max(9, Math.min(14, s * 0.055));
            const valFs = Math.max(9, Math.min(13, s * 0.05));
            const sliderH = Math.max(4, Math.min(8, s * 0.03));
            const gap = Math.max(2, Math.min(6, s * 0.015));
            return (
              <div className="w-full shrink-0 flex flex-col mt-1" style={{ gap }}>
                {/* Fixture selector — pick which fixture to control individually */}
                {widget.linkedFixtureIds.length > 1 && (
                  <div className="flex flex-wrap justify-center" style={{ gap: Math.max(2, gap) }}>
                    <button
                      onClick={e => { e.stopPropagation(); onSelect(); onUpdate({ selectedFixtureId: null }); }}
                      className={`rounded transition-all border font-semibold ${
                        !widget.selectedFixtureId
                          ? 'bg-primary/20 border-primary/50 text-primary'
                          : 'bg-muted/10 border-border/20 text-muted-foreground/60 hover:border-border/40'
                      }`}
                      style={{ fontSize: btnFs * 0.8, paddingLeft: btnPx, paddingRight: btnPx, paddingTop: btnPy, paddingBottom: btnPy }}>
                      ALL
                    </button>
                    {widget.linkedFixtureIds.map((fid, i) => {
                      const fxColors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff6fff', '#ff9f43'];
                      const fColor = fxColors[i % fxColors.length];
                      const inst = fixtureData.find(f => f.inst.id === fid);
                      const isActive = widget.selectedFixtureId === fid;
                      return (
                        <button key={fid}
                          onClick={e => { e.stopPropagation(); onSelect(); onUpdate({ selectedFixtureId: isActive ? null : fid }); }}
                          className={`rounded transition-all border font-semibold ${
                            isActive
                              ? 'border-foreground/60 text-foreground'
                              : 'border-border/20 text-muted-foreground/60 hover:border-border/40'
                          }`}
                          style={{
                            fontSize: btnFs * 0.75, paddingLeft: btnPx, paddingRight: btnPx, paddingTop: btnPy, paddingBottom: btnPy,
                            backgroundColor: isActive ? fColor + '30' : fColor + '10',
                            borderColor: isActive ? fColor : undefined,
                            color: isActive ? fColor : undefined,
                          }}>
                          {inst?.inst.name?.slice(0, 6) || `F${i + 1}`}
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* Zero all channels button */}
                <div className="flex justify-center">
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onSelect();
                      // Zero pan/tilt on the pad
                      onUpdate({ colorValue: { r: 0, g: 0, b: 128 } });
                      // Stop any running MH program
                      if (widget.mhProgram?.running) {
                        onUpdate({ mhProgram: { ...widget.mhProgram, running: false }, colorValue: { r: 0, g: 0, b: 128 } });
                      }
                      // Zero all linked fixture sliders/values
                      widget.linkedFixtureIds.forEach(fid => {
                        allWidgets.forEach(aw => {
                          if (aw.id !== widget.id && aw.linkedFixtureIds.includes(fid) && (aw.type === 'slider' || aw.type === 'button')) {
                            // We signal zero via the widget's own update — parent handles propagation
                          }
                        });
                      });
                    }}
                    className="rounded border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:border-destructive/60 transition-all font-bold uppercase tracking-wider"
                    style={{ fontSize: btnFs * 0.85, paddingLeft: btnPx * 2, paddingRight: btnPx * 2, paddingTop: btnPy, paddingBottom: btnPy }}>
                    ⬛ ZERO
                  </button>
                </div>
                {/* Pattern quick-select row */}
                <div className="flex flex-wrap justify-center" style={{ gap: Math.max(2, gap) }}>
                  {MH_PATTERNS.map(p => {
                    const isActive = widget.mhProgram?.pattern === p.value && widget.mhProgram?.running;
                    const isSelected2 = widget.mhProgram?.pattern === p.value;
                    return (
                      <button key={p.value}
                        onClick={e => {
                          e.stopPropagation();
                          onSelect();
                          const base = widget.mhProgram || { pattern: 'circle', speed: 128, size: 50, bpmSync: false, running: false, fixtureConfigs: [] };
                          if (isSelected2 && base.running) {
                            onUpdate({ mhProgram: { ...base, running: false } });
                          } else {
                            onUpdate({ mhProgram: { ...base, pattern: p.value, running: true } });
                          }
                        }}
                        className={`rounded transition-all border font-semibold ${
                          isActive
                            ? 'bg-primary/20 border-primary/50 text-primary shadow-[0_0_8px_hsl(var(--primary)/0.4)]'
                            : isSelected2
                              ? 'bg-muted/30 border-border/40 text-foreground'
                              : 'bg-muted/10 border-border/20 text-muted-foreground/60 hover:border-border/40 hover:text-muted-foreground'
                        }`}
                        title={p.label}
                        style={{ fontSize: btnFs, paddingLeft: btnPx, paddingRight: btnPx, paddingTop: btnPy, paddingBottom: btnPy }}>
                        {p.label.split(' ')[0]}
                      </button>
                    );
                  })}
                </div>

                {/* Speed slider on widget */}
                <div className="flex items-center gap-1.5 px-1">
                  <span className="text-muted-foreground/60 uppercase shrink-0 font-semibold" style={{ fontSize: lblFs }}>SPD</span>
                  <input
                    type="range"
                    min={0} max={255}
                    value={widget.mhProgram?.speed ?? 128}
                    onClick={e => e.stopPropagation()}
                    onChange={e => {
                      e.stopPropagation();
                      onSelect();
                      const base = widget.mhProgram || { pattern: 'circle', speed: 128, size: 50, bpmSync: false, running: false, fixtureConfigs: [] };
                      onUpdate({ mhProgram: { ...base, speed: Number(e.target.value) } });
                    }}
                    className="flex-1 accent-primary cursor-pointer"
                    style={{ minWidth: 0, height: sliderH }}
                  />
                  <span className="font-mono text-muted-foreground/60 text-right" style={{ fontSize: valFs, minWidth: valFs * 2.5 }}>{widget.mhProgram?.speed ?? 128}</span>
                </div>

                {/* Size slider on widget */}
                <div className="flex items-center gap-1.5 px-1">
                  <span className="text-muted-foreground/60 uppercase shrink-0 font-semibold" style={{ fontSize: lblFs }}>SIZ</span>
                  <input
                    type="range"
                    min={1} max={100}
                    value={widget.mhProgram?.size ?? 50}
                    onClick={e => e.stopPropagation()}
                    onChange={e => {
                      e.stopPropagation();
                      onSelect();
                      const base = widget.mhProgram || { pattern: 'circle', speed: 128, size: 50, bpmSync: false, running: false, fixtureConfigs: [] };
                      onUpdate({ mhProgram: { ...base, size: Number(e.target.value) } });
                    }}
                    className="flex-1 accent-primary cursor-pointer"
                    style={{ minWidth: 0, height: sliderH }}
                  />
                  <span className="font-mono text-muted-foreground/60 text-right" style={{ fontSize: valFs, minWidth: valFs * 2.5 }}>{widget.mhProgram?.size ?? 50}</span>
                </div>
              </div>
            );
          })()}
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
            if (document.hidden) {
              animRef.current = window.setTimeout(animate, 33) as unknown as number;
            } else {
              animRef.current = requestAnimationFrame(animate);
            }
          };
          animRef.current = requestAnimationFrame(animate);

          return () => {
            engine.stop();
            if (animRef.current) { cancelAnimationFrame(animRef.current); clearTimeout(animRef.current); }
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
            <div className="absolute top-1 right-1 z-10 flex gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const { openVfxOutputWindow } = require('./VfxOutputWindow');
                  const { useIOStore } = require('./IOSetup');
                  const io = useIOStore.getState().vfxOutput;
                  openVfxOutputWindow(widget.vfxPreset || 'plasma-wave', io.resolution, io.display, io.fullscreen);
                }}
                className="w-6 h-6 rounded-full flex items-center justify-center bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-all"
                title="Öppna VFX Output-fönster (HDMI)"
              >
                <Monitor size={10} />
              </button>
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

        const activatePreset = async (presetId: number) => {
          onSelect();
          onUpdate({ wledPresetId: presetId });
          // Send to device — use widget IP or linked fixture IPs
          const targetIps = new Set<string>();
          if (widget.wledIp) targetIps.add(widget.wledIp);
          widget.linkedFixtureIds.forEach(fid => {
            const wf = fixtureData.find(f => f.inst.id === fid);
            if (wf?.def.wledConfig?.ip) targetIps.add(wf.def.wledConfig.ip);
          });
          await Promise.all([...targetIps].map(ip => setWledPreset(ip, presetId).catch(() => {})));
        };

        const fetchPresetsFromDevice = async () => {
          if (!widget.wledIp) return;
          try {
            const presetsFromDevice = await fetchWledPresets(widget.wledIp);
            onUpdate({ wledPresets: presetsFromDevice });
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

      {/* DMX RESET */}
      {widget.type === 'dmx-reset' && (() => {
        const universe = widget.resetUniverse ?? 1;
        const s = Math.min(widget.width, widget.height);
        const fs = Math.max(10, Math.min(18, s * 0.15));
        const subFs = Math.max(8, Math.min(13, s * 0.1));
        return (
          <div className="w-full h-full rounded-lg control-glossy border border-destructive/30 flex flex-col items-center justify-center gap-1 transition-all overflow-hidden relative cursor-pointer hover:border-destructive/60 hover:bg-destructive/5 active:bg-destructive/15 active:scale-95"
            style={bgStyle}
            onClick={e => {
              e.stopPropagation();
              onSelect();
              onPress();
              // Visual feedback
              onUpdate({ toggled: true });
              setTimeout(() => onUpdate({ toggled: false }), 300);
            }}>
            {widget.toggled && (
              <div className="absolute inset-0 rounded-lg bg-destructive/20 animate-pulse z-0" />
            )}
            <Square size={Math.max(14, s * 0.12)} className="text-destructive relative z-10" />
            <span className="text-destructive font-bold uppercase tracking-wider relative z-10" style={{ fontSize: fs }}>RESET</span>
            <span className="text-muted-foreground/60 font-semibold relative z-10" style={{ fontSize: subFs }}>Universe {universe}</span>
            <span className="text-muted-foreground/30 relative z-10" style={{ fontSize: Math.max(7, subFs * 0.7) }}>512 CH → 0</span>
          </div>
        );
      })()}

      {/* WLED FIXTURE WIDGET */}
      {widget.type === 'wled-fixture' && (() => {
        const wledStore2 = useWledStore.getState();
        const linkedDeviceId = widget.wledFixtureDeviceId;
        const device = linkedDeviceId ? wledStore2.devices.find(d => d.id === linkedDeviceId) : undefined;
        const color = widget.wledFixtureColor || { r: 255, g: 0, b: 0 };
        const brightness = widget.wledFixtureBrightness ?? 128;
        const activePresetId = widget.wledFixtureActivePresetId;
        const presets = widget.wledPresets || [];

        const handleColor = (c: { r: number; g: number; b: number }) => {
          onUpdate({ wledFixtureColor: c });
          if (device?.online) {
            void setWledState(device.ip, { on: true, seg: [{ id: 0, col: [[c.r, c.g, c.b]] }] }).catch(() => {});
          }
        };
        const handleBri = (bri: number) => {
          onUpdate({ wledFixtureBrightness: bri });
          if (device?.online) {
            void setWledState(device.ip, { on: bri > 0, bri }).catch(() => {});
          }
        };
        const handlePreset = (presetId: number) => {
          onUpdate({ wledFixtureActivePresetId: presetId });
          if (device?.online) {
            void setWledPreset(device.ip, presetId).catch(() => {});
          }
        };

        const s = Math.min(widget.width, widget.height);
        return (
          <div className="w-full h-full rounded-lg control-glossy border border-[#ff6600]/30 flex flex-col overflow-hidden relative"
            style={{ ...bgStyle }} onClick={onSelect}>
            {/* Header */}
            <div className="px-2 py-1.5 flex items-center gap-1.5 border-b border-border/20 shrink-0" style={{ background: 'rgba(255,102,0,0.08)' }}>
              <Wifi size={10} className="text-[#ff6600]" />
              <span className="text-[9px] font-semibold truncate flex-1" style={{ color: '#ff6600' }}>{widget.label}</span>
              <div className={`w-2 h-2 rounded-full ${device?.online ? 'bg-green-500 shadow-[0_0_6px_#22c55e]' : 'bg-red-500'}`} />
              <span className="text-[7px] text-muted-foreground/50">{device?.online ? 'ON' : 'OFF'}</span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {!device ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 text-center">
                  <Wifi size={18} />
                  <span className="text-[8px] mt-1">Select WLED device in properties</span>
                </div>
              ) : (
                <>
                  {/* Color preview + picker */}
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full border border-border/30 cursor-pointer shrink-0"
                      style={{ background: `rgb(${color.r},${color.g},${color.b})`, boxShadow: `0 0 12px rgb(${color.r},${color.g},${color.b})` }}
                    />
                    <div className="flex-1 flex flex-wrap gap-0.5">
                      {QUICK_COLORS.slice(0, 8).map(qc => (
                        <button key={qc.label} onClick={e => { e.stopPropagation(); handleColor(qc.color); }}
                          className="w-5 h-5 rounded border border-border/20 hover:scale-110 transition-transform"
                          style={{ background: `rgb(${qc.color.r},${qc.color.g},${qc.color.b})` }}
                          title={qc.label} />
                      ))}
                    </div>
                  </div>

                  {/* Brightness */}
                  <div className="flex items-center gap-2">
                    <span className="text-[7px] text-muted-foreground uppercase w-6 shrink-0">BRI</span>
                    <input type="range" min={0} max={255} value={brightness}
                      onClick={e => e.stopPropagation()}
                      onChange={e => { e.stopPropagation(); handleBri(Number(e.target.value)); }}
                      className="flex-1 accent-[#ff6600] h-2 cursor-pointer" />
                    <span className="text-[8px] font-mono text-muted-foreground w-6 text-right">{brightness}</span>
                  </div>

                  {/* Presets */}
                  {presets.length > 0 && (
                    <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.floor(widget.width / 55))}, 1fr)` }}>
                      {presets.slice(0, 12).map(p => (
                        <button key={p.id} onClick={e => { e.stopPropagation(); handlePreset(p.id); }}
                          className={`px-1 py-0.5 rounded text-[7px] font-medium border truncate transition-all ${
                            activePresetId === p.id
                              ? 'bg-[#ff6600]/20 border-[#ff6600]/40 text-[#ff6600]'
                              : 'border-border/20 text-muted-foreground hover:border-[#ff6600]/30'
                          }`}>{p.name}</button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* AUDIO REACTIVE WIDGET */}
      {widget.type === 'audio-reactive' && (() => {
        const arConfig = widget.audioReactive || { running: false, effects: [], globalDecay: 180, sensitivity: 160 };
        const s = Math.min(widget.width, widget.height);
        const linkedCount = arConfig.effects.filter(e => e.enabled).length;

        const EFFECT_ICONS: Record<AudioReactiveEffectType, string> = {
          'color-pulse': '🔴', 'dimmer-pump': '💡', 'strobe-beat': '⚡', 'pos-alternate': '↔',
          'color-cycle': '🌈', 'bass-color-shift': '🎸', 'wled-preset-cycle': '🔄',
          'wled-pixel-chase': '🌊', 'intensity-map': '📊', 'hue-sweep': '🎨', 'size-pulse': '🔍',
        };
        const EFFECT_LABELS: Record<AudioReactiveEffectType, string> = {
          'color-pulse': 'Color Pulse', 'dimmer-pump': 'Dimmer Pump', 'strobe-beat': 'Strobe Beat',
          'pos-alternate': 'Pos Alternate', 'color-cycle': 'Color Cycle', 'bass-color-shift': 'Bass Shift',
          'wled-preset-cycle': 'Preset Cycle', 'wled-pixel-chase': 'Pixel Chase',
          'intensity-map': 'Intensity Map', 'hue-sweep': 'Hue Sweep', 'size-pulse': 'Size Pulse',
        };
        const BAND_COLORS: Record<string, string> = {
          bass: '#ff4444', mid: '#ffaa00', high: '#44aaff', all: '#aa44ff',
        };

        return (
          <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col overflow-hidden relative"
            style={{ ...bgStyle, borderColor: arConfig.running ? '#aa44ff' : undefined,
              boxShadow: arConfig.running ? '0 0 25px rgba(170,68,255,0.3), inset 0 0 15px rgba(170,68,255,0.08)' : undefined }}
            onClick={onSelect}>

            {/* Header */}
            <div className="px-2 py-1.5 flex items-center gap-1.5 border-b border-border/20 shrink-0"
              style={{ background: arConfig.running ? 'rgba(170,68,255,0.1)' : 'rgba(170,68,255,0.05)' }}>
              <Radio size={10} className="text-[#aa44ff]" />
              <span className="text-[9px] font-semibold truncate flex-1" style={{ color: '#aa44ff' }}>{widget.label}</span>
              <span className="text-[7px] text-muted-foreground/50">{linkedCount} FX</span>
              <button
                onClick={(e) => { e.stopPropagation(); onUpdate({ audioReactive: { ...arConfig, running: !arConfig.running } }); }}
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                  arConfig.running ? 'bg-[#aa44ff]/20 text-[#aa44ff] shadow-[0_0_8px_rgba(170,68,255,0.4)]' : 'bg-muted/40 text-muted-foreground'
                }`}>
                {arConfig.running ? <Square size={10} /> : <Play size={10} />}
              </button>
            </div>

            {/* Effects list */}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
              {arConfig.effects.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30 gap-1">
                  <Radio size={20} />
                  <span className="text-[8px]">Link fixtures in properties</span>
                  <span className="text-[7px]">then add audio effects</span>
                </div>
              ) : (
                arConfig.effects.map((fx, idx) => {
                  const inst = fixtureData.find(f => f.inst.id === fx.fixtureId);
                  const bandColor = BAND_COLORS[fx.triggerBand || 'all'];
                  return (
                    <div key={`${fx.fixtureId}-${idx}`}
                      className={`rounded border p-1.5 transition-all ${
                        fx.enabled
                          ? 'border-[#aa44ff]/30 bg-[#aa44ff]/5'
                          : 'border-border/15 bg-muted/5 opacity-50'
                      }`}>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px]">{EFFECT_ICONS[fx.effect] || '🔊'}</span>
                        <span className="text-[8px] font-semibold truncate flex-1" style={{ color: fx.enabled ? '#aa44ff' : undefined }}>
                          {inst?.inst.name?.slice(0, 10) || 'Unknown'}
                        </span>
                        <span className="text-[7px] px-1 rounded-full font-semibold" style={{ background: bandColor + '20', color: bandColor }}>
                          {(fx.triggerBand || 'all').toUpperCase()}
                        </span>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            const effects = [...arConfig.effects];
                            effects[idx] = { ...effects[idx], enabled: !effects[idx].enabled };
                            onUpdate({ audioReactive: { ...arConfig, effects } });
                          }}
                          className={`w-4 h-4 rounded-full border transition-all ${
                            fx.enabled ? 'bg-[#aa44ff] border-[#aa44ff]' : 'bg-muted/20 border-border/30'
                          }`}>
                          {fx.enabled && <span className="text-[6px] text-white flex items-center justify-center">✓</span>}
                        </button>
                      </div>
                      <div className="text-[7px] text-muted-foreground/60 mt-0.5">{EFFECT_LABELS[fx.effect]}</div>
                      {/* Color preview for color effects */}
                      {(fx.effect === 'color-pulse' || fx.effect === 'color-cycle' || fx.effect === 'pos-alternate') && fx.color1 && (
                        <div className="flex gap-0.5 mt-0.5">
                          <div className="w-3 h-3 rounded-sm border border-border/20"
                            style={{ background: `rgb(${fx.color1.r},${fx.color1.g},${fx.color1.b})` }} />
                          {fx.color2 && <div className="w-3 h-3 rounded-sm border border-border/20"
                            style={{ background: `rgb(${fx.color2.r},${fx.color2.g},${fx.color2.b})` }} />}
                        </div>
                      )}
                      {/* 16x16 Pixel Matrix Preview */}
                      <PixelMatrixPreview fx={fx} arConfig={arConfig} bpm={bpm} />
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom status */}
            <div className="px-2 py-1 border-t border-border/10 flex items-center justify-between shrink-0"
              style={{ background: 'rgba(0,0,0,0.2)' }}>
              <span className="text-[7px] text-muted-foreground/40 font-mono">
                DECAY:{arConfig.globalDecay} SENS:{arConfig.sensitivity}
              </span>
              {arConfig.running && (
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#aa44ff] animate-pulse" />
                  <span className="text-[7px] text-[#aa44ff] font-semibold">LIVE</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* TAP / AUDIO IN WIDGET */}
      {widget.type === 'tap-bpm' && (() => {
        const bs = bpmStateProp || { bpm: 120, tapTimes: [], isSynced: false, linkedWidgetIds: [], flashOn: false, bpmMode: 'auto' as const, autoBpm: 0, audioLevel: 0, pioneerDecks: {} as Record<number, PioneerDeckLocal>, pioneerSyncDeck: 0 };
        const ac = audioConfigProp || { source: 'none' as AudioSource, squelch: 10, gain: 128, udpPort: 11988, wledIp: '', sensitivity: 128, freqLow: 60, freqHigh: 200 };
        const levelPct = Math.round((bs.audioLevel / 255) * 100);
        const sourceLabel = AUDIO_SOURCES.find(s => s.value === ac.source)?.label || 'None';
        const s = Math.min(widget.width, widget.height);

        return (
          <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col overflow-hidden relative"
            style={{ ...bgStyle, borderColor: bs.flashOn ? '#ff2d78' : undefined, boxShadow: bs.flashOn ? '0 0 20px #ff2d7840' : undefined }}
            onClick={onSelect}>

            {/* Header */}
            <div className="px-2 py-1 flex items-center gap-1.5 border-b border-border/20 shrink-0" style={{ background: 'rgba(255,45,120,0.06)' }}>
              <Activity size={10} className="text-stokio-pink" />
              <span className="text-[9px] font-semibold truncate flex-1 text-stokio-pink">{widget.label}</span>
              <span className="text-[7px] font-mono text-muted-foreground/50">{sourceLabel}</span>
            </div>

            <div className="flex-1 p-2 space-y-2 overflow-y-auto">
              {/* Mode toggle */}
              <div className="flex rounded-md border border-border/20 overflow-hidden">
                <button
                  className={`flex-1 text-[8px] py-1 font-semibold transition-all ${bs.bpmMode === 'manual' ? 'bg-stokio-pink/20 text-stokio-pink' : 'text-muted-foreground hover:bg-muted/20'}`}
                  onClick={e => { e.stopPropagation(); setBpmStateProp?.(prev => ({ ...prev, bpmMode: 'manual' })); }}>
                  <Hand size={9} className="inline mr-0.5" /> MANUAL
                </button>
                <button
                  className={`flex-1 text-[8px] py-1 font-semibold transition-all ${bs.bpmMode === 'auto' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-muted/20'}`}
                  onClick={e => { e.stopPropagation(); setBpmStateProp?.(prev => ({ ...prev, bpmMode: 'auto' })); }}>
                  <Sparkles size={9} className="inline mr-0.5" /> AUTO
                </button>
              </div>

              {/* BPM display + Tap button */}
              <div className="flex items-center gap-2">
                <motion.button whileTap={{ scale: 0.9 }}
                  onClick={e => { e.stopPropagation(); handleTapProp?.(); }}
                  className="w-12 h-12 rounded-full control-glossy border-2 flex flex-col items-center justify-center transition-all shrink-0"
                  style={{
                    borderColor: bs.flashOn ? '#ff2d78' : 'hsl(var(--border) / 0.3)',
                    boxShadow: bs.flashOn ? '0 0 20px #ff2d7860, inset 0 0 10px #ff2d7820' : 'none',
                    opacity: bs.bpmMode === 'auto' ? 0.4 : 1,
                  }}>
                  <span className="text-[7px] uppercase text-muted-foreground font-semibold">TAP</span>
                  <span className="text-[10px] font-bold text-primary font-mono">{bs.bpm}</span>
                </motion.button>

                <div className="flex-1 space-y-1">
                  <div className="text-base font-bold font-mono text-foreground flex items-center gap-1">
                    {bs.bpm} <span className="text-[8px] text-muted-foreground font-normal">BPM</span>
                    {bs.isSynced && (
                      <motion.div className="w-2 h-2 rounded-full"
                        animate={{ backgroundColor: bs.flashOn ? '#ff2d78' : '#00ff66', boxShadow: bs.flashOn ? '0 0 8px #ff2d78' : '0 0 4px #00ff6660' }}
                        transition={{ duration: 0.05 }} />
                    )}
                  </div>
                  {bs.autoBpm > 0 && (
                    <div className="text-[8px] text-muted-foreground/60 font-mono">
                      AI Detect: <span className="text-primary">{bs.autoBpm}</span> BPM
                    </div>
                  )}
                  <div className="flex gap-0.5">
                    <Button variant="outline" size="sm" className="h-4 text-[7px] px-1"
                      onClick={() => setBpmStateProp?.(prev => ({ ...prev, bpm: Math.max(20, prev.bpm - 1) }))}>-1</Button>
                    <Button variant="outline" size="sm" className="h-4 text-[7px] px-1"
                      onClick={() => setBpmStateProp?.(prev => ({ ...prev, bpm: Math.min(300, prev.bpm + 1) }))}>+1</Button>
                    <Button variant="outline" size="sm" className="h-4 text-[7px] px-1"
                      onClick={() => setBpmStateProp?.(prev => ({ ...prev, bpm: Math.round(prev.bpm / 2) }))}>÷2</Button>
                    <Button variant="outline" size="sm" className="h-4 text-[7px] px-1"
                      onClick={() => setBpmStateProp?.(prev => ({ ...prev, bpm: Math.min(300, prev.bpm * 2) }))}>×2</Button>
                  </div>
                </div>
              </div>

              {/* Audio Level Meter */}
              <div className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-[7px] uppercase text-muted-foreground tracking-wider">Input Level</span>
                  <span className="text-[7px] font-mono text-muted-foreground/60">{bs.audioLevel}</span>
                </div>
                <div className="h-3 rounded-full bg-muted/30 overflow-hidden border border-border/10 relative">
                  <motion.div
                    className="h-full rounded-full"
                    animate={{ width: `${levelPct}%` }}
                    transition={{ duration: 0.05 }}
                    style={{
                      background: levelPct > 80
                        ? 'linear-gradient(90deg, #00ff66, #ff4444)'
                        : levelPct > 40
                          ? 'linear-gradient(90deg, #00ff66, #ffaa00)'
                          : 'linear-gradient(90deg, #00ff6640, #00ff66)',
                    }}
                  />
                </div>
              </div>

              {/* Audio Source selector */}
              <div>
                <span className="text-[7px] uppercase text-muted-foreground tracking-wider">Source</span>
                <select value={ac.source}
                  onChange={e => { e.stopPropagation(); setAudioConfigProp?.(prev => ({ ...prev, source: e.target.value as AudioSource })); }}
                  className="w-full h-5 rounded bg-muted/20 border border-border/20 text-[8px] px-1 text-foreground mt-0.5"
                  onClick={e => e.stopPropagation()}>
                  {AUDIO_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>
          </div>
        );
      })()}

      {/* EQ TRIGGER WIDGET */}
      {widget.type === 'eq-trigger' && (() => {
        const zones = widget.eqTriggerZones || [];
        const fixtureList = fixtureData.map(f => ({
          id: f.inst.id,
          name: f.inst.name,
          icon: getFixtureTypeIcon(f.def.type),
        }));

        return (
          <div className="w-full h-full rounded-lg control-glossy border border-border/30 flex flex-col overflow-hidden"
            style={bgStyle}
            onClick={onSelect}>
            <div className="px-2 py-1 flex items-center gap-1.5 border-b border-border/20 shrink-0" style={{ background: 'rgba(0,229,255,0.06)' }}>
              <Activity size={10} className="text-stokio-cyan" />
              <span className="text-[9px] font-semibold truncate flex-1 text-stokio-cyan">{widget.label}</span>
              <span className="text-[7px] font-mono text-muted-foreground/50">{zones.length} zones</span>
            </div>
            <div className="flex-1 p-1 overflow-hidden">
              <EqTriggerWidget
                zones={zones}
                onZonesChange={(z) => onUpdate({ eqTriggerZones: z })}
                analyserNode={analyserNode || null}
                sampleRate={sampleRateProp || 44100}
                width={widget.width - 10}
                height={widget.height - 36}
                fixtures={fixtureList}
                onTrigger={() => {}}
              />
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
const AUTOSAVE_KEY = 'stokio-dj-autosave-v1';

interface AutosaveData {
  pages: LayoutPage[];
  groups: FixtureGroup[];
  assignments: FixtureAssignment[];
  scripts: DJScript[];
  audioConfig: AudioConfig;
  activePageId: string;
}

function loadAutosave(): AutosaveData | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function persistAutosave(data: AutosaveData) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
  } catch {
    // Quota exceeded — try stripping images
    try {
      const stripped: AutosaveData = {
        ...data,
        pages: data.pages.map(page => ({
          ...page,
          bgImage: page.bgImage && page.bgImage.length > 50000 ? null : page.bgImage,
          widgets: page.widgets.map(w => ({
            ...w,
            bgImage: w.bgImage && w.bgImage.length > 50000 ? null : w.bgImage,
          })),
        })),
      };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(stripped));
    } catch {
      console.warn('Could not autosave LiveDJ: storage quota exceeded');
    }
  }
}

function loadSavedLayouts(): SavedLayout[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function stripLargeImages(layouts: SavedLayout[]): SavedLayout[] {
  return layouts.map(layout => ({
    ...layout,
    pages: layout.pages.map(page => ({
      ...page,
      bgImage: page.bgImage && page.bgImage.length > 50000 ? null : page.bgImage,
      widgets: page.widgets.map(w => ({
        ...w,
        bgImage: w.bgImage && w.bgImage.length > 50000 ? null : w.bgImage,
      })),
    })),
  }));
}

function persistLayouts(layouts: SavedLayout[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stripLargeImages(layouts)));
    } catch {
      console.warn('Could not save layouts: storage quota exceeded');
    }
  }
}

/** Create a virtual FixtureInstance + FixtureDefinition for a WLED device-list fixture so LiveDJ can treat it like any other fixture */
function wledFixtureToVirtual(fix: WledFixture): { inst: FixtureInstance; def: FixtureDefinition } {
  return {
    inst: {
      id: fix.id, definitionId: `_wled_${fix.id}`, name: fix.name, icon: fix.icon,
      universe: 0, dmxAddress: 0, modeId: 'wled-m1',
      onStage: false, stageX: 0, stageY: 0, stageWidth: 36, stageHeight: 36,
    },
    def: {
      id: `_wled_${fix.id}`, manufacturer: 'WLED', model: fix.deviceName, type: 'wled',
      category: 'wled', colorSystem: 'rgb',
      wledConfig: { ip: fix.deviceIp, ledCount: Math.max(1, fix.ledEnd - fix.ledStart + 1), segments: 1, presets: [] },
      modes: [{ id: 'wled-m1', name: 'WLED RGB', channelCount: 0, channels: [] }],
      createdAt: 0,
    },
  };
}

function wledDeviceToVirtual(dev: WledDevice): { inst: FixtureInstance; def: FixtureDefinition } {
  return wledFixtureToVirtual(wledDeviceToFixture(dev));
}

function buildWledColorState(target: WledFixture, device: WledDevice | undefined, color: { r: number; g: number; b: number }) {
  if (isWledDeviceTargetId(target.id)) {
    return {
      on: true,
      seg: (device?.state?.seg?.length
        ? device.state.seg.map(seg => ({ id: seg.id, on: true, col: [[color.r, color.g, color.b]] }))
        : [{ id: 0, on: true, col: [[color.r, color.g, color.b]] }]),
    };
  }

  return {
    on: true,
    seg: [{ id: target.segmentId, on: true, col: [[color.r, color.g, color.b]] }],
  };
}

function buildWledBrightnessState(target: WledFixture, bri: number) {
  if (isWledDeviceTargetId(target.id)) {
    return { on: bri > 0, bri };
  }

  return {
    on: bri > 0,
    seg: [{ id: target.segmentId, on: bri > 0, bri }],
  };
}

// ── Main LIVE DJ Component ──

const DEFAULT_PAGES: LayoutPage[] = [
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
];

const DEFAULT_SCRIPTS: DJScript[] = [
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
];

const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  source: 'none', squelch: 10, gain: 128, udpPort: 11988, wledIp: '',
  sensitivity: 128, freqLow: 60, freqHigh: 200,
};

export function LiveDJ() {
  const store = useFixtureStore();
  const wledStore = useWledStore();
  const [tab, setTab] = useState<Tab>('controller');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [customColorPresets, setCustomColorPresets] = useState<{ label: string; mode: ColorProgramMode; colors: { r: number; g: number; b: number }[] }[]>(() => {
    try { return JSON.parse(localStorage.getItem('stokio-custom-color-presets') || '[]'); } catch { return []; }
  });
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editingPageName, setEditingPageName] = useState('');

  // ── Load from autosave or defaults ──
  const autosaved = useRef(loadAutosave());

  // ── Pages ──
  const [pages, setPages] = useState<LayoutPage[]>(() => autosaved.current?.pages || DEFAULT_PAGES);
  const [activePageId, setActivePageId] = useState(() => autosaved.current?.activePageId || 'page-1');
  const activePage = pages.find(p => p.id === activePageId) || pages[0];
  const widgets = activePage?.widgets || [];

  const setWidgets = (updater: DJWidget[] | ((prev: DJWidget[]) => DJWidget[])) => {
    setPages(prev => prev.map(p => p.id === activePageId
      ? { ...p, widgets: typeof updater === 'function' ? updater(p.widgets) : updater }
      : p
    ));
  };

  // ── Groups ──
  const [groups, setGroups] = useState<FixtureGroup[]>(() => autosaved.current?.groups || []);

  // ── Assignments & Scripts ──
  const [assignments, setAssignments] = useState<FixtureAssignment[]>(() =>
    autosaved.current?.assignments || store.instances.map(inst => ({ instanceId: inst.id, mode: 'buttons' as ControlMode }))
  );
  const [scripts, setScripts] = useState<DJScript[]>(() => autosaved.current?.scripts || DEFAULT_SCRIPTS);

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
  const lastWledSentRef = useRef<Record<string, string>>({});

  // ── Audio & BPM ──
  const [audioConfig, setAudioConfig] = useState<AudioConfig>(() => autosaved.current?.audioConfig || DEFAULT_AUDIO_CONFIG);
  const [bpmState, setBpmState] = useState<BPMState>({
    bpm: 120, tapTimes: [], isSynced: false, linkedWidgetIds: [], flashOn: false,
    bpmMode: 'auto', autoBpm: 0, audioLevel: 0,
    pioneerDecks: {}, pioneerSyncDeck: 0,
  });

  // ── Autosave: debounced persist on state changes ──
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      persistAutosave({ pages, groups, assignments, scripts, audioConfig, activePageId });
    }, 1000);
    return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); };
  }, [pages, groups, assignments, scripts, audioConfig, activePageId]);
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

  // ── WLED UDP Sound Sync → BPM detection via polling ──
  const wledBeatRef = useRef<{ peaks: number[]; lastVol: number; lastPeakTime: number }>({ peaks: [], lastVol: 0, lastPeakTime: 0 });
  const wledPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (wledPollRef.current) { clearInterval(wledPollRef.current); wledPollRef.current = null; }
    if (!audioConfig.source.startsWith('wled') || !audioConfig.wledIp) return;

    const ip = audioConfig.wledIp;
    const beatData = wledBeatRef.current;
    beatData.peaks = [];
    beatData.lastVol = 0;
    beatData.lastPeakTime = 0;

    const poll = async () => {
      try {
        const res = await fetch(`http://${ip}/json/si`, { signal: AbortSignal.timeout(1500) });
        if (!res.ok) return;
        const data = await res.json();
        // WLED sound-reactive info: data.leds.lx = volume/loudness estimate
        // or data.um?.AudioReactive?.volumeSmth or similar
        const um = data?.um;
        const ar = um?.['AudioReactive'] || um?.['audioreactive'] || {};
        const vol = Math.min(255, Math.max(0, ar?.volumeSmth ?? ar?.volume ?? ar?.inputLevel ?? data?.leds?.lx ?? 0));
        const now = Date.now();
        const threshold = audioConfig.squelch * 0.5 + 20;

        // Update audio level
        setBpmState(prev => ({ ...prev, audioLevel: vol }));

        // Simple beat detection: rising edge above threshold
        if (vol > threshold && beatData.lastVol <= threshold && now - beatData.lastPeakTime > 200) {
          beatData.lastPeakTime = now;
          beatData.peaks = [...beatData.peaks.filter(t => now - t < 6000), now];

          if (beatData.peaks.length >= 4) {
            const intervals = beatData.peaks.slice(1).map((t, i) => t - beatData.peaks[i]);
            const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            const detectedBpm = Math.round(60000 / avgInterval);
            if (detectedBpm >= 40 && detectedBpm <= 300) {
              setBpmState(prev => ({
                ...prev, autoBpm: detectedBpm,
                ...(prev.bpmMode === 'auto' ? { bpm: detectedBpm, isSynced: true } : {}),
              }));
            }
          }
        }
        beatData.lastVol = vol;
      } catch { /* device unreachable */ }
    };

    // Poll at ~50ms for responsive beat detection
    wledPollRef.current = setInterval(poll, 50);
    return () => { if (wledPollRef.current) clearInterval(wledPollRef.current); };
  }, [audioConfig.source, audioConfig.wledIp, audioConfig.squelch]);

  // ── Browser Mic → BPM detection via Web Audio API ──
  const micBpmRef = useRef<{ ctx: AudioContext | null; analyser: AnalyserNode | null; stream: MediaStream | null; raf: number; peaks: number[]; lastEnergy: number; lastPeakTime: number }>({
    ctx: null, analyser: null, stream: null, raf: 0, peaks: [], lastEnergy: 0, lastPeakTime: 0,
  });

  useEffect(() => {
    const mic = micBpmRef.current;
    // Cleanup previous
    const cleanup = () => {
      if (mic.raf) cancelAnimationFrame(mic.raf);
      mic.stream?.getTracks().forEach(t => t.stop());
      mic.ctx?.close().catch(() => {});
      mic.ctx = null; mic.analyser = null; mic.stream = null; mic.raf = 0;
      mic.peaks = []; mic.lastEnergy = 0; mic.lastPeakTime = 0;
    };

    if (audioConfig.source !== 'browser-mic') { cleanup(); return cleanup; }

    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        mic.ctx = ctx; mic.analyser = analyser; mic.stream = stream;

        const freqData = new Uint8Array(analyser.frequencyBinCount);
        const nyquist = ctx.sampleRate / 2;
        const binHz = nyquist / analyser.frequencyBinCount;

        const detect = () => {
          if (cancelled) return;
          analyser.getByteFrequencyData(freqData);

          // Filter to selected frequency range
          const lowBin = Math.max(0, Math.floor(audioConfig.freqLow / binHz));
          const highBin = Math.min(freqData.length - 1, Math.ceil(audioConfig.freqHigh / binHz));
          let sum = 0;
          let count = 0;
          for (let i = lowBin; i <= highBin; i++) {
            sum += freqData[i];
            count++;
          }
          const energy = count > 0 ? sum / count : 0;

          // Update audio level
          setBpmState(prev => ({ ...prev, audioLevel: Math.round(energy) }));

          const threshold = (255 - audioConfig.sensitivity) * 0.6 + 15;
          const now = Date.now();

          // Rising edge detection
          if (energy > threshold && mic.lastEnergy <= threshold && now - mic.lastPeakTime > 200) {
            mic.lastPeakTime = now;
            mic.peaks = [...mic.peaks.filter(t => now - t < 6000), now];

            if (mic.peaks.length >= 4) {
              const intervals = mic.peaks.slice(1).map((t, i) => t - mic.peaks[i]);
              const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
              const detectedBpm = Math.round(60000 / avgInterval);
              if (detectedBpm >= 40 && detectedBpm <= 300) {
                setBpmState(prev => ({
                  ...prev, autoBpm: detectedBpm,
                  ...(prev.bpmMode === 'auto' ? { bpm: detectedBpm, isSynced: true } : {}),
                }));
              }
            }
          }
          mic.lastEnergy = energy;
          mic.raf = requestAnimationFrame(detect);
        };
        mic.raf = requestAnimationFrame(detect);
      } catch {
        console.warn('Browser mic access denied for BPM detection');
      }
    })();

    return () => { cancelled = true; cleanup(); };
  }, [audioConfig.source, audioConfig.sensitivity, audioConfig.freqLow, audioConfig.freqHigh]);

  // ── System Audio → BPM detection via getDisplayMedia ──
  const sysAudioRef = useRef<{ ctx: AudioContext | null; analyser: AnalyserNode | null; stream: MediaStream | null; raf: number; peaks: number[]; lastEnergy: number; lastPeakTime: number; sourceName: string }>({
    ctx: null, analyser: null, stream: null, raf: 0, peaks: [], lastEnergy: 0, lastPeakTime: 0, sourceName: '',
  });

  useEffect(() => {
    const sys = sysAudioRef.current;
    const cleanup = () => {
      if (sys.raf) cancelAnimationFrame(sys.raf);
      sys.stream?.getTracks().forEach(t => t.stop());
      sys.ctx?.close().catch(() => {});
      sys.ctx = null; sys.analyser = null; sys.stream = null; sys.raf = 0;
      sys.peaks = []; sys.lastEnergy = 0; sys.lastPeakTime = 0; sys.sourceName = '';
    };

    if (audioConfig.source !== 'system-audio') { cleanup(); return cleanup; }

    let cancelled = false;
    (async () => {
      try {
        // getDisplayMedia with audio captures system/tab audio
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: 1, height: 1 }, // minimal video (required by API)
          audio: true,
        } as DisplayMediaStreamOptions);
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        // Stop video track — we only need audio
        stream.getVideoTracks().forEach(t => t.stop());

        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
          console.warn('No audio track from system audio capture');
          return;
        }

        sys.sourceName = audioTracks[0].label || 'System Audio';
        sys.stream = stream;

        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        sys.ctx = ctx; sys.analyser = analyser;

        const freqData = new Uint8Array(analyser.frequencyBinCount);
        const nyquist = ctx.sampleRate / 2;
        const binHz = nyquist / analyser.frequencyBinCount;

        const detect = () => {
          if (cancelled) return;
          analyser.getByteFrequencyData(freqData);
          const lowBin = Math.max(0, Math.floor(audioConfig.freqLow / binHz));
          const highBin = Math.min(freqData.length - 1, Math.ceil(audioConfig.freqHigh / binHz));
          let sum = 0, count = 0;
          for (let i = lowBin; i <= highBin; i++) { sum += freqData[i]; count++; }
          const energy = count > 0 ? sum / count : 0;
          setBpmState(prev => ({ ...prev, audioLevel: Math.round(energy) }));
          const threshold = (255 - audioConfig.sensitivity) * 0.6 + 15;
          const now = Date.now();
          if (energy > threshold && sys.lastEnergy <= threshold && now - sys.lastPeakTime > 200) {
            sys.lastPeakTime = now;
            sys.peaks = [...sys.peaks.filter(t => now - t < 6000), now];
            if (sys.peaks.length >= 4) {
              const intervals = sys.peaks.slice(1).map((t, i) => t - sys.peaks[i]);
              const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
              const detectedBpm = Math.round(60000 / avgInterval);
              if (detectedBpm >= 40 && detectedBpm <= 300) {
                setBpmState(prev => ({
                  ...prev, autoBpm: detectedBpm,
                  ...(prev.bpmMode === 'auto' ? { bpm: detectedBpm, isSynced: true } : {}),
                }));
              }
            }
          }
          sys.lastEnergy = energy;
          sys.raf = requestAnimationFrame(detect);
        };
        sys.raf = requestAnimationFrame(detect);

        // When user stops sharing, clean up
        audioTracks[0].onended = () => {
          if (!cancelled) setAudioConfig(prev => ({ ...prev, source: 'none' }));
        };
      } catch {
        console.warn('System audio capture denied or not supported');
        setAudioConfig(prev => ({ ...prev, source: 'none' }));
      }
    })();

    return () => { cancelled = true; cleanup(); };
  }, [audioConfig.source, audioConfig.sensitivity, audioConfig.freqLow, audioConfig.freqHigh]);

  // Expose system audio source name for bottom bar
  const systemAudioSourceName = sysAudioRef.current?.sourceName || '';

  // ── Pioneer DJ (ProDJ Link) listener ──
  useEffect(() => {
    if (audioConfig.source !== 'pioneer-dj') return;

    const unsub = onPioneerData((data: PioneerData) => {
      if (data.type === 'pioneer-decks' && data.decks) {
        setBpmState(prev => ({ ...prev, pioneerDecks: data.decks as Record<number, PioneerDeckLocal> }));
      }
      if (data.type === 'pioneer-beat' && data.bpm && data.bpm > 0) {
        const syncDeckNum = bpmState.pioneerSyncDeck;
        // Sync from specific deck or any playing deck
        const shouldSync = syncDeckNum === 0 || data.deviceNumber === syncDeckNum;
        if (shouldSync) {
          setBpmState(prev => ({
            ...prev,
            autoBpm: data.bpm!,
            audioLevel: Math.min(255, (data.beat || 1) * 64), // simulate beat pulse
            ...(prev.bpmMode === 'auto' ? { bpm: Math.round(data.bpm!), isSynced: true } : {}),
          }));
        }
      }
    });

    return unsub;
  }, [audioConfig.source, bpmState.pioneerSyncDeck]);

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
    setWidgets(prev => {
      const updated = prev.map(w => w.id === id ? { ...w, ...updates } : w);
      // Master/follow: if an xy-pad's pan/tilt or MH program changed, propagate to other xy-pads sharing fixtures
      if (updates.colorValue || updates.mhProgram) {
        const source = updated.find(w => w.id === id);
        if (source?.type === 'xy-pad' && source.linkedFixtureIds.length > 0) {
          const followers: { wid: string; delayMs: number; follow: Partial<DJWidget> }[] = [];
          const result = updated.map(w => {
            if (w.id === id || w.type !== 'xy-pad') return w;
            const shared = w.linkedFixtureIds.some(fid => source.linkedFixtureIds.includes(fid));
            if (!shared) return w;
            const follow: Partial<DJWidget> = {};
            if (updates.colorValue) follow.colorValue = updates.colorValue;
            if (updates.mhProgram) follow.mhProgram = updates.mhProgram;
            // Check delay from follower's own fixture configs
            const maxDelay = Math.max(0, ...(w.mhProgram?.fixtureConfigs || []).map(c => c.delayMs || 0));
            if (maxDelay > 0 && updates.colorValue) {
              // Schedule delayed position update
              followers.push({ wid: w.id, delayMs: maxDelay, follow });
              return w; // don't update immediately
            }
            return { ...w, ...follow };
          });
          // Schedule delayed followers outside setState
          if (followers.length > 0) {
            followers.forEach(({ wid, delayMs, follow }) => {
              setTimeout(() => {
                setWidgets(p => p.map(w2 => w2.id === wid ? { ...w2, ...follow } : w2));
              }, delayMs);
            });
          }
          return result;
        }
      }
      return updated;
    });
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
      color: type === 'wled-fixture' ? '#ff6600' : '#00e5ff',
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
      wledPresets: type === 'wled-preset' || type === 'wled-fixture' ? [] : undefined,
      wledPresetId: type === 'wled-preset' ? -1 : undefined,
      wledFixtureColor: type === 'wled-fixture' ? { r: 255, g: 0, b: 0 } : undefined,
      wledFixtureBrightness: type === 'wled-fixture' ? 128 : undefined,
      audioReactive: type === 'audio-reactive' ? { running: false, effects: [], globalDecay: 180, sensitivity: 160 } : undefined,
      eqTriggerZones: type === 'eq-trigger' ? [] : undefined,
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
  const wledDeviceVirtualFixtures = wledStore.devices.map(wledDeviceToVirtual);
  const wledSegmentVirtualFixtures = wledStore.fixtures.map(wledFixtureToVirtual);
  const allFixturesWithDefs = [...fixturesWithDefs, ...wledDeviceVirtualFixtures, ...wledSegmentVirtualFixtures];

  const selectedWidgetData = widgets.find(w => w.id === selectedWidget);

  // ── Link group to widget helper ──
  const linkGroupToWidget = (groupId: string) => {
    if (!selectedWidget) return;
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    updateWidget(selectedWidget, { linkedFixtureIds: [...new Set([...selectedWidgetData!.linkedFixtureIds, ...group.fixtureIds])] });
  };

  // ── Audio Reactive Engine Loop ──
  const arStateRef = useRef<{
    beatCount: number;
    lastBeatTime: number;
    currentLevel: Record<string, number>; // per-band energy levels
    colorIdx: Record<string, number>; // per-effect color cycle index
    posToggle: Record<string, boolean>; // per-effect position toggle
    presetIdx: Record<string, number>; // per-effect WLED preset index
    chasePos: Record<string, number>; // per-effect pixel chase position
  }>({ beatCount: 0, lastBeatTime: 0, currentLevel: {}, colorIdx: {}, posToggle: {}, presetIdx: {}, chasePos: {} });

  useEffect(() => {
    // Get audio analyser dynamically (mic/system audio are created async)
    const getAnalyser = (): AnalyserNode | null => {
      if (audioConfig.source === 'browser-mic') return micBpmRef.current?.analyser || null;
      if (audioConfig.source === 'system-audio') return sysAudioRef.current?.analyser || null;
      return null;
    };

    // Find all active audio-reactive widgets
    const arWidgets = widgets.filter(w => w.type === 'audio-reactive' && w.audioReactive?.running);
    if (arWidgets.length === 0) return;

    // Even without an analyser, BPM-based effects can still work from tap-tempo
    const arState = arStateRef.current;
    let raf = 0;
    let lastFrameTime = 0;

    // Helper: get frequency band energy from analyser
    const getBandEnergy = (freqData: Uint8Array | null, band: string, sampleRate: number, binCount: number): number => {
      if (!freqData || freqData.length === 0) return 0;
      const binHz = (sampleRate / 2) / binCount;
      let lo = 0, hi = freqData.length;
      if (band === 'bass') { lo = Math.floor(30 / binHz); hi = Math.ceil(200 / binHz); }
      else if (band === 'mid') { lo = Math.floor(200 / binHz); hi = Math.ceil(2000 / binHz); }
      else if (band === 'high') { lo = Math.floor(2000 / binHz); hi = Math.ceil(12000 / binHz); }
      let sum = 0, count = 0;
      for (let i = Math.max(0, lo); i < Math.min(freqData.length, hi); i++) { sum += freqData[i]; count++; }
      return count > 0 ? sum / count : 0;
    };

    // HSL to RGB helper
    const hslToRgb = (h: number, s: number, l: number): { r: number; g: number; b: number } => {
      const hh = ((h % 360) + 360) % 360;
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs((hh / 60) % 2 - 1));
      const m = l - c / 2;
      let r = 0, g = 0, b = 0;
      if (hh < 60) { r = c; g = x; } else if (hh < 120) { r = x; g = c; }
      else if (hh < 180) { g = c; b = x; } else if (hh < 240) { g = x; b = c; }
      else if (hh < 300) { r = x; b = c; } else { r = c; b = x; }
      return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
    };

    const tick = (now: number) => {
      if (now - lastFrameTime < 30) { raf = requestAnimationFrame(tick); return; } // ~33fps
      lastFrameTime = now;

      // Read analyser each frame so async mic/system audio is picked up
      const analyser = getAnalyser();
      let freqData: Uint8Array | null = null;
      let sampleRate = 44100;
      let binCount = 512;

      if (analyser) {
        freqData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freqData as any);
        sampleRate = analyser.context.sampleRate;
        binCount = analyser.frequencyBinCount;
      }

      // Beat detection from BPM state
      const beatInterval = bpmState.bpm > 0 ? 60000 / bpmState.bpm : 500;
      const isBeat = now - arState.lastBeatTime >= beatInterval;
      if (isBeat) {
        arState.lastBeatTime = now;
        arState.beatCount++;
      }

      // Process each AR widget
      arWidgets.forEach(w => {
        const arConfig = w.audioReactive!;
        const sensitivity = arConfig.sensitivity / 255;

        arConfig.effects.filter(fx => fx.enabled).forEach((fx, fxIdx) => {
          const fxKey = `${w.id}-${fxIdx}`;
          const band = fx.triggerBand || 'all';
          const energy = getBandEnergy(freqData, band, sampleRate, binCount) * sensitivity;
          const normalizedEnergy = Math.min(1, energy / 180); // 0-1
          const decayRate = (fx.decay || arConfig.globalDecay) / 255;
          const intensityScale = (fx.intensity || 200) / 255;

          // Find fixture
          const instData = allFixturesWithDefs.find(f => f.inst.id === fx.fixtureId);
          if (!instData) return;
          const isWled = instData.def.category === 'wled';

          // Smooth current level
          const prevLevel = arState.currentLevel[fxKey] || 0;
          const targetLevel = normalizedEnergy * intensityScale;
          arState.currentLevel[fxKey] = Math.max(targetLevel, prevLevel * decayRate);
          const level = arState.currentLevel[fxKey];

          switch (fx.effect) {
            case 'dimmer-pump': {
              const dmxVal = Math.round(level * 255);
              if (isWled) {
                const wledFix = [...wledStore.fixtures, ...wledStore.devices.map(wledDeviceToFixture)].find(f => f.id === fx.fixtureId);
                if (wledFix) void setWledState(wledFix.deviceIp, { on: dmxVal > 5, bri: Math.max(1, dmxVal) }).catch(() => {});
              } else {
                const inst = instData.inst;
                const def = instData.def;
                const mode = def.modes.find(m => m.id === inst.modeId) || def.modes[0];
                const dimCh = mode?.channels.find(c => c.function === 'dimmer');
                if (dimCh) {
                  sendDmxChannel(inst.universe, inst.dmxAddress + dimCh.number - 1, dmxVal);
                }
              }
              break;
            }
            case 'color-pulse': {
              if (isBeat && fx.color1) {
                const c = fx.color1;
                if (isWled) {
                  const wledFix = [...wledStore.fixtures, ...wledStore.devices.map(wledDeviceToFixture)].find(f => f.id === fx.fixtureId);
                  if (wledFix) void setWledState(wledFix.deviceIp, { on: true, seg: [{ id: 0, col: [[c.r, c.g, c.b]] }] }).catch(() => {});
                } else {
                  const inst = instData.inst;
                  const def = instData.def;
                  const mode = def.modes.find(m => m.id === inst.modeId) || def.modes[0];
                  const rCh = mode?.channels.find(ch => ch.function === 'red');
                  const gCh = mode?.channels.find(ch => ch.function === 'green');
                  const bCh = mode?.channels.find(ch => ch.function === 'blue');
                  if (rCh) sendDmxChannel(inst.universe, inst.dmxAddress + rCh.number - 1, c.r);
                  if (gCh) sendDmxChannel(inst.universe, inst.dmxAddress + gCh.number - 1, c.g);
                  if (bCh) sendDmxChannel(inst.universe, inst.dmxAddress + bCh.number - 1, c.b);
                  const dimCh = mode?.channels.find(ch => ch.function === 'dimmer');
                  if (dimCh) sendDmxChannel(inst.universe, inst.dmxAddress + dimCh.number - 1, 255);
                }
              }
              break;
            }
            case 'strobe-beat': {
              if (isBeat) {
                if (!isWled) {
                  const inst = instData.inst;
                  const def = instData.def;
                  const mode = def.modes.find(m => m.id === inst.modeId) || def.modes[0];
                  const strobeCh = mode?.channels.find(c => c.function === 'strobe');
                  const dimCh = mode?.channels.find(c => c.function === 'dimmer');
                  if (strobeCh) sendDmxChannel(inst.universe, inst.dmxAddress + strobeCh.number - 1, 200);
                  if (dimCh) sendDmxChannel(inst.universe, inst.dmxAddress + dimCh.number - 1, 255);
                  setTimeout(() => {
                    if (strobeCh) sendDmxChannel(inst.universe, inst.dmxAddress + strobeCh.number - 1, 0);
                  }, 80);
                } else {
                  const wledFix = [...wledStore.fixtures, ...wledStore.devices.map(wledDeviceToFixture)].find(f => f.id === fx.fixtureId);
                  if (wledFix) {
                    void setWledState(wledFix.deviceIp, { on: true, bri: 255 }).catch(() => {});
                    setTimeout(() => { void setWledState(wledFix.deviceIp, { bri: 0 }).catch(() => {}); }, 80);
                  }
                }
              }
              break;
            }
            case 'pos-alternate': {
              if (isBeat) {
                arState.posToggle[fxKey] = !arState.posToggle[fxKey];
                const pos = arState.posToggle[fxKey] ? fx.posA : fx.posB;
                if (pos && !isWled) {
                  const inst = instData.inst;
                  const def = instData.def;
                  const mode = def.modes.find(m => m.id === inst.modeId) || def.modes[0];
                  const panCh = mode?.channels.find(c => c.function === 'pan');
                  const tiltCh = mode?.channels.find(c => c.function === 'tilt');
                  if (panCh) sendDmxChannel(inst.universe, inst.dmxAddress + panCh.number - 1, pos.pan);
                  if (tiltCh) sendDmxChannel(inst.universe, inst.dmxAddress + tiltCh.number - 1, pos.tilt);
                }
              }
              break;
            }
            case 'color-cycle': {
              if (isBeat && fx.color1 && fx.color2) {
                arState.colorIdx[fxKey] = ((arState.colorIdx[fxKey] || 0) + 1) % 2;
                const c = arState.colorIdx[fxKey] === 0 ? fx.color1 : fx.color2;
                if (isWled) {
                  const wledFix = [...wledStore.fixtures, ...wledStore.devices.map(wledDeviceToFixture)].find(f => f.id === fx.fixtureId);
                  if (wledFix) void setWledState(wledFix.deviceIp, { on: true, seg: [{ id: 0, col: [[c.r, c.g, c.b]] }] }).catch(() => {});
                } else {
                  const inst = instData.inst;
                  const def = instData.def;
                  const mode = def.modes.find(m => m.id === inst.modeId) || def.modes[0];
                  const rCh = mode?.channels.find(ch => ch.function === 'red');
                  const gCh = mode?.channels.find(ch => ch.function === 'green');
                  const bCh = mode?.channels.find(ch => ch.function === 'blue');
                  if (rCh) sendDmxChannel(inst.universe, inst.dmxAddress + rCh.number - 1, c.r);
                  if (gCh) sendDmxChannel(inst.universe, inst.dmxAddress + gCh.number - 1, c.g);
                  if (bCh) sendDmxChannel(inst.universe, inst.dmxAddress + bCh.number - 1, c.b);
                }
              }
              break;
            }
            case 'bass-color-shift': {
              const hue = normalizedEnergy * 120; // shifts from red(0) to green(120) with bass
              const c = hslToRgb(hue, 1, 0.5);
              if (isWled) {
                const wledFix = [...wledStore.fixtures, ...wledStore.devices.map(wledDeviceToFixture)].find(f => f.id === fx.fixtureId);
                if (wledFix) void setWledState(wledFix.deviceIp, { on: true, seg: [{ id: 0, col: [[c.r, c.g, c.b]] }] }).catch(() => {});
              } else {
                const inst = instData.inst;
                const def = instData.def;
                const mode = def.modes.find(m => m.id === inst.modeId) || def.modes[0];
                const rCh = mode?.channels.find(ch => ch.function === 'red');
                const gCh = mode?.channels.find(ch => ch.function === 'green');
                const bCh = mode?.channels.find(ch => ch.function === 'blue');
                if (rCh) sendDmxChannel(inst.universe, inst.dmxAddress + rCh.number - 1, c.r);
                if (gCh) sendDmxChannel(inst.universe, inst.dmxAddress + gCh.number - 1, c.g);
                if (bCh) sendDmxChannel(inst.universe, inst.dmxAddress + bCh.number - 1, c.b);
              }
              break;
            }
            case 'wled-preset-cycle': {
              if (isBeat && isWled && fx.wledPresets && fx.wledPresets.length > 0) {
                arState.presetIdx[fxKey] = ((arState.presetIdx[fxKey] || 0) + 1) % fx.wledPresets.length;
                const presetId = fx.wledPresets[arState.presetIdx[fxKey]];
                const wledFix = [...wledStore.fixtures, ...wledStore.devices.map(wledDeviceToFixture)].find(f => f.id === fx.fixtureId);
                if (wledFix) void setWledPreset(wledFix.deviceIp, presetId).catch(() => {});
              }
              break;
            }
            case 'wled-pixel-chase': {
              if (isBeat && isWled && fx.color1) {
                const wledFix = [...wledStore.fixtures, ...wledStore.devices.map(wledDeviceToFixture)].find(f => f.id === fx.fixtureId);
                if (wledFix) {
                  const dev = wledStore.devices.find(d => d.id === wledFix.deviceId);
                  const ledCount = dev?.info?.leds?.count || instData.def.wledConfig?.ledCount || 30;
                  arState.chasePos[fxKey] = 0;
                  const c = fx.color1;
                  // Send chase effect: use WLED effect 45 (Scan) with the color
                  void setWledState(wledFix.deviceIp, {
                    on: true,
                    seg: [{ id: 0, col: [[c.r, c.g, c.b], [0, 0, 0]], fx: 45, sx: 200, ix: Math.round(intensityScale * 255) }],
                  }).catch(() => {});
                }
              }
              break;
            }
            case 'intensity-map': {
              const dmxVal = Math.round(level * 255);
              if (isWled) {
                const wledFix = [...wledStore.fixtures, ...wledStore.devices.map(wledDeviceToFixture)].find(f => f.id === fx.fixtureId);
                if (wledFix) void setWledState(wledFix.deviceIp, { on: dmxVal > 5, bri: Math.max(1, dmxVal) }).catch(() => {});
              } else {
                const inst = instData.inst;
                const def = instData.def;
                const mode = def.modes.find(m => m.id === inst.modeId) || def.modes[0];
                const dimCh = mode?.channels.find(c => c.function === 'dimmer');
                if (dimCh) sendDmxChannel(inst.universe, inst.dmxAddress + dimCh.number - 1, dmxVal);
              }
              break;
            }
            case 'hue-sweep': {
              const hue = normalizedEnergy * 360;
              const c = hslToRgb(hue, 1, 0.5);
              if (isWled) {
                const wledFix = [...wledStore.fixtures, ...wledStore.devices.map(wledDeviceToFixture)].find(f => f.id === fx.fixtureId);
                if (wledFix) void setWledState(wledFix.deviceIp, { on: true, seg: [{ id: 0, col: [[c.r, c.g, c.b]] }] }).catch(() => {});
              } else {
                const inst = instData.inst;
                const def = instData.def;
                const mode = def.modes.find(m => m.id === inst.modeId) || def.modes[0];
                const rCh = mode?.channels.find(ch => ch.function === 'red');
                const gCh = mode?.channels.find(ch => ch.function === 'green');
                const bCh = mode?.channels.find(ch => ch.function === 'blue');
                if (rCh) sendDmxChannel(inst.universe, inst.dmxAddress + rCh.number - 1, c.r);
                if (gCh) sendDmxChannel(inst.universe, inst.dmxAddress + gCh.number - 1, c.g);
                if (bCh) sendDmxChannel(inst.universe, inst.dmxAddress + bCh.number - 1, c.b);
              }
              break;
            }
            case 'size-pulse': {
              if (!isWled) {
                const dmxVal = Math.round(level * 255);
                const inst = instData.inst;
                const def = instData.def;
                const mode = def.modes.find(m => m.id === inst.modeId) || def.modes[0];
                const zoomCh = mode?.channels.find(c => c.function === 'zoom');
                const irisCh = mode?.channels.find(c => c.function === 'iris');
                if (zoomCh) sendDmxChannel(inst.universe, inst.dmxAddress + zoomCh.number - 1, dmxVal);
                else if (irisCh) sendDmxChannel(inst.universe, inst.dmxAddress + irisCh.number - 1, dmxVal);
              }
              break;
            }
          }
        });
      });

      if (document.hidden) {
        raf = window.setTimeout(tick, 33) as unknown as number;
      } else {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); clearTimeout(raf); };
  }, [widgets, audioConfig.source, bpmState.bpm, allFixturesWithDefs, wledStore.devices, wledStore.fixtures]);

  useEffect(() => {
    const nextSent: Record<string, string> = {};
    const wledOutputFixtures = [
      ...wledStore.devices.map(wledDeviceToFixture),
      ...wledStore.fixtures,
    ];
    const wledFixMap = new Map(wledOutputFixtures.map(f => [f.id, f]));
    const wledDevMap = new Map(wledStore.devices.map(dev => [dev.id, dev]));

    widgets.forEach(w => {
      const linkedWled = w.linkedFixtureIds.map(id => wledFixMap.get(id)).filter((f): f is WledFixture => !!f);
      if (linkedWled.length === 0) return;

      // Color wheel → set color on linked WLED fixtures
      if (w.type === 'color-wheel' && w.colorValue) {
        const { r, g, b } = w.colorValue;
        linkedWled.forEach(fix => {
          const key = `color-${fix.id}`;
          const val = `${r},${g},${b}`;
          nextSent[key] = val;
          if (lastWledSentRef.current[key] === val) return;
          void setWledState(fix.deviceIp, buildWledColorState(fix, wledDevMap.get(fix.deviceId), { r, g, b })).catch(() => {});
        });
      }

      // Slider (dimmer) → set brightness
      if (w.type === 'slider' && (w.linkedFunction === 'dimmer' || !w.linkedFunction)) {
        const bri = Math.max(0, Math.min(255, Math.round(((w.value ?? 0) / 100) * 255)));
        linkedWled.forEach(fix => {
          const key = `bri-${fix.id}`;
          const val = String(bri);
          nextSent[key] = val;
          if (lastWledSentRef.current[key] === val) return;
          void setWledState(fix.deviceIp, buildWledBrightnessState(fix, bri)).catch(() => {});
        });
      }

      // WLED preset widget → activate preset
      if (w.type === 'wled-preset' && w.wledPresetId !== undefined && w.wledPresetId >= 0) {
        const ips = [...new Set([...(w.wledIp ? [w.wledIp] : []), ...linkedWled.map(f => f.deviceIp)])];
        ips.forEach(ip => {
          const key = `preset-${ip}`;
          const val = String(w.wledPresetId);
          nextSent[key] = val;
          if (lastWledSentRef.current[key] === val) return;
          void setWledPreset(ip, w.wledPresetId!).catch(() => {});
        });
      }
    });

    lastWledSentRef.current = nextSent;
  }, [widgets, wledStore.devices, wledStore.fixtures]);

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
              { id: 'mixer' as Tab, label: '🎚️ DMX Mixer' },
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
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 bg-background">
          <div className="flex items-center gap-2">
            <Speaker size={14} className="text-stokio-pink" />
            <span className="text-xs font-semibold tracking-wider text-muted-foreground">LIVE DJ</span>
          </div>
          <Button variant="outline" size="lg" className="h-12 px-6 gap-2 text-sm font-semibold border-border/50 hover:bg-muted/30" onClick={() => setIsFullscreen(false)}>
            <Minimize2 size={18} />
            EXIT FULLSCREEN
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
              {/* Tab background image */}
              {activePage?.bgImage && (
                <div className="absolute inset-0 pointer-events-none z-[0]"
                  style={{
                    backgroundImage: `url(${activePage.bgImage})`,
                    backgroundSize: (activePage.bgFit || 'fill') === 'fill' ? 'cover' : 'contain',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                    opacity: (activePage.bgOpacity ?? 30) / 100,
                  }} />
              )}

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
                          const wledInst = allFixturesWithDefs.find(f => f.inst.id === entry.targetId);
                          const wledIp = wledInst?.def.wledConfig?.ip;
                          const wledTarget = [...wledStore.devices.map(wledDeviceToFixture), ...wledStore.fixtures].find(f => f.id === entry.targetId);
                          const wledDevice = wledTarget ? wledStore.devices.find(dev => dev.id === wledTarget.deviceId) : undefined;
                          if (wledIp && entry.wledPresetId !== undefined) {
                            void setWledPreset(wledIp, entry.wledPresetId).catch(() => {});
                          }
                          // Also apply color if set
                          if (wledIp && entry.color && wledTarget) {
                            void setWledState(wledIp, buildWledColorState(wledTarget, wledDevice, entry.color)).catch(() => {});
                          }
                          if (wledIp && !entry.color && entry.dimmer !== undefined && wledTarget) {
                            void setWledState(wledIp, buildWledBrightnessState(wledTarget, entry.dimmer)).catch(() => {});
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
                  fixtureData={allFixturesWithDefs}
                  isFullscreen={isFullscreen}
                  bpm={bpmState.bpm}
                  bpmState={bpmState}
                  audioConfig={audioConfig}
                  handleTap={handleTap}
                  setBpmState={setBpmState}
                  setAudioConfig={setAudioConfig}
                  analyserNode={(() => {
                    if (audioConfig.source === 'browser-mic') return micBpmRef.current?.analyser || null;
                    if (audioConfig.source === 'system-audio') return sysAudioRef.current?.analyser || null;
                    return null;
                  })()}
                  sampleRate={(() => {
                    if (audioConfig.source === 'browser-mic') return micBpmRef.current?.ctx?.sampleRate || 44100;
                    if (audioConfig.source === 'system-audio') return sysAudioRef.current?.ctx?.sampleRate || 44100;
                    return 44100;
                  })()}
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
                  <>
                    <div>
                      <label className="text-[7px] uppercase text-muted-foreground">WLED Device IP</label>
                      <Input type="text" placeholder="192.168.1.x" value={audioConfig.wledIp}
                        onChange={e => setAudioConfig(prev => ({ ...prev, wledIp: e.target.value }))}
                        className="h-6 text-[10px] bg-muted/20 border-border/20 font-mono" />
                    </div>
                    <div>
                      <label className="text-[7px] uppercase text-muted-foreground">UDP Port</label>
                      <Input type="number" value={audioConfig.udpPort}
                        onChange={e => setAudioConfig(prev => ({ ...prev, udpPort: Number(e.target.value) }))}
                        className="h-6 text-[10px] bg-muted/20 border-border/20 font-mono" />
                    </div>
                  </>
                )}
                {/* Pioneer DJ (ProDJ Link) settings */}
                {audioConfig.source === 'pioneer-dj' && (
                  <div className="space-y-2">
                    <div className="text-[8px] text-muted-foreground/60 bg-muted/10 rounded p-1.5 border border-border/10">
                      🎛 Connect your Pioneer CDJ/DJM/XDJ to the same network. The engine server listens on ports 50000-50001 for ProDJ Link packets.
                    </div>
                    {Object.keys(bpmState.pioneerDecks).length === 0 ? (
                      <div className="text-[9px] text-muted-foreground/40 text-center py-3">
                        <Radio size={16} className="mx-auto mb-1 animate-pulse text-muted-foreground/30" />
                        Waiting for Pioneer devices…
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <label className="text-[7px] uppercase text-muted-foreground tracking-wider">Detected Decks</label>
                        {Object.values(bpmState.pioneerDecks).map((deck) => (
                          <button key={deck.deviceNumber}
                            onClick={() => setBpmState(prev => ({ ...prev, pioneerSyncDeck: prev.pioneerSyncDeck === deck.deviceNumber ? 0 : deck.deviceNumber }))}
                            className={`w-full flex items-center gap-2 p-2 rounded border transition-all text-left ${
                              bpmState.pioneerSyncDeck === deck.deviceNumber || bpmState.pioneerSyncDeck === 0
                                ? 'border-primary/40 bg-primary/5'
                                : 'border-border/20 bg-muted/10 opacity-50'
                            }`}>
                            <div className={`w-2 h-2 rounded-full ${deck.playing ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]' : 'bg-muted-foreground/30'}`} />
                            <div className="flex-1 min-w-0">
                              <div className="text-[9px] font-semibold text-foreground truncate">{deck.name}</div>
                              <div className="text-[7px] text-muted-foreground/60 font-mono">{deck.ip} • CH {deck.deviceNumber}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-bold font-mono text-primary">{deck.bpm > 0 ? deck.bpm.toFixed(1) : '—'}</div>
                              <div className="text-[6px] uppercase text-muted-foreground">BPM</div>
                            </div>
                            {deck.playing && deck.beat > 0 && (
                              <div className="flex gap-0.5">
                                {[1, 2, 3, 4].map(b => (
                                  <div key={b} className={`w-1.5 h-1.5 rounded-full transition-all ${
                                    b === deck.beat ? 'bg-primary shadow-[0_0_4px_hsl(var(--primary))]' : 'bg-muted-foreground/20'
                                  }`} />
                                ))}
                              </div>
                            )}
                          </button>
                        ))}
                        <div className="text-[7px] text-muted-foreground/40">
                          {bpmState.pioneerSyncDeck === 0 ? '🔗 Syncing from any playing deck' : `🔗 Syncing from CH ${bpmState.pioneerSyncDeck} only`}
                          {' — click a deck to toggle'}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {(audioConfig.source === 'browser-mic' || audioConfig.source === 'system-audio') && (
                  <div className="space-y-2">
                    {audioConfig.source === 'system-audio' && systemAudioSourceName && (
                      <div className="text-[8px] text-primary bg-primary/5 rounded p-1.5 border border-primary/20">
                        🎵 Capturing: <strong>{systemAudioSourceName}</strong>
                      </div>
                    )}
                    <div>
                      <label className="text-[7px] uppercase text-muted-foreground">Sensitivity</label>
                      <Slider value={[audioConfig.sensitivity]} onValueChange={([v]) => setAudioConfig(prev => ({ ...prev, sensitivity: v }))} max={255} className="mt-1" />
                      <span className="text-[7px] font-mono text-muted-foreground/50">{audioConfig.sensitivity}</span>
                    </div>
                    <div>
                      <label className="text-[7px] uppercase text-muted-foreground">Freq Low (Hz)</label>
                      <Slider value={[audioConfig.freqLow]} onValueChange={([v]) => setAudioConfig(prev => ({ ...prev, freqLow: Math.min(v, prev.freqHigh - 10) }))} min={20} max={8000} step={10} className="mt-1" />
                      <span className="text-[7px] font-mono text-muted-foreground/50">{audioConfig.freqLow} Hz</span>
                    </div>
                    <div>
                      <label className="text-[7px] uppercase text-muted-foreground">Freq High (Hz)</label>
                      <Slider value={[audioConfig.freqHigh]} onValueChange={([v]) => setAudioConfig(prev => ({ ...prev, freqHigh: Math.max(v, prev.freqLow + 10) }))} min={20} max={16000} step={10} className="mt-1" />
                      <span className="text-[7px] font-mono text-muted-foreground/50">{audioConfig.freqHigh} Hz</span>
                    </div>
                    <div className="text-[7px] text-muted-foreground/40 bg-muted/10 rounded p-1.5">
                      💡 {audioConfig.source === 'system-audio' ? 'Select a Chrome tab or application to capture its audio. Works with Spotify, YouTube, etc.' : 'Low freq (60-200 Hz) = kick/bass detection. High freq (2k-8k Hz) = hi-hat/snare detection.'}
                    </div>
                  </div>
                )}
              </div>

              {/* BPM / Tap Tempo — visible for all audio sources except 'none' */}
              {audioConfig.source !== 'none' && <div className="p-3 border-b border-border/20 space-y-2">
                <span className="text-[9px] uppercase tracking-widest text-stokio-pink font-semibold flex items-center gap-1">
                  <Activity size={10} /> BPM / Tap Tempo
                </span>

                {/* Auto / Manual toggle */}
                <div className="flex rounded-md border border-border/20 overflow-hidden">
                  <button
                    className={`flex-1 text-[8px] py-1 font-semibold transition-all ${bpmState.bpmMode === 'manual' ? 'bg-stokio-pink/20 text-stokio-pink' : 'text-muted-foreground hover:bg-muted/20'}`}
                    onClick={() => setBpmState(prev => ({ ...prev, bpmMode: 'manual' }))}>
                    <Hand size={9} className="inline mr-0.5" /> MANUAL TAP
                  </button>
                  <button
                    className={`flex-1 text-[8px] py-1 font-semibold transition-all ${bpmState.bpmMode === 'auto' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-muted/20'}`}
                    onClick={() => setBpmState(prev => ({ ...prev, bpmMode: 'auto' }))}>
                    <Sparkles size={9} className="inline mr-0.5" /> AUTO DETECT
                  </button>
                </div>

                {/* Audio Input Level Meter */}
                {audioConfig.source !== 'tap-tempo' && (
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[7px] uppercase text-muted-foreground tracking-wider">Input Level</span>
                      <span className="text-[7px] font-mono text-muted-foreground/60">{bpmState.audioLevel}/255</span>
                    </div>
                    <div className="h-3 rounded-full bg-muted/30 overflow-hidden border border-border/10">
                      <motion.div className="h-full rounded-full"
                        animate={{ width: `${Math.round((bpmState.audioLevel / 255) * 100)}%` }}
                        transition={{ duration: 0.05 }}
                        style={{
                          background: bpmState.audioLevel > 200 ? 'linear-gradient(90deg, #00ff66, #ff4444)' :
                            bpmState.audioLevel > 100 ? 'linear-gradient(90deg, #00ff66, #ffaa00)' :
                            'linear-gradient(90deg, #00ff6640, #00ff66)',
                        }} />
                    </div>
                    {bpmState.autoBpm > 0 && (
                      <div className="text-[8px] text-muted-foreground/60 font-mono mt-1">
                        AI Detected: <span className="text-primary font-semibold">{bpmState.autoBpm}</span> BPM
                        {bpmState.bpmMode === 'manual' && (
                          <button className="ml-1 text-primary/60 hover:text-primary underline"
                            onClick={() => setBpmState(prev => ({ ...prev, bpm: prev.autoBpm, isSynced: true }))}>
                            Use
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <motion.button whileTap={{ scale: 0.9 }} onClick={handleTap}
                    className="w-16 h-16 rounded-full control-glossy border-2 flex flex-col items-center justify-center transition-all"
                    style={{
                      borderColor: bpmState.flashOn ? '#ff2d78' : 'hsl(var(--border) / 0.3)',
                      boxShadow: bpmState.flashOn ? '0 0 25px #ff2d7860, inset 0 0 15px #ff2d7820' : 'none',
                      background: bpmState.flashOn ? 'radial-gradient(circle at center, #ff2d7815, transparent)' : undefined,
                      opacity: bpmState.bpmMode === 'auto' && audioConfig.source !== 'tap-tempo' ? 0.4 : 1,
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
              </div>}

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
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-5 text-[8px]" onClick={() => duplicateWidget(selectedWidgetData.id)} title="Duplicate widget">
                        <Copy size={10} />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-5 text-[8px] text-destructive" onClick={() => removeWidget(selectedWidgetData.id)}>
                        <Trash2 size={10} />
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[7px] uppercase text-muted-foreground">Label</label>
                    <Input value={selectedWidgetData.label}
                      onChange={e => updateWidget(selectedWidgetData.id, { label: e.target.value })}
                      className="h-6 text-[10px] bg-muted/20 border-border/20" />
                  </div>

                  <div>
                    <label className="text-[7px] uppercase text-muted-foreground">
                      {selectedWidgetData.type === 'slider' ? 'Fader Color' : 'Background Color'}
                    </label>
                    <div className="flex gap-1">
                      <Input type="color" value={selectedWidgetData.color}
                        onChange={e => updateWidget(selectedWidgetData.id, { color: e.target.value })}
                        className="h-6 w-10 p-0 bg-transparent border-0 cursor-pointer" />
                      <Input value={selectedWidgetData.color}
                        onChange={e => updateWidget(selectedWidgetData.id, { color: e.target.value })}
                        className="h-6 text-[10px] bg-muted/20 border-border/20 font-mono flex-1" />
                    </div>
                    {/* Fader color sync with color wheel widget */}
                    {selectedWidgetData.type === 'slider' && (() => {
                      const colorWidgets = widgets.filter(w => w.type === 'color-wheel');
                      return colorWidgets.length > 0 ? (
                        <div className="mt-1.5">
                          <label className="text-[7px] uppercase text-muted-foreground">Sync Fader Color with Color Widget</label>
                          <select
                            value={selectedWidgetData.faderColorSyncWidgetId || ''}
                            onChange={e => updateWidget(selectedWidgetData.id, { faderColorSyncWidgetId: e.target.value || null })}
                            className="w-full h-6 rounded bg-muted/20 border border-border/20 text-[10px] px-1 text-foreground mt-0.5">
                            <option value="">None (use fader color)</option>
                            {colorWidgets.map(cw => (
                              <option key={cw.id} value={cw.id}>{cw.label}</option>
                            ))}
                          </select>
                          {selectedWidgetData.faderColorSyncWidgetId && (
                            <div className="text-[7px] text-primary/60 mt-0.5">✓ Fader fill follows live color</div>
                          )}
                        </div>
                      ) : null;
                    })()}
                  </div>

                  {/* Background Color — only for slider widgets */}
                  {selectedWidgetData.type === 'slider' && (
                    <div>
                      <label className="text-[7px] uppercase text-muted-foreground">Background Color</label>
                      <div className="flex gap-1">
                        <Input type="color" value={selectedWidgetData.bgColor || '#1a1a2e'}
                          onChange={e => updateWidget(selectedWidgetData.id, { bgColor: e.target.value })}
                          className="h-6 w-10 p-0 bg-transparent border-0 cursor-pointer" />
                        <Input value={selectedWidgetData.bgColor || ''}
                          onChange={e => updateWidget(selectedWidgetData.id, { bgColor: e.target.value })}
                          placeholder="Default"
                          className="h-6 text-[10px] bg-muted/20 border-border/20 font-mono flex-1" />
                        {selectedWidgetData.bgColor && (
                          <Button variant="ghost" size="sm" className="h-6 px-1 text-muted-foreground"
                            onClick={() => updateWidget(selectedWidgetData.id, { bgColor: undefined })}>
                            <X size={10} />
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

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
                          {allFixturesWithDefs.filter(f => f.def.category === 'wled').length > 0 && (
                            <div>
                              <span className="text-[7px] text-muted-foreground/60">WLED Fixtures:</span>
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {allFixturesWithDefs.filter(f => f.def.category === 'wled').map(({ inst, def }) => {
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
                            const wledDef = isWled ? allFixturesWithDefs.find(f => f.inst.id === entry.targetId)?.def : null;
                            const name = isFixture
                              ? allFixturesWithDefs.find(f => f.inst.id === entry.targetId)?.inst.name || entry.targetId
                              : isWled
                                ? allFixturesWithDefs.find(f => f.inst.id === entry.targetId)?.inst.name || entry.targetId
                                : groups.find(g => g.id === entry.targetId)?.name || entry.targetId;
                            const icon = isFixture
                              ? getFixtureTypeIcon(allFixturesWithDefs.find(f => f.inst.id === entry.targetId)?.def.type || 'other')
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
                              ...(selectedWidgetData.mhProgram || { pattern: 'circle', speed: 128, size: 50, bpmSync: false, running: false, fixtureConfigs: [] }),
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
                          <Slider value={[selectedWidgetData.mhProgram?.speed || 128]}
                            onValueChange={([v]) => updateWidget(selectedWidgetData.id, {
                              mhProgram: { ...(selectedWidgetData.mhProgram || { pattern: 'circle', speed: 128, size: 50, bpmSync: false, running: false, fixtureConfigs: [] }), speed: v },
                            })} max={255} className="mt-1" />
                          <span className="text-[7px] font-mono text-muted-foreground/50">{selectedWidgetData.mhProgram?.speed || 128}</span>
                        </div>
                        <div>
                          <label className="text-[7px] uppercase text-muted-foreground">Size</label>
                          <Slider value={[selectedWidgetData.mhProgram?.size || 50]}
                            onValueChange={([v]) => updateWidget(selectedWidgetData.id, {
                              mhProgram: { ...(selectedWidgetData.mhProgram || { pattern: 'circle', speed: 128, size: 50, bpmSync: false, running: false, fixtureConfigs: [] }), size: v },
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
                            mhProgram: { ...(selectedWidgetData.mhProgram || { pattern: 'circle', speed: 128, size: 50, bpmSync: false, running: false, fixtureConfigs: [] }),
                              running: !selectedWidgetData.mhProgram?.running },
                          })}>
                          {selectedWidgetData.mhProgram?.running ? <><Square size={9} /> Stop</> : <><Play size={9} /> Run</>}
                        </Button>
                        <Button size="sm" variant="outline" className={`h-6 text-[9px] gap-1 ${selectedWidgetData.mhProgram?.bpmSync ? 'bg-stokio-pink/10 text-stokio-pink border-stokio-pink/30' : ''}`}
                          onClick={() => updateWidget(selectedWidgetData.id, {
                            mhProgram: { ...(selectedWidgetData.mhProgram || { pattern: 'circle', speed: 128, size: 50, bpmSync: false, running: false, fixtureConfigs: [] }),
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
                            const inst = allFixturesWithDefs.find(f => f.inst.id === fid);
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
                                mhProgram: { ...(selectedWidgetData.mhProgram || { pattern: 'circle', speed: 128, size: 50, bpmSync: false, running: false, fixtureConfigs: [] }),
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
                                  <Input type="number" min={0} step={0.05} value={Number((cfg.delayMs / 1000).toFixed(3))}
                                    onChange={e => updateCfg({ delayMs: Math.round(Number(e.target.value) * 1000) })}
                                    className="h-5 w-16 text-[9px] bg-muted/20 border-border/20 font-mono px-1" />
                                  <span className="text-[7px] text-muted-foreground/50">sec</span>
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
                      const fd = allFixturesWithDefs.find(f => f.inst.id === fid);
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

                  {/* Color Program settings for color-wheel */}
                  {selectedWidgetData.type === 'color-wheel' && (() => {
                    const prog = selectedWidgetData.colorProgram || { mode: 'static' as ColorProgramMode, colors: [], speed: 128, bpmSync: false, running: false };
                    const defaultProg: ColorProgram = { mode: 'static', colors: [], speed: 128, bpmSync: false, running: false };
                    return (
                      <div className="space-y-2 border-t border-border/20 pt-2">
                        <label className="text-[8px] uppercase tracking-widest text-stokio-cyan font-semibold flex items-center gap-1">
                          <Sparkles size={10} /> Color Program
                        </label>

                        {/* Mode selector */}
                        <div>
                          <label className="text-[7px] uppercase text-muted-foreground">Mode</label>
                          <div className="flex gap-1 mt-1">
                            {([['static', 'Static'], ['switch', 'Switch'], ['fade', 'Fade']] as [ColorProgramMode, string][]).map(([m, lbl]) => (
                              <button key={m}
                                onClick={() => updateWidget(selectedWidgetData.id, {
                                  colorProgram: { ...prog, mode: m, running: m !== 'static' && prog.running },
                                })}
                                className={`flex-1 h-6 rounded text-[9px] font-semibold border transition-all ${
                                  prog.mode === m ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border/20 text-muted-foreground hover:border-border/40'
                                }`}>{lbl}</button>
                            ))}
                          </div>
                        </div>

                        {/* Color slots */}
                        {prog.mode !== 'static' && (
                          <>
                            <div>
                              <label className="text-[7px] uppercase text-muted-foreground">Colors ({prog.colors.length}/4)</label>
                              <div className="flex gap-1 mt-1 flex-wrap items-center">
                                {prog.colors.map((c, i) => (
                                  <div key={i} className="relative group flex flex-col items-center gap-0.5">
                                    <input
                                      type="color"
                                      value={`#${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}`}
                                      onChange={e => {
                                        const hex = e.target.value;
                                        const nr = parseInt(hex.slice(1,3), 16);
                                        const ng = parseInt(hex.slice(3,5), 16);
                                        const nb = parseInt(hex.slice(5,7), 16);
                                        const newColors = [...prog.colors];
                                        newColors[i] = { r: nr, g: ng, b: nb };
                                        updateWidget(selectedWidgetData.id, { colorProgram: { ...prog, colors: newColors } });
                                      }}
                                      className="w-7 h-7 rounded border border-border/30 cursor-pointer p-0 bg-transparent"
                                      style={{ backgroundColor: `rgb(${c.r},${c.g},${c.b})` }}
                                    />
                                    <button
                                      onClick={() => {
                                        const newColors = prog.colors.filter((_, j) => j !== i);
                                        updateWidget(selectedWidgetData.id, { colorProgram: { ...prog, colors: newColors } });
                                      }}
                                      className="text-[6px] text-destructive/50 hover:text-destructive transition-colors">✕</button>
                                  </div>
                                ))}
                                {prog.colors.length < 4 && (
                                  <button onClick={() => {
                                    const cv2 = selectedWidgetData.colorValue || { r: 255, g: 0, b: 0 };
                                    updateWidget(selectedWidgetData.id, { colorProgram: { ...prog, colors: [...prog.colors, cv2] } });
                                  }}
                                    className="w-7 h-7 rounded border border-dashed border-border/30 text-muted-foreground/40 hover:border-primary/30 hover:text-primary transition-all flex items-center justify-center text-lg">+</button>
                                )}
                              </div>
                              <div className="text-[7px] text-muted-foreground/40 mt-0.5">Click swatch to edit color. ✕ to remove. + adds current color.</div>
                            </div>

                            {/* Presets */}
                            <div>
                              <label className="text-[7px] uppercase text-muted-foreground">Presets</label>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {[...COLOR_PROGRAM_PRESETS, ...customColorPresets].filter(p => p.mode === prog.mode || prog.mode === 'fade' || prog.mode === 'switch').map((preset, i) => (
                                  <button key={i}
                                    onClick={() => updateWidget(selectedWidgetData.id, {
                                      colorProgram: { ...prog, mode: preset.mode, colors: [...preset.colors] },
                                    })}
                                    className="text-[7px] px-1.5 py-0.5 rounded border border-border/20 text-muted-foreground hover:border-primary/30 hover:bg-primary/5 transition-all flex items-center gap-0.5">
                                    {preset.colors.map((c, j) => (
                                      <div key={j} className="w-2 h-2 rounded-full" style={{ backgroundColor: `rgb(${c.r},${c.g},${c.b})` }} />
                                    ))}
                                    <span className="ml-0.5">{preset.label}</span>
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Save as custom preset */}
                            {prog.colors.length >= 2 && (
                              <button
                                onClick={() => {
                                  const name = prompt('Preset name:');
                                  if (!name) return;
                                  const newPreset = { label: name, mode: prog.mode, colors: [...prog.colors] };
                                  const updated = [...customColorPresets, newPreset];
                                  setCustomColorPresets(updated);
                                  localStorage.setItem('stokio-custom-color-presets', JSON.stringify(updated));
                                }}
                                className="w-full h-6 rounded text-[9px] font-semibold border border-border/20 text-muted-foreground hover:border-primary/30 hover:bg-primary/5 transition-all flex items-center justify-center gap-1">
                                <Save size={9} /> Save as Custom Preset
                              </button>
                            )}

                            {/* Speed */}
                            <div>
                              <label className="text-[7px] uppercase text-muted-foreground">Speed</label>
                              <Slider value={[prog.speed]}
                                onValueChange={([v]) => updateWidget(selectedWidgetData.id, {
                                  colorProgram: { ...prog, speed: v },
                                })} max={255} className="mt-1" />
                              <span className="text-[7px] font-mono text-muted-foreground/50">{prog.speed}</span>
                            </div>

                            {/* BPM Sync */}
                            <button
                              onClick={() => updateWidget(selectedWidgetData.id, {
                                colorProgram: { ...prog, bpmSync: !prog.bpmSync },
                              })}
                              className={`w-full h-6 rounded text-[9px] font-semibold border transition-all flex items-center justify-center gap-1 ${
                                prog.bpmSync ? 'bg-stokio-pink/10 border-stokio-pink/30 text-stokio-pink' : 'border-border/20 text-muted-foreground hover:border-border/40'
                              }`}>
                              {prog.bpmSync ? '🎵 BPM Sync ON' : '🎵 BPM Sync'}
                            </button>

                            {/* Run/Stop */}
                            <Button
                              size="sm"
                              variant={prog.running ? 'destructive' : 'default'}
                              className="h-7 text-[9px] gap-1 w-full"
                              disabled={prog.colors.length < 2}
                              onClick={() => updateWidget(selectedWidgetData.id, {
                                colorProgram: { ...prog, running: !prog.running },
                              })}>
                              {prog.running ? <><Square size={9} /> Stop</> : <><Play size={9} /> Run</>}
                            </Button>

                            {prog.colors.length < 2 && (
                              <div className="text-[7px] text-muted-foreground/40">Add at least 2 colors to run</div>
                            )}
                          </>
                        )}

                        <div className="text-[8px] text-muted-foreground/50 bg-muted/10 rounded p-1.5">
                          💡 Switch: hard cuts between colors. Fade: smooth transitions. Use BPM Sync to lock changes to the beat.
                        </div>
                      </div>
                    );
                  })()}

                  {/* Link fixtures — individual */}
                  <div>
                    <label className="text-[7px] uppercase text-muted-foreground">Linked Fixtures</label>
                    <div className="space-y-0.5 mt-1">
                      {allFixturesWithDefs.map(({ inst, def }) => {
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
                        onClick={async () => {
                          if (!selectedWidgetData.wledIp) return;
                          try {
                            const presetsFromDevice = await fetchWledPresets(selectedWidgetData.wledIp);
                            updateWidget(selectedWidgetData.id, { wledPresets: presetsFromDevice });
                          } catch {
                            updateWidget(selectedWidgetData.id, { wledPresets: [] });
                          }
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

                  {/* WLED Fixture Widget Config */}
                  {selectedWidgetData.type === 'wled-fixture' && (
                    <div className="space-y-2 border-t border-border/20 pt-2">
                      <label className="text-[8px] uppercase tracking-widest font-semibold flex items-center gap-1" style={{ color: '#ff6600' }}>
                        <Wifi size={10} /> WLED Fixture Config
                      </label>
                      <div>
                        <label className="text-[7px] uppercase text-muted-foreground">WLED Device</label>
                        <select
                          value={selectedWidgetData.wledFixtureDeviceId || ''}
                          onChange={e => updateWidget(selectedWidgetData.id, { wledFixtureDeviceId: e.target.value || undefined })}
                          className="w-full h-7 rounded bg-muted/30 border border-border/30 text-[10px] px-2 text-foreground mt-1">
                          <option value="">— Select device —</option>
                          {wledStore.devices.map(dev => (
                            <option key={dev.id} value={dev.id}>{dev.name} ({dev.ip}) {dev.online ? '●' : '○'}</option>
                          ))}
                        </select>
                      </div>
                      <Button variant="outline" size="sm" className="w-full h-7 text-[10px] gap-1"
                        onClick={async () => {
                          const dev = wledStore.devices.find(d => d.id === selectedWidgetData.wledFixtureDeviceId);
                          if (!dev) return;
                          try {
                            const presetsFromDevice = await fetchWledPresets(dev.ip);
                            updateWidget(selectedWidgetData.id, { wledPresets: presetsFromDevice });
                          } catch {
                            updateWidget(selectedWidgetData.id, { wledPresets: [] });
                          }
                        }}>
                        <Wifi size={10} /> Fetch Presets
                      </Button>
                      {(selectedWidgetData.wledPresets || []).length > 0 && (
                        <div className="text-[8px] text-muted-foreground/50">{selectedWidgetData.wledPresets!.length} presets loaded</div>
                      )}
                    </div>
                  )}

                  {/* Fader Function Dropdown */}
                  {selectedWidgetData.type === 'slider' && (
                    <div className="border-t border-border/20 pt-2">
                      <label className="text-[7px] uppercase text-muted-foreground">Fader Function</label>
                      <select
                        value={selectedWidgetData.faderFixtureFunction || selectedWidgetData.linkedFunction || 'dimmer'}
                        onChange={e => updateWidget(selectedWidgetData.id, { faderFixtureFunction: e.target.value, linkedFunction: e.target.value })}
                        className="w-full h-6 rounded bg-muted/20 border border-border/20 text-[10px] px-1 text-foreground mt-0.5">
                        <optgroup label="General">
                          <option value="dimmer">Dimmer / Brightness</option>
                          <option value="strobe">Strobe</option>
                          <option value="speed">Speed</option>
                        </optgroup>
                        <optgroup label="DMX">
                          <option value="pan">Pan</option>
                          <option value="tilt">Tilt</option>
                          <option value="red">Red</option>
                          <option value="green">Green</option>
                          <option value="blue">Blue</option>
                          <option value="white">White</option>
                          <option value="color-wheel">Color Wheel</option>
                          <option value="gobo">Gobo</option>
                          <option value="focus">Focus</option>
                          <option value="zoom">Zoom</option>
                          <option value="iris">Iris</option>
                          <option value="prism">Prism</option>
                          <option value="frost">Frost</option>
                          <option value="macro">Macro</option>
                          <option value="custom">Custom Channel</option>
                        </optgroup>
                        <optgroup label="WLED">
                          <option value="wled-brightness">WLED Brightness</option>
                          <option value="wled-speed">WLED Effect Speed</option>
                          <option value="wled-intensity">WLED Effect Intensity</option>
                        </optgroup>
                      </select>
                    </div>
                  )}

                  {/* DMX Reset Widget Config */}
                  {selectedWidgetData.type === 'dmx-reset' && (
                    <div className="space-y-2 border-t border-border/20 pt-2">
                      <label className="text-[8px] uppercase tracking-widest text-destructive font-semibold flex items-center gap-1">
                        <Square size={10} /> DMX Reset
                      </label>
                      <div>
                        <label className="text-[7px] uppercase text-muted-foreground">Universe</label>
                        <Input
                          type="number"
                          min={1} max={64}
                          value={selectedWidgetData.resetUniverse ?? 1}
                          onChange={e => updateWidget(selectedWidgetData.id, { resetUniverse: Math.max(1, Number(e.target.value)) })}
                          className="h-6 text-[10px] bg-muted/20 border-border/20 mt-1"
                        />
                      </div>
                      <div className="text-[8px] text-muted-foreground/50 bg-muted/10 rounded p-1.5">
                        💡 Sends DMX value 0 to all 512 channels on the selected universe. Use as an emergency blackout.
                      </div>
                    </div>
                  )}

                  {/* Audio Reactive Widget Config */}
                  {selectedWidgetData.type === 'audio-reactive' && (() => {
                    const arConfig = selectedWidgetData.audioReactive || { running: false, effects: [], globalDecay: 180, sensitivity: 160 };
                    const AR_EFFECT_OPTIONS: { value: AudioReactiveEffectType; label: string; icon: string; desc: string; bands: string[] }[] = [
                      { value: 'color-pulse', label: 'Color Pulse', icon: '🔴', desc: 'Flash a color on each beat', bands: ['bass', 'mid', 'high', 'all'] },
                      { value: 'dimmer-pump', label: 'Dimmer Pump', icon: '💡', desc: 'Pump brightness on beat, fade between beats', bands: ['bass', 'mid', 'high', 'all'] },
                      { value: 'strobe-beat', label: 'Strobe Beat', icon: '⚡', desc: 'Quick strobe flash on each beat', bands: ['bass', 'high', 'all'] },
                      { value: 'pos-alternate', label: 'Position Alternate', icon: '↔', desc: 'MH swaps between two positions each beat', bands: ['bass', 'all'] },
                      { value: 'color-cycle', label: 'Color Cycle', icon: '🌈', desc: 'Step through colors each beat', bands: ['bass', 'mid', 'all'] },
                      { value: 'bass-color-shift', label: 'Bass Color Shift', icon: '🎸', desc: 'Hue shifts with bass intensity', bands: ['bass'] },
                      { value: 'wled-preset-cycle', label: 'WLED Preset Cycle', icon: '🔄', desc: 'Cycle WLED presets each beat', bands: ['bass', 'all'] },
                      { value: 'wled-pixel-chase', label: 'Pixel Chase', icon: '🌊', desc: 'Color travels along LED strip per beat with fade trail', bands: ['bass', 'mid', 'all'] },
                      { value: 'intensity-map', label: 'Intensity Map', icon: '📊', desc: 'Map audio level directly to brightness', bands: ['bass', 'mid', 'high', 'all'] },
                      { value: 'hue-sweep', label: 'Hue Sweep', icon: '🎨', desc: 'Sweep through rainbow based on frequency energy', bands: ['all'] },
                      { value: 'size-pulse', label: 'Size Pulse', icon: '🔍', desc: 'Pulse zoom/iris on beat', bands: ['bass', 'all'] },
                    ];

                    const addEffect = (fixtureId: string, effect: AudioReactiveEffectType) => {
                      const newEffect: AudioReactiveFixtureEffect = {
                        fixtureId, effect, enabled: true,
                        color1: { r: 255, g: 0, b: 0 }, color2: { r: 0, g: 0, b: 255 },
                        intensity: 200, decay: arConfig.globalDecay,
                        posA: { pan: 64, tilt: 128 }, posB: { pan: 192, tilt: 128 },
                        triggerBand: 'bass', wledPresets: [],
                      };
                      updateWidget(selectedWidgetData.id, {
                        audioReactive: { ...arConfig, effects: [...arConfig.effects, newEffect] },
                      });
                    };

                    const updateEffect = (idx: number, updates: Partial<AudioReactiveFixtureEffect>) => {
                      const effects = [...arConfig.effects];
                      effects[idx] = { ...effects[idx], ...updates };
                      updateWidget(selectedWidgetData.id, { audioReactive: { ...arConfig, effects } });
                    };

                    const removeEffect = (idx: number) => {
                      const effects = arConfig.effects.filter((_, i) => i !== idx);
                      updateWidget(selectedWidgetData.id, { audioReactive: { ...arConfig, effects } });
                    };

                    return (
                      <div className="space-y-2 border-t border-border/20 pt-2">
                        <label className="text-[8px] uppercase tracking-widest font-semibold flex items-center gap-1" style={{ color: '#aa44ff' }}>
                          <Radio size={10} /> Audio Reactive Config
                        </label>

                        {/* Global controls */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[7px] uppercase text-muted-foreground">Sensitivity</label>
                            <Slider value={[arConfig.sensitivity]} onValueChange={([v]) => updateWidget(selectedWidgetData.id, {
                              audioReactive: { ...arConfig, sensitivity: v },
                            })} max={255} className="mt-1" />
                            <span className="text-[7px] font-mono text-muted-foreground/50">{arConfig.sensitivity}</span>
                          </div>
                          <div>
                            <label className="text-[7px] uppercase text-muted-foreground">Decay</label>
                            <Slider value={[arConfig.globalDecay]} onValueChange={([v]) => updateWidget(selectedWidgetData.id, {
                              audioReactive: { ...arConfig, globalDecay: v },
                            })} max={255} className="mt-1" />
                            <span className="text-[7px] font-mono text-muted-foreground/50">{arConfig.globalDecay}</span>
                          </div>
                        </div>

                        {/* Run/Stop */}
                        <Button
                          size="sm"
                          variant={arConfig.running ? 'destructive' : 'default'}
                          className="h-7 text-[10px] gap-1 w-full"
                          onClick={() => updateWidget(selectedWidgetData.id, {
                            audioReactive: { ...arConfig, running: !arConfig.running },
                          })}>
                          {arConfig.running ? <><Square size={10} /> Stop</> : <><Play size={10} /> Start</>}
                        </Button>

                        {/* Add effect per fixture */}
                        <div className="border-t border-border/10 pt-2">
                          <label className="text-[7px] uppercase text-muted-foreground">Add Effect to Fixture</label>
                          {selectedWidgetData.linkedFixtureIds.length === 0 ? (
                            <div className="text-[8px] text-muted-foreground/40 text-center py-2">Link fixtures above first</div>
                          ) : (
                            <div className="space-y-1 mt-1">
                              {selectedWidgetData.linkedFixtureIds.map(fid => {
                                const inst = allFixturesWithDefs.find(f => f.inst.id === fid);
                                if (!inst) return null;
                                const isWled = inst.def.category === 'wled';
                                const isMH = inst.def.type === 'moving-head';
                                return (
                                  <div key={fid} className="glass-panel p-1.5 rounded">
                                    <div className="text-[8px] font-semibold flex items-center gap-1 mb-1">
                                      <span>{getFixtureTypeIcon(inst.def.type)}</span> {inst.inst.name}
                                    </div>
                                    <select
                                      value=""
                                      onChange={e => { if (e.target.value) addEffect(fid, e.target.value as AudioReactiveEffectType); }}
                                      className="w-full h-6 rounded bg-muted/20 border border-border/20 text-[9px] px-1 text-foreground">
                                      <option value="">+ Add Effect...</option>
                                      {AR_EFFECT_OPTIONS
                                        .filter(opt => {
                                          if (opt.value === 'pos-alternate' || opt.value === 'size-pulse') return isMH;
                                          if (opt.value === 'wled-preset-cycle' || opt.value === 'wled-pixel-chase') return isWled;
                                          return true;
                                        })
                                        .map(opt => (
                                          <option key={opt.value} value={opt.value}>{opt.icon} {opt.label}</option>
                                        ))}
                                    </select>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Effects list with config */}
                        {arConfig.effects.length > 0 && (
                          <div className="border-t border-border/10 pt-2 space-y-1.5">
                            <label className="text-[7px] uppercase text-muted-foreground">Active Effects</label>
                            {arConfig.effects.map((fx, idx) => {
                              const inst = allFixturesWithDefs.find(f => f.inst.id === fx.fixtureId);
                              const opt = AR_EFFECT_OPTIONS.find(o => o.value === fx.effect);
                              return (
                                <div key={idx} className="glass-panel p-2 rounded space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[8px] font-semibold flex items-center gap-1">
                                      {opt?.icon} {inst?.inst.name?.slice(0, 10)} — {opt?.label}
                                    </span>
                                    <button onClick={() => removeEffect(idx)} className="text-muted-foreground hover:text-destructive">
                                      <X size={10} />
                                    </button>
                                  </div>
                                  <div className="text-[7px] text-muted-foreground/50">{opt?.desc}</div>

                                  {/* Trigger Band */}
                                  <div className="flex items-center gap-1">
                                    <label className="text-[7px] text-muted-foreground w-10">Band</label>
                                    <div className="flex gap-0.5 flex-1">
                                      {(['bass', 'mid', 'high', 'all'] as const).map(band => (
                                        <button key={band}
                                          onClick={() => updateEffect(idx, { triggerBand: band })}
                                          className={`flex-1 text-[7px] py-0.5 rounded border font-semibold transition-all ${
                                            fx.triggerBand === band
                                              ? 'border-[#aa44ff]/40 bg-[#aa44ff]/10 text-[#aa44ff]'
                                              : 'border-border/20 text-muted-foreground hover:border-border/40'
                                          }`}>{band.toUpperCase()}</button>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Intensity */}
                                  <div className="flex items-center gap-1">
                                    <label className="text-[7px] text-muted-foreground w-10">Power</label>
                                    <Slider value={[fx.intensity || 200]} onValueChange={([v]) => updateEffect(idx, { intensity: v })} max={255} className="flex-1" />
                                    <span className="text-[7px] font-mono text-muted-foreground/50 w-6 text-right">{fx.intensity || 200}</span>
                                  </div>

                                  {/* Decay */}
                                  <div className="flex items-center gap-1">
                                    <label className="text-[7px] text-muted-foreground w-10">Decay</label>
                                    <Slider value={[fx.decay || arConfig.globalDecay]} onValueChange={([v]) => updateEffect(idx, { decay: v })} max={255} className="flex-1" />
                                    <span className="text-[7px] font-mono text-muted-foreground/50 w-6 text-right">{fx.decay || arConfig.globalDecay}</span>
                                  </div>

                                  {/* Color pickers for color effects */}
                                  {(fx.effect === 'color-pulse' || fx.effect === 'color-cycle' || fx.effect === 'wled-pixel-chase') && (
                                    <div className="flex items-center gap-1">
                                      <label className="text-[7px] text-muted-foreground w-10">Colors</label>
                                      <Input type="color"
                                        value={fx.color1 ? `#${fx.color1.r.toString(16).padStart(2,'0')}${fx.color1.g.toString(16).padStart(2,'0')}${fx.color1.b.toString(16).padStart(2,'0')}` : '#ff0000'}
                                        onChange={e => { const h = e.target.value; updateEffect(idx, { color1: { r: parseInt(h.slice(1,3),16), g: parseInt(h.slice(3,5),16), b: parseInt(h.slice(5,7),16) } }); }}
                                        className="h-5 w-7 p-0 bg-transparent border-0 cursor-pointer" />
                                      <Input type="color"
                                        value={fx.color2 ? `#${fx.color2.r.toString(16).padStart(2,'0')}${fx.color2.g.toString(16).padStart(2,'0')}${fx.color2.b.toString(16).padStart(2,'0')}` : '#0000ff'}
                                        onChange={e => { const h = e.target.value; updateEffect(idx, { color2: { r: parseInt(h.slice(1,3),16), g: parseInt(h.slice(3,5),16), b: parseInt(h.slice(5,7),16) } }); }}
                                        className="h-5 w-7 p-0 bg-transparent border-0 cursor-pointer" />
                                    </div>
                                  )}

                                  {/* Position A/B for pos-alternate */}
                                  {fx.effect === 'pos-alternate' && (
                                    <div className="grid grid-cols-2 gap-1">
                                      <div>
                                        <label className="text-[7px] text-muted-foreground">Pos A</label>
                                        <div className="flex gap-0.5">
                                          <Input type="number" min={0} max={255} value={fx.posA?.pan ?? 64}
                                            onChange={e => updateEffect(idx, { posA: { pan: Number(e.target.value), tilt: fx.posA?.tilt ?? 128 } })}
                                            className="h-5 text-[8px] bg-muted/20 border-border/20 font-mono px-1 flex-1" placeholder="Pan" />
                                          <Input type="number" min={0} max={255} value={fx.posA?.tilt ?? 128}
                                            onChange={e => updateEffect(idx, { posA: { pan: fx.posA?.pan ?? 64, tilt: Number(e.target.value) } })}
                                            className="h-5 text-[8px] bg-muted/20 border-border/20 font-mono px-1 flex-1" placeholder="Tilt" />
                                        </div>
                                      </div>
                                      <div>
                                        <label className="text-[7px] text-muted-foreground">Pos B</label>
                                        <div className="flex gap-0.5">
                                          <Input type="number" min={0} max={255} value={fx.posB?.pan ?? 192}
                                            onChange={e => updateEffect(idx, { posB: { pan: Number(e.target.value), tilt: fx.posB?.tilt ?? 128 } })}
                                            className="h-5 text-[8px] bg-muted/20 border-border/20 font-mono px-1 flex-1" placeholder="Pan" />
                                          <Input type="number" min={0} max={255} value={fx.posB?.tilt ?? 128}
                                            onChange={e => updateEffect(idx, { posB: { pan: fx.posB?.pan ?? 192, tilt: Number(e.target.value) } })}
                                            className="h-5 text-[8px] bg-muted/20 border-border/20 font-mono px-1 flex-1" placeholder="Tilt" />
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {/* WLED preset list for preset-cycle */}
                                  {fx.effect === 'wled-preset-cycle' && (
                                    <div>
                                      <label className="text-[7px] text-muted-foreground">Preset IDs (comma separated)</label>
                                      <Input
                                        value={(fx.wledPresets || []).join(', ')}
                                        onChange={e => {
                                          const ids = e.target.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
                                          updateEffect(idx, { wledPresets: ids });
                                        }}
                                        className="h-5 text-[8px] bg-muted/20 border-border/20 font-mono px-1"
                                        placeholder="1, 2, 3" />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="text-[8px] text-muted-foreground/50 bg-muted/10 rounded p-1.5">
                          💡 Link fixtures, add effects per fixture, choose frequency bands. Bass = kick/bass, Mid = melody, High = hi-hats. Effects react to audio in real-time when running.
                        </div>
                      </div>
                    );
                  })()}

                  {/* EQ Trigger Widget Config */}
                  {selectedWidgetData.type === 'eq-trigger' && (
                    <div className="space-y-2">
                      <label className="text-[8px] uppercase tracking-widest text-stokio-cyan font-semibold flex items-center gap-1">
                        <Activity size={10} /> EQ Trigger Zones
                      </label>
                      <EqTriggerWidget
                        zones={selectedWidgetData.eqTriggerZones || []}
                        onZonesChange={(z) => updateWidget(selectedWidgetData.id, { eqTriggerZones: z })}
                        analyserNode={(() => {
                          if (audioConfig.source === 'browser-mic') return micBpmRef.current?.analyser || null;
                          if (audioConfig.source === 'system-audio') return sysAudioRef.current?.analyser || null;
                          return null;
                        })()}
                        sampleRate={(() => {
                          if (audioConfig.source === 'browser-mic') return micBpmRef.current?.ctx?.sampleRate || 44100;
                          if (audioConfig.source === 'system-audio') return sysAudioRef.current?.ctx?.sampleRate || 44100;
                          return 44100;
                        })()}
                        width={240}
                        height={400}
                        fixtures={allFixturesWithDefs.map(f => ({
                          id: f.inst.id,
                          name: f.inst.name,
                          icon: getFixtureTypeIcon(f.def.type),
                        }))}
                        onTrigger={(zone, energy) => {
                          if (!zone.fixtureId) return;
                          const fixture = allFixturesWithDefs.find(f => f.inst.id === zone.fixtureId);
                          if (!fixture) return;
                          const uni = fixture.inst.universe || 1;
                          const startCh = fixture.inst.dmxAddress || 1;
                          const mode = fixture.def.modes.find(m => m.id === fixture.inst.modeId) || fixture.def.modes[0];
                          const chs = mode?.channels || [];

                          if (zone.action === 'dimmer') {
                            const min = zone.dimmerMin ?? 0;
                            const max = zone.dimmerMax ?? 255;
                            const val = Math.round(min + energy * (max - min));
                            const dimCh = chs.findIndex(c => c.function === 'dimmer');
                            if (dimCh >= 0) sendDmxChannel(uni, startCh + dimCh, val);
                          } else if (zone.action === 'strobe') {
                            const strobeCh = chs.findIndex(c => c.function === 'strobe');
                            if (strobeCh >= 0) sendDmxChannel(uni, startCh + strobeCh, 255);
                            setTimeout(() => {
                              if (strobeCh >= 0) sendDmxChannel(uni, startCh + strobeCh, 0);
                            }, 80);
                          } else if (zone.action === 'mh-position') {
                            const posA = zone.posA || { pan: 0, tilt: 0 };
                            const posB = zone.posB || { pan: 128, tilt: 128 };
                            const panCh = chs.findIndex(c => c.function === 'pan');
                            const tiltCh = chs.findIndex(c => c.function === 'tilt');
                            const useB = Math.random() > 0.5;
                            const pos = useB ? posB : posA;
                            if (panCh >= 0) sendDmxChannel(uni, startCh + panCh, pos.pan);
                            if (tiltCh >= 0) sendDmxChannel(uni, startCh + tiltCh, pos.tilt);
                          } else if (zone.action === 'on-off') {
                            const dimCh = chs.findIndex(c => c.function === 'dimmer');
                            if (dimCh >= 0) sendDmxChannel(uni, startCh + dimCh, 255);
                            setTimeout(() => {
                              if (dimCh >= 0) sendDmxChannel(uni, startCh + dimCh, 0);
                            }, 150);
                          }
                        }}
                        onColorOutput={(outputs) => {
                          outputs.forEach(({ zone, fadeProgress }) => {
                            if (!zone.fixtureId) return;
                            const fixture = allFixturesWithDefs.find(f => f.inst.id === zone.fixtureId);
                            if (!fixture) return;
                            const uni = fixture.inst.universe || 1;
                            const startCh = fixture.inst.dmxAddress || 1;
                            const mode = fixture.def.modes.find(m => m.id === fixture.inst.modeId) || fixture.def.modes[0];
                            const chs = mode?.channels || [];
                            const idle = zone.idleColor || { r: 0, g: 0, b: 0 };
                            const trig = zone.triggerColor || { r: 255, g: 255, b: 255 };
                            const t = fadeProgress;
                            const r = Math.round(idle.r + (trig.r - idle.r) * t);
                            const g = Math.round(idle.g + (trig.g - idle.g) * t);
                            const b = Math.round(idle.b + (trig.b - idle.b) * t);
                            const rCh = chs.findIndex(c => c.function === 'red');
                            const gCh = chs.findIndex(c => c.function === 'green');
                            const bCh = chs.findIndex(c => c.function === 'blue');
                            if (rCh >= 0) sendDmxChannel(uni, startCh + rCh, r);
                            if (gCh >= 0) sendDmxChannel(uni, startCh + gCh, g);
                            if (bCh >= 0) sendDmxChannel(uni, startCh + bCh, b);
                          });
                        }}
                        isConfig={true}
                      />
                      <div className="text-[8px] text-muted-foreground/50 bg-muted/10 rounded p-1.5">
                        📊 Create frequency trigger zones on the EQ spectrum. Each zone monitors a frequency range and triggers a fixture action when the audio energy exceeds the threshold.
                        Use for bass-triggered dimmers, mid-range strobes, or moving head position changes on specific frequencies.
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
                  {allFixturesWithDefs.map(({ inst, def }) => {
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
                {allFixturesWithDefs.length === 0 && (
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

          {allFixturesWithDefs.map(({ inst, def }) => {
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

          {allFixturesWithDefs.length === 0 && (
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
              fixtures={allFixturesWithDefs}
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

      {/* ── MIXER TAB ── */}
      {tab === 'mixer' && (
        <div className="flex-1 overflow-y-auto">
          <DmxMixer />
        </div>
      )}
    </motion.div>
  );
}
