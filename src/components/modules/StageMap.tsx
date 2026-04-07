import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Move, ZoomIn, ZoomOut, Grid3X3, Eye, EyeOff, 
  Maximize2, RotateCcw, Lightbulb, Radio
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useFixtureStore, type FixtureInstance, type FixtureDefinition,
  getFixtureTypeIcon, getFixtureIconEmoji,
} from '@/store/fixtureStore';
import { useWledStore, type WledDevice } from '@/store/wledStore';

interface StageMapProps {
  selectedFixtureIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onRequestAI?: (fixtureIds: string[]) => void;
  dmxValues?: Record<string, number>; // "universe-channel" => value
}

/**
 * Stage Map — Visual fixture layout with drag-and-drop placement.
 * Shows all DMX fixtures, WLED devices, and moving heads on a 2D map.
 */
export function StageMap({ selectedFixtureIds, onSelectionChange, onRequestAI, dmxValues = {} }: StageMapProps) {
  const { instances, definitions, updateInstance } = useFixtureStore();
  const wledDevices = useWledStore(s => s.devices);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [dragState, setDragState] = useState<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Canvas size
  const STAGE_W = 960;
  const STAGE_H = 540;

  // Get live color for a fixture based on DMX values
  const getFixtureLiveColor = useCallback((inst: FixtureInstance, def: FixtureDefinition): string => {
    const mode = def.modes.find(m => m.id === inst.modeId);
    if (!mode) return '#444';

    let r = 0, g = 0, b = 0, dimmer = 255;
    mode.channels.forEach(ch => {
      const addr = inst.dmxAddress + ch.number - 1;
      const val = dmxValues[`${inst.universe}-${addr}`] ?? ch.defaultValue;
      switch (ch.function) {
        case 'red': r = val; break;
        case 'green': g = val; break;
        case 'blue': b = val; break;
        case 'dimmer': dimmer = val; break;
      }
    });

    const d = dimmer / 255;
    return `rgb(${Math.round(r * d)}, ${Math.round(g * d)}, ${Math.round(b * d)})`;
  }, [dmxValues]);

  // Get pan/tilt for moving heads
  const getFixturePanTilt = useCallback((inst: FixtureInstance, def: FixtureDefinition): { pan: number; tilt: number } | null => {
    if (def.type !== 'moving-head') return null;
    const mode = def.modes.find(m => m.id === inst.modeId);
    if (!mode) return null;

    let pan = 128, tilt = 128;
    mode.channels.forEach(ch => {
      const addr = inst.dmxAddress + ch.number - 1;
      const val = dmxValues[`${inst.universe}-${addr}`] ?? ch.defaultValue;
      if (ch.function === 'pan') pan = val;
      if (ch.function === 'tilt') tilt = val;
    });

    return { pan, tilt };
  }, [dmxValues]);

  const handleMouseDown = useCallback((e: React.MouseEvent, instId: string) => {
    e.stopPropagation();
    const inst = instances.find(i => i.id === instId);
    if (!inst) return;

    // Toggle selection
    if (e.shiftKey) {
      onSelectionChange(
        selectedFixtureIds.includes(instId)
          ? selectedFixtureIds.filter(id => id !== instId)
          : [...selectedFixtureIds, instId]
      );
    } else if (!selectedFixtureIds.includes(instId)) {
      onSelectionChange([instId]);
    }

    setDragState({
      id: instId,
      startX: e.clientX,
      startY: e.clientY,
      origX: inst.stageX,
      origY: inst.stageY,
    });
  }, [instances, selectedFixtureIds, onSelectionChange]);

  useEffect(() => {
    if (!dragState) return;

    const onMove = (e: MouseEvent) => {
      const dx = (e.clientX - dragState.startX) / zoom;
      const dy = (e.clientY - dragState.startY) / zoom;
      const newX = Math.max(0, Math.min(STAGE_W - 30, dragState.origX + dx));
      const newY = Math.max(0, Math.min(STAGE_H - 30, dragState.origY + dy));
      updateInstance(dragState.id, { stageX: newX, stageY: newY, onStage: true });
    };

    const onUp = () => setDragState(null);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragState, zoom, updateInstance]);

  const handleCanvasClick = () => {
    onSelectionChange([]);
  };

  // Auto-place unplaced fixtures
  const autoPlace = () => {
    instances.forEach((inst, i) => {
      if (!inst.onStage) {
        const row = Math.floor(i / 6);
        const col = i % 6;
        updateInstance(inst.id, {
          onStage: true,
          stageX: 80 + col * 140,
          stageY: 80 + row * 120,
        });
      }
    });
  };

  const placedFixtures = instances.filter(i => i.onStage);
  const unplacedFixtures = instances.filter(i => !i.onStage);

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[10px] uppercase tracking-widest text-primary font-semibold">🗺️ Stage Map</h3>
          <span className="text-[8px] text-muted-foreground">
            {placedFixtures.length} placed · {unplacedFixtures.length} unplaced
          </span>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setZoom(z => Math.min(2, z + 0.1))}>
            <ZoomIn size={12} />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setZoom(z => Math.max(0.3, z - 0.1))}>
            <ZoomOut size={12} />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowGrid(v => !v)}>
            <Grid3X3 size={12} className={showGrid ? 'text-primary' : ''} />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowLabels(v => !v)}>
            {showLabels ? <Eye size={12} className="text-primary" /> : <EyeOff size={12} />}
          </Button>
          <Button variant="outline" size="sm" className="h-6 text-[8px] gap-1" onClick={autoPlace}>
            <Maximize2 size={10} /> Auto-place
          </Button>
          {selectedFixtureIds.length > 0 && onRequestAI && (
            <Button 
              variant="outline" 
              size="sm" 
              className="h-6 text-[8px] gap-1 border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
              onClick={() => onRequestAI(selectedFixtureIds)}
            >
              ✨ AI Show
            </Button>
          )}
        </div>
      </div>

      {/* Stage canvas */}
      <div className="flex-1 overflow-auto">
        <div
          ref={canvasRef}
          className="relative border border-border/20 rounded-lg overflow-hidden bg-black/50"
          style={{
            width: STAGE_W * zoom,
            height: STAGE_H * zoom,
            minWidth: STAGE_W * zoom,
            minHeight: STAGE_H * zoom,
          }}
          onClick={handleCanvasClick}
        >
          {/* Grid */}
          {showGrid && (
            <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
              <defs>
                <pattern id="stageGrid" width={40 * zoom} height={40 * zoom} patternUnits="userSpaceOnUse">
                  <path d={`M ${40 * zoom} 0 L 0 0 0 ${40 * zoom}`} fill="none" stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.15" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#stageGrid)" />
            </svg>
          )}

          {/* Stage label */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[8px] uppercase tracking-[0.3em] text-muted-foreground/30 font-semibold">
            FRONT OF STAGE
          </div>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[8px] uppercase tracking-[0.3em] text-muted-foreground/20">
            BACK
          </div>

          {/* Placed fixtures */}
          {placedFixtures.map(inst => {
            const def = definitions.find(d => d.id === inst.definitionId);
            if (!def) return null;
            const isSelected = selectedFixtureIds.includes(inst.id);
            const liveColor = getFixtureLiveColor(inst, def);
            const panTilt = getFixturePanTilt(inst, def);
            const icon = inst.icon ? getFixtureIconEmoji(inst.icon) : getFixtureTypeIcon(def.type);
            const size = inst.stageWidth * zoom;

            return (
              <motion.div
                key={inst.id}
                className={`absolute cursor-grab active:cursor-grabbing select-none group`}
                style={{
                  left: inst.stageX * zoom,
                  top: inst.stageY * zoom,
                  width: size,
                  height: size,
                }}
                onMouseDown={(e) => handleMouseDown(e, inst.id)}
                animate={{ scale: isSelected ? 1.1 : 1 }}
                transition={{ duration: 0.15 }}
              >
                {/* Live color glow */}
                <div
                  className="absolute inset-0 rounded-full blur-md"
                  style={{ backgroundColor: liveColor, opacity: 0.4 }}
                />

                {/* Fixture body */}
                <div
                  className={`relative w-full h-full rounded-full border-2 flex items-center justify-center transition-colors ${
                    isSelected
                      ? 'border-primary shadow-[0_0_12px_hsl(var(--primary)/0.5)]'
                      : 'border-border/40 hover:border-border/70'
                  }`}
                  style={{ backgroundColor: `color-mix(in srgb, ${liveColor} 30%, transparent)` }}
                >
                  <span className="text-sm">{icon}</span>

                  {/* Pan/Tilt beam indicator for moving heads */}
                  {panTilt && (
                    <div
                      className="absolute w-1 rounded-full bg-white/40"
                      style={{
                        height: size * 0.8,
                        left: '50%',
                        top: '-40%',
                        transformOrigin: 'bottom center',
                        transform: `translateX(-50%) rotate(${(panTilt.pan - 128) * 0.7}deg)`,
                        opacity: 0.3 + (dmxValues[`${inst.universe}-${inst.dmxAddress + 5}`] ?? 0) / 255 * 0.7,
                      }}
                    />
                  )}
                </div>

                {/* Label */}
                {showLabels && (
                  <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-center">
                    <span className="text-[7px] font-mono font-semibold text-foreground/70 bg-background/60 px-1 rounded">
                      {inst.name}
                    </span>
                    <span className="block text-[5px] text-muted-foreground/40">
                      U{inst.universe}.{inst.dmxAddress}
                    </span>
                  </div>
                )}
              </motion.div>
            );
          })}

          {/* WLED devices as secondary indicators */}
          {wledDevices.map((dev, i) => (
            <div
              key={dev.id}
              className="absolute flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/20"
              style={{
                right: 10 * zoom,
                top: (10 + i * 24) * zoom,
              }}
            >
              <Radio size={8} className="text-green-400" />
              <span className="text-[6px] font-mono text-green-400">{dev.name || dev.ip}</span>
              <div className={`w-1.5 h-1.5 rounded-full ${dev.online ? 'bg-green-400' : 'bg-red-400'}`} />
            </div>
          ))}
        </div>
      </div>

      {/* Unplaced fixtures tray */}
      {unplacedFixtures.length > 0 && (
        <div className="px-2 pb-1">
          <div className="text-[7px] uppercase text-muted-foreground/50 mb-1">Drag to place:</div>
          <div className="flex gap-1 flex-wrap">
            {unplacedFixtures.map(inst => {
              const def = definitions.find(d => d.id === inst.definitionId);
              const icon = inst.icon ? getFixtureIconEmoji(inst.icon) : (def ? getFixtureTypeIcon(def.type) : '□');
              return (
                <button
                  key={inst.id}
                  className="px-2 py-1 rounded text-[8px] bg-muted/20 border border-border/20 hover:bg-muted/40 flex items-center gap-1"
                  onClick={() => {
                    updateInstance(inst.id, {
                      onStage: true,
                      stageX: 100 + Math.random() * 600,
                      stageY: 100 + Math.random() * 300,
                    });
                  }}
                >
                  <span>{icon}</span>
                  <span>{inst.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
