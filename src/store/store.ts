import { useSyncExternalStore } from 'react';
import type { AppData, ClubSyncSettings, Goal, Meet, Settings, Swim, Swimmer } from './types';
import type { ReportMeet, ReportSwim } from '../lib/clubReport';
import type { ParsedAthlete, ParsedSwim } from '../lib/swimrankings';
import { uid } from '../lib/id';

const STORAGE_KEY = 'nageo:data:v1';

const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  includeTraining: false,
  defaultCourse: 'SCM',
  onboarded: false,
  celebrate: true,
  clubSync: { enabled: true, processed: {} },
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
      clubSync: { ...DEFAULT_SETTINGS.clubSync, ...(d.settings?.clubSync ?? {}) },
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
  persist();
  listeners.forEach((l) => l());
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
      // Nom modifié : les résultats du club seront recherchés à nouveau
      const processed = renamed
        ? Object.fromEntries(Object.entries(s.settings.clubSync.processed).map(([u, ids]) => [u, ids.filter((x) => x !== id)]))
        : s.settings.clubSync.processed;
      return {
        ...s,
        swimmers: s.swimmers.map((x) => (x.id === id ? { ...x, ...patch, id } : x)),
        settings: { ...s.settings, clubSync: { ...s.settings.clubSync, processed } },
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

  updateClubSync(patch: Partial<ClubSyncSettings>) {
    setState((s) => ({ ...s, settings: { ...s.settings, clubSync: { ...s.settings.clubSync, ...patch } } }));
  },

  /**
   * Import des résultats publiés par le club (rapports PDF « résultats par
   * club ») : crée les compétitions manquantes, ignore les doublons.
   */
  importClubResults(
    swimmerId: string,
    reports: {
      meet: ReportMeet;
      /** Compétition existante choisie par l'utilisateur. */
      meetId?: string;
      swims: (ReportSwim & { date?: string; startTime?: string; points?: number })[];
    }[],
  ): { added: number; swims: Swim[] } {
    const addedSwims: Swim[] = [];
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
            createdAt: now,
          };
          meets.push(meet);
        } else if (r.meet.endDate && (!meet.endDate || meet.endDate < r.meet.endDate)) {
          const i = meets.indexOf(meet);
          meet = { ...meet, endDate: r.meet.endDate, startDate: meet.startDate < r.meet.startDate ? meet.startDate : r.meet.startDate };
          meets[i] = meet;
        }
        // Programme saisi à la main pour cette compétition : on complète les épreuves prévues
        const sorted = [...r.swims].sort((a, b) => (a.eventNo ?? 0) - (b.eventNo ?? 0));
        for (const rs of sorted) {
          const date = rs.date ?? r.meet.startDate;
          const candidate = { course: rs.course, distance: rs.distance, stroke: rs.stroke, timeCs: rs.timeCs ?? null, date, status: rs.status, meetId: meet.id };
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
            entryCs: rs.entryCs,
            status: rs.status,
            round: rs.round,
            eventNo: rs.eventNo,
            place: rs.place,
            splits: rs.splits,
            timing: 'electronic',
            source: 'club',
            createdAt: now + seq++,
            updatedAt: now,
          });
        }
      }
      const newOnes = addedSwims.filter((a) => !s.swims.some((x) => x.id === a.id));
      const updatedIds = new Set(addedSwims.map((a) => a.id));
      return {
        ...s,
        meets,
        swims: [...s.swims.map((x) => (updatedIds.has(x.id) ? { ...x, ...addedSwims.find((a) => a.id === x.id)! } : x)), ...newOnes],
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
