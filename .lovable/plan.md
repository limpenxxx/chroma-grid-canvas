

# WLED Fixtures in Patched Fixtures + Icon System

## Overview
Show WLED fixtures alongside DMX fixtures in the "Patched Fixtures" tab, with color-coded backgrounds (light green for DMX, light blue for WLED). Add a selectable icon system for all fixture types.

## Changes

### 1. Add icon field to both fixture types

**`src/store/fixtureStore.ts`**
- Add `icon` field to `FixtureInstance` (optional string, e.g. `'moving-head'`, `'led-strip'`, `'led-matrix'`, `'rgb-par'`, `'pin-spot'`, `'smoke'`, `'laser'`, `'multi-beam'`)
- Update `getFixtureTypeIcon` to return Lucide-compatible icon names or emoji based on the new icon set

**`src/store/wledStore.ts`**
- Add `icon` field to `WledFixture` (same icon set)

### 2. Define icon options

Create a shared icon map with these fixture icon choices:
- Moving Head, LED Strip, LED Matrix, RGB PAR, Pin-spot, Smoke Machine, Laser Beamer, Multi Beam RGB
- Each maps to an emoji/symbol for rendering in lists and canvas

### 3. Update Patched Fixtures tab in `src/components/modules/Devices.tsx`

- Import `useWledStore` and its fixtures
- In the "instances" tab, render **both** DMX fixtures and WLED fixtures in a combined list
- DMX fixtures: `bg-green-500/10 border-green-500/20` background
- WLED fixtures: `bg-blue-400/10 border-blue-400/20` background
- WLED fixture rows show: icon, name, device name, IP, segment info, LED range, online status dot
- WLED fixtures are expandable like DMX ones, showing segment/LED details and remove button
- Add an icon selector dropdown in both DMX instance expanded view and WLED fixture expanded view

### 4. Icon selector component

- Inline dropdown/popover in expanded fixture view
- Shows all available icons as a grid of clickable options
- Updates the `icon` field on the fixture instance or WLED fixture

### 5. Persist icon in both stores

Both stores already use `persist` middleware, so the new field persists automatically.

## Technical details

- Icon choices: `['moving-head', 'led-strip', 'led-matrix', 'rgb-par', 'pin-spot', 'smoke', 'laser', 'multi-beam']`
- Icon display map using emoji: `{ 'moving-head': '◎', 'led-strip': '▬', 'led-matrix': '⊞', 'rgb-par': '●', 'pin-spot': '◈', 'smoke': '☁', 'laser': '⟐', 'multi-beam': '✦' }`
- Files modified: `src/store/fixtureStore.ts`, `src/store/wledStore.ts`, `src/components/modules/Devices.tsx`

