import type { Course, Round, Stroke } from '../store/types';

/** Compétition telle que lue dans une source de résultats (LENEX, photo…). */
export interface ReportMeet {
  name: string;
  organizer?: string;
  city?: string;
  course: Course;
  startDate: string;
  endDate?: string;
  /** Identifiant sur live.swimrankings.net. */
  liveId?: string;
}

/** Course telle que lue dans une source de résultats. */
export interface ReportSwim {
  eventNo?: number;
  distance: number;
  stroke: Stroke;
  course: Course;
  round: Round;
  entryCs?: number;
  timeCs?: number;
  status: 'OK' | 'DSQ' | 'DNS' | 'DNF';
  place?: number;
  splits?: number[];
}

/** Même nageur : nom et prénom (dans un sens ou dans l'autre) et année de naissance si connue. */
export function sameSwimmer(
  a: { firstName: string; lastName: string; birthYear?: number },
  sw: { firstName: string; lastName: string; birthYear?: number },
): boolean {
  const x = `${normName(a.lastName)}|${normName(a.firstName)}`;
  if (x !== `${normName(sw.lastName)}|${normName(sw.firstName)}` && x !== `${normName(sw.firstName)}|${normName(sw.lastName)}`) return false;
  return !(sw.birthYear && a.birthYear && sw.birthYear !== a.birthYear);
}

export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/**
 * Même nageur à une lettre près dans le nom (« ASSOUMANOU » / « ASOUMANOU ») :
 * même prénom et même année de naissance, connue des deux côtés.
 */
export function closeSwimmer(
  a: { firstName: string; lastName: string; birthYear?: number },
  sw: { firstName: string; lastName: string; birthYear?: number },
): boolean {
  if (sameSwimmer(a, sw)) return true;
  if (!a.birthYear || a.birthYear !== sw.birthYear || normName(a.firstName) !== normName(sw.firstName)) return false;
  const x = normName(a.lastName);
  const y = normName(sw.lastName);
  return x.length >= 4 && editDistance(x, y) <= (x.length >= 8 ? 2 : 1);
}

/** Clés de recherche d'un nageur (nom|prénom, dans les deux sens). */
export function nameKeys(p: { firstName: string; lastName: string }): string[] {
  const f = normName(p.firstName);
  const l = normName(p.lastName);
  return [`${l}|${f}`, `${f}|${l}`];
}

/** Normalise un nom pour la comparaison (accents, casse, tirets). */
export function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}
