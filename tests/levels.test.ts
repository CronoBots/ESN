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

  it('applique la grille des filles aux filles et celle des garçons aux garçons', () => {
    // Même âge (12 ans en 2026), même épreuve, même temps : le niveau dépend du sexe
    const girl = { gender: 'F' as const, birthYear: 2014 };
    const boy = { gender: 'M' as const, birthYear: 2014 };
    const t = FFBN_GRID.F.Trident.SCM!['100-FREE'][12 - 8];
    const f = levelStatus(girl, 'SCM', 100, 'FREE', 2026, t)!;
    const m = levelStatus(boy, 'SCM', 100, 'FREE', 2026, t)!;
    expect(f.gender).toBe('F');
    expect(m.gender).toBe('M');
    expect(f.reached).toBe('Trident');
    expect(m.levels.map((l) => l.cs)).toEqual([FFBN_GRID.M.Mistral.SCM!['100-FREE'][4], FFBN_GRID.M.Trident.SCM!['100-FREE'][4]]);
    expect(m.reached).not.toBe('Trident'); // le Trident des garçons est plus rapide
  });

  it('les temps des garçons sont plus rapides que ceux des filles, partout où les deux existent', () => {
    let compared = 0;
    for (const level of ['Mistral', 'Trident', 'Requin'] as const)
      for (const course of ['SCM', 'LCM'] as const)
        for (const [k, girls] of Object.entries(FFBN_GRID.F[level][course] ?? {}))
          girls.forEach((g, i) => {
            const b = FFBN_GRID.M[level][course]?.[k]?.[i];
            if (!g || !b) return;
            compared++;
            expect(b, `${level} ${course} ${k} âge ${i + 8}`).toBeLessThan(g);
          });
    expect(compared).toBeGreaterThan(600);
  });

  it('épreuves propres à chaque sexe chez les jeunes : 800 m libre filles, 1500 m libre garçons', () => {
    const girl = { gender: 'F' as const, birthYear: 2013 }; // 13 ans en 2026
    const boy = { gender: 'M' as const, birthYear: 2013 };
    expect(levelStatus(girl, 'SCM', 800, 'FREE', 2026)).not.toBeNull();
    expect(levelStatus(boy, 'SCM', 800, 'FREE', 2026)).toBeNull();
    expect(levelStatus(boy, 'SCM', 1500, 'FREE', 2026)).not.toBeNull();
    expect(levelStatus(girl, 'SCM', 1500, 'FREE', 2026)).toBeNull();
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
