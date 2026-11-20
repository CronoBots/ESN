#!/usr/bin/env node
/**
 * Livetimings publiés ailleurs que sur live.swimrankings.net (par exemple celui de la fédération,
 * resultats.glprod.be, pour les championnats de Belgique) : ces sites n'autorisent pas la lecture
 * depuis une autre application web (pas d'en-têtes CORS), le téléphone ne peut donc pas les lire.
 *
 * Au déploiement (GitHub Actions, toutes les 5 minutes les jours de compétition), ce script copie
 * dans le site, sous live/<id>/, la page et les feuilles PDF des compétitions du calendrier du club
 * qui ont un livetiming (champ « live » de public/data/club-calendar.json). L'application les lit
 * ensuite comme une compétition de live.swimrankings.net (liste dans live/meets.json).
 *
 * Compétition du calendrier sans « live » : le lien « Résultats live » que le district LNL publie peu
 * avant, sur la page de la compétition (lnl.glprod.be/publication/<n>/), est cherché tout seul, de
 * 7 jours avant au dernier jour, au plus toutes les 30 minutes, jusqu'à ce qu'il soit trouvé.
 *
 *   node scripts/mirror-live.mjs --check [liens]   écrit « active=true » ou « active=false » (une
 *                                                  compétition à copier aujourd'hui ?) et « links= »
 *                                                  (liens trouvés sur le site du district) ; [liens] :
 *                                                  dossier gardé d'un passage à l'autre (liens trouvés,
 *                                                  heure de la dernière recherche)
 *   node scripts/mirror-live.mjs <dist> [cache]    copie dans <dist>/live/ ; [cache] : copies du
 *                                                  passage précédent (requêtes conditionnelles :
 *                                                  seuls les fichiers modifiés sont retéléchargés) ;
 *                                                  liens trouvés lus dans la variable LIVE_LINKS
 */
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CALENDAR = new URL('../public/data/club-calendar.json', import.meta.url);
/** Copie commencée 2 jours avant (listes de départ), gardée 14 jours après (résultats corrigés). */
const BEFORE = 2;
const AFTER = 14;
const UA = 'ESN-Competition/1.0 (application du club, copie des feuilles publiques)';

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Date du jour en Belgique. */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());

/**
 * Dossier de la page du livetiming : « https://resultats.glprod.be/X/index.html » (lien publié par le
 * district) → « https://resultats.glprod.be/X/ ».
 */
export function liveBase(url) {
  const u = new URL(url);
  let path = u.pathname.replace(/\/index\.html?$/i, '/');
  if (!path.endsWith('/')) path += '/';
  return `${u.origin}${path}`;
}

/** « https://resultats.glprod.be/CB-bastogne26/ » → « ext-CB-bastogne26 ». */
export function mirrorId(url) {
  const base = new URL(liveBase(url));
  const last = base.pathname.split('/').filter(Boolean).pop() ?? base.hostname;
  return `ext-${last.replace(/[^A-Za-z0-9_-]+/g, '-')}`;
}

/** Compétitions du calendrier à copier aujourd'hui. */
export function activeEvents(calendar, day = today()) {
  return (calendar.events ?? []).filter(
    (e) => typeof e.live === 'string' && /^https:\/\//.test(e.live) && addDays(e.start, -BEFORE) <= day && addDays(e.end ?? e.start, AFTER) >= day,
  );
}

/* ------------------------------------------------------------------------ */
/* Liens de livetiming publiés par le district LNL                           */
/* ------------------------------------------------------------------------ */

const LNL = 'https://lnl.glprod.be';
/** Recherche de 7 jours avant au dernier jour de la compétition, au plus toutes les 30 minutes. */
const LOOKUP_BEFORE = 7;
const LOOKUP_EVERY = 30 * 60 * 1000;

/** Compétition du calendrier (clé des liens trouvés). */
export const eventKey = (e) => `${e.start}|${e.name}`;

const decode = (s) =>
  s
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&rsquo;|&#8217;|&#39;|&apos;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
const plain = (html) => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const isoDate = (d, m, y) => `${y}-${m}-${d}`;

/**
 * Compétitions d'une page du calendrier du district (lnl.glprod.be/calendrier/?month=AAAA-MM) :
 * page de la compétition, nom, organisateur (« Natation · FFBN »), dates.
 */
export function parseLnlCalendar(html) {
  const out = [];
  for (const [, block] of html.matchAll(/<article\b[^>]*class="[^"]*\bevent-row\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi)) {
    const link = /href="(?:https:\/\/lnl\.glprod\.be)?(\/publication\/\d+\/?)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const dates = /(\d{2})\/(\d{2})\/(\d{4})(?:\s*[—–-]\s*(\d{2})\/(\d{2})\/(\d{4}))?/.exec(plain(block));
    if (!link || !dates) continue;
    const start = isoDate(dates[1], dates[2], dates[3]);
    out.push({
      path: link[1].endsWith('/') ? link[1] : `${link[1]}/`,
      name: plain(link[2]),
      tag: plain(/<span\b[^>]*class="[^"]*\btag\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block)?.[1] ?? ''),
      start,
      end: dates[4] ? isoDate(dates[4], dates[5], dates[6]) : start,
    });
  }
  return out;
}

/** Mots qui ne distinguent pas une compétition d'une autre. */
const COMMON = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'en', 'a', 'au', 'aux', 'm', 'ans', 'plus', 'natation', 'championnat', 'championnats', 'meeting']);
const words = (s) =>
  new Set(
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !COMMON.has(w)),
  );

/**
 * Compétition du district qui correspond à celle du calendrier du club : dates qui se recouvrent, et
 * au moins un mot en commun (nom, ville ou organisateur : « FFBN », « 25 », « Jeunes », « Waremme »…).
 * Deux compétitions aussi proches l'une que l'autre : aucune (on ne devine pas).
 */
export function matchPublication(ev, entries) {
  const end = ev.end ?? ev.start;
  const mine = words(`${ev.name} ${ev.city ?? ''}`);
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const p of entries) {
    if (p.start > end || p.end < ev.start) continue;
    const theirs = words(`${p.name} ${p.tag}`);
    const common = [...mine].filter((w) => theirs.has(w)).length;
    if (!common) continue;
    const score = common + (p.start === ev.start ? 0.5 : 0);
    if (score > bestScore) [best, bestScore, tie] = [p, score, false];
    else if (score === bestScore) tie = true;
  }
  return tie ? null : best;
}

/**
 * Lien « Résultats live » de la page d'une compétition du district : page Splash Meet Manager de
 * resultats.glprod.be (« https://resultats.glprod.be/<dossier>/index.html »). Seulement un lien marqué
 * « live » : un autre lien vers ce site (résultats d'une édition passée) n'est pas le livetiming.
 */
export function findLiveLink(html) {
  for (const [, href, label] of html.matchAll(/<a\b[^>]*href="(https:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (!/\blive(?:timing)?\b/i.test(plain(label))) continue;
    let u;
    try {
      u = new URL(decode(href));
    } catch {
      continue;
    }
    if (u.hostname === 'resultats.glprod.be' && /^\/[^/]+\/(?:index\.html?)?$/i.test(u.pathname)) return liveBase(u.href);
  }
  return null;
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} : ${res.status}`);
  return res.text();
}

/**
 * Cherche sur le site du district le lien de livetiming des compétitions du calendrier qui n'en ont
 * pas (de 7 jours avant au dernier jour, au plus toutes les 30 minutes, jusqu'à ce qu'il soit trouvé).
 * `state` (gardé d'un passage à l'autre) : { [clé]: { checked, live?, publication? } }, mis à jour.
 * Une page du calendrier par mois, puis la page de la compétition ; une requête à la fois.
 * Renvoie true si `state` a changé.
 */
export async function findLiveLinks(calendar, state, { day = today(), now = Date.now(), fetchText = getText, pause = 1000 } = {}) {
  const events = calendar.events ?? [];
  let changed = false;
  // Compétitions retirées du calendrier ou finies depuis longtemps : oubliées
  const keys = new Map(events.map((e) => [eventKey(e), e]));
  for (const k of Object.keys(state)) {
    const e = keys.get(k);
    if (!e || addDays(e.end ?? e.start, AFTER + 1) < day) {
      delete state[k];
      changed = true;
    }
  }
  const todo = events.filter((e) => {
    const s = state[eventKey(e)];
    return !e.live && !s?.live && addDays(e.start, -LOOKUP_BEFORE) <= day && (e.end ?? e.start) >= day && now - (s?.checked ?? 0) >= LOOKUP_EVERY;
  });
  const months = new Map();
  let requests = 0;
  const polite = async (url) => {
    if (requests++ && pause) await new Promise((r) => setTimeout(r, pause));
    return fetchText(url);
  };
  for (const e of todo) {
    const month = e.start.slice(0, 7);
    if (!months.has(month))
      months.set(
        month,
        await polite(`${LNL}/calendrier/?month=${month}&view=list`)
          .then(parseLnlCalendar)
          .catch((err) => (console.warn(`Calendrier du district (${month}) illisible : ${err.message}`), [])),
      );
    const entry = { checked: now };
    const pub = matchPublication(e, months.get(month));
    if (pub) {
      const live = await polite(LNL + pub.path)
        .then(findLiveLink)
        .catch((err) => (console.warn(`Page ${pub.path} du district illisible : ${err.message}`), null));
      if (live) Object.assign(entry, { live, publication: pub.path });
    }
    console.warn(`${e.name} (${e.start}) : ${entry.live ? `livetiming trouvé (${entry.live})` : pub ? `pas encore de livetiming (${pub.path})` : 'pas au calendrier du district'}`);
    state[eventKey(e)] = entry;
    changed = true;
  }
  return changed;
}

/** Liens trouvés (variable LIVE_LINKS) ajoutés aux compétitions du calendrier qui n'en ont pas. */
export function withLinks(calendar, links) {
  return {
    ...calendar,
    events: (calendar.events ?? []).map((e) => {
      const url = links?.[eventKey(e)];
      return !e.live && typeof url === 'string' && /^https:\/\/resultats\.glprod\.be\//.test(url) ? { ...e, live: url } : e;
    }),
  };
}

/** Liens trouvés des compétitions du calendrier. */
const foundLinks = (calendar, state) =>
  Object.fromEntries((calendar.events ?? []).filter((e) => !e.live && state[eventKey(e)]?.live).map((e) => [eventKey(e), state[eventKey(e)].live]));

/** Feuilles de la page d'une compétition (Splash Meet Manager) : listes de départ, résultats, statistiques, LENEX. */
export function meetFiles(html) {
  const files = new Set();
  for (const m of html.matchAll(/href="([^"/?#:]+\.(?:pdf|lxf))"/gi)) {
    if (/^(StartList|ResultList)_\d+\.pdf$|^EntryStatistics\.pdf$|\.lxf$/i.test(m[1])) files.add(m[1]);
  }
  return [...files];
}

async function get(url, cached) {
  const headers = { 'User-Agent': UA };
  if (cached?.etag) headers['If-None-Match'] = cached.etag;
  if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
      if (res.status === 304) return { status: 304 };
      if (!res.ok) return { status: res.status };
      return { status: 200, body: Buffer.from(await res.arrayBuffer()), etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
    } catch (e) {
      if (attempt >= 1) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export async function mirrorMeet(ev, dist, cacheDir, manifest) {
  const id = mirrorId(ev.live);
  const base = liveBase(ev.live);
  const out = join(dist, 'live', id);
  const keep = cacheDir ? join(cacheDir, id) : null;
  mkdirSync(out, { recursive: true });
  if (keep) mkdirSync(keep, { recursive: true });
  let fetched = 0;
  let reused = 0;

  /** Télécharge un fichier (ou reprend la copie précédente s'il n'a pas changé). */
  const one = async (file, saveAs = file) => {
    const url = base + file;
    const prev = keep && existsSync(join(keep, saveAs)) ? manifest[url] : undefined;
    const r = await get(url, prev);
    if (r.status === 304 && prev) {
      copyFileSync(join(keep, saveAs), join(out, saveAs));
      reused++;
      return true;
    }
    if (r.status !== 200) return false;
    writeFileSync(join(out, saveAs), r.body);
    if (keep) {
      writeFileSync(join(keep, saveAs), r.body);
      manifest[url] = { etag: r.etag ?? undefined, lastModified: r.lastModified ?? undefined };
    }
    fetched++;
    return true;
  };

  let html;
  if (await one('', 'index.html').catch(() => false)) {
    html = readFileSync(join(out, 'index.html'), 'utf8');
  } else if (keep && existsSync(join(keep, 'index.html'))) {
    // Site momentanément indisponible : la copie précédente reste publiée
    console.warn(`${base} indisponible, copie précédente reprise`);
    cpSync(keep, out, { recursive: true });
    html = readFileSync(join(keep, 'index.html'), 'utf8');
    writeVersions(out, meetFiles(html));
    return meetInfo(ev, id, base, html);
  } else throw new Error(`${base} indisponible`);
  const files = meetFiles(html);
  // Fichier LENEX éventuel : aussi sous le nom lu par l'application (results.lxf)
  const lenex = files.find((f) => /\.lxf$/i.test(f));
  const queue = [...files];
  let failed = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const f = queue.shift();
        if (!(await one(f).catch(() => false))) failed++;
      }
    }),
  );
  if (lenex && lenex !== 'results.lxf' && existsSync(join(out, lenex))) copyFileSync(join(out, lenex), join(out, 'results.lxf'));
  writeVersions(out, lenex ? [...files, 'results.lxf'] : files);
  console.log(`${id} : ${files.length} feuilles (${fetched} téléchargées, ${reused} inchangées, ${failed} en échec)`);
  return meetInfo(ev, id, base, html);
}

/**
 * Liste des feuilles avec l'empreinte de leur contenu (files.json). GitHub Pages remet tous les fichiers à
 * la date du déploiement : sans cette liste, les téléphones retéléchargeraient chaque feuille toutes les
 * 5 minutes. L'application ne lit que les feuilles dont l'empreinte a changé (et pas la page, lourde).
 */
function writeVersions(out, files) {
  const versions = {};
  for (const f of files) if (existsSync(join(out, f))) versions[f] = createHash('sha1').update(readFileSync(join(out, f))).digest('hex').slice(0, 16);
  writeFileSync(join(out, 'files.json'), JSON.stringify({ files: versions }));
}

/** Compétition telle que listée pour l'application (nom publié par l'organisateur, dates et ville du calendrier). */
function meetInfo(ev, id, base, html) {
  const name = (/<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '')
    .replace(/\s*-\s*SPLASH Meet Manager.*$/i, '')
    .replace(/&amp;/g, '&')
    .trim();
  return { id, name: name || ev.name, city: ev.city, course: ev.course ?? 'SCM', startDate: ev.start, endDate: ev.end ?? ev.start, source: base };
}

/**
 * --check : liens cherchés sur le site du district (sortie du job, lue par la copie : LIVE_LINKS).
 * Seules les lignes « clé=valeur » vont sur la sortie standard (fichier GITHUB_OUTPUT) ; le journal, sur la sortie d'erreur.
 */
async function check(calendar, linksDir) {
  const file = linksDir ? join(linksDir, 'links.json') : null;
  let state = {};
  try {
    if (file && existsSync(file)) state = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    state = {};
  }
  let changed = false;
  try {
    changed = await findLiveLinks(calendar, state);
  } catch (e) {
    // Site du district indisponible : on réessaiera au passage suivant
    console.warn(`Recherche des liens de livetiming : ${e.message}`);
  }
  if (file && changed) {
    mkdirSync(linksDir, { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 1));
  }
  const links = foundLinks(calendar, state);
  console.log(`active=${activeEvents(withLinks(calendar, links)).length > 0}`);
  console.log(`links=${JSON.stringify(links)}`);
  console.log(`changed=${Boolean(file && changed)}`);
}

/** Liens trouvés par --check (variable LIVE_LINKS), illisibles : ignorés. */
function envLinks() {
  try {
    const v = JSON.parse(process.env.LIVE_LINKS || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

async function main() {
  const calendar = JSON.parse(readFileSync(CALENDAR, 'utf8'));
  if (process.argv[2] === '--check') return check(calendar, process.argv[3]);
  const events = activeEvents(withLinks(calendar, envLinks()));
  const dist = process.argv[2];
  if (!dist) throw new Error('Usage : node scripts/mirror-live.mjs <dist> [cache]');
  const cacheDir = process.argv[3];
  const manifestFile = cacheDir ? join(cacheDir, 'manifest.json') : null;
  if (cacheDir) mkdirSync(cacheDir, { recursive: true });
  const manifest = manifestFile && existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};
  const meets = [];
  for (const ev of events) {
    try {
      meets.push(await mirrorMeet(ev, dist, cacheDir, manifest));
    } catch (e) {
      // Livetiming indisponible : le reste du site est quand même publié
      console.warn(`Livetiming non copié (${ev.live}) : ${e.message}`);
    }
  }
  mkdirSync(join(dist, 'live'), { recursive: true });
  writeFileSync(join(dist, 'live', 'meets.json'), JSON.stringify({ updated: new Date().toISOString(), meets }, null, 1));
  if (manifestFile) writeFileSync(manifestFile, JSON.stringify(manifest));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
