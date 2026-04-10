/**
 * Arpeggiator Widget — Dimmer / RGBW light sequencer
 * 
 * Plays looping patterns across linked devices (DMX, WLED, Hue, MagicHome)
 * with BPM sync, audio reactivity, and customizable color/dimmer sequences.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Play, Square, Zap, Music, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

// ── Types ──

export type ArpPattern = 
  | 'up'           // 1→2→3→4→1...
  | 'down'         // 4→3→2→1→4...
  | 'up-down'      // 1→2→3→4→3→2→1...
  | 'random'       // random device each step
  | 'all-flash'    // all on simultaneously, then off
  | 'even-odd'     // alternating even/odd
  | 'chase'        // one at a time with fade tail
  | 'scatter'      // random subset each step
  | 'matrix';      // custom grid pattern (rows=devices, cols=steps)

export type ArpChannel = 'dimmer' | 'rgb' | 'rgbw';

export type ArpSyncMode = 'free' | 'bpm' | 'audio';

export interface ArpColorStep {
  r: number;
  g: number;
  b: number;
  w: number;       // white channel (0-255)
  dimmer: number;   // 0-255
}

export interface ArpMatrixCell {
  on: boolean;
  color?: { r: number; g: number; b: number };
  dimmer?: number; // 0-255
}

export interface ArpConfig {
  running: boolean;
  pattern: ArpPattern;
  channel: ArpChannel;
  syncMode: ArpSyncMode;
  speed: number;           // steps per second (free mode), 0.25-20
  bpmDivision: number;     // beats per step: 0.25, 0.5, 1, 2, 4
  fadePct: number;          // 0-100, how much of step duration is fade
  steps: ArpColorStep[];   // color sequence (cycles through)
  intensity: number;       // master intensity 0-255
  tailLength: number;      // for chase: how many fixtures trail (1-8)
  // Matrix pattern grid: rows = devices, cols = time steps
  matrixRows: number;      // number of device rows (usually = linked fixtures)
  matrixCols: number;      // number of time step columns
  matrixGrid: ArpMatrixCell[][]; // [row][col]
}

export const ARP_PATTERNS: { value: ArpPattern; label: string }[] = [
  { value: 'up', label: '↑ Up' },
  { value: 'down', label: '↓ Down' },
  { value: 'up-down', label: '↕ Up/Down' },
  { value: 'random', label: '🎲 Random' },
  { value: 'all-flash', label: '⚡ All Flash' },
  { value: 'even-odd', label: '▥ Even/Odd' },
  { value: 'chase', label: '→ Chase' },
  { value: 'scatter', label: '✦ Scatter' },
  { value: 'matrix', label: '▦ Matrix' },
];

export const BPM_DIVISIONS: { value: number; label: string }[] = [
  { value: 0.25, label: '1/4 beat' },
  { value: 0.5, label: '1/2 beat' },
  { value: 1, label: '1 beat' },
  { value: 2, label: '2 beats' },
  { value: 4, label: '4 beats' },
  { value: 8, label: '8 beats' },
];

export const DEFAULT_ARP_STEPS: ArpColorStep[] = [
  { r: 255, g: 0, b: 0, w: 0, dimmer: 255 },
  { r: 0, g: 0, b: 255, w: 0, dimmer: 255 },
  { r: 0, g: 255, b: 0, w: 0, dimmer: 255 },
  { r: 255, g: 255, b: 0, w: 0, dimmer: 255 },
];

export const ARP_PRESETS: { label: string; steps: ArpColorStep[]; pattern: ArpPattern }[] = [
  { label: '🔴🔵 R/B Police', pattern: 'even-odd', steps: [
    { r: 255, g: 0, b: 0, w: 0, dimmer: 255 },
    { r: 0, g: 0, b: 255, w: 0, dimmer: 255 },
  ]},
  { label: '🌈 Rainbow Chase', pattern: 'chase', steps: [
    { r: 255, g: 0, b: 0, w: 0, dimmer: 255 },
    { r: 255, g: 127, b: 0, w: 0, dimmer: 255 },
    { r: 255, g: 255, b: 0, w: 0, dimmer: 255 },
    { r: 0, g: 255, b: 0, w: 0, dimmer: 255 },
    { r: 0, g: 0, b: 255, w: 0, dimmer: 255 },
    { r: 128, g: 0, b: 255, w: 0, dimmer: 255 },
  ]},
  { label: '⚡ Strobe', pattern: 'all-flash', steps: [
    { r: 255, g: 255, b: 255, w: 255, dimmer: 255 },
    { r: 0, g: 0, b: 0, w: 0, dimmer: 0 },
  ]},
  { label: '🔥 Warm Pulse', pattern: 'up', steps: [
    { r: 255, g: 80, b: 0, w: 60, dimmer: 255 },
    { r: 255, g: 40, b: 0, w: 30, dimmer: 180 },
    { r: 200, g: 20, b: 0, w: 10, dimmer: 100 },
  ]},
  { label: '💜 UV Sweep', pattern: 'chase', steps: [
    { r: 128, g: 0, b: 255, w: 0, dimmer: 255 },
    { r: 200, g: 0, b: 255, w: 0, dimmer: 200 },
    { r: 80, g: 0, b: 200, w: 0, dimmer: 120 },
  ]},
  { label: '💡 Dimmer Wave', pattern: 'up-down', steps: [
    { r: 255, g: 255, b: 255, w: 255, dimmer: 255 },
    { r: 255, g: 255, b: 255, w: 255, dimmer: 180 },
    { r: 255, g: 255, b: 255, w: 255, dimmer: 100 },
    { r: 255, g: 255, b: 255, w: 255, dimmer: 40 },
  ]},
];

export function createDefaultArpConfig(): ArpConfig {
  return {
    running: false,
    pattern: 'chase',
    channel: 'rgb',
    syncMode: 'bpm',
    speed: 4,
    bpmDivision: 1,
    fadePct: 30,
    steps: [...DEFAULT_ARP_STEPS],
    intensity: 255,
    tailLength: 2,
  };
}

// ── Arp Engine (runs in widget) ──

export interface ArpEngineState {
  stepIndex: number;        // current step in sequence
  deviceIndex: number;      // current device in pattern
  phase: number;            // 0-1 within current step
  direction: 1 | -1;        // for up-down
  activeDevices: boolean[];  // which devices are currently "on"
}

/**
 * Calculate which devices should be active and what color/dimmer they should show.
 * Returns an array of { dimmer, r, g, b, w } per linked device.
 */
export function computeArpFrame(
  config: ArpConfig,
  state: ArpEngineState,
  deviceCount: number,
  timeSeconds: number,
  bpm: number,
  audioLevel: number,
): { outputs: ArpColorStep[]; nextState: ArpEngineState } {
  if (deviceCount === 0 || config.steps.length === 0) {
    return { outputs: Array(deviceCount).fill({ r: 0, g: 0, b: 0, w: 0, dimmer: 0 }), nextState: state };
  }

  // Calculate step timing
  let stepDuration: number; // seconds per step
  if (config.syncMode === 'bpm' && bpm > 0) {
    stepDuration = (60 / bpm) * config.bpmDivision;
  } else if (config.syncMode === 'audio') {
    // Audio: speed modulated by audio level
    const audioMod = 0.5 + (audioLevel / 255) * 1.5;
    stepDuration = 1 / (config.speed * audioMod);
  } else {
    stepDuration = 1 / config.speed;
  }

  const totalSteps = config.pattern === 'up-down' ? Math.max(1, deviceCount * 2 - 2) : deviceCount;
  const cycleTime = stepDuration * totalSteps;
  const t = cycleTime > 0 ? (timeSeconds % cycleTime) / cycleTime : 0;
  const currentStepFloat = t * totalSteps;
  const currentStep = Math.floor(currentStepFloat);
  const stepPhase = currentStepFloat - currentStep; // 0-1 within step

  const fadeIn = config.fadePct / 100;
  const brightness = stepPhase < fadeIn ? stepPhase / fadeIn : 1;
  const fadeOut = stepPhase > (1 - fadeIn) ? (1 - stepPhase) / fadeIn : 1;
  const envelope = Math.min(brightness, fadeOut);

  const intensityScale = config.intensity / 255;

  const outputs: ArpColorStep[] = Array(deviceCount).fill(null).map(() => ({
    r: 0, g: 0, b: 0, w: 0, dimmer: 0,
  }));

  const getStepColor = (idx: number): ArpColorStep => {
    return config.steps[idx % config.steps.length];
  };

  // Deterministic random from step count
  const pseudoRand = (seed: number) => Math.abs(Math.sin(seed * 12345.6789 + 0.1)) ;

  switch (config.pattern) {
    case 'up': {
      const activeDevice = currentStep % deviceCount;
      const color = getStepColor(currentStep);
      outputs[activeDevice] = applyEnvelope(color, envelope, intensityScale);
      break;
    }
    case 'down': {
      const activeDevice = (deviceCount - 1) - (currentStep % deviceCount);
      const color = getStepColor(currentStep);
      outputs[activeDevice] = applyEnvelope(color, envelope, intensityScale);
      break;
    }
    case 'up-down': {
      let activeDevice: number;
      if (currentStep < deviceCount) {
        activeDevice = currentStep;
      } else {
        activeDevice = deviceCount - 2 - (currentStep - deviceCount);
      }
      activeDevice = Math.max(0, Math.min(deviceCount - 1, activeDevice));
      const color = getStepColor(currentStep);
      outputs[activeDevice] = applyEnvelope(color, envelope, intensityScale);
      break;
    }
    case 'random': {
      const activeDevice = Math.floor(pseudoRand(currentStep) * deviceCount);
      const color = getStepColor(currentStep);
      outputs[activeDevice] = applyEnvelope(color, envelope, intensityScale);
      break;
    }
    case 'all-flash': {
      const colorIdx = Math.floor(currentStepFloat) % config.steps.length;
      const color = config.steps[colorIdx];
      for (let i = 0; i < deviceCount; i++) {
        outputs[i] = applyEnvelope(color, envelope, intensityScale);
      }
      break;
    }
    case 'even-odd': {
      const isEvenPhase = (Math.floor(currentStepFloat / deviceCount) % 2) === 0;
      for (let i = 0; i < deviceCount; i++) {
        const isEven = i % 2 === 0;
        const colorIdx = isEven ? 0 : 1;
        const active = isEvenPhase ? isEven : !isEven;
        if (active) {
          outputs[i] = applyEnvelope(getStepColor(colorIdx), envelope, intensityScale);
        }
      }
      break;
    }
    case 'chase': {
      const headPos = currentStep % deviceCount;
      const color = getStepColor(currentStep);
      for (let tail = 0; tail < config.tailLength; tail++) {
        const pos = (headPos - tail + deviceCount) % deviceCount;
        const tailFade = 1 - (tail / config.tailLength);
        outputs[pos] = applyEnvelope(color, envelope * tailFade, intensityScale);
      }
      break;
    }
    case 'scatter': {
      const color = getStepColor(currentStep);
      for (let i = 0; i < deviceCount; i++) {
        if (pseudoRand(currentStep * 100 + i) > 0.5) {
          outputs[i] = applyEnvelope(color, envelope, intensityScale);
        }
      }
      break;
    }
  }

  return {
    outputs,
    nextState: { ...state, stepIndex: currentStep, phase: stepPhase, deviceIndex: currentStep % deviceCount, direction: 1, activeDevices: outputs.map(o => o.dimmer > 0) },
  };
}

function applyEnvelope(color: ArpColorStep, envelope: number, intensityScale: number): ArpColorStep {
  const s = envelope * intensityScale;
  return {
    r: Math.round(color.r * s),
    g: Math.round(color.g * s),
    b: Math.round(color.b * s),
    w: Math.round(color.w * s),
    dimmer: Math.round(color.dimmer * s),
  };
}

// ── Visual Preview ──

export function ArpeggiatorPreview({ config, bpm, deviceCount, audioLevel }: {
  config: ArpConfig;
  bpm: number;
  deviceCount: number;
  audioLevel: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startTimeRef = useRef(performance.now() / 1000);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !config.running) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const state: ArpEngineState = {
      stepIndex: 0, deviceIndex: 0, phase: 0, direction: 1,
      activeDevices: Array(Math.max(deviceCount, 4)).fill(false),
    };

    const draw = () => {
      const now = performance.now() / 1000 - startTimeRef.current;
      const count = Math.max(deviceCount, 4);
      const { outputs } = computeArpFrame(config, state, count, now, bpm, audioLevel);

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const cellW = w / count;
      const cellH = h;

      for (let i = 0; i < count; i++) {
        const o = outputs[i];
        const brightness = (o.r + o.g + o.b) / 3 / 255;
        ctx.fillStyle = `rgb(${o.r},${o.g},${o.b})`;
        ctx.globalAlpha = Math.max(0.08, brightness);
        ctx.fillRect(i * cellW + 1, 0, cellW - 2, cellH);

        // Glow
        if (brightness > 0.3) {
          ctx.globalAlpha = brightness * 0.4;
          ctx.shadowColor = `rgb(${o.r},${o.g},${o.b})`;
          ctx.shadowBlur = 10;
          ctx.fillRect(i * cellW + 1, 0, cellW - 2, cellH);
          ctx.shadowBlur = 0;
        }
        ctx.globalAlpha = 1;
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [config, bpm, deviceCount, audioLevel, config.running]);

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={40}
      className="w-full rounded border border-border/10"
      style={{ height: 40, imageRendering: 'pixelated' }}
    />
  );
}
