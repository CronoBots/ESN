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
  /** Sélection par classement aux points (pas de temps limite) : épreuves imposées par catégorie d'âge. */
  allround?: {
    categories: AllroundCategory[];
    /** Classement de la fédération (outil « Belswim ranking »), d'où viennent les repères. */
    ranking?: string;
    /**
     * Points de la fédération ÷ `pointsScale` = points au barème de l'application. La fédération utilise un
     * barème World Aquatics plus ancien, plus généreux (mesuré sur les nageurs de l'ESN classés en 2026 : 2,5 %).
     */
    pointsScale?: number;
  };
}

export interface AllroundCategory {
  /** « Jeunes 1 (11-12 ans) » (nom du règlement en français) */
  label: string;
  minAge: number;
  maxAge: number;
  /** Nombre de nageurs sélectionnés (les premiers du classement), par sexe. */
  selected: number;
  /** Épreuves imposées ; un tableau = au choix (le meilleur nombre de points), ex. 50 ou 100 m papillon. */
  events: (string | string[])[];
  /**
   * Nombre de meilleurs résultats comptés (« les 4 meilleurs sur 5 ») ; il faut un temps sur au moins
   * autant d'épreuves pour être classé. Absent : toutes les épreuves.
   */
  counted?: number;
  /**
   * Repère de l'édition précédente : total de points du dernier sélectionné (en vert au classement de la
   * fédération), et son rang (plus loin que `selected` quand des nageurs mieux classés n'ont pas participé),
   * par sexe. Seulement des totaux, aucun nom.
   */
  previous?: { edition: number; cutoff: Record<Gender, number>; rank?: Record<Gender, number> };
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
    for (const cat of c.allround?.categories ?? []) {
      if (!cat.label || !(cat.minAge <= cat.maxAge) || !(cat.selected > 0) || !Array.isArray(cat.events) || !cat.events.length)
        throw new Error(`${where} : catégorie du classement invalide`);
      if (cat.counted != null && !(Number.isInteger(cat.counted) && cat.counted >= 1 && cat.counted <= cat.events.length))
        throw new Error(`${where} : nombre de résultats comptés invalide`);
      for (const e of cat.events.flat()) if (!EVENT.test(e)) throw new Error(`${where} : épreuve inconnue « ${e} »`);
      if (cat.previous && !(Number.isInteger(cat.previous.edition) && cat.previous.cutoff?.F > 0 && cat.previous.cutoff?.M > 0))
        throw new Error(`${where} : repère de l'édition précédente invalide`);
    }
    const scale = c.allround?.pointsScale;
    if (scale != null && !(scale >= 0.8 && scale <= 1.2)) throw new Error(`${where} : échelle des points de la fédération invalide`);
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

export interface AllroundEvent {
  /** Épreuves possibles (« 50-FLY », « 100-FLY ») ; la première sert de libellé. */
  events: string[];
  best?: Swim & { timeCs: number };
  points?: number;
  /** Parmi les meilleurs résultats comptés dans le total. */
  counted?: boolean;
}

export interface AllroundStatus {
  championship: Championship;
  category: AllroundCategory;
  age: number;
  events: AllroundEvent[];
  /** Somme des points des meilleurs résultats comptés. */
  total: number;
  /** Un temps sur assez d'épreuves (toutes, ou le nombre de résultats comptés) : condition pour être classé. */
  complete: boolean;
  /**
   * Repère : total du dernier sélectionné de l'édition précédente, et écart du nageur (positif : au-dessus),
   * avec l'écart moyen par résultat compté.
   */
  benchmark?: {
    edition: number;
    /** Repère au barème de l'application (comparable au total). */
    points: number;
    /** Repère tel que publié par la fédération (son barème). */
    official: number;
    /** Rang du dernier sélectionné au classement de la fédération. */
    rank?: number;
    gap: number;
    perEvent: number;
  };
}

/**
 * Classement aux points d'un championnat (ex. Belgique 11-16 ans) : pour chaque épreuve imposée,
 * le meilleur nombre de points World Aquatics de la période (25 ou 50 m), puis la somme.
 */
export function allroundStatus(
  c: Championship,
  swimmer: { id: string; gender: Gender; birthYear?: number },
  swims: Swim[],
  today: string,
  points: (s: Swim & { timeCs: number }) => number | null,
): AllroundStatus | null {
  if (!c.allround || !swimmer.birthYear) return null;
  const age = c.edition - swimmer.birthYear;
  const category = c.allround.categories.find((cat) => age >= cat.minAge && age <= cat.maxAge);
  if (!category) return null;
  const to = c.window.to < today ? c.window.to : today;
  const events = category.events.map((e): AllroundEvent => {
    const keys = Array.isArray(e) ? e : [e];
    let best: AllroundEvent = { events: keys };
    for (const s of swims) {
      if (s.swimmerId !== swimmer.id || !keys.includes(`${s.distance}-${s.stroke}`) || !c.accepts.includes(s.course)) continue;
      if (s.date < c.window.from || s.date > to || !countsForRecords(s, false)) continue;
      const p = points(s);
      if (p != null && (best.points == null || p > best.points)) best = { events: keys, best: s, points: p };
    }
    return best;
  });
  // Seuls les meilleurs résultats comptent (« les 4 meilleurs sur 5 ») ; à défaut, toutes les épreuves
  const need = category.counted ?? events.length;
  const best = events
    .filter((e) => e.points != null)
    .sort((a, b) => b.points! - a.points!)
    .slice(0, need);
  for (const e of best) e.counted = true;
  const total = best.reduce((n, e) => n + e.points!, 0);
  const official = category.previous?.cutoff[swimmer.gender];
  // Repère ramené au barème de l'application (la fédération compte ~2,5 % de points en plus)
  const cutoff = official ? Math.round(official / (c.allround.pointsScale ?? 1)) : undefined;
  return {
    championship: c,
    category,
    age,
    events,
    total,
    complete: events.filter((e) => e.points != null).length >= need,
    benchmark:
      official && cutoff
        ? {
            edition: category.previous!.edition,
            points: cutoff,
            official,
            rank: category.previous!.rank?.[swimmer.gender],
            gap: total - cutoff,
            perEvent: Math.ceil(Math.abs(total - cutoff) / need),
          }
        : undefined,
  };
}

/** Écart relatif à la prochaine limite (0,02 = 2 % plus lent) ; pour trier les plus proches. */
export const relativeLimitGap = (s: LimitStatus) => (s.next?.gapCs != null ? s.next.gapCs / s.next.cs : Infinity);

export interface QualifyingSummary {
  /** Épreuves où une limite est atteinte. */
  qualified: LimitStatus[];
  /** Épreuves avec un temps mais sans limite atteinte, les plus proches d'abord (période encore ouverte). */
  close: LimitStatus[];
}

export interface QualificationHighlights {
  /** Championnats où le nageur est qualifié, avec ses épreuves ; le plus d'épreuves d'abord. */
  qualified: { championship: Championship; events: LimitStatus[] }[];
  /** Sans qualification : la limite la plus proche, si elle est à portée (écart relatif au plus `maxGap`). */
  closest?: LimitStatus;
}

/** L'essentiel des qualifications pour l'en-tête d'une fiche : où il est qualifié, sinon ce qui s'en approche le plus. */
export function qualificationHighlights(s: QualifyingSummary, maxGap = 0.1): QualificationHighlights {
  const by = new Map<string, { championship: Championship; events: LimitStatus[] }>();
  for (const q of s.qualified) {
    const e = by.get(q.championship.id) ?? { championship: q.championship, events: [] };
    e.events.push(q);
    by.set(q.championship.id, e);
  }
  const qualified = [...by.values()].sort((a, b) => b.events.length - a.events.length || (a.championship.until < b.championship.until ? -1 : 1));
  const near = s.close[0];
  return { qualified, ...(!qualified.length && near && relativeLimitGap(near) <= maxGap ? { closest: near } : {}) };
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
      // Période de qualification close : plus rien « à gagner », seules les qualifications acquises restent
      else if (today <= c.window.to) close.push(s);
    }
  }
  close.sort((a, b) => relativeLimitGap(a) - relativeLimitGap(b));
  return { qualified, close };
}
