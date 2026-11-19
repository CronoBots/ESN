import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { encryptHistory } from '../src/lib/roster';

/*
 * Revue « écrans B » : célébration des records, chargement de la liste du club,
 * historique du club appliqué une seule fois (noms et temps fictifs uniquement).
 */

const HEADER = `@@URL:https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=1234567
@@GENDER:F
DUPONT, Emma (2012)
BEL - Ecole Seraing Natation`;

/** Navigateur minimal : stockage en mémoire, adresse et historique (lus au chargement du routeur). */
function stubBrowser(nav: Record<string, unknown> = {}) {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
  vi.stubGlobal('window', {
    location: { hash: '', pathname: '/', search: '', href: 'http://localhost/' },
    history: { state: null, pushState() {}, replaceState() {}, back() {} },
    addEventListener() {},
    removeEventListener() {},
    scrollTo() {},
  });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('navigator', { onLine: true, userAgent: 'test', ...nav });
}

async function freshStore() {
  vi.resetModules();
  const store = await import('../src/store/store');
  await store.initStore();
  return store;
}

const swim = (swimmerId: string, date: string, timeCs: number) =>
  ({ swimmerId, context: 'competition', date, distance: 100, stroke: 'FREE', course: 'SCM', timeCs, status: 'OK', round: 'TIM', timing: 'electronic', source: 'live' }) as const;

describe('célébration des records', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('« Célébrer les records » désactivé : ni confettis ni vibration', async () => {
    const vibrate = vi.fn();
    stubBrowser({ vibrate });
    const { actions } = await freshStore();
    const { overlay } = await import('../src/components/ui');
    actions.updateSettings({ celebrate: false });
    overlay.celebrate();
    expect(vibrate).not.toHaveBeenCalled();
    actions.updateSettings({ celebrate: true });
    overlay.celebrate();
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('« Vérifier maintenant » : seul le record d’un nageur suivi se fête', async () => {
    stubBrowser();
    const { actions, getState } = await freshStore();
    const { followedRecord } = await import('../src/screens/Settings');
    const emma = actions.addSwimmer({ firstName: 'Emma', lastName: 'DUPONT', gender: 'F', birthYear: 2012, relation: 'child', member: true });
    const lucas = actions.addSwimmer({ firstName: 'Lucas', lastName: 'MARTIN', gender: 'M', birthYear: 2012, relation: 'followed', member: true });
    actions.addSwim(swim(emma.id, '2025-10-11', 7000));
    actions.addSwim(swim(lucas.id, '2025-10-11', 8000));
    const swum = () => new Set(getState().swims.map((x) => x.id));

    // Nouveaux résultats : record de Lucas (non suivi), Emma plus lente que son record
    let before = swum();
    actions.addSwim(swim(lucas.id, '2026-11-14', 7500));
    actions.addSwim(swim(emma.id, '2026-11-14', 7200));
    expect(followedRecord(before)).toBe(false);

    // Record d'Emma (suivie)
    before = swum();
    actions.addSwim(swim(emma.id, '2026-11-15', 6800));
    expect(followedRecord(before)).toBe(true);
  });
});

describe('liste du club', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('« Charger la liste du club » hors connexion : un message au lieu de rien', async () => {
    stubBrowser({ onLine: false });
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await freshStore();
    const { overlay } = await import('../src/components/ui');
    const toast = vi.spyOn(overlay, 'toast');
    const { loadClub } = await import('../src/screens/Club');
    await expect(loadClub()).resolves.toBe(false);
    expect(toast).toHaveBeenCalledWith('Pas de connexion internet', '⚠️');
  });
});

describe('historique du club au premier lancement', () => {
  beforeEach(() => stubBrowser());
  afterEach(() => vi.unstubAllGlobals());

  it('deux demandes rapprochées : l’historique n’est déchiffré et importé qu’une fois', async () => {
    const code = 'CODE-FICTIF';
    const enc = await encryptHistory(
      {
        updated: '2026-11-01',
        athletes: [{ lastName: 'DUPONT', firstName: 'Emma', birthYear: 2012, text: `${HEADER}\n100m Libre\t25m\t1:10.00\t400\t11 oct 2025\tSeraing\tMeeting Janus\tESN` }],
      },
      code,
      1000,
    );
    vi.stubGlobal('fetch', async (url: string) =>
      String(url).includes('club-history') ? { ok: true, json: async () => JSON.parse(JSON.stringify(enc)) } : { ok: false, json: async () => null },
    );
    const { actions, getState } = await freshStore();
    actions.updateSettings({ club: { code, version: 'v1', updated: '2026-09-01', groups: [], count: 1 } });
    const emma = actions.addSwimmer({ firstName: 'Emma', lastName: 'DUPONT', gender: 'F', birthYear: 2012, relation: 'child', member: true });
    const { applyClubHistory } = await import('../src/screens/Club');
    const imported = vi.spyOn(actions, 'importSwimrankings');

    // Chargement de la liste puis vérification à l'ouverture, avant la fin du premier passage
    const [a, b] = await Promise.all([applyClubHistory(), applyClubHistory()]);
    expect(imported).toHaveBeenCalledTimes(1);
    expect(a + b).toBe(1);
    expect(getState().swims.filter((s) => s.swimmerId === emma.id)).toHaveLength(1);
    expect(getState().settings.club?.historyVersion).toBe(enc.iv);
  });
});
