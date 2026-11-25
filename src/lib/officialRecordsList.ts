import type { Course, Gender, Stroke } from '../store/types';

/*
 * Liste officielle des records du club (PDF « Records Club » publié par le club sur son site) : forme des données
 * et lecture du texte du PDF. Sans dépendance (lu aussi par scripts/roster.mjs, sous Node).
 * La liste du club mélange les bassins : un seul record par âge et par épreuve, en 25 m ou en 50 m.
 */

export interface OfficialRecord {
  /** Catégorie de la liste : « 9 » à « 18 », « seniors », « all » (toutes catégories). */
  section: string;
  gender: Gender;
  distance: number;
  stroke: Stroke;
  timeCs: number;
  /** Détenteur tel qu'écrit dans la liste (« DUPONT Emma », parfois une initiale : « DURAND P. »). */
  holder: string;
  place?: string;
  /** Bassin, quand la liste l'indique. */
  course?: Course;
  /** AAAA-MM-JJ, quand la liste l'indique. */
  date?: string;
  /** Course retrouvée telle quelle dans l'historique relevé. */
  verified?: boolean;
  /** Record douteux, à vérifier (raison courte, sans nom). */
  doubt?: string;
}

export interface OfficialRecordsList {
  /** Titre du fichier du club : « RECORDS 31.12.2025 ». */
  title: string;
  /** Records établis jusqu'à cette date (AAAA-MM-JJ). */
  asOf: string;
  source: string;
  records: OfficialRecord[];
}

const STROKES: Record<string, Stroke> = { 'Nage Libre': 'FREE', Dos: 'BACK', Brasse: 'BREAST', Papillon: 'FLY', '4 Nages': 'IM' };
const EVENT = /(\d+)m (Nage Libre|Dos|Brasse|Papillon|4 Nages)\b/;
const EVENT_START = new RegExp(`^${EVENT.source}`);
const HEADER = /^\s{10,}(Canetons|Benjamins|Minimes|Cadets|Juniors|Seniors|Toutes)(?:\s+(.*?))?\s*$/;

/**
 * Lit le texte du PDF du club (pdftotext -table) : une section par âge, filles à gauche, garçons à droite,
 * une ligne par épreuve « 100m Brasse   01:20,42  NOM Prénom   Lieu (25m) - 30/11/2007 ».
 * Les cases vides et « A établir » (59:59,99) ne sont pas des records. « unread » : lignes au temps illisible.
 */
export function parseOfficialRecordsText(text: string): { records: OfficialRecord[]; unread: string[] } {
  const records: OfficialRecord[] = [];
  const unread: string[] = [];
  let section: string | null = null;
  let split = -1;
  const half = (s: string, gender: Gender) => {
    const t = s.trim();
    const m = EVENT_START.exec(t);
    if (!m || !section) return;
    const rest = t.slice(m[0].length).trim();
    if (!rest) return;
    const cols = rest.split(/\s{2,}/);
    const tm = /^(\d{2}):(\d{2}),(\d{2})$/.exec(cols[0] ?? '');
    if (!tm) {
      unread.push(t);
      return;
    }
    cols.shift();
    const timeCs = (Number(tm[1]) * 60 + Number(tm[2])) * 100 + Number(tm[3]);
    const holder = (cols.shift() ?? '').trim();
    if (!holder || /tablir/i.test(holder) || timeCs >= 359999) return;
    const where = cols.join(' ').replace(/\s+/g, ' ').trim();
    const pool = /\((25|50)m\)/.exec(where);
    const d = /(\d{2})\/(\d{2})\/(\d{4})\s*$/.exec(where);
    const place = where
      .replace(/\s*\((25|50)m\).*$/, '')
      .replace(/^\d{4}\s*-\s*/, '')
      .trim();
    const rec: OfficialRecord = { section, gender, distance: Number(m[1]), stroke: STROKES[m[2]], timeCs, holder };
    if (place) rec.place = place;
    if (pool) rec.course = pool[1] === '25' ? 'SCM' : 'LCM';
    if (d) rec.date = `${d[3]}-${d[2]}-${d[1]}`;
    records.push(rec);
  };
  for (const line of text.split(/\r?\n/)) {
    const h = HEADER.exec(line);
    if (h) {
      section = h[1] === 'Toutes' ? 'all' : h[1] === 'Seniors' ? 'seniors' : (/\d+/.exec(h[2] ?? '')?.[0] ?? null);
      continue;
    }
    if (/^\s*Filles\s+Temps/.test(line)) {
      split = line.indexOf('Gar');
      continue;
    }
    if (!section || split < 0 || !EVENT.test(line)) continue;
    // Colonne des garçons : la deuxième épreuve de la ligne, à partir de la colonne « Garçons » (à quelques signes près)
    const from = Math.max(1, split - 6);
    const at = line.slice(from).search(EVENT);
    const cut = at >= 0 ? from + at : -1;
    half(cut > 0 ? line.slice(0, cut) : line, 'F');
    if (cut > 0) half(line.slice(cut), 'M');
  }
  return { records, unread };
}

// Noms normalisés gardés : la liste (400 records) est comparée à tous les membres du club
const normCache = new Map<string, string>();
const norm = (s: string) => {
  let n = normCache.get(s);
  if (n == null) {
    n = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]+/g, '');
    if (normCache.size > 5000) normCache.clear();
    normCache.set(s, n);
  }
  return n;
};

/** Le détenteur écrit dans la liste (« LA FONTAINE Léa », « DURAND P. ») est-il ce nageur ? */
export function holderMatches(holder: string, person: { lastName: string; firstName: string }): boolean {
  const w = holder.replace(/\./g, ' ').trim().split(/\s+/);
  for (let i = w.length - 1; i >= 1; i--) {
    const last = norm(w.slice(0, i).join(' '));
    const first = norm(w.slice(i).join(' '));
    if (norm(person.lastName) === last && (norm(person.firstName) === first || (first.length === 1 && norm(person.firstName).startsWith(first)))) return true;
  }
  return false;
}

/** Liste lue depuis les données enregistrées ou déchiffrées : gardée seulement si elle a la bonne forme. */
export function validOfficialRecords(x: unknown): OfficialRecordsList | undefined {
  const l = x as OfficialRecordsList;
  return l && typeof l.asOf === 'string' && Array.isArray(l.records) ? l : undefined;
}
