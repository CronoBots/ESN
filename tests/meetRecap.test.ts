import { describe, expect, it } from 'vitest';
import { liveClubMeets, meetQualifications, meetRecap, recapText } from '../src/lib/meetRecap';
import type { Championship } from '../src/lib/qualifying';
import type { PbInfo } from '../src/lib/stats';
import type { Meet, Swim, Swimmer } from '../src/store/types';

// Nageurs, compétition et courses fictifs
const sw = (id: string, firstName: string, lastName: string, gender: 'F' | 'M' = 'F', birthYear = 2013): Swimmer => ({
  id,
  firstName,
  lastName,
  gender,
  birthYear,
  color: 0,
  relation: 'followed',
  favorite: false,
  member: true,
  createdAt: 0,
});
const emma = sw('e', 'Emma', 'DUPONT');
const lea = sw('l', 'Léa', 'MARTIN');
const hugo = sw('h', 'Hugo', 'BERNARD', 'M', 2012);
const meet: Meet = { id: 'm', name: 'Championnats Test', city: 'Testville', course: 'SCM', startDate: '2026-11-20', endDate: '2026-11-22', createdAt: 0 };
let n = 0;
const swim = (o: Partial<Swim>): Swim => ({
  id: `s${n++}`,
  swimmerId: 'e',
  meetId: 'm',
  context: 'competition',
  date: '2026-11-20',
  distance: 100,
  stroke: 'FREE',
  course: 'SCM',
  timeCs: 7000,
  status: 'OK',
  round: 'TIM',
  source: 'live',
  createdAt: 0,
  updatedAt: 0,
  ...o,
});

const old = swim({ meetId: 'old', date: '2026-10-01', timeCs: 7200 }); // ancien record d'Emma
const s1 = swim({ timeCs: 7000, place: 2 }); // record perso, podium
const s2 = swim({ date: '2026-11-21', distance: 50, stroke: 'BACK', timeCs: 3500, round: 'HEAT', place: 12, eventNo: 5 });
const s3 = swim({ date: '2026-11-21', distance: 50, stroke: 'BACK', timeCs: 3480, round: 'FINAL', place: 6, eventNo: 45 });
const s4 = swim({ swimmerId: 'l', date: '2026-11-21', status: 'DSQ', timeCs: null });
const s5 = swim({ swimmerId: 'l', date: '2026-11-22', distance: 200, timeCs: null }); // au programme
const s6 = swim({ swimmerId: 'h', date: '2026-11-22', status: 'DNS', timeCs: null }); // forfait
const all = [old, s1, s2, s3, s4, s5, s6];
const pb = new Map<string, PbInfo>([[s1.id, { isPB: true, isFirst: false, deltaCs: -200, prevBestCs: 7200 }]]);

describe('récap de l’ESN à une compétition', () => {
  it('bilan par nageur et du club', () => {
    const r = meetRecap('m', all, [emma, lea, hugo], pb);
    expect(r.days).toEqual(['2026-11-20', '2026-11-21', '2026-11-22']);
    expect(r.swimmers.map((x) => x.swimmer.firstName)).toEqual(['Hugo', 'Emma', 'Léa']); // ordre des noms
    const e = r.swimmers.find((x) => x.swimmer.id === 'e')!;
    expect(e).toMatchObject({ total: 3, swum: 3, pbs: 1, gain: 200, podiums: 1, finals: 1 });
    expect(e.best?.id).toBe(s1.id); // 2e au temps, plutôt que 6e de la finale ou 12e des séries
    const l = r.swimmers.find((x) => x.swimmer.id === 'l')!;
    expect(l).toMatchObject({ total: 2, swum: 1, dsq: 1, pbs: 0 });
    expect(r.swimmers.find((x) => x.swimmer.id === 'h')).toMatchObject({ total: 0, swum: 0 }); // forfait : ni programme ni course
    expect(r).toMatchObject({ swum: 4, total: 5, pbs: 1, pbSwimmers: 1, podiums: 1 });
    expect(r.finals.map((f) => f.swim.id)).toEqual([s3.id]);
  });

  it('un seul jour', () => {
    const r = meetRecap('m', all, [emma, lea, hugo], pb, '2026-11-21');
    expect(r.swimmers.map((x) => x.swimmer.id)).toEqual(['e', 'l']);
    expect(r).toMatchObject({ swum: 3, pbs: 0, podiums: 0 });
  });

  it('records du club établis à la compétition', () => {
    // Emma détient le record du club du 100 m libre 25 m avec 1:10.00
    expect(meetRecap('m', all, [emma, lea, hugo], pb).records.map((x) => x.swim.id)).toContain(s1.id);
    // Une ancienne nageuse plus rapide : pas de record
    const ancienne = { ...sw('a', 'Anne', 'ANCIENNE'), former: true };
    const faster = swim({ swimmerId: 'a', meetId: 'x', date: '2019-05-01', timeCs: 6800 });
    expect(meetRecap('m', [...all, faster], [emma, lea, hugo, ancienne], pb).records.map((x) => x.swim.id)).not.toContain(s1.id);
  });

  it('temps limites atteints (nouvelle limite seulement)', () => {
    const c: Championship = {
      id: 'c',
      name: 'Championnats de Test',
      course: 'SCM',
      until: '2027-03-01',
      edition: 2027,
      limitsEdition: 2027,
      window: { from: '2026-09-01', to: '2027-02-15' },
      accepts: ['SCM', 'LCM'],
      source: '',
      limits: { F: { '100-FREE': { A: 7050, B: 7300 } }, M: {} },
      provisional: false,
    };
    const q = meetQualifications([s1, s2, s3], all, [emma], [c]);
    expect(q.map((x) => `${x.swim.id} ${x.label}`)).toEqual([`${s1.id} A`]);
    // B déjà atteinte avant (7200 ≤ 7300 dans la période) : A est une nouvelle limite ; sans gain de niveau, rien
    const already = swim({ meetId: 'p', date: '2026-10-15', timeCs: 6990 });
    expect(meetQualifications([s1], [...all, already], [emma], [c])).toEqual([]);
  });

  it('texte à partager', () => {
    const r = meetRecap('m', all, [emma, lea, hugo], pb);
    const t = recapText(meet, r, [], (c) => c.name, 'https://exemple.test/').replace(/\u00a0/g, ' ');
    expect(t).toContain('ESN · Championnats Test');
    expect(t).toContain('3 nageurs · 4 courses');
    expect(t).toContain('• Hugo BERNARD : forfait');
    expect(t).toContain('1 record perso (1 nageur)');
    expect(t).toContain('🏁 Finales');
    expect(t).toContain('• Emma DUPONT : 3 courses, 1 PB (−2.00), meilleure place 2e (100 m Libre)');
    expect(t).toContain('https://exemple.test/');
  });

  it('compétitions du club en cours', () => {
    expect(liveClubMeets([meet], all, [emma, lea], '2026-11-21').map((m) => m.id)).toEqual(['m']);
    expect(liveClubMeets([meet], all, [emma, lea], '2026-11-23')).toEqual([]);
    expect(liveClubMeets([meet], all, [{ ...emma, former: true }], '2026-11-21')).toEqual([]);
  });
});
