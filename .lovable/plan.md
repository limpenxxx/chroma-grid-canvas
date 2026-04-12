

## Analys

Systemet har tre samverkande prestandaproblem:

### 1. `backdrop-blur` på 290+ element (STÖRSTA problemet)
CSS-klassen `glass-panel` använder `backdrop-blur-xl` och appliceras på ~290 ställen i 16 filer. Varje element med `backdrop-blur` tvingar GPU:n att sampla och sudda alla pixlar bakom sig **varje frame**. Över animerade canvaser (VFX, Projection Mapping, Stage3D) multipliceras kostnaden dramatiskt.

### 2. 5+ simultana RAF-loopar i LiveDJ
LiveDJ.tsx kör minst 5 parallella `requestAnimationFrame`-loopar:
- VFX preview-canvas (rad 564)
- Pattern-animation (rad 717)
- Färgprogram (rad 765)
- EQ Trigger-motor (rad 3829)
- Arpeggiator-motor (rad 3917)

### 3. RAF-loopar rivs ner vid varje state-ändring
EQ Trigger-loopens dependency array inkluderar `widgets`, `bpmState.bpm`, `allFixturesWithDefs`, `wledStore.devices` etc. Varje ändring i dessa skapar en ny loop — exakt samma problem som fixades i ProjectionMapping.

---

## Plan

### Steg 1 — Ta bort `backdrop-blur` från glass-panel (störst effekt)
Ändra `src/index.css`:
- `glass-panel`: byt `backdrop-blur-xl` → ingen blur, öka opacitet till `bg-card/80`
- `glass-panel-strong`: byt `backdrop-blur-2xl` → ingen blur, `bg-card/90`

Behåller det mörka utseendet men utan GPU-kostnaden. Dialoger som redan använder `backdrop-blur-sm` på en overlay (modal) behålls — de visas bara tillfälligt.

### Steg 2 — Stabilisera EQ Trigger + Arpeggiator RAF-loopar med refs
Samma mönster som ProjectionMapping-fixen: läs `widgets`, `bpmState`, `allFixturesWithDefs` etc. via `useRef` istället för som useEffect-dependencies. Loopen skapas en gång och rivs aldrig ner.

### Steg 3 — Stabilisera VFX preview-loopen
VFX-canvasens RAF-loop (rad 564) beror på 8 dependencies. Flytta till ref-mönster.

---

## Tekniska detaljer

**Fil: `src/index.css`** — Ändra 2 CSS-klasser, ta bort `backdrop-blur-xl` och `backdrop-blur-2xl`.

**Fil: `src/components/modules/LiveDJ.tsx`** — Tre RAF useEffects stabiliseras med refs:
1. EQ Trigger engine (~rad 3579-3831): widgets, bpmState, fixtures → refs
2. Arpeggiator engine (~rad 3848-3919): widgets, bpmState → refs  
3. VFX preview canvas (~rad 540-568): fx, arConfig, bpm → refs

