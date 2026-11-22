import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { encryptHistory } from '../src/lib/roster';
import { swimDate, swimDayKey, swimLongDay } from '../src/lib/dates';
import { parseSwimrankings } from '../src/lib/swimrankings';
import { meetRecap } from '../src/lib/meetRecap';

/*
 * Ancienne course dont le JOUR n'a pas été relevé (ajoutée d'après la page d'une compétition de plusieurs jours) :
 * l'historique du club donne en 13e colonne les dates de la compétition, affichées à la place du jour.
 * Décision du 22 nov. 2026 : aucune valeur estimée affichée. Noms, temps et compétitions fictifs.
 */

const HEAD = '@@URL:https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=1234567\n@@GENDER:F\nDUPONT, Emma (2004)\nBEL - Ecole Seraing Natation';
// épreuve, bassin, temps, points, date, ville, compétition, club, place, tour, passages, remarque, dates de la compétition
const row = (ev: string, time: string, date: string, days = '', meet = 'Meeting fictif') =>
  [ev, '50m', time, '', date, 'Ville', meet, 'Ecole Seraing Natation', '3', 'Finale directe', '', '', days].join('\t').replace(/\t+$/, '');

const TEXT = [
  HEAD,
  row('100m Libre', '1:05.20', '17 nov 2018', '2018-11-17/2018-11-18', 'Championnats fictifs'),
  row('200m Dos', '2:30.10', '18 nov 2018', '2018-11-17/2018-11-18', 'Championnats fictifs'),
  '@@' + row('100m Brasse', 'DSQ', '17 nov 2018', '2018-11-17/2018-11-18', 'Championnats fictifs'),
  row('50m Libre', '30.00', '20 jan 2019'),
  // Dates illisibles ou à l'envers : ignorées (jour affiché comme avant)
  row('50m Dos', '35.00', '21 jan 2019', '2019-01-22/2019-01-20'),
  row('50m Brasse', '40.00', '22 jan 2019', 'pas une date'),
].join('\n');

describe('jour non relevé : lecture de l’historique', () => {
  it('13e colonne : dates de la compétition, pour les courses et les disqualifications', () => {
    const swims = parseSwimrankings(TEXT).swims;
    const of = (d: number, st: string) => swims.find((s) => s.distance === d && s.stroke === st)!;
    expect(of(100, 'FREE').dayRange).toEqual({ from: '2018-11-17', to: '2018-11-18' });
    expect(of(200, 'BACK').dayRange).toEqual({ from: '2018-11-17', to: '2018-11-18' });
    expect(of(100, 'BREAST')).toMatchObject({ status: 'DSQ', dayRange: { from: '2018-11-17', to: '2018-11-18' } });
    // Le jour reste lu comme avant (tri, âge, saison)
    expect(of(100, 'FREE').date).toBe('2018-11-17');
    expect(of(50, 'FREE').dayRange).toBeUndefined();
    expect(of(50, 'BACK').dayRange).toBeUndefined();
    expect(of(50, 'BREAST').dayRange).toBeUndefined();
  });

  it('affichage : dates de la compétition au lieu du jour', () => {
    const unread = { date: '2018-11-17', dayRange: { from: '2018-11-17', to: '2018-11-18' } };
    expect(swimDate(unread)).toBe('17 – 18 nov. 2018');
    expect(swimLongDay(unread)).toBe('17 – 18 nov. 2018');
    expect(swimDayKey(unread)).toBe('2018-11-17/2018-11-18');
    // Jour relevé : inchangé
    expect(swimDate({ date: '2018-11-17' })).toBe('17 nov. 2018');
    expect(swimLongDay({ date: '2018-11-17' })).toBe('Samedi 17 novembre');
    expect(swimDayKey({ date: '2018-11-17' })).toBe('2018-11-17');
  });
});

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

describe('jour non relevé : dans l’application', () => {
  beforeEach(() => stubBrowser());
  afterEach(() => vi.unstubAllGlobals());

  const code = 'CODE-FICTIF';
  let published: unknown = null;
  let version = 0;
  const publish = async (text: string) => {
    version++;
    published = await encryptHistory({ updated: `2026-11-2${version}`, athletes: [{ lastName: 'DUPONT', firstName: 'Emma', birthYear: 2004, text }] }, code, 1000);
  };

  async function setup() {
    vi.resetModules();
    vi.stubGlobal('fetch', async (url: string) =>
      String(url).includes('club-history') && published ? { ok: true, json: async () => JSON.parse(JSON.stringify(published)) } : { ok: false, json: async () => null },
    );
    const store = await import('../src/store/store');
    await store.initStore();
    store.actions.applyRoster(
      { club: 'Ecole Seraing Natation', updated: '2026-11-01', groups: [], members: [{ lastName: 'DUPONT', firstName: 'Emma', birthYear: 2004, gender: 'F', group: '' }] },
      code,
      'v1',
    );
    const { applyClubHistory } = await import('../src/screens/Club');
    const emma = store.getState().swimmers.find((s) => s.lastName === 'DUPONT')!;
    const mine = () => store.getState().swims.filter((s) => s.swimmerId === emma.id);
    return { ...store, applyClubHistory, emma, mine };
  }

  it('course gardée avec les dates de la compétition ; compétition sur toutes ses dates, sans récap jour par jour', async () => {
    // Les deux courses rangées le même jour (déduit) : la compétition ne paraissait durer qu'un jour
    await publish([HEAD, row('100m Libre', '1:05.20', '17 nov 2018', '2018-11-17/2018-11-18', 'Championnats fictifs'), row('200m Dos', '2:30.10', '17 nov 2018', '2018-11-17/2018-11-18', 'Championnats fictifs')].join('\n'));
    const { applyClubHistory, mine, getState } = await setup();
    await applyClubHistory();
    const swims = mine();
    expect(swims.map((s) => s.dayRange)).toEqual([
      { from: '2018-11-17', to: '2018-11-18' },
      { from: '2018-11-17', to: '2018-11-18' },
    ]);
    const meet = getState().meets.find((m) => m.id === swims[0].meetId)!;
    expect([meet.startDate, meet.endDate]).toEqual(['2018-11-17', '2018-11-18']);
    expect(meetRecap(meet.id, getState().swims, getState().swimmers, new Map()).days).toEqual([]);
  });

  it('jour relevé depuis (même jour confirmé) : les dates de la compétition ne sont plus affichées', async () => {
    await publish([HEAD, row('100m Libre', '1:05.20', '17 nov 2018', '2018-11-17/2018-11-18', 'Championnats fictifs')].join('\n'));
    const first = await setup();
    await first.applyClubHistory();
    expect(first.mine()[0].dayRange).toBeDefined();
    // Nouvelle publication : jour lu sur la page « saison », plus de 13e colonne
    await publish([HEAD, row('100m Libre', '1:05.20', '17 nov 2018', '', 'Championnats fictifs')].join('\n'));
    await first.applyClubHistory();
    expect(first.mine()).toHaveLength(1);
    expect(first.mine()[0].dayRange).toBeUndefined();
  });
});
