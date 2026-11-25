import { describe, expect, it } from 'vitest';
import { AGE_BANDS, clubRecords, recordHolders } from '../src/lib/clubRecords';
import { holderMatches, holderSwimmer, officialBest, officialRecordsBeaten, officialStandings, parseOfficialRecordsText, type OfficialRecordsList } from '../src/lib/officialRecords';
import { decryptOfficialRecords, encryptOfficialRecords } from '../src/lib/roster';
import type { Swim, Swimmer } from '../src/store/types';

// Extrait fictif de la liste du club (pdftotext -table) : noms inventés
const TEXT = [
  '                            Records Club                                                                    09/01/2026',
  '',
  '                                                                             Canetons  10 ans',
  '',
  'Filles            Temps     Nom                 Lieu & date                            Garçons           Temps                Nom       Lieu & date',
  '',
  '50m Nage Libre    00:33,43  DUPONT Emma         Crisnée (25m) - 25/11/2022             50m Nage Libre    00:33,08  MARTIN Hugo          Bastogne (25m) - 03/04/2009',
  '',
  '100m Nage Libre                                                                        100m Nage Libre   01:09,63  MARTIN Hugo',
  '',
  '50m Dos           00:38,59  DUPONT Emma         Duisburg (50m) - 11/05/2019            50m Dos           00:38,23  DURAND P.            4053 - Embourg (25m) - 07/11/2009',
  '',
  '200m Brasse       03:18,94  LEROY Zoé           Verviers (25m) - 11/12/2005            200m Brasse       59:59,99  A établir',
  '',
  '                                                                             Toutes  catégories',
  '',
  'Filles            Temps     Nom                 Lieu & date                            Garçons           Temps                Nom       Lieu & date',
  '',
  '100m 4 Nages      01:05,10  LEROY Zoé                                                  100m 4 Nages      00:59,90  MARTIN Hugo          (25m) - 25/04/2004',
].join('\n');

describe('liste officielle des records du club : lecture du PDF', () => {
  const { records, unread } = parseOfficialRecordsText(TEXT);

  it('lit chaque record, filles à gauche et garçons à droite, par catégorie', () => {
    expect(unread).toEqual([]);
    expect(records).toHaveLength(8);
    expect(records[0]).toEqual({ section: '10', gender: 'F', distance: 50, stroke: 'FREE', timeCs: 3343, holder: 'DUPONT Emma', place: 'Crisnée', course: 'SCM', date: '2022-11-25' });
    expect(records[1]).toMatchObject({ section: '10', gender: 'M', distance: 50, stroke: 'FREE', timeCs: 3308, holder: 'MARTIN Hugo', course: 'SCM', date: '2009-04-03' });
  });

  it('garde un record sans lieu ni date, le bassin de 50 m et le code postal retiré du lieu', () => {
    expect(records.find((r) => r.gender === 'M' && r.distance === 100 && r.section === '10')).toEqual({ section: '10', gender: 'M', distance: 100, stroke: 'FREE', timeCs: 6963, holder: 'MARTIN Hugo' });
    expect(records.find((r) => r.gender === 'F' && r.stroke === 'BACK')).toMatchObject({ course: 'LCM', place: 'Duisburg' });
    expect(records.find((r) => r.gender === 'M' && r.stroke === 'BACK')).toMatchObject({ holder: 'DURAND P.', place: 'Embourg', date: '2009-11-07' });
  });

  it('ignore les cases vides et « A établir », lit la section « Toutes catégories »', () => {
    expect(records.some((r) => r.gender === 'M' && r.stroke === 'BREAST')).toBe(false);
    expect(records.filter((r) => r.section === 'all').map((r) => [r.gender, r.timeCs, r.place ?? null, r.date ?? null])).toEqual([
      ['F', 6510, null, null],
      ['M', 5990, null, '2004-04-25'],
    ]);
  });

  it('reconnaît le détenteur, aussi écrit avec une initiale', () => {
    expect(holderMatches('DURAND P.', { lastName: 'Durand', firstName: 'Paul' })).toBe(true);
    expect(holderMatches('LEROY Zoé', { lastName: 'LEROY', firstName: 'Zoe' })).toBe(true);
    expect(holderMatches('LA FONTAINE Léa', { lastName: 'La Fontaine', firstName: 'Léa' })).toBe(true);
    expect(holderMatches('DURAND P.', { lastName: 'Durand', firstName: 'Marc' })).toBe(false);
  });
});

const swimmer = (id: string, gender: 'F' | 'M', birthYear: number, extra: Partial<Swimmer> = {}): Swimmer =>
  ({ id, firstName: id, lastName: 'TEST', gender, birthYear, color: 0, relation: 'child', member: true, ...extra }) as Swimmer;
let n = 0;
const swim = (swimmerId: string, date: string, timeCs: number, extra: Partial<Swim> = {}): Swim =>
  ({ id: `s${n++}`, swimmerId, context: 'competition', date, distance: 50, stroke: 'FREE', course: 'SCM', timeCs, status: 'OK', round: 'TIM', source: 'live', createdAt: 0, updatedAt: 0, ...extra }) as Swim;

const LIST: OfficialRecordsList = {
  title: 'RECORDS 31.12.2025',
  asOf: '2025-12-31',
  source: 'test',
  records: [
    { section: '10', gender: 'F', distance: 50, stroke: 'FREE', timeCs: 3343, holder: 'DUPONT Emma', course: 'SCM', date: '2022-11-25', verified: true },
    { section: '9', gender: 'F', distance: 50, stroke: 'FREE', timeCs: 3500, holder: 'DUPONT Emma' },
    { section: 'all', gender: 'F', distance: 50, stroke: 'FREE', timeCs: 2800, holder: 'LEROY Zoé' },
    { section: 'seniors', gender: 'F', distance: 50, stroke: 'FREE', timeCs: 2800, holder: 'LEROY Zoé' },
    { section: '18', gender: 'F', distance: 50, stroke: 'FREE', timeCs: 2900, holder: 'MOREL Lina' },
  ],
};
const ana = swimmer('ana', 'F', 2016); // 10 ans en 2026
const emma = swimmer('emma', 'F', 2012, { firstName: 'Emma', lastName: 'DUPONT', former: true });

describe('liste officielle des records du club : records d’aujourd’hui', () => {
  it('la liste fait foi avant sa date ; une course plus rapide nagée depuis devient le record', () => {
    const swims = [
      swim('ana', '2025-11-15', 3300), // avant la liste (à 9 ans de toute façon) : ignorée
      swim('ana', '2026-03-01', 3400), // plus lente que la liste
    ];
    const rows = officialStandings(LIST, swims, [ana, emma], 'F', '10');
    expect(rows).toHaveLength(1);
    expect(rows[0].newer).toBeUndefined();
    expect(rows[0].official?.timeCs).toBe(3343);
    expect(rows[0].holder?.id).toBe('emma');

    const faster = swim('ana', '2026-11-14', 3330, { course: 'LCM' });
    const now = officialStandings(LIST, [...swims, faster], [ana, emma], 'F', '10');
    expect(now[0].newer?.swim.id).toBe(faster.id);
    expect(now[0].official?.timeCs).toBe(3343);
  });

  it('une épreuve sans record dans la liste reçoit la première course nagée depuis', () => {
    const s = swim('ana', '2026-05-01', 4500, { stroke: 'BACK' });
    const rows = officialStandings(LIST, [s], [ana], 'F', '10');
    expect(rows.find((r) => r.stroke === 'BACK')?.newer?.swim.id).toBe(s.id);
  });

  it('records battus depuis la liste : une course une seule fois, à sa catégorie la plus large', () => {
    const zoe = swimmer('zoe', 'F', 2000); // 26 ans : seniors et toutes catégories
    const s = swim('zoe', '2026-10-10', 2750);
    const beaten = officialRecordsBeaten(LIST, [s], [zoe], '2026-01-01');
    expect(beaten).toHaveLength(1);
    expect(beaten[0].section.id).toBe('all');
    expect(beaten[0].previous?.timeCs).toBe(2800);
  });

  it('tranches d’âge de l’application : « 10 ans et moins » couvre 9 et 10 ans, « 18 ans et plus » les seniors', () => {
    expect(officialBest(LIST, 'F', '10', 50, 'FREE')?.timeCs).toBe(3343);
    expect(officialBest(LIST, 'F', '18', 50, 'FREE')?.timeCs).toBe(2800);
    expect(officialBest(LIST, 'F', 'masters', 50, 'FREE')).toBeUndefined();
    expect(officialBest(null, 'F', 'all', 50, 'FREE')).toBeUndefined();
  });

  it('un temps relevé plus lent que la liste n’est plus annoncé comme record du club', () => {
    const swims = [swim('ana', '2026-11-14', 3400)];
    const band = AGE_BANDS.find((b) => b.id === '10')!;
    expect(clubRecords(swims, [ana], { course: 'SCM', gender: 'F', band }).size).toBe(1);
    expect(clubRecords(swims, [ana], { course: 'SCM', gender: 'F', band, official: LIST }).size).toBe(0);
    const record = [swim('ana', '2026-11-14', 3340)];
    expect(clubRecords(record, [ana], { course: 'SCM', gender: 'F', band, official: LIST }).size).toBe(1);
  });

  it('le détenteur écrit autrement dans la liste est reconnu par les autres noms du membre', () => {
    const lea = swimmer('lea', 'F', 2009, { firstName: 'Léa', lastName: 'CAPELLE', aliases: [{ lastName: 'KAPELLE', firstName: 'Léa', birthYear: 2009 }] });
    expect(holderSwimmer({ holder: 'KAPELLE Léa', gender: 'F' }, [ana, lea])?.id).toBe('lea');
    expect(holderSwimmer({ holder: 'KAPELLE Léa', gender: 'M' }, [ana, lea])).toBeUndefined();
  });

  it('un ancien membre détenteur d’un record de la liste fait partie des détenteurs de records', () => {
    expect(holderSwimmer(LIST.records[0], [ana, emma])?.id).toBe('emma');
    expect(recordHolders([], [ana, emma], LIST).has('emma')).toBe(true);
    expect(recordHolders([], [ana, emma]).has('emma')).toBe(false);
  });

  it('se chiffre et se déchiffre avec le code du club', async () => {
    const enc = await encryptOfficialRecords(LIST, 'ESN-TEST-CODE', 1000);
    expect(enc.format).toBe('esn-records');
    expect(JSON.stringify(enc)).not.toContain('DUPONT');
    expect(await decryptOfficialRecords(enc, 'ESN-TEST-CODE')).toEqual(LIST);
  });
});
