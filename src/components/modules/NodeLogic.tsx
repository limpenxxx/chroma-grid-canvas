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
  category: 'input' | 'output' | 'action';
  x: number;
  y: number;
  ports: NodePort[];
  color: string;
  protocol?: string;
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
    id: 'n1', name: 'ArtNet DMX In', category: 'input', x: 50, y: 60,
    ports: [{ id: 'p1', label: 'Universe 1', type: 'output' }],
    color: '#00e5ff', protocol: 'ArtNet',
  },
  {
    id: 'n2', name: 'USB-DMX In', category: 'input', x: 50, y: 180,
    ports: [{ id: 'p2', label: 'DMX Data', type: 'output' }],
    color: '#00e5ff', protocol: 'USB-DMX',
  },
  {
    id: 'n3', name: 'Audio Peak', category: 'input', x: 50, y: 300,
    ports: [{ id: 'p3', label: 'Level', type: 'output' }],
    color: '#00e5ff',
  },
  {
    id: 'n4', name: 'ArtNet DMX Out', category: 'output', x: 450, y: 60,
    ports: [{ id: 'p4', label: 'Universe 1', type: 'input' }, { id: 'p4b', label: 'Universe 2', type: 'input' }],
    color: '#ffaa00', protocol: 'ArtNet',
  },
  {
    id: 'n5', name: 'USB-DMX Out', category: 'output', x: 450, y: 200,
    ports: [{ id: 'p5', label: 'DMX Data', type: 'input' }],
    color: '#ffaa00', protocol: 'USB-DMX',
  },
  {
    id: 'n6', name: 'Trigger Scene: Fire', category: 'action', x: 450, y: 340,
    ports: [{ id: 'p6', label: 'Trigger', type: 'input' }],
    color: '#ff2d78',
  },
];

const INITIAL_CONNECTIONS: Connection[] = [
  { id: 'c1', fromNodeId: 'n1', fromPortId: 'p1', toNodeId: 'n4', toPortId: 'p4' },
  { id: 'c2', fromNodeId: 'n2', fromPortId: 'p2', toNodeId: 'n5', toPortId: 'p5' },
  { id: 'c3', fromNodeId: 'n3', fromPortId: 'p3', toNodeId: 'n6', toPortId: 'p6' },
];

const NODE_LIBRARY = [
  // Inputs
  { name: 'ArtNet DMX In', category: 'input' as const, color: '#00e5ff', protocol: 'ArtNet',
    ports: [{ id: '', label: 'Universe', type: 'output' as const }] },
  { name: 'sACN DMX In', category: 'input' as const, color: '#00e5ff', protocol: 'sACN',
    ports: [{ id: '', label: 'Universe', type: 'output' as const }] },
  { name: 'USB-DMX In', category: 'input' as const, color: '#00e5ff', protocol: 'USB-DMX',
    ports: [{ id: '', label: 'DMX Data', type: 'output' as const }] },
  { name: 'Audio Peak', category: 'input' as const, color: '#00e5ff',
    ports: [{ id: '', label: 'Level', type: 'output' as const }] },
  { name: 'WLED Mic', category: 'input' as const, color: '#00e5ff',
    ports: [{ id: '', label: 'FFT', type: 'output' as const }] },
  // Outputs
  { name: 'ArtNet DMX Out', category: 'output' as const, color: '#ffaa00', protocol: 'ArtNet',
    ports: [{ id: '', label: 'Universe', type: 'input' as const }] },
  { name: 'sACN DMX Out', category: 'output' as const, color: '#ffaa00', protocol: 'sACN',
    ports: [{ id: '', label: 'Universe', type: 'input' as const }] },
  { name: 'USB-DMX Out', category: 'output' as const, color: '#ffaa00', protocol: 'USB-DMX',
    ports: [{ id: '', label: 'DMX Data', type: 'input' as const }] },
  { name: 'WLED Output', category: 'output' as const, color: '#ffaa00',
    ports: [{ id: '', label: 'Pixel Data', type: 'input' as const }] },
  // Actions
  { name: 'Trigger Scene', category: 'action' as const, color: '#ff2d78',
    ports: [{ id: '', label: 'Trigger', type: 'input' as const }] },
  { name: 'Play/Pause', category: 'action' as const, color: '#ff2d78',
    ports: [{ id: '', label: 'Toggle', type: 'input' as const }] },
  { name: 'Set Dimmer', category: 'action' as const, color: '#ff2d78',
    ports: [{ id: '', label: 'Value', type: 'input' as const }] },
  { name: 'WLED Segment Color', category: 'action' as const, color: '#ff2d78',
    ports: [{ id: '', label: 'Color', type: 'input' as const }] },
];

const CATEGORY_LABELS: Record<string, string> = { input: 'INPUT', output: 'OUTPUT', action: 'ACTION' };

export function NodeLogic() {
  const [nodes, setNodes] = useState<LogicNode[]>(INITIAL_NODES);
  const [connections, setConnections] = useState<Connection[]>(INITIAL_CONNECTIONS);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showLibrary, setShowLibrary] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const addNode = (template: typeof NODE_LIBRARY[0]) => {
    const id = `n${Date.now()}`;
    const newNode: LogicNode = {
      id, name: template.name, category: template.category,
      x: 200 + Math.random() * 100, y: 80 + Math.random() * 200,
      ports: template.ports.map(p => ({ ...p, id: `p${Date.now()}${Math.random()}` })),
      color: template.color, protocol: template.protocol,
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
    const portIndex = node.ports.filter(p => p.type === port.type).indexOf(port);
    const isOutput = port.type === 'output';
    return {
      x: node.x + (isOutput ? 210 : 0),
      y: node.y + 40 + portIndex * 22,
    };
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-border/30">
        <h2 className="text-sm font-semibold tracking-wider">NODE LOGIC</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowLibrary(!showLibrary)} className="h-7 text-[10px] gap-1">
            <Plus size={12} /> Add Node
          </Button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 relative overflow-hidden" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
        {/* Library Panel */}
        {showLibrary && (
          <motion.div
            initial={{ x: -220, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="absolute left-0 top-0 z-20 w-56 h-full glass-panel-strong border-r border-border/30 p-3 overflow-y-auto"
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3 font-semibold">Node Library</div>
            {(['input', 'output', 'action'] as const).map(cat => (
              <div key={cat} className="mb-3">
                <div className="text-[8px] uppercase tracking-widest text-muted-foreground/60 mb-1 px-1">
                  {CATEGORY_LABELS[cat]}
                </div>
                <div className="space-y-0.5">
                  {NODE_LIBRARY.filter(t => t.category === cat).map((tpl, i) => (
                    <button
                      key={i}
                      onClick={() => addNode(tpl)}
                      className="w-full flex items-center gap-2 p-2 rounded text-xs hover:bg-muted/50 text-left transition-colors"
                    >
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tpl.color }} />
                      <span className="flex-1">{tpl.name}</span>
                      {tpl.protocol && (
                        <span className="text-[7px] uppercase px-1 py-0.5 rounded bg-muted/50 text-muted-foreground">{tpl.protocol}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {/* SVG Cables */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
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
                {/* Port dots */}
                <circle cx={from.x} cy={from.y} r="4" fill="hsl(155, 100%, 50%)" opacity="0.6" />
                <circle cx={to.x} cy={to.y} r="4" fill="hsl(155, 100%, 50%)" opacity="0.6" />
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
              className="w-[210px] rounded-lg glass-panel border cursor-grab active:cursor-grabbing"
              style={{ borderColor: `${node.color}35` }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2 rounded-t-lg" style={{ background: `${node.color}12` }}>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: node.color, boxShadow: `0 0 6px ${node.color}` }} />
                  <span className="text-[10px] font-semibold truncate" style={{ color: node.color }}>{node.name}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {node.protocol && (
                    <span className="text-[7px] uppercase px-1 py-0.5 rounded bg-muted/40 text-muted-foreground">{node.protocol}</span>
                  )}
                  <span className="text-[7px] uppercase px-1 py-0.5 rounded bg-muted/40 text-muted-foreground">{CATEGORY_LABELS[node.category]}</span>
                  <button onClick={() => removeNode(node.id)} className="opacity-40 hover:opacity-100 ml-1">
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
              {/* Ports */}
              <div className="px-3 py-2 space-y-1">
                {node.ports.map(port => (
                  <div key={port.id} className={`flex items-center gap-2 text-[9px] ${port.type === 'output' ? 'justify-end' : ''}`}>
                    {port.type === 'input' && (
                      <div className="w-2.5 h-2.5 rounded-full border" style={{ borderColor: node.color, backgroundColor: `${node.color}25` }} />
                    )}
                    <span className="text-muted-foreground">{port.label}</span>
                    {port.type === 'output' && (
                      <div className="w-2.5 h-2.5 rounded-full border" style={{ borderColor: node.color, backgroundColor: `${node.color}25` }} />
                    )}
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
