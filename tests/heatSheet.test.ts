import { describe, expect, it } from 'vitest';
import { overallRanking } from '../src/lib/heatSheet';

describe('classement général d’une épreuve', () => {
  it('fusionne les catégories, classe au temps et garde les ex æquo à la même place', () => {
    const rows = overallRanking([
      {
        category: 'Benjamines',
        rows: [
          { place: 1, status: 'OK', name: 'DUPONT, Emma', yy: '14', club: 'ESN', timeCs: 3810 },
          { place: 2, status: 'DSQ', name: 'MARTIN, Léa', yy: '14', club: 'CNH' },
        ],
      },
      {
        category: 'Minimes',
        rows: [
          { place: 1, status: 'OK', name: 'DURAND, Zoé', yy: '12', club: 'RSCM', timeCs: 3650 },
          { place: 2, status: 'OK', name: 'PETIT, Inès', yy: '12', club: 'ESN', timeCs: 3810 },
        ],
      },
      // Classement « toutes catégories » publié en plus : pas de doublon
      { category: 'Toutes catégories', rows: [{ place: 1, status: 'OK', name: 'DURAND, Zoé', yy: '12', club: 'RSCM', timeCs: 3650 }] },
    ]);
    expect(rows.map((r) => [r.name, r.overall, r.category])).toEqual([
      ['DURAND, Zoé', 1, 'Minimes'],
      ['DUPONT, Emma', 2, 'Benjamines'],
      ['PETIT, Inès', 2, 'Minimes'],
      ['MARTIN, Léa', undefined, 'Benjamines'],
    ]);
  });
});
