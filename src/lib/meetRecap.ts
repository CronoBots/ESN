import type { Meet, Swim, Swimmer } from '../store/types';
import type { OfficialRecordsList } from './officialRecordsList';
import { isValidResult, type PbInfo } from './stats';
import { medalSwims } from './medals';
import { clubRecords, recordComplete, recordKey } from './clubRecords';
import { limitStatus, type Championship } from './qualifying';
import { courseLabel, eventLabel } from './events';
import { formatRange } from './dates';
import { formatTime } from './time';

/*
 * Récap de l'ESN à une compétition : bilan de chaque nageur du club et du club entier (courses,
 * records personnels, podiums, finales), records du club battus et temps limites atteints, en entier
 * ou pour un seul jour, et le texte à partager (groupe des parents, mail du club).
 */

type Valid = Swim & { timeCs: number };

export interface SwimmerRecap {
  swimmer: Swimmer;
  swims: Swim[];
  /** Au programme, sans les forfaits. */
  total: number;
  /** Nagées, disqualifications comprises. */
  swum: number;
  pbs: number;
  /** Temps gagné sur les records personnels battus (centièmes). */
  gain: number;
  /** Meilleure place d'une épreuve au temps ou d'une finale ; à défaut, meilleur classement des séries. */
  best?: Swim;
  podiums: number;
  finals: number;
  dsq: number;
}

export interface MeetRecap {
  swimmers: SwimmerRecap[];
  swum: number;
  total: number;
  pbs: number;
  /** Nageurs qui ont battu au moins un record personnel. */
  pbSwimmers: number;
  gain: number;
  podiums: number;
  /** Courses de finale (nageurs qualifiés). */
  finals: { swim: Valid; swimmer: Swimmer }[];
  /** Records du club (tous âges) établis à cette compétition et toujours en vigueur. */
  records: { swim: Valid; swimmer: Swimmer }[];
  /** Jours de course (programme compris), dans l'ordre. */
  days: string[];
}

export interface Qualification {
  swim: Valid;
  swimmer: Swimmer;
  championship: Championship;
  /** « A », « B » ou « Limite ». */
  label: string;
}

const isSwum = (s: Swim) => s.status === 'DSQ' || s.status === 'DNF' || (s.status === 'OK' && s.timeCs != null);
const byName = (a: Swimmer, b: Swimmer) => a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr');

/**
 * Récap d'une compétition. `allSwims` : toutes les courses connues (records du club) ; `day` : un seul
 * jour (« 2026-11-21 »), sinon toute la compétition.
 */
/** official : liste officielle des records du club (une course plus lente que la liste n'est pas un record du club). */
export function meetRecap(meetId: string, allSwims: Swim[], swimmers: Swimmer[], pbFlags: Map<string, PbInfo>, day?: string, official?: OfficialRecordsList | null): MeetRecap {
  const atMeet = allSwims.filter((s) => s.meetId === meetId);
  // Une course au jour non relevé (dates de la compétition seulement) : pas de récap jour par jour
  const days = atMeet.some((s) => s.dayRange) ? [] : [...new Set(atMeet.map((s) => s.date))].sort();
  const swims = day ? atMeet.filter((s) => s.date === day) : atMeet;
  const byId = new Map(swimmers.map((s) => [s.id, s]));
  const groups = new Map<string, Swim[]>();
  for (const s of swims) groups.set(s.swimmerId, [...(groups.get(s.swimmerId) ?? []), s]);
  const medals = new Set(medalSwims(atMeet).map((s) => s.id));

  const rows: SwimmerRecap[] = [];
  for (const [id, list] of groups) {
    const swimmer = byId.get(id);
    if (!swimmer) continue;
    const done = list.filter(isValidResult);
    const pbList = done.filter((s) => pbFlags.get(s.id)?.isPB);
    const ranked = done.filter((s) => s.place != null && (s.round === 'TIM' || s.round === 'FINAL')).sort((a, b) => a.place! - b.place!);
    const heats = done.filter((s) => s.place != null && (s.round === 'HEAT' || s.round === 'SEMI')).sort((a, b) => a.place! - b.place!);
    rows.push({
      swimmer,
      swims: list,
      total: list.filter((s) => s.status !== 'DNS').length,
      swum: list.filter(isSwum).length,
      pbs: pbList.length,
      gain: pbList.reduce((a, s) => a - (pbFlags.get(s.id)?.deltaCs ?? 0), 0),
      best: ranked[0] ?? heats[0],
      podiums: list.filter((s) => medals.has(s.id)).length,
      finals: done.filter((s) => s.round === 'FINAL').length,
      dsq: list.filter((s) => s.status === 'DSQ').length,
    });
  }
  rows.sort((a, b) => byName(a.swimmer, b.swimmer));

  const valid = swims.filter((s): s is Valid => isValidResult(s) && byId.has(s.swimmerId));
  const finals = valid
    .filter((s) => s.round === 'FINAL')
    .map((swim) => ({ swim, swimmer: byId.get(swim.swimmerId)! }))
    .sort((a, b) => (a.swim.place ?? 99) - (b.swim.place ?? 99));

  // Records du club : la course est-elle (toujours) le record de son épreuve, tous âges ?
  const records: MeetRecap['records'] = [];
  const cache = new Map<string, ReturnType<typeof clubRecords>>();
  for (const s of valid) {
    const sw = byId.get(s.swimmerId)!;
    if (!sw.member || sw.former || s.context !== 'competition' || !recordComplete(s.course, s.distance, s.stroke)) continue;
    const k = `${s.course}|${sw.gender}`;
    let recs = cache.get(k);
    if (!recs) {
      recs = clubRecords(allSwims, swimmers, { course: s.course, gender: sw.gender, official });
      cache.set(k, recs);
    }
    if (recs.get(recordKey(s.distance, s.stroke))?.swim.id === s.id) records.push({ swim: s, swimmer: sw });
  }

  return {
    swimmers: rows,
    swum: rows.reduce((a, r) => a + r.swum, 0),
    total: rows.reduce((a, r) => a + r.total, 0),
    pbs: rows.reduce((a, r) => a + r.pbs, 0),
    pbSwimmers: rows.filter((r) => r.pbs > 0).length,
    gain: rows.reduce((a, r) => a + r.gain, 0),
    podiums: rows.reduce((a, r) => a + r.podiums, 0),
    finals,
    records,
    days,
  };
}

/**
 * Temps limites atteints à cette compétition : la course devient le meilleur temps du nageur pour un
 * championnat (période et bassins acceptés) et passe une limite qu'il n'avait pas encore (ou une plus
 * exigeante : B puis A).
 */
export function meetQualifications(
  meetSwims: Swim[],
  allSwims: Swim[],
  swimmers: Swimmer[],
  championships: Championship[],
): Qualification[] {
  const byId = new Map(swimmers.map((s) => [s.id, s]));
  const bySwimmer = new Map<string, Swim[]>();
  for (const s of allSwims) bySwimmer.set(s.swimmerId, [...(bySwimmer.get(s.swimmerId) ?? []), s]);
  const out: Qualification[] = [];
  for (const s of meetSwims) {
    if (!isValidResult(s)) continue;
    const swimmer = byId.get(s.swimmerId);
    if (!swimmer) continue;
    const mine = (bySwimmer.get(s.swimmerId) ?? []).filter((x) => x.date <= s.date);
    for (const c of championships) {
      if (!c.accepts.includes(s.course) || s.date < c.window.from || s.date > c.window.to) continue;
      const after = limitStatus(c, swimmer, mine, s.distance, s.stroke, s.date);
      if (!after?.reached || after.best?.id !== s.id) continue;
      const before = limitStatus(
        c,
        swimmer,
        mine.filter((x) => x.id !== s.id),
        s.distance,
        s.stroke,
        s.date,
      );
      if (before?.reached && before.lines.indexOf(before.reached) <= after.lines.findIndex((l) => l.label === after.reached!.label)) continue;
      out.push({ swim: s as Valid, swimmer, championship: c, label: after.reached.label });
    }
  }
  return out.sort((a, b) => byName(a.swimmer, b.swimmer));
}

const place = (p: number) => `${p}${p === 1 ? 're' : 'e'}`;
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Texte du récap à partager (groupe des parents, mail du club). */
export function recapText(
  meet: Meet,
  r: MeetRecap,
  quals: Qualification[],
  champName: (c: Championship) => string,
  url: string,
  /** Récap d'un seul jour (« Samedi 21 novembre »). */
  dayLabel?: string,
): string {
  const ev = (s: Swim) => eventLabel(s.distance, s.stroke);
  const name = (sw: Swimmer) => `${sw.firstName} ${sw.lastName}`;
  const lines: string[] = [];
  lines.push(`🏊 ESN · ${meet.name}`);
  lines.push([dayLabel ?? formatRange(meet.startDate, meet.endDate), meet.city, courseLabel(meet.course)].filter(Boolean).join(' · '));
  lines.push('');
  lines.push(
    [
      plural(r.swimmers.length, 'nageur'),
      plural(r.swum, 'course'),
      `${plural(r.pbs, 'record')} perso${r.pbs ? ` (${plural(r.pbSwimmers, 'nageur')})` : ''}`,
      plural(r.podiums, 'podium'),
      r.finals.length ? plural(r.finals.length, 'finale') : null,
    ]
      .filter(Boolean)
      .join(' · '),
  );
  if (r.records.length) {
    lines.push('');
    lines.push('🏆 Records du club');
    for (const { swim, swimmer } of r.records) lines.push(`• ${name(swimmer)} · ${ev(swim)} ${courseLabel(swim.course)} en ${formatTime(swim.timeCs)}`);
  }
  if (quals.length) {
    lines.push('');
    lines.push('🎯 Temps limites atteints');
    for (const q of quals) lines.push(`• ${name(q.swimmer)} · ${ev(q.swim)} en ${formatTime(q.swim.timeCs)} · ${champName(q.championship)}${q.label === 'Limite' ? '' : ` (${q.label})`}`);
  }
  if (r.finals.length) {
    lines.push('');
    lines.push('🏁 Finales');
    for (const { swim, swimmer } of r.finals) lines.push(`• ${name(swimmer)} · ${ev(swim)} en ${formatTime(swim.timeCs)}${swim.place ? ` · ${place(swim.place)}` : ''}`);
  }
  lines.push('');
  for (const s of r.swimmers) {
    const bits = [
      s.swum ? plural(s.swum, 'course') : s.total ? `${plural(s.total, 'course')} à venir` : 'forfait',
      s.pbs ? `${s.pbs} PB (−${formatTime(s.gain)})` : null,
      s.best?.place ? `${s.best.round === 'HEAT' || s.best.round === 'SEMI' ? 'séries' : 'meilleure place'} ${place(s.best.place)} (${ev(s.best)})` : null,
    ].filter(Boolean);
    lines.push(`• ${name(s.swimmer)} : ${bits.join(', ')}`);
  }
  lines.push('');
  lines.push(`Résultats complets dans l’app ESN Compétition : ${url}`);
  return lines.join('\n');
}

/** Compétitions du club en cours aujourd'hui (au moins une course d'un membre actif). */
export function liveClubMeets(meets: Meet[], swims: Swim[], swimmers: Swimmer[], today: string): Meet[] {
  const members = new Set(swimmers.filter((s) => s.member && !s.former).map((s) => s.id));
  const withClub = new Set(swims.filter((s) => s.meetId && members.has(s.swimmerId)).map((s) => s.meetId!));
  return meets.filter((m) => m.startDate <= today && (m.endDate ?? m.startDate) >= today && withClub.has(m.id));
}

export interface MeetSummary {
  swimmers: number;
  swum: number;
  pbs: number;
  podiums: number;
}

/** Bilan court de chaque compétition (liste des compétitions du club), en un seul passage. */
export function meetSummaries(swims: Swim[], swimmers: Swimmer[], pbFlags: Map<string, PbInfo>): Map<string, MeetSummary> {
  const members = new Set(swimmers.filter((s) => s.member && !s.former).map((s) => s.id));
  const medals = new Set(medalSwims(swims).map((s) => s.id));
  const out = new Map<string, MeetSummary & { ids: Set<string> }>();
  for (const s of swims) {
    if (!s.meetId || !members.has(s.swimmerId)) continue;
    let m = out.get(s.meetId);
    if (!m) out.set(s.meetId, (m = { swimmers: 0, swum: 0, pbs: 0, podiums: 0, ids: new Set() }));
    m.ids.add(s.swimmerId);
    if (isSwum(s)) m.swum++;
    if (pbFlags.get(s.id)?.isPB) m.pbs++;
    if (medals.has(s.id)) m.podiums++;
  }
  return new Map([...out].map(([id, { ids, ...m }]) => [id, { ...m, swimmers: ids.size }]));
}
