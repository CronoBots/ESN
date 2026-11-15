import { CLUB } from '../club';
import { actions, batch, getState } from '../store/store';
import type { Swim, Swimmer } from '../store/types';
import { makeISO, monthFromToken, todayISO } from './dates';
import { parseLenex, unzipFirst, type LenexAthlete, type LenexMeet } from './lenex';
import { computePbFlags } from './stats';
import { nameKeys, sameSwimmer } from './results';

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
    const city = strip(cell('tdCity')).replace(/\s*\b[A-Z]{3}$/, '').replace(/^[^\p{L}\d]+/u, '').trim();
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
  added: number;
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
  const result: LiveSyncResult = { added: 0, pbs: 0, swimmers: [] };
  const state = getState();
  const cfg = state.settings.liveSync;
  if ((!cfg.enabled && !force) || !state.swimmers.length) return result;

  const today = todayISO();
  const meets = (await listLiveMeets()).filter((m) => m.status !== 'upcoming' && (!m.startDate || m.startDate <= today));
  const processed = { ...cfg.processed };
  const swimmers = state.swimmers;
  const todo = meets.filter((m) => m.status === 'live' || swimmers.some((s) => !processed[m.id]?.includes(s.id)));
  const found = new Map<string, ReturnType<typeof toImport>[]>();
  const profile = new Map<string, Partial<Swimmer>>();
  let done = 0;
  onProgress?.({ done, total: todo.length });

  await mapLimit(
    todo,
    3,
    async (m) => {
      const l = await fetchLiveResults(m.id, m.status === 'live');
      if (!l) return; // pas encore publié : on réessaiera
      const pending = m.status === 'live' ? swimmers : swimmers.filter((s) => !processed[m.id]?.includes(s.id));
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
      if (r.added) {
        result.added += r.added;
        result.swimmers.push({ swimmer: sw, added: r.added });
        added.push(...r.swims);
      }
    }
    actions.updateLiveSync({ processed, lastCheck: Date.now() });
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
  // Nageur ajouté (ou renommé) depuis la dernière recherche : tout de suite
  const known = new Set(Object.values(cfg.processed).flat());
  if (s.swimmers.some((sw) => !known.has(sw.id))) return true;
  // Pendant un week-end de compétition, on vérifie plus souvent
  const ongoing = s.meets.some((m) => m.startDate <= todayISO() && (m.endDate ?? m.startDate) >= todayISO());
  return Date.now() - (cfg.lastCheck ?? 0) > (ongoing ? 15 * 60 * 1000 : 3 * 3600 * 1000);
}
