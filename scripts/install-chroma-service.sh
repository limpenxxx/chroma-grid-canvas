#!/bin/bash
set -e

# ── Chroma Grid Canvas — Ubuntu Autostart Installer ──
CHROMA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHROMA_USER="$(whoami)"
NODE_BIN="$(which node)"
NPM_BIN="$(which npm)"

echo "╔══════════════════════════════════════════╗"
echo "║  Chroma Grid Canvas — Autostart Installer         ║"
echo "╠══════════════════════════════════════════╣"
echo "║  Projekt:    $CHROMA_DIR"
echo "║  Användare:  $CHROMA_USER"
echo "║  Node:       $NODE_BIN"
echo "╚══════════════════════════════════════════╝"

# ── Engine Service ──
sudo tee /etc/systemd/system/chroma-engine.service > /dev/null << EOF
[Unit]
Description=Chroma Grid Canvas Lighting Engine
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
NotifyAccess=main
User=$CHROMA_USER
WorkingDirectory=$CHROMA_DIR
ExecStart=$NODE_BIN server/engine-server.cjs
Restart=always
RestartSec=5
WatchdogSec=30
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
AmbientCapabilities=CAP_NET_BIND_SERVICE CAP_NET_BROADCAST CAP_NET_RAW

[Install]
WantedBy=multi-user.target
EOF

# ── Frontend Service ──
sudo tee /etc/systemd/system/chroma-frontend.service > /dev/null << EOF
[Unit]
Description=Chroma Grid Canvas Frontend (Vite)
After=chroma-engine.service
Requires=chroma-engine.service

[Service]
Type=simple
User=$CHROMA_USER
WorkingDirectory=$CHROMA_DIR
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
sudo systemctl enable chroma-engine.service
sudo systemctl enable chroma-frontend.service
sudo systemctl start chroma-engine.service
sudo systemctl start chroma-frontend.service

echo ""
echo "✅ Chroma Grid Canvas tjänster installerade och startade!"
echo ""
echo "  sudo systemctl status chroma-engine"
echo "  sudo systemctl status chroma-frontend"
echo "  journalctl -u chroma-engine -f"
echo "  journalctl -u chroma-frontend -f"
echo ""
echo "Avinstallera:"
echo "  sudo systemctl disable chroma-engine chroma-frontend"
echo "  sudo rm /etc/systemd/system/chroma-{engine,frontend}.service"
echo "  sudo systemctl daemon-reload"
