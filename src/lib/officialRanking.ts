import type { Gender } from '../store/types';
import { swimmerKey } from './pushKey';
import { swimmerNames } from './results';
import type { AllroundCategory, Championship } from './qualifying';

/*
 * Classement officiel des championnats de Belgique 11-16 ans, relu par le robot du club dans l'outil
 * « Belswim ranking » de la fédération (scripts/belswim-ranking.mjs) : rang, total et sélection (en vert
 * chez la fédération) des nageurs de l'ESN, désignés par une empreinte de leur nom, jamais en clair.
 */

export interface OfficialCategoryStats {
  /** Nageurs listés, et classés (total complet). */
  listed: number;
  ranked: number;
  /** Sélectionnés (en vert) et le dernier d'entre eux. */
  selected: number;
  last: { rank: number; total: number } | null;
}

export interface OfficialEntry {
  /** « 13-14 » */
  cat: string;
  gender: Gender;
  /** Rang (null : pas assez d'épreuves pour être classé). */
  rank: number | null;
  /** Total au barème de la fédération. */
  total: number;
  /** En vert au classement de la fédération : sélectionné. */
  selected: boolean;
  /** Barré : retiré (ne compte plus pour la sélection). */
  scratched: boolean;
}

export interface OfficialRanking {
  edition: number;
  period: { from: string; to: string } | null;
  /** Date de la lecture par le robot. */
  fetched: string;
  source: string;
  categories: Record<string, Partial<Record<Gender, OfficialCategoryStats>>>;
  swimmers: Record<string, OfficialEntry>;
}

const URL_ = './data/belswim-ranking.json';
let loading: Promise<OfficialRanking | null> | null = null;

/** Classement officiel (null s'il n'est pas publié : site en développement, fédération injoignable). */
export function loadOfficialRanking(): Promise<OfficialRanking | null> {
  loading ??= fetch(URL_, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && Number.isInteger(j.edition) && j.swimmers && j.categories ? (j as OfficialRanking) : null))
    .catch(() => null);
  return loading;
}

/** Ligne du nageur au classement officiel (son nom et ses autres noms connus). */
export async function officialEntry(
  ranking: OfficialRanking,
  swimmer: { firstName: string; lastName: string; birthYear?: number; aliases?: { firstName: string; lastName: string; birthYear?: number }[] },
): Promise<OfficialEntry | null> {
  for (const n of swimmerNames(swimmer)) {
    const e = ranking.swimmers[await swimmerKey(n)];
    if (e) return e;
  }
  return null;
}

/** Statistiques de la catégorie d'un nageur au classement officiel. */
export const categoryStats = (ranking: OfficialRanking, cat: string, gender: Gender) => ranking.categories[cat]?.[gender] ?? null;

/** Clé de catégorie du classement officiel (« 13-14 ») d'une catégorie de l'application. */
export const categoryKey = (cat: AllroundCategory) => `${cat.minAge}-${cat.maxAge}`;

/** Classement arrêté : la période de l'édition est terminée. */
export function rankingClosed(ranking: OfficialRanking, today: string): boolean {
  return !!ranking.period?.to && today > ranking.period.to;
}

/**
 * Repères tirés du classement officiel de l'édition précédente : total et rang du dernier sélectionné de
 * chaque catégorie, par sexe. Remplacent ceux du fichier des temps limites (relevés à la main) dès que le
 * robot a lu le classement arrêté de l'édition précédente.
 */
export function withOfficialBenchmarks(c: Championship, ranking: OfficialRanking | null, today: string): Championship {
  if (!c.allround || !ranking || ranking.edition !== c.edition - 1 || !rankingClosed(ranking, today)) return c;
  const categories = c.allround.categories.map((cat) => {
    const stats = ranking.categories[categoryKey(cat)];
    const F = stats?.F?.last;
    const M = stats?.M?.last;
    return F && M ? { ...cat, previous: { edition: ranking.edition, cutoff: { F: F.total, M: M.total }, rank: { F: F.rank, M: M.rank } } } : cat;
  });
  return { ...c, allround: { ...c.allround, categories } };
}
