import { describe, expect, it } from 'vitest';
import { lastClubWeekend } from '../src/lib/clubWeekend';
import { publishedMeet, upcomingClubEvents, type ClubEvent } from '../src/lib/clubCalendar';
import { parseQualifying, qualifyingSummary } from '../src/lib/qualifying';
import { chronoCompare, computePbFlags } from '../src/lib/stats';
import type { Meet, Swim, Swimmer } from '../src/store/types';

// Noms, villes et temps fictifs

let n = 0;
const swim = (swimmerId: string, date: string, timeCs: number, extra: Partial<Swim> = {}): Swim =>
  ({
    id: `r${n++}`,
    swimmerId,
    meetId: 'm1',
    context: 'competition',
    date,
    distance: 100,
    stroke: 'FREE',
    course: 'SCM',
    timeCs,
    status: 'OK',
    round: 'TIM',
    source: 'live',
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  }) as Swim;

const swimmer = (id: string, birthYear: number): Swimmer =>
  ({ id, firstName: id, lastName: 'FICTIF', gender: 'F', birthYear, color: 0, relation: 'child', member: true }) as Swimmer;

const meet = (over: Partial<Meet>): Meet => ({ id: 'm', name: 'Compétition', startDate: '2026-01-01', course: 'SCM', createdAt: 0, ...over });

describe('revue : podiums du week-end (stats-2)', () => {
  it('série 1re puis finale 2e du même 100 m libre : un seul podium', () => {
    const swims = [
      swim('zia', '2026-11-14', 7000, { round: 'HEAT', place: 1 }),
      swim('zia', '2026-11-14', 6950, { round: 'FINAL', place: 2 }),
    ];
    const meets = [meet({ id: 'm1', name: 'Meeting fictif', startDate: '2026-11-14' })];
    const w = lastClubWeekend(swims, [swimmer('zia', 2013)], meets, computePbFlags(swims, false), '2026-11-17')!;
    expect(w.podiums).toBe(1);
  });
});

describe('revue : compétition publiée du calendrier (stats-3)', () => {
  const ev: ClubEvent = { start: '2027-02-13', end: '2027-02-14', city: 'Villebourg', name: 'Meeting de printemps', groups: ['A'] };

  it('un autre meeting le même week-end ailleurs ne remplace pas l’annonce', () => {
    const other = meet({ name: 'Meeting van Testdorp', city: 'Testdorp', startDate: '2027-02-13', endDate: '2027-02-14' });
    expect(publishedMeet(ev, [other])).toBeUndefined();
    // L'année commune ne compte pas non plus comme mot du nom
    const withYear = { ...ev, name: 'Meeting de printemps 2027' };
    expect(publishedMeet(withYear, [{ ...other, name: 'Meeting van Testdorp 2027' }])).toBeUndefined();
    const cal = { title: '', season: '', version: '', until: '2027-06-30', groupNames: {}, events: [ev] };
    expect(upcomingClubEvents(cal, [other], '2027-02-01')).toEqual([ev]);
  });

  it('même ville, ou deux mots du nom en commun : l’annonce est remplacée', () => {
    const same = meet({ name: 'Meeting du club organisateur', city: 'Villebourg', startDate: '2027-02-13' });
    expect(publishedMeet(ev, [same])).toBe(same);
    const bkEvent: ClubEvent = { start: '2027-03-12', end: '2027-03-14', city: 'Ailleurs', name: 'Championnats de Belgique 25 m', groups: ['A'] };
    const bk = meet({ name: 'Championnat de Belgique 2027', startDate: '2027-03-12', endDate: '2027-03-14' });
    expect(publishedMeet(bkEvent, [bk])).toBe(bk);
  });
});

describe('revue : période de qualification close (stats-5)', () => {
  const data = parseQualifying({
    championships: [
      {
        id: 'test-25',
        name: 'Championnats de test',
        course: 'SCM',
        until: '2026-12-20',
        edition: 2026,
        limitsEdition: 2026,
        window: { from: '2026-01-01', to: '2026-11-29' },
        accepts: ['SCM'],
        source: 'https://example.org',
        limits: { F: { '100-FREE': { A: 6000, B: 6200 }, '100-BACK': { A: 7000, B: 7200 } }, M: {} },
      },
    ],
  });
  const zia = { id: 'zia', gender: 'F' as const, birthYear: 2008 };
  const swims = [
    swim('zia', '2026-10-01', 6300), // 100 m libre : 1.00 s de la limite B
    swim('zia', '2026-10-01', 7100, { stroke: 'BACK' }), // 100 m dos : limite B atteinte
  ];

  it('pendant la période : la limite non atteinte est encore « à gagner »', () => {
    const r = qualifyingSummary(data, zia, swims, '2026-11-20');
    expect(r.qualified.map((s) => s.stroke)).toEqual(['BACK']);
    expect(r.close.map((s) => s.stroke)).toEqual(['FREE']);
  });

  it('après la clôture : plus rien à gagner, la qualification acquise reste', () => {
    const r = qualifyingSummary(data, zia, swims, '2026-12-05');
    expect(r.qualified.map((s) => s.stroke)).toEqual(['BACK']);
    expect(r.close).toEqual([]);
  });
});

describe('revue : ordre série / finale sans heure (stats-6)', () => {
  it('finale sans heure de passage après la série relevée en direct : un seul record personnel', () => {
    const old = swim('zia', '2026-10-01', 7200);
    const heat = swim('zia', '2026-11-14', 6900, { round: 'HEAT', startTime: '10:05' });
    const final = swim('zia', '2026-11-14', 7000, { round: 'FINAL', source: 'swimrankings' });
    expect([final, heat, old].sort(chronoCompare).map((s) => s.id)).toEqual([old.id, heat.id, final.id]);
    const flags = computePbFlags([old, final, heat], false);
    expect(flags.get(heat.id)).toMatchObject({ isPB: true, deltaCs: -300 });
    expect(flags.get(final.id)).toMatchObject({ isPB: false, deltaCs: 100 });
  });

  it('deux heures de passage : l’heure décide toujours', () => {
    const a = swim('zia', '2026-11-14', 7000, { round: 'FINAL', startTime: '09:00' });
    const b = swim('zia', '2026-11-14', 7000, { round: 'HEAT', startTime: '17:00' });
    expect(chronoCompare(a, b)).toBeLessThan(0);
  });
});
