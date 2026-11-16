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

/** Vrai quand la liste des membres du club est dans l'application. */
export const hasClubMembers = (list: Swimmer[]) => list.some((s) => s.member);

/** Membre actuel du club (dans la liste publiée, pas ancien membre). */
export const isActiveMember = (s: Swimmer) => !!s.member && !s.former;

/** Ancien membre du club (marqué comme tel dans la liste publiée). */
export const isFormerMember = (s: Swimmer) => !!s.member && !!s.former;

/**
 * Mes nageurs : mes enfants et mes favoris. Sans liste du club (quelques nageurs
 * seulement), tous les nageurs. `current` est ajouté s'il n'en fait pas partie.
 */
export function mySwimmers(list: Swimmer[], current?: Swimmer): Swimmer[] {
  const mine = hasClubMembers(list) ? list.filter((s) => s.relation === 'child' || s.favorite) : list;
  const out = sortSwimmers(mine);
  return current && !out.some((s) => s.id === current.id) ? [...out, current] : out;
}

export function useSelectedSwimmer(): Swimmer | undefined {
  const data = useData();
  return useMemo(() => {
    const id = data.settings.selectedSwimmerId;
    return data.swimmers.find((s) => s.id === id) ?? mySwimmers(data.swimmers)[0] ?? sortSwimmers(data.swimmers)[0];
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
