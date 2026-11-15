import type { Course, Round, Stroke, SwimStatus } from '../store/types';

export interface StrokeInfo {
  id: Stroke;
  label: string;
  short: string;
  /** Variable CSS de la couleur d'identité de la nage. */
  colorVar: string;
}

export const STROKES: StrokeInfo[] = [
  { id: 'FREE', label: 'Libre', short: 'NL', colorVar: '--stroke-free' },
  { id: 'BACK', label: 'Dos', short: 'DOS', colorVar: '--stroke-back' },
  { id: 'BREAST', label: 'Brasse', short: 'BR', colorVar: '--stroke-breast' },
  { id: 'FLY', label: 'Papillon', short: 'PAP', colorVar: '--stroke-fly' },
  { id: 'IM', label: '4 nages', short: '4N', colorVar: '--stroke-im' },
];

export const STROKE_BY_ID: Record<Stroke, StrokeInfo> = Object.fromEntries(
  STROKES.map((s) => [s.id, s]),
) as Record<Stroke, StrokeInfo>;

export const COURSES: { id: Course; label: string; long: string }[] = [
  { id: 'SCM', label: '25 m', long: 'Petit bassin (25 m)' },
  { id: 'LCM', label: '50 m', long: 'Grand bassin (50 m)' },
];

export function courseLabel(c: Course): string {
  return c === 'SCM' ? '25 m' : '50 m';
}

const DISTANCES: Record<Stroke, number[]> = {
  FREE: [25, 50, 100, 200, 400, 800, 1500],
  BACK: [25, 50, 100, 200],
  BREAST: [25, 50, 100, 200],
  FLY: [25, 50, 100, 200],
  IM: [100, 200, 400],
};

export function distancesFor(stroke: Stroke, course: Course): number[] {
  const list = DISTANCES[stroke];
  if (stroke === 'IM' && course === 'LCM') return list.filter((d) => d !== 100);
  if (course === 'LCM') return list.filter((d) => d !== 25);
  return list;
}

export function isValidEvent(distance: number, stroke: Stroke, course: Course): boolean {
  return distancesFor(stroke, course).includes(distance);
}

/** « 100 m Brasse » — espaces insécables : jamais « 100 » / « m » ni « 4 » / « nages » sur deux lignes. */
export function eventLabel(distance: number, stroke: Stroke): string {
  return `${distance}\u00a0m ${STROKE_BY_ID[stroke].label.replace(' ', '\u00a0')}`;
}

/** Clé d'épreuve indépendante du bassin : "100-FREE". */
export function eventKey(distance: number, stroke: Stroke): string {
  return `${distance}-${stroke}`;
}

/** Clé d'épreuve complète : "SCM:100-FREE". */
export function fullEventKey(course: Course, distance: number, stroke: Stroke): string {
  return `${course}:${distance}-${stroke}`;
}

export function parseFullEventKey(key: string): { course: Course; distance: number; stroke: Stroke } | null {
  const m = /^(SCM|LCM):(\d+)-(FREE|BACK|BREAST|FLY|IM)$/.exec(key);
  if (!m) return null;
  return { course: m[1] as Course, distance: +m[2], stroke: m[3] as Stroke };
}

/** Liste ordonnée de toutes les épreuves standard (pour les tableaux de records). */
export function allEvents(course: Course): { distance: number; stroke: Stroke }[] {
  const out: { distance: number; stroke: Stroke }[] = [];
  for (const s of STROKES) for (const d of distancesFor(s.id, course)) out.push({ distance: d, stroke: s.id });
  return out;
}

export const ROUNDS: { id: Round; label: string }[] = [
  { id: 'TIM', label: 'Finale directe' },
  { id: 'HEAT', label: 'Séries' },
  { id: 'SEMI', label: 'Demi-finale' },
  { id: 'FINAL', label: 'Finale' },
];

export const ROUND_LABEL: Record<Round, string> = Object.fromEntries(ROUNDS.map((r) => [r.id, r.label])) as Record<
  Round,
  string
>;

export const STATUSES: { id: SwimStatus; label: string; short: string }[] = [
  { id: 'OK', label: 'Valide', short: 'OK' },
  { id: 'DSQ', label: 'Disqualifié', short: 'DSQ' },
  { id: 'DNF', label: 'Abandon', short: 'ABD' },
  { id: 'DNS', label: 'Forfait', short: 'FOR' },
];

export const STATUS_LABEL: Record<SwimStatus, string> = Object.fromEntries(
  STATUSES.map((s) => [s.id, s.label]),
) as Record<SwimStatus, string>;
export const STATUS_SHORT: Record<SwimStatus, string> = Object.fromEntries(
  STATUSES.map((s) => [s.id, s.short]),
) as Record<SwimStatus, string>;

/** Nombre de longueurs. */
export function lengths(distance: number, course: Course): number {
  return Math.max(1, Math.round(distance / (course === 'SCM' ? 25 : 50)));
}
