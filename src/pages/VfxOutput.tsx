import { useRef, useEffect, useState } from 'react';
import { AudioVisualizerEngine, PRESET_LABELS, type VisualizerPreset } from '@/lib/audioVisualizer';

/**
 * Standalone fullscreen VFX output page.
 * Launched by engine-server in Chromium kiosk mode on a specific DISPLAY.
 * Listens for preset changes via WebSocket from the engine.
 */
export default function VfxOutput() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AudioVisualizerEngine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [preset, setPreset] = useState<VisualizerPreset>(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('preset') as VisualizerPreset) || 'plasma-wave';
  });

  // Connect to engine WS for preset updates
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const engineHost = params.get('engine') || window.location.hostname;
    const enginePort = params.get('port') || '9100';
    const wsUrl = `ws://${engineHost}:${enginePort}`;

    function connect() {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'vfx-preset' && msg.preset) {
            setPreset(msg.preset as VisualizerPreset);
          }
          if (msg.type === 'vfx-close') {
            window.close();
          }
        } catch {}
      };

      ws.onclose = () => {
        setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => { wsRef.current?.close(); };
  }, []);

  // Visualizer engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new AudioVisualizerEngine();
    engineRef.current = engine;
    engine.preset = preset;
    engine.start('microphone').catch(() => {});

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    let running = true;
    const animate = () => {
      if (!running) return;
      engine.render(ctx!, canvas!.width, canvas!.height);
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);

    return () => {
      running = false;
      engine.stop();
      window.removeEventListener('resize', resize);
    };
  }, []);

  // Update preset on engine when it changes
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.preset = preset;
    }
  }, [preset]);

  // Auto-fullscreen on click
  useEffect(() => {
    const handler = () => {
      document.documentElement.requestFullscreen?.().catch(() => {});
    };
    document.addEventListener('click', handler, { once: true });
    // Try immediately
    setTimeout(() => {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }, 500);
    return () => document.removeEventListener('click', handler);
  }, []);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <div style={{ margin: 0, padding: 0, background: '#000', overflow: 'hidden', cursor: 'none', width: '100vw', height: '100vh' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100vw', height: '100vh' }} />
    </div>
  );
}
