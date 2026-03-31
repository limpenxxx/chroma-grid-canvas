// Philips Hue Bridge REST API client
// Works via local HTTP API (same network as bridge)

export interface HueBridge {
  id: string;
  ip: string;
  name: string;
  apiKey: string | null; // null = not yet paired
  modelId?: string;
  swVersion?: string;
}

export interface HueLight {
  id: string; // Hue light ID (string number)
  name: string;
  type: string; // e.g. "Extended color light", "Color temperature light"
  modelId: string;
  manufacturerName: string;
  uniqueId: string;
  state: HueLightState;
  capabilities: {
    hasColor: boolean;
    hasColorTemp: boolean;
  };
}

export interface HueLightState {
  on: boolean;
  bri: number;    // 1-254
  hue?: number;   // 0-65535
  sat?: number;   // 0-254
  ct?: number;    // color temp in mirek (153-500)
  xy?: [number, number]; // CIE xy
  colormode?: 'hs' | 'xy' | 'ct';
  reachable: boolean;
}

export interface HueGroup {
  id: string;
  name: string;
  type: string; // "Room", "Zone", etc
  lights: string[];
  state: { all_on: boolean; any_on: boolean };
  action: Partial<HueLightState>;
}

export interface HueScene {
  id: string;
  name: string;
  type: string;
  group?: string;
  lights: string[];
}

// ── Discovery ──

/** Discover bridges via Philips cloud endpoint (works from any network) */
export async function discoverBridges(): Promise<Array<{ id: string; internalipaddress: string }>> {
  try {
    const res = await fetch('https://discovery.meethue.com/', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// ── Pairing ──

/** Request a new API key from the bridge (user must press link button first) */
export async function pairBridge(ip: string): Promise<{ success: boolean; apiKey?: string; error?: string }> {
  try {
    const res = await fetch(`http://${ip}/api`, {
      method: 'POST',
      body: JSON.stringify({ devicetype: 'stokio_fx#browser' }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    if (Array.isArray(data) && data[0]?.success?.username) {
      return { success: true, apiKey: data[0].success.username };
    }
    const errorDesc = data[0]?.error?.description || 'Unknown error';
    return { success: false, error: errorDesc };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ── API helpers ──

async function hueGet<T>(ip: string, apiKey: string, path: string): Promise<T | null> {
  try {
    const res = await fetch(`http://${ip}/api/${apiKey}${path}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function huePut(ip: string, apiKey: string, path: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`http://${ip}/api/${apiKey}${path}`, {
      method: 'PUT',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Bridge info ──

export async function getBridgeConfig(ip: string, apiKey: string) {
  return hueGet<Record<string, unknown>>(ip, apiKey, '/config');
}

// ── Lights ──

export async function getLights(ip: string, apiKey: string): Promise<HueLight[]> {
  const data = await hueGet<Record<string, any>>(ip, apiKey, '/lights');
  if (!data) return [];
  return Object.entries(data).map(([id, light]) => ({
    id,
    name: light.name,
    type: light.type,
    modelId: light.modelid || '',
    manufacturerName: light.manufacturername || 'Philips',
    uniqueId: light.uniqueid || '',
    state: {
      on: light.state?.on ?? false,
      bri: light.state?.bri ?? 0,
      hue: light.state?.hue,
      sat: light.state?.sat,
      ct: light.state?.ct,
      xy: light.state?.xy,
      colormode: light.state?.colormode,
      reachable: light.state?.reachable ?? false,
    },
    capabilities: {
      hasColor: light.type?.toLowerCase().includes('color') ?? false,
      hasColorTemp: light.type?.toLowerCase().includes('temperature') || light.type?.toLowerCase().includes('color') || false,
    },
  }));
}

// ── Light control ──

export async function setLightState(ip: string, apiKey: string, lightId: string, state: Partial<HueLightState>): Promise<boolean> {
  return huePut(ip, apiKey, `/lights/${lightId}/state`, state as Record<string, unknown>);
}

export async function setLightColor(ip: string, apiKey: string, lightId: string, r: number, g: number, b: number): Promise<boolean> {
  const xy = rgbToXy(r, g, b);
  return setLightState(ip, apiKey, lightId, { xy, on: true });
}

export async function setLightBrightness(ip: string, apiKey: string, lightId: string, bri: number): Promise<boolean> {
  return setLightState(ip, apiKey, lightId, { bri: Math.max(1, Math.min(254, Math.round(bri * 2.54))) });
}

export async function setLightPower(ip: string, apiKey: string, lightId: string, on: boolean): Promise<boolean> {
  return setLightState(ip, apiKey, lightId, { on });
}

// ── Groups ──

export async function getGroups(ip: string, apiKey: string): Promise<HueGroup[]> {
  const data = await hueGet<Record<string, any>>(ip, apiKey, '/groups');
  if (!data) return [];
  return Object.entries(data).map(([id, g]) => ({
    id,
    name: g.name,
    type: g.type || 'LightGroup',
    lights: g.lights || [],
    state: g.state || { all_on: false, any_on: false },
    action: g.action || {},
  }));
}

export async function setGroupState(ip: string, apiKey: string, groupId: string, state: Partial<HueLightState>): Promise<boolean> {
  return huePut(ip, apiKey, `/groups/${groupId}/action`, state as Record<string, unknown>);
}

// ── Scenes ──

export async function getScenes(ip: string, apiKey: string): Promise<HueScene[]> {
  const data = await hueGet<Record<string, any>>(ip, apiKey, '/scenes');
  if (!data) return [];
  return Object.entries(data).map(([id, s]) => ({
    id,
    name: s.name,
    type: s.type || 'LightScene',
    group: s.group,
    lights: s.lights || [],
  }));
}

export async function activateScene(ip: string, apiKey: string, groupId: string, sceneId: string): Promise<boolean> {
  return huePut(ip, apiKey, `/groups/${groupId}/action`, { scene: sceneId });
}

// ── Color conversion ──

/** Convert RGB (0-255) to CIE xy for Hue API */
export function rgbToXy(r: number, g: number, b: number): [number, number] {
  // Gamma correction
  let red = r / 255;
  let green = g / 255;
  let blue = b / 255;

  red = red > 0.04045 ? Math.pow((red + 0.055) / 1.055, 2.4) : red / 12.92;
  green = green > 0.04045 ? Math.pow((green + 0.055) / 1.055, 2.4) : green / 12.92;
  blue = blue > 0.04045 ? Math.pow((blue + 0.055) / 1.055, 2.4) : blue / 12.92;

  const X = red * 0.664511 + green * 0.154324 + blue * 0.162028;
  const Y = red * 0.283881 + green * 0.668433 + blue * 0.047685;
  const Z = red * 0.000088 + green * 0.072310 + blue * 0.986039;

  const sum = X + Y + Z;
  if (sum === 0) return [0.3127, 0.3290]; // D65 white point
  return [X / sum, Y / sum];
}

/** Convert CIE xy + brightness to RGB (0-255) */
export function xyToRgb(x: number, y: number, bri: number = 254): { r: number; g: number; b: number } {
  const z = 1.0 - x - y;
  const Y = bri / 254;
  const X = (Y / y) * x;
  const Z = (Y / y) * z;

  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.011530;

  // Reverse gamma
  r = r <= 0.0031308 ? 12.92 * r : (1.0 + 0.055) * Math.pow(r, 1.0 / 2.4) - 0.055;
  g = g <= 0.0031308 ? 12.92 * g : (1.0 + 0.055) * Math.pow(g, 1.0 / 2.4) - 0.055;
  b = b <= 0.0031308 ? 12.92 * b : (1.0 + 0.055) * Math.pow(b, 1.0 / 2.4) - 0.055;

  return {
    r: Math.max(0, Math.min(255, Math.round(r * 255))),
    g: Math.max(0, Math.min(255, Math.round(g * 255))),
    b: Math.max(0, Math.min(255, Math.round(b * 255))),
  };
}
