import type { Course, Gender, Stroke, Swim } from '../store/types';
import { parseTime } from './time';
import { countsForRecords } from './stats';

/**
 * Temps limites des championnats (fédération belge) : publiés dans data/qualifying.json et lus par
 * l'application à chaque ouverture, pour être mis à jour à chaque saison sans nouvelle version.
 */

/** Championnat tel qu'écrit dans data/qualifying.json (temps en texte, comme sur le règlement). */
export interface ChampionshipJson {
  id: string;
  name: string;
  /** Bassin de la compétition. */
  course: Course;
  place?: string;
  start?: string;
  end?: string;
  /** Dernier jour où l'application l'affiche (fin de la compétition, ou fin de saison si la date n'est pas connue). */
  until: string;
  /** Année de la compétition : l'âge est celui atteint cette année-là. */
  edition: number;
  /** Édition dont viennent les limites ; plus ancienne que `edition` = limites provisoires (pas encore publiées). */
  limitsEdition: number;
  /** Période pendant laquelle les temps comptent. */
  window: { from: string; to: string };
  /** Bassins dont les temps comptent. */
  accepts: Course[];
  /** Jusqu'à cet âge, seule la limite A compte. */
  aOnlyUpTo?: number;
  note?: string;
  source: string;
  /** Sexe → « distance-nage » → « A », « B », âge (« 13 ») ou « 18+ » → temps. */
  limits: Record<Gender, Record<string, Record<string, string>>>;
}

export interface QualifyingJson {
  updated: string;
  championships: ChampionshipJson[];
}

export interface Championship extends Omit<ChampionshipJson, 'limits'> {
  limits: Record<Gender, Record<string, Record<string, number>>>;
  /** Limites de l'édition précédente, en attendant les nouvelles. */
  provisional: boolean;
}

export interface QualifyingData {
  updated: string;
  championships: Championship[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const EVENT = /^(25|50|100|200|400|800|1500)-(FREE|BACK|BREAST|FLY|IM)$/;
const KEY = /^(A|B|\d{1,2}\+?)$/;

/** Lit et contrôle le fichier ; une erreur décrit précisément la valeur fautive. */
export function parseQualifying(raw: unknown): QualifyingData {
  const r = raw as Partial<QualifyingJson>;
  if (!r || !Array.isArray(r.championships)) throw new Error('Fichier des temps limites invalide');
  const championships = r.championships.map((c): Championship => {
    const where = `championnat « ${c?.id ?? '?'} »`;
    if (!c?.id || !c.name) throw new Error(`${where} : identifiant ou nom manquant`);
    if (c.course !== 'SCM' && c.course !== 'LCM') throw new Error(`${where} : bassin inconnu`);
    for (const d of [c.until, c.window?.from, c.window?.to, ...(c.start ? [c.start] : []), ...(c.end ? [c.end] : [])])
      if (!ISO.test(d ?? '')) throw new Error(`${where} : date invalide « ${d} »`);
    if (!Array.isArray(c.accepts) || !c.accepts.length || c.accepts.some((a) => a !== 'SCM' && a !== 'LCM'))
      throw new Error(`${where} : bassins acceptés invalides`);
    if (!Number.isInteger(c.edition) || !Number.isInteger(c.limitsEdition)) throw new Error(`${where} : édition invalide`);
    const limits = { F: {}, M: {} } as Championship['limits'];
    for (const g of ['F', 'M'] as const) {
      for (const [event, row] of Object.entries(c.limits?.[g] ?? {})) {
        if (!EVENT.test(event)) throw new Error(`${where} : épreuve inconnue « ${event} »`);
        limits[g][event] = {};
        for (const [k, t] of Object.entries(row)) {
          const cs = parseTime(t);
          if (!KEY.test(k) || cs == null || cs <= 0) throw new Error(`${where} : ${g} ${event} ${k} « ${t} » illisible`);
          limits[g][event][k] = cs;
        }
      }
    }
    return { ...c, limits, provisional: c.limitsEdition < c.edition };
  });
  return { updated: String(r.updated ?? ''), championships };
}

/** Championnats encore à venir (ou en cours) à cette date. */
export const activeChampionships = (data: QualifyingData, today: string) => data.championships.filter((c) => today <= c.until);

/** Les masters (25 ans et plus) ont leurs propres championnats : pas de limites ici. */
const MAX_AGE = 24;

export interface LimitLine {
  /** « A », « B » ou « Limite ». */
  label: string;
  cs: number;
  reached: boolean;
  /** Temps encore à gagner (centièmes), avec un temps dans la période. */
  gapCs?: number;
}

export interface LimitStatus {
  championship: Championship;
  distance: number;
  stroke: Stroke;
  age: number;
  /** Du plus exigeant au plus accessible (A puis B). */
  lines: LimitLine[];
  /** Meilleur temps qui compte (période et bassins du championnat). */
  best?: Swim & { timeCs: number };
  /** Limite atteinte la plus exigeante. */
  reached?: LimitLine;
  /** Prochaine limite à atteindre (la plus accessible des non atteintes, ou A si B est déjà là). */
  next?: LimitLine;
}

/** Limites d'une épreuve pour un âge : A/B, ou la colonne de l'âge (« 18+ » couvre 18 ans et plus). */
function limitLines(c: Championship, gender: Gender, event: string, age: number): { label: string; cs: number }[] {
  const row = c.limits[gender]?.[event];
  if (!row) return [];
  if (row.A != null || row.B != null) {
    const out: { label: string; cs: number }[] = [];
    if (row.A != null) out.push({ label: 'A', cs: row.A });
    if (row.B != null && !(c.aOnlyUpTo != null && age <= c.aOnlyUpTo) && row.B !== row.A) out.push({ label: 'B', cs: row.B });
    return out;
  }
  const exact = row[String(age)];
  if (exact != null) return [{ label: 'Limite', cs: exact }];
  // « 18+ » : à partir de cet âge
  for (const [k, cs] of Object.entries(row)) if (k.endsWith('+') && age >= Number(k.slice(0, -1))) return [{ label: 'Limite', cs }];
  return [];
}

/** Meilleur temps en compétition d'un nageur sur une épreuve, dans la période et les bassins du championnat. */
function bestFor(c: Championship, swims: Swim[], swimmerId: string, distance: number, stroke: Stroke, today: string) {
  const to = c.window.to < today ? c.window.to : today;
  let best: (Swim & { timeCs: number }) | undefined;
  for (const s of swims) {
    if (s.swimmerId !== swimmerId || s.distance !== distance || s.stroke !== stroke || !c.accepts.includes(s.course)) continue;
    if (s.date < c.window.from || s.date > to || !countsForRecords(s, false)) continue;
    if (!best || s.timeCs < best.timeCs) best = s;
  }
  return best;
}

/** Situation d'un nageur face aux limites d'un championnat sur une épreuve (null : pas de limite pour lui). */
export function limitStatus(
  c: Championship,
  swimmer: { id: string; gender: Gender; birthYear?: number },
  swims: Swim[],
  distance: number,
  stroke: Stroke,
  today: string,
): LimitStatus | null {
  if (!swimmer.birthYear) return null;
  const age = c.edition - swimmer.birthYear;
  if (age > MAX_AGE) return null;
  const raw = limitLines(c, swimmer.gender, `${distance}-${stroke}`, age);
  if (!raw.length) return null;
  const best = bestFor(c, swims, swimmer.id, distance, stroke, today);
  const lines: LimitLine[] = raw.map((l) => ({
    ...l,
    reached: !!best && best.timeCs <= l.cs,
    ...(best && best.timeCs > l.cs ? { gapCs: best.timeCs - l.cs } : {}),
  }));
  const reached = lines.find((l) => l.reached);
  const open = lines.filter((l) => !l.reached);
  return { championship: c, distance, stroke, age, lines, best, reached, next: open[open.length - 1] };
}

/** Écart relatif à la prochaine limite (0,02 = 2 % plus lent) ; pour trier les plus proches. */
export const relativeLimitGap = (s: LimitStatus) => (s.next?.gapCs != null ? s.next.gapCs / s.next.cs : Infinity);

export interface QualifyingSummary {
  /** Épreuves où une limite est atteinte. */
  qualified: LimitStatus[];
  /** Épreuves avec un temps mais sans limite atteinte, les plus proches d'abord. */
  close: LimitStatus[];
}

/** Toutes les épreuves d'un nageur, sur les championnats encore à venir. */
export function qualifyingSummary(
  data: QualifyingData,
  swimmer: { id: string; gender: Gender; birthYear?: number },
  swims: Swim[],
  today: string,
): QualifyingSummary {
  const qualified: LimitStatus[] = [];
  const close: LimitStatus[] = [];
  for (const c of activeChampionships(data, today)) {
    for (const event of Object.keys(c.limits[swimmer.gender] ?? {})) {
      const [d, stroke] = event.split('-');
      const s = limitStatus(c, swimmer, swims, Number(d), stroke as Stroke, today);
      if (!s?.best) continue;
      if (s.reached) qualified.push(s);
      else close.push(s);
    }
  }
  close.sort((a, b) => relativeLimitGap(a) - relativeLimitGap(b));
  return { qualified, close };
}
