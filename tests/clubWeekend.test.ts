import { describe, expect, it } from 'vitest';
import { lastClubWeekend } from '../src/lib/clubWeekend';
import { computePbFlags } from '../src/lib/stats';
import type { Meet, Swim, Swimmer } from '../src/store/types';

const swimmer = (id: string, birthYear: number, extra: Partial<Swimmer> = {}): Swimmer =>
  ({ id, firstName: id, lastName: 'TEST', gender: 'F', birthYear, color: 0, relation: 'child', member: true, ...extra }) as Swimmer;

let n = 0;
const swim = (swimmerId: string, date: string, timeCs: number, extra: Partial<Swim> = {}): Swim =>
  ({
    id: `s${n++}`,
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

const meets = [{ id: 'm1', name: 'Meeting d’automne', startDate: '2026-11-14', course: 'SCM', createdAt: 0 } as Meet];

describe('résumé du dernier week-end du club', () => {
  it('compte nageurs, records personnels, premiers temps, podiums et records du club', () => {
    const swimmers = [swimmer('ana', 2014), swimmer('bea', 2014), swimmer('old', 1990, { former: true })];
    const swims = [
      swim('ana', '2026-10-10', 9000, { meetId: 'm0' }),
      swim('ana', '2026-11-14', 8500, { place: 2 }), // record personnel −5.00, podium
      swim('bea', '2026-11-15', 9900, { stroke: 'BACK' }), // premier temps
      swim('bea', '2026-11-15', 9800, { status: 'DSQ', distance: 50 }), // disqualifiée : ignorée
      swim('old', '2026-11-15', 6000), // ancien membre : hors résumé
      swim('old', '2008-03-01', 5900), // record du club tous âges (ancien membre)
    ];
    const w = lastClubWeekend(swims, swimmers, meets, computePbFlags(swims, false), '2026-11-17')!;
    expect(w).toMatchObject({ start: '2026-11-14', end: '2026-11-15', pbs: 1, firsts: 1, podiums: 1 });
    expect(w.swimmerIds.sort()).toEqual(['ana', 'bea']);
    expect(w.meets.map((m) => m.name)).toEqual(['Meeting d’automne']);
    expect(w.progress.map((p) => [p.swimmer.id, p.deltaCs, Math.round(p.pct * 10) / 10])).toEqual([['ana', 500, 5.6]]);
    // 100 m dos de bea : record du club (personne d'autre ne l'a nagé) ; 100 m libre : l'ancien membre reste devant
    expect(w.records.map((r) => r.swimmer.id)).toEqual(['bea']);
  });

  it('pas de « record du club » sur une épreuve où les anciens membres ne sont pas relevés', () => {
    const swimmers = [swimmer('ana', 2014)];
    const swims = [swim('ana', '2026-11-14', 1800, { distance: 25 })];
    const w = lastClubWeekend(swims, swimmers, meets, computePbFlags(swims, false), '2026-11-17')!;
    expect(w.records).toEqual([]);
  });

  it('rien quand aucun nageur du club n’a nagé', () => {
    expect(lastClubWeekend([], [swimmer('ana', 2014)], meets, new Map(), '2026-11-17')).toBeNull();
  });
});
