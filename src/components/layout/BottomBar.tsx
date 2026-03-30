import { useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Ban, Music } from 'lucide-react';

export function BottomBar() {
  const { masterDimmer, setMasterDimmer, blackout, toggleBlackout } = useAppStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Simulated waveform
    const time = Date.now() / 1000;
    ctx.beginPath();
    ctx.strokeStyle = 'hsl(155, 100%, 50%)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'hsl(155, 100%, 50%)';
    ctx.shadowBlur = 6;

    for (let x = 0; x < w; x++) {
      const freq1 = Math.sin((x / w) * 8 + time * 3) * (h / 4);
      const freq2 = Math.sin((x / w) * 14 + time * 5) * (h / 8);
      const freq3 = Math.sin((x / w) * 22 + time * 2) * (h / 12);
      const y = h / 2 + freq1 + freq2 + freq3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    animRef.current = requestAnimationFrame(drawWaveform);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = canvas.offsetWidth * 2;
      canvas.height = canvas.offsetHeight * 2;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(2, 2);
    }
    drawWaveform();
    return () => cancelAnimationFrame(animRef.current);
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
        <Music size={14} className="text-muted-foreground shrink-0" />
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
