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

/**
 * État des notifications sur cet appareil : `inapp` pour le navigateur intégré d'une autre application (lien
 * ouvert depuis WhatsApp, Facebook…), `install` pour un iPhone hors de l'application installée.
 */
export type PushState = 'unsupported' | 'inapp' | 'install' | 'denied' | 'off' | 'on';

/** Type d'appareil, d'après le navigateur. */
export type PushDevice = 'ios' | 'android' | 'other';
export function pushDevice(ua = navigator.userAgent, touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1): PushDevice {
  if (/iphone|ipad|ipod/i.test(ua) || touchMac) return 'ios';
  return /android/i.test(ua) ? 'android' : 'other';
}
/** Navigateur intégré à une autre application (vue web Android, Facebook, Instagram, Google…). */
export const inAppBrowser = (ua = navigator.userAgent) => /; wv\)|FBAN|FBAV|FB_IAB|Instagram|Snapchat|musical_ly|Bytedance|LinkedInApp|Line\/|GSA\//.test(ua);
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
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window) || !window.isSecureContext) {
    if (inAppBrowser()) return 'inapp';
    // iPhone : seulement dans l'application installée sur l'écran d'accueil (iOS 16.4 et plus)
    return pushDevice() === 'ios' && !standalone() ? 'install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  return read(ON) === '1' && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Échec de l'activation : explication pour l'utilisateur et détail technique (nom et message de l'erreur). */
export class PushError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
    /** Étape qui a échoué (rapport de diagnostic). */
    readonly stage = 'inconnue',
  ) {
    super(message);
  }
}

declare const __BUILD_TIME__: string | undefined;
const REPORTED = 'esn-notifications-rapports';

/**
 * Rapport de diagnostic anonyme quand l'activation échoue : étape, erreur du navigateur, appareil (système,
 * navigateur, application installée ou non, autorisation, version de l'application). Aucun nom, aucune
 * adresse de notification. Au plus un rapport par étape toutes les 10 minutes.
 */
export function reportPushProblem(stage: string, detail?: string) {
  const seen: Record<string, number> = (() => {
    try {
      return JSON.parse(read(REPORTED) ?? '{}');
    } catch {
      return {};
    }
  })();
  if (Date.now() - (seen[stage] ?? 0) < 600000) return;
  seen[stage] = Date.now();
  write(REPORTED, JSON.stringify(seen));
  const { device, installed } = env();
  const permission = 'Notification' in window ? Notification.permission : 'absente';
  const build = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__.slice(0, 16) : '?';
  const info = `${device} · ${installed ? 'application installée' : 'navigateur'} · autorisation ${permission} · version ${build} · ${navigator.userAgent}`;
  void pushRpc('esn_push_report', { p_stage: stage, p_detail: detail ?? null, p_device: info }).catch(() => undefined);
}
export const errorDetail = (e: unknown) => (e instanceof Error ? `${e.name} : ${e.message}` : String(e));

interface PushEnv {
  device: PushDevice;
  /** Application installée sur l'écran d'accueil. */
  installed: boolean;
}
const env = (): PushEnv => ({ device: pushDevice(), installed: standalone() });

/** Explication sous l'interrupteur quand il ne peut pas être activé (null sinon). */
export function pushAdvice(state: PushState, { device, installed }: PushEnv = env()): string | null {
  switch (state) {
    case 'inapp':
      return device === 'ios'
        ? 'Cette page est ouverte dans le navigateur d’une autre application (WhatsApp, Facebook, Messenger…), qui ne gère pas les notifications : ouvrez-la dans Safari, ajoutez-la à l’écran d’accueil, puis activez les notifications depuis son icône.'
        : 'Cette page est ouverte dans le navigateur d’une autre application (WhatsApp, Facebook, Messenger…), qui ne gère pas les notifications : ouvrez-la dans Chrome (⋮ › Ouvrir dans Chrome), installez-la sur l’écran d’accueil, puis activez les notifications ici.';
    case 'install':
      return 'Sur iPhone, les notifications ne fonctionnent que dans l’application installée sur l’écran d’accueil (iOS 16.4 ou plus récent) : ouvrez-la depuis son icône, puis activez-les ici.';
    case 'unsupported':
      return device === 'ios'
        ? 'Les notifications demandent iOS 16.4 ou plus récent : mettez l’iPhone à jour (Réglages › Général › Mise à jour logicielle), puis activez-les ici.'
        : device === 'android'
          ? 'Ce navigateur ne gère pas les notifications : ouvrez ESN Compétition dans Chrome (ou Samsung Internet, Firefox), installez-la sur l’écran d’accueil, puis activez-les ici.'
          : 'Les notifications ne sont pas disponibles sur ce navigateur.';
    case 'denied':
      return device === 'ios'
        ? 'Les notifications sont bloquées pour ESN Compétition : Réglages de l’iPhone › Notifications › ESN Compétition › Autoriser les notifications, puis revenez ici.'
        : device === 'android'
          ? installed
            ? 'Les notifications sont bloquées pour ESN Compétition : touchez longuement l’icône de l’application › Infos sur l’appli (ⓘ) › Notifications › Autoriser, puis revenez ici.'
            : 'Les notifications sont bloquées pour ce site : dans Chrome, touchez le cadenas (ou ⓘ) à gauche de l’adresse › Autorisations › Notifications › Autoriser (ou ⋮ › Paramètres › Paramètres des sites › Notifications), puis revenez ici. Vérifiez aussi que Chrome a le droit d’envoyer des notifications (Paramètres du téléphone › Applications › Chrome › Notifications).'
          : 'Les notifications sont bloquées pour ce site : autorisez-les dans les réglages du site (cadenas à gauche de l’adresse), puis revenez ici.';
    default:
      return null;
  }
}

/** Réglage des notifications de l'application installée sur Android (la demande peut ne jamais s'afficher). */
const ANDROID_APP_SETTINGS =
  'appui long sur l’icône ESN Compétition › Infos sur l’appli (ⓘ) › Notifications › Autoriser (si ce menu n’existe pas : Paramètres du téléphone › Applications › Chrome › Notifications)';

/** Pendant la demande d'autorisation. */
export function pushWaitAdvice({ device, installed }: PushEnv = env()): string {
  if (device !== 'android') return 'Touchez « Autoriser » dans la fenêtre qui s’affiche.';
  return installed
    ? `Touchez « Autoriser » dans la fenêtre qui s’affiche. Si rien n’apparaît : ${ANDROID_APP_SETTINGS}, puis revenez ici : l’activation se termine toute seule.`
    : 'Touchez « Autoriser » dans la fenêtre qui s’affiche. Si rien n’apparaît, Chrome a mis la demande de côté : touchez l’icône de cloche ou le cadenas à gauche de l’adresse › Notifications › Autoriser ; l’activation se termine toute seule.';
}

/** Aucune réponse à la demande d'autorisation (fenêtre jamais affichée). */
function noAnswerAdvice({ device, installed }: PushEnv): string {
  if (device !== 'android') return 'Pas de réponse à la demande d’autorisation : si vous avez autorisé entre-temps, touchez à nouveau l’interrupteur.';
  return installed
    ? `Aucune fenêtre d’autorisation ne s’est affichée. Autorisez les notifications dans les réglages du téléphone : ${ANDROID_APP_SETTINGS}. Revenez ensuite ici : l’activation se termine toute seule. Autre solution : ouvrez cronobots.github.io/ESN dans Chrome, touchez l’interrupteur, puis la cloche dans la barre d’adresse › Autoriser.`
    : 'Aucune fenêtre d’autorisation ne s’est affichée : touchez la cloche ou le cadenas à gauche de l’adresse › Notifications › Autoriser ; l’activation se termine toute seule. Sinon : Paramètres du téléphone › Applications › Chrome › Notifications › Autoriser, puis touchez à nouveau l’interrupteur.';
}

/** Autorisation de notifier déjà accordée sur cet appareil (réglages du téléphone ou du site). */
export const permissionGranted = () => 'Notification' in window && Notification.permission === 'granted';

/**
 * Prévient quand l'autorisation de notifier change (accordée dans les réglages, ou demande mise de côté
 * puis acceptée) ; renvoie la fonction d'arrêt.
 */
export function watchPermission(cb: () => void): () => void {
  let status: PermissionStatus | null = null;
  let stopped = false;
  navigator.permissions
    ?.query({ name: 'notifications' })
    .then((st) => {
      if (stopped) return;
      status = st;
      st.onchange = cb;
    })
    .catch(() => undefined);
  return () => {
    stopped = true;
    if (status) status.onchange = null;
  };
}

/** Autorisation ni donnée ni refusée (fenêtre fermée, ou mise de côté par le navigateur). */
function dismissedAdvice({ device, installed }: PushEnv): string {
  return device === 'android' && !installed
    ? 'L’autorisation n’a pas été donnée : réessayez et touchez « Autoriser ». Si aucune fenêtre ne s’affiche, touchez le cadenas (ou la cloche) à gauche de l’adresse › Notifications › Autoriser, puis réessayez.'
    : 'L’autorisation n’a pas été donnée : réessayez et touchez « Autoriser ».';
}

/** Inscription refusée par le service de notification du navigateur (Google pour Chrome sur Android). */
export function subscribeAdvice(e: unknown, device: PushDevice = pushDevice()): string {
  const name = e instanceof Error ? e.name : '';
  const message = e instanceof Error ? e.message : String(e);
  if (name === 'NotAllowedError') return 'Le navigateur refuse l’inscription aux notifications : autorisez-les pour ce site (cadenas à gauche de l’adresse), puis réessayez.';
  // Chrome : notifications interdites au navigateur lui-même (réglages du téléphone) ou navigation privée
  if (/permission denied/i.test(message))
    return device === 'android'
      ? 'Le téléphone n’autorise pas les notifications de Chrome : Paramètres du téléphone › Applications › Chrome (ou ESN Compétition si elle est installée) › Notifications › Autoriser. Elles ne fonctionnent pas non plus en navigation privée. Puis réessayez.'
      : 'Le navigateur n’a pas le droit d’envoyer des notifications (réglages du système, ou navigation privée) : autorisez-les, puis réessayez.';
  if (name === 'AbortError' || /push service|registration failed/i.test(message))
    return device === 'android'
      ? 'Le service de notifications de Google a refusé l’inscription. Il faut les services Google Play à jour (absents des Huawei récents) ; dans Brave, activez Paramètres › Confidentialité et sécurité › « Utiliser les services Google pour les messages push ». Sinon, ouvrez l’application dans Chrome et réessayez.'
      : 'Le service de notifications du navigateur a refusé l’inscription : réessayez dans un moment, ou depuis un autre navigateur.';
  return 'L’inscription aux notifications a échoué : réessayez dans un moment.';
}

/** Promesse limitée dans le temps (le service hors connexion peut ne jamais être prêt). */
function within<T>(p: Promise<T>, ms: number, message: string, stage = 'delai'): Promise<T> {
  const where = (({ device, installed }) => `${device === 'android' ? 'Android' : device === 'ios' ? 'iPhone' : 'ordinateur'} · ${installed ? 'application installée' : 'navigateur'}`)(env());
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new PushError(message, `pas de réponse après ${ms / 1000} s · ${where}`, stage)), ms))]);
}

const followed = (swimmers: Swimmer[]) => swimmers.filter((s) => s.relation === 'child' || s.favorite);

/**
 * Nageurs dont ce téléphone reçoit les notifications : les nageurs suivis, sauf ceux pour lesquels elles
 * sont coupées dans les Réglages (un nageur nouvellement suivi est notifié).
 */
export function pushTargets(state: { swimmers: Swimmer[]; settings: { pushMuted?: string[] } }): Swimmer[] {
  const muted = new Set(state.settings.pushMuted ?? []);
  return followed(state.swimmers).filter((s) => !muted.has(s.id));
}

function keyBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const worker = () =>
  within(navigator.serviceWorker.ready, 15000, 'Le service de l’application n’est pas prêt : fermez puis rouvrez l’application (ou rechargez la page), puis réessayez.', 'service');

async function subscription(create: boolean): Promise<PushSubscription | null> {
  const reg = await worker();
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

/**
 * Active les notifications (à appeler sur un geste de l'utilisateur : demande d'autorisation). Renvoie
 * `on` ou `denied` ; en cas d'échec, une PushError explique quoi faire.
 */
export async function enablePush(swimmers: Swimmer[]): Promise<PushState> {
  let permission: NotificationPermission;
  try {
    // Demande mise de côté par le navigateur (Chrome sur Android) : pas de réponse, l'interrupteur est rendu
    permission = await within(Notification.requestPermission(), 10000, noAnswerAdvice(env()), 'autorisation-sans-reponse');
  } catch (e) {
    if (e instanceof PushError) throw e;
    throw new PushError('La demande d’autorisation n’a pas pu s’afficher : réessayez.', errorDetail(e), 'autorisation-erreur');
  }
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') throw new PushError(dismissedAdvice(env()), `autorisation : ${permission}`, 'autorisation-ignoree');
  let sub: PushSubscription | null;
  try {
    sub = await subscription(true);
  } catch (e) {
    throw e instanceof PushError ? e : new PushError(subscribeAdvice(e), errorDetail(e), 'inscription');
  }
  if (!sub) throw new PushError(subscribeAdvice(null), 'aucun abonnement', 'inscription');
  try {
    await save(sub, swimmers, true);
  } catch (e) {
    throw new PushError('Le serveur du club n’a pas enregistré l’abonnement : vérifiez la connexion internet et réessayez dans un moment.', errorDetail(e), 'serveur');
  }
  write(ON, '1');
  // Confirmation sur le téléphone : les notifications s'affichent bien
  const names = followed(swimmers).map((s) => s.firstName);
  const reg = await worker().catch(() => null);
  await reg
    ?.showNotification('🔔 Notifications activées', {
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

