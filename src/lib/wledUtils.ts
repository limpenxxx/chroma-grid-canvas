import type { WledDevice, WledFixture } from '@/store/wledStore';
import { engineWledPresets } from '@/lib/wsSync';

export interface WledPresetSummary {
  id: number;
  name: string;
}

export const WLED_DEVICE_TARGET_PREFIX = '_wled_device_';

/**
 * Fetch WLED presets via engine server (not direct HTTP).
 * The engine makes the HTTP request to the WLED device on the local network.
 */
export async function fetchWledPresets(ip: string): Promise<WledPresetSummary[]> {
  const trimmedIp = ip.trim();
  if (!trimmedIp) return [];

  try {
    const result = await engineWledPresets(trimmedIp);
    const data = result.data;
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
  } catch {
    return [];
  }
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
