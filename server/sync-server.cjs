#!/usr/bin/env node
/**
 * Chroma Grid Canvas — LAN WebSocket Sync Server
 * 
 * Run on your main PC:  node server/sync-server.cjs
 * All browser windows (PC, tablet, phone) will share the same state.
 * 
 * Default port: 9100  (override with PORT env variable)
 */

const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT || '9100', 10);
const wss = new WebSocketServer({ port: PORT });

// Latest state snapshot — sent to new clients on connect
let latestState = null;
let clientCount = 0;

wss.on('connection', (ws) => {
  clientCount++;
  const id = clientCount;
  console.log(`[SYNC] Client #${id} connected  (total: ${wss.clients.size})`);

  // Send current state to new client
  if (latestState) {
    ws.send(JSON.stringify({ type: 'sync', state: latestState }));
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'update') {
        // Merge partial state into latest
        latestState = { ...(latestState || {}), ...msg.state };

        // Broadcast to all OTHER clients
        for (const client of wss.clients) {
          if (client !== ws && client.readyState === 1) {
            client.send(JSON.stringify({ type: 'sync', state: msg.state }));
          }
        }
      }
    } catch (e) {
      console.error('[SYNC] Bad message:', e.message);
    }
  });

  ws.on('close', () => {
    console.log(`[SYNC] Client #${id} disconnected  (total: ${wss.clients.size})`);
  });
});

console.log(`
╔══════════════════════════════════════════╗
║   Chroma Grid Canvas — Sync Server running       ║
║   Port: ${String(PORT).padEnd(33)}║
║                                          ║
║   Connect browsers to your PC's IP:      ║
║   http://<your-pc-ip>:5173               ║
║                                          ║
║   The app auto-connects to ws://         ║
║   <hostname>:${String(PORT).padEnd(28)}║
╚══════════════════════════════════════════╝
`);
