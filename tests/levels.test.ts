import { describe, expect, it } from 'vitest';
import { levelStatus, relativeGap } from '../src/lib/levels';
import { FFBN_GRID } from '../src/lib/ffbnGrid';

// Valeurs lues dans la grille FFBN du 29/01/2026 (Messieurs, Trident, 25 m : 100 m libre 11 ans = 1:06,21)
describe('niveaux FFBN', () => {
  it('reprend les temps de la grille officielle', () => {
    expect(FFBN_GRID.M.Trident.SCM!['100-FREE'][11 - 8]).toBe(6621);
    expect(FFBN_GRID.M.Requin.LCM!['100-FREE'][19 - 8]).toBe(5020);
    expect(FFBN_GRID.M.Requin.SCM).toBeUndefined();
  });

  it('donne le niveau atteint et le prochain selon l’âge de l’année', () => {
    const boy = { gender: 'M' as const, birthYear: 2015 };
    // 11 ans en 2026
    const mistral = FFBN_GRID.M.Mistral.SCM!['100-FREE'][3];
    const trident = FFBN_GRID.M.Trident.SCM!['100-FREE'][3];
    const s = levelStatus(boy, 'SCM', 100, 'FREE', 2026, mistral - 50)!;
    expect(s.age).toBe(11);
    expect(s.levels.map((l) => l.level)).toEqual(['Mistral', 'Trident']); // pas de Requin en 25 m
    expect(s.reached).toBe('Mistral');
    expect(s.next).toMatchObject({ level: 'Trident', cs: trident, gapCs: mistral - 50 - trident });
    expect(relativeGap(s)).toBeCloseTo((mistral - 50 - trident) / trident);
    // L'année suivante, il a 12 ans : la grille des 12 ans s'applique
    expect(levelStatus(boy, 'SCM', 100, 'FREE', 2027)!.levels[0].cs).toBe(FFBN_GRID.M.Mistral.SCM!['100-FREE'][4]);
  });

  it('égaler le temps suffit ; tous les niveaux atteints : plus de prochain', () => {
    const girl = { gender: 'F' as const, birthYear: 2008 };
    const requin = FFBN_GRID.F.Requin.LCM!['100-BACK'][18 - 8];
    const s = levelStatus(girl, 'LCM', 100, 'BACK', 2026, requin)!;
    expect(s.reached).toBe('Requin');
    expect(s.next).toBeUndefined();
  });

  it('ne dit rien hors de la grille', () => {
    expect(levelStatus({ gender: 'F', birthYear: 2020 }, 'SCM', 100, 'FREE', 2026)).toBeNull(); // 6 ans
    expect(levelStatus({ gender: 'F', birthYear: 1980 }, 'SCM', 100, 'FREE', 2026)).toBeNull(); // masters
    expect(levelStatus({ gender: 'F' }, 'SCM', 100, 'FREE', 2026)).toBeNull(); // année inconnue
    expect(levelStatus({ gender: 'F', birthYear: 2012 }, 'SCM', 100, 'FREE', 2030)).toBeNull(); // grille 2026-2028
    expect(levelStatus({ gender: 'F', birthYear: 2012 }, 'SCM', 25, 'FREE', 2026)).toBeNull(); // pas de 25 m
    expect(levelStatus({ gender: 'M', birthYear: 2016 }, 'SCM', 50, 'FREE', 2026)).toBeNull(); // 50 m dès 18 ans
  });

  it('la grille est cohérente : Mistral plus lent que Trident, Trident plus lent que Requin', () => {
    for (const g of ['F', 'M'] as const)
      for (const c of ['SCM', 'LCM'] as const)
        for (const [ev, mistral] of Object.entries(FFBN_GRID[g].Mistral[c]!))
          mistral.forEach((m, i) => {
            const t = FFBN_GRID[g].Trident[c]![ev]?.[i];
            const r = FFBN_GRID[g].Requin[c]?.[ev]?.[i];
            if (m && t) expect(m, `${g} ${c} ${ev} ${i}`).toBeGreaterThan(t);
            if (t && r) expect(t, `${g} ${c} ${ev} ${i}`).toBeGreaterThan(r);
          });
  });
});
