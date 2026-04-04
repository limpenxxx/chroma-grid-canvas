#!/bin/bash
set -e

# ── STOKIO FX — Ubuntu Autostart Installer ──
STOKIO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STOKIO_USER="$(whoami)"
NODE_BIN="$(which node)"
NPM_BIN="$(which npm)"

echo "╔══════════════════════════════════════════╗"
echo "║  STOKIO FX — Autostart Installer         ║"
echo "╠══════════════════════════════════════════╣"
echo "║  Projekt:    $STOKIO_DIR"
echo "║  Användare:  $STOKIO_USER"
echo "║  Node:       $NODE_BIN"
echo "╚══════════════════════════════════════════╝"

# ── Engine Service ──
sudo tee /etc/systemd/system/stokio-engine.service > /dev/null << EOF
[Unit]
Description=STOKIO FX Lighting Engine
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$STOKIO_USER
WorkingDirectory=$STOKIO_DIR
ExecStart=$NODE_BIN server/engine-server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
AmbientCapabilities=CAP_NET_BIND_SERVICE CAP_NET_BROADCAST CAP_NET_RAW

[Install]
WantedBy=multi-user.target
EOF

# ── Frontend Service ──
sudo tee /etc/systemd/system/stokio-frontend.service > /dev/null << EOF
[Unit]
Description=STOKIO FX Frontend (Vite)
After=stokio-engine.service
Requires=stokio-engine.service

[Service]
Type=simple
User=$STOKIO_USER
WorkingDirectory=$STOKIO_DIR
ExecStart=$NPM_BIN run dev -- --host 0.0.0.0
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# ── Aktivera & starta ──
sudo systemctl daemon-reload
sudo systemctl enable stokio-engine.service
sudo systemctl enable stokio-frontend.service
sudo systemctl start stokio-engine.service
sudo systemctl start stokio-frontend.service

echo ""
echo "✅ STOKIO FX tjänster installerade och startade!"
echo ""
echo "  sudo systemctl status stokio-engine"
echo "  sudo systemctl status stokio-frontend"
echo "  journalctl -u stokio-engine -f"
echo "  journalctl -u stokio-frontend -f"
echo ""
echo "Avinstallera:"
echo "  sudo systemctl disable stokio-engine stokio-frontend"
echo "  sudo rm /etc/systemd/system/stokio-{engine,frontend}.service"
echo "  sudo systemctl daemon-reload"
