import { startTransition, useEffect, useState } from 'react';

/** Longues listes : de quoi remplir l'écran tout de suite, le reste juste après le premier affichage. */
export const FIRST_ROWS = 40;

/**
 * Faux tant que la liste vient d'apparaître ou que `key` (filtres) vient de changer,
 * vrai juste après : le premier affichage ne montre que le haut de la liste.
 */
export function useProgressive(key = ''): boolean {
  const [doneKey, setDoneKey] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => startTransition(() => setDoneKey(key)), 0);
    return () => clearTimeout(t);
  }, [key]);
  return doneKey === key;
}

/** Groupes entiers (sections) jusqu'à environ FIRST_ROWS lignes ; tous une fois `full`. */
export function firstGroups<T>(groups: T[], size: (g: T) => number, full: boolean): T[] {
  if (full) return groups;
  const out: T[] = [];
  let rows = 0;
  for (const g of groups) {
    if (rows >= FIRST_ROWS) break;
    out.push(g);
    rows += size(g);
  }
  return out;
}
