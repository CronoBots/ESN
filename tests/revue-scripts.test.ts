/**
 * Revue des scripts du club (scripts/roster.mjs, generate-icons, README) et garde-fou contre
 * les noms de membres en clair dans le dépôt public.
 *
 * Les commandes de scripts/roster.mjs sont lancées pour de vrai, mais sur un dossier temporaire
 * (variable ESN_DATA), jamais sur public/data, avec des nageurs FICTIFS.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLUB } from '../src/club';
import { decryptHistory, decryptRankings, decryptRoster, encryptHistory, encryptRankings, encryptRoster, validateRoster, type ClubHistory } from '../src/lib/roster';
import { parseRankingsText } from '../src/lib/rankings';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const KEY = CLUB.accessKey;
const ESN = 'BEL - Ecole Seraing Natation';
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Liste fictive : une ancienne membre, un « autre nom ». */
const ROSTER = validateRoster({
  updated: '2026-09-01',
  members: [
    { lastName: 'DUPONT', firstName: 'Emma', birthYear: 2014, gender: 'F' },
    { lastName: 'MARTIN', firstName: 'Lucas', birthYear: 2012, gender: 'M' },
    { lastName: 'LAMBERT', firstName: 'Chloé', birthYear: 2010, gender: 'F', former: true },
    { lastName: 'PETIT', firstName: 'Noah', birthYear: 2013, gender: 'M', aliases: [{ lastName: 'PETIT', firstName: 'Noa', birthYear: 2013 }] },
  ],
});

const header = (name: string, ...marks: string[]) =>
  ['@@URL:https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=1234567', ...marks, name, ESN].join('\n');
/** Une course fictive ; `club` vide : colonne Club absente (7 colonnes). */
const race = (event: string, time: string, date: string, club = ESN) =>
  [event, '25m', time, '150', date, 'Liège', 'Meeting fictif', ...(club ? [club] : [])].join('\t');
const rank = (season: string, n: number) => [season, '25m', '100m Libre', 'Belgique · filles nées en 2014', String(n), '148', '1:31.08'].join('\t');

/** Dossier temporaire : liste chiffrée, fichiers déjà publiés, fichiers des dossiers de relevé. */
async function setup(files: Record<string, string>, published: { history?: ClubHistory['athletes']; rankings?: ClubHistory['athletes'] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'esn-revue-scripts-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data/club-roster.json'), JSON.stringify(await encryptRoster(ROSTER, KEY, 1000)));
  if (published.history)
    writeFileSync(join(dir, 'data/club-history.json'), JSON.stringify(await encryptHistory({ updated: '2026-09-01', athletes: published.history }, KEY, 1000)));
  if (published.rankings)
    writeFileSync(join(dir, 'data/club-rankings.json'), JSON.stringify(await encryptRankings({ updated: '2026-09-01', athletes: published.rankings }, KEY, 1000)));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

/** Lance scripts/roster.mjs avec ESN_DATA = dossier temporaire (jamais public/data). */
function run(dir: string, ...args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, ESN_DATA: join(dir, 'data') };
  delete env.ESN_CODE;
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/roster.mjs'), ...args], { cwd: dir, env, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const read = (dir: string, file: string) => JSON.parse(readFileSync(join(dir, 'data', file), 'utf8'));
const textOf = (athletes: ClubHistory['athletes'], lastName: string) => athletes.find((a) => a.lastName === lastName)?.text ?? '';
const races = (text: string) => text.split('\n').filter((l) => l.split('\t').length >= 5).length;

describe('scripts/roster.mjs historique', () => {
  const full = `${header('DUPONT, Emma (2014)', '@@CLUBS')}\n${[race('100m Libre', '1:31.08', '11 oct 2025'), race('50m Dos', '45.12', '14 déc 2024'), race('100m Libre', '1:35.40', '14 juin 2024')].join('\n')}`;
  const partial = `${header('DUPONT, Emma (2014)', '@@PARTIEL')}\n${race('100m Libre', '1:31.08', '11 oct 2025')}`;

  it('scripts-2 : un fichier plus pauvre ne remplace pas la version publiée, sauf --remplacer', async () => {
    const verified = `${header('MARTIN, Lucas (2012)', '@@CLUBS')}\n${race('50m Libre', '35.20', '11 oct 2025')}`;
    const noClub = `${header('MARTIN, Lucas (2012)')}\n${race('50m Libre', '35.20', '11 oct 2025', '')}`;
    const dir = await setup(
      { 'historique/DUPONT_Emma.txt': partial, 'historique/MARTIN_Lucas.txt': noClub },
      {
        history: [
          { lastName: 'DUPONT', firstName: 'Emma', birthYear: 2014, text: full },
          { lastName: 'MARTIN', firstName: 'Lucas', birthYear: 2012, text: verified },
        ],
      },
    );
    const r = run(dir, 'historique', 'historique');
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/DUPONT_Emma\.txt : 1 temps \(publié : 3\).*version publiée gardée/);
    expect(r.out).toMatch(/MARTIN_Lucas\.txt : 1 temps \(publié : 1\), club des courses non relevé.*version publiée gardée/);
    let athletes = (await decryptHistory(read(dir, 'club-history.json'), KEY)).athletes;
    expect(races(textOf(athletes, 'DUPONT'))).toBe(3);
    expect(textOf(athletes, 'MARTIN')).toMatch(/^@@CLUBS/m);

    const forced = run(dir, 'historique', 'historique', '--remplacer');
    expect(forced.status).toBe(0);
    athletes = (await decryptHistory(read(dir, 'club-history.json'), KEY)).athletes;
    expect(races(textOf(athletes, 'DUPONT'))).toBe(1);
    expect(textOf(athletes, 'DUPONT')).toMatch(/^@@PARTIEL/m);
  }, 60_000);

  it('scripts-2 : un fichier plus complet remplace la version publiée, avec le nombre publié affiché', async () => {
    const dir = await setup({ 'historique/DUPONT_Emma.txt': full }, { history: [{ lastName: 'DUPONT', firstName: 'Emma', birthYear: 2014, text: partial }] });
    const r = run(dir, 'historique', 'historique');
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/✓ DUPONT_Emma\.txt : 3 temps \(publié : 1\)/);
    expect(races(textOf((await decryptHistory(read(dir, 'club-history.json'), KEY)).athletes, 'DUPONT'))).toBe(3);
  }, 60_000);

  it('scripts-3 : deux fichiers du même nageur dans le dossier arrêtent la commande, rien n’est écrit', async () => {
    const dir = await setup({
      'historique/DUPONT_Emma.txt': full,
      'historique/DUPONT_Emma_partiel.txt': partial,
      'classements/DUPONT_Emma.txt': `${header('DUPONT, Emma (2014)')}\n${rank('2026-2027', 12)}`,
      'classements/DUPONT_Emma2.txt': `${header('DUPONT, Emma')}\n${rank('2026-2027', 12)}`,
    });
    const h = run(dir, 'historique', 'historique');
    expect(h.status).not.toBe(0);
    expect(h.out).toContain('DUPONT_Emma.txt et DUPONT_Emma_partiel.txt : même nageur deux fois');
    expect(existsSync(join(dir, 'data/club-history.json'))).toBe(false);
    const c = run(dir, 'classements', 'classements');
    expect(c.status).not.toBe(0);
    expect(c.out).toContain('DUPONT_Emma.txt et DUPONT_Emma2.txt : même nageur deux fois');
    expect(existsSync(join(dir, 'data/club-rankings.json'))).toBe(false);
  }, 60_000);

  it('scripts-8 : une année de naissance différente de la liste est signalée, pas marquée ✓', async () => {
    const dir = await setup({ 'historique/DUPONT_Emma.txt': `${header('DUPONT, Emma (2013)')}\n${race('100m Libre', '1:31.08', '11 oct 2025')}` });
    const r = run(dir, 'historique', 'historique');
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/⚠ année de naissance différente de la liste.* DUPONT_Emma\.txt/);
    expect(r.out).not.toMatch(/✓ DUPONT_Emma\.txt/);
  }, 60_000);
});

describe('scripts/roster.mjs classements', () => {
  it('scripts-5 : une mise à jour de la saison en cours garde les classements publiés de la saison précédente', async () => {
    const published = `${header('DUPONT, Emma (2014)')}\n${rank('2025-2026', 30)}\n${rank('2026-2027', 20)}`;
    const dir = await setup(
      { 'classements/DUPONT_Emma.txt': `${header('DUPONT, Emma (2014)')}\n${rank('2026-2027', 12)}` },
      { rankings: [{ lastName: 'DUPONT', firstName: 'Emma', birthYear: 2014, text: published }] },
    );
    const r = run(dir, 'classements', 'classements');
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/DUPONT_Emma\.txt : 1 classements \(\+ 1 déjà publiés gardés\)/);
    const ranks = () => decryptRankings(read(dir, 'club-rankings.json'), KEY).then((x) => parseRankingsText(textOf(x.athletes, 'DUPONT')));
    // La ligne de même saison, bassin, épreuve et classement est remplacée ; l'autre saison reste
    expect((await ranks()).map((x) => `${x.season} ${x.rank}`).sort()).toEqual(['2025-2026 30', '2026-2027 12']);

    expect(run(dir, 'classements', 'classements', '--remplacer').status).toBe(0);
    expect((await ranks()).map((x) => `${x.season} ${x.rank}`)).toEqual(['2026-2027 12']);
  }, 60_000);
});

describe('scripts/roster.mjs chiffrer', () => {
  it('scripts-6 : refuse un autre code que celui de l’application, sauf --nouveau-code', async () => {
    const dir = await setup({ 'membres.csv': 'A;DUPONT;Emma;2014;F' });
    const before = readFileSync(join(dir, 'data/club-roster.json'), 'utf8');
    const r = run(dir, 'chiffrer', 'membres.csv', 'ESN-7KQ4-M2XP');
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("n'est pas celui de l'application");
    expect(readFileSync(join(dir, 'data/club-roster.json'), 'utf8')).toBe(before);

    expect(run(dir, 'chiffrer', 'membres.csv').status).toBe(0);
    expect((await decryptRoster(read(dir, 'club-roster.json'), KEY)).members).toHaveLength(1);

    expect(run(dir, 'chiffrer', 'membres.csv', 'ESN-7KQ4-M2XP', '--nouveau-code').status).toBe(0);
    expect((await decryptRoster(read(dir, 'club-roster.json'), 'ESN-7KQ4-M2XP')).members).toHaveLength(1);
  }, 60_000);

  it('scripts-7 : avertit quand une liste à 5 colonnes rend actifs les anciens et perd les autres noms', async () => {
    const dir = await setup({ 'membres.csv': 'A;DUPONT;Emma;2014;F\nA;MARTIN;Lucas;2012;M\n;LAMBERT;Chloé;2010;F\n;PETIT;Noah;2013;M' });
    const r = run(dir, 'chiffrer', 'membres.csv');
    expect(r.status).toBe(0);
    expect(r.out).toContain('⚠ 1 anciens membres de la liste publiée redeviennent actifs');
    expect(r.out).toContain('⚠ 1 « autres noms » de la liste publiée disparaissent');
    // Liste reprise de « lire » (7 colonnes) : aucun avertissement
    const same = await setup({ 'membres.csv': 'A;DUPONT;Emma;2014;F\nA;MARTIN;Lucas;2012;M\n;LAMBERT;Chloé;2010;F;ancien\n;PETIT;Noah;2013;M;;PETIT, Noa (2013)' });
    expect(run(same, 'chiffrer', 'membres.csv').out).not.toContain('⚠');
  }, 60_000);
});

describe('logos et README', () => {
  it('scripts-12 : npm run icons ne recrée pas les logos sombres retirés du précache', () => {
    expect(readFileSync(join(ROOT, 'scripts/generate-icons.mjs'), 'utf8')).not.toMatch(/-dark\.png/);
  });

  it('scripts-6 : le README ne donne aucun code à passer à « chiffrer »', () => {
    expect(readFileSync(join(ROOT, 'README.md'), 'utf8')).not.toMatch(/ESN-[A-Z0-9]{4}-[A-Z0-9]{4}/);
  });
});

/** Sans accents ni casse, mots séparés par une espace (« DUPONT_Emma » → « dupont emma »). */
const words = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();

describe('scripts-1 : aucun nom de membre en clair dans le dépôt public', () => {
  it('ni dans src/, tests/, scripts/, .claude/ ni README.md (fichiers suivis par git ou à ajouter)', async () => {
    const roster = await decryptRoster(JSON.parse(readFileSync(join(ROOT, 'public/data/club-roster.json'), 'utf8')), CLUB.accessKey);
    // Nom et prénom de chaque membre et de chacun de ses « autres noms »
    const people = roster.members
      .flatMap((m) => [m, ...(m.aliases ?? [])])
      .map((p) => ({ last: words(p.lastName), first: words(p.firstName) }))
      .filter((p) => p.last && p.first);
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'src', 'tests', 'scripts', '.claude', 'README.md'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\0')
      .filter((f) => f && existsSync(join(ROOT, f)));
    expect(files.length).toBeGreaterThan(0);
    const found = new Set<string>();
    for (const file of files) {
      const raw = readFileSync(join(ROOT, file), 'utf8');
      if (raw.includes('\0')) continue; // fichier binaire
      const text = ` ${words(raw)} `;
      const tokens = new Set(text.split(' '));
      const hit = people.some(
        ({ last, first }) =>
          `${last} ${first}`.split(' ').every((t) => tokens.has(t)) && (text.includes(` ${last} ${first} `) || text.includes(` ${first} ${last} `)),
      );
      if (hit) found.add(file);
    }
    // Seulement le chemin des fichiers fautifs : jamais le nom trouvé
    expect([...found]).toEqual([]);
  }, 60_000);
});
