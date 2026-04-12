import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Trash2, RefreshCw, Wifi, Usb, Monitor, Save, AlertTriangle, Network
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { onEngineStatus, type EngineStatus, broadcastState, isSyncingFromRemote, onSyncState, sendRawMessage } from '@/lib/wsSync';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { VfxOutputControl } from './VfxOutputWindow';

// ── Types ──

export interface NetworkInterface {
  name: string;
  address: string;
  mac: string;
  internal: boolean;
  operstate?: string; // 'up' | 'down' | 'unknown' — from /sys/class/net
}

export type NicRole = 'system' | 'artnet' | 'sacn' | 'none';
export const NIC_ROLE_OPTIONS: { value: NicRole; label: string; description: string; color: string }[] = [
  { value: 'system', label: 'System (Huvud)', description: 'STOKIO, WLED, Hue, internet', color: '#00e5ff' },
  { value: 'artnet', label: 'ArtNet DMX',     description: 'Dedicerad DMX-trafik (UDP 6454)', color: '#ff6600' },
  { value: 'sacn',   label: 'sACN / E1.31',   description: 'Dedicerad sACN-trafik (UDP 5568)', color: '#00cc88' },
  { value: 'none',   label: 'Ej tilldelad',   description: 'Inte aktiv', color: '#666666' },
];

export type OutputProtocol = 'artnet' | 'sacn' | 'usb-dmx' | 'ddp';
export type OutputDirection = 'output' | 'input' | 'input+output';
export type UsbAdapterType = 'enttec-open' | 'enttec-pro' | 'udmx' | 'dmxking' | 'eurolite-dmx' | 'ch340-dmx';

export interface IOOutput {
  id: string;
  universe: number;
  protocol: OutputProtocol;
  direction: OutputDirection;
  enabled: boolean;
  // Network
  bindInterface?: string; // NIC name or IP to bind ArtNet/sACN
  targetIp?: string;      // unicast target or 'broadcast'
  // USB
  usbType?: UsbAdapterType;
  usbPort?: string;       // serial port path
  usbConnected?: boolean;
  // Label
  label?: string;
}

export interface VfxOutputConfig {
  enabled: boolean;
  display: number; // screen index (0=primary, 1=secondary, etc.)
  resolution: string; // e.g. '1920x1080'
  fullscreen: boolean;
}

interface IOState {
  outputs: IOOutput[];
  networkInterfaces: NetworkInterface[];
  nicRoles: Record<string, NicRole>; // NIC name → role
  vfxOutput: VfxOutputConfig;
  addOutput: (o: IOOutput) => void;
  updateOutput: (id: string, patch: Partial<IOOutput>) => void;
  removeOutput: (id: string) => void;
  setNetworkInterfaces: (nics: NetworkInterface[]) => void;
  setNicRole: (nicName: string, role: NicRole) => void;
  setVfxOutput: (patch: Partial<VfxOutputConfig>) => void;
}

export const useIOStore = create<IOState>()(
  persist(
    (set, get) => ({
      outputs: [
        {
          id: 'default-artnet-1',
          universe: 1,
          protocol: 'artnet',
          direction: 'output',
          enabled: true,
          bindInterface: 'all',
          targetIp: 'broadcast',
          label: 'ArtNet Universe 1',
        },
      ],
      networkInterfaces: [],
      nicRoles: {},
      vfxOutput: {
        enabled: false,
        display: 1,
        resolution: '1920x1080',
        fullscreen: true,
      },
      addOutput: (o) => set((s) => ({ outputs: [...s.outputs, o] })),
      updateOutput: (id, patch) =>
        set((s) => ({ outputs: s.outputs.map((o) => (o.id === id ? { ...o, ...patch } : o)) })),
      removeOutput: (id) => set((s) => ({ outputs: s.outputs.filter((o) => o.id !== id) })),
      setNetworkInterfaces: (nics) => set({ networkInterfaces: nics }),
      setNicRole: (nicName, role) => {
        set((s) => {
          const newRoles = { ...s.nicRoles, [nicName]: role };
          // Send to engine
          sendRawMessage({ type: 'nic-roles', roles: newRoles });
          // Auto-bind outputs to the appropriate NIC based on roles
          const nic = s.networkInterfaces.find(n => n.name === nicName);
          const nicAddr = nic?.address || nicName;
          let updatedOutputs = s.outputs;
          if (role === 'artnet') {
            updatedOutputs = updatedOutputs.map(o => 
              o.protocol === 'artnet' ? { ...o, bindInterface: nicAddr } : o
            );
          } else if (role === 'sacn') {
            updatedOutputs = updatedOutputs.map(o => 
              o.protocol === 'sacn' ? { ...o, bindInterface: nicAddr } : o
            );
          }
          return { nicRoles: newRoles, outputs: updatedOutputs };
        });
      },
      setVfxOutput: (patch) => set((s) => ({ vfxOutput: { ...s.vfxOutput, ...patch } })),
    }),
    {
      name: 'stokio-io-v1',
      partialize: (s) => ({
        outputs: s.outputs,
        nicRoles: s.nicRoles,
        vfxOutput: s.vfxOutput,
        // Don't persist networkInterfaces — they come from engine
      }),
    }
  )
);

// ── Sync to engine (only outputs/vfx changes, NOT nic list updates) ──
let _lastOutputsJson = '';
let _lastVfxJson = '';
useIOStore.subscribe((state) => {
  if (isSyncingFromRemote()) return;
  const outputsJson = JSON.stringify(state.outputs);
  const vfxJson = JSON.stringify(state.vfxOutput);
  const outputsChanged = outputsJson !== _lastOutputsJson;
  const vfxChanged = vfxJson !== _lastVfxJson;
  if (!outputsChanged && !vfxChanged) return;
  _lastOutputsJson = outputsJson;
  _lastVfxJson = vfxJson;
  broadcastState('io', {
    outputs: state.outputs,
    vfxOutput: state.vfxOutput,
  });
  if (outputsChanged) {
    sendRawMessage({ type: 'io-config', outputs: state.outputs });
  }
});

onSyncState((incoming) => {
  const io = incoming.io as Record<string, unknown> | undefined;
  if (io) {
    if (io.outputs) useIOStore.setState({ outputs: io.outputs as IOOutput[] });
    if (io.vfxOutput) useIOStore.setState({ vfxOutput: io.vfxOutput as VfxOutputConfig });
  }
});

const USB_ADAPTER_LABELS: Record<UsbAdapterType, string> = {
  'enttec-open': 'Enttec Open DMX USB',
  'enttec-pro': 'Enttec DMX USB Pro',
  'udmx': 'uDMX (Anyma)',
  'dmxking': 'DMXking ultraDMX',
  'eurolite-dmx': 'Eurolite USB-DMX512 PRO',
  'ch340-dmx': 'CH340 USB-DMX',
};

const PROTOCOL_COLORS: Record<OutputProtocol, string> = {
  artnet: '#ff6600',
  sacn: '#00cc88',
  'usb-dmx': '#00e5ff',
  ddp: '#aa44ff',
};

interface DetectedUsbPort {
  path: string;
  name: string;
  vendor: string;
  product: string;
  serial: string;
  adapterType: string;
}

const USB_TYPE_FROM_DETECTED: Record<string, UsbAdapterType> = {
  'enttec-open': 'enttec-open',
  'enttec-pro': 'enttec-pro',
  'ftdi-generic': 'eurolite-dmx',
  'udmx': 'udmx',
  'dmxking': 'dmxking',
  'eurolite-dmx': 'eurolite-dmx',
  'ch340-dmx': 'ch340-dmx',
  'ch340-generic': 'ch340-dmx',
};

export function IOSetup() {
  const store = useIOStore();
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [detectedUsbPorts, setDetectedUsbPorts] = useState<DetectedUsbPort[]>([]);
  const [addingOutput, setAddingOutput] = useState(false);
  const [newProtocol, setNewProtocol] = useState<OutputProtocol>('artnet');
  const [newUniverse, setNewUniverse] = useState(1);
  const [newBindIface, setNewBindIface] = useState('all');
  const [newUsbType, setNewUsbType] = useState<UsbAdapterType>('enttec-pro');

  useEffect(() => {
    return onEngineStatus(setEngineStatus);
  }, []);

  // Parse NIC list and USB ports from engine status
  useEffect(() => {
    if (engineStatus) {
      if ((engineStatus as any).networkInterfaces) {
        store.setNetworkInterfaces((engineStatus as any).networkInterfaces);
      }
      if ((engineStatus as any).usbSerialPorts) {
        setDetectedUsbPorts((engineStatus as any).usbSerialPorts);
      }
    }
  }, [engineStatus]);

  const addNewOutput = () => {
    const id = `io-${Date.now()}`;
    const isUsb = newProtocol === 'usb-dmx';
    store.addOutput({
      id,
      universe: newUniverse,
      protocol: newProtocol,
      direction: 'output',
      enabled: true,
      bindInterface: isUsb ? undefined : newBindIface,
      targetIp: isUsb ? undefined : 'broadcast',
      usbType: isUsb ? newUsbType : undefined,
      label: isUsb
        ? `${USB_ADAPTER_LABELS[newUsbType]} Uni ${newUniverse}`
        : `${newProtocol.toUpperCase()} Universe ${newUniverse}`,
    });
    setAddingOutput(false);
    setNewUniverse((prev) => prev + 1);
  };

  const nics = store.networkInterfaces;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Engine connection status */}
      <div className="glass-panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-primary font-semibold">
            ⚡ Engine I/O Configuration
          </div>
          <div className={`flex items-center gap-1.5 text-[9px] ${engineStatus?.running ? 'text-green-400' : 'text-red-400'}`}>
            <div className={`w-2 h-2 rounded-full ${engineStatus?.running ? 'bg-green-400 shadow-[0_0_6px_rgba(0,255,100,0.5)]' : 'bg-red-400'}`} />
            {engineStatus?.running ? 'Engine Connected' : 'Engine Offline'}
          </div>
        </div>
        <div className="text-[8px] text-muted-foreground/60 bg-muted/10 rounded p-2">
          Konfigurera nätverksutgångar för ArtNet/sACN och USB-DMX adaptrar.
          Bind ArtNet till ett dedikerat NIC för att separera DMX-trafik från TCP/IP.
          <br />
          <strong>Ubuntu-tips:</strong> Kör <code className="bg-muted/30 px-1 rounded">engine-server.cjs</code> med root för USB-åtkomst.
        </div>
      </div>

      {/* Network Interfaces detected */}
      <div className="glass-panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[9px] uppercase tracking-widest font-semibold" style={{ color: '#ff6600' }}>
            🌐 Nätverksgränssnitt (NIC)
          </div>
          <Button variant="ghost" size="sm" className="h-6 text-[9px] gap-1 text-muted-foreground">
            <RefreshCw size={10} /> Uppdatera
          </Button>
        </div>
        <div className="border border-border/20 rounded overflow-hidden">
          <table className="w-full text-[9px]">
            <thead>
              <tr className="bg-muted/20 border-b border-border/20">
                <th className="text-left p-2 text-muted-foreground font-semibold">Namn</th>
                <th className="text-left p-2 text-muted-foreground font-semibold">IP-adress</th>
                <th className="text-left p-2 text-muted-foreground font-semibold">MAC</th>
                <th className="text-left p-2 text-muted-foreground font-semibold">Tilldelning</th>
              </tr>
            </thead>
            <tbody>
              {nics.length > 0 ? (
                nics.filter((n) => !n.internal).map((nic) => {
                  const assignedOutputs = store.outputs.filter((o) => o.bindInterface === nic.address || o.bindInterface === nic.name);
                  return (
                    <tr key={nic.name + nic.address} className="border-b border-border/10">
                      <td className="p-2 font-mono font-semibold">{nic.name}</td>
                      <td className="p-2 font-mono text-primary">
                        {nic.address || <span className="text-muted-foreground/40 italic">Ej ansluten</span>}
                      </td>
                      <td className="p-2 font-mono text-muted-foreground/50">{nic.mac || '—'}</td>
                      <td className="p-2">
                        {assignedOutputs.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {assignedOutputs.map((o) => (
                              <span
                                key={o.id}
                                className="px-1.5 py-0.5 rounded text-[7px] font-semibold"
                                style={{
                                  backgroundColor: `${PROTOCOL_COLORS[o.protocol]}22`,
                                  color: PROTOCOL_COLORS[o.protocol],
                                  border: `1px solid ${PROTOCOL_COLORS[o.protocol]}44`,
                                }}
                              >
                                {o.protocol.toUpperCase()} U{o.universe}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40 italic">Ej tilldelad</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={4} className="p-3 text-center text-muted-foreground/40 italic">
                    {engineStatus?.running
                      ? 'Väntar på NIC-lista från engine...'
                      : 'Starta engine-server för att detektera nätverksgränssnitt'}
                  </td>
                </tr>
              )}
              {/* Always show fallback IPs */}
              <tr className="border-b border-border/10 bg-muted/5">
                <td className="p-2 font-mono text-muted-foreground">all</td>
                <td className="p-2 font-mono text-muted-foreground/50">0.0.0.0</td>
                <td className="p-2 font-mono text-muted-foreground/30">—</td>
                <td className="p-2 text-[8px] text-muted-foreground/40 italic">Alla gränssnitt (broadcast)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Output routing table */}
      <div className="glass-panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[9px] uppercase tracking-widest text-stokio-cyan font-semibold">
            📡 Output Routing
          </div>
          <span className="text-[8px] text-muted-foreground">{store.outputs.length} output(s)</span>
        </div>
        <div className="space-y-2">
          {store.outputs.map((output) => (
            <OutputRow key={output.id} output={output} nics={nics} store={store} />
          ))}
        </div>

        {/* Add new output */}
        {addingOutput ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="glass-panel p-3 space-y-3 border border-primary/20"
          >
            <div className="text-[9px] uppercase tracking-widest text-primary font-semibold">Ny Output</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[7px] uppercase text-muted-foreground">Protokoll</label>
                <select
                  value={newProtocol}
                  onChange={(e) => setNewProtocol(e.target.value as OutputProtocol)}
                  className="w-full h-7 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground mt-0.5"
                >
                  <option value="artnet">ArtNet (UDP 6454)</option>
                  <option value="sacn">sACN / E1.31 (UDP 5568)</option>
                  <option value="usb-dmx">USB-DMX (Serial)</option>
                  <option value="ddp">DDP (Pixel Streaming)</option>
                </select>
              </div>
              <div>
                <label className="text-[7px] uppercase text-muted-foreground">Universe</label>
                <Input
                  type="number"
                  min={1}
                  max={32768}
                  value={newUniverse}
                  onChange={(e) => setNewUniverse(Number(e.target.value))}
                  className="h-7 text-xs bg-muted/30 border-border/30 font-mono mt-0.5"
                />
              </div>
            </div>

            {newProtocol !== 'usb-dmx' && (
              <div>
                <label className="text-[7px] uppercase text-muted-foreground">Bind till NIC</label>
                <select
                  value={newBindIface}
                  onChange={(e) => setNewBindIface(e.target.value)}
                  className="w-full h-7 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground mt-0.5"
                >
                  <option value="all">Alla gränssnitt (0.0.0.0)</option>
                  {nics
                    .filter((n) => !n.internal)
                    .map((n) => (
                      <option key={n.name} value={n.address || n.name}>
                        {n.name}{n.address ? ` — ${n.address}` : ' (ej ansluten)'}
                      </option>
                    ))}
                </select>
              </div>
            )}

            {newProtocol === 'usb-dmx' && (
              <div>
                <label className="text-[7px] uppercase text-muted-foreground">USB-adapter typ</label>
                <select
                  value={newUsbType}
                  onChange={(e) => setNewUsbType(e.target.value as UsbAdapterType)}
                  className="w-full h-7 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground mt-0.5"
                >
                  {(Object.keys(USB_ADAPTER_LABELS) as UsbAdapterType[]).map((t) => (
                    <option key={t} value={t}>{USB_ADAPTER_LABELS[t]}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-[10px]" onClick={addNewOutput}>
                <Plus size={12} /> Lägg till
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => setAddingOutput(false)}>
                Avbryt
              </Button>
            </div>
          </motion.div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px] gap-1 w-full"
            onClick={() => setAddingOutput(true)}
          >
            <Plus size={12} /> Lägg till Output
          </Button>
        )}
      </div>

      {/* USB-DMX section */}
      <div className="glass-panel p-4 space-y-3">
        <div className="text-[9px] uppercase tracking-widest text-stokio-cyan font-semibold">🔌 USB-DMX Adaptrar</div>
        
        {/* Detected USB ports from engine */}
        {detectedUsbPorts.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[8px] uppercase tracking-widest text-green-400 font-semibold">
              ✅ Detekterade USB-enheter
            </div>
            {detectedUsbPorts.map((port) => {
              const alreadyAdded = store.outputs.some((o) => o.usbPort === port.path);
              const detectedType = USB_TYPE_FROM_DETECTED[port.adapterType] || 'enttec-pro';
              const typeName = port.adapterType === 'unknown' 
                ? 'Okänd USB-seriell enhet' 
                : (USB_ADAPTER_LABELS[detectedType] || port.adapterType);
              return (
                <div
                  key={port.path}
                  className={`flex items-center gap-3 p-2 rounded border ${
                    alreadyAdded 
                      ? 'border-green-500/30 bg-green-500/5' 
                      : 'border-stokio-cyan/30 bg-stokio-cyan/5'
                  }`}
                >
                  <Usb size={14} className={alreadyAdded ? 'text-green-400' : 'text-stokio-cyan'} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-semibold font-mono">{port.path}</div>
                    <div className="text-[8px] text-muted-foreground">
                      {typeName}
                      {port.vendor && <span className="ml-1 text-muted-foreground/40">VID:{port.vendor} PID:{port.product}</span>}
                      {port.serial && <span className="ml-1 text-muted-foreground/40">S/N:{port.serial}</span>}
                    </div>
                  </div>
                  {alreadyAdded ? (
                    <span className="text-[8px] text-green-400 font-semibold px-2">Tillagd ✓</span>
                  ) : (
                    <Button
                      size="sm"
                      className="h-6 text-[9px] gap-1"
                      onClick={() => {
                        const nextUni = Math.max(1, ...store.outputs.map(o => o.universe)) + 1;
                        store.addOutput({
                          id: `usb-${Date.now()}`,
                          universe: nextUni,
                          protocol: 'usb-dmx',
                          direction: 'output',
                          enabled: true,
                          usbType: detectedType,
                          usbPort: port.path,
                          label: `${USB_ADAPTER_LABELS[detectedType] || 'USB-DMX'} (${port.name})`,
                        });
                      }}
                    >
                      <Plus size={10} /> Lägg till
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {detectedUsbPorts.length === 0 && engineStatus?.running && (
          <div className="text-[9px] text-muted-foreground/50 bg-muted/10 rounded p-2 text-center italic">
            Inga USB-serieportar detekterade. Koppla in din DMX-adapter och starta om engine.
          </div>
        )}
        
        {!engineStatus?.running && (
          <div className="text-[8px] text-muted-foreground/60 bg-muted/10 rounded p-2 space-y-1">
            <p>Starta <code className="bg-muted/30 px-1 rounded">engine-server.cjs</code> för att auto-detektera USB-DMX adaptrar.</p>
            <p>
              <strong>Ubuntu:</strong> Lägg till användaren i <code className="bg-muted/30 px-1 rounded">dialout</code>-gruppen:
              <code className="bg-muted/30 px-1 rounded ml-1">sudo usermod -aG dialout $USER</code>
            </p>
          </div>
        )}

        {/* Already configured USB outputs */}
        {store.outputs.filter((o) => o.protocol === 'usb-dmx').length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-border/10">
            <div className="text-[8px] uppercase tracking-widest text-muted-foreground font-semibold">
              Konfigurerade USB-utgångar
            </div>
            {store.outputs
              .filter((o) => o.protocol === 'usb-dmx')
              .map((o) => (
                <div
                  key={o.id}
                  className="flex items-center gap-3 p-2 rounded border border-stokio-cyan/20 bg-stokio-cyan/5"
                >
                  <Usb size={14} className="text-stokio-cyan" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-semibold">{o.label}</div>
                    <div className="text-[8px] text-muted-foreground">
                      {o.usbType ? USB_ADAPTER_LABELS[o.usbType] : 'USB-DMX'} · Universe {o.universe}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={o.usbPort || ''}
                      onChange={(e) => store.updateOutput(o.id, { usbPort: e.target.value })}
                      className="h-6 text-[9px] bg-muted/20 border border-border/20 rounded px-1 font-mono text-foreground"
                    >
                      <option value="">Välj port...</option>
                      {detectedUsbPorts.map((p) => (
                        <option key={p.path} value={p.path}>{p.path} ({p.adapterType})</option>
                      ))}
                      <option value="custom">Ange manuellt...</option>
                    </select>
                    {o.usbPort === 'custom' && (
                      <Input
                        placeholder="/dev/ttyUSB0"
                        onChange={(e) => store.updateOutput(o.id, { usbPort: e.target.value })}
                        className="h-6 text-[9px] bg-muted/20 border-border/20 w-28 font-mono"
                      />
                    )}
                    <div className={`w-2 h-2 rounded-full ${o.usbConnected ? 'bg-green-400 shadow-[0_0_6px_rgba(0,255,100,0.5)]' : 'bg-red-400'}`} />
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* VFX Output (HDMI) */}
      <div className="glass-panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[9px] uppercase tracking-widest font-semibold" style={{ color: '#aa44ff' }}>
            🖥️ VFX Video Output (HDMI)
          </div>
          <button
            onClick={() => store.setVfxOutput({ enabled: !store.vfxOutput.enabled })}
            className={`px-2 py-0.5 rounded text-[8px] font-semibold transition-all ${
              store.vfxOutput.enabled
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-muted/20 text-muted-foreground border border-border/20'
            }`}
          >
            {store.vfxOutput.enabled ? 'AKTIV' : 'INAKTIV'}
          </button>
        </div>
        <div className="text-[8px] text-muted-foreground/60 bg-muted/10 rounded p-2">
          Skicka VFX-visualiseraren i fullskärm till en dedikerad HDMI-utgång via ett extra grafikkort (Nvidia GT 310).
          <br />
          <strong>Ubuntu X11/Wayland:</strong> Konfigurera dubbla skärmar i Display Settings. VFX-fönstret öppnas på vald skärm.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[7px] uppercase text-muted-foreground">Skärm (Display)</label>
            <select
              value={store.vfxOutput.display}
              onChange={(e) => store.setVfxOutput({ display: Number(e.target.value) })}
              className="w-full h-7 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground mt-0.5"
            >
              <option value={0}>Primär (Skärm 1)</option>
              <option value={1}>Sekundär (Skärm 2 — HDMI)</option>
              <option value={2}>Skärm 3</option>
            </select>
          </div>
          <div>
            <label className="text-[7px] uppercase text-muted-foreground">Upplösning</label>
            <select
              value={store.vfxOutput.resolution}
              onChange={(e) => store.setVfxOutput({ resolution: e.target.value })}
              className="w-full h-7 rounded bg-muted/30 border border-border/30 text-xs px-2 text-foreground mt-0.5"
            >
              <option value="1920x1080">1920×1080 (Full HD)</option>
              <option value="1280x720">1280×720 (HD)</option>
              <option value="3840x2160">3840×2160 (4K)</option>
              <option value="1024x768">1024×768</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={store.vfxOutput.fullscreen}
              onChange={(e) => store.setVfxOutput({ fullscreen: e.target.checked })}
              className="rounded"
            />
            <span className="text-[9px] text-muted-foreground">Auto-fullskärm vid start</span>
          </label>
        </div>
      </div>

      {/* VFX Output Quick Control */}
      <VfxOutputControl />

      {/* Tips */}
      <div className="glass-panel p-4 space-y-2 border-l-2 border-yellow-500/30">
        <div className="flex items-center gap-1.5 text-[9px] text-yellow-400 font-semibold">
          <AlertTriangle size={12} /> Nätverks-tips för Ubuntu
        </div>
        <div className="text-[8px] text-muted-foreground/60 space-y-1">
          <p>• <strong>Dubbla NIC:</strong> Bind ArtNet till NIC 2 (t.ex. <code className="bg-muted/30 px-1 rounded">enp2s0</code>) och behåll TCP/IP (internet, WLED) på NIC 1.</p>
          <p>• <strong>Statisk IP för ArtNet-NIC:</strong> Sätt t.ex. <code className="bg-muted/30 px-1 rounded">2.0.0.1/8</code> — de flesta ArtNet-enheter använder 2.x.x.x eller 10.x.x.x.</p>
          <p>• <strong>Brandvägg:</strong> <code className="bg-muted/30 px-1 rounded">sudo ufw allow 6454/udp</code> och <code className="bg-muted/30 px-1 rounded">sudo ufw allow 5568/udp</code></p>
          <p>• <strong>Enttec USB:</strong> <code className="bg-muted/30 px-1 rounded">ls /dev/ttyUSB*</code> för att hitta enheten, sedan konfigurera porten ovan.</p>
        </div>
      </div>
    </div>
  );
}

// ── Output Row Component ──
function OutputRow({
  output,
  nics,
  store,
}: {
  output: IOOutput;
  nics: NetworkInterface[];
  store: IOState;
}) {
  const color = PROTOCOL_COLORS[output.protocol];
  const isNetwork = output.protocol === 'artnet' || output.protocol === 'sacn' || output.protocol === 'ddp';

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 transition-all ${
        output.enabled ? 'border-border/30' : 'border-border/10 opacity-50'
      }`}
      style={{ borderLeftWidth: 3, borderLeftColor: color }}
    >
      <div className="flex items-center gap-3">
        {isNetwork ? <Wifi size={14} style={{ color }} /> : <Usb size={14} style={{ color }} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Input
              value={output.label || ''}
              onChange={(e) => store.updateOutput(output.id, { label: e.target.value })}
              className="h-5 text-[10px] bg-transparent border-0 p-0 font-semibold"
              style={{ maxWidth: 200 }}
            />
            <span
              className="text-[7px] px-1.5 py-0.5 rounded font-semibold"
              style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}
            >
              {output.protocol.toUpperCase()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => store.updateOutput(output.id, { enabled: !output.enabled })}
            className={`px-2 py-0.5 rounded text-[8px] font-semibold transition-all ${
              output.enabled
                ? 'bg-green-500/20 text-green-400'
                : 'bg-muted/20 text-muted-foreground'
            }`}
          >
            {output.enabled ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => store.removeOutput(output.id)}
            className="text-muted-foreground/40 hover:text-destructive transition-colors p-1"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[7px] uppercase text-muted-foreground">Universe</label>
          <Input
            type="number"
            min={1}
            max={32768}
            value={output.universe}
            onChange={(e) => store.updateOutput(output.id, { universe: Number(e.target.value) })}
            className="h-6 text-[9px] bg-muted/20 border-border/20 font-mono mt-0.5"
          />
        </div>
        <div>
          <label className="text-[7px] uppercase text-muted-foreground">Riktning</label>
          <select
            value={output.direction}
            onChange={(e) => store.updateOutput(output.id, { direction: e.target.value as OutputDirection })}
            className="w-full h-6 rounded bg-muted/20 border border-border/20 text-[9px] px-1 text-foreground mt-0.5"
          >
            <option value="output">Output</option>
            <option value="input">Input</option>
            <option value="input+output">Input + Output</option>
          </select>
        </div>
        {isNetwork && (
          <div>
            <label className="text-[7px] uppercase text-muted-foreground">Bind NIC</label>
            <select
              value={output.bindInterface || 'all'}
              onChange={(e) => store.updateOutput(output.id, { bindInterface: e.target.value })}
              className="w-full h-6 rounded bg-muted/20 border border-border/20 text-[9px] px-1 text-foreground mt-0.5"
            >
              <option value="all">Alla (0.0.0.0)</option>
              {nics
                .filter((n) => !n.internal)
                .map((n) => (
                  <option key={n.name} value={n.address || n.name}>
                    {n.name}{n.address ? ` (${n.address})` : ' (ej ansluten)'}
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>

      {isNetwork && (
        <div>
          <label className="text-[7px] uppercase text-muted-foreground">Mål-IP</label>
          <Input
            value={output.targetIp || 'broadcast'}
            onChange={(e) => store.updateOutput(output.id, { targetIp: e.target.value })}
            placeholder="broadcast eller t.ex. 2.0.0.100"
            className="h-6 text-[9px] bg-muted/20 border-border/20 font-mono mt-0.5"
          />
        </div>
      )}

      {output.protocol === 'usb-dmx' && (
        <div>
          <label className="text-[7px] uppercase text-muted-foreground">Serieport</label>
          <Input
            value={output.usbPort || ''}
            onChange={(e) => store.updateOutput(output.id, { usbPort: e.target.value })}
            placeholder="/dev/ttyUSB0"
            className="h-6 text-[9px] bg-muted/20 border-border/20 font-mono mt-0.5"
          />
        </div>
      )}
    </div>
  );
}
