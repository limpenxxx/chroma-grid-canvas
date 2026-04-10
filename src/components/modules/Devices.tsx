import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, Upload, Download, Search, Edit2, Save, X, ChevronDown, ChevronRight, Copy, Wifi
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useFixtureStore, type FixtureDefinition, type FixtureInstance,
  type ChannelFunction, type ColorSystem, type ColorWheelSlot,
  CHANNEL_FUNCTION_LABELS, getChannelColor, getFixtureTypeIcon,
  FIXTURE_ICON_OPTIONS, getFixtureIconEmoji, type FixtureIcon,
} from '@/store/fixtureStore';
import { useWledStore, type WledFixture } from '@/store/wledStore';
import { useHueStore } from '@/store/hueStore';
import { useMagicHomeStore } from '@/store/magicHomeStore';
import { xyToRgb } from '@/lib/hueApi';
import { WledPanel } from './WledPanel';
import { HuePanel } from './HuePanel';
import { MagicHomePanel } from './MagicHomePanel';
import { DmxMixer } from './DmxMixer';
import { useLiveDmxLevels } from '@/hooks/useLiveDmxLevels';
import { IOSetup } from './IOSetup';
import { FixtureEditor } from './FixtureEditor';

type Tab = 'instances' | 'library' | 'editor' | 'wled' | 'hue' | 'magichome' | 'io' | 'mixer';

// Constants moved to FixtureEditor.tsx

export function Devices() {
  const store = useFixtureStore();
  const liveDmxLevels = useLiveDmxLevels();
  const wledStore = useWledStore();
  const hueStore = useHueStore();
  const magicStore = useMagicHomeStore();
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
        {(['instances', 'library', 'editor', 'mixer', 'wled', 'hue', 'magichome', 'io'] as Tab[]).map(t => {
          const activeColor = t === 'hue' ? 'border-purple-400 text-purple-400'
            : t === 'magichome' ? 'border-yellow-400 text-yellow-400'
            : t === 'mixer' ? 'border-red-400 text-red-400'
            : 'border-primary text-primary';
          const label: Record<Tab, string> = {
            instances: 'Patched Fixtures', library: 'Fixture Library', editor: 'Fixture Editor',
            mixer: '🎛️ DMX Mixer', wled: '📡 WLED', hue: '💡 Philips Hue',
            magichome: '✦ MagicHome', io: '🔌 I/O Setup',
          };
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-[10px] uppercase tracking-wider font-semibold transition-colors border-b-2 whitespace-nowrap ${
                tab === t ? activeColor : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label[t]}
            </button>
          );
        })}
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

                        {/* Input / Connection */}
                        {def.connectors && def.connectors.length > 0 && (
                          <div className="mb-2">
                            <label className="text-[7px] uppercase text-muted-foreground">Input</label>
                            <select value={inst.inputMode || def.connectors[0]}
                              onChange={e => store.updateInstance(inst.id, { inputMode: e.target.value as any })}
                              className="w-full h-6 rounded bg-muted/30 border border-border/30 text-[10px] px-1 text-foreground">
                              {def.connectors.map(c => (
                                <option key={c} value={c}>
                                  {c === '3-pin' ? '3-Pin DMX' : c === '5-pin' ? '5-Pin DMX' : c === 'artnet' ? 'ArtNet' : c === 'sacn' ? 'sACN' : c === 'wireless' ? 'Wireless' : c}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

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

          {/* Section: Philips Hue Lights */}
          {(() => {
            const allHueLights = hueStore.bridges.filter(b => b.apiKey).flatMap(b =>
              (hueStore.lights[b.id] || []).filter(l => l.name.toLowerCase().includes(search.toLowerCase())).map(l => ({ bridge: b, light: l }))
            );
            if (allHueLights.length === 0) return null;
            return (
              <>
                <div className="text-[9px] uppercase tracking-widest text-purple-400 font-semibold mb-1 mt-4">
                  💡 Philips Hue Lights
                </div>
                {allHueLights.map(({ bridge, light }) => {
                  const col = light.state.xy
                    ? xyToRgb(light.state.xy[0], light.state.xy[1], light.state.bri || 127)
                    : { r: 200, g: 200, b: 200 };
                  const briPercent = light.state.on ? Math.round((light.state.bri / 254) * 100) : 0;
                  return (
                    <div key={`hue-${bridge.id}-${light.id}`} className="rounded-lg border transition-all border-purple-400/20 bg-purple-400/10">
                      <div className="flex items-center gap-3 p-3">
                        <div className="w-6 h-6 rounded-full border border-purple-400/30 shrink-0"
                          style={{
                            backgroundColor: light.state.on ? `rgb(${col.r},${col.g},${col.b})` : 'rgb(40,40,40)',
                            boxShadow: light.state.on ? `0 0 8px rgb(${col.r},${col.g},${col.b})` : 'none',
                          }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold">{light.name}</div>
                          <div className="text-[9px] text-muted-foreground">
                            {light.type} • {bridge.name} • {light.state.reachable ? (light.state.on ? `ON ${briPercent}%` : 'OFF') : 'Unreachable'}
                          </div>
                        </div>
                        <Button variant={light.state.on ? 'secondary' : 'outline'} size="sm" className="h-6 text-[8px] px-2"
                          onClick={() => hueStore.setPower(bridge.id, light.id, !light.state.on).then(() => hueStore.refreshBridge(bridge.id))}>
                          {light.state.on ? 'ON' : 'OFF'}
                        </Button>
                        {light.state.on && light.capabilities.hasColor && (
                          <input type="color"
                            value={`#${col.r.toString(16).padStart(2, '0')}${col.g.toString(16).padStart(2, '0')}${col.b.toString(16).padStart(2, '0')}`}
                            onChange={e => {
                              const hex = e.target.value;
                              const r = parseInt(hex.slice(1, 3), 16);
                              const g = parseInt(hex.slice(3, 5), 16);
                              const b2 = parseInt(hex.slice(5, 7), 16);
                              hueStore.setColor(bridge.id, light.id, r, g, b2);
                            }}
                            className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            );
          })()}

          {/* Section: MagicHome Devices */}
          {(() => {
            const filteredMagic = magicStore.devices.filter(d => d.name.toLowerCase().includes(search.toLowerCase()));
            if (filteredMagic.length === 0) return null;
            return (
              <>
                <div className="text-[9px] uppercase tracking-widest text-yellow-400 font-semibold mb-1 mt-4">
                  ✦ MagicHome Devices
                </div>
                {filteredMagic.map(device => {
                  const col = device.state?.color || { r: 100, g: 100, b: 100 };
                  return (
                    <div key={`magic-${device.id}`} className="rounded-lg border transition-all border-yellow-400/20 bg-yellow-400/10">
                      <div className="flex items-center gap-3 p-3">
                        <div className="w-6 h-6 rounded-full border border-yellow-400/30 shrink-0"
                          style={{
                            backgroundColor: device.state?.on ? `rgb(${col.r},${col.g},${col.b})` : 'rgb(40,40,40)',
                            boxShadow: device.state?.on ? `0 0 8px rgb(${col.r},${col.g},${col.b})` : 'none',
                          }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold">{device.name}</div>
                          <div className="text-[9px] text-muted-foreground">
                            {device.address} • {device.model || 'MagicHome'} • {device.online ? (device.state?.on ? 'ON' : 'OFF') : 'Offline'}
                          </div>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${device.online ? 'bg-green-500' : 'bg-red-500'}`} />
                        <Button variant={device.state?.on ? 'secondary' : 'outline'} size="sm" className="h-6 text-[8px] px-2"
                          onClick={() => magicStore.setPower(device.id, !device.state?.on)}>
                          {device.state?.on ? 'ON' : 'OFF'}
                        </Button>
                        {device.state?.on && (
                          <input type="color"
                            value={`#${col.r.toString(16).padStart(2, '0')}${col.g.toString(16).padStart(2, '0')}${col.b.toString(16).padStart(2, '0')}`}
                            onChange={e => {
                              const hex = e.target.value;
                              const r = parseInt(hex.slice(1, 3), 16);
                              const g = parseInt(hex.slice(3, 5), 16);
                              const b2 = parseInt(hex.slice(5, 7), 16);
                              magicStore.setColor(device.id, r, g, b2);
                            }}
                            className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            );
          })()}

          {filteredInsts.length === 0 && wledStore.fixtures.length === 0 && hueStore.bridges.every(b => !(hueStore.lights[b.id]?.length)) && magicStore.devices.length === 0 && (
            <div className="text-center text-muted-foreground text-xs py-8">
              No fixtures patched yet. Add DMX fixtures above, or connect WLED / Hue / MagicHome devices in their tabs.
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

      {tab === 'editor' && editingDef && (
        <FixtureEditor
          editingDef={editingDef}
          setEditingDef={setEditingDef}
          onSave={saveDefinition}
          onCancel={() => { setEditingDef(null); setTab('library'); }}
        />
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

      {/* MAGICHOME TAB */}
      {tab === 'magichome' && <MagicHomePanel />}

      {/* I/O SETUP TAB */}
      {tab === 'io' && <IOSetup />}

      {/* MIXER TAB */}
      {tab === 'mixer' && <DmxMixer liveDmxValues={liveDmxLevels} />}
    </motion.div>
  );
}
