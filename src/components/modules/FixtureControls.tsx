import { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Home, Crosshair, Wifi, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import {
  useFixtureStore, type FixtureDefinition, type FixtureInstance,
  type ColorSystem, type ColorWheelSlot, getFixtureTypeIcon, getFixtureIconEmoji,
} from '@/store/fixtureStore';
import { useWledStore, type WledFixture } from '@/store/wledStore';
import { setWledBrightness, setWledPower, setWledState } from '@/lib/wledApi';
import { fetchWledPresets, isWledDeviceTarget, wledDeviceToFixture } from '@/lib/wledUtils';

// ── Live channel values per instance ──
interface FixtureState {
  color: { r: number; g: number; b: number; w: number; ww: number; cw: number };
  colorWheelSlotId?: string; // active slot for color-wheel fixtures
  pan: number;
  tilt: number;
  dimmer: number;
}

function defaultState(): FixtureState {
  return { color: { r: 0, g: 0, b: 0, w: 0, ww: 0, cw: 0 }, pan: 50, tilt: 50, dimmer: 80 };
}

// ── Color Wheel (HSV) ──
function ColorWheel({ color, onChange }: {
  color: { r: number; g: number; b: number };
  onChange: (c: { r: number; g: number; b: number }) => void;
}) {
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
    });
  }, [onChange]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full control-glossy"
        style={{ background: `conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)`, padding: 6 }}>
        <div className="w-full h-full rounded-full bg-[#0a0a0a] flex items-center justify-center">
          <div className="w-16 h-16 rounded-full border-2 border-border/30"
            style={{ background: `rgb(${color.r}, ${color.g}, ${color.b})`, boxShadow: `0 0 20px rgb(${color.r}, ${color.g}, ${color.b})` }} />
        </div>
      </div>
      <div className="absolute top-1/2 left-1/2 w-4 h-4 rounded-full border-2 border-foreground -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{ backgroundColor: `rgb(${color.r}, ${color.g}, ${color.b})`, boxShadow: `0 0 12px rgb(${color.r}, ${color.g}, ${color.b})` }} />
      <canvas ref={canvasRef} width={size} height={size}
        className="absolute inset-0 rounded-full cursor-crosshair opacity-0" onClick={handleClick} />
    </div>
  );
}

// ── Fixed Color Wheel Selector ──
function FixedColorWheelSelector({ slots, activeSlotId, onSelect }: {
  slots: ColorWheelSlot[];
  activeSlotId?: string;
  onSelect: (slot: ColorWheelSlot) => void;
}) {
  const size = 180;
  const slotAngle = 360 / slots.length;

  return (
    <div className="space-y-2">
      {/* Circular wheel representation */}
      <div className="relative mx-auto" style={{ width: size, height: size }}>
        <div className="absolute inset-0 rounded-full control-glossy border border-border/20 overflow-hidden">
          {slots.map((slot, i) => {
            const startAngle = i * slotAngle - 90;
            const isActive = slot.id === activeSlotId;
            return (
              <button
                key={slot.id}
                className="absolute inset-0 w-full h-full"
                onClick={() => onSelect(slot)}
                style={{ clipPath: `polygon(50% 50%, ${50 + 50 * Math.cos((startAngle) * Math.PI / 180)}% ${50 + 50 * Math.sin((startAngle) * Math.PI / 180)}%, ${50 + 50 * Math.cos((startAngle + slotAngle) * Math.PI / 180)}% ${50 + 50 * Math.sin((startAngle + slotAngle) * Math.PI / 180)}%)` }}
              >
                <div className="w-full h-full" style={{
                  backgroundColor: slot.color,
                  opacity: isActive ? 1 : 0.6,
                  boxShadow: isActive ? `inset 0 0 20px rgba(255,255,255,0.4)` : 'none',
                }} />
              </button>
            );
          })}
          {/* Center dot */}
          <div className="absolute top-1/2 left-1/2 w-10 h-10 rounded-full -translate-x-1/2 -translate-y-1/2 bg-[#0a0a0a] border border-border/30 flex items-center justify-center">
            {activeSlotId && (
              <div className="w-6 h-6 rounded-full" style={{
                backgroundColor: slots.find(s => s.id === activeSlotId)?.color,
                boxShadow: `0 0 12px ${slots.find(s => s.id === activeSlotId)?.color}`,
              }} />
            )}
          </div>
        </div>
      </div>

      {/* Color grid for quick selection */}
      <div className="grid grid-cols-4 gap-1.5 max-w-[180px] mx-auto">
        {slots.map(slot => {
          const isActive = slot.id === activeSlotId;
          return (
            <button
              key={slot.id}
              onClick={() => onSelect(slot)}
              className={`group relative flex flex-col items-center gap-0.5 p-1 rounded transition-all ${isActive ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-muted/30'}`}
            >
              <div className="w-7 h-7 rounded-full border-2 transition-all"
                style={{
                  backgroundColor: slot.color,
                  borderColor: isActive ? 'hsl(var(--primary))' : 'transparent',
                  boxShadow: isActive ? `0 0 10px ${slot.color}` : 'none',
                }}
              />
              <span className="text-[7px] text-muted-foreground truncate w-full text-center">{slot.name}</span>
              <span className="text-[6px] font-mono text-muted-foreground/50">DMX:{slot.dmxValue}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── XY Pad ──
function XYPad({ pan, tilt, onPanChange, onTiltChange }: {
  pan: number; tilt: number; onPanChange: (v: number) => void; onTiltChange: (v: number) => void;
}) {
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
      <div ref={padRef}
        className="w-44 h-44 rounded-lg control-glossy border border-border/30 relative cursor-crosshair select-none"
        onMouseDown={(e) => { setIsDragging(true); handleMove(e); }}
        onMouseMove={handleMove}
        onMouseUp={() => setIsDragging(false)}
        onMouseLeave={() => setIsDragging(false)}
        onClick={handleMove}
      >
        <div className="absolute inset-0 rounded-lg overflow-hidden pointer-events-none">
          <div className="absolute left-1/2 top-0 w-px h-full bg-border/20" />
          <div className="absolute top-1/2 left-0 w-full h-px bg-border/20" />
        </div>
        <motion.div
          className="absolute w-4 h-4 rounded-full border-2 border-primary -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{ left: `${pan}%`, top: `${tilt}%`, boxShadow: '0 0 8px hsl(155, 100%, 50%)' }}
          animate={{ left: `${pan}%`, top: `${tilt}%` }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        />
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

// ── White Channel Sliders ──
function WhiteChannels({ colorSystem, color, onChange }: {
  colorSystem: ColorSystem;
  color: FixtureState['color'];
  onChange: (c: Partial<FixtureState['color']>) => void;
}) {
  const channels: { key: keyof FixtureState['color']; label: string }[] = [];

  if (colorSystem === 'rgbw') {
    channels.push({ key: 'w', label: 'W' });
  } else if (colorSystem === 'rgbww') {
    channels.push({ key: 'w', label: 'WW' }, { key: 'cw', label: 'CW' });
  } else if (colorSystem === 'rgbwc') {
    channels.push({ key: 'w', label: 'W' }, { key: 'cw', label: 'C' });
  }

  if (channels.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {channels.map(ch => (
        <div key={ch.key} className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground w-6 text-right font-semibold">{ch.label}</span>
          <Slider
            value={[color[ch.key]]}
            onValueChange={([v]) => onChange({ [ch.key]: v })}
            max={255}
            className="flex-1"
          />
          <span className="text-[9px] font-mono text-muted-foreground w-6">{color[ch.key]}</span>
        </div>
      ))}
    </div>
  );
}

// ── Color System Label ──
function colorSystemLabel(cs: ColorSystem): string {
  const map: Record<ColorSystem, string> = {
    'rgb': 'RGB COLOR',
    'rgbw': 'RGBW COLOR',
    'rgbww': 'RGBWW COLOR',
    'rgbwc': 'RGBWC COLOR',
    'color-wheel': 'COLOR WHEEL',
  };
  return map[cs];
}

// ── WLED Fixture Panel ──
function WledFixturePanel({ instance, definition }: {
  instance: FixtureInstance;
  definition: FixtureDefinition;
}) {
  const store = useFixtureStore();
  const wled = definition.wledConfig;
  const [ip, setIp] = useState(wled?.ip || '');
  const [presets, setPresets] = useState(wled?.presets || []);
  const [activePreset, setActivePreset] = useState<number | null>(null);
  const [color, setColor] = useState({ r: 255, g: 0, b: 0 });
  const [brightness, setBrightness] = useState(128);

  const fetchPresets = async () => {
    if (!ip) return;
    try {
      const presetsFromDevice = await fetchWledPresets(ip);
      setPresets(presetsFromDevice);
      store.updateDefinition(definition.id, { wledConfig: { ...wled!, ip, presets: presetsFromDevice } });
    } catch {
      setPresets([]);
    }
  };

  const saveIp = () => {
    store.updateDefinition(definition.id, { wledConfig: { ...wled!, ip } });
  };

  return (
    <div className="flex flex-wrap gap-6 items-start">
      {/* Connection */}
      <div className="space-y-3 min-w-[200px]">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground block">WLED DEVICE</label>
        <div className="flex gap-1.5">
          <Input value={ip} onChange={e => setIp(e.target.value)} onBlur={saveIp}
            placeholder="192.168.1.x"
            className="h-7 text-[10px] bg-muted/20 border-border/20 font-mono flex-1" />
          <Button variant="outline" size="sm" className="h-7 text-[9px] gap-1" onClick={fetchPresets}>
            <RefreshCw size={10} /> Fetch
          </Button>
        </div>
        <div className="text-[8px] text-muted-foreground/50">
          LEDs: {wled?.ledCount || '?'} · Segments: {wled?.segments || 1}
        </div>

        {/* Brightness */}
        <div className="space-y-1">
          <label className="text-[9px] text-muted-foreground">Brightness</label>
          <div className="flex items-center gap-2">
            <Slider value={[brightness]} onValueChange={([v]) => setBrightness(v)} max={255} className="flex-1" />
            <span className="text-[9px] font-mono text-muted-foreground w-6">{brightness}</span>
          </div>
        </div>
      </div>

      {/* Color */}
      <div className="space-y-3">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground block text-center">COLOR</label>
        <div className="relative w-[180px] h-[180px]">
          <div className="absolute inset-0 rounded-full control-glossy"
            style={{ background: `conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)`, padding: 6 }}>
            <div className="w-full h-full rounded-full bg-[#0a0a0a] flex items-center justify-center">
              <div className="w-16 h-16 rounded-full border-2 border-border/30"
                style={{ background: `rgb(${color.r}, ${color.g}, ${color.b})`, boxShadow: `0 0 20px rgb(${color.r}, ${color.g}, ${color.b})` }} />
            </div>
          </div>
        </div>
        {['r', 'g', 'b'].map(ch => (
          <div key={ch} className="flex items-center gap-2">
            <span className="text-[9px] text-muted-foreground w-4 uppercase font-semibold">{ch}</span>
            <Slider value={[color[ch as keyof typeof color]]}
              onValueChange={([v]) => setColor(prev => ({ ...prev, [ch]: v }))} max={255} className="flex-1" />
            <span className="text-[9px] font-mono text-muted-foreground w-6">{color[ch as keyof typeof color]}</span>
          </div>
        ))}
      </div>

      {/* Presets from device */}
      <div className="space-y-3 min-w-[200px]">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground block">DEVICE PRESETS</label>
        {presets.length === 0 ? (
          <div className="text-[9px] text-muted-foreground/40 text-center py-4">
            Enter WLED IP and click Fetch to load presets
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {presets.map(p => (
              <button key={p.id} onClick={() => setActivePreset(p.id)}
                className={`px-2 py-1.5 rounded text-[9px] font-medium border transition-all ${
                  activePreset === p.id
                    ? 'bg-[#ff6600]/20 border-[#ff6600]/40 text-[#ff6600] shadow-[0_0_8px_rgba(255,102,0,0.3)]'
                    : 'border-border/20 text-muted-foreground hover:border-[#ff6600]/30 hover:bg-[#ff6600]/5'
                }`}>
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── WLED Fixture Live Panel (for wledStore fixtures) ──
function WledFixtureLivePanel({ fixture, state, updateState }: {
  fixture: WledFixture;
  state: FixtureState;
  updateState: (u: Partial<FixtureState>) => void;
}) {
  const wledStore = useWledStore();
  const dev = wledStore.devices.find(d => d.id === fixture.deviceId);
  const [brightness, setBrightness] = useState(state.dimmer * 2.55 | 0);
  const deviceTarget = isWledDeviceTarget(fixture);

  const handleColorChange = async (c: { r: number; g: number; b: number }) => {
    updateState({ color: { ...state.color, ...c } });
    if (dev?.online) {
      try {
        await setWledState(dev.ip, deviceTarget
          ? {
              on: true,
              seg: (dev.state?.seg?.length
                ? dev.state.seg.map(seg => ({ id: seg.id, on: true, col: [[c.r, c.g, c.b]] }))
                : [{ id: 0, on: true, col: [[c.r, c.g, c.b]] }]),
            }
          : {
              on: true,
              seg: [{ id: fixture.segmentId, on: true, col: [[c.r, c.g, c.b]] }],
            });
      } catch { /* offline */ }
    }
  };

  const handleBrightness = async (bri: number) => {
    setBrightness(bri);
    updateState({ dimmer: Math.round(bri / 2.55) });
    if (dev?.online) {
      try {
        if (deviceTarget) {
          await setWledBrightness(dev.ip, bri);
        } else {
          await setWledState(dev.ip, { on: bri > 0, seg: [{ id: fixture.segmentId, on: bri > 0, bri }] });
        }
      } catch { /* offline */ }
    }
  };

  return (
    <div className="flex flex-wrap gap-8 items-start">
      {/* Color */}
      <div className="space-y-3">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground block text-center">COLOR</label>
        <ColorWheel color={state.color} onChange={handleColorChange} />
        {['r', 'g', 'b'].map(ch => (
          <div key={ch} className="flex items-center gap-2">
            <span className="text-[9px] text-muted-foreground w-4 uppercase font-semibold">{ch}</span>
            <Slider
              value={[state.color[ch as keyof typeof state.color]]}
              onValueChange={([v]) => handleColorChange({ ...state.color, [ch]: v })}
              max={255}
              className="flex-1"
            />
            <span className="text-[9px] font-mono text-muted-foreground w-6">{state.color[ch as keyof typeof state.color]}</span>
          </div>
        ))}
      </div>

      {/* Brightness */}
      <div className="space-y-3">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground block text-center">BRIGHTNESS</label>
        <div className="h-44 w-12 rounded-lg fader-track border border-border/30 relative mx-auto">
          <motion.div
            className="absolute bottom-0 left-0 w-full rounded-b-lg bg-gradient-to-t from-[#ff6600]/60 to-[#ff6600]/20"
            animate={{ height: `${(brightness / 255) * 100}%` }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          />
          <input type="range" min={0} max={255} value={brightness}
            onChange={(e) => handleBrightness(Number(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-ns-resize"
            style={{ writingMode: 'vertical-lr', direction: 'rtl' } as React.CSSProperties}
          />
        </div>
        <div className="text-[9px] font-mono text-muted-foreground text-center">{brightness}/255</div>
      </div>

      {/* Info */}
      <div className="space-y-3 min-w-[160px]">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground block">FIXTURE INFO</label>
        <div className="space-y-1.5 text-[9px]">
          <div className="flex justify-between"><span className="text-muted-foreground">Device:</span> <span>{fixture.deviceName}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">IP:</span> <span className="font-mono">{fixture.deviceIp}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Target:</span> <span>{deviceTarget ? 'All segments' : `Seg ${fixture.segmentId}`}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">LEDs:</span> <span>{fixture.ledStart}–{fixture.ledEnd} ({fixture.ledEnd - fixture.ledStart + 1}px)</span></div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status:</span>
            <span className={dev?.online ? 'text-green-500' : 'text-red-500'}>{dev?.online ? '● Online' : '○ Offline'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──
type FixtureTab = 'dmx' | 'wled';

export function FixtureControls() {
  const store = useFixtureStore();
  const wledStore = useWledStore();
  const [states, setStates] = useState<Record<string, FixtureState>>({});
  const [selectedId, setSelectedId] = useState<string>(store.instances[0]?.id || '');
  const [fixtureTab, setFixtureTab] = useState<FixtureTab>('dmx');

  const dmxInstances = store.instances.filter(i => {
    const def = store.definitions.find(d => d.id === i.definitionId);
    return def?.category === 'dmx';
  });
  // Legacy fixtureStore WLED instances + real wledStore fixtures
  const wledStoreFixtures = [...wledStore.devices.map(wledDeviceToFixture), ...wledStore.fixtures];
  const legacyWledInstances = store.instances.filter(i => {
    const def = store.definitions.find(d => d.id === i.definitionId);
    return def?.category === 'wled';
  });

  useEffect(() => {
    if (fixtureTab === 'wled' && !selectedId && (wledStoreFixtures[0] || legacyWledInstances[0])) {
      setSelectedId(wledStoreFixtures[0]?.id || legacyWledInstances[0]?.id || '');
    }
  }, [fixtureTab, selectedId, wledStoreFixtures, legacyWledInstances]);

  const currentInstances = fixtureTab === 'dmx' ? dmxInstances : legacyWledInstances;
  const selected = fixtureTab === 'wled' 
    ? (wledStoreFixtures.find(f => f.id === selectedId) ? null : currentInstances.find(i => i.id === selectedId) || currentInstances[0])
    : (currentInstances.find(i => i.id === selectedId) || currentInstances[0]);
  const selectedWledFixture = fixtureTab === 'wled'
    ? (wledStoreFixtures.find(f => f.id === selectedId) || (!selected && wledStoreFixtures[0]) || undefined)
    : undefined;
  const selectedDef = selected ? store.definitions.find(d => d.id === selected.definitionId) : undefined;
  const selectedMode = selected && selectedDef ? selectedDef.modes.find(m => m.id === selected.modeId) : undefined;

  const getState = (id: string): FixtureState => states[id] || defaultState();
  const updateState = (id: string, updates: Partial<FixtureState>) => {
    setStates(prev => ({ ...prev, [id]: { ...getState(id), ...updates } }));
  };

  const hasPanTilt = selectedMode?.channels.some(c => c.function === 'pan' || c.function === 'tilt');
  const state = selected ? getState(selected.id) : defaultState();

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
      <div className="p-3 border-b border-border/30 flex items-center gap-4">
        <h2 className="text-sm font-semibold tracking-wider">FIXTURES</h2>
        <div className="flex gap-1">
          <button onClick={() => setFixtureTab('dmx')}
            className={`px-3 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition-all ${
              fixtureTab === 'dmx' ? 'bg-primary/10 text-primary border border-primary/30' : 'text-muted-foreground hover:text-foreground hover:bg-muted/20'
            }`}>DMX</button>
          <button onClick={() => setFixtureTab('wled')}
            className={`px-3 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
              fixtureTab === 'wled' ? 'bg-[#ff6600]/10 text-[#ff6600] border border-[#ff6600]/30' : 'text-muted-foreground hover:text-foreground hover:bg-muted/20'
            }`}>
            <Wifi size={10} /> WLED
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Fixture List */}
        <div className="w-44 border-r border-border/30 p-2 space-y-1 overflow-y-auto">
          {fixtureTab === 'dmx' && currentInstances.length === 0 && (
            <div className="text-[10px] text-muted-foreground text-center py-4">
              No DMX fixtures patched.<br />Go to Devices to add fixtures.
            </div>
          )}
          {fixtureTab === 'wled' && wledStoreFixtures.length === 0 && legacyWledInstances.length === 0 && (
            <div className="text-[10px] text-muted-foreground text-center py-4">
              No WLED fixtures.<br />Go to Devices → WLED tab to create fixtures.
            </div>
          )}
          {/* DMX fixtures list */}
          {fixtureTab === 'dmx' && currentInstances.map(inst => {
            const def = store.definitions.find(d => d.id === inst.definitionId);
            if (!def) return null;
            const s = getState(inst.id);
            const previewColor = def.colorSystem === 'color-wheel'
                ? (def.colorWheelSlots?.find(sl => sl.id === s.colorWheelSlotId)?.color || '#888')
                : `rgb(${s.color.r},${s.color.g},${s.color.b})`;
            return (
              <button
                key={inst.id}
                onClick={() => setSelectedId(inst.id)}
                className={`w-full flex items-center gap-2 p-2 rounded text-xs transition-all ${
                  selected?.id === inst.id ? 'bg-primary/10 border border-primary/30 text-primary' : 'hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                <span className="text-sm">{getFixtureTypeIcon(def.type)}</span>
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: previewColor, boxShadow: `0 0 6px ${previewColor}` }} />
                <div className="flex-1 text-left min-w-0">
                  <div className="truncate text-[10px] font-semibold">{inst.name}</div>
                  <div className="text-[8px] text-muted-foreground/60">{def.colorSystem.toUpperCase()}</div>
                </div>
              </button>
            );
          })}
          {/* WLED fixtures from wledStore */}
          {fixtureTab === 'wled' && wledStoreFixtures.map(fix => {
            const dev = wledStore.devices.find(d => d.id === fix.deviceId);
            const s = getState(fix.id);
            const previewColor = `rgb(${s.color.r},${s.color.g},${s.color.b})`;
            return (
              <button
                key={fix.id}
                onClick={() => setSelectedId(fix.id)}
                className={`w-full flex items-center gap-2 p-2 rounded text-xs transition-all ${
                  selectedId === fix.id ? 'bg-[#ff6600]/10 border border-[#ff6600]/30 text-[#ff6600]' : 'hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                <span className="text-sm">{fix.icon ? getFixtureIconEmoji(fix.icon) : '💡'}</span>
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: previewColor, boxShadow: `0 0 6px ${previewColor}` }} />
                <div className="flex-1 text-left min-w-0">
                  <div className="truncate text-[10px] font-semibold">{fix.name}</div>
                  <div className="text-[8px] text-muted-foreground/60">
                    {isWledDeviceTarget(fix) ? `${fix.deviceName} · All LEDs` : `${fix.deviceName} · Seg ${fix.segmentId}`}
                  </div>
                  <div className={`text-[7px] ${dev?.online ? 'text-green-500' : 'text-red-500'}`}>
                    {dev?.online ? '● Online' : '○ Offline'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Controls */}
        <div className="flex-1 p-6 overflow-y-auto">
          {selectedWledFixture ? (
            <WledFixtureLivePanel fixture={selectedWledFixture} state={getState(selectedWledFixture.id)} updateState={(u) => updateState(selectedWledFixture.id, u)} />
          ) : !selected || !selectedDef ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Select a fixture</div>
          ) : selectedDef.category === 'wled' ? (
            <WledFixturePanel instance={selected} definition={selectedDef} />
          ) : (
            <div className="flex flex-wrap gap-8 items-start">
              {/* Color Controls */}
              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground block text-center">
                  {colorSystemLabel(selectedDef.colorSystem)}
                </label>

                {selectedDef.colorSystem === 'color-wheel' ? (
                  <FixedColorWheelSelector
                    slots={selectedDef.colorWheelSlots || []}
                    activeSlotId={state.colorWheelSlotId}
                    onSelect={(slot) => updateState(selected.id, { colorWheelSlotId: slot.id })}
                  />
                ) : (
                  <>
                    <ColorWheel
                      color={state.color}
                      onChange={(c) => updateState(selected.id, { color: { ...state.color, ...c } })}
                    />
                    {/* RGB readout sliders */}
                    {['r', 'g', 'b'].map(ch => (
                      <div key={ch} className="flex items-center gap-2">
                        <span className="text-[9px] text-muted-foreground w-4 uppercase font-semibold">{ch}</span>
                        <Slider
                          value={[state.color[ch as keyof typeof state.color]]}
                          onValueChange={([v]) => updateState(selected.id, { color: { ...state.color, [ch]: v } })}
                          max={255}
                          className="flex-1"
                        />
                        <span className="text-[9px] font-mono text-muted-foreground w-6">{state.color[ch as keyof typeof state.color]}</span>
                      </div>
                    ))}
                    {/* White channels */}
                    <WhiteChannels
                      colorSystem={selectedDef.colorSystem}
                      color={state.color}
                      onChange={(updates) => updateState(selected.id, { color: { ...state.color, ...updates } })}
                    />
                    {/* Color readout */}
                    <div className="text-[9px] font-mono text-muted-foreground text-center">
                      R:{state.color.r} G:{state.color.g} B:{state.color.b}
                      {selectedDef.colorSystem !== 'rgb' && ` W:${state.color.w}`}
                      {selectedDef.colorSystem === 'rgbww' && ` CW:${state.color.cw}`}
                      {selectedDef.colorSystem === 'rgbwc' && ` C:${state.color.cw}`}
                    </div>
                  </>
                )}
              </div>

              {/* XY Pad */}
              {hasPanTilt && (
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground block text-center">PAN / TILT</label>
                  <XYPad
                    pan={state.pan}
                    tilt={state.tilt}
                    onPanChange={(v) => updateState(selected.id, { pan: v })}
                    onTiltChange={(v) => updateState(selected.id, { tilt: v })}
                  />
                  <div className="text-[9px] font-mono text-muted-foreground text-center">
                    P:{state.pan}° T:{state.tilt}°
                  </div>
                </div>
              )}

              {/* Dimmer */}
              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground block text-center">DIMMER</label>
                <div className="h-44 w-12 rounded-lg fader-track border border-border/30 relative mx-auto">
                  <motion.div
                    className="absolute bottom-0 left-0 w-full rounded-b-lg bg-gradient-to-t from-primary/60 to-primary/20"
                    animate={{ height: `${state.dimmer}%` }}
                    transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  />
                  <input type="range" min={0} max={100} value={state.dimmer}
                    onChange={(e) => updateState(selected.id, { dimmer: Number(e.target.value) })}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-ns-resize"
                    style={{ writingMode: 'vertical-lr', direction: 'rtl' } as React.CSSProperties}
                  />
                </div>
                <div className="text-[9px] font-mono text-muted-foreground text-center">{state.dimmer}%</div>
              </div>

              {/* Channel overview */}
              {selectedMode && (
                <div className="space-y-2 min-w-[160px]">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground block">CHANNELS</label>
                  <div className="space-y-0.5">
                    {selectedMode.channels.map(ch => (
                      <div key={ch.id} className="flex items-center gap-1.5 text-[9px]">
                        <span className="font-mono text-muted-foreground/50 w-5">{ch.number}</span>
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: `var(--channel-${ch.function}, #888)` }} />
                        <span className="text-muted-foreground">{ch.name}</span>
                        <span className="text-[7px] text-muted-foreground/40 uppercase ml-auto">{ch.function}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
