import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { latestRankText, normSeason, parseRankingsText, rankLabel, ranksFor } from '../src/lib/rankings';
import type { NationalRank } from '../src/store/types';

// Classements fictifs (nageuse fictive)
const TEXT = `@@URL:https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=1234567
DUPONT, Emma (2015)
2026-2027\t25m\t100m Libre\tBelgique · filles nées en 2015\t12\t148\t1:12.34
2025/26\t25m\t100m Libre\tBelgique · filles nées en 2015\t25\t\t1:18.90
2026-2027\t50m\t200m 4 nages\tBelgique · 11 ans\t3
2026-2027\t25m\tépreuve inconnue\tBelgique\t4
2026-2027\t25m\t100m Dos\tBelgique\tpas un rang
2025-2026\t25m\t50m Libre Lap\tBelgique · 19 ans et plus\t41\t\t47.93M`;

describe('classements nationaux', () => {
  it('lit les lignes valides et écarte les autres', () => {
    const r = parseRankingsText(TEXT);
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({ season: '2026-2027', course: 'SCM', distance: 100, stroke: 'FREE', label: 'Belgique · filles nées en 2015', rank: 12, of: 148, timeCs: 7234 });
    expect(r[1]).toMatchObject({ season: '2025-2026', rank: 25, timeCs: 7890 });
    expect(r[1].of).toBeUndefined();
    expect(r[2]).toMatchObject({ course: 'LCM', distance: 200, stroke: 'IM', rank: 3 });
  });

  it('saisons et libellés', () => {
    expect(normSeason('2026-2027')).toBe('2026-2027');
    expect(normSeason('2026/27')).toBe('2026-2027');
    expect(normSeason('2026')).toBe('2026');
    expect(normSeason('2026-2029')).toBeNull();
    expect(rankLabel(1)).toBe('1re');
    expect(rankLabel(12)).toBe('12e');
  });

  it('la saison la plus récente d’abord, pour la fiche et la liste des records', () => {
    const list: NationalRank[] = parseRankingsText(TEXT).map((r) => ({ swimmerId: 's1', ...r }));
    const free = ranksFor(list, 's1', 'SCM', 100, 'FREE');
    expect(free.map((r) => r.season)).toEqual(['2026-2027', '2025-2026']);
    expect(latestRankText(free)).toBe('12e en Belgique (2026-2027)');
    expect(ranksFor(list, 's2', 'SCM', 100, 'FREE')).toEqual([]);
    expect(latestRankText([])).toBeNull();
  });
});

describe('classements dans l’application', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const m = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('une nouvelle version remplace les classements précédents, gardés à la relance', async () => {
    vi.resetModules();
    const { initStore, actions, getState, normalizeData } = await import('../src/store/store');
    await initStore();
    const one: NationalRank = { swimmerId: 's1', season: '2025-2026', course: 'SCM', distance: 100, stroke: 'FREE', label: 'Belgique', rank: 25 };
    actions.setRankings([one], 'v1');
    actions.setRankings([{ ...one, season: '2026-2027', rank: 12 }], 'v2');
    expect(getState().rankings?.map((r) => r.rank)).toEqual([12]);
    expect(normalizeData(JSON.parse(JSON.stringify(getState()))).rankings).toHaveLength(1);
    expect(normalizeData({}).rankings).toEqual([]);
  });
});
