#!/usr/bin/env node
/**
 * Relais du direct : le planificateur de GitHub (schedule) ne garantit pas ses passages (aucun pendant
 * plus d'une heure le 20/11/2026 au matin). Lancé une fois (à la main ou par un de ses créneaux), ce
 * script reste actif jusqu'à ~6 heures : de 6 h à 22 h, toutes les minutes, il regarde si la page du
 * livetiming des compétitions du jour a changé (le site la réécrit à chaque publication) et, si oui,
 * relance le déploiement (« Déployer sur GitHub Pages »), qui recopie les feuilles dans le site :
 * tout de suite pour une nouvelle feuille de résultats, au plus toutes les 3 minutes sinon.
 * Avant de s'arrêter, il lance son successeur tant qu'une compétition est à suivre aujourd'hui ou demain.
 *
 *   node scripts/live-relay.mjs     (GH_TOKEN et GITHUB_REPOSITORY fournis par GitHub Actions)
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { activeEvents, eventKey, meetFiles, withLinks } from './mirror-live.mjs';

const CALENDAR = new URL('../public/data/club-calendar.json', import.meta.url);
const UA = 'ESN-Competition/1.0 (application du club, copie des feuilles publiques)';
/** Durée de vie du relais (un passage GitHub Actions est limité à 6 heures). */
const UNTIL = Date.now() + Number(process.env.RELAY_MINUTES ?? 340) * 60000;
const EVERY = 60000;
/** Deux déploiements au moins à 3 minutes d'intervalle (un déploiement dure ~1 minute)... */
export const GAP = 180000;
/** ... sauf pour une nouvelle feuille de résultats : dès 75 s après le début du précédent. */
export const RESULT_GAP = 75000;

/**
 * Déployer maintenant ? Page changée depuis le dernier déploiement, et assez de temps écoulé depuis :
 * 75 s si une feuille de résultats inconnue au dernier déploiement est apparue, 3 minutes sinon.
 */
export function shouldDeploy({ changed, newResult, sinceLast }) {
  return changed && sinceLast > (newResult ? RESULT_GAP : GAP);
}

/** Feuilles de résultats (ResultList_N.pdf) d'une page de livetiming. */
export const resultSheets = (html) => meetFiles(html).filter((f) => /^ResultList_\d+\.pdf$/i.test(f));

const brusselsHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Version de la page d'une compétition : date et contenu (réécrite à chaque publication de feuilles),
 * et ses feuilles de résultats.
 */
async function pageVersion(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) return { version: `erreur ${res.status}`, results: [] };
    const body = Buffer.from(await res.arrayBuffer());
    return { version: `${res.headers.get('last-modified') ?? ''} ${createHash('sha1').update(body).digest('hex')}`, results: resultSheets(body.toString('latin1')).map((f) => url + f) };
  } catch (e) {
    return { version: `erreur ${e.message}`, results: [] };
  }
}

/** Liens de livetiming trouvés par le robot sur le site du district (cache .live-links/links.json). */
function foundLinks(calendar) {
  try {
    const state = JSON.parse(readFileSync('.live-links/links.json', 'utf8'));
    return Object.fromEntries((calendar.events ?? []).filter((e) => !e.live && state[eventKey(e)]?.live).map((e) => [eventKey(e), state[eventKey(e)].live]));
  } catch {
    return {};
  }
}

function deploy() {
  execFileSync('gh', ['workflow', 'run', 'deploy.yml', '--ref', 'main', '-R', process.env.GITHUB_REPOSITORY ?? 'CronoBots/ESN'], { stdio: 'inherit' });
}

/** Date en Belgique (« 2026-11-20 »), décalée de `days` jours. */
const brusselsDay = (days = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date(Date.now() + days * 86400000));

/** Compétitions du club (avec livetiming) en cours ce jour-là, veille comprise. */
function followedOn(day) {
  const calendar = JSON.parse(readFileSync(CALENDAR, 'utf8'));
  const prev = (iso) => new Date(Date.parse(`${iso}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  return activeEvents(withLinks(calendar, foundLinks(calendar)), day).filter((e) => prev(e.start) <= day && (e.end ?? e.start) >= day);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
let deployed = null;
let lastDeploy = 0;
/** Feuilles de résultats déjà présentes lors d'un déploiement. */
const known = new Set();
while (Date.now() < UNTIL) {
  const events = followedOn(brusselsDay());
  if (!events.length && !followedOn(brusselsDay(1)).length) {
    console.log('Aucune compétition à suivre aujourd’hui ni demain.');
    break;
  }
  // La nuit (22 h - 6 h) : en attente, sans rien interroger
  if (!events.length || brusselsHour() < 6 || brusselsHour() >= 22) {
    await sleep(10 * 60000);
    continue;
  }
  const pages = await Promise.all(events.map((e) => pageVersion(e.live)));
  const versions = pages.map((p) => p.version);
  const results = pages.flatMap((p) => p.results);
  const now = versions.join('|');
  const failed = versions.every((v) => v.startsWith('erreur'));
  const newResult = results.some((r) => !known.has(r));
  if (!failed && shouldDeploy({ changed: now !== deployed, newResult, sinceLast: Date.now() - lastDeploy })) {
    console.log(`${new Date().toISOString()} : ${newResult ? 'nouvelle feuille de résultats' : 'nouvelle publication'}, déploiement (${versions.map((v) => v.slice(0, 40)).join(' ; ')})`);
    try {
      deploy();
      deployed = now;
      lastDeploy = Date.now();
      for (const r of results) known.add(r);
    } catch (e) {
      console.warn(`Déploiement non lancé : ${e.message}`);
    }
  }
  await sleep(EVERY);
}

// Relève : tant qu'une compétition est à suivre aujourd'hui ou demain, un nouveau relais est lancé ; il
// attend la fin de celui-ci (une seule exécution à la fois) et prend le relais, sans dépendre du planificateur
if (process.env.GITHUB_ACTIONS && (followedOn(brusselsDay()).length || followedOn(brusselsDay(1)).length)) {
  try {
    execFileSync('gh', ['workflow', 'run', 'live-relay.yml', '--ref', 'main', '-R', process.env.GITHUB_REPOSITORY ?? 'CronoBots/ESN'], { stdio: 'inherit' });
    console.log('Relais suivant lancé.');
  } catch (e) {
    console.warn(`Relais suivant non lancé : ${e.message}`);
  }
}
console.log('Fin du relais.');
}
