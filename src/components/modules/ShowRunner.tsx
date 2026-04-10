import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, SkipForward, SkipBack, Square, Plus, ChevronRight,
  Clock, Trash2, Copy, GripVertical, ChevronDown, Settings
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCueStore, type Cue, type CueSequence } from '@/store/cueStore';

function CueTimingEditor({ cue, sequenceId }: { cue: Cue; sequenceId: string }) {
  const updateCue = useCueStore(s => s.updateCue);

  return (
    <div className="grid grid-cols-4 gap-2 p-3 border rounded-lg border-border/20 bg-muted/5">
      <div>
        <label className="text-[8px] uppercase text-muted-foreground/60 tracking-wider">Fade In</label>
        <Input type="number" step="0.1" min="0" value={cue.fadeIn}
          onChange={e => updateCue(sequenceId, cue.id, { fadeIn: parseFloat(e.target.value) || 0 })}
          className="h-7 text-[11px] mt-0.5" />
      </div>
      <div>
        <label className="text-[8px] uppercase text-muted-foreground/60 tracking-wider">Hold</label>
        <Input type="number" step="0.5" min="0" value={cue.hold}
          onChange={e => updateCue(sequenceId, cue.id, { hold: parseFloat(e.target.value) || 0 })}
          className="h-7 text-[11px] mt-0.5" />
      </div>
      <div>
        <label className="text-[8px] uppercase text-muted-foreground/60 tracking-wider">Fade Out</label>
        <Input type="number" step="0.1" min="0" value={cue.fadeOut}
          onChange={e => updateCue(sequenceId, cue.id, { fadeOut: parseFloat(e.target.value) || 0 })}
          className="h-7 text-[11px] mt-0.5" />
      </div>
      <div>
        <label className="text-[8px] uppercase text-muted-foreground/60 tracking-wider">Delay</label>
        <Input type="number" step="0.1" min="0" value={cue.delay}
          onChange={e => updateCue(sequenceId, cue.id, { delay: parseFloat(e.target.value) || 0 })}
          className="h-7 text-[11px] mt-0.5" />
      </div>
      <div className="col-span-2">
        <label className="text-[8px] uppercase text-muted-foreground/60 tracking-wider">Trigger</label>
        <Select value={cue.trigger} onValueChange={v => updateCue(sequenceId, cue.id, { trigger: v as Cue['trigger'] })}>
          <SelectTrigger className="h-7 text-[11px] mt-0.5"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">Manual (GO)</SelectItem>
            <SelectItem value="follow">Follow</SelectItem>
            <SelectItem value="time">Timed</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {cue.trigger === 'follow' && (
        <div className="col-span-2">
          <label className="text-[8px] uppercase text-muted-foreground/60 tracking-wider">Follow After (s)</label>
          <Input type="number" step="0.1" min="0" value={cue.followTime}
            onChange={e => updateCue(sequenceId, cue.id, { followTime: parseFloat(e.target.value) || 0 })}
            className="h-7 text-[11px] mt-0.5" />
        </div>
      )}
    </div>
  );
}

export function ShowRunner() {
  const {
    sequences, activeSequenceId, activeCueIndex, playbackStatus,
    setActiveSequence, go, goBack, stop, pause, resume, jumpToCue,
    addCue, removeCue, updateCue, addSequence, removeSequence,
  } = useCueStore();

  const [expandedCueId, setExpandedCueId] = useState<string | null>(null);
  const [newCueName, setNewCueName] = useState('');

  const activeSeq = sequences.find(s => s.id === activeSequenceId);
  const activeCue = activeSeq && activeCueIndex >= 0 ? activeSeq.cues[activeCueIndex] : null;

  const handleAddCue = () => {
    if (!activeSequenceId || !newCueName.trim()) return;
    const cue: Cue = {
      id: `cue-${Date.now()}`,
      name: newCueName.trim(),
      color: '#00e5ff',
      fadeIn: 2, fadeOut: 1, hold: 0, delay: 0,
      trigger: 'manual', followTime: 0,
      dmxValues: [], wledStates: [], hueStates: [], activeEffectIds: [],
    };
    addCue(activeSequenceId, cue);
    setNewCueName('');
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
      {/* Header with sequence selector */}
      <div className="flex items-center justify-between p-3 border-b border-border/30 gap-2">
        <h2 className="text-sm font-semibold tracking-wider shrink-0">CUE LIST</h2>
        <Select value={activeSequenceId || ''} onValueChange={v => setActiveSequence(v)}>
          <SelectTrigger className="h-7 text-[11px] max-w-[200px]"><SelectValue placeholder="Select sequence" /></SelectTrigger>
          <SelectContent>
            {sequences.map(s => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 shrink-0"
          onClick={() => addSequence(`Sequence ${sequences.length + 1}`)}>
          <Plus size={12} /> Seq
        </Button>
      </div>

      {/* GO Button + Transport */}
      <div className="p-4 flex flex-col items-center gap-3 border-b border-border/30">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={go}
          disabled={!activeSeq}
          className="w-28 h-28 rounded-full control-glossy border-2 border-primary/40 flex items-center justify-center text-primary font-bold text-2xl tracking-widest transition-all hover:border-primary glow-green disabled:opacity-30 disabled:cursor-not-allowed"
        >
          GO
        </motion.button>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full control-glossy border border-border/30"
            onClick={goBack} disabled={!activeSeq || activeCueIndex <= 0}>
            <SkipBack size={14} />
          </Button>
          {playbackStatus === 'playing' ? (
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full control-glossy border border-border/30"
              onClick={pause}>
              <Pause size={14} className="text-primary" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full control-glossy border border-border/30"
              onClick={playbackStatus === 'paused' ? resume : go}>
              <Play size={14} className="text-primary" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full control-glossy border border-border/30"
            onClick={stop} disabled={playbackStatus === 'stopped'}>
            <Square size={14} className="text-destructive" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full control-glossy border border-border/30"
            onClick={go} disabled={!activeSeq}>
            <SkipForward size={14} />
          </Button>
        </div>

        {/* Now playing */}
        {activeCue && (
          <div className="text-center">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Cue {activeCueIndex + 1}</div>
            <div className="text-sm font-semibold text-primary">{activeCue.name}</div>
            <div className="text-[9px] text-muted-foreground/50 flex gap-2 justify-center mt-1">
              <span>↗ {activeCue.fadeIn}s</span>
              <span>▬ {activeCue.hold || '∞'}s</span>
              <span>↘ {activeCue.fadeOut}s</span>
            </div>
          </div>
        )}

        {/* Status badge */}
        <div className={`text-[8px] uppercase tracking-widest px-3 py-1 rounded-full border ${
          playbackStatus === 'playing' ? 'bg-green-500/10 border-green-500/30 text-green-400' :
          playbackStatus === 'paused' ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' :
          'bg-muted/10 border-border/20 text-muted-foreground/50'
        }`}>
          {playbackStatus}
        </div>
      </div>

      {/* Add Cue */}
      {activeSeq && (
        <div className="flex gap-2 p-3 border-b border-border/20">
          <Input value={newCueName} onChange={e => setNewCueName(e.target.value)}
            placeholder="New cue name..." className="h-7 text-[11px] flex-1"
            onKeyDown={e => e.key === 'Enter' && handleAddCue()} />
          <Button size="sm" className="h-7 text-[10px] gap-1" onClick={handleAddCue} disabled={!newCueName.trim()}>
            <Plus size={12} /> Store
          </Button>
        </div>
      )}

      {/* Cue List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {activeSeq?.cues.map((cue, idx) => {
          const isActive = idx === activeCueIndex;
          const isDone = activeCueIndex >= 0 && idx < activeCueIndex;
          const isExpanded = expandedCueId === cue.id;

          return (
            <div key={cue.id}>
              <motion.div
                layout
                className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all cursor-pointer ${
                  isActive ? 'border-primary/40 bg-primary/5 glow-green' :
                  isDone ? 'border-border/10 bg-card/20 opacity-40' :
                  'border-border/20 bg-card/40 hover:border-border/40'
                }`}
                onClick={() => jumpToCue(idx)}
              >
                <GripVertical size={10} className="text-muted-foreground/20 shrink-0" />
                <span className="text-[10px] font-mono text-muted-foreground/50 w-5 shrink-0">{idx + 1}</span>
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{
                  backgroundColor: cue.color,
                  boxShadow: isActive ? `0 0 8px ${cue.color}` : 'none',
                }} />
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] font-medium truncate block">{cue.name}</span>
                </div>
                <span className="text-[8px] font-mono text-muted-foreground/40 shrink-0 flex items-center gap-1">
                  <Clock size={8} />
                  {cue.fadeIn}s/{cue.hold || '∞'}/{cue.fadeOut}s
                </span>
                <span className={`text-[7px] px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                  cue.trigger === 'manual' ? 'bg-blue-500/10 text-blue-400' :
                  cue.trigger === 'follow' ? 'bg-green-500/10 text-green-400' :
                  'bg-yellow-500/10 text-yellow-400'
                }`}>{cue.trigger}</span>

                {/* Expand / Actions */}
                <button onClick={e => { e.stopPropagation(); setExpandedCueId(isExpanded ? null : cue.id); }}
                  className="text-muted-foreground/30 hover:text-foreground">
                  <Settings size={10} />
                </button>
                <button onClick={e => { e.stopPropagation(); removeCue(activeSequenceId!, cue.id); }}
                  className="text-muted-foreground/20 hover:text-destructive">
                  <Trash2 size={10} />
                </button>

                {isActive && <ChevronRight size={12} className="text-primary animate-pulse shrink-0" />}
              </motion.div>

              {/* Expanded timing editor */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="pt-1 pb-2 px-1">
                      <CueTimingEditor cue={cue} sequenceId={activeSequenceId!} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
