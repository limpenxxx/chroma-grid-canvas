/**
 * STOKIO full project backup & restore
 * Exports/imports all persisted state from Zustand stores and localStorage.
 */

const BACKUP_VERSION = 1;
const BACKUP_MAGIC = 'stokio-project-backup';
const DEFAULT_PROJECT_KEY = 'stokio-default-project';
const SAVED_PROJECTS_KEY = 'stokio-saved-projects';

// All localStorage keys used by the app
const PERSIST_KEYS = [
  'stokio-fixtures-v1',
  'stokio-media-v1',
  'stokio-dj-layouts',
  'stokio-dj-autosave-v1',
  'stokio-custom-color-presets',
  'stokio-dmx-mixer-v1',
  'stokio-app-v1',
  'sflc-node-logic-v2',
  'stokio-stage-v1',
  'stokio-wled-v1',
  'stokio-cues-v1',
  'stokio-effects-v1',
  'stokio-stage3d-v1',
];

export interface StokioBackup {
  _magic: typeof BACKUP_MAGIC;
  _version: number;
  _createdAt: string;
  _appVersion: string;
  stores: Record<string, unknown>;
}

export interface SavedProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  data: StokioBackup;
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

    // Clear existing state first
    for (const key of PERSIST_KEYS) {
      localStorage.removeItem(key);
    }

    for (const [key, value] of Object.entries(data.stores)) {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
    return null; // success
  } catch {
    return 'Failed to parse backup file.';
  }
}

/** Create a backup object from current state */
function createBackupObject(): StokioBackup {
  const stores: Record<string, unknown> = {};
  for (const key of PERSIST_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw) {
      try { stores[key] = JSON.parse(raw); } catch { stores[key] = raw; }
    }
  }
  return {
    _magic: BACKUP_MAGIC,
    _version: BACKUP_VERSION,
    _createdAt: new Date().toISOString(),
    _appVersion: 'v0.1',
    stores,
  };
}

/** Restore a backup object into localStorage */
function restoreBackupObject(data: StokioBackup) {
  for (const key of PERSIST_KEYS) {
    localStorage.removeItem(key);
  }
  for (const [key, value] of Object.entries(data.stores)) {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
}

// ── Saved Projects Management ──

export function getSavedProjects(): SavedProject[] {
  try {
    const raw = localStorage.getItem(SAVED_PROJECTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function persistSavedProjects(projects: SavedProject[]) {
  try {
    localStorage.setItem(SAVED_PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    console.warn('Could not save projects list: quota exceeded');
  }
}

/** Save current state as a named project */
export function saveProject(name: string): SavedProject {
  const projects = getSavedProjects();
  const now = new Date().toISOString();
  
  // Check if project with same name exists — overwrite it
  const existingIdx = projects.findIndex(p => p.name === name);
  const project: SavedProject = {
    id: existingIdx >= 0 ? projects[existingIdx].id : `proj-${Date.now()}`,
    name,
    createdAt: existingIdx >= 0 ? projects[existingIdx].createdAt : now,
    updatedAt: now,
    data: createBackupObject(),
  };

  if (existingIdx >= 0) {
    projects[existingIdx] = project;
  } else {
    projects.push(project);
  }
  persistSavedProjects(projects);
  return project;
}

/** Load a saved project (returns error or null) */
export function loadProject(id: string): string | null {
  const projects = getSavedProjects();
  const project = projects.find(p => p.id === id);
  if (!project) return 'Project not found.';
  restoreBackupObject(project.data);
  return null;
}

/** Delete a saved project */
export function deleteProject(id: string) {
  const projects = getSavedProjects().filter(p => p.id !== id);
  persistSavedProjects(projects);
}

/** Save current state as the default project (loaded on startup) */
export function saveAsDefault() {
  const backup = createBackupObject();
  try {
    localStorage.setItem(DEFAULT_PROJECT_KEY, JSON.stringify(backup));
  } catch {
    console.warn('Could not save default project: quota exceeded');
  }
}

/** Load the default project if one exists (returns true if loaded) */
export function loadDefaultProject(): boolean {
  try {
    const raw = localStorage.getItem(DEFAULT_PROJECT_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw) as StokioBackup;
    if (data._magic !== BACKUP_MAGIC) return false;
    restoreBackupObject(data);
    return true;
  } catch { return false; }
}

/** Check if a default project is saved */
export function hasDefaultProject(): boolean {
  return localStorage.getItem(DEFAULT_PROJECT_KEY) !== null;
}

/** Clear all project state (new project) */
export function clearAllState() {
  for (const key of PERSIST_KEYS) {
    localStorage.removeItem(key);
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

export async function downloadJson(content: string, filename: string) {
  const blob = new Blob([content], { type: 'application/json' });

  // Try modern File System Access API first (works in sandboxed contexts)
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e: any) {
      if (e?.name === 'AbortError') return; // user cancelled
    }
  }

  // Fallback: open blob in new tab so user can save manually
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
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
