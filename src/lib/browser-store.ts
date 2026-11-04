import { openDB } from 'idb';
import { z } from 'zod';
import { CampaignStore, GUEST, type DataStore, type StoreHooks } from './store';
import type { Session, World } from './types';

const SESSION_KEY = 'okoyom.session';
const WORLD_KEY = 'okoyom.world';
const DB_NAME = 'okoyom';

const SessionSchema = z.object({
  role: z.enum(['guest', 'player', 'gm']),
  heroId: z.string().nullable(),
  preview: z.boolean(),
});

function readSession(): Session {
  if (typeof localStorage === 'undefined') return GUEST;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return GUEST;
    return SessionSchema.parse(JSON.parse(raw));
  } catch {
    return GUEST;
  }
}

function writeSession(session: Session): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

async function idbHooks(): Promise<Pick<StoreHooks, 'loadWorld' | 'saveWorld'>> {
  const db = await openDB(DB_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('kv')) database.createObjectStore('kv');
    },
  });
  return {
    loadWorld: async () => {
      const saved = (await db.get('kv', 'world')) as World | undefined;
      return saved ?? null;
    },
    saveWorld: async (world) => {
      await db.put('kv', world, 'world');
    },
  };
}

function localStorageWorldHooks(): Pick<StoreHooks, 'loadWorld' | 'saveWorld'> {
  return {
    loadWorld: async () => {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(WORLD_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as World;
    },
    saveWorld: async (world) => {
      localStorage.setItem(WORLD_KEY, JSON.stringify(world));
    },
  };
}

function browserHooks(): StoreHooks {
  let worldApi = localStorageWorldHooks();
  const hooks: StoreHooks = {
    loadWorld: () => worldApi.loadWorld(),
    saveWorld: (world) => worldApi.saveWorld(world),
    loadSession: readSession,
    saveSession: writeSession,
    now: () => new Date().toISOString(),
    id: () => crypto.randomUUID(),
  };
  if (typeof indexedDB !== 'undefined') {
    const ready = idbHooks()
      .then((api) => {
        worldApi = api;
      })
      .catch(() => {
        worldApi = localStorageWorldHooks();
      });
    const loadWorld = hooks.loadWorld;
    hooks.loadWorld = async () => {
      await ready;
      return loadWorld();
    };
    const saveWorld = hooks.saveWorld;
    hooks.saveWorld = async (world) => {
      await ready;
      return saveWorld(world);
    };
  }
  return hooks;
}

const globalStore = globalThis as { __okoyom?: DataStore };

export function getStore(): DataStore {
  if (!globalStore.__okoyom) globalStore.__okoyom = new CampaignStore(browserHooks());
  return globalStore.__okoyom;
}

export function openSwitcher(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('okoyom-switcher'));
}
