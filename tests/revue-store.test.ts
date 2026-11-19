import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { parseSwimrankings } from '../src/lib/swimrankings';
import type { ImportReport } from '../src/store/store';

/*
 * Défauts relevés par la revue (groupe « store ») : doublons à l'import des résultats,
 * enregistrement dans IndexedDB, historique en colonnes. Noms et temps fictifs.
 */

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
const settle = () => new Promise((r) => setTimeout(r, 20));

async function freshStore() {
  vi.resetModules();
  return import('../src/store/store');
}

async function readIdb(): Promise<{ swimmers: { firstName: string }[]; goals: unknown[]; settings: { defaultCourse: string; celebrate: boolean } } | undefined> {
  const { openDb, idbGet } = await import('../src/store/idb');
  const db = await openDb();
  return idbGet(db!, 'data');
}

const MEET: ImportReport['meet'] = { name: 'Meeting fictif de printemps', course: 'SCM', startDate: '2026-03-14', endDate: '2026-03-15', liveId: '999' };

describe('import des résultats : doublons', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('indexedDB', undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function withSwimmer() {
    const store = await freshStore();
    const sw = store.actions.addSwimmer({ firstName: 'Lina', lastName: 'Fictive', gender: 'F', birthYear: 2014, relation: 'followed' });
    const mine = () => store.getState().swims.filter((s) => s.swimmerId === sw.id);
    const add = (swims: ImportReport['swims']) => store.actions.importClubResults(sw.id, [{ meet: MEET, source: 'live', swims }]);
    return { mine, add };
  }

  it('import-3 : séries et finale nagées dans le même temps restent deux courses', async () => {
    const { mine, add } = await withSwimmer();
    const r = add([
      { eventNo: 12, distance: 50, stroke: 'BACK', course: 'SCM', round: 'HEAT', timeCs: 3845, status: 'OK', place: 2, date: '2026-03-14' },
      { eventNo: 52, distance: 50, stroke: 'BACK', course: 'SCM', round: 'FINAL', timeCs: 3845, status: 'OK', place: 1, date: '2026-03-14' },
    ]);
    expect(r.added).toBe(2);
    expect(mine().map((s) => `${s.round}:${s.place}:${s.eventNo}`).sort()).toEqual(['FINAL:1:52', 'HEAT:2:12']);
  });

  it('import-6 : la liste de départ de la finale, après le résultat des séries, va au programme', async () => {
    const { mine, add } = await withSwimmer();
    add([{ eventNo: 13, distance: 100, stroke: 'FREE', course: 'SCM', round: 'HEAT', timeCs: 7512, status: 'OK', place: 5, date: '2026-03-14' }]);
    const r = add([{ eventNo: 53, distance: 100, stroke: 'FREE', course: 'SCM', round: 'FINAL', status: 'OK', heat: 1, lane: 4, startTime: '16:30', date: '2026-03-14' }]);
    expect(r.added).toBe(1);
    expect(mine().find((s) => s.eventNo === 53)).toMatchObject({ timeCs: null, lane: 4, heat: 1, startTime: '16:30' });
    // La liste de départ des séries relue ensuite ne revient pas en programme fantôme
    const again = add([{ eventNo: 13, distance: 100, stroke: 'FREE', course: 'SCM', round: 'HEAT', status: 'OK', heat: 3, lane: 2, date: '2026-03-14' }]);
    expect(again.added).toBe(0);
    expect(mine()).toHaveLength(2);
  });

  it('store-7 : dans un même fichier, la finale encore à nager n’est pas prise pour la série nagée', async () => {
    const { mine, add } = await withSwimmer();
    const r = add([
      { eventNo: 1, distance: 50, stroke: 'FREE', course: 'SCM', round: 'HEAT', timeCs: 3310, status: 'OK', place: 3, date: '2026-03-14' },
      { eventNo: 21, distance: 50, stroke: 'FREE', course: 'SCM', round: 'FINAL', status: 'OK', heat: 1, lane: 5, startTime: '17:05', date: '2026-03-14' },
    ]);
    expect(r.added).toBe(2);
    expect(mine().find((s) => s.eventNo === 21)).toMatchObject({ timeCs: null, lane: 5 });
  });

  it('import-9 : disqualification sans temps (feuille PDF) puis avec temps (LENEX) : une seule course, complétée', async () => {
    const { mine, add } = await withSwimmer();
    add([{ eventNo: 7, distance: 50, stroke: 'FLY', course: 'SCM', round: 'TIM', status: 'DSQ', date: '2026-03-15' }]);
    const r = add([{ eventNo: 7, distance: 50, stroke: 'FLY', course: 'SCM', round: 'TIM', timeCs: 4210, status: 'DSQ', date: '2026-03-15' }]);
    expect(r.added).toBe(0);
    expect(mine().map((s) => `${s.status}:${s.timeCs}`)).toEqual(['DSQ:4210']);
  });
});

describe('historique en colonnes (swimrankings)', () => {
  it('import-5 : deux courses au même temps le même jour gardent chacune leur compétition', () => {
    const text = [
      '@@GENDER:F',
      'FICTIVE, Lina (2014)',
      'BEL - Club Exemple Natation',
      ['50m Libre', '25m', '38.45', '300', '11 oct 2025', 'Ville A', 'Meeting A', 'Club Exemple Natation', '3', 'Séries', ''].join('\t'),
      ['50m Libre', '50m', '38.45', '280', '11 oct 2025', 'Ville B', 'Meeting B', 'Club Exemple Natation', '7', 'Finale', ''].join('\t'),
    ].join('\n');
    const r = parseSwimrankings(text);
    expect(r.swims).toHaveLength(2);
    expect(r.swims.find((s) => s.course === 'SCM')).toMatchObject({ meet: 'Meeting A', city: 'Ville A', place: 3, round: 'HEAT' });
    expect(r.swims.find((s) => s.course === 'LCM')).toMatchObject({ meet: 'Meeting B', city: 'Ville B', place: 7, round: 'FINAL' });
  });
});

describe('enregistrement dans IndexedDB', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('store-1 : base lente, modification pendant l’attente : les données de la base ne sont pas écrasées', async () => {
    const { openDb, idbPut } = await import('../src/store/idb');
    const db = await openDb();
    const child = { id: 'c1', firstName: 'Lina', lastName: 'Fictive', gender: 'F', birthYear: 2014, color: 0, relation: 'child', favorite: true, createdAt: 1 };
    const goal = { id: 'g1', swimmerId: 'c1', distance: 50, stroke: 'FREE', course: 'SCM', targetCs: 3500, createdAt: 1 };
    await idbPut(db!, 'data', { version: 1, swimmers: [child], meets: [], swims: [], goals: [goal], settings: { onboarded: true } });
    db!.close();
    const real = indexedDB;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // Base qui tarde à s'ouvrir (certains iPhone)
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
    const { initStore, actions, getState, flushStore } = await freshStore();
    await initStore(30);
    // Pendant l'attente (application démarrée à vide) : une modification, écrite dans localStorage
    actions.addSwimmer({ firstName: 'Nora', lastName: 'Exemple', gender: 'F', birthYear: 2015, relation: 'followed' });
    expect(localStorage.getItem(OLD_KEY)).not.toBeNull();
    release();
    await settle();
    await flushStore();
    expect(getState().swimmers.map((s) => s.firstName)).toEqual(['Lina']);
    expect(getState().goals).toHaveLength(1);
    const stored = await readIdb();
    expect(stored?.swimmers.map((s) => s.firstName)).toEqual(['Lina']);
    expect(stored?.goals).toHaveLength(1);
    expect(localStorage.getItem(OLD_KEY)).toBeNull();
  });

  it('store-1 : reprise de localStorage dans une base vide, modification faite pendant la copie enregistrée', async () => {
    localStorage.setItem(OLD_KEY, JSON.stringify({ version: 1, swimmers: [], meets: [], swims: [], goals: [], settings: { onboarded: true } }));
    const factory = indexedDB;
    let during: (() => void) | null = null;
    // Geste fait au moment où la copie de reprise est écrite dans la base
    vi.stubGlobal('indexedDB', {
      open: (...args: Parameters<IDBFactory['open']>) => {
        const req = factory.open(...args);
        req.addEventListener('success', () => {
          const db = req.result;
          const transaction = db.transaction.bind(db);
          db.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
            if (mode === 'readwrite' && during) {
              const f = during;
              during = null;
              f();
            }
            return transaction(names, mode);
          }) as IDBDatabase['transaction'];
        });
        return req;
      },
    });
    const { initStore, actions, flushStore } = await freshStore();
    during = () => actions.updateSettings({ defaultCourse: 'LCM' });
    await initStore();
    expect(during).toBeNull();
    await flushStore();
    expect((await readIdb())?.settings.defaultCourse).toBe('LCM');
    expect(localStorage.getItem(OLD_KEY)).toBeNull();
  });

  it('store-5 : connexion à la base perdue : rouverte, la modification est enregistrée', async () => {
    const factory = indexedDB;
    const opened: IDBDatabase[] = [];
    vi.stubGlobal('indexedDB', {
      open: (...args: Parameters<IDBFactory['open']>) => {
        const req = factory.open(...args);
        req.addEventListener('success', () => opened.push(req.result));
        return req;
      },
    });
    const { initStore, actions, flushStore, getSaveError } = await freshStore();
    await initStore();
    // Connexion fermée par le navigateur (WebKit après un long passage en arrière-plan)
    opened[0].close();
    actions.updateSettings({ defaultCourse: 'LCM' });
    await flushStore();
    await settle();
    await flushStore();
    expect((await readIdb())?.settings.defaultCourse).toBe('LCM');
    expect(getSaveError()).toBeNull();
  });

  it('store-8 : deux onglets : un changement pas encore enregistré n’est pas écrasé par l’autre onglet', async () => {
    const channels: { listeners: ((e: unknown) => void)[] }[] = [];
    class FakeChannel {
      listeners: ((e: unknown) => void)[] = [];
      constructor() {
        channels.push(this);
      }
      addEventListener(_type: string, l: (e: unknown) => void) {
        this.listeners.push(l);
      }
      postMessage() {}
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    vi.stubGlobal('window', { addEventListener: () => {} });
    vi.stubGlobal('document', { addEventListener: () => {}, visibilityState: 'visible' });
    const { initStore, actions, getState, flushStore } = await freshStore();
    await initStore();
    const { openDb, idbPut } = await import('../src/store/idb');
    const other = await openDb();
    const otherData = { version: 1, swimmers: [], meets: [], swims: [], goals: [], settings: { defaultCourse: 'SCM', celebrate: true } };
    const fromOtherTab = () => channels[channels.length - 1].listeners.forEach((l) => l({ data: 'saved' }));

    // Changement pas encore enregistré (dans 400 ms) quand l'autre onglet enregistre
    actions.updateSettings({ defaultCourse: 'LCM' });
    await idbPut(other!, 'data', otherData);
    fromOtherTab();
    await settle();
    expect(getState().settings.defaultCourse).toBe('LCM');
    await flushStore();
    expect((await readIdb())?.settings.defaultCourse).toBe('LCM');

    // Changement fait pendant la relecture de la base
    await idbPut(other!, 'data', otherData);
    fromOtherTab();
    actions.updateSettings({ celebrate: false });
    await settle();
    expect(getState().settings.celebrate).toBe(false);
    await flushStore();
    expect((await readIdb())?.settings.celebrate).toBe(false);
  });
});
