import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { encryptHistory, encryptRankings } from '../src/lib/roster';

/*
 * Autres noms d'un membre (liste du club) : la fiche les garde, et l'historique comme les classements
 * publiés sous l'autre orthographe s'y rattachent (noms et temps fictifs uniquement).
 */

function stubBrowser() {
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
  vi.stubGlobal('navigator', { onLine: true, userAgent: 'test' });
}

async function freshStore() {
  vi.resetModules();
  const store = await import('../src/store/store');
  await store.initStore();
  return store;
}

describe('autres noms d’un membre', () => {
  beforeEach(() => stubBrowser());
  afterEach(() => vi.unstubAllGlobals());

  it('historique et classements publiés sous l’autre orthographe rattachés au membre', async () => {
    const code = 'CODE-FICTIF';
    const alias = 'DUPPONT, Emma (2014)';
    const history = await encryptHistory(
      {
        updated: '2026-11-01',
        athletes: [{ lastName: 'DUPPONT', firstName: 'Emma', birthYear: 2014, text: `${alias}\n100m Libre\t25m\t1:20.00\t300\t11 oct 2026\tLiège\tMeeting fictif\tEcole Seraing Natation` }],
      },
      code,
      1000,
    );
    const rankings = await encryptRankings(
      { updated: '2026-11-01', athletes: [{ lastName: 'DUPPONT', firstName: 'Emma', birthYear: 2014, text: `${alias}\n2026-2027\t25m\t100m Libre\tBelgique · 12 ans\t40\t\t1:20.00` }] },
      code,
      1000,
    );
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      const body = u.includes('club-history') ? history : u.includes('club-rankings') ? rankings : null;
      return body ? { ok: true, json: async () => JSON.parse(JSON.stringify(body)) } : { ok: false, json: async () => null };
    });
    const { actions, getState } = await freshStore();
    actions.applyRoster(
      {
        club: 'Ecole Seraing Natation',
        updated: '2026-11-01',
        groups: [],
        members: [{ lastName: 'DUPONT', firstName: 'Emma', birthYear: 2014, gender: 'F', group: '', aliases: [{ lastName: 'DUPPONT', firstName: 'Emma', birthYear: 2014 }] }],
      },
      code,
      'v1',
    );
    const emma = getState().swimmers.find((s) => s.lastName === 'DUPONT')!;
    expect(emma.aliases).toEqual([{ lastName: 'DUPPONT', firstName: 'Emma', birthYear: 2014 }]);

    const { applyClubHistory, applyClubRankings } = await import('../src/screens/Club');
    expect(await applyClubHistory()).toBe(1);
    expect(getState().swims.filter((s) => s.swimmerId === emma.id).map((s) => s.timeCs)).toEqual([8000]);
    expect(await applyClubRankings()).toBe(1);
    expect(getState().rankings?.filter((r) => r.swimmerId === emma.id)).toHaveLength(1);
  });
});
