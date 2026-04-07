/**
 * Preset Sequencer — Timeline-based preset scheduling with crossfade
 * 
 * Schedules visualizer presets on a timeline with automatic transitions.
 */

import type { VisualizerPreset } from './audioVisualizer';

export type TransitionType = 'cut' | 'crossfade' | 'fade-through-black';

export const TRANSITION_LABELS: Record<TransitionType, string> = {
  'cut': '⚡ Cut',
  'crossfade': '🔄 Crossfade',
  'fade-through-black': '⬛ Fade Through Black',
};

export interface SequencerStep {
  id: string;
  preset: VisualizerPreset;
  durationMs: number;        // how long this preset plays
  transitionType: TransitionType;
  transitionDurationMs: number; // crossfade/transition length
  colorPalette?: string;     // named palette to apply
  label?: string;
}

export interface PresetSequence {
  id: string;
  name: string;
  steps: SequencerStep[];
  loop: boolean;
  bpmSync: boolean;          // sync step transitions to beats
}

export interface SequencerState {
  playing: boolean;
  currentStepIndex: number;
  stepStartTime: number;     // timestamp when current step started
  transitionProgress: number; // 0-1 during transition, -1 when not transitioning
  elapsedMs: number;
}

/**
 * Color palette presets (xLights-inspired)
 */
export interface ColorPalette {
  id: string;
  name: string;
  colors: string[]; // HSL strings
}

export const DEFAULT_PALETTES: ColorPalette[] = [
  { id: 'neon-club', name: '🎉 Neon Club', colors: ['hsl(300,100%,50%)', 'hsl(180,100%,50%)', 'hsl(60,100%,50%)', 'hsl(330,100%,50%)'] },
  { id: 'warm-fire', name: '🔥 Warm Fire', colors: ['hsl(0,100%,50%)', 'hsl(30,100%,50%)', 'hsl(45,100%,50%)', 'hsl(15,100%,40%)'] },
  { id: 'ice-blue', name: '❄️ Ice Blue', colors: ['hsl(190,100%,50%)', 'hsl(210,100%,60%)', 'hsl(230,80%,70%)', 'hsl(200,100%,40%)'] },
  { id: 'forest', name: '🌲 Forest', colors: ['hsl(120,60%,30%)', 'hsl(90,70%,40%)', 'hsl(150,50%,35%)', 'hsl(80,80%,25%)'] },
  { id: 'sunset', name: '🌅 Sunset', colors: ['hsl(20,100%,50%)', 'hsl(340,100%,50%)', 'hsl(45,100%,55%)', 'hsl(0,80%,40%)'] },
  { id: 'ocean', name: '🌊 Ocean', colors: ['hsl(200,100%,40%)', 'hsl(180,80%,50%)', 'hsl(220,90%,30%)', 'hsl(170,100%,45%)'] },
  { id: 'cyberpunk', name: '🤖 Cyberpunk', colors: ['hsl(300,100%,50%)', 'hsl(180,100%,50%)', 'hsl(60,100%,50%)', 'hsl(0,100%,50%)'] },
  { id: 'pastel', name: '🎨 Pastel', colors: ['hsl(350,80%,80%)', 'hsl(200,80%,80%)', 'hsl(120,60%,80%)', 'hsl(50,80%,80%)'] },
  { id: 'monochrome', name: '⬜ Monochrome', colors: ['hsl(0,0%,100%)', 'hsl(0,0%,70%)', 'hsl(0,0%,40%)', 'hsl(0,0%,10%)'] },
  { id: 'uv-glow', name: '💜 UV Glow', colors: ['hsl(270,100%,60%)', 'hsl(290,100%,50%)', 'hsl(310,80%,40%)', 'hsl(260,100%,70%)'] },
];

/**
 * Create a default sequencer step
 */
export function createDefaultStep(preset: VisualizerPreset, durationMs = 30000): SequencerStep {
  return {
    id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    preset,
    durationMs,
    transitionType: 'crossfade',
    transitionDurationMs: 2000,
  };
}

/**
 * Create a default sequence
 */
export function createDefaultSequence(): PresetSequence {
  return {
    id: `seq-${Date.now()}`,
    name: 'New Sequence',
    steps: [
      createDefaultStep('plasma-wave', 30000),
      createDefaultStep('northern-lights', 30000),
      createDefaultStep('fire-inferno', 20000),
      createDefaultStep('kaleidoscope', 25000),
    ],
    loop: true,
    bpmSync: false,
  };
}

/**
 * Calculate which step should be active at a given elapsed time
 */
export function getActiveStep(
  sequence: PresetSequence,
  elapsedMs: number
): { stepIndex: number; stepElapsed: number; transitionProgress: number } {
  if (sequence.steps.length === 0) {
    return { stepIndex: -1, stepElapsed: 0, transitionProgress: -1 };
  }

  const totalDuration = sequence.steps.reduce((sum, s) => sum + s.durationMs, 0);
  
  let effectiveElapsed = elapsedMs;
  if (sequence.loop && totalDuration > 0) {
    effectiveElapsed = elapsedMs % totalDuration;
  } else if (elapsedMs >= totalDuration) {
    // Not looping and past end
    return { stepIndex: sequence.steps.length - 1, stepElapsed: sequence.steps[sequence.steps.length - 1].durationMs, transitionProgress: -1 };
  }

  let accumulated = 0;
  for (let i = 0; i < sequence.steps.length; i++) {
    const step = sequence.steps[i];
    if (effectiveElapsed < accumulated + step.durationMs) {
      const stepElapsed = effectiveElapsed - accumulated;
      const timeToEnd = step.durationMs - stepElapsed;
      const nextStep = sequence.steps[(i + 1) % sequence.steps.length];
      
      // Check if we're in transition zone (end of step)
      let transitionProgress = -1;
      if (nextStep && timeToEnd <= step.transitionDurationMs) {
        transitionProgress = 1 - (timeToEnd / step.transitionDurationMs);
      }

      return { stepIndex: i, stepElapsed, transitionProgress };
    }
    accumulated += step.durationMs;
  }

  return { stepIndex: 0, stepElapsed: 0, transitionProgress: -1 };
}
