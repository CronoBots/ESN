import type { Swim } from '../store/types';

/** Course nagée avec un temps valide (comme isValidResult de stats, sans import circulaire). */
const isValidResult = (s: Swim): s is Swim & { timeCs: number } => s.status === 'OK' && typeof s.timeCs === 'number' && s.timeCs > 0;

/**
 * Médailles : 1re, 2e ou 3e place d'une course en compétition (classement de la catégorie, tel que
 * publié dans les résultats : pages de compétition du club sur swimrankings, résultats officiels, direct).
 */

/**
 * Nombre de médailles affiché pour les membres actifs (décision du club, 20 nov. 2026 ; pas pour les anciens :
 * seuls leurs temps comptent), compté depuis MEDALS_SINCE, d'où les places des actifs sont toutes connues.
 */
export const SHOW_MEDAL_COUNTS = true;

/**
 * Début du compte des médailles : saison 2017/18. Depuis, chaque course classée d'un membre actif a sa place
 * (les autres sont des premiers relayeurs ou des temps de passage, sans place) ; avant, les classements ne sont
 * pas encore tous relevés. À avancer quand les compétitions plus anciennes seront lues.
 */
export const MEDALS_SINCE = '2017-09-01';

export interface MedalCount {
  gold: number;
  silver: number;
  bronze: number;
  total: number;
}

export type MedalSwim = Swim & { timeCs: number; place: 1 | 2 | 3 };

const eventKey = (s: Swim) => `${s.swimmerId}|${s.meetId ?? s.date}|${s.distance}|${s.stroke}|${s.course}`;

/**
 * Courses médaillées. Une place de série ne compte pas quand le nageur a nagé la finale (ou la
 * demi-finale) de la même épreuve : seule la place de la finale est une médaille.
 */
export function medalSwims(swims: Swim[], swimmerId?: string): MedalSwim[] {
  const mine = swimmerId ? swims.filter((s) => s.swimmerId === swimmerId) : swims;
  const finals = new Set(mine.filter((s) => s.round === 'FINAL' && isValidResult(s)).map(eventKey));
  const semis = new Set(mine.filter((s) => s.round === 'SEMI' && isValidResult(s)).map(eventKey));
  return mine.filter((s): s is MedalSwim => {
    if (s.context !== 'competition' || !isValidResult(s) || s.place == null || s.place < 1 || s.place > 3) return false;
    if (s.round === 'HEAT') return !finals.has(eventKey(s)) && !semis.has(eventKey(s));
    if (s.round === 'SEMI') return !finals.has(eventKey(s));
    return true;
  });
}

/** Courses médaillées comptées dans le nombre de médailles : depuis MEDALS_SINCE. */
export function countedMedalSwims(swims: Swim[], swimmerId?: string): MedalSwim[] {
  return medalSwims(swims, swimmerId).filter((s) => s.date >= MEDALS_SINCE);
}

export function medalCount(list: MedalSwim[]): MedalCount {
  const c = { gold: 0, silver: 0, bronze: 0, total: list.length };
  for (const s of list) {
    if (s.place === 1) c.gold++;
    else if (s.place === 2) c.silver++;
    else c.bronze++;
  }
  return c;
}

/** Première date où le classement d'une course du nageur est connu (undefined : aucun classement). */
export function placesKnownSince(swims: Swim[], swimmerId: string): string | undefined {
  let first: string | undefined;
  for (const s of swims) if (s.swimmerId === swimmerId && s.place != null && s.context === 'competition' && (!first || s.date < first)) first = s.date;
  return first;
}
