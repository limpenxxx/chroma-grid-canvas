import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, Upload, Download, Search, Edit2, Save, X, ChevronDown, ChevronRight, Copy, Wifi
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useFixtureStore, type FixtureDefinition, type FixtureInstance, type FixtureMode,
  type FixtureChannel, type ChannelFunction, type ColorSystem, type ColorWheelSlot,
  CHANNEL_FUNCTION_LABELS, getChannelColor, getFixtureTypeIcon,
  FIXTURE_ICON_OPTIONS, getFixtureIconEmoji, type FixtureIcon,
} from '@/store/fixtureStore';
import { useWledStore, type WledFixture } from '@/store/wledStore';
import { WledPanel } from './WledPanel';
import { HuePanel } from './HuePanel';

type Tab = 'instances' | 'library' | 'editor' | 'wled' | 'hue' | 'io';

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

const ALL_FUNCTIONS: ChannelFunction[] = Object.keys(CHANNEL_FUNCTION_LABELS) as ChannelFunction[];

export function Devices() {
  const store = useFixtureStore();
  const wledStore = useWledStore();
  const [tab, setTab] = useState<Tab>('instances');
  const [search, setSearch] = useState('');
  const [editingDef, setEditingDef] = useState<FixtureDefinition | null>(null);
  const [expandedInstance, setExpandedInstance] = useState<string | null>(null);
  const [addingInstance, setAddingInstance] = useState(false);
  const [newInstDefId, setNewInstDefId] = useState('');
  const [newInstName, setNewInstName] = useState('');
  const [newInstAddr, setNewInstAddr] = useState(1);
  const [newInstUniverse, setNewInstUniverse] = useState(1);
  const importRef = useRef<HTMLInputElement>(null);

  // Filter
  const filteredDefs = store.definitions.filter(d =>
    `${d.manufacturer} ${d.model}`.toLowerCase().includes(search.toLowerCase())
  );
  const filteredInsts = store.instances.filter(i => {
    const def = store.definitions.find(d => d.id === i.definitionId);
    return i.name.toLowerCase().includes(search.toLowerCase()) ||
      (def && `${def.manufacturer} ${def.model}`.toLowerCase().includes(search.toLowerCase()));
  });

  const handleExport = () => {
    const json = store.exportLibrary();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'stokio-fixtures.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => store.importLibrary(reader.result as string);
    reader.readAsText(file);
    e.target.value = '';
  };

  const addNewInstance = () => {
    if (!newInstDefId) return;
    const def = store.definitions.find(d => d.id === newInstDefId);
    if (!def) return;
    const inst: FixtureInstance = {
      id: `inst-${Date.now()}`,
      definitionId: newInstDefId,
      name: newInstName || `${def.model}-${store.instances.length + 1}`,
      universe: newInstUniverse,
      dmxAddress: newInstAddr,
      modeId: def.modes[0].id,
      onStage: false,
      stageX: 200 + Math.random() * 200,
      stageY: 100 + Math.random() * 200,
      stageWidth: 36,
      stageHeight: 36,
    };
    store.addInstance(inst);
    setAddingInstance(false);
    setNewInstName('');
  };

  const startNewDefinition = () => {
    const newDef: FixtureDefinition = {
      id: `def-${Date.now()}`,
      manufacturer: '',
      model: '',
      type: 'par',
      category: 'dmx',
      colorSystem: 'rgb',
      createdAt: Date.now(),
      modes: [{
        id: `mode-${Date.now()}`,
        name: 'Default',
        channelCount: 1,
        channels: [{
          id: `ch-${Date.now()}`,
          number: 1, name: 'Dimmer', function: 'dimmer',
          defaultValue: 0, min: 0, max: 255,
        }],
      }],
    };
    setEditingDef(newDef);
    setTab('editor');
  };

  const saveDefinition = () => {
    if (!editingDef) return;
    const existing = store.definitions.find(d => d.id === editingDef.id);
    if (existing) {
      store.updateDefinition(editingDef.id, editingDef);
    } else {
      store.addDefinition(editingDef);
    }
    setEditingDef(null);
    setTab('library');
  };

  const addModeToEditor = () => {
    if (!editingDef) return;
    setEditingDef({
      ...editingDef,
      modes: [...editingDef.modes, {
        id: `mode-${Date.now()}`,
        name: `Mode ${editingDef.modes.length + 1}`,
        channelCount: 1,
        channels: [{ id: `ch-${Date.now()}`, number: 1, name: 'Ch 1', function: 'dimmer', defaultValue: 0, min: 0, max: 255 }],
      }],
    });
  };

  const addChannelToMode = (modeId: string) => {
    if (!editingDef) return;
    setEditingDef({
      ...editingDef,
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

  const updateChannel = (modeId: string, chId: string, updates: Partial<FixtureChannel>) => {
    if (!editingDef) return;
    setEditingDef({
      ...editingDef,
      modes: editingDef.modes.map(m => {
        if (m.id !== modeId) return m;
        return { ...m, channels: m.channels.map(c => c.id === chId ? { ...c, ...updates } : c) };
      }),
    });
  };

  const removeChannel = (modeId: string, chId: string) => {
    if (!editingDef) return;
    setEditingDef({
      ...editingDef,
      modes: editingDef.modes.map(m => {
        if (m.id !== modeId) return m;
        const filtered = m.channels.filter(c => c.id !== chId).map((c, i) => ({ ...c, number: i + 1 }));
        return { ...m, channelCount: filtered.length, channels: filtered };
      }),
    });
  };

  const removeMode = (modeId: string) => {
    if (!editingDef || editingDef.modes.length <= 1) return;
    setEditingDef({ ...editingDef, modes: editingDef.modes.filter(m => m.id !== modeId) });
  };

  const getInstanceDef = (inst: FixtureInstance) => store.definitions.find(d => d.id === inst.definitionId);
  const getInstanceMode = (inst: FixtureInstance) => {
    const def = getInstanceDef(inst);
    return def?.modes.find(m => m.id === inst.modeId);
  };

  // DMX address conflict check
  const getAddressConflicts = (inst: FixtureInstance): string[] => {
    const mode = getInstanceMode(inst);
    if (!mode) return [];
    const end = inst.dmxAddress + mode.channelCount - 1;
    return store.instances.filter(other => {
      if (other.id === inst.id || other.universe !== inst.universe) return false;
      const otherMode = getInstanceMode(other);
      if (!otherMode) return false;
      const otherEnd = other.dmxAddress + otherMode.channelCount - 1;
      return inst.dmxAddress <= otherEnd && end >= other.dmxAddress;
    }).map(o => o.name);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-wider">DEVICES</h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
            {store.instances.length} fixtures
          </span>
        </div>
        <div className="flex gap-1">
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={() => importRef.current?.click()}>
            <Upload size={12} /> Import
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={handleExport}>
            <Download size={12} /> Export
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/30 overflow-x-auto">
        {(['instances', 'library', 'editor', 'wled', 'hue', 'io'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-[10px] uppercase tracking-wider font-semibold transition-colors border-b-2 whitespace-nowrap ${
              tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'instances' ? 'Patched Fixtures' : t === 'library' ? 'Fixture Library' : t === 'editor' ? 'Fixture Editor' : t === 'wled' ? '📡 WLED' : t === 'hue' ? '💡 Philips Hue' : '🔌 I/O Setup'}
          </button>
        ))}
      </div>

      {/* Search */}
      {tab !== 'editor' && (
        <div className="p-3 pb-0">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search fixtures..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-muted/30 border-border/30 text-xs h-8 pl-8"
            />
          </div>
        </div>
      )}

      {/* INSTANCES TAB */}
      {tab === 'instances' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {/* Add Instance */}
          <div className="mb-3">
            {addingInstance ? (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                className="glass-panel p-3 space-y-2">
                <div className="text-[9px] uppercase tracking-widest text-primary font-semibold">Add New DMX Fixture</div>
                <select value={newInstDefId} onChange={e => setNewInstDefId(e.target.value)}
                  className="w-full h-7 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground">
                  <option value="">Select fixture type...</option>
                  {store.definitions.filter(d => d.category === 'dmx').map(d => (
                    <option key={d.id} value={d.id}>{d.manufacturer} {d.model}</option>
                  ))}
                </select>
                <div className="grid grid-cols-3 gap-2">
                  <Input placeholder="Name" value={newInstName} onChange={e => setNewInstName(e.target.value)}
                    className="h-7 text-xs bg-muted/30 border-border/30" />
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] text-muted-foreground">Uni</span>
                    <Input type="number" min={1} max={32768} value={newInstUniverse}
                      onChange={e => setNewInstUniverse(Number(e.target.value))}
                      className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] text-muted-foreground">Addr</span>
                    <Input type="number" min={1} max={512} value={newInstAddr}
                      onChange={e => setNewInstAddr(Number(e.target.value))}
                      className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-[10px]" onClick={addNewInstance}>Patch</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => setAddingInstance(false)}>Cancel</Button>
                </div>
              </motion.div>
            ) : (
              <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 w-full" onClick={() => setAddingInstance(true)}>
                <Plus size={12} /> Add New DMX Fixture
              </Button>
            )}
          </div>

          {/* DMX Address Map */}
          <div className="glass-panel p-3 mb-3">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">DMX Universe Map</div>
            <div className="h-6 bg-muted/30 rounded-sm relative overflow-hidden border border-border/20">
              {filteredInsts.filter(i => i.universe === 1).map(inst => {
                const mode = getInstanceMode(inst);
                if (!mode) return null;
                const w = (mode.channelCount / 512) * 100;
                const l = ((inst.dmxAddress - 1) / 512) * 100;
                const conflicts = getAddressConflicts(inst);
                return (
                  <div
                    key={inst.id}
                    className="absolute top-0 h-full flex items-center justify-center text-[7px] font-mono border-r border-background"
                    style={{
                      left: `${l}%`, width: `${Math.max(w, 0.5)}%`,
                      backgroundColor: conflicts.length > 0 ? 'rgba(255,45,120,0.5)' : 'rgba(0,229,255,0.3)',
                    }}
                    title={`${inst.name}: Ch ${inst.dmxAddress}-${inst.dmxAddress + mode.channelCount - 1}`}
                  >
                    {mode.channelCount > 4 && <span className="truncate px-0.5">{inst.name}</span>}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-1 text-[7px] text-muted-foreground/50 font-mono">
              <span>1</span><span>128</span><span>256</span><span>384</span><span>512</span>
            </div>
          </div>

          {/* Section: DMX Fixtures */}
          {filteredInsts.length > 0 && (
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold mb-1 mt-2">
              DMX Fixtures
            </div>
          )}

          {/* DMX Instance list */}
          {filteredInsts.map(inst => {
            const def = getInstanceDef(inst);
            const mode = getInstanceMode(inst);
            if (!def || !mode) return null;
            const expanded = expandedInstance === inst.id;
            const conflicts = getAddressConflicts(inst);
            const endAddr = inst.dmxAddress + mode.channelCount - 1;

            return (
              <div key={inst.id} className={`rounded-lg border transition-all ${
                conflicts.length > 0
                  ? 'border-destructive/40 bg-destructive/5'
                  : 'border-green-500/20 bg-green-500/10'
              }`}>
                <button
                  onClick={() => setExpandedInstance(expanded ? null : inst.id)}
                  className="w-full flex items-center gap-3 p-3 text-left"
                >
                  <span className="text-lg">{inst.icon ? getFixtureIconEmoji(inst.icon) : getFixtureTypeIcon(def.type)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold">{inst.name}</div>
                    <div className="text-[9px] text-muted-foreground">{def.manufacturer} {def.model} — {mode.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-mono text-stokio-cyan">
                      U{inst.universe}.{String(inst.dmxAddress).padStart(3, '0')}–{String(endAddr).padStart(3, '0')}
                    </div>
                    <div className="text-[8px] text-muted-foreground">{mode.channelCount}ch</div>
                  </div>
                  {conflicts.length > 0 && (
                    <span className="text-[8px] text-destructive px-1.5 py-0.5 rounded bg-destructive/10">CONFLICT</span>
                  )}
                  {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>

                <AnimatePresence>
                  {expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 pb-3 space-y-2 border-t border-border/20 pt-2">
                        {/* Icon Selector */}
                        <div>
                          <label className="text-[7px] uppercase text-muted-foreground">Icon</label>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {FIXTURE_ICON_OPTIONS.map(opt => (
                              <button
                                key={opt.value}
                                onClick={() => store.updateInstance(inst.id, { icon: opt.value })}
                                className={`w-7 h-7 rounded text-sm flex items-center justify-center border transition-all ${
                                  inst.icon === opt.value
                                    ? 'border-primary bg-primary/20'
                                    : 'border-border/30 bg-muted/20 hover:bg-muted/40'
                                }`}
                                title={opt.label}
                              >
                                {opt.emoji}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* DMX Settings */}
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-[7px] uppercase text-muted-foreground">Universe</label>
                            <Input type="number" min={1} value={inst.universe}
                              onChange={e => store.updateInstance(inst.id, { universe: Number(e.target.value) })}
                              className="h-6 text-[10px] bg-muted/30 border-border/30 font-mono" />
                          </div>
                          <div>
                            <label className="text-[7px] uppercase text-muted-foreground">DMX Address</label>
                            <Input type="number" min={1} max={512} value={inst.dmxAddress}
                              onChange={e => store.updateInstance(inst.id, { dmxAddress: Number(e.target.value) })}
                              className="h-6 text-[10px] bg-muted/30 border-border/30 font-mono" />
                          </div>
                          <div>
                            <label className="text-[7px] uppercase text-muted-foreground">Mode</label>
                            <select value={inst.modeId}
                              onChange={e => store.updateInstance(inst.id, { modeId: e.target.value })}
                              className="w-full h-6 rounded bg-muted/30 border border-border/30 text-[10px] px-1 text-foreground">
                              {def.modes.map(m => <option key={m.id} value={m.id}>{m.name} ({m.channelCount}ch)</option>)}
                            </select>
                          </div>
                        </div>

                        {/* Channel Map */}
                        <div>
                          <div className="text-[8px] uppercase tracking-wider text-muted-foreground mb-1">Channel Map</div>
                          <div className="space-y-0.5">
                            {mode.channels.map(ch => (
                              <div key={ch.id} className="flex items-center gap-2 text-[9px] py-0.5">
                                <span className="font-mono text-muted-foreground w-8">
                                  {String(inst.dmxAddress + ch.number - 1).padStart(3, '0')}
                                </span>
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getChannelColor(ch.function) }} />
                                <span className="flex-1">{ch.name}</span>
                                <span className="text-[8px] text-muted-foreground uppercase">{ch.function}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-1 pt-1">
                          <Button variant="outline" size="sm" className="h-6 text-[9px] gap-1"
                            onClick={() => store.updateInstance(inst.id, { onStage: !inst.onStage })}>
                            {inst.onStage ? '✓ On Stage' : 'Add to Stage'}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 text-[9px] gap-1 text-destructive"
                            onClick={() => store.removeInstance(inst.id)}>
                            <Trash2 size={10} /> Remove
                          </Button>
                        </div>

                        {conflicts.length > 0 && (
                          <div className="text-[9px] text-destructive bg-destructive/10 rounded p-2">
                            ⚠ Address conflict with: {conflicts.join(', ')}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          {/* Section: WLED Fixtures */}
          {wledStore.fixtures.length > 0 && (
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold mb-1 mt-4">
              WLED Fixtures
            </div>
          )}

          {wledStore.fixtures
            .filter(f => f.name.toLowerCase().includes(search.toLowerCase()) || f.deviceName.toLowerCase().includes(search.toLowerCase()))
            .map(fix => {
              const device = wledStore.devices.find(d => d.id === fix.deviceId);
              const expanded = expandedInstance === fix.id;

              return (
                <div key={fix.id} className="rounded-lg border transition-all border-blue-400/20 bg-blue-400/10">
                  <button
                    onClick={() => setExpandedInstance(expanded ? null : fix.id)}
                    className="w-full flex items-center gap-3 p-3 text-left"
                  >
                    <span className="text-lg">{fix.icon ? getFixtureIconEmoji(fix.icon) : '💡'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold">{fix.name}</div>
                      <div className="text-[9px] text-muted-foreground">
                        {fix.deviceName} — Seg {fix.segmentId} — LED {fix.ledStart}–{fix.ledEnd}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div className="text-[10px] font-mono text-blue-400">{fix.deviceIp}</div>
                        <div className="text-[8px] text-muted-foreground">{fix.ledEnd - fix.ledStart + 1} LEDs</div>
                      </div>
                      <div className={`w-2 h-2 rounded-full ${device?.online ? 'bg-green-500' : 'bg-red-500'}`}
                        title={device?.online ? 'Online' : 'Offline'} />
                    </div>
                    {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>

                  <AnimatePresence>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="px-3 pb-3 space-y-2 border-t border-border/20 pt-2">
                          {/* Icon Selector */}
                          <div>
                            <label className="text-[7px] uppercase text-muted-foreground">Icon</label>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {FIXTURE_ICON_OPTIONS.map(opt => (
                                <button
                                  key={opt.value}
                                  onClick={() => wledStore.updateFixture(fix.id, { icon: opt.value })}
                                  className={`w-7 h-7 rounded text-sm flex items-center justify-center border transition-all ${
                                    fix.icon === opt.value
                                      ? 'border-primary bg-primary/20'
                                      : 'border-border/30 bg-muted/20 hover:bg-muted/40'
                                  }`}
                                  title={opt.label}
                                >
                                  {opt.emoji}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* WLED Details */}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[7px] uppercase text-muted-foreground">Device</label>
                              <div className="text-[10px] font-mono bg-muted/30 rounded px-2 py-1">{fix.deviceName}</div>
                            </div>
                            <div>
                              <label className="text-[7px] uppercase text-muted-foreground">IP</label>
                              <div className="text-[10px] font-mono bg-muted/30 rounded px-2 py-1">{fix.deviceIp}</div>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="text-[7px] uppercase text-muted-foreground">Segment</label>
                              <div className="text-[10px] font-mono bg-muted/30 rounded px-2 py-1">{fix.segmentId}</div>
                            </div>
                            <div>
                              <label className="text-[7px] uppercase text-muted-foreground">LED Start</label>
                              <div className="text-[10px] font-mono bg-muted/30 rounded px-2 py-1">{fix.ledStart}</div>
                            </div>
                            <div>
                              <label className="text-[7px] uppercase text-muted-foreground">LED End</label>
                              <div className="text-[10px] font-mono bg-muted/30 rounded px-2 py-1">{fix.ledEnd}</div>
                            </div>
                          </div>

                          {/* Status */}
                          <div className="flex items-center gap-2 text-[9px]">
                            <div className={`w-2 h-2 rounded-full ${device?.online ? 'bg-green-500' : 'bg-red-500'}`} />
                            <span>{device?.online ? 'Online' : 'Offline'}</span>
                            {device?.lastSeen && (
                              <span className="text-muted-foreground">
                                Last seen: {new Date(device.lastSeen).toLocaleTimeString()}
                              </span>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex gap-1 pt-1">
                            <Button variant="ghost" size="sm" className="h-6 text-[9px] gap-1 text-destructive"
                              onClick={() => wledStore.removeFixture(fix.id)}>
                              <Trash2 size={10} /> Remove
                            </Button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

          {filteredInsts.length === 0 && wledStore.fixtures.length === 0 && (
            <div className="text-center text-muted-foreground text-xs py-8">
              No fixtures patched yet. Add DMX fixtures above or WLED fixtures in the WLED Devices tab.
            </div>
          )}
        </div>
      )}

      {/* LIBRARY TAB */}
      {tab === 'library' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 w-full mb-3" onClick={startNewDefinition}>
            <Plus size={12} /> Create New Fixture Definition
          </Button>

          {filteredDefs.map(def => (
            <div key={def.id} className="glass-panel p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{getFixtureTypeIcon(def.type)}</span>
                <div className="flex-1">
                  <div className="text-xs font-semibold">{def.manufacturer} {def.model}</div>
                  <div className="text-[9px] text-muted-foreground">
                    {def.modes.length} mode{def.modes.length > 1 ? 's' : ''} — {def.type}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6"
                  onClick={() => { setEditingDef({ ...def }); setTab('editor'); }}>
                  <Edit2 size={12} />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6"
                  onClick={() => {
                    const clone = { ...def, id: `def-${Date.now()}`, model: `${def.model} (Copy)`, createdAt: Date.now() };
                    store.addDefinition(clone);
                  }}>
                  <Copy size={12} />
                </Button>
                {def.createdAt > 0 && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                    onClick={() => store.removeDefinition(def.id)}>
                    <Trash2 size={12} />
                  </Button>
                )}
              </div>
              {/* Mode summary */}
              <div className="flex flex-wrap gap-1">
                {def.modes.map(m => (
                  <span key={m.id} className="text-[8px] px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground">
                    {m.name}: {m.channelCount}ch
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* EDITOR TAB */}
      {tab === 'editor' && editingDef && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-primary font-semibold">Fixture Definition Editor</span>
            <div className="flex gap-1">
              <Button size="sm" className="h-7 text-[10px] gap-1" onClick={saveDefinition}>
                <Save size={12} /> Save
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => { setEditingDef(null); setTab('library'); }}>
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
                  onChange={e => setEditingDef({ ...editingDef, manufacturer: e.target.value })}
                  placeholder="e.g. Chauvet" className="h-7 text-xs bg-muted/30 border-border/30" />
              </div>
              <div>
                <label className="text-[8px] uppercase text-muted-foreground">Model</label>
                <Input value={editingDef.model}
                  onChange={e => setEditingDef({ ...editingDef, model: e.target.value })}
                  placeholder="e.g. Intimidator Spot 360" className="h-7 text-xs bg-muted/30 border-border/30" />
              </div>
            </div>
            <div>
              <label className="text-[8px] uppercase text-muted-foreground">Type</label>
              <select value={editingDef.type}
                onChange={e => setEditingDef({ ...editingDef, type: e.target.value as FixtureDefinition['type'] })}
                className="w-full h-7 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground">
                {FIXTURE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[8px] uppercase text-muted-foreground">Color System</label>
              <select value={editingDef.colorSystem}
                onChange={e => {
                  const cs = e.target.value as ColorSystem;
                  setEditingDef({
                    ...editingDef,
                    colorSystem: cs,
                    colorWheelSlots: cs === 'color-wheel' ? (editingDef.colorWheelSlots || [...DEFAULT_COLOR_WHEEL_SLOTS]) : undefined,
                  });
                }}
                className="w-full h-7 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground">
                {COLOR_SYSTEMS.map(cs => <option key={cs.value} value={cs.value}>{cs.label}</option>)}
              </select>
            </div>
          </div>

          {/* Color Wheel Slots Editor */}
          {editingDef.colorSystem === 'color-wheel' && (
            <div className="glass-panel p-3 space-y-2 border-l-2 border-l-[hsl(var(--stokio-pink))]">
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">Fixed Color Wheel Slots</span>
                <Button variant="ghost" size="sm" className="h-5 text-[9px] px-2" onClick={() => {
                  const slots = editingDef.colorWheelSlots || [];
                  setEditingDef({
                    ...editingDef,
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
                      onChange={e => setEditingDef({
                        ...editingDef,
                        colorWheelSlots: editingDef.colorWheelSlots?.map(s => s.id === slot.id ? { ...s, name: e.target.value } : s),
                      })}
                      className="h-6 text-[10px] bg-muted/20 border-border/20 px-1" />
                    <Input type="color" value={slot.color}
                      onChange={e => setEditingDef({
                        ...editingDef,
                        colorWheelSlots: editingDef.colorWheelSlots?.map(s => s.id === slot.id ? { ...s, color: e.target.value } : s),
                      })}
                      className="h-6 p-0 bg-transparent border-border/20 cursor-pointer" />
                    <Input type="number" min={0} max={255} value={slot.dmxValue}
                      onChange={e => setEditingDef({
                        ...editingDef,
                        colorWheelSlots: editingDef.colorWheelSlots?.map(s => s.id === slot.id ? { ...s, dmxValue: Number(e.target.value) } : s),
                      })}
                      className="h-6 text-[10px] bg-muted/20 border-border/20 font-mono px-1" />
                    <button onClick={() => setEditingDef({
                      ...editingDef,
                      colorWheelSlots: editingDef.colorWheelSlots?.filter(s => s.id !== slot.id),
                    })} className="text-muted-foreground hover:text-destructive flex items-center justify-center">
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
              {/* Preview strip */}
              <div className="flex gap-0.5 mt-2">
                {(editingDef.colorWheelSlots || []).map(slot => (
                  <div key={slot.id} className="flex-1 h-4 rounded-sm" style={{ backgroundColor: slot.color }} title={`${slot.name} (DMX: ${slot.dmxValue})`} />
                ))}
              </div>
            </div>
          )}

          {editingDef.modes.map((mode, mIdx) => (
            <div key={mode.id} className="glass-panel p-3 space-y-2 border-l-2" style={{ borderLeftColor: mIdx === 0 ? '#00e5ff' : '#ff2d78' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Input value={mode.name}
                    onChange={e => setEditingDef({
                      ...editingDef,
                      modes: editingDef.modes.map(m => m.id === mode.id ? { ...m, name: e.target.value } : m),
                    })}
                    className="h-6 text-[10px] bg-transparent border-0 p-0 font-semibold w-32" />
                  <span className="text-[8px] text-muted-foreground">{mode.channelCount}ch</span>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-5 text-[9px] px-2" onClick={() => addChannelToMode(mode.id)}>
                    <Plus size={10} /> Ch
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
                {mode.channels.map(ch => (
                  <div key={ch.id} className="grid grid-cols-[30px_1fr_1fr_40px_20px] gap-1 items-center">
                    <span className="text-[10px] font-mono text-muted-foreground text-center">{ch.number}</span>
                    <Input value={ch.name}
                      onChange={e => updateChannel(mode.id, ch.id, { name: e.target.value })}
                      className="h-6 text-[10px] bg-muted/20 border-border/20 px-1" />
                    <select value={ch.function}
                      onChange={e => updateChannel(mode.id, ch.id, { function: e.target.value as ChannelFunction })}
                      className="h-6 rounded bg-muted/20 border border-border/20 text-[10px] px-1 text-foreground">
                      {ALL_FUNCTIONS.map(f => (
                        <option key={f} value={f}>{CHANNEL_FUNCTION_LABELS[f]}</option>
                      ))}
                    </select>
                    <Input type="number" min={0} max={255} value={ch.defaultValue}
                      onChange={e => updateChannel(mode.id, ch.id, { defaultValue: Number(e.target.value) })}
                      className="h-6 text-[10px] bg-muted/20 border-border/20 font-mono px-1" />
                    <button onClick={() => removeChannel(mode.id, ch.id)}
                      className="text-muted-foreground hover:text-destructive flex items-center justify-center">
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 w-full" onClick={addModeToEditor}>
            <Plus size={12} /> Add Mode
          </Button>
        </div>
      )}

      {tab === 'editor' && !editingDef && (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
          <span className="text-sm">No fixture selected for editing</span>
          <Button variant="outline" size="sm" className="text-[10px]" onClick={startNewDefinition}>
            <Plus size={12} /> Create New
          </Button>
        </div>
      )}

      {/* WLED TAB */}
      {tab === 'wled' && <WledPanel />}

      {/* HUE TAB */}
      {tab === 'hue' && <HuePanel />}

      {/* I/O SETUP TAB */}
      {tab === 'io' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="glass-panel p-4 space-y-3">
            <div className="text-[10px] uppercase tracking-widest text-primary font-semibold">Input / Output Configuration</div>
            <div className="text-[9px] text-muted-foreground">
              Configure USB-DMX adapters and ArtNet network interfaces for DMX output. Similar to QLC+ Input/Output setup.
            </div>
          </div>

          {/* USB-DMX Adapters */}
          <div className="glass-panel p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[9px] uppercase tracking-widest text-stokio-cyan font-semibold">🔌 USB-DMX Adapters</div>
            </div>
            <div className="text-[8px] text-muted-foreground/60 bg-muted/10 rounded p-2">
              Supported adapters: Enttec Open DMX USB, Enttec DMX USB Pro, uDMX, DMXking ultraDMX.
              <br />Connect via WebSerial API (requires Chrome/Edge and local HTTP access).
            </div>
            <div className="border border-border/20 rounded overflow-hidden">
              <table className="w-full text-[9px]">
                <thead><tr className="bg-muted/20 border-b border-border/20">
                  <th className="text-left p-2 text-muted-foreground font-semibold">Universe</th>
                  <th className="text-left p-2 text-muted-foreground font-semibold">Type</th>
                  <th className="text-left p-2 text-muted-foreground font-semibold">Device</th>
                  <th className="text-left p-2 text-muted-foreground font-semibold">Status</th>
                  <th className="text-left p-2 text-muted-foreground font-semibold">Direction</th>
                </tr></thead>
                <tbody>
                  <tr className="border-b border-border/10">
                    <td className="p-2 font-mono">1</td>
                    <td className="p-2">USB-DMX</td>
                    <td className="p-2 text-muted-foreground/50 italic">No device connected</td>
                    <td className="p-2"><span className="text-red-500">○ Disconnected</span></td>
                    <td className="p-2">Output</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1">
              <Plus size={12} /> Add USB-DMX Adapter
            </Button>
          </div>

          {/* ArtNet */}
          <div className="glass-panel p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[9px] uppercase tracking-widest font-semibold" style={{ color: '#ff6600' }}>🌐 ArtNet / sACN Network</div>
            </div>
            <div className="text-[8px] text-muted-foreground/60 bg-muted/10 rounded p-2">
              Send DMX over Ethernet via ArtNet or sACN (E1.31). Configure network interfaces and universe mapping.
              <br />Requires local network access (HTTP only, not HTTPS).
            </div>
            <div className="border border-border/20 rounded overflow-hidden">
              <table className="w-full text-[9px]">
                <thead><tr className="bg-muted/20 border-b border-border/20">
                  <th className="text-left p-2 text-muted-foreground font-semibold">Universe</th>
                  <th className="text-left p-2 text-muted-foreground font-semibold">Protocol</th>
                  <th className="text-left p-2 text-muted-foreground font-semibold">Target IP</th>
                  <th className="text-left p-2 text-muted-foreground font-semibold">Status</th>
                  <th className="text-left p-2 text-muted-foreground font-semibold">Direction</th>
                </tr></thead>
                <tbody>
                  <tr className="border-b border-border/10">
                    <td className="p-2 font-mono">1</td>
                    <td className="p-2">ArtNet</td>
                    <td className="p-2 font-mono text-muted-foreground/50">—</td>
                    <td className="p-2"><span className="text-red-500">○ Not configured</span></td>
                    <td className="p-2">Output</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1">
                <Plus size={12} /> Add ArtNet Output
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1">
                <Plus size={12} /> Add sACN Output
              </Button>
            </div>
          </div>

          {/* DDP */}
          <div className="glass-panel p-4 space-y-3">
            <div className="text-[9px] uppercase tracking-widest text-primary font-semibold">📡 DDP (Distributed Display Protocol)</div>
            <div className="text-[8px] text-muted-foreground/60 bg-muted/10 rounded p-2">
              Low-latency pixel streaming for WLED and ESP32 controllers over Ethernet. Recommended for large LED installations.
            </div>
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1">
              <Plus size={12} /> Add DDP Output
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
