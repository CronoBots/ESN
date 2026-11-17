import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { activeChampionships, limitStatus, parseQualifying, qualifyingSummary } from '../src/lib/qualifying';
import type { Swim } from '../src/store/types';

// Copie figée des limites 2026 : les tests ne dépendent pas des mises à jour du fichier publié
const FIXTURE = new URL('./fixtures/qualifying-2026.json', import.meta.url);
const data = parseQualifying(JSON.parse(readFileSync(FIXTURE, 'utf8')));
const champ = (id: string) => data.championships.find((c) => c.id === id)!;
const TODAY = '2026-11-17';

let n = 0;
const swim = (swimmerId: string, distance: number, stroke: Swim['stroke'], course: Swim['course'], timeCs: number, date: string): Swim => ({
  id: `s${n++}`,
  swimmerId,
  context: 'competition',
  date,
  distance,
  stroke,
  course,
  timeCs,
  status: 'OK',
  round: 'TIM',
  source: 'swimrankings',
  createdAt: 0,
  updatedAt: 0,
});

describe('temps limites publiés', () => {
  it('le fichier publié est lisible et à jour', () => {
    const published = parseQualifying(JSON.parse(readFileSync(new URL('../public/data/qualifying.json', import.meta.url), 'utf8')));
    expect(published.championships.length).toBeGreaterThan(0);
    for (const c of published.championships) expect(Object.keys(c.limits.F).length + Object.keys(c.limits.M).length).toBeGreaterThan(0);
  });

  it('lit le fichier : temps recopiés des règlements', () => {
    expect(data.championships.map((c) => c.id)).toEqual(['obk-25-2026', 'obk-50-2027', 'bk-11-14-2027', 'bk-15-2027']);
    expect(champ('obk-25-2026').limits.F['50-FREE']).toEqual({ A: 2759, B: 2822 });
    expect(champ('obk-25-2026').limits.M['1500-FREE']).toEqual({ A: 97917, B: 99984 });
    expect(champ('bk-11-14-2027').limits.M['400-FREE']).toEqual({ 11: 35001, 12: 32937, 13: 30576, 14: 29326 });
    expect(champ('bk-15-2027').limits.F['50-FREE']['18+']).toBe(2861);
    // Limites reprises de l'édition précédente : provisoires
    expect(champ('obk-25-2026').provisional).toBe(false);
    expect(champ('bk-15-2027').provisional).toBe(true);
  });

  it('refuse un temps illisible', () => {
    const bad = { championships: [{ ...JSON.parse(readFileSync(FIXTURE, 'utf8')).championships[0], limits: { F: { '50-FREE': { A: '27,5x' } }, M: {} } }] };
    expect(() => parseQualifying(bad)).toThrow(/illisible/);
  });

  it('ne montre plus un championnat passé', () => {
    expect(activeChampionships(data, TODAY)).toHaveLength(4);
    expect(activeChampionships(data, '2026-12-21').map((c) => c.id)).not.toContain('obk-25-2026');
  });
});

describe('situation d’un nageur', () => {
  it('limite de son âge l’année du championnat, temps de la période seulement', () => {
    const lea = { id: 'lea', gender: 'F' as const, birthYear: 2014 }; // 13 ans en 2027
    const swims = [swim('lea', 400, 'FREE', 'LCM', 30000, '2025-06-01'), swim('lea', 400, 'FREE', 'SCM', 31100, '2026-10-11')];
    const s = limitStatus(champ('bk-11-14-2027'), lea, swims, 400, 'FREE', TODAY)!;
    expect(s.age).toBe(13);
    expect(s.lines).toEqual([{ label: 'Limite', cs: 31021, reached: false, gapCs: 79 }]);
    expect(s.best?.timeCs).toBe(31100); // le temps de 2025 est hors période
    swims.push(swim('lea', 400, 'FREE', 'SCM', 31000, '2026-11-15'));
    expect(limitStatus(champ('bk-11-14-2027'), lea, swims, 400, 'FREE', TODAY)?.reached?.cs).toBe(31021);
  });

  it('A seulement jusqu’à 16 ans, A et B ensuite ; temps en 50 m comptés pour le 25 m', () => {
    const swims = [swim('a', 100, 'FREE', 'LCM', 6050, '2026-03-01'), swim('b', 100, 'FREE', 'LCM', 6050, '2026-03-01')];
    const young = limitStatus(champ('obk-25-2026'), { id: 'a', gender: 'F', birthYear: 2010 }, swims, 100, 'FREE', TODAY)!;
    expect(young.lines.map((l) => l.label)).toEqual(['A']);
    expect(young.next).toMatchObject({ label: 'A', gapCs: 90 });
    const older = limitStatus(champ('obk-25-2026'), { id: 'b', gender: 'F', birthYear: 2009 }, swims, 100, 'FREE', TODAY)!;
    expect(older.lines.map((l) => `${l.label}:${l.reached}`)).toEqual(['A:false', 'B:true']);
    expect(older.reached?.label).toBe('B');
    expect(older.next?.label).toBe('A');
  });

  it('bassin de 50 m seulement pour les 15 ans et plus ; rien pour les masters', () => {
    const swims = [swim('c', 50, 'FREE', 'SCM', 2500, '2026-03-01')];
    const c = { id: 'c', gender: 'M' as const, birthYear: 2009 };
    expect(limitStatus(champ('bk-15-2027'), c, swims, 50, 'FREE', TODAY)?.best).toBeUndefined();
    expect(limitStatus(champ('bk-15-2027'), { ...c, birthYear: 1990 }, swims, 50, 'FREE', TODAY)).toBeNull();
  });

  it('résumé : qualifications et limites les plus proches', () => {
    const tom = { id: 'tom', gender: 'M' as const, birthYear: 2013 }; // 14 ans en 2027
    const swims = [
      swim('tom', 400, 'FREE', 'SCM', 29000, '2026-10-01'), // 14 ans : 4:53.26 → qualifié
      swim('tom', 200, 'IM', 'SCM', 16500, '2026-10-01'), // 2:38.65 → 6.35 s
      swim('tom', 200, 'BACK', 'SCM', 15700, '2026-10-01'), // 2:36.66 → 0.34 s
    ];
    const r = qualifyingSummary(data, tom, swims, TODAY);
    expect(r.qualified.map((s) => `${s.championship.id} ${s.distance}-${s.stroke}`)).toEqual(['bk-11-14-2027 400-FREE']);
    expect(r.close.slice(0, 2).map((s) => `${s.distance}-${s.stroke}`)).toEqual(['200-BACK', '200-IM']);
  });
});
