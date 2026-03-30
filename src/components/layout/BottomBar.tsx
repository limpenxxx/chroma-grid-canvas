import { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Ban, Mic, MicOff } from 'lucide-react';

export function BottomBar() {
  const { masterDimmer, setMasterDimmer, blackout, toggleBlackout } = useAppStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [audioActive, setAudioActive] = useState(false);

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
      // Flat line when no audio
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

  const toggleAudio = useCallback(async () => {
    if (audioActive) {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      analyserRef.current = null;
      dataArrayRef.current = null;
      setAudioActive(false);
      return;
    }
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
      setAudioActive(true);
    } catch {
      console.warn('Microphone access denied');
    }
  }, [audioActive]);

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
    <div className="h-14 border-t border-border/50 bg-[hsl(0_0%_3%)] flex items-center px-4 gap-6">
      {/* Master Dimmer */}
      <div className="flex items-center gap-3 min-w-[200px]">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Master</span>
        <Slider
          value={[blackout ? 0 : masterDimmer]}
          onValueChange={([v]) => setMasterDimmer(v)}
          max={100}
          step={1}
          className="w-28"
          disabled={blackout}
        />
        <span className="text-xs font-mono text-primary w-8 text-right">
          {blackout ? '0' : masterDimmer}%
        </span>
      </div>

      {/* Blackout */}
      <Button
        variant={blackout ? 'destructive' : 'outline'}
        size="sm"
        onClick={toggleBlackout}
        className={`text-[10px] uppercase tracking-wider font-semibold h-8 px-3 ${
          blackout ? 'glow-pink animate-pulse-glow' : ''
        }`}
      >
        <Ban size={14} />
        BO
      </Button>

      {/* Waveform */}
      <div className="flex-1 flex items-center gap-2 max-w-md">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleAudio}
          className={`h-7 w-7 p-0 shrink-0 ${audioActive ? 'text-primary' : 'text-muted-foreground'}`}
        >
          {audioActive ? <Mic size={14} /> : <MicOff size={14} />}
        </Button>
        <canvas
          ref={canvasRef}
          className="w-full h-8 rounded"
          style={{ imageRendering: 'auto' }}
        />
      </div>

      {/* Now Playing */}
      <div className="flex items-center gap-2 ml-auto">
        <div className="w-2 h-2 rounded-full bg-primary animate-pulse-glow" />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          No Media
        </span>
      </div>
    </div>
  );
}
