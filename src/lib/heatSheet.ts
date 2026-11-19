import { parseSheetHeader, type SheetHeader } from './resultSheet';

/**
 * Lecture complète d'une feuille de compétition (Splash Meet Manager) :
 * toutes les séries d'une épreuve (« Liste des séries ») ou tout son
 * classement (« Liste résultats »), pour afficher la série d'un nageur avec
 * les autres nageurs, et le classement de sa catégorie.
 *
 * Les lignes viennent du PDF (pdf.js) : les colonnes sont séparées par au
 * moins trois espaces, par exemple
 *   3 DUPONT, Hugo   14   Esn   1:25.78
 *   1.   MARTIN Léa   15   Club Exemple   1:07.22   417   32.78   34.44
 */

export interface SheetRow {
  lane?: number;
  place?: number;
  status: 'OK' | 'DSQ' | 'DNS' | 'DNF';
  name: string;
  /** Année de naissance sur deux chiffres, telle qu'imprimée. */
  yy?: string;
  club?: string;
  entryCs?: number;
  timeCs?: number;
  points?: number;
}

export interface SheetHeat {
  heat: number;
  total?: number;
  rows: SheetRow[];
  /** Heure de départ estimée (HH:MM). */
  start?: string;
}

export interface EventSheet {
  header: SheetHeader;
  /** Titre lisible : « Dames, 100m Libre ». */
  title?: string;
  heats: SheetHeat[];
  /** Classement par catégorie (« Benjamines », « 11 - 12 ans »…). */
  results: { category?: string; rows: SheetRow[] }[];
}

const TIME = /^(?:(\d{1,2}):)?(\d{1,2})[.,](\d{2})$/;

/** « DUPONT, Hugo », « VAN DEN BERG Léa » → nom (majuscules) et prénom. */
export function splitName(name: string): { lastName: string; firstName: string } | null {
  const comma = /^([^,]+),\s*(.+)$/.exec(name.trim());
  if (comma) return { lastName: comma[1].trim().toUpperCase(), firstName: comma[2].trim() };
  const words = name.trim().split(/\s+/);
  const upper = (w: string) => /^[A-ZÀ-ÖØ-Þ'’-]{2,}$/.test(w);
  let i = 0;
  while (i < words.length - 1 && upper(words[i])) i++;
  if (!i) return null;
  return { lastName: words.slice(0, i).join(' '), firstName: words.slice(i).join(' ') };
}

export function timeCs(t: string): number | undefined {
  const m = TIME.exec(t.trim());
  return m ? (Number(m[1] ?? 0) * 60 + Number(m[2])) * 100 + Number(m[3]) : undefined;
}

const cols = (line: string) =>
  line
    .split(/\s{3,}/)
    .map((c) => c.trim())
    .filter(Boolean);

/** « Club Exemple 99 1:15.61 » (colonnes collées) → club, temps. */
function splitTail(part: string): { text: string; time?: number } {
  const m = /^(.*?)\s+(\d{1,2}:\d{2}[.,]\d{2}|\d{1,2}[.,]\d{2})$/.exec(part);
  if (!m) return { text: part };
  return { text: m[1].replace(/\s+\d{1,3}$/, ''), time: timeCs(m[2]) };
}

function titleOf(text: string): string | undefined {
  for (const l of text.split('\n')) {
    const m = /(Dames|Messieurs|Filles|Garçons|Mixte|Tous)\s*,\s*([^\s].*?)(?:\s{3,}|$)/i.exec(l);
    if (m && /\d+\s*m/i.test(m[2])) return `${m[1]}, ${m[2].trim()}`;
  }
  return undefined;
}

/** Liste des séries : toutes les séries de l'épreuve, ligne par ligne. */
export function parseStartSheet(text: string): EventSheet {
  const header = parseSheetHeader([text]);
  const heats: SheetHeat[] = [];
  let cur: SheetHeat | null = null;
  for (const line of text.split('\n')) {
    const h = /^\s*(?:S[ée]rie|Heat|Reeks)\s+(\d+)(?:\s+(?:de|sur|of|van|\/)\s+(\d+))?/i.exec(line);
    if (h) {
      cur = { heat: Number(h[1]), total: h[2] ? Number(h[2]) : undefined, rows: [] };
      heats.push(cur);
      continue;
    }
    if (!cur) continue;
    const c = cols(line);
    if (c.length < 2) continue;
    const first = /^(\d{1,2})\s+(.+)$/.exec(c[0]);
    let lane: number | undefined;
    let rest: string[];
    if (first) {
      lane = Number(first[1]);
      rest = [first[2], ...c.slice(1)];
    } else if (/^\d{1,2}$/.test(c[0])) {
      lane = Number(c[0]);
      rest = c.slice(1);
    } else continue;
    const yi = rest.findIndex((x, i) => i > 0 && /^\d{2}$/.test(x));
    if (yi < 1) continue;
    const name = rest.slice(0, yi).join(' ');
    const after = rest.slice(yi + 1);
    const last = after[after.length - 1] ?? '';
    let entryCs = timeCs(last);
    let club = after.slice(0, entryCs != null || /^NT$/i.test(last) ? -1 : undefined).join(' ');
    if (entryCs == null && !/^NT$/i.test(last)) {
      const t = splitTail(club);
      club = t.text;
      entryCs = t.time;
    }
    cur.rows.push({ lane, status: 'OK', name, yy: rest[yi], club: club || undefined, entryCs });
  }
  return { header, title: titleOf(text), heats: heats.filter((x) => x.rows.length), results: [] };
}

const STATUS: [RegExp, SheetRow['status']][] = [
  [/^(disq\.?|dsq|dq)$/i, 'DSQ'],
  [/^(forf\.?|forfait|dns|abs\.?)$/i, 'DNS'],
  [/^(aband\.?|abandon|dnf)$/i, 'DNF'],
];

/** Liste résultats : classement de l'épreuve, par catégorie. */
export function parseResultSheet(text: string): EventSheet {
  const header = parseSheetHeader([text]);
  const groups: { category?: string; rows: SheetRow[] }[] = [];
  let cur: { category?: string; rows: SheetRow[] } = { rows: [] };
  groups.push(cur);
  let started = false;
  for (const line of text.split('\n')) {
    const c = cols(line);
    if (!c.length) continue;
    if (/^(Rang|Place|Pl\.)\b/i.test(c[0])) {
      started = true;
      continue;
    }
    if (!started || /Splash Meet Manager|Registered to|Page \d/i.test(line)) continue;
    // Catégorie écrite en chiffres (« 11 - 12 ans », « 13 ans et plus ») : avant le rang, qui la prendrait pour « 11. »
    if (c.length === 1 && /\bans\b|cat[ée]gorie/i.test(c[0]) && !/\d[.:]\d{2}/.test(c[0])) {
      cur = { category: c[0], rows: [] };
      groups.push(cur);
      continue;
    }
    // Rang : « 1. », « 1. NOM… », « disq. NOM… »
    const head = /^(\d{1,3})\.?(?:\s+(.+))?$/.exec(c[0]) ?? /^(disq\.?|dsq|forf\.?|forfait|aband\.?|abandon|dns|dnf)(?:\s+(.+))?$/i.exec(c[0]);
    if (!head) {
      // Ligne de catégorie (« Benjamines », « 11 - 12 ans ») : courte, sans temps
      if (c.length === 1 && c[0].length <= 40 && !/\d[.:]\d{2}/.test(c[0])) {
        cur = { category: c[0], rows: [] };
        groups.push(cur);
      }
      continue;
    }
    const rest = [...(head[2] ? [head[2]] : []), ...c.slice(1)];
    const yi = rest.findIndex((x, i) => i > 0 && /^\d{2}$/.test(x));
    if (yi < 1) continue;
    const status = STATUS.find(([re]) => re.test(head[1]))?.[1] ?? 'OK';
    const place = status === 'OK' ? Number(head[1]) : undefined;
    const after = rest.slice(yi + 1);
    let club: string | undefined;
    let time: number | undefined;
    let points: number | undefined;
    for (const part of after) {
      const t = timeCs(part);
      if (time == null && t != null) {
        time = t;
        continue;
      }
      if (time == null && club == null) {
        const s = splitTail(part);
        club = s.text;
        if (s.time != null) time = s.time;
        continue;
      }
      if (time != null && points == null && /^\d{1,4}$/.test(part)) {
        points = Number(part);
        break;
      }
      if (time != null) break;
    }
    cur.rows.push({ place, status, name: rest.slice(0, yi).join(' '), yy: rest[yi], club, timeCs: status === 'OK' ? time : undefined, points });
  }
  return { header, title: titleOf(text), heats: [], results: groups.filter((g) => g.rows.length) };
}

/** Durée typique d'une série quand aucun temps d'engagement n'est connu (centièmes). */
function fallbackCs(distance: number): number {
  return Math.round(distance * 1.4 * 100);
}

/**
 * Heure de départ estimée de chaque série : départ de l'épreuve, puis pour
 * chaque série le temps d'engagement le plus lent + 45 s de mise en place.
 */
export function estimateHeatStarts(sheet: EventSheet, distance: number): EventSheet {
  const start = sheet.header.startTime;
  if (!start) return sheet;
  const [h, m] = start.split(':').map(Number);
  let t = (h * 60 + m) * 60;
  const heats = sheet.heats.map((heat) => {
    const hh = Math.floor(t / 3600) % 24;
    const mm = Math.floor((t % 3600) / 60);
    const out = { ...heat, start: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
    const slowest = Math.max(0, ...heat.rows.map((r) => r.entryCs ?? 0));
    t += Math.round((slowest || fallbackCs(distance)) / 100) + 45;
    return out;
  });
  return { ...sheet, heats };
}

/** Ligne du classement général : la catégorie d'origine et la place toutes catégories confondues. */
export interface OverallRow extends SheetRow {
  category?: string;
  overall?: number;
}

/**
 * Classement final de l'épreuve, toutes catégories confondues : au temps
 * (ex æquo à la même place), puis disqualifiés, forfaits et abandons. Un
 * nageur présent dans plusieurs classements (catégorie et « toutes
 * catégories ») n'apparaît qu'une fois.
 */
export function overallRanking(results: EventSheet['results']): OverallRow[] {
  const seen = new Set<string>();
  const rows: OverallRow[] = [];
  for (const g of results) {
    for (const r of g.rows) {
      const key = `${r.name.toUpperCase()}|${r.yy ?? ''}|${(r.club ?? '').toUpperCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ ...r, category: g.category });
    }
  }
  const timed = rows.filter((r) => r.status === 'OK' && r.timeCs != null).sort((a, b) => a.timeCs! - b.timeCs!);
  let place = 0;
  const ranked = timed.map((r, i) => {
    if (i === 0 || r.timeCs !== timed[i - 1].timeCs) place = i + 1;
    return { ...r, overall: place };
  });
  return [...ranked, ...rows.filter((r) => !(r.status === 'OK' && r.timeCs != null))];
}
