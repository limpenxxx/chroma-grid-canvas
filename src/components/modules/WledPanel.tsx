import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { engineWledScan, isEngineConnected } from '@/lib/wsSync';
import { useIOStore } from '@/components/modules/IOSetup';
import {
  Plus, Trash2, Power, Wifi, WifiOff, RefreshCw, Palette, Zap, SunDim, Layers, Radar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { sendWledOutput } from '@/lib/wsSync';
import { useWledStore, type WledDevice, type WledFixture, WLED_PROTOCOL_OPTIONS, type WledProtocol } from '@/store/wledStore';

type SubTab = 'devices' | 'fixtures';

export function WledPanel() {
  const store = useWledStore();
  const [subTab, setSubTab] = useState<SubTab>('devices');
  const [addingIp, setAddingIp] = useState('');
  const [addingName, setAddingName] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Add fixture form
  const [showAddFixture, setShowAddFixture] = useState(false);
  const [newFixDeviceId, setNewFixDeviceId] = useState('');
  const [newFixName, setNewFixName] = useState('');
  const [newFixSegment, setNewFixSegment] = useState(0);
  const [newFixLedStart, setNewFixLedStart] = useState(0);
  const [newFixLedEnd, setNewFixLedEnd] = useState(59);

  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');

  // Refresh on mount
  useEffect(() => {
    if (store.devices.length > 0) store.refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Network scan via engine server — dynamically detect subnets from NICs
  const scanNetwork = async () => {
    if (!isEngineConnected()) {
      setScanProgress('Engine not connected — starta engine-server först');
      setTimeout(() => setScanProgress(''), 4000);
      return;
    }
    setScanning(true);
    const existingIps = new Set(store.devices.map(d => d.ip));

    // Build subnet list from actual NICs (system role preferred)
    const ioStore = useIOStore.getState();
    const nics = ioStore.networkInterfaces.filter(n => !n.internal && n.address);
    const subnetSet = new Set<string>();
    for (const nic of nics) {
      const parts = nic.address.split('.');
      if (parts.length === 4) {
        subnetSet.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
      }
    }
    // Fallback if no NICs detected yet
    if (subnetSet.size === 0) {
      subnetSet.add('192.168.0');
      subnetSet.add('192.168.1');
    }
    const subnets = Array.from(subnetSet);
    let totalFound = 0;

    for (const subnet of subnets) {
      setScanProgress(`Scanning ${subnet}.x ...`);
      const ips = Array.from({ length: 255 }, (_, i) => `${subnet}.${i + 1}`)
        .filter(ip => !existingIps.has(ip));

      try {
        const result = await engineWledScan(ips);
        for (const dev of result.found || []) {
          if (!existingIps.has(dev.ip)) {
            existingIps.add(dev.ip);
            totalFound++;
            await store.addDevice(dev.ip, dev.name);
          }
        }
      } catch {
        // engine timeout or not connected
      }
    }

    setScanProgress(totalFound > 0 ? `Found ${totalFound} device(s)` : 'No new devices found');
    setScanning(false);
    setTimeout(() => setScanProgress(''), 4000);
  };

  const addDevice = async () => {
    const ip = addingIp.trim();
    if (!ip) return;
    await store.addDevice(ip, addingName.trim() || undefined);
    setAddingIp('');
    setAddingName('');
    setShowAdd(false);
  };

  const handlePower = (dev: WledDevice) => {
    const newState = !dev.state?.on;
    sendWledOutput(dev.ip, { on: newState });
    store.updateDevice(dev.id, {
      state: dev.state ? { ...dev.state, on: newState } : dev.state,
    });
  };

  const handleBrightness = (dev: WledDevice, bri: number) => {
    sendWledOutput(dev.ip, { bri });
    store.updateDevice(dev.id, {
      state: dev.state ? { ...dev.state, bri } : dev.state,
    });
  };

  const handleColor = (dev: WledDevice, hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    sendWledOutput(dev.ip, { seg: [{ id: 0, col: [[r, g, b]] }] });
  };

  const handleEffect = (dev: WledDevice, fx: number) => {
    sendWledOutput(dev.ip, { seg: [{ id: 0, fx }] });
  };

  const handlePreset = (dev: WledDevice, ps: number) => {
    sendWledOutput(dev.ip, { ps });
  };

  const addFixture = () => {
    if (!newFixDeviceId) return;
    store.addFixture({
      deviceId: newFixDeviceId,
      name: newFixName.trim() || `WLED-Fix-${store.fixtures.length + 1}`,
      segmentId: newFixSegment,
      ledStart: newFixLedStart,
      ledEnd: newFixLedEnd,
    });
    setShowAddFixture(false);
    setNewFixName('');
    setNewFixSegment(0);
    setNewFixLedStart(0);
    setNewFixLedEnd(59);
  };

  const QUICK_COLORS = [
    '#ff0000', '#ff8800', '#ffff00', '#00ff00', '#00ffff',
    '#0000ff', '#8800ff', '#ff00ff', '#ffffff', '#000000',
  ];

  const selectedDeviceForFixture = store.devices.find(d => d.id === newFixDeviceId);

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {/* Sub-tabs */}
      <div className="flex border-b border-border/30 mb-1">
        {(['devices', 'fixtures'] as SubTab[]).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-4 py-1.5 text-[9px] uppercase tracking-wider font-semibold transition-colors border-b-2 ${
              subTab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'devices' ? (
              <span className="flex items-center gap-1"><Wifi size={10} /> Devices ({store.devices.length})</span>
            ) : (
              <span className="flex items-center gap-1"><Layers size={10} /> Fixtures ({store.fixtures.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* ════════ DEVICES SUB-TAB ════════ */}
      {subTab === 'devices' && (
        <>
          {/* Add Device */}
          <div>
            {showAdd ? (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                className="glass-panel p-3 space-y-2">
                <div className="text-[9px] uppercase tracking-widest text-primary font-semibold">Add WLED Device</div>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="IP Address (e.g. 192.168.1.100)"
                    value={addingIp} onChange={e => setAddingIp(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addDevice()}
                    className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                  <Input placeholder="Name (optional)"
                    value={addingName} onChange={e => setAddingName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addDevice()}
                    className="h-7 text-xs bg-muted/30 border-border/30" />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-[10px]" onClick={addDevice}>Add</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => setShowAdd(false)}>Cancel</Button>
                </div>
              </motion.div>
            ) : (
              <>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 flex-1"
                  onClick={() => setShowAdd(true)}>
                  <Plus size={12} /> Add Device
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 flex-1"
                  onClick={scanNetwork} disabled={scanning}>
                  <Radar size={12} className={scanning ? 'animate-spin' : ''} /> Scan Network
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1"
                  onClick={() => store.refreshAll()} disabled={store._polling}>
                  <RefreshCw size={12} className={store._polling ? 'animate-spin' : ''} />
                </Button>
                {store.devices.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1 text-destructive hover:text-destructive"
                    onClick={() => { if (confirm('Ta bort ALLA WLED-enheter?')) store.removeAllDevices(); }}>
                    <Trash2 size={12} /> Rensa
                  </Button>
                )}
              </div>
              {scanProgress && (
                <div className="text-[9px] text-primary/80 text-center mt-1 animate-pulse">
                  {scanProgress}
                </div>
              )}
              </>
            )}
          </div>

          {store.devices.length === 0 && (
            <div className="text-center py-12 text-muted-foreground/50">
              <Wifi size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-xs">No WLED devices added</p>
              <p className="text-[9px] mt-1">Enter the IP address of your ESP32 WLED device</p>
              <p className="text-[9px] mt-3 text-primary/50">⚠ Must run locally (HTTP) — HTTPS blocks local network requests</p>
            </div>
          )}

          {/* Device List */}
          {store.devices.map(dev => {
            const expanded = expandedId === dev.id;
            const isOn = dev.state?.on ?? false;
            const fixtureCount = store.getFixturesForDevice(dev.id).length;

            return (
              <div key={dev.id} className={`rounded-lg border transition-all ${
                dev.online
                  ? 'border-primary/20 bg-card/40'
                  : 'border-destructive/20 bg-destructive/5'
              }`}>
                {/* Header */}
                <button
                  onClick={() => setExpandedId(expanded ? null : dev.id)}
                  className="w-full flex items-center gap-3 p-3 text-left"
                >
                  {dev.online ? (
                    <Wifi size={16} className="text-primary shrink-0" />
                  ) : (
                    <WifiOff size={16} className="text-destructive shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold">{dev.name}</div>
                    <div className="text-[9px] text-muted-foreground font-mono">{dev.ip}</div>
                  </div>
                  {dev.info && (
                    <div className="text-right">
                      <div className="text-[9px] text-muted-foreground">v{dev.info.ver}</div>
                      <div className="text-[9px] text-muted-foreground">{dev.info.leds.count} LEDs</div>
                    </div>
                  )}
                  {fixtureCount > 0 && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                      {fixtureCount} fix
                    </span>
                  )}
                  {dev.online && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handlePower(dev); }}
                      className={`p-1.5 rounded-lg transition-all ${
                        isOn ? 'bg-primary/20 text-primary' : 'bg-muted/30 text-muted-foreground'
                      }`}
                    >
                      <Power size={14} />
                    </button>
                  )}
                </button>

                {/* Expanded Controls */}
                <AnimatePresence>
                  {expanded && dev.online && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 pb-3 space-y-3 border-t border-border/20 pt-3">
                        {/* Brightness */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[9px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                              <SunDim size={10} /> Brightness
                            </span>
                            <span className="text-[10px] font-mono text-primary">{dev.state?.bri ?? 0}</span>
                          </div>
                          <Slider
                            value={[dev.state?.bri ?? 128]}
                            min={0} max={255} step={1}
                            onValueChange={([v]) => handleBrightness(dev, v)}
                            className="w-full"
                          />
                        </div>

                        {/* Protocol / Output Mode */}
                        <div>
                          <span className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1 block">
                            Output Protocol
                          </span>
                          <select
                            className="w-full h-7 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground"
                            value={dev.protocol || 'dnrgb'}
                            onChange={e => store.updateDevice(dev.id, { protocol: e.target.value as WledProtocol })}
                          >
                            {WLED_PROTOCOL_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                          <p className="text-[8px] text-muted-foreground/60 mt-0.5">
                            {WLED_PROTOCOL_OPTIONS.find(o => o.value === (dev.protocol || 'dnrgb'))?.description}
                          </p>
                          {(dev.protocol === 'dnrgb' || dev.protocol === 'ddp' || !dev.protocol) && (
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[8px] text-muted-foreground">Timeout:</span>
                              <Input
                                type="number" min={0} max={255} step={1}
                                value={dev.realtimeTimeout ?? 0}
                                onChange={e => store.updateDevice(dev.id, { realtimeTimeout: Number(e.target.value) })}
                                className="h-5 w-16 text-[10px] bg-muted/30 border-border/30 font-mono"
                              />
                              <span className="text-[8px] text-muted-foreground/50">sek (0 = WLED default)</span>
                            </div>
                          )}
                        </div>

                        <div>
                          <span className="text-[9px] uppercase tracking-widest text-muted-foreground flex items-center gap-1 mb-1">
                            <Palette size={10} /> Color
                          </span>
                          <div className="flex gap-1.5 flex-wrap">
                            {QUICK_COLORS.map(c => (
                              <button key={c} onClick={() => handleColor(dev, c)}
                                className="w-7 h-7 rounded-md border border-border/30 hover:scale-110 active:scale-95 transition-transform"
                                style={{ backgroundColor: c }} title={c} />
                            ))}
                            <input type="color" className="w-7 h-7 rounded-md border border-border/30 cursor-pointer"
                              onChange={(e) => handleColor(dev, e.target.value)} title="Custom color" />
                          </div>
                        </div>

                        {/* Effects */}
                        {dev.effects && dev.effects.length > 0 && (
                          <div>
                            <span className="text-[9px] uppercase tracking-widest text-muted-foreground flex items-center gap-1 mb-1">
                              <Zap size={10} /> Effect
                            </span>
                            <select className="w-full h-7 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground"
                              value={dev.state?.seg?.[0]?.fx ?? 0}
                              onChange={(e) => handleEffect(dev, Number(e.target.value))}>
                              {dev.effects.map((name, i) => (
                                <option key={i} value={i}>{i}: {name}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* Palettes */}
                        {dev.palettes && dev.palettes.length > 0 && (
                          <div>
                            <span className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1 block">Palette</span>
                            <select className="w-full h-7 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground"
                              value={dev.state?.seg?.[0]?.pal ?? 0}
                              onChange={(e) => {
                                const pal = Number(e.target.value);
                                sendWledOutput(dev.ip, { seg: [{ id: 0, fx: dev.state?.seg?.[0]?.fx ?? 0, pal }] });
                              }}>
                              {dev.palettes.map((name, i) => (
                                <option key={i} value={i}>{i}: {name}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* Segments info */}
                        {dev.state?.seg && dev.state.seg.length > 0 && (
                          <div>
                            <span className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1 block">
                              Segments ({dev.state.seg.length})
                            </span>
                            <div className="space-y-1">
                              {dev.state.seg.map((seg, i) => (
                                <div key={i} className="flex items-center gap-2 text-[9px] py-1 px-2 rounded bg-muted/20">
                                  <span className="font-mono text-primary w-4">{i}</span>
                                  <span>LED {seg.start}–{seg.stop}</span>
                                  <span className="text-muted-foreground">({seg.len} px)</span>
                                  <span className={`ml-auto text-[8px] ${seg.on ? 'text-primary' : 'text-muted-foreground'}`}>
                                    {seg.on ? 'ON' : 'OFF'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Preset trigger */}
                        <div>
                          <span className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1 block">Quick Preset</span>
                          <div className="flex gap-1 flex-wrap">
                            {Array.from({ length: 16 }, (_, i) => i + 1).map(ps => (
                              <button key={ps} onClick={() => handlePreset(dev, ps)}
                                className="w-8 h-8 rounded-md bg-muted/30 border border-border/30 text-[10px] font-mono hover:bg-primary/20 hover:border-primary/30 active:scale-95 transition-all">
                                {ps}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Device Info */}
                        {dev.info && (
                          <div className="text-[8px] text-muted-foreground/50 space-y-0.5 pt-2 border-t border-border/10">
                            <div>MAC: {dev.info.mac} · Arch: {dev.info.arch}</div>
                            <div>LEDs: {dev.info.leds.count} · FPS: {dev.info.leds.fps} · Power: {dev.info.leds.pwr}mA</div>
                            {dev.info.wifi && <div>WiFi RSSI: {dev.info.wifi.rssi}dBm ({dev.info.wifi.signal}%)</div>}
                          </div>
                        )}

                        {/* Remove */}
                        <Button variant="ghost" size="sm" className="h-6 text-[9px] text-destructive hover:text-destructive gap-1"
                          onClick={() => store.removeDevice(dev.id)}>
                          <Trash2 size={10} /> Remove Device
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </>
      )}

      {/* ════════ FIXTURES SUB-TAB ════════ */}
      {subTab === 'fixtures' && (
        <>
          {/* Add Fixture */}
          <div>
            {showAddFixture ? (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                className="glass-panel p-3 space-y-2">
                <div className="text-[9px] uppercase tracking-widest text-primary font-semibold">Create WLED Fixture</div>
                
                {/* Select device */}
                <div>
                  <label className="text-[8px] uppercase text-muted-foreground">Device</label>
                  <select value={newFixDeviceId} onChange={e => setNewFixDeviceId(e.target.value)}
                    className="w-full h-7 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground">
                    <option value="">Select device...</option>
                    {store.devices.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.ip}) {d.online ? '● Online' : '○ Offline'}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Name */}
                <Input placeholder="Fixture name" value={newFixName} onChange={e => setNewFixName(e.target.value)}
                  className="h-7 text-xs bg-muted/30 border-border/30" />

                {/* Segment selection */}
                {selectedDeviceForFixture?.state?.seg && (
                  <div>
                    <label className="text-[8px] uppercase text-muted-foreground">Segment</label>
                <select value={String(newFixSegment)} onChange={e => {
                      const segIdx = Number(e.target.value);
                      setNewFixSegment(segIdx);
                      const seg = selectedDeviceForFixture.state?.seg?.[segIdx];
                      if (seg) {
                        setNewFixLedStart(seg.start);
                        setNewFixLedEnd(seg.stop);
                      }
                    }}
                      className="w-full h-7 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground">
                      {selectedDeviceForFixture.state.seg.map((seg, i) => (
                        <option key={i} value={String(i)}>
                          Seg {i}: LED {seg.start}–{seg.stop} ({seg.len} px)
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* LED range */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[8px] uppercase text-muted-foreground">LED Start</label>
                    <Input type="number" min={0} value={newFixLedStart}
                      onChange={e => setNewFixLedStart(Number(e.target.value))}
                      className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                  </div>
                  <div>
                    <label className="text-[8px] uppercase text-muted-foreground">LED End</label>
                    <Input type="number" min={0} value={newFixLedEnd}
                      onChange={e => setNewFixLedEnd(Number(e.target.value))}
                      className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                  </div>
                </div>

                <div className="text-[8px] text-muted-foreground">
                  {newFixLedEnd - newFixLedStart + 1} LEDs in this fixture
                </div>

                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-[10px]" onClick={addFixture}
                    disabled={!newFixDeviceId}>Create Fixture</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => setShowAddFixture(false)}>Cancel</Button>
                </div>
              </motion.div>
            ) : (
              <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 w-full"
                onClick={() => setShowAddFixture(true)} disabled={store.devices.length === 0}>
                <Plus size={12} /> Create WLED Fixture
              </Button>
            )}
          </div>

          {store.fixtures.length === 0 && (
            <div className="text-center py-12 text-muted-foreground/50">
              <Layers size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-xs">No WLED fixtures created</p>
              <p className="text-[9px] mt-1">Add a device first, then create fixtures from its segments</p>
            </div>
          )}

          {/* Fixture List */}
          {store.fixtures.map(fix => {
            const dev = store.devices.find(d => d.id === fix.deviceId);
            const isOnline = dev?.online ?? false;
            return (
              <div key={fix.id} className={`rounded-lg border p-3 transition-all ${
                isOnline ? 'border-primary/20 bg-card/40' : 'border-destructive/20 bg-destructive/5'
              }`}>
                <div className="flex items-center gap-3">
                  <span className="text-lg">💡</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold">{fix.name}</div>
                    <div className="text-[9px] text-muted-foreground">
                      {fix.deviceName} · Seg {fix.segmentId} · LED {fix.ledStart}–{fix.ledEnd} ({fix.ledEnd - fix.ledStart + 1} px)
                    </div>
                  </div>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded ${
                    isOnline
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'bg-destructive/10 text-destructive border border-destructive/20'
                  }`}>
                    {isOnline ? 'Online' : 'Offline'}
                  </span>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                    onClick={() => store.removeFixture(fix.id)}>
                    <Trash2 size={10} />
                  </Button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
