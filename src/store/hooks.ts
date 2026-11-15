import { useMemo } from 'react';
import { useData } from './store';
import { computePbFlags, personalBests } from '../lib/stats';
import type { AppData, Swimmer } from './types';

let cache: { swims: AppData['swims']; include: boolean; flags: ReturnType<typeof computePbFlags> } | null = null;

/** Indicateurs « record personnel » de toutes les courses (mémoïsés). */
export function usePbFlags() {
  const data = useData();
  const include = data.settings.includeTraining;
  if (!cache || cache.swims !== data.swims || cache.include !== include) {
    cache = { swims: data.swims, include, flags: computePbFlags(data.swims, include) };
  }
  return cache.flags;
}

export function sortSwimmers(list: Swimmer[]): Swimmer[] {
  return [...list].sort((a, b) => {
    if (a.relation !== b.relation) return a.relation === 'child' ? -1 : 1;
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'fr');
  });
}

export function useSelectedSwimmer(): Swimmer | undefined {
  const data = useData();
  return useMemo(() => {
    const id = data.settings.selectedSwimmerId;
    return data.swimmers.find((s) => s.id === id) ?? sortSwimmers(data.swimmers)[0];
  }, [data.swimmers, data.settings.selectedSwimmerId]);
}

export function usePersonalBests(swimmerId: string | undefined) {
  const data = useData();
  return useMemo(
    () => (swimmerId ? personalBests(data.swims, swimmerId, data.settings.includeTraining) : new Map()),
    [data.swims, swimmerId, data.settings.includeTraining],
  );
}

export function fullName(s: Pick<Swimmer, 'firstName' | 'lastName'>): string {
  return `${s.firstName} ${s.lastName}`.trim();
}
