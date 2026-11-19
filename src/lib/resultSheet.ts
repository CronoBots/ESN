import type { Course, Gender, Round, Stroke } from '../store/types';
import { makeISO } from './dates';
import { isValidEvent } from './events';
import { computePoints } from './points';
import { editDistance, normName } from './results';

/**
 * Lecture d'une feuille de résultats affichée à la piscine (« Liste
 * résultats » imprimée par Splash Meet Manager), à partir du texte reconnu
 * sur une photo. Exemple :
 *
 *   Meeting d'automne
 *   4000 Liège, 13- - 15-11-2026
 *   Epreuve 27          Dames, 50m Dos          11 ans et plus
 *   14-11-26 - 15:30                            Liste résultats
 *   Rang                      AN                        Temps   Pts
 *   11 - 12 ans
 *     1. DUPONT, Emma         15   Club Exemple        38.48   281
 *     2. MARTIN, Léa          15   Esn                 42.42   210   (temps de passage éventuels)
 *   disq. DURAND, Zoé         15   Esn                 52.37
 */

export interface SheetHeader {
  meetName?: string;
  city?: string;
  startDate?: string;
  endDate?: string;
  eventNo?: number;
  date?: string;
  startTime?: string;
  gender?: Gender;
  distance?: number;
  stroke?: Stroke;
  round: Round;
}

export interface SheetResult {
  place?: number;
  status: 'OK' | 'DSQ' | 'DNS' | 'DNF';
  timeCs?: number;
  points?: number;
  /** Temps au tour (non cumulés), tels qu'imprimés. */
  laps: number[];
  /** Bassin déduit des points imprimés (si concluant). */
  course?: Course;
  /** Fiabilité : vérifié par les points ou par la somme des passages. */
  verified: boolean;
  line: string;
}

export interface SheetSwimmer {
  firstName: string;
  lastName: string;
  birthYear?: number;
  gender?: Gender;
}

const STROKES: [RegExp, Stroke][] = [
  [/^(nage\s*libre|libre|crawl|vrije\s*slag|freestyle)/i, 'FREE'],
  [/^(dos|rugslag|backstroke)/i, 'BACK'],
  [/^(brasse|schoolslag|breaststroke)/i, 'BREAST'],
  [/^(papillon|vlinderslag|butterfly)/i, 'FLY'],
  [/^(4\s*nages|quatre\s*nages|wisselslag|medley)/i, 'IM'],
];

const MEET_WORDS =
  /(meeting|championnat|crit[ée]rium|grand\s+prix|coupe|open|challenge|troph[ée]e|interclubs|m[ée]morial|euromeeting|nocturne|comp[ée]tition|journ[ée]e|gala)/i;

function clean(s: string): string {
  return s.replace(/[|_~“”"«»]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Lit l'en-tête (compétition, épreuve, date) en combinant plusieurs lectures. */
export function parseSheetHeader(texts: string[]): SheetHeader {
  const h: SheetHeader = { round: 'TIM' };
  const lines = texts.flatMap((t) => t.split('\n').map(clean)).filter(Boolean);

  for (const l of lines) {
    // Lieu et dates : « 4367 Crisnée, 13- - 15-11-2026 » ou « Liège, 12-10-2025 »
    if (!h.startDate) {
      const m = /([A-ZÀ-Ý][A-Za-zÀ-ÿ'’\- ]{1,40}),\s*(\d{1,2})\s*-?\s*-\s*-?\s*(\d{1,2})-(\d{1,2})-(\d{4})/.exec(l);
      const s = m ? null : /([A-ZÀ-Ý][A-Za-zÀ-ÿ'’\- ]{1,40}),\s*(\d{1,2})-(\d{1,2})-(\d{4})\b/.exec(l);
      if (m) {
        const a = makeISO(+m[5], +m[4], +m[2]);
        const b = makeISO(+m[5], +m[4], +m[3]);
        if (a && b && a <= b) {
          h.startDate = a;
          h.endDate = b !== a ? b : undefined;
          h.city = m[1].trim();
        }
      } else if (s) {
        const a = makeISO(+s[4], +s[3], +s[2]);
        if (a) {
          h.startDate = a;
          h.city = s[1].trim();
        }
      }
    }
    if (!h.meetName && MEET_WORDS.test(l) && !/liste|r[ée]sultats|points|aqua|splash|manager/i.test(l)) {
      const m = new RegExp(`(${MEET_WORDS.source}[A-Za-zÀ-ÿ0-9'’&\\- ]*)`, 'i').exec(l);
      if (m) {
        const name = m[1].replace(/\s+[A-Za-z]{1,2}$/, '').trim();
        if (name.length >= 6) h.meetName = name;
      }
    }
    if (h.eventNo == null) {
      const m = /[ÉE]preuve\s+(\d{1,3})\b/i.exec(l);
      if (m) h.eventNo = +m[1];
    }
    if (!h.startTime) {
      const m = /\b(\d{1,2})-(\d{1,2})-(\d{2,4})\s*-\s*(\d{1,2})[:.](\d{2})/.exec(l);
      if (m) {
        const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
        const d = makeISO(y, +m[2], +m[1]);
        if (d && +m[4] < 24 && +m[5] < 60) {
          h.date = d;
          h.startTime = `${m[4].padStart(2, '0')}:${m[5]}`;
        }
      }
    }
    if (!h.date) {
      // Heure tronquée (« 14-11-26 - 15:3 ») : on garde au moins le jour
      const m = /\b(\d{1,2})-(\d{1,2})-(\d{2})\s*-\s*\d/.exec(l);
      if (m) {
        const d = makeISO(2000 + +m[3], +m[2], +m[1]);
        if (d) h.date = d;
      }
    }
    if (!h.distance) {
      const m = /(dames|messieurs|filles|gar[çc]ons|mixte|women|men)?[,.]?\s*(\d{2,4})\s?m\s+(nage\s*libre|libre|dos|brasse|papillon|4\s*nages|quatre\s*nages)/i.exec(l);
      if (m && !/^\d+\s*x/i.test(l.slice(Math.max(0, m.index - 3), m.index + 2))) {
        const stroke = STROKES.find(([re]) => re.test(m[3]))?.[1];
        if (stroke) {
          h.distance = +m[2];
          h.stroke = stroke;
          if (m[1]) h.gender = /dames|filles|women/i.test(m[1]) ? 'F' : /mixte/i.test(m[1]) ? undefined : 'M';
          if (/finale/i.test(l) && !/s[ée]ries/i.test(l)) h.round = 'FINAL';
          else if (/s[ée]ries/i.test(l)) h.round = 'HEAT';
        }
      }
    }
  }
  // Date de l'épreuve plausible ?
  if (h.date && h.startDate && (h.date < h.startDate || h.date > (h.endDate ?? h.startDate))) {
    h.date = undefined;
    h.startTime = undefined;
  }
  return h;
}

/** Jeton de temps reconnu → centièmes (« 1:22.17 », « 42,42 », « 5052 » → 50.52). */
function tokenTime(tok: string): number | null {
  const t = tok.replace(/[‘’'`]/g, '').replace(/[Oo]/g, '0');
  let m = /^(\d{1,2})[:;](\d{2})[.,](\d{2})$/.exec(t);
  if (m) return (+m[1] * 60 + +m[2]) * 100 + +m[3];
  m = /^(\d{1,2})[.,](\d{2})[.,](\d{2})$/.exec(t);
  if (m) return (+m[1] * 60 + +m[2]) * 100 + +m[3];
  m = /^(\d{1,2})[.,](\d{2})$/.exec(t);
  if (m) return +m[1] * 100 + +m[2];
  m = /^(\d{1,2})(\d{2})(\d{2})$/.exec(t);
  if (m && +m[2] < 60) return (+m[1] * 60 + +m[2]) * 100 + +m[3];
  m = /^(\d{2})(\d{2})$/.exec(t);
  if (m) return +m[1] * 100 + +m[2];
  return null;
}


/**
 * La ligne concerne-t-elle ce nageur ? « NOM, Prénom » avec tolérance aux
 * erreurs de lecture (bord de feuille coupé : « PONT, Emma » pour « DUPONT »).
 * Une correspondance partielle du nom exige l'année de naissance sur la ligne.
 */
function nameOnLine(line: string, sw: SheetSwimmer): number {
  // Découpage identique à celui de readLine (indices de mots compatibles)
  const tokens = clean(line).split(' ');
  const norm = tokens.map((t) => normName(t));
  const first = normName(sw.firstName);
  const last = normName(sw.lastName);
  if (!first || !last) return -1;
  const fp = first.slice(0, Math.min(5, first.length));
  for (let k = 1; k < norm.length; k++) {
    // Prénom plus long d'au moins deux lettres : un autre prénom (« Léane » n'est pas « Léa »)
    if (norm[k].length > first.length + 1) continue;
    if (!norm[k].startsWith(fp) && editDistance(norm[k].slice(0, first.length), first) > (first.length > 5 ? 1 : 0)) continue;
    const prev: string[] = [];
    for (let j = k - 1; j >= 0 && prev.length < 3; j--) if (norm[j]) prev.unshift(norm[j]);
    for (let n = 1; n <= prev.length; n++) {
      const c = prev.slice(prev.length - n).join('');
      if (c === last || editDistance(c, last) <= Math.floor(last.length / 5)) return k;
      const partial = c.length >= 3 && (last.endsWith(c) || last.startsWith(c) || editDistance(c, last.slice(-c.length)) <= 1);
      if (partial && sw.birthYear) {
        const yy = String(sw.birthYear % 100).padStart(2, '0');
        if (tokens.slice(k + 1, k + 4).some((t) => t.replace(/\D/g, '') === yy)) return k;
      }
    }
  }
  return -1;
}

/** Extrait le résultat d'un nageur d'une ligne de la feuille. */
function readLine(line: string, sw: SheetSwimmer, header: SheetHeader): SheetResult | null {
  const raw = clean(line.replace(/[,;:](?=\s)/g, ' ').replace(/(\D)[.](?=\s)/g, '$1 . '));
  const words = raw.split(' ');
  const k = nameOnLine(raw, sw);
  if (k < 0) return null;
  const after = k + 1;
  const before = words.slice(0, after).join(' ');
  const rest = words.slice(after);

  let status: SheetResult['status'] = 'OK';
  let place: number | undefined;
  // Ce qui précède le NOM (en majuscules) : rang « 2. » ou statut « disq. »
  const pre = before.split(/[A-ZÀ-Ý]{2,}/)[0] ?? '';
  const rk = /(\d{1,3})\s*[.,]?\s*$/.exec(pre.trim());
  if (/disq|dsq|disqual/i.test(pre)) status = 'DSQ';
  else if (/forf|dns|abs/i.test(pre)) status = 'DNS';
  else if (/abd|dnf|aband/i.test(pre)) status = 'DNF';
  else if (rk && +rk[1] > 0) place = +rk[1];

  // Jetons après le nom : année (AN), club, temps, points, passages
  const times: { cs: number; idx: number }[] = [];
  const ints: { n: number; idx: number }[] = [];
  rest.forEach((tok, idx) => {
    const t = tok.replace(/[^\d:.,;]/g, '');
    if (!t) return;
    const cs = /[:.,;]/.test(t) || /^\d{4,6}$/.test(t) ? tokenTime(t) : null;
    if (cs != null && cs >= 1500 && cs < 60 * 6000) times.push({ cs, idx });
    else if (/^\d{1,4}$/.test(t)) ints.push({ n: +t, idx });
  });
  if (!times.length) return { status, place, laps: [], verified: false, line: raw };

  const main = times[0];
  const pts = ints.find((x) => x.idx > main.idx && x.n > 0 && x.n <= 1200 && x.idx <= main.idx + 2);
  const laps = times.filter((t) => t.idx > main.idx).map((t) => t.cs);
  const res: SheetResult = { status, place, timeCs: main.cs, points: pts?.n, laps, verified: false, line: raw };

  // Vérifications : somme des passages, puis points (qui donnent aussi le bassin)
  const lapCount = header.distance ? header.distance / 50 : 0;
  if (lapCount >= 2 && laps.length === lapCount && Math.abs(laps.reduce((a, b) => a + b, 0) - main.cs) <= 2) res.verified = true;
  const gender = header.gender ?? sw.gender;
  if (pts && gender && header.distance && header.stroke) {
    for (const c of ['SCM', 'LCM'] as Course[]) {
      if (!isValidEvent(header.distance, header.stroke, c)) continue;
      const p = computePoints(main.cs, c, gender, header.distance, header.stroke);
      if (p != null && Math.abs(p - pts.n) <= 6) {
        res.course = c;
        res.verified = true;
        break;
      }
    }
  }
  return res;
}

function score(r: SheetResult | null): number {
  if (!r) return -1;
  return (r.verified ? 100 : 0) + (r.timeCs ? 10 : 0) + (r.points ? 3 : 0) + (r.place ? 1 : 0) + r.laps.length;
}

/**
 * Cherche le résultat d'un nageur dans les lectures d'une même photo et
 * garde la plus fiable.
 */
/** Rang imprimé en début de ligne (« 3. NOM, Prénom »), sinon null. */
function lineRank(line: string): number | null {
  const m = /^\s*(\d{1,3})\s*[.,]\s+[A-ZÀ-Ý]/.exec(line);
  return m ? +m[1] : null;
}

/**
 * Place illisible : on la déduit des lignes voisines (« 3. » juste après →
 * 2e ; « 1. » juste avant → 2e). Chaque voisin vote ; il faut deux votes
 * concordants.
 */
function inferPlace(lines: string[], idx: number): number | undefined {
  const votes = new Map<number, number>();
  for (let k = 1; k <= 3; k++) {
    const after = lines[idx + k] != null ? lineRank(lines[idx + k]) : null;
    if (after != null && after - k >= 1) votes.set(after - k, (votes.get(after - k) ?? 0) + 1);
    const before = idx - k >= 0 ? lineRank(lines[idx - k]) : null;
    if (before != null) votes.set(before + k, (votes.get(before + k) ?? 0) + 1);
  }
  let best: number | undefined;
  let n = 0;
  for (const [place, c] of votes) if (c > n) [best, n] = [place, c];
  return n >= 2 ? best : undefined;
}

/** La ligne d'un nageur (ou la suivante, quand la ligne est coupée) porte-t-elle ce club ? */
function clubOnLine(lines: string[], idx: number, club: RegExp | undefined): boolean {
  if (!club || club.test(lines[idx])) return true;
  // La ligne suivante n'est la suite que si ce n'est pas celle d'un autre nageur (« 4. NOM… », « disq. NOM… »)
  const next = lines[idx + 1] ?? '';
  return lineRank(next) == null && !/^\s*(disq|dsq|forf|dns|abs|abd|dnf|aband)/i.test(next) && club.test(next);
}

/** Homonyme d'une autre année : la ligne porte des nombres à deux chiffres (AN), aucun n'est son année. */
function otherYear(line: string, yy: string | null): boolean {
  if (!yy) return false;
  const years = [...` ${line} `.matchAll(/\s(\d{2})(?=\s)/g)].map((m) => m[1]);
  return years.length > 0 && !years.includes(yy);
}

/**
 * Résultat d'un nageur dans une feuille. `club` : seulement une ligne de ce club (un nageur qui a
 * changé de club ne reçoit que ses résultats nagés pour le club).
 */
export function findSwimmerResult(texts: string[], sw: SheetSwimmer, header = parseSheetHeader(texts), club?: RegExp): SheetResult | null {
  let best: SheetResult | null = null;
  let bestAt: { lines: string[]; idx: number } | null = null;
  const yy = sw.birthYear ? String(sw.birthYear % 100).padStart(2, '0') : null;
  for (const t of texts) {
    const lines = t.split('\n').filter((l) => l.trim());
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      if (nameOnLine(line, sw) < 0 || !clubOnLine(lines, idx, club)) continue;
      const r = readLine(line, sw, header);
      // Homonyme d'une autre année : on écarte, même avec un temps (comme findSwimmerEntry)
      if (!r || otherYear(r.line, yy)) continue;
      if (score(r) > score(best)) {
        best = r;
        bestAt = { lines, idx };
      }
    }
  }
  if (best && best.place == null && best.status === 'OK' && bestAt) {
    best.place = inferPlace(bestAt.lines, bestAt.idx);
    // Une autre lecture de la même photo peut avoir le rang lisible
    if (best.place == null) {
      for (const t of texts) {
        const lines = t.split('\n').filter((l) => l.trim());
        // Sa ligne, pas celle d'un homonyme (autre club, autre année)
        const i = lines.findIndex((l, j) => nameOnLine(l, sw) >= 0 && clubOnLine(lines, j, club) && !otherYear(readLine(l, sw, header)?.line ?? '', yy));
        if (i < 0) continue;
        const r = readLine(lines[i], sw, header);
        best.place = r?.place ?? inferPlace(lines, i);
        if (best.place != null) break;
      }
    }
  }
  // Passages à garder seulement s'ils sont cohérents
  if (best && best.timeCs && best.laps.length && header.distance) {
    const sum = best.laps.reduce((a, b) => a + b, 0);
    if (best.laps.length !== header.distance / 50 || Math.abs(sum - best.timeCs) > 2) best.laps = [];
  }
  return best;
}

/** Temps au tour → temps de passage cumulés (hors arrivée). */
export function lapsToSplits(laps: number[]): number[] | undefined {
  if (laps.length < 2) return undefined;
  const out: number[] = [];
  let acc = 0;
  for (const l of laps.slice(0, -1)) {
    acc += l;
    out.push(acc);
  }
  return out;
}

export interface SheetEntry {
  heat?: number;
  lane?: number;
  /** Temps d'engagement en centièmes (absent : NT). */
  entryCs?: number;
}

/**
 * Inscription d'un nageur dans une liste de départ (« Liste des séries ») :
 *
 *   Série 2 de 3
 *       4 DUPONT, Emma            14       Esn                 1:23.45
 */
export function findSwimmerEntry(text: string, sw: SheetSwimmer, club?: RegExp): SheetEntry | null {
  const yy = sw.birthYear ? String(sw.birthYear % 100).padStart(2, '0') : null;
  let heat: number | undefined;
  const rows = text.split('\n');
  for (let idx = 0; idx < rows.length; idx++) {
    const raw = rows[idx];
    const h = /(?:S[ée]rie|Heat|Reeks)\s+(\d+)\b/i.exec(raw);
    if (h && !/\d{1,2}[.:]\d{2}/.test(raw)) {
      heat = Number(h[1]);
      continue;
    }
    if (nameOnLine(raw, sw) < 0 || !clubOnLine(rows, idx, club)) continue;
    const line = clean(raw);
    // Homonyme d'une autre année de naissance : ce n'est pas lui
    if (yy && /\s\d{2}\s/.test(` ${line} `) && !new RegExp(`(^|\\s)${yy}(\\s|$)`).test(line)) continue;
    const lane = /^(\d{1,2})\s/.exec(line)?.[1];
    const times = [...line.matchAll(/(?:(\d{1,2}):)?(\d{1,2})[.,](\d{2})(?!\d)/g)];
    const t = times[times.length - 1];
    const entryCs = t ? (Number(t[1] ?? 0) * 60 + Number(t[2])) * 100 + Number(t[3]) : undefined;
    return { heat, lane: lane ? Number(lane) : undefined, entryCs };
  }
  return null;
}

