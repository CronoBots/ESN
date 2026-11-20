import type { Course, Goal, Meet, Round, Stroke, Swim, Swimmer } from '../store/types';
import { computePoints } from './points';
import { daysBetween, fromISO, seasonOf, toISO, todayISO } from './dates';
import { STROKES, fullEventKey } from './events';
import { countedMedalSwims, medalCount, medalSwims, type MedalCount } from './medals';

const ROUND_ORDER: Record<Round, number> = { HEAT: 0, TIM: 1, SEMI: 2, FINAL: 3 };

export function chronoCompare(a: Swim, b: Swim): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ta = a.startTime ?? '';
  const tb = b.startTime ?? '';
  // Heure de passage comparée seulement si les deux courses en ont une : une finale sans heure
  // (historique) ne doit pas passer avant la série du matin relevée en direct.
  if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
  const ra = ROUND_ORDER[a.round] ?? 1;
  const rb = ROUND_ORDER[b.round] ?? 1;
  if (ra !== rb) return ra - rb;
  return a.createdAt - b.createdAt;
}

/** Course nagée avec un temps valide. */
export function isValidResult(s: Swim): s is Swim & { timeCs: number } {
  return s.status === 'OK' && typeof s.timeCs === 'number' && s.timeCs > 0;
}

/** Course comptant pour les records. */
export function countsForRecords(s: Swim, includeTraining: boolean): s is Swim & { timeCs: number } {
  return isValidResult(s) && (includeTraining || s.context === 'competition');
}

export function swimKey(s: Pick<Swim, 'course' | 'distance' | 'stroke'>): string {
  return fullEventKey(s.course, s.distance, s.stroke);
}

export interface PbInfo {
  /** Nouveau record personnel (amélioration d'un temps existant). */
  isPB: boolean;
  /** Premier temps sur cette épreuve. */
  isFirst: boolean;
  /** Record avant cette course. */
  prevBestCs?: number;
  /** Écart avec le record précédent (négatif = amélioration). */
  deltaCs?: number;
}

/** Calcule, pour chaque course, si elle a constitué un record personnel au moment où elle a été nagée. */
export function computePbFlags(swims: Swim[], includeTraining: boolean): Map<string, PbInfo> {
  const result = new Map<string, PbInfo>();
  const groups = new Map<string, Swim[]>();
  for (const s of swims) {
    if (!countsForRecords(s, includeTraining)) continue;
    const k = `${s.swimmerId}|${swimKey(s)}`;
    const g = groups.get(k);
    if (g) g.push(s);
    else groups.set(k, [s]);
  }
  for (const list of groups.values()) {
    list.sort(chronoCompare);
    let best: number | undefined;
    for (const s of list) {
      const t = s.timeCs!;
      if (best === undefined) {
        result.set(s.id, { isPB: false, isFirst: true });
        best = t;
      } else {
        result.set(s.id, { isPB: t < best, isFirst: false, prevBestCs: best, deltaCs: t - best });
        if (t < best) best = t;
      }
    }
  }
  return result;
}

/** Meilleurs temps par épreuve (clé "SCM:100-FREE"). */
export function personalBests(swims: Swim[], swimmerId: string, includeTraining: boolean): Map<string, Swim> {
  const map = new Map<string, Swim>();
  for (const s of swims) {
    if (s.swimmerId !== swimmerId || !countsForRecords(s, includeTraining)) continue;
    const k = swimKey(s);
    const prev = map.get(k);
    if (!prev || s.timeCs! < prev.timeCs! || (s.timeCs === prev.timeCs && chronoCompare(s, prev) < 0)) map.set(k, s);
  }
  return map;
}

export function eventHistory(
  swims: Swim[],
  swimmerId: string,
  course: Course,
  distance: number,
  stroke: Stroke,
): Swim[] {
  return swims
    .filter((s) => s.swimmerId === swimmerId && s.course === course && s.distance === distance && s.stroke === stroke)
    .sort(chronoCompare);
}

export function pointsFor(s: Swim, swimmer: Swimmer | undefined): number | null {
  if (s.points != null) return s.points;
  if (!swimmer || !isValidResult(s)) return null;
  return computePoints(s.timeCs, s.course, swimmer.gender, s.distance, s.stroke);
}

/* ------------------------------------------------------------------------ */
/* Statistiques d'une épreuve                                                */
/* ------------------------------------------------------------------------ */

export interface EventStats {
  count: number;
  first?: Swim;
  best?: Swim;
  latest?: Swim;
  /** Progression totale depuis le premier temps (centièmes, positif = gain). */
  totalGainCs: number;
  totalGainPct: number;
  /** Progression sur les 12 derniers mois. */
  yearGainCs: number | null;
  /** Écart du dernier temps au record. */
  latestVsBestCs: number | null;
  /** Moyenne des 5 derniers temps. */
  recentAvgCs: number | null;
  /** Régularité : écart-type des 5 derniers temps (centièmes). */
  consistencyCs: number | null;
  /** Tendance en centièmes par mois (négatif = amélioration). */
  trendCsPerMonth: number | null;
  pbCount: number;
}

export function eventStats(history: Swim[], includeTraining: boolean): EventStats {
  const valid = history.filter((s) => countsForRecords(s, includeTraining)).sort(chronoCompare);
  const stats: EventStats = {
    count: valid.length,
    totalGainCs: 0,
    totalGainPct: 0,
    yearGainCs: null,
    latestVsBestCs: null,
    recentAvgCs: null,
    consistencyCs: null,
    trendCsPerMonth: null,
    pbCount: 0,
  };
  if (!valid.length) return stats;
  stats.first = valid[0];
  stats.latest = valid[valid.length - 1];
  let best = valid[0];
  let running = valid[0].timeCs!;
  for (const s of valid.slice(1)) {
    if (s.timeCs! < running) {
      stats.pbCount++;
      running = s.timeCs!;
    }
    if (s.timeCs! < best.timeCs!) best = s;
  }
  stats.best = best;
  stats.totalGainCs = valid[0].timeCs! - best.timeCs!;
  stats.totalGainPct = (stats.totalGainCs / valid[0].timeCs!) * 100;
  stats.latestVsBestCs = stats.latest.timeCs! - best.timeCs!;

  const yearAgo = toISO(new Date(fromISO(todayISO()).getTime() - 365 * 86400000));
  const before = valid.filter((s) => s.date <= yearAgo);
  const within = valid.filter((s) => s.date > yearAgo);
  if (within.length) {
    const ref = before.length ? Math.min(...before.map((s) => s.timeCs!)) : within[0].timeCs!;
    const bestWithin = Math.min(...within.map((s) => s.timeCs!));
    stats.yearGainCs = before.length || within.length > 1 ? ref - bestWithin : null;
  }

  const last5 = valid.slice(-5).map((s) => s.timeCs!);
  stats.recentAvgCs = Math.round(last5.reduce((a, b) => a + b, 0) / last5.length);
  if (last5.length >= 3) {
    const mean = stats.recentAvgCs;
    stats.consistencyCs = Math.round(Math.sqrt(last5.reduce((a, b) => a + (b - mean) ** 2, 0) / last5.length));
  }
  const reg = regression(valid.slice(-10));
  if (reg) stats.trendCsPerMonth = reg.slopePerDay * 30.44;
  return stats;
}

/** Régression linéaire temps = a + b × jours. */
export function regression(list: Swim[]): { intercept: number; slopePerDay: number; origin: string } | null {
  const pts = list.filter((s) => s.timeCs != null);
  if (pts.length < 3) return null;
  const origin = pts[0].date;
  const xs = pts.map((s) => daysBetween(origin, s.date));
  const ys = pts.map((s) => s.timeCs!);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0 || xs[n - 1] - xs[0] < 14) return null;
  const slope = num / den;
  return { intercept: my - slope * mx, slopePerDay: slope, origin };
}

/** Projection de la date d'atteinte d'un objectif, au rythme actuel. */
export function projectGoal(history: Swim[], targetCs: number, includeTraining: boolean): string | null {
  const valid = history.filter((s) => countsForRecords(s, includeTraining)).sort(chronoCompare);
  if (!valid.length) return null;
  const best = Math.min(...valid.map((s) => s.timeCs!));
  if (best <= targetCs) return null;
  // Progression des records successifs (plus robuste que tous les temps)
  const reg = regression(valid.slice(-10));
  if (!reg || reg.slopePerDay >= -0.05) return null;
  const days = (targetCs - reg.intercept) / reg.slopePerDay;
  const d = new Date(fromISO(reg.origin).getTime() + days * 86400000);
  const today = fromISO(todayISO());
  if (d.getTime() < today.getTime()) return toISO(new Date(today.getTime() + 30 * 86400000));
  if (d.getTime() - today.getTime() > 3 * 365 * 86400000) return null;
  return toISO(d);
}

/* ------------------------------------------------------------------------ */
/* Synthèse d'un nageur                                                     */
/* ------------------------------------------------------------------------ */

export interface SwimmerSummary {
  races: number;
  meets: number;
  pbs: number;
  pbsThisSeason: number;
  eventsSwum: number;
  distanceRaced: number;
  bestPoints: { swim: Swim; points: number } | null;
  strokePoints: { stroke: Stroke; points: number | null; best?: Swim }[];
  lastRace?: Swim;
  /** Médailles (1re, 2e, 3e place) des compétitions dont le classement est connu. */
  medals: MedalCount;
  podiums: number;
  wins: number;
}

export function swimmerSummary(
  swims: Swim[],
  swimmer: Swimmer,
  includeTraining: boolean,
  pbFlags: Map<string, PbInfo>,
): SwimmerSummary {
  const mine = swims.filter((s) => s.swimmerId === swimmer.id);
  const valid = mine.filter((s) => countsForRecords(s, includeTraining));
  const season = seasonOf(todayISO());
  const meetIds = new Set(mine.filter((s) => s.meetId && isValidResult(s)).map((s) => s.meetId));
  const events = new Set(valid.map(swimKey));
  let bestPoints: SwimmerSummary['bestPoints'] = null;
  const byStroke = new Map<Stroke, { points: number; swim: Swim }>();
  for (const s of valid) {
    const p = pointsFor(s, swimmer);
    if (p == null) continue;
    if (!bestPoints || p > bestPoints.points) bestPoints = { swim: s, points: p };
    const cur = byStroke.get(s.stroke);
    if (!cur || p > cur.points) byStroke.set(s.stroke, { points: p, swim: s });
  }
  const pbList = valid.filter((s) => pbFlags.get(s.id)?.isPB);
  return {
    races: valid.length,
    meets: meetIds.size,
    pbs: pbList.length,
    pbsThisSeason: pbList.filter((s) => seasonOf(s.date) === season).length,
    eventsSwum: events.size,
    distanceRaced: valid.reduce((a, s) => a + s.distance, 0),
    bestPoints,
    strokePoints: STROKES.map((st) => ({
      stroke: st.id,
      points: byStroke.get(st.id)?.points ?? null,
      best: byStroke.get(st.id)?.swim,
    })),
    lastRace: [...valid].sort(chronoCompare).pop(),
    // Médailles (depuis MEDALS_SINCE) : une place de série ne compte pas quand le nageur a nagé la finale
    ...((m) => ({ medals: m, podiums: m.total, wins: m.gold }))(medalCount(countedMedalSwims(mine))),
  };
}

/* ------------------------------------------------------------------------ */
/* Trophées                                                                  */
/* ------------------------------------------------------------------------ */

export interface Achievement {
  id: string;
  icon: string;
  title: string;
  description: string;
  unlocked: boolean;
  date?: string;
  progress?: { value: number; target: number };
  /** Trophée pas encore vérifiable (ex. : aucun classement connu) : affiché à la place de « À débloquer ». */
  pending?: string;
}

export function achievements(
  swims: Swim[],
  swimmer: Swimmer,
  meets: Meet[],
  pbFlags: Map<string, PbInfo>,
): Achievement[] {
  const valid = swims
    .filter((s) => s.swimmerId === swimmer.id && isValidResult(s) && s.context === 'competition')
    .sort(chronoCompare);
  const pbs = valid.filter((s) => pbFlags.get(s.id)?.isPB);
  const fem = swimmer.gender === 'F';
  const out: Achievement[] = [];

  const nth = (list: Swim[], n: number) => (list.length >= n ? list[n - 1].date : undefined);
  const counter = (
    id: string,
    icon: string,
    title: string,
    description: string,
    list: Swim[],
    target: number,
  ) => {
    out.push({
      id,
      icon,
      title,
      description,
      unlocked: list.length >= target,
      date: nth(list, target),
      progress: { value: Math.min(list.length, target), target },
    });
  };

  counter('first-race', '🏁', 'Premier plongeon', 'Nager sa première course en compétition', valid, 1);
  counter('first-pb', '⚡', 'Premier record', 'Améliorer un record personnel', pbs, 1);
  counter('pb-10', '🔥', 'En feu', '10 records personnels battus', pbs, 10);
  counter('pb-25', '🚀', 'Fusée', '25 records personnels battus', pbs, 25);
  counter('races-25', '🏊', fem ? 'Habituée des plots' : 'Habitué des plots', '25 courses en compétition', valid, 25);
  counter('races-100', '💯', 'Centurion', '100 courses en compétition', valid, 100);

  // Polyvalence : les 5 nages
  const strokesSeen = new Map<Stroke, string>();
  for (const s of valid) if (!strokesSeen.has(s.stroke)) strokesSeen.set(s.stroke, s.date);
  out.push({
    id: 'all-strokes',
    icon: '🎯',
    title: fem ? 'Polyvalente' : 'Polyvalent',
    description: 'Nager les 5 nages en compétition',
    unlocked: strokesSeen.size >= 5,
    date: strokesSeen.size >= 5 ? [...strokesSeen.values()].sort().pop() : undefined,
    progress: { value: strokesSeen.size, target: 5 },
  });

  // Hat-trick : 3 records dans une même compétition
  const pbByMeet = new Map<string, Swim[]>();
  for (const s of pbs) {
    const k = s.meetId ?? s.date;
    pbByMeet.set(k, [...(pbByMeet.get(k) ?? []), s]);
  }
  const hat = [...pbByMeet.values()].filter((l) => l.length >= 3).sort((a, b) => (a[2].date < b[2].date ? -1 : 1))[0];
  out.push({
    id: 'hat-trick',
    icon: '🎩',
    title: 'Coup du chapeau',
    description: '3 records personnels dans une même compétition',
    unlocked: !!hat,
    date: hat?.[2].date,
  });

  const long = valid.find((s) => s.distance >= 400);
  out.push({
    id: 'distance',
    icon: '🌊',
    title: 'Longue distance',
    description: 'Nager un 400 m ou plus',
    unlocked: !!long,
    date: long?.date,
  });

  const lcm = valid.find((s) => s.course === 'LCM');
  out.push({
    id: 'lcm',
    icon: '🏟️',
    title: 'Grand bassin',
    description: 'Première course en bassin de 50 m',
    unlocked: !!lcm,
    date: lcm?.date,
  });

  const bigJump = pbs.find((s) => {
    const info = pbFlags.get(s.id);
    return info?.prevBestCs && info.deltaCs != null && -info.deltaCs / info.prevBestCs >= 0.05;
  });
  out.push({
    id: 'big-jump',
    icon: '📈',
    title: 'Bond en avant',
    description: 'Améliorer un record de plus de 5 %',
    unlocked: !!bigJump,
    date: bigJump?.date,
  });

  // Podium et victoire : comme les médailles (une place de série ne compte pas quand la finale est nagée).
  // Les places ne sont connues que pour les compétitions lues par l'application, pas pour l'historique.
  const medals = medalSwims(valid);
  const placesUnknown = !valid.some((s) => s.place != null) ? 'Classement pas encore connu' : undefined;
  const podium = medals[0];
  out.push({ id: 'podium', icon: '🥉', title: 'Sur le podium', description: 'Terminer dans le top 3', unlocked: !!podium, date: podium?.date, pending: placesUnknown });
  const win = medals.find((s) => s.place === 1);
  out.push({ id: 'win', icon: '🥇', title: fem ? 'Championne' : 'Champion', description: 'Remporter une course', unlocked: !!win, date: win?.date, pending: placesUnknown });

  for (const target of [200, 300, 400, 500]) {
    const hit = valid.find((s) => (pointsFor(s, swimmer) ?? 0) >= target);
    out.push({
      id: `pts-${target}`,
      icon: target >= 500 ? '💎' : target >= 400 ? '🌟' : target >= 300 ? '⭐' : '✨',
      title: `${target} points`,
      description: `Atteindre ${target} points World Aquatics sur une course`,
      unlocked: !!hit,
      date: hit?.date,
    });
  }

  const meetIds = [...new Set(valid.map((s) => s.meetId).filter(Boolean))] as string[];
  const meetDates = meetIds
    .map((id) => meets.find((m) => m.id === id)?.startDate)
    .filter(Boolean)
    .sort() as string[];
  out.push({
    id: 'meets-10',
    icon: '🧳',
    title: fem ? 'Globe-trotteuse' : 'Globe-trotteur',
    description: 'Participer à 10 compétitions',
    unlocked: meetIds.length >= 10,
    date: meetDates[9],
    progress: { value: Math.min(meetIds.length, 10), target: 10 },
  });


  return out;
}

/* ------------------------------------------------------------------------ */
/* Objectifs                                                                  */
/* ------------------------------------------------------------------------ */

/** Date à laquelle un objectif a été atteint (première course sous le temps cible). */
export function goalAchievedDate(goal: Goal, swims: Swim[], includeTraining: boolean): string | undefined {
  const hit = swims
    .filter(
      (s) =>
        s.swimmerId === goal.swimmerId &&
        s.course === goal.course &&
        s.distance === goal.distance &&
        s.stroke === goal.stroke &&
        countsForRecords(s, includeTraining) &&
        s.timeCs! <= goal.targetCs &&
        s.date >= toISO(new Date(goal.createdAt)),
    )
    .sort(chronoCompare)[0];
  if (hit) return hit.date;
  // Objectif déjà sous le record existant au moment de la création
  const already = swims.find(
    (s) =>
      s.swimmerId === goal.swimmerId &&
      s.course === goal.course &&
      s.distance === goal.distance &&
      s.stroke === goal.stroke &&
      countsForRecords(s, includeTraining) &&
      s.timeCs! <= goal.targetCs,
  );
  return already?.date;
}

/* ------------------------------------------------------------------------ */
/* Chronologie des compétitions                                               */
/* ------------------------------------------------------------------------ */

export interface TimelineEntry {
  key: string;
  meet?: Meet;
  name: string;
  city?: string;
  course?: Course;
  startDate: string;
  endDate?: string;
  swims: Swim[];
  pbs: number;
  /** Temps total gagné sur les records battus (centièmes). */
  gainCs: number;
  best: { swim: Swim; points: number } | null;
  /** Écart de points avec la compétition précédente (meilleure perf.). */
  trend: number | null;
}

/** Compétitions d'un nageur avec leurs résultats, de la plus ancienne à la plus récente. */
export function meetTimeline(
  swims: Swim[],
  meets: Meet[],
  swimmer: Swimmer,
  pbFlags: Map<string, PbInfo>,
): TimelineEntry[] {
  const byMeet = new Map<string, Swim[]>();
  for (const s of swims) {
    if (s.swimmerId !== swimmer.id || s.context !== 'competition') continue;
    if (s.timeCs == null && s.status === 'OK') continue; // épreuve prévue, pas encore nagée
    const k = s.meetId ?? `date:${s.date}`;
    byMeet.set(k, [...(byMeet.get(k) ?? []), s]);
  }
  const meetById = new Map(meets.map((m) => [m.id, m]));
  const out: TimelineEntry[] = [];
  for (const [key, list] of byMeet) {
    const meet = meetById.get(key);
    list.sort((a, b) => chronoCompare(a, b) || (a.eventNo ?? 0) - (b.eventNo ?? 0));
    let best: TimelineEntry['best'] = null;
    let pbs = 0;
    let gainCs = 0;
    for (const s of list) {
      const p = pointsFor(s, swimmer);
      if (p != null && (!best || p > best.points)) best = { swim: s, points: p };
      const f = pbFlags.get(s.id);
      if (f?.isPB) {
        pbs++;
        gainCs += -(f.deltaCs ?? 0);
      }
    }
    const dates = list.map((s) => s.date).sort();
    out.push({
      key,
      meet,
      name: meet?.name ?? 'Compétition',
      city: meet?.city,
      course: meet?.course ?? list[0].course,
      startDate: meet?.startDate ?? dates[0],
      endDate: meet?.endDate ?? (dates[dates.length - 1] !== dates[0] ? dates[dates.length - 1] : undefined),
      swims: list,
      pbs,
      gainCs,
      best,
      trend: null,
    });
  }
  out.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  let prev: number | null = null;
  for (const e of out) {
    if (e.best) {
      e.trend = prev != null ? e.best.points - prev : null;
      prev = e.best.points;
    }
  }
  return out;
}

/** Compétitions avec au moins un membre actuel de l'ESN (pas seulement d'anciens membres). */
export function clubMeets(swims: Swim[], swimmers: Swimmer[]): Set<string> {
  const active = new Set(swimmers.filter((s) => !s.former).map((s) => s.id));
  const ids = new Set<string>();
  for (const s of swims) if (s.meetId && active.has(s.swimmerId)) ids.add(s.meetId);
  return ids;
}
