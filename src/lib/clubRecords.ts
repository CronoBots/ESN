import type { Course, Gender, Stroke, Swim, Swimmer } from '../store/types';
import { chronoCompare, countsForRecords } from './stats';
import { holderSwimmer, officialBest, type OfficialRecordsList } from './officialRecords';
// (officialRecords n'importe de ce fichier que des types : pas de dépendance circulaire à l'exécution)

/**
 * Records du club : meilleur temps de tous les nageurs de l'ESN (membres actuels et
 * anciens) sur chaque épreuve, par bassin, filles ou garçons, et par âge.
 */

/** Âge dans l'année de la course (comme les catégories d'âge de la fédération). */
export function ageAt(swim: Pick<Swim, 'date'>, swimmer: Pick<Swimmer, 'birthYear'>): number | undefined {
  return swimmer.birthYear ? Number(swim.date.slice(0, 4)) - swimmer.birthYear : undefined;
}

export interface AgeBand {
  id: string;
  label: string;
  /** Libellé court pour les puces. */
  short: string;
  test: (age: number | undefined) => boolean;
}

export const AGE_BANDS: AgeBand[] = [
  { id: 'all', label: 'Tous âges', short: 'Tous âges', test: () => true },
  { id: '10', label: '10 ans et moins', short: '10 ans et –', test: (a) => a != null && a <= 10 },
  ...[11, 12, 13, 14, 15, 16, 17].map((n) => ({ id: String(n), label: `${n} ans`, short: `${n} ans`, test: (a: number | undefined) => a === n })),
  { id: '18', label: '18 ans et plus', short: '18 ans et +', test: (a) => a != null && a >= 18 },
  { id: 'masters', label: 'Masters (25 ans et plus)', short: 'Masters', test: (a) => a != null && a >= 25 },
];

/** Tranche d'âge d'un nageur cette année (la plus précise : « 12 ans », « 18 ans et plus »). */
export function bandForAge(age: number | undefined): AgeBand | undefined {
  if (age == null) return undefined;
  return AGE_BANDS.find((b) => b.id !== 'all' && b.id !== 'masters' && b.test(age));
}

/**
 * Nageur dont l'âge est proposé en raccourci sur les records du club (« 12 ans · Emma ») : nageur suivi
 * ou ajouté à la main. Jamais un nageur du club pris par défaut quand on n'en suit aucun (le premier de la
 * liste du club devient le nageur choisi à son chargement, sans que l'utilisateur l'ait choisi).
 */
export function shortcutSwimmer(selected: Swimmer | undefined): Swimmer | undefined {
  return selected && (selected.favorite || selected.relation === 'child' || !selected.member) ? selected : undefined;
}

export interface ClubRecord {
  swim: Swim & { timeCs: number };
  swimmer: Swimmer;
  /** Âge dans l'année du record. */
  age?: number;
}

/** Clé d'épreuve : « 100-FREE ». */
export const recordKey = (distance: number, stroke: Stroke) => `${distance}-${stroke}`;

/**
 * Épreuves dont les 10 meilleurs temps ESN de tous les temps sont relevés (classements
 * « Meilleurs à vie » du club sur swimrankings, filles et garçons, 25 et 50 m) : toutes à partir
 * du 50 m. Les épreuves de 25 m (jeunes) n'y figurent pas : seulement un « meilleur temps connu ».
 */
export function recordComplete(_course: Course, distance: number, _stroke: Stroke): boolean {
  return distance >= 50;
}

/**
 * Membres du club qui détiennent au moins un record (une épreuve, un bassin, une tranche d'âge,
 * tous âges compris), comme clubRecords, et ceux de la liste officielle du club. Sert à n'afficher que les
 * anciens membres qui ont marqué le club.
 */
export function recordHolders(swims: Swim[], swimmers: Swimmer[], official?: OfficialRecordsList | null): Set<string> {
  const members = new Map(swimmers.filter((s) => s.member).map((s) => [s.id, s]));
  const best = new Map<string, Swim & { timeCs: number }>();
  for (const s of swims) {
    if (!countsForRecords(s, false)) continue;
    const swimmer = members.get(s.swimmerId);
    if (!swimmer) continue;
    const age = ageAt(s, swimmer);
    for (const band of AGE_BANDS) {
      if (!band.test(age)) continue;
      const k = `${s.course}|${swimmer.gender}|${band.id}|${recordKey(s.distance, s.stroke)}`;
      const cur = best.get(k);
      if (!cur || s.timeCs < cur.timeCs || (s.timeCs === cur.timeCs && chronoCompare(s, cur) < 0)) best.set(k, s);
    }
  }
  const out = new Set([...best.values()].map((s) => s.swimmerId));
  for (const r of official?.records ?? []) {
    const sw = holderSwimmer(r, swimmers);
    if (sw) out.add(sw.id);
  }
  return out;
}

/**
 * Record de chaque épreuve pour un bassin, un sexe et une tranche d'âge : temps le plus
 * rapide en compétition d'un membre du club (à temps égal, le premier réalisé).
 * Avec la liste officielle du club (opts.official) : un temps plus lent que le record de la liste
 * (tous bassins) n'est pas le record du club, l'épreuve est alors absente du résultat.
 */
export function clubRecords(
  swims: Swim[],
  swimmers: Swimmer[],
  opts: { course: Course; gender: Gender; band?: AgeBand; official?: OfficialRecordsList | null },
): Map<string, ClubRecord> {
  const members = new Map(swimmers.filter((s) => s.member && s.gender === opts.gender).map((s) => [s.id, s]));
  const band = opts.band ?? AGE_BANDS[0];
  const out = new Map<string, ClubRecord>();
  for (const s of swims) {
    if (s.course !== opts.course || !countsForRecords(s, false)) continue;
    const swimmer = members.get(s.swimmerId);
    if (!swimmer) continue;
    const age = ageAt(s, swimmer);
    if (!band.test(age)) continue;
    const k = recordKey(s.distance, s.stroke);
    const cur = out.get(k);
    if (!cur || s.timeCs < cur.swim.timeCs || (s.timeCs === cur.swim.timeCs && chronoCompare(s, cur.swim) < 0)) {
      out.set(k, { swim: s, swimmer, age });
    }
  }
  if (opts.official)
    for (const [k, r] of out) {
      const best = officialBest(opts.official, opts.gender, band.id, r.swim.distance, r.swim.stroke);
      if (best && r.swim.timeCs > best.timeCs) out.delete(k);
    }
  return out;
}
