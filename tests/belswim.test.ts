import { describe, expect, it } from 'vitest';
import { swimmerKey } from '../src/lib/pushKey';
import { categoryKey, officialEntry, rankingClosed, withOfficialBenchmarks, type OfficialRanking } from '../src/lib/officialRanking';
import { parseQualifying } from '../src/lib/qualifying';
// @ts-expect-error script Node sans types
import { nameSplits, parseRanking, publicRanking, swimmerKey as robotKey } from '../scripts/belswim-ranking.mjs';

// Page fictive au format de l'outil « Belswim ranking » (noms inventés)
const row = (rank: number, name: string, license: string, year: number, total: number, opts: { green?: boolean; scratched?: boolean } = {}) =>
  `<tr><td class="loreleitd"${opts.green ? ' bgcolor="#32CD32"' : ' bgcolor="FFFFFF"'} align="center"><b>${rank}</b></td>` +
  `<td class="loreleitd"><b><div class='content'><span title='Even geduld...' id='1_1' class='${opts.scratched ? 'geschrapt' : ''}'>${name}</span></div></b></td>` +
  `<td class="loreleitd"><b>${license}</b></td><td class="loreleitd"><b>M</b></td><td class="loreleitd"><b>${year}</b></td>` +
  `<td><b>300</b></td><td><b>300</b></td><td><b>300</b></td><td><b>300</b></td><td><b>300</b></td><td><b>0</b></td><td><b>${total}</b></td></tr>`;
const PAGE = `<h1>Ranking CB-BK 11-16 25m 2026</h1><b>Période du 1er janvier 2025 au 1er novembre 2026.</b>
<table><tr><td colspan="12"><strong><a id="13-14_M"></a>jeugd/jeunesse 2 (13-14)</strong></td></tr>
<tr><td>Rang</td><td>Nom</td></tr>
${row(1, 'Martin Léo', 'AAA/1/12', 2012, 2500, { green: true })}
${row(2, 'Dubois Hugo', 'BBB/2/12', 2012, 2400, { scratched: true })}
${row(3, 'Van Damme Noah', 'ESN/3/13', 2013, 2300, { green: true })}
${row(4, 'Petit Jules', 'ESNV/4/13', 2013, 2200)}
${row(5, 'Lambert Tom', 'ESN/5/13', 2013, 2100)}
${row(6, 'Simon Adam', 'ESN/6/13', 2013, 0)}
</table>`;

describe('classement officiel de la fédération (11-16 ans)', () => {
  it('lit l’édition, la période, les sélectionnés (vert), les retirés (barrés) et les seuls nageurs de l’ESN', () => {
    const p = parseRanking(PAGE);
    expect(p.edition).toBe(2026);
    expect(p.period).toEqual({ from: '2025-01-01', to: '2026-11-01' });
    expect(p.categories['13-14'].M).toEqual({ listed: 6, ranked: 5, selected: 2, last: { rank: 3, total: 2300 } });
    // ESNV est un autre club
    expect(p.swimmers.map((s: { name: string }) => s.name)).toEqual(['Van Damme Noah', 'Lambert Tom', 'Simon Adam']);
    expect(p.swimmers[0]).toMatchObject({ rank: 3, total: 2300, selected: true, scratched: false, cat: '13-14', gender: 'M' });
  });

  it('même empreinte que l’application, pour chaque coupure du nom ; aucun nom en clair publié', async () => {
    expect(nameSplits('Van Damme Noah')).toEqual([
      ['Van', 'Damme Noah'],
      ['Van Damme', 'Noah'],
    ]);
    expect(robotKey('Van Damme', 'Noah', 2013)).toBe(await swimmerKey({ lastName: 'VAN DAMME', firstName: 'Noah', birthYear: 2013 }));
    const pub = publicRanking(parseRanking(PAGE), '2026-11-24T03:23:00Z') as OfficialRanking;
    expect(JSON.stringify(pub)).not.toMatch(/Damme|Lambert|Simon|Martin/);
    const noah = await officialEntry(pub, { lastName: 'Van Damme', firstName: 'Noah', birthYear: 2013 });
    expect(noah).toMatchObject({ rank: 3, selected: true });
    // Pas assez d'épreuves : pas de rang
    expect(await officialEntry(pub, { lastName: 'Simon', firstName: 'Adam', birthYear: 2013 })).toMatchObject({ rank: null, total: 0 });
    expect(await officialEntry(pub, { lastName: 'Inconnu', firstName: 'Zoé', birthYear: 2013 })).toBeNull();
  });

  it('classement arrêté de l’an dernier : il fournit les repères (dernier sélectionné, total et rang)', () => {
    const pub = publicRanking(parseRanking(PAGE), '2026-11-24T03:23:00Z') as OfficialRanking;
    pub.categories['13-14'].F = { listed: 1, ranked: 1, selected: 1, last: { rank: 1, total: 2000 } };
    expect(rankingClosed(pub, '2026-10-31')).toBe(false);
    expect(rankingClosed(pub, '2026-11-02')).toBe(true);
    const c = parseQualifying({
      updated: 'x',
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
          allround: { categories: [{ label: 'Jeunes 2 (13-14 ans)', minAge: 13, maxAge: 14, selected: 70, events: ['100-FLY'], previous: { edition: 2026, cutoff: { F: 1, M: 1 } } }] },
        },
      ],
    }).championships[0];
    expect(categoryKey(c.allround!.categories[0])).toBe('13-14');
    const withBench = withOfficialBenchmarks(c, pub, '2026-11-24');
    expect(withBench.allround!.categories[0].previous).toEqual({ edition: 2026, cutoff: { F: 2000, M: 2300 }, rank: { F: 1, M: 3 } });
    // Classement de la même édition, ou pas encore arrêté : repères du fichier gardés
    expect(withOfficialBenchmarks(c, { ...pub, edition: 2027 }, '2026-11-24')).toBe(c);
    expect(withOfficialBenchmarks(c, pub, '2026-10-01')).toBe(c);
  });
});
