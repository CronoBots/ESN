import type { Course, Round, Stroke } from '../store/types';

/** Compétition telle que lue dans une source de résultats (LENEX, photo…). */
export interface ReportMeet {
  name: string;
  organizer?: string;
  city?: string;
  course: Course;
  startDate: string;
  endDate?: string;
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

/** Normalise un nom pour la comparaison (accents, casse, tirets). */
export function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}
