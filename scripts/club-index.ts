/**
 * Génère public/data/club-results.json : le catalogue des rapports de
 * résultats (PDF « résultats par club ») publiés sur le site du club.
 *
 * Le catalogue ne contient que le nom, le lieu et les dates des compétitions
 * avec l'adresse du PDF : aucune donnée de nageur. Les PDF sont lus ensuite
 * directement par l'application, sur le téléphone de chaque parent.
 *
 * Lancement : npm run club-index (exécuté chaque jour par la publication GitHub).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CLUB } from '../src/club';
import { groupLines } from '../src/lib/pdfText';
import { looksLikeClubReport, parseMeetHeader } from '../src/lib/clubReport';

interface IndexReport {
  url: string;
  name: string;
  city?: string;
  organizer?: string;
  course: 'SCM' | 'LCM';
  start: string;
  end?: string;
}
interface ClubIndex {
  club: string;
  updatedAt: string;
  pages: string[];
  reports: IndexReport[];
  /** PDF déjà examinés qui ne sont pas des rapports de club (résultats globaux…). */
  others: string[];
}

// Chemin depuis la racine du projet (le script est compilé puis lancé depuis node_modules/.cache)
const OUT = join(process.cwd(), 'public', 'data', 'club-results.json');
const UA = 'Nageo-club-index/1.0 (+https://cronobots.github.io/ESN/)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return res;
      if (res.status < 500) throw new Error(`${res.status} ${url}`);
    } catch (e) {
      if (attempt === 2) throw e;
    }
    await sleep(1000 * (attempt + 1));
  }
  throw new Error(`échec ${url}`);
}

function absolute(href: string, base: string): string {
  return new URL(href.replace(/&amp;/g, '&'), base).toString();
}

/** Pages « Résultats … » trouvées dans le menu du site + liste connue. */
async function resultPages(): Promise<string[]> {
  const pages = new Set<string>(CLUB.resultsPages);
  try {
    const html = await (await get(CLUB.website)).text();
    const re = /<a[^>]+href="([^"]+)"[^>]*>(?:(?!<\/a>)[\s\S])*?R[ée]sultats(?:(?!<\/a>)[\s\S])*?<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const url = absolute(m[1], CLUB.website);
      if (url.startsWith(CLUB.website) && !/water|wp|nasyn|artisti|synchro/i.test(url)) pages.add(url);
    }
  } catch (e) {
    console.warn('Menu du site illisible :', (e as Error).message);
  }
  return [...pages];
}

async function pdfLinks(page: string): Promise<string[]> {
  const html = await (await get(page)).text();
  const found = new Set<string>();
  const re = /(?:https?:\/\/[^"'\s]+)?\/_files\/ugd\/[a-z0-9_]+\.pdf/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) found.add(absolute(m[0], CLUB.website));
  return [...found];
}

async function examine(url: string): Promise<IndexReport | null> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await (await get(url)).arrayBuffer());
  const task = pdfjs.getDocument({ data, verbosity: 0 });
  const doc = await task.promise;
  try {
    const lines: string[] = [];
    // Les premières pages suffisent pour reconnaître un rapport de club
    for (let i = 1; i <= Math.min(doc.numPages, 3); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      lines.push(...groupLines(content.items as never), '');
    }
    if (!looksLikeClubReport(lines)) return null;
    const meet = parseMeetHeader(lines);
    if (!meet) return null;
    return {
      url,
      name: meet.name,
      city: meet.city,
      organizer: meet.organizer,
      course: meet.course,
      start: meet.startDate,
      end: meet.endDate,
    };
  } finally {
    await task.destroy();
  }
}

async function main() {
  let previous: ClubIndex | null = null;
  if (existsSync(OUT)) {
    try {
      previous = JSON.parse(readFileSync(OUT, 'utf8')) as ClubIndex;
    } catch {
      previous = null;
    }
  }
  const known = new Map((previous?.reports ?? []).map((r) => [r.url, r]));
  const others = new Set(previous?.others ?? []);

  const pages = await resultPages();
  const urls = new Set<string>();
  for (const p of pages) {
    try {
      for (const u of await pdfLinks(p)) urls.add(u);
    } catch (e) {
      console.warn('Page illisible :', p, (e as Error).message);
    }
    await sleep(300);
  }
  if (!urls.size && previous) {
    console.warn('Aucun PDF trouvé : le catalogue précédent est conservé.');
    return;
  }

  const reports: IndexReport[] = [];
  let added = 0;
  for (const url of urls) {
    if (known.has(url)) {
      reports.push(known.get(url)!);
      continue;
    }
    if (others.has(url)) continue;
    try {
      const r = await examine(url);
      if (r) {
        reports.push(r);
        added++;
        console.log(`+ ${r.start} ${r.name}`);
      } else others.add(url);
    } catch (e) {
      console.warn('PDF illisible :', url, (e as Error).message);
    }
    await sleep(300);
  }
  reports.sort((a, b) => (a.start < b.start ? 1 : -1));

  const index: ClubIndex = {
    club: CLUB.licenseCode,
    updatedAt: new Date().toISOString(),
    pages,
    reports,
    others: [...others].filter((u) => urls.has(u)).sort(),
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(index, null, 1) + '\n');
  console.log(`Catalogue : ${reports.length} rapports (${added} nouveaux), ${index.others.length} autres PDF.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
