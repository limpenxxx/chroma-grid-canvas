import { useRef, useEffect, useCallback, useState } from 'react';
import { Monitor, Maximize2, ExternalLink, Square, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AudioVisualizerEngine, PRESET_LABELS, type VisualizerPreset } from '@/lib/audioVisualizer';
import { useIOStore } from './IOSetup';

/**
 * VFX Output Window — opens visualizer in a separate browser window
 * designed for a dedicated HDMI output (secondary GPU).
 */

let vfxWindow: Window | null = null;
let vfxEngine: AudioVisualizerEngine | null = null;

export function openVfxOutputWindow(
  preset: VisualizerPreset = 'plasma-wave',
  resolution: string = '1920x1080',
  displayIndex: number = 1,
  autoFullscreen: boolean = true
) {
  // Close existing
  if (vfxWindow && !vfxWindow.closed) {
    vfxWindow.close();
  }

  const [w, h] = resolution.split('x').map(Number);

  // Position on secondary display. On Ubuntu with X11, screen.availLeft
  // gives the offset. For display 1 we assume it's to the right of primary.
  const left = displayIndex * (window.screen.availWidth || 1920);
  const top = 0;

  vfxWindow = window.open(
    '',
    'stokio-vfx-output',
    `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes`
  );

  if (!vfxWindow) {
    console.error('[VFX OUTPUT] Popup blocked — allow popups for this site');
    return;
  }

  // Write minimal HTML
  vfxWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>STOKIO VFX Output</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; overflow: hidden; cursor: none; }
    canvas { width: 100vw; height: 100vh; display: block; }
  </style>
</head>
<body>
  <canvas id="vfx-canvas" width="${w}" height="${h}"></canvas>
</body>
</html>`);
  vfxWindow.document.close();

  // Setup engine
  const canvas = vfxWindow.document.getElementById('vfx-canvas') as HTMLCanvasElement;
  if (!canvas) return;

  vfxEngine = new AudioVisualizerEngine();
  vfxEngine.preset = preset;
  vfxEngine.start('microphone').catch(() => {});

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const animate = () => {
    if (!vfxWindow || vfxWindow.closed) {
      vfxEngine?.stop();
      vfxEngine = null;
      return;
    }
    if (vfxEngine && ctx) {
      vfxEngine.render(ctx, canvas.width, canvas.height);
    }
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);

  // Auto-fullscreen (requires user gesture in some browsers)
  if (autoFullscreen) {
    vfxWindow.document.addEventListener('click', () => {
      canvas.requestFullscreen?.().catch(() => {});
    }, { once: true });
    // Try immediately for kiosk mode
    setTimeout(() => {
      try {
        canvas.requestFullscreen?.().catch(() => {});
      } catch {}
    }, 500);
  }

  // ESC handler
  vfxWindow.document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      vfxWindow?.close();
    }
  });
}

export function setVfxOutputPreset(preset: VisualizerPreset) {
  if (vfxEngine) vfxEngine.preset = preset;
}

export function closeVfxOutputWindow() {
  if (vfxWindow && !vfxWindow.closed) vfxWindow.close();
  vfxEngine?.stop();
  vfxEngine = null;
  vfxWindow = null;
}

export function isVfxOutputOpen(): boolean {
  return !!(vfxWindow && !vfxWindow.closed);
}

/**
 * Inline UI control panel for VFX Output (used in I/O Setup or Live DJ)
 */
export function VfxOutputControl({ currentPreset }: { currentPreset?: VisualizerPreset }) {
  const ioStore = useIOStore();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<VisualizerPreset>(currentPreset || 'plasma-wave');

  useEffect(() => {
    const check = setInterval(() => {
      setIsOpen(isVfxOutputOpen());
    }, 1000);
    return () => clearInterval(check);
  }, []);

  const handleOpen = () => {
    const { resolution, display, fullscreen } = ioStore.vfxOutput;
    openVfxOutputWindow(selectedPreset, resolution, display, fullscreen);
    setIsOpen(true);
  };

  const handleClose = () => {
    closeVfxOutputWindow();
    setIsOpen(false);
  };

  useEffect(() => {
    if (isOpen) setVfxOutputPreset(selectedPreset);
  }, [selectedPreset, isOpen]);

  return (
    <div className="glass-panel p-3 space-y-2 border-l-2" style={{ borderLeftColor: '#aa44ff' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Monitor size={12} style={{ color: '#aa44ff' }} />
          <span className="text-[9px] uppercase tracking-widest font-semibold" style={{ color: '#aa44ff' }}>
            VFX HDMI Output
          </span>
        </div>
        <div className={`flex items-center gap-1 text-[8px] ${isOpen ? 'text-green-400' : 'text-muted-foreground/40'}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground/30'}`} />
          {isOpen ? 'LIVE' : 'Stängd'}
        </div>
      </div>

      <div className="flex gap-2">
        <select
          value={selectedPreset}
          onChange={(e) => setSelectedPreset(e.target.value as VisualizerPreset)}
          className="flex-1 h-7 rounded bg-muted/30 border border-border/30 text-[9px] px-2 text-foreground"
        >
          {Object.entries(PRESET_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {!isOpen ? (
          <Button size="sm" className="h-7 text-[9px] gap-1" onClick={handleOpen}>
            <ExternalLink size={10} /> Öppna Output
          </Button>
        ) : (
          <Button variant="destructive" size="sm" className="h-7 text-[9px] gap-1" onClick={handleClose}>
            <Square size={10} /> Stäng
          </Button>
        )}
      </div>

      <div className="text-[7px] text-muted-foreground/40">
        Öppnas på skärm {ioStore.vfxOutput.display + 1} ({ioStore.vfxOutput.resolution}). 
        Klicka i fönstret för fullskärm. ESC för att stänga.
      </div>
    </div>
  );
}
