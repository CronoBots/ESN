import { describe, expect, it } from 'vitest';
import { findSwimmerEntry, findSwimmerResult, lapsToSplits, parseSheetHeader } from '../src/lib/resultSheet';
import { parseMeetDocs } from '../src/lib/liveResults';

// Lectures (OCR) d'une même photo, bruitées comme sur une vraie photo — noms fictifs
const READ_A = `- 7
Be aR RTE A OEE. Ta mé
Meeting d'automne du Club
Epreuve 29
14-11-26 - 15:5 Dames, 100m Libre 11 anse
Points: AQUA 2026 20 Liste résultats
 1. MARTIN, Léa         14 Club Exemple     1:04.98  453  31.51  33.47
 17. DUPONT, Emma        15 Esn ; 1:22.17 224 a res
`;
const READ_B = ` | |
Meeting d'automne du Club
4000 Liège, 13- - 15-11-2026
Epreuve 29
14-11-26 - 15:50 Beue=scan des Liste résultats
 7 17. DUPONT, Emma 15 Esn 1:22.17 224 38.69 43.48
`;

describe('feuilles de résultats affichées (photo)', () => {
  it('lit l’en-tête en combinant les lectures', () => {
    expect(parseSheetHeader([READ_A, READ_B])).toEqual({
      meetName: "Meeting d'automne du Club",
      city: 'Liège',
      startDate: '2026-11-13',
      endDate: '2026-11-15',
      eventNo: 29,
      date: '2026-11-14',
      startTime: '15:50',
      gender: 'F',
      distance: 100,
      stroke: 'FREE',
      round: 'TIM',
    });
  });

  it('trouve et vérifie le temps du nageur', () => {
    const r = findSwimmerResult([READ_A, READ_B], { firstName: 'Emma', lastName: 'Dupont', birthYear: 2015, gender: 'F' })!;
    expect(r).toMatchObject({ place: 17, status: 'OK', timeCs: 8217, points: 224, laps: [3869, 4348], course: 'SCM', verified: true });
    expect(lapsToSplits(r.laps)).toEqual([3869]);
  });

  it('gère les disqualifications et les chiffres sans virgule', () => {
    const t = `Meeting d'automne du Club
4000 Liège, 13- - 15-11-2026
Epreuve 39 15-11-26 - 16:20 Dames, 50m Brasse
 5. DUPONT, Emma 155 Bemis IL 5052 177
disq. DURAND, Zoé 15 Esn 52.37`;
    const emma = findSwimmerResult([t], { firstName: 'Emma', lastName: 'Dupont', gender: 'F' })!;
    expect(emma).toMatchObject({ place: 5, timeCs: 5052, points: 177, verified: true, course: 'SCM' });
    const zoe = findSwimmerResult([t], { firstName: 'Zoé', lastName: 'Durand', gender: 'F' })!;
    expect(zoe).toMatchObject({ status: 'DSQ', timeCs: 5237, place: undefined });
  });

  it('ne trouve rien pour un nageur absent', () => {
    expect(findSwimmerResult([READ_A], { firstName: 'Paul', lastName: 'Absent' })).toBeNull();
  });
});

describe('nom partiellement lu', () => {
  it('accepte un nom coupé si le prénom et l’année correspondent', () => {
    const t = `Epreuve 27 14-11-26 - 15:30 Dames, 50m Dos
.     PONT, Emma                   15 Esn                               42.42 210`;
    const r = findSwimmerResult([t], { firstName: 'Emma', lastName: 'Dupont', birthYear: 2015, gender: 'F' });
    expect(r).toMatchObject({ timeCs: 4242, points: 210, verified: true });
    // sans année concordante : pas de correspondance partielle
    expect(findSwimmerResult([t], { firstName: 'Emma', lastName: 'Dupont', birthYear: 2012, gender: 'F' })).toBeNull();
  });
});

describe('place illisible', () => {
  it('déduit la place des lignes voisines', () => {
    const t = `Epreuve 27 14-11-26 - 15:30 Dames, 50m Dos
5 MARTIN, Léa 15 Club Exemple 38.48 281
:. DUPONT, Emma 15 Esn 42.42 210
3. DURAND, Zoé 15 Club 42.92 203
4. PETIT, Ana 15 Club 45.14 174
5. ROBERT, Lou 15 Club 45.64 168`;
    const r = findSwimmerResult([t], { firstName: 'Emma', lastName: 'Dupont', birthYear: 2015, gender: 'F' })!;
    expect(r).toMatchObject({ place: 2, timeCs: 4242 });
  });
});

describe('listes de départ (PDF des compétitions)', () => {
  const START = `Meeting d'automne
4000 Liège, 13- - 15-11-2026
Epreuve 9   Messieurs, 100m Brasse   11 ans et plus
13-11-26 - 19:15   Liste des séries
AN
Série 2 de 3
1 MARTIN, Lucas   12   Club Exemple   1:31.20
3 DUPONT, Hugo   14   Esn   1:25.78
4 DUPONT, Hugo   11   Autre Club   NT
Splash Meet Manager   Page 1`;

  it('retrouve la série, la ligne et le temps d’engagement', () => {
    expect(findSwimmerEntry(START, { firstName: 'Hugo', lastName: 'Dupont', birthYear: 2014, gender: 'M' })).toEqual({
      heat: 2,
      lane: 3,
      entryCs: 8578,
    });
    // Homonyme d'une autre année : seule la bonne ligne compte
    expect(findSwimmerEntry(START, { firstName: 'Hugo', lastName: 'Dupont', birthYear: 2011, gender: 'M' })).toEqual({
      heat: 2,
      lane: 4,
      entryCs: undefined,
    });
    expect(findSwimmerEntry(START, { firstName: 'Léa', lastName: 'Dupont', birthYear: 2014, gender: 'F' })).toBeNull();
    const h = parseSheetHeader([START]);
    expect(h).toMatchObject({ eventNo: 9, distance: 100, stroke: 'BREAST', gender: 'M', date: '2026-11-13', startTime: '19:15' });
  });

  it('dates avec des barres et séries éliminatoires (livetiming de la fédération)', () => {
    const fed = `Championnats de Belgique Test 2026
Bastogne, 20 - 22/11/2026
Epreuve 75   Garçons, 200m Brasse   Jeunesse/Jeugd 2
22/11/2026 - 16:20   Liste des séries
AN
Série 1 de 4
5 DUPONT, Hugo   12   Esn   2:52.81`;
    expect(parseSheetHeader([fed])).toMatchObject({ eventNo: 75, distance: 200, stroke: 'BREAST', gender: 'M', round: 'TIM', date: '2026-11-22', startTime: '16:20' });
    expect(findSwimmerEntry(fed, { firstName: 'Hugo', lastName: 'Dupont', birthYear: 2012, gender: 'M' })).toEqual({ heat: 1, lane: 5, entryCs: 17281 });
    const heats = fed.replace('Epreuve 75', 'Epreuve 1').replace('22/11/2026 - 16:20   Liste des séries', '20/11/2026 - 8:30   Liste des séries Eliminatoires');
    expect(parseSheetHeader([heats])).toMatchObject({ round: 'HEAT', date: '2026-11-20', startTime: '08:30' });
    expect(parseSheetHeader([fed.replace('Liste des séries', 'Liste des résultats Finale')]).round).toBe('FINAL');
    expect(parseSheetHeader([fed.replace('Liste des séries', 'Liste des résultats Finale directe')]).round).toBe('TIM');
  });

  it('liste les feuilles publiées sur la page de la compétition', () => {
    const docs = parseMeetDocs(
      '<a href="StartList_1.pdf">x</a><a href="StartList_2.pdf">x</a><a href="ResultList_1.pdf">x</a><a href="EntryStatistics.pdf">x</a>',
    );
    expect([...docs.results.keys()]).toEqual([1]);
    expect([...docs.starts.keys()]).toEqual([1, 2]);
    expect(docs.stats).toBe('EntryStatistics.pdf');
  });
});
