/**
 * Liste des membres du club (groupes A, B, C…), chiffrée.
 *
 * Le site et le dépôt GitHub sont publics : la liste n'y figure jamais en
 * clair. Elle est chiffrée (AES-GCM 256 bits, clé dérivée du code du club par
 * PBKDF2-SHA-256) et ne se lit qu'avec le code que le club donne aux membres.
 *
 * Module autonome (aucun import) : il sert aussi au script scripts/roster.mjs.
 */

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
  format: 'esn-roster' | 'esn-history';
  v: 1;
  kdf: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  iv: string;
  data: string;
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
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(JSON.stringify(value))),
  );
  return { format, v: 1, kdf: 'PBKDF2-SHA-256', iterations, salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
}

async function decryptJson(enc: EncryptedRoster, code: string): Promise<unknown> {
  const key = await deriveKey(code, fromB64(enc.salt), enc.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(enc.iv) as BufferSource }, key, fromB64(enc.data) as BufferSource);
  } catch {
    throw new WrongCodeError();
  }
  return JSON.parse(new TextDecoder().decode(plain));
}

export function encryptRoster(roster: Roster, code: string, iterations = ROSTER_ITERATIONS): Promise<EncryptedRoster> {
  return encryptJson(roster, code, 'esn-roster', iterations);
}

export function encryptHistory(history: ClubHistory, code: string, iterations = ROSTER_ITERATIONS): Promise<EncryptedRoster> {
  return encryptJson(history, code, 'esn-history', iterations);
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
export async function decryptHistory(enc: EncryptedRoster, code: string): Promise<ClubHistory> {
  const h = (await decryptJson(enc, code)) as ClubHistory;
  if (!h || !Array.isArray(h.athletes)) throw new Error('Historique invalide');
  return h;
}

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
    members.push({ lastName, firstName, birthYear, gender, group });
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
 * groupe ; nom ; prénom ; année de naissance ; sexe (F/M). Ligne d'en-tête facultative.
 */
export function parseRosterCsv(text: string): { group: string; lastName: string; firstName: string; birthYear?: number; gender: string }[] {
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
  return (isHeader ? rows.slice(1) : rows).map(([group = '', lastName = '', firstName = '', year = '', gender = '']) => ({
    group: group.replace(/^groupe\s*/i, ''),
    lastName,
    firstName,
    birthYear: year ? Number(year) : undefined,
    gender: sex(gender),
  }));
}
