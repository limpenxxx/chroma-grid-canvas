/**
 * Value Curves System — xLights-inspired parameter automation
 * 
 * Allows any numeric parameter to be animated over time using
 * predefined curve shapes, optionally synced to BPM.
 */

export type CurveType =
  | 'flat'
  | 'ramp-up'
  | 'ramp-down'
  | 'ramp-up-down'
  | 'sine'
  | 'square'
  | 'sawtooth'
  | 'triangle'
  | 'random'
  | 'exponential-up'
  | 'exponential-down'
  | 'logarithmic'
  | 'bounce'
  | 'elastic';

export const CURVE_LABELS: Record<CurveType, string> = {
  'flat': '── Flat',
  'ramp-up': '╱ Ramp Up',
  'ramp-down': '╲ Ramp Down',
  'ramp-up-down': '╱╲ Ramp Up/Down',
  'sine': '∿ Sine Wave',
  'square': '⊓ Square Wave',
  'sawtooth': '⩘ Sawtooth',
  'triangle': '△ Triangle',
  'random': '⚡ Random',
  'exponential-up': '⤴ Exponential Up',
  'exponential-down': '⤵ Exponential Down',
  'logarithmic': '↗ Logarithmic',
  'bounce': '⏎ Bounce',
  'elastic': '〰 Elastic',
};

export type BpmSyncMode = 'none' | 'beat' | '2-beats' | '4-beats' | '8-beats' | '16-beats' | 'bar' | '2-bars' | '4-bars';

export const BPM_SYNC_LABELS: Record<BpmSyncMode, string> = {
  'none': 'Free (time)',
  'beat': '1 Beat',
  '2-beats': '2 Beats',
  '4-beats': '4 Beats',
  '8-beats': '8 Beats',
  '16-beats': '16 Beats',
  'bar': '1 Bar',
  '2-bars': '2 Bars',
  '4-bars': '4 Bars',
};

export interface ValueCurve {
  id: string;
  paramName: string;       // e.g. 'sensitivity', 'colorShift', 'blur'
  curveType: CurveType;
  min: number;             // output range min
  max: number;             // output range max
  speed: number;           // cycles per second (when bpmSync = 'none')
  bpmSync: BpmSyncMode;
  phase: number;           // 0-1 phase offset
  enabled: boolean;
}

/**
 * Get the number of beats for a given sync mode
 */
function syncModeToBeats(mode: BpmSyncMode): number {
  switch (mode) {
    case 'beat': return 1;
    case '2-beats': return 2;
    case '4-beats': return 4;
    case '8-beats': return 8;
    case '16-beats': return 16;
    case 'bar': return 4;
    case '2-bars': return 8;
    case '4-bars': return 16;
    default: return 0;
  }
}

/**
 * Evaluate a curve at a given time position.
 * 
 * @param curve - The curve definition
 * @param timeSeconds - Current time in seconds
 * @param bpm - Current BPM (0 if no BPM source)
 * @param beatPhase - Current beat phase 0-1 (fraction within current beat cycle)
 * @returns Value between curve.min and curve.max
 */
export function evaluateCurve(
  curve: ValueCurve,
  timeSeconds: number,
  bpm: number = 0,
  beatPhase: number = 0
): number {
  if (!curve.enabled) return curve.min;

  let t: number; // normalized position 0-1 within cycle

  if (curve.bpmSync !== 'none' && bpm > 0) {
    // BPM-synced: calculate position within the beat cycle
    const beatsPerCycle = syncModeToBeats(curve.bpmSync);
    const secondsPerBeat = 60 / bpm;
    const cycleLength = secondsPerBeat * beatsPerCycle;
    t = ((timeSeconds / cycleLength) + curve.phase) % 1;
  } else {
    // Free-running: use speed (cycles per second)
    t = ((timeSeconds * curve.speed) + curve.phase) % 1;
  }

  // Evaluate curve shape
  let v: number; // 0-1 output

  switch (curve.curveType) {
    case 'flat':
      v = 1;
      break;
    case 'ramp-up':
      v = t;
      break;
    case 'ramp-down':
      v = 1 - t;
      break;
    case 'ramp-up-down':
      v = t < 0.5 ? t * 2 : (1 - t) * 2;
      break;
    case 'sine':
      v = (Math.sin(t * Math.PI * 2) + 1) / 2;
      break;
    case 'square':
      v = t < 0.5 ? 1 : 0;
      break;
    case 'sawtooth':
      v = t;
      break;
    case 'triangle':
      v = t < 0.5 ? t * 2 : 2 - t * 2;
      break;
    case 'random':
      // Deterministic random based on cycle count
      v = Math.abs(Math.sin(Math.floor(timeSeconds * (curve.speed || 1)) * 12345.6789)) ;
      break;
    case 'exponential-up':
      v = t * t * t;
      break;
    case 'exponential-down':
      v = 1 - (1 - t) * (1 - t) * (1 - t);
      break;
    case 'logarithmic':
      v = Math.log(1 + t * 9) / Math.log(10);
      break;
    case 'bounce': {
      // Bouncing ball effect
      const b = Math.abs(Math.sin(t * Math.PI * 3) * (1 - t));
      v = b;
      break;
    }
    case 'elastic': {
      const p = 0.3;
      v = Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
      v = Math.max(0, Math.min(1, v));
      break;
    }
    default:
      v = 0;
  }

  // Map to output range
  return curve.min + v * (curve.max - curve.min);
}

/**
 * Create a default value curve
 */
export function createDefaultCurve(paramName: string, min = 0, max = 1): ValueCurve {
  return {
    id: `vc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    paramName,
    curveType: 'sine',
    min,
    max,
    speed: 0.5,
    bpmSync: 'none',
    phase: 0,
    enabled: true,
  };
}
