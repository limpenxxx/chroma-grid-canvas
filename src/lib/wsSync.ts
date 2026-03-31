/**
 * WebSocket Sync Client
 * Connects to the STOKIO FX Engine Server and acts as a remote control.
 * All hardware output is handled by the engine — the browser is just a GUI.
 */

type SyncListener = (state: Record<string, unknown>) => void;
type EngineStatusListener = (status: EngineStatus) => void;
type PioneerListener = (data: PioneerData) => void;

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

/** Broadcast a partial state update to other clients */
export function broadcastState(storeKey: string, state: Record<string, unknown>) {
  if (isRemoteUpdate) return; // don't echo back
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'update', state: { [storeKey]: state } }));
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

/** Send WLED pixel data to the engine for output */
export function sendWledOutput(ip: string, payload: Record<string, unknown>) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'wled-output', ip, payload }));
  }
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
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
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
