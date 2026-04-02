import { useState, useCallback, useRef } from 'react';
import { Lock, Unlock, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFixtureStore } from '@/store/fixtureStore';

// Store locked channels and values in localStorage
const STORAGE_KEY = 'stokio-dmx-mixer-v1';

interface MixerState {
  lockedChannels: Record<string, boolean>; // "universe-channel" => true
  channelValues: Record<string, number>;   // "universe-channel" => 0-255
}

function loadMixerState(): MixerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { lockedChannels: {}, channelValues: {} };
}

function saveMixerState(state: MixerState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function channelKey(universe: number, channel: number) {
  return `${universe}-${channel}`;
}

// Vertical fader component
function ChannelFader({
  channel,
  value,
  locked,
  fixtureName,
  channelName,
  onValueChange,
  onToggleLock,
}: {
  channel: number;
  value: number;
  locked: boolean;
  fixtureName?: string;
  channelName?: string;
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
    onValueChange(Math.round(pct * 255));
  }, [onValueChange]);

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

  const pct = (value / 255) * 100;

  return (
    <div className="flex flex-col items-center gap-0.5 select-none" style={{ width: 28 }}>
      {/* Channel number */}
      <span className={`text-[7px] font-mono font-bold ${locked ? 'text-red-400' : 'text-muted-foreground'}`}>
        {channel}
      </span>

      {/* Fader track */}
      <div
        ref={faderRef}
        className={`relative w-3 rounded-full cursor-ns-resize border transition-colors ${
          locked 
            ? 'border-red-500/50 bg-red-950/30' 
            : 'border-border/30 bg-muted/20'
        }`}
        style={{ height: 150 }}
        onMouseDown={handleMouseDown}
      >
        {/* Fill */}
        <div
          className={`absolute bottom-0 left-0 w-full rounded-full transition-colors ${
            locked 
              ? 'bg-gradient-to-t from-red-500/80 to-red-500/30' 
              : 'bg-gradient-to-t from-primary/60 to-primary/20'
          }`}
          style={{ height: `${pct}%` }}
        />
        {/* Thumb */}
        <div
          className={`absolute left-1/2 -translate-x-1/2 w-5 h-2 rounded-sm transition-colors ${
            locked 
              ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]' 
              : 'bg-primary shadow-[0_0_6px_hsl(var(--primary)/0.5)]'
          }`}
          style={{ bottom: `calc(${pct}% - 4px)` }}
        />
      </div>

      {/* Value */}
      <span className={`text-[6px] font-mono ${locked ? 'text-red-400' : 'text-muted-foreground/60'}`}>
        {value}
      </span>

      {/* Lock button */}
      <button
        onClick={onToggleLock}
        className={`w-4 h-4 flex items-center justify-center rounded transition-all ${
          locked 
            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' 
            : 'text-muted-foreground/30 hover:text-muted-foreground/60 hover:bg-muted/20'
        }`}
      >
        {locked ? <Lock size={7} /> : <Unlock size={7} />}
      </button>

      {/* Fixture name tooltip */}
      {fixtureName && (
        <span className={`text-[5px] text-center leading-tight truncate w-full ${locked ? 'text-red-400/60' : 'text-muted-foreground/40'}`}>
          {channelName || fixtureName}
        </span>
      )}
    </div>
  );
}

export function DmxMixer() {
  const store = useFixtureStore();
  const [mixerState, setMixerState] = useState<MixerState>(loadMixerState);
  const [universe, setUniverse] = useState(1);
  const [rangeStart, setRangeStart] = useState(1); // show channels in pages of 64

  const CHANNELS_PER_PAGE = 64;
  const rangeEnd = Math.min(rangeStart + CHANNELS_PER_PAGE - 1, 512);

  // Build a channel-to-fixture map for labeling
  const channelFixtureMap = new Map<number, { fixtureName: string; channelName: string }>();
  store.instances.forEach(inst => {
    if (inst.universe !== universe) return;
    const def = store.definitions.find(d => d.id === inst.definitionId);
    if (!def) return;
    const mode = def.modes.find(m => m.id === inst.modeId);
    if (!mode) return;
    mode.channels.forEach(ch => {
      const addr = inst.dmxAddress + ch.number - 1;
      if (addr >= 1 && addr <= 512) {
        channelFixtureMap.set(addr, { fixtureName: inst.name, channelName: ch.name });
      }
    });
  });

  const updateValue = useCallback((ch: number, val: number) => {
    const key = channelKey(universe, ch);
    setMixerState(prev => {
      const next = { ...prev, channelValues: { ...prev.channelValues, [key]: val } };
      saveMixerState(next);
      return next;
    });
  }, [universe]);

  const toggleLock = useCallback((ch: number) => {
    const key = channelKey(universe, ch);
    setMixerState(prev => {
      const isLocked = !!prev.lockedChannels[key];
      const next = {
        ...prev,
        lockedChannels: { ...prev.lockedChannels, [key]: !isLocked },
      };
      if (isLocked) {
        delete next.lockedChannels[key];
      }
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

  const channels = [];
  for (let i = rangeStart; i <= rangeEnd; i++) {
    channels.push(i);
  }

  // Page buttons
  const pages = [];
  for (let p = 1; p <= 512; p += CHANNELS_PER_PAGE) {
    pages.push(p);
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-[10px] uppercase tracking-widest text-primary font-semibold">
            🎛️ DMX Mixer Console
          </h3>
          {lockedCount > 0 && (
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1">
              <Lock size={8} /> {lockedCount} locked
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="h-6 text-[9px] gap-1" onClick={unlockAll}>
            <Unlock size={10} /> Unlock All
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
            <button
              key={u}
              onClick={() => setUniverse(u)}
              className={`px-2 py-0.5 rounded text-[9px] font-mono font-semibold transition-all ${
                universe === u
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/20 border border-transparent'
              }`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      {/* Page navigation */}
      <div className="flex gap-1 flex-wrap">
        {pages.map(p => {
          const end = Math.min(p + CHANNELS_PER_PAGE - 1, 512);
          // Check if any channels in this page are locked
          const hasLocked = Array.from({ length: end - p + 1 }, (_, i) => p + i)
            .some(ch => mixerState.lockedChannels[channelKey(universe, ch)]);
          return (
            <button
              key={p}
              onClick={() => setRangeStart(p)}
              className={`px-2 py-0.5 rounded text-[8px] font-mono transition-all ${
                rangeStart === p
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : hasLocked
                    ? 'text-red-400 border border-red-500/20 bg-red-500/5 hover:bg-red-500/10'
                    : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/20 border border-transparent'
              }`}
            >
              {p}–{end}
            </button>
          );
        })}
      </div>

      {/* Faders */}
      <div className="glass-panel p-3">
        <div className="flex gap-0.5 overflow-x-auto pb-2">
          {channels.map(ch => {
            const key = channelKey(universe, ch);
            const value = mixerState.channelValues[key] ?? 0;
            const locked = !!mixerState.lockedChannels[key];
            const fixtureInfo = channelFixtureMap.get(ch);
            return (
              <ChannelFader
                key={ch}
                channel={ch}
                value={value}
                locked={locked}
                fixtureName={fixtureInfo?.fixtureName}
                channelName={fixtureInfo?.channelName}
                onValueChange={(v) => updateValue(ch, v)}
                onToggleLock={() => toggleLock(ch)}
              />
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[8px] text-muted-foreground/50">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-primary/60" />
          <span>Normal</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-red-500/60" />
          <span>Locked (overrides scenes/programs)</span>
        </div>
      </div>
    </div>
  );
}
