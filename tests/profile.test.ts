import { describe, expect, it } from 'vitest';
import { bestTimesTable, careerSpan, clubRecordsHeld, seasonsSummary, topRanks } from '../src/lib/profile';
import type { NationalRank, Swim, Swimmer } from '../src/store/types';

// Nageurs et courses fictifs
const emma: Swimmer = { id: 'e', firstName: 'Emma', lastName: 'DUPONT', gender: 'F', birthYear: 2012, color: 0, relation: 'followed', favorite: false, member: true, createdAt: 0 };
const lea: Swimmer = { ...emma, id: 'l', firstName: 'Léa', lastName: 'MARTIN' };
let n = 0;
const swim = (over: Partial<Swim>): Swim => ({
  id: `s${n++}`,
  swimmerId: 'e',
  context: 'competition',
  date: '2025-10-11',
  distance: 100,
  stroke: 'FREE',
  course: 'SCM',
  timeCs: 7000,
  status: 'OK',
  round: 'TIM',
  source: 'swimrankings',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const swims = [
  swim({ date: '2024-11-10', timeCs: 7500, meetId: 'm1' }),
  swim({ date: '2025-10-11', timeCs: 7000, meetId: 'm2' }),
  swim({ date: '2025-10-12', timeCs: 8200, course: 'LCM', meetId: 'm2' }),
  swim({ date: '2025-10-12', distance: 50, stroke: 'BACK', timeCs: 3900, meetId: 'm2' }),
  swim({ date: '2026-01-20', timeCs: 9999, status: 'DSQ', meetId: 'm3' }), // disqualifiée : ne compte pas
  swim({ swimmerId: 'l', date: '2025-10-11', timeCs: 6800, meetId: 'm2' }), // Léa, plus rapide au 100 m libre 25 m
];

describe('fiche d’un nageur', () => {
  it('première et dernière compétition (courses valides)', () => {
    const { first, last } = careerSpan(swims.filter((s) => s.swimmerId === 'e'));
    expect(first?.date).toBe('2024-11-10');
    expect(last?.date).toBe('2025-10-12');
  });

  it('meilleurs temps en 25 m et en 50 m, une ligne par épreuve, dans l’ordre des nages', () => {
    const rows = bestTimesTable(swims.filter((s) => s.swimmerId === 'e'));
    expect(rows.map((r) => `${r.distance}-${r.stroke}`)).toEqual(['100-FREE', '50-BACK']);
    expect(rows[0].scm?.timeCs).toBe(7000);
    expect(rows[0].lcm?.timeCs).toBe(8200);
    expect(rows[1].lcm).toBeUndefined();
  });

  it('records du club détenus aujourd’hui', () => {
    const held = clubRecordsHeld(swims, [emma, lea], emma);
    // Léa détient le record absolu du 100 m libre 25 m ; Emma celui des 12 ans (2024), le 100 m libre 50 m et le 50 m dos
    expect(held.some((h) => h.band.id === 'all' && h.course === 'SCM' && h.swim.distance === 100)).toBe(false);
    expect(held.some((h) => h.band.id === '12' && h.course === 'SCM' && h.swim.distance === 100 && h.swim.timeCs === 7500)).toBe(true);
    expect(held.some((h) => h.band.id === 'all' && h.course === 'LCM' && h.swim.distance === 100)).toBe(true);
    expect(held[0].band.id).toBe('all'); // record absolu d'abord
  });

  it('saison par saison, la plus récente d’abord', () => {
    const pb = new Map(swims.map((s) => [s.id, { isPB: s.timeCs === 7000 || s.timeCs === 7500, isFirst: false }])) as never;
    const seasons = seasonsSummary(swims.filter((s) => s.swimmerId === 'e'), emma, pb);
    expect(seasons.map((s) => s.season)).toEqual(['2025-2026', '2024-2025']);
    expect(seasons[0]).toMatchObject({ meets: 1, races: 3, pbs: 1 });
    expect(seasons[1]).toMatchObject({ meets: 1, races: 1, pbs: 1 });
  });

  it('meilleurs rangs nationaux de la dernière saison classée', () => {
    const r = (o: Partial<NationalRank>): NationalRank => ({ swimmerId: 'e', season: '2026-2027', course: 'SCM', distance: 100, stroke: 'FREE', label: 'Belgique', rank: 10, ...o });
    const top = topRanks([r({ rank: 12 }), r({ rank: 8, label: 'Belgique · 14 ans' }), r({ distance: 50, stroke: 'BACK', rank: 3 }), r({ season: '2025-2026', rank: 1 })], 'e');
    expect(top.map((x) => `${x.distance}-${x.rank}`)).toEqual(['50-3', '100-8']);
    expect(topRanks([], 'e')).toEqual([]);
    // 25 m : saison « 2026-2027 » ; 50 m : année civile « 2026 » (comme sur swimrankings) : les deux bassins sont montrés
    const both = topRanks(
      [r({ season: '2026-2027', rank: 20 }), r({ season: '2025-2026', rank: 2 }), r({ course: 'LCM', season: '2026', rank: 5 }), r({ course: 'LCM', season: '2025', rank: 1 })],
      'e',
    );
    expect(both.map((x) => `${x.course} ${x.season} ${x.rank}`)).toEqual(['LCM 2026 5', 'SCM 2026-2027 20']);
  });
});
