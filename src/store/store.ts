import { useSyncExternalStore } from 'react';
import type { AppData, Goal, LiveSyncSettings, Meet, Settings, Swim, Swimmer } from './types';
import { closeSwimmer, sameSwimmer, type ReportMeet, type ReportSwim } from '../lib/results';
import type { Roster } from '../lib/roster';
import { CLUB } from '../club';
import type { ParsedAthlete, ParsedSwim } from '../lib/swimrankings';
import { uid } from '../lib/id';

const STORAGE_KEY = 'nageo:data:v1';

/**
 * Version de la lecture de la liste du club. 2 : anciens membres. Une liste
 * appliquée par une version précédente est relue une fois, même inchangée.
 */
export const ROSTER_PARSER = 2;

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

/** Valide et complète des données (sauvegarde ou stockage local). */
export function normalizeData(raw: unknown): AppData {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppData>;
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    version: 1,
    swimmers: arr<Swimmer>(d.swimmers).filter((s) => s && s.id),
    meets: arr<Meet>(d.meets).filter((m) => m && m.id),
    swims: arr<Swim>(d.swims).filter((s) => s && s.id && s.swimmerId),
    goals: arr<Goal>(d.goals).filter((g) => g && g.id),
    settings: {
      ...DEFAULT_SETTINGS,
      ...(d.settings ?? {}),
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

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    saveError = null;
  } catch (e) {
    saveError = e instanceof Error ? e.message : String(e);
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
    if (e.key === STORAGE_KEY) {
      state = load();
      listeners.forEach((l) => l());
    }
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
  swims: (ReportSwim & { date?: string; startTime?: string; points?: number; heat?: number; lane?: number; notes?: string })[];
}

/* ------------------------------------------------------------------------ */
/* Outils d'import                                                           */
/* ------------------------------------------------------------------------ */

const normMeet = (t?: string) => (t ?? '').toLowerCase().replace(/[^a-z0-9à-ÿ]/g, '');
const dayMs = 86400000;

/** Retrouve une compétition existante (même nom, dates proches, même bassin). */
function findMeet(meets: Meet[], name: string, date: string, course: Meet['course']): Meet | undefined {
  const n = normMeet(name);
  const sameName = (m: Meet) => {
    const mn = normMeet(m.name);
    return mn && n && (mn.startsWith(n) || n.startsWith(mn));
  };
  const t = new Date(date).getTime();
  return (
    meets.find((m) => sameName(m) && m.course === course && date >= m.startDate && date <= (m.endDate ?? m.startDate)) ??
    meets.find((m) => sameName(m) && m.course === course && Math.abs(t - new Date(m.startDate).getTime()) <= 4 * dayMs)
  );
}

/** Vrai si une course identique (même épreuve, même temps, dates proches) existe déjà. */
function isDuplicate(existing: Swim[], s: Pick<Swim, 'course' | 'distance' | 'stroke' | 'timeCs' | 'date' | 'status' | 'meetId'>): boolean {
  const t = new Date(s.date).getTime();
  return existing.some(
    (x) =>
      x.course === s.course &&
      x.distance === s.distance &&
      x.stroke === s.stroke &&
      (s.timeCs != null ? x.timeCs === s.timeCs : x.status === s.status && x.meetId === s.meetId) &&
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
   * résultat (ceux qui ont des résultats restent, sans groupe).
   */
  applyRoster(roster: Roster, code: string, version: string): { added: number; total: number } {
    let added = 0;
    setState((s) => {
      const now = Date.now();
      const swimmers = [...s.swimmers];
      const kept = new Set<string>();
      for (const m of roster.members) {
        const i = swimmers.findIndex((sw) => !kept.has(sw.id) && sameSwimmer(m, sw));
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
            birthYear: sw.birthYear ?? m.birthYear,
            club: sw.club || roster.club,
          };
          kept.add(sw.id);
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
            createdAt: now,
          };
          swimmers.push(sw);
          kept.add(sw.id);
          added++;
        }
      }
      const used = new Set([...s.swims.map((x) => x.swimmerId), ...s.goals.map((g) => g.swimmerId)]);
      const next = swimmers
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
        settings: {
          ...s.settings,
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
        // Déjà dans la liste, éventuellement écrit autrement sur la feuille (une lettre près)
        if (swimmers.some((sw) => closeSwimmer(c, sw))) continue;
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
        let meet = (r.meetId && meets.find((m) => m.id === r.meetId)) || findMeet(meets, r.meet.name, r.meet.startDate, r.meet.course);
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
          const candidate = { course: rs.course, distance: rs.distance, stroke: rs.stroke, timeCs: rs.timeCs ?? null, date, status: rs.status, meetId: meet.id };
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
                (rs.entryCs != null && rs.entryCs !== same.entryCs);
              if (changed)
                refreshed.push({
                  ...same,
                  heat: rs.heat ?? same.heat,
                  lane: rs.lane ?? same.lane,
                  startTime: rs.startTime ?? same.startTime,
                  entryCs: rs.entryCs ?? same.entryCs,
                  eventNo: same.eventNo ?? rs.eventNo,
                  updatedAt: now,
                });
              continue;
            }
          }
          if (isDuplicate([...mine, ...addedSwims], candidate)) continue;
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
  ): { swimmerId: string; added: number; skipped: number; meetsCreated: number } {
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
      const mine = s.swims.filter((x) => x.swimmerId === swimmerId);
      for (const p of swims) {
        if (isDuplicate([...mine, ...newSwims], { ...p, timeCs: p.timeCs, status: 'OK', meetId: undefined })) {
          skipped++;
          continue;
        }
        let meetId: string | undefined;
        const meetName = p.meet || (p.city ? `Compétition à ${p.city.replace(/\s*\([A-Z]{3}\)$/, '')}` : 'Compétition');
        const found = findMeet(meets, meetName, p.date, p.course);
        if (found) {
          meetId = found.id;
          const i = meets.indexOf(found);
          meets[i] = {
            ...found,
            startDate: p.date < found.startDate ? p.date : found.startDate,
            endDate: p.date > (found.endDate ?? found.startDate) ? p.date : found.endDate,
          };
        } else {
          const cityMatch = /^(.*?)\s*\(([A-Z]{3})\)$/.exec(p.city ?? '');
          const meet: Meet = {
            id: uid(),
            name: meetName,
            city: cityMatch ? cityMatch[1] : p.city,
            nation: cityMatch ? cityMatch[2] : undefined,
            startDate: p.date,
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
          distance: p.distance,
          stroke: p.stroke,
          course: p.course,
          timeCs: p.timeCs,
          status: 'OK',
          round: 'TIM',
          points: p.points,
          timing: 'electronic',
          source: 'swimrankings',
          createdAt: now,
          updatedAt: now,
        });
        added++;
      }
      return {
        ...s,
        meets: meets.map((m) => ({ ...m })),
        swims: [...s.swims, ...newSwims],
        settings: { ...s.settings, onboarded: true, selectedSwimmerId: swimmerId },
      };
    });
    return { swimmerId, added, skipped, meetsCreated };
  },
};

/** Données de démonstration pour découvrir l'application. */
export function loadDemo() {
  import('./demo').then((m) => actions.mergeAll(m.buildDemo()));
}
