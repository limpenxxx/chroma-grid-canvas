

## Analys

Tre separata problem identifierade:

1. **Engine startade inte** — du skrev `ode` istället för `node` (stavfel). Efter att du dödat processen på port 9100 kördes aldrig engine igen.

2. **Systemd-tjänster saknas** — du har aldrig kört `scripts/install-chroma-service.sh`, därför finns inte `chroma-engine.service`.

3. **`get-status`-meddelande hanteras inte** — IOSetup skickar `{ type: 'get-status' }` vid klick på Uppdatera, men engine-servern har ingen case för det i `handleMessage()`. NIC-listan skickas bara vid initial WebSocket-anslutning (som `engine-status`) eller via `hw-scan`. Det förklarar varför NIC-listan kan vara tom även när engine är igång.

4. **Potentiell portkonflikt** — `sync-server.cjs` använder också port 9100. Om den startas av misstag blockerar den engine-servern.

---

## Plan

### Steg 1 — Lägg till `get-status`-hantering i engine-servern

Lägger till en `case 'get-status'` i `handleMessage()` i `server/engine-server.cjs` som svarar med samma `engine-status`-meddelande (inklusive NIC-lista) som skickas vid anslutning. Detta gör att Uppdatera-knappen i I/O Setup alltid fungerar.

### Steg 2 — Graceful port-conflict i engine-servern

Lägger till en `wss.on('error')` handler som fångar `EADDRINUSE` och skriver ut ett tydligt felmeddelande med instruktioner (`sudo lsof -i :9100` och `kill`) istället för att krascha med en ohanterlig stack trace.

### Steg 3 — Uppdatera installationsskriptet med WatchdogSec

Lägger till `WatchdogSec=30` och `NotifyAccess=main` i engine-tjänstens systemd-unit (från den tidigare granskningens punkt 9).

### Steg 4 — Uppdatera INSTALL-UBUNTU.md

Förtydligar manuell start-sektion och lägger till en snabbstart-sektion högst upp med exakt kommandosekvens:
```
node server/engine-server.cjs &
npm run dev -- --host 0.0.0.0
```

---

## Tekniska detaljer

**Fil: `server/engine-server.cjs`**
- Ny `case 'get-status'` i `handleMessage()` (~rad 828) som återanvänder samma NIC-scan-logik som redan körs vid `wss.on('connection')`.
- Refaktorera NIC-scan till en separat funktion `scanNics()` som anropas från både connection-handler och `get-status`.
- Lägg till `wss.on('error', ...)` efter rad 702 för att fånga `EADDRINUSE`.

**Fil: `scripts/install-chroma-service.sh`**
- Lägg till `WatchdogSec=30` i `[Service]`-sektionen för chroma-engine.

