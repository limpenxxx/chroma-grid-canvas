/**
 * WebSocket Sync Client
 * Connects to the LAN sync server and keeps all browser windows in sync.
 */

type SyncListener = (state: Record<string, unknown>) => void;

let ws: WebSocket | null = null;
let listeners: SyncListener[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let isRemoteUpdate = false;

/** True when we're applying a remote update — stores should skip broadcasting */
export function isSyncingFromRemote(): boolean {
  return isRemoteUpdate;
}

/** Subscribe to incoming state updates */
export function onSyncState(listener: SyncListener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** Broadcast a partial state update to other clients */
export function broadcastState(storeKey: string, state: Record<string, unknown>) {
  if (isRemoteUpdate) return; // don't echo back
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'update', state: { [storeKey]: state } }));
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
      console.log('[SYNC] Connected to', url);
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
        }
      } catch { /* ignore bad messages */ }
    };

    ws.onclose = () => {
      ws = null;
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
