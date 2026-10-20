// Local storage for the app: the preset library in IndexedDB, settings in localStorage.
// Everything stays on this device. Export/import moves the library between devices.

import { recipeGuitarId, type ToneRecipe } from '../tonelab/recipe';
import { DEFAULT_GUITAR, DEFAULT_GUITARS, DEFAULT_RIG, FIRST_GUITAR_ID, type GuitarProfile, type RigProfile } from '../ai/guitar';
import { DEFAULT_MODELS, type AiSettings } from '../ai/providers';

const DB_NAME = 'tonelab-se';
const DB_VERSION = 1;
const RECIPES = 'recipes';
const BACKUPS = 'backups';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RECIPES)) db.createObjectStore(RECIPES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(BACKUPS)) db.createObjectStore(BACKUPS, { keyPath: 'createdAt' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const library = {
  all: () => tx<ToneRecipe[]>(RECIPES, 'readonly', (s) => s.getAll() as IDBRequest<ToneRecipe[]>).then((r) => r.sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  put: (r: ToneRecipe) => tx(RECIPES, 'readwrite', (s) => s.put(r)),
  remove: (id: string) => tx(RECIPES, 'readwrite', (s) => s.delete(id)),
  /** Delete every saved tone, all guitars. */
  clear: () => tx(RECIPES, 'readwrite', (s) => s.clear()),
  /** Add the tones bundled with the app (tones/all-tones.json); same ids replace older copies. */
  async addStarterTones(): Promise<number> {
    const { default: text } = await import('../../tones/all-tones.json?raw');
    return library.importJson(text);
  },
  /** A saved tone for this song, made for this guitar. */
  async find(song: string | undefined, artist: string | undefined, part: string | undefined, guitarId: string): Promise<ToneRecipe | undefined> {
    const n = (x?: string) => (x ?? '').trim().toLowerCase();
    const all = await library.all();
    return all.find(
      (r) =>
        recipeGuitarId(r) === guitarId &&
        n(r.request.song) === n(song) &&
        n(r.request.artist) === n(artist) &&
        (n(part) === '' || n(r.request.part) === n(part)) &&
        (n(song) || n(artist)),
    );
  },
  async exportJson(): Promise<string> {
    return JSON.stringify({ kind: 'tonelab-se-library', version: 1, recipes: await library.all() }, null, 1);
  },
  async importJson(text: string): Promise<number> {
    const data = JSON.parse(text);
    if (data?.kind !== 'tonelab-se-library' || !Array.isArray(data.recipes)) throw new Error('Not a Tonelab library file.');
    for (const r of data.recipes) await library.put(r);
    return data.recipes.length;
  },
};

export const backups = {
  all: () => tx<{ createdAt: string; channel: number; sysexHex: string }[]>(BACKUPS, 'readonly', (s) => s.getAll() as IDBRequest<any[]>),
  put: (b: { createdAt: string; channel: number; sysexHex: string; kind: string }) => tx(BACKUPS, 'readwrite', (s) => s.put(b)),
};

// ----- settings -----

export interface AppSettings {
  ai: AiSettings;
  guitars: GuitarProfile[];
  /** The guitar being played now. */
  activeGuitarId: string;
  /** The Library shows every guitar's tones instead of the active guitar's bank. */
  libraryShowAll?: boolean;
  /** Load each Winamp or Spotify track's tone as it starts (Gig screen). */
  gigFollow?: boolean;
  /** Track key (see parseTrack) -> recipe id, for tracks the automatic match gets wrong. */
  trackLinks?: Record<string, string>;
  rig: RigProfile;
  midiChannel: number;
  lastPortName?: string;
  /** Language for talking instead of typing (MicButton). */
  voiceLang?: 'fr-CA' | 'en-CA';
}

const SETTINGS_KEY = 'tonelab-se-settings';

export function defaultSettings(): AppSettings {
  return {
    ai: { provider: 'anthropic', apiKey: '', ...DEFAULT_MODELS.anthropic, webSearch: false },
    guitars: DEFAULT_GUITARS.map((g) => ({ ...g })),
    activeGuitarId: FIRST_GUITAR_ID,
    rig: DEFAULT_RIG,
    midiChannel: 0,
  };
}

export function loadSettings(): AppSettings {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY));
  } catch {
    return defaultSettings();
  }
}

/** Stored JSON -> settings. Settings from before multiple guitars ({ guitar }) keep the edited guitar as the first one. */
export function parseSettings(raw: string | null): AppSettings {
  const d = defaultSettings();
  if (!raw) return d;
  const { guitar: legacy, ...s } = JSON.parse(raw);
  let guitars: GuitarProfile[] = Array.isArray(s.guitars) && s.guitars.length ? s.guitars : d.guitars;
  if (!Array.isArray(s.guitars) && legacy) {
    guitars = [{ ...DEFAULT_GUITAR, ...legacy, id: FIRST_GUITAR_ID, kind: 'split' }, ...d.guitars.filter((g) => g.id !== FIRST_GUITAR_ID)];
  }
  const activeGuitarId = guitars.some((g) => g.id === s.activeGuitarId) ? s.activeGuitarId : guitars[0].id;
  return { ...d, ...s, ai: { ...d.ai, ...s.ai }, guitars, activeGuitarId, rig: { ...d.rig, ...s.rig } };
}

export function saveSettings(s: AppSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Private mode or storage blocked: settings last for this session only.
  }
}

export function downloadText(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
