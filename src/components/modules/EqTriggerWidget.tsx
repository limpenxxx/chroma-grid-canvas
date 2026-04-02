import { useRef, useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Plus, Trash2, Activity, ChevronDown, ChevronRight } from 'lucide-react';

// ── Types ──

export interface EqTriggerZone {
  id: string;
  label: string;
  freqLow: number;   // Hz
  freqHigh: number;   // Hz
  threshold: number;  // 0-255
  color: string;      // display color
  fixtureId: string;  // linked fixture instance ID
  action: EqTriggerAction;
  // MH position params
  posA?: { pan: number; tilt: number };
  posB?: { pan: number; tilt: number };
  // Dimmer params
  dimmerMin?: number;
  dimmerMax?: number;
  // Color: idle (background) + trigger (on hit)
  idleColor?: { r: number; g: number; b: number };
  triggerColor?: { r: number; g: number; b: number };
  // Fade mode
  fadeMode?: 'instant' | 'fade';
  fadeTimeMs?: number; // fade-out duration in ms (default 500)
  // state
  active: boolean;
  energy: number; // current 0-1
}

export type EqTriggerAction = 'dimmer' | 'strobe' | 'color' | 'mh-position' | 'on-off' | 'color-flash';

const ACTION_OPTIONS: { value: EqTriggerAction; label: string }[] = [
  { value: 'dimmer', label: '💡 Dimmer' },
  { value: 'strobe', label: '⚡ Strobe' },
  { value: 'color-flash', label: '🎨 Color (Idle→Trigger)' },
  { value: 'color', label: '🎨 Color (legacy)' },
  { value: 'mh-position', label: '🔄 MH Position' },
  { value: 'on-off', label: '🔘 On/Off' },
];

const ZONE_COLORS = ['#ff2d78', '#00e5ff', '#ffaa00', '#00ff66', '#aa44ff', '#ff6600', '#4488ff', '#ff4444'];

export interface EqColorOutput {
  zone: EqTriggerZone;
  fadeProgress: number; // 0 = idle, 1 = full trigger
}

interface EqTriggerWidgetProps {
  zones: EqTriggerZone[];
  onZonesChange: (zones: EqTriggerZone[]) => void;
  analyserNode: AnalyserNode | null;
  sampleRate: number;
  width: number;
  height: number;
  fixtures: { id: string; name: string; icon: string }[];
  onTrigger: (zone: EqTriggerZone, energy: number) => void;
  onColorOutput?: (outputs: EqColorOutput[]) => void;
  isConfig?: boolean; // show config panel
}

// ── Spectrum Canvas ──

function SpectrumCanvas({
  analyserNode,
  sampleRate,
  zones,
  width,
  height,
  onZoneEnergies,
}: {
  analyserNode: AnalyserNode | null;
  sampleRate: number;
  zones: EqTriggerZone[];
  width: number;
  height: number;
  onZoneEnergies: (energies: Record<string, number>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const energiesRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = 2;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(0, 0, width, height);

      const nyquist = sampleRate / 2;
      const maxFreq = Math.min(nyquist, 20000);
      const freqToX = (f: number) => Math.log2(Math.max(20, f) / 20) / Math.log2(maxFreq / 20) * width;

      // Draw grid lines
      const gridFreqs = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      gridFreqs.forEach(f => {
        if (f > maxFreq) return;
        const x = freqToX(f);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      });

      // Draw frequency labels
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      gridFreqs.forEach(f => {
        if (f > maxFreq) return;
        const x = freqToX(f);
        ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x, height - 2);
      });

      // Draw zone highlights
      zones.forEach(zone => {
        const x1 = freqToX(zone.freqLow);
        const x2 = freqToX(zone.freqHigh);
        const energy = energiesRef.current[zone.id] || 0;
        const alpha = 0.08 + energy * 0.25;
        ctx.fillStyle = zone.color + Math.round(alpha * 255).toString(16).padStart(2, '0');
        ctx.fillRect(x1, 0, x2 - x1, height);

        // Zone border
        ctx.strokeStyle = zone.color + '60';
        ctx.lineWidth = 1;
        ctx.strokeRect(x1, 0, x2 - x1, height);

        // Zone label
        ctx.fillStyle = zone.color;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(zone.label, (x1 + x2) / 2, 12);

        // Threshold line
        const threshY = height - (zone.threshold / 255) * (height - 20);
        ctx.strokeStyle = zone.color + '80';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, threshY);
        ctx.lineTo(x2, threshY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Energy bar at bottom of zone
        if (energy > 0) {
          const barH = 3;
          ctx.fillStyle = zone.color;
          ctx.globalAlpha = 0.8;
          ctx.fillRect(x1 + 1, height - 14 - barH, (x2 - x1 - 2) * energy, barH);
          ctx.globalAlpha = 1;

          // Active indicator
          if (energy > zone.threshold / 255) {
            ctx.shadowColor = zone.color;
            ctx.shadowBlur = 8;
            ctx.fillStyle = zone.color;
            ctx.fillRect(x1 + 2, 16, 6, 6);
            ctx.shadowBlur = 0;
          }
        }
      });

      // Draw spectrum bars
      if (analyserNode) {
        const freqData = new Uint8Array(analyserNode.frequencyBinCount);
        analyserNode.getByteFrequencyData(freqData);
        const binHz = nyquist / analyserNode.frequencyBinCount;

        // Draw smooth spectrum line
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0,255,102,0.7)';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(0,255,102,0.4)';
        ctx.shadowBlur = 4;

        const barCount = Math.min(256, width);
        for (let i = 0; i < barCount; i++) {
          const freq = 20 * Math.pow(maxFreq / 20, i / barCount);
          const bin = Math.floor(freq / binHz);
          if (bin >= freqData.length) break;

          // Average nearby bins for smoothing
          let val = 0;
          let cnt = 0;
          for (let b = Math.max(0, bin - 1); b <= Math.min(freqData.length - 1, bin + 1); b++) {
            val += freqData[b]; cnt++;
          }
          val = (val / cnt) / 255;

          const x = freqToX(freq);
          const y = height - 18 - val * (height - 30);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Also draw filled area
        ctx.lineTo(width, height - 18);
        ctx.lineTo(0, height - 18);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,255,102,0.06)';
        ctx.fill();

        // Calculate zone energies
        const newEnergies: Record<string, number> = {};
        zones.forEach(zone => {
          const loBin = Math.max(0, Math.floor(zone.freqLow / binHz));
          const hiBin = Math.min(freqData.length - 1, Math.ceil(zone.freqHigh / binHz));
          let sum = 0;
          let count = 0;
          for (let i = loBin; i <= hiBin; i++) { sum += freqData[i]; count++; }
          newEnergies[zone.id] = count > 0 ? sum / count / 255 : 0;
        });
        energiesRef.current = newEnergies;
        onZoneEnergies(newEnergies);
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [analyserNode, sampleRate, width, height, zones, onZoneEnergies]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="rounded-md"
    />
  );
}

// ── Main EQ Trigger Widget ──

export function EqTriggerWidget({
  zones,
  onZonesChange,
  analyserNode,
  sampleRate,
  width,
  height,
  fixtures,
  onTrigger,
  isConfig = false,
}: EqTriggerWidgetProps) {
  const [expandedZone, setExpandedZone] = useState<string | null>(null);
  const prevActiveRef = useRef<Record<string, boolean>>({});

  const specH = isConfig ? Math.min(120, height * 0.35) : Math.max(60, height - 40);
  const specW = width - 8;

  const handleZoneEnergies = useCallback((energies: Record<string, number>) => {
    const prev = prevActiveRef.current;
    zones.forEach(zone => {
      const e = energies[zone.id] || 0;
      const isActive = e > zone.threshold / 255;
      if (isActive && !prev[zone.id]) {
        onTrigger(zone, e);
      }
      prev[zone.id] = isActive;
    });
  }, [zones, onTrigger]);

  const addZone = () => {
    const id = `eq-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const idx = zones.length;
    onZonesChange([...zones, {
      id,
      label: `Zone ${idx + 1}`,
      freqLow: idx === 0 ? 20 : idx === 1 ? 200 : idx === 2 ? 500 : 1000,
      freqHigh: idx === 0 ? 150 : idx === 1 ? 500 : idx === 2 ? 2000 : 5000,
      threshold: 100,
      color: ZONE_COLORS[idx % ZONE_COLORS.length],
      fixtureId: '',
      action: 'color-flash',
      dimmerMin: 0,
      dimmerMax: 255,
      idleColor: { r: 64, g: 0, b: 0 },
      triggerColor: { r: 255, g: 255, b: 255 },
      fadeMode: 'fade',
      fadeTimeMs: 500,
      active: false,
      energy: 0,
    }]);
  };

  const updateZone = (id: string, updates: Partial<EqTriggerZone>) => {
    onZonesChange(zones.map(z => z.id === id ? { ...z, ...updates } : z));
  };

  const removeZone = (id: string) => {
    onZonesChange(zones.filter(z => z.id !== id));
  };

  return (
    <div className="flex flex-col gap-1 w-full h-full" onClick={e => e.stopPropagation()}>
      {/* Spectrum display */}
      <div className="flex items-center justify-center">
        <SpectrumCanvas
          analyserNode={analyserNode}
          sampleRate={sampleRate}
          zones={zones}
          width={specW}
          height={specH}
          onZoneEnergies={handleZoneEnergies}
        />
      </div>

      {/* Zone indicators (compact mode) */}
      {!isConfig && (
        <div className="flex gap-1 px-1 flex-wrap">
          {zones.map(zone => (
            <div key={zone.id} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] font-mono"
              style={{ backgroundColor: zone.color + '20', color: zone.color, border: `1px solid ${zone.color}40` }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{
                backgroundColor: (prevActiveRef.current[zone.id]) ? zone.color : zone.color + '30',
                boxShadow: prevActiveRef.current[zone.id] ? `0 0 6px ${zone.color}` : 'none',
              }} />
              {zone.label}
            </div>
          ))}
        </div>
      )}

      {/* Config panel */}
      {isConfig && (
        <div className="flex-1 overflow-y-auto space-y-1.5 px-1">
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
              <Activity size={10} className="inline mr-1" />Trigger Zones ({zones.length})
            </span>
            <Button variant="outline" size="sm" className="h-5 text-[8px] px-2" onClick={addZone}>
              <Plus size={9} className="mr-0.5" /> Add Zone
            </Button>
          </div>

          {zones.map(zone => (
            <div key={zone.id} className="rounded border border-border/30 bg-muted/10">
              {/* Zone header */}
              <button
                className="w-full flex items-center gap-1.5 px-2 py-1 text-left"
                onClick={() => setExpandedZone(expandedZone === zone.id ? null : zone.id)}
              >
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: zone.color }} />
                <span className="text-[9px] font-semibold flex-1" style={{ color: zone.color }}>{zone.label}</span>
                <span className="text-[7px] text-muted-foreground font-mono">{zone.freqLow}-{zone.freqHigh}Hz</span>
                {expandedZone === zone.id ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              </button>

              {expandedZone === zone.id && (
                <div className="px-2 pb-2 space-y-1.5">
                  {/* Label */}
                  <div>
                    <span className="text-[7px] text-muted-foreground uppercase">Label</span>
                    <Input value={zone.label} onChange={e => updateZone(zone.id, { label: e.target.value })}
                      className="h-5 text-[9px] bg-muted/20" onClick={e => e.stopPropagation()} />
                  </div>

                  {/* Frequency range */}
                  <div className="grid grid-cols-2 gap-1">
                    <div>
                      <span className="text-[7px] text-muted-foreground uppercase">Low Hz</span>
                      <Input type="number" value={zone.freqLow} min={20} max={20000}
                        onChange={e => updateZone(zone.id, { freqLow: Number(e.target.value) })}
                        className="h-5 text-[9px] bg-muted/20 font-mono" onClick={e => e.stopPropagation()} />
                    </div>
                    <div>
                      <span className="text-[7px] text-muted-foreground uppercase">High Hz</span>
                      <Input type="number" value={zone.freqHigh} min={20} max={20000}
                        onChange={e => updateZone(zone.id, { freqHigh: Number(e.target.value) })}
                        className="h-5 text-[9px] bg-muted/20 font-mono" onClick={e => e.stopPropagation()} />
                    </div>
                  </div>

                  {/* Threshold */}
                  <div>
                    <span className="text-[7px] text-muted-foreground uppercase">Threshold {Math.round(zone.threshold / 255 * 100)}%</span>
                    <Slider value={[zone.threshold]} onValueChange={([v]) => updateZone(zone.id, { threshold: v })}
                      max={255} step={1} className="mt-0.5" />
                  </div>

                  {/* Fixture */}
                  <div>
                    <span className="text-[7px] text-muted-foreground uppercase">Fixture</span>
                    <select value={zone.fixtureId}
                      onChange={e => updateZone(zone.id, { fixtureId: e.target.value })}
                      onClick={e => e.stopPropagation()}
                      className="w-full h-5 rounded bg-muted/20 border border-border/20 text-[8px] px-1 text-foreground">
                      <option value="">— None —</option>
                      {fixtures.map(f => (
                        <option key={f.id} value={f.id}>{f.icon} {f.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Action */}
                  <div>
                    <span className="text-[7px] text-muted-foreground uppercase">Action</span>
                    <select value={zone.action}
                      onChange={e => updateZone(zone.id, { action: e.target.value as EqTriggerAction })}
                      onClick={e => e.stopPropagation()}
                      className="w-full h-5 rounded bg-muted/20 border border-border/20 text-[8px] px-1 text-foreground">
                      {ACTION_OPTIONS.map(a => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Action-specific params */}
                  {zone.action === 'mh-position' && (
                    <div className="space-y-1 border-t border-border/20 pt-1">
                      <span className="text-[7px] text-muted-foreground uppercase">Position A</span>
                      <div className="grid grid-cols-2 gap-1">
                        <div>
                          <span className="text-[6px] text-muted-foreground">Pan</span>
                          <Input type="number" value={zone.posA?.pan ?? 0} min={0} max={255}
                            onChange={e => updateZone(zone.id, { posA: { ...zone.posA || { pan: 0, tilt: 0 }, pan: Number(e.target.value) } })}
                            className="h-5 text-[9px] bg-muted/20 font-mono" onClick={e => e.stopPropagation()} />
                        </div>
                        <div>
                          <span className="text-[6px] text-muted-foreground">Tilt</span>
                          <Input type="number" value={zone.posA?.tilt ?? 0} min={0} max={255}
                            onChange={e => updateZone(zone.id, { posA: { ...zone.posA || { pan: 0, tilt: 0 }, tilt: Number(e.target.value) } })}
                            className="h-5 text-[9px] bg-muted/20 font-mono" onClick={e => e.stopPropagation()} />
                        </div>
                      </div>
                      <span className="text-[7px] text-muted-foreground uppercase">Position B</span>
                      <div className="grid grid-cols-2 gap-1">
                        <div>
                          <span className="text-[6px] text-muted-foreground">Pan</span>
                          <Input type="number" value={zone.posB?.pan ?? 128} min={0} max={255}
                            onChange={e => updateZone(zone.id, { posB: { ...zone.posB || { pan: 128, tilt: 128 }, pan: Number(e.target.value) } })}
                            className="h-5 text-[9px] bg-muted/20 font-mono" onClick={e => e.stopPropagation()} />
                        </div>
                        <div>
                          <span className="text-[6px] text-muted-foreground">Tilt</span>
                          <Input type="number" value={zone.posB?.tilt ?? 128} min={0} max={255}
                            onChange={e => updateZone(zone.id, { posB: { ...zone.posB || { pan: 128, tilt: 128 }, tilt: Number(e.target.value) } })}
                            className="h-5 text-[9px] bg-muted/20 font-mono" onClick={e => e.stopPropagation()} />
                        </div>
                      </div>
                    </div>
                  )}

                  {zone.action === 'dimmer' && (
                    <div className="grid grid-cols-2 gap-1">
                      <div>
                        <span className="text-[7px] text-muted-foreground uppercase">Min</span>
                        <Input type="number" value={zone.dimmerMin ?? 0} min={0} max={255}
                          onChange={e => updateZone(zone.id, { dimmerMin: Number(e.target.value) })}
                          className="h-5 text-[9px] bg-muted/20 font-mono" onClick={e => e.stopPropagation()} />
                      </div>
                      <div>
                        <span className="text-[7px] text-muted-foreground uppercase">Max</span>
                        <Input type="number" value={zone.dimmerMax ?? 255} min={0} max={255}
                          onChange={e => updateZone(zone.id, { dimmerMax: Number(e.target.value) })}
                          className="h-5 text-[9px] bg-muted/20 font-mono" onClick={e => e.stopPropagation()} />
                      </div>
                    </div>
                  )}

                  {/* Color Flash params (idle → trigger) */}
                  {(zone.action === 'color-flash' || zone.action === 'color') && (
                    <div className="space-y-1.5 border-t border-border/20 pt-1">
                      <span className="text-[7px] text-muted-foreground uppercase font-semibold">🎨 Idle → Trigger Colors</span>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-[7px] text-muted-foreground uppercase">Idle (BG)</span>
                          <div className="flex items-center gap-1 mt-0.5">
                            <input type="color"
                              value={`#${(zone.idleColor?.r ?? 0).toString(16).padStart(2,'0')}${(zone.idleColor?.g ?? 0).toString(16).padStart(2,'0')}${(zone.idleColor?.b ?? 0).toString(16).padStart(2,'0')}`}
                              onChange={e => {
                                const hex = e.target.value;
                                updateZone(zone.id, { idleColor: { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) } });
                              }}
                              onClick={e => e.stopPropagation()}
                              className="w-8 h-5 rounded border border-border/30 cursor-pointer bg-transparent" />
                            <span className="text-[7px] font-mono text-muted-foreground">
                              {zone.idleColor ? `${zone.idleColor.r},${zone.idleColor.g},${zone.idleColor.b}` : '0,0,0'}
                            </span>
                          </div>
                        </div>
                        <div>
                          <span className="text-[7px] text-muted-foreground uppercase">Trigger</span>
                          <div className="flex items-center gap-1 mt-0.5">
                            <input type="color"
                              value={`#${(zone.triggerColor?.r ?? 255).toString(16).padStart(2,'0')}${(zone.triggerColor?.g ?? 255).toString(16).padStart(2,'0')}${(zone.triggerColor?.b ?? 255).toString(16).padStart(2,'0')}`}
                              onChange={e => {
                                const hex = e.target.value;
                                updateZone(zone.id, { triggerColor: { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) } });
                              }}
                              onClick={e => e.stopPropagation()}
                              className="w-8 h-5 rounded border border-border/30 cursor-pointer bg-transparent" />
                            <span className="text-[7px] font-mono text-muted-foreground">
                              {zone.triggerColor ? `${zone.triggerColor.r},${zone.triggerColor.g},${zone.triggerColor.b}` : '255,255,255'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Fade mode */}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[7px] text-muted-foreground uppercase">Release</span>
                        <select value={zone.fadeMode || 'fade'}
                          onChange={e => updateZone(zone.id, { fadeMode: e.target.value as 'instant' | 'fade' })}
                          onClick={e => e.stopPropagation()}
                          className="h-5 rounded bg-muted/20 border border-border/20 text-[8px] px-1 text-foreground">
                          <option value="instant">⚡ Instant (static)</option>
                          <option value="fade">🌊 Fade out</option>
                        </select>
                      </div>

                      {(zone.fadeMode || 'fade') === 'fade' && (
                        <div>
                          <span className="text-[7px] text-muted-foreground uppercase">Fade time {zone.fadeTimeMs ?? 500}ms</span>
                          <Slider value={[zone.fadeTimeMs ?? 500]} onValueChange={([v]) => updateZone(zone.id, { fadeTimeMs: v })}
                            min={50} max={3000} step={50} className="mt-0.5" />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-1">
                    <span className="text-[7px] text-muted-foreground uppercase">Zone Color</span>
                    <div className="flex gap-0.5">
                      {ZONE_COLORS.map(c => (
                        <button key={c} className="w-3 h-3 rounded-sm border border-border/30"
                          style={{ backgroundColor: c, outline: zone.color === c ? '2px solid white' : 'none' }}
                          onClick={e => { e.stopPropagation(); updateZone(zone.id, { color: c }); }} />
                      ))}
                    </div>
                  </div>

                  {/* Delete */}
                  <Button variant="ghost" size="sm" className="h-5 text-[8px] text-destructive w-full"
                    onClick={e => { e.stopPropagation(); removeZone(zone.id); }}>
                    <Trash2 size={9} className="mr-0.5" /> Remove Zone
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
