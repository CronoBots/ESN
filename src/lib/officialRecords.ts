import type { Gender, Stroke, Swim, Swimmer } from '../store/types';
import type { ClubRecord } from './clubRecords';
import { chronoCompare, countsForRecords } from './stats';
import { holderMatches, type OfficialRecord, type OfficialRecordsList } from './officialRecordsList';

export { holderMatches, parseOfficialRecordsText, validOfficialRecords, type OfficialRecord, type OfficialRecordsList } from './officialRecordsList';

/*
 * Liste officielle des records du club, publiée chiffrée avec l'application (scripts/roster.mjs records).
 * Elle fait foi pour le passé : une course n'est un record du club que si elle bat la liste. Après la date
 * de la liste, une course plus rapide d'un membre devient le record. Tous bassins, comme la liste du club.
 */

/** Âge dans l'année de la course, comme les records du club (clubRecords.ageAt, sans dépendance circulaire). */
const ageAt = (swim: Pick<Swim, 'date'>, swimmer: Pick<Swimmer, 'birthYear'>) => (swimmer.birthYear ? Number(swim.date.slice(0, 4)) - swimmer.birthYear : undefined);

export interface OfficialSection {
  id: string;
  label: string;
  short: string;
  test: (age: number | undefined) => boolean;
}

/** Catégories de la liste du club. « 9 ans » compte aussi les plus jeunes, « Seniors » les 19 ans et plus. */
export const OFFICIAL_SECTIONS: OfficialSection[] = [
  { id: 'all', label: 'Toutes catégories', short: 'Toutes cat.', test: () => true },
  { id: '9', label: '9 ans et moins', short: '9 ans', test: (a) => a != null && a <= 9 },
  ...[10, 11, 12, 13, 14, 15, 16, 17, 18].map((n) => ({ id: String(n), label: `${n} ans`, short: `${n} ans`, test: (a: number | undefined) => a === n })),
  { id: 'seniors', label: 'Seniors (19 ans et plus)', short: 'Seniors', test: (a) => a != null && a >= 19 },
];

/** Membre du club qui détient ce record (nom de la liste du club ou l'un de ses autres noms), s'il est connu. */
export function holderSwimmer(rec: Pick<OfficialRecord, 'holder' | 'gender'>, swimmers: Swimmer[]): Swimmer | undefined {
  const found = swimmers.filter((s) => s.member && s.gender === rec.gender && (holderMatches(rec.holder, s) || s.aliases?.some((a) => holderMatches(rec.holder, a))));
  return found.length === 1 ? found[0] : undefined;
}

/** Catégories de la liste couvertes par une tranche d'âge de l'application (AGE_BANDS). */
const SECTIONS_OF_BAND: Record<string, string[]> = {
  all: ['all'],
  '10': ['9', '10'],
  ...Object.fromEntries([11, 12, 13, 14, 15, 16, 17].map((n) => [String(n), [String(n)]])),
  '18': ['18', 'seniors'],
  masters: [],
};

/** Record officiel le plus rapide pour une tranche d'âge de l'application (tous bassins), s'il y en a un. */
export function officialBest(list: OfficialRecordsList | null | undefined, gender: Gender, bandId: string, distance: number, stroke: Stroke): OfficialRecord | undefined {
  if (!list) return undefined;
  const sections = SECTIONS_OF_BAND[bandId] ?? [];
  let best: OfficialRecord | undefined;
  for (const r of list.records)
    if (r.gender === gender && r.distance === distance && r.stroke === stroke && sections.includes(r.section) && (!best || r.timeCs < best.timeCs)) best = r;
  return best;
}

export interface OfficialStanding {
  distance: number;
  stroke: Stroke;
  official?: OfficialRecord;
  /** Membre qui détient le record officiel, s'il est dans la liste du club. */
  holder?: Swimmer;
  /** Course d'un membre plus rapide, nagée après la date de la liste : c'est le record aujourd'hui. */
  newer?: ClubRecord;
}

const STROKE_ORDER: Stroke[] = ['FREE', 'BACK', 'BREAST', 'FLY', 'IM'];

/** Meilleure course de chaque épreuve depuis la date de la liste (membres, compétition, tous bassins). */
function bestSince(list: OfficialRecordsList, swims: Swim[], swimmers: Swimmer[], gender: Gender, section: OfficialSection): Map<string, ClubRecord> {
  const members = new Map(swimmers.filter((s) => s.member && s.gender === gender).map((s) => [s.id, s]));
  const out = new Map<string, ClubRecord>();
  for (const s of swims) {
    if (s.date <= list.asOf || !countsForRecords(s, false)) continue;
    const sw = members.get(s.swimmerId);
    if (!sw) continue;
    const age = ageAt(s, sw);
    if (!section.test(age)) continue;
    const k = `${s.distance}-${s.stroke}`;
    const cur = out.get(k);
    if (!cur || s.timeCs < cur.swim.timeCs || (s.timeCs === cur.swim.timeCs && chronoCompare(s, cur.swim) < 0)) out.set(k, { swim: s, swimmer: sw, age });
  }
  return out;
}

/** Records d'une catégorie de la liste, filles ou garçons, mis à jour par les courses nagées depuis la liste. */
export function officialStandings(list: OfficialRecordsList, swims: Swim[], swimmers: Swimmer[], gender: Gender, sectionId: string): OfficialStanding[] {
  const section = OFFICIAL_SECTIONS.find((s) => s.id === sectionId) ?? OFFICIAL_SECTIONS[0];
  const rows = new Map<string, OfficialStanding>();
  for (const r of list.records)
    if (r.gender === gender && r.section === section.id) rows.set(`${r.distance}-${r.stroke}`, { distance: r.distance, stroke: r.stroke, official: r, holder: holderSwimmer(r, swimmers) });
  for (const [k, rec] of bestSince(list, swims, swimmers, gender, section)) {
    const row = rows.get(k);
    if (row?.official && rec.swim.timeCs >= row.official.timeCs) continue;
    rows.set(k, { ...(row ?? { distance: rec.swim.distance, stroke: rec.swim.stroke }), newer: rec });
  }
  return [...rows.values()].sort((a, b) => STROKE_ORDER.indexOf(a.stroke) - STROKE_ORDER.indexOf(b.stroke) || a.distance - b.distance);
}

/** Records de la liste battus depuis sa date (et depuis « since ») : une course montrée une fois, à sa catégorie la plus large. */
export function officialRecordsBeaten(
  list: OfficialRecordsList,
  swims: Swim[],
  swimmers: Swimmer[],
  since: string,
): (ClubRecord & { section: OfficialSection; previous?: OfficialRecord })[] {
  const out = new Map<string, ClubRecord & { section: OfficialSection; previous?: OfficialRecord }>();
  for (const section of OFFICIAL_SECTIONS)
    for (const gender of ['F', 'M'] as Gender[])
      for (const row of officialStandings(list, swims, swimmers, gender, section.id))
        if (row.newer && row.newer.swim.date >= since && !out.has(row.newer.swim.id)) out.set(row.newer.swim.id, { ...row.newer, section, previous: row.official });
  return [...out.values()].sort((a, b) => (a.swim.date < b.swim.date ? 1 : -1));
}
