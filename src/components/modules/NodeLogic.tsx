import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Save, FolderOpen, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { LogicNode, Connection, NodeConfig } from './node-logic/types';
import { NODE_LIBRARY } from './node-logic/nodeLibrary';
import { NodeCard } from './node-logic/NodeCard';
import { NodeLibraryPanel } from './node-logic/NodeLibraryPanel';
import { NodeProperties } from './node-logic/NodeProperties';
import { generateESPHomeFirmware, generateWLEDUsermod } from './node-logic/firmwareGenerator';

// ── Default demo nodes ──
const INITIAL_NODES: LogicNode[] = [
  {
    id: 'n1', name: 'ArtNet DMX In', category: 'dmx-input', x: 50, y: 60, templateId: 'artnet-in',
    ports: [{ id: 'p1', label: 'Universe Out', type: 'output', dataType: 'dmx' }],
    color: '#00e5ff', config: { protocol: 'ArtNet', universe: 1, channelStart: 1, channelEnd: 512 },
  },
  {
    id: 'n2', name: 'DMX Channel Mapper', category: 'dmx-input', x: 300, y: 60, templateId: 'dmx-channel-map',
    ports: [
      { id: 'p2a', label: 'DMX In', type: 'input', dataType: 'dmx' },
      { id: 'p2b', label: 'Trigger 1', type: 'output', dataType: 'trigger' },
      { id: 'p2c', label: 'Value 1', type: 'output', dataType: 'value' },
    ],
    color: '#00e5ff', config: { channelMappings: [{ dmxChannel: 1, targetType: 'livdj-button', targetId: 'btn1', targetLabel: 'Strobe Button' }] },
  },
  {
    id: 'n3', name: 'ESP32 Button', category: 'esp32', x: 50, y: 250, templateId: 'esp32-button',
    ports: [
      { id: 'p3a', label: 'Pressed', type: 'output', dataType: 'trigger' },
      { id: 'p3b', label: 'Released', type: 'output', dataType: 'trigger' },
      { id: 'p3c', label: 'Double', type: 'output', dataType: 'trigger' },
      { id: 'p3d', label: 'Hold', type: 'output', dataType: 'trigger' },
    ],
    color: '#00cc44', config: { gpioPin: 4, buttonMode: 'push-release', holdTime: 1000, doublePressTime: 300 },
  },
  {
    id: 'n4', name: 'Trigger Scene', category: 'triggers', x: 560, y: 60, templateId: 'trigger-scene',
    ports: [
      { id: 'p4a', label: 'Trigger', type: 'input', dataType: 'trigger' },
      { id: 'p4b', label: 'Active', type: 'output', dataType: 'trigger' },
    ],
    color: '#ff2d78', config: { mappedTargetType: 'scene', mappedTarget: 'fire_scene' },
  },
  {
    id: 'n5', name: 'Live DJ Button', category: 'triggers', x: 560, y: 230, templateId: 'trigger-dj-button',
    ports: [
      { id: 'p5a', label: 'Press', type: 'input', dataType: 'trigger' },
      { id: 'p5b', label: 'Value', type: 'input', dataType: 'value' },
    ],
    color: '#ff2d78', config: { mappedTargetType: 'livdj-button', mappedTarget: 'strobe_1' },
  },
  {
    id: 'n6', name: 'ArtNet DMX Out', category: 'dmx-output', x: 560, y: 400, templateId: 'artnet-out',
    ports: [
      { id: 'p6a', label: 'Universe 1', type: 'input', dataType: 'dmx' },
    ],
    color: '#ffaa00', config: { protocol: 'ArtNet', universe: 1, ipAddress: '255.255.255.255' },
  },
];

const INITIAL_CONNECTIONS: Connection[] = [
  { id: 'c1', fromNodeId: 'n1', fromPortId: 'p1', toNodeId: 'n2', toPortId: 'p2a' },
  { id: 'c2', fromNodeId: 'n2', fromPortId: 'p2b', toNodeId: 'n4', toPortId: 'p4a' },
  { id: 'c3', fromNodeId: 'n3', fromPortId: 'p3a', toNodeId: 'n5', toPortId: 'p5a' },
];

const STORAGE_KEY = 'sflc-node-logic-v2';

export function NodeLogic() {
  const [nodes, setNodes] = useState<LogicNode[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const d = JSON.parse(saved);
        return d.nodes || INITIAL_NODES;
      }
    } catch {}
    return INITIAL_NODES;
  });
  const [connections, setConnections] = useState<Connection[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const d = JSON.parse(saved);
        return d.connections || INITIAL_CONNECTIONS;
      }
    } catch {}
    return INITIAL_CONNECTIONS;
  });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showLibrary, setShowLibrary] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Drag handling ──
  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDragging(nodeId);
    setDragOffset({ x: e.clientX - rect.left - node.x, y: e.clientY - rect.top - node.y });
    e.stopPropagation();
  }, [nodes]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setNodes(prev => prev.map(n =>
      n.id === dragging ? { ...n, x: e.clientX - rect.left - dragOffset.x, y: e.clientY - rect.top - dragOffset.y } : n
    ));
  }, [dragging, dragOffset]);

  const handleMouseUp = useCallback(() => setDragging(null), []);

  // ── Add node from template ──
  const addNode = (templateId: string) => {
    const tpl = NODE_LIBRARY.find(t => t.id === templateId);
    if (!tpl) return;
    const id = `n${Date.now()}`;
    const newNode: LogicNode = {
      id, name: tpl.name, category: tpl.category, templateId: tpl.id,
      x: 200 + Math.random() * 150, y: 80 + Math.random() * 250,
      ports: tpl.ports.map(p => ({ ...p, id: `p${Date.now()}${Math.random().toString(36).slice(2, 6)}` })),
      color: tpl.color, config: { ...tpl.defaultConfig },
    };
    setNodes(prev => [...prev, newNode]);
    setShowLibrary(false);
    setSelectedNode(id);
  };

  const removeNode = (nodeId: string) => {
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    setConnections(prev => prev.filter(c => c.fromNodeId !== nodeId && c.toNodeId !== nodeId));
    if (selectedNode === nodeId) setSelectedNode(null);
  };

  const updateNodeConfig = (nodeId: string, config: Partial<NodeConfig>) => {
    setNodes(prev => prev.map(n =>
      n.id === nodeId ? { ...n, config: { ...n.config, ...config } } : n
    ));
  };

  // ── Port positions for SVG cables ──
  const getPortPosition = (nodeId: string, portId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return { x: 0, y: 0 };
    const port = node.ports.find(p => p.id === portId);
    if (!port) return { x: 0, y: 0 };
    const sameType = node.ports.filter(p => p.type === port.type);
    const idx = sameType.indexOf(port);
    const hasConfig = node.config.universe || node.config.gpioPin !== undefined || node.config.wledIp;
    const headerH = 32;
    const portH = 18;
    const configH = hasConfig ? 24 : 0;
    return {
      x: node.x + (port.type === 'output' ? 220 : 0),
      y: node.y + headerH + 8 + idx * portH + configH * 0,
    };
  };

  // ── Save / Load ──
  const saveToFile = () => {
    const data = JSON.stringify({ nodes, connections }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'sflc-node-logic.json'; a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem(STORAGE_KEY, data);
    toast.success('Node logic saved');
  };

  const loadFromFile = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const d = JSON.parse(ev.target?.result as string);
          if (d.nodes) { setNodes(d.nodes); setConnections(d.connections || []); setSelectedNode(null); }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
          toast.success('Node logic loaded');
        } catch { toast.error('Invalid file'); }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const downloadAllFirmware = () => {
    const esp32Nodes = nodes.filter(n => n.category === 'esp32');
    if (esp32Nodes.length === 0) { toast.error('No ESP32 nodes to generate firmware for'); return; }
    const yaml = generateESPHomeFirmware(esp32Nodes);
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'sflc_gpio.yaml'; a.click();
    URL.revokeObjectURL(url);
    toast.success('ESPHome firmware downloaded');
  };

  const selected = nodes.find(n => n.id === selectedNode);
  const esp32Nodes = nodes.filter(n => n.category === 'esp32');

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-3 border-b border-border/30">
        <h2 className="text-sm font-semibold tracking-wider">NODE LOGIC</h2>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setShowLibrary(!showLibrary)} className="h-7 text-[10px] gap-1">
            <Plus size={12} /> Add Node
          </Button>
          <Button variant="outline" size="sm" onClick={saveToFile} className="h-7 text-[10px] gap-1">
            <Save size={12} /> Save
          </Button>
          <Button variant="outline" size="sm" onClick={loadFromFile} className="h-7 text-[10px] gap-1">
            <FolderOpen size={12} /> Open
          </Button>
          {esp32Nodes.length > 0 && (
            <Button variant="outline" size="sm" onClick={downloadAllFirmware} className="h-7 text-[10px] gap-1">
              <Download size={12} /> Firmware
            </Button>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={() => setSelectedNode(null)}
      >
        {/* Library Panel */}
        <AnimatePresence>
          {showLibrary && <NodeLibraryPanel onAddNode={addNode} />}
        </AnimatePresence>

        {/* Properties Panel */}
        <AnimatePresence>
          {selected && (
            <NodeProperties
              node={selected}
              allEsp32Nodes={esp32Nodes}
              onUpdate={(cfg) => updateNodeConfig(selected.id, cfg)}
              onClose={() => setSelectedNode(null)}
            />
          )}
        </AnimatePresence>

        {/* SVG Cables */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-[5]">
          {connections.map(conn => {
            const from = getPortPosition(conn.fromNodeId, conn.fromPortId);
            const to = getPortPosition(conn.toNodeId, conn.toPortId);
            const cx1 = from.x + 80;
            const cx2 = to.x - 80;
            return (
              <g key={conn.id}>
                <path
                  d={`M ${from.x} ${from.y} C ${cx1} ${from.y}, ${cx2} ${to.y}, ${to.x} ${to.y}`}
                  stroke="hsl(155, 100%, 50%)" strokeWidth="2" fill="none" opacity="0.5"
                />
                <path
                  d={`M ${from.x} ${from.y} C ${cx1} ${from.y}, ${cx2} ${to.y}, ${to.x} ${to.y}`}
                  stroke="hsl(155, 100%, 50%)" strokeWidth="6" fill="none" opacity="0.08" filter="blur(4px)"
                />
                <circle cx={from.x} cy={from.y} r="4" fill="hsl(155, 100%, 50%)" opacity="0.6" />
                <circle cx={to.x} cy={to.y} r="4" fill="hsl(155, 100%, 50%)" opacity="0.6" />
              </g>
            );
          })}
        </svg>

        {/* Nodes */}
        {nodes.map(node => (
          <NodeCard
            key={node.id}
            node={node}
            selected={selectedNode === node.id}
            onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
            onSelect={() => setSelectedNode(node.id)}
            onRemove={() => removeNode(node.id)}
          />
        ))}
      </div>
    </motion.div>
  );
}
