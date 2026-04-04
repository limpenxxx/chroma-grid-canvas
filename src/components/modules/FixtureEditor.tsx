import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, Save, X, ChevronDown, ChevronRight, Copy, Play, Square,
  Download, Upload, Bookmark, GripVertical, Eye, EyeOff
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  useFixtureStore, type FixtureDefinition, type FixtureMode,
  type FixtureChannel, type ChannelFunction, type ChannelCapability,
  type ColorSystem, type ColorWheelSlot, type SavedMode,
  CHANNEL_FUNCTION_LABELS, getChannelColor,
} from '@/store/fixtureStore';
import { sendDmxChannel } from '@/lib/wsSync';

// ── Constants ──

const FIXTURE_TYPES: FixtureDefinition['type'][] = [
  'moving-head', 'par', 'strip', 'wash', 'spot', 'beam', 'strobe', 'laser', 'effect', 'dimmer', 'other',
];

const COLOR_SYSTEMS: { value: ColorSystem; label: string }[] = [
  { value: 'rgb', label: 'RGB' },
  { value: 'rgbw', label: 'RGBW' },
  { value: 'rgbww', label: 'RGBWW (Warm+Cool White)' },
  { value: 'rgbwc', label: 'RGBWC (White+Color)' },
  { value: 'color-wheel', label: 'Fixed Color Wheel' },
];

const ALL_FUNCTIONS: ChannelFunction[] = Object.keys(CHANNEL_FUNCTION_LABELS) as ChannelFunction[];

const DEFAULT_COLOR_WHEEL_SLOTS: ColorWheelSlot[] = [
  { id: 'cw1', name: 'Open/White', color: '#ffffff', dmxValue: 0 },
  { id: 'cw2', name: 'Red', color: '#ff0000', dmxValue: 18 },
  { id: 'cw3', name: 'Blue', color: '#0000ff', dmxValue: 36 },
  { id: 'cw4', name: 'Green', color: '#00ff00', dmxValue: 54 },
  { id: 'cw5', name: 'Yellow', color: '#ffff00', dmxValue: 72 },
  { id: 'cw6', name: 'Orange', color: '#ff8800', dmxValue: 90 },
  { id: 'cw7', name: 'Purple', color: '#8800ff', dmxValue: 108 },
  { id: 'cw8', name: 'Magenta', color: '#ff00ff', dmxValue: 126 },
];

const GOBO_ICONS = ['⬤', '◉', '◐', '◑', '◒', '◓', '⊕', '⊗', '⊘', '⊙', '◍', '◎', '●', '○', '◇', '◆', '△', '▲', '□', '■', '☆', '★', '✦', '✧', '❋', '❊', '❁', '✿', '⬡', '⬢', '⯃', '⯂'];

const CAPABILITY_TYPES: { value: ChannelCapability['type']; label: string }[] = [
  { value: 'open', label: 'Open/Blank' },
  { value: 'gobo', label: 'Gobo' },
  { value: 'color', label: 'Color' },
  { value: 'rotation', label: 'Rotation' },
  { value: 'speed', label: 'Speed' },
  { value: 'macro', label: 'Macro' },
  { value: 'custom', label: 'Custom' },
];

// ── Channels that support capability ranges ──
const CAPABILITY_CHANNELS: ChannelFunction[] = ['gobo', 'gobo-rotation', 'color-wheel', 'macro', 'fx', 'prism'];

interface Props {
  editingDef: FixtureDefinition;
  setEditingDef: (def: FixtureDefinition | null) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function FixtureEditor({ editingDef, setEditingDef, onSave, onCancel }: Props) {
  const store = useFixtureStore();
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [testUniverse, setTestUniverse] = useState(1);
  const [testAddress, setTestAddress] = useState(1);
  const [testValues, setTestValues] = useState<Record<number, number>>({});
  const [showSavedModes, setShowSavedModes] = useState(false);
  const [activeTestModeId, setActiveTestModeId] = useState<string>(editingDef.modes[0]?.id || '');

  // Get active mode for testing
  const activeTestMode = editingDef.modes.find(m => m.id === activeTestModeId) || editingDef.modes[0];

  // ── Editing helpers ──
  const updateDef = (patch: Partial<FixtureDefinition>) => setEditingDef({ ...editingDef, ...patch });

  const updateMode = (modeId: string, patch: Partial<FixtureMode>) => {
    updateDef({
      modes: editingDef.modes.map(m => m.id === modeId ? { ...m, ...patch } : m),
    });
  };

  const updateChannel = (modeId: string, chId: string, updates: Partial<FixtureChannel>) => {
    updateDef({
      modes: editingDef.modes.map(m => {
        if (m.id !== modeId) return m;
        return { ...m, channels: m.channels.map(c => c.id === chId ? { ...c, ...updates } : c) };
      }),
    });
  };

  const addChannelToMode = (modeId: string) => {
    updateDef({
      modes: editingDef.modes.map(m => {
        if (m.id !== modeId) return m;
        const num = m.channels.length + 1;
        return {
          ...m,
          channelCount: num,
          channels: [...m.channels, {
            id: `ch-${Date.now()}`, number: num, name: `Ch ${num}`,
            function: 'custom' as ChannelFunction, defaultValue: 0, min: 0, max: 255,
          }],
        };
      }),
    });
  };

  const removeChannel = (modeId: string, chId: string) => {
    updateDef({
      modes: editingDef.modes.map(m => {
        if (m.id !== modeId) return m;
        const filtered = m.channels.filter(c => c.id !== chId).map((c, i) => ({ ...c, number: i + 1 }));
        return { ...m, channelCount: filtered.length, channels: filtered };
      }),
    });
  };

  const addMode = () => {
    updateDef({
      modes: [...editingDef.modes, {
        id: `mode-${Date.now()}`,
        name: `Mode ${editingDef.modes.length + 1}`,
        channelCount: 1,
        channels: [{ id: `ch-${Date.now()}`, number: 1, name: 'Ch 1', function: 'dimmer' as ChannelFunction, defaultValue: 0, min: 0, max: 255 }],
      }],
    });
  };

  const removeMode = (modeId: string) => {
    if (editingDef.modes.length <= 1) return;
    updateDef({ modes: editingDef.modes.filter(m => m.id !== modeId) });
  };

  const duplicateMode = (modeId: string) => {
    const mode = editingDef.modes.find(m => m.id === modeId);
    if (!mode) return;
    const newMode: FixtureMode = {
      ...mode,
      id: `mode-${Date.now()}`,
      name: `${mode.name} (Copy)`,
      channels: mode.channels.map(c => ({ ...c, id: `ch-${Date.now()}-${c.number}` })),
    };
    updateDef({ modes: [...editingDef.modes, newMode] });
  };

  // ── Save mode as template ──
  const saveAsTemplate = (mode: FixtureMode) => {
    const saved: SavedMode = {
      id: `sm-${Date.now()}`,
      name: `${editingDef.manufacturer} ${editingDef.model} — ${mode.name}`,
      description: `${mode.channelCount}ch mode`,
      fixtureType: editingDef.type,
      mode: { ...mode, id: `mode-${Date.now()}`, channels: mode.channels.map(c => ({ ...c, id: `ch-${Date.now()}-${c.number}` })) },
      createdAt: Date.now(),
    };
    store.addSavedMode(saved);
  };

  // ── Load mode from template ──
  const loadTemplate = (saved: SavedMode) => {
    const mode = { ...saved.mode, id: `mode-${Date.now()}`, channels: saved.mode.channels.map(c => ({ ...c, id: `ch-${Date.now()}-${c.number}` })) };
    updateDef({ modes: [...editingDef.modes, mode] });
    setShowSavedModes(false);
  };

  // ── Channel capabilities (gobo/color ranges) ──
  const addCapability = (modeId: string, chId: string) => {
    const mode = editingDef.modes.find(m => m.id === modeId);
    const ch = mode?.channels.find(c => c.id === chId);
    if (!ch) return;
    const existing = ch.capabilities || [];
    const lastMax = existing.length > 0 ? existing[existing.length - 1].dmxMax + 1 : 0;
    const newCap: ChannelCapability = {
      id: `cap-${Date.now()}`,
      dmxMin: lastMax,
      dmxMax: Math.min(255, lastMax + 20),
      label: `Slot ${existing.length + 1}`,
      type: ch.function === 'gobo' ? 'gobo' : ch.function === 'color-wheel' ? 'color' : 'custom',
      icon: ch.function === 'gobo' ? GOBO_ICONS[existing.length % GOBO_ICONS.length] : undefined,
      color: ch.function === 'color-wheel' ? '#ffffff' : undefined,
    };
    updateChannel(modeId, chId, { capabilities: [...existing, newCap] });
  };

  const updateCapability = (modeId: string, chId: string, capId: string, updates: Partial<ChannelCapability>) => {
    const mode = editingDef.modes.find(m => m.id === modeId);
    const ch = mode?.channels.find(c => c.id === chId);
    if (!ch?.capabilities) return;
    updateChannel(modeId, chId, {
      capabilities: ch.capabilities.map(c => c.id === capId ? { ...c, ...updates } : c),
    });
  };

  const removeCapability = (modeId: string, chId: string, capId: string) => {
    const mode = editingDef.modes.find(m => m.id === modeId);
    const ch = mode?.channels.find(c => c.id === chId);
    if (!ch?.capabilities) return;
    updateChannel(modeId, chId, { capabilities: ch.capabilities.filter(c => c.id !== capId) });
  };

  // ── Live DMX test ──
  const sendTestValue = useCallback((chNumber: number, value: number) => {
    const dmxCh = testAddress + chNumber - 1;
    sendDmxChannel(testUniverse, dmxCh, value);
    setTestValues(prev => ({ ...prev, [chNumber]: value }));
  }, [testUniverse, testAddress]);

  // Reset all test channels to 0 on unmount
  useEffect(() => {
    return () => {
      if (testMode && activeTestMode) {
        activeTestMode.channels.forEach(ch => {
          sendDmxChannel(testUniverse, testAddress + ch.number - 1, 0);
        });
      }
    };
  }, [testMode]);

  // Find capability at current test value
  const getActiveCapability = (ch: FixtureChannel): ChannelCapability | undefined => {
    const val = testValues[ch.number] ?? ch.defaultValue;
    return ch.capabilities?.find(c => val >= c.dmxMin && val <= c.dmxMax);
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-primary font-semibold">Fixture Definition Editor</span>
        <div className="flex gap-1">
          <Button size="sm" className="h-7 text-[10px] gap-1" onClick={onSave}>
            <Save size={12} /> Save
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={onCancel}>
            <X size={12} />
          </Button>
        </div>
      </div>

      {/* Basic info */}
      <div className="glass-panel p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[8px] uppercase text-muted-foreground">Manufacturer</label>
            <Input value={editingDef.manufacturer}
              onChange={e => updateDef({ manufacturer: e.target.value })}
              placeholder="e.g. Chauvet" className="h-7 text-xs bg-muted/30 border-border/30" />
          </div>
          <div>
            <label className="text-[8px] uppercase text-muted-foreground">Model</label>
            <Input value={editingDef.model}
              onChange={e => updateDef({ model: e.target.value })}
              placeholder="e.g. Intimidator Spot 360" className="h-7 text-xs bg-muted/30 border-border/30" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[8px] uppercase text-muted-foreground">Type</label>
            <select value={editingDef.type}
              onChange={e => updateDef({ type: e.target.value as FixtureDefinition['type'] })}
              className="w-full h-7 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground">
              {FIXTURE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[8px] uppercase text-muted-foreground">Color System</label>
            <select value={editingDef.colorSystem}
              onChange={e => {
                const cs = e.target.value as ColorSystem;
                updateDef({
                  colorSystem: cs,
                  colorWheelSlots: cs === 'color-wheel' ? (editingDef.colorWheelSlots || [...DEFAULT_COLOR_WHEEL_SLOTS]) : undefined,
                });
              }}
              className="w-full h-7 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground">
              {COLOR_SYSTEMS.map(cs => <option key={cs.value} value={cs.value}>{cs.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Color Wheel Slots */}
      {editingDef.colorSystem === 'color-wheel' && (
        <div className="glass-panel p-3 space-y-2 border-l-2 border-l-[hsl(var(--stokio-pink))]">
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">Fixed Color Wheel Slots</span>
            <Button variant="ghost" size="sm" className="h-5 text-[9px] px-2" onClick={() => {
              const slots = editingDef.colorWheelSlots || [];
              updateDef({
                colorWheelSlots: [...slots, {
                  id: `cw-${Date.now()}`, name: `Color ${slots.length + 1}`,
                  color: '#ffffff', dmxValue: slots.length > 0 ? Math.min(255, slots[slots.length - 1].dmxValue + 18) : 0,
                }],
              });
            }}>
              <Plus size={10} /> Slot
            </Button>
          </div>
          <div className="space-y-1">
            <div className="grid grid-cols-[24px_1fr_70px_50px_20px] gap-1 text-[7px] uppercase text-muted-foreground/60 px-1">
              <span></span><span>Name</span><span>Color</span><span>DMX</span><span></span>
            </div>
            {(editingDef.colorWheelSlots || []).map(slot => (
              <div key={slot.id} className="grid grid-cols-[24px_1fr_70px_50px_20px] gap-1 items-center">
                <div className="w-5 h-5 rounded-full border border-border/30 mx-auto" style={{ backgroundColor: slot.color, boxShadow: `0 0 6px ${slot.color}40` }} />
                <Input value={slot.name}
                  onChange={e => updateDef({
                    colorWheelSlots: editingDef.colorWheelSlots?.map(s => s.id === slot.id ? { ...s, name: e.target.value } : s),
                  })}
                  className="h-6 text-[10px] bg-muted/20 border-border/20 px-1" />
                <Input type="color" value={slot.color}
                  onChange={e => updateDef({
                    colorWheelSlots: editingDef.colorWheelSlots?.map(s => s.id === slot.id ? { ...s, color: e.target.value } : s),
                  })}
                  className="h-6 p-0 bg-transparent border-border/20 cursor-pointer" />
                <Input type="number" min={0} max={255} value={slot.dmxValue}
                  onChange={e => updateDef({
                    colorWheelSlots: editingDef.colorWheelSlots?.map(s => s.id === slot.id ? { ...s, dmxValue: Number(e.target.value) } : s),
                  })}
                  className="h-6 text-[10px] bg-muted/20 border-border/20 font-mono px-1" />
                <button onClick={() => updateDef({
                  colorWheelSlots: editingDef.colorWheelSlots?.filter(s => s.id !== slot.id),
                })} className="text-muted-foreground hover:text-destructive flex items-center justify-center">
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-0.5 mt-2">
            {(editingDef.colorWheelSlots || []).map(slot => (
              <div key={slot.id} className="flex-1 h-4 rounded-sm" style={{ backgroundColor: slot.color }} title={`${slot.name} (DMX: ${slot.dmxValue})`} />
            ))}
          </div>
        </div>
      )}

      {/* ═══ LIVE TEST PANEL ═══ */}
      <div className="glass-panel p-3 space-y-2 border-l-2 border-l-green-500/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-widest font-semibold text-green-400">🎚️ Live Test</span>
            {testMode && (
              <span className="text-[7px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 animate-pulse">LIVE</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {testMode && (
              <>
                <div className="flex items-center gap-1">
                  <span className="text-[7px] text-muted-foreground">Uni</span>
                  <Input type="number" min={1} max={32768} value={testUniverse}
                    onChange={e => setTestUniverse(Number(e.target.value))}
                    className="h-5 w-12 text-[9px] bg-muted/20 border-border/20 font-mono px-1" />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[7px] text-muted-foreground">Addr</span>
                  <Input type="number" min={1} max={512} value={testAddress}
                    onChange={e => setTestAddress(Number(e.target.value))}
                    className="h-5 w-12 text-[9px] bg-muted/20 border-border/20 font-mono px-1" />
                </div>
              </>
            )}
            <button
              onClick={() => {
                if (testMode && activeTestMode) {
                  activeTestMode.channels.forEach(ch => sendDmxChannel(testUniverse, testAddress + ch.number - 1, 0));
                  setTestValues({});
                }
                setTestMode(!testMode);
              }}
              className={`px-2 py-0.5 rounded text-[8px] font-semibold transition-all ${
                testMode
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-muted/20 text-muted-foreground border border-border/20'
              }`}
            >
              {testMode ? '■ Stoppa' : '▶ Starta Test'}
            </button>
          </div>
        </div>

        {testMode && activeTestMode && (
          <div className="space-y-1">
            {/* Mode selector for test */}
            <div className="flex gap-1 mb-2">
              {editingDef.modes.map(m => (
                <button key={m.id}
                  onClick={() => { setActiveTestModeId(m.id); setTestValues({}); }}
                  className={`px-2 py-0.5 rounded text-[8px] transition-all ${
                    m.id === activeTestModeId ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-muted/20 text-muted-foreground'
                  }`}>
                  {m.name}
                </button>
              ))}
            </div>

            {/* Faders */}
            <div className="flex gap-1 overflow-x-auto pb-2" style={{ minHeight: 180 }}>
              {activeTestMode.channels.map(ch => {
                const val = testValues[ch.number] ?? ch.defaultValue;
                const color = getChannelColor(ch.function);
                const activeCap = getActiveCapability(ch);
                return (
                  <div key={ch.id} className="flex flex-col items-center gap-1 min-w-[36px]" style={{ width: 36 }}>
                    {/* Value */}
                    <span className="text-[8px] font-mono" style={{ color }}>{val}</span>
                    {/* Active capability indicator */}
                    {activeCap && (
                      <span className="text-[10px]" title={activeCap.label}>
                        {activeCap.icon || (activeCap.color ? <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: activeCap.color }} /> : '•')}
                      </span>
                    )}
                    {/* Vertical slider */}
                    <div className="relative flex-1 w-5" style={{ minHeight: 100 }}>
                      <input
                        type="range"
                        min={0}
                        max={255}
                        value={val}
                        onChange={e => sendTestValue(ch.number, Number(e.target.value))}
                        className="absolute w-[100px] origin-bottom-left"
                        style={{
                          transform: 'rotate(-90deg) translateX(-100%)',
                          left: '50%',
                          bottom: 0,
                          marginLeft: -50,
                          accentColor: color,
                        }}
                      />
                    </div>
                    {/* Channel info */}
                    <span className="text-[6px] text-muted-foreground text-center leading-tight truncate w-full" title={ch.name}>
                      {ch.number}
                    </span>
                    <span className="text-[5px] text-muted-foreground/50 truncate w-full text-center" title={CHANNEL_FUNCTION_LABELS[ch.function]}>
                      {ch.name.length > 5 ? ch.name.slice(0, 5) : ch.name}
                    </span>
                  </div>
                );
              })}
            </div>
            {/* Quick actions */}
            <div className="flex gap-1">
              <Button variant="outline" size="sm" className="h-5 text-[8px]" onClick={() => {
                activeTestMode.channels.forEach(ch => sendTestValue(ch.number, 0));
              }}>Alla 0</Button>
              <Button variant="outline" size="sm" className="h-5 text-[8px]" onClick={() => {
                activeTestMode.channels.forEach(ch => sendTestValue(ch.number, 255));
              }}>Alla 255</Button>
              <Button variant="outline" size="sm" className="h-5 text-[8px]" onClick={() => {
                activeTestMode.channels.forEach(ch => sendTestValue(ch.number, ch.defaultValue));
              }}>Default</Button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ SAVED MODE TEMPLATES ═══ */}
      <div className="glass-panel p-3 space-y-2">
        <div className="flex items-center justify-between">
          <button onClick={() => setShowSavedModes(!showSavedModes)} className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">
            <Bookmark size={10} /> Sparade Kanal-lägen ({store.savedModes.length})
            {showSavedModes ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        </div>
        <AnimatePresence>
          {showSavedModes && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="space-y-1 overflow-hidden">
              {store.savedModes.length === 0 && (
                <div className="text-[8px] text-muted-foreground/40 text-center py-2 italic">
                  Inga sparade lägen. Klicka 💾 på ett läge nedan för att spara det som mall.
                </div>
              )}
              {store.savedModes.map(sm => (
                <div key={sm.id} className="flex items-center gap-2 p-1.5 rounded bg-muted/10 border border-border/10">
                  <div className="flex-1 min-w-0">
                    <div className="text-[9px] font-semibold truncate">{sm.name}</div>
                    <div className="text-[7px] text-muted-foreground">{sm.mode.channelCount}ch · {sm.fixtureType}</div>
                  </div>
                  <Button variant="ghost" size="sm" className="h-5 text-[8px] px-2 text-primary" onClick={() => loadTemplate(sm)}>
                    Ladda
                  </Button>
                  <button onClick={() => store.removeSavedMode(sm.id)} className="text-muted-foreground/40 hover:text-destructive">
                    <X size={10} />
                  </button>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ═══ MODE EDITOR ═══ */}
      {editingDef.modes.map((mode, mIdx) => (
        <div key={mode.id} className="glass-panel p-3 space-y-2 border-l-2" style={{ borderLeftColor: mIdx === 0 ? '#00e5ff' : mIdx === 1 ? '#ff2d78' : '#ffaa00' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Input value={mode.name}
                onChange={e => updateMode(mode.id, { name: e.target.value })}
                className="h-6 text-[10px] bg-transparent border-0 p-0 font-semibold w-32" />
              <span className="text-[8px] text-muted-foreground">{mode.channelCount}ch</span>
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-5 text-[9px] px-2" onClick={() => addChannelToMode(mode.id)}>
                <Plus size={10} /> Ch
              </Button>
              <Button variant="ghost" size="sm" className="h-5 text-[9px] px-1" title="Duplicera läge" onClick={() => duplicateMode(mode.id)}>
                <Copy size={10} />
              </Button>
              <Button variant="ghost" size="sm" className="h-5 text-[9px] px-1" title="Spara som mall" onClick={() => saveAsTemplate(mode)}>
                <Bookmark size={10} />
              </Button>
              {editingDef.modes.length > 1 && (
                <Button variant="ghost" size="sm" className="h-5 text-[9px] px-1 text-destructive" onClick={() => removeMode(mode.id)}>
                  <Trash2 size={10} />
                </Button>
              )}
            </div>
          </div>

          {/* Channel list */}
          <div className="space-y-1">
            <div className="grid grid-cols-[30px_1fr_1fr_40px_20px] gap-1 text-[7px] uppercase text-muted-foreground/60 px-1">
              <span>Ch</span><span>Name</span><span>Function</span><span>Def</span><span></span>
            </div>
            {mode.channels.map(ch => {
              const hasCaps = CAPABILITY_CHANNELS.includes(ch.function);
              const isExpanded = expandedChannel === `${mode.id}-${ch.id}`;
              const capCount = ch.capabilities?.length || 0;
              return (
                <div key={ch.id}>
                  <div className="grid grid-cols-[30px_1fr_1fr_40px_20px] gap-1 items-center">
                    <span className="text-[10px] font-mono text-center" style={{ color: getChannelColor(ch.function) }}>
                      {ch.number}
                    </span>
                    <Input value={ch.name}
                      onChange={e => updateChannel(mode.id, ch.id, { name: e.target.value })}
                      className="h-6 text-[10px] bg-muted/20 border-border/20 px-1" />
                    <div className="flex items-center gap-0.5">
                      <select value={ch.function}
                        onChange={e => updateChannel(mode.id, ch.id, { function: e.target.value as ChannelFunction })}
                        className="flex-1 h-6 rounded bg-muted/20 border border-border/20 text-[10px] px-1 text-foreground">
                        {ALL_FUNCTIONS.map(f => (
                          <option key={f} value={f}>{CHANNEL_FUNCTION_LABELS[f]}</option>
                        ))}
                      </select>
                      {hasCaps && (
                        <button
                          onClick={() => setExpandedChannel(isExpanded ? null : `${mode.id}-${ch.id}`)}
                          className={`text-[7px] px-1 py-0.5 rounded transition-all ${
                            capCount > 0 ? 'bg-primary/20 text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground'
                          }`}
                          title={`${capCount} capability ranges`}
                        >
                          {capCount > 0 ? `${capCount}×` : '+'}{isExpanded ? '▼' : '▶'}
                        </button>
                      )}
                    </div>
                    <Input type="number" min={0} max={255} value={ch.defaultValue}
                      onChange={e => updateChannel(mode.id, ch.id, { defaultValue: Number(e.target.value) })}
                      className="h-6 text-[10px] bg-muted/20 border-border/20 font-mono px-1" />
                    <button onClick={() => removeChannel(mode.id, ch.id)}
                      className="text-muted-foreground hover:text-destructive flex items-center justify-center">
                      <X size={10} />
                    </button>
                  </div>

                  {/* ═══ CAPABILITY RANGES (Gobo/Color/Macro slots) ═══ */}
                  <AnimatePresence>
                    {isExpanded && hasCaps && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="ml-8 mt-1 mb-2 space-y-1 overflow-hidden"
                      >
                        <div className="text-[7px] uppercase text-muted-foreground/60 font-semibold flex items-center justify-between">
                          <span>DMX Ranges — {CHANNEL_FUNCTION_LABELS[ch.function]}</span>
                          <Button variant="ghost" size="sm" className="h-4 text-[7px] px-1" onClick={() => addCapability(mode.id, ch.id)}>
                            <Plus size={8} /> Lägg till
                          </Button>
                        </div>

                        {/* DMX range bar visualization */}
                        {(ch.capabilities || []).length > 0 && (
                          <div className="relative h-5 bg-muted/20 rounded-sm border border-border/10 overflow-hidden">
                            {(ch.capabilities || []).map(cap => {
                              const w = ((cap.dmxMax - cap.dmxMin + 1) / 256) * 100;
                              const l = (cap.dmxMin / 256) * 100;
                              return (
                                <div
                                  key={cap.id}
                                  className="absolute top-0 h-full flex items-center justify-center text-[6px] font-mono border-r border-background/50"
                                  style={{
                                    left: `${l}%`,
                                    width: `${Math.max(w, 1)}%`,
                                    backgroundColor: cap.color ? `${cap.color}44` : cap.type === 'gobo' ? 'rgba(136,204,68,0.3)' : 'rgba(0,229,255,0.2)',
                                  }}
                                  title={`${cap.label}: ${cap.dmxMin}–${cap.dmxMax}`}
                                >
                                  <span className="truncate px-0.5">
                                    {cap.icon || cap.label.slice(0, 4)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Capability rows */}
                        <div className="space-y-0.5">
                          <div className="grid grid-cols-[20px_40px_40px_1fr_50px_20px_20px] gap-1 text-[6px] uppercase text-muted-foreground/40 px-0.5">
                            <span></span><span>Min</span><span>Max</span><span>Label</span><span>Typ</span><span>Ikon</span><span></span>
                          </div>
                          {(ch.capabilities || []).map(cap => (
                            <div key={cap.id} className="grid grid-cols-[20px_40px_40px_1fr_50px_20px_20px] gap-1 items-center">
                              {/* Icon/Color preview */}
                              <div className="flex items-center justify-center">
                                {cap.color ? (
                                  <div className="w-4 h-4 rounded-full border border-border/30" style={{ backgroundColor: cap.color }} />
                                ) : (
                                  <span className="text-[10px]">{cap.icon || '•'}</span>
                                )}
                              </div>
                              <Input type="number" min={0} max={255} value={cap.dmxMin}
                                onChange={e => updateCapability(mode.id, ch.id, cap.id, { dmxMin: Number(e.target.value) })}
                                className="h-5 text-[8px] bg-muted/20 border-border/20 font-mono px-1" />
                              <Input type="number" min={0} max={255} value={cap.dmxMax}
                                onChange={e => updateCapability(mode.id, ch.id, cap.id, { dmxMax: Number(e.target.value) })}
                                className="h-5 text-[8px] bg-muted/20 border-border/20 font-mono px-1" />
                              <Input value={cap.label}
                                onChange={e => updateCapability(mode.id, ch.id, cap.id, { label: e.target.value })}
                                className="h-5 text-[8px] bg-muted/20 border-border/20 px-1" />
                              <select value={cap.type || 'custom'}
                                onChange={e => updateCapability(mode.id, ch.id, cap.id, { type: e.target.value as ChannelCapability['type'] })}
                                className="h-5 rounded bg-muted/20 border border-border/20 text-[7px] px-0.5 text-foreground">
                                {CAPABILITY_TYPES.map(t => (
                                  <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                              </select>
                              {/* Icon picker (gobo) or color (color-wheel) */}
                              {cap.type === 'gobo' ? (
                                <select value={cap.icon || '⬤'}
                                  onChange={e => updateCapability(mode.id, ch.id, cap.id, { icon: e.target.value })}
                                  className="h-5 rounded bg-muted/20 border border-border/20 text-[10px] px-0 text-foreground text-center">
                                  {GOBO_ICONS.map(g => <option key={g} value={g}>{g}</option>)}
                                </select>
                              ) : cap.type === 'color' ? (
                                <input type="color" value={cap.color || '#ffffff'}
                                  onChange={e => updateCapability(mode.id, ch.id, cap.id, { color: e.target.value })}
                                  className="h-5 w-5 p-0 bg-transparent border-0 cursor-pointer" />
                              ) : (
                                <span className="text-[8px] text-muted-foreground/30 text-center">—</span>
                              )}
                              <button onClick={() => removeCapability(mode.id, ch.id, cap.id)}
                                className="text-muted-foreground/40 hover:text-destructive flex items-center justify-center">
                                <X size={8} />
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Quick-fill for gobo channels */}
                        {ch.function === 'gobo' && (ch.capabilities || []).length === 0 && (
                          <Button variant="outline" size="sm" className="h-5 text-[7px] w-full" onClick={() => {
                            const slots: ChannelCapability[] = [];
                            const slotSize = 20;
                            for (let i = 0; i < 8; i++) {
                              slots.push({
                                id: `cap-${Date.now()}-${i}`,
                                dmxMin: i * slotSize,
                                dmxMax: (i + 1) * slotSize - 1,
                                label: i === 0 ? 'Open' : `Gobo ${i}`,
                                type: i === 0 ? 'open' : 'gobo',
                                icon: i === 0 ? '○' : GOBO_ICONS[i],
                              });
                            }
                            updateChannel(mode.id, ch.id, { capabilities: slots });
                          }}>
                            ⚡ Fyll 8 gobo-slots (0–20, 21–40 osv)
                          </Button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 w-full" onClick={addMode}>
        <Plus size={12} /> Lägg till Läge (Mode)
      </Button>
    </div>
  );
}
