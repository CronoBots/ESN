import { describe, expect, it } from 'vitest';
import { looksLikeClubReport, parseClubReport, parseMeetHeader } from '../src/lib/clubReport';
import { groupLines } from '../src/lib/pdfText';

// Données fictives, au format des rapports « résultats par club » (Splash)
const PDFJS_LINES = [
  'Championnat de District 2026',
  'FFBN - Bastogne (25m) - Du samedi 17 octobre 2026 au dimanche 18 octobre 2026',
  'DUPONT Emma   CLUB/012345/14   12 ans',
  '2   50m Nage Libre   00:36,56   25m   00:35,45   11',
  '00:41,83 (50m)',
  '3   100m Nage Libre   01:25,55   25m   01:21,06   9   00:41,83 (50m)',
  '6   400m Nage Libre   NT   25m   06:01,20   4   00:41,90 (50m) - 01:27,52 (100m) - 02:13,04 (150m) - 02:58,90 (200m)',
  '03:45,16 (250m) - 04:31,36 (300m) - 05:17,10 (350m)',
  '22   100m Brasse - Séries   01:56,72   25m   01:52,11   7',
  '23   100m Brasse - Finale   01:56,72   25m   01:50,94   3',
  '28   100m 4 Nages   59:59,99   25m   01:41,10   8',
  '30   4x50m Nage Libre   02:40,00   25m   02:38,00   2',
  'VAN DEN BERG Léa-Marie   CLUB/054321/13 13 ans',
  '17   50m Dos   00:44,10   25m   DSQ',
  '18   200m Dos   03:30,10   25m   03:21,44   5',
];

const PDFTOTEXT_LINES = `                        Meeting d'hiver
                        CNX - 4053 - Embourg (50m) - Dimanche 18 Janvier 2026



 DUPONT Emma            CLUB/012345/1412 ans


2   50m Nage Libre           00:34,56   50m
                                              00:34,45   11

4   200m Nage Libre          02:44,21   50m
                                              02:45,49   7    00:37,22 (50m) - 01:18,58 (100m) - 02:02,06 (150m)
`.split('\n');

describe('rapports de résultats du club', () => {
  it('reconnaît un rapport', () => {
    expect(looksLikeClubReport(PDFJS_LINES)).toBe(true);
    expect(looksLikeClubReport(['Résultats globaux', 'Epreuve 1 Dames 50m Libre'])).toBe(false);
  });

  it('lit l’en-tête de la compétition', () => {
    expect(parseMeetHeader(PDFJS_LINES)).toEqual({
      name: 'Championnat de District 2026',
      organizer: 'FFBN',
      city: 'Bastogne',
      course: 'SCM',
      startDate: '2026-10-17',
      endDate: '2026-10-18',
    });
    expect(parseMeetHeader(PDFTOTEXT_LINES)).toMatchObject({ name: "Meeting d'hiver", city: 'Embourg', course: 'LCM', startDate: '2026-01-18' });
  });

  it('lit les nageurs et leurs courses (pdf.js : résultat sur la même ligne)', () => {
    const r = parseClubReport(PDFJS_LINES)!;
    expect(r.swimmers).toHaveLength(2);
    const [emma, lea] = r.swimmers;
    expect(emma).toMatchObject({ lastName: 'Dupont', firstName: 'Emma', birthYear: 2014, club: 'CLUB' });
    // le relais 4x50m est ignoré
    expect(emma.swims).toHaveLength(6);
    expect(emma.swims[0]).toMatchObject({ distance: 50, stroke: 'FREE', course: 'SCM', entryCs: 3656, timeCs: 3545, place: 11 });
    expect(emma.swims[1]).toMatchObject({ distance: 100, timeCs: 8106, place: 9, splits: [4183] });
    expect(emma.swims[2].splits).toEqual([4190, 8752, 13304, 17890, 22516, 27136, 31710]);
    expect(emma.swims[2].entryCs).toBeUndefined();
    expect(emma.swims[3]).toMatchObject({ stroke: 'BREAST', round: 'HEAT', timeCs: 11211 });
    expect(emma.swims[4]).toMatchObject({ round: 'FINAL', timeCs: 11094, place: 3 });
    expect(emma.swims[5]).toMatchObject({ stroke: 'IM', entryCs: undefined, timeCs: 10110 });
    expect(lea).toMatchObject({ lastName: 'Van Den Berg', firstName: 'Léa-Marie', birthYear: 2013 });
    expect(lea.swims[0]).toMatchObject({ distance: 50, stroke: 'BACK', status: 'DSQ' });
    expect(lea.swims[0].timeCs).toBeUndefined();
    expect(lea.swims[1]).toMatchObject({ distance: 200, timeCs: 20144 });
  });

  it('lit le format « texte » (résultat sur la ligne suivante)', () => {
    const r = parseClubReport(PDFTOTEXT_LINES)!;
    expect(r.swimmers[0]).toMatchObject({ lastName: 'Dupont', birthYear: 2014 });
    expect(r.swimmers[0].swims).toHaveLength(2);
    expect(r.swimmers[0].swims[1]).toMatchObject({ distance: 200, course: 'LCM', timeCs: 16549, place: 7, splits: [3722, 7858, 12206] });
  });

  it('regroupe les cellules décalées d’une même rangée (pdf.js)', () => {
    const item = (str: string, x: number, y: number, width = str.length * 3) => ({ str, transform: [1, 0, 0, 1, x, y], width });
    const lines = groupLines([
      item('2', 34, 686.5),
      item('50m Nage Libre', 46, 686.5),
      item('00:34,56', 181, 687.8),
      item('25m', 210, 688.8),
      item('00:34,45', 228, 686.5),
      item('11', 268, 687.8),
      item('00:35,83 (50m)', 283, 677.7),
      item('3', 34, 675.2),
      item('100m Nage Libre', 46, 675.2),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^2 +50m Nage Libre +00:34,56 +25m +00:34,45 +11$/);
    expect(lines[1]).toMatch(/^3 +100m Nage Libre +00:35,83 \(50m\)$/);
  });
});
