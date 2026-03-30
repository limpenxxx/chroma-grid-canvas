/**
 * WLED JSON API wrapper for controlling real WLED devices on the local network.
 * Docs: https://kno.wled.ge/interfaces/json-api/
 *
 * NOTE: This only works over HTTP (local network).
 * HTTPS pages cannot fetch HTTP endpoints (mixed-content block).
 * Run the app locally with `npm run dev` to use this.
 */

export interface WledState {
  on: boolean;
  bri: number;       // 0-255
  transition: number;
  ps: number;        // current preset
  pl: number;        // current playlist
  seg: WledSegment[];
}

export interface WledSegment {
  id: number;
  start: number;
  stop: number;
  len: number;
  col: [number, number, number][];  // [[R,G,B], [R,G,B], [R,G,B]]
  fx: number;
  sx: number;   // speed
  ix: number;   // intensity
  pal: number;  // palette
  on: boolean;
  bri: number;
}

export interface WledInfo {
  ver: string;
  vid: number;
  leds: { count: number; pwr: number; fps: number; maxpwr: number; maxseg: number };
  name: string;
  udpport: number;
  arch: string;
  brand: string;
  product: string;
  mac: string;
  ip: string;
  wifi?: { bssid: string; rssi: number; signal: number; channel: number };
}

export interface WledFullState {
  state: WledState;
  info: WledInfo;
  effects: string[];
  palettes: string[];
}

export interface WledDevice {
  id: string;
  ip: string;
  name: string;
  online: boolean;
  info?: WledInfo;
  state?: WledState;
  effects?: string[];
  palettes?: string[];
}

const TIMEOUT = 3000;

async function fetchWithTimeout(url: string, opts?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Get full WLED state + info */
export async function getWledState(ip: string): Promise<WledFullState> {
  const res = await fetchWithTimeout(`http://${ip}/json`);
  if (!res.ok) throw new Error(`WLED ${ip}: HTTP ${res.status}`);
  return res.json();
}

/** Set WLED state (partial update) */
export async function setWledState(ip: string, state: Record<string, unknown>): Promise<void> {
  await fetchWithTimeout(`http://${ip}/json/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
}

/** Turn on/off */
export async function setWledPower(ip: string, on: boolean): Promise<void> {
  await setWledState(ip, { on });
}

/** Set brightness 0-255 */
export async function setWledBrightness(ip: string, bri: number): Promise<void> {
  await setWledState(ip, { bri: Math.max(0, Math.min(255, bri)) });
}

/** Set color on segment 0 */
export async function setWledColor(ip: string, r: number, g: number, b: number): Promise<void> {
  await setWledState(ip, { seg: [{ id: 0, col: [[r, g, b]] }] });
}

/** Activate a preset */
export async function setWledPreset(ip: string, presetId: number): Promise<void> {
  await setWledState(ip, { ps: presetId });
}

/** Set effect by ID with optional speed/intensity */
export async function setWledEffect(ip: string, fx: number, sx?: number, ix?: number, pal?: number): Promise<void> {
  const seg: Record<string, unknown> = { id: 0, fx };
  if (sx !== undefined) seg.sx = sx;
  if (ix !== undefined) seg.ix = ix;
  if (pal !== undefined) seg.pal = pal;
  await setWledState(ip, { seg: [seg] });
}

/** Check if device is reachable */
export async function pingWled(ip: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`http://${ip}/json/info`);
    return res.ok;
  } catch {
    return false;
  }
}
