import type { Course, NationalRank, Stroke } from '../store/types';
import { tokenize } from './swimrankings';
import { isValidEvent } from './events';

/**
 * Classements nationaux (swimrankings.net) des nageurs du club : relevés dans le navigateur de
 * l'utilisateur (skill « classements-nationaux »), publiés chiffrés dans public/data/club-rankings.json.
 *
 * Une ligne par classement, colonnes séparées par des tabulations :
 *   Saison   Bassin   Épreuve      Classement                        Rang   Sur   Temps
 *   2026-2027  25m    100m Libre   Belgique · filles nées en 2015    12     148   1:12.34
 * « Sur » (nombre de nageurs classés) et « Temps » sont facultatifs.
 */
export type ParsedRank = Omit<NationalRank, 'swimmerId'>;

/** « 2026-2027 », « 2026/27 », « 2026 » → « 2026-2027 » ou « 2026 ». */
export function normSeason(s: string): string | null {
  const t = s.trim();
  const two = /^(\d{4})\s*[-/]\s*(\d{2}|\d{4})$/.exec(t);
  if (two) {
    const a = Number(two[1]);
    const b = two[2].length === 2 ? Math.floor(a / 100) * 100 + Number(two[2]) : Number(two[2]);
    return b === a + 1 ? `${a}-${b}` : null;
  }
  return /^\d{4}$/.test(t) ? t : null;
}

export function parseRankingsText(text: string): ParsedRank[] {
  const out: ParsedRank[] = [];
  for (const line of text.split(/\r?\n/)) {
    const c = line.split('\t').map((x) => x.trim());
    if (c.length < 5) continue;
    const season = normSeason(c[0]);
    const course: Course | null = /^25\s?m$/i.test(c[1]) || /^SCM$/i.test(c[1]) ? 'SCM' : /^50\s?m$/i.test(c[1]) || /^LCM$/i.test(c[1]) ? 'LCM' : null;
    const ev = tokenize(c[2]).find((t) => t.t === 'EVENT') as { distance: number; stroke: Stroke } | undefined;
    const rank = Number(/^(\d{1,4})\b/.exec(c[4])?.[1]);
    if (!season || !course || !ev || !c[3] || !(rank >= 1) || !isValidEvent(ev.distance, ev.stroke, course)) continue;
    const of = Number(/^(\d{1,5})\b/.exec(c[5] ?? '')?.[1]);
    const time = c[6] ? tokenize(c[6]).find((t) => t.t === 'TIME') : undefined;
    out.push({
      season,
      course,
      distance: ev.distance,
      stroke: ev.stroke,
      label: c[3],
      rank,
      ...(of >= rank ? { of } : {}),
      ...(time && time.t === 'TIME' ? { timeCs: time.cs } : {}),
    });
  }
  return out;
}

/** Saison la plus récente d'abord, puis le meilleur rang. */
export function sortRanks<T extends Pick<NationalRank, 'season' | 'rank'>>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.season === b.season ? a.rank - b.rank : a.season < b.season ? 1 : -1));
}

/** « 1re », « 2e », « 12e ». */
export function rankLabel(rank: number): string {
  return rank === 1 ? '1re' : `${rank}e`;
}

/** Classements d'un nageur sur une épreuve (bassin compris), saison la plus récente d'abord. */
export function ranksFor(rankings: NationalRank[] | undefined, swimmerId: string, course: Course, distance: number, stroke: Stroke): NationalRank[] {
  return sortRanks((rankings ?? []).filter((r) => r.swimmerId === swimmerId && r.course === course && r.distance === distance && r.stroke === stroke));
}

/** « 12e en Belgique » : le meilleur rang de la saison la plus récente, pour une ligne de liste. */
export function latestRankText(list: NationalRank[]): string | null {
  const r = list[0];
  if (!r) return null;
  return `${rankLabel(r.rank)} ${/belg/i.test(r.label) ? 'en Belgique' : 'au classement'} (${r.season})`;
}
