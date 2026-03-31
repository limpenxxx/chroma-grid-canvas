// MagicHome / flux_led device control via local REST proxy
// Requires magic-home-rest proxy running locally: https://github.com/CasperVerswijvelt/magic-home-rest
// Default proxy URL: http://localhost:3000

export interface MagicHomeDevice {
  id: string;         // MAC address e.g. "F4CFA2120867"
  address: string;    // IP address
  model: string;      // model string from discovery
  name: string;       // user-assigned label
}

export interface MagicHomeDeviceState {
  on: boolean;
  mode: string;       // "color" | "custom" | "preset" | etc
  color: { r: number; g: number; b: number };
  warm_white: number; // 0-255
  cold_white: number; // 0-255
}

const DEFAULT_PROXY = 'http://localhost:3000';

function proxyUrl(base: string | undefined): string {
  return (base || DEFAULT_PROXY).replace(/\/$/, '');
}

// ── Discovery ──

/** Get all MagicHome devices on the network (via proxy) */
export async function discoverDevices(proxyBase?: string): Promise<MagicHomeDevice[]> {
  try {
    const res = await fetch(`${proxyUrl(proxyBase)}/api/devices`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => ({
      id: d.id || d.address || '',
      address: d.address || '',
      model: d.model || '',
      name: d.name || `MagicHome (${d.address})`,
    }));
  } catch {
    return [];
  }
}

// ── Device state ──

/** Get current state of a device */
export async function getDeviceState(deviceId: string, proxyBase?: string): Promise<MagicHomeDeviceState | null> {
  try {
    const res = await fetch(`${proxyUrl(proxyBase)}/api/device/${deviceId}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      on: data.on ?? false,
      mode: data.mode || 'color',
      color: data.color || { r: 0, g: 0, b: 0 },
      warm_white: data.warm_white ?? 0,
      cold_white: data.cold_white ?? 0,
    };
  } catch {
    return null;
  }
}

// ── Control ──

async function postDevice(deviceId: string, action: string, body?: Record<string, unknown>, proxyBase?: string): Promise<boolean> {
  try {
    const res = await fetch(`${proxyUrl(proxyBase)}/api/device/${deviceId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Turn device on */
export async function setDeviceOn(deviceId: string, proxyBase?: string): Promise<boolean> {
  return postDevice(deviceId, 'on', undefined, proxyBase);
}

/** Turn device off */
export async function setDeviceOff(deviceId: string, proxyBase?: string): Promise<boolean> {
  return postDevice(deviceId, 'off', undefined, proxyBase);
}

/** Set RGB color */
export async function setDeviceColor(deviceId: string, r: number, g: number, b: number, proxyBase?: string): Promise<boolean> {
  return postDevice(deviceId, 'color', { r, g, b }, proxyBase);
}

/** Set warm white level (0-255) */
export async function setDeviceWarmWhite(deviceId: string, level: number, proxyBase?: string): Promise<boolean> {
  return postDevice(deviceId, 'warm-white', { value: Math.max(0, Math.min(255, level)) }, proxyBase);
}

/** Set color with brightness applied */
export async function setDeviceColorWithBrightness(
  deviceId: string, r: number, g: number, b: number, brightness: number, proxyBase?: string
): Promise<boolean> {
  const scale = brightness / 100;
  return setDeviceColor(deviceId, Math.round(r * scale), Math.round(g * scale), Math.round(b * scale), proxyBase);
}

/** Trigger a built-in pattern/effect */
export async function setDevicePattern(deviceId: string, pattern: string, speed: number = 50, proxyBase?: string): Promise<boolean> {
  return postDevice(deviceId, 'pattern', { pattern, speed }, proxyBase);
}

// Built-in patterns available on most MagicHome controllers
export const MAGIC_HOME_PATTERNS = [
  'seven_color_cross_fade',
  'red_gradual_change',
  'green_gradual_change',
  'blue_gradual_change',
  'yellow_gradual_change',
  'cyan_gradual_change',
  'purple_gradual_change',
  'white_gradual_change',
  'red_green_cross_fade',
  'red_blue_cross_fade',
  'green_blue_cross_fade',
  'seven_color_strobe_flash',
  'red_strobe_flash',
  'green_strobe_flash',
  'blue_strobe_flash',
  'yellow_strobe_flash',
  'cyan_strobe_flash',
  'purple_strobe_flash',
  'white_strobe_flash',
  'seven_color_jumping',
] as const;

export type MagicHomePattern = typeof MAGIC_HOME_PATTERNS[number];
