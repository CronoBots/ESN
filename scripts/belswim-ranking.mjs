#!/usr/bin/env node
/**
 * Classement officiel des championnats de Belgique 11-16 ans (outil « Belswim ranking » de la fédération).
 *
 * La fédération classe tous les jeunes de Belgique aux points, par catégorie et par sexe, et colore en vert
 * les sélectionnés (« leur participation est assurée ») ; les nageurs retirés sont barrés. Ce robot lit ce
 * classement (au plus toutes les 6 heures, la page fait ~3 Mo) et n'en garde que :
 *   - par catégorie et par sexe : nombre de classés, de sélectionnés, et le dernier sélectionné (rang, total) ;
 *   - pour les nageurs de l'ESN : rang, total, sélectionné ou non, retiré ou non, désignés par une empreinte
 *     de leur nom et de leur année de naissance (la même que l'application calcule), jamais en clair.
 * Le fichier est écrit dans le site construit (data/belswim-ranking.json), comme le livetiming copié.
 *
 *   node scripts/belswim-ranking.mjs dist .belswim-cache     (sortie : changed=true|false, pour GitHub Actions)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RANKING_PAGE = 'https://www.belswim.be/prestaties/pub_clubs-cbkj25.php';
/** Page d'un club : tout le classement, les nageurs du club surlignés. */
export const RANKING_URL = 'https://www.belswim.be/prestaties/pub_cbkj25.php?c=ESN';
const CLUB = 'ESN';
const UA = 'ESN-Competition/1.0 (application du club, classement public de la fédération)';
/** Relecture au plus toutes les 6 heures. */
const MAX_AGE = 6 * 3600000;

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

/** Même normalisation que l'application (src/lib/results.ts : normName). */
export const normName = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

/** Même empreinte que l'application (src/lib/pushKey.ts : swimmerKey). */
export function swimmerKey(lastName, firstName, birthYear) {
  return createHash('sha256').update(`esn|${normName(lastName)}|${normName(firstName)}|${birthYear ?? ''}`).digest('hex').slice(0, 24);
}

/**
 * « Nom Prénom » de la fédération : le nom peut avoir plusieurs mots (« Van Damme Lucie »). Toutes les
 * coupures possibles sont gardées ; l'application retrouve la sienne.
 */
export function nameSplits(full) {
  const words = full.trim().split(/\s+/);
  const out = [];
  for (let i = 1; i < words.length; i++) out.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
  return out;
}

const text = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();

/** « 1er novembre 2026 » → « 2026-11-01 ». */
function frenchDate(day, month, year) {
  const m = MONTHS.indexOf(normName(month));
  return m < 0 ? null : `${year}-${String(m + 1).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`;
}

/** Lit la page du classement : édition, période, catégories et nageurs du club. */
export function parseRanking(html, club = CLUB) {
  const edition = Number(/Ranking\s+CB-BK\s+11-16\s+25m\s+(\d{4})/i.exec(html)?.[1] ?? /CB\s*-\s*BK\s+11-16\s+25m\s+(\d{4})/i.exec(html)?.[1]);
  if (!edition) throw new Error('Édition du classement introuvable');
  const p = /P[ée]riode du (\d+)(?:er)? (\S+) (\d{4}) au (\d+)(?:er)? (\S+) (\d{4})/i.exec(text(html));
  const period = p ? { from: frenchDate(p[1], p[2], p[3]), to: frenchDate(p[4], p[5], p[6]) } : null;
  const categories = {};
  const swimmers = [];
  let cat = null;
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = m[1];
    const anchor = /<a id="(\d+-\d+)_([MV])"/.exec(row);
    if (anchor) {
      cat = { age: anchor[1], gender: anchor[2] === 'V' ? 'F' : 'M' };
      continue;
    }
    if (!cat) continue;
    const cells = [...row.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)];
    if (cells.length < 8) continue;
    const rank = Number(text(cells[0][2]));
    if (!Number.isInteger(rank) || rank <= 0) continue;
    // Vert = sélectionné ; barré = retiré (ne compte plus pour la sélection)
    const selected = /32CD32/i.test(cells[0][1]);
    const scratched = /class=['"]geschrapt['"]/.test(cells[1][2]);
    const total = Number(text(cells[cells.length - 1][2])) || 0;
    const byCat = (categories[cat.age] ??= {});
    const stats = (byCat[cat.gender] ??= { listed: 0, ranked: 0, selected: 0, last: null });
    stats.listed++;
    if (total > 0) stats.ranked++;
    if (selected) {
      stats.selected++;
      if (!stats.last || total < stats.last.total || (total === stats.last.total && rank > stats.last.rank)) stats.last = { rank, total };
    }
    const license = text(cells[2][2]);
    if (license.split('/')[0] !== club) continue;
    swimmers.push({ name: text(cells[1][2]), year: Number(text(cells[4][2])), cat: cat.age, gender: cat.gender, rank, total, selected, scratched });
  }
  return { edition, period, categories, swimmers };
}

/** Fichier publié : nageurs du club désignés par leur empreinte (toutes les coupures du nom). */
export function publicRanking(parsed, fetched) {
  const swimmers = {};
  for (const s of parsed.swimmers) {
    const entry = { cat: s.cat, gender: s.gender, rank: s.total > 0 ? s.rank : null, total: s.total, selected: s.selected, scratched: s.scratched };
    for (const [last, first] of nameSplits(s.name)) swimmers[swimmerKey(last, first, s.year)] = entry;
  }
  return { edition: parsed.edition, period: parsed.period, fetched, source: RANKING_PAGE, categories: parsed.categories, swimmers };
}

async function main(dist, cacheDir) {
  mkdirSync(cacheDir, { recursive: true });
  const cacheFile = join(cacheDir, 'ranking.json');
  const cached = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : null;
  let out = cached;
  let changed = false;
  if (!cached || Date.now() - Date.parse(cached.fetched) > MAX_AGE) {
    try {
      const res = await fetch(RANKING_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Page annoncée en ISO-8859-1 mais servie en UTF-8 : UTF-8 d'abord, ISO-8859-1 s'il n'est pas valide
      const bytes = await res.arrayBuffer();
      let html;
      try {
        html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        html = new TextDecoder('latin1').decode(bytes);
      }
      out = publicRanking(parseRanking(html), new Date().toISOString());
      changed = true;
      console.error(`Classement ${out.edition} lu : ${Object.keys(out.swimmers).length} empreintes de nageurs du club.`);
    } catch (e) {
      console.error(`Classement de la fédération non lu (${e.message}) : ${cached ? 'copie précédente gardée' : 'aucune copie'}.`);
    }
  }
  if (out) {
    mkdirSync(join(dist, 'data'), { recursive: true });
    writeFileSync(join(dist, 'data', 'belswim-ranking.json'), JSON.stringify(out));
    if (changed) writeFileSync(cacheFile, JSON.stringify(out));
  }
  console.log(`changed=${changed}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dist = 'dist', cache = '.belswim-cache'] = process.argv.slice(2);
  await main(dist, cache);
}
