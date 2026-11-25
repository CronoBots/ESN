/**
 * Liste des membres du club (groupes A, B, C…), chiffrée.
 *
 * Le site et le dépôt GitHub sont publics : la liste n'y figure jamais en
 * clair. Elle est chiffrée (AES-GCM 256 bits, clé dérivée du code du club par
 * PBKDF2-SHA-256) et ne se lit qu'avec le code que le club donne aux membres.
 *
 * Module sans dépendance à l'application (seulement fflate, compression) : il
 * sert aussi au script scripts/roster.mjs.
 *
 * Les données sont compressées (gzip) avant d'être chiffrées : l'historique du
 * club est ainsi environ 6 fois plus léger à télécharger. Les fichiers publiés
 * avant la compression restent lisibles.
 */
import { gunzipSync, gzipSync } from 'fflate';
import type { ClubEntriesFile } from './clubEntries';
import type { OfficialRecordsList } from './officialRecordsList';

export interface RosterGroup {
  id: string;
  name: string;
}

export interface RosterMember {
  lastName: string;
  firstName: string;
  birthYear?: number;
  gender: 'F' | 'M';
  /** Groupe d'entraînement (A, B, C…), facultatif : sans groupe, les nageurs sont classés par année. */
  group?: string;
  /** Ancien membre (a nagé pour le club, n'y est plus) : liste à part, classements sur option. */
  former?: boolean;
  /**
   * Autres noms du même nageur (orthographe ou année de naissance différente sur swimrankings) :
   * une fiche à l'un de ces noms est réunie avec celle-ci (temps, objectifs, suivi).
   */
  aliases?: RosterAlias[];
}

export interface RosterAlias {
  lastName: string;
  firstName: string;
  birthYear?: number;
}

export interface Roster {
  club: string;
  /** AAAA-MM-JJ */
  updated: string;
  groups: RosterGroup[];
  members: RosterMember[];
}

/** Historique swimrankings des nageurs du club (texte d'import par nageur). */
export interface ClubHistory {
  /** AAAA-MM-JJ */
  updated: string;
  athletes: { lastName: string; firstName: string; birthYear?: number; swimrankingsId?: string; text: string }[];
}

export interface EncryptedRoster {
  format: 'esn-roster' | 'esn-history' | 'esn-rankings' | 'esn-entries' | 'esn-records';
  v: 1;
  kdf: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  iv: string;
  data: string;
  /** Contenu compressé (gzip) avant chiffrement ; absent : texte JSON tel quel (anciens fichiers). */
  zip?: 'gzip';
}

export const ROSTER_ITERATIONS = 310_000;

/** Sans 0/O ni 1/I/L : pas de confusion à la saisie (31 signes). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Code tel que saisi → forme canonique (casse, espaces, tirets et préfixe « ESN » ignorés). */
export function normalizeCode(code: string): string {
  const c = code.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.startsWith('ESN') && c.length > 3 ? c.slice(3) : c;
}

/** Nouveau code du club, par exemple « ESN-7KQ4-M2XP » (environ 40 bits d'aléa). */
export function generateCode(): string {
  let out = '';
  while (out.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      // tirage sans biais : on écarte les octets ≥ 248 (= 8 × 31)
      if (b < 248 && out.length < 8) out += CODE_ALPHABET[b % 31];
    }
  }
  return `ESN-${out.slice(0, 4)}-${out.slice(4)}`;
}

export class WrongCodeError extends Error {
  constructor() {
    super('Code du club incorrect');
    this.name = 'WrongCodeError';
  }
}

const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(code: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(normalizeCode(code)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptJson(value: unknown, code: string, format: EncryptedRoster['format'], iterations: number): Promise<EncryptedRoster> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(code, salt, iterations);
  const plain = gzipSync(new TextEncoder().encode(JSON.stringify(value)), { level: 9, mtime: 0 });
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plain as BufferSource));
  return { format, v: 1, kdf: 'PBKDF2-SHA-256', iterations, salt: toB64(salt), iv: toB64(iv), data: toB64(data), zip: 'gzip' };
}

async function decryptJson(enc: EncryptedRoster, code: string): Promise<unknown> {
  const key = await deriveKey(code, fromB64(enc.salt), enc.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(enc.iv) as BufferSource }, key, fromB64(enc.data) as BufferSource);
  } catch {
    throw new WrongCodeError();
  }
  const bytes = new Uint8Array(plain);
  return JSON.parse(new TextDecoder().decode(enc.zip === 'gzip' ? gunzipSync(bytes) : bytes));
}

export function encryptRoster(roster: Roster, code: string, iterations = ROSTER_ITERATIONS): Promise<EncryptedRoster> {
  return encryptJson(roster, code, 'esn-roster', iterations);
}

export function encryptHistory(history: ClubHistory, code: string, iterations = ROSTER_ITERATIONS): Promise<EncryptedRoster> {
  return encryptJson(history, code, 'esn-history', iterations);
}

/** Classements nationaux des nageurs du club : même forme que l'historique (un texte par nageur). */
export function encryptRankings(rankings: ClubHistory, code: string, iterations = ROSTER_ITERATIONS): Promise<EncryptedRoster> {
  return encryptJson(rankings, code, 'esn-rankings', iterations);
}

/** Inscriptions du club aux compétitions (programme et records de chaque engagement). */
export function encryptEntries(entries: ClubEntriesFile, code: string, iterations = ROSTER_ITERATIONS): Promise<EncryptedRoster> {
  return encryptJson(entries, code, 'esn-entries', iterations);
}

export async function decryptEntries(enc: EncryptedRoster, code: string): Promise<ClubEntriesFile> {
  const e = (await decryptJson(enc, code)) as ClubEntriesFile;
  if (!e || !Array.isArray(e.meets)) throw new Error('Inscriptions invalides');
  return e;
}

/** Liste officielle des records du club (noms des détenteurs : chiffrée comme le reste). */
export function encryptOfficialRecords(list: OfficialRecordsList, code: string, iterations = ROSTER_ITERATIONS): Promise<EncryptedRoster> {
  return encryptJson(list, code, 'esn-records', iterations);
}

export async function decryptOfficialRecords(enc: EncryptedRoster, code: string): Promise<OfficialRecordsList> {
  const l = (await decryptJson(enc, code)) as OfficialRecordsList;
  // Même contrôle que validOfficialRecords (pas d'import de valeur ici : fichier lu aussi par Node)
  if (!l || typeof l.asOf !== 'string' || !Array.isArray(l.records)) throw new Error('Liste des records invalide');
  return l;
}

export function isEncryptedRoster(x: unknown, format: EncryptedRoster['format'] = 'esn-roster'): x is EncryptedRoster {
  const e = x as EncryptedRoster;
  return !!e && e.format === format && e.v === 1 && typeof e.data === 'string' && typeof e.iv === 'string' && typeof e.salt === 'string';
}

/** Déchiffre la liste ; WrongCodeError si le code ne correspond pas. */
export async function decryptRoster(enc: EncryptedRoster, code: string): Promise<Roster> {
  return validateRoster(await decryptJson(enc, code));
}

/** Déchiffre l'historique du club ; WrongCodeError si le code ne correspond pas. */
export async function decryptRankings(enc: EncryptedRoster, code: string): Promise<ClubHistory> {
  const h = (await decryptJson(enc, code)) as ClubHistory;
  if (!h || !Array.isArray(h.athletes)) throw new Error('Classements invalides');
  return h;
}

export async function decryptHistory(enc: EncryptedRoster, code: string): Promise<ClubHistory> {
  const h = (await decryptJson(enc, code)) as ClubHistory;
  if (!h || !Array.isArray(h.athletes)) throw new Error('Historique invalide');
  return h;
}

/**
 * Courses nagées pour le club seulement. Sur swimrankings, chaque course est relevée avec le club
 * pour lequel le nageur nageait (8e colonne) : une course nagée pour un autre club (avant son
 * arrivée, après son départ) est retirée. Les colonnes suivantes (place, tour, passages) restent.
 * Quand toutes les courses portent leur club, l'en-tête reçoit « @@CLUBS » : historique vérifié.
 */
export function keepClubRaces(text: string, club: RegExp): { text: string; kept: number; dropped: number; verified: boolean } {
  const out: string[] = [];
  let kept = 0;
  let dropped = 0;
  let withClub = 0;
  let marked = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^@@CLUBS\b/.test(line.trim())) {
      marked = true;
      continue;
    }
    const cols = line.split('\t');
    if (cols.length < 5) {
      out.push(line);
      continue;
    }
    if (cols.length >= 8 && cols[7].trim()) {
      withClub++;
      if (!club.test(cols[7].trim())) {
        dropped++;
        continue;
      }
    }
    out.push(line);
    kept++;
  }
  const verified = marked || (kept + dropped > 0 && withClub === kept + dropped);
  if (verified) {
    // Marque après les lignes « @@… » du début
    let at = 0;
    while (at < out.length && /^@@/.test(out[at].trim())) at++;
    out.splice(at, 0, '@@CLUBS');
  }
  return { text: out.join('\n'), kept, dropped, verified };
}

/** Fichier d'un nageur dans historique/ ou classements/ : « NOM_Prenom.txt » ; « _suivi.txt » (suivi du relevé) n'en est pas un. */
export const isSwimmerFile = (name: string) => name.endsWith('.txt') && !name.startsWith('_');

/** En-tête d'un texte d'import swimrankings : « NOM, Prénom (AAAA) » et l'identifiant swimrankings. */
export function historyHeader(text: string): { lastName: string; firstName: string; birthYear?: number; swimrankingsId?: string } | null {
  const id = /athleteId=(\d+)/.exec(text)?.[1];
  for (const line of text.split(/\r?\n/)) {
    const m = /^([^,@\t]+),\s*([^(\t]+?)\s*(?:\((\d{4})\))?\s*$/.exec(line.trim());
    if (m) return { lastName: m[1].trim(), firstName: m[2].trim(), birthYear: m[3] ? Number(m[3]) : undefined, swimrankingsId: id };
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Lecture et contrôle de la liste en clair (script de préparation)          */
/* ------------------------------------------------------------------------ */

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Contrôle une liste et la remet en forme (noms, groupes connus, doublons). */
export function validateRoster(raw: unknown): Roster {
  const r = raw as Partial<Roster>;
  if (!r || !Array.isArray(r.members)) throw new Error('Liste des membres invalide');
  const members: RosterMember[] = [];
  const seen = new Set<string>();
  for (const m of r.members) {
    const lastName = clean(m.lastName);
    const firstName = clean(m.firstName);
    const group = clean(m.group).toUpperCase() || undefined;
    const gender = clean(m.gender).toUpperCase();
    if (!lastName || !firstName) throw new Error(`Nom ou prénom manquant : ${JSON.stringify(m)}`);
    if (gender !== 'F' && gender !== 'M') throw new Error(`Sexe (F ou M) manquant pour ${firstName} ${lastName}`);
    const birthYear = m.birthYear ? Number(m.birthYear) : undefined;
    if (birthYear != null && !(birthYear > 1900 && birthYear < 2100)) throw new Error(`Année de naissance invalide pour ${firstName} ${lastName}`);
    const key = memberKey({ lastName, firstName, birthYear });
    if (seen.has(key)) continue;
    seen.add(key);
    const former = m.former === true || /^anc/i.test(clean(m.former));
    const aliases = readAliases(m.aliases).filter((a) => memberKey(a) !== key);
    members.push({ lastName, firstName, birthYear, gender, group, ...(former ? { former: true } : {}), ...(aliases.length ? { aliases } : {}) });
  }
  // Un autre nom ne peut pas être celui d'un membre de la liste (sinon les deux fiches seraient réunies)
  for (const m of members) {
    if (!m.aliases) continue;
    m.aliases = m.aliases.filter((a) => !seen.has(memberKey(a)));
    if (!m.aliases.length) delete m.aliases;
  }
  const ids = [...new Set(members.map((m) => m.group).filter((g): g is string => !!g))].sort();
  const named = new Map((r.groups ?? []).map((g) => [clean(g.id).toUpperCase(), clean(g.name)]));
  return {
    club: clean(r.club) || 'Ecole Seraing Natation',
    updated: clean(r.updated) || new Date().toISOString().slice(0, 10),
    groups: ids.map((id) => ({ id, name: named.get(id) || `Groupe ${id}` })),
    members,
  };
}

/** « DUPOND, Emma (2012) | DUPONT, Ema » (texte du tableur) ou liste déjà lue. */
function readAliases(raw: unknown): RosterAlias[] {
  const list = Array.isArray(raw) ? raw : clean(raw) ? clean(raw).split('|') : [];
  const out: RosterAlias[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      const m = /^([^,]+),\s*([^(]+?)\s*(?:\((\d{4})\))?$/.exec(clean(item));
      if (m) out.push({ lastName: m[1].trim(), firstName: m[2].trim(), ...(m[3] ? { birthYear: Number(m[3]) } : {}) });
    } else if (item && typeof item === 'object') {
      const a = item as Partial<RosterAlias>;
      const lastName = clean(a.lastName);
      const firstName = clean(a.firstName);
      const birthYear = a.birthYear ? Number(a.birthYear) : undefined;
      if (lastName && firstName) out.push({ lastName, firstName, ...(birthYear && birthYear > 1900 && birthYear < 2100 ? { birthYear } : {}) });
    }
  }
  return out;
}

/** Autres noms au format du tableur : « DUPOND, Emma (2012) | … ». */
export function aliasesText(aliases: RosterAlias[] | undefined): string {
  return (aliases ?? []).map((a) => `${a.lastName}, ${a.firstName}${a.birthYear ? ` (${a.birthYear})` : ''}`).join(' | ');
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

/** Clé d'un membre : nom, prénom (sans accents ni casse) et année de naissance. */
export function memberKey(m: { lastName: string; firstName: string; birthYear?: number }): string {
  return `${norm(m.lastName)}|${norm(m.firstName)}|${m.birthYear ?? ''}`;
}

/**
 * Liste en clair au format tableur (CSV, séparateur ; , ou tabulation) :
 * groupe ; nom ; prénom ; année de naissance ; sexe (F/M) ; statut (« ancien »
 * pour un ancien membre, sinon vide) ; autres noms (facultatif : « NOM, Prénom (AAAA) »,
 * séparés par « | »). Ligne d'en-tête facultative.
 */
export function parseRosterCsv(
  text: string,
): { group: string; lastName: string; firstName: string; birthYear?: number; gender: string; former?: boolean; aliases?: string }[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return [];
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const rows = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1')));
  const isHeader = /group/i.test(rows[0][0] ?? '') && !/^\d{4}$/.test(rows[0][3] ?? '');
  // F = fille ; M, G (garçon) ou H (homme) = garçon
  const sex = (g = '') => {
    const c = g.trim().toUpperCase()[0];
    return c === 'F' ? 'F' : c === 'M' || c === 'G' || c === 'H' ? 'M' : g;
  };
  return (isHeader ? rows.slice(1) : rows).map(([group = '', lastName = '', firstName = '', year = '', gender = '', status = '', aliases = '']) => ({
    group: group.replace(/^groupe\s*/i, ''),
    lastName,
    firstName,
    birthYear: year ? Number(year) : undefined,
    gender: sex(gender),
    ...(/^anc/i.test(status.trim()) ? { former: true } : {}),
    ...(aliases.trim() ? { aliases: aliases.trim() } : {}),
  }));
}
