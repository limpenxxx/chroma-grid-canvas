/**
 * Layer Blending System — xLights-inspired effect compositing
 * 
 * Multiple effect layers per node/fixture with blend modes.
 */

export type BlendMode =
  | 'normal'
  | 'additive'
  | 'subtract'
  | 'multiply'
  | 'screen'
  | 'max'
  | 'min'
  | 'average'
  | 'mask'          // Layer 1 masks layer 2 (alpha from top)
  | 'unmask'        // Inverted mask
  | 'overlay'
  | 'difference';

export const BLEND_LABELS: Record<BlendMode, string> = {
  'normal': 'Normal',
  'additive': 'Additive',
  'subtract': 'Subtract',
  'multiply': 'Multiply',
  'screen': 'Screen',
  'max': 'Max (Lighten)',
  'min': 'Min (Darken)',
  'average': 'Average',
  'mask': 'Mask',
  'unmask': 'Unmask (Inv. Mask)',
  'overlay': 'Overlay',
  'difference': 'Difference',
};

export interface EffectLayer {
  id: string;
  name: string;
  effectPreset: string;  // VisualizerPreset or test pattern name
  blendMode: BlendMode;
  opacity: number;       // 0-1
  enabled: boolean;
  solo: boolean;
  order: number;         // rendering order (lower = bottom)
}

/**
 * Blend two pixel values (0-255 per channel) using a blend mode.
 */
export function blendPixel(
  baseR: number, baseG: number, baseB: number,
  topR: number, topG: number, topB: number,
  mode: BlendMode,
  opacity: number
): [number, number, number] {
  let rR: number, rG: number, rB: number;

  switch (mode) {
    case 'normal':
      rR = topR;
      rG = topG;
      rB = topB;
      break;

    case 'additive':
      rR = Math.min(255, baseR + topR);
      rG = Math.min(255, baseG + topG);
      rB = Math.min(255, baseB + topB);
      break;

    case 'subtract':
      rR = Math.max(0, baseR - topR);
      rG = Math.max(0, baseG - topG);
      rB = Math.max(0, baseB - topB);
      break;

    case 'multiply':
      rR = (baseR * topR) / 255;
      rG = (baseG * topG) / 255;
      rB = (baseB * topB) / 255;
      break;

    case 'screen':
      rR = 255 - ((255 - baseR) * (255 - topR)) / 255;
      rG = 255 - ((255 - baseG) * (255 - topG)) / 255;
      rB = 255 - ((255 - baseB) * (255 - topB)) / 255;
      break;

    case 'max':
      rR = Math.max(baseR, topR);
      rG = Math.max(baseG, topG);
      rB = Math.max(baseB, topB);
      break;

    case 'min':
      rR = Math.min(baseR, topR);
      rG = Math.min(baseG, topG);
      rB = Math.min(baseB, topB);
      break;

    case 'average':
      rR = (baseR + topR) / 2;
      rG = (baseG + topG) / 2;
      rB = (baseB + topB) / 2;
      break;

    case 'mask': {
      const maskLuma = (topR * 0.299 + topG * 0.587 + topB * 0.114) / 255;
      rR = baseR * maskLuma;
      rG = baseG * maskLuma;
      rB = baseB * maskLuma;
      break;
    }

    case 'unmask': {
      const unmaskLuma = 1 - (topR * 0.299 + topG * 0.587 + topB * 0.114) / 255;
      rR = baseR * unmaskLuma;
      rG = baseG * unmaskLuma;
      rB = baseB * unmaskLuma;
      break;
    }

    case 'overlay':
      rR = baseR < 128 ? (2 * baseR * topR) / 255 : 255 - (2 * (255 - baseR) * (255 - topR)) / 255;
      rG = baseG < 128 ? (2 * baseG * topG) / 255 : 255 - (2 * (255 - baseG) * (255 - topG)) / 255;
      rB = baseB < 128 ? (2 * baseB * topB) / 255 : 255 - (2 * (255 - baseB) * (255 - topB)) / 255;
      break;

    case 'difference':
      rR = Math.abs(baseR - topR);
      rG = Math.abs(baseG - topG);
      rB = Math.abs(baseB - topB);
      break;

    default:
      rR = topR;
      rG = topG;
      rB = topB;
  }

  // Apply opacity
  return [
    Math.round(baseR + (rR - baseR) * opacity),
    Math.round(baseG + (rG - baseG) * opacity),
    Math.round(baseB + (rB - baseB) * opacity),
  ];
}

/**
 * Blend two ImageData buffers using a blend mode.
 * Modifies baseData in place.
 */
export function blendImageData(
  baseData: ImageData,
  topData: ImageData,
  mode: BlendMode,
  opacity: number
): void {
  const len = Math.min(baseData.data.length, topData.data.length);
  for (let i = 0; i < len; i += 4) {
    const [r, g, b] = blendPixel(
      baseData.data[i], baseData.data[i + 1], baseData.data[i + 2],
      topData.data[i], topData.data[i + 1], topData.data[i + 2],
      mode,
      opacity * (topData.data[i + 3] / 255) // factor in alpha
    );
    baseData.data[i] = r;
    baseData.data[i + 1] = g;
    baseData.data[i + 2] = b;
  }
}

/**
 * Create a default effect layer
 */
export function createDefaultLayer(order: number, preset = 'plasma-wave'): EffectLayer {
  return {
    id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: `Layer ${order + 1}`,
    effectPreset: preset,
    blendMode: order === 0 ? 'normal' : 'additive',
    opacity: 1,
    enabled: true,
    solo: false,
    order,
  };
}
