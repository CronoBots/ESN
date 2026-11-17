import { describe, expect, it } from 'vitest';
import { normalizeData } from '../src/store/store';

const swim = (id: string, swimmerId: string, meetId?: string) => ({
  id,
  swimmerId,
  meetId,
  date: '2026-10-10',
  course: 'SCM',
  distance: 100,
  stroke: 'FREE',
  timeCs: 9000,
  status: 'OK',
  context: 'competition',
});

describe('ancien exemple de démonstration', () => {
  it('est retiré au chargement, sans toucher aux vrais nageurs', () => {
    const d = normalizeData({
      swimmers: [
        { id: 'demo', firstName: 'Emma', lastName: 'Exemple', club: 'Club de démonstration', relation: 'child' },
        { id: 'real', firstName: 'Léa', lastName: 'DUPONT', club: 'Ecole Seraing Natation', member: true, favorite: true },
      ],
      meets: [
        { id: 'm-demo', name: 'Meeting d’hiver', startDate: '2026-11-27' },
        { id: 'm-shared', name: 'Meeting commun', startDate: '2026-10-10' },
      ],
      swims: [swim('s1', 'demo', 'm-demo'), swim('s2', 'demo', 'm-shared'), swim('s3', 'real', 'm-shared')],
      goals: [{ id: 'g1', swimmerId: 'demo' }, { id: 'g2', swimmerId: 'real' }],
      settings: { selectedSwimmerId: 'demo' },
    });
    expect(d.swimmers.map((s) => s.id)).toEqual(['real']);
    expect(d.swims.map((s) => s.id)).toEqual(['s3']);
    expect(d.meets.map((m) => m.id)).toEqual(['m-shared']); // compétition de l'exemple seul : retirée
    expect(d.goals.map((g) => g.id)).toEqual(['g2']);
    expect(d.settings.selectedSwimmerId).toBeUndefined();
  });

  it('ne change rien sans exemple', () => {
    const d = normalizeData({ swimmers: [{ id: 'real', firstName: 'Léa', lastName: 'DUPONT' }], settings: { selectedSwimmerId: 'real' } });
    expect(d.swimmers).toHaveLength(1);
    expect(d.settings.selectedSwimmerId).toBe('real');
  });
});
