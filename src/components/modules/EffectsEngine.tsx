import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Play, Pause, Plus, Trash2, Waves, Zap, Rainbow, Settings, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEffectStore, type EffectDefinition, type EffectWaveform, type EffectTarget } from '@/store/effectStore';
import { useFixtureStore } from '@/store/fixtureStore';

const WAVEFORM_ICONS: Record<EffectWaveform, string> = {
  sine: '∿', square: '⊓', sawtooth: '⋀', triangle: '△', random: '⁘',
};

const TARGET_LABELS: Record<EffectTarget, string> = {
  dimmer: 'Dimmer', red: 'Red', green: 'Green', blue: 'Blue',
  white: 'White', pan: 'Pan', tilt: 'Tilt', 'all-color': 'RGB Color',
};

const TYPE_ICONS: Record<EffectDefinition['type'], typeof Waves> = {
  phaser: Waves,
  chaser: Zap,
  rainbow: Rainbow,
  'strobe-fx': Zap,
};

function EffectCard({ effect }: { effect: EffectDefinition }) {
  const { activeEffectIds, toggleEffect, updateEffect, removeEffect } = useEffectStore();
  const instances = useFixtureStore(s => s.instances);
  const [expanded, setExpanded] = useState(false);
  const isActive = activeEffectIds.includes(effect.id);
  const Icon = TYPE_ICONS[effect.type] || Waves;

  return (
    <div className={`rounded-lg border transition-all ${
      isActive
        ? 'border-primary/40 bg-primary/5 shadow-[0_0_12px_hsl(var(--primary)/0.15)]'
        : 'border-border/20 bg-card/40'
    }`}>
      <div className="flex items-center gap-2 p-3">
        {/* Play/Stop */}
        <button onClick={() => toggleEffect(effect.id)}
          className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all ${
            isActive
              ? 'bg-primary/20 border-primary/40 text-primary'
              : 'bg-muted/20 border-border/30 text-muted-foreground hover:border-primary/30'
          }`}>
          {isActive ? <Pause size={12} /> : <Play size={12} />}
        </button>

        <Icon size={14} className={isActive ? 'text-primary' : 'text-muted-foreground/50'} />

        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold truncate">{effect.name}</div>
          <div className="text-[8px] text-muted-foreground/50 flex gap-2">
            <span>{effect.type}</span>
            <span>{WAVEFORM_ICONS[effect.waveform]} {effect.waveform}</span>
            <span>{effect.speed} BPM</span>
            <span>→ {TARGET_LABELS[effect.target]}</span>
          </div>
        </div>

        {/* Quick speed control */}
        <div className="w-20 shrink-0">
          <Slider
            value={[effect.speed]}
            min={1} max={300} step={1}
            onValueChange={([v]) => updateEffect(effect.id, { speed: v })}
            className="h-4"
          />
          <div className="text-[7px] text-center text-muted-foreground/40">{effect.speed} BPM</div>
        </div>

        <button onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground/30 hover:text-foreground">
          <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        <button onClick={() => removeEffect(effect.id)}
          className="text-muted-foreground/20 hover:text-destructive">
          <Trash2 size={10} />
        </button>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
          className="overflow-hidden border-t border-border/10">
          <div className="p-3 grid grid-cols-2 gap-3">
            {/* Waveform */}
            <div>
              <label className="text-[8px] uppercase text-muted-foreground/60 tracking-wider">Waveform</label>
              <Select value={effect.waveform} onValueChange={v => updateEffect(effect.id, { waveform: v as EffectWaveform })}>
                <SelectTrigger className="h-7 text-[11px] mt-0.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(WAVEFORM_ICONS) as EffectWaveform[]).map(w => (
                    <SelectItem key={w} value={w}>{WAVEFORM_ICONS[w]} {w}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Target */}
            <div>
              <label className="text-[8px] uppercase text-muted-foreground/60 tracking-wider">Target</label>
              <Select value={effect.target} onValueChange={v => updateEffect(effect.id, { target: v as EffectTarget })}>
                <SelectTrigger className="h-7 text-[11px] mt-0.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TARGET_LABELS) as EffectTarget[]).map(t => (
                    <SelectItem key={t} value={t}>{TARGET_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Intensity */}
            <div>
              <label className="text-[8px] uppercase text-muted-foreground/60 tracking-wider">Intensity {effect.intensity}%</label>
              <Slider value={[effect.intensity]} min={0} max={100} step={1}
                onValueChange={([v]) => updateEffect(effect.id, { intensity: v })} className="mt-1" />
            </div>

            {/* Phase Spread */}
            <div>
              <label className="text-[8px] uppercase text-muted-foreground/60 tracking-wider">Phase Spread {effect.phaseSpread}°</label>
              <Slider value={[effect.phaseSpread]} min={0} max={360} step={5}
                onValueChange={([v]) => updateEffect(effect.id, { phaseSpread: v })} className="mt-1" />
            </div>

            {/* Fixture offset */}
            <div>
              <label className="text-[8px] uppercase text-muted-foreground/60 tracking-wider">Fixture Offset {effect.fixtureOffset}°</label>
              <Slider value={[effect.fixtureOffset]} min={0} max={360} step={5}
                onValueChange={([v]) => updateEffect(effect.id, { fixtureOffset: v })} className="mt-1" />
            </div>

            {/* Rainbow spread */}
            {effect.type === 'rainbow' && (
              <div>
                <label className="text-[8px] uppercase text-muted-foreground/60 tracking-wider">Hue Spread {effect.rainbowSpread}°</label>
                <Slider value={[effect.rainbowSpread]} min={0} max={360} step={5}
                  onValueChange={([v]) => updateEffect(effect.id, { rainbowSpread: v })} className="mt-1" />
              </div>
            )}

            {/* Fixture selection */}
            <div className="col-span-2">
              <label className="text-[8px] uppercase text-muted-foreground/60 tracking-wider mb-1 block">
                Fixtures ({effect.fixtureIds.length} selected)
              </label>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                {instances.map(inst => {
                  const sel = effect.fixtureIds.includes(inst.id);
                  return (
                    <button key={inst.id}
                      onClick={() => {
                        const ids = sel
                          ? effect.fixtureIds.filter(id => id !== inst.id)
                          : [...effect.fixtureIds, inst.id];
                        updateEffect(effect.id, { fixtureIds: ids });
                      }}
                      className={`text-[9px] px-2 py-1 rounded border transition-all ${
                        sel ? 'bg-primary/20 border-primary/30 text-primary' : 'bg-muted/10 border-border/20 text-muted-foreground/50'
                      }`}
                    >
                      {inst.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

export function EffectsEngine() {
  const { effects, addEffect, deactivateAll, activeEffectIds } = useEffectStore();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<EffectDefinition['type']>('phaser');

  const handleAdd = () => {
    if (!newName.trim()) return;
    addEffect({
      id: `fx-${Date.now()}`,
      name: newName.trim(),
      type: newType,
      speed: 60,
      intensity: 100,
      waveform: 'sine',
      target: newType === 'rainbow' ? 'all-color' : 'dimmer',
      fixtureOffset: 0,
      fixtureIds: [],
      phaseSpread: 120,
      rainbowSpread: 360,
    });
    setNewName('');
    setShowAdd(false);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-border/30">
        <h2 className="text-sm font-semibold tracking-wider">EFFECTS ENGINE</h2>
        <div className="flex gap-2">
          {activeEffectIds.length > 0 && (
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 text-destructive border-destructive/30"
              onClick={deactivateAll}>
              <Pause size={10} /> Stop All ({activeEffectIds.length})
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1"
            onClick={() => setShowAdd(!showAdd)}>
            <Plus size={12} /> Effect
          </Button>
        </div>
      </div>

      {/* Add panel */}
      {showAdd && (
        <div className="p-3 border-b border-border/20 flex gap-2">
          <Input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Effect name..." className="h-7 text-[11px] flex-1"
            onKeyDown={e => e.key === 'Enter' && handleAdd()} />
          <Select value={newType} onValueChange={v => setNewType(v as EffectDefinition['type'])}>
            <SelectTrigger className="h-7 text-[11px] w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="phaser">Phaser</SelectItem>
              <SelectItem value="chaser">Chaser</SelectItem>
              <SelectItem value="rainbow">Rainbow</SelectItem>
              <SelectItem value="strobe-fx">Strobe FX</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" className="h-7 text-[10px]" onClick={handleAdd} disabled={!newName.trim()}>Create</Button>
        </div>
      )}

      {/* Effect list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {effects.length === 0 ? (
          <div className="text-center py-8 text-[11px] text-muted-foreground/40">
            No effects yet. Click "+ Effect" to create one.
          </div>
        ) : (
          effects.map(fx => <EffectCard key={fx.id} effect={fx} />)
        )}
      </div>
    </motion.div>
  );
}
