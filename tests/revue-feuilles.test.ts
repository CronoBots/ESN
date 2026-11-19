import { describe, expect, it } from 'vitest';
import { findSwimmerResult } from '../src/lib/resultSheet';
import { parseResultSheet } from '../src/lib/heatSheet';
import { parseLenex } from '../src/lib/lenex';

// Feuilles et fichiers fictifs (noms et temps inventés)
const HEAD = `Meeting d'automne
4000 Liège, 13- - 15-11-2026
Epreuve 27   Dames, 50m Dos   11 ans et plus
14-11-26 - 15:30   Liste résultats
Rang   AN   Temps   Pts`;
const LEA = { firstName: 'Léa', lastName: 'Dupont', birthYear: 2015, gender: 'F' as const };
const ESN = /\besn\b/i;
const sheet = (...rows: string[]) => [HEAD, ...rows].join('\n');

describe('feuille de résultats : la ligne d’un homonyme n’est pas attribuée au nageur (import-2)', () => {
  it('écarte un prénom plus long (« Léane » n’est pas « Léa »)', () => {
    const t = sheet('1.   DUPONT, Léane   15   Esn   38.48   281');
    expect(findSwimmerResult([t], LEA, undefined, ESN)).toBeNull();
  });

  it('écarte un homonyme d’une autre année, même avec un temps', () => {
    const t = sheet('1.   DUPONT, Léa   13   Esn   38.48   281');
    expect(findSwimmerResult([t], LEA, undefined, ESN)).toBeNull();
  });

  it('ne prend pas le club sur la ligne d’un autre nageur classé ou disqualifié', () => {
    expect(findSwimmerResult([sheet('3.   DUPONT, Léa   15   Club Exemple   45.10   150', '4.   MARTIN, Zoé   15   Esn   46.00   140')], LEA, undefined, ESN)).toBeNull();
    expect(findSwimmerResult([sheet('3.   DUPONT, Léa   15   Club Exemple   45.10   150', 'disq.   MARTIN, Zoé   15   Esn   46.00')], LEA, undefined, ESN)).toBeNull();
  });

  it('garde la suite d’une ligne coupée (club sur la ligne suivante)', () => {
    const r = findSwimmerResult([sheet('5.   DUPONT, Léa   15   42.42   210', 'Esn')], LEA, undefined, ESN);
    expect(r).toMatchObject({ place: 5, timeCs: 4242 });
  });

  it('rend sa propre ligne quand sa sœur, plus rapide, est imprimée avant', () => {
    const t = sheet('1.   DUPONT, Léane   13   Esn   38.48   281', '2.   DUPONT, Léa   15   Esn   42.42   210');
    expect(findSwimmerResult([t], LEA, undefined, ESN)).toMatchObject({ place: 2, timeCs: 4242, points: 210 });
  });

  it('ne reprend pas le rang d’un homonyme quand le sien est illisible', () => {
    const t = sheet('1.   DUPONT, Léa   13   Club Exemple   38.00   300', '     MARTIN, Zoé   14   Club Exemple   40.00   250', '     DUPONT, Léa   15   Esn   42.42   210');
    const r = findSwimmerResult([t], LEA, undefined, ESN)!;
    expect(r).toMatchObject({ timeCs: 4242 });
    expect(r.place).toBeUndefined();
  });
});

describe('liste résultats : catégories écrites en chiffres (import-7)', () => {
  it('ouvre une catégorie pour « 11 - 12 ans » et « 13 ans et plus »', () => {
    const t = sheet(
      'Benjamines',
      '1.   MARTIN, Zoé   15   Club Exemple   38.48   281',
      '2.   DUPONT, Léa   15   Esn   42.42   210',
      '11 - 12 ans',
      '1.   DURAND, Ana   13   Esn   36.10   340',
      '2.   PETIT, Lou   14   Club Exemple   37.20   311',
      '13 ans et plus',
      '1.   ROBERT, Inès   12   Club Exemple   35.00   360',
    );
    const res = parseResultSheet(t).results;
    expect(res.map((g) => [g.category, g.rows.map((r) => r.place)])).toEqual([
      ['Benjamines', [1, 2]],
      ['11 - 12 ans', [1, 2]],
      ['13 ans et plus', [1]],
    ]);
  });
});

/** Fichier LENEX fictif : une épreuve par tour, avec son classement. */
function lef(events: { id: number; round: string; place: number; technique?: string }[]): string {
  const ev = events
    .map(
      (e) => `<EVENT eventid="${e.id}" number="${e.id}" round="${e.round}">
  <SWIMSTYLE distance="50" relaycount="1" stroke="FREE"${e.technique ? ` technique="${e.technique}"` : ''} />
  <AGEGROUPS><AGEGROUP agegroupid="${e.id}" agemax="-1" agemin="-1"><RANKINGS><RANKING place="${e.place}" resultid="${e.id}" /></RANKINGS></AGEGROUP></AGEGROUPS>
</EVENT>`,
    )
    .join('\n');
  const res = events.map((e) => `<RESULT eventid="${e.id}" resultid="${e.id}" swimtime="00:00:3${e.id % 10}.00" />`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<LENEX version="3.0"><MEETS><MEET city="Liège" name="Meeting fictif" course="SCM">
<SESSIONS><SESSION date="2026-10-10" number="1"><EVENTS>
${ev}
</EVENTS></SESSION></SESSIONS>
<CLUBS><CLUB name="Club Exemple"><ATHLETES><ATHLETE firstname="Emma" lastname="Dupont" birthdate="2012-03-04" gender="F"><RESULTS>
${res}
</RESULTS></ATHLETE></ATHLETES></CLUB></CLUBS>
</MEET></MEETS></LENEX>`;
}

describe('LENEX : barrages et quarts de finale (import-10)', () => {
  it('lit un barrage comme une course sans place, et un quart de finale comme une série', () => {
    const r = parseLenex(
      lef([
        { id: 1, round: 'PRE', place: 8 },
        { id: 2, round: 'SOP', place: 1 },
        { id: 3, round: 'SOS', place: 1 },
        { id: 4, round: 'QUA', place: 5 },
        { id: 5, round: 'SOQ', place: 2 },
      ]),
    )!;
    expect(r.athletes[0].swims.map((s) => [s.eventNo, s.round, s.place])).toEqual([
      [1, 'HEAT', 8],
      [2, 'HEAT', undefined],
      [3, 'HEAT', undefined],
      [4, 'HEAT', 5],
      [5, 'HEAT', undefined],
    ]);
  });
});

describe('LENEX : épreuves spéciales (import-11)', () => {
  it('ignore les épreuves avec une technique (jambes, bras…)', () => {
    const r = parseLenex(
      lef([
        { id: 1, round: 'TIM', place: 3 },
        { id: 2, round: 'TIM', place: 1, technique: 'KICK' },
        { id: 3, round: 'TIM', place: 2, technique: 'PULL' },
      ]),
    )!;
    expect(r.athletes[0].swims.map((s) => s.eventNo)).toEqual([1]);
  });
});
