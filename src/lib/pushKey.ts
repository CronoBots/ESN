import { normName } from './results';

/**
 * Notifications : un nageur suivi est désigné par une empreinte de son nom et de son année de naissance
 * (jamais en clair). La même empreinte est calculée par l'application (abonnement) et par le robot
 * (résultats officiels), avec l'API de chiffrement standard (navigateur et Node).
 */
export async function swimmerKey(sw: { lastName: string; firstName: string; birthYear?: number }): Promise<string> {
  const text = `esn|${normName(sw.lastName)}|${normName(sw.firstName)}|${sw.birthYear ?? ''}`;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Base des abonnements (Supabase) : adresse et clé publique, uniquement des fonctions limitées. */
export const PUSH_API = {
  url: 'https://pnizdddritizjbsksoir.supabase.co/rest/v1/rpc',
  key: 'sb_publishable_FzetjMxWmdjSaTHWl1uZSg_HhMyErQI',
};

/** Clé publique des notifications (VAPID) ; la clé privée n'est connue que du robot. */
export const VAPID_PUBLIC_KEY = 'BHpSTXzaZx-BfpPDDpSCR-Xki7486MXI8vRJdZtuJjoYsU7OeUXtt7lGceW7QsU8lyuxKzNw8ENwdnbx5M0A8ug';

export async function pushRpc(name: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${PUSH_API.url}/${name}`, {
    method: 'POST',
    headers: { apikey: PUSH_API.key, Authorization: `Bearer ${PUSH_API.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
