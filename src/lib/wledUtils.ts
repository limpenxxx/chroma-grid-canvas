import type { WledDevice, WledFixture } from '@/store/wledStore';

export interface WledPresetSummary {
  id: number;
  name: string;
}

export const WLED_DEVICE_TARGET_PREFIX = '_wled_device_';

const REQUEST_TIMEOUT = 3000;

async function fetchJsonWithTimeout(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchWledPresets(ip: string): Promise<WledPresetSummary[]> {
  const trimmedIp = ip.trim();
  if (!trimmedIp) return [];

  const data = await fetchJsonWithTimeout(`http://${trimmedIp}/presets.json`);
  if (!data || typeof data !== 'object') return [];

  return Object.entries(data as Record<string, unknown>)
    .map(([key, value]) => {
      const id = Number(key);
      if (!Number.isInteger(id)) return null;

      const preset = value as { n?: unknown } | null;
      const name = typeof preset?.n === 'string' && preset.n.trim()
        ? preset.n.trim()
        : `Preset ${id}`;

      return { id, name };
    })
    .filter((preset): preset is WledPresetSummary => preset !== null)
    .sort((a, b) => a.id - b.id);
}

export function getWledDeviceLedCount(device: WledDevice): number {
  if (device.info?.leds.count) return Math.max(1, device.info.leds.count);

  const segmentMax = device.state?.seg?.reduce((max, seg) => Math.max(max, seg.stop), 0) ?? 0;
  return Math.max(1, segmentMax);
}

export function wledDeviceToFixture(device: WledDevice): WledFixture {
  const ledCount = getWledDeviceLedCount(device);

  return {
    id: `${WLED_DEVICE_TARGET_PREFIX}${device.id}`,
    deviceId: device.id,
    name: `${device.name} · All LEDs`,
    segmentId: 0,
    ledStart: 0,
    ledEnd: ledCount - 1,
    deviceIp: device.ip,
    deviceName: device.name,
  };
}

export function isWledDeviceTargetId(id: string): boolean {
  return id.startsWith(WLED_DEVICE_TARGET_PREFIX);
}

export function isWledDeviceTarget(fixture: WledFixture): boolean {
  return isWledDeviceTargetId(fixture.id);
}