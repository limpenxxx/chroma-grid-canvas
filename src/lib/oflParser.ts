/**
 * Open Fixture Library (OFL) Parser
 * Converts OFL JSON fixture format to STOKIO FixtureDefinition.
 * API: https://open-fixture-library.org/<manufacturer>/<fixture>.json
 */

import type {
  FixtureDefinition,
  FixtureMode,
  FixtureChannel,
  ChannelFunction,
  ChannelCapability,
  ColorSystem,
} from '@/store/fixtureStore';

// ── OFL JSON types (subset) ──

interface OflCapability {
  dmxRange: [number, number];
  type: string;
  comment?: string;
  effectName?: string;
  shutterEffect?: string;
  speedStart?: string;
  speedEnd?: string;
  color?: string;
  colors?: { startColors?: string[]; endColors?: string[] };
  slotNumber?: number;
  [key: string]: unknown;
}

interface OflChannel {
  fineChannelAliases?: string[];
  defaultValue?: number | string;
  capability?: { type: string; [key: string]: unknown };
  capabilities?: OflCapability[];
}

interface OflMode {
  name: string;
  shortName?: string;
  channels: (string | null)[];
}

interface OflFixture {
  name: string;
  shortName?: string;
  categories?: string[];
  availableChannels?: Record<string, OflChannel>;
  modes?: OflMode[];
  wheels?: Record<string, { slots?: { type: string; name?: string; colors?: string[] }[] }>;
}

// ── Map OFL capability types to STOKIO channel functions ──

function mapOflType(type: string, channelName: string): ChannelFunction {
  const lower = channelName.toLowerCase();

  // Name-based first
  if (lower.includes('dimmer') || type === 'Intensity') return 'dimmer';
  if (lower === 'pan' || type === 'Pan') return 'pan';
  if (lower === 'pan fine') return 'pan-fine';
  if (lower === 'tilt' || type === 'Tilt') return 'tilt';
  if (lower === 'tilt fine') return 'tilt-fine';
  if (lower === 'red' || lower.includes(' red')) return 'red';
  if (lower === 'green' || lower.includes(' green')) return 'green';
  if (lower === 'blue' || lower.includes(' blue')) return 'blue';
  if (lower === 'white' || lower.includes(' white')) return 'white';
  if (lower === 'amber' || lower.includes('amber')) return 'amber';
  if (lower === 'uv' || lower.includes('uv')) return 'uv';
  if (lower.includes('cyan') || lower.includes('magenta') || lower.includes('yellow')) return 'color-wheel';
  if (lower.includes('zoom')) return 'zoom';
  if (lower.includes('focus')) return 'focus';
  if (lower.includes('iris')) return 'iris';
  if (lower.includes('frost')) return 'frost';
  if (lower.includes('prism')) return 'prism';
  if (lower.includes('gobo') && lower.includes('rot')) return 'gobo-rotation';
  if (lower.includes('gobo')) return 'gobo';
  if (lower.includes('color') && lower.includes('wheel')) return 'color-wheel';
  if (lower.includes('strobe') || lower.includes('shutter')) return 'shutter';
  if (lower.includes('speed')) return 'speed';
  if (lower.includes('cto')) return 'cto';
  if (lower.includes('ctb')) return 'ctb';
  if (lower.includes('macro') || lower.includes('program') || lower.includes('chase')) return 'macro';

  // Type-based fallback
  switch (type) {
    case 'Pan': return 'pan';
    case 'Tilt': return 'tilt';
    case 'Intensity': return 'dimmer';
    case 'ColorIntensity': return 'custom';
    case 'ColorPreset': case 'ColorTemperature': return 'cto';
    case 'ShutterStrobe': return 'shutter';
    case 'WheelSlot': case 'WheelRotation': return 'color-wheel';
    case 'Effect': case 'EffectSpeed': return 'fx';
    case 'Zoom': return 'zoom';
    case 'Focus': return 'focus';
    case 'Prism': case 'PrismRotation': return 'prism';
    case 'Frost': return 'frost';
    case 'Iris': return 'iris';
    case 'Speed': case 'PanTiltSpeed': return 'speed';
    default: return 'custom';
  }
}

function mapOflCategory(categories: string[]): FixtureDefinition['type'] {
  const joined = categories.join(' ').toLowerCase();
  if (joined.includes('moving head')) return 'moving-head';
  if (joined.includes('pixel bar') || joined.includes('strip') || joined.includes('batten')) return 'strip';
  if (joined.includes('blinder') || joined.includes('strobe')) return 'strobe';
  if (joined.includes('laser')) return 'laser';
  if (joined.includes('dimmer')) return 'dimmer';
  if (joined.includes('effect') || joined.includes('flower')) return 'effect';
  if (joined.includes('scanner')) return 'moving-head';
  return 'par';
}

// ── Parse OFL JSON into FixtureDefinition ──

export function parseOflJson(json: OflFixture, manufacturer: string): FixtureDefinition | null {
  try {
    if (!json.availableChannels || !json.modes?.length) return null;

    const channels = json.availableChannels;

    // Build a set of all fine channel aliases
    const fineAliases = new Set<string>();
    for (const ch of Object.values(channels)) {
      ch.fineChannelAliases?.forEach((a) => fineAliases.add(a));
    }

    // Parse modes
    const modes: FixtureMode[] = json.modes.map((mode, modeIdx) => {
      const modeChannels: FixtureChannel[] = [];

      mode.channels.forEach((chName, chIdx) => {
        if (!chName) return; // null = unused gap

        // Check if this is a fine channel alias
        if (fineAliases.has(chName)) {
          // Find parent channel to get the type
          const lower = chName.toLowerCase();
          const fn: ChannelFunction = lower.includes('pan') ? 'pan-fine'
            : lower.includes('tilt') ? 'tilt-fine'
            : 'custom';

          modeChannels.push({
            id: `ofl-${modeIdx}-${chIdx}`,
            number: chIdx + 1,
            name: chName,
            function: fn,
            defaultValue: 0,
            min: 0,
            max: 255,
          });
          return;
        }

        const chDef = channels[chName];
        if (!chDef) {
          modeChannels.push({
            id: `ofl-${modeIdx}-${chIdx}`,
            number: chIdx + 1,
            name: chName,
            function: 'custom',
            defaultValue: 0,
            min: 0,
            max: 255,
          });
          return;
        }

        // Determine channel function
        const capType = chDef.capability?.type || chDef.capabilities?.[0]?.type || 'Generic';
        const fn = mapOflType(capType, chName);

        // Parse capabilities
        const caps: ChannelCapability[] = [];
        if (chDef.capabilities) {
          chDef.capabilities.forEach((cap, capIdx) => {
            const label = cap.comment || cap.effectName || cap.shutterEffect || cap.type || `Range ${capIdx + 1}`;
            caps.push({
              id: `ofl-cap-${modeIdx}-${chIdx}-${capIdx}`,
              dmxMin: cap.dmxRange[0],
              dmxMax: cap.dmxRange[1],
              label,
              type: cap.type.includes('Gobo') ? 'gobo'
                : cap.type.includes('Color') || cap.type.includes('Wheel') ? 'color'
                : 'custom',
            });
          });
        }

        const defVal = typeof chDef.defaultValue === 'number' ? chDef.defaultValue
          : (fn === 'pan' || fn === 'tilt' || fn === 'focus') ? 128 : 0;

        modeChannels.push({
          id: `ofl-${modeIdx}-${chIdx}`,
          number: chIdx + 1,
          name: chName,
          function: fn,
          defaultValue: defVal,
          min: 0,
          max: 255,
          capabilities: caps.length > 1 ? caps : undefined,
        });
      });

      return {
        id: `ofl-mode-${modeIdx}`,
        name: `${mode.name} (${modeChannels.length}ch)`,
        channelCount: modeChannels.length,
        channels: modeChannels,
      };
    }).filter((m) => m.channels.length > 0);

    if (modes.length === 0) return null;

    // Determine color system
    const fns = modes[0].channels.map((c) => c.function);
    const hasRgb = fns.includes('red') && fns.includes('green') && fns.includes('blue');
    const hasWhite = fns.includes('white');
    const colorSystem: ColorSystem = hasRgb ? (hasWhite ? 'rgbw' : 'rgb') : 'color-wheel';

    return {
      id: `ofl-${manufacturer}-${json.name}-${Date.now()}`.replace(/\s+/g, '-').toLowerCase(),
      manufacturer,
      model: json.name,
      type: mapOflCategory(json.categories || []),
      category: 'dmx',
      colorSystem,
      modes,
      createdAt: Date.now(),
    };
  } catch (err) {
    console.error('[OFL] Parse error:', err);
    return null;
  }
}

// ── API helpers ──

const OFL_BASE = 'https://open-fixture-library.org';

export interface OflManufacturerInfo {
  key: string;
  name: string;
  website?: string;
  fixtures: { key: string; name: string; categories: string[] }[];
}

export async function fetchOflManufacturers(): Promise<Record<string, { name: string }>> {
  const res = await fetch(`${OFL_BASE}/api/v1/manufacturers`);
  if (!res.ok) throw new Error('Failed to fetch manufacturers');
  return res.json();
}

export async function fetchOflManufacturer(key: string): Promise<OflManufacturerInfo> {
  const res = await fetch(`${OFL_BASE}/api/v1/manufacturers/${key}`);
  if (!res.ok) throw new Error(`Failed to fetch manufacturer: ${key}`);
  return res.json();
}

export async function fetchOflFixture(manufacturerKey: string, fixtureKey: string): Promise<OflFixture> {
  const res = await fetch(`${OFL_BASE}/${manufacturerKey}/${fixtureKey}.json`);
  if (!res.ok) throw new Error(`Failed to fetch fixture: ${manufacturerKey}/${fixtureKey}`);
  return res.json();
}
