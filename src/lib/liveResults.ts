import { CLUB } from '../club';
import { actions, batch, getState } from '../store/store';
import type { Swim, Swimmer } from '../store/types';
import { makeISO, monthFromToken, todayISO } from './dates';
import { parseLenex, unzipFirst, type LenexAthlete, type LenexMeet } from './lenex';
import { computePbFlags } from './stats';
import { nameKeys, normName, sameSwimmer, type ReportMeet } from './results';
import { findSwimmerEntry, findSwimmerResult, lapsToSplits, parseSheetHeader } from './resultSheet';
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
export const SYNC_ENGINE = 2;

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

const lenexCache = new Map<string, Promise<LenexMeet | null>>();

/** Résultats LENEX d'une compétition (null s'ils ne sont pas encore publiés). */
export function fetchLiveResults(id: string, live = false): Promise<LenexMeet | null> {
  const key = `${id}${live ? `@${Math.floor(Date.now() / 300000)}` : ''}`;
  let p = lenexCache.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(`${LIVE_BASE}/${id}/results.lxf`, { cache: live ? 'no-cache' : 'default' });
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const b = new Uint8Array(buf);
      if (b.length < 4 || b[0] !== 0x50 || b[1] !== 0x4b) return null; // pas une archive : pas encore publié
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

async function pdfText(url: string, fresh: boolean): Promise<string> {
  const res = await fetch(url, { cache: fresh ? 'no-cache' : 'default' });
  if (!res.ok) return '';
  const { pdfLines } = await import('./pdfText');
  return (await pdfLines(await res.arrayBuffer())).join('\n');
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
): Promise<{ found: Map<string, PdfSwim[]>; complete: boolean } | null> {
  const fresh = m.status !== 'finished';
  const res = await fetch(`${LIVE_BASE}/${m.id}/`, { cache: fresh ? 'no-cache' : 'default' });
  if (!res.ok) return null;
  const docs = parseMeetDocs(await res.text());
  if (!docs.results.size && !docs.starts.size) return null;
  // Terminé : tous les résultats sont là (ou la compétition date de plus de 3 jours : épreuves annulées, relais…)
  const old = (m.endDate ?? m.startDate ?? '') < new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const complete = m.status === 'finished' && docs.results.size > 0 && (docs.results.size >= docs.starts.size || old);
  const found = new Map<string, PdfSwim[]>();
  // Aucun nageur du club inscrit : rien à lire
  if (club && docs.stats && !club.test(await pdfText(`${LIVE_BASE}/${m.id}/${docs.stats}`, fresh))) return { found, complete: m.status === 'finished' };
  const events = [...new Set([...docs.results.keys(), ...docs.starts.keys()])].sort((a, b) => a - b);
  const course = m.course ?? 'SCM';
  await mapLimit(events, 4, async (no) => {
    const isResult = docs.results.has(no);
    const text = await pdfText(`${LIVE_BASE}/${m.id}/${(isResult ? docs.results : docs.starts).get(no)}`, fresh && !isResult);
    if (!text) return;
    const flat = normName(text);
    const header = parseSheetHeader([text]);
    if (!header.distance || !header.stroke || !isValidEvent(header.distance, header.stroke, course)) return;
    for (const sw of swimmers) {
      if (!flat.includes(normName(sw.lastName)) || (header.gender && header.gender !== sw.gender)) continue;
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
        if (e) swim = { ...base, status: 'OK', entryCs: e.entryCs, heat: e.heat, lane: e.lane };
      }
      if (swim) found.set(sw.id, [...(found.get(sw.id) ?? []), swim]);
    }
  });
  return { found, complete };
}

function liveMeetReport(m: LiveMeet): ReportMeet | null {
  return m.startDate ? { name: m.name, city: m.city, course: m.course ?? 'SCM', startDate: m.startDate, endDate: m.endDate } : null;
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
  const result: LiveSyncResult = { added: 0, entries: 0, entrySwimmers: [], pbs: 0, swimmers: [] };
  const state = getState();
  const cfg = state.settings.liveSync;
  if ((!cfg.enabled && !force) || !state.swimmers.length) return result;

  const today = todayISO();
  const all = await listLiveMeets();
  const meets = all.filter((m) => m.status !== 'upcoming' && (!m.startDate || m.startDate <= today));
  const processed = { ...cfg.processed };
  const swimmers = state.swimmers;
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
  const profile = new Map<string, Partial<Swimmer>>();
  let done = 0;
  onProgress?.({ done, total: todo.length });

  await mapLimit(
    todo,
    3,
    async (m) => {
      const pending = m.status === 'finished' ? swimmers.filter((s) => !processed[m.id]?.includes(s.id)) : swimmers;
      const l = m.status === 'upcoming' ? null : await fetchLiveResults(m.id, m.status === 'live');
      if (!l) {
        // Pas de fichier LENEX : feuilles PDF (nageurs du club, compétitions récentes ou à venir)
        const report = liveMeetReport(m);
        if (!club || !report || report.startDate < recent) return;
        const pdf = await readMeetPdfs(m, pending, club);
        if (!pdf) return; // rien de publié : on réessaiera
        for (const [id, swims] of pdf.found) found.set(id, [...(found.get(id) ?? []), { meet: report, swims }]);
        if (pdf.complete) processed[m.id] = [...new Set([...(processed[m.id] ?? []), ...pending.map((s) => s.id)])];
        return;
      }
      // Index des nageurs de la compétition (des centaines) : recherche directe par nom
      const index = new Map<string, LenexAthlete[]>();
      for (const x of l.athletes) for (const k of nameKeys(x)) index.set(k, [...(index.get(k) ?? []), x]);
      for (const sw of pending) {
        const a = (index.get(nameKeys(sw)[0]) ?? []).find((x) => sameSwimmer(x, sw));
        if (!a) continue;
        found.set(sw.id, [...(found.get(sw.id) ?? []), toImport(l, a)]);
        const patch: Partial<Swimmer> = { ...profile.get(sw.id) };
        if (!sw.birthYear && a.birthYear) patch.birthYear = a.birthYear;
        if (!sw.club && a.club) patch.club = a.club;
        if (Object.keys(patch).length) profile.set(sw.id, patch);
      }
      if (m.status === 'finished') processed[m.id] = [...new Set([...(processed[m.id] ?? []), ...pending.map((s) => s.id)])];
    },
    () => onProgress?.({ done: ++done, total: todo.length }),
  );

  const added: Swim[] = [];
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
