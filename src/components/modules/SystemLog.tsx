import { useState, useRef, useEffect, useMemo } from 'react';
import { useLogStore, type LogLevel } from '@/store/logStore';
import { Trash2, Download, ArrowDown, Pause, Play, Filter, RotateCcw, Server, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { engineRequest } from '@/lib/wsSync';
import { toast } from 'sonner';

const LEVEL_COLORS: Record<LogLevel, string> = {
  info: 'text-blue-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
  debug: 'text-muted-foreground',
  dmx: 'text-emerald-400',
  wled: 'text-orange-400',
  ai: 'text-violet-400',
};

const LEVEL_BG: Record<LogLevel, string> = {
  info: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  warn: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  error: 'bg-red-500/20 text-red-300 border-red-500/30',
  debug: 'bg-muted/30 text-muted-foreground border-border/30',
  dmx: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  wled: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  ai: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
};

const ALL_LEVELS: LogLevel[] = ['info', 'warn', 'error', 'debug', 'dmx', 'wled', 'ai'];

export function SystemLog() {
  const { entries, clearLogs } = useLogStore();
  const [filter, setFilter] = useState('');
  const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(new Set(ALL_LEVELS));
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [restarting, setRestarting] = useState<string | null>(null);

  const SERVICES = [
    { id: 'chroma-engine', label: 'Engine', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20' },
    { id: 'chroma-frontend', label: 'Frontend', color: 'text-blue-400 border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20' },
    { id: 'avahi-daemon', label: 'mDNS (Avahi)', color: 'text-purple-400 border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20' },
  ];

  const restartService = async (serviceId: string) => {
    setRestarting(serviceId);
    try {
      const result = await engineRequest<{ success: boolean; error?: string }>(
        { type: 'restart-service', service: serviceId },
        'restart-service-result',
        20000,
      );
      if (result.success) {
        toast.success(`${serviceId} omstartad`);
      } else {
        toast.error(`Misslyckades: ${result.error}`);
      }
    } catch (err: any) {
      toast.error(`Kunde inte nå engine: ${err.message}`);
    } finally {
      setRestarting(null);
    }
  };

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return entries.filter((e) => {
      if (!activeLevels.has(e.level)) return false;
      if (q && !e.message.toLowerCase().includes(q) && !e.source.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, filter, activeLevels]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  const toggleLevel = (lvl: LogLevel) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      return next;
    });
  };

  const exportLogs = () => {
    const text = filtered
      .map((e) => {
        const t = new Date(e.ts).toISOString();
        const d = e.data ? ` | ${JSON.stringify(e.data)}` : '';
        return `[${t}] [${e.level.toUpperCase()}] [${e.source}] ${e.message}${d}`;
      })
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stokio-log-${new Date().toISOString().slice(0, 19)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col gap-2 p-3">
      {/* Service Controls */}
      <div className="glass-panel p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Server size={12} className="text-primary" />
          <span className="text-[9px] uppercase tracking-widest text-primary font-semibold">Service Control</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {SERVICES.map((svc) => (
            <Button
              key={svc.id}
              variant="outline"
              size="sm"
              className={`h-7 text-[10px] gap-1.5 border ${svc.color}`}
              disabled={restarting !== null}
              onClick={() => restartService(svc.id)}
            >
              {restarting === svc.id ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <RotateCcw size={11} />
              )}
              {svc.label}
            </Button>
          ))}
        </div>
        <p className="text-[8px] text-muted-foreground/50">
          Kräver att engine körs som systemd-tjänst med sudo-behörighet för systemctl restart.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <Filter size={12} className="text-muted-foreground" />
          {ALL_LEVELS.map((lvl) => (
            <button
              key={lvl}
              onClick={() => toggleLevel(lvl)}
              className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold border transition-all ${
                activeLevels.has(lvl) ? LEVEL_BG[lvl] : 'bg-muted/10 text-muted-foreground/30 border-transparent'
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>

        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search logs..."
          className="h-7 text-xs w-48 bg-muted/20"
        />

        <div className="flex-1" />

        <Badge variant="outline" className="text-[9px] font-mono">
          {filtered.length} / {entries.length}
        </Badge>

        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setAutoScroll(!autoScroll)}>
          {autoScroll ? <ArrowDown size={12} className="text-primary" /> : <Pause size={12} className="text-muted-foreground" />}
        </Button>

        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={exportLogs} title="Export logs">
          <Download size={12} />
        </Button>

        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={clearLogs} title="Clear logs">
          <Trash2 size={12} />
        </Button>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto font-mono text-[10px] leading-relaxed bg-black/40 rounded-lg border border-border/20 p-2 space-y-px"
      >
        {filtered.length === 0 ? (
          <div className="text-muted-foreground/40 text-center py-8 text-xs">
            No log entries yet. System events will appear here.
          </div>
        ) : (
          filtered.map((e) => (
            <div key={e.id} className="flex gap-2 hover:bg-muted/10 px-1 rounded group">
              <span className="text-muted-foreground/40 shrink-0">
                {new Date(e.ts).toLocaleTimeString('sv-SE', { hour12: false })}.{Math.floor((e.ts % 1000) / 100)}
              </span>
              <span className={`uppercase font-bold w-[38px] shrink-0 ${LEVEL_COLORS[e.level]}`}>
                {e.level}
              </span>
              <span className="text-muted-foreground/60 shrink-0 w-[100px] truncate">{e.source}</span>
              <span className="text-foreground/80 flex-1">{e.message}</span>
              {e.data && (
                <span className="text-muted-foreground/30 truncate max-w-[200px] opacity-0 group-hover:opacity-100 transition-opacity">
                  {JSON.stringify(e.data)}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
