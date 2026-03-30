import type { NodeTemplate } from './types';

export const NODE_LIBRARY: NodeTemplate[] = [
  // ── DMX INPUT ──
  {
    id: 'artnet-in', name: 'ArtNet DMX In', category: 'dmx-input', color: '#00e5ff',
    description: 'Receive DMX over ArtNet from a physical console',
    ports: [
      { label: 'Universe Out', type: 'output', dataType: 'dmx' },
    ],
    defaultConfig: { protocol: 'ArtNet', universe: 1, channelStart: 1, channelEnd: 512 },
  },
  {
    id: 'sacn-in', name: 'sACN DMX In', category: 'dmx-input', color: '#00e5ff',
    description: 'Receive DMX over sACN (E1.31)',
    ports: [
      { label: 'Universe Out', type: 'output', dataType: 'dmx' },
    ],
    defaultConfig: { protocol: 'sACN', universe: 1, channelStart: 1, channelEnd: 512 },
  },
  {
    id: 'usb-dmx-in', name: 'USB-DMX In', category: 'dmx-input', color: '#00e5ff',
    description: 'Receive DMX via USB-DMX dongle',
    ports: [
      { label: 'DMX Data', type: 'output', dataType: 'dmx' },
    ],
    defaultConfig: { protocol: 'USB-DMX', universe: 1 },
  },
  {
    id: 'dmx-channel-map', name: 'DMX Channel Mapper', category: 'dmx-input', color: '#00e5ff',
    description: 'Map specific DMX channels to triggers, faders, or buttons',
    ports: [
      { label: 'DMX In', type: 'input', dataType: 'dmx' },
      { label: 'Trigger 1', type: 'output', dataType: 'trigger' },
      { label: 'Trigger 2', type: 'output', dataType: 'trigger' },
      { label: 'Value 1', type: 'output', dataType: 'value' },
      { label: 'Value 2', type: 'output', dataType: 'value' },
    ],
    defaultConfig: { channelMappings: [] },
  },

  // ── DMX OUTPUT ──
  {
    id: 'artnet-out', name: 'ArtNet DMX Out', category: 'dmx-output', color: '#ffaa00',
    description: 'Send DMX out via ArtNet to local fixtures',
    ports: [
      { label: 'Universe 1', type: 'input', dataType: 'dmx' },
      { label: 'Universe 2', type: 'input', dataType: 'dmx' },
    ],
    defaultConfig: { protocol: 'ArtNet', universe: 1, ipAddress: '255.255.255.255' },
  },
  {
    id: 'sacn-out', name: 'sACN DMX Out', category: 'dmx-output', color: '#ffaa00',
    description: 'Send DMX out via sACN (E1.31)',
    ports: [
      { label: 'Universe 1', type: 'input', dataType: 'dmx' },
    ],
    defaultConfig: { protocol: 'sACN', universe: 1 },
  },
  {
    id: 'usb-dmx-out', name: 'USB-DMX Out', category: 'dmx-output', color: '#ffaa00',
    description: 'Send DMX via USB-DMX dongle',
    ports: [
      { label: 'DMX Data', type: 'input', dataType: 'dmx' },
    ],
    defaultConfig: { protocol: 'USB-DMX', universe: 1 },
  },

  // ── WLED ──
  {
    id: 'wled-out', name: 'WLED Output', category: 'wled', color: '#ff6600',
    description: 'Send pixel data to a WLED controller',
    ports: [
      { label: 'Pixel Data', type: 'input', dataType: 'color' },
      { label: 'Trigger', type: 'input', dataType: 'trigger' },
    ],
    defaultConfig: { wledIp: '192.168.1.100', wledSegment: 0 },
  },
  {
    id: 'wled-segment', name: 'WLED Segment Color', category: 'wled', color: '#ff6600',
    description: 'Set color/effect on a specific WLED segment',
    ports: [
      { label: 'Color', type: 'input', dataType: 'color' },
      { label: 'Brightness', type: 'input', dataType: 'value' },
    ],
    defaultConfig: { wledIp: '192.168.1.100', wledSegment: 0 },
  },
  {
    id: 'wled-e131', name: 'WLED E1.31 Bridge', category: 'wled', color: '#ff6600',
    description: 'Bridge DMX to WLED via E1.31 protocol',
    ports: [
      { label: 'DMX In', type: 'input', dataType: 'dmx' },
      { label: 'Status', type: 'output', dataType: 'trigger' },
    ],
    defaultConfig: { wledIp: '192.168.1.100', universe: 1 },
  },

  // ── AUDIO ──
  {
    id: 'mic-input', name: 'Microphone Input', category: 'audio', color: '#aa44ff',
    description: 'System mic / audio interface input',
    ports: [
      { label: 'Audio Level', type: 'output', dataType: 'value' },
      { label: 'FFT Data', type: 'output', dataType: 'value' },
      { label: 'Beat', type: 'output', dataType: 'trigger' },
    ],
    defaultConfig: {},
  },
  {
    id: 'audio-peak', name: 'Audio Peak Detect', category: 'audio', color: '#aa44ff',
    description: 'Detect audio peaks for trigger events',
    ports: [
      { label: 'Audio In', type: 'input', dataType: 'value' },
      { label: 'Peak Trigger', type: 'output', dataType: 'trigger' },
      { label: 'Level', type: 'output', dataType: 'value' },
    ],
    defaultConfig: {},
  },
  {
    id: 'audio-interface', name: 'Audio Interface', category: 'audio', color: '#aa44ff',
    description: 'Linux audio interface input/output',
    ports: [
      { label: 'Input L', type: 'output', dataType: 'value' },
      { label: 'Input R', type: 'output', dataType: 'value' },
      { label: 'Output L', type: 'input', dataType: 'value' },
      { label: 'Output R', type: 'input', dataType: 'value' },
    ],
    defaultConfig: {},
  },

  // ── ESP32 GPIO ──
  {
    id: 'esp32-button', name: 'ESP32 Button', category: 'esp32', color: '#00cc44',
    description: 'Physical push button on ESP32 GPIO',
    ports: [
      { label: 'Pressed', type: 'output', dataType: 'trigger' },
      { label: 'Released', type: 'output', dataType: 'trigger' },
      { label: 'Double', type: 'output', dataType: 'trigger' },
      { label: 'Hold', type: 'output', dataType: 'trigger' },
    ],
    defaultConfig: { gpioPin: 4, buttonMode: 'push-release', holdTime: 1000, doublePressTime: 300 },
  },
  {
    id: 'esp32-toggle', name: 'ESP32 Toggle Switch', category: 'esp32', color: '#00cc44',
    description: 'Physical toggle switch on ESP32 GPIO',
    ports: [
      { label: 'State', type: 'output', dataType: 'trigger' },
    ],
    defaultConfig: { gpioPin: 5, buttonMode: 'toggle' },
  },
  {
    id: 'esp32-pot', name: 'ESP32 Potentiometer', category: 'esp32', color: '#00cc44',
    description: 'Analog pot/fader on ESP32 ADC pin',
    ports: [
      { label: 'Value', type: 'output', dataType: 'value' },
    ],
    defaultConfig: { gpioPin: 34, buttonMode: 'pot', potMin: 0, potMax: 255 },
  },
  {
    id: 'esp32-encoder', name: 'ESP32 Rotary Encoder', category: 'esp32', color: '#00cc44',
    description: 'Rotary encoder with push button',
    ports: [
      { label: 'Value', type: 'output', dataType: 'value' },
      { label: 'Click', type: 'output', dataType: 'trigger' },
    ],
    defaultConfig: { gpioPin: 16 },
  },
  {
    id: 'esp32-led', name: 'ESP32 LED Output', category: 'esp32', color: '#00cc44',
    description: 'Drive status LED from ESP32 GPIO',
    ports: [
      { label: 'On/Off', type: 'input', dataType: 'trigger' },
      { label: 'PWM', type: 'input', dataType: 'value' },
    ],
    defaultConfig: { gpioPin: 2 },
  },

  // ── TRIGGERS ──
  {
    id: 'trigger-scene', name: 'Trigger Scene', category: 'triggers', color: '#ff2d78',
    description: 'Activate a saved scene/preset',
    ports: [
      { label: 'Trigger', type: 'input', dataType: 'trigger' },
      { label: 'Active', type: 'output', dataType: 'trigger' },
    ],
    defaultConfig: { mappedTargetType: 'scene', mappedTarget: '' },
  },
  {
    id: 'trigger-dj-button', name: 'Live DJ Button', category: 'triggers', color: '#ff2d78',
    description: 'Trigger a Live DJ button/widget',
    ports: [
      { label: 'Press', type: 'input', dataType: 'trigger' },
      { label: 'Value', type: 'input', dataType: 'value' },
    ],
    defaultConfig: { mappedTargetType: 'livdj-button', mappedTarget: '' },
  },
  {
    id: 'trigger-script', name: 'Run Script', category: 'triggers', color: '#ff2d78',
    description: 'Execute a custom automation script',
    ports: [
      { label: 'Run', type: 'input', dataType: 'trigger' },
      { label: 'Done', type: 'output', dataType: 'trigger' },
    ],
    defaultConfig: { mappedTargetType: 'script', mappedTarget: '' },
  },
  {
    id: 'trigger-media', name: 'Media Control', category: 'triggers', color: '#ff2d78',
    description: 'Play/pause/skip media in the Media Server',
    ports: [
      { label: 'Play', type: 'input', dataType: 'trigger' },
      { label: 'Pause', type: 'input', dataType: 'trigger' },
      { label: 'Next', type: 'input', dataType: 'trigger' },
    ],
    defaultConfig: { mappedTargetType: 'media', mappedTarget: '' },
  },
  {
    id: 'trigger-dimmer', name: 'Master Dimmer', category: 'triggers', color: '#ff2d78',
    description: 'Control the master dimmer value',
    ports: [
      { label: 'Value', type: 'input', dataType: 'value' },
    ],
    defaultConfig: { mappedTargetType: 'dimmer', mappedTarget: 'master' },
  },

  // ── PROCESSING ──
  {
    id: 'proc-merge', name: 'Universe Merge', category: 'processing', color: '#4488ff',
    description: 'Merge two DMX universes (HTP)',
    ports: [
      { label: 'DMX A', type: 'input', dataType: 'dmx' },
      { label: 'DMX B', type: 'input', dataType: 'dmx' },
      { label: 'Merged', type: 'output', dataType: 'dmx' },
    ],
    defaultConfig: {},
  },
  {
    id: 'proc-threshold', name: 'Threshold Gate', category: 'processing', color: '#4488ff',
    description: 'Pass trigger when value exceeds threshold',
    ports: [
      { label: 'Value In', type: 'input', dataType: 'value' },
      { label: 'Trigger', type: 'output', dataType: 'trigger' },
    ],
    defaultConfig: {},
  },
  {
    id: 'proc-lfo', name: 'LFO Generator', category: 'processing', color: '#4488ff',
    description: 'Low frequency oscillator for automated effects',
    ports: [
      { label: 'Output', type: 'output', dataType: 'value' },
    ],
    defaultConfig: {},
  },
  {
    id: 'proc-value-map', name: 'Value Mapper', category: 'processing', color: '#4488ff',
    description: 'Remap value range (e.g. 0-255 → 0-100)',
    ports: [
      { label: 'In', type: 'input', dataType: 'value' },
      { label: 'Out', type: 'output', dataType: 'value' },
    ],
    defaultConfig: {},
  },
];
