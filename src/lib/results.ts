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
