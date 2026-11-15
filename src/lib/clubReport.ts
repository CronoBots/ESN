import type { Course, Round, Stroke } from '../store/types';
import { makeISO, monthFromToken } from './dates';
import { isValidEvent } from './events';

/**
 * Lecture des « résultats par club » publiés par les clubs (rapport Splash
 * Team / Meet Manager, format PDF). Exemple de structure :
 *
 *   Championnat de District LNL 2026
 *   FFBN - Bastogne (25m) - Du samedi 17 octobre 2026 au dimanche 18 octobre 2026
 *    DUPONT Emma            CLUB/012345/14 12 ans
 *   2   50m Nage Libre           00:34,56   25m
 *                                     00:34,45   11
 *   3   100m Nage Libre          01:15,55   25m
 *                                     01:15,06   9    00:35,83 (50m)
 */

export interface ReportMeet {
  name: string;
  organizer?: string;
  city?: string;
  course: Course;
  startDate: string;
  endDate?: string;
}

export interface ReportSwim {
  eventNo?: number;
  distance: number;
  stroke: Stroke;
  course: Course;
  round: Round;
  entryCs?: number;
  timeCs?: number;
  status: 'OK' | 'DSQ' | 'DNS' | 'DNF';
  place?: number;
  splits?: number[];
}

export interface ReportSwimmer {
  lastName: string;
  firstName: string;
  club: string;
  license: string;
  birthYear?: number;
  swims: ReportSwim[];
}

export interface ClubReport {
  meet: ReportMeet;
  swimmers: ReportSwimmer[];
}

const STROKE_RE: [RegExp, Stroke][] = [
  [/^(nage\s+libre|libre|vrije\s*slag|freestyle|crawl)/i, 'FREE'],
  [/^(dos|rugslag|backstroke)/i, 'BACK'],
  [/^(brasse|schoolslag|breaststroke)/i, 'BREAST'],
  [/^(papillon|vlinderslag|butterfly)/i, 'FLY'],
  [/^(4\s*nages|wisselslag|medley|quatre\s+nages)/i, 'IM'],
];

/** "01:15,06" | "1:15.06" | "35,83" → centièmes */
export function reportTime(s: string): number | null {
  const m = /^(?:(\d{1,2}):)?(\d{1,2})[,.](\d{2})$/.exec(s.trim());
  if (!m) return null;
  return ((m[1] ? +m[1] : 0) * 60 + +m[2]) * 100 + +m[3];
}

const TIME = String.raw`\d{1,2}:\d{2}[,.]\d{2}`;

// En-tête du nageur : "DUPONT Emma   CLUB/012345/14 12 ans" (l'espace avant l'âge peut manquer)
const SWIMMER_RE = new RegExp(
  String.raw`^\s*((?:[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'’\-]*\s+)+)([A-ZÀ-ÖØ-Þ][^\d/]*?)\s+([A-Z][A-Z0-9]{1,11})\/(\d{3,8})\/(\d{2})\s*(\d{1,3})?\s*(?:ans|jaar)?\s*$`,
);
// Épreuve : "3   100m Nage Libre - Séries     01:15,55   25m"
// (le résultat peut suivre sur la même ligne : « … 25m   01:15,06 9 00:35,83 (50m) »)
const EVENT_RE = new RegExp(String.raw`^\s*(\d{1,3})\s+(\d{2,4})\s?m\s+(.+?)\s+(${TIME}|NT|-)\s+(25|50)\s?m(?:\s+(.*))?\s*$`, 'i');
// Résultat : "      01:15,06   9    00:35,83 (50m)"
const RESULT_RE = new RegExp(String.raw`^\s*(${TIME})(?:\s+(\d{1,3})\b)?(.*)$`);
const STATUS_RE = /^\s*(DSQ|DQ|disq\.?|disqualifi\S*|dis|DNS|NS|forfait|abs\.?|absent|DNF|abandon|ABD|FF)\b/i;
const SPLIT_RE = new RegExp(String.raw`(${TIME})\s*\((\d{2,4})\s?m\)`, 'g');
// "FFBN - Bastogne (25m) - Du samedi 17 octobre 2026 au dimanche 18 octobre 2026"
const MEET_LINE_RE = /^\s*(?:(.*?)\s+)?-\s+(.+?)\s*\((25|50)\s?m\)\s*-\s*(.+?)\s*$/;

function parseStroke(label: string): { stroke: Stroke; round: Round } | null {
  const l = label.trim();
  for (const [re, stroke] of STROKE_RE) {
    if (re.test(l)) {
      const round: Round = /finale?\b/i.test(l) && !/s[ée]ries/i.test(l)
        ? /demi/i.test(l)
          ? 'SEMI'
          : 'FINAL'
        : /s[ée]ries|reeksen|heats?/i.test(l)
          ? 'HEAT'
          : 'TIM';
      return { stroke, round };
    }
  }
  return null;
}

function parseDates(text: string): { start?: string; end?: string } {
  const re = /(\d{1,2})(?:er)?\s+([A-Za-zÀ-ÿ.]+)\s+(\d{4})/g;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const month = monthFromToken(m[2]);
    const iso = month ? makeISO(+m[3], month, +m[1]) : null;
    if (iso) found.push(iso);
  }
  // Format numérique « 17 - 19/7/2026 » ou « 12-10-2025 »
  if (!found.length) {
    const n = /(\d{1,2})\s*-\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(text);
    if (n) {
      const a = makeISO(+n[4], +n[3], +n[1]);
      const b = makeISO(+n[4], +n[3], +n[2]);
      if (a) found.push(a);
      if (b) found.push(b);
    }
  }
  if (!found.length) return {};
  found.sort();
  return { start: found[0], end: found[found.length - 1] !== found[0] ? found[found.length - 1] : undefined };
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'’])([a-zà-ÿ])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}

/** Vrai si le texte ressemble à un rapport « résultats par club ». */
export function looksLikeClubReport(lines: string[]): boolean {
  return lines.some((l) => SWIMMER_RE.test(l)) && lines.some((l) => EVENT_RE.test(l));
}

export function parseMeetHeader(lines: string[]): ReportMeet | null {
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  for (let i = 1; i < Math.min(nonEmpty.length, 8); i++) {
    const m = MEET_LINE_RE.exec(nonEmpty[i]);
    if (!m) continue;
    const dates = parseDates(m[4]);
    if (!dates.start) continue;
    const city = m[2]
      .replace(/^\d{4}\s*-?\s*/, '') // code postal
      .trim();
    return {
      name: nonEmpty[i - 1].replace(/\s+/g, ' '),
      organizer: m[1]?.trim() || undefined,
      city: city || undefined,
      course: m[3] === '50' ? 'LCM' : 'SCM',
      startDate: dates.start,
      endDate: dates.end,
    };
  }
  return null;
}

export function parseClubReport(lines: string[]): ClubReport | null {
  const meet = parseMeetHeader(lines);
  if (!meet) return null;
  const swimmers = new Map<string, ReportSwimmer>();
  let current: ReportSwimmer | null = null;
  let pending: ReportSwim | null = null;
  const thisYear = new Date().getFullYear() % 100;

  const flush = () => {
    if (pending && current) current.swims.push(pending);
    pending = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/ /g, ' ');
    if (!line.trim()) continue;

    const sw = SWIMMER_RE.exec(line);
    if (sw) {
      flush();
      const lastName = titleCase(sw[1].trim());
      const firstName = sw[2].trim();
      const license = `${sw[3]}/${sw[4]}/${sw[5]}`;
      const yy = +sw[5];
      const birthYear = yy <= thisYear ? 2000 + yy : 1900 + yy;
      const key = license;
      current = swimmers.get(key) ?? { lastName, firstName, club: sw[3], license, birthYear, swims: [] };
      swimmers.set(key, current);
      continue;
    }

    const ev = EVENT_RE.exec(line);
    if (ev) {
      flush();
      const parsed = parseStroke(ev[3]);
      const distance = +ev[2];
      const course: Course = ev[5] === '50' ? 'LCM' : 'SCM';
      if (!parsed || !current || !isValidEvent(distance, parsed.stroke, course)) {
        pending = null;
        continue;
      }
      const entry = ev[4] !== 'NT' && ev[4] !== '-' ? reportTime(ev[4]) : null;
      pending = {
        eventNo: +ev[1],
        distance,
        stroke: parsed.stroke,
        course,
        round: parsed.round,
        entryCs: entry != null && entry < 59 * 6000 ? entry : undefined,
        status: 'OK',
      };
      if (ev[6]?.trim()) readResult(pending, ev[6]);
      continue;
    }

    if (!pending) continue;
    readResult(pending, line);
  }
  flush();

  const list = [...swimmers.values()].filter((s) => s.swims.length);
  return { meet, swimmers: list };
}

/** Lit un résultat (temps, place, passages) ou un statut (DSQ, forfait…). */
function readResult(p: ReportSwim, line: string) {
  {
    if (p.timeCs == null && p.status === 'OK') {
      const st = STATUS_RE.exec(line);
      if (st) {
        const k = st[1].toLowerCase();
        p.status = /^(dns|ns|forfait|abs|absent|ff)/.test(k) ? 'DNS' : /^(dnf|abandon|abd)/.test(k) ? 'DNF' : 'DSQ';
        return;
      }
      const res = RESULT_RE.exec(line);
      if (res) {
        p.timeCs = reportTime(res[1]) ?? undefined;
        if (res[2]) p.place = +res[2];
        addSplits(p, res[3]);
        return;
      }
    }
    // suite des temps de passage sur une autre ligne
    addSplits(p, line);
  }
}

function addSplits(p: ReportSwim, text: string) {
  SPLIT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  const found: { at: number; cs: number }[] = [];
  while ((m = SPLIT_RE.exec(text))) {
    const cs = reportTime(m[1]);
    if (cs != null) found.push({ at: +m[2], cs });
  }
  if (!found.length) return;
  // On ne garde que les passages aux 50 m (ou 25 m pour un 50 m)
  const step = p.distance === 50 ? 25 : 50;
  const kept = found.filter((f) => f.at % step === 0 && f.at < p.distance);
  if (!kept.length) return;
  const all = [...(p.splits ?? [])];
  for (const f of kept) {
    const idx = f.at / step - 1;
    all[idx] = f.cs;
  }
  p.splits = all;
}

/** Normalise un nom pour la comparaison (accents, casse, tirets). */
export function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}
