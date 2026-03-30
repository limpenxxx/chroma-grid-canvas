// Node Logic Types

export interface NodePort {
  id: string;
  label: string;
  type: 'input' | 'output';
  dataType?: 'dmx' | 'trigger' | 'value' | 'color' | 'audio' | 'gpio';
}

export interface NodeConfig {
  // DMX
  universe?: number;
  channelStart?: number;
  channelEnd?: number;
  protocol?: string;
  ipAddress?: string;
  // ESP32
  gpioPin?: number;
  buttonMode?: 'push-release' | 'toggle' | 'double-press' | 'hold' | 'pot';
  holdTime?: number; // ms
  doublePressTime?: number; // ms
  potMin?: number;
  potMax?: number;
  // WLED
  wledSegment?: number;
  wledIp?: string;
  // Mapping
  mappedTarget?: string; // Live DJ button ID, script name, etc.
  mappedTargetType?: 'livdj-button' | 'script' | 'scene' | 'dimmer' | 'media';
  // Channel mapping
  channelMappings?: ChannelMapping[];
  // Firmware
  firmwareType?: 'esphome' | 'wled-usermod' | 'custom';
}

export interface ChannelMapping {
  dmxChannel: number;
  targetType: 'livdj-button' | 'script' | 'scene' | 'dimmer' | 'fader' | 'color';
  targetId: string;
  targetLabel: string;
  rangeMin?: number; // DMX value range
  rangeMax?: number;
}

export type NodeCategory = 'dmx-input' | 'dmx-output' | 'wled' | 'audio' | 'esp32' | 'triggers' | 'processing';

export interface LogicNode {
  id: string;
  name: string;
  category: NodeCategory;
  x: number;
  y: number;
  ports: NodePort[];
  color: string;
  config: NodeConfig;
  templateId: string;
}

export interface Connection {
  id: string;
  fromNodeId: string;
  fromPortId: string;
  toNodeId: string;
  toPortId: string;
}

export interface NodeTemplate {
  id: string;
  name: string;
  category: NodeCategory;
  color: string;
  description: string;
  ports: Omit<NodePort, 'id'>[];
  defaultConfig: NodeConfig;
}

export const CATEGORY_META: Record<NodeCategory, { label: string; color: string; icon: string }> = {
  'dmx-input':   { label: 'DMX INPUT',    color: '#00e5ff', icon: '📥' },
  'dmx-output':  { label: 'DMX OUTPUT',   color: '#ffaa00', icon: '📤' },
  'wled':        { label: 'WLED',         color: '#ff6600', icon: '💡' },
  'audio':       { label: 'AUDIO',        color: '#aa44ff', icon: '🎵' },
  'esp32':       { label: 'ESP32 GPIO',   color: '#00cc44', icon: '🔌' },
  'triggers':    { label: 'TRIGGERS',     color: '#ff2d78', icon: '⚡' },
  'processing':  { label: 'PROCESSING',   color: '#4488ff', icon: '⚙️' },
};
