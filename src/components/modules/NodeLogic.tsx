import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface NodePort {
  id: string;
  label: string;
  type: 'input' | 'output';
}

interface LogicNode {
  id: string;
  name: string;
  category: 'input' | 'action';
  x: number;
  y: number;
  ports: NodePort[];
  color: string;
}

interface Connection {
  id: string;
  fromNodeId: string;
  fromPortId: string;
  toNodeId: string;
  toPortId: string;
}

const INITIAL_NODES: LogicNode[] = [
  {
    id: 'n1', name: 'DMX Input Ch.1', category: 'input', x: 50, y: 80,
    ports: [{ id: 'p1', label: 'Value', type: 'output' }],
    color: '#00e5ff',
  },
  {
    id: 'n2', name: 'Audio Peak', category: 'input', x: 50, y: 220,
    ports: [{ id: 'p2', label: 'Level', type: 'output' }],
    color: '#00e5ff',
  },
  {
    id: 'n3', name: 'Trigger Scene: Fire', category: 'action', x: 400, y: 80,
    ports: [{ id: 'p3', label: 'Trigger', type: 'input' }],
    color: '#ff2d78',
  },
  {
    id: 'n4', name: 'Master Dimmer', category: 'action', x: 400, y: 220,
    ports: [{ id: 'p4', label: 'Value', type: 'input' }],
    color: '#ff2d78',
  },
];

const INITIAL_CONNECTIONS: Connection[] = [
  { id: 'c1', fromNodeId: 'n1', fromPortId: 'p1', toNodeId: 'n3', toPortId: 'p3' },
  { id: 'c2', fromNodeId: 'n2', fromPortId: 'p2', toNodeId: 'n4', toPortId: 'p4' },
];

const NODE_LIBRARY = [
  { name: 'DMX Channel', category: 'input' as const, color: '#00e5ff', ports: [{ id: '', label: 'Value', type: 'output' as const }] },
  { name: 'USB-DMX', category: 'input' as const, color: '#00e5ff', ports: [{ id: '', label: 'Data', type: 'output' as const }] },
  { name: 'Audio Peak', category: 'input' as const, color: '#00e5ff', ports: [{ id: '', label: 'Level', type: 'output' as const }] },
  { name: 'WLED Mic', category: 'input' as const, color: '#00e5ff', ports: [{ id: '', label: 'FFT', type: 'output' as const }] },
  { name: 'Trigger Scene', category: 'action' as const, color: '#ff2d78', ports: [{ id: '', label: 'Trigger', type: 'input' as const }] },
  { name: 'Play/Pause', category: 'action' as const, color: '#ff2d78', ports: [{ id: '', label: 'Toggle', type: 'input' as const }] },
  { name: 'Set Dimmer', category: 'action' as const, color: '#ff2d78', ports: [{ id: '', label: 'Value', type: 'input' as const }] },
  { name: 'WLED Segment', category: 'action' as const, color: '#ff2d78', ports: [{ id: '', label: 'Color', type: 'input' as const }] },
];

export function NodeLogic() {
  const [nodes, setNodes] = useState<LogicNode[]>(INITIAL_NODES);
  const [connections, setConnections] = useState<Connection[]>(INITIAL_CONNECTIONS);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showLibrary, setShowLibrary] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    setDragging(nodeId);
    setDragOffset({ x: e.clientX - node.x, y: e.clientY - node.y });
    e.stopPropagation();
  }, [nodes]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setNodes(prev => prev.map(n =>
      n.id === dragging ? { ...n, x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y } : n
    ));
  }, [dragging, dragOffset]);

  const handleMouseUp = useCallback(() => setDragging(null), []);

  const addNode = (template: typeof NODE_LIBRARY[0]) => {
    const id = `n${Date.now()}`;
    const newNode: LogicNode = {
      id, name: template.name, category: template.category,
      x: 200 + Math.random() * 100, y: 100 + Math.random() * 200,
      ports: template.ports.map(p => ({ ...p, id: `p${Date.now()}${Math.random()}` })),
      color: template.color,
    };
    setNodes(prev => [...prev, newNode]);
    setShowLibrary(false);
  };

  const removeNode = (nodeId: string) => {
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    setConnections(prev => prev.filter(c => c.fromNodeId !== nodeId && c.toNodeId !== nodeId));
  };

  const getPortPosition = (nodeId: string, portId: string): { x: number; y: number } => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return { x: 0, y: 0 };
    const port = node.ports.find(p => p.id === portId);
    if (!port) return { x: 0, y: 0 };
    const isOutput = port.type === 'output';
    return {
      x: node.x + (isOutput ? 200 : 0),
      y: node.y + 35,
    };
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-border/30">
        <h2 className="text-sm font-semibold tracking-wider">NODE LOGIC</h2>
        <Button variant="outline" size="sm" onClick={() => setShowLibrary(!showLibrary)} className="h-7 text-[10px] gap-1">
          <Plus size={12} /> Add Node
        </Button>
      </div>

      <div className="flex-1 relative overflow-hidden" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
        {/* Library Panel */}
        {showLibrary && (
          <motion.div
            initial={{ x: -200, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="absolute left-0 top-0 z-20 w-52 h-full glass-panel-strong border-r border-border/30 p-3 overflow-y-auto"
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Node Library</div>
            <div className="space-y-1">
              {NODE_LIBRARY.map((tpl, i) => (
                <button
                  key={i}
                  onClick={() => addNode(tpl)}
                  className="w-full flex items-center gap-2 p-2 rounded text-xs hover:bg-muted/50 text-left"
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tpl.color }} />
                  {tpl.name}
                  <span className="ml-auto text-[8px] uppercase text-muted-foreground">{tpl.category}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* SVG Cables */}
        <svg ref={svgRef} className="absolute inset-0 w-full h-full pointer-events-none z-10">
          {connections.map(conn => {
            const from = getPortPosition(conn.fromNodeId, conn.fromPortId);
            const to = getPortPosition(conn.toNodeId, conn.toPortId);
            const cx1 = from.x + 80;
            const cx2 = to.x - 80;
            return (
              <g key={conn.id}>
                <path
                  d={`M ${from.x} ${from.y} C ${cx1} ${from.y}, ${cx2} ${to.y}, ${to.x} ${to.y}`}
                  stroke="hsl(155, 100%, 50%)"
                  strokeWidth="2"
                  fill="none"
                  opacity="0.6"
                />
                <path
                  d={`M ${from.x} ${from.y} C ${cx1} ${from.y}, ${cx2} ${to.y}, ${to.x} ${to.y}`}
                  stroke="hsl(155, 100%, 50%)"
                  strokeWidth="4"
                  fill="none"
                  opacity="0.15"
                  filter="blur(4px)"
                />
              </g>
            );
          })}
        </svg>

        {/* Nodes */}
        {nodes.map(node => (
          <motion.div
            key={node.id}
            className="absolute z-10 select-none"
            style={{ left: node.x, top: node.y }}
            onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
          >
            <div
              className="w-[200px] rounded-lg glass-panel border cursor-grab active:cursor-grabbing"
              style={{ borderColor: `${node.color}40` }}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-3 py-2 rounded-t-lg"
                style={{ background: `${node.color}15` }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: node.color, boxShadow: `0 0 6px ${node.color}` }} />
                  <span className="text-[10px] font-semibold truncate" style={{ color: node.color }}>{node.name}</span>
                </div>
                <button onClick={() => removeNode(node.id)} className="opacity-50 hover:opacity-100">
                  <Trash2 size={10} />
                </button>
              </div>
              {/* Ports */}
              <div className="px-3 py-2 space-y-1">
                {node.ports.map(port => (
                  <div key={port.id} className={`flex items-center gap-2 text-[9px] ${port.type === 'output' ? 'justify-end' : ''}`}>
                    <div
                      className="w-2.5 h-2.5 rounded-full border"
                      style={{ borderColor: node.color, backgroundColor: `${node.color}30` }}
                    />
                    <span className="text-muted-foreground">{port.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
