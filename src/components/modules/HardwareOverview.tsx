import { useState, useEffect, useCallback } from 'react';
import {
  Monitor, Cpu, HardDrive, Wifi, Usb, Music, Volume2,
  RefreshCw, Loader2, Activity, Server, Network, Cable
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { engineRequest, onEngineMessage, isEngineConnected, onEngineConnect } from '@/lib/wsSync';
import { useWledStore } from '@/store/wledStore';
import { useHueStore } from '@/store/hueStore';

interface SystemInfo {
  hostname: string;
  cpuModel: string;
  totalMemMb: number;
  uptimeSec: number;
  platform: string;
  arch: string;
}

interface NicInfo {
  name: string;
  address: string;
  mac: string;
  internal: boolean;
  operstate?: string;
}

interface UsbSerial {
  path: string;
  name: string;
  vendor: string;
  product: string;
  adapterType: string;
}

interface UsbDevice {
  bus: string;
  device: string;
  id: string;
  name: string;
}

interface MidiDevice {
  port: number;
  name: string;
  open?: boolean;
}

interface AudioDevice {
  id: string;
  name: string;
  label: string;
}

interface HwScanResult {
  system: SystemInfo;
  nics: NicInfo[];
  usbSerialPorts: UsbSerial[];
  usbDevices: UsbDevice[];
  midiDevices: MidiDevice[];
  midiAvailable: boolean;
  audioDevices: AudioDevice[];
  audioAvailable: boolean;
  wledCount: number;
  hueBridgeCount: number;
  magicDeviceCount: number;
  dmxUniverses: number[];
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Section({ icon: Icon, title, count, children }: {
  icon: React.ElementType; title: string; count?: number; children: React.ReactNode;
}) {
  return (
    <div className="glass-panel p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Icon size={12} className="text-primary" />
        <span className="text-[9px] uppercase tracking-widest text-primary font-semibold flex-1">{title}</span>
        {count !== undefined && (
          <Badge variant="outline" className="text-[8px] font-mono h-4 px-1.5">{count}</Badge>
        )}
      </div>
      {children}
    </div>
  );
}

function DeviceRow({ icon: Icon, label, sublabel, status, statusColor }: {
  icon: React.ElementType; label: string; sublabel?: string; status?: string; statusColor?: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/10 text-[10px]">
      <Icon size={11} className="text-muted-foreground shrink-0" />
      <span className="flex-1 truncate text-foreground/80">{label}</span>
      {sublabel && <span className="text-muted-foreground/50 text-[9px] shrink-0">{sublabel}</span>}
      {status && (
        <Badge variant="outline" className={`text-[7px] h-3.5 px-1 ${statusColor || ''}`}>{status}</Badge>
      )}
    </div>
  );
}

export function HardwareOverview() {
  const [data, setData] = useState<HwScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<number | null>(null);

  const wledDevices = useWledStore((s) => s.devices);
  const hueBridges = useHueStore((s) => s.bridges);

  const doScan = useCallback(async () => {
    if (!isEngineConnected()) return;
    setScanning(true);
    try {
      const result = await engineRequest<HwScanResult>(
        { type: 'hw-scan' }, 'hw-scan-result', 10000
      );
      setData(result);
      setLastScan(Date.now());
    } catch {
      // engine not reachable
    } finally {
      setScanning(false);
    }
  }, []);

  // Scan on mount + when engine connects
  useEffect(() => {
    doScan();
    const unsub = onEngineConnect(() => { setTimeout(doScan, 500); });
    return unsub;
  }, [doScan]);

  // Listen for push hw-change events from engine
  useEffect(() => {
    return onEngineMessage((msg: any) => {
      if (msg.type === 'hw-changed') {
        doScan();
      }
    });
  }, [doScan]);

  if (!data && !scanning) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-6">
        <Monitor size={32} className="text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground/50">Anslut till engine för att se hårdvaruöversikt</p>
        <Button variant="outline" size="sm" onClick={doScan}>
          <RefreshCw size={12} className="mr-1.5" /> Skanna
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-2 p-3 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <Monitor size={14} className="text-primary" />
        <span className="text-[10px] uppercase tracking-widest text-primary font-bold flex-1">Hårdvaruöversikt</span>
        {lastScan && (
          <span className="text-[8px] text-muted-foreground/40">
            Skannad {new Date(lastScan).toLocaleTimeString('sv-SE', { hour12: false })}
          </span>
        )}
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={doScan} disabled={scanning}>
          {scanning ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </Button>
      </div>

      {data && (
        <>
          {/* System Info */}
          <Section icon={Server} title="System">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] px-2">
              <span className="text-muted-foreground/60">Hostname</span>
              <span className="text-foreground/80 font-mono">{data.system.hostname}</span>
              <span className="text-muted-foreground/60">CPU</span>
              <span className="text-foreground/80 font-mono text-[9px]">{data.system.cpuModel}</span>
              <span className="text-muted-foreground/60">RAM</span>
              <span className="text-foreground/80 font-mono">{data.system.totalMemMb} MB</span>
              <span className="text-muted-foreground/60">Uptime</span>
              <span className="text-foreground/80 font-mono">{formatUptime(data.system.uptimeSec)}</span>
              <span className="text-muted-foreground/60">Platform</span>
              <span className="text-foreground/80 font-mono">{data.system.platform} / {data.system.arch}</span>
            </div>
          </Section>

          {/* NICs */}
          <Section icon={Network} title="Nätverkskort" count={data.nics.length}>
            {data.nics.length === 0 ? (
              <p className="text-[9px] text-muted-foreground/40 px-2">Inga nätverkskort hittade</p>
            ) : (
              data.nics.map((nic, i) => (
                <DeviceRow
                  key={i}
                  icon={Wifi}
                  label={nic.name}
                  sublabel={nic.address || nic.mac || 'Ingen IP'}
                  status={nic.operstate === 'up' || nic.address ? 'UP' : 'DOWN'}
                  statusColor={nic.operstate === 'up' || nic.address
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-red-500/20 text-red-300 border-red-500/30'}
                />
              ))
            )}
          </Section>

          {/* USB Devices */}
          <Section icon={Usb} title="USB-enheter" count={data.usbDevices.length}>
            {data.usbDevices.length === 0 ? (
              <p className="text-[9px] text-muted-foreground/40 px-2">Inga USB-enheter hittade</p>
            ) : (
              data.usbDevices.map((dev, i) => (
                <DeviceRow key={i} icon={Usb} label={dev.name} sublabel={dev.id} />
              ))
            )}
          </Section>

          {/* USB-DMX Adapters */}
          {data.usbSerialPorts.length > 0 && (
            <Section icon={Cable} title="DMX USB-adaptrar" count={data.usbSerialPorts.length}>
              {data.usbSerialPorts.map((port, i) => (
                <DeviceRow
                  key={i}
                  icon={Cable}
                  label={port.path}
                  sublabel={port.adapterType}
                  status="ANSLUTEN"
                  statusColor="bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                />
              ))}
            </Section>
          )}

          {/* MIDI */}
          <Section icon={Music} title="MIDI-enheter" count={data.midiDevices.length}>
            {!data.midiAvailable ? (
              <p className="text-[9px] text-muted-foreground/40 px-2">node-midi ej installerat på engine</p>
            ) : data.midiDevices.length === 0 ? (
              <p className="text-[9px] text-muted-foreground/40 px-2">Inga MIDI-enheter anslutna</p>
            ) : (
              data.midiDevices.map((dev, i) => (
                <DeviceRow
                  key={i}
                  icon={Music}
                  label={dev.name}
                  sublabel={`Port ${dev.port}`}
                  status={dev.open ? 'ÖPPEN' : 'STÄNGD'}
                  statusColor={dev.open
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-muted/30 text-muted-foreground border-border/30'}
                />
              ))
            )}
          </Section>

          {/* Audio */}
          <Section icon={Volume2} title="Ljudkort" count={data.audioDevices.length}>
            {data.audioDevices.length === 0 ? (
              <p className="text-[9px] text-muted-foreground/40 px-2">Inga ljudkort hittade</p>
            ) : (
              data.audioDevices.map((dev, i) => (
                <DeviceRow key={i} icon={Volume2} label={dev.name} sublabel={dev.id} />
              ))
            )}
          </Section>

          {/* Lighting Devices Summary */}
          <Section icon={Activity} title="Ljusenheter">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] px-2">
              <span className="text-muted-foreground/60">WLED-noder</span>
              <span className="text-foreground/80 font-mono">
                {wledDevices.length} ({wledDevices.filter(d => d.online).length} online)
              </span>
              <span className="text-muted-foreground/60">Hue-bryggor</span>
              <span className="text-foreground/80 font-mono">{hueBridges.length}</span>
              <span className="text-muted-foreground/60">MagicHome</span>
              <span className="text-foreground/80 font-mono">{data.magicDeviceCount}</span>
              <span className="text-muted-foreground/60">DMX Universum</span>
              <span className="text-foreground/80 font-mono">
                {data.dmxUniverses.length > 0 ? data.dmxUniverses.join(', ') : 'Inga'}
              </span>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
