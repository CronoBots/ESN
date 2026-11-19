import type { Course, Gender, Round, Stroke } from '../store/types';
import { makeISO, monthFromToken } from './dates';
import { parseTime } from './time';
import { isValidEvent } from './events';

/**
 * Import depuis swimrankings.net.
 *
 * swimrankings.net est protégé contre les robots et n'autorise pas les appels
 * depuis d'autres sites : l'import se fait donc à l'initiative du parent, qui
 * transmet le contenu de la page (bouton-favori « Envoyer vers ESN » ou
 * copier-coller). Ce module transforme ce texte en performances structurées.
 */

export interface ParsedSwim {
  distance: number;
  stroke: Stroke;
  course: Course;
  timeCs: number;
  points?: number;
  date: string;
  city?: string;
  meet?: string;
  /** Vrai si le bassin n'a pas été trouvé (25 m supposé). */
  courseGuessed?: boolean;
  /** Temps réalisé en compétition masters (marqué « M » après le temps sur swimrankings). */
  masters?: boolean;
  /** Place dans la compétition (colonne « Place » de l'historique du club). */
  place?: number;
  /** Tour : séries, demi-finale, finale (colonne « Tour »). */
  round?: Round;
  /** Temps de passage cumulés (colonne « Passages »). */
  splits?: number[];
  splitEvery?: 25 | 50;
}

export interface ParsedAthlete {
  firstName?: string;
  lastName?: string;
  birthYear?: number;
  gender?: Gender;
  nation?: string;
  club?: string;
  swimrankingsId?: string;
}

export interface ParseResult {
  athlete: ParsedAthlete;
  swims: ParsedSwim[];
}

/* ------------------------------------------------------------------------ */
/* Liens                                                                     */
/* ------------------------------------------------------------------------ */

export function swimrankingsUrl(id: string, page: 'PBEST' | 'MEET' | 'ALL' = 'PBEST'): string {
  const base = `https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=${encodeURIComponent(id)}`;
  return page === 'ALL' ? base : `${base}&athletePage=${page}`;
}

/** Extrait l'identifiant athlète d'un lien swimrankings (ou d'un identifiant brut). */
export function extractAthleteId(input: string | undefined | null): string | null {
  if (!input) return null;
  const s = input.trim();
  const m = /athleteId=(\d+)/i.exec(s);
  if (m) return m[1];
  if (/^\d{4,10}$/.test(s)) return s;
  return null;
}

/* ------------------------------------------------------------------------ */
/* Reconnaissance des épreuves                                              */
/* ------------------------------------------------------------------------ */

const STROKE_WORDS: [RegExp, Stroke][] = [
  [/^(?:4\s*nages|quatre\s*nages|individual\s*medley|medley|im|wisselslag|lagen|4n|qn|ind\.?\s*medley)$/i, 'IM'],
  [/^(?:nage\s*libre|libre|freestyle|free|crawl|vrije\s*slag|vrij|freistil|kraul|nl|fr)$/i, 'FREE'],
  [/^(?:dos|backstroke|back|rugslag|rug|r[üu]cken|ruecken|bk)$/i, 'BACK'],
  [/^(?:brasse|breaststroke|breast|schoolslag|brust|br)$/i, 'BREAST'],
  [/^(?:papillon|butterfly|fly|vlinderslag|vlinder|schmetterling|delphin|delfin|pap|bu)$/i, 'FLY'],
];

const STROKE_ALT =
  '4\\s*nages|quatre\\s*nages|individual\\s*medley|ind\\.?\\s*medley|medley|wisselslag|lagen|nage\\s*libre|libre|freestyle|free|crawl|vrije\\s*slag|vrij|freistil|kraul|dos|backstroke|back|rugslag|rug|r[üu]cken|brasse|breaststroke|breast|schoolslag|brust|papillon|butterfly|fly|vlinderslag|vlinder|schmetterling|delphin|delfin|im|nl|pap';

function strokeFromWord(w: string): Stroke | null {
  const t = w.trim().replace(/\s+/g, ' ');
  for (const [re, s] of STROKE_WORDS) if (re.test(t)) return s;
  return null;
}

/* ------------------------------------------------------------------------ */
/* Tokenisation                                                              */
/* ------------------------------------------------------------------------ */

type Token =
  | { t: 'EVENT'; distance: number; stroke: Stroke }
  | { t: 'COURSE'; course: Course }
  | { t: 'TIME'; cs: number; masters?: boolean }
  | { t: 'DATE'; iso: string }
  | { t: 'INT'; n: number }
  | { t: 'TEXT'; s: string }
  | { t: 'RELAY' }
  | { t: 'EOL' };

const MONTH_ALT =
  'janv(?:ier)?|jan(?:uary|uari|uar)?|f[ée]vr?(?:ier)?|feb(?:ruary|ruari|ruar)?|mars|mar(?:ch)?|m[äa]rz|maart|mrt|avr(?:il)?|apr(?:il)?|mai|may|mei|juin|june?|juni|juil(?:let)?|july?|juli|ao[ûu]t?|aug(?:ust(?:us)?)?|sept?(?:embre|ember)?|oct(?:obre|ober)?|okt(?:ober)?|nov(?:embre|ember)?|d[ée]c(?:embre|ember)?|dez(?:ember)?';

/*
 * Reconnaissance des éléments d'une cellule (épreuve, date, temps, bassin, nombre).
 * Sans « lookbehind » dans les expressions régulières : non pris en charge avant iOS 16.4, il
 * empêchait l'application de démarrer sur ces iPhone. La condition sur le caractère précédent est
 * vérifiée à part ; chaque forme est essayée dans l'ordre, à chaque position (comme une alternance).
 */
const before = (s: string, i: number, n = 1) => s[i - n] ?? '';
const notAfter = (chars: RegExp) => (s: string, i: number) => !chars.test(before(s, i));

const TOKEN_FORMS: { re: RegExp; ok?: (s: string, i: number) => boolean }[] = [
  // relais : "4x50m Libre" (ignoré, mais coupe le contexte)
  { re: /(?<relay>\d\s?[x×]\s?\d{2,4}\s?m)/iy },
  // épreuve : "100m Libre", "100 m nage libre", "200m 4 nages" (sauf relais "4x50m", "4 x 50m")
  {
    re: new RegExp(`(?<event>(?<dist>25|50|100|200|400|800|1500)\\s?m(?:[eè]tres?|eter)?\\.?\\s+(?<stroke>${STROKE_ALT})(?![a-zà-ÿ]))`, 'iy'),
    ok: (s, i) => !/[\dx×]/i.test(before(s, i)) && !(/\s/.test(before(s, i)) && /[x×]/i.test(before(s, i, 2))),
  },
  // date texte : "11 oct 2026", "11. Okt. 2026", "11-Oct-2026"
  { re: new RegExp(`(?<dtext>(?<dd>\\d{1,2})\\.?[\\s-]+(?<mon>${MONTH_ALT})\\.?[\\s-]+(?<yy>\\d{4}|\\d{2})(?!\\d))`, 'iy') },
  // date numérique : "11.10.2026", "11/10/2026"
  { re: /(?<dnum>(?<nd>\d{1,2})[./](?<nm>\d{1,2})[./](?<ny>\d{4})(?!\d))/iy, ok: notAfter(/[\d.]/) },
  // date ISO
  { re: /(?<diso>(?<iy>\d{4})-(?<im>\d{2})-(?<id>\d{2}))/iy },
  // temps : "1:24.62", "38.45", "38,45"
  { re: /(?<time>(?:\d{1,2}:)?\d{1,2}[.,]\d{2}(?![\d.,:]))/iy, ok: notAfter(/[\d:.,]/) },
  // bassin : "25m", "50 m", "SCM", "LCM"
  { re: /(?<course>(?:25|50)\s?m(?![a-zà-ÿ\d]))/iy, ok: notAfter(/\d/) },
  { re: /(?<course>\b(?:SCM|LCM)\b)/iy },
  // entier
  { re: /(?<int>\d{1,4}(?![\d.,:]))/iy, ok: notAfter(/[\d.,:]/) },
];

/** Premier élément reconnu à partir de la position `from`. */
function nextToken(s: string, from: number): RegExpExecArray | null {
  for (let i = from; i < s.length; i++) {
    // Toutes les formes commencent par un chiffre, sauf « SCM » / « LCM »
    const c = s.charCodeAt(i);
    if ((c < 48 || c > 57) && !/[sl]/i.test(s[i])) continue;
    for (const f of TOKEN_FORMS) {
      if (f.ok && !f.ok(s, i)) continue;
      f.re.lastIndex = i;
      const m = f.re.exec(s);
      if (m) return m;
    }
  }
  return null;
}

function tokenizeCell(cell: string, out: Token[]): void {
  let last = 0;
  let pos = 0;
  let m: RegExpExecArray | null;
  const pushText = (s: string) => {
    const txt = s.replace(/^[\s|:;,\-–—()]+|[\s|:;,\-–—(]+$/g, '').trim();
    if (txt.length >= 2 && /[a-zà-ÿ]/i.test(txt)) out.push({ t: 'TEXT', s: txt });
  };
  while ((m = nextToken(cell, pos))) {
    const g = m.groups!;
    if (m.index > last) pushText(cell.slice(last, m.index));
    last = m.index + m[0].length;
    pos = last;
    if (g.relay) {
      out.push({ t: 'RELAY' });
    } else if (g.event) {
      const stroke = strokeFromWord(g.stroke);
      if (stroke) out.push({ t: 'EVENT', distance: +g.dist, stroke });
      else pushText(m[0]);
    } else if (g.dtext) {
      const month = monthFromToken(g.mon);
      const iso = month ? makeISO(+g.yy, month, +g.dd) : null;
      if (iso) out.push({ t: 'DATE', iso });
    } else if (g.dnum) {
      const iso = makeISO(+g.ny, +g.nm, +g.nd);
      if (iso) out.push({ t: 'DATE', iso });
    } else if (g.diso) {
      const iso = makeISO(+g.iy, +g.im, +g.id);
      if (iso) out.push({ t: 'DATE', iso });
    } else if (g.time) {
      const cs = parseTime(g.time.replace(',', '.'));
      // « 2:21.62M » : temps masters (M majuscule collé au temps, pas le début d'un mot)
      const masters = cell[last] === 'M' && !/[a-zà-ÿ]/i.test(cell[last + 1] ?? '');
      if (masters) {
        last++;
        pos = last;
      }
      if (cs != null && cs > 0) out.push({ t: 'TIME', cs, ...(masters ? { masters: true } : {}) });
    } else if (g.course) {
      const c = g.course.toUpperCase();
      out.push({ t: 'COURSE', course: c.startsWith('25') || c === 'SCM' ? 'SCM' : 'LCM' });
    } else if (g.int) {
      out.push({ t: 'INT', n: +g.int });
    }
  }
  if (last < cell.length) pushText(cell.slice(last));
}

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const lines = text.replace(/\r/g, '').replace(/ /g, ' ').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith('@@')) continue; // métadonnées du bouton-favori
    const cells = line.split(/\t| {2,}|\s\|\s/);
    for (const c of cells) if (c.trim()) tokenizeCell(c.trim(), out);
    out.push({ t: 'EOL' });
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Analyse                                                                   */
/* ------------------------------------------------------------------------ */

interface Draft {
  distance?: number;
  stroke?: Stroke;
  course?: Course;
  timeCs?: number;
  masters?: boolean;
  points?: number;
  date?: string;
  texts: string[];
  expectPoints: boolean;
}

const NOISE_TEXT =
  /^(?:séries?|heats?|finale?s?(?: directe)?|final|demi-?finale|semi-?final|tim|ok|dsq|dq|ds|abd|dnf|dns|forfait|ns|nt|pts?\.?|points|temps|time|date|bassin|course|ville|city|lieu|compétition|competition|meet|épreuve|event|pays|rang|rank)$/i;

/** « Finale », « Finale B », « Demi-finale », « Séries » → tour de la course (vide : épreuve unique). */
export function roundFromText(s: string | undefined): Round | undefined {
  const t = (s ?? '').trim();
  if (!t) return undefined;
  if (/demi|semi/i.test(t)) return 'SEMI';
  if (/final/i.test(t)) return 'FINAL';
  // « Eliminatoire » : séries d'une épreuve avec finale (pages de compétition swimrankings en français)
  if (/s[ée]rie|heat|prelim|reeks|vorl|limin/i.test(t)) return 'HEAT';
  return 'TIM';
}

/** « 32.10 1:08.20 1:45.33 » → temps de passage cumulés, gardés seulement s'ils tombent juste (tous les 50 ou 25 m). */
export function splitsFromText(s: string | undefined, distance: number, timeCs: number): { splits: number[]; splitEvery: 25 | 50 } | undefined {
  const list = tokenize(s ?? '')
    .filter((t): t is Extract<Token, { t: 'TIME' }> => t.t === 'TIME')
    .map((t) => t.cs);
  if (!list.length || list.some((v, i) => v >= timeCs || (i > 0 && v <= list[i - 1]))) return undefined;
  const legs = list.length + 1;
  const every = distance / legs === 50 ? 50 : distance / legs === 25 ? 25 : null;
  return every ? { splits: list, splitEvery: every } : undefined;
}

export function parseSwimrankings(text: string): ParseResult {
  // Historique du club en colonnes : la lecture des temps ne voit que les 7 premières (épreuve … compétition) ;
  // club, place, tour et passages sont lus à part (un temps de passage n'est pas une course)
  const tokens = tokenize(
    text
      .split(/\r?\n/)
      .map((l) => (l.split('\t').length > 7 ? l.split('\t').slice(0, 7).join('\t') : l))
      .join('\n'),
  );
  const swims: ParsedSwim[] = [];

  let ctxEvent: { distance: number; stroke: Stroke } | null = null;
  let ctxCourse: Course | null = null;
  let ctxDate: string | null = null;
  let cur: Draft = { texts: [], expectPoints: false };

  const fresh = (): Draft => ({
    distance: ctxEvent?.distance,
    stroke: ctxEvent?.stroke,
    course: undefined,
    texts: [],
    expectPoints: false,
  });

  const finalize = () => {
    if (cur.timeCs && cur.distance && cur.stroke) {
      const date = cur.date ?? ctxDate;
      const course = cur.course ?? ctxCourse ?? 'SCM';
      if (date && isValidEvent(cur.distance, cur.stroke, course)) {
        const texts = cur.texts;
        let city: string | undefined;
        let meet: string | undefined;
        if (texts.length >= 2) {
          city = texts[0];
          meet = texts[1];
        } else if (texts.length === 1) {
          if (/\([A-Z]{3}\)\s*$/.test(texts[0]) || texts[0].split(' ').length === 1) city = texts[0];
          else meet = texts[0];
        }
        swims.push({
          distance: cur.distance,
          stroke: cur.stroke,
          course,
          timeCs: cur.timeCs,
          points: cur.points,
          date,
          city: city ? cleanText(city) : undefined,
          meet: meet ? cleanText(meet) : undefined,
          courseGuessed: !cur.course && !ctxCourse ? true : undefined,
          ...(cur.masters ? { masters: true } : {}),
        });
      }
    }
    cur = fresh();
  };

  for (const tok of tokens) {
    switch (tok.t) {
      case 'EVENT':
        finalize();
        ctxEvent = { distance: tok.distance, stroke: tok.stroke };
        ctxCourse = null;
        cur = fresh();
        break;
      case 'RELAY':
        finalize();
        ctxEvent = null;
        ctxCourse = null;
        cur = fresh();
        break;
      case 'COURSE':
        if (cur.timeCs && cur.date) finalize();
        if (!cur.timeCs) {
          cur.course = tok.course;
          ctxCourse = tok.course;
        }
        break;
      case 'TIME':
        if (cur.timeCs) finalize();
        cur.timeCs = tok.cs;
        cur.masters = tok.masters;
        cur.expectPoints = true;
        break;
      case 'INT':
        if (cur.expectPoints && cur.points == null && tok.n <= 1500) cur.points = tok.n;
        cur.expectPoints = false;
        break;
      case 'DATE':
        cur.expectPoints = false;
        if (cur.timeCs && !cur.date) cur.date = tok.iso;
        else if (!cur.timeCs) ctxDate = tok.iso;
        break;
      case 'TEXT':
        cur.expectPoints = false;
        if (cur.timeCs && cur.date && cur.texts.length < 2 && !NOISE_TEXT.test(tok.s)) cur.texts.push(tok.s);
        break;
      case 'EOL':
        break;
    }
  }
  finalize();

  // Format d'import en colonnes (épreuve, bassin, temps, points, date, ville, compétition, puis club,
  // place, tour, passages, séparés par des tabulations) : ville et compétition reprises telles quelles
  // (« 4e édition… », « Interclubs U15 ») ; place, tour et passages quand ils ont été relevés.
  // Ligne retrouvée par épreuve, bassin, temps et date : deux courses au même temps le même jour
  // (autre bassin, autre épreuve) gardent chacune leur compétition
  const columns = new Map<string, { city?: string; meet?: string; place?: string; round?: string; splits?: string }>();
  for (const line of text.split(/\r?\n/)) {
    const c = line.split('\t');
    if (c.length < 7) continue;
    const event = tokenize(c[0]).find((t) => t.t === 'EVENT');
    const course = tokenize(c[1]).find((t) => t.t === 'COURSE');
    const time = tokenize(c[2]).find((t) => t.t === 'TIME');
    const date = tokenize(c[4]).find((t) => t.t === 'DATE');
    if (event?.t === 'EVENT' && time?.t === 'TIME' && date?.t === 'DATE') {
      // Bassin non écrit : 25 m, comme dans la lecture des temps
      const pool = course?.t === 'COURSE' ? course.course : 'SCM';
      columns.set(`${event.distance}|${event.stroke}|${pool}|${time.cs}|${date.iso}`, {
        city: c[5].trim() || undefined,
        meet: c[6].trim() || undefined,
        place: c[8],
        round: c[9],
        splits: c[10],
      });
    }
  }
  if (columns.size) {
    for (const s of swims) {
      const c = columns.get(`${s.distance}|${s.stroke}|${s.course}|${s.timeCs}|${s.date}`);
      if (c?.meet) s.meet = cleanText(c.meet);
      if (c?.city) s.city = cleanText(c.city);
      const place = Number(/^\s*(\d{1,3})\b/.exec(c?.place ?? '')?.[1]);
      if (place >= 1) s.place = place;
      const round = roundFromText(c?.round);
      if (round) s.round = round;
      const sp = splitsFromText(c?.splits, s.distance, s.timeCs);
      if (sp) Object.assign(s, sp);
    }
  }

  return { athlete: parseAthlete(text), swims: dropOfficialSplits(dedupe(swims)) };
}

/**
 * Temps de passage officiels : swimrankings publie aussi, comme des résultats, le temps aux 400 m d'un
 * 800 m ou aux 800 m d'un 1500 m (rangés à part, « Lap », dans ses classements). Ce ne sont pas des
 * courses : les résultats officiels, ceux du club et SplashMe ne les comptent ni comme course ni comme
 * record personnel. Une telle ligne n'a ni place ni tour, et tombe le même jour, dans la même compétition,
 * qu'une course plus longue de même nage et même bassin :
 *  - temps identique au passage relevé à cette distance : passage officiel, sans doute possible ;
 *  - passages non relevés : 400 m dans un 800 ou un 1500 m, 800 m dans un 1500 m libre, à l'allure de
 *    la course (rapport 0,93 à 1,03), celle-ci classée ; sans place, on ne peut pas trancher : on garde.
 * Les 50 m et 100 m nagés le même jour qu'une course plus longue (masters, meetings) restent des courses.
 */
export function dropOfficialSplits<T extends ParsedSwim>(list: T[]): T[] {
  return list.filter(
    (s) =>
      s.place != null ||
      !!s.round ||
      !list.some((o) => {
        if (o === s || o.stroke !== s.stroke || o.course !== s.course || o.date !== s.date || o.distance <= s.distance) return false;
        if (o.meet && s.meet && o.meet !== s.meet) return false;
        const at = o.splits?.[s.distance / (o.splitEvery ?? 50) - 1];
        if (at != null) return at === s.timeCs;
        const lap = s.stroke === 'FREE' && ((s.distance === 400 && (o.distance === 800 || o.distance === 1500)) || (s.distance === 800 && o.distance === 1500));
        if (!lap || o.place == null) return false;
        const pace = s.timeCs / ((o.timeCs * s.distance) / o.distance);
        return pace >= 0.93 && pace <= 1.03;
      }),
  );
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/\s*(?:\.\.\.|…)$/, '').trim();
}

function dedupe(list: ParsedSwim[]): ParsedSwim[] {
  const map = new Map<string, ParsedSwim>();
  for (const s of list) {
    const key = `${s.course}|${s.distance}|${s.stroke}|${s.timeCs}|${s.date}`;
    const prev = map.get(key);
    if (!prev) map.set(key, s);
    else {
      // garder la version la plus complète (nom de compétition le plus long)
      if ((s.meet?.length ?? 0) > (prev.meet?.length ?? 0)) prev.meet = s.meet;
      if (!prev.city && s.city) prev.city = s.city;
      if (prev.points == null && s.points != null) prev.points = s.points;
      if (s.masters) prev.masters = true;
      if (prev.place == null && s.place != null) prev.place = s.place;
      if (!prev.round && s.round) prev.round = s.round;
      if (!prev.splits && s.splits) Object.assign(prev, { splits: s.splits, splitEvery: s.splitEvery });
    }
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/* ------------------------------------------------------------------------ */
/* Identité de l'athlète                                                     */
/* ------------------------------------------------------------------------ */

export function parseAthlete(text: string): ParsedAthlete {
  const a: ParsedAthlete = {};
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/ /g, ' ').trim())
    .filter(Boolean);

  for (const l of lines) {
    const meta = /^@@(\w+):(.*)$/.exec(l);
    if (!meta) continue;
    const [, k, v] = meta;
    if (k === 'URL') a.swimrankingsId = extractAthleteId(v) ?? undefined;
    if (k === 'GENDER' && (v === 'F' || v === 'M')) a.gender = v;
  }
  if (!a.swimrankingsId) {
    const id = extractAthleteId(text);
    if (id) a.swimrankingsId = id;
  }

  // "DUPONT, Emma" puis "(2014 ♀)" — ou "DUPONT, Emma (2014)".
  // Une ligne peut contenir plusieurs zones (menu du site à gauche, capture
  // d'écran lue ligne par ligne) : on examine chaque zone séparément.
  const segs = (l: string | undefined) =>
    (l ?? '')
      .replace(/,\s+/g, ', ')
      .split(/\t| {3,}/)
      .map((x) => x.trim())
      .filter(Boolean);
  const nameRe = /^([A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'’\- ]{1,40}),\s*([A-Za-zÀ-ÖØ-öø-ÿ'’\- ]{1,40}?)\s*(?:\((\d{4})[^)]*\)?)?$/;
  const menuRe = /^(meilleurs|best|records?|comp[ée]titions?|biographie|personal|classements?|calendrier|accueil|nageurs|splashme|swimstats)/i;
  outer: for (let i = 0; i < lines.length; i++) {
    for (const seg of segs(lines[i])) {
      const m = nameRe.exec(seg);
      if (!m) continue;
      a.lastName = titleCase(m[1].trim());
      a.firstName = m[2].trim();
      let year = m[3] ? +m[3] : undefined;
      if (!year) {
        for (const nseg of segs(lines[i + 1])) {
          const y = /^\(?\s*(\d{4})\b/.exec(nseg);
          if (y) {
            year = +y[1];
            break;
          }
        }
      }
      if (year && year > 1900 && year <= new Date().getFullYear()) a.birthYear = year;
      if (!a.gender) {
        const around = `${lines[i]} ${lines[i + 1] ?? ''}`;
        if (/♀|female|femme|dame|vrouw/i.test(around)) a.gender = 'F';
        else if (/♂|\bmale\b|homme|herr|man\b/i.test(around)) a.gender = 'M';
      }
      // Nation + club : "BEL - Belgique" puis "Nom du club" (ou "BEL - Club")
      for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
        const n = segs(lines[j])
          .map((x) => /^([A-Z]{3})\s*-\s*(.+)$/.exec(x))
          .find(Boolean);
        if (!n) continue;
        a.nation = n[1];
        const rest = n[2].trim();
        const isCountry = /^(belgique|belgium|belgi[eë]|france|nederland|netherlands|pays-bas|luxembourg|deutschland|germany|allemagne|suisse|schweiz|switzerland|espa[ñn]a|spain|espagne|italia|italy|italie|great britain|grande-bretagne|canada|usa|united states)$/i.test(
          rest,
        );
        if (isCountry) {
          const next = segs(lines[j + 1]).filter((x) => !menuRe.test(x));
          const club = next[next.length - 1];
          if (club && /[a-z]/i.test(club) && !/\d/.test(club)) a.club = club;
        } else {
          a.club = rest;
        }
        break;
      }
      break outer;
    }
  }
  return a;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'’])([a-zà-ÿ])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}
