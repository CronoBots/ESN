import { describe, expect, it } from 'vitest';
import { AGE_BANDS, bandForAge, clubRecords, recordHolders } from '../src/lib/clubRecords';
import type { Swim, Swimmer } from '../src/store/types';

const swimmer = (id: string, gender: 'F' | 'M', birthYear: number, extra: Partial<Swimmer> = {}): Swimmer =>
  ({ id, firstName: id, lastName: 'TEST', gender, birthYear, color: 0, relation: 'child', member: true, ...extra }) as Swimmer;

let n = 0;
const swim = (swimmerId: string, date: string, timeCs: number, extra: Partial<Swim> = {}): Swim =>
  ({
    id: `s${n++}`,
    swimmerId,
    context: 'competition',
    date,
    distance: 100,
    stroke: 'FREE',
    course: 'SCM',
    timeCs,
    status: 'OK',
    round: 'TIM',
    source: 'swimrankings',
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  }) as Swim;

const swimmers = [
  swimmer('ana', 'F', 2012),
  swimmer('bea', 'F', 2000, { former: true }),
  swimmer('cle', 'F', 2012, { member: false }),
  swimmer('dan', 'M', 2012),
];

describe('records du club', () => {
  it('garde le meilleur temps des membres (actuels et anciens) du bon sexe, en compétition', () => {
    const swims = [
      swim('ana', '2025-11-10', 6500),
      swim('bea', '2014-03-01', 6300),
      swim('cle', '2025-11-10', 6000), // pas membre du club
      swim('dan', '2025-11-10', 5900), // garçon
      swim('ana', '2025-12-01', 6100, { context: 'training' }), // entraînement
      swim('ana', '2025-12-02', 6000, { status: 'DSQ' }), // disqualifiée
    ];
    const rec = clubRecords(swims, swimmers, { course: 'SCM', gender: 'F' }).get('100-FREE');
    expect(rec?.swimmer.id).toBe('bea');
    expect(rec?.swim.timeCs).toBe(6300);
    expect(rec?.age).toBe(14);
  });

  it('par âge : âge dans l’année de la course ; à temps égal, le premier réalisé', () => {
    const swims = [swim('ana', '2024-02-01', 7000), swim('ana', '2025-01-15', 6800), swim('bea', '2012-05-01', 6800)];
    // ana (2012) : 12 ans en 2024, 13 ans en 2025 ; bea (2000) : 12 ans en 2012
    const at12 = clubRecords(swims, swimmers, { course: 'SCM', gender: 'F', band: AGE_BANDS.find((b) => b.id === '12') });
    expect(at12.get('100-FREE')).toMatchObject({ age: 12, swimmer: { id: 'bea' } });
    const at13 = clubRecords(swims, swimmers, { course: 'SCM', gender: 'F', band: AGE_BANDS.find((b) => b.id === '13') });
    expect(at13.get('100-FREE')).toMatchObject({ age: 13, swimmer: { id: 'ana' } });
    const tie = clubRecords(swims, swimmers, { course: 'SCM', gender: 'F' });
    expect(tie.get('100-FREE')?.swimmer.id).toBe('bea');
    expect(bandForAge(9)?.id).toBe('10');
    expect(bandForAge(30)?.id).toBe('18');
  });

  it('détenteurs d’au moins un record (toutes tranches d’âge, bassins et sexes)', () => {
    const extra = [...swimmers, swimmer('eve', 'F', 2000, { former: true }), swimmer('fay', 'F', 2000, { former: true })];
    const swims = [
      swim('ana', '2025-11-10', 6500),
      swim('bea', '2014-03-01', 6300), // record tous âges et 14 ans
      swim('eve', '2014-03-01', 6400), // battue partout (même âge que bea)
      swim('fay', '2026-03-01', 9000, { course: 'LCM' }), // seule en 50 m : record
      swim('dan', '2025-11-10', 5900),
      swim('cle', '2025-11-10', 5000), // pas membre
    ];
    const ids = recordHolders(swims, extra);
    expect([...ids].sort()).toEqual(['ana', 'bea', 'dan', 'fay']);
  });
});
