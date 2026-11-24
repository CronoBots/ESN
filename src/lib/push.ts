import type { Swimmer } from '../store/types';
import { pushRpc, swimmerKey, VAPID_PUBLIC_KEY } from './pushKey';

/*
 * Notifications des résultats des nageurs suivis (Web Push). L'application s'abonne avec les empreintes
 * de ses nageurs suivis ; le robot du club lit les résultats officiels et envoie une notification par
 * résultat. Rien d'autre n'est envoyé : ni nom, ni e-mail.
 */

const ON = 'esn-notifications';
const KINDS = 'esn-notifications-types';

/** Types de notification : résultats (tous, ou records perso seulement) et programme (engagements, finales). */
export interface PushPrefs {
  results: 'all' | 'pb' | 'none';
  entries: boolean;
}
export function pushPrefs(): PushPrefs {
  try {
    const p = JSON.parse(read(KINDS) ?? '{}') as Partial<PushPrefs>;
    return { results: p.results === 'pb' || p.results === 'none' ? p.results : 'all', entries: p.entries !== false };
  } catch {
    return { results: 'all', entries: true };
  }
}
const kindsOf = (p: PushPrefs) => [...(p.results === 'all' ? ['results'] : p.results === 'pb' ? ['pb'] : []), ...(p.entries ? ['entries'] : [])];
const SENT = 'esn-notifications-envoye';
const LIVE = 'esn-direct-signale';

export type PushState = 'unsupported' | 'install' | 'denied' | 'off' | 'on';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible */
  }
}

/** État des notifications sur cet appareil. */
export function pushState(): PushState {
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !window.isSecureContext) return 'unsupported';
  // iPhone : seulement dans l'application installée sur l'écran d'accueil (iOS 16.4 et plus)
  if (!('PushManager' in window)) return isIos() && !standalone() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return read(ON) === '1' && Notification.permission === 'granted' ? 'on' : 'off';
}

const followed = (swimmers: Swimmer[]) => swimmers.filter((s) => s.relation === 'child' || s.favorite);

function keyBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function subscription(create: boolean): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  const cur = await reg.pushManager.getSubscription();
  if (cur || !create) return cur;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) as BufferSource });
}

/** Envoie l'abonnement et les nageurs suivis (seulement s'ils ont changé, sauf `force`). */
async function save(sub: PushSubscription, swimmers: Swimmer[], force = false) {
  const keys = (await Promise.all(followed(swimmers).map(swimmerKey))).sort();
  const kinds = kindsOf(pushPrefs());
  const json = sub.toJSON();
  const sig = `${json.endpoint}|${keys.join(',')}|${kinds.join(',')}`;
  if (!force && read(SENT) === sig) return;
  const res = await pushRpc('esn_push_subscribe', { p_endpoint: json.endpoint, p_p256dh: json.keys?.p256dh, p_auth: json.keys?.auth, p_swimmers: keys, p_kinds: kinds });
  if (!res.ok) throw new Error(`Abonnement refusé (${res.status})`);
  write(SENT, sig);
}

/** Active les notifications (à appeler sur un geste de l'utilisateur : demande d'autorisation). */
export async function enablePush(swimmers: Swimmer[]): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const sub = await subscription(true);
  if (!sub) return 'off';
  await save(sub, swimmers, true);
  write(ON, '1');
  // Confirmation sur le téléphone : les notifications s'affichent bien
  const names = followed(swimmers).map((s) => s.firstName);
  const reg = await navigator.serviceWorker.ready;
  await reg
    .showNotification('🔔 Notifications activées', {
      body: names.length ? `Vous recevrez les résultats de ${names.join(', ')} pendant les compétitions.` : 'Suivez des nageurs pour recevoir leurs résultats.',
      icon: './icons/icon-192.png',
      tag: 'esn-activation',
    })
    .catch(() => undefined);
  return 'on';
}

export async function disablePush(): Promise<void> {
  write(ON, null);
  write(SENT, null);
  const sub = await subscription(false).catch(() => null);
  if (!sub) return;
  await pushRpc('esn_push_unsubscribe', { p_endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

/** Au lancement et quand les nageurs suivis changent : abonnement tenu à jour (renouvelé s'il a expiré). */
export async function refreshPush(swimmers: Swimmer[]): Promise<void> {
  if (pushState() !== 'on') return;
  const sub = await subscription(true);
  if (sub) await save(sub, swimmers);
}

/**
 * Compétition en direct de live.swimrankings.net où nagent des nageurs du club : signalée au robot
 * (la liste des compétitions de ce site n'est lisible que dans un navigateur). Une fois par heure au plus.
 */
export function reportLiveMeet(liveId: string) {
  const seen: Record<string, number> = (() => {
    try {
      return JSON.parse(read(LIVE) ?? '{}');
    } catch {
      return {};
    }
  })();
  if (Date.now() - (seen[liveId] ?? 0) < 3600000) return;
  seen[liveId] = Date.now();
  for (const k of Object.keys(seen)) if (Date.now() - seen[k] > 7 * 86400000) delete seen[k];
  write(LIVE, JSON.stringify(seen));
  void pushRpc('esn_report_live_meet', { p_live_id: liveId }).catch(() => undefined);
}

/** Change les types de notification ; l'abonnement est mis à jour tout de suite. */
export async function setPushPrefs(prefs: PushPrefs, swimmers: Swimmer[]): Promise<void> {
  write(KINDS, JSON.stringify(prefs));
  await refreshPush(swimmers);
}

