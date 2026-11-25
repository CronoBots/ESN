// Liste des membres du club, chiffrée pour l'application (public/data/club-roster.json).
//
//   node scripts/roster.mjs code                        propose un nouveau code du club
//   node scripts/roster.mjs chiffrer membres.csv CODE    chiffre la liste avec ce code ; un autre code que celui de
//                                                        l'application (src/club.ts) demande --nouveau-code
//   node scripts/roster.mjs verifier CODE                relit le fichier publié avec ce code
//   node scripts/roster.mjs lire CODE                    affiche la liste des membres (sur votre ordinateur seulement)
//   node scripts/roster.mjs manquants CODE               membres actifs dont l'historique n'est pas encore publié
//   node scripts/roster.mjs historique DOSSIER CODE      chiffre l'historique swimrankings (un .txt par nageur)
//                                                        dans public/data/club-history.json (fusionné avec
//                                                        l'historique déjà publié : rien n'est perdu) ; seules
//                                                        les courses nagées pour l'ESN sont gardées (8e colonne) ;
//                                                        un fichier plus pauvre que la version publiée (moins de
//                                                        temps, @@PARTIEL, club non relevé) est écarté sans --remplacer
//   node scripts/roster.mjs inscriptions FICHIER [CODE]  inscriptions du club à une compétition (PDF « inscription_ESN_pour_… »
//                                                        envoyé par le club, ou son texte pdftotext -layout) : programme de chaque
//                                                        nageur et records officiels de son âge, chiffrés dans
//                                                        public/data/club-entries.json (la même compétition est remplacée)
//   node scripts/roster.mjs records FICHIER.pdf [CODE]   liste officielle des records du club (PDF « Records Club » du site
//                                                        du club ; date tirée du nom « RECORDS 31.12.2025 » ou --au=AAAA-MM-JJ) :
//                                                        chaque record retrouvé dans historique/ est marqué vérifié ;
//                                                        --doutes=FICHIER.tsv (local) marque des records « à vérifier ».
//                                                        Chiffrée dans public/data/club-records.json (remplace la précédente)
//   node scripts/roster.mjs classements DOSSIER CODE     chiffre les classements nationaux (un .txt par nageur)
//                                                        dans public/data/club-rankings.json (fusionnés ligne par
//                                                        ligne : un classement publié absent du fichier est gardé,
//                                                        sauf avec --remplacer)
//
// membres.csv : groupe ; nom ; prénom ; année de naissance ; sexe (F/M) ; statut ; autres noms, une ligne par nageur.
// Statut : « ancien » pour un ancien membre (liste à part, classements sur option), sinon vide.
// Autres noms (facultatif) : le même nageur écrit autrement, « NOM, Prénom (AAAA) » séparés par « | » ;
// dans l'application, une fiche à l'un de ces noms est réunie avec celle du membre.
// Le code peut aussi être donné par la variable d'environnement ESN_CODE ; sans code, c'est la clé publique
// de l'application (src/club.ts, CLUB.accessKey : application ouverte à tous).
// ESN_DATA : autre dossier que public/data pour les fichiers publiés (tests).
// La liste en clair ne doit JAMAIS être ajoutée au dépôt (public) : seul le fichier chiffré l'est.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { aliasesText, decryptEntries, decryptHistory, decryptRankings, decryptRoster, encryptEntries, encryptHistory, encryptOfficialRecords, encryptRankings, encryptRoster, generateCode, historyHeader, isSwimmerFile, keepClubRaces, memberKey, normalizeCode, parseRosterCsv, validateRoster } from '../src/lib/roster.ts';
import { holderMatches, parseOfficialRecordsText } from '../src/lib/officialRecordsList.ts';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { CLUB } from '../src/club.ts';
import { announcedTotals, mergeEntries, parseClubEntries } from '../src/lib/clubEntries.ts';

/** Historique déjà publié (vide s'il n'y en a pas). */
async function publishedHistory(code) {
  if (!existsSync(HISTORY)) return [];
  return (await decryptHistory(JSON.parse(readFileSync(HISTORY, 'utf8')), code)).athletes;
}

/** Même nageur : nom, prénom et année (sans accents ni casse), ou sans l'année si l'un ne l'a pas. */
const sameMember = (a, b) =>
  memberKey(a) === memberKey(b) || (!(a.birthYear && b.birthYear) && memberKey({ ...a, birthYear: undefined }) === memberKey({ ...b, birthYear: undefined }));

/** Nombre de courses (ou de classements) d'un texte : une ligne d'au moins 5 colonnes. */
const races = (text) => text.split(/\r?\n/).filter((l) => l.split('\t').length >= 5).length;

/** Même nageur deux fois dans le dossier : le second fichier effacerait les données du premier. */
function checkTwin(seen, h, f) {
  const twin = seen.find((s) => sameMember(s.h, h));
  if (twin) throw new Error(`${twin.f} et ${f} : même nageur deux fois dans le dossier, gardez un seul fichier`);
  seen.push({ h, f });
}

const DATA = process.env.ESN_DATA ? pathToFileURL(`${resolve(process.env.ESN_DATA)}/`) : new URL('../public/data/', import.meta.url);
const OUT = new URL('club-roster.json', DATA);
const HISTORY = new URL('club-history.json', DATA);
const RANKINGS = new URL('club-rankings.json', DATA);
const ENTRIES = new URL('club-entries.json', DATA);
const OFFICIAL = new URL('club-records.json', DATA);
const [cmd, ...all] = process.argv.slice(2);
// Options (--remplacer, --nouveau-code) à part des arguments
const args = all.filter((a) => !a.startsWith('--'));
const option = (name) => all.includes(`--${name}`);
/** Valeur d'une option « --nom=valeur » (undefined si absente). */
const value = (name) => all.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

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
  // Un autre code que celui de l'application : plus aucun téléphone ne pourrait lire la liste
  if (normalizeCode(code) !== normalizeCode(CLUB.accessKey) && !option('nouveau-code'))
    throw new Error(
      "Ce code n'est pas celui de l'application (src/club.ts, CLUB.accessKey) : les téléphones ne pourraient plus lire la liste. " +
        'Omettez le code ; pour changer de code, ajoutez --nouveau-code et reportez-le dans src/club.ts dans le même commit.',
    );
  const text = readFileSync(file, 'utf8');
  const raw = file.endsWith('.json') ? JSON.parse(text) : { members: parseRosterCsv(text) };
  const roster = validateRoster(Array.isArray(raw) ? { members: raw } : raw);
  // Liste publiée : un tableur sans les colonnes statut et autres noms ferait revenir les anciens et perdre les autres noms
  const before = existsSync(OUT) ? await decryptRoster(JSON.parse(readFileSync(OUT, 'utf8')), code).catch(() => null) : null;
  if (before) {
    const back = roster.members.filter((m) => !m.former && before.members.some((b) => b.former && memberKey(b) === memberKey(m))).length;
    const names = new Set(roster.members.flatMap((m) => (m.aliases ?? []).map(memberKey)));
    const lost = before.members.flatMap((b) => b.aliases ?? []).filter((a) => !names.has(memberKey(a))).length;
    if (back) console.log(`⚠ ${back} anciens membres de la liste publiée redeviennent actifs (6e colonne « ancien » vide)`);
    if (lost) console.log(`⚠ ${lost} « autres noms » de la liste publiée disparaissent (7e colonne)`);
    if (back || lost) console.log('  Partez de « node scripts/roster.mjs lire » ; pour annuler : git checkout public/data/club-roster.json');
  }
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
  const previous = await publishedHistory(code);
  const athletes = [];
  const seen = [];
  for (const f of readdirSync(dir).filter(isSwimmerFile).sort()) {
    const raw = readFileSync(join(dir, f), 'utf8').trim();
    const h = historyHeader(raw);
    if (!h) throw new Error(`${f} : en-tête « NOM, Prénom (AAAA) » introuvable`);
    checkTwin(seen, h, f);
    // Seulement les courses nagées pour l'ESN (club relevé en 8e colonne)
    const { text, kept, dropped, verified } = keepClubRaces(raw, CLUB.match);
    // Comme dans l'application : même année de naissance quand les deux sont connues
    const known = roster.members.some((m) => sameMember(m, h));
    const otherYear = !known && roster.members.some((m) => memberKey({ ...m, birthYear: undefined }) === memberKey({ ...h, birthYear: undefined }));
    const mark = known ? '✓' : otherYear ? '⚠ année de naissance différente de la liste (corrigez l’en-tête ou ajoutez l’autre nom) :' : '⚠ pas dans la liste du club :';
    const club = verified ? (dropped ? ` (${dropped} nagés pour un autre club, retirés)` : ' (tous pour l’ESN)') : ' ⚠ club des courses non relevé';
    // Version publiée plus riche (fichier ancien resté sur cet ordinateur) : gardée, sauf --remplacer
    const old = previous.find((a) => sameMember(a, h));
    const was = old ? ` (publié : ${races(old.text)})` : '';
    const poorer = !old
      ? ''
      : kept + dropped < races(old.text)
        ? 'moins de temps que la version publiée'
        : /^@@PARTIEL/m.test(raw) && !/^@@PARTIEL/m.test(old.text)
          ? 'historique provisoire (@@PARTIEL), la version publiée est complète'
          : /^@@CLUBS/m.test(old.text) && !verified
            ? 'club des courses non relevé, la version publiée est vérifiée'
            : '';
    if (poorer && !option('remplacer')) {
      console.log(`⚠ ${f} : ${kept} temps${was}, ${poorer} : version publiée gardée (--remplacer pour publier ce fichier)`);
      continue;
    }
    console.log(`${mark} ${f} : ${kept} temps${was}${club}`);
    athletes.push({ ...h, text });
  }
  // Nageurs déjà publiés absents du dossier (autre ordinateur, dossier vidé…) : gardés tels quels,
  // sauf l'ancienne fiche d'un nageur réunie avec une autre (« autres noms » de la liste)
  const aliases = roster.members.flatMap((m) => m.aliases ?? []);
  const published = previous.filter((a) => !athletes.some((b) => sameMember(a, b)));
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
  const before = existsSync(RANKINGS) ? (await decryptRankings(JSON.parse(readFileSync(RANKINGS, 'utf8')), code)).athletes : [];
  // Clé d'un classement : saison, bassin, épreuve, classement (sans casse ni espaces)
  const rankKey = (l) => l.split('\t').slice(0, 4).map((x) => x.toLowerCase().replace(/\s+/g, '')).join('|');
  const athletes = [];
  const seen = [];
  for (const f of readdirSync(dir).filter(isSwimmerFile).sort()) {
    let text = readFileSync(join(dir, f), 'utf8').trim();
    const h = historyHeader(text);
    if (!h) throw new Error(`${f} : en-tête « NOM, Prénom (AAAA) » introuvable`);
    checkTwin(seen, h, f);
    const lines = races(text);
    const ranks = parseRankingsText(text).length;
    // Classements déjà publiés absents du fichier (saison précédente…) : gardés, sauf --remplacer
    const keys = new Set(text.split(/\r?\n/).map(rankKey));
    const old = option('remplacer') ? [] : (before.find((a) => sameMember(a, h))?.text ?? '').split(/\r?\n/).filter((l) => l.split('\t').length >= 5 && !keys.has(rankKey(l)));
    if (old.length) text = `${text}\n${old.join('\n')}`;
    const known = roster.members.some((m) => sameMember(m, h));
    console.log(
      `${known ? '✓' : '⚠ pas dans la liste du club :'} ${f} : ${ranks} classements${old.length ? ` (+ ${old.length} déjà publiés gardés)` : ''}${ranks < lines ? ` ⚠ ${lines - ranks} ligne(s) illisible(s)` : ''}`,
    );
    athletes.push({ ...h, text });
  }
  const kept = before.filter((a) => !athletes.some((b) => sameMember(a, b)));
  if (kept.length) console.log(`${kept.length} nageurs des classements déjà publiés gardés tels quels`);
  athletes.push(...kept);
  writeFileSync(RANKINGS, `${JSON.stringify(await encryptRankings({ updated: new Date().toISOString().slice(0, 10), athletes }, code))}\n`);
  console.log(`Classements de ${athletes.length} nageurs chiffrés dans public/data/club-rankings.json`);
} else if (cmd === 'inscriptions') {
  const [file, given] = args;
  if (!file) throw new Error('Fichier d’inscriptions manquant');
  const code = given ?? process.env.ESN_CODE ?? CLUB.accessKey;
  // PDF : texte mis en page par pdftotext (colonnes du programme conservées)
  const text = /\.pdf$/i.test(file) ? execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }) : readFileSync(file, 'utf8');
  const meet = parseClubEntries(text);
  const starts = meet.athletes.reduce((n, a) => n + a.entries.length, 0);
  const announced = announcedTotals(text);
  if (announced && (announced.swimmers !== meet.athletes.length || announced.starts !== starts))
    throw new Error(`Lecture incomplète : ${meet.athletes.length} nageurs et ${starts} départs lus, ${announced.swimmers} et ${announced.starts} annoncés`);
  const roster = await decryptRoster(JSON.parse(readFileSync(OUT, 'utf8')), code);
  const known = (a) => roster.members.some((m) => sameMember(m, a) || m.aliases?.some((al) => sameMember(al, a)));
  // Prénom coupé par le fichier du club (colonne trop étroite : « Cassandr ») : complété d'après la liste du club
  const flat = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  for (const a of meet.athletes) {
    if (known(a) || flat(a.firstName).length < 4) continue;
    const full = roster.members.filter((m) => m.birthYear === a.birthYear && flat(m.lastName) === flat(a.lastName) && flat(m.firstName).startsWith(flat(a.firstName)));
    if (full.length === 1) a.firstName = full[0].firstName;
  }
  const unknown = meet.athletes.filter((a) => !known(a));
  const before = existsSync(ENTRIES) ? await decryptEntries(JSON.parse(readFileSync(ENTRIES, 'utf8')), code) : null;
  const merged = mergeEntries(before, meet, new Date().toISOString().slice(0, 10));
  writeFileSync(ENTRIES, `${JSON.stringify(await encryptEntries(merged, code))}\n`);
  console.log(`${meet.name} (${meet.city ?? '?'}, ${meet.startDate}${meet.endDate ? ` au ${meet.endDate}` : ''}) : ${meet.athletes.length} nageurs, ${starts} départs`);
  if (unknown.length) console.log(`⚠ ${unknown.length} nageur(s) absent(s) de la liste du club (autre orthographe ?) : ${unknown.map((a) => `${a.lastName} ${a.firstName} (${a.birthYear})`).join(', ')}`);
  console.log(`Inscriptions de ${merged.meets.length} compétition(s) chiffrées dans public/data/club-entries.json`);
} else if (cmd === 'records') {
  const [file, given] = args;
  if (!file) throw new Error('Usage : node scripts/roster.mjs records « RECORDS 31.12.2025.pdf » [CODE] [--au=AAAA-MM-JJ] [--doutes=FICHIER.tsv]');
  const code = given ?? process.env.ESN_CODE ?? CLUB.accessKey;
  // Date de la liste : celle du nom du fichier du club (« RECORDS 31.12.2025 »), sinon --au
  const title = basename(file).replace(/\.(pdf|txt)$/i, '');
  const d = /(\d{2})[./-](\d{2})[./-](\d{4})/.exec(title);
  const asOf = value('au') ?? (d ? `${d[3]}-${d[2]}-${d[1]}` : null);
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('Date de la liste introuvable dans le nom du fichier : ajoutez --au=AAAA-MM-JJ');
  // PDF : texte en tableau (pdftotext -table garde les colonnes filles / garçons alignées)
  const text = /\.pdf$/i.test(file) ? execFileSync('pdftotext', ['-enc', 'UTF-8', '-table', file, '-'], { encoding: 'utf8' }) : readFileSync(file, 'utf8');
  const { records, unread } = parseOfficialRecordsText(text);
  if (!records.length) throw new Error('Aucun record lu : est-ce bien la liste « Records Club » du club ?');
  // Vérifié : même nageur, même épreuve, même temps (et même bassin s'il est indiqué) dans l'historique relevé (tous clubs)
  const STROKE_FR = { FREE: 'Libre', BACK: 'Dos', BREAST: 'Brasse', FLY: 'Papillon', IM: '4 nages' };
  const fmt = (cs) => (cs >= 6000 ? `${Math.floor(cs / 6000)}:${String(Math.floor((cs % 6000) / 100)).padStart(2, '0')}` : String(Math.floor(cs / 100))) + `.${String(cs % 100).padStart(2, '0')}`;
  const hist = existsSync('historique')
    ? readdirSync('historique')
        .filter(isSwimmerFile)
        .map((f) => readFileSync(join('historique', f), 'utf8'))
        .map((t) => ({ h: historyHeader(t), lines: new Set(t.split(/\r?\n/).map((l) => l.split('\t').slice(0, 3).map((c) => c.trim()).join('|'))) }))
        .filter((x) => x.h)
    : [];
  for (const r of records) {
    const pools = r.course ? [r.course === 'SCM' ? '25m' : '50m'] : ['25m', '50m'];
    const keys = pools.map((p) => `${r.distance}m ${STROKE_FR[r.stroke]}|${p}|${fmt(r.timeCs)}`);
    if (hist.some((x) => holderMatches(r.holder, x.h) && keys.some((k) => x.lines.has(k)))) r.verified = true;
  }
  // Records douteux (fichier local) : sexe, épreuve (« 100m Brasse »), temps, détenteur, raison
  const doubtsFile = value('doutes');
  let doubts = 0;
  if (doubtsFile)
    for (const l of readFileSync(doubtsFile, 'utf8').split(/\r?\n/).slice(1).filter(Boolean)) {
      const [g, ev, t, who, why] = l.split('\t');
      const hit = records.filter((r) => r.gender === g && `${r.distance}m ${STROKE_FR[r.stroke]}` === ev && fmt(r.timeCs) === t && r.holder === who);
      if (!hit.length) console.log(`⚠ doute sans record correspondant : ${ev} ${t}`);
      for (const r of hit) {
        r.doubt = why;
        r.verified = false;
        doubts++;
      }
    }
  const list = { title, asOf, source: 'Records Club, site du club', records };
  writeFileSync(OFFICIAL, `${JSON.stringify(await encryptOfficialRecords(list, code))}\n`);
  const n = (f) => records.filter(f).length;
  console.log(`${records.length} records lus (liste au ${asOf}) : ${n((r) => r.verified)} vérifiés dans l'historique, ${n((r) => !r.verified)} non vérifiés, ${doubts} à vérifier`);
  console.log(`  sans date : ${n((r) => !r.date)} ; bassin 50 m : ${n((r) => r.course === 'LCM')} ; sans bassin : ${n((r) => !r.course)}`);
  if (unread.length) console.log(`⚠ ${unread.length} ligne(s) au temps illisible :\n${unread.map((l) => `  ${l}`).join('\n')}`);
  console.log('Liste officielle des records chiffrée dans public/data/club-records.json');
} else {
  const head = readFileSync(new URL(import.meta.url), 'utf8').split('\n');
  console.log(head.slice(0, head.findIndex((l) => !l.startsWith('//'))).join('\n'));
}
