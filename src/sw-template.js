/* Service worker ESN Compétition — généré au build (voir vite.config.ts). */
const CACHE = 'nageo-__CACHE_VERSION__';
const PRECACHE = __PRECACHE_FILES__;
// Données du club (data/) : cache à part, gardé d'une version à l'autre (sinon chaque mise à jour
// effaçait la copie hors connexion du calendrier et des temps limites)
const DATA_CACHE = 'esn-data';
// Ouverture : au-delà de ce délai sans réponse du réseau (signal faible), la copie en cache s'affiche
const NAV_TIMEOUT = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('nageo-') && k !== CACHE)
            .map((k) => keepData(k).catch(() => {}).then(() => caches.delete(k))),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Copies des données rangées par une version précédente dans son propre cache : reprises dans
// le cache des données avant sa suppression (une copie plus récente déjà présente est gardée)
function keepData(name) {
  return Promise.all([caches.open(name), caches.open(DATA_CACHE)]).then(([old, data]) =>
    old.keys().then((reqs) =>
      Promise.all(
        reqs
          .filter((r) => new URL(r.url).pathname.includes('/data/'))
          .map((r) => data.match(r).then((have) => have || old.match(r).then((res) => res && data.put(r, res)))),
      ),
    ),
  );
}

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigation : réseau d'abord (pour recevoir les mises à jour), cache en secours.
  // Réseau très lent (une barre de signal à la piscine) : la copie en cache s'affiche après NAV_TIMEOUT,
  // et la réponse du réseau, quand elle arrive, met le cache à jour pour le lancement suivant.
  if (req.mode === 'navigate') {
    // Lien d'accès éventuel dans l'adresse (?code=…) : jamais envoyé au serveur, la page est la même
    const target = url.search ? `${url.origin}${url.pathname}` : req;
    const cached = () => caches.match('./', { ignoreSearch: true }).then((r) => r || caches.match('./index.html'));
    // Page toujours revalidée auprès du serveur (réponse 304 si elle n'a pas changé) : la copie gardée 10 minutes
    // par le navigateur pouvait encore annoncer la version précédente, dont les fichiers n'existent plus après une
    // mise à jour (écran d'ouverture figé jusqu'à 10 minutes). Navigateur qui refuserait l'option : requête simple.
    const network = fetch(target, { cache: 'no-cache' })
      .catch(() => fetch(target))
      .then((res) => {
        // Page d'erreur de l'hébergeur (panne) : la copie hors connexion n'est pas remplacée
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
        }
        return res;
      });
    // Le service worker reste actif jusqu'à la réponse du réseau, même si la copie en cache est déjà affichée
    event.waitUntil(network.catch(() => {}));
    event.respondWith(
      new Promise((resolve) => {
        const timer = setTimeout(() => cached().then((r) => resolve(r || network.catch(cached))), NAV_TIMEOUT);
        network.then(
          (res) => {
            clearTimeout(timer);
            resolve(res);
          },
          () => {
            clearTimeout(timer);
            resolve(cached());
          },
        );
      }),
    );
    return;
  }

  // Livetiming copié avec le site (live/) : toujours relu sur le réseau, l'application garde elle-même
  // les feuilles définitives ; jamais servi depuis le cache des fichiers de l'application
  if (url.pathname.includes('/live/')) return;

  // Données du club (liste, historique) : réseau d'abord (requête conditionnelle, 304 si inchangées),
  // dernière copie en secours hors connexion, dans le cache des données (gardé lors des mises à jour).
  if (url.pathname.includes('/data/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })),
    );
    return;
  }

  // Fichiers statiques : cache d'abord.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
