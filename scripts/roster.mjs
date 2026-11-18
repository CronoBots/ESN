// Liste des membres du club, chiffrée pour l'application (public/data/club-roster.json).
//
//   node scripts/roster.mjs code                        propose un nouveau code du club
//   node scripts/roster.mjs chiffrer membres.csv CODE    chiffre la liste avec ce code
//   node scripts/roster.mjs verifier CODE                relit le fichier publié avec ce code
//   node scripts/roster.mjs lire CODE                    affiche la liste des membres (sur votre ordinateur seulement)
//   node scripts/roster.mjs manquants CODE               membres actifs dont l'historique n'est pas encore publié
//   node scripts/roster.mjs historique DOSSIER CODE      chiffre l'historique swimrankings (un .txt par nageur)
//                                                        dans public/data/club-history.json (fusionné avec
//                                                        l'historique déjà publié : rien n'est perdu) ; seules
//                                                        les courses nagées pour l'ESN sont gardées (8e colonne)
//   node scripts/roster.mjs classements DOSSIER CODE     chiffre les classements nationaux (un .txt par nageur)
//                                                        dans public/data/club-rankings.json (fusionnés de même)
//
// membres.csv : groupe ; nom ; prénom ; année de naissance ; sexe (F/M) ; statut ; autres noms, une ligne par nageur.
// Statut : « ancien » pour un ancien membre (liste à part, classements sur option), sinon vide.
// Autres noms (facultatif) : le même nageur écrit autrement, « NOM, Prénom (AAAA) » séparés par « | » ;
// dans l'application, une fiche à l'un de ces noms est réunie avec celle du membre.
// Le code peut aussi être donné par la variable d'environnement ESN_CODE ; sans code, c'est la clé publique
// de l'application (src/club.ts, CLUB.accessKey : application ouverte à tous).
// La liste en clair ne doit JAMAIS être ajoutée au dépôt (public) : seul le fichier chiffré l'est.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { aliasesText, decryptHistory, decryptRankings, decryptRoster, encryptHistory, encryptRankings, encryptRoster, generateCode, historyHeader, isSwimmerFile, keepClubRaces, memberKey, parseRosterCsv, validateRoster } from '../src/lib/roster.ts';
import { existsSync } from 'node:fs';
import { CLUB } from '../src/club.ts';

/** Historique déjà publié (vide s'il n'y en a pas). */
async function publishedHistory(code) {
  if (!existsSync(HISTORY)) return [];
  return (await decryptHistory(JSON.parse(readFileSync(HISTORY, 'utf8')), code)).athletes;
}

/** Même nageur : nom, prénom et année (sans accents ni casse), ou sans l'année si l'un ne l'a pas. */
const sameMember = (a, b) =>
  memberKey(a) === memberKey(b) || (!(a.birthYear && b.birthYear) && memberKey({ ...a, birthYear: undefined }) === memberKey({ ...b, birthYear: undefined }));

const OUT = new URL('../public/data/club-roster.json', import.meta.url);
const HISTORY = new URL('../public/data/club-history.json', import.meta.url);
const RANKINGS = new URL('../public/data/club-rankings.json', import.meta.url);
const [cmd, ...args] = process.argv.slice(2);

function summary(roster) {
  const count = (n) => `${n} nageur${n > 1 ? 's' : ''}`;
  const active = roster.members.filter((m) => !m.former);
  const former = roster.members.length - active.length;
  const years = [...new Set(active.map((m) => m.birthYear ?? '?'))].sort();
  const lines = roster.groups.length
    ? roster.groups.map((g) => `  ${g.name} : ${count(active.filter((m) => m.group === g.id).length)}`)
    : years.map((y) => `  ${y} : ${count(active.filter((m) => (m.birthYear ?? '?') === y).length)}`);
  if (former) lines.push(`  anciens membres : ${count(former)}`);
  return `${active.length} nageurs${former ? ` et ${former} anciens membres` : ''} (liste du ${roster.updated})\n${lines.join('\n')}`;
}

if (cmd === 'code') {
  console.log(generateCode());
} else if (cmd === 'chiffrer') {
  const [file, argCode] = args;
  const code = argCode ?? process.env.ESN_CODE ?? CLUB.accessKey;
  if (!file || !code) throw new Error('Usage : node scripts/roster.mjs chiffrer membres.csv CODE');
  const text = readFileSync(file, 'utf8');
  const raw = file.endsWith('.json') ? JSON.parse(text) : { members: parseRosterCsv(text) };
  const roster = validateRoster(Array.isArray(raw) ? { members: raw } : raw);
  mkdirSync(new URL('./', OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(await encryptRoster(roster, code))}\n`);
  console.log(`Liste chiffrée dans public/data/club-roster.json\n${summary(roster)}`);
} else if (cmd === 'verifier') {
  const code = args[0] ?? process.env.ESN_CODE ?? CLUB.accessKey;
  const roster = await decryptRoster(JSON.parse(readFileSync(OUT, 'utf8')), code);
  console.log(`Fichier publié lisible avec ce code\n${summary(roster)}`);
} else if (cmd === 'lire') {
  const code = args[0] ?? process.env.ESN_CODE ?? CLUB.accessKey;
  const roster = await decryptRoster(JSON.parse(readFileSync(OUT, 'utf8')), code);
  console.log('groupe;nom;prénom;année;sexe;statut;autres noms');
  for (const m of roster.members)
    console.log([m.group ?? '', m.lastName, m.firstName, m.birthYear ?? '', m.gender, m.former ? 'ancien' : '', aliasesText(m.aliases)].join(';').replace(/;+$/, ''));
} else if (cmd === 'manquants') {
  const code = args[0] ?? process.env.ESN_CODE ?? CLUB.accessKey;
  const roster = await decryptRoster(JSON.parse(readFileSync(OUT, 'utf8')), code);
  const published = await publishedHistory(code);
  // Historique provisoire (ligne « @@PARTIEL ») : meilleurs temps seulement, reste à compléter
  const done = published.filter((a) => !/^@@PARTIEL/m.test(a.text));
  const missing = roster.members.filter((m) => !m.former && !done.some((a) => sameMember(a, m)));
  const partial = missing.filter((m) => published.some((a) => sameMember(a, m))).length;
  console.log(
    `${missing.length} membres actifs sans historique complet publié (sur ${roster.members.filter((m) => !m.former).length})` +
      (partial ? `, dont ${partial} avec un historique provisoire (meilleurs temps)` : ''),
  );
  console.log('groupe;nom;prénom;année;sexe');
  for (const m of missing) console.log([m.group ?? '', m.lastName, m.firstName, m.birthYear ?? '', m.gender].join(';'));
  // Historique complet sans le club de chaque course : des courses d'un autre club ont pu y entrer
  const unchecked = roster.members.filter((m) => !m.former && done.some((a) => sameMember(a, m) && !/^@@CLUBS/m.test(a.text)));
  console.log(`\n${unchecked.length} membres actifs dont le club de chaque course reste à relever (nageurs qui ont pu changer de club)`);
  console.log('groupe;nom;prénom;année;sexe');
  for (const m of unchecked) console.log([m.group ?? '', m.lastName, m.firstName, m.birthYear ?? '', m.gender].join(';'));
} else if (cmd === 'historique') {
  const [dir, argCode] = args;
  const code = argCode ?? process.env.ESN_CODE ?? CLUB.accessKey;
  if (!dir || !code) throw new Error('Usage : node scripts/roster.mjs historique DOSSIER CODE');
  const roster = await decryptRoster(JSON.parse(readFileSync(OUT, 'utf8')), code);
  const members = new Map(roster.members.map((m) => [memberKey(m), m]));
  const athletes = [];
  for (const f of readdirSync(dir).filter(isSwimmerFile).sort()) {
    const raw = readFileSync(join(dir, f), 'utf8').trim();
    const h = historyHeader(raw);
    if (!h) throw new Error(`${f} : en-tête « NOM, Prénom (AAAA) » introuvable`);
    // Seulement les courses nagées pour l'ESN (club relevé en 8e colonne)
    const { text, kept, dropped, verified } = keepClubRaces(raw, CLUB.match);
    const known = members.has(memberKey(h)) || [...members.values()].some((m) => memberKey({ ...m, birthYear: undefined }) === memberKey({ ...h, birthYear: undefined }));
    const club = verified ? (dropped ? ` (${dropped} nagés pour un autre club, retirés)` : ' (tous pour l’ESN)') : ' ⚠ club des courses non relevé';
    console.log(`${known ? '✓' : '⚠ pas dans la liste du club :'} ${f} : ${kept} temps${club}`);
    athletes.push({ ...h, text });
  }
  // Nageurs déjà publiés absents du dossier (autre ordinateur, dossier vidé…) : gardés tels quels,
  // sauf l'ancienne fiche d'un nageur réunie avec une autre (« autres noms » de la liste)
  const aliases = roster.members.flatMap((m) => m.aliases ?? []);
  const published = (await publishedHistory(code)).filter((a) => !athletes.some((b) => sameMember(a, b)));
  const kept = published.filter((a) => !aliases.some((b) => sameMember(a, b)));
  if (kept.length) console.log(`${kept.length} nageurs de l'historique déjà publié gardés tels quels`);
  if (published.length > kept.length) console.log(`${published.length - kept.length} anciennes fiches en double retirées (réunies avec une autre)`);
  athletes.push(...kept);
  mkdirSync(new URL('./', HISTORY), { recursive: true });
  writeFileSync(HISTORY, `${JSON.stringify(await encryptHistory({ updated: new Date().toISOString().slice(0, 10), athletes }, code))}\n`);
  console.log(`Historique de ${athletes.length} nageurs chiffré dans public/data/club-history.json`);
} else if (cmd === 'classements') {
  const [dir, argCode] = args;
  const code = argCode ?? process.env.ESN_CODE ?? CLUB.accessKey;
  if (!dir || !code) throw new Error('Usage : node scripts/roster.mjs classements DOSSIER CODE');
  // Contrôle léger des lignes (la lecture complète est celle de l'application, src/lib/rankings.ts)
  const okLine = (l) => {
    const c = l.split('\t').map((x) => x.trim());
    return /^\d{4}(\s*[-/]\s*\d{2,4})?$/.test(c[0]) && /^(25|50)\s?m$|^(SCM|LCM)$/i.test(c[1]) && /\d+\s?m\b/i.test(c[2]) && !!c[3] && /^\d{1,4}\b/.test(c[4]);
  };
  const parseRankingsText = (text) => text.split('\n').filter((l) => l.split('\t').length >= 5 && okLine(l));
  const roster = await decryptRoster(JSON.parse(readFileSync(OUT, 'utf8')), code);
  const athletes = [];
  for (const f of readdirSync(dir).filter(isSwimmerFile).sort()) {
    const text = readFileSync(join(dir, f), 'utf8').trim();
    const h = historyHeader(text);
    if (!h) throw new Error(`${f} : en-tête « NOM, Prénom (AAAA) » introuvable`);
    const lines = text.split('\n').filter((l) => l.split('\t').length >= 5).length;
    const ranks = parseRankingsText(text).length;
    const known = roster.members.some((m) => sameMember(m, h));
    console.log(`${known ? '✓' : '⚠ pas dans la liste du club :'} ${f} : ${ranks} classements${ranks < lines ? ` ⚠ ${lines - ranks} ligne(s) illisible(s)` : ''}`);
    athletes.push({ ...h, text });
  }
  const before = existsSync(RANKINGS) ? (await decryptRankings(JSON.parse(readFileSync(RANKINGS, 'utf8')), code)).athletes : [];
  const kept = before.filter((a) => !athletes.some((b) => sameMember(a, b)));
  if (kept.length) console.log(`${kept.length} nageurs des classements déjà publiés gardés tels quels`);
  athletes.push(...kept);
  writeFileSync(RANKINGS, `${JSON.stringify(await encryptRankings({ updated: new Date().toISOString().slice(0, 10), athletes }, code))}\n`);
  console.log(`Classements de ${athletes.length} nageurs chiffrés dans public/data/club-rankings.json`);
} else {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 17).join('\n'));
}
