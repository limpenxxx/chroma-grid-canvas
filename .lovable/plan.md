

## Problem

The "Select fixture type..." dropdown on the Patched Fixtures tab uses a native HTML `<select>` element. When there are many fixtures (100+), the dropdown extends beyond the screen and gets cut off — you can't scroll to fixtures past "Astera FP2". This is a browser limitation with native selects in constrained layouts.

## Plan

### Replace native `<select>` with a searchable combobox

**File: `src/components/modules/Devices.tsx`**

Replace the native `<select>` (lines 228-234) with a Popover + Command (combobox) pattern using the existing shadcn/ui components (`Popover`, `Command`, `CommandInput`, `CommandList`, `CommandItem`).

This gives:
- A **search field** to filter fixtures by name (no more scrolling through hundreds)
- A **scrollable list** with proper max-height that works within the panel
- Selecting an item closes the popover and sets the fixture ID

The combobox will show the selected fixture name on the trigger button, and typing filters the list instantly.

### Technical details

- Import `Popover`, `PopoverTrigger`, `PopoverContent` from `@/components/ui/popover`
- Import `Command`, `CommandInput`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandList` from `@/components/ui/command`
- Add an `open` state for the popover
- Filter `store.definitions.filter(d => d.category === 'dmx')` through the Command search
- On select: set `newInstDefId`, close popover

