import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ── 3D Stage Types ──

export type Fixture3DType = 'moving-head' | 'par' | 'strip' | 'wash' | 'spot' | 'wled-strip' | 'wled-matrix' | 'hue-bulb' | 'magic-bulb' | 'truss' | 'generic';

export interface Fixture3D {
  id: string;
  name: string;
  type: Fixture3DType;
  // Link to system fixtures
  fixtureInstanceId?: string;  // DMX fixture instance
  wledNodeId?: string;         // WLED node from stageStore
  hueBridgeId?: string;        // Hue bridge
  hueLightId?: string;         // Hue light
  magicDeviceId?: string;      // MagicHome device
  // 3D position
  x: number;
  y: number;
  z: number;
  // 3D rotation (degrees)
  rotX: number;
  rotY: number;
  rotZ: number;
  // Scale
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  // Visual config
  beamAngle: number;    // degrees
  beamLength: number;   // meters
  showBeam: boolean;
  // For WLED strips
  ledCount?: number;
  stripLength?: number; // meters
  // For WLED matrix
  matrixW?: number;
  matrixH?: number;
}

export interface RoomDimensions {
  width: number;   // meters
  depth: number;
  height: number;
  wallColor: string;
  floorColor: string;
  ceilingColor: string;
  showWalls: boolean;
  showCeiling: boolean;
  showFloor: boolean;
}

export interface TrussElement {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  length: number;  // meters
  rotY: number;    // rotation around Y axis
}

interface Stage3DStore {
  fixtures3d: Fixture3D[];
  room: RoomDimensions;
  trusses: TrussElement[];
  showBeams: boolean;
  cameraPreset: 'front' | 'top' | 'side' | 'free';

  // Room
  setRoom: (room: Partial<RoomDimensions>) => void;

  // Fixtures
  addFixture3D: (fixture: Fixture3D) => void;
  updateFixture3D: (id: string, updates: Partial<Fixture3D>) => void;
  removeFixture3D: (id: string) => void;

  // Trusses
  addTruss: (truss: TrussElement) => void;
  updateTruss: (id: string, updates: Partial<TrussElement>) => void;
  removeTruss: (id: string) => void;

  // View
  setShowBeams: (v: boolean) => void;
  setCameraPreset: (v: 'front' | 'top' | 'side' | 'free') => void;
}

const DEFAULT_ROOM: RoomDimensions = {
  width: 12,
  depth: 10,
  height: 4,
  wallColor: '#1a1a2e',
  floorColor: '#0a0a14',
  ceilingColor: '#111122',
  showWalls: true,
  showCeiling: true,
  showFloor: true,
};

const DEFAULT_TRUSSES: TrussElement[] = [
  { id: 'truss-1', name: 'Front Truss', x: 0, y: 3.5, z: -2, length: 8, rotY: 0 },
  { id: 'truss-2', name: 'Back Truss', x: 0, y: 3.5, z: 3, length: 6, rotY: 0 },
];

const DEFAULT_3D_FIXTURES: Fixture3D[] = [
  {
    id: '3d-mh-1', name: 'MH-1', type: 'moving-head', fixtureInstanceId: 'inst-1',
    x: -2, y: 3.5, z: -2, rotX: 0, rotY: 0, rotZ: 0,
    scaleX: 1, scaleY: 1, scaleZ: 1,
    beamAngle: 15, beamLength: 4, showBeam: true,
  },
  {
    id: '3d-mh-2', name: 'MH-2', type: 'moving-head', fixtureInstanceId: 'inst-2',
    x: 2, y: 3.5, z: -2, rotX: 0, rotY: 0, rotZ: 0,
    scaleX: 1, scaleY: 1, scaleZ: 1,
    beamAngle: 15, beamLength: 4, showBeam: true,
  },
  {
    id: '3d-par-1', name: 'PAR-1', type: 'par', fixtureInstanceId: 'inst-3',
    x: -3, y: 3.5, z: 0, rotX: 0, rotY: 0, rotZ: 0,
    scaleX: 1, scaleY: 1, scaleZ: 1,
    beamAngle: 40, beamLength: 3, showBeam: true,
  },
];

export const useStage3DStore = create<Stage3DStore>()(
  persist(
    (set) => ({
      fixtures3d: DEFAULT_3D_FIXTURES,
      room: DEFAULT_ROOM,
      trusses: DEFAULT_TRUSSES,
      showBeams: true,
      cameraPreset: 'front',

      setRoom: (updates) => set(s => ({ room: { ...s.room, ...updates } })),

      addFixture3D: (fixture) => set(s => ({ fixtures3d: [...s.fixtures3d, fixture] })),
      updateFixture3D: (id, updates) => set(s => ({
        fixtures3d: s.fixtures3d.map(f => f.id === id ? { ...f, ...updates } : f),
      })),
      removeFixture3D: (id) => set(s => ({
        fixtures3d: s.fixtures3d.filter(f => f.id !== id),
      })),

      addTruss: (truss) => set(s => ({ trusses: [...s.trusses, truss] })),
      updateTruss: (id, updates) => set(s => ({
        trusses: s.trusses.map(t => t.id === id ? { ...t, ...updates } : t),
      })),
      removeTruss: (id) => set(s => ({
        trusses: s.trusses.filter(t => t.id !== id),
      })),

      setShowBeams: (v) => set({ showBeams: v }),
      setCameraPreset: (v) => set({ cameraPreset: v }),
    }),
    { name: 'stokio-stage3d-v1' }
  )
);
