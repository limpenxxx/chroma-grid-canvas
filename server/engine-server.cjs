#!/usr/bin/env node
/**
 * Chroma Grid Canvas — Lighting Engine Server
 * 
 * Persistent Node.js process that holds all lighting state and outputs to hardware.
 * The browser is just a remote control — all hardware output continues even when
 * no browser is connected.
 *
 * Run:  node server/engine-server.cjs
 * Port: 9100 (override with PORT env var)
 *
 * Protocols supported:
 *   - WLED JSON API (HTTP)
 *   - Philips Hue (HTTP REST)
 *   - MagicHome (via magic-home-rest proxy)
 *   - ArtNet DMX (UDP port 6454)
 *   - sACN / E1.31 (UDP port 5568)
 */

const { WebSocketServer } = require('ws');
const dgram = require('dgram');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ── MIDI (optional: install with `npm install midi` on the server) ──
let midiLib = null;
let midiInputs = []; // Array of { port, input, name }
try {
  midiLib = require('midi');
  console.log('[MIDI] node-midi loaded ✓');
} catch {
  console.log('[MIDI] node-midi not installed — Engine USB-MIDI disabled. Install with: npm install midi');
}

const PORT = parseInt(process.env.PORT || '9100', 10);
const STATE_FILE = path.join(__dirname, '.engine-state.json');
const OUTPUT_INTERVAL = 40;  // 25fps hardware output
const HUE_INTERVAL = 100;   // Hue rate limit: ~10/sec per light
const SAVE_INTERVAL = 5000;  // persist state every 5s
const MIDI_POLL_INTERVAL = 5000; // re-scan MIDI devices every 5s

// ── MIDI engine state ──
let midiDeviceList = []; // [{ port, name, open }]
let audioDevices = [];

// ══════════════════════════════════════════════════════════════
// State
// ══════════════════════════════════════════════════════════════

const state = {
  dmx: {},
  wled: {},
  hue: {},
  magic: {},
  ddp: {},    // DDP pixel data: { ip: { pixels: [r,g,b,...] } }
  wledRealtime: {}, // DNRGB realtime: { ip: { pixels: [r,g,b,...], timeout?: number } }
  app: {},
  fixtures: {},
  media: {},
  stage: {},
  wledDevices: {},
  masterDimmer: 100,
  blackout: false,
  pioneerDecks: {},

  // I/O config: which NIC to bind ArtNet/sACN, USB ports, etc.
  ioConfig: {
    outputs: [],        // Array of { id, universe, protocol, bindInterface, targetIp, usbPort, ... }
    artnetBindAddress: '0.0.0.0',  // default: all interfaces
    sacnBindAddress: '0.0.0.0',
    usbPorts: [],       // Array of { universe, port, type }
  },
};

// Last-sent cache to avoid redundant network calls
const lastSent = {
  wled: {},   // keyed by ip → JSON string of last sent payload
  hue: {},    // keyed by bridgeId:lightId → JSON string
  magic: {},  // keyed by deviceId → JSON string
  dmx: {},    // keyed by universe → last buffer hash
};

let dirty = false; // true when state changed since last save

// ══════════════════════════════════════════════════════════════
// Engine MIDI — USB MIDI input via node-midi
// ══════════════════════════════════════════════════════════════

function midiScanDevices() {
  if (!midiLib) return;
  try {
    const probe = new midiLib.Input();
    const count = probe.getPortCount();
    const newList = [];
    for (let i = 0; i < count; i++) {
      newList.push({ port: i, name: probe.getPortName(i) });
    }
    probe.closePort();

    // Compare with current list
    const currentNames = new Set(midiDeviceList.map(d => d.name));
    const newNames = new Set(newList.map(d => d.name));

    // Close removed devices
    for (const existing of midiInputs) {
      if (!newNames.has(existing.name)) {
        console.log(`[MIDI] Device removed: ${existing.name}`);
        try { existing.input.closePort(); } catch {}
      }
    }
    midiInputs = midiInputs.filter(d => newNames.has(d.name));

    // Open new devices
    for (const dev of newList) {
      if (!currentNames.has(dev.name)) {
        console.log(`[MIDI] New device: ${dev.name} (port ${dev.port})`);
        openMidiPort(dev.port, dev.name);
      }
    }

    midiDeviceList = newList.map(d => ({
      port: d.port,
      name: d.name,
      open: midiInputs.some(m => m.name === d.name),
    }));
  } catch (err) {
    console.error('[MIDI] Scan error:', err.message);
  }
}

function openMidiPort(portIndex, name) {
  if (!midiLib) return;
  try {
    const input = new midiLib.Input();
    input.on('message', (deltaTime, message) => {
      if (!message || message.length < 3) return;
      const status = message[0];
      const channel = status & 0x0F;
      const msgType = status & 0xF0;
      const note = message[1];
      const velocity = message[2];

      let type = null;
      if (msgType === 0x90 && velocity > 0) type = 'noteon';
      else if (msgType === 0x80 || (msgType === 0x90 && velocity === 0)) type = 'noteoff';
      else if (msgType === 0xB0) type = 'cc';
      if (!type) return;

      const event = { type, channel, note, velocity, timestamp: Date.now(), source: 'engine', deviceName: name };
      // Broadcast to all connected browsers
      broadcastToAll({ type: 'engine-midi', event });
    });
    input.openPort(portIndex);
    midiInputs.push({ port: portIndex, input, name });
    console.log(`[MIDI] ✓ Opened port ${portIndex}: ${name}`);
  } catch (err) {
    console.error(`[MIDI] Failed to open port ${portIndex} (${name}):`, err.message);
  }
}

// Start MIDI scanning
if (midiLib) {
  midiScanDevices();
  setInterval(midiScanDevices, MIDI_POLL_INTERVAL);
}

// ══════════════════════════════════════════════════════════════
// Engine Audio — optional host sound cards via arecord/pw-record list
// ══════════════════════════════════════════════════════════════

function scanAudioDevices() {
  try {
    const { execSync } = require('child_process');
    const out = execSync('arecord -l 2>/dev/null || true', { encoding: 'utf8' });
    const lines = out.split('\n').filter(line => line.includes('card '));
    audioDevices = lines.map((line, idx) => {
      const m = line.match(/card\s+(\d+):\s*([^,]+),\s*device\s+(\d+):\s*([^\[]+)/i);
      if (m) {
        return {
          id: `hw:${m[1]},${m[3]}`,
          name: `${m[2].trim()} / ${m[4].trim()}`,
          label: line.trim(),
        };
      }
      return { id: `audio-${idx}`, name: line.trim(), label: line.trim() };
    });
  } catch {
    audioDevices = [];
  }
}

scanAudioDevices();

// ══════════════════════════════════════════════════════════════
// State persistence
// ══════════════════════════════════════════════════════════════

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      // Restore non-volatile state
      if (data.hue) state.hue = data.hue;
      if (data.magic) state.magic = data.magic;
      if (data.masterDimmer !== undefined) state.masterDimmer = data.masterDimmer;
      if (data.blackout !== undefined) state.blackout = data.blackout;
      if (data.app) state.app = data.app;
      if (data.fixtures) state.fixtures = data.fixtures;
      if (data.stage) state.stage = data.stage;
      if (data.wledDevices) state.wledDevices = data.wledDevices;
      // Restore DMX universes
      if (data.dmx) {
        for (const [uni, arr] of Object.entries(data.dmx)) {
          state.dmx[uni] = new Uint8Array(arr);
        }
      }
      // Restore WLED
      if (data.wled) state.wled = data.wled;
      console.log('[ENGINE] Restored state from disk');
    }
  } catch (e) {
    console.error('[ENGINE] Failed to load state:', e.message);
  }
}

function saveState() {
  if (!dirty) return;
  dirty = false;
  try {
    const serializable = {
      dmx: {},
      wled: state.wled,
      hue: state.hue,
      magic: state.magic,
      masterDimmer: state.masterDimmer,
      blackout: state.blackout,
      app: state.app,
      fixtures: state.fixtures,
      stage: state.stage,
      wledDevices: state.wledDevices,
    };
    // Convert Uint8Arrays to regular arrays for JSON
    for (const [uni, buf] of Object.entries(state.dmx)) {
      serializable.dmx[uni] = Array.from(buf);
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(serializable), 'utf8');
  } catch (e) {
    console.error('[ENGINE] Failed to save state:', e.message);
  }
}

// ══════════════════════════════════════════════════════════════
// HTTP helper (works in older Node.js without global fetch)
// ══════════════════════════════════════════════════════════════

function httpRequest(url, method = 'GET', body = null, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const dns = require('dns');
    const lib = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (url.startsWith('https') ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      timeout,
      headers: {},
      // Use OS resolver (supports mDNS .local via avahi/nss-mdns)
      lookup: dns.lookup,
    };
    if (body) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', (err) => {
      console.error(`[HTTP] ${method} ${url} → error: ${err.message}`);
      reject(err);
    });
    req.on('timeout', () => {
      console.error(`[HTTP] ${method} ${url} → timeout after ${timeout}ms`);
      req.destroy();
      reject(new Error(`timeout: ${url}`));
    });
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

// Simple RGB to CIE xy conversion for Hue Entertainment HTTP fallback
function rgbToXySimple(r, g, b) {
  let R = r / 255, G = g / 255, B = b / 255;
  R = R > 0.04045 ? Math.pow((R + 0.055) / 1.055, 2.4) : R / 12.92;
  G = G > 0.04045 ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92;
  B = B > 0.04045 ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92;
  const X = R * 0.664511 + G * 0.154324 + B * 0.162028;
  const Y = R * 0.283881 + G * 0.668433 + B * 0.047685;
  const Z = R * 0.000088 + G * 0.072310 + B * 0.986039;
  const sum = X + Y + Z;
  return sum === 0 ? [0.3127, 0.3290] : [X / sum, Y / sum];
}

// ══════════════════════════════════════════════════════════════
// Hardware Output: WLED
// ══════════════════════════════════════════════════════════════

async function outputWled() {
  for (const [ip, payload] of Object.entries(state.wled)) {
    const key = JSON.stringify(payload);
    if (lastSent.wled[ip] === key) continue;
    lastSent.wled[ip] = key;
    try {
      await httpRequest(`http://${ip}/json/state`, 'POST', payload, 2000);
    } catch { /* device offline */ }
  }
}

// ══════════════════════════════════════════════════════════════
// Hardware Output: Philips Hue
// ══════════════════════════════════════════════════════════════

async function outputHue() {
  for (const [bridgeId, bridge] of Object.entries(state.hue)) {
    if (!bridge.ip || !bridge.apiKey || !bridge.lights) continue;
    for (const [lightId, lightState] of Object.entries(bridge.lights)) {
      const cacheKey = `${bridgeId}:${lightId}`;
      const key = JSON.stringify(lightState);
      if (lastSent.hue[cacheKey] === key) continue;
      lastSent.hue[cacheKey] = key;
      try {
        await httpRequest(
          `http://${bridge.ip}/api/${bridge.apiKey}/lights/${lightId}/state`,
          'PUT', lightState, 2000
        );
      } catch { /* bridge offline */ }
    }
  }
}

// ══════════════════════════════════════════════════════════════
// Hardware Output: MagicHome (via proxy)
// ══════════════════════════════════════════════════════════════

async function outputMagic() {
  for (const [deviceId, dev] of Object.entries(state.magic)) {
    if (!dev.proxyUrl) continue;
    const key = JSON.stringify({ r: dev.r, g: dev.g, b: dev.b, on: dev.on });
    if (lastSent.magic[deviceId] === key) continue;
    lastSent.magic[deviceId] = key;
    try {
      if (dev.on === false) {
        await httpRequest(`${dev.proxyUrl}/api/device/${deviceId}/off`, 'POST', undefined, 2000);
      } else {
        await httpRequest(`${dev.proxyUrl}/api/device/${deviceId}/color`, 'POST',
          { r: dev.r || 0, g: dev.g || 0, b: dev.b || 0 }, 2000
        );
      }
    } catch { /* proxy offline */ }
  }
}

// ══════════════════════════════════════════════════════════════
// Hardware Output: ArtNet DMX (UDP)
// ══════════════════════════════════════════════════════════════

let artnetSocket = dgram.createSocket('udp4');
artnetSocket.on('error', () => {}); // ignore errors

let artnetSequence = 0;

function buildArtNetPacket(universe, dmxData) {
  // Art-Net DMX packet (opcode 0x5000)
  const len = Math.min(dmxData.length, 512);
  const packet = Buffer.alloc(18 + len);

  // Header: "Art-Net\0"
  packet.write('Art-Net\0', 0);
  // Opcode: 0x5000 (little-endian)
  packet.writeUInt16LE(0x5000, 8);
  // Protocol version: 14 (big-endian)
  packet.writeUInt16BE(14, 10);
  // Sequence
  artnetSequence = (artnetSequence + 1) & 0xff;
  packet.writeUInt8(artnetSequence, 12);
  // Physical port
  packet.writeUInt8(0, 13);
  // Universe (little-endian)
  packet.writeUInt16LE(universe - 1, 14); // Art-Net universes are 0-based
  // Length (big-endian)
  packet.writeUInt16BE(len, 16);
  // DMX data
  Buffer.from(dmxData.slice(0, len)).copy(packet, 18);

  return packet;
}

function outputArtNet() {
  for (const [uniStr, dmxBuf] of Object.entries(state.dmx)) {
    const uni = parseInt(uniStr, 10);
    if (isNaN(uni) || !(dmxBuf instanceof Uint8Array)) continue;

    // Apply master dimmer & blackout
    let outputBuf = dmxBuf;
    if (state.blackout) {
      outputBuf = new Uint8Array(512); // all zeros
    } else if (state.masterDimmer < 100) {
      outputBuf = new Uint8Array(512);
      const scale = state.masterDimmer / 100;
      for (let i = 0; i < 512; i++) {
        outputBuf[i] = Math.round(dmxBuf[i] * scale);
      }
    }

    const hash = Buffer.from(outputBuf).toString('base64');
    if (lastSent.dmx[uniStr] === hash) continue;
    lastSent.dmx[uniStr] = hash;

    const packet = buildArtNetPacket(uni, outputBuf);
    // Determine target: check io config for this universe
    const ioOut = (state.ioConfig.outputs || []).find(o => o.protocol === 'artnet' && o.universe === uni && o.enabled !== false);
    const targetIp = (ioOut && ioOut.targetIp && ioOut.targetIp !== 'broadcast') ? ioOut.targetIp : '255.255.255.255';
    artnetSocket.send(packet, 0, packet.length, 6454, targetIp, () => {});
  }
}

// ══════════════════════════════════════════════════════════════
// Hardware Output: sACN / E1.31 (UDP)
// ══════════════════════════════════════════════════════════════

const sacnSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
sacnSocket.on('error', () => {});

let sacnSequence = 0;
const SACN_CID = Buffer.from([
  0x53, 0x54, 0x4f, 0x4b, 0x49, 0x4f, 0x2d, 0x46,
  0x58, 0x2d, 0x45, 0x4e, 0x47, 0x49, 0x4e, 0x45
]); // "STOKIO-FX-ENGINE"

function buildSacnPacket(universe, dmxData, priority = 100) {
  const slotCount = Math.min(dmxData.length, 512);
  const packet = Buffer.alloc(126 + slotCount);
  let offset = 0;

  // Root Layer
  packet.writeUInt16BE(0x0010, offset); offset += 2;
  packet.writeUInt16BE(0x0000, offset); offset += 2;
  const acnId = Buffer.from([0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00]);
  acnId.copy(packet, offset); offset += 12;
  const rootLen = 110 + slotCount;
  packet.writeUInt16BE(0x7000 | (rootLen & 0x0fff), offset); offset += 2;
  packet.writeUInt32BE(0x00000004, offset); offset += 4;
  SACN_CID.copy(packet, offset); offset += 16;

  // Framing Layer
  const framingLen = 88 + slotCount;
  packet.writeUInt16BE(0x7000 | (framingLen & 0x0fff), offset); offset += 2;
  packet.writeUInt32BE(0x00000002, offset); offset += 4;
  const sourceName = Buffer.alloc(64);
  sourceName.write('Chroma Grid Canvas Engine');
  sourceName.copy(packet, offset); offset += 64;
  packet.writeUInt8(priority, offset); offset += 1;
  packet.writeUInt16BE(0, offset); offset += 2;
  sacnSequence = (sacnSequence + 1) & 0xff;
  packet.writeUInt8(sacnSequence, offset); offset += 1;
  packet.writeUInt8(0, offset); offset += 1;
  packet.writeUInt16BE(universe, offset); offset += 2;

  // DMP Layer
  const dmpLen = 11 + slotCount;
  packet.writeUInt16BE(0x7000 | (dmpLen & 0x0fff), offset); offset += 2;
  packet.writeUInt8(0x02, offset); offset += 1;
  packet.writeUInt8(0xa1, offset); offset += 1;
  packet.writeUInt16BE(0, offset); offset += 2;
  packet.writeUInt16BE(1, offset); offset += 2;
  packet.writeUInt16BE(1 + slotCount, offset); offset += 2;
  packet.writeUInt8(0, offset); offset += 1;
  Buffer.from(dmxData.slice(0, slotCount)).copy(packet, offset);

  return packet;
}

function outputSacn() {
  for (const [uniStr, dmxBuf] of Object.entries(state.dmx)) {
    const uni = parseInt(uniStr, 10);
    if (isNaN(uni) || !(dmxBuf instanceof Uint8Array)) continue;

    let outputBuf = dmxBuf;
    if (state.blackout) {
      outputBuf = new Uint8Array(512);
    } else if (state.masterDimmer < 100) {
      outputBuf = new Uint8Array(512);
      const scale = state.masterDimmer / 100;
      for (let i = 0; i < 512; i++) outputBuf[i] = Math.round(dmxBuf[i] * scale);
    }

    const packet = buildSacnPacket(uni, outputBuf);
    const hi = (uni >> 8) & 0xff;
    const lo = uni & 0xff;
    const multicastAddr = `239.255.${hi}.${lo}`;
    sacnSocket.send(packet, 0, packet.length, 5568, multicastAddr, () => {});
  }
}

// ══════════════════════════════════════════════════════════════
// Hardware Output: WLED Realtime UDP — DNRGB protocol
// ══════════════════════════════════════════════════════════════
// DNRGB is WLED's native UDP realtime protocol. Key advantage:
// it only *temporarily* takes over LED output. When packets stop
// arriving (configurable timeout in WLED, default 2.5s), the node
// automatically falls back to its own preset/effect. This means
// STOKIO can override without permanently locking out the native
// WLED app — users can still use the WLED app by simply pausing
// STOKIO output.
//
// Packet format (DNRGB):
//   Byte 0: protocol (4 = DNRGB)
//   Byte 1: timeout in seconds (0 = use WLED default)
//   Byte 2-3: start LED index (big-endian)
//   Byte 4+: R,G,B,R,G,B,... (up to ~480 pixels per packet)
//
// The WLED `lor` (live override) setting lets users temporarily
// ignore realtime data from their WLED app without restarting:
//   lor=0 → accept realtime (default)
//   lor=1 → override once (next local change stops realtime)
//   lor=2 → always override (ignore all incoming realtime data)

const dnrgbSocket = dgram.createSocket('udp4');
dnrgbSocket.on('error', () => {});

const WLED_UDP_PORT = 21324;
const DNRGB_PROTOCOL = 4;
const DNRGB_MAX_PIXELS_PER_PACKET = 480;

const dnrgbLastSent = {}; // ip → last hash

function buildDnrgbPacket(pixelData, startIndex = 0, timeout = 0) {
  const dataLen = pixelData.length; // R,G,B bytes
  const packet = Buffer.alloc(4 + dataLen);
  packet.writeUInt8(DNRGB_PROTOCOL, 0);
  packet.writeUInt8(timeout, 1); // 0 = use WLED's own setting
  packet.writeUInt16BE(startIndex, 2); // start LED index
  Buffer.from(pixelData).copy(packet, 4);
  return packet;
}

function sendDnrgbPixels(ip, pixelData, timeout = 0) {
  const key = Buffer.from(pixelData).toString('base64').slice(0, 64);
  if (!dnrgbLastSent[ip]) dnrgbLastSent[ip] = '';
  if (dnrgbLastSent[ip] === key) return; // no change
  dnrgbLastSent[ip] = key;

  const maxBytes = DNRGB_MAX_PIXELS_PER_PACKET * 3;
  for (let byteOff = 0; byteOff < pixelData.length; byteOff += maxBytes) {
    const chunk = pixelData.slice(byteOff, byteOff + maxBytes);
    const startLed = byteOff / 3;
    const packet = buildDnrgbPacket(chunk, startLed, timeout);
    dnrgbSocket.send(packet, 0, packet.length, WLED_UDP_PORT, ip, () => {});
  }
}

/**
 * Output DNRGB realtime data to all configured WLED devices.
 * Uses state.wledRealtime: { ip: { pixels: [r,g,b,...], timeout?: number } }
 */
function outputDnrgb() {
  for (const [ip, data] of Object.entries(state.wledRealtime || {})) {
    if (!data.pixels || data.pixels.length === 0) continue;
    let pixels = data.pixels;
    // Apply master dimmer & blackout
    if (state.blackout) {
      pixels = new Array(pixels.length).fill(0);
    } else if (state.masterDimmer < 100) {
      const scale = state.masterDimmer / 100;
      pixels = pixels.map(v => Math.round(v * scale));
    }
    sendDnrgbPixels(ip, pixels, data.timeout || 0);
  }
}

// ══════════════════════════════════════════════════════════════
// Hardware Output: DDP (Distributed Display Protocol)
// ══════════════════════════════════════════════════════════════
// DDP is a lightweight protocol optimized for LED controllers like WLED.
// No universe limits — direct pixel addressing. Much faster than E1.31 for WLED.
// Like DNRGB, DDP is also temporary — WLED falls back when packets stop.

const ddpSocket = dgram.createSocket('udp4');
ddpSocket.on('error', () => {});

const DDP_PORT = 4048;
let ddpSequence = 0;

// DDP header flags
const DDP_FLAGS_VER1 = 0x40;    // Version 1
const DDP_FLAGS_PUSH = 0x01;    // Push (display) after this packet
const DDP_FLAGS_TIMECODE = 0x10; // Has timecode (not used)
const DDP_TYPE_RGB = 0x01;      // RGB data type (8-bit per channel)

/**
 * Build a DDP packet for RGB pixel data.
 * DDP packet format:
 *   Byte 0: flags (ver | push)
 *   Byte 1: sequence (1-15)
 *   Byte 2: data type (0x01 = RGB 8-bit)
 *   Byte 3: source ID
 *   Byte 4-7: data offset (big-endian)
 *   Byte 8-9: data length (big-endian)
 *   Byte 10+: pixel data (R,G,B,R,G,B,...)
 */
function buildDdpPacket(pixelData, offset = 0, isLast = true) {
  const dataLen = pixelData.length;
  const headerLen = 10;
  const packet = Buffer.alloc(headerLen + dataLen);

  let flags = DDP_FLAGS_VER1;
  if (isLast) flags |= DDP_FLAGS_PUSH;

  packet.writeUInt8(flags, 0);
  ddpSequence = (ddpSequence % 15) + 1; // 1-15, wraps
  packet.writeUInt8(ddpSequence, 1);
  packet.writeUInt8(DDP_TYPE_RGB, 2); // data type
  packet.writeUInt8(0x01, 3);          // source ID

  // Data offset (4 bytes big-endian)
  packet.writeUInt32BE(offset, 4);
  // Data length (2 bytes big-endian)
  packet.writeUInt16BE(dataLen, 8);

  // Copy pixel data
  Buffer.from(pixelData).copy(packet, headerLen);

  return packet;
}

// DDP pixel buffers per target IP
const ddpBuffers = {}; // ip → { pixels: Uint8Array, lastHash: string }

/**
 * Send DDP pixel data to a WLED device.
 * pixelData should be a flat array of [R,G,B,R,G,B,...] values.
 */
function sendDdpPixels(ip, pixelData) {
  const key = Buffer.from(pixelData).toString('base64').slice(0, 64);
  if (!ddpBuffers[ip]) ddpBuffers[ip] = { lastHash: '' };
  if (ddpBuffers[ip].lastHash === key) return; // no change
  ddpBuffers[ip].lastHash = key;

  // DDP max payload is ~1440 bytes (480 pixels * 3 channels)
  const MAX_PIXELS_PER_PACKET = 480;
  const MAX_BYTES_PER_PACKET = MAX_PIXELS_PER_PACKET * 3;

  for (let offset = 0; offset < pixelData.length; offset += MAX_BYTES_PER_PACKET) {
    const chunk = pixelData.slice(offset, offset + MAX_BYTES_PER_PACKET);
    const isLast = (offset + MAX_BYTES_PER_PACKET >= pixelData.length);
    const packet = buildDdpPacket(chunk, offset / 3, isLast); // offset in pixels
    ddpSocket.send(packet, 0, packet.length, DDP_PORT, ip, () => {});
  }
}

/**
 * Output DDP to all configured WLED devices with DDP protocol
 */
function outputDdp() {
  // DDP targets are stored in state.ddp: { ip: { pixels: [r,g,b,...] } }
  for (const [ip, data] of Object.entries(state.ddp || {})) {
    if (data.pixels && data.pixels.length > 0) {
      let pixels = data.pixels;
      // Apply master dimmer
      if (state.blackout) {
        pixels = new Array(pixels.length).fill(0);
      } else if (state.masterDimmer < 100) {
        const scale = state.masterDimmer / 100;
        pixels = pixels.map(v => Math.round(v * scale));
      }
      sendDdpPixels(ip, pixels);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// WebSocket Server
// ══════════════════════════════════════════════════════════════

const wss = new WebSocketServer({ port: PORT });
let clientCount = 0;

function broadcastToAll(msg, exclude = null) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client !== exclude && client.readyState === 1) {
      client.send(data);
    }
  }
}

wss.on('connection', (ws) => {
  clientCount++;
  const id = clientCount;
  console.log(`[ENGINE] Client #${id} connected (total: ${wss.clients.size})`);

  // Send full state to new client
  const syncState = {
    app: state.app,
    fixtures: state.fixtures,
    media: state.media,
    stage: state.stage,
    wled: state.wledDevices,
  };
  ws.send(JSON.stringify({ type: 'sync', state: syncState }));

  // Send engine status with NIC list + detected USB serial ports
  // Include ALL physical NICs, even those without an IP (cable disconnected)
  const os = require('os');
  const ifaces = os.networkInterfaces();
  const nicList = [];
  const seenNics = new Set();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4') {
        nicList.push({ name, address: addr.address, mac: addr.mac || '', internal: addr.internal });
        seenNics.add(name);
      }
    }
  }
  // Also detect NICs without IPv4 (disconnected cables) via /sys/class/net on Linux
  try {
    const fs = require('fs');
    const netDir = '/sys/class/net';
    if (fs.existsSync(netDir)) {
      const allNics = fs.readdirSync(netDir);
      for (const nic of allNics) {
        if (seenNics.has(nic) || nic === 'lo') continue;
        // Read MAC and operstate
        let mac = '';
        let operstate = 'down';
        try { mac = fs.readFileSync(`${netDir}/${nic}/address`, 'utf8').trim(); } catch {}
        try { operstate = fs.readFileSync(`${netDir}/${nic}/operstate`, 'utf8').trim(); } catch {}
        // Skip virtual/docker interfaces
        if (mac === '00:00:00:00:00:00' || nic.startsWith('veth') || nic.startsWith('docker') || nic.startsWith('br-')) continue;
        nicList.push({ name: nic, address: '', mac, internal: false, operstate });
      }
    }
  } catch {}

  // Auto-detect USB serial ports (ttyUSB*, ttyACM*)
  let usbSerialPorts = [];
  try {
    const devFiles = fs.readdirSync('/dev');
    usbSerialPorts = devFiles
      .filter(f => /^tty(USB|ACM)\d+$/.test(f))
      .map(f => {
        const devPath = '/dev/' + f;
        let vendor = '', product = '', serial = '';
        // Try to read sysfs info for better identification
        try {
          const sysBase = '/sys/class/tty/' + f + '/device/..';
          if (fs.existsSync(sysBase + '/idVendor')) vendor = fs.readFileSync(sysBase + '/idVendor', 'utf8').trim();
          if (fs.existsSync(sysBase + '/idProduct')) product = fs.readFileSync(sysBase + '/idProduct', 'utf8').trim();
          if (fs.existsSync(sysBase + '/serial')) serial = fs.readFileSync(sysBase + '/serial', 'utf8').trim();
        } catch {}
        // Known USB-DMX vendors
        let adapterType = 'unknown';
        if (vendor === '0403' && product === '6001') adapterType = 'eurolite-dmx';
        else if (vendor === '0403' && product === '6010') adapterType = 'enttec-pro';
        else if (vendor === '0403' && product === '6014') adapterType = 'eurolite-dmx';
        else if (vendor === '0403') adapterType = 'ftdi-generic';
        else if (vendor === '10cf') adapterType = 'udmx';
        else if (vendor === '16c0') adapterType = 'dmxking';
        else if (vendor === '1a86' && product === '7523') adapterType = 'ch340-dmx';
        else if (vendor === '1a86') adapterType = 'ch340-generic';
        return { path: devPath, name: f, vendor, product, serial, adapterType };
      });
    if (usbSerialPorts.length > 0) {
      console.log(`[ENGINE] Detected USB serial ports:`, usbSerialPorts.map(p => `${p.path} (${p.adapterType})`).join(', '));
    }
  } catch {}

  ws.send(JSON.stringify({
    type: 'engine-status',
    running: true,
    dmxUniverses: Object.keys(state.dmx).map(Number),
    wledTargets: Object.keys(state.wled).length,
    hueBridges: Object.keys(state.hue).length,
    magicDevices: Object.keys(state.magic).length,
    pioneerDecks: state.pioneerDecks,
    networkInterfaces: nicList,
    usbSerialPorts: usbSerialPorts,
  }));

  // Send Pioneer deck state if any
  if (Object.keys(state.pioneerDecks).length > 0) {
    ws.send(JSON.stringify({ type: 'pioneer-decks', decks: state.pioneerDecks }));
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleMessage(ws, msg);
    } catch (e) {
      console.error('[ENGINE] Bad message:', e.message);
    }
  });

  ws.on('close', () => {
    console.log(`[ENGINE] Client #${id} disconnected (total: ${wss.clients.size})`);
    // Engine keeps running — hardware output continues!
  });
});

function handleMessage(ws, msg) {
  switch (msg.type) {
    // ── Existing sync protocol (backward compatible) ──
    case 'update': {
      if (msg.state) {
        // Merge into engine state
        for (const [key, value] of Object.entries(msg.state)) {
          if (key === 'app') {
            state.app = { ...state.app, ...value };
            if (value.masterDimmer !== undefined) state.masterDimmer = value.masterDimmer;
            if (value.blackout !== undefined) state.blackout = value.blackout;
          } else if (key === 'fixtures') {
            state.fixtures = { ...state.fixtures, ...value };
          } else if (key === 'media') {
            state.media = { ...state.media, ...value };
          } else if (key === 'stage') {
            state.stage = { ...state.stage, ...value };
          } else if (key === 'wled') {
            state.wledDevices = { ...state.wledDevices, ...value };
          }
        }
        dirty = true;
        // Broadcast to other browsers
        broadcastToAll({ type: 'sync', state: msg.state }, ws);
      }
      break;
    }

    // ── DMX channel control ──
    case 'dmx': {
      const uni = String(msg.universe || 1);
      if (!state.dmx[uni]) state.dmx[uni] = new Uint8Array(512);
      if (msg.channel !== undefined && msg.value !== undefined) {
        state.dmx[uni][msg.channel - 1] = Math.max(0, Math.min(255, msg.value));
      }
      dirty = true;
      break;
    }

    case 'dmx-batch': {
      const uni = String(msg.universe || 1);
      if (!state.dmx[uni]) state.dmx[uni] = new Uint8Array(512);
      if (msg.channels && typeof msg.channels === 'object') {
        for (const [ch, val] of Object.entries(msg.channels)) {
          const idx = parseInt(ch, 10) - 1;
          if (idx >= 0 && idx < 512) {
            state.dmx[uni][idx] = Math.max(0, Math.min(255, Number(val)));
          }
        }
      }
      dirty = true;
      break;
    }

    // ── WLED output (JSON API — permanent) ──
    case 'wled-output': {
      if (msg.ip && msg.payload) {
        state.wled[msg.ip] = msg.payload;
        dirty = true;
      }
      break;
    }

    case 'wled-remove-device': {
      const { deviceId, ip } = msg;
      if (ip) {
        delete state.wled[ip];
        delete lastSent.wled[ip];
        if (state.wledRealtime) delete state.wledRealtime[ip];
        if (state.ddp) delete state.ddp[ip];
      }
      if (deviceId && state.wledDevices) {
        if (Array.isArray(state.wledDevices.devices)) {
          state.wledDevices.devices = state.wledDevices.devices.filter((d) => d.id !== deviceId);
        }
        if (Array.isArray(state.wledDevices.fixtures)) {
          state.wledDevices.fixtures = state.wledDevices.fixtures.filter((f) => f.deviceId !== deviceId);
        }
      }
      dirty = true;
      break;
    }

    // ── WLED realtime (DNRGB — temporary override) ──
    case 'wled-realtime': {
      // { ip, pixels: [r,g,b,...], timeout?: number }
      if (msg.ip && msg.pixels) {
        if (!state.wledRealtime) state.wledRealtime = {};
        state.wledRealtime[msg.ip] = { pixels: msg.pixels, timeout: msg.timeout || 0 };
        // No dirty flag — realtime data is ephemeral, not persisted
      }
      break;
    }

    // ── Hue control ──
    case 'hue-bridge': {
      // Register/update a Hue bridge
      if (msg.bridgeId && msg.ip && msg.apiKey) {
        if (!state.hue[msg.bridgeId]) {
          state.hue[msg.bridgeId] = { ip: msg.ip, apiKey: msg.apiKey, lights: {} };
        } else {
          state.hue[msg.bridgeId].ip = msg.ip;
          state.hue[msg.bridgeId].apiKey = msg.apiKey;
        }
        dirty = true;
      }
      break;
    }

    case 'hue-remove-bridge': {
      if (msg.bridgeId && state.hue[msg.bridgeId]) {
        delete state.hue[msg.bridgeId];
        for (const key of Object.keys(lastSent.hue)) {
          if (key.startsWith(`${msg.bridgeId}:`)) {
            delete lastSent.hue[key];
          }
        }
        dirty = true;
      }
      break;
    }

    case 'hue-light': {
      // Set light state: { bridgeId, lightId, state: { on, bri, xy, ... } }
      if (msg.bridgeId && msg.lightId && msg.state) {
        if (!state.hue[msg.bridgeId]) break;
        state.hue[msg.bridgeId].lights[msg.lightId] = msg.state;
        dirty = true;
      }
      break;
    }

    // ── MagicHome control ──
    case 'magic-set': {
      // { deviceId, proxyUrl, on, r, g, b }
      if (msg.deviceId) {
        state.magic[msg.deviceId] = {
          proxyUrl: msg.proxyUrl || 'http://localhost:3000',
          address: msg.address || '',
          on: msg.on !== undefined ? msg.on : true,
          r: msg.r || 0,
          g: msg.g || 0,
          b: msg.b || 0,
        };
        dirty = true;
      }
      break;
    }

    // ── DDP pixel output ──
    case 'ddp-output': {
      // { ip, pixels: [r,g,b,r,g,b,...] }
      if (msg.ip && msg.pixels) {
        if (!state.ddp) state.ddp = {};
        state.ddp[msg.ip] = { pixels: msg.pixels };
        dirty = true;
      }
      break;
    }

    // ── Master controls ──
    case 'master-dimmer': {
      if (msg.value !== undefined) {
        state.masterDimmer = Math.max(0, Math.min(100, msg.value));
        dirty = true;
        // Clear ArtNet cache so next output uses new dimmer
        lastSent.dmx = {};
      }
      break;
    }

    case 'blackout': {
      state.blackout = !!msg.value;
      dirty = true;
      lastSent.dmx = {};
      break;
    }

    // ── Service restart (systemd) ──
    case 'restart-service': {
      const { service, reqId, sudoPass } = msg;
      const allowed = ['chroma-engine', 'chroma-frontend', 'avahi-daemon'];
      if (!service || !allowed.includes(service)) {
        ws.send(JSON.stringify({ type: 'restart-service-result', reqId, success: false, error: `Service not allowed: ${service}` }));
        break;
      }
      if (!sudoPass) {
        ws.send(JSON.stringify({ type: 'restart-service-result', reqId, success: false, error: 'Lösenord krävs' }));
        break;
      }
      console.log(`[ENGINE] Restart requested: ${service}`);
      const { exec } = require('child_process');
      // Use sudo -S to read password from stdin — password is never logged or persisted
      const child = exec(`sudo -S systemctl restart ${service}`, { timeout: 15000 }, (err, stdout, stderr) => {
        if (err) {
          console.error(`[ENGINE] Restart ${service} failed:`, err.message);
          ws.send(JSON.stringify({ type: 'restart-service-result', reqId, success: false, error: err.message }));
        } else {
          console.log(`[ENGINE] ✓ Restarted ${service}`);
          ws.send(JSON.stringify({ type: 'restart-service-result', reqId, success: true, service }));
        }
      });
      // Write password to stdin and close it
      child.stdin.write(sudoPass + '\n');
      child.stdin.end();
      break;
    }

    // ── Query engine state ──
    case 'get-state': {
      ws.send(JSON.stringify({
        type: 'engine-state',
        dmxUniverses: Object.keys(state.dmx).map(Number),
        wledTargets: Object.keys(state.wled),
        hueBridges: Object.keys(state.hue),
        magicDevices: Object.keys(state.magic),
        masterDimmer: state.masterDimmer,
        blackout: state.blackout,
        midiDevices: midiDeviceList,
        midiAvailable: !!midiLib,
        audioDevices,
        audioAvailable: audioDevices.length > 0,
      }));
      break;
    }

    case 'audio-list-devices': {
      scanAudioDevices();
      ws.send(JSON.stringify({
        type: 'audio-devices',
        reqId: msg.reqId,
        devices: audioDevices,
        available: audioDevices.length > 0,
      }));
      break;
    }

    case 'audio-poll': {
      const { deviceId, reqId } = msg;
      if (!deviceId) {
        ws.send(JSON.stringify({ type: 'audio-poll-result', reqId, level: 0 }));
        break;
      }
      const { exec } = require('child_process');
      exec(`bash -lc "arecord -D ${deviceId} -f S16_LE -r 44100 -c 1 -d 1 -q -t raw 2>/dev/null | python3 -c \"import sys,struct,math; data=sys.stdin.buffer.read(); vals=struct.iter_unpack('<h', data[:44100*2]); arr=[abs(v[0]) for v in vals]; print(min(255, int((sum(arr)/max(1,len(arr)))/128)))\""`, { timeout: 2500 }, (err, stdout) => {
        const level = err ? 0 : Math.max(0, Math.min(255, parseInt(String(stdout || '0').trim(), 10) || 0));
        ws.send(JSON.stringify({ type: 'audio-poll-result', reqId, level, deviceName: deviceId }));
      });
      break;
    }

    // ── MIDI device query ──
    case 'midi-list-devices': {
      ws.send(JSON.stringify({
        type: 'midi-devices',
        reqId: msg.reqId,
        devices: midiDeviceList,
        available: !!midiLib,
      }));
      break;
    }

    // ── MIDI rescan ──
    case 'midi-rescan': {
      midiScanDevices();
      ws.send(JSON.stringify({
        type: 'midi-devices',
        reqId: msg.reqId,
        devices: midiDeviceList,
        available: !!midiLib,
      }));
      break;
    }

    // ── I/O configuration from browser ──
    case 'io-config': {
      if (msg.outputs) {
        state.ioConfig.outputs = msg.outputs;
        // Extract ArtNet bind address from first artnet output with a specific NIC
        const artnetOut = msg.outputs.find(o => o.protocol === 'artnet' && o.bindInterface && o.bindInterface !== 'all');
        if (artnetOut && state.ioConfig.artnetBindAddress !== artnetOut.bindInterface) {
          state.ioConfig.artnetBindAddress = artnetOut.bindInterface;
          console.log(`[ENGINE] ArtNet bound to NIC: ${artnetOut.bindInterface}`);
          // Rebind ArtNet socket — properly replace the reference
          try { artnetSocket.close(); } catch {}
          artnetSocket = dgram.createSocket('udp4');
          artnetSocket.on('error', () => {});
          artnetSocket.bind({ address: artnetOut.bindInterface, port: 0 }, () => {
            try { artnetSocket.setBroadcast(true); } catch {}
            console.log(`[ENGINE] ✓ ArtNet socket rebound to ${artnetOut.bindInterface}`);
          });
        } else if (!artnetOut && state.ioConfig.artnetBindAddress !== '0.0.0.0') {
          // Reset to all interfaces
          state.ioConfig.artnetBindAddress = '0.0.0.0';
          try { artnetSocket.close(); } catch {}
          artnetSocket = dgram.createSocket('udp4');
          artnetSocket.on('error', () => {});
          artnetSocket.bind(() => {
            try { artnetSocket.setBroadcast(true); } catch {}
            console.log(`[ENGINE] ✓ ArtNet socket reset to 0.0.0.0`);
          });
        }
        const sacnOut = msg.outputs.find(o => o.protocol === 'sacn' && o.bindInterface && o.bindInterface !== 'all');
        if (sacnOut) {
          state.ioConfig.sacnBindAddress = sacnOut.bindInterface;
          console.log(`[ENGINE] sACN bound to NIC: ${sacnOut.bindInterface}`);
        }
        // USB-DMX ports
        state.ioConfig.usbPorts = msg.outputs
          .filter(o => o.protocol === 'usb-dmx' && o.usbPort)
          .map(o => ({ universe: o.universe, port: o.usbPort, type: o.usbType }));
        if (state.ioConfig.usbPorts.length > 0) {
          console.log(`[ENGINE] USB-DMX ports configured:`, state.ioConfig.usbPorts.map(p => `${p.port} (U${p.universe})`).join(', '));
        }
        dirty = true;
      }
      break;
    }

    // ── NIC role assignment ──
    case 'nic-roles': {
      if (msg.roles) {
        state.ioConfig.nicRoles = msg.roles;
        console.log('[ENGINE] NIC roles updated:', JSON.stringify(msg.roles));
        dirty = true;
      }
      break;
    }

    // ── VFX Output Window (Chromium kiosk on local display) ──
    case 'vfx-window-open': {
      const preset = msg.preset || 'plasma-wave';
      const displayIndex = msg.display || 1;
      const appPort = msg.appPort || 5173;
      const enginePort = PORT;

      // Kill existing VFX window if any
      if (state._vfxProcess) {
        try { process.kill(-state._vfxProcess.pid); } catch {}
        try { state._vfxProcess.kill(); } catch {}
        state._vfxProcess = null;
      }

      const url = `http://localhost:${appPort}/vfx-output?preset=${preset}&engine=localhost&port=${enginePort}`;

      // Use xrandr to find the geometry of the target display
      const { execSync } = require('child_process');
      let windowPos = '0,0';
      let screenSize = '1920,1080';
      try {
        const xrandrOut = execSync('xrandr --query', { env: { ...process.env, DISPLAY: ':0' }, encoding: 'utf8' });
        // Parse connected outputs with geometry: e.g. "HDMI-1 connected 1920x1080+1920+0"
        const outputs = [];
        const lines = xrandrOut.split('\n');
        for (const line of lines) {
          const m = line.match(/^(\S+)\s+connected\s+(?:primary\s+)?(\d+)x(\d+)\+(\d+)\+(\d+)/);
          if (m) {
            outputs.push({ name: m[1], w: parseInt(m[2]), h: parseInt(m[3]), x: parseInt(m[4]), y: parseInt(m[5]) });
          }
        }
        console.log('[VFX] Detected displays:', outputs.map(o => `${o.name} ${o.w}x${o.h}+${o.x}+${o.y}`).join(', '));
        // displayIndex 0 = first, 1 = second, etc.
        if (outputs[displayIndex]) {
          const o = outputs[displayIndex];
          windowPos = `${o.x},${o.y}`;
          screenSize = `${o.w},${o.h}`;
        } else if (outputs.length > 1) {
          // Fallback: pick non-primary (largest x offset)
          const secondary = outputs.reduce((a, b) => a.x > b.x ? a : b);
          windowPos = `${secondary.x},${secondary.y}`;
          screenSize = `${secondary.w},${secondary.h}`;
        }
      } catch (e) {
        console.warn('[VFX] xrandr failed, using default position:', e.message);
      }

      // Try chromium-browser, then google-chrome, then chromium
      const browsers = ['chromium-browser', 'google-chrome', 'chromium'];
      let launched = false;

      for (const browser of browsers) {
        try {
          const proc = spawn(browser, [
            '--kiosk',
            '--start-fullscreen',
            '--noerrdialogs',
            '--disable-infobars',
            '--disable-session-crashed-bubble',
            '--disable-restore-session-state',
            '--no-first-run',
            '--autoplay-policy=no-user-gesture-required',
            `--window-size=${screenSize}`,
            `--window-position=${windowPos}`,
            '--user-data-dir=/tmp/chroma-vfx-browser',
            `--app=${url}`,
          ], {
            env: { ...process.env, DISPLAY: ':0' },
            detached: true,
            stdio: 'ignore',
          });
          proc.unref();
          state._vfxProcess = proc;
          state._vfxDisplay = displayIndex;
          console.log(`[VFX] Opened ${browser} fullscreen on display ${displayIndex} (pos ${windowPos}, size ${screenSize}) → ${url}`);
          launched = true;
          broadcastToAll({ type: 'vfx-window-status', open: true, display: displayIndex });
          break;
        } catch (e) {
          // Try next browser
        }
      }

      if (!launched) {
        console.error('[VFX] Could not launch any browser. Install chromium-browser.');
        ws.send(JSON.stringify({ type: 'vfx-window-status', open: false, error: 'No browser found' }));
      }
      break;
    }

    case 'vfx-window-close': {
      if (state._vfxProcess) {
        try { state._vfxProcess.kill(); } catch {}
        state._vfxProcess = null;
        console.log('[VFX] Closed output window');
      }
      broadcastToAll({ type: 'vfx-window-status', open: false });
      break;
    }

    case 'vfx-set-preset': {
      // Forward preset change to all clients (the VFX output page listens)
      broadcastToAll({ type: 'vfx-preset', preset: msg.preset });
      break;
    }

    // ══════════════════════════════════════════════════════════
    // Hue Bridge: discovery, pairing, refresh (all via engine)
    // ══════════════════════════════════════════════════════════

    case 'hue-discover': {
      // Discover bridges via Philips cloud + mDNS-style scan
      const reqId = msg.reqId;
      (async () => {
        try {
          const data = await httpRequest('https://discovery.meethue.com/', 'GET', null, 5000);
          const bridges = Array.isArray(data) ? data : [];
          ws.send(JSON.stringify({ type: 'hue-discover-result', reqId, bridges }));
        } catch {
          ws.send(JSON.stringify({ type: 'hue-discover-result', reqId, bridges: [] }));
        }
      })();
      break;
    }

    case 'hue-pair': {
      // Pair with bridge (user must press link button first)
      const { ip, reqId } = msg;
      (async () => {
        try {
          const data = await httpRequest(`http://${ip}/api`, 'POST', { devicetype: 'stokio_fx#engine' }, 5000);
          if (Array.isArray(data) && data[0]?.success?.username) {
            ws.send(JSON.stringify({ type: 'hue-pair-result', reqId, success: true, apiKey: data[0].success.username }));
          } else {
            const errorDesc = Array.isArray(data) ? data[0]?.error?.description || 'Unknown error' : 'Unknown error';
            ws.send(JSON.stringify({ type: 'hue-pair-result', reqId, success: false, error: errorDesc }));
          }
        } catch (err) {
          ws.send(JSON.stringify({ type: 'hue-pair-result', reqId, success: false, error: String(err) }));
        }
      })();
      break;
    }

    case 'hue-refresh': {
      // Fetch lights, groups, scenes, config from a paired bridge
      const { bridgeId, ip, apiKey, reqId } = msg;
      if (!ip || !apiKey) break;
      console.log(`[HUE] Refreshing bridge ${bridgeId} at ${ip}...`);
      (async () => {
        try {
          const [lights, groups, scenes, config] = await Promise.all([
            httpRequest(`http://${ip}/api/${apiKey}/lights`, 'GET', null, 5000),
            httpRequest(`http://${ip}/api/${apiKey}/groups`, 'GET', null, 5000),
            httpRequest(`http://${ip}/api/${apiKey}/scenes`, 'GET', null, 5000),
            httpRequest(`http://${ip}/api/${apiKey}/config`, 'GET', null, 5000),
          ]);
          const lightCount = lights ? Object.keys(lights).length : 0;
          const groupCount = groups ? Object.keys(groups).length : 0;
          console.log(`[HUE] ✓ Bridge ${ip} — ${lightCount} lights, ${groupCount} groups`);
          ws.send(JSON.stringify({ type: 'hue-refresh-result', reqId, bridgeId, lights, groups, scenes, config }));
        } catch (err) {
          console.error(`[HUE] ✗ Bridge ${ip} refresh failed — ${err.message}`);
          ws.send(JSON.stringify({ type: 'hue-refresh-result', reqId, bridgeId, error: String(err) }));
        }
      })();
      break;
    }

    case 'hue-group-action': {
      const { bridgeId, groupId, groupState } = msg;
      const bridge = state.hue[bridgeId];
      if (!bridge) break;
      (async () => {
        try {
          await httpRequest(`http://${bridge.ip}/api/${bridge.apiKey}/groups/${groupId}/action`, 'PUT', groupState, 2000);
        } catch { /* offline */ }
      })();
      break;
    }

    case 'hue-scene': {
      const { bridgeId, groupId, sceneId } = msg;
      const bridge = state.hue[bridgeId];
      if (!bridge) break;
      (async () => {
        try {
          await httpRequest(`http://${bridge.ip}/api/${bridge.apiKey}/groups/${groupId}/action`, 'PUT', { scene: sceneId }, 2000);
        } catch { /* offline */ }
      })();
      break;
    }

    // ══════════════════════════════════════════════════════════
    // WLED: discovery, refresh (via engine)
    // ══════════════════════════════════════════════════════════

    case 'wled-refresh': {
      // Fetch full state from a WLED device
      const { ip, deviceId, reqId } = msg;
      if (!ip) break;
      console.log(`[WLED] Refreshing device ${deviceId} at ${ip}...`);
      (async () => {
        try {
          const data = await httpRequest(`http://${ip}/json`, 'GET', null, 3000);
          console.log(`[WLED] ✓ ${ip} online — ${data?.info?.leds?.count || '?'} LEDs`);
          ws.send(JSON.stringify({ type: 'wled-refresh-result', reqId, deviceId, data, online: true }));
        } catch (err) {
          console.error(`[WLED] ✗ ${ip} offline — ${err.message}`);
          ws.send(JSON.stringify({ type: 'wled-refresh-result', reqId, deviceId, data: null, online: false }));
        }
      })();
      break;
    }

    case 'wled-preset': {
      // Activate a WLED preset
      const { ip: wledIp, presetId } = msg;
      if (!wledIp) break;
      (async () => {
        try {
          await httpRequest(`http://${wledIp}/json/state`, 'POST', { ps: presetId }, 2000);
        } catch { /* offline */ }
      })();
      break;
    }

    case 'wled-presets': {
      // Fetch preset list from a WLED device
      const { ip: presetsIp, reqId: presetsReqId } = msg;
      if (!presetsIp) break;
      (async () => {
        try {
          const data = await httpRequest(`http://${presetsIp}/presets.json`, 'GET', null, 3000);
          ws.send(JSON.stringify({ type: 'wled-presets-result', reqId: presetsReqId, data }));
        } catch {
          ws.send(JSON.stringify({ type: 'wled-presets-result', reqId: presetsReqId, data: null }));
        }
      })();
      break;
    }

    case 'wled-scan': {
      // Network scan: probe a list of IPs for WLED devices
      const { ips, reqId: scanReqId } = msg;
      if (!Array.isArray(ips)) break;
      (async () => {
        const found = [];
        for (let i = 0; i < ips.length; i += 20) {
          const chunk = ips.slice(i, i + 20);
          const results = await Promise.allSettled(
            chunk.map(async (scanIp) => {
              try {
                const info = await httpRequest(`http://${scanIp}/json/info`, 'GET', null, 1500);
                if (info && info.ver && info.name) return { ip: scanIp, name: info.name };
              } catch {}
              return null;
            })
          );
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) found.push(r.value);
          }
        }
        ws.send(JSON.stringify({ type: 'wled-scan-result', reqId: scanReqId, found }));
      })();
      break;
    }

    case 'wled-audio-poll': {
      const { ip: audioIp, reqId: audioReqId } = msg;
      if (!audioIp) break;
      (async () => {
        try {
          const data = await httpRequest(`http://${audioIp}/json/si`, 'GET', null, 1500);
          ws.send(JSON.stringify({ type: 'wled-audio-poll-result', reqId: audioReqId, data }));
        } catch {
          ws.send(JSON.stringify({ type: 'wled-audio-poll-result', reqId: audioReqId, data: null }));
        }
      })();
      break;
    }

    case 'magic-discover': {
      const { proxyUrl, reqId } = msg;
      (async () => {
        try {
          const data = await httpRequest(`${proxyUrl}/api/discover`, 'GET', null, 10000);
          ws.send(JSON.stringify({ type: 'magic-discover-result', reqId, devices: Array.isArray(data) ? data : [] }));
        } catch {
          ws.send(JSON.stringify({ type: 'magic-discover-result', reqId, devices: [] }));
        }
      })();
      break;
    }

    case 'magic-refresh': {
      const { deviceId, proxyUrl, reqId } = msg;
      (async () => {
        try {
          const data = await httpRequest(`${proxyUrl}/api/device/${deviceId}/state`, 'GET', null, 3000);
          ws.send(JSON.stringify({ type: 'magic-refresh-result', reqId, deviceId, state: data, online: true }));
        } catch {
          ws.send(JSON.stringify({ type: 'magic-refresh-result', reqId, deviceId, state: null, online: false }));
        }
      })();
      break;
    }

    case 'magic-power': {
      const { deviceId, proxyUrl, on } = msg;
      (async () => {
        try {
          await httpRequest(`${proxyUrl}/api/device/${deviceId}/${on ? 'on' : 'off'}`, 'POST', undefined, 2000);
        } catch { /* offline */ }
      })();
      // Also update engine state
      if (!state.magic[msg.deviceId]) state.magic[msg.deviceId] = {};
      state.magic[msg.deviceId].proxyUrl = msg.proxyUrl;
      state.magic[msg.deviceId].on = msg.on;
      dirty = true;
      break;
    }

    case 'magic-color': {
      const { deviceId, proxyUrl, r, g, b } = msg;
      (async () => {
        try {
          await httpRequest(`${proxyUrl}/api/device/${deviceId}/color`, 'POST', { r, g, b }, 2000);
        } catch { /* offline */ }
      })();
      if (!state.magic[deviceId]) state.magic[deviceId] = {};
      state.magic[deviceId].proxyUrl = proxyUrl;
      state.magic[deviceId].on = true;
      state.magic[deviceId].r = r;
      state.magic[deviceId].g = g;
      state.magic[deviceId].b = b;
      dirty = true;
      break;
    }

    case 'magic-pattern': {
      const { deviceId, proxyUrl, pattern, speed } = msg;
      (async () => {
        try {
          await httpRequest(`${proxyUrl}/api/device/${deviceId}/pattern`, 'POST', { pattern, speed: speed || 50 }, 2000);
        } catch { /* offline */ }
      })();
      break;
    }

    case 'magic-warm-white': {
      const { deviceId, proxyUrl, level } = msg;
      (async () => {
        try {
          await httpRequest(`${proxyUrl}/api/device/${deviceId}/warm-white`, 'POST', { level }, 2000);
        } catch { /* offline */ }
      })();
      break;
    }

    // ══════════════════════════════════════════════════════════
    // Hue Entertainment API (DTLS streaming)
    // ══════════════════════════════════════════════════════════

    case 'hue-entertainment-create': {
      // Create an entertainment configuration via REST API
      const { bridgeId, name, lights: entLights, reqId } = msg;
      const bridge = state.hue[bridgeId];
      if (!bridge) {
        ws.send(JSON.stringify({ type: 'hue-entertainment-create-result', reqId, error: 'Bridge not registered' }));
        break;
      }
      (async () => {
        try {
          // Create entertainment configuration (API v1)
          const body = {
            name: name || 'STOKIO Entertainment',
            type: 'Entertainment',
            class: 'Other',
            lights: entLights || [],
          };
          const result = await httpRequest(
            `http://${bridge.ip}/api/${bridge.apiKey}/groups`,
            'POST', body, 5000
          );
          const groupId = Array.isArray(result) && result[0]?.success?.id
            ? result[0].success.id
            : null;
          ws.send(JSON.stringify({ type: 'hue-entertainment-create-result', reqId, groupId, result }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'hue-entertainment-create-result', reqId, error: String(err) }));
        }
      })();
      break;
    }

    case 'hue-entertainment-start': {
      // Activate streaming mode on an entertainment group and establish DTLS
      const { bridgeId, groupId, reqId } = msg;
      const bridge = state.hue[bridgeId];
      if (!bridge) {
        ws.send(JSON.stringify({ type: 'hue-entertainment-start-result', reqId, success: false, error: 'Bridge not registered' }));
        break;
      }
      (async () => {
        try {
          // Step 1: Activate streaming on the group
          await httpRequest(
            `http://${bridge.ip}/api/${bridge.apiKey}/groups/${groupId}`,
            'PUT', { stream: { active: true } }, 5000
          );

          // Step 2: Get the entertainment group to find clientkey + light channels
          const groupData = await httpRequest(
            `http://${bridge.ip}/api/${bridge.apiKey}/groups/${groupId}`,
            'GET', null, 3000
          );

          // Step 3: Get the clientkey for this API user
          const config = await httpRequest(
            `http://${bridge.ip}/api/${bridge.apiKey}/config`,
            'GET', null, 3000
          );

          // Find our clientkey from whitelist
          let clientKey = null;
          if (config && config.whitelist) {
            for (const [, entry] of Object.entries(config.whitelist)) {
              // The clientkey is set during entertainment registration
              // We need to have registered with entertainment capability
            }
          }

          // Step 4: Establish DTLS connection
          let dtlsConnected = false;
          try {
            const dtls = require('node-dtls-client');
            const socket = dtls.createSocket({
              type: 'udp4',
              address: bridge.ip,
              port: 2100,
              psk: { [bridge.apiKey]: Buffer.from(bridge.clientKey || '', 'hex') },
              ciphers: ['TLS_PSK_WITH_AES_128_GCM_SHA256'],
              timeout: 5000,
            });

            await new Promise((resolve, reject) => {
              socket.on('connected', () => {
                dtlsConnected = true;
                // Store DTLS socket for this bridge
                if (!state._hueEntertainment) state._hueEntertainment = {};
                state._hueEntertainment[bridgeId] = {
                  socket,
                  groupId,
                  lights: groupData?.lights || [],
                  sequence: 0,
                };
                resolve();
              });
              socket.on('error', reject);
              socket.on('close', () => {
                if (state._hueEntertainment && state._hueEntertainment[bridgeId]) {
                  delete state._hueEntertainment[bridgeId];
                  broadcastToAll({ type: 'hue-entertainment-status', bridgeId, active: false });
                }
              });
            });
          } catch (dtlsErr) {
            // DTLS library not installed — fall back to fast HTTP polling
            console.warn('[HUE-ENT] node-dtls-client not available, using fast HTTP fallback:', dtlsErr.message);
            if (!state._hueEntertainment) state._hueEntertainment = {};
            state._hueEntertainment[bridgeId] = {
              socket: null, // null = HTTP fallback mode
              groupId,
              lights: groupData?.lights || [],
              sequence: 0,
              httpFallback: true,
            };
            dtlsConnected = false; // but we still have HTTP fallback
          }

          ws.send(JSON.stringify({
            type: 'hue-entertainment-start-result',
            reqId,
            success: true,
            dtls: dtlsConnected,
            httpFallback: !dtlsConnected,
            groupId,
            lights: groupData?.lights || [],
          }));

          broadcastToAll({ type: 'hue-entertainment-status', bridgeId, active: true, dtls: dtlsConnected, groupId });

        } catch (err) {
          ws.send(JSON.stringify({ type: 'hue-entertainment-start-result', reqId, success: false, error: String(err) }));
        }
      })();
      break;
    }

    case 'hue-entertainment-stop': {
      const { bridgeId, reqId } = msg;
      const bridge = state.hue[bridgeId];
      if (state._hueEntertainment && state._hueEntertainment[bridgeId]) {
        const ent = state._hueEntertainment[bridgeId];
        if (ent.socket) {
          try { ent.socket.close(); } catch {}
        }
        // Deactivate streaming on bridge
        if (bridge) {
          httpRequest(
            `http://${bridge.ip}/api/${bridge.apiKey}/groups/${ent.groupId}`,
            'PUT', { stream: { active: false } }, 3000
          ).catch(() => {});
        }
        delete state._hueEntertainment[bridgeId];
      }
      broadcastToAll({ type: 'hue-entertainment-status', bridgeId, active: false });
      if (reqId) ws.send(JSON.stringify({ type: 'hue-entertainment-stop-result', reqId, success: true }));
      break;
    }

    case 'hue-entertainment-color': {
      // Stream color data to entertainment lights
      // { bridgeId, channels: [{ channel: 0, r: 255, g: 0, b: 0 }, ...] }
      if (!state._hueEntertainment || !state._hueEntertainment[msg.bridgeId]) break;
      const ent = state._hueEntertainment[msg.bridgeId];
      const channels = msg.channels || [];

      if (ent.socket && !ent.httpFallback) {
        // DTLS mode: build binary packet
        // Protocol: "HueStream" + version(2.0) + seq + reserved + colorspace(RGB=0) + reserved + entertainment_config_id
        const header = Buffer.alloc(16);
        Buffer.from('HueStream', 'ascii').copy(header, 0); // 9 bytes
        header.writeUInt8(0x02, 9);  // API version major
        header.writeUInt8(0x00, 10); // API version minor
        ent.sequence = (ent.sequence + 1) & 0xff;
        header.writeUInt8(ent.sequence, 11); // sequence number
        header.writeUInt16BE(0x0000, 12);    // reserved
        header.writeUInt8(0x00, 14);         // color space: 0 = RGB
        header.writeUInt8(0x00, 15);         // reserved

        // Entertainment config ID as null-terminated string (variable length)
        // For v1 API, we just omit this or use the group ID
        // Each light channel: 1 byte type (0=light) + 2 bytes id + 2 bytes R + 2 bytes G + 2 bytes B
        const channelBufs = channels.map(ch => {
          const buf = Buffer.alloc(7);
          buf.writeUInt8(0x00, 0); // type: light
          buf.writeUInt16BE(ch.channel || 0, 1); // channel id
          buf.writeUInt16BE(Math.round((ch.r / 255) * 65535), 3); // R (16-bit)
          buf.writeUInt16BE(Math.round((ch.g / 255) * 65535), 5); // G (16-bit)
          // Only 7 bytes per spec: type(1) + id(2) + R(2) + G(2) = 7
          // Actually need 9 bytes: type(1) + id(2) + R(2) + G(2) + B(2)
          return buf;
        });

        // Rebuild with correct 9 bytes per channel
        const channelBufs2 = channels.map(ch => {
          const buf = Buffer.alloc(9);
          buf.writeUInt8(0x00, 0); // type: light
          buf.writeUInt16BE(ch.channel || 0, 1);
          buf.writeUInt16BE(Math.round((ch.r / 255) * 65535), 3);
          buf.writeUInt16BE(Math.round((ch.g / 255) * 65535), 5);
          buf.writeUInt16BE(Math.round((ch.b / 255) * 65535), 7);
          return buf;
        });

        const packet = Buffer.concat([header, ...channelBufs2]);
        try { ent.socket.send(packet); } catch {}
      } else {
        // HTTP fallback: send individual light commands (slower but works without DTLS)
        const bridge = state.hue[msg.bridgeId];
        if (!bridge) break;
        for (const ch of channels) {
          const lightId = ent.lights[ch.channel];
          if (!lightId) continue;
          const xy = rgbToXySimple(ch.r, ch.g, ch.b);
          const bri = Math.max(1, Math.round(Math.max(ch.r, ch.g, ch.b) / 255 * 254));
          httpRequest(
            `http://${bridge.ip}/api/${bridge.apiKey}/lights/${lightId}/state`,
            'PUT', { on: true, xy, bri, transitiontime: 0 }, 1000
          ).catch(() => {});
        }
      }
      break;
    }

    default:
      // Unknown message type — ignore
      break;
  }
}

// ══════════════════════════════════════════════════════════════
// Main output loop
// ══════════════════════════════════════════════════════════════

let outputCycle = 0;

async function outputLoop() {
  outputCycle++;

  // ArtNet & sACN every cycle (25fps)
  outputArtNet();
  outputSacn();

  // DDP every cycle (25fps) — fast pixel protocol for WLED
  outputDdp();

  // DNRGB every cycle (25fps) — WLED realtime, auto-releases on stop
  outputDnrgb();

  // WLED JSON API every cycle (only for devices set to 'json' protocol)
  await outputWled();

  // Hue every 3rd cycle (~8fps, within Hue rate limits)
  if (outputCycle % 3 === 0) {
    await outputHue();
  }

  // MagicHome every 2nd cycle (~12fps)
  if (outputCycle % 2 === 0) {
    await outputMagic();
  }
}

// ══════════════════════════════════════════════════════════════
// ProDJ Link — Pioneer DJ equipment discovery & beat sync
// ══════════════════════════════════════════════════════════════

const PRODJLINK_HEADER = Buffer.from([0x51, 0x73, 0x70, 0x74, 0x31, 0x57, 0x6d, 0x4a, 0x4f, 0x4c]);

function isProDJLinkPacket(buf) {
  if (buf.length < 11) return false;
  for (let i = 0; i < 10; i++) {
    if (buf[i] !== PRODJLINK_HEADER[i]) return false;
  }
  return true;
}

// Port 50000: device keepalive / announcements
const pdjKeepAlive = dgram.createSocket({ type: 'udp4', reuseAddr: true });
pdjKeepAlive.on('error', (e) => console.error('[PIONEER] Keepalive socket error:', e.message));

pdjKeepAlive.on('message', (buf, rinfo) => {
  if (!isProDJLinkPacket(buf)) return;
  const packetType = buf[10];

  // Type 0x06 = CDJ/Mixer keepalive, Type 0x0a = device keepalive
  if (packetType !== 0x06 && packetType !== 0x0a) return;

  // Device name: bytes 12-31 (null-terminated)
  let deviceName = '';
  for (let i = 12; i < Math.min(32, buf.length); i++) {
    if (buf[i] === 0) break;
    deviceName += String.fromCharCode(buf[i]);
  }

  // Device number
  const deviceNumber = buf.length > 36 ? buf[36] : buf.length > 33 ? buf[33] : 0;

  if (deviceNumber > 0) {
    const existing = state.pioneerDecks[deviceNumber] || {};
    state.pioneerDecks[deviceNumber] = {
      ...existing,
      name: deviceName.trim() || existing.name || `Deck ${deviceNumber}`,
      deviceNumber,
      ip: rinfo.address,
      lastSeen: Date.now(),
      bpm: existing.bpm || 0,
      beat: existing.beat || 0,
      playing: existing.playing || false,
      master: existing.master || false,
    };
  }
});

try {
  pdjKeepAlive.bind(50000, () => {
    try { pdjKeepAlive.setBroadcast(true); } catch {}
    console.log('[PIONEER] Listening for keepalive on port 50000');
  });
} catch (e) {
  console.error('[PIONEER] Could not bind port 50000:', e.message);
}

// Port 50001: beat packets
const pdjBeat = dgram.createSocket({ type: 'udp4', reuseAddr: true });
pdjBeat.on('error', (e) => console.error('[PIONEER] Beat socket error:', e.message));

pdjBeat.on('message', (buf, rinfo) => {
  if (!isProDJLinkPacket(buf)) return;
  const packetType = buf[10];

  // Type 0x28 = Beat packet (0x60 = 96 bytes long)
  if (packetType === 0x28 && buf.length >= 0x60) {
    // Device number at byte 0x21 (33)
    const deviceNumber = buf[0x21];
    // BPM at bytes 0x5a-0x5b: 2-byte big-endian value * 0.01
    const bpmRaw = buf.readUInt16BE(0x5a);
    const bpm = Math.round(bpmRaw / 100 * 10) / 10; // one decimal
    // Beat within bar at byte 0x5c
    const beat = buf[0x5c];

    if (deviceNumber > 0 && bpm > 0 && bpm < 500) {
      const existing = state.pioneerDecks[deviceNumber] || {};
      state.pioneerDecks[deviceNumber] = {
        ...existing,
        name: existing.name || `Deck ${deviceNumber}`,
        deviceNumber,
        ip: existing.ip || rinfo.address,
        lastSeen: Date.now(),
        bpm,
        beat: beat || existing.beat || 0,
        playing: true,
        master: existing.master || false,
      };

      // Broadcast beat to all connected browser clients
      broadcastToAll({
        type: 'pioneer-beat',
        deviceNumber,
        bpm,
        beat,
        name: state.pioneerDecks[deviceNumber].name,
      });
    }
  }

  // Type 0x0b = Channels On Air / status (also on port 50001 for some models)
  if (packetType === 0x0b && buf.length >= 0x28) {
    const deviceNumber = buf[0x21];
    const bpmRaw = buf.readUInt16BE(0x24);
    const bpm = Math.round(bpmRaw / 100 * 10) / 10;

    if (deviceNumber > 0 && bpm > 0 && bpm < 500) {
      const existing = state.pioneerDecks[deviceNumber] || {};
      state.pioneerDecks[deviceNumber] = {
        ...existing,
        name: existing.name || `Deck ${deviceNumber}`,
        deviceNumber,
        ip: existing.ip || rinfo.address,
        lastSeen: Date.now(),
        bpm,
      };
    }
  }
});

try {
  pdjBeat.bind(50001, () => {
    try { pdjBeat.setBroadcast(true); } catch {}
    console.log('[PIONEER] Listening for beats on port 50001');
  });
} catch (e) {
  console.error('[PIONEER] Could not bind port 50001:', e.message);
}

// Periodically broadcast full Pioneer deck state to clients & prune stale decks
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [num, deck] of Object.entries(state.pioneerDecks)) {
    if (now - deck.lastSeen > 10000) {
      // Mark offline after 10s silence
      if (deck.playing) {
        state.pioneerDecks[num] = { ...deck, playing: false };
        changed = true;
      }
    }
    if (now - deck.lastSeen > 60000) {
      // Remove after 60s
      delete state.pioneerDecks[num];
      changed = true;
    }
  }

  if (Object.keys(state.pioneerDecks).length > 0) {
    broadcastToAll({ type: 'pioneer-decks', decks: state.pioneerDecks });
  }
}, 2000);

// ══════════════════════════════════════════════════════════════
// Startup
// ══════════════════════════════════════════════════════════════

loadState();

// Output loop
const outputTimer = setInterval(outputLoop, OUTPUT_INTERVAL);

// Save state periodically
const saveTimer = setInterval(saveState, SAVE_INTERVAL);

// ── Broadcast live DMX levels to browsers (10fps) ──
// Sends only non-zero channels so it stays lightweight for remote tablets
let lastDmxLevelsHash = '';
const dmxLevelsTimer = setInterval(() => {
  if (wss.clients.size === 0) return;
  const levels = {};
  let hasData = false;
  for (const [uniStr, dmxBuf] of Object.entries(state.dmx)) {
    if (!(dmxBuf instanceof Uint8Array)) continue;
    const scale = state.blackout ? 0 : (state.masterDimmer / 100);
    const uniLevels = {};
    for (let i = 0; i < 512; i++) {
      const v = Math.round(dmxBuf[i] * scale);
      if (v > 0) { uniLevels[i + 1] = v; hasData = true; }
    }
    if (Object.keys(uniLevels).length > 0) levels[uniStr] = uniLevels;
  }
  // Quick hash to avoid sending identical frames
  const hash = JSON.stringify(levels);
  if (hash === lastDmxLevelsHash) return;
  lastDmxLevelsHash = hash;
  broadcastToAll({ type: 'dmx-levels', levels });
}, 100);

// Enable broadcast for ArtNet
artnetSocket.bind(() => {
  try { artnetSocket.setBroadcast(true); } catch {}
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[ENGINE] Shutting down...');
  clearInterval(outputTimer);
  clearInterval(saveTimer);
  clearInterval(dmxLevelsTimer);
  saveState();
  artnetSocket.close();
  sacnSocket.close();
  ddpSocket.close();
  wss.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  clearInterval(outputTimer);
  clearInterval(saveTimer);
  saveState();
  process.exit(0);
});

const interfaces = require('os').networkInterfaces();
const localIPs = Object.values(interfaces)
  .flat()
  .filter(i => i && i.family === 'IPv4' && !i.internal)
  .map(i => i.address);

console.log(`
╔═══════════════════════════════════════════════╗
║   Chroma Grid Canvas — Lighting Engine        ║
║   ─────────────────────────────────────────   ║
║   WebSocket:  port ${String(PORT).padEnd(27)}║
║   ArtNet:     port 6454 (UDP broadcast)       ║
║   sACN:       port 5568 (UDP multicast)       ║
║   DDP:        port 4048 (UDP pixel data)      ║
║                                               ║
║   Engine runs independently of browser.       ║
║   Close all browser tabs — lights stay on.    ║
║                                               ║
║   Local IPs:                                  ║
${localIPs.map(ip => `║     ${ip.padEnd(42)}║`).join('\n')}
║                                               ║
║   Open browser: http://<ip>:5173              ║
╚═══════════════════════════════════════════════╝
`);
