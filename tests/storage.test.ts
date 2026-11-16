import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

/** localStorage minimal (les tests tournent sous Node). */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const OLD_KEY = 'nageo:data:v1';
const swimmer = { id: 's1', firstName: 'Emma', lastName: 'DUPONT', gender: 'F', birthYear: 2012, color: 0, relation: 'child' };

async function freshStore() {
  vi.resetModules();
  return import('../src/store/store');
}

async function readIdb(): Promise<{ swimmers: { firstName: string }[]; settings: { defaultCourse: string } } | undefined> {
  const { openDb, idbGet } = await import('../src/store/idb');
  const db = await openDb();
  return idbGet(db!, 'data');
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('stockage IndexedDB', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reprend les données de l’ancien stockage puis efface l’ancienne copie', async () => {
    localStorage.setItem(OLD_KEY, JSON.stringify({ version: 1, swimmers: [swimmer], meets: [], swims: [], goals: [], settings: {} }));
    const { initStore, getState } = await freshStore();
    await initStore();
    expect(getState().swimmers.map((s) => s.firstName)).toEqual(['Emma']);
    expect(localStorage.getItem(OLD_KEY)).toBeNull();
    expect((await readIdb())?.swimmers.map((s) => s.firstName)).toEqual(['Emma']);

    // Relance de l'application : les données viennent d'IndexedDB
    const again = await freshStore();
    expect(again.getState().swimmers).toHaveLength(0);
    await again.initStore();
    expect(again.getState().swimmers.map((s) => s.firstName)).toEqual(['Emma']);
  });

  it('enregistre chaque modification dans IndexedDB, plus dans localStorage', async () => {
    const { initStore, actions, getState } = await freshStore();
    await initStore();
    actions.updateSettings({ defaultCourse: 'LCM' });
    actions.updateSettings({ defaultCourse: 'SCM' });
    actions.updateSettings({ defaultCourse: 'LCM' });
    await settle();
    expect(getState().settings.defaultCourse).toBe('LCM');
    expect((await readIdb())?.settings.defaultCourse).toBe('LCM');
    expect(localStorage.getItem(OLD_KEY)).toBeNull();
  });

  it('garde localStorage quand IndexedDB est absent', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const { initStore, actions } = await freshStore();
    await initStore();
    actions.updateSettings({ defaultCourse: 'LCM' });
    expect(JSON.parse(localStorage.getItem(OLD_KEY)!).settings.defaultCourse).toBe('LCM');
  });

  it('démarre quand même si la base ne répond pas, puis la charge', async () => {
    const { openDb, idbPut } = await import('../src/store/idb');
    const db = await openDb();
    await idbPut(db!, 'data', { version: 1, swimmers: [swimmer], meets: [], swims: [], goals: [], settings: {} });
    db!.close();
    const real = indexedDB;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // Base qui tarde à s'ouvrir (comportement observé sur certains iPhone)
    vi.stubGlobal('indexedDB', {
      open: (...args: Parameters<IDBFactory['open']>) => {
        const req = real.open(...args);
        const proxy = {} as IDBOpenDBRequest;
        Object.defineProperty(proxy, 'result', { get: () => req.result });
        req.onsuccess = () => gate.then(() => proxy.onsuccess?.(new Event('success')));
        req.onupgradeneeded = (e) => proxy.onupgradeneeded?.(e);
        req.onerror = (e) => proxy.onerror?.(e);
        return proxy;
      },
    });
    const { initStore, getState } = await freshStore();
    await initStore(30);
    expect(getState().swimmers).toHaveLength(0);
    release();
    await settle();
    expect(getState().swimmers.map((s) => s.firstName)).toEqual(['Emma']);
  });
});
