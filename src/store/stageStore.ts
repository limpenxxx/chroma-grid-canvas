import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { VisualizerPreset, AudioInputSource } from '@/lib/audioVisualizer';

type SegmentOrientation = 'horizontal' | 'vertical' | 'zigzag-h' | 'zigzag-v';

export interface WLEDSegment {
  id: string;
  label: string;
  pixelStart: number;
  pixelEnd: number;
  orientation: SegmentOrientation;
  reversed: boolean;
}

export interface WLEDNode {
  id: string;
  name: string;
  ip: string;
  wledFixtureId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  pixelsX: number;
  pixelsY: number;
  segments: WLEDSegment[];
  totalPixels: number;
  blurAmount: number;
  sampleRadius: number;
  interpolationSpeed: number;
}

export interface MappingFixture {
  id: string;
  fixtureInstanceId: string;
  x: number;
  y: number;
  radius: number;
  blurAmount: number;
  sampleRadius: number;
  interpolationSpeed: number;
}

export type BackgroundSource = 'video' | 'visualizer' | 'texture' | 'none';
export type TestPattern = 'blobs' | 'scanlines' | 'test-picture' | 'rgb-scanline' | 'color-bars' | 'gradient-sweep';

interface StageStore {
  nodes: WLEDNode[];
  mappingFixtures: MappingFixture[];
  bgSource: BackgroundSource;
  testPattern: TestPattern;
  vizPreset: VisualizerPreset;
  vizAudioInput: AudioInputSource;
  vizSensitivity: number;
  vizColorShift: number;
  showGrid: boolean;
  zoom: number;
  selectedMediaItemId: string | null;
  selectedPlaylistId: string | null;

  setNodes: (nodes: WLEDNode[] | ((prev: WLEDNode[]) => WLEDNode[])) => void;
  setMappingFixtures: (mf: MappingFixture[] | ((prev: MappingFixture[]) => MappingFixture[])) => void;
  setBgSource: (s: BackgroundSource) => void;
  setTestPattern: (p: TestPattern) => void;
  setVizPreset: (p: VisualizerPreset) => void;
  setVizAudioInput: (i: AudioInputSource) => void;
  setVizSensitivity: (v: number) => void;
  setVizColorShift: (v: number) => void;
  setShowGrid: (v: boolean) => void;
  setZoom: (v: number | ((prev: number) => number)) => void;
  setSelectedMediaItemId: (id: string | null) => void;
  setSelectedPlaylistId: (id: string | null) => void;
}

const createDefaultSegment = (index: number, start: number, count: number): WLEDSegment => ({
  id: `seg-${Date.now()}-${index}`,
  label: `Seg ${index + 1}`,
  pixelStart: start,
  pixelEnd: start + count - 1,
  orientation: 'horizontal',
  reversed: false,
});

const DEFAULT_NODES: WLEDNode[] = [
  {
    id: '1', name: 'WLED-Main', ip: '192.168.1.100', x: 200, y: 120, width: 240, height: 135,
    pixelsX: 16, pixelsY: 16, totalPixels: 256, rotation: 0,
    blurAmount: 20, sampleRadius: 5, interpolationSpeed: 50,
    segments: [createDefaultSegment(0, 0, 128), createDefaultSegment(1, 128, 128)],
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

export { createDefaultSegment };

export const useStageStore = create<StageStore>()(
  persist(
    (set) => ({
      nodes: DEFAULT_NODES,
      mappingFixtures: [],
      bgSource: 'texture',
      testPattern: 'blobs',
      vizPreset: 'plasma-wave',
      vizAudioInput: 'microphone',
      vizSensitivity: 1.0,
      vizColorShift: 0,
      showGrid: true,
      zoom: 1,
      selectedMediaItemId: null,
      selectedPlaylistId: null,

      setNodes: (v) => set((s) => ({ nodes: typeof v === 'function' ? v(s.nodes) : v })),
      setMappingFixtures: (v) => set((s) => ({ mappingFixtures: typeof v === 'function' ? v(s.mappingFixtures) : v })),
      setBgSource: (s) => set({ bgSource: s }),
      setTestPattern: (p) => set({ testPattern: p }),
      setVizPreset: (p) => set({ vizPreset: p }),
      setVizAudioInput: (i) => set({ vizAudioInput: i }),
      setVizSensitivity: (v) => set({ vizSensitivity: v }),
      setVizColorShift: (v) => set({ vizColorShift: v }),
      setShowGrid: (v) => set({ showGrid: v }),
      setZoom: (v) => set((s) => ({ zoom: typeof v === 'function' ? v(s.zoom) : v })),
      setSelectedMediaItemId: (id) => set({ selectedMediaItemId: id }),
      setSelectedPlaylistId: (id) => set({ selectedPlaylistId: id }),
    }),
    {
      name: 'stokio-stage-v1',
    }
  )
);
