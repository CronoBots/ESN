import { describe, expect, it } from 'vitest';
import { medalCount, medalSwims, placesKnownSince } from '../src/lib/medals';
import type { Swim } from '../src/store/types';

let n = 0;
const swim = (o: Partial<Swim>): Swim => ({
  id: `s${n++}`,
  swimmerId: 'a',
  meetId: 'm1',
  context: 'competition',
  date: '2026-10-11',
  distance: 50,
  stroke: 'FREE',
  course: 'SCM',
  timeCs: 3000,
  status: 'OK',
  round: 'TIM',
  source: 'live',
  createdAt: 0,
  updatedAt: 0,
  ...o,
});

describe('médailles', () => {
  it('compte or, argent et bronze des courses classées', () => {
    const swims = [
      swim({ place: 1 }),
      swim({ place: 2, stroke: 'BACK' }),
      swim({ place: 3, stroke: 'BREAST' }),
      swim({ place: 1, distance: 100 }),
      swim({ place: 4, stroke: 'FLY' }),
      swim({ place: 1, stroke: 'IM', distance: 100, status: 'DSQ', timeCs: null }),
      swim({ place: 2, distance: 200, context: 'training' }),
      swim({ place: 1, swimmerId: 'b' }),
    ];
    expect(medalCount(medalSwims(swims, 'a'))).toEqual({ gold: 2, silver: 1, bronze: 1, total: 4 });
  });

  it('série puis finale : seule la place de la finale est une médaille', () => {
    const swims = [
      swim({ round: 'HEAT', place: 1 }),
      swim({ round: 'FINAL', place: 3, timeCs: 2990 }),
      // Série seule (pas de finale nagée) : sa place compte
      swim({ round: 'HEAT', place: 2, stroke: 'BACK' }),
      // Même épreuve à une autre compétition : séparée
      swim({ round: 'HEAT', place: 1, meetId: 'm2' }),
    ];
    const medals = medalSwims(swims, 'a');
    expect(medals.map((s) => `${s.meetId}-${s.stroke}-${s.round}-${s.place}`).sort()).toEqual(['m1-BACK-HEAT-2', 'm1-FREE-FINAL-3', 'm2-FREE-HEAT-1']);
  });

  it('sait depuis quand les classements sont connus', () => {
    const swims = [swim({ date: '2026-11-15', place: 5 }), swim({ date: '2026-10-11', place: 2 }), swim({ date: '2020-01-01' })];
    expect(placesKnownSince(swims, 'a')).toBe('2026-10-11');
    expect(placesKnownSince(swims, 'b')).toBeUndefined();
  });
});
