import { useState, useCallback, useRef, useEffect } from 'react';
import { Lock, Unlock, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFixtureStore, getChannelColor, getFixtureTypeIcon, getFixtureIconEmoji } from '@/store/fixtureStore';
import { sendDmxChannel } from '@/lib/wsSync';

const STORAGE_KEY = 'stokio-dmx-mixer-v1';

interface MixerState {
  lockedChannels: Record<string, boolean>;
  channelValues: Record<string, number>;
}

function loadMixerState(): MixerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { lockedChannels: {}, channelValues: {} };
}

function saveMixerState(state: MixerState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function channelKey(universe: number, channel: number) {
  return `${universe}-${channel}`;
}

// Enhanced fader with fixture info, icon, and live color
function ChannelFader({
  channel, value, locked, fixtureName, channelName, channelFunction, fixtureIcon,
  liveValue, onValueChange, onToggleLock,
}: {
  channel: number;
  value: number;
  locked: boolean;
  fixtureName?: string;
  channelName?: string;
  channelFunction?: string;
  fixtureIcon?: string;
  liveValue?: number; // real-time DMX output value (may differ from slider if driven by program)
  onValueChange: (v: number) => void;
  onToggleLock: () => void;
}) {
  const faderRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = useCallback((clientY: number) => {
    const el = faderRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const newVal = Math.round(pct * 255);
    onValueChange(newVal);
    // Send to engine immediately
    sendDmxChannel(1, channel, newVal);
  }, [onValueChange, channel]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    handleDrag(e.clientY);
    const onMove = (ev: MouseEvent) => handleDrag(ev.clientY);
    const onUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [handleDrag]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setIsDragging(true);
    handleDrag(e.touches[0].clientY);
    const onMove = (ev: TouchEvent) => { ev.preventDefault(); handleDrag(ev.touches[0].clientY); };
    const onEnd = () => {
      setIsDragging(false);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
  }, [handleDrag]);

  const pct = (value / 255) * 100;
  const livePct = liveValue !== undefined ? (liveValue / 255) * 100 : null;
  const fnColor = channelFunction ? getChannelColor(channelFunction as any) : undefined;
  const hasFixture = !!fixtureName;
  const isActive = value > 0;

  return (
    <div className={`flex flex-col items-center gap-0.5 select-none transition-opacity ${hasFixture ? 'opacity-100' : 'opacity-40'}`} style={{ width: 30 }}>
      {/* Fixture icon */}
      {fixtureIcon && (
        <span className="text-[8px] leading-none" title={fixtureName}>{fixtureIcon}</span>
      )}

      {/* Channel number with function color indicator */}
      <div className="flex items-center gap-0.5">
        {fnColor && (
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: fnColor, opacity: isActive ? 1 : 0.3 }} />
        )}
        <span className={`text-[7px] font-mono font-bold ${locked ? 'text-red-400' : hasFixture ? 'text-foreground/70' : 'text-muted-foreground/40'}`}>
          {channel}
        </span>
      </div>

      {/* Fader track */}
      <div
        ref={faderRef}
        className={`relative w-3.5 rounded-full cursor-ns-resize border transition-colors ${
          locked ? 'border-red-500/50 bg-red-950/30'
          : isDragging ? 'border-primary/60 bg-primary/5'
          : 'border-border/30 bg-muted/20'
        }`}
        style={{ height: 150 }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        {/* Live value indicator (background bar from engine) */}
        {livePct !== null && livePct !== pct && (
          <div
            className="absolute bottom-0 left-0 w-full rounded-full bg-yellow-500/15"
            style={{ height: `${livePct}%` }}
          />
        )}

        {/* Fill */}
        <div
          className={`absolute bottom-0 left-0 w-full rounded-full transition-colors ${
            locked ? 'bg-gradient-to-t from-red-500/80 to-red-500/30'
            : fnColor ? '' : 'bg-gradient-to-t from-primary/60 to-primary/20'
          }`}
          style={{
            height: `${pct}%`,
            ...(fnColor && !locked ? { background: `linear-gradient(to top, ${fnColor}80, ${fnColor}30)` } : {}),
          }}
        />

        {/* Thumb */}
        <div
          className={`absolute left-1/2 -translate-x-1/2 w-5 h-2.5 rounded-sm transition-colors ${
            locked ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]'
            : 'bg-foreground/80 shadow-[0_0_4px_rgba(255,255,255,0.2)]'
          }`}
          style={{ bottom: `calc(${pct}% - 5px)` }}
        />
      </div>

      {/* Value */}
      <span className={`text-[6px] font-mono tabular-nums ${
        locked ? 'text-red-400' 
        : isActive ? 'text-foreground/60' 
        : 'text-muted-foreground/30'
      }`}>
        {value}
      </span>

      {/* Lock button */}
      <button
        onClick={onToggleLock}
        className={`w-4 h-4 flex items-center justify-center rounded transition-all ${
          locked ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
          : 'text-muted-foreground/30 hover:text-muted-foreground/60 hover:bg-muted/20'
        }`}
      >
        {locked ? <Lock size={7} /> : <Unlock size={7} />}
      </button>

      {/* Channel name */}
      {channelName && (
        <span className={`text-[5px] text-center leading-tight truncate w-full ${
          locked ? 'text-red-400/60' : 'text-muted-foreground/50'
        }`} title={`${fixtureName} - ${channelName}`}>
          {channelName}
        </span>
      )}
      {!channelName && fixtureName && (
        <span className="text-[5px] text-center leading-tight truncate w-full text-muted-foreground/30" title={fixtureName}>
          {fixtureName}
        </span>
      )}
    </div>
  );
}

interface DmxMixerProps {
  /** Live DMX values from engine for real-time display */
  liveDmxValues?: Record<string, number>;
  /** Callback when a value changes (for syncing to other components) */
  onValueChange?: (universe: number, channel: number, value: number) => void;
}

export function DmxMixer({ liveDmxValues = {}, onValueChange }: DmxMixerProps) {
  const store = useFixtureStore();
  const [mixerState, setMixerState] = useState<MixerState>(loadMixerState);
  const [universe, setUniverse] = useState(1);
  const [rangeStart, setRangeStart] = useState(1);
  const [viewMode, setViewMode] = useState<'all' | 'fixtures-only'>('all');

  const CHANNELS_PER_PAGE = 64;
  const rangeEnd = Math.min(rangeStart + CHANNELS_PER_PAGE - 1, 512);

  // Build enhanced channel-to-fixture map
  const channelFixtureMap = new Map<number, {
    fixtureName: string;
    channelName: string;
    channelFunction: string;
    fixtureIcon: string;
    instanceId: string;
  }>();

  store.instances.forEach(inst => {
    if (inst.universe !== universe) return;
    const def = store.definitions.find(d => d.id === inst.definitionId);
    if (!def) return;
    const mode = def.modes.find(m => m.id === inst.modeId);
    if (!mode) return;
    const icon = inst.icon ? getFixtureIconEmoji(inst.icon) : getFixtureTypeIcon(def.type);
    mode.channels.forEach(ch => {
      const addr = inst.dmxAddress + ch.number - 1;
      if (addr >= 1 && addr <= 512) {
        channelFixtureMap.set(addr, {
          fixtureName: inst.name,
          channelName: ch.name,
          channelFunction: ch.function,
          fixtureIcon: icon,
          instanceId: inst.id,
        });
      }
    });
  });

  // Determine fixture groups for header bars
  const fixtureGroups: { startCh: number; endCh: number; name: string; icon: string }[] = [];
  store.instances.forEach(inst => {
    if (inst.universe !== universe) return;
    const def = store.definitions.find(d => d.id === inst.definitionId);
    if (!def) return;
    const mode = def.modes.find(m => m.id === inst.modeId);
    if (!mode || mode.channels.length === 0) return;
    const icon = inst.icon ? getFixtureIconEmoji(inst.icon) : getFixtureTypeIcon(def.type);
    fixtureGroups.push({
      startCh: inst.dmxAddress,
      endCh: inst.dmxAddress + mode.channelCount - 1,
      name: inst.name,
      icon,
    });
  });
  fixtureGroups.sort((a, b) => a.startCh - b.startCh);

  const updateValue = useCallback((ch: number, val: number) => {
    const key = channelKey(universe, ch);
    setMixerState(prev => {
      const next = { ...prev, channelValues: { ...prev.channelValues, [key]: val } };
      saveMixerState(next);
      return next;
    });
    onValueChange?.(universe, ch, val);
  }, [universe, onValueChange]);

  const toggleLock = useCallback((ch: number) => {
    const key = channelKey(universe, ch);
    setMixerState(prev => {
      const isLocked = !!prev.lockedChannels[key];
      const next = { ...prev, lockedChannels: { ...prev.lockedChannels, [key]: !isLocked } };
      if (isLocked) delete next.lockedChannels[key];
      saveMixerState(next);
      return next;
    });
  }, [universe]);

  const lockedCount = Object.values(mixerState.lockedChannels).filter(Boolean).length;

  const unlockAll = () => {
    setMixerState(prev => {
      const next = { ...prev, lockedChannels: {} };
      saveMixerState(next);
      return next;
    });
  };

  const resetAll = () => {
    setMixerState({ lockedChannels: {}, channelValues: {} });
    saveMixerState({ lockedChannels: {}, channelValues: {} });
  };

  let channels: number[] = [];
  if (viewMode === 'fixtures-only') {
    // Only show channels that belong to fixtures
    const fixChs = new Set<number>();
    store.instances.forEach(inst => {
      if (inst.universe !== universe) return;
      const def = store.definitions.find(d => d.id === inst.definitionId);
      if (!def) return;
      const mode = def.modes.find(m => m.id === inst.modeId);
      if (!mode) return;
      mode.channels.forEach(ch => {
        fixChs.add(inst.dmxAddress + ch.number - 1);
      });
    });
    channels = Array.from(fixChs).sort((a, b) => a - b);
  } else {
    for (let i = rangeStart; i <= rangeEnd; i++) channels.push(i);
  }

  const pages = [];
  for (let p = 1; p <= 512; p += CHANNELS_PER_PAGE) pages.push(p);

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-[10px] uppercase tracking-widest text-primary font-semibold">🎛️ DMX Mixer</h3>
          {lockedCount > 0 && (
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1">
              <Lock size={8} /> {lockedCount} locked
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode(v => v === 'all' ? 'fixtures-only' : 'all')}
            className={`px-2 py-0.5 rounded text-[8px] font-semibold transition-all ${
              viewMode === 'fixtures-only'
                ? 'bg-primary/10 text-primary border border-primary/30'
                : 'text-muted-foreground hover:text-foreground border border-transparent'
            }`}
          >
            {viewMode === 'fixtures-only' ? '🎯 Fixtures Only' : '📊 All 512'}
          </button>
          <Button variant="outline" size="sm" className="h-6 text-[9px] gap-1" onClick={unlockAll}>
            <Unlock size={10} /> Unlock
          </Button>
          <Button variant="outline" size="sm" className="h-6 text-[9px] gap-1" onClick={resetAll}>
            <RotateCcw size={10} /> Reset
          </Button>
        </div>
      </div>

      {/* Universe selector */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-muted-foreground font-semibold">UNIVERSE</span>
        <div className="flex gap-1">
          {[1, 2, 3, 4].map(u => (
            <button key={u} onClick={() => setUniverse(u)}
              className={`px-2 py-0.5 rounded text-[9px] font-mono font-semibold transition-all ${
                universe === u ? 'bg-primary/10 text-primary border border-primary/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/20 border border-transparent'
              }`}
            >{u}</button>
          ))}
        </div>
      </div>

      {/* Page navigation (only in 'all' mode) */}
      {viewMode === 'all' && (
        <div className="flex gap-1 flex-wrap">
          {pages.map(p => {
            const end = Math.min(p + CHANNELS_PER_PAGE - 1, 512);
            const hasLocked = Array.from({ length: end - p + 1 }, (_, i) => p + i)
              .some(ch => mixerState.lockedChannels[channelKey(universe, ch)]);
            const hasFixture = Array.from({ length: end - p + 1 }, (_, i) => p + i)
              .some(ch => channelFixtureMap.has(ch));
            return (
              <button key={p} onClick={() => setRangeStart(p)}
                className={`px-2 py-0.5 rounded text-[8px] font-mono transition-all ${
                  rangeStart === p ? 'bg-primary/10 text-primary border border-primary/30'
                  : hasLocked ? 'text-red-400 border border-red-500/20 bg-red-500/5'
                  : hasFixture ? 'text-foreground/60 border border-border/30 bg-muted/10'
                  : 'text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted/20 border border-transparent'
                }`}
              >{p}–{end}</button>
            );
          })}
        </div>
      )}

      {/* Fixture group headers */}
      {fixtureGroups.filter(g => {
        if (viewMode === 'fixtures-only') return true;
        return g.startCh >= rangeStart && g.startCh <= rangeEnd;
      }).length > 0 && (
        <div className="flex gap-1 flex-wrap text-[7px]">
          {fixtureGroups.filter(g => {
            if (viewMode === 'fixtures-only') return true;
            return g.startCh >= rangeStart && g.startCh <= rangeEnd;
          }).map(g => (
            <span key={g.startCh} className="px-1.5 py-0.5 rounded bg-muted/20 border border-border/20 flex items-center gap-1">
              <span>{g.icon}</span>
              <span className="font-semibold">{g.name}</span>
              <span className="text-muted-foreground">{g.startCh}–{g.endCh}</span>
            </span>
          ))}
        </div>
      )}

      {/* Faders */}
      <div className="glass-panel p-3">
        <div className="flex gap-0.5 overflow-x-auto pb-2">
          {channels.map(ch => {
            const key = channelKey(universe, ch);
            const value = mixerState.channelValues[key] ?? 0;
            const locked = !!mixerState.lockedChannels[key];
            const info = channelFixtureMap.get(ch);
            const liveVal = liveDmxValues[key];
            return (
              <ChannelFader
                key={ch}
                channel={ch}
                value={locked ? value : (liveVal ?? value)}
                locked={locked}
                fixtureName={info?.fixtureName}
                channelName={info?.channelName}
                channelFunction={info?.channelFunction}
                fixtureIcon={info?.fixtureIcon}
                liveValue={liveVal}
                onValueChange={(v) => updateValue(ch, v)}
                onToggleLock={() => toggleLock(ch)}
              />
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[8px] text-muted-foreground/50 flex-wrap">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-primary/60" />
          <span>Normal</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-red-500/60" />
          <span>Locked (priority override)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-1 rounded-sm bg-yellow-500/30" />
          <span>Live from engine</span>
        </div>
      </div>
    </div>
  );
}
