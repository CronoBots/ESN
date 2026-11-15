import { useSyncExternalStore } from 'react';

/**
 * Routeur minimal basé sur le hash (#/chemin?param=valeur) : fonctionne sur
 * n'importe quel hébergement statique (GitHub Pages, Netlify…) et hors-ligne.
 *
 * L'état de navigation est tenu en mémoire (pile de pages) et reflété dans
 * l'adresse quand c'est possible : la navigation reste fiable même si
 * l'historique du navigateur est indisponible (cadre intégré, aperçu…).
 */
export interface Route {
  path: string[];
  query: URLSearchParams;
  raw: string;
}

function parse(raw: string): Route {
  const hash = raw.replace(/^#/, '') || '/';
  const [p, q = ''] = hash.split('?');
  return {
    path: p
      .split('/')
      .filter(Boolean)
      .map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      }),
    query: new URLSearchParams(q),
    raw: hash,
  };
}

let current = parse(window.location.hash);
const stack: string[] = [];
/** Nombre d'entrées d'historique ajoutées par l'application. */
let pushed = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function setUrl(raw: string, mode: 'push' | 'replace') {
  try {
    const url = `${window.location.pathname}${window.location.search}#${raw}`;
    if (mode === 'push') {
      window.history.pushState({ nageo: raw }, '', url);
      pushed++;
    } else window.history.replaceState({ nageo: raw }, '', url);
  } catch {
    /* historique indisponible : la navigation reste en mémoire */
  }
}

function scrollTop() {
  try {
    window.scrollTo({ top: 0 });
  } catch {
    /* ignore */
  }
}

// Changement d'adresse venu de l'extérieur (bouton retour du navigateur, lien, favori)
function syncFromLocation() {
  const raw = parse(window.location.hash).raw;
  if (raw === current.raw) return;
  if (stack.length && stack[stack.length - 1] === raw) {
    stack.pop();
    pushed = Math.max(0, pushed - 1);
  } else stack.push(current.raw);
  current = parse(raw);
  emit();
  scrollTop();
}
window.addEventListener('hashchange', syncFromLocation);
window.addEventListener('popstate', syncFromLocation);

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
  const raw = parse(to.replace(/^#/, '')).raw;
  if (raw === current.raw && !opts.replace) return;
  if (!opts.replace) stack.push(current.raw);
  current = parse(raw);
  setUrl(raw, opts.replace ? 'replace' : 'push');
  emit();
  scrollTop();
}

/** Retour arrière : page précédente si elle existe, sinon page parente. */
export function goBack(fallback = '/') {
  // Revient dans l'historique du navigateur quand l'entrée a été ajoutée par l'app
  if (pushed > 0 && stack.length) {
    const before = current.raw;
    try {
      window.history.back();
      // Si l'historique ne répond pas (cadre restreint), on recule en mémoire
      setTimeout(() => {
        if (current.raw === before) memoryBack(fallback);
      }, 250);
      return;
    } catch {
      /* repli en mémoire */
    }
  }
  memoryBack(fallback);
}

function memoryBack(fallback: string) {
  const prev = stack.pop();
  const raw = prev ?? parse(fallback).raw;
  current = parse(raw);
  setUrl(raw, 'replace');
  emit();
  scrollTop();
}

export function href(path: string): string {
  return `#${path}`;
}
