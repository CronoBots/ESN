/**
 * Bilan de la récupération des données des nageurs du club, source par source.
 *
 *   npm run audit
 *
 * Écrit audit/rapport.md (dossier local, ignoré par git : il contient des noms) et affiche un résumé.
 * - Liste du club : actifs, anciens, doublons possibles.
 * - Historique publié (public/data/club-history.json) : état de chaque membre actif (absent, partiel,
 *   complet sans club par course, vérifié), nombre de courses, période, part avec place, tour, passages.
 * - Classements nationaux publiés (public/data/club-rankings.json).
 * - Contrôle des meilleurs temps : si le dossier controle/ contient, pour un nageur, ses meilleurs temps
 *   relevés sur swimrankings (même format que l'historique), ils sont comparés à l'historique publié.
 * - Résultats en direct (live.swimrankings.net, réseau) : nageurs de l'ESN trouvés dans les fichiers de
 *   résultats récents, absents de la liste du club ou que l'application ne relierait pas à leur fiche.
 */
import { describe, it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CLUB } from '../../src/club';
import { decryptHistory, decryptRankings, decryptRoster, historyHeader, keepClubRaces, type RosterMember } from '../../src/lib/roster';
import { parseSwimrankings, type ParsedSwim } from '../../src/lib/swimrankings';
import { parseRankingsText } from '../../src/lib/rankings';
import { parseMeetList, swimsForClub } from '../../src/lib/liveResults';
import { parseLenex, unzipFirst, type LenexAthlete } from '../../src/lib/lenex';
import { closeSwimmer, normName, sameSwimmer } from '../../src/lib/results';
import { eventLabel } from '../../src/lib/events';
import { formatTime } from '../../src/lib/time';

const KEY = process.env.ESN_CODE ?? CLUB.accessKey;
const out: string[] = [];
const summary: string[] = [];
const say = (s = '') => out.push(s);
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)} %` : '–');
const who = (m: { lastName: string; firstName: string; birthYear?: number }) => `${m.lastName} ${m.firstName}${m.birthYear ? ` (${m.birthYear})` : ''}`;
const sameMember = (a: { lastName: string; firstName: string; birthYear?: number }, b: { lastName: string; firstName: string; birthYear?: number }) =>
  normName(a.lastName) === normName(b.lastName) && normName(a.firstName) === normName(b.firstName) && (!a.birthYear || !b.birthYear || a.birthYear === b.birthYear);

describe('bilan de la récupération', () => {
  it('toutes les sources', async () => {
    const roster = await decryptRoster(read('public/data/club-roster.json'), KEY);
    const active = roster.members.filter((m) => !m.former);
    const former = roster.members.filter((m) => m.former);
    const history = existsSync('public/data/club-history.json') ? (await decryptHistory(read('public/data/club-history.json'), KEY)).athletes : [];
    const rankings = existsSync('public/data/club-rankings.json') ? (await decryptRankings(read('public/data/club-rankings.json'), KEY)).athletes : [];
    const today = new Date().toISOString().slice(0, 10);

    say(`# Bilan de la récupération — ${today}`);
    say();

    // 1. Liste du club
    say('## 1. Liste du club');
    say(`${active.length} membres actifs, ${former.length} anciens membres (liste du ${roster.updated}).`);
    const dupes: string[] = [];
    roster.members.forEach((a, i) =>
      roster.members.slice(i + 1).forEach((b) => {
        if (normName(a.lastName) === normName(b.lastName) && normName(a.firstName) === normName(b.firstName)) dupes.push(`${who(a)} / ${who(b)}`);
      }),
    );
    say(dupes.length ? `Doublons possibles (même nom) : ${dupes.join(' ; ')}` : 'Aucun doublon de nom.');
    say();

    // 2. Historique
    say('## 2. Historique swimrankings publié');
    const histOf = (m: RosterMember) => history.find((a) => sameMember(a, m));
    const rows: string[] = [];
    const todo = { absent: [] as string[], partial: [] as string[], noClub: [] as string[] };
    let races = 0;
    let withPlace = 0;
    let withRound = 0;
    let withSplits = 0;
    let dsq = 0;
    for (const m of active) {
      const h = histOf(m);
      if (!h) {
        todo.absent.push(who(m));
        rows.push(`| ${who(m)} | absent | | | | | |`);
        continue;
      }
      const parsed: ParsedSwim[] = parseSwimrankings(keepClubRaces(h.text, CLUB.match).text).swims;
      // Disqualifications et forfaits (sans temps) comptés à part
      const swims = parsed.filter((s) => !s.status);
      dsq += parsed.length - swims.length;
      const state = /^@@PARTIEL/m.test(h.text) ? 'partiel (meilleurs temps)' : /^@@CLUBS/m.test(h.text) ? 'vérifié (club par course)' : 'complet, club non relevé';
      if (/^@@PARTIEL/m.test(h.text)) todo.partial.push(who(m));
      else if (!/^@@CLUBS/m.test(h.text)) todo.noClub.push(who(m));
      const dates = swims.map((s) => s.date).sort();
      const p = swims.filter((s) => s.place != null).length;
      const r = swims.filter((s) => s.round && s.round !== 'TIM').length;
      const sp = swims.filter((s) => s.splits?.length).length;
      races += swims.length;
      withPlace += p;
      withRound += r;
      withSplits += sp;
      rows.push(`| ${who(m)} | ${state} | ${swims.length} | ${dates[0] ?? ''} → ${dates[dates.length - 1] ?? ''} | ${pct(p, swims.length)} | ${pct(r, swims.length)} | ${pct(sp, swims.length)} |`);
    }
    say('| Nageur | État | Courses | Période | Place | Tour | Passages |');
    say('|---|---|---|---|---|---|---|');
    rows.forEach((r) => say(r));
    const orphans = history.filter((a) => !roster.members.some((m) => sameMember(a, m)));
    const formerWith = former.filter((m) => histOf(m)).length;
    say();
    say(`Anciens membres avec un historique : ${formerWith} sur ${former.length}.`);
    if (orphans.length) say(`Historiques sans membre dans la liste (à rattacher ou retirer) : ${orphans.map(who).join(' ; ')}`);
    say(`À faire : ${todo.absent.length} absent(s), ${todo.partial.length} partiel(s), ${todo.noClub.length} sans club par course.`);
    say();
    summary.push(
      `Historique : ${active.length - todo.absent.length}/${active.length} actifs ; ${active.length - todo.absent.length - todo.partial.length - todo.noClub.length} vérifiés ; ` +
        `${races} courses (place ${pct(withPlace, races)}, tour ${pct(withRound, races)}, passages ${pct(withSplits, races)}) ; ${dsq} disqualifications ou forfaits`,
    );

    // 3. Classements nationaux
    say('## 3. Classements nationaux publiés');
    const ranked = active.map((m) => {
      const a = rankings.find((x) => sameMember(x, m));
      const list = a ? parseRankingsText(a.text) : [];
      return { m, list };
    });
    const withRanks = ranked.filter((x) => x.list.length);
    say(`${withRanks.length} actifs sur ${active.length} avec au moins un classement.`);
    for (const { m, list } of withRanks) {
      const seasons = [...new Set(list.map((r) => r.season))].sort().join(', ');
      const best = [...list].sort((a, b) => a.rank - b.rank)[0];
      say(`- ${who(m)} : ${list.length} classement(s), saisons ${seasons} ; meilleur rang ${best.rank}e (${eventLabel(best.distance, best.stroke)}, ${best.label})`);
    }
    const without = ranked.filter((x) => !x.list.length).map((x) => who(x.m));
    if (without.length) say(`Sans classement : ${without.join(' ; ')}`);
    say();
    summary.push(`Classements : ${withRanks.length}/${active.length} actifs`);

    // 4. Contrôle des meilleurs temps
    say('## 4. Contrôle des meilleurs temps (dossier controle/)');
    if (!existsSync('controle')) {
      say('Pas de dossier controle/ : contrôle non fait.');
      summary.push('Contrôle des meilleurs temps : non fait (pas de dossier controle/)');
    } else {
      let ok = 0;
      const issues: string[] = [];
      // Écarts expliqués : course nagée pour un autre club (relevé complet local historique/, retirée à la
      // publication) ou temps de passage officiel (400 m d'un 800 m…, que l'application ne compte pas comme course)
      const explained = { club: [] as string[], split: [] as string[] };
      const local = existsSync('historique')
        ? readdirSync('historique')
            .filter((x) => x.endsWith('.txt') && !x.startsWith('_'))
            .map((x) => readFileSync(`historique/${x}`, 'utf8'))
            .map((t) => ({ h: historyHeader(t), lines: t.split(/\r?\n/).filter((l) => l.split('\t').length >= 7) }))
        : [];
      const otherClub = (h: { lastName: string; firstName: string; birthYear?: number }, pb: ParsedSwim & { timeCs: number }) => {
        for (const l of local.find((x) => x.h && sameMember(x.h, h))?.lines ?? []) {
          const c = l.split('\t');
          if (c[2].trim().replace(/M$/, '') !== formatTime(pb.timeCs) || !c[7]?.trim() || CLUB.match.test(c[7])) continue;
          const s = parseSwimrankings(c.slice(0, 7).join('\t')).swims[0];
          if (s && s.distance === pb.distance && s.stroke === pb.stroke && s.course === pb.course && s.date === pb.date) return c[7].trim();
        }
        return null;
      };
      const longer = (pub: ParsedSwim[], pb: ParsedSwim) =>
        pub.find(
          (o) =>
            pb.stroke === 'FREE' && o.stroke === 'FREE' && o.course === pb.course && o.date === pb.date &&
            ((pb.distance === 400 && (o.distance === 800 || o.distance === 1500)) || (pb.distance === 800 && o.distance === 1500)),
        );
      for (const f of readdirSync('controle').filter((x) => x.endsWith('.txt'))) {
        const text = readFileSync(`controle/${f}`, 'utf8');
        const h = historyHeader(text);
        if (!h) {
          issues.push(`${f} : en-tête « NOM, Prénom (AAAA) » introuvable`);
          continue;
        }
        const pubText = history.find((a) => sameMember(a, h))?.text;
        // Seulement les courses nagées : une disqualification n'a pas de temps
        const timed = (list: ParsedSwim[]) => list.filter((s): s is ParsedSwim & { timeCs: number } => s.timeCs != null);
        const pub = timed(pubText ? parseSwimrankings(keepClubRaces(pubText, CLUB.match).text).swims : []);
        for (const pb of timed(parseSwimrankings(text).swims)) {
          const same = pub.filter((s) => s.distance === pb.distance && s.stroke === pb.stroke && s.course === pb.course);
          const best = same.reduce<ParsedSwim | undefined>((b, s) => (!b || s.timeCs < b.timeCs ? s : b), undefined);
          const ev = `${eventLabel(pb.distance, pb.stroke)} ${pb.course === 'LCM' ? '50 m' : '25 m'}`;
          const club = best?.timeCs === pb.timeCs ? null : otherClub(h, pb);
          const lap = best?.timeCs === pb.timeCs || club ? undefined : longer(pub, pb);
          if (best && best.timeCs === pb.timeCs) ok++;
          else if (club) explained.club.push(`${who(h)} · ${ev} : record ${formatTime(pb.timeCs)} du ${pb.date} nagé pour ${club}`);
          else if (lap) explained.split.push(`${who(h)} · ${ev} : record ${formatTime(pb.timeCs)} du ${pb.date} = temps de passage officiel de son ${lap.distance} m (pas une course)`);
          else if (!best) issues.push(`${who(h)} · ${ev} : record ${formatTime(pb.timeCs)} du ${pb.date} absent de l'historique (aucune course de cette épreuve)`);
          else if (best.timeCs > pb.timeCs)
            issues.push(`${who(h)} · ${ev} : record swimrankings ${formatTime(pb.timeCs)} (${pb.date}) manque, l'historique s'arrête à ${formatTime(best.timeCs)} (autre club ? course non relevée ?)`);
          else issues.push(`${who(h)} · ${ev} : l'historique a ${formatTime(best.timeCs)} (${best.date}), plus rapide que le record swimrankings ${formatTime(pb.timeCs)}`);
        }
      }
      const nExpl = explained.club.length + explained.split.length;
      say(`${ok} meilleurs temps identiques ; ${nExpl} écart(s) expliqué(s) ; ${issues.length} écart(s) à vérifier.`);
      if (issues.length) say('### À vérifier');
      issues.forEach((i) => say(`- ${i}`));
      say(`### Expliqués : nagés pour un autre club (${explained.club.length})`);
      explained.club.forEach((i) => say(`- ${i}`));
      say(`### Expliqués : temps de passage officiels (${explained.split.length})`);
      explained.split.forEach((i) => say(`- ${i}`));
      summary.push(
        `Contrôle des meilleurs temps : ${ok} identiques, ${nExpl} écarts expliqués (${explained.club.length} autre club, ${explained.split.length} passages officiels), ${issues.length} à vérifier`,
      );
    }
    say();

    // 5. Résultats en direct
    say('## 5. Résultats en direct (live.swimrankings.net)');
    try {
      const list = parseMeetList(await (await fetch(`https://live.swimrankings.net/?nation=${CLUB.liveNation}`)).text());
      const meets = list.filter((m) => m.status !== 'upcoming');
      const esn = new Map<string, { a: LenexAthlete; meets: Set<string>; results: number }>();
      const noLenex: string[] = [];
      for (const m of meets) {
        await new Promise((r) => setTimeout(r, 800)); // rythme poli
        const res = await fetch(`https://live.swimrankings.net/${m.id}/results.lxf`).catch(() => null);
        const buf = res?.ok ? await res.arrayBuffer() : null;
        const b = buf ? new Uint8Array(buf) : null;
        if (!b || b.length < 4 || b[0] !== 0x50 || b[1] !== 0x4b) {
          noLenex.push(`${m.startDate ?? '?'} ${m.name}`);
          continue;
        }
        // Fichier abîmé (archive tronquée, sans compétition) : cette compétition seulement est passée
        const l = await unzipFirst(buf!)
          .then(parseLenex)
          .catch(() => null);
        if (!l) {
          noLenex.push(`${m.startDate ?? '?'} ${m.name} (fichier illisible)`);
          continue;
        }
        for (const a of l.athletes) {
          if (!swimsForClub(a)) continue;
          const k = `${normName(a.lastName)}|${normName(a.firstName)}|${a.birthYear ?? ''}`;
          const e = esn.get(k) ?? { a, meets: new Set<string>(), results: 0 };
          e.meets.add(m.name);
          e.results += a.swims.length;
          esn.set(k, e);
        }
      }
      const members = roster.members.map((m) => ({ ...m, gender: m.gender }));
      const missing: string[] = [];
      const formerFound: string[] = [];
      const fuzzy: string[] = [];
      let matched = 0;
      for (const { a, meets: ms, results } of esn.values()) {
        // Même nageur, ou un de ses « autres noms » de la liste (orthographe déjà confirmée) : relié sans doute
        const exact = members.find((m) => sameSwimmer(a, m) || (m.aliases ?? []).some((al) => sameSwimmer(a, al)));
        const close = exact ? undefined : members.find((m) => closeSwimmer(a, m));
        const m = exact ?? close;
        const line = `${who({ lastName: a.lastName.toUpperCase(), firstName: a.firstName, birthYear: a.birthYear })} : ${results} résultat(s), ${ms.size} compétition(s)`;
        if (!m) missing.push(line);
        else {
          matched++;
          if (close) fuzzy.push(`${line} → relié à ${who(close)} (orthographe proche)`);
          if (m.former) formerFound.push(`${line} → marqué « ancien » dans la liste`);
        }
      }
      say(`${meets.length} compétitions listées ; ${meets.length - noLenex.length} avec fichier de résultats ; ${esn.size} nageurs de l'ESN trouvés, ${matched} reliés à la liste.`);
      if (missing.length) say(`Nageurs de l'ESN absents de la liste du club (à ajouter) :\n${missing.map((x) => `- ${x}`).join('\n')}`);
      if (fuzzy.length) say(`Reliés malgré une orthographe différente (à vérifier, « autres noms ») :\n${fuzzy.map((x) => `- ${x}`).join('\n')}`);
      if (formerFound.length) say(`Nagent encore pour l'ESN mais marqués anciens :\n${formerFound.map((x) => `- ${x}`).join('\n')}`);
      if (noLenex.length) say(`Sans fichier de résultats (feuilles PDF, lues par l'application) : ${noLenex.join(' ; ')}`);
      summary.push(`Résultats en direct : ${esn.size} nageurs ESN, ${missing.length} absent(s) de la liste, ${formerFound.length} marqué(s) anciens à tort, ${fuzzy.length} orthographe(s) à vérifier`);
    } catch (e) {
      say(`Lecture impossible (${(e as Error).message}) : vérifier la connexion internet.`);
      summary.push('Résultats en direct : lecture impossible (connexion ?)');
    }

    mkdirSync('audit', { recursive: true });
    // Résumé en tête du rapport (affiché par scripts/audit/show.mjs après npm run audit)
    const [title, ...rest] = out;
    writeFileSync('audit/rapport.md', `${[title, '', '## Résumé', ...summary.map((x) => `- ${x}`), '', ...rest].join('\n')}\n`);
  });
});
