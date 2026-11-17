/**
 * Lien d'invitation : l'adresse de l'application avec le code du club, pour
 * ouvrir l'application déjà connectée au club, sans code à taper.
 *
 * Le code voyage après le « # » : il n'est jamais envoyé au serveur qui
 * héberge le site, il reste dans le navigateur.
 */

/** Adresse de l'application (sans page ni paramètre). */
export function appBaseUrl(): string {
  return `${location.origin}${location.pathname}`;
}

export function inviteLink(code: string): string {
  return `${appBaseUrl()}#/club?code=${encodeURIComponent(code)}`;
}

/**
 * Code du club dans un texte collé : lien d'invitation complet, message
 * WhatsApp qui le contient, ou code seul (« ESN-7KQ4-M2XP »).
 */
export function codeFromText(text: string): string | null {
  const t = text.trim();
  const fromLink = /[?&]code=([^&\s#]+)/.exec(t);
  if (fromLink) return decodeURIComponent(fromLink[1]).toUpperCase();
  const bare = /\b(ESN[-\s]?[A-Z2-9]{4}[-\s]?[A-Z2-9]{4})\b/i.exec(t);
  return bare ? bare[1].toUpperCase() : null;
}
