// Liste des membres du club, chiffrée pour l'application (public/data/club-roster.json).
//
//   node scripts/roster.mjs code                        propose un nouveau code du club
//   node scripts/roster.mjs chiffrer membres.csv CODE    chiffre la liste avec ce code
//   node scripts/roster.mjs verifier CODE                relit le fichier publié avec ce code
//
// membres.csv : groupe ; nom ; prénom ; année de naissance ; sexe (F/M), une ligne par nageur.
// Le code peut aussi être donné par la variable d'environnement ESN_CODE.
// La liste en clair ne doit JAMAIS être ajoutée au dépôt (public) : seul le fichier chiffré l'est.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { decryptRoster, encryptRoster, generateCode, parseRosterCsv, validateRoster } from '../src/lib/roster.ts';

const OUT = new URL('../public/data/club-roster.json', import.meta.url);
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
} else {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 9).join('\n'));
}
