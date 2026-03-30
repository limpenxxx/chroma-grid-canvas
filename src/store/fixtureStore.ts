import { create } from 'zustand';

export type ChannelFunction =
  | 'dimmer' | 'red' | 'green' | 'blue' | 'white' | 'amber' | 'uv'
  | 'pan' | 'pan-fine' | 'tilt' | 'tilt-fine'
  | 'strobe' | 'color-wheel' | 'gobo' | 'gobo-rotation'
  | 'prism' | 'focus' | 'zoom' | 'iris'
  | 'frost' | 'speed' | 'macro' | 'fx'
  | 'shutter' | 'cto' | 'ctb'
  | 'custom';

export interface FixtureChannel {
  id: string;
  number: number; // relative channel number (1-based within fixture)
  name: string;
  function: ChannelFunction;
  defaultValue: number;
  min: number;
  max: number;
}

export interface FixtureMode {
  id: string;
  name: string;
  channelCount: number;
  channels: FixtureChannel[];
}

export type ColorSystem = 'rgb' | 'rgbw' | 'rgbww' | 'rgbwc' | 'color-wheel';

export interface ColorWheelSlot {
  id: string;
  name: string;
  color: string; // hex color
  dmxValue: number; // DMX value that selects this color (0-255)
}

export interface FixtureDefinition {
  id: string;
  manufacturer: string;
  model: string;
  type: 'moving-head' | 'par' | 'strip' | 'wash' | 'spot' | 'beam' | 'strobe' | 'laser' | 'effect' | 'dimmer' | 'other';
  colorSystem: ColorSystem;
  colorWheelSlots?: ColorWheelSlot[]; // only used when colorSystem === 'color-wheel'
  modes: FixtureMode[];
  createdAt: number;
}

export interface FixtureInstance {
  id: string;
  definitionId: string;
  name: string;
  universe: number;
  dmxAddress: number;
  modeId: string;
  // Stage builder placement
  onStage: boolean;
  stageX: number;
  stageY: number;
  stageWidth: number;
  stageHeight: number;
}

const CHANNEL_FUNCTION_LABELS: Record<ChannelFunction, string> = {
  dimmer: 'Dimmer', red: 'Red', green: 'Green', blue: 'Blue', white: 'White',
  amber: 'Amber', uv: 'UV', pan: 'Pan', 'pan-fine': 'Pan Fine',
  tilt: 'Tilt', 'tilt-fine': 'Tilt Fine', strobe: 'Strobe',
  'color-wheel': 'Color Wheel', gobo: 'Gobo', 'gobo-rotation': 'Gobo Rotation',
  prism: 'Prism', focus: 'Focus', zoom: 'Zoom', iris: 'Iris',
  frost: 'Frost', speed: 'Speed', macro: 'Macro', fx: 'FX',
  shutter: 'Shutter', cto: 'CTO', ctb: 'CTB', custom: 'Custom',
};

export { CHANNEL_FUNCTION_LABELS };

// Built-in fixture library
const BUILT_IN_FIXTURES: FixtureDefinition[] = [
  {
    id: 'generic-rgb-par',
    manufacturer: 'Generic',
    model: 'RGB PAR',
    type: 'par',
    createdAt: 0,
    modes: [{
      id: 'm1', name: '3 Channel', channelCount: 3,
      channels: [
        { id: 'c1', number: 1, name: 'Red', function: 'red', defaultValue: 0, min: 0, max: 255 },
        { id: 'c2', number: 2, name: 'Green', function: 'green', defaultValue: 0, min: 0, max: 255 },
        { id: 'c3', number: 3, name: 'Blue', function: 'blue', defaultValue: 0, min: 0, max: 255 },
      ],
    }, {
      id: 'm2', name: '7 Channel', channelCount: 7,
      channels: [
        { id: 'c1', number: 1, name: 'Dimmer', function: 'dimmer', defaultValue: 0, min: 0, max: 255 },
        { id: 'c2', number: 2, name: 'Red', function: 'red', defaultValue: 0, min: 0, max: 255 },
        { id: 'c3', number: 3, name: 'Green', function: 'green', defaultValue: 0, min: 0, max: 255 },
        { id: 'c4', number: 4, name: 'Blue', function: 'blue', defaultValue: 0, min: 0, max: 255 },
        { id: 'c5', number: 5, name: 'Strobe', function: 'strobe', defaultValue: 0, min: 0, max: 255 },
        { id: 'c6', number: 6, name: 'Color Macro', function: 'macro', defaultValue: 0, min: 0, max: 255 },
        { id: 'c7', number: 7, name: 'Speed', function: 'speed', defaultValue: 0, min: 0, max: 255 },
      ],
    }],
  },
  {
    id: 'generic-rgbw-par',
    manufacturer: 'Generic',
    model: 'RGBW PAR',
    type: 'par',
    createdAt: 0,
    modes: [{
      id: 'm1', name: '4 Channel', channelCount: 4,
      channels: [
        { id: 'c1', number: 1, name: 'Red', function: 'red', defaultValue: 0, min: 0, max: 255 },
        { id: 'c2', number: 2, name: 'Green', function: 'green', defaultValue: 0, min: 0, max: 255 },
        { id: 'c3', number: 3, name: 'Blue', function: 'blue', defaultValue: 0, min: 0, max: 255 },
        { id: 'c4', number: 4, name: 'White', function: 'white', defaultValue: 0, min: 0, max: 255 },
      ],
    }],
  },
  {
    id: 'generic-moving-head-spot',
    manufacturer: 'Generic',
    model: 'Moving Head Spot',
    type: 'moving-head',
    createdAt: 0,
    modes: [{
      id: 'm1', name: '16 Channel', channelCount: 16,
      channels: [
        { id: 'c1', number: 1, name: 'Pan', function: 'pan', defaultValue: 128, min: 0, max: 255 },
        { id: 'c2', number: 2, name: 'Pan Fine', function: 'pan-fine', defaultValue: 0, min: 0, max: 255 },
        { id: 'c3', number: 3, name: 'Tilt', function: 'tilt', defaultValue: 128, min: 0, max: 255 },
        { id: 'c4', number: 4, name: 'Tilt Fine', function: 'tilt-fine', defaultValue: 0, min: 0, max: 255 },
        { id: 'c5', number: 5, name: 'Speed', function: 'speed', defaultValue: 0, min: 0, max: 255 },
        { id: 'c6', number: 6, name: 'Dimmer', function: 'dimmer', defaultValue: 0, min: 0, max: 255 },
        { id: 'c7', number: 7, name: 'Shutter/Strobe', function: 'shutter', defaultValue: 0, min: 0, max: 255 },
        { id: 'c8', number: 8, name: 'Red', function: 'red', defaultValue: 0, min: 0, max: 255 },
        { id: 'c9', number: 9, name: 'Green', function: 'green', defaultValue: 0, min: 0, max: 255 },
        { id: 'c10', number: 10, name: 'Blue', function: 'blue', defaultValue: 0, min: 0, max: 255 },
        { id: 'c11', number: 11, name: 'White', function: 'white', defaultValue: 0, min: 0, max: 255 },
        { id: 'c12', number: 12, name: 'Color Wheel', function: 'color-wheel', defaultValue: 0, min: 0, max: 255 },
        { id: 'c13', number: 13, name: 'Gobo', function: 'gobo', defaultValue: 0, min: 0, max: 255 },
        { id: 'c14', number: 14, name: 'Gobo Rotation', function: 'gobo-rotation', defaultValue: 0, min: 0, max: 255 },
        { id: 'c15', number: 15, name: 'Focus', function: 'focus', defaultValue: 128, min: 0, max: 255 },
        { id: 'c16', number: 16, name: 'Prism', function: 'prism', defaultValue: 0, min: 0, max: 255 },
      ],
    }],
  },
  {
    id: 'generic-dimmer',
    manufacturer: 'Generic',
    model: 'Dimmer',
    type: 'dimmer',
    createdAt: 0,
    modes: [{
      id: 'm1', name: '1 Channel', channelCount: 1,
      channels: [
        { id: 'c1', number: 1, name: 'Dimmer', function: 'dimmer', defaultValue: 0, min: 0, max: 255 },
      ],
    }],
  },
  {
    id: 'generic-strobe',
    manufacturer: 'Generic',
    model: 'Strobe',
    type: 'strobe',
    createdAt: 0,
    modes: [{
      id: 'm1', name: '2 Channel', channelCount: 2,
      channels: [
        { id: 'c1', number: 1, name: 'Dimmer', function: 'dimmer', defaultValue: 0, min: 0, max: 255 },
        { id: 'c2', number: 2, name: 'Strobe Speed', function: 'strobe', defaultValue: 0, min: 0, max: 255 },
      ],
    }],
  },
];

interface FixtureStore {
  definitions: FixtureDefinition[];
  instances: FixtureInstance[];
  addDefinition: (def: FixtureDefinition) => void;
  removeDefinition: (id: string) => void;
  updateDefinition: (id: string, updates: Partial<FixtureDefinition>) => void;
  addInstance: (inst: FixtureInstance) => void;
  removeInstance: (id: string) => void;
  updateInstance: (id: string, updates: Partial<FixtureInstance>) => void;
  exportLibrary: () => string;
  importLibrary: (json: string) => void;
}

export const useFixtureStore = create<FixtureStore>((set, get) => ({
  definitions: [...BUILT_IN_FIXTURES],
  instances: [
    {
      id: 'inst-1', definitionId: 'generic-moving-head-spot', name: 'MH-1',
      universe: 1, dmxAddress: 1, modeId: 'm1',
      onStage: false, stageX: 300, stageY: 100, stageWidth: 40, stageHeight: 40,
    },
    {
      id: 'inst-2', definitionId: 'generic-moving-head-spot', name: 'MH-2',
      universe: 1, dmxAddress: 17, modeId: 'm1',
      onStage: false, stageX: 400, stageY: 100, stageWidth: 40, stageHeight: 40,
    },
    {
      id: 'inst-3', definitionId: 'generic-rgb-par', name: 'PAR-1',
      universe: 1, dmxAddress: 33, modeId: 'm2',
      onStage: false, stageX: 200, stageY: 300, stageWidth: 30, stageHeight: 30,
    },
    {
      id: 'inst-4', definitionId: 'generic-rgbw-par', name: 'PAR-2',
      universe: 1, dmxAddress: 40, modeId: 'm1',
      onStage: false, stageX: 450, stageY: 300, stageWidth: 30, stageHeight: 30,
    },
  ],
  addDefinition: (def) => set(s => ({ definitions: [...s.definitions, def] })),
  removeDefinition: (id) => set(s => ({ definitions: s.definitions.filter(d => d.id !== id) })),
  updateDefinition: (id, updates) => set(s => ({
    definitions: s.definitions.map(d => d.id === id ? { ...d, ...updates } : d),
  })),
  addInstance: (inst) => set(s => ({ instances: [...s.instances, inst] })),
  removeInstance: (id) => set(s => ({ instances: s.instances.filter(i => i.id !== id) })),
  updateInstance: (id, updates) => set(s => ({
    instances: s.instances.map(i => i.id === id ? { ...i, ...updates } : i),
  })),
  exportLibrary: () => {
    const { definitions } = get();
    return JSON.stringify({ stokioFixtureLibrary: true, version: 1, definitions }, null, 2);
  },
  importLibrary: (json) => {
    try {
      const data = JSON.parse(json);
      if (data.stokioFixtureLibrary && Array.isArray(data.definitions)) {
        set(s => ({
          definitions: [
            ...s.definitions,
            ...data.definitions.filter((d: FixtureDefinition) => !s.definitions.some(e => e.id === d.id)),
          ],
        }));
      }
    } catch { /* invalid JSON */ }
  },
}));

// Helper: get channel function color for UI
export function getChannelColor(fn: ChannelFunction): string {
  const colors: Partial<Record<ChannelFunction, string>> = {
    red: '#ff4444', green: '#44ff44', blue: '#4488ff', white: '#ffffff',
    amber: '#ffaa00', uv: '#aa44ff', dimmer: '#ffcc00',
    pan: '#00e5ff', 'pan-fine': '#00b8cc', tilt: '#00e5ff', 'tilt-fine': '#00b8cc',
    strobe: '#ff2d78', shutter: '#ff2d78', gobo: '#88cc44', 'gobo-rotation': '#88cc44',
    'color-wheel': '#ff8800', focus: '#cccccc', zoom: '#cccccc',
    speed: '#ff6600', macro: '#cc66ff', fx: '#ff44cc',
  };
  return colors[fn] || '#888888';
}

// Type icon mapping
export function getFixtureTypeIcon(type: FixtureDefinition['type']): string {
  const icons: Record<FixtureDefinition['type'], string> = {
    'moving-head': '◎', par: '●', strip: '▬', wash: '◉', spot: '◈',
    beam: '↯', strobe: '⚡', laser: '⟐', effect: '✧', dimmer: '◐', other: '□',
  };
  return icons[type];
}
