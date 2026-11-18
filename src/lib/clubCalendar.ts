import type { Course, Meet } from '../store/types';
import { daysBetween } from './dates';

/**
 * Calendrier des compétitions du club (public/data/club-calendar.json), tel que les entraîneurs le
 * communiquent : il annonce les compétitions avant que les organisateurs publient leurs listes de
 * départ. Dès qu'une compétition est publiée (programme des nageurs), c'est elle qui s'affiche.
 */
export interface ClubEvent {
  start: string;
  end?: string;
  /** Précision sur les dates (« 13-14 ou 14-15 novembre »). */
  dates?: string;
  city: string;
  name: string;
  course?: Course;
  /** Groupes d'entraînement concernés (A, B, C). */
  groups: string[];
  /** Âge (atteint dans l'année) : compétition réservée à ces âges. */
  minAge?: number;
  maxAge?: number;
  /** Conditions : temps limites, sélection… */
  note?: string;
}

export interface ClubCalendar {
  title: string;
  season: string;
  /** Version du calendrier (AAAA-MM-JJ). */
  version: string;
  /** Dernier jour couvert : la suite sera ajoutée quand le club la communique. */
  until: string;
  /** Prénom de l'entraîneur de chaque groupe (A → Guillaume), comme sur le calendrier du club. */
  groupNames: Record<string, string>;
  note?: string;
  events: ClubEvent[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Date AAAA-MM-JJ qui existe vraiment (pas de 31 avril ni de mois 13). */
function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Lecture du fichier publié ; une entrée invalide est écartée (jamais d'erreur affichée). */
export function parseClubCalendar(raw: unknown): ClubCalendar | null {
  const r = raw as Partial<ClubCalendar> | null;
  if (!r || !Array.isArray(r.events)) return null;
  const events = r.events.filter(
    (e): e is ClubEvent =>
      !!e && isDate(e.start) && (e.end == null || (isDate(e.end) && e.end >= e.start)) && typeof e.name === 'string' && typeof e.city === 'string' && Array.isArray(e.groups),
  );
  return {
    title: String(r.title ?? 'Calendrier du club'),
    season: String(r.season ?? ''),
    version: String(r.version ?? ''),
    until: isDate(r.until) ? r.until : events.reduce((d, e) => ((e.end ?? e.start) > d ? (e.end ?? e.start) : d), ''),
    groupNames:
      r.groupNames && typeof r.groupNames === 'object'
        ? Object.fromEntries(Object.entries(r.groupNames).filter((e): e is [string, string] => typeof e[1] === 'string' && !!e[1].trim()))
        : {},
    note: r.note,
    events: events.sort((a, b) => (a.start < b.start ? -1 : 1)),
  };
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const words = (s: string) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4));

/**
 * Compétition publiée (programme ou résultats déjà dans l'application) qui correspond à cette
 * entrée du calendrier : dates qui se chevauchent (à un jour près) et même ville, ou un mot du nom en commun.
 */
export function publishedMeet(ev: ClubEvent, meets: Meet[]): Meet | undefined {
  const evEnd = ev.end ?? ev.start;
  const city = words(ev.city);
  const name = words(ev.name);
  return meets.find((m) => {
    const mEnd = m.endDate ?? m.startDate;
    if (daysBetween(evEnd, m.startDate) > 1 || daysBetween(mEnd, ev.start) > 1) return false;
    const mCity = words(m.city ?? '');
    const mName = words(m.name);
    return [...city].some((w) => mCity.has(w) || mName.has(w)) || [...name].some((w) => mName.has(w));
  });
}

/** L'âge (atteint dans l'année de la compétition) permet-il d'y nager ? Âge inconnu : oui. */
export function ageAllows(ev: ClubEvent, birthYear?: number): boolean {
  if (!birthYear) return true;
  const age = Number(ev.start.slice(0, 4)) - birthYear;
  return (ev.minAge == null || age >= ev.minAge) && (ev.maxAge == null || age <= ev.maxAge);
}

/** « 11-16 ans », « 15 ans et plus », « jusqu'à 12 ans » ; vide sans limite d'âge. */
export function ageLabel(ev: ClubEvent): string {
  if (ev.minAge != null && ev.maxAge != null) return `${ev.minAge}-${ev.maxAge}\u00a0ans`;
  if (ev.minAge != null) return `${ev.minAge}\u00a0ans et plus`;
  if (ev.maxAge != null) return `jusqu’à ${ev.maxAge}\u00a0ans`;
  return '';
}

/** Accueil : prochaine compétition du club pour ce nageur (son âge le permet), avant la publication du programme. */
export function nextClubEventFor(events: ClubEvent[], birthYear?: number): ClubEvent | undefined {
  return events.find((e) => ageAllows(e, birthYear));
}

/** Compétitions du calendrier pas encore terminées et pas encore publiées, dans l'ordre. */
export function upcomingClubEvents(cal: ClubCalendar | null, meets: Meet[], today: string): ClubEvent[] {
  if (!cal) return [];
  return cal.events.filter((e) => (e.end ?? e.start) >= today && !publishedMeet(e, meets));
}

const of = (name: string) => (/^[aeiouyhàâäéèêëîïôöùûü]/i.test(name) ? `d’${name}` : `de ${name}`);
const joinFr = (items: string[]) => (items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`);

/**
 * En phrase : « Groupes de Guillaume et d’Emilie » avec les prénoms des entraîneurs,
 * sinon « Groupe A », « Groupes A et B », « Groupes A, B et C ».
 */
export function groupsLabel(groups: string[], names: Record<string, string> = {}): string {
  if (!groups.length) return '';
  const withNames = groups.every((g) => names[g]);
  return `${groups.length > 1 ? 'Groupes' : 'Groupe'} ${joinFr(withNames ? groups.map((g) => of(names[g])) : groups)}`;
}

/** Court, pour un badge : « Guillaume, Emilie » (la lettre quand un prénom manque). */
export function groupsShort(groups: string[], names: Record<string, string> = {}): string {
  return groups.map((g) => names[g] ?? g).join(', ');
}

/** Compétition « fictive » pour l'export vers l'agenda du téléphone (journées entières). */
export function eventAsMeet(ev: ClubEvent): Meet {
  return {
    id: `esn-${ev.start}-${norm(ev.city).replace(/[^a-z0-9]+/g, '-')}`,
    name: ev.name,
    city: ev.city,
    startDate: ev.start,
    endDate: ev.end,
    course: ev.course ?? 'SCM',
    createdAt: 0,
  };
}
