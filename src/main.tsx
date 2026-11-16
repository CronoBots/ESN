import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initStore } from './store/store';
// Polices embarquées (fonctionnent hors-ligne) : Barlow pour le texte, Barlow Condensed pour les titres et les temps
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import './styles/global.css';

// Écran d'ouverture (logo) : visible au moins 0,9 s depuis le lancement, puis fondu
function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  setTimeout(() => {
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 400);
  }, Math.max(0, 900 - performance.now()));
}

// Données lues dans IndexedDB avant le premier affichage (sous l'écran d'ouverture)
initStore().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  hideSplash();
});

// Service worker : application disponible hors-ligne (production uniquement)
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  // Nouvelle version installée : on recharge (une seule fois) pour l'utiliser tout de suite
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        // Retour dans l'application (iPhone : elle reste ouverte en arrière-plan) : vérifier les mises à jour
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => {
        /* environnement sans service worker (aperçu, iframe…) */
      });
  });
}

// Demande un stockage persistant (évite l'effacement automatique des données)
if (navigator.storage?.persist) {
  navigator.storage.persisted?.().then((p) => {
    if (!p) navigator.storage.persist().catch(() => {});
  });
}
