# Chroma Grid Canvas — Setup Guide

Complete setup instructions for running Chroma Grid Canvas on your local machine.  
The system has two parts:

1. **Frontend (React GUI)** — The browser-based remote control  
2. **Engine Server (Node.js)** — The persistent lighting engine that talks to hardware

---

## Prerequisites (All Platforms)

| Requirement | Version | Purpose |
|---|---|---|
| **Node.js** | v18+ (LTS recommended) | Runs both the frontend dev server and the engine |
| **npm** or **bun** | Comes with Node.js / install separately | Package manager |
| **Git** | Any recent version | Clone the repository |
| **Network** | Same LAN as your lighting gear | WLED, Hue, ArtNet, sACN, Pioneer DJ |

---

## Windows Setup

### 1. Install Node.js

Download and install from https://nodejs.org (LTS version).

Or use winget:
```powershell
winget install OpenJS.NodeJS.LTS
```

### 2. Install Git

```powershell
winget install Git.Git
```

### 3. Clone & Install

```powershell
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

npm install
```

### 4. Start the Engine Server

Open a **separate terminal**:
```powershell
node server/engine-server.cjs
```

You should see the Chroma Grid Canvas banner with your local IP addresses.

### 5. Start the Frontend

```powershell
npm run dev
```

Open `http://localhost:5173` in Chrome (recommended for System Audio capture).

### 6. Firewall Rules (Important!)

Windows Firewall may block UDP traffic. Allow these ports:

```powershell
# Run as Administrator
netsh advfirewall firewall add rule name="Chroma ArtNet" dir=in action=allow protocol=UDP localport=6454
netsh advfirewall firewall add rule name="Chroma sACN" dir=in action=allow protocol=UDP localport=5568
netsh advfirewall firewall add rule name="Chroma Engine WS" dir=in action=allow protocol=TCP localport=9100
netsh advfirewall firewall add rule name="Chroma Pioneer Keep" dir=in action=allow protocol=UDP localport=50000
netsh advfirewall firewall add rule name="Chroma Pioneer Beat" dir=in action=allow protocol=UDP localport=50001
```

### 7. Optional: USB-DMX (WebSerial)

WebSerial works out of the box in Chrome on Windows. Plug in your USB-DMX adapter (e.g. Enttec Open DMX) and select it from the Devices panel.

### 8. Optional: Run Engine as a Windows Service

Install `pm2` to keep the engine running:
```powershell
npm install -g pm2
pm2 start server/engine-server.cjs --name chroma-engine
pm2 save
pm2 startup
```

---

## macOS Setup

### 1. Install Homebrew (if not installed)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. Install Node.js & Git

```bash
brew install node git
```

### 3. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

npm install
```

### 4. Start the Engine Server

Open a **separate terminal**:
```bash
node server/engine-server.cjs
```

### 5. Start the Frontend

```bash
npm run dev
```

Open `http://localhost:5173` in Chrome.

### 6. Firewall

macOS may prompt you to allow incoming connections for Node.js — click **Allow**.

If you need to manually allow ports:
```bash
# Check if firewall is enabled
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

# Add Node.js to allowed apps
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add $(which node)
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp $(which node)
```

### 7. Optional: Run Engine as a Background Service

```bash
npm install -g pm2
pm2 start server/engine-server.cjs --name chroma-engine
pm2 save
pm2 startup
```

### 8. Optional: USB-DMX

WebSerial is supported in Chrome on macOS. You may need to install drivers for some USB-DMX adapters (e.g. FTDI drivers for Enttec).

---

## Linux Setup

### 1. Install Node.js

**Ubuntu / Debian:**
```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

**Arch Linux:**
```bash
sudo pacman -S nodejs npm git
```

**Fedora:**
```bash
sudo dnf install nodejs npm git
```

### 2. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

npm install
```

### 3. Start the Engine Server

```bash
node server/engine-server.cjs
```

### 4. Start the Frontend

```bash
npm run dev
```

Open `http://localhost:5173` in Chrome/Chromium.

### 5. Network Permissions

The engine needs to bind to UDP ports and send broadcast/multicast packets:

```bash
# Allow Node.js to bind to privileged ports (if needed) and send broadcasts
sudo setcap 'cap_net_bind_service,cap_net_broadcast,cap_net_raw+ep' $(which node)
```

If running behind `ufw`:
```bash
sudo ufw allow 9100/tcp    # Engine WebSocket
sudo ufw allow 6454/udp    # ArtNet
sudo ufw allow 5568/udp    # sACN
sudo ufw allow 50000/udp   # Pioneer DJ keepalive
sudo ufw allow 50001/udp   # Pioneer DJ beat sync
sudo ufw allow 5353/udp    # mDNS (Hue discovery)
```

### 6. Optional: USB-DMX Serial Permissions

Add your user to the `dialout` group for serial port access:
```bash
sudo usermod -aG dialout $USER
# Log out and back in for this to take effect
```

### 7. Optional: Run as a systemd Service

Create `/etc/systemd/system/chroma-engine.service`:
```ini
[Unit]
Description=Chroma Grid Canvas Lighting Engine
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/path/to/YOUR_REPO
ExecStart=/usr/bin/node server/engine-server.cjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable chroma-engine
sudo systemctl start chroma-engine

# Check status
sudo systemctl status chroma-engine
journalctl -u chroma-engine -f
```

### 8. Headless / Raspberry Pi

Chroma Grid Canvas engine runs great on a Raspberry Pi as a dedicated lighting controller:
```bash
# On Raspberry Pi OS (Debian-based)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs git
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO && npm install
# Set up systemd service as above, then access the GUI from another device
```

---

## Network Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser (Chrome)     http://IP:5173            │
│  ├── React GUI (remote control)                 │
│  └── WebSocket ──► ws://IP:9100                 │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  Engine Server        node server/engine-server.cjs │
│  ├── ArtNet OUT      ──► UDP :6454 broadcast    │
│  ├── sACN OUT        ──► UDP :5568 multicast    │
│  ├── WLED            ──► HTTP JSON API          │
│  ├── Philips Hue     ──► HTTP REST API          │
│  ├── MagicHome       ──► HTTP proxy             │
│  ├── Pioneer DJ IN   ◄── UDP :50000, :50001     │
│  └── State file      ──► .engine-state.json     │
└─────────────────────────────────────────────────┘
```

## Ports Reference

| Port | Protocol | Direction | Purpose |
|------|----------|-----------|---------|
| 5173 | TCP | — | Vite dev server (frontend) |
| 9100 | TCP | IN/OUT | Engine WebSocket |
| 6454 | UDP | OUT | ArtNet DMX |
| 5568 | UDP | OUT | sACN / E1.31 |
| 50000 | UDP | IN | Pioneer DJ keepalive |
| 50001 | UDP | IN | Pioneer DJ beat sync |
| 11988 | UDP | IN | WLED Sound Sync |
| 80 | TCP | OUT | WLED JSON API, Hue API |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Engine not starting | Check Node.js version: `node -v` (need v18+) |
| Can't see WLED devices | Ensure same subnet, check firewall |
| ArtNet not received | Check UDP 6454 firewall rule, verify broadcast |
| Pioneer DJ not detected | Must be same Ethernet network (not WiFi), check ports 50000-50001 |
| WebSerial not available | Use Chrome (not Firefox/Safari), check serial permissions on Linux |
| "Address already in use" | Another process is using the port — `lsof -i :9100` or `netstat -tlnp | grep 9100` |
| High CPU usage | Reduce WLED polling frequency, check for excessive DMX universes |
