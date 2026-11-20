#!/usr/bin/env node
/**
 * Relais du direct : le planificateur de GitHub (schedule) ne garantit pas ses passages (aucun pendant
 * plus d'une heure le 20/11/2026 au matin). Lancé une fois (à la main, par la session ou par son propre
 * créneau), ce script reste actif jusqu'à ~6 heures : toutes les 2 minutes, il regarde si la page du
 * livetiming des compétitions du jour a changé (le site la réécrit à chaque publication) et, si oui,
 * relance le déploiement (« Déployer sur GitHub Pages »), qui recopie les feuilles dans le site.
 *
 *   node scripts/live-relay.mjs     (GH_TOKEN et GITHUB_REPOSITORY fournis par GitHub Actions)
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { activeEvents } from './mirror-live.mjs';

const CALENDAR = new URL('../public/data/club-calendar.json', import.meta.url);
const UA = 'ESN-Competition/1.0 (application du club, copie des feuilles publiques)';
/** Durée de vie du relais (un passage GitHub Actions est limité à 6 heures). */
const UNTIL = Date.now() + Number(process.env.RELAY_MINUTES ?? 340) * 60000;
const EVERY = 120000;
/** Deux déploiements au moins à 3 minutes d'intervalle (un déploiement dure ~1 minute). */
const GAP = 180000;

const brusselsHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Version de la page d'une compétition : date et contenu (réécrite à chaque publication de feuilles). */
async function pageVersion(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) return `erreur ${res.status}`;
    const body = Buffer.from(await res.arrayBuffer());
    return `${res.headers.get('last-modified') ?? ''} ${createHash('sha1').update(body).digest('hex')}`;
  } catch (e) {
    return `erreur ${e.message}`;
  }
}

function deploy() {
  execFileSync('gh', ['workflow', 'run', 'deploy.yml', '--ref', 'main', '-R', process.env.GITHUB_REPOSITORY ?? 'CronoBots/ESN'], { stdio: 'inherit' });
}

let deployed = null;
let lastDeploy = 0;
while (Date.now() < UNTIL && brusselsHour() >= 6 && brusselsHour() < 22) {
  const events = activeEvents(JSON.parse(readFileSync(CALENDAR, 'utf8')));
  if (!events.length) {
    console.log('Aucune compétition à suivre aujourd’hui.');
    break;
  }
  const versions = await Promise.all(events.map((e) => pageVersion(e.live)));
  const now = versions.join('|');
  const failed = versions.every((v) => v.startsWith('erreur'));
  if (!failed && now !== deployed && Date.now() - lastDeploy > GAP) {
    console.log(`${new Date().toISOString()} : nouvelle publication, déploiement (${versions.map((v) => v.slice(0, 40)).join(' ; ')})`);
    try {
      deploy();
      deployed = now;
      lastDeploy = Date.now();
    } catch (e) {
      console.warn(`Déploiement non lancé : ${e.message}`);
    }
  }
  await sleep(EVERY);
}
console.log('Fin du relais.');
