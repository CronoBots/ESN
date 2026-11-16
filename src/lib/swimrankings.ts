import type { Course, Gender, Stroke } from '../store/types';
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
  | { t: 'TIME'; cs: number }
  | { t: 'DATE'; iso: string }
  | { t: 'INT'; n: number }
  | { t: 'TEXT'; s: string }
  | { t: 'RELAY' }
  | { t: 'EOL' };

const MONTH_ALT =
  'janv(?:ier)?|jan(?:uary|uari|uar)?|f[ée]vr?(?:ier)?|feb(?:ruary|ruari|ruar)?|mars|mar(?:ch)?|m[äa]rz|maart|mrt|avr(?:il)?|apr(?:il)?|mai|may|mei|juin|june?|juni|juil(?:let)?|july?|juli|ao[ûu]t?|aug(?:ust(?:us)?)?|sept?(?:embre|ember)?|oct(?:obre|ober)?|okt(?:ober)?|nov(?:embre|ember)?|d[ée]c(?:embre|ember)?|dez(?:ember)?';

const TOKEN_RE = new RegExp(
  [
    // 0 — relais : "4x50m Libre" (ignoré, mais coupe le contexte)
    `(?<relay>\\d\\s?[x×]\\s?\\d{2,4}\\s?m)`,
    // 1 — épreuve : "100m Libre", "100 m nage libre", "200m 4 nages" (sauf relais "4x50m")
    `(?<event>(?<![x×]\\s?)(?<![\\d])(?<dist>25|50|100|200|400|800|1500)\\s?m(?:[eè]tres?|eter)?\\.?\\s+(?<stroke>${STROKE_ALT})(?![a-zà-ÿ]))`,
    // 2 — date texte : "11 oct 2026", "11. Okt. 2026", "11-Oct-2026"
    `(?<dtext>(?<dd>\\d{1,2})\\.?[\\s-]+(?<mon>${MONTH_ALT})\\.?[\\s-]+(?<yy>\\d{4}|\\d{2})(?!\\d))`,
    // 3 — date numérique : "11.10.2026", "11/10/2026"
    `(?<dnum>(?<![\\d.])(?<nd>\\d{1,2})[./](?<nm>\\d{1,2})[./](?<ny>\\d{4})(?!\\d))`,
    // 4 — date ISO
    `(?<diso>(?<iy>\\d{4})-(?<im>\\d{2})-(?<id>\\d{2}))`,
    // 5 — temps : "1:24.62", "38.45", "38,45"
    `(?<time>(?<![\\d:.,])(?:\\d{1,2}:)?\\d{1,2}[.,]\\d{2}(?![\\d.,:]))`,
    // 6 — bassin : "25m", "50 m", "SCM", "LCM"
    `(?<course>(?<![\\d])(?:25|50)\\s?m(?![a-zà-ÿ\\d])|\\b(?:SCM|LCM)\\b)`,
    // 7 — entier
    `(?<int>(?<![\\d.,:])\\d{1,4}(?![\\d.,:]))`,
  ].join('|'),
  'gi',
);

function tokenizeCell(cell: string, out: Token[]): void {
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  const pushText = (s: string) => {
    const txt = s.replace(/^[\s|:;,\-–—()]+|[\s|:;,\-–—(]+$/g, '').trim();
    if (txt.length >= 2 && /[a-zà-ÿ]/i.test(txt)) out.push({ t: 'TEXT', s: txt });
  };
  while ((m = TOKEN_RE.exec(cell))) {
    const g = m.groups!;
    if (m.index > last) pushText(cell.slice(last, m.index));
    last = m.index + m[0].length;
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
      if (cs != null && cs > 0) out.push({ t: 'TIME', cs });
    } else if (g.course) {
      const c = g.course.toUpperCase();
      out.push({ t: 'COURSE', course: c.startsWith('25') || c === 'SCM' ? 'SCM' : 'LCM' });
    } else if (g.int) {
      out.push({ t: 'INT', n: +g.int });
    }
    if (m[0].length === 0) TOKEN_RE.lastIndex++;
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
  points?: number;
  date?: string;
  texts: string[];
  expectPoints: boolean;
}

const NOISE_TEXT =
  /^(?:séries?|heats?|finale?s?(?: directe)?|final|demi-?finale|semi-?final|tim|ok|dsq|dq|ds|abd|dnf|dns|forfait|ns|nt|pts?\.?|points|temps|time|date|bassin|course|ville|city|lieu|compétition|competition|meet|épreuve|event|pays|rang|rank)$/i;

export function parseSwimrankings(text: string): ParseResult {
  const tokens = tokenize(text);
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

  // Format d'import en colonnes (épreuve, bassin, temps, points, date, ville, compétition, séparés par
  // des tabulations) : ville et compétition reprises telles quelles (« 4e édition… », « Interclubs U15 »)
  const columns = new Map<string, { city?: string; meet?: string }>();
  for (const line of text.split(/\r?\n/)) {
    const c = line.split('\t');
    if (c.length < 7) continue;
    const time = tokenize(c[2]).find((t) => t.t === 'TIME');
    const date = tokenize(c[4]).find((t) => t.t === 'DATE');
    if (time?.t === 'TIME' && date?.t === 'DATE') columns.set(`${time.cs}|${date.iso}`, { city: c[5].trim() || undefined, meet: c[6].trim() || undefined });
  }
  if (columns.size) {
    for (const s of swims) {
      const c = columns.get(`${s.timeCs}|${s.date}`);
      if (c?.meet) s.meet = cleanText(c.meet);
      if (c?.city) s.city = cleanText(c.city);
    }
  }

  return { athlete: parseAthlete(text), swims: dedupe(swims) };
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

/* ------------------------------------------------------------------------ */
/* Bouton-favori (bookmarklet)                                              */
/* ------------------------------------------------------------------------ */

/**
 * Code du bouton-favori : sur une page athlète swimrankings.net, il récupère
 * le tableau (en conservant les noms complets des compétitions), puis propose
 * d'ouvrir l'app ou de copier les données.
 */
export function bookmarkletCode(appUrl: string): string {
  const src = `(function(){
var A=${JSON.stringify(appUrl)};
var L=['@@URL:'+location.href];
var g=document.querySelector('img[src*="female" i],img[alt*="female" i],img[title*="female" i],img[src*="woman" i]')?'F':(document.querySelector('img[src*="male" i],img[alt*="male" i],img[title*="male" i]')?'M':'');
if(g)L.push('@@GENDER:'+g);
var t=(document.body.innerText||'').split('\\n');
L=L.concat(t.slice(0,120));
document.querySelectorAll('tr').forEach(function(r){
if(r.querySelector('table'))return;
var c=[];
r.querySelectorAll('td,th').forEach(function(d){
var x=(d.innerText||'').replace(/\\s+/g,' ').trim();
var e=d.querySelector('[title]');var ti=d.getAttribute('title')||(e&&e.getAttribute('title'))||'';
if(ti&&ti.length>x.length&&/(\\.\\.\\.|…)$/.test(x))x=ti;
c.push(x);});
if(c.join('').length)L.push(c.join('\\t'));});
var D=L.join('\\n');
var u=A+'#/import?data='+encodeURIComponent(D);
var o=document.getElementById('nageo-box');if(o)o.remove();
var b=document.createElement('div');b.id='nageo-box';
b.style.cssText='position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);background:#111;color:#fff;font:15px -apple-system,system-ui,sans-serif;padding:16px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.4);width:min(92vw,360px);text-align:center';
b.innerHTML='<div style="font-weight:700;font-size:17px;margin-bottom:4px">ESN Compétition</div><div style="opacity:.75;margin-bottom:12px">Données de la page prêtes à être importées.</div>';
function btn(l,p,f){var e=document.createElement('button');e.textContent=l;e.style.cssText='display:block;width:100%;margin-top:8px;padding:12px;border-radius:12px;border:0;font:600 15px -apple-system,system-ui,sans-serif;cursor:pointer;'+(p?'background:#0A84FF;color:#fff':'background:#2c2c2e;color:#fff');e.onclick=f;b.appendChild(e);return e;}
btn('Ouvrir dans l\u2019app ESN',1,function(){window.open(u,'_blank');b.remove();});
var cp=btn('Copier les données',0,function(){var ok=function(){cp.textContent='Copié ✓ — collez-le dans l\u2019app ESN';};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(D).then(ok,function(){fb();ok();});}else{fb();ok();}});
function fb(){var a=document.createElement('textarea');a.value=D;document.body.appendChild(a);a.select();try{document.execCommand('copy')}catch(e){}a.remove();}
btn('Fermer',0,function(){b.remove();});
document.body.appendChild(b);
})()`;
  const compact = src
    .split('\n')
    .map((l) => l.trim())
    .join('');
  return `javascript:${encodeURIComponent(compact).replace(/%20/g, ' ')}`;
}
