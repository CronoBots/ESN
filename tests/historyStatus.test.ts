import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { CLUB } from '../src/club';
import { encryptHistory, keepClubRaces } from '../src/lib/roster';
import { medalSwims } from '../src/lib/medals';
import { countsForRecords, personalBests } from '../src/lib/stats';
import { parseSwimrankings } from '../src/lib/swimrankings';
import type { Swim } from '../src/store/types';

/*
 * Disqualifications, forfaits et abandons dans l'historique du club (noms, temps et raisons fictifs).
 * Format : « DSQ », « DNS » ou « DNF » à la place du temps, raison en 12e colonne, ligne commencée par « @@ »
 * (ignorée par les versions de l'application d'avant le 20 nov. 2026, qui lisaient toutes les colonnes).
 */

// Historique fictif, en colonnes : épreuve, bassin, temps, points, date, ville, compétition, club, place, tour, passages, remarque
const HEAD = '@@URL:https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=1234567\n@@GENDER:F\nDUPONT, Emma (2014)\nBEL - Ecole Seraing Natation';
const row = (ev: string, time: string, date: string, extra: { pts?: string; place?: string; round?: string; splits?: string; note?: string; club?: string; meet?: string } = {}) =>
  [ev, '25m', time, extra.pts ?? '', date, 'Ville', extra.meet ?? 'Meeting fictif', extra.club ?? 'Ecole Seraing Natation', extra.place ?? '', extra.round ?? '', extra.splits ?? '', extra.note ?? ''].join('\t');

const OK_ROWS = [
  row('50m Libre', '34.49', '13 nov 2026', { pts: '250', place: '3', round: 'Finale directe' }),
  row('100m Dos', '1:26.26', '15 nov 2026', { pts: '240', place: '5', round: 'Finale directe', splits: '42.10' }),
  row('200m 4 nages', '3:13.48', '15 nov 2026', { pts: '230', place: '7', round: 'Finale directe', splits: '45.00 1:36.00 2:30.00' }),
  row('50m Dos', '52.37', '14 nov 2026'),
];
// Disqualifications et forfaits glissés entre les courses, raison comprise (chiffres, deux-points, barre oblique)
const STATUS_ROWS = [
  row('100m Brasse', 'DSQ', '15 nov 2026', { round: 'Finale directe', note: 'SW 7.4 - Virage fictif / raison inventée' }),
  row('200m Papillon', 'DNS', '14 nov 2026', { round: 'Finale directe' }),
  row('400m 4 nages', 'DSQ', '18 oct 2026', { round: 'Séries', note: '9.4.b - Section fictive non terminée' }),
  row('800m Libre', 'DNF', '17 oct 2026'),
];
const mixed = (prefix: string) =>
  [HEAD, prefix + STATUS_ROWS[0], OK_ROWS[0], prefix + STATUS_ROWS[1], OK_ROWS[1], OK_ROWS[2], prefix + STATUS_ROWS[2], OK_ROWS[3], prefix + STATUS_ROWS[3]].join('\n');
const timed = (text: string) => parseSwimrankings(text).swims.filter((s) => !s.status);

describe('historique : lecture des disqualifications et forfaits', () => {
  it('une ligne DSQ / DNS / DNF ne décale pas la lecture des autres courses (avec ou sans « @@ »)', () => {
    const plain = timed([HEAD, ...OK_ROWS].join('\n'));
    expect(plain).toHaveLength(4);
    // Avant, après, entre chaque course, et en fin de fichier
    expect(timed(mixed(''))).toEqual(plain);
    expect(timed(mixed('@@'))).toEqual(plain);
  });

  it('lit chaque disqualification, forfait ou abandon sans temps, avec son tour et sa raison', () => {
    for (const prefix of ['', '@@']) {
      const swims = parseSwimrankings(mixed(prefix)).swims;
      expect(swims).toHaveLength(8);
      // Rangées par date avec les autres courses
      expect(swims.map((s) => s.date)).toEqual([...swims.map((s) => s.date)].sort());
      const status = swims.filter((s) => s.status);
      expect(status.map((s) => `${s.distance} ${s.stroke} ${s.status} ${s.date}`)).toEqual([
        '800 FREE DNF 2026-10-17',
        '400 IM DSQ 2026-10-18',
        '200 FLY DNS 2026-11-14',
        '100 BREAST DSQ 2026-11-15',
      ]);
      for (const s of status) {
        expect(s.timeCs).toBeUndefined();
        expect(s).toMatchObject({ course: 'SCM', city: 'Ville', meet: 'Meeting fictif' });
        expect(s.points).toBeUndefined();
        expect(s.place).toBeUndefined();
      }
      expect(status[1]).toMatchObject({ round: 'HEAT', note: '9.4.b - Section fictive non terminée' });
      expect(status[3]).toMatchObject({ round: 'FINAL', note: 'SW 7.4 - Virage fictif / raison inventée' });
      expect(status[0].round).toBeUndefined();
      expect(status[2].note).toBeUndefined();
    }
  });

  it('seulement pour l’ESN : la disqualification nagée pour un autre club est retirée', () => {
    const text = [HEAD, '@@' + row('100m Dos', 'DSQ', '15 nov 2026', { club: 'BEL - Club Exemple Natation' }), '@@' + STATUS_ROWS[0], OK_ROWS[0]].join('\n');
    const r = keepClubRaces(text, CLUB.match);
    expect(r).toMatchObject({ kept: 2, dropped: 1, verified: true });
    expect(parseSwimrankings(r.text).swims.map((s) => `${s.distance} ${s.stroke} ${s.status ?? s.timeCs}`)).toEqual(['50 FREE 3449', '100 BREAST DSQ']);
  });

  it('ignore une épreuve impossible et une date absente', () => {
    const text = [HEAD, '@@' + row('1500m Brasse', 'DSQ', '15 nov 2026'), '@@' + row('100m Dos', 'DNS', ''), OK_ROWS[0]].join('\n');
    expect(parseSwimrankings(text).swims.map((s) => s.status ?? s.timeCs)).toEqual([3449]);
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

describe('historique publié : disqualifications et forfaits dans l’application', () => {
  beforeEach(() => stubBrowser());
  afterEach(() => vi.unstubAllGlobals());

  const code = 'CODE-FICTIF';
  let published: unknown = null;
  const publish = async (text: string) => {
    published = await encryptHistory({ updated: '2026-11-20', athletes: [{ lastName: 'DUPONT', firstName: 'Emma', birthYear: 2014, text }] }, code, 1000);
  };

  async function setup() {
    vi.resetModules();
    vi.stubGlobal('fetch', async (url: string) =>
      String(url).includes('club-history') && published ? { ok: true, json: async () => JSON.parse(JSON.stringify(published)) } : { ok: false, json: async () => null },
    );
    const store = await import('../src/store/store');
    await store.initStore();
    store.actions.applyRoster(
      { club: 'Ecole Seraing Natation', updated: '2026-11-01', groups: [], members: [{ lastName: 'DUPONT', firstName: 'Emma', birthYear: 2014, gender: 'F', group: '' }] },
      code,
      'v1',
    );
    const { applyClubHistory } = await import('../src/screens/Club');
    const emma = store.getState().swimmers.find((s) => s.lastName === 'DUPONT')!;
    const mine = () => store.getState().swims.filter((s) => s.swimmerId === emma.id);
    return { ...store, applyClubHistory, emma, mine };
  }

  it('ajoutées sans temps à la fiche, raison comprise, hors records et médailles', async () => {
    await publish(mixed('@@'));
    const { applyClubHistory, mine, getState, emma } = await setup();
    expect(await applyClubHistory()).toBe(8);
    const dsq = mine().filter((s) => s.status !== 'OK');
    expect(dsq.map((s) => `${s.distance} ${s.stroke} ${s.status}`).sort()).toEqual(['100 BREAST DSQ', '200 FLY DNS', '400 IM DSQ', '800 FREE DNF']);
    for (const s of dsq) {
      expect(s.timeCs).toBeUndefined();
      expect(s.source).toBe('swimrankings');
      expect(countsForRecords(s, true)).toBe(false);
    }
    const breast = dsq.find((s) => s.stroke === 'BREAST')!;
    expect(breast).toMatchObject({ round: 'FINAL', notes: 'Disqualification : SW 7.4 - Virage fictif / raison inventée' });
    expect(dsq.find((s) => s.stroke === 'FLY')!.notes).toBeUndefined();
    // Même compétition que les courses nagées le même week-end
    const okMeet = mine().find((s) => s.status === 'OK' && s.date === '2026-11-15')!.meetId;
    expect(breast.meetId).toBe(okMeet);
    // Records : seulement les courses nagées ; médailles : jamais une disqualification, même avec une place
    expect([...personalBests(getState().swims, emma.id, true).values()].every((s) => s.status === 'OK')).toBe(true);
    expect(medalSwims(dsq.map((s) => ({ ...s, place: 1 }) as Swim))).toEqual([]);
    expect(getState().settings.club?.historyParser).toBe(7);

    // Relu (même version) : rien en double
    expect(await applyClubHistory()).toBe(0);
    expect(mine()).toHaveLength(8);
  });

  it('nouvelle version de l’historique : une disqualification retirée disparaît, les autres restent', async () => {
    await publish(mixed('@@'));
    const { applyClubHistory, mine } = await setup();
    await applyClubHistory();
    await publish([HEAD, ...OK_ROWS, '@@' + STATUS_ROWS[1]].join('\n'));
    expect(await applyClubHistory()).toBe(0);
    expect(mine().map((s) => `${s.distance} ${s.stroke} ${s.status}`).filter((s) => !s.endsWith('OK'))).toEqual(['200 FLY DNS']);
    expect(mine()).toHaveLength(5);
  });

  it('disqualification déjà connue par les résultats en direct (compétition nommée autrement) : pas en double', async () => {
    await publish([HEAD, OK_ROWS[1], '@@' + STATUS_ROWS[0]].join('\n'));
    const { applyClubHistory, mine, actions, emma, batch } = await setup();
    const meet = actions.addMeet({ name: 'MEETING FICTIF (résultats en direct)', startDate: '2026-11-13', endDate: '2026-11-15', course: 'SCM', liveId: '99999' } as never);
    batch(() => {
      // Fichier de résultats : temps nagé gardé avec la disqualification
      actions.addSwim({ swimmerId: emma.id, meetId: meet.id, context: 'competition', date: '2026-11-15', distance: 100, stroke: 'BREAST', course: 'SCM', timeCs: 9999, status: 'DSQ', round: 'TIM', eventNo: 12, timing: 'electronic', source: 'live' } as never);
    });
    expect(await applyClubHistory()).toBe(1);
    const dsq = mine().filter((s) => s.status === 'DSQ');
    expect(dsq).toHaveLength(1);
    expect(dsq[0].source).toBe('live');
  });

  it('compétition déjà présente sous un autre nom : la disqualification y est rangée, pas dans une compétition à part', async () => {
    await publish([HEAD, OK_ROWS[1], '@@' + STATUS_ROWS[0]].join('\n'));
    const { applyClubHistory, mine, actions, emma, batch, getState } = await setup();
    const meet = actions.addMeet({ name: 'Critérium d’automne', startDate: '2026-11-13', endDate: '2026-11-15', course: 'SCM', liveId: '99999' } as never);
    batch(() => {
      actions.addSwim({ swimmerId: emma.id, meetId: meet.id, context: 'competition', date: '2026-11-15', distance: 100, stroke: 'BACK', course: 'SCM', timeCs: 8626, status: 'OK', round: 'TIM', timing: 'electronic', source: 'live' } as never);
    });
    // Le 100 m dos est déjà là (résultats en direct) ; seule la disqualification est ajoutée
    expect(await applyClubHistory()).toBe(1);
    const dsq = mine().find((s) => s.status === 'DSQ')!;
    expect(dsq.meetId).toBe(meet.id);
    expect(getState().meets.map((m) => m.name)).toEqual(['Critérium d’automne']);
  });
});
