// Liste des membres du club, chiffrée pour l'application (public/data/club-roster.json).
//
//   node scripts/roster.mjs code                        propose un nouveau code du club
//   node scripts/roster.mjs chiffrer membres.csv CODE    chiffre la liste avec ce code
//   node scripts/roster.mjs verifier CODE                relit le fichier publié avec ce code
//   node scripts/roster.mjs lire CODE                    affiche la liste des membres (sur votre ordinateur seulement)
//   node scripts/roster.mjs historique DOSSIER CODE      chiffre l'historique swimrankings (un .txt par nageur)
//                                                        dans public/data/club-history.json
//
// membres.csv : groupe ; nom ; prénom ; année de naissance ; sexe (F/M), une ligne par nageur.
// Le code peut aussi être donné par la variable d'environnement ESN_CODE.
// La liste en clair ne doit JAMAIS être ajoutée au dépôt (public) : seul le fichier chiffré l'est.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decryptRoster, encryptHistory, encryptRoster, generateCode, historyHeader, memberKey, parseRosterCsv, validateRoster } from '../src/lib/roster.ts';

const OUT = new URL('../public/data/club-roster.json', import.meta.url);
const HISTORY = new URL('../public/data/club-history.json', import.meta.url);
const [cmd, ...args] = process.argv.slice(2);

function summary(roster) {
  const count = (n) => `${n} nageur${n > 1 ? 's' : ''}`;
  const years = [...new Set(roster.members.map((m) => m.birthYear ?? '?'))].sort();
  const lines = roster.groups.length
    ? roster.groups.map((g) => `  ${g.name} : ${count(roster.members.filter((m) => m.group === g.id).length)}`)
    : years.map((y) => `  ${y} : ${count(roster.members.filter((m) => (m.birthYear ?? '?') === y).length)}`);
  return `${roster.members.length} nageurs (liste du ${roster.updated})\n${lines.join('\n')}`;
}

if (cmd === 'code') {
  console.log(generateCode());
} else if (cmd === 'chiffrer') {
  const [file, argCode] = args;
  const code = argCode ?? process.env.ESN_CODE;
  if (!file || !code) throw new Error('Usage : node scripts/roster.mjs chiffrer membres.csv CODE');
  const text = readFileSync(file, 'utf8');
  const raw = file.endsWith('.json') ? JSON.parse(text) : { members: parseRosterCsv(text) };
  const roster = validateRoster(Array.isArray(raw) ? { members: raw } : raw);
  mkdirSync(new URL('./', OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(await encryptRoster(roster, code))}\n`);
  console.log(`Liste chiffrée dans public/data/club-roster.json\n${summary(roster)}`);
} else if (cmd === 'verifier') {
  const code = args[0] ?? process.env.ESN_CODE;
  const roster = await decryptRoster(JSON.parse(readFileSync(OUT, 'utf8')), code);
  console.log(`Fichier publié lisible avec ce code\n${summary(roster)}`);
} else if (cmd === 'lire') {
  const code = args[0] ?? process.env.ESN_CODE;
  const roster = await decryptRoster(JSON.parse(readFileSync(OUT, 'utf8')), code);
  console.log('groupe;nom;prénom;année;sexe');
  for (const m of roster.members) console.log([m.group ?? '', m.lastName, m.firstName, m.birthYear ?? '', m.gender].join(';'));
} else if (cmd === 'historique') {
  const [dir, argCode] = args;
  const code = argCode ?? process.env.ESN_CODE;
  if (!dir || !code) throw new Error('Usage : node scripts/roster.mjs historique DOSSIER CODE');
  const roster = await decryptRoster(JSON.parse(readFileSync(OUT, 'utf8')), code);
  const members = new Map(roster.members.map((m) => [memberKey(m), m]));
  const athletes = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()) {
    const text = readFileSync(join(dir, f), 'utf8').trim();
    const h = historyHeader(text);
    if (!h) throw new Error(`${f} : en-tête « NOM, Prénom (AAAA) » introuvable`);
    const lines = text.split('\n').filter((l) => l.split('\t').length >= 5).length;
    const known = members.has(memberKey(h)) || [...members.values()].some((m) => memberKey({ ...m, birthYear: undefined }) === memberKey({ ...h, birthYear: undefined }));
    console.log(`${known ? '✓' : '⚠ pas dans la liste du club :'} ${f} : ${lines} temps`);
    athletes.push({ ...h, text });
  }
  mkdirSync(new URL('./', HISTORY), { recursive: true });
  writeFileSync(HISTORY, `${JSON.stringify(await encryptHistory({ updated: new Date().toISOString().slice(0, 10), athletes }, code))}\n`);
  console.log(`Historique de ${athletes.length} nageurs chiffré dans public/data/club-history.json`);
} else {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 13).join('\n'));
}
