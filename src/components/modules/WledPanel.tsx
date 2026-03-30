import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, Power, Wifi, WifiOff, RefreshCw, Palette, Zap, SunDim,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  type WledDevice,
  getWledState,
  setWledPower,
  setWledBrightness,
  setWledColor,
  setWledEffect,
  setWledPreset,
  pingWled,
} from '@/lib/wledApi';

const STORAGE_KEY = 'stokio-wled-devices';

function loadDevices(): WledDevice[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveDevices(devices: WledDevice[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(
    devices.map(d => ({ id: d.id, ip: d.ip, name: d.name }))
  ));
}

export function WledPanel() {
  const [devices, setDevices] = useState<WledDevice[]>(loadDevices);
  const [addingIp, setAddingIp] = useState('');
  const [addingName, setAddingName] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  const refreshDevice = useCallback(async (dev: WledDevice) => {
    try {
      const data = await getWledState(dev.ip);
      return {
        ...dev,
        online: true,
        info: data.info,
        state: data.state,
        effects: data.effects,
        palettes: data.palettes,
        name: dev.name || data.info.name,
      };
    } catch {
      return { ...dev, online: false };
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setPolling(true);
    const updated = await Promise.all(devices.map(refreshDevice));
    setDevices(updated);
    setPolling(false);
  }, [devices, refreshDevice]);

  // Initial fetch on mount
  useEffect(() => {
    if (devices.length > 0) refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save to localStorage when device list changes
  useEffect(() => { saveDevices(devices); }, [devices]);

  const addDevice = async () => {
    const ip = addingIp.trim();
    if (!ip) return;
    const newDev: WledDevice = {
      id: `wled-${Date.now()}`,
      ip,
      name: addingName.trim() || ip,
      online: false,
    };
    const updated = await refreshDevice(newDev);
    setDevices(prev => [...prev, updated]);
    setAddingIp('');
    setAddingName('');
    setShowAdd(false);
  };

  const removeDevice = (id: string) => {
    setDevices(prev => prev.filter(d => d.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const handlePower = async (dev: WledDevice) => {
    const newState = !dev.state?.on;
    try {
      await setWledPower(dev.ip, newState);
      setDevices(prev => prev.map(d =>
        d.id === dev.id ? { ...d, state: d.state ? { ...d.state, on: newState } : d.state } : d
      ));
    } catch { /* device offline */ }
  };

  const handleBrightness = async (dev: WledDevice, bri: number) => {
    try {
      await setWledBrightness(dev.ip, bri);
      setDevices(prev => prev.map(d =>
        d.id === dev.id ? { ...d, state: d.state ? { ...d.state, bri } : d.state } : d
      ));
    } catch { /* device offline */ }
  };

  const handleColor = async (dev: WledDevice, hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    try {
      await setWledColor(dev.ip, r, g, b);
    } catch { /* device offline */ }
  };

  const handleEffect = async (dev: WledDevice, fx: number) => {
    try {
      await setWledEffect(dev.ip, fx);
    } catch { /* device offline */ }
  };

  const handlePreset = async (dev: WledDevice, ps: number) => {
    try {
      await setWledPreset(dev.ip, ps);
    } catch { /* device offline */ }
  };

  const QUICK_COLORS = [
    '#ff0000', '#ff8800', '#ffff00', '#00ff00', '#00ffff',
    '#0000ff', '#8800ff', '#ff00ff', '#ffffff', '#000000',
  ];

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
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
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 flex-1"
              onClick={() => setShowAdd(true)}>
              <Plus size={12} /> Add WLED Device
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1"
              onClick={refreshAll} disabled={polling}>
              <RefreshCw size={12} className={polling ? 'animate-spin' : ''} /> Refresh
            </Button>
          </div>
        )}
      </div>

      {devices.length === 0 && (
        <div className="text-center py-12 text-muted-foreground/50">
          <Wifi size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-xs">No WLED devices added</p>
          <p className="text-[9px] mt-1">Enter the IP address of your ESP32 WLED device</p>
          <p className="text-[9px] mt-3 text-primary/50">⚠ Must run locally (HTTP) — HTTPS blocks local network requests</p>
        </div>
      )}

      {/* Device List */}
      {devices.map(dev => {
        const expanded = expandedId === dev.id;
        const isOn = dev.state?.on ?? false;

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
                        <span className="text-[10px] font-mono text-primary">
                          {dev.state?.bri ?? 0}
                        </span>
                      </div>
                      <Slider
                        value={[dev.state?.bri ?? 128]}
                        min={0} max={255} step={1}
                        onValueChange={([v]) => handleBrightness(dev, v)}
                        className="w-full"
                      />
                    </div>

                    {/* Quick Colors */}
                    <div>
                      <span className="text-[9px] uppercase tracking-widest text-muted-foreground flex items-center gap-1 mb-1">
                        <Palette size={10} /> Color
                      </span>
                      <div className="flex gap-1.5 flex-wrap">
                        {QUICK_COLORS.map(c => (
                          <button
                            key={c}
                            onClick={() => handleColor(dev, c)}
                            className="w-7 h-7 rounded-md border border-border/30 hover:scale-110 active:scale-95 transition-transform"
                            style={{ backgroundColor: c }}
                            title={c}
                          />
                        ))}
                        <input
                          type="color"
                          className="w-7 h-7 rounded-md border border-border/30 cursor-pointer"
                          onChange={(e) => handleColor(dev, e.target.value)}
                          title="Custom color"
                        />
                      </div>
                    </div>

                    {/* Effects */}
                    {dev.effects && dev.effects.length > 0 && (
                      <div>
                        <span className="text-[9px] uppercase tracking-widest text-muted-foreground flex items-center gap-1 mb-1">
                          <Zap size={10} /> Effect
                        </span>
                        <select
                          className="w-full h-7 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground"
                          value={dev.state?.seg?.[0]?.fx ?? 0}
                          onChange={(e) => handleEffect(dev, Number(e.target.value))}
                        >
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
                        <select
                          className="w-full h-7 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground"
                          value={dev.state?.seg?.[0]?.pal ?? 0}
                          onChange={(e) => {
                            const pal = Number(e.target.value);
                            setWledEffect(dev.ip, dev.state?.seg?.[0]?.fx ?? 0, undefined, undefined, pal);
                          }}
                        >
                          {dev.palettes.map((name, i) => (
                            <option key={i} value={i}>{i}: {name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Preset trigger */}
                    <div>
                      <span className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1 block">Quick Preset</span>
                      <div className="flex gap-1 flex-wrap">
                        {Array.from({ length: 16 }, (_, i) => i + 1).map(ps => (
                          <button
                            key={ps}
                            onClick={() => handlePreset(dev, ps)}
                            className="w-8 h-8 rounded-md bg-muted/30 border border-border/30 text-[10px] font-mono hover:bg-primary/20 hover:border-primary/30 active:scale-95 transition-all"
                          >
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
                      onClick={() => removeDevice(dev.id)}>
                      <Trash2 size={10} /> Remove Device
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
