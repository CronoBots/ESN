import { describe, expect, it } from 'vitest';
import { countedMedalSwims, MEDALS_SINCE, medalCount, medalSwims, placesKnownSince, SHOW_MEDAL_COUNTS } from '../src/lib/medals';
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

  it('nombre de médailles affiché, compté depuis la saison 2017/18 (places des actifs toutes connues)', () => {
    expect(SHOW_MEDAL_COUNTS).toBe(true);
    expect(MEDALS_SINCE).toBe('2017-09-01');
    const swims = [
      swim({ place: 1, date: '2016-11-20', meetId: 'old' }), // avant : classements pas tous relevés
      swim({ place: 2, date: '2017-08-31', meetId: 'summer' }), // saison 2016/17
      swim({ place: 3, date: '2017-09-01', meetId: 'first' }), // premier jour compté
      swim({ place: 1, date: '2026-11-14', meetId: 'recent' }),
    ];
    expect(medalSwims(swims, 'a')).toHaveLength(4);
    expect(countedMedalSwims(swims, 'a').map((s) => s.meetId).sort()).toEqual(['first', 'recent']);
    expect(medalCount(countedMedalSwims(swims, 'a'))).toEqual({ gold: 1, silver: 0, bronze: 1, total: 2 });
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

  it('trophées podium et victoire : places de finale, « classement pas encore connu » sans aucune place', async () => {
    const { achievements } = await import('../src/lib/stats');
    const sw = { id: 'a', firstName: 'Emma', lastName: 'DUPONT', gender: 'F' as const, color: 0, relation: 'followed' as const, favorite: false, createdAt: 0 };
    const pick = (swims: Swim[]) => achievements(swims, sw, [], new Map()).filter((t) => t.id === 'podium' || t.id === 'win');
    // Historique sans place : pas vérifiable
    expect(pick([swim({})]).map((t) => `${t.id}:${t.unlocked}:${t.pending}`)).toEqual(['podium:false:Classement pas encore connu', 'win:false:Classement pas encore connu']);
    // 1re en série, 3e en finale : podium, pas de victoire
    const t = pick([swim({ round: 'HEAT', place: 1 }), swim({ round: 'FINAL', place: 3 })]);
    expect(t.map((x) => `${x.id}:${x.unlocked}:${x.pending ?? ''}`)).toEqual(['podium:true:', 'win:false:']);
  });

  it('résultats officiels d’une course déjà connue (historique) : la place est ajoutée, sans doublon', async () => {
    const { actions, getState } = await import('../src/store/store');
    actions.resetAll();
    const sw = actions.addSwimmer({ firstName: 'Emma', lastName: 'Dupont', gender: 'F', birthYear: 2013, relation: 'followed' });
    // Course venue de l'historique swimrankings : ni place, ni tour
    actions.addSwim({ swimmerId: sw.id, context: 'competition', date: '2026-10-17', distance: 200, stroke: 'FLY', course: 'SCM', timeCs: 18921, status: 'OK', round: 'TIM', source: 'swimrankings' });
    const r = actions.importClubResults(sw.id, [
      {
        meet: { name: 'Championnat de district', course: 'SCM', startDate: '2026-10-17', endDate: '2026-10-18', liveId: '1' },
        swims: [
          { distance: 200, stroke: 'FLY', course: 'SCM', round: 'TIM', timeCs: 18921, status: 'OK', place: 1, eventNo: 12, date: '2026-10-17' },
          { distance: 100, stroke: 'BACK', course: 'SCM', round: 'TIM', timeCs: 8193, status: 'OK', place: 2, date: '2026-10-18' },
        ],
      },
    ]);
    expect(r.added).toBe(1); // le 100 dos est nouveau ; le 200 papillon est complété, pas ajouté
    const swims = getState().swims.filter((s) => s.swimmerId === sw.id);
    expect(swims).toHaveLength(2);
    expect(swims.find((s) => s.stroke === 'FLY')).toMatchObject({ place: 1, eventNo: 12, source: 'swimrankings', timeCs: 18921 });
    expect(medalCount(medalSwims(swims, sw.id))).toEqual({ gold: 1, silver: 1, bronze: 0, total: 2 });
  });

  it('sait depuis quand les classements sont connus', () => {
    const swims = [swim({ date: '2026-11-15', place: 5 }), swim({ date: '2026-10-11', place: 2 }), swim({ date: '2020-01-01' })];
    expect(placesKnownSince(swims, 'a')).toBe('2026-10-11');
    expect(placesKnownSince(swims, 'b')).toBeUndefined();
  });
});
