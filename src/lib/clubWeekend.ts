import type { Meet, Swim, Swimmer } from '../store/types';
import type { OfficialRecordsList } from './officialRecordsList';
import { clubRecords, recordComplete, recordKey } from './clubRecords';
import { isValidResult, type PbInfo } from './stats';
import { addDays } from './dates';
import { medalSwims } from './medals';

/** Une progression du week-end : record personnel amélioré de deltaCs centièmes (pct % de l'ancien record). */
export interface WeekendProgress {
  swim: Swim & { timeCs: number };
  swimmer: Swimmer;
  deltaCs: number;
  pct: number;
}

export interface ClubWeekend {
  /** Premier et dernier jour de course du week-end. */
  start: string;
  end: string;
  meets: Meet[];
  /** Courses valides des nageurs du club ce week-end. */
  swims: (Swim & { timeCs: number })[];
  swimmerIds: string[];
  /** Records personnels améliorés. */
  pbs: number;
  /** Premières courses sur une épreuve. */
  firsts: number;
  /** Places 1 à 3. */
  podiums: number;
  /** Plus belles progressions, en part du temps gagnée (comparable d'un 50 m à un 1500 m), les 3 premières. */
  progress: WeekendProgress[];
  /**
   * Records du club (tous âges) établis ce week-end. Pas de record par âge : pour les anciens
   * membres, seul le meilleur temps à vie est connu, un « record à 12 ans » pourrait être faux.
   */
  records: { swim: Swim & { timeCs: number }; swimmer: Swimmer }[];
}

/**
 * Dernier week-end de compétition du club : les courses des nageurs du club (membres
 * actuels) nagées dans les 3 jours qui précèdent la plus récente, jusqu'à aujourd'hui.
 */
export function lastClubWeekend(
  swims: Swim[],
  swimmers: Swimmer[],
  meets: Meet[],
  pbFlags: Map<string, PbInfo>,
  today: string,
  /** Liste officielle des records du club : une course plus lente que la liste n'est pas un record du club. */
  official?: OfficialRecordsList | null,
): ClubWeekend | null {
  const members = new Map(swimmers.filter((s) => s.member && !s.former).map((s) => [s.id, s]));
  const valid = swims.filter(
    (s): s is Swim & { timeCs: number } => s.context === 'competition' && isValidResult(s) && s.date <= today && members.has(s.swimmerId),
  );
  if (!valid.length) return null;
  const end = valid.reduce((d, s) => (s.date > d ? s.date : d), valid[0].date);
  const from = addDays(end, -3);
  const week = valid.filter((s) => s.date >= from);
  const start = week.reduce((d, s) => (s.date < d ? s.date : d), end);
  const meetIds = [...new Set(week.map((s) => s.meetId).filter((id): id is string => !!id))];
  const byId = new Map(meets.map((m) => [m.id, m]));

  const progress: WeekendProgress[] = [];
  let pbs = 0;
  let firsts = 0;
  for (const s of week) {
    const f = pbFlags.get(s.id);
    if (f?.isFirst) firsts++;
    if (f?.isPB) {
      pbs++;
      if (f.deltaCs != null && f.deltaCs < 0) {
        const gain = -f.deltaCs;
        progress.push({ swim: s, swimmer: members.get(s.swimmerId)!, deltaCs: gain, pct: (gain / (s.timeCs + gain)) * 100 });
      }
    }
  }
  progress.sort((a, b) => b.pct - a.pct);

  // Records du club : la course est-elle (encore) le record de son épreuve, tous âges ?
  const records: ClubWeekend['records'] = [];
  const cache = new Map<string, ReturnType<typeof clubRecords>>();
  for (const s of week) {
    // Épreuve où les anciens membres ne sont pas relevés : pas de « record du club » annoncé
    if (!recordComplete(s.course, s.distance, s.stroke)) continue;
    const sw = members.get(s.swimmerId)!;
    const k = `${s.course}|${sw.gender}`;
    let recs = cache.get(k);
    if (!recs) {
      recs = clubRecords(swims, swimmers, { course: s.course, gender: sw.gender, official });
      cache.set(k, recs);
    }
    if (recs.get(recordKey(s.distance, s.stroke))?.swim.id === s.id) records.push({ swim: s, swimmer: sw });
  }

  return {
    start,
    end,
    meets: meetIds.map((id) => byId.get(id)).filter((m): m is Meet => !!m),
    swims: week,
    swimmerIds: [...new Set(week.map((s) => s.swimmerId))],
    pbs,
    firsts,
    // Même règle que les médailles : la place de série ne compte pas quand le nageur a nagé la finale
    podiums: medalSwims(week).length,
    progress: progress.slice(0, 3),
    records,
  };
}
