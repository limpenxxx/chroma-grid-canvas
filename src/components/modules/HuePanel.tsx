import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, RefreshCw, Lightbulb, Link2, Wifi, ChevronDown, ChevronRight, Search
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { useHueStore } from '@/store/hueStore';
import { xyToRgb } from '@/lib/hueApi';
import { toast } from 'sonner';

export function HuePanel() {
  const hueStore = useHueStore();
  const [addIp, setAddIp] = useState('');
  const [pairingBridgeId, setPairingBridgeId] = useState<string | null>(null);
  const [pairingStatus, setPairingStatus] = useState<string>('');
  const [expandedBridge, setExpandedBridge] = useState<string | null>(null);

  // Auto-refresh paired bridges on mount
  useEffect(() => {
    hueStore.refreshAll();
  }, []);

  const handleDiscover = async () => {
    await hueStore.discover();
    toast.success('Bridge discovery complete');
  };

  const handleAddManual = () => {
    const ip = addIp.trim();
    if (!ip) return;
    hueStore.addBridge(ip);
    setAddIp('');
    toast.success(`Bridge added: ${ip}`);
  };

  const handlePair = async (bridgeId: string) => {
    setPairingBridgeId(bridgeId);
    setPairingStatus('Press the link button on your Hue Bridge, then click "Pair Now"...');
  };

  const handlePairConfirm = async () => {
    if (!pairingBridgeId) return;
    setPairingStatus('Connecting...');
    const result = await hueStore.pair(pairingBridgeId);
    if (result.success) {
      setPairingStatus('');
      setPairingBridgeId(null);
      setExpandedBridge(pairingBridgeId);
      toast.success('Bridge paired successfully!');
    } else {
      setPairingStatus(`Failed: ${result.error}. Press the link button and try again.`);
    }
  };

  const getLightColor = (light: { state: { xy?: [number, number]; bri?: number; on?: boolean } }) => {
    if (!light.state.on) return { r: 40, g: 40, b: 40 };
    if (light.state.xy) {
      return xyToRgb(light.state.xy[0], light.state.xy[1], light.state.bri || 127);
    }
    const b = light.state.bri || 0;
    const v = Math.round((b / 254) * 255);
    return { r: v, g: v, b: v };
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Discovery & Add */}
      <div className="glass-panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-purple-400 font-semibold">💡 Philips Hue Bridges</div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={handleDiscover}
              disabled={hueStore.discovering}>
              <Search size={12} className={hueStore.discovering ? 'animate-spin' : ''} />
              {hueStore.discovering ? 'Scanning...' : 'Auto-Discover'}
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={() => hueStore.refreshAll()}>
              <RefreshCw size={12} /> Refresh All
            </Button>
          </div>
        </div>

        {/* Manual add */}
        <div className="flex gap-2">
          <Input
            placeholder="Bridge IP (e.g. 192.168.1.50)"
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

      {/* Bridges list */}
      {hueStore.bridges.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/40">
          <Lightbulb size={32} />
          <span className="text-sm mt-2">No Hue bridges found</span>
          <span className="text-[10px] mt-1">Use Auto-Discover or add a bridge IP manually</span>
        </div>
      )}

      {hueStore.bridges.map(bridge => {
        const isExpanded = expandedBridge === bridge.id;
        const isPaired = !!bridge.apiKey;
        const lights = hueStore.lights[bridge.id] || [];
        const groups = hueStore.groups[bridge.id] || [];
        const scenes = hueStore.scenes[bridge.id] || [];

        return (
          <div key={bridge.id} className={`glass-panel overflow-hidden transition-all ${isPaired ? 'border-purple-400/20' : 'border-yellow-500/30'}`}>
            {/* Bridge header */}
            <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={() => setExpandedBridge(isExpanded ? null : bridge.id)}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-lg ${
                isPaired ? 'bg-purple-400/10 border border-purple-400/30' : 'bg-yellow-500/10 border border-yellow-500/30'
              }`}>
                💡
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold">{bridge.name}</div>
                <div className="text-[9px] text-muted-foreground font-mono">{bridge.ip}</div>
              </div>
              {isPaired ? (
                <span className="text-[8px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  ✓ Paired • {lights.length} lights
                </span>
              ) : (
                <span className="text-[8px] px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
                  Not paired
                </span>
              )}
              <div className="flex gap-1">
                {!isPaired && (
                  <Button variant="outline" size="sm" className="h-6 text-[9px] gap-1" onClick={e => { e.stopPropagation(); handlePair(bridge.id); }}>
                    <Link2 size={10} /> Pair
                  </Button>
                )}
                {isPaired && (
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); hueStore.refreshBridge(bridge.id); }}>
                    <RefreshCw size={11} />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); hueStore.removeBridge(bridge.id); }}>
                  <Trash2 size={11} className="text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
              {isExpanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
            </div>

            {/* Pairing modal */}
            {pairingBridgeId === bridge.id && (
              <div className="px-3 pb-3">
                <div className="glass-panel p-4 space-y-3 border-yellow-500/30">
                  <div className="text-[10px] uppercase tracking-widest text-yellow-500 font-semibold">Bridge Pairing</div>
                  <div className="text-[9px] text-muted-foreground">{pairingStatus}</div>
                  <div className="text-[10px] text-yellow-400/80 bg-yellow-500/10 rounded p-2 border border-yellow-500/20">
                    1. Press the large <strong>link button</strong> on top of your Hue Bridge
                    <br />2. Then click "Pair Now" within 30 seconds
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="h-7 text-[10px] gap-1" onClick={handlePairConfirm}>
                      <Link2 size={12} /> Pair Now
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => { setPairingBridgeId(null); setPairingStatus(''); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Expanded: lights */}
            <AnimatePresence>
              {isExpanded && isPaired && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden">
                  <div className="px-3 pb-3 space-y-2">
                    {/* Bridge info */}
                    {bridge.modelId && (
                      <div className="text-[8px] text-muted-foreground/50">
                        Model: {bridge.modelId} • SW: {bridge.swVersion} • {lights.length} lights • {groups.length} groups • {scenes.length} scenes
                      </div>
                    )}

                    {/* Lights */}
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold mt-2">Lights</div>
                    {lights.length === 0 && (
                      <div className="text-[9px] text-muted-foreground/40 italic">No lights found. Try refreshing.</div>
                    )}
                    {lights.map(light => {
                      const col = getLightColor(light);
                      const briPercent = light.state.on ? Math.round((light.state.bri / 254) * 100) : 0;
                      return (
                        <div key={light.id} className={`flex items-center gap-3 p-2 rounded-lg border transition-all ${
                          light.state.reachable
                            ? 'border-border/20 bg-card/40'
                            : 'border-destructive/20 bg-destructive/5 opacity-60'
                        }`}>
                          {/* Color indicator */}
                          <div className="w-6 h-6 rounded-full border border-border/30 shrink-0"
                            style={{
                              backgroundColor: `rgb(${col.r},${col.g},${col.b})`,
                              boxShadow: light.state.on ? `0 0 8px rgb(${col.r},${col.g},${col.b})` : 'none',
                            }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] font-medium truncate">{light.name}</div>
                            <div className="text-[8px] text-muted-foreground">
                              {light.type} • {light.state.reachable ? (light.state.on ? `ON ${briPercent}%` : 'OFF') : 'Unreachable'}
                            </div>
                          </div>
                          {/* Quick controls */}
                          <Button variant={light.state.on ? 'secondary' : 'outline'} size="sm" className="h-6 text-[8px] px-2"
                            onClick={() => hueStore.setPower(bridge.id, light.id, !light.state.on).then(() => hueStore.refreshBridge(bridge.id))}>
                            {light.state.on ? 'ON' : 'OFF'}
                          </Button>
                          {light.state.on && (
                            <div className="w-20">
                              <Slider value={[briPercent]} onValueChange={([v]) => {
                                hueStore.setBrightness(bridge.id, light.id, v);
                              }} max={100} />
                            </div>
                          )}
                          {light.state.on && light.capabilities.hasColor && (
                            <input type="color"
                              value={`#${col.r.toString(16).padStart(2, '0')}${col.g.toString(16).padStart(2, '0')}${col.b.toString(16).padStart(2, '0')}`}
                              onChange={e => {
                                const hex = e.target.value;
                                const r = parseInt(hex.slice(1, 3), 16);
                                const g = parseInt(hex.slice(3, 5), 16);
                                const b = parseInt(hex.slice(5, 7), 16);
                                hueStore.setColor(bridge.id, light.id, r, g, b);
                              }}
                              className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent"
                            />
                          )}
                        </div>
                      );
                    })}

                    {/* Groups */}
                    {groups.length > 0 && (
                      <>
                        <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold mt-3">Rooms & Groups</div>
                        {groups.map(group => (
                          <div key={group.id} className="flex items-center gap-3 p-2 rounded-lg border border-border/20 bg-card/40">
                            <div className="text-lg">🏠</div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[10px] font-medium truncate">{group.name}</div>
                              <div className="text-[8px] text-muted-foreground">
                                {group.type} • {group.lights.length} lights • {group.state.any_on ? 'Some ON' : 'All OFF'}
                              </div>
                            </div>
                            <Button variant={group.state.any_on ? 'secondary' : 'outline'} size="sm" className="h-6 text-[8px] px-2"
                              onClick={() => hueStore.setGroupAction(bridge.id, group.id, { on: !group.state.any_on }).then(() => hueStore.refreshBridge(bridge.id))}>
                              {group.state.any_on ? 'ON' : 'OFF'}
                            </Button>
                          </div>
                        ))}
                      </>
                    )}

                    {/* Scenes */}
                    {scenes.length > 0 && (
                      <>
                        <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold mt-3">Scenes</div>
                        <div className="flex flex-wrap gap-1">
                          {scenes.slice(0, 20).map(scene => (
                            <Button key={scene.id} variant="outline" size="sm" className="h-6 text-[8px] px-2"
                              onClick={() => {
                                const groupId = scene.group || '0';
                                hueStore.triggerScene(bridge.id, groupId, scene.id).then(() => hueStore.refreshBridge(bridge.id));
                              }}>
                              🎨 {scene.name}
                            </Button>
                          ))}
                          {scenes.length > 20 && (
                            <span className="text-[8px] text-muted-foreground self-center">+{scenes.length - 20} more</span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {/* Info panel */}
      <div className="glass-panel p-4 space-y-2">
        <div className="text-[9px] text-muted-foreground/60">
          <strong>Note:</strong> Philips Hue uses local HTTP API — works on <code className="text-primary">localhost</code> only (same as WLED).
          <br />Auto-discover uses <code className="text-primary">discovery.meethue.com</code> to find bridges on your network.
          <br />Entertainment API (low-latency streaming) requires a local DTLS proxy — coming soon.
        </div>
      </div>
    </div>
  );
}
