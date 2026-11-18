import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { CLUB } from '../src/club';
import { keepClubRaces } from '../src/lib/roster';
import { findSwimmerEntry, findSwimmerResult } from '../src/lib/resultSheet';
import { swimsForClub } from '../src/lib/liveResults';
import { parseSwimrankings } from '../src/lib/swimrankings';

/*
 * Un nageur qui a changé de club n'a que ses résultats nagés pour l'ESN
 * (noms fictifs uniquement).
 */

const HEADER = `@@URL:https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=1234567
@@GENDER:F
DUPONT, Emma (2012)
BEL - Ecole Seraing Natation`;

describe('historique : seulement les courses nagées pour l’ESN', () => {
  it('retire les courses d’un autre club, puis marque l’historique vérifié', () => {
    const text = `${HEADER}
100m Libre\t25m\t1:20.00\t300\t12 oct 2019\tLiège\tMeeting d'automne\tBEL - Club Exemple Natation
100m Libre\t25m\t1:10.00\t400\t11 oct 2025\tSeraing\tMeeting Janus\tBEL - Ecole Seraing Natation
50m Dos\t50m\t40.00\t350\t15 mar 2026\tBastogne\tChampionnat de District\tESN`;
    const r = keepClubRaces(text, CLUB.match);
    expect(r).toMatchObject({ kept: 2, dropped: 1, verified: true });
    expect(r.text).not.toMatch(/Club Exemple/);
    expect(r.text).toMatch(/^@@CLUBS$/m);
    // Les colonnes restent (club, puis place, tour, passages quand ils sont relevés)
    expect(r.text.split('\n').filter((l) => l.includes('\t')).every((l) => l.split('\t').length === 8)).toBe(true);
    const swims = parseSwimrankings(r.text).swims;
    expect(swims.map((s) => s.date)).toEqual(['2025-10-11', '2026-03-15']);
    // Relu (historique déjà publié) : rien ne change, il reste vérifié
    expect(keepClubRaces(r.text, CLUB.match)).toMatchObject({ text: r.text, kept: 2, dropped: 0, verified: true });
  });

  it('lit la place, le tour et les temps de passage relevés sur swimrankings', () => {
    const text = `${HEADER}
200m Libre\t25m\t2:30.00\t400\t11 oct 2025\tSeraing\tMeeting Janus\tBEL - Ecole Seraing Natation\t2\tFinale\t35.10 1:13.20 1:51.80
100m Dos\t50m\t1:20.00\t350\t12 oct 2025\tSeraing\tMeeting Janus\tESN\t12\tSéries\t39.00
50m Brasse\t25m\t40.00\t300\t13 oct 2025\tLiège\tCoupe\tESN\t\t\t`;
    const swims = parseSwimrankings(keepClubRaces(text, CLUB.match).text).swims;
    // Les temps de passage ne deviennent jamais des courses
    expect(swims).toHaveLength(3);
    expect(swims[0]).toMatchObject({ distance: 200, timeCs: 15000, place: 2, round: 'FINAL', splits: [3510, 7320, 11180], splitEvery: 50 });
    expect(swims[1]).toMatchObject({ distance: 100, course: 'LCM', place: 12, round: 'HEAT', splits: [3900], splitEvery: 50 });
    // Colonnes vides : rien d'inventé
    expect(swims[2].place).toBeUndefined();
    expect(swims[2].round).toBeUndefined();
    expect(swims[2].splits).toBeUndefined();
  });

  it('historique sans club par course : gardé tel quel, mais pas vérifié', () => {
    const text = `${HEADER}
100m Libre\t25m\t1:10.00\t400\t11 oct 2025\tSeraing\tMeeting Janus`;
    expect(keepClubRaces(text, CLUB.match)).toMatchObject({ text, kept: 1, dropped: 0, verified: false });
  });
});

describe('recherche automatique : seulement les lignes de l’ESN', () => {
  const emma = { firstName: 'Emma', lastName: 'Dupont', birthYear: 2012, gender: 'F' as const };

  it('feuille de résultats : la ligne d’un autre club n’est pas retenue', () => {
    const other = `Epreuve 27 14-11-26 - 15:30 Dames, 50m Dos
 3. DUPONT, Emma 12 Club Exemple 42.42 210`;
    const esn = `Epreuve 27 14-11-26 - 15:30 Dames, 50m Dos
 3. DUPONT, Emma 12 Esn 42.42 210`;
    expect(findSwimmerResult([other], emma, undefined, CLUB.match)).toBeNull();
    expect(findSwimmerResult([esn], emma, undefined, CLUB.match)).toMatchObject({ timeCs: 4242 });
    // Sans contrôle du club (lecture d'une feuille pour l'affichage), la ligne reste lisible
    expect(findSwimmerResult([other], emma)).toMatchObject({ timeCs: 4242 });
  });

  it('liste de départ : seulement l’inscription pour l’ESN', () => {
    const start = `Série 2 de 3
    4 DUPONT, Emma            12       Club Exemple                 1:23.45
Série 3 de 3
    5 DUPONT, Emma            12       Ecole Seraing Natation       1:20.00`;
    expect(findSwimmerEntry(start, emma, CLUB.match)).toMatchObject({ heat: 3, lane: 5, entryCs: 8000 });
  });

  it('fichier de résultats (LENEX) : le club de la compétition fait foi', () => {
    expect(swimsForClub({ club: 'Ecole Seraing Natation' })).toBe(true);
    expect(swimsForClub({ club: 'ESN' })).toBe(true);
    expect(swimsForClub({ club: 'Club Exemple Natation' })).toBe(false);
    expect(swimsForClub({})).toBe(false);
  });
});

describe('nouvelle version de l’historique dans l’application', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const m = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('retire les courses d’historique qui n’y sont plus, sans toucher aux résultats trouvés en direct', async () => {
    vi.resetModules();
    const { initStore, actions, getState, batch } = await import('../src/store/store');
    await initStore();
    const id = actions.addSwimmer({ firstName: 'Emma', lastName: 'DUPONT', gender: 'F', birthYear: 2012, relation: 'child' }).id;
    const old = `${HEADER}
100m Libre\t25m\t1:20.00\t300\t12 oct 2019\tLiège\tMeeting d'automne
100m Libre\t25m\t1:10.00\t400\t11 oct 2025\tSeraing\tMeeting Janus`;
    actions.importSwimrankings({ swimmerId: id }, parseSwimrankings(old).swims, { select: false });
    // Un résultat trouvé en direct, à la même compétition d'un autre club
    const meet2019 = getState().meets.find((m) => m.name === "Meeting d'automne")!;
    batch(() => {
      actions.addSwim({ swimmerId: id, meetId: undefined, context: 'competition', date: '2026-11-14', distance: 50, stroke: 'BACK', course: 'SCM', timeCs: 4242, status: 'OK', round: 'TIM', timing: 'electronic', source: 'live' } as never);
    });
    expect(getState().swims.filter((s) => s.swimmerId === id)).toHaveLength(3);

    // Nouvelle version : la course de 2019 (autre club) n'y est plus
    const next = keepClubRaces(
      `${HEADER}
100m Libre\t25m\t1:20.00\t300\t12 oct 2019\tLiège\tMeeting d'automne\tBEL - Club Exemple Natation
100m Libre\t25m\t1:10.00\t400\t11 oct 2025\tSeraing\tMeeting Janus\tBEL - Ecole Seraing Natation`,
      CLUB.match,
    ).text;
    expect(actions.pruneHistorySwims(id, parseSwimrankings(next).swims)).toBe(1);
    const left = getState().swims.filter((s) => s.swimmerId === id);
    expect(left.map((s) => s.date).sort()).toEqual(['2025-10-11', '2026-11-14']);
    // La compétition restée vide disparaît aussi
    expect(getState().meets.some((m) => m.id === meet2019.id)).toBe(false);
  });
});
