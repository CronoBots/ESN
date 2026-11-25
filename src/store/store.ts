import { useSyncExternalStore } from 'react';
import type { AppData, EntryRecords, Goal, LiveSyncSettings, Meet, NationalRank, Settings, Swim, Swimmer } from './types';
import { closeSwimmer, sameSwimmer, swimmerNames, type ReportMeet, type ReportSwim } from '../lib/results';
import type { Roster } from '../lib/roster';
import { CLUB } from '../club';
import { historyNote, type ParsedAthlete, type ParsedSwim } from '../lib/swimrankings';
import { uid } from '../lib/id';
import { idbGet, idbPut, openDb } from './idb';

/** Ancien emplacement (localStorage) : lu une fois pour la reprise, puis effacé. Sert aussi de repli. */
const STORAGE_KEY = 'nageo:data:v1';
/** Clé des données dans IndexedDB. */
const DATA_KEY = 'data';

/**
 * Version de la lecture de la liste du club. 2 : anciens membres. 3 : autres noms d'un
 * nageur (fiches en double réunies). 4 : autres noms gardés sur la fiche (historique et classements
 * rattachés sous l'un ou l'autre nom). Une liste appliquée par une version précédente est
 * relue une fois, même inchangée.
 */
export const ROSTER_PARSER = 4;

const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  includeTraining: false,
  defaultCourse: 'SCM',
  onboarded: false,
  celebrate: true,
  liveSync: { enabled: true, processed: {} },
};

function emptyData(): AppData {
  return { version: 1, swimmers: [], meets: [], swims: [], goals: [], settings: { ...DEFAULT_SETTINGS } };
}

/** Nageur de l'ancien exemple de démonstration (anciennes versions de l'application). */
const DEMO_CLUB = 'Club de démonstration';

/** Valide et complète des données (sauvegarde ou stockage local). */
export function normalizeData(raw: unknown): AppData {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppData>;
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  let swimmers = arr<Swimmer>(d.swimmers).filter((s) => s && s.id);
  let meets = arr<Meet>(d.meets).filter((m) => m && m.id);
  let swims = arr<Swim>(d.swims)
    .filter((s) => s && s.id && s.swimmerId)
    // Disqualification ou forfait gardé avec un temps 0 (fichier LENEX lu par une ancienne version) : sans temps
    .map((s) => (s.status !== 'OK' && s.timeCs === 0 ? { ...s, timeCs: null } : s));
  let goals = arr<Goal>(d.goals).filter((g) => g && g.id);
  let selectedSwimmerId = d.settings?.selectedSwimmerId;
  // Exemple de démonstration gardé par un navigateur depuis une ancienne version : retiré
  // (nageurs, leurs courses et objectifs, et les compétitions qui n'appartenaient qu'à l'exemple)
  const demo = new Set(swimmers.filter((s) => s.club === DEMO_CLUB).map((s) => s.id));
  if (demo.size) {
    const demoMeets = new Set(swims.filter((x) => demo.has(x.swimmerId) && x.meetId).map((x) => x.meetId!));
    swims = swims.filter((x) => !demo.has(x.swimmerId));
    const used = new Set(swims.map((x) => x.meetId));
    meets = meets.filter((m) => !demoMeets.has(m.id) || used.has(m.id));
    goals = goals.filter((g) => !demo.has(g.swimmerId));
    swimmers = swimmers.filter((s) => !demo.has(s.id));
    if (selectedSwimmerId && demo.has(selectedSwimmerId)) selectedSwimmerId = undefined;
  }
  return {
    version: 1,
    swimmers,
    meets,
    swims,
    goals,
    rankings: arr<NationalRank>(d.rankings).filter((r) => r && r.swimmerId && !demo.has(r.swimmerId)),
    settings: {
      ...DEFAULT_SETTINGS,
      ...(d.settings ?? {}),
      selectedSwimmerId,
      // Tout est automatique : la recherche des résultats ne peut plus être coupée, plus de temps d'entraînement saisis
      includeTraining: false,
      liveSync: { ...DEFAULT_SETTINGS.liveSync, ...(d.settings?.liveSync ?? {}), enabled: true },
    },
  };
}

function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeData(JSON.parse(raw));
  } catch {
    /* stockage indisponible : on démarre à vide */
  }
  return emptyData();
}

let state: AppData = load();
const listeners = new Set<() => void>();
let saveError: string | null = null;
let batching = 0;
let dirty = false;

/**
 * Où les données sont enregistrées : IndexedDB dès que la base est ouverte
 * (initStore), sinon localStorage (navigateur sans IndexedDB, tests).
 */
let backend: 'local' | 'idb' = 'local';
let db: IDBDatabase | null = null;
let writing = false;
let rewrite = false;

/** Autres onglets ouverts : prévenus après chaque enregistrement pour relire les données. */
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('esn-data') : null;

function notify() {
  listeners.forEach((l) => l());
}

let lastWrite: Promise<void> = Promise.resolve();
/** Base rouverte après un échec d'écriture : l'écriture suivante est le seul nouvel essai. */
let retrying = false;
let reopening = false;

/**
 * Écriture refusée : connexion à la base perdue (iPhone après un long passage en arrière-plan),
 * qui ferait échouer toutes les écritures suivantes. La base est rouverte et l'écriture refaite
 * une fois ; si elle échoue encore, la modification suivante réessaie.
 */
function reopenDb() {
  if (reopening) return;
  reopening = true;
  void openDb().then((d) => {
    reopening = false;
    if (!d) return;
    try {
      db?.close();
    } catch {
      /* déjà fermée */
    }
    db = d;
    retrying = true;
    writeIdb();
  });
}

/** Une écriture à la fois ; si l'état change pendant ce temps, on réécrit la dernière version ensuite. */
function writeIdb() {
  if (writing) {
    rewrite = true;
    return;
  }
  writing = true;
  lastWrite = idbPut(db!, DATA_KEY, state)
    .then(() => {
      saveError = null;
      retrying = false;
      channel?.postMessage('saved');
    })
    .catch((e) => {
      saveError = e instanceof Error ? e.message : String(e);
      if (retrying) retrying = false;
      else reopenDb();
    })
    .finally(() => {
      writing = false;
      if (rewrite) {
        rewrite = false;
        writeIdb();
      }
    });
}

/**
 * IndexedDB : l'écriture copie toutes les données (plusieurs Mo avec le club). Elle part une fois
 * les modifications terminées (WRITE_DELAY sans nouvelle modification) : plusieurs gestes
 * rapprochés (cœurs touchés à la suite, changement de nageur) n'en font qu'une, et l'écran reste
 * fluide. Application fermée ou mise en arrière-plan : écriture immédiate.
 */
const WRITE_DELAY = 400;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function flushWrite() {
  if (!writeTimer) return;
  clearTimeout(writeTimer);
  writeTimer = null;
  writeIdb();
}

/** Enregistre tout de suite ce qui attend encore (tests, avant une opération qui relit la base). */
export async function flushStore(): Promise<void> {
  flushWrite();
  await lastWrite;
  while (writing) await lastWrite;
}

if (typeof window !== 'undefined') {
  // Application fermée ou mise en arrière-plan : on n'attend pas
  window.addEventListener('pagehide', flushWrite);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushWrite());
}

function persist() {
  if (backend === 'idb' && db) {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(flushWrite, WRITE_DELAY);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    saveError = null;
  } catch (e) {
    saveError = e instanceof Error ? e.message : String(e);
  }
}

/**
 * Ouvre IndexedDB et y charge les données, avant le premier affichage.
 * Reprise : des données encore dans localStorage (ancienne version de
 * l'application) passent dans IndexedDB si la base est vide, puis l'ancienne
 * copie est effacée. Une copie écrite pendant une session où IndexedDB était
 * lente ou indisponible part d'un état vide (localStorage effacé à la reprise) :
 * elle ne remplace jamais les données déjà dans la base.
 * Si la base tarde (certains iPhone au premier lancement), l'application
 * démarre quand même et la charge dès qu'elle répond.
 */
export async function initStore(timeoutMs = 5000): Promise<void> {
  const opening = openDb();
  const first = await Promise.race([opening, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), timeoutMs))]);
  if (first === 'timeout') {
    void opening.then((d) => d && attach(d));
    return;
  }
  if (first) await attach(first);
}

async function attach(d: IDBDatabase) {
  try {
    let local = false;
    try {
      local = localStorage.getItem(STORAGE_KEY) != null;
    } catch {
      /* localStorage inaccessible */
    }
    const stored = await idbGet<unknown>(d, DATA_KEY);
    let copied: AppData | null = null;
    if (stored) state = normalizeData(stored);
    else if (local) {
      copied = state;
      await idbPut(d, DATA_KEY, copied);
    }
    db = d;
    backend = 'idb';
    if (local) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* sans effet : la copie IndexedDB fait foi */
      }
    }
    // Modifié pendant la reprise : enregistré aussi (la copie locale vient d'être effacée)
    if (copied && state !== copied) persist();
    notify();
    // Demande au navigateur de ne pas effacer ces données en cas de manque de place
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    /* IndexedDB inutilisable : on reste sur localStorage */
  }
}

function setState(updater: (s: AppData) => AppData) {
  state = updater(state);
  if (batching) {
    dirty = true;
    return;
  }
  persist();
  listeners.forEach((l) => l());
}

/** Regroupe plusieurs modifications en un seul enregistrement (nombreux nageurs du club). */
export function batch<T>(fn: () => T): T {
  batching++;
  try {
    return fn();
  } finally {
    if (--batching === 0 && dirty) {
      dirty = false;
      persist();
      listeners.forEach((l) => l());
    }
  }
}

export function getState(): AppData {
  return state;
}

export function getSaveError(): string | null {
  return saveError;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// Synchronisation entre onglets
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (backend === 'local' && e.key === STORAGE_KEY) {
      state = load();
      notify();
    }
  });
  channel?.addEventListener('message', () => {
    // Modification de cet onglet pas encore enregistrée : gardée. Son écriture remplacera les données
    // de l'autre onglet, qui les relira à son tour (« saved »)
    if (!db || writeTimer || writing) return;
    idbGet<unknown>(db, DATA_KEY)
      .then((stored) => {
        if (!stored || writeTimer || writing) return;
        state = normalizeData(stored);
        notify();
      })
      .catch(() => {});
  });
}

export function useStore<T>(selector: (s: AppData) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

export function useData(): AppData {
  return useSyncExternalStore(subscribe, () => state);
}

/** Résultats d'une compétition à importer (LENEX, photo des feuilles…). */
export interface ImportReport {
  meet: ReportMeet;
  source?: Swim['source'];
  /** Compétition existante choisie par l'utilisateur. */
  meetId?: string;
  swims: (ReportSwim & { date?: string; startTime?: string; points?: number; heat?: number; lane?: number; notes?: string; records?: EntryRecords })[];
}

/* ------------------------------------------------------------------------ */
/* Outils d'import                                                           */
/* ------------------------------------------------------------------------ */

const normMeet = (t?: string) =>
  (t ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const dayMs = 86400000;

/** Retrouve une compétition existante (même nom, dates proches, même bassin). */
function findMeet(meets: Meet[], name: string, date: string, course: Meet['course'], city?: string): Meet | undefined {
  const n = normMeet(name);
  const c = normMeet(city);
  const sameName = (m: Meet) => {
    const mn = normMeet(m.name);
    return mn && n && (mn.startsWith(n) || n.startsWith(mn));
  };
  const t = new Date(date).getTime();
  return (
    meets.find((m) => sameName(m) && m.course === course && date >= m.startDate && date <= (m.endDate ?? m.startDate)) ??
    meets.find((m) => sameName(m) && m.course === course && Math.abs(t - new Date(m.startDate).getTime()) <= 4 * dayMs) ??
    // Nom écrit autrement (invitation du club organisateur, livetiming, swimrankings) : même ville, même bassin, pendant la compétition
    (c ? meets.find((m) => normMeet(m.city) === c && m.course === course && date >= m.startDate && date <= (m.endDate ?? m.startDate)) : undefined)
  );
}

/** Vrai si une course identique (même épreuve, même temps, dates proches) existe déjà. */
function isDuplicate(existing: Swim[], s: Pick<Swim, 'course' | 'distance' | 'stroke' | 'timeCs' | 'date' | 'status' | 'meetId' | 'eventNo'>): boolean {
  return !!findDuplicate(existing, s);
}

/** Même course déjà enregistrée (même épreuve, même temps, à quelques jours près). */
function findDuplicate(existing: Swim[], s: Pick<Swim, 'course' | 'distance' | 'stroke' | 'timeCs' | 'date' | 'status' | 'meetId' | 'eventNo'>): Swim | undefined {
  const t = new Date(s.date).getTime();
  return existing.find(
    (x) =>
      x.course === s.course &&
      x.distance === s.distance &&
      x.stroke === s.stroke &&
      // Séries et finale d'une même épreuve (numéros d'épreuve différents) : deux courses, même au même temps
      (x.eventNo == null || s.eventNo == null || x.eventNo === s.eventNo) &&
      (s.timeCs != null
        ? x.timeCs === s.timeCs ||
          // Disqualification déjà enregistrée sans temps (feuille PDF) : le fichier LENEX la complète
          (s.status !== 'OK' && x.status === s.status && x.timeCs == null && x.meetId === s.meetId)
        : x.status === s.status && x.meetId === s.meetId) &&
      Math.abs(new Date(x.date).getTime() - t) <= 4 * dayMs,
  );
}

/* ------------------------------------------------------------------------ */
/* Actions                                                                   */
/* ------------------------------------------------------------------------ */

export const actions = {
  updateSettings(patch: Partial<Settings>) {
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  },

  selectSwimmer(id: string) {
    actions.updateSettings({ selectedSwimmerId: id });
  },

  addSwimmer(data: Omit<Swimmer, 'id' | 'createdAt' | 'color' | 'favorite'> & Partial<Pick<Swimmer, 'color' | 'favorite'>>): Swimmer {
    const swimmer: Swimmer = {
      ...data,
      id: uid(),
      createdAt: Date.now(),
      color: data.color ?? state.swimmers.length % 8,
      favorite: data.favorite ?? data.relation === 'child',
    };
    setState((s) => ({
      ...s,
      swimmers: [...s.swimmers, swimmer],
      settings: { ...s.settings, selectedSwimmerId: s.settings.selectedSwimmerId ?? swimmer.id, onboarded: true },
    }));
    return swimmer;
  },

  updateSwimmer(id: string, patch: Partial<Swimmer>) {
    setState((s) => {
      const before = s.swimmers.find((x) => x.id === id);
      const renamed =
        before &&
        ((patch.firstName != null && patch.firstName !== before.firstName) ||
          (patch.lastName != null && patch.lastName !== before.lastName) ||
          (patch.birthYear !== undefined && patch.birthYear !== before.birthYear && before.birthYear != null));
      // Nom ou année modifiés : ses résultats seront recherchés à nouveau
      const processed = renamed
        ? Object.fromEntries(Object.entries(s.settings.liveSync.processed).map(([u, ids]) => [u, ids.filter((x) => x !== id)]))
        : s.settings.liveSync.processed;
      return {
        ...s,
        swimmers: s.swimmers.map((x) => (x.id === id ? { ...x, ...patch, id } : x)),
        settings: { ...s.settings, liveSync: { ...s.settings.liveSync, processed } },
      };
    });
  },

  deleteSwimmer(id: string) {
    setState((s) => {
      const swimmers = s.swimmers.filter((x) => x.id !== id);
      return {
        ...s,
        swimmers,
        swims: s.swims.filter((x) => x.swimmerId !== id),
        goals: s.goals.filter((g) => g.swimmerId !== id),
        settings: {
          ...s.settings,
          selectedSwimmerId: s.settings.selectedSwimmerId === id ? swimmers[0]?.id : s.settings.selectedSwimmerId,
        },
      };
    });
  },

  addMeet(data: Omit<Meet, 'id' | 'createdAt'>): Meet {
    const meet: Meet = { ...data, id: uid(), createdAt: Date.now() };
    setState((s) => ({ ...s, meets: [...s.meets, meet] }));
    return meet;
  },

  updateMeet(id: string, patch: Partial<Meet>) {
    setState((s) => {
      const meets = s.meets.map((m) => (m.id === id ? { ...m, ...patch, id } : m));
      // Le bassin de la compétition s'applique à ses courses
      const swims = patch.course
        ? s.swims.map((x) => (x.meetId === id ? { ...x, course: patch.course! } : x))
        : s.swims;
      return { ...s, meets, swims };
    });
  },

  deleteMeet(id: string, withSwims: boolean) {
    setState((s) => ({
      ...s,
      meets: s.meets.filter((m) => m.id !== id),
      swims: withSwims ? s.swims.filter((x) => x.meetId !== id) : s.swims.map((x) => (x.meetId === id ? { ...x, meetId: undefined } : x)),
    }));
  },

  addSwim(data: Omit<Swim, 'id' | 'createdAt' | 'updatedAt'>): Swim {
    const now = Date.now();
    const swim: Swim = { ...data, id: uid(), createdAt: now, updatedAt: now };
    setState((s) => ({ ...s, swims: [...s.swims, swim] }));
    return swim;
  },

  updateSwim(id: string, patch: Partial<Swim>) {
    setState((s) => ({
      ...s,
      swims: s.swims.map((x) => (x.id === id ? { ...x, ...patch, id, updatedAt: Date.now() } : x)),
    }));
  },

  deleteSwim(id: string) {
    setState((s) => ({ ...s, swims: s.swims.filter((x) => x.id !== id) }));
  },

  addGoal(data: Omit<Goal, 'id' | 'createdAt'>): Goal {
    const goal: Goal = { ...data, id: uid(), createdAt: Date.now() };
    setState((s) => ({ ...s, goals: [...s.goals, goal] }));
    return goal;
  },

  updateGoal(id: string, patch: Partial<Goal>) {
    setState((s) => ({ ...s, goals: s.goals.map((g) => (g.id === id ? { ...g, ...patch, id } : g)) }));
  },

  deleteGoal(id: string) {
    setState((s) => ({ ...s, goals: s.goals.filter((g) => g.id !== id) }));
  },

  /** Remplace toutes les données (restauration d'une sauvegarde). */
  replaceAll(data: AppData) {
    setState(() => normalizeData(data));
  },

  /** Fusionne une sauvegarde : ajoute ce qui n'existe pas encore (par identifiant). */
  mergeAll(data: AppData) {
    const d = normalizeData(data);
    setState((s) => {
      const merge = <T extends { id: string }>(a: T[], b: T[]) => {
        const ids = new Set(a.map((x) => x.id));
        return [...a, ...b.filter((x) => !ids.has(x.id))];
      };
      return {
        ...s,
        swimmers: merge(s.swimmers, d.swimmers),
        meets: merge(s.meets, d.meets),
        swims: merge(s.swims, d.swims),
        goals: merge(s.goals, d.goals),
        settings: { ...s.settings, onboarded: true, selectedSwimmerId: s.settings.selectedSwimmerId ?? d.swimmers[0]?.id },
      };
    });
  },

  resetAll() {
    setState(() => emptyData());
  },

  /**
   * Liste des membres du club (lecture version ROSTER_PARSER) : ajoute les nouveaux nageurs (suivis, avec leur
   * groupe), met à jour les groupes, et retire les anciens membres sans
   * résultat (ceux qui ont des résultats restent, sans groupe). Une fiche à l'un des
   * autres noms d'un membre (doublon) est réunie avec la sienne.
   */
  applyRoster(roster: Roster, code: string, version: string): { added: number; total: number } {
    let added = 0;
    setState((s) => {
      const now = Date.now();
      const swimmers = [...s.swimmers];
      const kept = new Set<string>();
      /** Fiche en double → fiche gardée. */
      const merged = new Map<string, string>();
      const mergeAliases = (m: Roster['members'][number], mainId: string) => {
        for (const a of m.aliases ?? [])
          for (const sw of swimmers) if (sw.id !== mainId && !kept.has(sw.id) && !merged.has(sw.id) && sameSwimmer(a, sw)) merged.set(sw.id, mainId);
      };
      const free = (sw: Swimmer) => !kept.has(sw.id) && !merged.has(sw.id);
      for (const m of roster.members) {
        let i = swimmers.findIndex((sw) => free(sw) && sameSwimmer(m, sw));
        // Seulement une fiche à un autre nom : c'est elle qui prend le nom de la liste
        const byAlias = i < 0 && m.aliases ? swimmers.findIndex((sw) => free(sw) && m.aliases!.some((a) => sameSwimmer(a, sw))) : -1;
        if (i < 0) i = byAlias;
        if (i >= 0) {
          const sw = swimmers[i];
          // Nom et prénom écrits comme dans la liste du club (même orthographe pour tous)
          swimmers[i] = {
            ...sw,
            firstName: m.firstName,
            lastName: m.lastName,
            group: m.group,
            member: true,
            former: m.former || undefined,
            aliases: m.aliases?.length ? m.aliases : undefined,
            birthYear: byAlias >= 0 ? (m.birthYear ?? sw.birthYear) : (sw.birthYear ?? m.birthYear),
            club: sw.club || roster.club,
          };
          kept.add(sw.id);
          mergeAliases(m, sw.id);
        } else {
          const sw: Swimmer = {
            id: uid(),
            firstName: m.firstName,
            lastName: m.lastName,
            gender: m.gender,
            birthYear: m.birthYear,
            club: roster.club,
            nation: 'BEL',
            color: swimmers.length % 8,
            relation: 'followed',
            favorite: false,
            group: m.group,
            member: true,
            former: m.former || undefined,
            ...(m.aliases?.length ? { aliases: m.aliases } : {}),
            createdAt: now,
          };
          swimmers.push(sw);
          kept.add(sw.id);
          mergeAliases(m, sw.id);
          added++;
        }
      }
      for (const id of kept) merged.delete(id);
      // Fiches en double : courses (sans répéter une course déjà là), objectifs et suivi passent sur la fiche gardée
      let swims = s.swims;
      let goals = s.goals;
      let selectedSwimmerId = s.settings.selectedSwimmerId;
      if (merged.size) {
        const key = (x: Swim) => `${x.swimmerId}|${x.distance}|${x.stroke}|${x.course}|${x.timeCs}|${x.date}`;
        const have = new Set(s.swims.filter((x) => !merged.has(x.swimmerId)).map(key));
        swims = [];
        for (const x of s.swims) {
          const to = merged.get(x.swimmerId);
          if (!to) {
            swims.push(x);
            continue;
          }
          const moved = { ...x, swimmerId: to };
          if (have.has(key(moved))) continue;
          have.add(key(moved));
          swims.push(moved);
        }
        goals = s.goals.map((g) => (merged.has(g.swimmerId) ? { ...g, swimmerId: merged.get(g.swimmerId)! } : g));
        for (const [dupId, mainId] of merged) {
          const dup = swimmers.find((sw) => sw.id === dupId)!;
          const j = swimmers.findIndex((sw) => sw.id === mainId);
          swimmers[j] = {
            ...swimmers[j],
            favorite: swimmers[j].favorite || dup.favorite,
            relation: dup.relation === 'child' ? 'child' : swimmers[j].relation,
          };
        }
        if (selectedSwimmerId && merged.has(selectedSwimmerId)) selectedSwimmerId = merged.get(selectedSwimmerId);
      }
      const used = new Set([...swims.map((x) => x.swimmerId), ...goals.map((g) => g.swimmerId)]);
      const next = swimmers
        .filter((sw) => !merged.has(sw.id))
        .filter((sw) => !sw.member || kept.has(sw.id) || sw.discovered || used.has(sw.id) || sw.relation === 'child' || sw.favorite)
        .map((sw) =>
          kept.has(sw.id) && sw.discovered
            ? { ...sw, discovered: false }
            : sw.member && !kept.has(sw.id) && !sw.discovered
              ? { ...sw, member: false, group: undefined }
              : sw,
        );
      return {
        ...s,
        swimmers: next,
        swims,
        goals,
        settings: {
          ...s.settings,
          selectedSwimmerId,
          onboarded: true,
          club: { code, version, updated: roster.updated, groups: roster.groups, count: roster.members.length, rosterParser: ROSTER_PARSER },
        },
      };
    });
    return { added, total: roster.members.length };
  },

  /**
   * Nageurs suivis (favoris), choisis dans la liste du club : ce sont eux qui
   * s'affichent sur l'accueil et dans les sélecteurs.
   */
  setFollowed(ids: string[]) {
    setState((s) => ({
      ...s,
      swimmers: s.swimmers.map((sw) =>
        ids.includes(sw.id) ? { ...sw, favorite: true } : sw.favorite || sw.relation === 'child' ? { ...sw, favorite: false, relation: 'followed' } : sw,
      ),
      settings: {
        ...s.settings,
        onboarded: true,
        selectedSwimmerId: ids.includes(s.settings.selectedSwimmerId ?? '') ? s.settings.selectedSwimmerId : ids[0] ?? s.settings.selectedSwimmerId,
      },
    }));
  },

  /** Suivre ou ne plus suivre un nageur (cœur). */
  follow(id: string, on: boolean) {
    setState((s) => {
      const swimmers = s.swimmers.map((sw) => (sw.id === id ? { ...sw, favorite: on, relation: on ? sw.relation : ('followed' as const) } : sw));
      const followed = swimmers.filter((sw) => sw.favorite || sw.relation === 'child');
      const sel = s.settings.selectedSwimmerId;
      const selectedSwimmerId = followed.some((sw) => sw.id === sel) ? sel : (followed[0]?.id ?? sel);
      return { ...s, swimmers, settings: { ...s.settings, selectedSwimmerId } };
    });
  },

  /**
   * Nageurs du club trouvés dans une compétition (résultats officiels, listes
   * de départ) qui ne sont pas encore dans la liste : ajoutés à la liste du club.
   */
  addClubSwimmers(list: { firstName: string; lastName: string; birthYear?: number; gender: Swimmer['gender']; swimrankingsId?: string }[]): Swimmer[] {
    const added: Swimmer[] = [];
    setState((s) => {
      const swimmers = [...s.swimmers];
      for (const c of list) {
        // Déjà dans la liste, éventuellement écrit autrement sur la feuille (une lettre près, ou l'un de ses autres noms)
        if (swimmers.some((sw) => swimmerNames(sw).some((n) => closeSwimmer(c, n)))) continue;
        const sw: Swimmer = {
          id: uid(),
          firstName: c.firstName,
          lastName: c.lastName,
          gender: c.gender,
          birthYear: c.birthYear,
          swimrankingsId: c.swimrankingsId,
          club: CLUB.name,
          nation: 'BEL',
          color: swimmers.length % 8,
          relation: 'followed',
          favorite: false,
          member: true,
          discovered: true,
          createdAt: Date.now(),
        };
        swimmers.push(sw);
        added.push(sw);
      }
      return added.length ? { ...s, swimmers } : s;
    });
    return added;
  },

  /** Oublie le code du club (les nageurs et leurs résultats restent). */
  forgetClub() {
    setState((s) => ({ ...s, settings: { ...s.settings, club: undefined } }));
  },

  updateLiveSync(patch: Partial<LiveSyncSettings>) {
    setState((s) => ({ ...s, settings: { ...s.settings, liveSync: { ...s.settings.liveSync, ...patch } } }));
  },

  /**
   * Import de résultats (fichier LENEX en direct, photo des feuilles…) :
   * crée les compétitions manquantes, complète le programme, ignore les doublons.
   */
  importClubResults(swimmerId: string, reports: ImportReport[]): { added: number; swims: Swim[] } {
    const addedSwims: Swim[] = [];
    /** Programme mis à jour (série, ligne, heure) : pas compté comme ajout. */
    const refreshed: Swim[] = [];
    setState((s) => {
      const meets = [...s.meets];
      const mine = s.swims.filter((x) => x.swimmerId === swimmerId);
      const now = Date.now();
      let seq = 0;
      for (const r of reports) {
        let meet = (r.meetId && meets.find((m) => m.id === r.meetId)) || findMeet(meets, r.meet.name, r.meet.startDate, r.meet.course, r.meet.city);
        if (!meet) {
          meet = {
            id: uid(),
            name: r.meet.name,
            city: r.meet.city,
            organizer: r.meet.organizer,
            startDate: r.meet.startDate,
            endDate: r.meet.endDate,
            course: r.meet.course,
            liveId: r.meet.liveId,
            createdAt: now,
          };
          meets.push(meet);
        } else {
          const longer = r.meet.endDate && (!meet.endDate || meet.endDate < r.meet.endDate);
          if (longer || (r.meet.liveId && !meet.liveId)) {
            const i = meets.indexOf(meet);
            meet = {
              ...meet,
              liveId: meet.liveId ?? r.meet.liveId,
              ...(longer ? { endDate: r.meet.endDate, startDate: meet.startDate < r.meet.startDate ? meet.startDate : r.meet.startDate } : {}),
            };
            meets[i] = meet;
          }
        }
        // Programme saisi à la main pour cette compétition : on complète les épreuves prévues
        const sorted = [...r.swims].sort((a, b) => (a.eventNo ?? 0) - (b.eventNo ?? 0));
        for (const rs of sorted) {
          const date = rs.date ?? r.meet.startDate;
          const candidate = {
            course: rs.course,
            distance: rs.distance,
            stroke: rs.stroke,
            timeCs: rs.timeCs ?? null,
            date,
            status: rs.status,
            meetId: meet.id,
            eventNo: rs.eventNo,
          };
          // Programme déjà connu : on met à jour série, ligne, heure et engagement s'ils ont changé
          if (rs.timeCs == null && rs.status === 'OK') {
            const same = [...mine, ...addedSwims, ...refreshed].find(
              (x) =>
                x.meetId === meet!.id &&
                x.timeCs == null &&
                x.status === 'OK' &&
                x.distance === rs.distance &&
                x.stroke === rs.stroke &&
                (x.eventNo == null || rs.eventNo == null || x.eventNo === rs.eventNo),
            );
            if (same) {
              const changed =
                (rs.heat != null && rs.heat !== same.heat) ||
                (rs.lane != null && rs.lane !== same.lane) ||
                (rs.startTime != null && rs.startTime !== same.startTime) ||
                (rs.entryCs != null && rs.entryCs !== same.entryCs) ||
                (rs.records != null && JSON.stringify(rs.records) !== JSON.stringify(same.records));
              if (changed)
                refreshed.push({
                  ...same,
                  heat: rs.heat ?? same.heat,
                  lane: rs.lane ?? same.lane,
                  startTime: rs.startTime ?? same.startTime,
                  entryCs: rs.entryCs ?? same.entryCs,
                  eventNo: same.eventNo ?? rs.eventNo,
                  records: rs.records ?? same.records,
                  updatedAt: now,
                });
              continue;
            }
          }
          // Résultat déjà lu pour cette épreuve de la même compétition en direct (séries et finale ont des
          // numéros d'épreuve différents) : la feuille officielle la plus récente fait foi (temps corrigé par
          // l'organisateur, ou lecture corrigée par une nouvelle version de l'application). Une disqualification
          // ou un forfait sans temps (« 00:00:00.00 » dans le fichier LENEX) corrige aussi la course lue « nagée »
          const noTime = rs.timeCs == null && rs.status !== 'OK';
          if ((rs.timeCs != null || noTime) && rs.eventNo != null && meet.liveId) {
            const prev = [...refreshed, ...mine].find(
              (x) =>
                x.meetId === meet!.id &&
                x.source === 'live' &&
                x.eventNo === rs.eventNo &&
                x.distance === rs.distance &&
                x.stroke === rs.stroke &&
                x.timeCs != null &&
                // Disqualification déjà connue avec son temps : gardée telle quelle
                (!noTime || x.status === 'OK'),
            );
            if (prev) {
              const fixed =
                prev.timeCs !== rs.timeCs ||
                prev.status !== rs.status ||
                (rs.place != null && rs.place !== prev.place) ||
                (!!rs.round && rs.round !== prev.round) ||
                (!!rs.splits?.length && !prev.splits?.length);
              if (fixed) {
                const corrected: Swim = {
                  ...prev,
                  timeCs: rs.timeCs ?? null,
                  status: rs.status,
                  // Disqualification, forfait, abandon : plus de place
                  place: rs.status === 'OK' ? rs.place ?? prev.place : rs.place,
                  round: rs.round ?? prev.round,
                  splits: rs.splits?.length ? rs.splits : prev.splits,
                  updatedAt: now,
                };
                const i = refreshed.findIndex((x) => x.id === prev.id);
                if (i >= 0) refreshed[i] = corrected;
                else refreshed.push(corrected);
              }
              continue;
            }
          }
          const dup = findDuplicate([...mine, ...addedSwims], candidate);
          if (dup) {
            // Course déjà connue (historique swimrankings, import précédent) : les résultats officiels la
            // complètent (place dans la catégorie, temps de passage, tour) sans changer le temps
            const known = !addedSwims.some((a) => a.id === dup.id);
            const base = refreshed.find((x) => x.id === dup.id) ?? dup;
            const round = base.source === 'swimrankings' && rs.round ? rs.round : base.round;
            const more =
              (rs.place != null && base.place == null) ||
              (!!rs.splits?.length && !base.splits?.length) ||
              round !== base.round ||
              (rs.eventNo != null && base.eventNo == null) ||
              (rs.timeCs != null && base.timeCs == null);
            if (known && more) {
              const enriched: Swim = {
                ...base,
                // Disqualification enregistrée sans temps : le temps du fichier LENEX s'y ajoute
                timeCs: base.timeCs ?? rs.timeCs ?? null,
                place: base.place ?? rs.place,
                splits: base.splits?.length ? base.splits : rs.splits,
                round,
                eventNo: base.eventNo ?? rs.eventNo,
                heat: base.heat ?? rs.heat,
                lane: base.lane ?? rs.lane,
                updatedAt: now,
              };
              const i = refreshed.findIndex((x) => x.id === dup.id);
              if (i >= 0) refreshed[i] = enriched;
              else refreshed.push(enriched);
            }
            continue;
          }
          const planned = mine.find(
            (x) =>
              x.meetId === meet!.id &&
              x.timeCs == null &&
              x.status === 'OK' &&
              x.distance === rs.distance &&
              x.stroke === rs.stroke &&
              (x.eventNo == null || rs.eventNo == null || x.eventNo === rs.eventNo) &&
              !addedSwims.some((a) => a.id === x.id),
          );
          if (planned) {
            addedSwims.push({
              ...planned,
              timeCs: rs.timeCs ?? null,
              status: rs.status,
              place: rs.place,
              splits: rs.splits,
              round: rs.round,
              eventNo: planned.eventNo ?? rs.eventNo,
              entryCs: planned.entryCs ?? rs.entryCs,
              points: rs.points ?? planned.points,
              heat: rs.heat ?? planned.heat,
              lane: rs.lane ?? planned.lane,
              notes: planned.notes ?? rs.notes,
              course: rs.course,
              date: rs.date ?? planned.date,
              startTime: planned.startTime ?? rs.startTime,
              timing: 'electronic',
              updatedAt: now,
            });
            continue;
          }
          addedSwims.push({
            id: uid(),
            swimmerId,
            meetId: meet.id,
            context: 'competition',
            date,
            startTime: rs.startTime,
            distance: rs.distance,
            stroke: rs.stroke,
            course: rs.course,
            timeCs: rs.timeCs ?? null,
            points: rs.points,
            heat: rs.heat,
            lane: rs.lane,
            notes: rs.notes,
            entryCs: rs.entryCs,
            ...(rs.records ? { records: rs.records } : {}),
            status: rs.status,
            round: rs.round,
            eventNo: rs.eventNo,
            place: rs.place,
            splits: rs.splits,
            timing: 'electronic',
            source: r.source ?? 'live',
            createdAt: now + seq++,
            updatedAt: now,
          });
        }
      }
      const changes = [...addedSwims, ...refreshed.filter((r) => !addedSwims.some((a) => a.id === r.id))];
      const newOnes = changes.filter((a) => !s.swims.some((x) => x.id === a.id));
      const updatedIds = new Set(changes.map((a) => a.id));
      return {
        ...s,
        meets,
        swims: [...s.swims.map((x) => (updatedIds.has(x.id) ? { ...x, ...changes.find((a) => a.id === x.id)! } : x)), ...newOnes],
      };
    });
    return { added: addedSwims.length, swims: addedSwims };
  },

  /**
   * Import swimrankings : crée (ou complète) le nageur, crée les compétitions
   * manquantes et ajoute les performances qui n'existent pas encore.
   */
  importSwimrankings(
    target: { swimmerId: string } | { create: ParsedAthlete & { gender: 'F' | 'M'; firstName: string; lastName: string } },
    swims: ParsedSwim[],
    /** select : afficher ce nageur sur l'accueil (import d'un parent) ; pas pour l'historique du club. */
    opts: { select?: boolean } = {},
  ): { swimmerId: string; added: number; skipped: number; meetsCreated: number } {
    const select = opts.select ?? true;
    let swimmerId: string;
    if ('swimmerId' in target) {
      swimmerId = target.swimmerId;
    } else {
      const c = target.create;
      swimmerId = actions.addSwimmer({
        firstName: c.firstName,
        lastName: c.lastName,
        gender: c.gender,
        birthYear: c.birthYear,
        club: c.club,
        nation: c.nation,
        swimrankingsId: c.swimrankingsId,
        relation: 'child',
      }).id;
    }
    let added = 0;
    let skipped = 0;
    let meetsCreated = 0;
    setState((s) => {
      const meets = [...s.meets];
      const newSwims: Swim[] = [];
      // Courses du nageur rangées par épreuve et temps : le contrôle des doublons ne parcourt que celles-là
      const byTime = new Map<string, Swim[]>();
      const timeKey = (x: Pick<Swim, 'course' | 'distance' | 'stroke' | 'timeCs'>) => `${x.course}|${x.distance}|${x.stroke}|${x.timeCs}`;
      for (const x of s.swims) {
        if (x.swimmerId !== swimmerId) continue;
        const k = timeKey(x);
        const list = byTime.get(k);
        if (list) list.push(x);
        else byTime.set(k, [x]);
      }
      // Disqualifications et forfaits (sans temps) déjà enregistrés pour ce nageur : résultats en direct, feuille PDF
      const withStatus = s.swims.filter((x) => x.swimmerId === swimmerId && x.status !== 'OK');
      const sameStatus = (x: Swim, p: ParsedSwim) =>
        x.course === p.course && x.distance === p.distance && x.stroke === p.stroke && x.status === p.status && Math.abs(Date.parse(x.date) - Date.parse(p.date)) <= dayMs;
      for (const p of swims) {
        const dup = p.status
          ? withStatus.some((x) => sameStatus(x, p))
          : isDuplicate(byTime.get(timeKey(p)) ?? [], { ...p, timeCs: p.timeCs, status: 'OK', meetId: undefined });
        if (dup) {
          skipped++;
          continue;
        }
        let meetId: string | undefined;
        const meetName = p.meet || (p.city ? `Compétition à ${p.city.replace(/\s*\([A-Z]{3}\)$/, '')}` : 'Compétition');
        // Disqualification d'une compétition déjà présente sous un autre nom (résultats en direct) : celle des
        // autres courses du nageur ce jour-là, dans ce bassin
        const sameDay = p.status
          ? [...s.swims, ...newSwims].find((x) => x.swimmerId === swimmerId && x.date === p.date && x.course === p.course && x.meetId)?.meetId
          : undefined;
        const found = findMeet(meets, meetName, p.date, p.course) ?? meets.find((m) => m.id === sameDay);
        // Jour non relevé : la compétition couvre au moins ses dates connues
        const first = p.dayRange && p.dayRange.from < p.date ? p.dayRange.from : p.date;
        const last = p.dayRange && p.dayRange.to > p.date ? p.dayRange.to : p.date;
        if (found) {
          meetId = found.id;
          const i = meets.indexOf(found);
          meets[i] = {
            ...found,
            startDate: first < found.startDate ? first : found.startDate,
            endDate: last > (found.endDate ?? found.startDate) ? last : found.endDate,
          };
        } else {
          const cityMatch = /^(.*?)\s*\(([A-Z]{3})\)$/.exec(p.city ?? '');
          const meet: Meet = {
            id: uid(),
            name: meetName,
            city: cityMatch ? cityMatch[1] : p.city,
            nation: cityMatch ? cityMatch[2] : undefined,
            startDate: first,
            ...(last !== first ? { endDate: last } : {}),
            course: p.course,
            createdAt: Date.now(),
          };
          meets.push(meet);
          meetId = meet.id;
          meetsCreated++;
        }
        const now = Date.now();
        newSwims.push({
          id: uid(),
          swimmerId,
          meetId,
          context: 'competition',
          date: p.date,
          ...(p.dayRange ? { dayRange: p.dayRange } : {}),
          distance: p.distance,
          stroke: p.stroke,
          course: p.course,
          timeCs: p.timeCs,
          status: p.status ?? 'OK',
          round: p.round ?? 'TIM',
          points: p.points,
          ...(historyNote(p) ? { notes: historyNote(p) } : {}),
          ...(p.place != null ? { place: p.place } : {}),
          ...(p.splits ? { splits: p.splits, splitEvery: p.splitEvery } : {}),
          ...(p.masters ? { masters: true } : {}),
          timing: 'electronic',
          source: 'swimrankings',
          createdAt: now,
          updatedAt: now,
        });
        const added1 = newSwims[newSwims.length - 1];
        if (p.status) {
          withStatus.push(added1);
          added++;
          continue;
        }
        const k = timeKey(added1);
        const list = byTime.get(k);
        if (list) list.push(added1);
        else byTime.set(k, [added1]);
        added++;
      }
      // Rien de nouveau (historique déjà lu) : aucune copie des données
      if (!newSwims.length && !select) return s;
      return {
        ...s,
        meets: newSwims.length ? meets.map((m) => ({ ...m })) : s.meets,
        swims: newSwims.length ? [...s.swims, ...newSwims] : s.swims,
        settings: select ? { ...s.settings, onboarded: true, selectedSwimmerId: swimmerId } : { ...s.settings, onboarded: true },
      };
    });
    return { swimmerId, added, skipped, meetsCreated };
  },

  /**
   * Nouvelle version de l'historique du club : les courses d'historique d'un nageur qui n'y sont plus
   * (nagées pour un autre club, corrigées) sont retirées, puis les compétitions restées vides.
   * Les résultats trouvés par la recherche automatique ne sont jamais touchés.
   */
  /** Classements nationaux publiés par le club : remplacent les précédents. */
  /**
   * Inscriptions du club republiées : un engagement du club (programme pas encore nagé) qui n'y figure plus
   * est retiré. `keep` : « idNageur|n° d'épreuve » des engagements publiés pour ces compétitions.
   */
  dropClubEntries(meetIds: string[], keep: Set<string>): number {
    let n = 0;
    setState((s) => {
      const swims = s.swims.filter((x) => {
        const drop = x.source === 'club' && x.timeCs == null && x.status === 'OK' && !!x.meetId && meetIds.includes(x.meetId) && !keep.has(`${x.swimmerId}|${x.eventNo}`);
        if (drop) n++;
        return !drop;
      });
      return n ? { ...s, swims } : s;
    });
    return n;
  },

  setRankings(rankings: NationalRank[], version: string) {
    setState((s) => ({
      ...s,
      rankings,
      settings: s.settings.club ? { ...s.settings, club: { ...s.settings.club, rankingsVersion: version } } : s.settings,
    }));
  },

  pruneHistorySwims(swimmerId: string, keep: Pick<ParsedSwim, 'course' | 'distance' | 'stroke' | 'timeCs' | 'date' | 'status'>[]): number {
    // Disqualification, forfait : sans temps, reconnus à leur statut (course nagée : « OK »)
    const key = (x: Pick<Swim, 'course' | 'distance' | 'stroke' | 'date'> & { timeCs?: number | null; status?: string }) =>
      `${x.course}|${x.distance}|${x.stroke}|${x.timeCs ?? ''}|${x.status ?? 'OK'}|${x.date}`;
    const wanted = new Set(keep.map(key));
    let removed = 0;
    setState((s) => {
      const gone = new Set(s.swims.filter((x) => x.swimmerId === swimmerId && x.source === 'swimrankings' && !wanted.has(key(x))).map((x) => x.id));
      if (!gone.size) return s;
      removed = gone.size;
      const touched = new Set(s.swims.filter((x) => gone.has(x.id)).map((x) => x.meetId));
      const swims = s.swims.filter((x) => !gone.has(x.id));
      const used = new Set(swims.map((x) => x.meetId));
      // Compétitions de ces courses restées sans aucune course (et sans lien vers les résultats en direct)
      return { ...s, swims, meets: s.meets.filter((m) => !touched.has(m.id) || used.has(m.id) || m.liveId) };
    });
    return removed;
  },
};

