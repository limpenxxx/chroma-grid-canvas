/**
 * WebSocket Sync Client
 * Connects to the STOKIO FX Engine Server and acts as a remote control.
 * All hardware output is handled by the engine — the browser is just a GUI.
 */

type SyncListener = (state: Record<string, unknown>) => void;
type EngineStatusListener = (status: EngineStatus) => void;
type PioneerListener = (data: PioneerData) => void;
type RawMessageListener = (msg: any) => void;

export interface PioneerDeck {
  name: string;
  deviceNumber: number;
  bpm: number;
  beat: number;
  playing: boolean;
  master: boolean;
  ip: string;
  lastSeen: number;
}

export interface PioneerData {
  type: 'pioneer-decks' | 'pioneer-beat';
  decks?: Record<number, PioneerDeck>;
  deviceNumber?: number;
  bpm?: number;
  beat?: number;
  name?: string;
}

export interface EngineStatus {
  running: boolean;
  dmxUniverses: number[];
  wledTargets: number;
  hueBridges: number;
  magicDevices: number;
  masterDimmer?: number;
  blackout?: boolean;
  pioneerDecks?: Record<number, PioneerDeck>;
}

let ws: WebSocket | null = null;
let listeners: SyncListener[] = [];
let engineStatusListeners: EngineStatusListener[] = [];
let pioneerListeners: PioneerListener[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let isRemoteUpdate = false;
let _engineConnected = false;
let rawMessageListeners: RawMessageListener[] = [];
let engineConnectListeners: (() => void)[] = [];

/** Subscribe to engine connect events (fires when WS opens) */
export function onEngineConnect(listener: () => void): () => void {
  engineConnectListeners.push(listener);
  // If already connected, fire immediately
  if (_engineConnected) {
    try { listener(); } catch {}
  }
  return () => {
    engineConnectListeners = engineConnectListeners.filter((l) => l !== listener);
  };
}

/** True when we're applying a remote update — stores should skip broadcasting */
export function isSyncingFromRemote(): boolean {
  return isRemoteUpdate;
}

/** True when connected to the engine server */
export function isEngineConnected(): boolean {
  return _engineConnected;
}

/** Subscribe to incoming state updates */
export function onSyncState(listener: SyncListener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** Subscribe to engine status updates */
export function onEngineStatus(listener: EngineStatusListener): () => void {
  engineStatusListeners.push(listener);
  return () => {
    engineStatusListeners = engineStatusListeners.filter((l) => l !== listener);
  };
}

/** Subscribe to Pioneer DJ updates */
export function onPioneerData(listener: PioneerListener): () => void {
  pioneerListeners.push(listener);
  return () => {
    pioneerListeners = pioneerListeners.filter((l) => l !== listener);
  };
}

/** Subscribe to all raw engine messages (for VFX status etc.) */
export function onEngineMessage(listener: RawMessageListener): () => void {
  rawMessageListeners.push(listener);
  return () => {
    rawMessageListeners = rawMessageListeners.filter((l) => l !== listener);
  };
}

/** Broadcast a partial state update to other clients */
export function broadcastState(storeKey: string, state: Record<string, unknown>) {
  if (isRemoteUpdate) return; // don't echo back
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'update', state: { [storeKey]: state } }));
  }
}

/** Send a raw typed message to the engine */
export function sendRawMessage(msg: Record<string, unknown>) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Send a request to the engine and wait for a typed response.
 * Uses reqId to correlate request/response.
 */
let _reqIdCounter = 0;
const _pendingRequests = new Map<string, { resolve: (data: any) => void; timer: ReturnType<typeof setTimeout> }>();

export function engineRequest<T = any>(msg: Record<string, unknown>, responseType: string, timeoutMs: number = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Engine not connected'));
      return;
    }
    const reqId = `req-${++_reqIdCounter}-${Date.now()}`;
    const timer = setTimeout(() => {
      _pendingRequests.delete(reqId);
      reject(new Error('Engine request timeout'));
    }, timeoutMs);
    _pendingRequests.set(reqId, { resolve, timer });
    sendRawMessage({ ...msg, reqId });
  });
}

// Called from onmessage handler to resolve pending requests
function _handleEngineResponse(msg: any) {
  if (msg.reqId && _pendingRequests.has(msg.reqId)) {
    const pending = _pendingRequests.get(msg.reqId)!;
    clearTimeout(pending.timer);
    _pendingRequests.delete(msg.reqId);
    pending.resolve(msg);
  }
}

// ── Engine commands (hardware output routed through engine) ──

/** Send a single DMX channel value to the engine */
export function sendDmxChannel(universe: number, channel: number, value: number) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'dmx', universe, channel, value }));
  }
}

/** Send multiple DMX channels at once */
export function sendDmxBatch(universe: number, channels: Record<number, number>) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'dmx-batch', universe, channels }));
  }
}

/** Send WLED JSON API payload to the engine (permanent — overwrites WLED preset) */
export function sendWledOutput(ip: string, payload: Record<string, unknown>) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'wled-output', ip, payload }));
  }
}

/** Send WLED DNRGB realtime pixel data to the engine (temporary — auto-releases) */
export function sendWledRealtime(ip: string, pixels: number[], timeout?: number) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'wled-realtime', ip, pixels, timeout: timeout || 0 }));
  }
}

/** Send DDP pixel data to a WLED device via the engine (fast pixel protocol, no universe limits) */
export function sendDdpPixels(ip: string, pixels: number[]) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ddp-output', ip, pixels }));
  }
}

/**
 * Smart WLED color routing — sends color to a WLED device via the engine
 * using the correct protocol (dnrgb, ddp, or json).
 */
export function sendWledColor(
  ip: string,
  r: number, g: number, b: number,
  protocol: 'dnrgb' | 'ddp' | 'json' = 'dnrgb',
  ledCount: number = 1,
  segmentId: number = 0,
  timeout?: number,
) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  if (protocol === 'json') {
    // JSON API: permanent, sets segment color
    sendWledOutput(ip, { on: true, seg: [{ id: segmentId, col: [[r, g, b]] }] });
  } else if (protocol === 'ddp') {
    // DDP: temporary, pixel-level
    const pixels: number[] = [];
    for (let i = 0; i < ledCount; i++) pixels.push(r, g, b);
    sendDdpPixels(ip, pixels);
  } else {
    // DNRGB: temporary, pixel-level (default)
    const pixels: number[] = [];
    for (let i = 0; i < ledCount; i++) pixels.push(r, g, b);
    sendWledRealtime(ip, pixels, timeout);
  }
}

/**
 * Smart WLED brightness routing — sends brightness via the engine.
 */
export function sendWledBrightness(
  ip: string,
  bri: number,
  on: boolean = true,
  protocol: 'dnrgb' | 'ddp' | 'json' = 'dnrgb',
  segmentId: number = 0,
) {
  // Brightness control always uses JSON API (DNRGB is pixel-level only)
  sendWledOutput(ip, { on, bri: Math.max(0, Math.min(255, bri)), seg: [{ id: segmentId }] });
}

/** Register a Hue bridge with the engine */
export function sendHueBridge(bridgeId: string, ip: string, apiKey: string) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'hue-bridge', bridgeId, ip, apiKey }));
  }
}

/** Set a Hue light state through the engine */
export function sendHueLight(bridgeId: string, lightId: string, state: Record<string, unknown>) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'hue-light', bridgeId, lightId, state }));
  }
}

/** Set a MagicHome device state through the engine */
export function sendMagicSet(deviceId: string, proxyUrl: string, on: boolean, r: number, g: number, b: number) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'magic-set', deviceId, proxyUrl, on, r, g, b }));
  }
}

// ── Hue engine commands ──

/** Discover Hue bridges via engine */
export function engineHueDiscover(): Promise<{ bridges: Array<{ id: string; internalipaddress: string }> }> {
  return engineRequest({ type: 'hue-discover' }, 'hue-discover-result', 8000);
}

/** Pair with Hue bridge via engine */
export function engineHuePair(ip: string): Promise<{ success: boolean; apiKey?: string; error?: string }> {
  return engineRequest({ type: 'hue-pair', ip }, 'hue-pair-result', 8000);
}

/** Refresh bridge data via engine */
export function engineHueRefresh(bridgeId: string, ip: string, apiKey: string): Promise<any> {
  return engineRequest({ type: 'hue-refresh', bridgeId, ip, apiKey }, 'hue-refresh-result', 8000);
}

/** Set Hue group action via engine */
export function sendHueGroupAction(bridgeId: string, groupId: string, state: Record<string, unknown>) {
  sendRawMessage({ type: 'hue-group-action', bridgeId, groupId, groupState: state });
}

/** Activate Hue scene via engine */
export function sendHueScene(bridgeId: string, groupId: string, sceneId: string) {
  sendRawMessage({ type: 'hue-scene', bridgeId, groupId, sceneId });
}

// ── WLED engine commands ──

/** Refresh WLED device state via engine */
export function engineWledRefresh(deviceId: string, ip: string): Promise<any> {
  return engineRequest({ type: 'wled-refresh', deviceId, ip }, 'wled-refresh-result', 5000);
}

/** Fetch WLED preset list via engine */
export function engineWledPresets(ip: string): Promise<{ data: any }> {
  return engineRequest({ type: 'wled-presets', ip }, 'wled-presets-result', 5000);
}

/** Scan network for WLED devices via engine */
export function engineWledScan(ips: string[]): Promise<{ found: Array<{ ip: string; name: string }> }> {
  return engineRequest({ type: 'wled-scan', ips }, 'wled-scan-result', 30000);
}

/** Poll WLED audio-reactive data via engine */
export function engineWledAudioPoll(ip: string): Promise<{ data: any }> {
  return engineRequest({ type: 'wled-audio-poll', ip }, 'wled-audio-poll-result', 2000);
}

// ── MagicHome engine commands ──

/** Discover MagicHome devices via engine proxy */
export function engineMagicDiscover(proxyUrl: string): Promise<{ devices: any[] }> {
  return engineRequest({ type: 'magic-discover', proxyUrl }, 'magic-discover-result', 12000);
}

/** Refresh MagicHome device state via engine */
export function engineMagicRefresh(deviceId: string, proxyUrl: string): Promise<any> {
  return engineRequest({ type: 'magic-refresh', deviceId, proxyUrl }, 'magic-refresh-result', 5000);
}

/** MagicHome power control via engine */
export function sendMagicPower(deviceId: string, proxyUrl: string, on: boolean) {
  sendRawMessage({ type: 'magic-power', deviceId, proxyUrl, on });
}

/** MagicHome color control via engine */
export function sendMagicColor(deviceId: string, proxyUrl: string, r: number, g: number, b: number) {
  sendRawMessage({ type: 'magic-color', deviceId, proxyUrl, r, g, b });
}

/** MagicHome pattern control via engine */
export function sendMagicPattern(deviceId: string, proxyUrl: string, pattern: string, speed?: number) {
  sendRawMessage({ type: 'magic-pattern', deviceId, proxyUrl, pattern, speed });
}

/** MagicHome warm white control via engine */
export function sendMagicWarmWhite(deviceId: string, proxyUrl: string, level: number) {
  sendRawMessage({ type: 'magic-warm-white', deviceId, proxyUrl, level });
}

/** Send master dimmer to engine */
export function sendMasterDimmer(value: number) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'master-dimmer', value }));
  }
}

/** Send blackout state to engine */
export function sendBlackout(value: boolean) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'blackout', value }));
  }
}

/** Send MIDI mapping to engine */
export function sendMidiLearn(channel: number, cc: number, target: string) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'midi-learn', channel, cc, target }));
  }
}

/** Send OSC address mapping to engine */
export function sendOscMap(address: string, target: string) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'osc-map', address, target }));
  }
}

/** Get the sync server URL — same hostname as page, port 9100 */
function getSyncUrl(): string {
  const host = window.location.hostname || 'localhost';
  const port = 9100;
  return `ws://${host}:${port}`;
}

function connect() {
  try {
    const url = getSyncUrl();
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('[ENGINE] Connected to', url);
      _engineConnected = true;
      // Notify listeners that engine is connected — stores can auto-refresh
      for (const listener of engineConnectListeners) {
        try { listener(); } catch {}
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        // Handle request/response pattern first
        _handleEngineResponse(msg);
        // Dispatch to raw message listeners
        for (const listener of rawMessageListeners) {
          listener(msg);
        }
        if (msg.type === 'sync' && msg.state) {
          isRemoteUpdate = true;
          for (const listener of listeners) {
            listener(msg.state);
          }
          isRemoteUpdate = false;
        } else if (msg.type === 'engine-status' || msg.type === 'engine-state') {
          for (const listener of engineStatusListeners) {
            listener(msg as EngineStatus);
          }
        } else if (msg.type === 'pioneer-decks' || msg.type === 'pioneer-beat') {
          for (const listener of pioneerListeners) {
            listener(msg as PioneerData);
          }
        }
      } catch { /* ignore bad messages */ }
    };

    ws.onclose = () => {
      ws = null;
      _engineConnected = false;
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws?.close();
    };
  } catch {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000);
}

/** Initialize the sync connection */
export function initSync() {
  connect();
}
