import type { Course, EntryRecords, Gender, Stroke } from '../store/types';

/*
 * Inscriptions du club à une compétition (fichier « inscription_ESN_pour_… » envoyé par le club, logiciel
 * du club) : programme de la compétition (épreuves par session), et pour chaque nageur engagé ses épreuves,
 * son temps d'engagement et les records officiels de son âge (club, club toutes catégories, district,
 * francophone, Belgique). Lu depuis le texte du PDF (pdftotext -layout), publié chiffré
 * (public/data/club-entries.json), puis ajouté comme programme dans l'application.
 */

/** Records officiels pour l'âge du nageur (bassin de la compétition), en centièmes. */
export type { EntryRecords };

export interface ClubEntry {
  eventNo: number;
  distance: number;
  stroke: Stroke;
  /** Catégorie de l'épreuve (« Canetons »…). */
  category?: string;
  /** Jour (AAAA-MM-JJ) et heure de début de la session (HH:MM). */
  date?: string;
  startTime?: string;
  /** Temps d'engagement (absent : sans temps). */
  entryCs?: number;
  entryCourse?: Course;
  records?: EntryRecords;
}

export interface ClubEntriesAthlete {
  lastName: string;
  firstName: string;
  birthYear?: number;
  gender?: Gender;
  entries: ClubEntry[];
}

export interface ClubEntriesMeet {
  name: string;
  city?: string;
  /** Club organisateur (code). */
  organizer?: string;
  course: Course;
  startDate: string;
  endDate?: string;
  athletes: ClubEntriesAthlete[];
}

export interface ClubEntriesFile {
  /** AAAA-MM-JJ */
  updated: string;
  meets: ClubEntriesMeet[];
}

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const DAY = /(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d{1,2})\s+(\S+)\s+(\d{4})/gi;

function isoDay(day: string, month: string, year: string): string | undefined {
  const m = MONTHS.indexOf(plain(month));
  return m < 0 ? undefined : `${year}-${String(m + 1).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`;
}

/** « 01:04,51 » → 6451 ; « 59:59,99 » (sans temps) → undefined. */
export function entryTime(t: string | undefined): number | undefined {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{2})$/.exec(t?.trim() ?? '');
  if (!m) return undefined;
  const cs = ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 100 + Number(m[4]);
  return cs >= 359999 ? undefined : cs;
}

function strokeOf(text: string): Stroke | undefined {
  const t = plain(text);
  if (/4 nages/.test(t)) return 'IM';
  if (/nage libre|libre/.test(t)) return 'FREE';
  if (/\bdos\b/.test(t)) return 'BACK';
  if (/brasse/.test(t)) return 'BREAST';
  if (/papillon/.test(t)) return 'FLY';
  return undefined;
}

const genderOf = (name: string): Gender | undefined => (/dames|filles/i.test(name) ? 'F' : /messieurs|gar[cç]ons/i.test(name) ? 'M' : undefined);

/** Programme : n° d'épreuve → jour, heure de début de session, sexe. */
function parseProgramme(lines: string[]): Map<number, { date?: string; time?: string; gender?: Gender }> {
  const out = new Map<number, { date?: string; time?: string; gender?: Gender }>();
  let cols: { start: number; date?: string; time?: string }[] = [];
  for (const line of lines) {
    if (/ESN\/|R-Club|^\f?[A-ZÀ-Þ'’-]{2,}\s/.test(line)) continue;
    const heads = [...line.matchAll(DAY)];
    if (heads.length && /session|matin|apr[eè]s/i.test(line)) {
      // Nouvelle rangée de sessions : une colonne par jour
      cols = heads.map((h) => ({ start: h.index ?? 0, date: isoDay(h[2], h[3], h[4]) }));
      continue;
    }
    if (!cols.length) continue;
    cols.forEach((c, i) => {
      const part = line.slice(c.start, cols[i + 1]?.start ?? line.length);
      const m = /^\s*(?:(\d{1,2}:\d{2})\s+)?(\d{1,3})\s+(\S+(?: \S+)*)/.exec(part);
      if (!m) {
        // « 08:00   Echauffement » : pas une épreuve
        return;
      }
      if (m[1]) c.time = m[1];
      const name = m[3];
      if (/^\d+\s*x\s*\d+/i.test(name) || !/\d+m\b/i.test(name)) return;
      const no = Number(m[2]);
      if (!out.has(no)) out.set(no, { date: c.date, time: c.time, gender: genderOf(name) });
    });
  }
  return out;
}

/**
 * Lit le texte du fichier d'inscriptions (pdftotext -layout). Lève une erreur si la compétition ou les
 * engagements ne sont pas reconnus.
 */
export function parseClubEntries(text: string): ClubEntriesMeet {
  const lines = text.replace(/\r/g, '').split('\n');
  const first = lines.map((l) => l.trim()).filter(Boolean);
  const name = first[0];
  // « ENW - Waremme (25m) - Du samedi 12 décembre 2026 au dimanche 13 décembre 2026 »
  const info = first.find((l) => /\((?:25|50)\s*m\)/i.test(l) && DAY.test(l));
  DAY.lastIndex = 0;
  if (!name || !info) throw new Error('Compétition non reconnue (nom, bassin, dates)');
  const course: Course = /\(50\s*m\)/i.test(info) ? 'LCM' : 'SCM';
  const days = [...info.matchAll(DAY)].map((d) => isoDay(d[2], d[3], d[4])).filter((d): d is string => !!d);
  const head = /^([A-Z0-9]{2,8})\s+-\s+(.+?)\s+\((?:25|50)\s*m\)/i.exec(info);
  const programme = parseProgramme(lines);

  const athletes: ClubEntriesAthlete[] = [];
  let athlete: ClubEntriesAthlete | null = null;
  let pending: { best50?: string; records: EntryRecords; time?: string } | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\f/g, '');
    // « NOM Prénom    ESN/392239/15    11 ans »
    // (un nom long touche le numéro de licence : une seule espace)
    const a = /^\s*(\S.*?)\s+[A-Z]{2,8}\/\d+\/(\d{2})\s+(\d{1,2})\s+ans\b/.exec(line);
    if (a) {
      const words = a[1].trim().split(/\s+/);
      const upper = (w: string) => w === w.toUpperCase() && /[A-ZÀ-Þ]/.test(w);
      let k = 0;
      while (k < words.length - 1 && upper(words[k])) k++;
      const yy = Number(a[2]);
      athlete = { lastName: words.slice(0, Math.max(1, k)).join(' '), firstName: words.slice(Math.max(1, k)).join(' '), birthYear: 2000 + yy, entries: [] };
      athletes.push(athlete);
      pending = null;
      continue;
    }
    if (!athlete) continue;
    // Ligne des records : « 50m : 00:45,49 (24/01/26)   R-Club : 00:34,59   R-Dis : …   R-BEL : … »
    if (/\b50m\s*:/.test(line) && /R-Club\s*:/.test(line)) {
      const rec = (k: string) => entryTime(new RegExp(`${k}\\s*:\\s*([\\d:,]+)`).exec(line)?.[1]);
      pending = { records: { club: rec('R-Club'), district: rec('R-Dis'), belgian: rec('R-BEL') }, time: /^\s*(\d{1,2}:\d{2})\s{2,}/.exec(line)?.[1] };
      continue;
    }
    // Ligne de l'engagement : « 11 100m Nage Libre   01:22,17 25m   25m : 01:22,17 (13/11/26)   R-ClubTC : … R-Fran : … »
    const e = /^\s*(\d{1,3})\s+(\d{2,4})m\s+(.+?)\s+(\d{1,2}:\d{2}[,.]\d{2})\s+(Fic|25m|50m)\b(.*)$/i.exec(line);
    if (!e || /\d\s*x\s*\d/i.test(e[3])) continue;
    const stroke = strokeOf(e[3]);
    if (!stroke) continue;
    const eventNo = Number(e[1]);
    const prog = programme.get(eventNo);
    // Heure propre à l'épreuve (« - 13:00 ») ou heure de début de la session
    const ownTime = /(\d{1,2}:\d{2})/.exec(e[3])?.[1] ?? pending?.time;
    const category =
      e[3]
        .replace(/[-–]?\s*\d{1,2}:\d{2}/g, '')
        .replace(/nage libre|libre|4 nages|dos|brasse|papillon/gi, '')
        .trim() || undefined;
    const rec = (k: string) => entryTime(new RegExp(`${k}\\s*:\\s*([\\d:,]+)`).exec(e[6])?.[1]);
    const records: EntryRecords = { ...pending?.records, clubAll: rec('R-ClubTC'), francophone: rec('R-Fran') };
    for (const k of Object.keys(records) as (keyof EntryRecords)[]) if (records[k] == null) delete records[k];
    const entryCs = e[5].toLowerCase() === 'fic' ? undefined : entryTime(e[4]);
    athlete.entries.push({
      eventNo,
      distance: Number(e[2]),
      stroke,
      ...(category ? { category } : {}),
      date: prog?.date ?? days[0],
      startTime: ownTime ?? prog?.time,
      ...(entryCs != null ? { entryCs, entryCourse: e[5].toLowerCase() === '50m' ? 'LCM' : 'SCM' } : {}),
      ...(Object.keys(records).length ? { records } : {}),
    });
    if (prog?.gender && !athlete.gender) athlete.gender = prog.gender;
    pending = null;
  }
  if (!athletes.some((x) => x.entries.length)) throw new Error('Aucun engagement reconnu');
  return {
    name,
    city: head?.[2],
    organizer: head?.[1],
    course,
    startDate: days[0],
    endDate: days[days.length - 1] !== days[0] ? days[days.length - 1] : undefined,
    athletes: athletes.filter((x) => x.entries.length),
  };
}

/** Nombre de nageurs et de départs annoncés en fin de fichier (« 19 nageurs - 137 départs »), pour contrôle. */
export function announcedTotals(text: string): { swimmers: number; starts: number } | null {
  const m = /(\d+)\s+nageurs?\s*-\s*(\d+)\s+d[ée]parts?/i.exec(text);
  return m ? { swimmers: Number(m[1]), starts: Number(m[2]) } : null;
}

/** Engagements d'un nageur, au format d'import de l'application (programme pas encore nagé). */
export function entriesReport(meet: ClubEntriesMeet, a: ClubEntriesAthlete) {
  return {
    meet: { name: meet.name, city: meet.city, organizer: meet.organizer, course: meet.course, startDate: meet.startDate, endDate: meet.endDate },
    source: 'club' as const,
    swims: a.entries.map((e) => ({
      eventNo: e.eventNo,
      distance: e.distance,
      stroke: e.stroke,
      course: meet.course,
      round: 'TIM' as const,
      status: 'OK' as const,
      entryCs: e.entryCs,
      date: e.date ?? meet.startDate,
      startTime: e.startTime,
      ...(e.records ? { records: e.records } : {}),
    })),
  };
}

/**
 * Ajoute (ou remplace) une compétition dans le fichier publié ; les compétitions terminées depuis plus de
 * 30 jours sont retirées (leurs résultats sont alors dans l'historique).
 */
export function mergeEntries(file: ClubEntriesFile | null, meet: ClubEntriesMeet, today: string): ClubEntriesFile {
  const limit = new Date(Date.parse(`${today}T12:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
  const same = (m: ClubEntriesMeet) => m.startDate === meet.startDate && m.course === meet.course && (m.city ?? '') === (meet.city ?? '');
  const meets = [...(file?.meets ?? []).filter((m) => !same(m) && (m.endDate ?? m.startDate) >= limit), meet].sort((x, y) => (x.startDate < y.startDate ? -1 : 1));
  return { updated: today, meets };
}
