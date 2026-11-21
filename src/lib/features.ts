/**
 * Nouvelle organisation de l'application : « Mon espace » (mes nageurs) et « Club » (tout l'ESN).
 * En ligne le dimanche 22/11/2026 au soir, après la dernière course de Bastogne, pour ne rien changer
 * pendant la compétition. Avant : aperçu avec l'adresse « …/ESN/#/?espaces=1 » (gardé sur l'appareil).
 */
const SPACES_FROM = Date.parse('2026-11-22T19:00:00Z');
const KEY = 'esn-espaces';

export function spacesEnabled(now = Date.now()): boolean {
  if (now >= SPACES_FROM) return true;
  try {
    const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('espaces');
    if (q === '1') localStorage.setItem(KEY, '1');
    if (q === '0') localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
