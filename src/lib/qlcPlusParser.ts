/**
 * QLC+ Fixture Definition (.qxf) Parser
 * Converts QLC+ XML fixture files to STOKIO FixtureDefinition format.
 *
 * QXF format reference:
 *   - Root: <FixtureDefinition> with xmlns
 *   - Children: <Manufacturer>, <Model>, <Type>, <Channel>, <Mode>
 *   - <Channel Name="..."> → <Group Byte="0|1">GroupName</Group>, <Capability Min="x" Max="y">Label</Capability>
 *   - <Mode Name="..."> → <Channel Number="n">ChannelName</Channel>, <Head> groups
 */

import type {
  FixtureDefinition,
  FixtureMode,
  FixtureChannel,
  ChannelFunction,
  ChannelCapability,
  ColorSystem,
} from '@/store/fixtureStore';

// ── Map QLC+ Group names to STOKIO channel functions ──

const GROUP_MAP: Record<string, ChannelFunction> = {
  Intensity: 'dimmer',
  Pan: 'pan',
  Tilt: 'tilt',
  Colour: 'color-wheel',
  Color: 'color-wheel',
  Gobo: 'gobo',
  Shutter: 'shutter',
  Beam: 'focus',
  Prism: 'prism',
  Speed: 'speed',
  Effect: 'fx',
  Maintenance: 'custom',
  Nothing: 'custom',
};

function mapGroup(group: string, byte: number, channelName: string): ChannelFunction {
  const lower = channelName.toLowerCase();

  // Fine channels
  if (byte === 1) {
    if (lower.includes('pan')) return 'pan-fine';
    if (lower.includes('tilt')) return 'tilt-fine';
    return 'custom';
  }

  // Name-based heuristics (more specific than group)
  if (lower.includes('strobe')) return 'strobe';
  if (lower.includes('dimmer') || lower === 'intensity' || lower === 'master dimmer') return 'dimmer';
  if (lower.includes('pan')) return 'pan';
  if (lower.includes('tilt')) return 'tilt';
  if (lower === 'red' || lower.includes('red')) return 'red';
  if (lower === 'green' || lower.includes('green')) return 'green';
  if (lower === 'blue' || lower.includes('blue')) return 'blue';
  if (lower === 'white' || lower.includes('white')) return 'white';
  if (lower === 'amber' || lower.includes('amber')) return 'amber';
  if (lower === 'uv' || lower.includes('uv')) return 'uv';
  if (lower.includes('zoom')) return 'zoom';
  if (lower.includes('focus')) return 'focus';
  if (lower.includes('iris')) return 'iris';
  if (lower.includes('frost')) return 'frost';
  if (lower.includes('prism')) return 'prism';
  if (lower.includes('gobo') && lower.includes('rot')) return 'gobo-rotation';
  if (lower.includes('gobo')) return 'gobo';
  if (lower.includes('cto')) return 'cto';
  if (lower.includes('ctb')) return 'ctb';
  if (lower.includes('macro')) return 'macro';
  if (lower.includes('speed')) return 'speed';

  // Fallback to group
  if (GROUP_MAP[group]) return GROUP_MAP[group];
  return 'custom';
}

function mapFixtureType(qlcType: string): FixtureDefinition['type'] {
  const lower = qlcType.toLowerCase();
  if (lower.includes('moving head')) return 'moving-head';
  if (lower.includes('color changer') || lower.includes('led bar') || lower.includes('strip')) return 'strip';
  if (lower.includes('scanner')) return 'moving-head';
  if (lower.includes('dimmer')) return 'dimmer';
  if (lower.includes('strobe') || lower.includes('blinder')) return 'strobe';
  if (lower.includes('laser')) return 'laser';
  if (lower.includes('effect') || lower.includes('flower')) return 'effect';
  if (lower.includes('hazer') || lower.includes('smoke') || lower.includes('fog')) return 'other';
  return 'par';
}

// ── Parsed intermediate types ──

interface QlcChannel {
  name: string;
  group: string;
  byte: number; // 0 = coarse (MSB), 1 = fine (LSB)
  defaultValue: number;
  capabilities: ChannelCapability[];
}

// ── Main parser ──

export function parseQlcPlusXml(xmlString: string): FixtureDefinition | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'application/xml');

    const root = doc.documentElement;
    if (!root || !root.tagName.includes('FixtureDefinition')) return null;

    const text = (tag: string) => {
      const el = root.querySelector(tag);
      return el?.textContent?.trim() || '';
    };

    const manufacturer = text('Manufacturer') || 'Unknown';
    const model = text('Model') || 'Unknown';
    const fixtureType = text('Type') || 'Other';

    // Parse all channels (top-level, shared across modes)
    const channelMap = new Map<string, QlcChannel>();
    const channelNodes = root.querySelectorAll(':scope > Channel');

    channelNodes.forEach((chNode) => {
      const name = chNode.getAttribute('Name') || 'Unknown';
      const groupNode = chNode.querySelector('Group');
      const group = groupNode?.textContent?.trim() || 'Intensity';
      const byte = parseInt(groupNode?.getAttribute('Byte') || '0') || 0;
      const defaultValue = parseInt(chNode.getAttribute('Default') || '0') || 0;

      const caps: ChannelCapability[] = [];
      chNode.querySelectorAll('Capability').forEach((capNode, idx) => {
        const min = parseInt(capNode.getAttribute('Min') || '0');
        const max = parseInt(capNode.getAttribute('Max') || '255');
        const label = capNode.textContent?.trim() || `Range ${idx + 1}`;
        const color = capNode.getAttribute('Color') || undefined;
        const color2 = capNode.getAttribute('Color2') || undefined;

        const capType = group === 'Gobo' ? 'gobo'
          : (group === 'Colour' || group === 'Color') ? 'color'
          : 'custom';

        caps.push({
          id: `qlc-cap-${name}-${idx}`,
          dmxMin: min,
          dmxMax: max,
          label,
          color: color || color2 || undefined,
          type: capType as ChannelCapability['type'],
        });
      });

      channelMap.set(name, { name, group, byte, defaultValue, capabilities: caps });
    });

    // Parse modes
    const modeNodes = root.querySelectorAll(':scope > Mode');
    const modes: FixtureMode[] = [];

    modeNodes.forEach((modeNode, modeIdx) => {
      const modeName = modeNode.getAttribute('Name') || `Mode ${modeIdx + 1}`;
      const modeChannelNodes = modeNode.querySelectorAll(':scope > Channel');
      const channels: FixtureChannel[] = [];

      modeChannelNodes.forEach((mchNode) => {
        const chNumber = parseInt(mchNode.getAttribute('Number') || '0');
        const chName = mchNode.textContent?.trim() || '';
        const qlcCh = channelMap.get(chName);

        if (!qlcCh) {
          // Channel referenced but not defined — add as custom
          channels.push({
            id: `qlc-ch-${modeIdx}-${chNumber}`,
            number: chNumber + 1,
            name: chName,
            function: 'custom',
            defaultValue: 0,
            min: 0,
            max: 255,
          });
          return;
        }

        const fn = mapGroup(qlcCh.group, qlcCh.byte, qlcCh.name);
        const defaultVal = qlcCh.defaultValue ||
          (fn === 'pan' || fn === 'tilt' || fn === 'focus' ? 128 : 0);

        channels.push({
          id: `qlc-ch-${modeIdx}-${chNumber}`,
          number: chNumber + 1,
          name: qlcCh.name,
          function: fn,
          defaultValue: defaultVal,
          min: 0,
          max: 255,
          capabilities: qlcCh.capabilities.length > 1 ? qlcCh.capabilities : undefined,
        });
      });

      if (channels.length > 0) {
        modes.push({
          id: `qlc-mode-${modeIdx}`,
          name: `${modeName} (${channels.length}ch)`,
          channelCount: channels.length,
          channels,
        });
      }
    });

    if (modes.length === 0) return null;

    // Determine color system
    const allFns = modes[0].channels.map((c) => c.function);
    const hasRgb = allFns.includes('red') && allFns.includes('green') && allFns.includes('blue');
    const hasWhite = allFns.includes('white');
    const colorSystem: ColorSystem = hasRgb ? (hasWhite ? 'rgbw' : 'rgb') : 'color-wheel';

    return {
      id: `qlc-${manufacturer}-${model}-${Date.now()}`.replace(/\s+/g, '-').toLowerCase(),
      manufacturer,
      model,
      type: mapFixtureType(fixtureType),
      category: 'dmx',
      colorSystem,
      modes,
      createdAt: Date.now(),
    };
  } catch (err) {
    console.error('[QLC+] Parse error:', err);
    return null;
  }
}

/**
 * Parse a .qxf file (XML text file)
 */
export async function parseQxfFile(file: File): Promise<FixtureDefinition | null> {
  const text = await file.text();
  return parseQlcPlusXml(text);
}

/**
 * Batch-parse multiple .qxf files
 */
export async function parseQxfFiles(files: File[]): Promise<FixtureDefinition[]> {
  const results: FixtureDefinition[] = [];
  for (const file of files) {
    const def = await parseQxfFile(file);
    if (def) results.push(def);
  }
  return results;
}
