import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker : application disponible hors-ligne (production uniquement)
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
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
