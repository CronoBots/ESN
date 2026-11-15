import { CLUB } from '../club';
import { actions, getState } from '../store/store';
import type { Swim, Swimmer } from '../store/types';
import { normName, parseClubReport, type ClubReport, type ReportSwimmer } from './clubReport';
import { computePbFlags } from './stats';

/**
 * Résultats publiés par le club : le catalogue (liste des rapports PDF) est
 * généré chaque jour sur le serveur du site ; les PDF eux-mêmes sont
 * téléchargés depuis le site du club et lus sur l'appareil du parent.
 * Aucune donnée de nageur ne transite par Nageo.
 */

export interface IndexReport {
  url: string;
  name: string;
  city?: string;
  organizer?: string;
  course: 'SCM' | 'LCM';
  start: string;
  end?: string;
}

export interface ClubIndex {
  club: string;
  updatedAt: string;
  reports: IndexReport[];
}

export interface Progress {
  done: number;
  total: number;
}

const reportCache = new Map<string, Promise<ClubReport | null>>();

export async function loadIndex(): Promise<ClubIndex> {
  const res = await fetch(CLUB.indexUrl, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Catalogue indisponible (${res.status})`);
  const idx = (await res.json()) as ClubIndex;
  idx.reports.sort((a, b) => (a.start < b.start ? -1 : 1));
  return idx;
}

export function fetchReport(entry: IndexReport): Promise<ClubReport | null> {
  let p = reportCache.get(entry.url);
  if (!p) {
    p = (async () => {
      const res = await fetch(entry.url);
      if (!res.ok) throw new Error(`PDF indisponible (${res.status})`);
      const { pdfLines } = await import('./pdfText');
      const lines = await pdfLines(await res.arrayBuffer());
      return parseClubReport(lines);
    })();
    p.catch(() => reportCache.delete(entry.url));
    reportCache.set(entry.url, p);
  }
  return p;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>, onDone?: () => void): Promise<(R | Error)[]> {
  const out: (R | Error)[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch (e) {
        out[i] = e instanceof Error ? e : new Error(String(e));
      }
      onDone?.();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function sameSwimmer(rs: Pick<ReportSwimmer, 'firstName' | 'lastName' | 'birthYear'>, sw: Pick<Swimmer, 'firstName' | 'lastName' | 'birthYear'>): boolean {
  const a = `${normName(rs.lastName)}|${normName(rs.firstName)}`;
  const b = `${normName(sw.lastName)}|${normName(sw.firstName)}`;
  const swapped = `${normName(sw.firstName)}|${normName(sw.lastName)}`;
  if (a !== b && a !== swapped) return false;
  if (sw.birthYear && rs.birthYear && sw.birthYear !== rs.birthYear) return false;
  return true;
}

/** Nageur susceptible d'apparaître dans les résultats du club (club vide ou identique). */
export function isClubSwimmer(sw: Pick<Swimmer, 'club'>): boolean {
  if (!sw.club?.trim()) return true;
  const c = normName(sw.club);
  return [CLUB.name, CLUB.short, CLUB.licenseCode, 'Seraing'].some((x) => c.includes(normName(x)));
}

/* ------------------------------------------------------------------------ */
/* Recherche d'un nageur dans tous les rapports du club                       */
/* ------------------------------------------------------------------------ */

export interface ClubMatch {
  license: string;
  firstName: string;
  lastName: string;
  birthYear?: number;
  reports: { meet: ClubReport['meet']; swims: ReportSwimmer['swims'] }[];
  swimCount: number;
  lastMeet?: string;
}

export async function searchClub(query: { firstName: string; lastName: string }, onProgress?: (p: Progress) => void): Promise<ClubMatch[]> {
  const idx = await loadIndex();
  const qLast = normName(query.lastName);
  const qFirst = normName(query.firstName);
  let done = 0;
  onProgress?.({ done, total: idx.reports.length });
  const reports = await mapLimit(idx.reports, 4, fetchReport, () => onProgress?.({ done: ++done, total: idx.reports.length }));
  const byLicense = new Map<string, ClubMatch>();
  for (const r of reports) {
    if (!r || r instanceof Error) continue;
    for (const s of r.swimmers) {
      const last = normName(s.lastName);
      const first = normName(s.firstName);
      const direct = (!qLast || last.startsWith(qLast)) && (!qFirst || first.startsWith(qFirst));
      const swapped = qLast && qFirst && first.startsWith(qLast) && last.startsWith(qFirst);
      if (!direct && !swapped) continue;
      const m = byLicense.get(s.license) ?? {
        license: s.license,
        firstName: s.firstName,
        lastName: s.lastName,
        birthYear: s.birthYear,
        reports: [],
        swimCount: 0,
      };
      m.reports.push({ meet: r.meet, swims: s.swims });
      m.swimCount += s.swims.length;
      if (!m.lastMeet || r.meet.startDate > m.lastMeet) m.lastMeet = r.meet.startDate;
      byLicense.set(s.license, m);
    }
  }
  return [...byLicense.values()].sort((a, b) => b.swimCount - a.swimCount).slice(0, 12);
}

/* ------------------------------------------------------------------------ */
/* Synchronisation automatique                                               */
/* ------------------------------------------------------------------------ */

export interface SyncResult {
  added: number;
  pbs: number;
  swimmers: { swimmer: Swimmer; added: number }[];
  errors: number;
}

let running: Promise<SyncResult> | null = null;

export function syncClub(opts: { force?: boolean; onProgress?: (p: Progress) => void } = {}): Promise<SyncResult> {
  if (!running) {
    running = doSync(opts).finally(() => {
      running = null;
    });
  }
  return running;
}

async function doSync({ force, onProgress }: { force?: boolean; onProgress?: (p: Progress) => void }): Promise<SyncResult> {
  const result: SyncResult = { added: 0, pbs: 0, swimmers: [], errors: 0 };
  const state = getState();
  if (!state.settings.clubSync.enabled && !force) return result;
  const swimmers = state.swimmers.filter(isClubSwimmer);
  if (!swimmers.length) return result;

  const idx = await loadIndex();
  const processed = { ...state.settings.clubSync.processed };
  const todo = idx.reports.filter((r) => swimmers.some((s) => !processed[r.url]?.includes(s.id)));
  let done = 0;
  onProgress?.({ done, total: todo.length });

  const found = new Map<string, { meet: ClubReport['meet']; swims: ReportSwimmer['swims'] }[]>();
  const profile = new Map<string, Partial<Swimmer>>();
  await mapLimit(
    todo,
    4,
    async (entry) => {
      const report = await fetchReport(entry).catch(() => {
        result.errors++;
        return undefined;
      });
      if (report === undefined) return;
      const pending = swimmers.filter((s) => !processed[entry.url]?.includes(s.id));
      for (const sw of pending) {
        const match = report?.swimmers.find((rs) => sameSwimmer(rs, sw));
        if (match && report) {
          found.set(sw.id, [...(found.get(sw.id) ?? []), { meet: report.meet, swims: match.swims }]);
          if (!sw.birthYear && match.birthYear) profile.set(sw.id, { ...profile.get(sw.id), birthYear: match.birthYear });
          if (!sw.club) profile.set(sw.id, { ...profile.get(sw.id), club: CLUB.name });
        }
      }
      processed[entry.url] = [...new Set([...(processed[entry.url] ?? []), ...pending.map((s) => s.id)])];
    },
    () => onProgress?.({ done: ++done, total: todo.length }),
  );

  const added: Swim[] = [];
  for (const sw of swimmers) {
    const reports = found.get(sw.id);
    if (profile.has(sw.id)) actions.updateSwimmer(sw.id, profile.get(sw.id)!);
    if (!reports?.length) continue;
    const r = actions.importClubResults(sw.id, reports);
    if (r.added) {
      result.swimmers.push({ swimmer: sw, added: r.added });
      result.added += r.added;
      added.push(...r.swims);
    }
  }
  actions.updateClubSync({ processed, lastCheck: Date.now() });

  if (added.length) {
    const flags = computePbFlags(getState().swims, getState().settings.includeTraining);
    // Records battus lors des 60 derniers jours parmi les nouveaux résultats
    const recent = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    result.pbs = added.filter((s) => flags.get(s.id)?.isPB && s.date >= recent).length;
  }
  return result;
}

/** Faut-il lancer une synchronisation en arrière-plan ? */
export function shouldAutoSync(): boolean {
  const s = getState();
  const swimmers = s.swimmers.filter(isClubSwimmer);
  if (!s.settings.clubSync.enabled || !swimmers.length) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const last = s.settings.clubSync.lastCheck ?? 0;
  const anyNew = swimmers.some((sw) => !Object.values(s.settings.clubSync.processed).some((ids) => ids.includes(sw.id)));
  return anyNew || Date.now() - last > 6 * 3600 * 1000;
}
