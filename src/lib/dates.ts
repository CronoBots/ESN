/** Utilitaires de dates (format ISO AAAA-MM-JJ, affichage en français). */

const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_LONG = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];
const DAYS_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

export function todayISO(): string {
  return toISO(new Date());
}

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function isValidISO(iso: string | undefined | null): iso is string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = fromISO(iso);
  return toISO(d) === iso;
}

/** "14 nov. 2026" */
export function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = fromISO(iso);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** "14 nov." */
export function formatDayMonth(iso: string): string {
  const d = fromISO(iso);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** "samedi 14 novembre" */
export function formatLongDay(iso: string): string {
  const d = fromISO(iso);
  return `${DAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
}

/** "novembre 2026" */
export function formatMonthYear(iso: string): string {
  const d = fromISO(iso);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

/** "13 – 15 nov. 2026" */
export function formatRange(start: string, end?: string): string {
  if (!end || end === start) return formatDate(start);
  const a = fromISO(start);
  const b = fromISO(end);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${a.getDate()} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`;
  }
  if (a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`;
  }
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 86400000);
}

export function addDays(iso: string, days: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

/** Texte relatif : "aujourd'hui", "hier", "dans 3 jours", "il y a 2 mois". */
export function relativeDay(iso: string, ref = todayISO()): string {
  const diff = daysBetween(ref, iso);
  if (diff === 0) return "aujourd'hui";
  if (diff === 1) return 'demain';
  if (diff === -1) return 'hier';
  const abs = Math.abs(diff);
  let txt: string;
  if (abs < 14) txt = `${abs} jours`;
  else if (abs < 60) txt = `${Math.round(abs / 7)} semaines`;
  else if (abs < 365 * 2) txt = `${Math.round(abs / 30.44)} mois`;
  else txt = `${Math.round(abs / 365.25)} ans`;
  return diff > 0 ? `dans ${txt}` : `il y a ${txt}`;
}

/**
 * Saison sportive (septembre → août) : 2026-11-14 → "2026-2027".
 */
export function seasonOf(iso: string): string {
  const d = fromISO(iso);
  const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

export function seasonLabel(season: string): string {
  const [a, b] = season.split('-');
  return `Saison ${a}/${b.slice(2)}`;
}

/** Âge sportif (au 31 décembre de l'année en cours). */
export function sportAge(birthYear: number | undefined, ref = new Date()): number | null {
  if (!birthYear) return null;
  return ref.getFullYear() - birthYear;
}

/** Index des mois pour le parseur (FR, EN, NL, DE). */
const MONTH_TOKENS: Record<string, number> = {
  jan: 1, janv: 1, janvier: 1, january: 1, januar: 1, januari: 1, jän: 1,
  feb: 2, fév: 2, fev: 2, févr: 2, fevr: 2, février: 2, fevrier: 2, february: 2, februar: 2, februari: 2,
  mar: 3, mars: 3, march: 3, mär: 3, märz: 3, maart: 3, mrt: 3,
  apr: 4, avr: 4, avril: 4, april: 4,
  may: 5, mai: 5, mei: 5,
  jun: 6, juin: 6, june: 6, juni: 6,
  jul: 7, juil: 7, juillet: 7, july: 7, juli: 7,
  aug: 8, aoû: 8, aou: 8, août: 8, aout: 8, august: 8, augustus: 8,
  sep: 9, sept: 9, septembre: 9, september: 9,
  oct: 10, octobre: 10, october: 10, okt: 10, oktober: 10,
  nov: 11, novembre: 11, november: 11,
  dec: 12, déc: 12, décembre: 12, decembre: 12, december: 12, dez: 12, dezember: 12,
};

export function monthFromToken(token: string): number | null {
  const t = token.toLowerCase().replace(/\.$/, '');
  return MONTH_TOKENS[t] ?? null;
}

export function makeISO(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidISO(iso) ? iso : null;
}
