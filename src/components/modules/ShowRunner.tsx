import { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, SkipForward, Plus, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Cue {
  id: string;
  name: string;
  duration: string;
  color: string;
  status: 'idle' | 'active' | 'done';
}

const MOCK_CUES: Cue[] = [
  { id: '1', name: 'Intro — House Lights Down', duration: '5s', color: '#00e5ff', status: 'done' },
  { id: '2', name: 'Scene 1 — Fire Wave', duration: '30s', color: '#ff2d78', status: 'active' },
  { id: '3', name: 'Scene 2 — Ocean Cascade', duration: '45s', color: '#00e5ff', status: 'idle' },
  { id: '4', name: 'Scene 3 — Strobe Burst', duration: '15s', color: '#ffffff', status: 'idle' },
  { id: '5', name: 'Scene 4 — Rainbow Sweep', duration: '60s', color: '#00ff66', status: 'idle' },
  { id: '6', name: 'Finale — Full White Out', duration: '10s', color: '#ffffff', status: 'idle' },
  { id: '7', name: 'Blackout', duration: '3s', color: '#333333', status: 'idle' },
];

export function ShowRunner() {
  const [cues, setCues] = useState<Cue[]>(MOCK_CUES);
  const [isRunning, setIsRunning] = useState(true);

  const activeIndex = cues.findIndex(c => c.status === 'active');

  const goNext = () => {
    setCues(prev => prev.map((c, i) => ({
      ...c,
      status: i === activeIndex ? 'done' : i === activeIndex + 1 ? 'active' : c.status,
    })));
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-border/30">
        <h2 className="text-sm font-semibold tracking-wider">SHOW RUNNER</h2>
        <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1">
          <Plus size={12} /> Add Cue
        </Button>
      </div>

      {/* GO Button */}
      <div className="p-6 flex flex-col items-center gap-4 border-b border-border/30">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={goNext}
          className="w-32 h-32 rounded-full control-glossy border-2 border-primary/40 flex items-center justify-center text-primary font-bold text-2xl tracking-widest transition-all hover:border-primary glow-green"
        >
          GO
        </motion.button>
        <div className="flex gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full control-glossy border border-border/30"
            onClick={() => setIsRunning(!isRunning)}
          >
            {isRunning ? <Pause size={16} className="text-primary" /> : <Play size={16} className="text-primary" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full control-glossy border border-border/30"
            onClick={goNext}
          >
            <SkipForward size={16} />
          </Button>
        </div>
        {activeIndex >= 0 && (
          <div className="text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Now Playing</div>
            <div className="text-sm font-semibold text-primary">{cues[activeIndex].name}</div>
          </div>
        )}
      </div>

      {/* Cue List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {cues.map((cue, idx) => (
          <motion.div
            key={cue.id}
            layout
            className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
              cue.status === 'active'
                ? 'border-primary/40 bg-primary/5 glow-green'
                : cue.status === 'done'
                ? 'border-border/10 bg-card/20 opacity-50'
                : 'border-border/20 bg-card/40'
            }`}
          >
            <span className="text-[10px] font-mono text-muted-foreground w-6">{idx + 1}</span>
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cue.color, boxShadow: cue.status === 'active' ? `0 0 8px ${cue.color}` : 'none' }} />
            <div className="flex-1">
              <span className="text-xs font-medium">{cue.name}</span>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground">{cue.duration}</span>
            {cue.status === 'active' && (
              <ChevronRight size={14} className="text-primary animate-pulse" />
            )}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
