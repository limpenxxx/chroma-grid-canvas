/**
 * STOKIO full project backup & restore
 * Exports/imports all persisted state from Zustand stores and localStorage.
 */

const BACKUP_VERSION = 1;
const BACKUP_MAGIC = 'stokio-project-backup';

// All localStorage keys used by the app
const PERSIST_KEYS = [
  'stokio-fixtures-v1',
  'stokio-media-v1',
  'stokio-dj-layouts',
];

export interface StokioBackup {
  _magic: typeof BACKUP_MAGIC;
  _version: number;
  _createdAt: string;
  _appVersion: string;
  stores: Record<string, unknown>;
}

/** Export full project state as JSON string */
export function exportFullBackup(): string {
  const stores: Record<string, unknown> = {};
  for (const key of PERSIST_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw) {
      try { stores[key] = JSON.parse(raw); } catch { stores[key] = raw; }
    }
  }
  const backup: StokioBackup = {
    _magic: BACKUP_MAGIC,
    _version: BACKUP_VERSION,
    _createdAt: new Date().toISOString(),
    _appVersion: 'v0.1',
    stores,
  };
  return JSON.stringify(backup, null, 2);
}

/** Import full project state, returns error message or null on success */
export function importFullBackup(json: string): string | null {
  try {
    const data = JSON.parse(json) as StokioBackup;
    if (data._magic !== BACKUP_MAGIC) return 'Not a valid STOKIO backup file.';
    if (!data.stores || typeof data.stores !== 'object') return 'Backup data is corrupted.';

    for (const [key, value] of Object.entries(data.stores)) {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
    return null; // success
  } catch {
    return 'Failed to parse backup file.';
  }
}

// ── Mapping-specific save/load ──

const MAPPING_MAGIC = 'stokio-mapping-preset';

export interface MappingPreset {
  _magic: typeof MAPPING_MAGIC;
  _version: number;
  _createdAt: string;
  name: string;
  nodes: unknown[];
  mappingFixtures: unknown[];
}

export function exportMappingPreset(name: string, nodes: unknown[], mappingFixtures: unknown[]): string {
  const preset: MappingPreset = {
    _magic: MAPPING_MAGIC,
    _version: 1,
    _createdAt: new Date().toISOString(),
    name,
    nodes,
    mappingFixtures,
  };
  return JSON.stringify(preset, null, 2);
}

export function parseMappingPreset(json: string): MappingPreset | string {
  try {
    const data = JSON.parse(json) as MappingPreset;
    if (data._magic !== MAPPING_MAGIC) return 'Not a valid mapping preset file.';
    if (!Array.isArray(data.nodes)) return 'Invalid preset data.';
    return data;
  } catch {
    return 'Failed to parse preset file.';
  }
}

// ── File helpers ──

export function downloadJson(content: string, filename: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function openJsonFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { reject(new Error('No file selected')); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    };
    input.click();
  });
}
