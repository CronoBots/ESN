import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { activeChampionships, allroundStatus, limitStatus, parseQualifying, qualificationHighlights, qualifyingSummary } from '../src/lib/qualifying';
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
    // Chaque championnat a des temps limites ou un classement aux points
    for (const c of published.championships) expect(Object.keys(c.limits.F).length + Object.keys(c.limits.M).length + (c.allround?.categories.length ?? 0)).toBeGreaterThan(0);
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

  it('classement aux points (11-16 ans) : meilleurs points par épreuve imposée, 50 ou 100 m papillon', () => {
    const c = parseQualifying({
      championships: [
        {
          id: 'bk-11-16',
          name: 'Championnats de Belgique 11-16 ans',
          course: 'SCM',
          until: '2027-11-30',
          edition: 2027,
          limitsEdition: 2026,
          window: { from: '2026-01-01', to: '2027-11-01' },
          accepts: ['SCM', 'LCM'],
          source: 'https://example.org',
          limits: { F: {}, M: {} },
          allround: {
            categories: [
              { label: 'Jeugd 1 (11-12 ans)', minAge: 11, maxAge: 12, selected: 80, events: [['50-FLY', '100-FLY'], '100-BACK', '200-IM'] },
              { label: 'Jeugd 2 (13-14 ans)', minAge: 13, maxAge: 14, selected: 96, events: ['100-FLY', '100-BACK', '200-IM', '400-FREE'] },
            ],
          },
        },
      ],
    }).championships[0];
    const zoe = { id: 'zoe', gender: 'F' as const, birthYear: 2015 }; // 12 ans en 2027 : Jeugd 1
    const pts = new Map<string, number>();
    const add = (d: number, st: Swim['stroke'], course: Swim['course'], date: string, p: number) => {
      const s = swim('zoe', d, st, course, 1000 + n, date);
      pts.set(s.id, p);
      return s;
    };
    const swims = [
      add(50, 'FLY', 'SCM', '2026-03-01', 310),
      add(100, 'FLY', 'LCM', '2026-05-01', 330), // le 100 m vaut plus : il compte
      add(100, 'BACK', 'SCM', '2025-12-01', 400), // hors période
      add(100, 'BACK', 'SCM', '2026-06-01', 350),
    ];
    const s = allroundStatus(c, zoe, swims, TODAY, (x) => pts.get(x.id) ?? null)!;
    expect(s.category.label).toBe('Jeugd 1 (11-12 ans)');
    expect(s.events.map((e) => e.points ?? null)).toEqual([330, 350, null]);
    expect(s.total).toBe(680);
    expect(s.complete).toBe(false);
    // 17 ans : pas concerné
    expect(allroundStatus(c, { ...zoe, birthYear: 2010 }, swims, TODAY, () => 1)).toBeNull();
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

  it('en-tête de la fiche : championnats qualifiés, sinon la limite la plus proche', () => {
    const tom = { id: 'tom', gender: 'M' as const, birthYear: 2013 };
    const qualified = [swim('tom', 400, 'FREE', 'SCM', 29000, '2026-10-01'), swim('tom', 200, 'BACK', 'SCM', 15700, '2026-10-01')];
    const h = qualificationHighlights(qualifyingSummary(data, tom, qualified, TODAY));
    expect(h.qualified.map((q) => `${q.championship.id} ${q.events.length}`)).toEqual(['bk-11-14-2027 1']);
    expect(h.closest).toBeUndefined();
    // Pas qualifié : la limite la plus proche (0.34 s au 200 m dos)
    const near = qualificationHighlights(qualifyingSummary(data, tom, [qualified[1]], TODAY));
    expect(near.qualified).toEqual([]);
    expect(near.closest).toMatchObject({ distance: 200, stroke: 'BACK' });
    // Trop loin (plus de 10 %) : rien
    const far = qualificationHighlights(qualifyingSummary(data, tom, [swim('tom', 200, 'BACK', 'SCM', 19000, '2026-10-01')], TODAY));
    expect(far).toEqual({ qualified: [] });
  });
});
