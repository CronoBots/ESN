import { describe, expect, it } from 'vitest';
// @ts-expect-error script Node sans types
import { GAP, RESULT_GAP, resultSheets, shouldDeploy } from '../scripts/live-relay.mjs';

describe('relais du direct : déployer maintenant ?', () => {
  it('nouvelle feuille de résultats : dès 75 s après le déploiement précédent', () => {
    expect(RESULT_GAP).toBe(75000);
    expect(shouldDeploy({ changed: true, newResult: true, sinceLast: 60000 })).toBe(false);
    expect(shouldDeploy({ changed: true, newResult: true, sinceLast: 76000 })).toBe(true);
  });

  it('autre changement de la page (listes de départ…) : 3 minutes au moins', () => {
    expect(GAP).toBe(180000);
    expect(shouldDeploy({ changed: true, newResult: false, sinceLast: 120000 })).toBe(false);
    expect(shouldDeploy({ changed: true, newResult: false, sinceLast: 181000 })).toBe(true);
  });

  it('page inchangée : jamais', () => {
    expect(shouldDeploy({ changed: false, newResult: false, sinceLast: 3600000 })).toBe(false);
  });

  it('seules les feuilles de résultats comptent', () => {
    const html = '<a href="StartList_3.pdf">x</a><a href="ResultList_2.pdf">y</a><a href="ResultList_2.pdf">y</a><a href="EntryStatistics.pdf">z</a><a href="Meet.lxf">l</a>';
    expect(resultSheets(html)).toEqual(['ResultList_2.pdf']);
  });
});
