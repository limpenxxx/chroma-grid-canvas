import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plus, Minus, Trash2, Pencil, X, Check } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { usePresetStore, type ScenePreset } from '@/store/presetStore';
import { toast } from 'sonner';

// Built-in preset images
import imgDaylight from '@/assets/presets/daylight.jpg';
import imgRed from '@/assets/presets/red.jpg';
import imgRedWhite from '@/assets/presets/red-white.jpg';
import imgDiscoball from '@/assets/presets/discoball.jpg';
import imgMhSlow from '@/assets/presets/mh-slow.jpg';
import imgMhFast from '@/assets/presets/mh-fast.jpg';
import imgKimOpium from '@/assets/presets/kim-opium.jpg';
import imgNevzat from '@/assets/presets/nevzat.jpg';
import imgCem from '@/assets/presets/cem.jpg';

const BUILT_IN_PRESETS: ScenePreset[] = [
  { id: 'preset-daylight', name: 'Dagsljus', image: imgDaylight, description: 'Warm white daylight', color: { r: 255, g: 220, b: 180 }, masterDimmer: 100, order: 0, builtIn: true },
  { id: 'preset-red', name: 'Rött', image: imgRed, description: 'Deep red ambient', color: { r: 255, g: 0, b: 0 }, masterDimmer: 80, order: 1, builtIn: true },
  { id: 'preset-red-white', name: 'Rött + Vitt', image: imgRedWhite, description: 'Red and white contrast', color: { r: 255, g: 100, b: 100 }, masterDimmer: 90, order: 2, builtIn: true },
  { id: 'preset-discoball', name: 'Discokula', image: imgDiscoball, description: 'Classic disco ball effect', effectIds: ['fx-rainbow'], masterDimmer: 100, order: 3, builtIn: true },
  { id: 'preset-mh-slow', name: 'MH Slow', image: imgMhSlow, description: 'Moving heads slow sweep', effectIds: ['fx-pan-tilt-circle'], masterDimmer: 80, order: 4, builtIn: true },
  { id: 'preset-mh-fast', name: 'MH Fast', image: imgMhFast, description: 'Moving heads fast dynamic', effectIds: ['fx-pan-tilt-circle'], masterDimmer: 100, order: 5, builtIn: true },
  { id: 'preset-kim-opium', name: 'Kim Opium', image: imgKimOpium, description: 'Dark moody purple & amber', color: { r: 120, g: 30, b: 80 }, masterDimmer: 50, order: 6, builtIn: true },
  { id: 'preset-nevzat', name: 'Nevzat', image: imgNevzat, description: 'Warm orange & deep blue', color: { r: 200, g: 100, b: 20 }, masterDimmer: 70, order: 7, builtIn: true },
  { id: 'preset-cem', name: 'Cem', image: imgCem, description: 'High energy green & magenta', color: { r: 0, g: 255, b: 80 }, masterDimmer: 100, order: 8, builtIn: true },
];

// Seed built-in presets on first load
function useSeedPresets() {
  const { presets, addPreset } = usePresetStore();
  useEffect(() => {
    if (presets.length === 0) {
      BUILT_IN_PRESETS.forEach(p => addPreset(p));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

function PresetButton({ preset, scale, isActive }: {
  preset: ScenePreset; scale: number; isActive: boolean;
}) {
  const { activatePreset, deactivatePreset, removePreset, updatePreset } = usePresetStore();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(preset.name);

  const baseSize = 100 * scale;
  const imgSize = baseSize;
  const fontSize = Math.max(8, 10 * scale);

  const handleClick = () => {
    if (editing) return;
    if (isActive) {
      deactivatePreset();
    } else {
      activatePreset(preset.id);
    }
  };

  const handleSaveEdit = () => {
    updatePreset(preset.id, { name: editName.trim() || preset.name });
    setEditing(false);
  };

  return (
    <motion.div
      whileTap={{ scale: 0.95 }}
      className={`relative group cursor-pointer flex flex-col items-center gap-1 select-none`}
      style={{ width: imgSize }}
      onClick={handleClick}
    >
      {/* Image */}
      <div
        className={`relative rounded-xl overflow-hidden border-2 transition-all duration-200 ${
          isActive
            ? 'border-primary shadow-[0_0_20px_hsl(var(--primary)/0.5)] ring-2 ring-primary/30'
            : 'border-border/30 hover:border-border/60'
        }`}
        style={{ width: imgSize, height: imgSize * 0.7 }}
      >
        <img
          src={preset.image}
          alt={preset.name}
          loading="lazy"
          className="w-full h-full object-cover"
          draggable={false}
        />
        {/* Active overlay */}
        {isActive && (
          <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full bg-primary/80 flex items-center justify-center animate-pulse">
              <div className="w-2 h-2 rounded-full bg-white" />
            </div>
          </div>
        )}
        {/* Color indicator */}
        {preset.color && (
          <div
            className="absolute bottom-1 right-1 w-3 h-3 rounded-full border border-white/30"
            style={{ backgroundColor: `rgb(${preset.color.r},${preset.color.g},${preset.color.b})` }}
          />
        )}
        {/* Edit/Delete on hover */}
        {!editing && (
          <div className="absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={e => { e.stopPropagation(); setEditName(preset.name); setEditing(true); }}
              className="w-5 h-5 rounded bg-black/60 flex items-center justify-center text-white/70 hover:text-white"
            >
              <Pencil size={8} />
            </button>
            {!preset.builtIn && (
              <button
                onClick={e => { e.stopPropagation(); removePreset(preset.id); toast.success('Preset removed'); }}
                className="w-5 h-5 rounded bg-black/60 flex items-center justify-center text-destructive/70 hover:text-destructive"
              >
                <Trash2 size={8} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Label */}
      {editing ? (
        <div className="flex gap-0.5 items-center" onClick={e => e.stopPropagation()}>
          <Input
            value={editName}
            onChange={e => setEditName(e.target.value)}
            className="h-5 text-[9px] w-20 px-1"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleSaveEdit()}
          />
          <button onClick={handleSaveEdit} className="text-primary"><Check size={10} /></button>
          <button onClick={() => setEditing(false)} className="text-muted-foreground"><X size={10} /></button>
        </div>
      ) : (
        <span
          className={`text-center font-semibold uppercase tracking-wider truncate w-full transition-colors ${
            isActive ? 'text-primary' : 'text-foreground/70'
          }`}
          style={{ fontSize }}
        >
          {preset.name}
        </span>
      )}
    </motion.div>
  );
}

export function ScenePresets() {
  useSeedPresets();
  const { presets, activePresetId, presetScale, setPresetScale } = usePresetStore();

  const sorted = [...presets].sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-col gap-3">
      {/* Scale control */}
      <div className="flex items-center gap-3 px-1">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-semibold shrink-0">
          SCENE PRESETS
        </span>
        <div className="flex-1" />
        <Minus size={10} className="text-muted-foreground/30" />
        <Slider
          value={[presetScale]}
          min={0.5} max={2} step={0.1}
          onValueChange={([v]) => setPresetScale(v)}
          className="w-20"
        />
        <Plus size={10} className="text-muted-foreground/30" />
      </div>

      {/* Preset grid */}
      <div className="flex flex-wrap gap-2">
        {sorted.map(preset => (
          <PresetButton
            key={preset.id}
            preset={preset}
            scale={presetScale}
            isActive={activePresetId === preset.id}
          />
        ))}
      </div>
    </div>
  );
}
