#!/usr/bin/env node
/**
 * Livetimings publiés ailleurs que sur live.swimrankings.net (par exemple celui de la fédération,
 * resultats.glprod.be, pour les championnats de Belgique) : ces sites n'autorisent pas la lecture
 * depuis une autre application web (pas d'en-têtes CORS), le téléphone ne peut donc pas les lire.
 *
 * Au déploiement (GitHub Actions, toutes les 10 minutes les jours de compétition), ce script copie
 * dans le site, sous live/<id>/, la page et les feuilles PDF des compétitions du calendrier du club
 * qui ont un livetiming (champ « live » de public/data/club-calendar.json). L'application les lit
 * ensuite comme une compétition de live.swimrankings.net (liste dans live/meets.json).
 *
 *   node scripts/mirror-live.mjs --check           écrit « active=true » ou « active=false »
 *                                                  (une compétition à copier aujourd'hui ?)
 *   node scripts/mirror-live.mjs <dist> [cache]    copie dans <dist>/live/ ; [cache] : copies du
 *                                                  passage précédent (requêtes conditionnelles :
 *                                                  seuls les fichiers modifiés sont retéléchargés)
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

/** « https://resultats.glprod.be/CB-bastogne26/ » → « ext-CB-bastogne26 ». */
export function mirrorId(url) {
  const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? new URL(url).hostname;
  return `ext-${last.replace(/[^A-Za-z0-9_-]+/g, '-')}`;
}

/** Compétitions du calendrier à copier aujourd'hui. */
export function activeEvents(calendar, day = today()) {
  return (calendar.events ?? []).filter(
    (e) => typeof e.live === 'string' && /^https:\/\//.test(e.live) && addDays(e.start, -BEFORE) <= day && addDays(e.end ?? e.start, AFTER) >= day,
  );
}

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

async function mirrorMeet(ev, dist, cacheDir, manifest) {
  const id = mirrorId(ev.live);
  const base = ev.live.endsWith('/') ? ev.live : `${ev.live}/`;
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

  const page = await get(base).catch((e) => ({ status: e.message }));
  let html;
  if (page.status === 200) {
    html = page.body.toString('utf8');
    if (keep) writeFileSync(join(keep, 'index.html'), html);
  } else if (keep && existsSync(join(keep, 'index.html'))) {
    // Site momentanément indisponible : la copie précédente reste publiée
    console.warn(`${base} : ${page.status}, copie précédente reprise`);
    cpSync(keep, out, { recursive: true });
    html = readFileSync(join(keep, 'index.html'), 'utf8');
    return meetInfo(ev, id, base, html);
  } else throw new Error(`${base} : ${page.status}`);
  writeFileSync(join(out, 'index.html'), html);
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
  console.log(`${id} : ${files.length} feuilles (${fetched} téléchargées, ${reused} inchangées, ${failed} en échec)`);
  return meetInfo(ev, id, base, html);
}

/** Compétition telle que listée pour l'application (nom publié par l'organisateur, dates et ville du calendrier). */
function meetInfo(ev, id, base, html) {
  const name = (/<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '')
    .replace(/\s*-\s*SPLASH Meet Manager.*$/i, '')
    .replace(/&amp;/g, '&')
    .trim();
  return { id, name: name || ev.name, city: ev.city, course: ev.course ?? 'SCM', startDate: ev.start, endDate: ev.end ?? ev.start, source: base };
}

async function main() {
  const calendar = JSON.parse(readFileSync(CALENDAR, 'utf8'));
  const events = activeEvents(calendar);
  if (process.argv[2] === '--check') {
    console.log(`active=${events.length > 0}`);
    return;
  }
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
