import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { broadcastState, isSyncingFromRemote, onSyncState } from '@/lib/wsSync';

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
  // Per-channel capability ranges (gobo slots, color wheel ranges, etc.)
  capabilities?: ChannelCapability[];
}

/** A capability range on a channel — maps DMX value ranges to named functions/gobos/colors */
export interface ChannelCapability {
  id: string;
  dmxMin: number;
  dmxMax: number;
  label: string;
  icon?: string;   // emoji or gobo icon
  color?: string;  // hex color (for color-wheel type)
  type?: 'open' | 'gobo' | 'color' | 'macro' | 'rotation' | 'speed' | 'custom';
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

export type FixtureCategory = 'dmx' | 'wled';

export interface WledConfig {
  ip: string;
  ledCount: number;
  segments: number;
  presets: { id: number; name: string }[];
}

export interface FixtureDefinition {
  id: string;
  manufacturer: string;
  model: string;
  type: 'moving-head' | 'par' | 'strip' | 'wash' | 'spot' | 'beam' | 'strobe' | 'laser' | 'effect' | 'dimmer' | 'wled' | 'other';
  category: FixtureCategory;
  colorSystem: ColorSystem;
  colorWheelSlots?: ColorWheelSlot[]; // only used when colorSystem === 'color-wheel'
  wledConfig?: WledConfig; // only for WLED fixtures
  modes: FixtureMode[];
  createdAt: number;
}

export type FixtureIcon = 'moving-head' | 'led-strip' | 'led-matrix' | 'rgb-par' | 'pin-spot' | 'smoke' | 'laser' | 'multi-beam';

export const FIXTURE_ICON_OPTIONS: { value: FixtureIcon; label: string; emoji: string }[] = [
  { value: 'moving-head', label: 'Moving Head', emoji: '◎' },
  { value: 'led-strip', label: 'LED Strip', emoji: '▬' },
  { value: 'led-matrix', label: 'LED Matrix', emoji: '⊞' },
  { value: 'rgb-par', label: 'RGB PAR', emoji: '●' },
  { value: 'pin-spot', label: 'Pin-spot', emoji: '◈' },
  { value: 'smoke', label: 'Smoke Machine', emoji: '☁' },
  { value: 'laser', label: 'Laser Beamer', emoji: '⟐' },
  { value: 'multi-beam', label: 'Multi Beam RGB', emoji: '✦' },
];

export function getFixtureIconEmoji(icon?: FixtureIcon): string {
  const found = FIXTURE_ICON_OPTIONS.find(o => o.value === icon);
  return found?.emoji || '□';
}

export interface FixtureInstance {
  id: string;
  definitionId: string;
  name: string;
  icon?: FixtureIcon;
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
    category: 'dmx',
    colorSystem: 'rgb',
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
    category: 'dmx',
    colorSystem: 'rgbw',
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
    category: 'dmx',
    colorSystem: 'rgbw',
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
    category: 'dmx',
    colorSystem: 'rgb',
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
    category: 'dmx',
    colorSystem: 'rgb',
    createdAt: 0,
    modes: [{
      id: 'm1', name: '2 Channel', channelCount: 2,
      channels: [
        { id: 'c1', number: 1, name: 'Dimmer', function: 'dimmer', defaultValue: 0, min: 0, max: 255 },
        { id: 'c2', number: 2, name: 'Strobe Speed', function: 'strobe', defaultValue: 0, min: 0, max: 255 },
      ],
    }],
  },
  {
    id: 'generic-color-wheel-spot',
    manufacturer: 'Generic',
    model: 'Color Wheel Spot',
    type: 'spot',
    category: 'dmx',
    colorSystem: 'color-wheel' as ColorSystem,
    colorWheelSlots: [
      { id: 'cw1', name: 'Open/White', color: '#ffffff', dmxValue: 0 },
      { id: 'cw2', name: 'Red', color: '#ff0000', dmxValue: 15 },
      { id: 'cw3', name: 'Blue', color: '#0044ff', dmxValue: 30 },
      { id: 'cw4', name: 'Green', color: '#00cc00', dmxValue: 45 },
      { id: 'cw5', name: 'Yellow', color: '#ffee00', dmxValue: 60 },
      { id: 'cw6', name: 'Orange', color: '#ff6600', dmxValue: 75 },
      { id: 'cw7', name: 'Purple', color: '#8800ff', dmxValue: 90 },
      { id: 'cw8', name: 'Magenta', color: '#ff00aa', dmxValue: 105 },
    ],
    createdAt: 0,
    modes: [{
      id: 'm1', name: '6 Channel', channelCount: 6,
      channels: [
        { id: 'c1', number: 1, name: 'Dimmer', function: 'dimmer', defaultValue: 0, min: 0, max: 255 },
        { id: 'c2', number: 2, name: 'Color Wheel', function: 'color-wheel', defaultValue: 0, min: 0, max: 255 },
        { id: 'c3', number: 3, name: 'Gobo', function: 'gobo', defaultValue: 0, min: 0, max: 255 },
        { id: 'c4', number: 4, name: 'Strobe', function: 'strobe', defaultValue: 0, min: 0, max: 255 },
        { id: 'c5', number: 5, name: 'Pan', function: 'pan', defaultValue: 128, min: 0, max: 255 },
        { id: 'c6', number: 6, name: 'Tilt', function: 'tilt', defaultValue: 128, min: 0, max: 255 },
      ],
    }],
  },
  // ── Ayrton MagicDot-Neo ──
  {
    id: 'ayrton-magicdot-neo',
    manufacturer: 'Ayrton',
    model: 'MagicDot-Neo',
    type: 'moving-head',
    category: 'dmx',
    colorSystem: 'rgbw',
    createdAt: 0,
    modes: [{
      id: 'mdn-std', name: 'Standard (19ch)', channelCount: 19,
      channels: [
        { id: 'mdn-c1',  number: 1,  name: 'Pan',                 function: 'pan',         defaultValue: 128, min: 0, max: 255 },
        { id: 'mdn-c2',  number: 2,  name: 'Pan Fine',            function: 'pan-fine',    defaultValue: 0,   min: 0, max: 255 },
        { id: 'mdn-c3',  number: 3,  name: 'Tilt',                function: 'tilt',        defaultValue: 128, min: 0, max: 255 },
        { id: 'mdn-c4',  number: 4,  name: 'Tilt Fine',           function: 'tilt-fine',   defaultValue: 0,   min: 0, max: 255 },
        { id: 'mdn-c5',  number: 5,  name: 'Pan/Tilt Speed',      function: 'speed',       defaultValue: 0,   min: 0, max: 255 },
        { id: 'mdn-c6',  number: 6,  name: 'Master Dimmer',       function: 'dimmer',      defaultValue: 0,   min: 0, max: 255 },
        {
          id: 'mdn-c7',  number: 7,  name: 'Shutter/Strobe',     function: 'shutter',     defaultValue: 0,   min: 0, max: 255,
          capabilities: [
            { id: 'mdn-c7-0', dmxMin: 0,   dmxMax: 3,   label: 'Closed',          type: 'custom' },
            { id: 'mdn-c7-1', dmxMin: 4,   dmxMax: 103, label: 'Strobe Slow→Fast', type: 'custom' },
            { id: 'mdn-c7-2', dmxMin: 104, dmxMax: 107, label: 'Open',            type: 'custom' },
            { id: 'mdn-c7-3', dmxMin: 108, dmxMax: 207, label: 'Pulse Effects',   type: 'custom' },
            { id: 'mdn-c7-4', dmxMin: 208, dmxMax: 212, label: 'Open',            type: 'custom' },
            { id: 'mdn-c7-5', dmxMin: 213, dmxMax: 251, label: 'Random Strobe',   type: 'custom' },
            { id: 'mdn-c7-6', dmxMin: 252, dmxMax: 255, label: 'Open',            type: 'custom' },
          ],
        },
        { id: 'mdn-c8',  number: 8,  name: 'Red',                 function: 'red',         defaultValue: 0,   min: 0, max: 255 },
        { id: 'mdn-c9',  number: 9,  name: 'Green',               function: 'green',       defaultValue: 0,   min: 0, max: 255 },
        { id: 'mdn-c10', number: 10, name: 'Blue',                function: 'blue',        defaultValue: 0,   min: 0, max: 255 },
        { id: 'mdn-c11', number: 11, name: 'White',               function: 'white',       defaultValue: 0,   min: 0, max: 255 },
        {
          id: 'mdn-c12', number: 12, name: 'Continuous Pan Rot',  function: 'custom',      defaultValue: 0,   min: 0, max: 255,
          capabilities: [
            { id: 'mdn-c12-0', dmxMin: 0,   dmxMax: 127, label: 'No Function',        type: 'custom' },
            { id: 'mdn-c12-1', dmxMin: 128, dmxMax: 191, label: 'CW Fast→Slow',       type: 'custom' },
            { id: 'mdn-c12-2', dmxMin: 192, dmxMax: 255, label: 'CCW Slow→Fast',      type: 'custom' },
          ],
        },
        { id: 'mdn-c13', number: 13, name: 'Color Macros',        function: 'color-wheel', defaultValue: 0,   min: 0, max: 255 },
        {
          id: 'mdn-c14', number: 14, name: 'Continuous Tilt Rot', function: 'custom',      defaultValue: 0,   min: 0, max: 255,
          capabilities: [
            { id: 'mdn-c14-0', dmxMin: 0,   dmxMax: 127, label: 'No Function',        type: 'custom' },
            { id: 'mdn-c14-1', dmxMin: 128, dmxMax: 191, label: 'CW Fast→Slow',       type: 'custom' },
            { id: 'mdn-c14-2', dmxMin: 192, dmxMax: 255, label: 'CCW Slow→Fast',      type: 'custom' },
          ],
        },
        { id: 'mdn-c15', number: 15, name: 'Color Macro Speed',   function: 'speed',       defaultValue: 0,   min: 0, max: 255 },
        { id: 'mdn-c16', number: 16, name: 'Color Crossfade',     function: 'custom',      defaultValue: 0,   min: 0, max: 255 },
        { id: 'mdn-c17', number: 17, name: 'Internal Programs',   function: 'macro',       defaultValue: 0,   min: 0, max: 255 },
        { id: 'mdn-c18', number: 18, name: 'Program Speed',       function: 'speed',       defaultValue: 0,   min: 0, max: 255 },
        {
          id: 'mdn-c19', number: 19, name: 'Control/Reset',       function: 'custom',      defaultValue: 0,   min: 0, max: 255,
          capabilities: [
            { id: 'mdn-c19-0', dmxMin: 0,   dmxMax: 79,  label: 'Safe / No Function', type: 'custom' },
            { id: 'mdn-c19-1', dmxMin: 80,  dmxMax: 99,  label: 'Motor Reset',        type: 'custom' },
            { id: 'mdn-c19-2', dmxMin: 100, dmxMax: 119, label: 'Display Off',        type: 'custom' },
            { id: 'mdn-c19-3', dmxMin: 120, dmxMax: 255, label: 'Calibration/Other',  type: 'custom' },
          ],
        },
      ],
    }],
  },
  // ── SunD DM-RGB400 Laser ──
  {
    id: 'sund-dm-rgb400',
    manufacturer: 'SunD',
    model: 'DM-RGB400',
    type: 'other',
    category: 'dmx',
    colorSystem: 'rgb',
    createdAt: 0,
    modes: [{
      id: 'sund-std', name: 'DMX Standard (12ch)', channelCount: 12,
      channels: [
        {
          id: 'sund-c1', number: 1, name: 'Mode', function: 'macro', defaultValue: 150, min: 0, max: 255,
          capabilities: [
            { id: 'sund-c1-0', dmxMin: 0,   dmxMax: 49,  label: 'Sound Active',     type: 'macro' },
            { id: 'sund-c1-1', dmxMin: 50,  dmxMax: 99,  label: 'Auto Mode',        type: 'macro' },
            { id: 'sund-c1-2', dmxMin: 100, dmxMax: 149, label: 'Static Patterns',  type: 'macro' },
            { id: 'sund-c1-3', dmxMin: 150, dmxMax: 255, label: 'Dynamic Patterns', type: 'macro' },
          ],
        },
        { id: 'sund-c2',  number: 2,  name: 'Pattern Select',  function: 'macro',   defaultValue: 0, min: 0, max: 255 },
        { id: 'sund-c3',  number: 3,  name: 'Strobe',          function: 'strobe',  defaultValue: 0, min: 0, max: 255 },
        { id: 'sund-c4',  number: 4,  name: 'Drawing Speed',   function: 'speed',   defaultValue: 0, min: 0, max: 255 },
        { id: 'sund-c5',  number: 5,  name: 'Horizontal (X)',  function: 'pan',     defaultValue: 128, min: 0, max: 255 },
        { id: 'sund-c6',  number: 6,  name: 'Vertical (Y)',    function: 'tilt',    defaultValue: 128, min: 0, max: 255 },
        { id: 'sund-c7',  number: 7,  name: 'Zoom',            function: 'zoom',    defaultValue: 128, min: 0, max: 255 },
        {
          id: 'sund-c8', number: 8, name: 'Color Mode', function: 'color-wheel', defaultValue: 0, min: 0, max: 255,
          capabilities: [
            { id: 'sund-c8-0', dmxMin: 0,   dmxMax: 49,  label: 'Red',          type: 'color', color: '#ff0000' },
            { id: 'sund-c8-1', dmxMin: 50,  dmxMax: 99,  label: 'Green',        type: 'color', color: '#00ff00' },
            { id: 'sund-c8-2', dmxMin: 100, dmxMax: 149, label: 'Blue',         type: 'color', color: '#0000ff' },
            { id: 'sund-c8-3', dmxMin: 150, dmxMax: 199, label: 'Yellow',       type: 'color', color: '#ffff00' },
            { id: 'sund-c8-4', dmxMin: 200, dmxMax: 224, label: 'Cyan',         type: 'color', color: '#00ffff' },
            { id: 'sund-c8-5', dmxMin: 225, dmxMax: 255, label: 'Multi-Color',  type: 'color', color: '#ffffff' },
          ],
        },
        {
          id: 'sund-c9', number: 9, name: 'Reset', function: 'custom', defaultValue: 0, min: 0, max: 255,
          capabilities: [
            { id: 'sund-c9-0', dmxMin: 0,   dmxMax: 200, label: 'Safe',  type: 'custom' },
            { id: 'sund-c9-1', dmxMin: 201, dmxMax: 255, label: 'Reset', type: 'custom' },
          ],
        },
        { id: 'sund-c10', number: 10, name: 'X Rotation', function: 'custom', defaultValue: 128, min: 0, max: 255 },
        { id: 'sund-c11', number: 11, name: 'Y Rotation', function: 'custom', defaultValue: 128, min: 0, max: 255 },
        { id: 'sund-c12', number: 12, name: 'Z Rotation', function: 'custom', defaultValue: 128, min: 0, max: 255 },
      ],
    }],
  },
  // ── WLED Built-in fixtures ──
  {
    id: 'wled-strip-60',
    manufacturer: 'WLED',
    model: '60 LED Strip',
    type: 'wled',
    category: 'wled',
    colorSystem: 'rgb',
    wledConfig: { ip: '', ledCount: 60, segments: 1, presets: [] },
    createdAt: 0,
    modes: [{
      id: 'wled-m1', name: 'WLED RGB', channelCount: 0,
      channels: [],
    }],
  },
  {
    id: 'wled-strip-144',
    manufacturer: 'WLED',
    model: '144 LED Strip',
    type: 'wled',
    category: 'wled',
    colorSystem: 'rgb',
    wledConfig: { ip: '', ledCount: 144, segments: 1, presets: [] },
    createdAt: 0,
    modes: [{
      id: 'wled-m1', name: 'WLED RGB', channelCount: 0,
      channels: [],
    }],
  },
  {
    id: 'wled-matrix-16x16',
    manufacturer: 'WLED',
    model: '16×16 Matrix',
    type: 'wled',
    category: 'wled',
    colorSystem: 'rgb',
    wledConfig: { ip: '', ledCount: 256, segments: 1, presets: [] },
    createdAt: 0,
    modes: [{
      id: 'wled-m1', name: 'WLED RGB', channelCount: 0,
      channels: [],
    }],
  },
];

interface FixtureStore {
  definitions: FixtureDefinition[];
  instances: FixtureInstance[];
  savedModes: SavedMode[]; // reusable mode templates
  addDefinition: (def: FixtureDefinition) => void;
  removeDefinition: (id: string) => void;
  updateDefinition: (id: string, updates: Partial<FixtureDefinition>) => void;
  addInstance: (inst: FixtureInstance) => void;
  removeInstance: (id: string) => void;
  updateInstance: (id: string, updates: Partial<FixtureInstance>) => void;
  addSavedMode: (mode: SavedMode) => void;
  removeSavedMode: (id: string) => void;
  exportLibrary: () => string;
  importLibrary: (json: string) => void;
}

/** A saved/reusable channel mode template */
export interface SavedMode {
  id: string;
  name: string;
  description?: string;
  fixtureType?: string; // e.g. 'moving-head', 'par'
  mode: FixtureMode;
  createdAt: number;
}

const DEFAULT_INSTANCES: FixtureInstance[] = [
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
  {
    id: 'inst-5', definitionId: 'generic-color-wheel-spot', name: 'SPOT-1',
    universe: 1, dmxAddress: 44, modeId: 'm1',
    onStage: false, stageX: 350, stageY: 200, stageWidth: 36, stageHeight: 36,
  },
];

export const useFixtureStore = create<FixtureStore>()(
  persist(
    (set, get) => ({
      definitions: [...BUILT_IN_FIXTURES],
      instances: [...DEFAULT_INSTANCES],
      savedModes: [] as SavedMode[],
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
      addSavedMode: (mode) => set(s => ({ savedModes: [...s.savedModes, mode] })),
      removeSavedMode: (id) => set(s => ({ savedModes: s.savedModes.filter(m => m.id !== id) })),
      exportLibrary: () => {
        const { definitions, savedModes } = get();
        return JSON.stringify({ stokioFixtureLibrary: true, version: 1, definitions, savedModes }, null, 2);
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
              ...(Array.isArray(data.savedModes) ? {
                savedModes: [
                  ...s.savedModes,
                  ...data.savedModes.filter((m: SavedMode) => !s.savedModes.some(e => e.id === m.id)),
                ],
              } : {}),
            }));
          }
        } catch { /* invalid JSON */ }
      },
    }),
    {
      name: 'stokio-fixtures-v1',
      partialize: (state) => ({
        definitions: state.definitions,
        instances: state.instances,
        savedModes: state.savedModes,
      }),
    }
  )
);

// Sync: broadcast fixture changes
useFixtureStore.subscribe((state) => {
  if (!isSyncingFromRemote()) {
    broadcastState('fixtures', {
      definitions: state.definitions,
      instances: state.instances,
    });
  }
});

// Sync: receive remote fixture updates
onSyncState((incoming) => {
  const fx = incoming.fixtures as Record<string, unknown> | undefined;
  if (fx) {
    useFixtureStore.setState({
      ...(fx.definitions !== undefined && { definitions: fx.definitions as FixtureDefinition[] }),
      ...(fx.instances !== undefined && { instances: fx.instances as FixtureInstance[] }),
    });
  }
});

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
    beam: '↯', strobe: '⚡', laser: '⟐', effect: '✧', dimmer: '◐', wled: '💡', other: '□',
  };
  return icons[type];
}
