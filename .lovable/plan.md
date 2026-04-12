

## Problem

Fixture Library-fliken i Devices visar **alla** fixturdefinitioner utan paginering. Med OFL-importerade fixturer som har 15-68 modes vardera (t.ex. Astera FP2 med 68 modes × ~10 badges) skapas tusentals DOM-noder som gör listan trög och kan se ut som att den "stannar".

"Show more"-knappen lades till i **Online Fixture Browser** (FileExplorer.tsx), men aldrig i **Fixture Library**-fliken (Devices.tsx).

## Plan

### Steg 1 — Lägg till paginering i Fixture Library-fliken

**Fil: `src/components/modules/Devices.tsx`**

- Lägg till `DEF_PAGE_SIZE = 30` och en `visibleDefCount` state.
- Byt `filteredDefs.map(...)` till `filteredDefs.slice(0, visibleDefCount).map(...)`.
- Lägg till en "Show more (N remaining)"-knapp efter listan.
- Nollställ `visibleDefCount` vid sökning (search-ändring).

### Steg 2 — Begränsa mode-badges per fixtur

Varje fixtur visar **alla** modes som badges. En Astera FP2 med 68 modes renderar 68 badges.

- Visa max 12 mode-badges per fixtur.
- Om det finns fler, visa en `+N more` badge.

Dessa två ändringar löser både "ser ej Show more" och att listan fryser vid många fixturer.

