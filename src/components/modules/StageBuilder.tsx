import { useRef, useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plus, RotateCw, Grid3X3, ZoomIn, ZoomOut, Move } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface WLEDNode {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  ledCount: number;
}

const MOCK_NODES: WLEDNode[] = [
  { id: '1', name: 'WLED-Main', x: 200, y: 150, width: 160, height: 90, rotation: 0, ledCount: 256 },
  { id: '2', name: 'WLED-Left', x: 50, y: 300, width: 80, height: 120, rotation: -15, ledCount: 144 },
  { id: '3', name: 'WLED-Right', x: 500, y: 250, width: 100, height: 60, rotation: 10, ledCount: 60 },
];

export function StageBuilder() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<WLEDNode[]>(MOCK_NODES);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const animRef = useRef<number>(0);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width / 2;
    const h = canvas.height / 2;
    ctx.save();
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Grid
    if (showGrid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 0.5;
      const gridSize = 20;
      for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
    }

    // Animated background texture (mock media layer)
    const time = Date.now() / 2000;
    for (let i = 0; i < 5; i++) {
      const gx = (Math.sin(time + i * 1.5) * 0.5 + 0.5) * w;
      const gy = (Math.cos(time * 0.7 + i * 2) * 0.5 + 0.5) * h;
      const gradient = ctx.createRadialGradient(gx, gy, 0, gx, gy, 120);
      gradient.addColorStop(0, `hsla(${(time * 30 + i * 60) % 360}, 80%, 50%, 0.15)`);
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }

    // Draw WLED nodes
    nodes.forEach((node) => {
      ctx.save();
      ctx.translate(node.x + node.width / 2, node.y + node.height / 2);
      ctx.rotate((node.rotation * Math.PI) / 180);

      const isSelected = selectedNode === node.id;

      // Node sampled texture preview
      const imgData = ctx.getImageData(
        (node.x + node.width / 2) * 2 - 10,
        (node.y + node.height / 2) * 2 - 10,
        20, 20
      );
      // Sample average color from underlying
      let r = 0, g = 0, b = 0;
      for (let p = 0; p < imgData.data.length; p += 4) {
        r += imgData.data[p]; g += imgData.data[p + 1]; b += imgData.data[p + 2];
      }
      const pixels = imgData.data.length / 4;
      r = Math.floor(r / pixels); g = Math.floor(g / pixels); b = Math.floor(b / pixels);

      // Fill with sampled color + pattern
      ctx.fillStyle = `rgb(${r + 30}, ${g + 30}, ${b + 30})`;
      ctx.strokeStyle = isSelected ? '#00ff66' : 'rgba(0,229,255,0.4)';
      ctx.lineWidth = isSelected ? 2 : 1;

      const hw = node.width / 2;
      const hh = node.height / 2;
      ctx.fillRect(-hw, -hh, node.width, node.height);
      ctx.strokeRect(-hw, -hh, node.width, node.height);

      // LED grid dots
      const cols = Math.ceil(Math.sqrt(node.ledCount * (node.width / node.height)));
      const rows = Math.ceil(node.ledCount / cols);
      const dotSpaceX = node.width / (cols + 1);
      const dotSpaceY = node.height / (rows + 1);
      
      for (let row = 1; row <= rows; row++) {
        for (let col = 1; col <= cols; col++) {
          const dx = -hw + col * dotSpaceX;
          const dy = -hh + row * dotSpaceY;
          const hue = ((col + row) * 15 + Date.now() / 30) % 360;
          ctx.fillStyle = `hsla(${hue}, 90%, 55%, 0.7)`;
          ctx.beginPath();
          ctx.arc(dx, dy, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Label
      ctx.fillStyle = isSelected ? '#00ff66' : 'rgba(255,255,255,0.7)';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.name, 0, hh + 14);

      // Selection glow
      if (isSelected) {
        ctx.shadowColor = '#00ff66';
        ctx.shadowBlur = 12;
        ctx.strokeStyle = '#00ff66';
        ctx.lineWidth = 1;
        ctx.strokeRect(-hw - 3, -hh - 3, node.width + 6, node.height + 6);
        ctx.shadowBlur = 0;
      }

      ctx.restore();
    });

    // Coordinate readout
    if (selectedNode) {
      const sel = nodes.find(n => n.id === selectedNode);
      if (sel) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(8, h - 28, 200, 20);
        ctx.fillStyle = '#00ff66';
        ctx.font = '10px monospace';
        ctx.fillText(`${sel.name}  X:${Math.round(sel.x)} Y:${Math.round(sel.y)} R:${sel.rotation}°`, 14, h - 14);
      }
    }

    ctx.restore();
    animRef.current = requestAnimationFrame(drawCanvas);
  }, [nodes, selectedNode, showGrid]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // 16:9 aspect ratio
    const cw = container.clientWidth;
    const ch = cw * (9 / 16);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    canvas.width = cw * 2;
    canvas.height = ch * 2;

    drawCanvas();
    return () => cancelAnimationFrame(animRef.current);
  }, [drawCanvas, zoom]);

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Hit test nodes in reverse (top first)
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (mx >= n.x && mx <= n.x + n.width && my >= n.y && my <= n.y + n.height) {
        setSelectedNode(n.id);
        setDragging(n.id);
        setDragOffset({ x: mx - n.x, y: my - n.y });
        return;
      }
    }
    setSelectedNode(null);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    setNodes(prev => prev.map(n =>
      n.id === dragging
        ? { ...n, x: Math.max(0, mx - dragOffset.x), y: Math.max(0, my - dragOffset.y) }
        : n
    ));
  };

  const handleCanvasMouseUp = () => {
    setDragging(null);
  };

  const addNode = () => {
    const newNode: WLEDNode = {
      id: String(Date.now()),
      name: `WLED-${nodes.length + 1}`,
      x: 100 + Math.random() * 200,
      y: 100 + Math.random() * 150,
      width: 100,
      height: 60,
      rotation: 0,
      ledCount: 64,
    };
    setNodes(prev => [...prev, newNode]);
    setSelectedNode(newNode.id);
  };

  const rotateSelected = () => {
    if (!selectedNode) return;
    setNodes(prev => prev.map(n =>
      n.id === selectedNode ? { ...n, rotation: (n.rotation + 15) % 360 } : n
    ));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="h-full flex flex-col"
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-3 border-b border-border/30">
        <h2 className="text-sm font-semibold tracking-wider text-foreground mr-4">STAGE BUILDER</h2>
        <Button variant="outline" size="sm" onClick={addNode} className="h-7 text-[10px] gap-1">
          <Plus size={12} /> Add WLED Node
        </Button>
        <Button variant="outline" size="sm" onClick={rotateSelected} disabled={!selectedNode} className="h-7 text-[10px] gap-1">
          <RotateCw size={12} /> Rotate
        </Button>
        <Button
          variant={showGrid ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setShowGrid(!showGrid)}
          className="h-7 text-[10px] gap-1"
        >
          <Grid3X3 size={12} /> Grid
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}>
            <ZoomOut size={14} />
          </Button>
          <span className="text-[10px] text-muted-foreground w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.min(2, z + 0.1))}>
            <ZoomIn size={14} />
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 p-4 overflow-hidden flex items-center justify-center">
        <canvas
          ref={canvasRef}
          className="rounded-lg border border-border/30 cursor-crosshair"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        />
      </div>

      {/* Node Properties */}
      {selectedNode && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="p-3 border-t border-border/30 glass-panel mx-4 mb-4 rounded-lg"
        >
          {(() => {
            const node = nodes.find(n => n.id === selectedNode);
            if (!node) return null;
            return (
              <div className="flex items-center gap-6 text-[10px]">
                <span className="text-primary font-semibold">{node.name}</span>
                <span className="text-muted-foreground">X: <span className="text-foreground font-mono">{Math.round(node.x)}</span></span>
                <span className="text-muted-foreground">Y: <span className="text-foreground font-mono">{Math.round(node.y)}</span></span>
                <span className="text-muted-foreground">W: <span className="text-foreground font-mono">{node.width}</span></span>
                <span className="text-muted-foreground">H: <span className="text-foreground font-mono">{node.height}</span></span>
                <span className="text-muted-foreground">R: <span className="text-foreground font-mono">{node.rotation}°</span></span>
                <span className="text-muted-foreground">LEDs: <span className="text-stokio-cyan font-mono">{node.ledCount}</span></span>
              </div>
            );
          })()}
        </motion.div>
      )}
    </motion.div>
  );
}
