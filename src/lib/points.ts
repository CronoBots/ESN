import type { Course, Gender, Stroke } from '../store/types';
import { parseTime } from './time';

/**
 * Points « World Aquatics » (ex-FINA) : P = 1000 × (B / T)³
 * B = temps de base de l'épreuve (record du monde de référence).
 *
 * Les temps de base officiels sont publiés chaque saison par World Aquatics.
 * Les valeurs ci-dessous sont des records du monde récents, recoupées avec les
 * points « FINA 2026 » affichés par swimrankings.net. Les points sont
 * donc INDICATIFS (écart de quelques points possible avec swimrankings).
 * Les points importés depuis swimrankings.net restent prioritaires.
 * Pour mettre à jour : remplacer les valeurs de BASE_TIMES.
 */
type Table = Partial<Record<string, string>>;

const BASE_TIMES: Record<Course, Record<Gender, Table>> = {
  LCM: {
    M: {
      '50-FREE': '20.91', '100-FREE': '46.40', '200-FREE': '1:42.00', '400-FREE': '3:40.07',
      '800-FREE': '7:32.12', '1500-FREE': '14:30.67',
      '50-BACK': '23.55', '100-BACK': '51.60', '200-BACK': '1:51.92',
      '50-BREAST': '25.95', '100-BREAST': '56.88', '200-BREAST': '2:05.48',
      '50-FLY': '22.27', '100-FLY': '49.45', '200-FLY': '1:50.34',
      '200-IM': '1:52.69', '400-IM': '4:02.50',
    },
    F: {
      '50-FREE': '23.61', '100-FREE': '51.71', '200-FREE': '1:52.23', '400-FREE': '3:54.18',
      '800-FREE': '8:04.12', '1500-FREE': '15:20.48',
      '50-BACK': '26.86', '100-BACK': '57.13', '200-BACK': '2:03.14',
      '50-BREAST': '29.16', '100-BREAST': '1:04.13', '200-BREAST': '2:17.55',
      '50-FLY': '24.43', '100-FLY': '54.60', '200-FLY': '2:01.81',
      '200-IM': '2:05.70', '400-IM': '4:23.65',
    },
  },
  SCM: {
    M: {
      '50-FREE': '19.90', '100-FREE': '44.84', '200-FREE': '1:39.37', '400-FREE': '3:32.25',
      '800-FREE': '7:20.46', '1500-FREE': '14:06.88',
      '50-BACK': '22.11', '100-BACK': '48.33', '200-BACK': '1:45.63',
      '50-BREAST': '24.95', '100-BREAST': '55.28', '200-BREAST': '2:00.16',
      '50-FLY': '21.75', '100-FLY': '47.71', '200-FLY': '1:46.85',
      '100-IM': '49.28', '200-IM': '1:48.88', '400-IM': '3:54.81',
    },
    F: {
      '50-FREE': '22.83', '100-FREE': '49.93', '200-FREE': '1:50.31', '400-FREE': '3:50.25',
      '800-FREE': '7:57.42', '1500-FREE': '15:08.24',
      '50-BACK': '25.23', '100-BACK': '54.02', '200-BACK': '1:57.33',
      '50-BREAST': '28.37', '100-BREAST': '1:02.36', '200-BREAST': '2:12.50',
      '50-FLY': '23.94', '100-FLY': '52.71', '200-FLY': '1:59.32',
      '100-IM': '55.11', '200-IM': '2:01.63', '400-IM': '4:15.48',
    },
  },
};

export function baseTime(course: Course, gender: Gender, distance: number, stroke: Stroke): number | null {
  const s = BASE_TIMES[course][gender][`${distance}-${stroke}`];
  return s ? parseTime(s) : null;
}

export function computePoints(
  timeCs: number,
  course: Course,
  gender: Gender,
  distance: number,
  stroke: Stroke,
): number | null {
  const b = baseTime(course, gender, distance, stroke);
  if (!b || !timeCs) return null;
  return Math.floor(1000 * Math.pow(b / timeCs, 3));
}

/** Temps nécessaire pour atteindre un nombre de points donné. */
export function timeForPoints(
  points: number,
  course: Course,
  gender: Gender,
  distance: number,
  stroke: Stroke,
): number | null {
  const b = baseTime(course, gender, distance, stroke);
  if (!b || points <= 0) return null;
  return Math.round(b / Math.cbrt(points / 1000));
}
