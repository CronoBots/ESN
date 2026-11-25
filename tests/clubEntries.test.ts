import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announcedTotals, entriesReport, entryTime, mergeEntries, parseClubEntries } from '../src/lib/clubEntries';
import { entryTargets } from '../src/lib/entryTargets';
import { parseQualifying } from '../src/lib/qualifying';
import { decryptEntries, encryptEntries } from '../src/lib/roster';
import type { Swim } from '../src/store/types';

/*
 * Inscriptions du club à une compétition (fichier « inscription_ESN_pour_… », texte pdftotext -layout).
 * Compétition, nageurs et temps fictifs, au format du fichier réel.
 */
const TEXT = `                                        Meeting fictif de la Ville de Testville
                                        TST - Testville (25m) - Du samedi 12 décembre 2026 au dimanche 13 décembre 2026
                                        PISCINE DE TESTVILLE



Samedi 12 Décembre 2026 session1 sa       Dimanche 13 Décembre 2026 session 4 dim                        Entraîneurs
08:00   Echauffement                      08:00  Echauffement
                                                                                                            A DESIGNER
09:00   1   200m Dos Dames                09:00  27 200m 4 Nages Dames
        2   50m Brasse Dames                     28 50m Dos Dames                                        Délégués
        3   50m Brasse Messieurs                 29 50m Dos Messieurs                                       A DESIGNER
        9   4 x 50m 4 Nages Dames                35 4 x 200m Nage Libre Dames
Samedi 12 Décembre 2026 session 2 sa      Dimanche 13 Décembre 2026 session 5 dim
12:00   Echauffement                      12:00  Echauffement
13:00   10 200m Nage Libre Dames          13:00  36 100m 4 Nages Dames
        11 100m Nage Libre Dames                 40 100m Dos Messieurs


DUPONT Lina                             ESN/100001/15             11 ans
                                                                    50m : ()                    R-Club : 00:40,15   R-Dis : 00:37,36
  2 50m Brasse                                     00:43,17 25m     25m : 00:43,17 (13/11/26)   R-ClubTC : 00:33,64 R-Fran : 00:36,20
                                                                    50m : ()                    R-Club : 01:05,65   R-Dis : 01:04,67    R-BEL : 01:03,31
 11 100m Nage Libre                                59:59,99 Fic     25m : ()                    R-ClubTC : 00:59,13 R-Fran : 01:04,51
                                                                    50m : ()                    R-Club : 02:35,05
 10 200m Nage Libre Canetons - 13:00 13:00 59:59,99 Fic             25m : ()                    R-ClubTC : 02:02,82
\fVAN DER BERG MARTINEZ Alexandr ESN/100002/13          13 ans
                                                 50m : 00:42,10 (24/01/26)   R-Club : 01:07,48   R-Dis : 01:03,00
40 100m Dos                   01:15,54 25m       25m : 01:15,54 (30/05/26)   R-ClubTC : 01:00,36 R-Fran : 01:01,00
                                                 50m : ()                    R-Club : 00:33,00   R-Dis : 00:30,00
29 50m Dos                    00:35,10 50m       25m : ()                    R-ClubTC : 00:27,00 R-Fran : 00:29,00



                                                                                                                2 nageurs - 5 départs
`;

describe('inscriptions du club : lecture du fichier', () => {
  const meet = parseClubEntries(TEXT);

  it('compétition, ville, organisateur, bassin et dates', () => {
    expect(meet).toMatchObject({ name: 'Meeting fictif de la Ville de Testville', city: 'Testville', organizer: 'TST', course: 'SCM', startDate: '2026-12-12', endDate: '2026-12-13' });
    expect(announcedTotals(TEXT)).toEqual({ swimmers: 2, starts: 5 });
    expect(meet.athletes.reduce((n, a) => n + a.entries.length, 0)).toBe(5);
  });

  it('nageurs : nom en capitales (plusieurs mots), prénom, année tirée de la licence, sexe du programme ; nom long collé à la licence', () => {
    expect(meet.athletes.map((a) => [a.lastName, a.firstName, a.birthYear, a.gender])).toEqual([
      ['DUPONT', 'Lina', 2015, 'F'],
      ['VAN DER BERG MARTINEZ', 'Alexandr', 2013, 'M'],
    ]);
  });

  it('épreuves : jour et heure de la session (deux colonnes du programme), temps d’engagement, « Fic » = sans temps, catégorie', () => {
    const [lina, alex] = meet.athletes;
    expect(lina.entries[0]).toMatchObject({ eventNo: 2, distance: 50, stroke: 'BREAST', date: '2026-12-12', startTime: '09:00', entryCs: 4317, entryCourse: 'SCM' });
    expect(lina.entries[1]).toMatchObject({ eventNo: 11, distance: 100, stroke: 'FREE', date: '2026-12-12', startTime: '13:00' });
    expect(lina.entries[1].entryCs).toBeUndefined();
    expect(lina.entries[2]).toMatchObject({ eventNo: 10, distance: 200, stroke: 'FREE', category: 'Canetons', startTime: '13:00' });
    expect(alex.entries[0]).toMatchObject({ eventNo: 40, stroke: 'BACK', date: '2026-12-13', startTime: '13:00' });
    // Temps d'engagement nagé en 50 m
    expect(alex.entries[1]).toMatchObject({ eventNo: 29, date: '2026-12-13', startTime: '09:00', entryCs: 3510, entryCourse: 'LCM' });
  });

  it('records officiels de son âge : club, club toutes catégories, district, francophone, Belgique', () => {
    expect(meet.athletes[0].entries[1].records).toEqual({ club: 6565, clubAll: 5913, district: 6467, francophone: 6451, belgian: 6331 });
    expect(meet.athletes[0].entries[2].records).toEqual({ club: 15505, clubAll: 12282 });
    expect(entryTime('59:59,99')).toBeUndefined();
    expect(entryTime('10:26,55')).toBe(62655);
  });

  it('format d’import : programme pas encore nagé, records gardés', () => {
    const r = entriesReport(meet, meet.athletes[0]);
    expect(r.source).toBe('club');
    expect(r.meet).toMatchObject({ name: meet.name, city: 'Testville', course: 'SCM' });
    expect(r.swims[0]).toMatchObject({ eventNo: 2, round: 'TIM', status: 'OK', entryCs: 4317, date: '2026-12-12', startTime: '09:00', records: { club: 4015 } });
    expect(r.swims[0]).not.toHaveProperty('timeCs');
  });

  it('fichier publié : la même compétition est remplacée, les anciennes retirées ; chiffré et relu', async () => {
    const old = { ...meet, startDate: '2026-09-01', endDate: undefined, city: 'Ailleurs' };
    let file = mergeEntries(null, old, '2026-09-01');
    file = mergeEntries(file, meet, '2026-11-25');
    expect(file.meets.map((m) => m.city)).toEqual(['Testville']); // l'ancienne (terminée depuis plus de 30 jours) est retirée
    file = mergeEntries(file, { ...meet, athletes: meet.athletes.slice(0, 1) }, '2026-11-26');
    expect(file.meets).toHaveLength(1);
    expect(file.meets[0].athletes).toHaveLength(1);
    const enc = await encryptEntries(file, 'CODE-TEST', 1000);
    expect(enc.format).toBe('esn-entries');
    expect(JSON.stringify(enc)).not.toMatch(/DUPONT|Lina/);
    expect(await decryptEntries(enc, 'CODE-TEST')).toEqual(file);
  });
});

describe('temps à viser sur une épreuve du programme', () => {
  const data = parseQualifying({
    updated: 'x',
    championships: [
      {
        id: 'bk-11-14-test',
        name: 'Championnats de Belgique 11-14 ans',
        course: 'LCM',
        until: '2027-08-31',
        edition: 2027,
        limitsEdition: 2026,
        window: { from: '2026-01-01', to: '2027-07-01' },
        accepts: ['SCM', 'LCM'],
        source: 'https://example.org',
        limits: { F: { '100-FREE': { '13': '1:06.67' } }, M: {} },
      },
    ],
  });
  const sw = { id: 'z', gender: 'F' as const, birthYear: 2014 }; // 13 ans en 2027
  const swim = (p: Partial<Swim>): Swim =>
    ({ id: Math.random().toString(36), swimmerId: 'z', context: 'competition', date: '2026-11-13', distance: 100, stroke: 'FREE', course: 'SCM', timeCs: null, status: 'OK', round: 'TIM', timing: 'electronic', source: 'club', createdAt: 0, updatedAt: 0, ...p }) as Swim;
  const short = () => 'Belgique 11-14 ans';

  it('limite à atteindre et record du club de son âge, du plus accessible au plus difficile, avec l’écart', () => {
    const pb = swim({ timeCs: 6779, source: 'swimrankings' });
    const entry = swim({ date: '2026-12-12', entryCs: 6779, records: { club: 6216 } });
    const t = entryTargets(entry, sw, [pb, entry], data, '2026-11-25', short);
    expect(t).toEqual([
      { kind: 'limit', cs: 6667, label: 'Belgique 11-14 ans', gapCs: 112 },
      { kind: 'club', cs: 6216, label: 'record du club 12 ans', gapCs: 563 },
    ]);
  });

  it('seulement à portée (10 %), rien sans aucun temps, rien de déjà atteint', () => {
    const far = swim({ date: '2026-12-12', entryCs: 9000, records: { club: 6216 } });
    expect(entryTargets(far, sw, [far], data, '2026-11-25', short)).toEqual([]);
    const nt = swim({ date: '2026-12-12', records: { club: 6216 } });
    expect(entryTargets(nt, sw, [nt], data, '2026-11-25', short)).toEqual([]);
    const pb = swim({ timeCs: 6100, source: 'swimrankings' });
    const done = swim({ date: '2026-12-12', entryCs: 6100, records: { club: 6216 } });
    expect(entryTargets(done, sw, [pb, done], data, '2026-11-25', short)).toEqual([]);
    // Épreuve déjà nagée : plus de temps à viser
    expect(entryTargets(swim({ timeCs: 6500 }), sw, [], data, '2026-11-25', short)).toEqual([]);
  });
});

describe('programme du club, puis résultats de l’organisateur', () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 });
    vi.stubGlobal('indexedDB', undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('le résultat publié sous un autre nom de compétition (même ville, mêmes dates) remplit le programme, sans doublon', async () => {
    vi.resetModules();
    const store = await import('../src/store/store');
    const meet = parseClubEntries(TEXT);
    const sw = store.actions.addSwimmer({ firstName: 'Lina', lastName: 'Dupont', gender: 'F', birthYear: 2015, relation: 'followed' });
    expect(store.actions.importClubResults(sw.id, [entriesReport(meet, meet.athletes[0])]).added).toBe(3);
    // Livetiming de l'organisateur : autre nom, même ville
    store.actions.importClubResults(sw.id, [
      {
        meet: { name: 'Last Chance Testville 2026', city: 'Testville', course: 'SCM', startDate: '2026-12-12', endDate: '2026-12-13', liveId: '1' },
        source: 'live',
        swims: [{ eventNo: 2, distance: 50, stroke: 'BREAST', course: 'SCM', round: 'TIM', timeCs: 4290, status: 'OK', place: 3, date: '2026-12-12' }],
      },
    ]);
    const mine = store.getState().swims.filter((s) => s.swimmerId === sw.id);
    expect(store.getState().meets).toHaveLength(1);
    expect(mine).toHaveLength(3);
    expect(mine.find((s) => s.eventNo === 2)).toMatchObject({ timeCs: 4290, place: 3, records: { club: 4015 } });
    // Engagement retiré du fichier republié : retiré du programme
    const meetId = mine[0].meetId!;
    expect(store.actions.dropClubEntries([meetId], new Set([`${sw.id}|2`, `${sw.id}|11`]))).toBe(1);
    expect(store.getState().swims.filter((s) => s.swimmerId === sw.id).map((s) => s.eventNo).sort()).toEqual([11, 2]);
  });
});
