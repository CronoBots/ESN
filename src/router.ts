import { useSyncExternalStore } from 'react';

/**
 * Routeur minimal basé sur le hash (#/chemin?param=valeur) : fonctionne sur
 * n'importe quel hébergement statique (GitHub Pages, Netlify…) et hors-ligne.
 */
export interface Route {
  path: string[];
  query: URLSearchParams;
  raw: string;
}

function parse(): Route {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const [p, q = ''] = hash.split('?');
  return {
    path: p.split('/').filter(Boolean).map(decodeURIComponent),
    query: new URLSearchParams(q),
    raw: hash,
  };
}

let current = parse();
const listeners = new Set<() => void>();
let depth = 0;

window.addEventListener('hashchange', () => {
  current = parse();
  listeners.forEach((l) => l());
  window.scrollTo({ top: 0 });
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const target = to.startsWith('#') ? to : `#${to}`;
  if (opts.replace) {
    window.history.replaceState(null, '', target);
    current = parse();
    listeners.forEach((l) => l());
    window.scrollTo({ top: 0 });
  } else {
    depth++;
    window.location.hash = target;
  }
}

/** Retour arrière : historique si possible, sinon page parente. */
export function goBack(fallback = '/') {
  if (depth > 0) {
    depth--;
    window.history.back();
  } else {
    navigate(fallback, { replace: true });
  }
}

export function href(path: string): string {
  return `#${path}`;
}
