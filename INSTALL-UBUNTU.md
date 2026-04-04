# Chroma Grid Canvas — Ubuntu Installationsguide

> Komplett guide för att installera Chroma Grid Canvas som en **dedikerad ljusstyrningsenhet** på Ubuntu.  
> Systemet startar automatiskt vid ström, återhämtar sig från strömavbrott och kräver inget GUI.

---

## Innehåll

1. [Krav](#krav)
2. [Installation](#installation)
3. [Konfigurera nätverk](#konfigurera-nätverk)
4. [Brandvägg](#brandvägg)
5. [Installera som systemtjänst](#installera-som-systemtjänst)
6. [Autostart vid strömbortfall](#autostart-vid-strömbortfall)
7. [USB-DMX (seriell)](#usb-dmx-seriell)
8. [Underhåll & felsökning](#underhåll--felsökning)
9. [Avinstallation](#avinstallation)

---

## Krav

| Krav | Minimum | Rekommenderat |
|------|---------|---------------|
| **OS** | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| **Node.js** | v18 | v20 LTS |
| **CPU** | Intel i5 / Ryzen 5 | Intel i7 / Ryzen 7 (för stora LED-grids) |
| **RAM** | 8 GB | 16 GB |
| **Lagring** | SSD (20 GB ledigt) | SSD |
| **Nätverk** | 1× Gigabit Ethernet | 2× Gigabit Ethernet (separat ljus- och DJ-nätverk) |

---

## Installation

### 1. Installera Node.js (LTS)

> **Viktigt:** Använd **inte** `sudo apt install npm` — det ger en föråldrad version.  
> NodeSource-paketet inkluderar både `node` och `npm`.

```bash
# Ta bort eventuell gammal systemversion
sudo apt-get remove -y nodejs npm 2>/dev/null

# Installera Node.js 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential
```

Verifiera att **båda** finns:
```bash
node -v   # Ska visa v20.x
npm -v    # Ska visa v10.x
```

Om `npm` fortfarande saknas:
```bash
sudo apt-get install -y npm
# Eller installera via corepack:
sudo corepack enable
```

### 2. Klona projektet

```bash
cd /opt
sudo git clone https://github.com/YOUR_USERNAME/chroma-grid-canvas.git
sudo chown -R $USER:$USER /opt/chroma-grid-canvas
cd /opt/chroma-grid-canvas
```

> **Tips:** Använd `/opt/chroma-grid-canvas` som standardsökväg — installationsskriptet anpassar sig automatiskt.

### 3. Installera beroenden

```bash
npm install
```

### 4. Testa manuellt

Starta motorn i en terminal:
```bash
node server/engine-server.js
```

Starta frontend i en annan:
```bash
npm run dev -- --host 0.0.0.0
```

Öppna `http://<IP>:5173` i Chrome på valfri enhet i samma nätverk.

---

## Konfigurera nätverk

### Enkel konfiguration (ett nätverkskort)

Ingen extra konfiguration behövs — anslut till samma LAN som dina WLED/Hue/ArtNet-enheter.

### Avancerad konfiguration (dubbla nätverkskort)

Isolera ljusprotokolltrafik (WLED, ArtNet, sACN) från DJ-länktrafik (Pioneer ProDJ Link):

Skapa `/etc/netplan/01-chroma.yaml`:
```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    # Ljusnätverk — WLED, ArtNet, sACN
    enp1s0:
      addresses:
        - 10.0.0.10/24
      routes:
        - to: default
          via: 10.0.0.1
      nameservers:
        addresses: [8.8.8.8, 1.1.1.1]

    # DJ-nätverk — Pioneer ProDJ Link
    enp2s0:
      addresses:
        - 169.254.1.10/16
      dhcp4: false
```

Tillämpa:
```bash
sudo netplan apply
```

> **OBS:** Pioneer ProDJ Link använder link-local (169.254.x.x). Byt ut `enp1s0`/`enp2s0` mot dina faktiska gränssnittsnamn (`ip link show`).

---

## Brandvägg

```bash
# Engine WebSocket
sudo ufw allow 9100/tcp comment 'Chroma Engine WS'

# Ljusprotokoll
sudo ufw allow 6454/udp comment 'ArtNet DMX'
sudo ufw allow 5568/udp comment 'sACN / E1.31'

# Pioneer DJ
sudo ufw allow 50000/udp comment 'Pioneer DJ keepalive'
sudo ufw allow 50001/udp comment 'Pioneer DJ beat sync'

# WLED Sound Sync
sudo ufw allow 11988/udp comment 'WLED Sound Sync'

# mDNS (Hue-upptäckt)
sudo ufw allow 5353/udp comment 'mDNS'

# Frontend (dev-server)
sudo ufw allow 5173/tcp comment 'Chroma Frontend'

# Aktivera brandvägg
sudo ufw enable
sudo ufw status verbose
```

### Nätverksrättigheter för Node.js

Låt Node.js skicka broadcast/multicast utan root:
```bash
sudo setcap 'cap_net_bind_service,cap_net_broadcast,cap_net_raw+ep' $(which node)
```

---

## Installera som systemtjänst

### Automatiskt (rekommenderat)

Kör det medföljande installationsskriptet:

```bash
chmod +x scripts/install-chroma-service.sh
./scripts/install-chroma-service.sh
```

Detta skapar och aktiverar två systemd-tjänster:
- **chroma-engine** — Ljusmotorn (port 9100)
- **chroma-frontend** — Vite dev-server (port 5173)

### Manuellt

<details>
<summary>Klicka för manuell konfiguration</summary>

Skapa `/etc/systemd/system/chroma-engine.service`:
```ini
[Unit]
Description=Chroma Grid Canvas Lighting Engine
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=chroma
WorkingDirectory=/opt/chroma-grid-canvas
ExecStart=/usr/bin/node server/engine-server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
AmbientCapabilities=CAP_NET_BIND_SERVICE CAP_NET_BROADCAST CAP_NET_RAW

[Install]
WantedBy=multi-user.target
```

Skapa `/etc/systemd/system/chroma-frontend.service`:
```ini
[Unit]
Description=Chroma Grid Canvas Frontend (Vite)
After=chroma-engine.service
Requires=chroma-engine.service

[Service]
Type=simple
User=chroma
WorkingDirectory=/opt/chroma-grid-canvas
ExecStart=/usr/bin/npm run dev -- --host 0.0.0.0
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Aktivera:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now chroma-engine chroma-frontend
```

</details>

---

## Autostart vid strömbortfall

Tre steg krävs för att systemet ska starta helt automatiskt efter ett strömavbrott:

### Steg 1: BIOS — Slå på automatiskt vid ström

Gå in i BIOS/UEFI (tryck `DEL` eller `F2` vid uppstart):

| Inställning | Värde |
|-------------|-------|
| **AC Power Recovery** / **After Power Loss** | `Power On` / `Last State` |
| **Wake on LAN** (valfritt) | `Enabled` |

> Exakt namn varierar per BIOS-tillverkare. Sök under *Power Management* eller *Advanced*.

### Steg 2: Ubuntu — Automatisk inloggning (valfritt, headless)

Om maskinen kör utan skärm, aktivera autoinloggning för att säkerställa att alla användar-tjänster startar:

```bash
# Skapa en dedikerad användare (om du inte redan har en)
sudo adduser --system --group --shell /bin/bash chroma
sudo usermod -aG dialout chroma  # USB-DMX åtkomst

# Ge ägandeskap till projektet
sudo chown -R chroma:chroma /opt/chroma-grid-canvas
```

> **Notera:** systemd-tjänster med `User=chroma` startar automatiskt — ingen GUI-inloggning behövs.

### Steg 3: Verifiera att tjänsterna är aktiverade

```bash
sudo systemctl is-enabled chroma-engine    # Ska visa "enabled"
sudo systemctl is-enabled chroma-frontend  # Ska visa "enabled"
```

### Testa strömbortfall

```bash
# Simulera omstart
sudo reboot

# Vänta tills maskinen startar, kontrollera sedan:
sudo systemctl status chroma-engine
sudo systemctl status chroma-frontend

# Se loggar i realtid
journalctl -u chroma-engine -f
journalctl -u chroma-frontend -f
```

### Watchdog (extra säkerhet)

Lägg till en hardware watchdog som startar om maskinen om systemet fryser:

```bash
# Installera watchdog-daemon
sudo apt-get install -y watchdog

# Konfigurera
sudo tee /etc/watchdog.conf > /dev/null << 'EOF'
watchdog-device = /dev/watchdog
max-load-1 = 24
watchdog-timeout = 30
EOF

sudo systemctl enable --now watchdog
```

---

## USB-DMX (seriell)

Lägg till din användare i `dialout`-gruppen för seriell åtkomst:

```bash
sudo usermod -aG dialout $USER
# Logga ut och in igen

# Verifiera
groups  # Ska visa "dialout"
ls -la /dev/ttyUSB*  # Ska visa din adapter
```

Om du kör som systemtjänst med `chroma`-användaren:
```bash
sudo usermod -aG dialout chroma
sudo systemctl restart chroma-engine
```

---

## Underhåll & felsökning

### Vanliga kommandon

```bash
# Status
sudo systemctl status chroma-engine
sudo systemctl status chroma-frontend

# Starta om
sudo systemctl restart chroma-engine
sudo systemctl restart chroma-frontend

# Loggar (senaste 100 rader)
journalctl -u chroma-engine -n 100
journalctl -u chroma-frontend -n 100

# Realtidsloggar
journalctl -u chroma-engine -f
```

### Uppdatera Chroma Grid Canvas

```bash
cd /opt/chroma-grid-canvas
git pull
npm install
sudo systemctl restart chroma-engine chroma-frontend
```

### Felsökning

| Problem | Lösning |
|---------|---------|
| Engine startar inte | `node -v` — behöver v18+. Kolla `journalctl -u chroma-engine -n 50` |
| "Address already in use" | `lsof -i :9100` — döda processen eller vänta |
| Ser inte WLED-enheter | Kontrollera att enheter är på samma subnät, kolla brandvägg |
| ArtNet tas inte emot | Kontrollera UDP 6454 i brandvägg, verifiera broadcast |
| Pioneer DJ ej detekterad | Måste vara samma Ethernet-nätverk (inte WiFi), kolla port 50000–50001 |
| Hög CPU-belastning | Minska WLED-polling, begränsa antal DMX-universum |
| USB-DMX syns inte | Kolla `dmesg | tail`, verifiera `dialout`-gruppmedlemskap |

### Portöversikt

| Port | Protokoll | Riktning | Syfte |
|------|-----------|----------|-------|
| 5173 | TCP | — | Vite dev-server (frontend) |
| 9100 | TCP | IN/OUT | Engine WebSocket |
| 6454 | UDP | OUT | ArtNet DMX |
| 5568 | UDP | OUT | sACN / E1.31 |
| 50000 | UDP | IN | Pioneer DJ keepalive |
| 50001 | UDP | IN | Pioneer DJ beat sync |
| 11988 | UDP | IN | WLED Sound Sync |

---

## Avinstallation

```bash
# Stoppa och ta bort tjänster
sudo systemctl stop chroma-engine chroma-frontend
sudo systemctl disable chroma-engine chroma-frontend
sudo rm /etc/systemd/system/chroma-{engine,frontend}.service
sudo systemctl daemon-reload

# Ta bort projektet (valfritt)
sudo rm -rf /opt/chroma-grid-canvas

# Ta bort användaren (valfritt)
sudo deluser --remove-home chroma
```
