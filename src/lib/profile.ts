import type { Course, NationalRank, Stroke, Swim, Swimmer } from '../store/types';
import { AGE_BANDS, clubRecords, type AgeBand } from './clubRecords';
import { seasonOf } from './dates';
import { distancesFor, STROKES } from './events';
import { countsForRecords, isValidResult, pointsFor, type PbInfo } from './stats';
import { sortRanks } from './rankings';

/**
 * Fiche complète d'un nageur du club : tout ce que l'application sait de lui, rassemblé
 * (meilleurs temps des deux bassins, records du club détenus, saisons, classements nationaux).
 * Tout est recalculé à partir des données : la fiche se met à jour d'elle-même à chaque
 * résultat trouvé, historique ou classement publié.
 */

/** Première et dernière compétition (courses en compétition, nagées). */
export function careerSpan(mine: Swim[]): { first?: Swim; last?: Swim } {
  let first: Swim | undefined;
  let last: Swim | undefined;
  for (const s of mine) {
    if (s.context !== 'competition' || !isValidResult(s)) continue;
    if (!first || s.date < first.date) first = s;
    if (!last || s.date > last.date) last = s;
  }
  return { first, last };
}

export interface BestRow {
  distance: number;
  stroke: Stroke;
  scm?: Swim;
  lcm?: Swim;
}

/** Meilleur temps de chaque épreuve, en 25 m et en 50 m, dans l'ordre des nages et des distances. */
export function bestTimesTable(mine: Swim[]): BestRow[] {
  const best = new Map<string, Swim>();
  for (const s of mine) {
    if (!countsForRecords(s, false)) continue;
    const k = `${s.course}-${s.distance}-${s.stroke}`;
    const b = best.get(k);
    if (!b || s.timeCs! < b.timeCs! || (s.timeCs === b.timeCs && s.date < b.date)) best.set(k, s);
  }
  const rows: BestRow[] = [];
  for (const st of STROKES) {
    const dists = [...new Set([...distancesFor(st.id, 'SCM'), ...distancesFor(st.id, 'LCM')])].sort((a, b) => a - b);
    for (const d of dists) {
      const scm = best.get(`SCM-${d}-${st.id}`);
      const lcm = best.get(`LCM-${d}-${st.id}`);
      if (scm || lcm) rows.push({ distance: d, stroke: st.id, scm, lcm });
    }
  }
  return rows;
}

export interface HeldRecord {
  band: AgeBand;
  course: Course;
  swim: Swim;
}

/** Records du club que ce nageur détient aujourd'hui : record absolu d'abord, puis par âge. */
export function clubRecordsHeld(swims: Swim[], swimmers: Swimmer[], swimmer: Swimmer): HeldRecord[] {
  const out: HeldRecord[] = [];
  for (const band of AGE_BANDS)
    for (const course of ['SCM', 'LCM'] as const)
      for (const r of clubRecords(swims, swimmers, { course, gender: swimmer.gender, band }).values())
        if (r.swimmer.id === swimmer.id) out.push({ band, course, swim: r.swim });
  const order = new Map(AGE_BANDS.map((b, i) => [b.id, i]));
  return out.sort((a, b) => order.get(a.band.id)! - order.get(b.band.id)! || (a.course === b.course ? 0 : a.course === 'LCM' ? -1 : 1));
}

export interface SeasonLine {
  season: string;
  meets: number;
  races: number;
  pbs: number;
  bestPoints: number | null;
}

/** Saison par saison (la plus récente d'abord) : compétitions, courses, records personnels, meilleurs points. */
export function seasonsSummary(mine: Swim[], swimmer: Swimmer, pbFlags: Map<string, PbInfo>): SeasonLine[] {
  const by = new Map<string, { meets: Set<string>; races: number; pbs: number; best: number | null }>();
  for (const s of mine) {
    if (s.context !== 'competition' || !isValidResult(s)) continue;
    const k = seasonOf(s.date);
    const e = by.get(k) ?? { meets: new Set<string>(), races: 0, pbs: 0, best: null };
    e.meets.add(s.meetId ?? `date:${s.date}`);
    e.races++;
    if (pbFlags.get(s.id)?.isPB) e.pbs++;
    const p = pointsFor(s, swimmer);
    if (p != null && (e.best == null || p > e.best)) e.best = p;
    by.set(k, e);
  }
  return [...by.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([season, e]) => ({ season, meets: e.meets.size, races: e.races, pbs: e.pbs, bestPoints: e.best }));
}

export interface StrokeStrength {
  stroke: Stroke;
  /** Meilleurs points sur cette nage (toutes distances, 25 et 50 m) ; null : jamais nagée en compétition. */
  points: number | null;
  /** Part du meilleur total des cinq nages (0 à 1) : la longueur de la jauge. */
  ratio: number;
  /** Nage la plus forte du nageur. */
  best: boolean;
}

/**
 * Profil par nage de l'en-tête de la fiche : les cinq nages, dans l'ordre habituel, avec les meilleurs points
 * de chacune, rapportés à la plus forte. Vide sous deux nages avec des points (rien à comparer).
 */
export function strokeProfile(list: { stroke: Stroke; points: number | null }[]): StrokeStrength[] {
  const max = Math.max(0, ...list.map((x) => x.points ?? 0));
  if (list.filter((x) => (x.points ?? 0) > 0).length < 2) return [];
  return STROKES.map((st) => {
    const points = list.find((x) => x.stroke === st.id)?.points ?? null;
    return { stroke: st.id, points, ratio: points ? points / max : 0, best: !!points && points === max };
  });
}

/** Meilleur rang de chaque épreuve sur la saison la plus récente classée, du meilleur au moins bon. */
export function topRanks(rankings: NationalRank[] | undefined, swimmerId: string, limit = 5): NationalRank[] {
  const mine = sortRanks((rankings ?? []).filter((r) => r.swimmerId === swimmerId));
  if (!mine.length) return [];
  // Dernière saison classée de CHAQUE bassin : en 25 m « 2026-2027 », en 50 m l'année civile « 2026 »
  // (sinon les rangs en grand bassin ne seraient jamais montrés)
  const latest = new Map<Course, string>();
  for (const r of mine) if (!latest.has(r.course) || r.season > latest.get(r.course)!) latest.set(r.course, r.season);
  const best = new Map<string, NationalRank>();
  for (const r of mine) {
    if (r.season !== latest.get(r.course)) continue;
    const k = `${r.course}-${r.distance}-${r.stroke}`;
    const b = best.get(k);
    if (!b || r.rank < b.rank) best.set(k, r);
  }
  return [...best.values()].sort((a, b) => a.rank - b.rank).slice(0, limit);
}
