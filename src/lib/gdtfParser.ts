/**
 * GDTF (General Device Type Format) Parser
 * Parses .gdtf files (ZIP archives containing fixture definitions)
 * and converts them to STOKIO FixtureDefinition format.
 *
 * GDTF spec: https://gdtf-share.com/
 * A .gdtf file is a ZIP containing description.xml + optional 3D models/images
 */

import type { FixtureDefinition, FixtureMode, FixtureChannel, ChannelFunction, ChannelCapability } from '@/store/fixtureStore';

// Map GDTF attribute names to our channel functions
const GDTF_ATTR_MAP: Record<string, ChannelFunction> = {
  'Dimmer': 'dimmer',
  'Pan': 'pan',
  'PanFine': 'pan-fine',
  'Tilt': 'tilt',
  'TiltFine': 'tilt-fine',
  'ColorAdd_R': 'red',
  'ColorAdd_G': 'green',
  'ColorAdd_B': 'blue',
  'ColorAdd_W': 'white',
  'ColorAdd_A': 'amber',
  'ColorAdd_UV': 'uv',
  'Color1': 'color-wheel',
  'Color2': 'color-wheel',
  'Gobo1': 'gobo',
  'Gobo2': 'gobo',
  'Gobo1Pos': 'gobo-rotation',
  'Gobo2Pos': 'gobo-rotation',
  'Shutter1': 'shutter',
  'Shutter1Strobe': 'strobe',
  'Focus1': 'focus',
  'Zoom': 'zoom',
  'Iris': 'iris',
  'Frost1': 'frost',
  'Prism1': 'prism',
  'Speed': 'speed',
  'CTO': 'cto',
  'CTB': 'ctb',
};

function mapGdtfAttribute(attr: string): ChannelFunction {
  // Direct match
  if (GDTF_ATTR_MAP[attr]) return GDTF_ATTR_MAP[attr];
  // Partial match
  const lower = attr.toLowerCase();
  if (lower.includes('dimmer') || lower.includes('intensity')) return 'dimmer';
  if (lower.includes('pan')) return lower.includes('fine') ? 'pan-fine' : 'pan';
  if (lower.includes('tilt')) return lower.includes('fine') ? 'tilt-fine' : 'tilt';
  if (lower.includes('red') || lower === 'coloradd_r') return 'red';
  if (lower.includes('green') || lower === 'coloradd_g') return 'green';
  if (lower.includes('blue') || lower === 'coloradd_b') return 'blue';
  if (lower.includes('white') || lower === 'coloradd_w') return 'white';
  if (lower.includes('gobo') && lower.includes('rot')) return 'gobo-rotation';
  if (lower.includes('gobo')) return 'gobo';
  if (lower.includes('color') || lower.includes('colour')) return 'color-wheel';
  if (lower.includes('strobe') || lower.includes('shutter')) return 'strobe';
  if (lower.includes('zoom')) return 'zoom';
  if (lower.includes('focus')) return 'focus';
  if (lower.includes('prism')) return 'prism';
  if (lower.includes('iris')) return 'iris';
  if (lower.includes('frost')) return 'frost';
  if (lower.includes('speed')) return 'speed';
  if (lower.includes('macro')) return 'macro';
  return 'custom';
}

function mapFixtureType(gdtfType: string): FixtureDefinition['type'] {
  const lower = gdtfType.toLowerCase();
  if (lower.includes('moving') || lower.includes('yoke')) return 'moving-head';
  if (lower.includes('par') || lower.includes('led par')) return 'par';
  if (lower.includes('strip') || lower.includes('bar') || lower.includes('batten')) return 'strip';
  if (lower.includes('wash')) return 'wash';
  if (lower.includes('spot') || lower.includes('profile')) return 'spot';
  if (lower.includes('beam')) return 'beam';
  if (lower.includes('strobe') || lower.includes('blinder')) return 'strobe';
  if (lower.includes('laser')) return 'laser';
  if (lower.includes('dimmer')) return 'dimmer';
  return 'other';
}

/**
 * Parse a GDTF description.xml string into a FixtureDefinition
 */
export function parseGdtfXml(xmlString: string): FixtureDefinition | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'application/xml');

    const ftNode = doc.querySelector('FixtureType');
    if (!ftNode) return null;

    const manufacturer = ftNode.getAttribute('Manufacturer') || 'Unknown';
    const model = ftNode.getAttribute('Name') || ftNode.getAttribute('LongName') || 'Unknown';
    const fixtureTypeHint = ftNode.getAttribute('FixtureTypeID') || model;

    // Parse DMX modes
    const dmxModes = doc.querySelectorAll('DMXMode');
    const modes: FixtureMode[] = [];

    dmxModes.forEach((modeNode, modeIdx) => {
      const modeName = modeNode.getAttribute('Name') || `Mode ${modeIdx + 1}`;
      const channelNodes = modeNode.querySelectorAll('DMXChannel');
      const channels: FixtureChannel[] = [];

      channelNodes.forEach((chNode, chIdx) => {
        const geometry = chNode.getAttribute('Geometry') || '';
        const logicalChannels = chNode.querySelectorAll('LogicalChannel');

        logicalChannels.forEach((lcNode) => {
          const attr = lcNode.getAttribute('Attribute') || geometry || 'Custom';
          const fn = mapGdtfAttribute(attr);

          // Parse channel functions for capabilities
          const cfNodes = lcNode.querySelectorAll('ChannelFunction');
          const capabilities: ChannelCapability[] = [];

          cfNodes.forEach((cfNode, cfIdx) => {
            const cfName = cfNode.getAttribute('Name') || `Step ${cfIdx + 1}`;
            const dmxFrom = cfNode.getAttribute('DMXFrom') || '0/1';
            const physFrom = cfNode.getAttribute('PhysicalFrom');
            const physTo = cfNode.getAttribute('PhysicalTo');

            // Parse DMX value (format can be "128/1" meaning value 128 in 8-bit)
            const dmxVal = parseInt(dmxFrom.split('/')[0]) || 0;

            capabilities.push({
              id: `cap-${modeIdx}-${chIdx}-${cfIdx}`,
              dmxMin: dmxVal,
              dmxMax: 255, // will be corrected by next capability
              label: cfName,
              type: fn === 'gobo' ? 'gobo' : fn === 'color-wheel' ? 'color' : 'custom',
            });
          });

          // Fix dmxMax based on next capability's dmxMin
          for (let i = 0; i < capabilities.length - 1; i++) {
            capabilities[i].dmxMax = capabilities[i + 1].dmxMin - 1;
          }

          channels.push({
            id: `ch-${modeIdx}-${chIdx}`,
            number: chIdx + 1,
            name: attr,
            function: fn,
            defaultValue: fn === 'pan' || fn === 'tilt' || fn === 'focus' ? 128 : 0,
            min: 0,
            max: 255,
            capabilities: capabilities.length > 0 ? capabilities : undefined,
          });
        });
      });

      if (channels.length > 0) {
        modes.push({
          id: `gdtf-mode-${modeIdx}`,
          name: modeName,
          channelCount: channels.length,
          channels,
        });
      }
    });

    if (modes.length === 0) return null;

    // Determine color system from channels
    const allFunctions = modes[0].channels.map(c => c.function);
    const hasRgb = allFunctions.includes('red') && allFunctions.includes('green') && allFunctions.includes('blue');
    const hasWhite = allFunctions.includes('white');
    const colorSystem = hasRgb ? (hasWhite ? 'rgbw' : 'rgb') : 'color-wheel';

    return {
      id: `gdtf-${manufacturer}-${model}-${Date.now()}`.replace(/\s+/g, '-').toLowerCase(),
      manufacturer,
      model,
      type: mapFixtureType(fixtureTypeHint),
      category: 'dmx',
      colorSystem,
      modes,
      createdAt: Date.now(),
    };
  } catch (err) {
    console.error('[GDTF] Parse error:', err);
    return null;
  }
}

/**
 * Parse a .gdtf file (ZIP) and extract the fixture definition.
 * Uses the browser's built-in ZIP handling via JSZip or manual extraction.
 * For now, accepts the raw XML content directly if already extracted.
 */
export async function parseGdtfFile(file: File): Promise<FixtureDefinition | null> {
  // If it's an XML file directly
  if (file.name.endsWith('.xml')) {
    const text = await file.text();
    return parseGdtfXml(text);
  }

  // For .gdtf (ZIP) files, try to find description.xml
  // We use a simple ZIP parser approach for the browser
  try {
    const arrayBuffer = await file.arrayBuffer();
    const xmlContent = await extractDescriptionXmlFromZip(arrayBuffer);
    if (xmlContent) {
      return parseGdtfXml(xmlContent);
    }
  } catch (err) {
    console.error('[GDTF] Failed to parse ZIP:', err);
  }

  return null;
}

/**
 * Simple ZIP extraction to find description.xml
 * ZIP format: each file has a local file header starting with PK\x03\x04
 */
async function extractDescriptionXmlFromZip(buffer: ArrayBuffer): Promise<string | null> {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  
  let offset = 0;
  while (offset < bytes.length - 4) {
    // Look for local file header signature: PK\x03\x04
    if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4B &&
        bytes[offset + 2] === 0x03 && bytes[offset + 3] === 0x04) {
      
      const view = new DataView(buffer, offset);
      const compressionMethod = view.getUint16(8, true);
      const compressedSize = view.getUint32(18, true);
      const uncompressedSize = view.getUint32(22, true);
      const fileNameLength = view.getUint16(26, true);
      const extraFieldLength = view.getUint16(28, true);
      
      const fileNameBytes = bytes.slice(offset + 30, offset + 30 + fileNameLength);
      const fileName = decoder.decode(fileNameBytes);
      
      const dataStart = offset + 30 + fileNameLength + extraFieldLength;
      
      if (fileName.toLowerCase() === 'description.xml' && compressionMethod === 0) {
        // Stored (no compression)
        const fileData = bytes.slice(dataStart, dataStart + uncompressedSize);
        return decoder.decode(fileData);
      }
      
      if (fileName.toLowerCase() === 'description.xml' && compressionMethod === 8) {
        // Deflate — use DecompressionStream if available
        const compressedData = bytes.slice(dataStart, dataStart + compressedSize);
        try {
          const ds = new DecompressionStream('raw');
          const writer = ds.writable.getWriter();
          writer.write(compressedData);
          writer.close();
          const reader = ds.readable.getReader();
          const chunks: Uint8Array[] = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
          const result = new Uint8Array(totalLength);
          let pos = 0;
          for (const chunk of chunks) {
            result.set(chunk, pos);
            pos += chunk.length;
          }
          return decoder.decode(result);
        } catch {
          console.warn('[GDTF] DecompressionStream not available, cannot decompress');
          return null;
        }
      }
      
      offset = dataStart + compressedSize;
    } else {
      offset++;
    }
  }
  
  return null;
}
