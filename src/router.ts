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
  // Retour arrière en cours (fermeture d'une fenêtre) : l'adresse change juste après
  if (ownBacks > 0) {
    deferred.push(() => setUrl(raw, mode));
    return;
  }
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

/* ------------------------------------------------------------------------ */
/* Fenêtres ouvertes (feuilles, confirmations) et bouton retour               */
/* ------------------------------------------------------------------------ */

/*
 * Chaque fenêtre ouverte ajoute une entrée d'historique (même adresse) : le bouton retour d'Android,
 * du navigateur ou le geste retour de Safari ferme la fenêtre au lieu de changer la page derrière.
 * Fermée par un de ses boutons, la fenêtre retire son entrée (retour arrière « silencieux »).
 */
const SESSION = Math.random().toString(36).slice(2, 8);
let layerSeq = 0;
/** Retours arrière lancés par l'application (fermeture d'une fenêtre) : sans effet sur la page. */
let ownBacks = 0;
let deferred: (() => void)[] = [];
const pendingLayers = new Set<string>();
let layerHooks: { isOpen: (token: string) => boolean; closeAbove: (token: string | undefined) => void } = {
  isOpen: () => false,
  closeAbove: () => {},
};

/** Branché par l'hôte des fenêtres : savoir si une fenêtre est ouverte, fermer celles au-dessus d'une entrée. */
export function bindLayers(hooks: typeof layerHooks) {
  layerHooks = hooks;
}

const layerSeqOf = (token: unknown) => (typeof token === 'string' && token.startsWith(`${SESSION}-`) ? Number(token.slice(SESSION.length + 1)) : 0);

/** Fenêtres ouvertes après l'entrée `token` (toutes si `token` est absent ou d'une session précédente). */
export function isLayerAbove(layer: string, token: string | undefined): boolean {
  return layerSeqOf(layer) > layerSeqOf(token);
}

function flushDeferred() {
  const list = deferred;
  deferred = [];
  list.forEach((f) => f());
}

function ownBack() {
  ownBacks++;
  try {
    window.history.back();
  } catch {
    ownBacks--;
    flushDeferred();
    return;
  }
  // Sécurité : navigateur qui ne répond pas au retour arrière
  setTimeout(() => {
    if (ownBacks > 0) {
      ownBacks = 0;
      flushDeferred();
    }
  }, 600);
}

/** Nouvelle fenêtre : entrée d'historique à la même adresse. */
export function pushLayer(): string {
  const token = `${SESSION}-${++layerSeq}`;
  const push = () => {
    if (!pendingLayers.delete(token)) return; // déjà refermée
    try {
      window.history.pushState({ ...(window.history.state ?? {}), layer: token }, '', window.location.href);
    } catch {
      /* historique indisponible */
    }
  };
  pendingLayers.add(token);
  if (ownBacks > 0) deferred.push(push);
  else push();
  return token;
}

/** Fenêtre fermée par un de ses boutons : son entrée d'historique est retirée. */
export function popLayer(token: string) {
  if (pendingLayers.delete(token)) return;
  if (window.history.state?.layer === token) ownBack();
}

function onPopState() {
  if (ownBacks > 0) {
    ownBacks--;
    if (!ownBacks) flushDeferred();
    return;
  }
  const layer: string | undefined = window.history.state?.layer;
  // Retour arrière : les fenêtres ouvertes au-dessus de cette entrée se ferment
  layerHooks.closeAbove(layer);
  syncFromLocation();
  // Entrée d'une fenêtre déjà fermée : on la saute
  if (layer && !layerHooks.isOpen(layer)) ownBack();
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
window.addEventListener('popstate', onPopState);

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
