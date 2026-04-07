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

const PORT = parseInt(process.env.PORT || '9100', 10);
const STATE_FILE = path.join(__dirname, '.engine-state.json');
const OUTPUT_INTERVAL = 40;  // 25fps hardware output
const HUE_INTERVAL = 100;   // Hue rate limit: ~10/sec per light
const SAVE_INTERVAL = 5000;  // persist state every 5s

// ══════════════════════════════════════════════════════════════
// State
// ══════════════════════════════════════════════════════════════

const state = {
  dmx: {},
  wled: {},
  hue: {},
  magic: {},
  ddp: {},    // DDP pixel data: { ip: { pixels: [r,g,b,...] } }
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
    const lib = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (url.startsWith('https') ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      timeout,
      headers: {},
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
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
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

const artnetSocket = dgram.createSocket('udp4');
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
// Hardware Output: DDP (Distributed Display Protocol)
// ══════════════════════════════════════════════════════════════
// DDP is a lightweight protocol optimized for LED controllers like WLED.
// No universe limits — direct pixel addressing. Much faster than E1.31 for WLED.

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
  const os = require('os');
  const ifaces = os.networkInterfaces();
  const nicList = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4') {
        nicList.push({ name, address: addr.address, mac: addr.mac || '', internal: addr.internal });
      }
    }
  }

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

    // ── WLED output ──
    case 'wled-output': {
      if (msg.ip && msg.payload) {
        state.wled[msg.ip] = msg.payload;
        dirty = true;
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
      }));
      break;
    }

    // ── I/O configuration from browser ──
    case 'io-config': {
      if (msg.outputs) {
        state.ioConfig.outputs = msg.outputs;
        // Extract ArtNet bind address from first artnet output with a specific NIC
        const artnetOut = msg.outputs.find(o => o.protocol === 'artnet' && o.bindInterface && o.bindInterface !== 'all');
        if (artnetOut) {
          state.ioConfig.artnetBindAddress = artnetOut.bindInterface;
          console.log(`[ENGINE] ArtNet bound to NIC: ${artnetOut.bindInterface}`);
          // Rebind ArtNet socket
          try {
            artnetSocket.close();
          } catch {}
          const newSocket = require('dgram').createSocket('udp4');
          newSocket.on('error', () => {});
          newSocket.bind({ address: artnetOut.bindInterface, port: 0 }, () => {
            try { newSocket.setBroadcast(true); } catch {}
            console.log(`[ENGINE] ArtNet socket rebound to ${artnetOut.bindInterface}`);
          });
          // Note: in production, we'd replace artnetSocket reference
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

  // WLED every cycle
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

// Enable broadcast for ArtNet
artnetSocket.bind(() => {
  try { artnetSocket.setBroadcast(true); } catch {}
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[ENGINE] Shutting down...');
  clearInterval(outputTimer);
  clearInterval(saveTimer);
  saveState();
  artnetSocket.close();
  sacnSocket.close();
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
║   Chroma Grid Canvas — Lighting Engine                ║
║   ─────────────────────────────────────────   ║
║   WebSocket:  port ${String(PORT).padEnd(27)}║
║   ArtNet:     port 6454 (UDP broadcast)       ║
║   sACN:       port 5568 (UDP multicast)       ║
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
