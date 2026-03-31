import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, RefreshCw, Lightbulb, ChevronDown, ChevronRight, Search, Settings2, Zap
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { useMagicHomeStore } from '@/store/magicHomeStore';
import { MAGIC_HOME_PATTERNS, type MagicHomePattern } from '@/lib/magicHomeApi';
import { toast } from 'sonner';

const PATTERN_LABELS: Record<string, string> = {
  seven_color_cross_fade: '🌈 7-Color Fade',
  red_gradual_change: '🔴 Red Fade',
  green_gradual_change: '🟢 Green Fade',
  blue_gradual_change: '🔵 Blue Fade',
  yellow_gradual_change: '🟡 Yellow Fade',
  cyan_gradual_change: '🔵 Cyan Fade',
  purple_gradual_change: '🟣 Purple Fade',
  white_gradual_change: '⚪ White Fade',
  red_green_cross_fade: '🔴🟢 R/G Fade',
  red_blue_cross_fade: '🔴🔵 R/B Fade',
  green_blue_cross_fade: '🟢🔵 G/B Fade',
  seven_color_strobe_flash: '⚡ 7-Color Strobe',
  red_strobe_flash: '⚡ Red Strobe',
  green_strobe_flash: '⚡ Green Strobe',
  blue_strobe_flash: '⚡ Blue Strobe',
  yellow_strobe_flash: '⚡ Yellow Strobe',
  cyan_strobe_flash: '⚡ Cyan Strobe',
  purple_strobe_flash: '⚡ Purple Strobe',
  white_strobe_flash: '⚡ White Strobe',
  seven_color_jumping: '🎯 7-Color Jump',
};

export function MagicHomePanel() {
  const store = useMagicHomeStore();
  const [addIp, setAddIp] = useState('');
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [proxyInput, setProxyInput] = useState(store.proxyUrl);

  useEffect(() => {
    store.refreshAll();
  }, []);

  const handleDiscover = async () => {
    await store.discover();
    toast.success(`Discovery complete — ${store.devices.length} device(s)`);
  };

  const handleAddManual = () => {
    const ip = addIp.trim();
    if (!ip) return;
    store.addDevice(ip);
    setAddIp('');
    toast.success(`Device added: ${ip}`);
  };

  const handleSaveProxy = () => {
    store.setProxyUrl(proxyInput.trim());
    toast.success('Proxy URL updated');
    setShowSettings(false);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Header & Discovery */}
      <div className="glass-panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-yellow-400 font-semibold">✦ MagicHome / flux_led</div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={handleDiscover}
              disabled={store.discovering}>
              <Search size={12} className={store.discovering ? 'animate-spin' : ''} />
              {store.discovering ? 'Scanning...' : 'Discover'}
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={() => store.refreshAll()}>
              <RefreshCw size={12} /> Refresh
            </Button>
            <Button variant={showSettings ? 'secondary' : 'outline'} size="sm" className="h-7 w-7 p-0"
              onClick={() => setShowSettings(!showSettings)}>
              <Settings2 size={12} />
            </Button>
          </div>
        </div>

        {/* Proxy settings */}
        <AnimatePresence>
          {showSettings && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden">
              <div className="space-y-2 pt-2 border-t border-border/20">
                <label className="text-[8px] uppercase tracking-wider text-muted-foreground">REST Proxy URL</label>
                <div className="flex gap-2">
                  <Input value={proxyInput} onChange={e => setProxyInput(e.target.value)}
                    placeholder="http://localhost:3000"
                    className="h-7 text-xs bg-muted/30 border-border/30 flex-1 font-mono" />
                  <Button size="sm" className="h-7 text-[10px]" onClick={handleSaveProxy}>Save</Button>
                </div>
                <div className="text-[8px] text-muted-foreground/50">
                  Requires <a href="https://github.com/CasperVerswijvelt/magic-home-rest" target="_blank" rel="noopener"
                    className="text-primary underline">magic-home-rest</a> proxy running on your network.
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Manual add */}
        <div className="flex gap-2">
          <Input
            placeholder="Device IP (e.g. 192.168.1.200)"
            value={addIp}
            onChange={e => setAddIp(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddManual()}
            className="h-7 text-xs bg-muted/30 border-border/30 flex-1"
          />
          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={handleAddManual}>
            <Plus size={12} /> Add
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {store.devices.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/40">
          <Lightbulb size={32} />
          <span className="text-sm mt-2">No MagicHome devices</span>
          <span className="text-[10px] mt-1">Start the REST proxy, then use Discover or add an IP</span>
        </div>
      )}

      {/* Device list */}
      {store.devices.map(device => {
        const isExpanded = expandedDevice === device.id;
        const col = device.state?.color || { r: 40, g: 40, b: 40 };
        const isOn = device.state?.on ?? false;
        const briPercent = isOn ? Math.round((Math.max(col.r, col.g, col.b) / 255) * 100) : 0;

        return (
          <div key={device.id} className={`glass-panel overflow-hidden transition-all ${
            device.online ? 'border-yellow-400/20' : 'border-destructive/20'
          }`}>
            {/* Device header */}
            <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={() => setExpandedDevice(isExpanded ? null : device.id)}>
              <div className="w-7 h-7 rounded-full border border-border/30 shrink-0"
                style={{
                  backgroundColor: isOn ? `rgb(${col.r},${col.g},${col.b})` : '#282828',
                  boxShadow: isOn ? `0 0 10px rgb(${col.r},${col.g},${col.b})` : 'none',
                }} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold truncate">{device.name}</div>
                <div className="text-[9px] text-muted-foreground font-mono">{device.address}</div>
              </div>
              <span className={`text-[8px] px-2 py-0.5 rounded-full border ${
                device.online
                  ? 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20'
                  : 'bg-destructive/10 text-destructive border-destructive/20'
              }`}>
                {device.online ? (isOn ? `ON ${briPercent}%` : 'OFF') : 'Offline'}
              </span>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); store.refreshDevice(device.id); }}>
                  <RefreshCw size={11} />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); store.removeDevice(device.id); }}>
                  <Trash2 size={11} className="text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
              {isExpanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
            </div>

            {/* Expanded controls */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden">
                  <div className="px-3 pb-3 space-y-3">
                    {/* Power + Color */}
                    <div className="flex items-center gap-3">
                      <Button variant={isOn ? 'secondary' : 'outline'} size="sm" className="h-7 text-[10px] gap-1"
                        onClick={() => store.setPower(device.id, !isOn)}>
                        {isOn ? '⚡ ON' : '○ OFF'}
                      </Button>
                      <input type="color"
                        value={`#${col.r.toString(16).padStart(2, '0')}${col.g.toString(16).padStart(2, '0')}${col.b.toString(16).padStart(2, '0')}`}
                        onChange={e => {
                          const hex = e.target.value;
                          const r = parseInt(hex.slice(1, 3), 16);
                          const g = parseInt(hex.slice(3, 5), 16);
                          const b = parseInt(hex.slice(5, 7), 16);
                          store.setColor(device.id, r, g, b);
                        }}
                        className="w-8 h-7 rounded cursor-pointer border border-border/30 bg-transparent p-0"
                      />
                      {/* Quick colors */}
                      {[
                        { c: [255, 0, 0], l: '🔴' },
                        { c: [0, 255, 0], l: '🟢' },
                        { c: [0, 0, 255], l: '🔵' },
                        { c: [255, 255, 0], l: '🟡' },
                        { c: [0, 255, 255], l: '🔵' },
                        { c: [255, 0, 255], l: '🟣' },
                        { c: [255, 255, 255], l: '⚪' },
                      ].map(({ c, l }, i) => (
                        <button key={i} onClick={() => store.setColor(device.id, c[0], c[1], c[2])}
                          className="w-6 h-6 rounded-full border border-border/30 text-[10px] hover:scale-110 transition-transform"
                          style={{ backgroundColor: `rgb(${c[0]},${c[1]},${c[2]})` }}
                          title={l} />
                      ))}
                    </div>

                    {/* Brightness */}
                    <div>
                      <label className="text-[8px] uppercase tracking-wider text-muted-foreground block mb-1">
                        Brightness: {briPercent}%
                      </label>
                      <Slider value={[briPercent]} onValueChange={([v]) => store.setBrightness(device.id, v)} max={100} />
                    </div>

                    {/* Warm white */}
                    {device.state && (
                      <div>
                        <label className="text-[8px] uppercase tracking-wider text-muted-foreground block mb-1">
                          Warm White: {device.state.warm_white}
                        </label>
                        <Slider value={[device.state.warm_white]} onValueChange={([v]) => store.setWarmWhite(device.id, v)} max={255} />
                      </div>
                    )}

                    {/* Patterns */}
                    <div>
                      <label className="text-[8px] uppercase tracking-wider text-muted-foreground block mb-1">
                        <Zap size={9} className="inline" /> Built-in Effects
                      </label>
                      <div className="flex flex-wrap gap-1">
                        {MAGIC_HOME_PATTERNS.map(p => (
                          <Button key={p} variant="outline" size="sm" className="h-6 text-[7px] px-1.5"
                            onClick={() => store.setPattern(device.id, p)}>
                            {PATTERN_LABELS[p] || p}
                          </Button>
                        ))}
                      </div>
                    </div>

                    {/* Device info */}
                    <div className="text-[8px] text-muted-foreground/50 border-t border-border/10 pt-2">
                      ID: {device.id} • Model: {device.model || '—'} • Mode: {device.state?.mode || '—'}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {/* Info */}
      <div className="glass-panel p-4 space-y-2">
        <div className="text-[9px] text-muted-foreground/60">
          <strong>Setup:</strong> MagicHome devices use TCP port 5577 (not HTTP). A REST proxy is required.
          <br />1. Install & run <a href="https://github.com/CasperVerswijvelt/magic-home-rest" target="_blank" rel="noopener"
            className="text-primary underline">magic-home-rest</a> on your network
          <br />2. Set the proxy URL above (default: <code className="text-primary">http://localhost:3000</code>)
          <br />3. Click Discover to find devices, or add by IP
          <br /><br />Supports RGB, RGBW, RGBWW controllers (flux_led compatible).
        </div>
      </div>
    </div>
  );
}
