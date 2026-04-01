import { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore, type LayoutMode } from '@/store/appStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Ban, Mic, MicOff, Monitor, MonitorSmartphone, Tablet, MonitorDot } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type AudioMode = 'none' | 'mic' | 'system';

export function BottomBar({ compact = false }: { compact?: boolean }) {
  const { masterDimmer, setMasterDimmer, blackout, toggleBlackout, layoutMode, setLayoutMode } = useAppStore();
  const isNarrowViewport = useIsMobile();
  const compactView = compact || isNarrowViewport;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [audioMode, setAudioMode] = useState<AudioMode>('none');
  const [sourceName, setSourceName] = useState('No Media');

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width / 2;
    const h = canvas.height / 2;
    ctx.clearRect(0, 0, w, h);

    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;

    if (analyser && dataArray) {
      analyser.getByteTimeDomainData(dataArray as unknown as Uint8Array<ArrayBuffer>);
      ctx.beginPath();
      ctx.strokeStyle = 'hsl(155, 100%, 50%)';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = 'hsl(155, 100%, 50%)';
      ctx.shadowBlur = 6;

      const sliceWidth = w / dataArray.length;
      let x = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * h) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      ctx.beginPath();
      ctx.strokeStyle = 'hsl(155, 100%, 50%)';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.3;
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    animRef.current = requestAnimationFrame(drawWaveform);
  }, []);

  const stopAudio = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    dataArrayRef.current = null;
    setAudioMode('none');
    setSourceName('No Media');
  }, []);

  const startMic = useCallback(async () => {
    stopAudio();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      setAudioMode('mic');
      setSourceName('Microphone');
    } catch {
      console.warn('Microphone access denied');
    }
  }, [stopAudio]);

  const startSystemAudio = useCallback(async () => {
    stopAudio();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1, height: 1 },
        audio: true,
      } as DisplayMediaStreamOptions);
      stream.getVideoTracks().forEach(t => t.stop());
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) { console.warn('No audio track'); return; }
      streamRef.current = stream;
      const label = audioTracks[0].label || 'System Audio';
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(new MediaStream(audioTracks));
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      setAudioMode('system');
      setSourceName(label);
      audioTracks[0].onended = () => stopAudio();
    } catch {
      console.warn('System audio capture denied');
    }
  }, [stopAudio]);

  const toggleAudio = useCallback(async () => {
    if (audioMode === 'mic') { stopAudio(); return; }
    if (audioMode === 'system') { stopAudio(); return; }
    await startMic();
  }, [audioMode, stopAudio, startMic]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = canvas.offsetWidth * 2;
      canvas.height = canvas.offsetHeight * 2;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(2, 2);
    }
    drawWaveform();
    return () => {
      cancelAnimationFrame(animRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [drawWaveform]);

  return (
    <div className={`border-t border-border/50 bg-[hsl(0_0%_3%)] flex items-center ${
      compactView ? 'h-11 px-2 gap-2' : 'h-14 px-4 gap-6'
    }`}>
      {/* Master Dimmer */}
      <div className={`flex items-center gap-2 shrink-0 ${compactView ? 'min-w-0' : 'min-w-[200px] gap-3'}`}>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Master</span>
        <Slider
          value={[blackout ? 0 : masterDimmer]}
          onValueChange={([v]) => setMasterDimmer(v)}
          max={100}
          step={1}
          className={compactView ? 'w-14' : 'w-28'}
          disabled={blackout}
        />
        <span className="text-xs font-mono text-primary w-8 text-right">
          {blackout ? '0' : masterDimmer}%
        </span>
      </div>

      <Button
        variant={blackout ? 'destructive' : 'outline'}
        size="sm"
        onClick={toggleBlackout}
        className={`text-[10px] uppercase tracking-wider font-semibold h-8 px-3 shrink-0 ${
          blackout ? 'glow-pink animate-pulse-glow' : ''
        }`}
      >
        <Ban size={14} />
        BO
      </Button>

      {!compactView && (
        <div className="flex-1 flex items-center gap-2 max-w-md">
          <Button variant="ghost" size="sm" onClick={toggleAudio}
            className={`h-7 w-7 p-0 shrink-0 ${audioMode === 'mic' ? 'text-primary' : 'text-muted-foreground'}`}
            title="Microphone">
            {audioMode === 'mic' ? <Mic size={14} /> : <MicOff size={14} />}
          </Button>
          <Button variant="ghost" size="sm" onClick={startSystemAudio}
            className={`h-7 w-7 p-0 shrink-0 ${audioMode === 'system' ? 'text-primary' : 'text-muted-foreground'}`}
            title="System Audio">
            <Monitor size={14} />
          </Button>
          <canvas ref={canvasRef} className="w-full h-8 rounded" style={{ imageRendering: 'auto' }} />
        </div>
      )}

      {compactView && <div className="flex-1" />}

      <div className={`flex items-center gap-1 shrink-0 ${!compactView ? 'border-l border-border/30 pl-3 ml-2' : ''}`}>
        {([
          { mode: 'desktop' as LayoutMode, icon: MonitorDot, label: 'Desktop' },
          { mode: 'tablet' as LayoutMode, icon: Tablet, label: 'Tablet' },
          { mode: 'mobile' as LayoutMode, icon: MonitorSmartphone, label: 'Mobile' },
        ]).map(({ mode, icon: Icon, label }) => (
          <Tooltip key={mode}>
            <TooltipTrigger asChild>
              <button onClick={() => setLayoutMode(mode)}
                className={`p-1.5 rounded-md transition-all ${
                  layoutMode === mode
                    ? 'text-primary bg-primary/10 border border-primary/30'
                    : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/20'
                }`}>
                <Icon size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="glass-panel-strong text-[10px]">{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      {!compactView && (
        <div className="flex items-center gap-2 ml-auto">
          <div className={`w-2 h-2 rounded-full ${audioMode !== 'none' ? 'bg-primary animate-pulse-glow' : 'bg-muted-foreground/30'}`} />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider truncate max-w-[150px]">
            {sourceName}
          </span>
        </div>
      )}
    </div>
  );
}
