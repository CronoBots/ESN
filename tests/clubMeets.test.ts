import { describe, expect, it } from 'vitest';
import { clubMeets } from '../src/lib/stats';
import type { Swim, Swimmer } from '../src/store/types';

const sw = (id: string, former = false) => ({ id, firstName: 'Emma', lastName: 'DUPONT', gender: 'F', birthYear: 2012, color: 0, member: true, ...(former ? { former } : {}) }) as Swimmer;
const swim = (swimmerId: string, meetId?: string) =>
  ({ id: `${swimmerId}-${meetId}`, swimmerId, meetId, date: '2026-10-10', course: 'SCM', distance: 100, stroke: 'FREE', context: 'competition', status: 'OK', timeCs: 8000 }) as Swim;

describe('compétitions du club', () => {
  it('garde seulement les compétitions avec au moins un membre actuel', () => {
    const swimmers = [sw('actuel'), sw('ancien', true)];
    const ids = clubMeets(
      [swim('actuel', 'm1'), swim('ancien', 'm1'), swim('ancien', 'm2'), swim('inconnu', 'm3'), swim('actuel')],
      swimmers,
    );
    expect([...ids]).toEqual(['m1']); // m2 : anciens membres seulement ; m3 : personne du club
  });
});
