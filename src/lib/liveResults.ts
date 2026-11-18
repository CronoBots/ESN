import { CLUB } from '../club';
import { actions, batch, getState } from '../store/store';
import type { Swim, Swimmer } from '../store/types';
import { makeISO, monthFromToken, todayISO } from './dates';
import { parseLenex, unzipFirst, type LenexAthlete, type LenexMeet } from './lenex';
import { computePbFlags } from './stats';
import { closeSwimmer, nameKeys, normName, sameSwimmer, type ReportMeet } from './results';
import { findSwimmerEntry, findSwimmerResult, lapsToSplits, parseSheetHeader } from './resultSheet';
import { estimateHeatStarts, parseResultSheet, parseStartSheet, splitName, type EventSheet, type SheetRow } from './heatSheet';

/** Nageur du club repéré dans une compétition. */
export interface ClubCandidate {
  firstName: string;
  lastName: string;
  birthYear?: number;
  gender: Swimmer['gender'];
  swimrankingsId?: string;
}

const yearOf = (yy?: string) => (yy ? (Number(yy) < 40 ? 2000 : 1900) + Number(yy) : undefined);

/** Nageurs du club dans une feuille (liste des séries ou résultats). */
function clubRows(text: string, isResult: boolean, gender: Swimmer['gender'] | undefined, club: RegExp): ClubCandidate[] {
  if (!gender) return [];
  const rows = isResult ? parseResultSheet(text).results.flatMap((g) => g.rows) : parseStartSheet(text).heats.flatMap((h) => h.rows);
  const out: ClubCandidate[] = [];
  for (const r of rows) {
    if (!club.test((r.club ?? '').trim())) continue;
    const n = splitName(r.name);
    if (n) out.push({ ...n, birthYear: yearOf(r.yy), gender });
  }
  return out;
}
import { isValidEvent } from './events';
import type { ImportReport } from '../store/store';

export { sameSwimmer };

export interface Progress {
  done: number;
  total: number;
}

/**
 * Résultats publiés en direct par les organisateurs (Splash Meet Manager →
 * live.swimrankings.net). Le site autorise explicitement la lecture par
 * d'autres applications (CORS) et ses règles (robots.txt) permettent l'accès
 * aux pages des compétitions et aux fichiers de résultats LENEX (.lxf).
 */
export const LIVE_BASE = 'https://live.swimrankings.net';

/** 2 : lecture des feuilles PDF (résultats et listes de départ). */
export const SYNC_ENGINE = 7; // 3 : fiche swimrankings reliée ; 4 : séries en direct ; 5 : nouveaux nageurs du club ; 6 : noms à une lettre près ; 7 : places ajoutées aux courses déjà connues (historique)

export interface LiveMeet {
  id: string;
  status: 'live' | 'finished' | 'upcoming';
  name: string;
  city?: string;
  course?: 'SCM' | 'LCM';
  startDate?: string;
  endDate?: string;
}

function strip(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** « 13 - 15 Nov 2026 », « 31 Oct - 1 Nov 2026 », « 8 Nov 2026 » → dates ISO */
export function parseLiveDates(text: string): { start?: string; end?: string } {
  const t = text.trim();
  const iso = (d: string, m: string, y: string) => {
    const mo = monthFromToken(m);
    return mo ? makeISO(+y, mo, +d) ?? undefined : undefined;
  };
  let m = /^(\d{1,2})\s*-\s*(\d{1,2})\s+([A-Za-zéû.]+)\s+(\d{4})$/.exec(t);
  if (m) return { start: iso(m[1], m[3], m[4]), end: iso(m[2], m[3], m[4]) };
  m = /^(\d{1,2})\s+([A-Za-zéû.]+)\s*-\s*(\d{1,2})\s+([A-Za-zéû.]+)\s+(\d{4})$/.exec(t);
  if (m) return { start: iso(m[1], m[2], m[5]), end: iso(m[3], m[4], m[5]) };
  m = /^(\d{1,2})\s+([A-Za-zéû.]+)\s+(\d{4})\s*-\s*(\d{1,2})\s+([A-Za-zéû.]+)\s+(\d{4})$/.exec(t);
  if (m) return { start: iso(m[1], m[2], m[3]), end: iso(m[4], m[5], m[6]) };
  m = /^(\d{1,2})\s+([A-Za-zéû.]+)\s+(\d{4})$/.exec(t);
  if (m) return { start: iso(m[1], m[2], m[3]) };
  return {};
}

/** Liste des compétitions d'un pays, telle qu'affichée sur la page d'accueil du site. */
export function parseMeetList(html: string): LiveMeet[] {
  const out: LiveMeet[] = [];
  const rowRe = /<tr class="([^"]*)">([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const row = m[2];
    const id = /href="\/(\d+)\/"/.exec(row)?.[1];
    if (!id) continue;
    const cell = (cls: string) => new RegExp(`<td class="${cls}"[^>]*>([\\s\\S]*?)</td>`).exec(row)?.[1] ?? '';
    const badge = strip(/<span class="badge[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(cell('tdStatus'))?.[1] ?? '').toLowerCase();
    const dateLong = strip(/<span class="dateLong">([\s\S]*?)<\/span>/.exec(cell('tdDate'))?.[1] ?? '');
    const name = strip(/<span class="name">([\s\S]*?)<\/span>/.exec(cell('tdName'))?.[1] ?? '');
    // « 🇧🇪 4367 Crisnée BEL », « 4053 - Embourg » → « Crisnée », « Embourg »
    const city = strip(cell('tdCity'))
      .replace(/\s*\b[A-Z]{3}$/, '')
      .replace(/^[^\p{L}\d]+/u, '')
      .replace(/^\d{4,5}\s*-?\s*/, '')
      .trim();
    const course = /50m/.test(strip(cell('tdCourse'))) ? 'LCM' : /25m/.test(strip(cell('tdCourse'))) ? 'SCM' : undefined;
    const d = parseLiveDates(dateLong);
    const status: LiveMeet['status'] = /live/.test(badge + m[1]) ? 'live' : /finish|termin|fini/.test(badge + m[1]) ? 'finished' : 'upcoming';
    if (name) out.push({ id, status, name, city: city || undefined, course, startDate: d.start, endDate: d.end });
  }
  return out;
}

export async function listLiveMeets(nation = CLUB.liveNation): Promise<LiveMeet[]> {
  const res = await fetch(`${LIVE_BASE}/?nation=${encodeURIComponent(nation)}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Liste des compétitions indisponible (${res.status})`);
  return parseMeetList(await res.text());
}

/* ------------------------------------------------------------------------ */
/* Compétitions terminées : documents gardés sur l'appareil                  */
/* ------------------------------------------------------------------------ */

/*
 * Les résultats d'une compétition terminée depuis plus de 2 jours sont validés et ne changent plus :
 * le fichier de résultats, les feuilles PDF et le classement de chaque épreuve sont gardés sur
 * l'appareil (Cache Storage) et ne sont plus jamais retéléchargés. Les compétitions en cours, à venir
 * ou terminées depuis moins de 2 jours (corrections possibles) sont toujours relues sur internet.
 */
const FINAL_CACHE = 'esn-resultats-v1';
/** Au-delà, les documents gardés depuis le plus longtemps sont effacés. */
const FINAL_MAX = 400;

/** Compétition finie depuis plus de 2 jours (date de fin) : résultats définitifs. */
export function isSettled(endDate: string | undefined, today = todayISO()): boolean {
  if (!endDate) return false;
  return endDate < new Date(Date.parse(today) - 2 * 86400000).toISOString().slice(0, 10);
}

const settledMeet = (m: LiveMeet) => m.status === 'finished' && isSettled(m.endDate ?? m.startDate);

async function finalCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(FINAL_CACHE);
  } catch {
    return null;
  }
}

/** Document définitif déjà sur l'appareil. */
export async function readFinal(key: string): Promise<Response | null> {
  try {
    return (await (await finalCache())?.match(key)) ?? null;
  } catch {
    return null;
  }
}

/** Garde un document définitif sur l'appareil (en arrière-plan, sans jamais bloquer ni échouer). */
export function keepFinal(key: string, body: BodyInit): Promise<void> {
  return (async () => {
    const cache = await finalCache();
    if (!cache) return;
    await cache.put(key, new Response(body));
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - FINAL_MAX))) await cache.delete(k);
  })().catch(() => {});
}

const lenexCache = new Map<string, Promise<LenexMeet | null>>();

/**
 * Résultats LENEX d'une compétition (null s'ils ne sont pas encore publiés).
 * `settled` : compétition aux résultats définitifs, lus une seule fois puis gardés sur l'appareil.
 */
export function fetchLiveResults(id: string, live = false, settled = false): Promise<LenexMeet | null> {
  const key = `${id}${live ? `@${Math.floor(Date.now() / 300000)}` : ''}`;
  let p = lenexCache.get(key);
  if (!p) {
    p = (async () => {
      const url = `${LIVE_BASE}/${id}/results.lxf`;
      const kept = settled ? await readFinal(url) : null;
      let buf: ArrayBuffer;
      if (kept) buf = await kept.arrayBuffer();
      else {
        const res = await fetch(url, { cache: live ? 'no-cache' : 'default' });
        if (!res.ok) return null;
        buf = await res.arrayBuffer();
      }
      const b = new Uint8Array(buf);
      if (b.length < 4 || b[0] !== 0x50 || b[1] !== 0x4b) return null; // pas une archive : pas encore publié
      if (settled && !kept) void keepFinal(url, buf.slice(0));
      return parseLenex(await unzipFirst(buf));
    })();
    p.catch(() => lenexCache.delete(key));
    lenexCache.set(key, p);
  }
  return p;
}

/* ------------------------------------------------------------------------ */
/* Feuilles PDF (quand l'organisateur ne publie pas le fichier LENEX)        */
/* ------------------------------------------------------------------------ */

export interface MeetDocs {
  /** Résultats par épreuve : numéro d'épreuve → fichier. */
  results: Map<number, string>;
  /** Listes de départ par épreuve. */
  starts: Map<number, string>;
  stats?: string;
}

/** Feuilles publiées sur la page d'une compétition (ResultList_N.pdf, StartList_N.pdf…). */
export function parseMeetDocs(html: string): MeetDocs {
  const docs: MeetDocs = { results: new Map(), starts: new Map() };
  for (const m of html.matchAll(/href="((ResultList|StartList)_(\d+)\.pdf)"/g)) {
    (m[2] === 'ResultList' ? docs.results : docs.starts).set(Number(m[3]), m[1]);
  }
  if (/href="EntryStatistics\.pdf"/.test(html)) docs.stats = 'EntryStatistics.pdf';
  return docs;
}

/** Texte d'une feuille PDF. `keep` : feuille définitive, lue une seule fois puis gardée sur l'appareil (le texte, pas le PDF). */
export async function pdfText(url: string, fresh: boolean, keep = false): Promise<string> {
  const key = `${url}?texte`;
  const kept = keep ? await readFinal(key) : null;
  if (kept) return kept.text();
  const res = await fetch(url, { cache: fresh ? 'no-cache' : 'default' });
  if (!res.ok) return '';
  const { pdfLines } = await import('./pdfText');
  const text = (await pdfLines(await res.arrayBuffer())).join('\n');
  if (keep && text) void keepFinal(key, text);
  return text;
}

type PdfSwim = ImportReport['swims'][number];

/**
 * Résultats (feuilles « Liste résultats ») et, à défaut, programme (« Liste
 * des séries » : série, ligne, temps d'engagement) des nageurs, lus dans les
 * PDF de la compétition. `complete` : tous les résultats sont publiés.
 */
export async function readMeetPdfs(
  m: LiveMeet,
  swimmers: Swimmer[],
  club?: RegExp,
  members?: RegExp,
): Promise<{ found: Map<string, PdfSwim[]>; complete: boolean; candidates: ClubCandidate[] } | null> {
  const fresh = m.status !== 'finished';
  const keep = settledMeet(m);
  const res = await fetch(`${LIVE_BASE}/${m.id}/`, { cache: fresh ? 'no-cache' : 'default' });
  if (!res.ok) return null;
  const docs = parseMeetDocs(await res.text());
  if (!docs.results.size && !docs.starts.size) return null;
  // Terminé : tous les résultats sont là (ou la compétition date de plus de 3 jours : épreuves annulées, relais…)
  const old = (m.endDate ?? m.startDate ?? '') < new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const complete = m.status === 'finished' && docs.results.size > 0 && (docs.results.size >= docs.starts.size || old);
  const found = new Map<string, PdfSwim[]>();
  const candidates: ClubCandidate[] = [];
  // Aucun nageur du club inscrit : rien à lire
  if (club && docs.stats && !club.test(await pdfText(`${LIVE_BASE}/${m.id}/${docs.stats}`, fresh, keep)))
    return { found, complete: m.status === 'finished', candidates };
  const events = [...new Set([...docs.results.keys(), ...docs.starts.keys()])].sort((a, b) => a - b);
  const course = m.course ?? 'SCM';
  await mapLimit(events, 4, async (no) => {
    const isResult = docs.results.has(no);
    const text = await pdfText(`${LIVE_BASE}/${m.id}/${(isResult ? docs.results : docs.starts).get(no)}`, fresh && !isResult, keep);
    if (!text) return;
    const flat = normName(text);
    const header = parseSheetHeader([text]);
    if (!header.distance || !header.stroke || !isValidEvent(header.distance, header.stroke, course)) return;
    if (members) candidates.push(...clubRows(text, isResult, header.gender, members));
    for (const sw of swimmers) {
      // Tri rapide (nom ou prénom sur la feuille) ; la lecture de la ligne tolère une lettre d'écart dans le nom
      if (!(flat.includes(normName(sw.lastName)) || flat.includes(normName(sw.firstName))) || (header.gender && header.gender !== sw.gender)) continue;
      const base = {
        eventNo: header.eventNo ?? no,
        distance: header.distance,
        stroke: header.stroke,
        course,
        round: header.round,
        date: header.date,
        startTime: header.startTime,
      };
      let swim: PdfSwim | null = null;
      if (isResult) {
        const r = findSwimmerResult([text], sw, header);
        if (r && (r.timeCs != null || r.status !== 'OK'))
          swim = { ...base, timeCs: r.timeCs, status: r.status, place: r.place, points: r.points, splits: lapsToSplits(r.laps) };
      } else {
        const e = findSwimmerEntry(text, sw);
        // Heure de passage : départ estimé de sa série
        const heatStart = e?.heat ? estimateHeatStarts(parseStartSheet(text), header.distance).heats.find((h) => h.heat === e.heat)?.start : undefined;
        if (e) swim = { ...base, startTime: heatStart ?? base.startTime, status: 'OK', entryCs: e.entryCs, heat: e.heat, lane: e.lane };
      }
      if (swim) found.set(sw.id, [...(found.get(sw.id) ?? []), swim]);
    }
  });
  return { found, complete, candidates };
}

/* ------------------------------------------------------------------------ */
/* Feuille complète d'une épreuve (séries et classement), à la demande       */
/* ------------------------------------------------------------------------ */

const sheetCache = new Map<string, { at: number; p: Promise<EventSheet | null> }>();

/** Séries et classement d'une épreuve d'après le fichier LENEX. */
export function sheetFromLenex(l: LenexMeet, eventNo: number): EventSheet | null {
  const rows: (SheetRow & { heat?: number })[] = [];
  let ref: LenexMeet['athletes'][number]['swims'][number] | undefined;
  for (const a of l.athletes) {
    for (const s of a.swims) {
      if (s.eventNo !== eventNo) continue;
      ref ??= s;
      rows.push({
        heat: s.heat,
        lane: s.lane,
        status: s.status,
        name: `${a.lastName.toUpperCase()}, ${a.firstName}`,
        yy: a.birthYear ? String(a.birthYear % 100).padStart(2, '0') : undefined,
        club: a.club,
        entryCs: s.entryCs,
        timeCs: s.status === 'OK' ? s.timeCs : undefined,
        points: s.points,
      });
    }
  }
  if (!ref) return null;
  const heats = [...new Set(rows.map((r) => r.heat ?? 1))]
    .sort((a, b) => a - b)
    .map((heat, _i, all) => ({ heat, total: all.length, rows: rows.filter((r) => (r.heat ?? 1) === heat).sort((a, b) => (a.lane ?? 0) - (b.lane ?? 0)) }));
  const done = rows.filter((r) => r.timeCs != null || r.status !== 'OK');
  const ranked = done
    .slice()
    .sort((a, b) => (a.timeCs ?? Infinity) - (b.timeCs ?? Infinity))
    .map((r, _i, arr) => ({ ...r, place: r.timeCs != null ? arr.findIndex((x) => x.timeCs === r.timeCs) + 1 : undefined }));
  const sheet: EventSheet = {
    header: { round: ref.round, eventNo, distance: ref.distance, stroke: ref.stroke, date: ref.date, startTime: ref.startTime },
    heats,
    results: ranked.length ? [{ category: 'Tous âges', rows: ranked }] : [],
  };
  return estimateHeatStarts(sheet, ref.distance);
}

/**
 * Séries (tous les nageurs, ligne, club, engagement, heure estimée) et
 * classement d'une épreuve : fichier LENEX s'il est publié, sinon feuilles PDF.
 * `live` : compétition en cours, relue toutes les 2 minutes au plus.
 * `settled` : résultats définitifs ; le classement est gardé sur l'appareil après la première lecture.
 */
export function loadEventSheet(liveId: string, eventNo: number, live: boolean, settled = false): Promise<EventSheet | null> {
  const key = `${liveId}/${eventNo}`;
  const cached = sheetCache.get(key);
  if (cached && (!live || Date.now() - cached.at < 120000)) return cached.p;
  const kept = `${LIVE_BASE}/${liveId}/epreuve-${eventNo}.json`;
  const p = (async () => {
    const saved = settled ? await readFinal(kept) : null;
    if (saved) return (await saved.json()) as EventSheet;
    const sheet = await readEventSheet(liveId, eventNo, live, settled);
    // Classement publié d'une compétition terminée : plus besoin de relire le fichier ni les feuilles
    if (settled && sheet?.results.length) void keepFinal(kept, JSON.stringify(sheet));
    return sheet;
  })();
  sheetCache.set(key, { at: Date.now(), p });
  p.catch(() => sheetCache.delete(key));
  return p;
}

async function readEventSheet(liveId: string, eventNo: number, live: boolean, settled: boolean): Promise<EventSheet | null> {
  const l = await fetchLiveResults(liveId, live, settled).catch(() => null);
  const fromLenex = l ? sheetFromLenex(l, eventNo) : null;
  if (fromLenex) return fromLenex;
  const res = await fetch(`${LIVE_BASE}/${liveId}/`, { cache: live ? 'no-cache' : 'default' });
  if (!res.ok) return null;
  const docs = parseMeetDocs(await res.text());
  const startFile = docs.starts.get(eventNo);
  const resultFile = docs.results.get(eventNo);
  const [st, rs] = await Promise.all([
    startFile ? pdfText(`${LIVE_BASE}/${liveId}/${startFile}`, live, settled) : Promise.resolve(''),
    resultFile ? pdfText(`${LIVE_BASE}/${liveId}/${resultFile}`, live, settled) : Promise.resolve(''),
  ]);
  if (!st && !rs) return null;
  const start = st ? parseStartSheet(st) : null;
  const result = rs ? parseResultSheet(rs) : null;
  const header = start?.header ?? result!.header;
  const sheet: EventSheet = { header, title: start?.title ?? result?.title, heats: start?.heats ?? [], results: result?.results ?? [] };
  return header.distance ? estimateHeatStarts(sheet, header.distance) : sheet;
}

function liveMeetReport(m: LiveMeet): ReportMeet | null {
  return m.startDate ? { name: m.name, city: m.city, course: m.course ?? 'SCM', startDate: m.startDate, endDate: m.endDate, liveId: m.id } : null;
}

function toImport(l: LenexMeet, a: LenexAthlete) {
  return {
    meet: l.meet,
    swims: a.swims.map((s) => ({
      ...s,
      notes: s.comment ? `${s.status === 'DSQ' ? 'Disqualification' : 'Remarque'} : ${s.comment}` : undefined,
    })),
  };
}

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>, onDone?: () => void) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const it = items[next++];
        try {
          await fn(it);
        } catch {
          /* compétition ignorée */
        }
        onDone?.();
      }
    }),
  );
}

/* ------------------------------------------------------------------------ */
/* Synchronisation automatique                                               */
/* ------------------------------------------------------------------------ */

export interface LiveSyncResult {
  /** Résultats ajoutés (temps, disqualifications…). */
  added: number;
  /** Épreuves au programme ajoutées (listes de départ). */
  entries: number;
  /** Nageurs du club trouvés dans les compétitions et ajoutés à la liste. */
  newMembers: Swimmer[];
  entrySwimmers: { swimmer: Swimmer; added: number }[];
  pbs: number;
  swimmers: { swimmer: Swimmer; added: number }[];
}

let running: Promise<LiveSyncResult> | null = null;

/** État observable de la recherche en cours (bandeau « Recherche des résultats… »). */
export const syncStatus = {
  value: null as Progress | null,
  listeners: new Set<() => void>(),
  set(v: Progress | null) {
    this.value = v;
    this.listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    syncStatus.listeners.add(l);
    return () => {
      syncStatus.listeners.delete(l);
    };
  },
};

export const isSyncing = () => running != null;

export function syncLive(opts: { force?: boolean; onProgress?: (p: Progress) => void } = {}): Promise<LiveSyncResult> {
  if (!running) {
    syncStatus.set({ done: 0, total: 0 });
    running = doSync({
      ...opts,
      onProgress: (p) => {
        syncStatus.set(p);
        opts.onProgress?.(p);
      },
    }).finally(() => {
      running = null;
      syncStatus.set(null);
    });
  }
  return running;
}

async function doSync({ force, onProgress }: { force?: boolean; onProgress?: (p: Progress) => void }): Promise<LiveSyncResult> {
  const result: LiveSyncResult = { added: 0, entries: 0, entrySwimmers: [], newMembers: [], pbs: 0, swimmers: [] };
  const state = getState();
  const cfg = state.settings.liveSync;
  if ((!cfg.enabled && !force) || !state.swimmers.length) return result;

  const today = todayISO();
  const all = await listLiveMeets();
  const meets = all.filter((m) => m.status !== 'upcoming' && (!m.startDate || m.startDate <= today));
  // Nouvelle version de la recherche : toutes les compétitions sont relues (sans doublon)
  const processed = (cfg.engine ?? 1) < SYNC_ENGINE ? {} : { ...cfg.processed };
  // Anciens membres : leur historique au club suffit (pas de recherche de leurs résultats actuels, souvent ailleurs)
  const swimmers = state.swimmers.filter((s) => !s.former);
  // Nageurs du club : on lit aussi les feuilles PDF (compétitions récentes sans fichier LENEX, programmes à venir)
  const club = swimmers.some((s) => s.member) ? CLUB.match : undefined;
  const soon = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);
  const recent = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const upcoming = club ? all.filter((m) => m.status === 'upcoming' && m.startDate && m.startDate <= soon) : [];
  const todo = [
    ...meets.filter((m) => m.status === 'live' || swimmers.some((s) => !processed[m.id]?.includes(s.id))),
    ...upcoming,
  ];
  const found = new Map<string, ImportReport[]>();
  const candidates: ClubCandidate[] = [];
  const profile = new Map<string, Partial<Swimmer>>();
  let done = 0;
  onProgress?.({ done, total: todo.length });

  await mapLimit(
    todo,
    3,
    async (m) => {
      const pending = m.status === 'finished' ? swimmers.filter((s) => !processed[m.id]?.includes(s.id)) : swimmers;
      const l = m.status === 'upcoming' ? null : await fetchLiveResults(m.id, m.status === 'live', settledMeet(m));
      if (!l) {
        // Pas de fichier LENEX : feuilles PDF (nageurs du club, compétitions récentes ou à venir)
        const report = liveMeetReport(m);
        if (!club || !report || report.startDate < recent) return;
        const pdf = await readMeetPdfs(m, pending, club, CLUB.member);
        if (!pdf) return; // rien de publié : on réessaiera
        candidates.push(...pdf.candidates);
        for (const [id, swims] of pdf.found) found.set(id, [...(found.get(id) ?? []), { meet: report, swims }]);
        if (pdf.complete) processed[m.id] = [...new Set([...(processed[m.id] ?? []), ...pending.map((s) => s.id)])];
        return;
      }
      // Nageurs du club pas encore dans la liste
      if (club)
        for (const a of l.athletes)
          if (a.gender && CLUB.member.test((a.club ?? '').trim()))
            candidates.push({ firstName: a.firstName, lastName: a.lastName.toUpperCase(), birthYear: a.birthYear, gender: a.gender, swimrankingsId: a.swrid });
      // Index des nageurs de la compétition (des centaines) : recherche directe par nom
      const index = new Map<string, LenexAthlete[]>();
      for (const x of l.athletes) for (const k of nameKeys(x)) index.set(k, [...(index.get(k) ?? []), x]);
      for (const sw of pending) {
        // Nom identique, sinon à une lettre près (« VERBRUGGEN » / « VERBRUGEN ») avec même prénom et même année
        const a = (index.get(nameKeys(sw)[0]) ?? []).find((x) => sameSwimmer(x, sw)) ?? l.athletes.find((x) => closeSwimmer(x, sw));
        if (!a) continue;
        const report = toImport(l, a);
        found.set(sw.id, [...(found.get(sw.id) ?? []), { ...report, meet: { ...report.meet, liveId: m.id } }]);
        const patch: Partial<Swimmer> = { ...profile.get(sw.id) };
        if (!sw.birthYear && a.birthYear) patch.birthYear = a.birthYear;
        if (!sw.club && a.club) patch.club = a.club;
        // Fiche swimrankings reliée automatiquement (identifiant présent dans les résultats officiels)
        if (!sw.swimrankingsId && a.swrid) patch.swimrankingsId = a.swrid;
        if (Object.keys(patch).length) profile.set(sw.id, patch);
      }
      if (m.status === 'finished') processed[m.id] = [...new Set([...(processed[m.id] ?? []), ...pending.map((s) => s.id)])];
    },
    () => onProgress?.({ done: ++done, total: todo.length }),
  );

  const added: Swim[] = [];
  // Nouveaux nageurs du club : ajoutés à la liste ; leurs résultats sont cherchés à la recherche suivante
  if (club && candidates.length) result.newMembers = actions.addClubSwimmers(candidates);
  // Un seul enregistrement pour tous les nageurs du club
  batch(() => {
    for (const sw of swimmers) {
      if (profile.has(sw.id)) actions.updateSwimmer(sw.id, profile.get(sw.id)!);
      const reports = found.get(sw.id);
      if (!reports?.length) continue;
      const r = actions.importClubResults(sw.id, reports);
      const done = r.swims.filter((x) => x.timeCs != null || x.status !== 'OK');
      const planned = r.swims.length - done.length;
      if (planned) {
        result.entries += planned;
        result.entrySwimmers.push({ swimmer: sw, added: planned });
      }
      if (done.length) {
        result.added += done.length;
        result.swimmers.push({ swimmer: sw, added: done.length });
        added.push(...done);
      }
    }
    actions.updateLiveSync({ processed, lastCheck: Date.now(), engine: SYNC_ENGINE });
  });
  if (added.length) {
    const flags = computePbFlags(getState().swims, getState().settings.includeTraining);
    result.pbs = added.filter((s) => flags.get(s.id)?.isPB).length;
  }
  return result;
}

export function shouldAutoSyncLive(): boolean {
  const s = getState();
  const cfg = s.settings.liveSync;
  if (!cfg.enabled || !s.swimmers.length) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  // Application mise à jour avec une nouvelle façon de chercher : tout de suite
  if ((cfg.engine ?? 1) < SYNC_ENGINE) return true;
  // Nageur ajouté (ou renommé) depuis la dernière recherche : tout de suite
  const known = new Set(Object.values(cfg.processed).flat());
  if (s.swimmers.some((sw) => !known.has(sw.id))) return true;
  // Pendant un week-end de compétition, on vérifie plus souvent
  const ongoing = s.meets.some((m) => m.startDate <= todayISO() && (m.endDate ?? m.startDate) >= todayISO());
  return Date.now() - (cfg.lastCheck ?? 0) > (ongoing ? 15 * 60 * 1000 : 3 * 3600 * 1000);
}
