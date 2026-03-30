import { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, RotateCw, Grid3X3, ZoomIn, ZoomOut, Trash2, Copy, ChevronDown, Film, Droplets, Music, Mic, Volume2, Monitor, Save, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { useFixtureStore, getFixtureTypeIcon, getChannelColor } from '@/store/fixtureStore';
import { useMediaStore, getEmbedUrl } from '@/store/mediaStore';
import { AudioVisualizerEngine, PRESET_LABELS, INPUT_LABELS, type VisualizerPreset, type AudioInputSource } from '@/lib/audioVisualizer';
import { exportMappingPreset, parseMappingPreset, downloadJson, openJsonFile } from '@/lib/backupRestore';
import { toast } from 'sonner';

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
  // SignalRGB-style settings
  blurAmount: number;       // 0-100 — how much to blur/smooth the sampled colors
  sampleRadius: number;     // 1-50 — radius of the area each pixel samples from (in canvas px)
  interpolationSpeed: number; // 1-100 — how fast colors transition (temporal smoothing)
}

// DMX fixture on the mapping canvas with its own blur/radius
interface MappingFixture {
  id: string;
  fixtureInstanceId: string;
  x: number;
  y: number;
  radius: number;           // visual size on canvas
  blurAmount: number;       // 0-100
  sampleRadius: number;     // 1-50
  interpolationSpeed: number;
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
    blurAmount: 20, sampleRadius: 5, interpolationSpeed: 50,
    segments: [
      createDefaultSegment(0, 0, 128),
      createDefaultSegment(1, 128, 128),
    ],
  },
  {
    id: '2', name: 'WLED-Left', ip: '192.168.1.101', x: 40, y: 250, width: 60, height: 180,
    pixelsX: 8, pixelsY: 18, totalPixels: 144, rotation: 0,
    blurAmount: 30, sampleRadius: 8, interpolationSpeed: 50,
    segments: [createDefaultSegment(0, 0, 144)],
  },
  {
    id: '3', name: 'WLED-Right', ip: '192.168.1.102', x: 520, y: 200, width: 120, height: 50,
    pixelsX: 20, pixelsY: 3, totalPixels: 60, rotation: 0,
    blurAmount: 10, sampleRadius: 3, interpolationSpeed: 50,
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
type SelectionType = 'node' | 'fixture' | 'mapping-fixture' | null;

type BackgroundSource = 'video' | 'visualizer' | 'texture';

export function StageBuilder() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const vizEngineRef = useRef<AudioVisualizerEngine>(new AudioVisualizerEngine());
  const vizCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [nodes, setNodes] = useState<WLEDNode[]>(MOCK_NODES);
  const [mappingFixtures, setMappingFixtures] = useState<MappingFixture[]>([]);
  const [selectionType, setSelectionType] = useState<SelectionType>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ type: SelectionType; id: string } | null>(null);
  const [resizing, setResizing] = useState<{ nodeId: string; handle: ResizeHandle; startX: number; startY: number; startNode: WLEDNode } | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [showProperties, setShowProperties] = useState(true);
  const animRef = useRef<number>(0);
  const canvasDims = useRef({ w: 0, h: 0 });
  const fixtureStore = useFixtureStore();
  const mediaStore = useMediaStore();
  const stageFixtures = fixtureStore.instances.filter(i => i.onStage);

  // Background source state
  const [bgSource, setBgSource] = useState<BackgroundSource>('texture');
  const [vizPreset, setVizPreset] = useState<VisualizerPreset>('plasma-wave');
  const [vizAudioInput, setVizAudioInput] = useState<AudioInputSource>('microphone');
  const [vizSensitivity, setVizSensitivity] = useState(1.0);
  const [vizColorShift, setVizColorShift] = useState(0);
  const [vizRunning, setVizRunning] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [showBgPanel, setShowBgPanel] = useState(false);

  // Get active media item for video background
  const activeItem = mediaStore.items.find(i => i.id === mediaStore.activeItemId);
  const isVideoPlaying = mediaStore.isPlaying && activeItem?.type === 'video';

  // Auto-switch to video source when video starts playing
  useEffect(() => {
    if (isVideoPlaying) setBgSource('video');
  }, [isVideoPlaying]);

  // Load audio devices
  useEffect(() => {
    AudioVisualizerEngine.getInputDevices().then(setAudioDevices).catch(() => {});
  }, []);

  // Sync viz engine settings
  useEffect(() => {
    const engine = vizEngineRef.current;
    engine.preset = vizPreset;
    engine.sensitivity = vizSensitivity;
    engine.colorShift = vizColorShift;
  }, [vizPreset, vizSensitivity, vizColorShift]);

  // Create offscreen canvas for visualizer
  useEffect(() => {
    if (!vizCanvasRef.current) {
      vizCanvasRef.current = document.createElement('canvas');
      vizCanvasRef.current.width = 640;
      vizCanvasRef.current.height = 360;
    }
    return () => { vizEngineRef.current.destroy(); };
  }, []);

  const startVisualizer = async () => {
    try {
      await vizEngineRef.current.start(vizAudioInput, selectedDeviceId || undefined);
      setVizRunning(true);
      setBgSource('visualizer');
    } catch (err) {
      console.error('Failed to start visualizer:', err);
    }
  };

  const stopVisualizer = () => {
    vizEngineRef.current.stop();
    setVizRunning(false);
    if (bgSource === 'visualizer') setBgSource('texture');
  };

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

    // Background source rendering
    const video = videoRef.current;
    if (bgSource === 'video' && video && isVideoPlaying && video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, w, h);
    } else if (bgSource === 'visualizer' && vizCanvasRef.current) {
      // Render visualizer to offscreen canvas, then draw to main
      const vizCanvas = vizCanvasRef.current;
      const vizCtx = vizCanvas.getContext('2d');
      if (vizCtx) {
        vizEngineRef.current.render(vizCtx, vizCanvas.width, vizCanvas.height);
        ctx.drawImage(vizCanvas, 0, 0, w, h);
      }
    } else {
      // Animated background texture (fallback)
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
    }

    // Sample background image data for color-picking
    let bgImageData: ImageData | null = null;
    try {
      bgImageData = ctx.getImageData(0, 0, w * 2, h * 2);
    } catch (_) { /* security error with cross-origin video */ }

    const sampleBgColor = (canvasX: number, canvasY: number, sampleRad: number, blurAmt: number): [number, number, number] => {
      if (!bgImageData) return [40, 40, 40];
      // Convert to pixel coords (canvas is 2x)
      const cx = Math.round(canvasX * 2);
      const cy = Math.round(canvasY * 2);
      const rad = Math.max(1, Math.round(sampleRad * 2));
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      const stride = bgImageData.width * 4;
      const step = blurAmt > 30 ? 2 : 1; // skip pixels for large blur for perf
      for (let dy = -rad; dy <= rad; dy += step) {
        for (let dx = -rad; dx <= rad; dx += step) {
          const px = cx + dx;
          const py = cy + dy;
          if (px < 0 || py < 0 || px >= bgImageData.width || py >= bgImageData.height) continue;
          const idx = py * stride + px * 4;
          rSum += bgImageData.data[idx];
          gSum += bgImageData.data[idx + 1];
          bSum += bgImageData.data[idx + 2];
          count++;
        }
      }
      if (count === 0) return [40, 40, 40];
      return [Math.round(rSum / count), Math.round(gSum / count), Math.round(bSum / count)];
    };

    // Draw WLED nodes
    nodes.forEach((node) => {
      ctx.save();
      ctx.translate(node.x + node.width / 2, node.y + node.height / 2);
      ctx.rotate((node.rotation * Math.PI) / 180);

      const isSelected = selectionType === 'node' && selectedId === node.id;
      const hw = node.width / 2;
      const hh = node.height / 2;

      // Node background (semi-transparent so grid lines show)
      ctx.fillStyle = 'rgba(10,10,10,0.3)';
      ctx.fillRect(-hw, -hh, node.width, node.height);

      // Border
      ctx.strokeStyle = isSelected ? '#00ff66' : 'rgba(0,229,255,0.35)';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(-hw, -hh, node.width, node.height);

      // Draw pixel grid — each cell samples its color from the video/background
      const pxW = node.width / node.pixelsX;
      const pxH = node.height / node.pixelsY;
      let segColorIndex = 0;
      const segColors = ['#00e5ff', '#ff2d78', '#00ff66', '#ffaa00', '#aa66ff', '#ff6644'];

      // Pre-compute node center in canvas coords (before rotation, but we need world coords)
      const cosR = Math.cos((node.rotation * Math.PI) / 180);
      const sinR = Math.sin((node.rotation * Math.PI) / 180);
      const nodeCX = node.x + node.width / 2;
      const nodeCY = node.y + node.height / 2;

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

          if (seg.reversed) col = node.pixelsX - 1 - col;

          if (col >= 0 && col < node.pixelsX && row >= 0 && row < node.pixelsY) {
            const localX = -hw + col * pxW + pxW / 2;
            const localY = -hh + row * pxH + pxH / 2;
            // Transform local pixel center to world canvas coords
            const worldX = nodeCX + localX * cosR - localY * sinR;
            const worldY = nodeCY + localX * sinR + localY * cosR;

            // Sample color from background at this world position
            const [r, g, b] = sampleBgColor(worldX, worldY, node.sampleRadius, node.blurAmount);

            const px = -hw + col * pxW;
            const py = -hh + row * pxH;
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(px + 0.5, py + 0.5, pxW - 1, pxH - 1);
            // Grid line per segment
            ctx.strokeStyle = `${segColor}30`;
            ctx.lineWidth = 0.3;
            ctx.strokeRect(px + 0.5, py + 0.5, pxW - 1, pxH - 1);
          }
        }
      });

      // Label
      ctx.fillStyle = isSelected ? '#00ff66' : 'rgba(255,255,255,0.6)';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${node.name}`, 0, hh + 12);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '7px monospace';
      ctx.fillText(`${node.pixelsX}×${node.pixelsY} (${node.totalPixels}px)`, 0, hh + 20);
      if (node.blurAmount > 0 || node.sampleRadius > 1) {
        ctx.fillStyle = 'rgba(0,229,255,0.4)';
        ctx.fillText(`blur:${node.blurAmount} rad:${node.sampleRadius}`, 0, hh + 28);
      }

      // Selection handles
      if (isSelected) {
        ctx.shadowColor = '#00ff66';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = '#00ff66';
        ctx.lineWidth = 1;
        ctx.strokeRect(-hw - 2, -hh - 2, node.width + 4, node.height + 4);
        ctx.shadowBlur = 0;
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

    // Draw DMX fixtures on stage (legacy circles)
    stageFixtures.forEach((inst) => {
      const def = fixtureStore.definitions.find(d => d.id === inst.definitionId);
      if (!def) return;
      // Skip if this fixture has a mapping fixture entry (drawn separately)
      if (mappingFixtures.some(mf => mf.fixtureInstanceId === inst.id)) return;

      const isSelected2 = selectionType === 'fixture' && selectedId === inst.id;
      const x = inst.stageX;
      const y = inst.stageY;
      const w2 = inst.stageWidth;
      const h2 = inst.stageHeight;

      ctx.save();
      ctx.fillStyle = isSelected2 ? 'rgba(255,45,120,0.25)' : 'rgba(255,255,255,0.08)';
      ctx.strokeStyle = isSelected2 ? '#ff2d78' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = isSelected2 ? 2 : 1;
      ctx.beginPath();
      ctx.arc(x + w2 / 2, y + h2 / 2, w2 / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (isSelected2) {
        ctx.shadowColor = '#ff2d78';
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      ctx.fillStyle = isSelected2 ? '#ff2d78' : 'rgba(255,255,255,0.7)';
      ctx.font = `${Math.max(10, w2 * 0.45)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(getFixtureTypeIcon(def.type), x + w2 / 2, y + h2 / 2);

      ctx.fillStyle = isSelected2 ? '#ff2d78' : 'rgba(255,255,255,0.5)';
      ctx.font = '8px Inter, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(inst.name, x + w2 / 2, y + h2 + 3);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '7px monospace';
      ctx.fillText(`U${inst.universe}.${inst.dmxAddress}`, x + w2 / 2, y + h2 + 12);

      ctx.restore();
    });

    // Draw mapping fixtures (DMX fixtures with blur/radius on the mapping canvas)
    mappingFixtures.forEach((mf) => {
      const inst = fixtureStore.instances.find(i => i.id === mf.fixtureInstanceId);
      const def = inst ? fixtureStore.definitions.find(d => d.id === inst.definitionId) : null;
      if (!inst || !def) return;

      const isSelected2 = selectionType === 'mapping-fixture' && selectedId === mf.id;

      ctx.save();

      // Sample radius indicator (outer ring)
      if (mf.sampleRadius > 1) {
        ctx.strokeStyle = `rgba(0,229,255,${isSelected2 ? 0.4 : 0.15})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(mf.x, mf.y, mf.radius + mf.sampleRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Blur glow
      if (mf.blurAmount > 0) {
        const blurGrad = ctx.createRadialGradient(mf.x, mf.y, mf.radius * 0.5, mf.x, mf.y, mf.radius + mf.blurAmount / 3);
        blurGrad.addColorStop(0, `rgba(0,229,255,${Math.min(0.3, mf.blurAmount / 200)})`);
        blurGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = blurGrad;
        ctx.beginPath();
        ctx.arc(mf.x, mf.y, mf.radius + mf.blurAmount / 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Fixture circle — sample color from video/background
      const [mr, mg, mb] = sampleBgColor(mf.x, mf.y, mf.sampleRadius, mf.blurAmount);
      ctx.fillStyle = isSelected2
        ? `rgba(${mr},${mg},${mb},0.85)`
        : `rgba(${mr},${mg},${mb},0.7)`;
      ctx.strokeStyle = isSelected2 ? '#00e5ff' : 'rgba(0,229,255,0.5)';
      ctx.lineWidth = isSelected2 ? 2 : 1;
      ctx.beginPath();
      ctx.arc(mf.x, mf.y, mf.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (isSelected2) {
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Icon
      ctx.fillStyle = isSelected2 ? '#00e5ff' : 'rgba(255,255,255,0.8)';
      ctx.font = `${Math.max(10, mf.radius * 0.7)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(getFixtureTypeIcon(def.type), mf.x, mf.y);

      // Label
      ctx.fillStyle = isSelected2 ? '#00e5ff' : 'rgba(255,255,255,0.5)';
      ctx.font = '8px Inter, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(inst.name, mf.x, mf.y + mf.radius + 3);
      if (mf.blurAmount > 0 || mf.sampleRadius > 1) {
        ctx.fillStyle = 'rgba(0,229,255,0.4)';
        ctx.font = '7px monospace';
        ctx.fillText(`b:${mf.blurAmount} r:${mf.sampleRadius}`, mf.x, mf.y + mf.radius + 12);
      }

      ctx.restore();
    });

    // Coord readout
    if (selectionType === 'node' && selectedId) {
      const sel = nodes.find(n => n.id === selectedId);
      if (sel) {
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(8, h - 30, 320, 22);
        ctx.fillStyle = '#00ff66';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(
          `${sel.name}  X:${Math.round(sel.x)} Y:${Math.round(sel.y)} ${sel.width}×${sel.height} R:${sel.rotation}° blur:${sel.blurAmount}`,
          14, h - 15
        );
      }
    }

    ctx.restore();
    animRef.current = requestAnimationFrame(drawCanvas);
  }, [nodes, selectionType, selectedId, showGrid, stageFixtures, mappingFixtures, fixtureStore, isVideoPlaying, bgSource]);

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

  // Video element sync
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isVideoPlaying && activeItem?.sourceType === 'file') {
      video.src = activeItem.src;
      video.play().catch(() => {});
    } else if (!isVideoPlaying) {
      video.pause();
    }
  }, [isVideoPlaying, activeItem]);

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

    // Check mapping fixtures first
    for (let i = mappingFixtures.length - 1; i >= 0; i--) {
      const mf = mappingFixtures[i];
      const dist = Math.sqrt((mx - mf.x) ** 2 + (my - mf.y) ** 2);
      if (dist <= mf.radius + 4) {
        setSelectionType('mapping-fixture');
        setSelectedId(mf.id);
        setDragging({ type: 'mapping-fixture', id: mf.id });
        setDragOffset({ x: mx - mf.x, y: my - mf.y });
        return;
      }
    }

    // Check stage fixtures
    for (let i = stageFixtures.length - 1; i >= 0; i--) {
      const f = stageFixtures[i];
      if (mappingFixtures.some(mf => mf.fixtureInstanceId === f.id)) continue;
      const cx = f.stageX + f.stageWidth / 2;
      const cy = f.stageY + f.stageHeight / 2;
      const dist = Math.sqrt((mx - cx) ** 2 + (my - cy) ** 2);
      if (dist <= f.stageWidth / 2 + 4) {
        setSelectionType('fixture');
        setSelectedId(f.id);
        setDragging({ type: 'fixture', id: f.id });
        setDragOffset({ x: mx - f.stageX, y: my - f.stageY });
        return;
      }
    }

    // Check WLED nodes
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (selectionType === 'node' && selectedId === n.id) {
        const handle = getResizeHandle(mx, my, n);
        if (handle) {
          setResizing({ nodeId: n.id, handle, startX: mx, startY: my, startNode: { ...n } });
          return;
        }
      }
      if (mx >= n.x && mx <= n.x + n.width && my >= n.y && my <= n.y + n.height) {
        setSelectionType('node');
        setSelectedId(n.id);
        setDragging({ type: 'node', id: n.id });
        setDragOffset({ x: mx - n.x, y: my - n.y });
        return;
      }
    }
    setSelectionType(null);
    setSelectedId(null);
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
      if (dragging.type === 'node') {
        setNodes(prev => prev.map(n =>
          n.id === dragging.id ? { ...n, x: Math.max(0, mx - dragOffset.x), y: Math.max(0, my - dragOffset.y) } : n
        ));
      } else if (dragging.type === 'fixture') {
        fixtureStore.updateInstance(dragging.id, {
          stageX: Math.max(0, mx - dragOffset.x),
          stageY: Math.max(0, my - dragOffset.y),
        });
      } else if (dragging.type === 'mapping-fixture') {
        setMappingFixtures(prev => prev.map(mf =>
          mf.id === dragging.id ? { ...mf, x: Math.max(0, mx - dragOffset.x), y: Math.max(0, my - dragOffset.y) } : mf
        ));
      }
    }
  };

  const handleCanvasMouseUp = () => {
    setDragging(null);
    setResizing(null);
  };

  const addNode = () => {
    const id = String(Date.now());
    const newNode: WLEDNode = {
      id, name: `WLED-${nodes.length + 1}`, ip: `192.168.1.${110 + nodes.length}`,
      x: 100 + Math.random() * 200, y: 80 + Math.random() * 150,
      width: 120, height: 68, rotation: 0, pixelsX: 16, pixelsY: 9, totalPixels: 144,
      blurAmount: 15, sampleRadius: 5, interpolationSpeed: 50,
      segments: [createDefaultSegment(0, 0, 144)],
    };
    setNodes(prev => [...prev, newNode]);
    setSelectionType('node');
    setSelectedId(newNode.id);
  };

  const addMappingFixture = (fixtureInstanceId: string) => {
    if (mappingFixtures.some(mf => mf.fixtureInstanceId === fixtureInstanceId)) return;
    const mf: MappingFixture = {
      id: `mf-${Date.now()}`,
      fixtureInstanceId,
      x: 300 + Math.random() * 100,
      y: 200 + Math.random() * 80,
      radius: 20,
      blurAmount: 25,
      sampleRadius: 15,
      interpolationSpeed: 50,
    };
    setMappingFixtures(prev => [...prev, mf]);
    setSelectionType('mapping-fixture');
    setSelectedId(mf.id);
  };

  const rotateSelected = () => {
    if (selectionType !== 'node' || !selectedId) return;
    setNodes(prev => prev.map(n =>
      n.id === selectedId ? { ...n, rotation: (n.rotation + 15) % 360 } : n
    ));
  };

  const duplicateSelected = () => {
    if (selectionType !== 'node' || !selectedId) return;
    const source = nodes.find(n => n.id === selectedId);
    if (!source) return;
    const id = String(Date.now());
    const newNode: WLEDNode = {
      ...source, id, name: `${source.name}-copy`, x: source.x + 30, y: source.y + 30,
      segments: source.segments.map(s => ({ ...s, id: `seg-${Date.now()}-${Math.random()}` })),
    };
    setNodes(prev => [...prev, newNode]);
    setSelectionType('node');
    setSelectedId(id);
  };

  const deleteSelected = () => {
    if (selectionType === 'node' && selectedId) {
      setNodes(prev => prev.filter(n => n.id !== selectedId));
    } else if (selectionType === 'mapping-fixture' && selectedId) {
      setMappingFixtures(prev => prev.filter(mf => mf.id !== selectedId));
    }
    setSelectionType(null);
    setSelectedId(null);
  };

  const updateNode = (id: string, updates: Partial<WLEDNode>) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
  };

  const updateMappingFixture = (id: string, updates: Partial<MappingFixture>) => {
    setMappingFixtures(prev => prev.map(mf => mf.id === id ? { ...mf, ...updates } : mf));
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
      return { ...n, segments: [...n.segments, createDefaultSegment(n.segments.length, lastEnd, remaining)] };
    }));
  };

  const removeSegment = (nodeId: string, segId: string) => {
    setNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n;
      return { ...n, segments: n.segments.filter(s => s.id !== segId) };
    }));
  };

  const saveMapping = () => {
    const name = `mapping-${new Date().toISOString().slice(0, 16).replace('T', '_')}`;
    const json = exportMappingPreset(name, nodes, mappingFixtures);
    downloadJson(json, `${name}.json`);
    toast.success('Mapping preset saved');
  };

  const openMapping = async () => {
    try {
      const json = await openJsonFile();
      const result = parseMappingPreset(json);
      if (typeof result === 'string') { toast.error(result); return; }
      setNodes(result.nodes as WLEDNode[]);
      setMappingFixtures(result.mappingFixtures as MappingFixture[]);
      setSelectionType(null);
      setSelectedId(null);
      toast.success(`Loaded mapping: ${result.name}`);
    } catch { toast.error('No file selected'); }
  };

  const selectedNode = selectionType === 'node' ? nodes.find(n => n.id === selectedId) : null;
  const selectedMF = selectionType === 'mapping-fixture' ? mappingFixtures.find(mf => mf.id === selectedId) : null;
  const selectedMFInst = selectedMF ? fixtureStore.instances.find(i => i.id === selectedMF.fixtureInstanceId) : null;
  const selectedMFDef = selectedMFInst ? fixtureStore.definitions.find(d => d.id === selectedMFInst.definitionId) : null;

  // Get RGBW-capable fixtures for adding to mapping
  const rgbwFixtures = fixtureStore.instances.filter(inst => {
    const def = fixtureStore.definitions.find(d => d.id === inst.definitionId);
    return def && ['rgb', 'rgbw', 'rgbww', 'rgbwc'].includes(def.colorSystem);
  });

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
      {/* Hidden video element for canvas rendering */}
      <video ref={videoRef} className="hidden" muted loop playsInline crossOrigin="anonymous" />

      {/* Toolbar */}
      <div className="flex items-center gap-2 p-3 border-b border-border/30 flex-wrap">
        <h2 className="text-sm font-semibold tracking-wider text-foreground mr-3">PIXEL-VIDEO-MAPPING</h2>
        <Button variant="outline" size="sm" onClick={addNode} className="h-7 text-[10px] gap-1">
          <Plus size={12} /> WLED Node
        </Button>

        {/* Add DMX fixture dropdown */}
        {rgbwFixtures.length > 0 && (
          <select className="h-7 text-[9px] bg-muted/30 border border-border/30 rounded px-2 text-foreground"
            value="" onChange={e => { if (e.target.value) addMappingFixture(e.target.value); }}>
            <option value="" disabled>+ DMX Fixture</option>
            {rgbwFixtures.filter(f => !mappingFixtures.some(mf => mf.fixtureInstanceId === f.id)).map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        )}

        <Button variant="outline" size="sm" onClick={rotateSelected} disabled={selectionType !== 'node'} className="h-7 text-[10px] gap-1">
          <RotateCw size={12} /> Rotate
        </Button>
        <Button variant="outline" size="sm" onClick={duplicateSelected} disabled={selectionType !== 'node'} className="h-7 text-[10px] gap-1">
          <Copy size={12} /> Duplicate
        </Button>
        <Button variant="outline" size="sm" onClick={deleteSelected} disabled={!selectedId} className="h-7 text-[10px] gap-1 text-destructive hover:text-destructive">
          <Trash2 size={12} /> Delete
        </Button>
        <Button variant={showGrid ? 'secondary' : 'outline'} size="sm" onClick={() => setShowGrid(!showGrid)} className="h-7 text-[10px] gap-1">
          <Grid3X3 size={12} /> Grid
        </Button>

        {/* Background Source Selector */}
        <div className="flex items-center gap-1 border-l border-border/30 pl-2 ml-1">
          <Button variant={bgSource === 'texture' ? 'secondary' : 'outline'} size="sm"
            onClick={() => setBgSource('texture')} className="h-7 text-[9px] gap-1 px-2">
            <Grid3X3 size={10} /> Texture
          </Button>
          <Button variant={bgSource === 'video' ? 'secondary' : 'outline'} size="sm"
            onClick={() => setBgSource('video')} className="h-7 text-[9px] gap-1 px-2"
            disabled={!isVideoPlaying}>
            <Film size={10} /> Video
          </Button>
          <Button variant={bgSource === 'visualizer' ? 'secondary' : 'outline'} size="sm"
            onClick={() => setShowBgPanel(!showBgPanel)} className="h-7 text-[9px] gap-1 px-2">
            <Music size={10} /> Audio VFX
          </Button>
          {vizRunning && (
            <div className="flex items-center gap-1 text-[9px] text-green-400 bg-green-400/10 px-2 py-1 rounded border border-green-400/30">
              <Volume2 size={10} className="animate-pulse" /> Live
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={saveMapping} className="h-7 text-[10px] gap-1">
            <Save size={12} /> Save
          </Button>
          <Button variant="outline" size="sm" onClick={openMapping} className="h-7 text-[10px] gap-1">
            <FolderOpen size={12} /> Open
          </Button>
          <div className="w-px h-5 bg-border/30 mx-1" />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}>
            <ZoomOut size={14} />
          </Button>
          <span className="text-[10px] text-muted-foreground w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.min(2, z + 0.1))}>
            <ZoomIn size={14} />
          </Button>
        </div>
      </div>

      {/* Audio Visualizer Settings Panel */}
      <AnimatePresence>
        {showBgPanel && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="border-b border-border/30 overflow-hidden bg-card/40">
            <div className="p-3 flex flex-wrap gap-4 items-end">
              {/* Audio Input */}
              <div className="space-y-1">
                <label className="text-[8px] uppercase tracking-wider text-muted-foreground block">Audio Input</label>
                <div className="flex gap-1">
                  {(Object.keys(INPUT_LABELS) as AudioInputSource[]).map(src => (
                    <Button key={src} variant={vizAudioInput === src ? 'secondary' : 'outline'} size="sm"
                      className="h-6 text-[8px] px-2 gap-1"
                      onClick={() => setVizAudioInput(src)}>
                      {src === 'microphone' && <Mic size={9} />}
                      {src === 'system-audio' && <Monitor size={9} />}
                      {src === 'audio-interface' && <Music size={9} />}
                      {src === 'microphone' ? 'Mic' : src === 'system-audio' ? 'System' : 'Interface'}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Device selector for mic/interface */}
              {vizAudioInput !== 'system-audio' && audioDevices.length > 0 && (
                <div className="space-y-1">
                  <label className="text-[8px] uppercase tracking-wider text-muted-foreground block">Device</label>
                  <select value={selectedDeviceId} onChange={e => setSelectedDeviceId(e.target.value)}
                    className="h-6 text-[9px] bg-muted/30 border border-border/30 rounded px-2 text-foreground max-w-[200px]">
                    <option value="">Default</option>
                    {audioDevices.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Input ${d.deviceId.slice(0, 8)}`}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Preset */}
              <div className="space-y-1">
                <label className="text-[8px] uppercase tracking-wider text-muted-foreground block">Preset</label>
                <select value={vizPreset} onChange={e => setVizPreset(e.target.value as VisualizerPreset)}
                  className="h-6 text-[9px] bg-muted/30 border border-border/30 rounded px-2 text-foreground">
                  {(Object.entries(PRESET_LABELS)).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              {/* Sensitivity */}
              <div className="space-y-1 w-24">
                <label className="text-[8px] uppercase tracking-wider text-muted-foreground block">
                  Sensitivity: {vizSensitivity.toFixed(1)}
                </label>
                <Slider value={[vizSensitivity * 50]} onValueChange={([v]) => setVizSensitivity(v / 50)} max={150} />
              </div>

              {/* Color Shift */}
              <div className="space-y-1 w-24">
                <label className="text-[8px] uppercase tracking-wider text-muted-foreground block">
                  Color Shift: {vizColorShift}°
                </label>
                <Slider value={[vizColorShift]} onValueChange={([v]) => setVizColorShift(v)} max={360} />
              </div>

              {/* Start/Stop */}
              {!vizRunning ? (
                <Button size="sm" className="h-7 text-[10px] gap-1 bg-green-600 hover:bg-green-700" onClick={startVisualizer}>
                  <Volume2 size={12} /> Start Audio VFX
                </Button>
              ) : (
                <Button size="sm" variant="destructive" className="h-7 text-[10px] gap-1" onClick={stopVisualizer}>
                  Stop
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
          {showProperties && (selectedNode || selectedMF) && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-l border-border/30 overflow-y-auto overflow-x-hidden bg-card/30"
            >
              <div className="w-[280px] p-3 space-y-4">

                {/* ── WLED Node Properties ── */}
                {selectedNode && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-widest text-primary font-semibold">WLED Node</span>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowProperties(false)}>
                        <ChevronDown size={12} className="rotate-90" />
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <label className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1 block">Name</label>
                        <Input value={selectedNode.name} onChange={e => updateNode(selectedNode.id, { name: e.target.value })}
                          className="h-7 text-xs bg-muted/30 border-border/30" />
                      </div>
                      <div>
                        <label className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1 block">IP Address</label>
                        <Input value={selectedNode.ip} onChange={e => updateNode(selectedNode.id, { ip: e.target.value })}
                          className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                      </div>
                    </div>

                    {/* Pixel Matrix */}
                    <div className="glass-panel p-3 space-y-2">
                      <span className="text-[9px] uppercase tracking-widest text-stokio-cyan font-semibold">Pixel Matrix</span>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">Pixels X</label>
                          <Input type="number" min={1} max={256} value={selectedNode.pixelsX}
                            onChange={e => {
                              const v = Math.max(1, Number(e.target.value));
                              const newTotal = v * selectedNode.pixelsY;
                              updateNode(selectedNode.id, {
                                pixelsX: v, totalPixels: newTotal,
                                segments: [{ ...selectedNode.segments[0] || createDefaultSegment(0, 0, newTotal), pixelEnd: newTotal - 1 }, ...selectedNode.segments.slice(1)],
                              });
                            }}
                            className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                        </div>
                        <div>
                          <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">Pixels Y</label>
                          <Input type="number" min={1} max={256} value={selectedNode.pixelsY}
                            onChange={e => {
                              const v = Math.max(1, Number(e.target.value));
                              const newTotal = selectedNode.pixelsX * v;
                              updateNode(selectedNode.id, {
                                pixelsY: v, totalPixels: newTotal,
                                segments: [{ ...selectedNode.segments[0] || createDefaultSegment(0, 0, newTotal), pixelEnd: newTotal - 1 }, ...selectedNode.segments.slice(1)],
                              });
                            }}
                            className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                        </div>
                      </div>
                      <div className="text-[9px] font-mono text-muted-foreground text-center">
                        Total: <span className="text-stokio-cyan">{selectedNode.totalPixels}</span> pixels
                      </div>
                    </div>

                    {/* SignalRGB-style Blur & Sample Settings */}
                    <div className="glass-panel p-3 space-y-3">
                      <span className="text-[9px] uppercase tracking-widest text-stokio-cyan font-semibold flex items-center gap-1">
                        <Droplets size={10} /> Color Sampling
                      </span>
                      <div>
                        <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">
                          Blur Amount: <span className="text-stokio-cyan">{selectedNode.blurAmount}</span>
                        </label>
                        <Slider value={[selectedNode.blurAmount]} onValueChange={([v]) => updateNode(selectedNode.id, { blurAmount: v })} max={100} />
                        <div className="text-[7px] text-muted-foreground/50 mt-0.5">Smooths color transitions between adjacent pixels</div>
                      </div>
                      <div>
                        <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">
                          Sample Radius: <span className="text-stokio-cyan">{selectedNode.sampleRadius}px</span>
                        </label>
                        <Slider value={[selectedNode.sampleRadius]} onValueChange={([v]) => updateNode(selectedNode.id, { sampleRadius: v })} min={1} max={50} />
                        <div className="text-[7px] text-muted-foreground/50 mt-0.5">Area each pixel samples from the video/texture</div>
                      </div>
                      <div>
                        <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">
                          Interpolation Speed: <span className="text-stokio-cyan">{selectedNode.interpolationSpeed}%</span>
                        </label>
                        <Slider value={[selectedNode.interpolationSpeed]} onValueChange={([v]) => updateNode(selectedNode.id, { interpolationSpeed: v })} max={100} />
                        <div className="text-[7px] text-muted-foreground/50 mt-0.5">How fast colors transition (temporal smoothing)</div>
                      </div>
                    </div>

                    {/* Transform */}
                    <div className="glass-panel p-3 space-y-2">
                      <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">Transform</span>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">X</label>
                          <Input type="number" value={Math.round(selectedNode.x)} onChange={e => updateNode(selectedNode.id, { x: Number(e.target.value) })}
                            className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                        </div>
                        <div>
                          <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">Y</label>
                          <Input type="number" value={Math.round(selectedNode.y)} onChange={e => updateNode(selectedNode.id, { y: Number(e.target.value) })}
                            className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                        </div>
                        <div>
                          <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">Width</label>
                          <Input type="number" min={30} value={selectedNode.width} onChange={e => updateNode(selectedNode.id, { width: Math.max(30, Number(e.target.value)) })}
                            className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                        </div>
                        <div>
                          <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">Height</label>
                          <Input type="number" min={20} value={selectedNode.height} onChange={e => updateNode(selectedNode.id, { height: Math.max(20, Number(e.target.value)) })}
                            className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                        </div>
                      </div>
                      <div>
                        <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">Rotation: {selectedNode.rotation}°</label>
                        <Slider value={[selectedNode.rotation]} onValueChange={([v]) => updateNode(selectedNode.id, { rotation: v })} min={0} max={359} step={1} />
                      </div>
                    </div>

                    {/* Segments */}
                    <div className="glass-panel p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] uppercase tracking-widest text-stokio-pink font-semibold">Segments</span>
                        <Button variant="ghost" size="sm" className="h-5 text-[9px] px-2" onClick={() => addSegment(selectedNode.id)}>
                          <Plus size={10} /> Add
                        </Button>
                      </div>
                      {selectedNode.segments.map((seg, idx) => {
                        const segColors = ['border-stokio-cyan/30', 'border-stokio-pink/30', 'border-primary/30', 'border-yellow-500/30', 'border-purple-500/30'];
                        return (
                          <div key={seg.id} className={`p-2 rounded border ${segColors[idx % segColors.length]} bg-muted/20 space-y-2`}>
                            <div className="flex items-center justify-between">
                              <Input value={seg.label} onChange={e => updateSegment(selectedNode.id, seg.id, { label: e.target.value })}
                                className="h-5 text-[10px] bg-transparent border-0 p-0 font-semibold w-20" />
                              {selectedNode.segments.length > 1 && (
                                <button onClick={() => removeSegment(selectedNode.id, seg.id)} className="text-muted-foreground hover:text-destructive">
                                  <Trash2 size={10} />
                                </button>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                              <div>
                                <label className="text-[7px] uppercase text-muted-foreground">Start Pixel</label>
                                <Input type="number" min={0} value={seg.pixelStart}
                                  onChange={e => updateSegment(selectedNode.id, seg.id, { pixelStart: Number(e.target.value) })}
                                  className="h-6 text-[10px] bg-muted/30 border-border/30 font-mono" />
                              </div>
                              <div>
                                <label className="text-[7px] uppercase text-muted-foreground">End Pixel</label>
                                <Input type="number" min={0} value={seg.pixelEnd}
                                  onChange={e => updateSegment(selectedNode.id, seg.id, { pixelEnd: Number(e.target.value) })}
                                  className="h-6 text-[10px] bg-muted/30 border-border/30 font-mono" />
                              </div>
                            </div>
                            <div>
                              <label className="text-[7px] uppercase text-muted-foreground">Orientation</label>
                              <select value={seg.orientation}
                                onChange={e => updateSegment(selectedNode.id, seg.id, { orientation: e.target.value as SegmentOrientation })}
                                className="w-full h-6 rounded bg-muted/30 border border-border/30 text-[10px] px-1 text-foreground">
                                {Object.entries(ORIENTATION_LABELS).map(([k, v]) => (
                                  <option key={k} value={k}>{v}</option>
                                ))}
                              </select>
                            </div>
                            <label className="flex items-center gap-1.5 text-[9px] text-muted-foreground cursor-pointer">
                              <input type="checkbox" checked={seg.reversed}
                                onChange={e => updateSegment(selectedNode.id, seg.id, { reversed: e.target.checked })}
                                className="rounded border-border" />
                              Reversed direction
                            </label>
                            <div className="text-[8px] font-mono text-muted-foreground">
                              {seg.pixelEnd - seg.pixelStart + 1} pixels
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* ── Mapping Fixture Properties ── */}
                {selectedMF && selectedMFInst && selectedMFDef && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-widest text-stokio-cyan font-semibold">DMX Fixture Mapping</span>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowProperties(false)}>
                        <ChevronDown size={12} className="rotate-90" />
                      </Button>
                    </div>

                    <div className="glass-panel p-3 space-y-2">
                      <div className="text-[10px] font-semibold">{selectedMFInst.name}</div>
                      <div className="text-[8px] text-muted-foreground">
                        {selectedMFDef.manufacturer} {selectedMFDef.model} • U{selectedMFInst.universe}.{selectedMFInst.dmxAddress}
                      </div>
                      <div className="text-[8px] text-muted-foreground">
                        Color: <span className="text-stokio-cyan uppercase">{selectedMFDef.colorSystem}</span>
                      </div>
                    </div>

                    {/* Position & Size */}
                    <div className="glass-panel p-3 space-y-2">
                      <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">Position</span>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">X</label>
                          <Input type="number" value={Math.round(selectedMF.x)} onChange={e => updateMappingFixture(selectedMF.id, { x: Number(e.target.value) })}
                            className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                        </div>
                        <div>
                          <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">Y</label>
                          <Input type="number" value={Math.round(selectedMF.y)} onChange={e => updateMappingFixture(selectedMF.id, { y: Number(e.target.value) })}
                            className="h-7 text-xs bg-muted/30 border-border/30 font-mono" />
                        </div>
                      </div>
                      <div>
                        <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">
                          Visual Radius: <span className="text-stokio-cyan">{selectedMF.radius}px</span>
                        </label>
                        <Slider value={[selectedMF.radius]} onValueChange={([v]) => updateMappingFixture(selectedMF.id, { radius: v })} min={8} max={60} />
                      </div>
                    </div>

                    {/* SignalRGB-style settings */}
                    <div className="glass-panel p-3 space-y-3">
                      <span className="text-[9px] uppercase tracking-widest text-stokio-cyan font-semibold flex items-center gap-1">
                        <Droplets size={10} /> Color Sampling
                      </span>
                      <div>
                        <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">
                          Blur Amount: <span className="text-stokio-cyan">{selectedMF.blurAmount}</span>
                        </label>
                        <Slider value={[selectedMF.blurAmount]} onValueChange={([v]) => updateMappingFixture(selectedMF.id, { blurAmount: v })} max={100} />
                        <div className="text-[7px] text-muted-foreground/50 mt-0.5">Smooths sampled color output for softer transitions</div>
                      </div>
                      <div>
                        <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">
                          Sample Radius: <span className="text-stokio-cyan">{selectedMF.sampleRadius}px</span>
                        </label>
                        <Slider value={[selectedMF.sampleRadius]} onValueChange={([v]) => updateMappingFixture(selectedMF.id, { sampleRadius: v })} min={1} max={50} />
                        <div className="text-[7px] text-muted-foreground/50 mt-0.5">Area around fixture position to average color from</div>
                      </div>
                      <div>
                        <label className="text-[8px] uppercase text-muted-foreground mb-0.5 block">
                          Interpolation Speed: <span className="text-stokio-cyan">{selectedMF.interpolationSpeed}%</span>
                        </label>
                        <Slider value={[selectedMF.interpolationSpeed]} onValueChange={([v]) => updateMappingFixture(selectedMF.id, { interpolationSpeed: v })} max={100} />
                        <div className="text-[7px] text-muted-foreground/50 mt-0.5">Temporal smoothing — lower = smoother color changes</div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom status */}
      {!showProperties && selectedId && (
        <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          className="p-2 border-t border-border/30 flex items-center justify-between px-4">
          <div className="text-[10px] text-muted-foreground">
            Selected: <span className="text-primary font-semibold">
              {selectedNode?.name || selectedMFInst?.name || '—'}
            </span>
          </div>
          <Button variant="ghost" size="sm" className="h-5 text-[9px]" onClick={() => setShowProperties(true)}>
            Show Properties →
          </Button>
        </motion.div>
      )}
    </motion.div>
  );
}
