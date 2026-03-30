import { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, RotateCw, Grid3X3, ZoomIn, ZoomOut, Trash2, Copy, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { useFixtureStore, getFixtureTypeIcon, getChannelColor } from '@/store/fixtureStore';

type SegmentOrientation = 'horizontal' | 'vertical' | 'zigzag-h' | 'zigzag-v';

interface WLEDSegment {
  id: string;
  label: string;
  pixelStart: number;
  pixelEnd: number;
  orientation: SegmentOrientation;
  reversed: boolean;
}

interface WLEDNode {
  id: string;
  name: string;
  ip: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  pixelsX: number;
  pixelsY: number;
  segments: WLEDSegment[];
  totalPixels: number;
}

const createDefaultSegment = (index: number, start: number, count: number): WLEDSegment => ({
  id: `seg-${Date.now()}-${index}`,
  label: `Seg ${index + 1}`,
  pixelStart: start,
  pixelEnd: start + count - 1,
  orientation: 'horizontal',
  reversed: false,
});

const MOCK_NODES: WLEDNode[] = [
  {
    id: '1', name: 'WLED-Main', ip: '192.168.1.100', x: 200, y: 120, width: 240, height: 135,
    pixelsX: 16, pixelsY: 16, totalPixels: 256, rotation: 0,
    segments: [
      createDefaultSegment(0, 0, 128),
      createDefaultSegment(1, 128, 128),
    ],
  },
  {
    id: '2', name: 'WLED-Left', ip: '192.168.1.101', x: 40, y: 250, width: 60, height: 180,
    pixelsX: 8, pixelsY: 18, totalPixels: 144, rotation: 0,
    segments: [createDefaultSegment(0, 0, 144)],
  },
  {
    id: '3', name: 'WLED-Right', ip: '192.168.1.102', x: 520, y: 200, width: 120, height: 50,
    pixelsX: 20, pixelsY: 3, totalPixels: 60, rotation: 0,
    segments: [createDefaultSegment(0, 0, 60)],
  },
];

const ORIENTATION_LABELS: Record<SegmentOrientation, string> = {
  'horizontal': '→ Horizontal',
  'vertical': '↓ Vertical',
  'zigzag-h': '⇋ Zigzag H',
  'zigzag-v': '⇵ Zigzag V',
};

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null;

export function StageBuilder() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<WLEDNode[]>(MOCK_NODES);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedFixture, setSelectedFixture] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [draggingFixture, setDraggingFixture] = useState<string | null>(null);
  const [resizing, setResizing] = useState<{ nodeId: string; handle: ResizeHandle; startX: number; startY: number; startNode: WLEDNode } | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [showProperties, setShowProperties] = useState(true);
  const animRef = useRef<number>(0);
  const canvasDims = useRef({ w: 0, h: 0 });
  const fixtureStore = useFixtureStore();
  const stageFixtures = fixtureStore.instances.filter(i => i.onStage);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvasDims.current.w;
    const h = canvasDims.current.h;
    ctx.save();
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, w, h);

    // Grid
    if (showGrid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.025)';
      ctx.lineWidth = 0.5;
      const gridSize = 20;
      for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
    }

    // Animated background texture (mock video layer)
    const time = Date.now() / 2000;
    for (let i = 0; i < 6; i++) {
      const gx = (Math.sin(time + i * 1.5) * 0.5 + 0.5) * w;
      const gy = (Math.cos(time * 0.7 + i * 2) * 0.5 + 0.5) * h;
      const gradient = ctx.createRadialGradient(gx, gy, 0, gx, gy, 140);
      gradient.addColorStop(0, `hsla(${(time * 30 + i * 55) % 360}, 80%, 50%, 0.12)`);
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
      const hw = node.width / 2;
      const hh = node.height / 2;

      // Node background (sampled area indicator)
      ctx.fillStyle = 'rgba(10,10,10,0.6)';
      ctx.fillRect(-hw, -hh, node.width, node.height);

      // Border
      ctx.strokeStyle = isSelected ? '#00ff66' : 'rgba(0,229,255,0.35)';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(-hw, -hh, node.width, node.height);

      // Draw pixel grid based on segments
      const pxW = node.width / node.pixelsX;
      const pxH = node.height / node.pixelsY;
      let segColorIndex = 0;
      const segColors = ['#00e5ff', '#ff2d78', '#00ff66', '#ffaa00', '#aa66ff', '#ff6644'];

      node.segments.forEach((seg) => {
        const segColor = segColors[segColorIndex % segColors.length];
        segColorIndex++;
        const pixelCount = seg.pixelEnd - seg.pixelStart + 1;

        for (let p = 0; p < pixelCount; p++) {
          const globalPixel = seg.pixelStart + p;
          let col: number, row: number;

          if (seg.orientation === 'horizontal') {
            col = globalPixel % node.pixelsX;
            row = Math.floor(globalPixel / node.pixelsX);
          } else if (seg.orientation === 'vertical') {
            row = globalPixel % node.pixelsY;
            col = Math.floor(globalPixel / node.pixelsY);
          } else if (seg.orientation === 'zigzag-h') {
            row = Math.floor(globalPixel / node.pixelsX);
            col = row % 2 === 0 ? globalPixel % node.pixelsX : (node.pixelsX - 1 - (globalPixel % node.pixelsX));
          } else {
            col = Math.floor(globalPixel / node.pixelsY);
            row = col % 2 === 0 ? globalPixel % node.pixelsY : (node.pixelsY - 1 - (globalPixel % node.pixelsY));
          }

          if (seg.reversed) {
            col = node.pixelsX - 1 - col;
          }

          if (col >= 0 && col < node.pixelsX && row >= 0 && row < node.pixelsY) {
            const px = -hw + col * pxW;
            const py = -hh + row * pxH;

            // Animated color per pixel
            const hue = ((col + row) * 18 + Date.now() / 25) % 360;
            ctx.fillStyle = `hsla(${hue}, 85%, 50%, 0.65)`;
            ctx.fillRect(px + 0.5, py + 0.5, pxW - 1, pxH - 1);

            // Segment color border on every pixel
            ctx.strokeStyle = `${segColor}30`;
            ctx.lineWidth = 0.3;
            ctx.strokeRect(px + 0.5, py + 0.5, pxW - 1, pxH - 1);
          }
        }
      });

      // Label below
      ctx.fillStyle = isSelected ? '#00ff66' : 'rgba(255,255,255,0.6)';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${node.name}`, 0, hh + 12);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '7px monospace';
      ctx.fillText(`${node.pixelsX}×${node.pixelsY} (${node.totalPixels}px)`, 0, hh + 20);

      // Resize handles when selected
      if (isSelected) {
        ctx.shadowColor = '#00ff66';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = '#00ff66';
        ctx.lineWidth = 1;
        ctx.strokeRect(-hw - 2, -hh - 2, node.width + 4, node.height + 4);
        ctx.shadowBlur = 0;

        // Draw 8 resize handles
        const handleSize = 5;
        const handles = [
          { x: -hw, y: -hh }, { x: 0, y: -hh }, { x: hw, y: -hh },
          { x: -hw, y: 0 }, { x: hw, y: 0 },
          { x: -hw, y: hh }, { x: 0, y: hh }, { x: hw, y: hh },
        ];
        handles.forEach(pos => {
          ctx.fillStyle = '#00ff66';
          ctx.fillRect(pos.x - handleSize / 2, pos.y - handleSize / 2, handleSize, handleSize);
        });
      }

      ctx.restore();
    });

    // Coord readout
    if (selectedNode) {
      const sel = nodes.find(n => n.id === selectedNode);
      if (sel) {
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        const rW = 280;
        ctx.fillRect(8, h - 30, rW, 22);
        ctx.fillStyle = '#00ff66';
        ctx.font = '10px monospace';
        ctx.fillText(
          `${sel.name}  X:${Math.round(sel.x)} Y:${Math.round(sel.y)} ${sel.width}×${sel.height} R:${sel.rotation}° ${sel.pixelsX}×${sel.pixelsY}px`,
          14, h - 15
        );
      }
    }

    ctx.restore();
    animRef.current = requestAnimationFrame(drawCanvas);
  }, [nodes, selectedNode, showGrid]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const cw = container.clientWidth;
    const ch = cw * (9 / 16);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    canvas.width = cw * 2;
    canvas.height = ch * 2;
    canvasDims.current = { w: cw, h: ch };

    drawCanvas();
    return () => cancelAnimationFrame(animRef.current);
  }, [drawCanvas, zoom]);

  const getResizeHandle = (mx: number, my: number, node: WLEDNode): ResizeHandle => {
    const tol = 8;
    const onLeft = Math.abs(mx - node.x) < tol;
    const onRight = Math.abs(mx - (node.x + node.width)) < tol;
    const onTop = Math.abs(my - node.y) < tol;
    const onBottom = Math.abs(my - (node.y + node.height)) < tol;

    if (onTop && onLeft) return 'nw';
    if (onTop && onRight) return 'ne';
    if (onBottom && onLeft) return 'sw';
    if (onBottom && onRight) return 'se';
    if (onTop) return 'n';
    if (onBottom) return 's';
    if (onLeft) return 'w';
    if (onRight) return 'e';
    return null;
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      // Check resize handles first if selected
      if (selectedNode === n.id) {
        const handle = getResizeHandle(mx, my, n);
        if (handle) {
          setResizing({ nodeId: n.id, handle, startX: mx, startY: my, startNode: { ...n } });
          return;
        }
      }
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
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (resizing) {
      const { handle, startX, startY, startNode } = resizing;
      const dx = mx - startX;
      const dy = my - startY;

      setNodes(prev => prev.map(n => {
        if (n.id !== resizing.nodeId) return n;
        let { x, y, width, height } = startNode;
        const minW = 30, minH = 20;

        if (handle?.includes('e')) width = Math.max(minW, width + dx);
        if (handle?.includes('w')) { x = x + dx; width = Math.max(minW, width - dx); }
        if (handle?.includes('s')) height = Math.max(minH, height + dy);
        if (handle?.includes('n')) { y = y + dy; height = Math.max(minH, height - dy); }

        return { ...n, x, y, width, height };
      }));
      return;
    }

    if (dragging) {
      setNodes(prev => prev.map(n =>
        n.id === dragging
          ? { ...n, x: Math.max(0, mx - dragOffset.x), y: Math.max(0, my - dragOffset.y) }
          : n
      ));
    }
  };

  const handleCanvasMouseUp = () => {
    setDragging(null);
    setResizing(null);
  };

  const addNode = () => {
    const id = String(Date.now());
    const newNode: WLEDNode = {
      id,
      name: `WLED-${nodes.length + 1}`,
      ip: `192.168.1.${110 + nodes.length}`,
      x: 100 + Math.random() * 200,
      y: 80 + Math.random() * 150,
      width: 120,
      height: 68,
      rotation: 0,
      pixelsX: 16,
      pixelsY: 9,
      totalPixels: 144,
      segments: [createDefaultSegment(0, 0, 144)],
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

  const duplicateSelected = () => {
    if (!selectedNode) return;
    const source = nodes.find(n => n.id === selectedNode);
    if (!source) return;
    const id = String(Date.now());
    const newNode: WLEDNode = {
      ...source,
      id,
      name: `${source.name}-copy`,
      x: source.x + 30,
      y: source.y + 30,
      segments: source.segments.map(s => ({ ...s, id: `seg-${Date.now()}-${Math.random()}` })),
    };
    setNodes(prev => [...prev, newNode]);
    setSelectedNode(id);
  };

  const deleteSelected = () => {
    if (!selectedNode) return;
    setNodes(prev => prev.filter(n => n.id !== selectedNode));
    setSelectedNode(null);
  };

  const updateNode = (id: string, updates: Partial<WLEDNode>) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
  };

  const updateSegment = (nodeId: string, segId: string, updates: Partial<WLEDSegment>) => {
    setNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n;
      return { ...n, segments: n.segments.map(s => s.id === segId ? { ...s, ...updates } : s) };
    }));
  };

  const addSegment = (nodeId: string) => {
    setNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n;
      const lastEnd = n.segments.length > 0 ? n.segments[n.segments.length - 1].pixelEnd + 1 : 0;
      const remaining = Math.max(1, n.totalPixels - lastEnd);
      return {
        ...n,
        segments: [...n.segments, createDefaultSegment(n.segments.length, lastEnd, remaining)],
      };
    }));
  };

  const removeSegment = (nodeId: string, segId: string) => {
    setNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n;
      return { ...n, segments: n.segments.filter(s => s.id !== segId) };
    }));
  };

  const selected = nodes.find(n => n.id === selectedNode);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-3 border-b border-border/30 flex-wrap">
        <h2 className="text-sm font-semibold tracking-wider text-foreground mr-3">STAGE BUILDER</h2>
        <Button variant="outline" size="sm" onClick={addNode} className="h-7 text-[10px] gap-1">
          <Plus size={12} /> Add WLED Node
        </Button>
        <Button variant="outline" size="sm" onClick={rotateSelected} disabled={!selectedNode} className="h-7 text-[10px] gap-1">
          <RotateCw size={12} /> Rotate
        </Button>
        <Button variant="outline" size="sm" onClick={duplicateSelected} disabled={!selectedNode} className="h-7 text-[10px] gap-1">
          <Copy size={12} /> Duplicate
        </Button>
        <Button variant="outline" size="sm" onClick={deleteSelected} disabled={!selectedNode} className="h-7 text-[10px] gap-1 text-destructive hover:text-destructive">
          <Trash2 size={12} /> Delete
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

      <div className="flex-1 flex overflow-hidden">
        {/* Canvas */}
        <div ref={containerRef} className="flex-1 p-4 overflow-hidden flex items-start justify-center">
          <canvas
            ref={canvasRef}
            className="rounded-lg border border-border/30 cursor-crosshair"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
          />
        </div>

        {/* Properties Panel */}
        <AnimatePresence>
          {showProperties && selected && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-l border-border/30 overflow-y-auto overflow-x-hidden bg-card/30"
            >
              <div className="w-[280px] p-3 space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-primary font-semibold">Node Properties</span>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowProperties(false)}>
                    <ChevronDown size={12} className="rotate-90" />
                  </Button>
                </div>

                {/* Name & IP */}
                <div className="space-y-2">
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1 block">Name</label>
                    <Input
                      value={selected.name}
                      onChange={(e) => updateNode(selected.id, { name: e.target.value })}
                      className="h-7 text-xs bg-muted/30 border-border/30"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1 block">IP Address</label>
                    <Input
                      value={selected.ip}
                      onChange={(e) => updateNode(selected.id, { ip: e.target.value })}
                      className="h-7 text-xs bg-muted/30 border-border/30 font-mono"
                    />
                  </div>
                </div>

                {/* Pixel Grid */}
                <div className="glass-panel p-3 space-y-2">
                  <span className="text-[9px] uppercase tracking-widest text-stokio-cyan font-semibold">Pixel Matrix</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">Pixels X</label>
                      <Input
                        type="number"
                        min={1}
                        max={256}
                        value={selected.pixelsX}
                        onChange={(e) => {
                          const v = Math.max(1, Number(e.target.value));
                          updateNode(selected.id, { pixelsX: v, totalPixels: v * selected.pixelsY });
                        }}
                        className="h-7 text-xs bg-muted/30 border-border/30 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">Pixels Y</label>
                      <Input
                        type="number"
                        min={1}
                        max={256}
                        value={selected.pixelsY}
                        onChange={(e) => {
                          const v = Math.max(1, Number(e.target.value));
                          updateNode(selected.id, { pixelsY: v, totalPixels: selected.pixelsX * v });
                        }}
                        className="h-7 text-xs bg-muted/30 border-border/30 font-mono"
                      />
                    </div>
                  </div>
                  <div className="text-[9px] font-mono text-muted-foreground text-center">
                    Total: <span className="text-stokio-cyan">{selected.totalPixels}</span> pixels
                  </div>
                </div>

                {/* Position & Size */}
                <div className="glass-panel p-3 space-y-2">
                  <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">Transform</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">X</label>
                      <Input type="number" value={Math.round(selected.x)} onChange={(e) => updateNode(selected.id, { x: Number(e.target.value) })}
                        className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                    </div>
                    <div>
                      <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">Y</label>
                      <Input type="number" value={Math.round(selected.y)} onChange={(e) => updateNode(selected.id, { y: Number(e.target.value) })}
                        className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                    </div>
                    <div>
                      <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">Width</label>
                      <Input type="number" min={30} value={selected.width} onChange={(e) => updateNode(selected.id, { width: Math.max(30, Number(e.target.value)) })}
                        className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                    </div>
                    <div>
                      <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">Height</label>
                      <Input type="number" min={20} value={selected.height} onChange={(e) => updateNode(selected.id, { height: Math.max(20, Number(e.target.value)) })}
                        className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">Rotation: {selected.rotation}°</label>
                    <Slider value={[selected.rotation]} onValueChange={([v]) => updateNode(selected.id, { rotation: v })} min={0} max={359} step={1} />
                  </div>
                </div>

                {/* Segments */}
                <div className="glass-panel p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] uppercase tracking-widest text-stokio-pink font-semibold">Segments</span>
                    <Button variant="ghost" size="sm" className="h-5 text-[9px] px-2" onClick={() => addSegment(selected.id)}>
                      <Plus size={10} /> Add
                    </Button>
                  </div>

                  {selected.segments.map((seg, idx) => {
                    const segColors = ['border-stokio-cyan/30', 'border-stokio-pink/30', 'border-primary/30', 'border-yellow-500/30', 'border-purple-500/30'];
                    return (
                      <div key={seg.id} className={`p-2 rounded border ${segColors[idx % segColors.length]} bg-muted/20 space-y-2`}>
                        <div className="flex items-center justify-between">
                          <Input
                            value={seg.label}
                            onChange={(e) => updateSegment(selected.id, seg.id, { label: e.target.value })}
                            className="h-5 text-[10px] bg-transparent border-0 p-0 font-semibold w-20"
                          />
                          {selected.segments.length > 1 && (
                            <button onClick={() => removeSegment(selected.id, seg.id)} className="text-muted-foreground hover:text-destructive">
                              <Trash2 size={10} />
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <label className="text-[7px] uppercase text-muted-foreground">Start Pixel</label>
                            <Input type="number" min={0} value={seg.pixelStart}
                              onChange={(e) => updateSegment(selected.id, seg.id, { pixelStart: Number(e.target.value) })}
                              className="h-6 text-[10px] bg-muted/30 border-border/30 font-mono" />
                          </div>
                          <div>
                            <label className="text-[7px] uppercase text-muted-foreground">End Pixel</label>
                            <Input type="number" min={0} value={seg.pixelEnd}
                              onChange={(e) => updateSegment(selected.id, seg.id, { pixelEnd: Number(e.target.value) })}
                              className="h-6 text-[10px] bg-muted/30 border-border/30 font-mono" />
                          </div>
                        </div>
                        <div>
                          <label className="text-[7px] uppercase text-muted-foreground">Orientation</label>
                          <select
                            value={seg.orientation}
                            onChange={(e) => updateSegment(selected.id, seg.id, { orientation: e.target.value as SegmentOrientation })}
                            className="w-full h-6 rounded bg-muted/30 border border-border/30 text-[10px] px-1 text-foreground"
                          >
                            {Object.entries(ORIENTATION_LABELS).map(([k, v]) => (
                              <option key={k} value={k}>{v}</option>
                            ))}
                          </select>
                        </div>
                        <label className="flex items-center gap-1.5 text-[9px] text-muted-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            checked={seg.reversed}
                            onChange={(e) => updateSegment(selected.id, seg.id, { reversed: e.target.checked })}
                            className="rounded border-border"
                          />
                          Reversed direction
                        </label>
                        <div className="text-[8px] font-mono text-muted-foreground">
                          {seg.pixelEnd - seg.pixelStart + 1} pixels
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom status */}
      {!showProperties && selectedNode && (
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="p-2 border-t border-border/30 flex items-center justify-between px-4"
        >
          <div className="text-[10px] text-muted-foreground">
            Selected: <span className="text-primary font-semibold">{selected?.name}</span>
          </div>
          <Button variant="ghost" size="sm" className="h-5 text-[9px]" onClick={() => setShowProperties(true)}>
            Show Properties →
          </Button>
        </motion.div>
      )}
    </motion.div>
  );
}
