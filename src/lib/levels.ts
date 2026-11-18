import type { Course, Gender, Stroke } from '../store/types';
import { FFBN_GRID, FFBN_GRID_YEARS } from './ffbnGrid';

/**
 * Niveaux de référence FFBN (Mistral, Trident, Requin) d'un nageur sur une
 * épreuve : temps à réaliser selon l'âge atteint dans l'année, niveau atteint
 * avec son meilleur temps, prochain niveau et écart.
 */

export type Level = 'Mistral' | 'Trident' | 'Requin';
export const LEVELS: Level[] = ['Mistral', 'Trident', 'Requin'];

/** Âges couverts par la grille : de 8 ans à « 19 et plus ». Les masters (25 ans et plus) ont leurs propres références. */
const MIN_AGE = 8;
const MAX_AGE = 24;

export interface LevelTime {
  level: Level;
  cs: number;
  /** Atteint avec le temps donné. */
  reached: boolean;
  /** Temps encore à gagner (centièmes) quand le niveau n'est pas atteint. */
  gapCs?: number;
}

export interface LevelStatus {
  /** Grille utilisée : filles (F) ou garçons (M), les temps de référence ne sont pas les mêmes. */
  gender: Gender;
  /** Âge atteint dans l'année, celui de la grille. */
  age: number;
  year: number;
  /** Niveaux qui existent pour cet âge et cette épreuve, du plus accessible au plus exigeant. */
  levels: LevelTime[];
  /** Plus haut niveau atteint. */
  reached?: Level;
  /** Prochain niveau à atteindre. */
  next?: LevelTime;
}

/** La grille couvre-t-elle cette année ? (2026 à 2028) */
export function gridCovers(year: number): boolean {
  return year >= FFBN_GRID_YEARS[0] && year <= FFBN_GRID_YEARS[1];
}

/**
 * Niveaux d'un nageur sur une épreuve pour l'année donnée ; `bestCs` = son
 * meilleur temps dans ce bassin (facultatif). Rien hors de la grille : âge
 * inconnu ou hors 8-24 ans, année non couverte, épreuve sans temps de référence.
 */
export function levelStatus(
  sw: { gender: Gender; birthYear?: number },
  course: Course,
  distance: number,
  stroke: Stroke,
  year: number,
  bestCs?: number | null,
): LevelStatus | null {
  if (!sw.birthYear || !gridCovers(year)) return null;
  const age = year - sw.birthYear;
  if (age < MIN_AGE || age > MAX_AGE) return null;
  const i = Math.min(age, 19) - MIN_AGE;
  const key = `${distance}-${stroke}`;
  const levels: LevelTime[] = [];
  for (const level of LEVELS) {
    const cs = FFBN_GRID[sw.gender][level][course]?.[key]?.[i];
    if (!cs) continue;
    const reached = bestCs != null && bestCs <= cs;
    levels.push({ level, cs, reached, gapCs: reached || bestCs == null ? undefined : bestCs - cs });
  }
  if (!levels.length) return null;
  const reached = [...levels].reverse().find((l) => l.reached)?.level;
  const next = levels.find((l) => !l.reached);
  return { gender: sw.gender, age, year, levels, reached, next };
}

/** « filles de 12 ans », « garçons de 19 ans et plus » : la grille appliquée, en clair. */
export function gridLabel(gender: Gender, age: number): string {
  return `${gender === 'F' ? 'filles' : 'garçons'} de ${age >= 19 ? '19 ans et plus' : `${age} ans`}`;
}

/** Écart relatif au prochain niveau (0,02 = 2 % du temps) : pour choisir les objectifs les plus proches. */
export function relativeGap(status: LevelStatus): number | null {
  const n = status.next;
  return n?.gapCs != null ? n.gapCs / n.cs : null;
}
