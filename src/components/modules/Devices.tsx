import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Wifi, WifiOff, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Device {
  id: string;
  name: string;
  ip: string;
  ledCount: number;
  online: boolean;
  type: string;
  firmware: string;
}

const MOCK_DEVICES: Device[] = [
  { id: '1', name: 'WLED-Main Stage', ip: '192.168.1.100', ledCount: 256, online: true, type: 'ESP32', firmware: '0.14.0' },
  { id: '2', name: 'WLED-Left Wing', ip: '192.168.1.101', ledCount: 144, online: true, type: 'ESP32', firmware: '0.14.0' },
  { id: '3', name: 'WLED-Right Wing', ip: '192.168.1.102', ledCount: 60, online: false, type: 'ESP8266', firmware: '0.13.3' },
  { id: '4', name: 'WLED-Backlight', ip: '192.168.1.103', ledCount: 300, online: true, type: 'ESP32-S3', firmware: '0.14.0' },
  { id: '5', name: 'WLED-DJ Booth', ip: '192.168.1.104', ledCount: 120, online: true, type: 'ESP32', firmware: '0.14.0' },
  { id: '6', name: 'WLED-Bar Front', ip: '192.168.1.105', ledCount: 180, online: false, type: 'ESP8266', firmware: '0.13.1' },
];

export function Devices() {
  const [devices] = useState<Device[]>(MOCK_DEVICES);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = devices.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.ip.includes(search)
  );

  const onlineCount = devices.filter(d => d.online).length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-border/30">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold tracking-wider">DEVICES</h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
            {onlineCount}/{devices.length} online
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowAdd(!showAdd)} className="h-7 text-[10px] gap-1">
          <Plus size={12} /> Add Device
        </Button>
      </div>

      {/* Add Device Dialog */}
      {showAdd && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="p-4 border-b border-border/30 bg-card/50"
        >
          <div className="flex gap-3">
            <Input placeholder="Device Name" className="bg-muted/30 border-border/30 text-xs h-8 flex-1" />
            <Input placeholder="IP Address" className="bg-muted/30 border-border/30 text-xs h-8 w-40" />
            <Button size="sm" className="h-8 text-[10px]">Connect</Button>
          </div>
        </motion.div>
      )}

      {/* Search */}
      <div className="p-3">
        <Input
          placeholder="Search devices..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-muted/30 border-border/30 text-xs h-8"
        />
      </div>

      {/* Device Grid */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((device) => (
            <motion.div
              key={device.id}
              layout
              className={`glass-panel p-4 space-y-3 ${
                device.online ? 'border-primary/20' : 'border-border/10 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {device.online ? (
                    <Wifi size={14} className="text-primary" />
                  ) : (
                    <WifiOff size={14} className="text-muted-foreground" />
                  )}
                  <span className="text-xs font-semibold">{device.name}</span>
                </div>
                <button className="text-muted-foreground hover:text-foreground">
                  <Settings size={12} />
                </button>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">IP</span>
                  <span className="font-mono">{device.ip}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">LEDs</span>
                  <span className="font-mono text-stokio-cyan">{device.ledCount}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">Type</span>
                  <span className="font-mono">{device.type}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">FW</span>
                  <span className="font-mono">{device.firmware}</span>
                </div>
              </div>

              {/* Status indicator */}
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${device.online ? 'bg-primary glow-green' : 'bg-muted-foreground/30'}`} />
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  {device.online ? 'Connected' : 'Offline'}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
