import { useEffect, useState } from 'react';
import { Monitor, ExternalLink, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PRESET_LABELS, type VisualizerPreset } from '@/lib/audioVisualizer';
import { useIOStore } from './IOSetup';
import { sendRawMessage, onEngineMessage } from '@/lib/wsSync';

/**
 * VFX Output Window — launches Chromium kiosk on the server's local display
 * via engine-server. No browser popup — renders on the machine's HDMI output.
 */

export function VfxOutputControl({ currentPreset }: { currentPreset?: VisualizerPreset }) {
  const ioStore = useIOStore();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<VisualizerPreset>(currentPreset || 'plasma-wave');

  // Listen for status updates from engine
  useEffect(() => {
    const unsub = onEngineMessage((msg: any) => {
      if (msg.type === 'vfx-window-status') {
        setIsOpen(!!msg.open);
      }
    });
    return unsub;
  }, []);

  const handleOpen = () => {
    const { resolution, display, fullscreen } = ioStore.vfxOutput;
    sendRawMessage({
      type: 'vfx-window-open',
      preset: selectedPreset,
      resolution,
      display,
      fullscreen,
    });
  };

  const handleClose = () => {
    sendRawMessage({ type: 'vfx-window-close' });
  };

  // Send preset change to engine when changed while open
  useEffect(() => {
    if (isOpen) {
      sendRawMessage({ type: 'vfx-set-preset', preset: selectedPreset });
    }
  }, [selectedPreset, isOpen]);

  return (
    <div className="glass-panel p-3 space-y-2 border-l-2" style={{ borderLeftColor: '#aa44ff' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Monitor size={12} style={{ color: '#aa44ff' }} />
          <span className="text-[9px] uppercase tracking-widest font-semibold" style={{ color: '#aa44ff' }}>
            VFX HDMI Output (Lokal)
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
        Renderas lokalt på skärm {ioStore.vfxOutput.display + 1} ({ioStore.vfxOutput.resolution}) via Chromium kiosk.
        Klicka för fullskärm. ESC för att stänga.
      </div>
    </div>
  );
}
