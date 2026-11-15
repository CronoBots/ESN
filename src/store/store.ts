import { useSyncExternalStore } from 'react';
import type { AppData, Goal, Meet, Settings, Swim, Swimmer } from './types';
import type { ParsedAthlete, ParsedSwim } from '../lib/swimrankings';
import { uid } from '../lib/id';

const STORAGE_KEY = 'nageo:data:v1';

const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  includeTraining: false,
  defaultCourse: 'SCM',
  onboarded: false,
  celebrate: true,
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
    settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) },
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
    setState((s) => ({ ...s, swimmers: s.swimmers.map((x) => (x.id === id ? { ...x, ...patch, id } : x)) }));
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
      const existing = new Set(
        s.swims
          .filter((x) => x.swimmerId === swimmerId && x.timeCs)
          .map((x) => `${x.course}|${x.distance}|${x.stroke}|${x.timeCs}|${x.date}`),
      );
      const norm = (t?: string) => (t ?? '').toLowerCase().replace(/[^a-z0-9à-ÿ]/g, '');
      for (const p of swims) {
        const key = `${p.course}|${p.distance}|${p.stroke}|${p.timeCs}|${p.date}`;
        if (existing.has(key)) {
          skipped++;
          continue;
        }
        existing.add(key);
        let meetId: string | undefined;
        const meetName = p.meet || (p.city ? `Compétition à ${p.city.replace(/\s*\([A-Z]{3}\)$/, '')}` : 'Compétition');
        const found = meets.find(
          (m) =>
            (norm(m.name).startsWith(norm(meetName)) || norm(meetName).startsWith(norm(m.name))) &&
            p.date >= m.startDate &&
            p.date <= (m.endDate ?? m.startDate) &&
            m.course === p.course,
        ) ??
          meets.find(
            (m) =>
              (norm(m.name).startsWith(norm(meetName)) || norm(meetName).startsWith(norm(m.name))) &&
              Math.abs(new Date(p.date).getTime() - new Date(m.startDate).getTime()) <= 4 * 86400000 &&
              m.course === p.course,
          );
        if (found) {
          meetId = found.id;
          if (p.date < found.startDate) found.startDate = p.date;
          if (p.date > (found.endDate ?? found.startDate)) found.endDate = p.date;
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
