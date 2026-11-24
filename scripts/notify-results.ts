/**
 * Robot des notifications : les jours de compétition du club, lit les résultats officiels et le programme
 * (fichier LENEX de live.swimrankings.net, sinon feuilles PDF ; livetiming de la fédération) et envoie à
 * chaque téléphone abonné, selon les types choisis : chaque résultat de ses nageurs suivis (temps, place,
 * record personnel) ou seulement les records perso, et le programme (engagements, qualification en finale).
 *
 * Lancé par le relais du direct (scripts/live-relay.mjs), à chaque passage. Regroupé pour Node par
 * rolldown (voir .github/workflows/live-relay.yml). Variables :
 *   ESN_PUSH_TOKEN      jeton du robot (base des abonnements)       — secret GitHub
 *   VAPID_PRIVATE_KEY   clé privée des notifications                — secret GitHub
 *   NOTIFY_DRY=1        essai : rien n'est envoyé ni marqué, les notifications sont affichées
 *   NOTIFY_LIVE_IDS     compétitions de live.swimrankings.net en plus (essai), « 11570,11666 »
 *   NOTIFY_TODAY        jour de référence (essai), « 2026-11-14 »
 *   NOTIFY_PDF_BASES    pages de livetiming en plus (essai), « https://…/CB-test/ »
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import webpush from 'web-push';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { CLUB } from '../src/club';
import { decryptHistory, decryptRoster, keepClubRaces, type RosterMember } from '../src/lib/roster';
import { parseSwimrankings } from '../src/lib/swimrankings';
import { parseLenex, unzipFirst } from '../src/lib/lenex';
import { findSwimmerEntry, findSwimmerResult, parseSheetHeader } from '../src/lib/resultSheet';
import { groupLines } from '../src/lib/pdfText';
import { closeSwimmer, normName, sameSwimmer } from '../src/lib/results';
import { eventLabel } from '../src/lib/events';
import { formatTime } from '../src/lib/time';
import { formatShortWeekday } from '../src/lib/dates';
import { PUSH_API, swimmerKey, VAPID_PUBLIC_KEY } from '../src/lib/pushKey';
// @ts-expect-error script Node sans types
import { activeEvents, eventKey, withLinks } from './mirror-live.mjs';
import type { Course, Round, Stroke } from '../src/store/types';

const TOKEN = process.env.ESN_PUSH_TOKEN ?? '';
const DRY = process.env.NOTIFY_DRY === '1';
const UA = 'ESN-Competition/1.0 (application du club, notifications des résultats)';
const CACHE = '.notify-cache';
const today = process.env.NOTIFY_TODAY || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());

/** Un résultat officiel d'un nageur du club. */
interface Result {
  meetKey: string;
  meetName: string;
  member: { lastName: string; firstName: string; birthYear?: number };
  key: string;
  eventNo?: number;
  distance: number;
  stroke: Stroke;
  course: Course;
  round: Round;
  date: string;
  status: 'OK' | 'DSQ' | 'DNS' | 'DNF';
  timeCs?: number;
  place?: number;
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${PUSH_API.url}/${name}`, {
    method: 'POST',
    headers: { apikey: PUSH_API.key, Authorization: `Bearer ${PUSH_API.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${name} : ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

const json = (path: string) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

/** Téléchargement avec cache sur disque (requête conditionnelle : une feuille inchangée n'est pas relue). */
async function cached(url: string, parse: (buf: ArrayBuffer) => Promise<string>): Promise<string | null> {
  mkdirSync(CACHE, { recursive: true });
  const file = `${CACHE}/${createHash('sha1').update(url).digest('hex')}.json`;
  const prev = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { lm?: string; etag?: string; text: string }) : null;
  const headers: Record<string, string> = { 'User-Agent': UA };
  if (prev?.etag) headers['If-None-Match'] = prev.etag;
  if (prev?.lm) headers['If-Modified-Since'] = prev.lm;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (res.status === 304 && prev) return prev.text;
  if (!res.ok) return null;
  const text = await parse(await res.arrayBuffer());
  writeFileSync(file, JSON.stringify({ lm: res.headers.get('last-modified') ?? undefined, etag: res.headers.get('etag') ?? undefined, text }));
  return text;
}

async function pdfText(buf: ArrayBuffer): Promise<string> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push(...groupLines((await (await doc.getPage(i)).getTextContent()).items as never), '');
  return out.join('\n');
}

/** Au programme d'une compétition (liste de départ publiée), pas encore nagé. */
interface Entry {
  meetKey: string;
  meetName: string;
  member: { lastName: string; firstName: string; birthYear?: number };
  key: string;
  eventNo?: number;
  distance: number;
  stroke: Stroke;
  round: Round;
  date: string;
  startTime?: string;
  heat?: number;
  lane?: number;
}

interface MeetRead {
  results: Result[];
  entries: Entry[];
}

/** Compétition de live.swimrankings.net : fichier LENEX (résultats et programme), sinon ses feuilles PDF. */
async function liveMeet(liveId: string, members: RosterMember[]): Promise<MeetRead> {
  const xml = await cached(`https://live.swimrankings.net/${liveId}/results.lxf`, async (buf) => {
    const b = new Uint8Array(buf);
    return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b ? unzipFirst(buf) : '';
  }).catch(() => null);
  const l = xml ? parseLenex(xml) : null;
  if (!l) return pdfMeet(`https://live.swimrankings.net/${liveId}/`, `live:${liveId}`, members, '');
  const out: MeetRead = { results: [], entries: [] };
  for (const a of l.athletes) {
    if (!CLUB.member.test((a.club ?? '').trim())) continue;
    const m = members.find((x) => sameSwimmer(a, x)) ?? members.find((x) => closeSwimmer(a, x));
    const member = m ?? { lastName: a.lastName, firstName: a.firstName, birthYear: a.birthYear };
    const key = await swimmerKey(member);
    const base = { meetKey: `live:${liveId}`, meetName: l.meet.name, member, key };
    for (const s of a.swims) {
      const date = s.date ?? l.meet.startDate;
      if (s.status === 'OK' && s.timeCs == null) {
        out.entries.push({ ...base, eventNo: s.eventNo, distance: s.distance, stroke: s.stroke, round: s.round, date, startTime: s.startTime, heat: s.heat, lane: s.lane });
        continue;
      }
      out.results.push({ ...base, eventNo: s.eventNo, distance: s.distance, stroke: s.stroke, course: s.course, round: s.round, date, status: s.status, timeCs: s.timeCs, place: s.place });
    }
  }
  return out;
}

/** Feuilles PDF d'une compétition (Splash Meet Manager) : résultats publiés, et programme des épreuves pas encore nagées. */
async function pdfMeet(base: string, meetKey: string, members: RosterMember[], meetName: string): Promise<MeetRead> {
  const page = await fetch(base, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }).then((r) => (r.ok ? r.text() : ''));
  const sheets = (kind: string) => new Map([...page.matchAll(new RegExp(`href="(${kind}_(\\d+)\\.pdf)"`, 'g'))].map((m) => [Number(m[2]), m[1]]));
  const resultFiles = sheets('ResultList');
  const startFiles = sheets('StartList');
  const name = (/<title>([^<]*)<\/title>/i.exec(page)?.[1] ?? meetName).replace(/\s*-\s*SPLASH Meet Manager.*$/i, '').trim() || meetName;
  const out: MeetRead = { results: [], entries: [] };
  const read = async (f: string) => {
    const text = await cached(base + f, pdfText).catch(() => null);
    return text ? { text, h: parseSheetHeader([text]) } : null;
  };
  for (const f of resultFiles.values()) {
    const sheet = await read(f);
    if (!sheet?.h.distance || !sheet.h.stroke) continue;
    const { text, h } = sheet;
    const flat = normName(text);
    for (const m of members) {
      if ((h.gender && h.gender !== m.gender) || !flat.includes(normName(m.lastName))) continue;
      const r = findSwimmerResult([text], m, h, CLUB.match);
      if (!r || (r.status === 'OK' && r.timeCs == null)) continue;
      out.results.push({
        meetKey,
        meetName: name,
        member: m,
        key: await swimmerKey(m),
        eventNo: h.eventNo,
        distance: h.distance!,
        stroke: h.stroke!,
        course: r.course ?? 'SCM',
        round: h.round,
        date: h.date ?? today,
        status: r.status,
        timeCs: r.timeCs,
        place: r.place,
      });
    }
  }
  // Programme : listes de départ des épreuves sans résultat
  for (const [no, f] of startFiles) {
    if (resultFiles.has(no)) continue;
    const sheet = await read(f);
    if (!sheet?.h.distance || !sheet.h.stroke) continue;
    const { text, h } = sheet;
    const flat = normName(text);
    for (const m of members) {
      if ((h.gender && h.gender !== m.gender) || !flat.includes(normName(m.lastName))) continue;
      const e = findSwimmerEntry(text, m, CLUB.match);
      if (!e) continue;
      out.entries.push({
        meetKey,
        meetName: name,
        member: m,
        key: await swimmerKey(m),
        eventNo: h.eventNo ?? no,
        distance: h.distance!,
        stroke: h.stroke!,
        round: h.round,
        date: h.date ?? today,
        startTime: h.startTime,
        heat: e.heat,
        lane: e.lane,
      });
    }
  }
  return out;
}

/** Meilleur temps connu avant cette course (historique du club, puis résultats de la compétition). */
function bestTimes(history: { athletes: { lastName: string; firstName: string; birthYear?: number; text: string }[] }) {
  const best = new Map<string, { cs: number; date: string }[]>();
  for (const a of history.athletes) {
    const k = `${normName(a.lastName)}|${normName(a.firstName)}|${a.birthYear ?? ''}`;
    for (const s of parseSwimrankings(keepClubRaces(a.text, CLUB.match).text).swims) {
      if (s.timeCs == null || s.status) continue; // disqualification, forfait, abandon
      const e = `${k}|${s.course}|${s.distance}|${s.stroke}`;
      best.set(e, [...(best.get(e) ?? []), { cs: s.timeCs, date: s.date }]);
    }
  }
  return (r: Result, earlier: Result[]): number | undefined => {
    const k = `${normName(r.member.lastName)}|${normName(r.member.firstName)}|${r.member.birthYear ?? ''}`;
    const times = [
      ...(best.get(`${k}|${r.course}|${r.distance}|${r.stroke}`) ?? []).filter((t) => t.date < r.date).map((t) => t.cs),
      ...earlier.filter((x) => x.key === r.key && x.course === r.course && x.distance === r.distance && x.stroke === r.stroke && x.status === 'OK' && x.timeCs != null).map((x) => x.timeCs!),
    ];
    return times.length ? Math.min(...times) : undefined;
  };
}

const place = (p: number) => `${p}${p === 1 ? 're' : 'e'}`;

function line(r: Result, prevBest: number | undefined): string {
  const ev = eventLabel(r.distance, r.stroke);
  if (r.status !== 'OK') return `${ev} · ${r.status === 'DSQ' ? 'disqualification' : r.status === 'DNS' ? 'forfait' : 'abandon'}`;
  const bits = [ev, formatTime(r.timeCs!)];
  if (r.place) bits.push(r.round === 'HEAT' || r.round === 'SEMI' ? `${place(r.place)} des séries` : place(r.place));
  if (prevBest == null) bits.push('1er temps');
  else if (r.timeCs! < prevBest) bits.push(`record perso −${formatTime(prevBest - r.timeCs!)}`);
  return bits.join(' · ');
}

type Kind = 'results' | 'pb' | 'entries';
interface Sub {
  endpoint: string;
  p256dh: string;
  auth: string;
  swimmers: string[];
  kinds: Kind[] | null;
}
interface Message {
  swimmer: string;
  kind: Kind;
  /** Contient un record personnel (pour les téléphones qui ne veulent que ceux-là). */
  pb: boolean;
  title: string;
  body: string;
  tag: string;
}

const dayLabel = (iso: string) => `${formatShortWeekday(iso)} ${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`;

function entryLine(e: Entry): string {
  return [
    `${dayLabel(e.date)}${e.startTime ? ` ${e.startTime}` : ''}`,
    eventLabel(e.distance, e.stroke) + (e.round === 'FINAL' ? ' (finale)' : e.round === 'SEMI' ? ' (demi-finale)' : ''),
    e.heat ? `série ${e.heat}${e.lane != null ? `, couloir ${e.lane}` : ''}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

async function main() {
  const calendar = json('public/data/club-calendar.json');
  let links: Record<string, string> = {};
  try {
    const state = JSON.parse(readFileSync('.live-links/links.json', 'utf8'));
    links = Object.fromEntries(Object.entries(state).map(([k, v]) => [k, (v as { live?: string }).live]).filter(([, v]) => v)) as Record<string, string>;
  } catch {
    /* pas de lien trouvé */
  }
  const prev = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const mirrored = (activeEvents(withLinks(calendar, links), today) as { live: string; start: string; end?: string; name: string }[]).filter(
    (e) => prev(e.start) <= today && (e.end ?? e.start) >= today,
  );
  // Essai : autres pages de livetiming (« https://…/CB-test/ »)
  for (const url of (process.env.NOTIFY_PDF_BASES ?? '').split(',').filter(Boolean)) mirrored.push({ live: url, start: today, name: 'Essai' });
  const liveIds = new Set<string>((process.env.NOTIFY_LIVE_IDS ?? '').split(',').filter(Boolean));
  if (TOKEN) for (const id of await rpc<string[]>('esn_robot_live_meets', { p_token: TOKEN })) liveIds.add(id);
  if (!mirrored.length && !liveIds.size) {
    console.log('Notifications : aucune compétition à lire.');
    return;
  }

  const roster = await decryptRoster(json('public/data/club-roster.json'), CLUB.accessKey);
  const members = roster.members.filter((m) => !m.former);
  const read: MeetRead[] = [];
  for (const id of liveIds) read.push(await liveMeet(id, members).catch((e) => (console.warn(`Compétition ${id} : ${e.message}`), { results: [], entries: [] })));
  for (const e of mirrored)
    read.push(await pdfMeet(e.live.replace(/index\.html?$/i, ''), `ext:${e.live}`, members, e.name).catch((err) => (console.warn(`${e.live} : ${err.message}`), { results: [], entries: [] })));
  const results = read.flatMap((x) => x.results).sort((a, b) => (a.date === b.date ? (a.eventNo ?? 0) - (b.eventNo ?? 0) : a.date < b.date ? -1 : 1));
  const entries = read.flatMap((x) => x.entries).filter((e) => e.date >= today);
  console.log(`Notifications : ${results.length} résultats et ${entries.length} épreuves au programme pour le club (${liveIds.size} compétition(s) signalée(s), ${mirrored.length} livetiming de la fédération).`);
  if (!results.length && !entries.length) return;

  const subs = TOKEN ? await rpc<Sub[]>('esn_robot_subscriptions', { p_token: TOKEN }) : [];
  const wanted = new Set(subs.flatMap((s) => s.swimmers));
  /** Nouveau (une seule fois) ? En essai : tout ce qui est du jour. */
  const claim = async (id: string) =>
    DRY || (await rpc<boolean>('esn_robot_claim', { p_token: TOKEN, p_key: createHash('sha1').update(id).digest('hex') }));

  // Résultats : une seule fois chacun ; ceux des jours précédents sont marqués sans notification
  const prevBest = results.length ? bestTimes(await decryptHistory(json('public/data/club-history.json'), CLUB.accessKey)) : () => undefined;
  const fresh: { r: Result; text: string; pb: boolean }[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!DRY && !wanted.has(r.key)) continue; // personne ne suit ce nageur : rien à envoyer (ni à marquer)
    const best = prevBest(r, results.slice(0, i));
    const pb = r.status === 'OK' && r.timeCs != null && best != null && r.timeCs < best;
    if ((await claim(`${r.meetKey}|${r.key}|${r.eventNo ?? `${r.distance}-${r.stroke}`}|${r.round}`)) && r.date === today) fresh.push({ r, text: line(r, best), pb });
  }
  // Programme : chaque épreuve une seule fois (finale comprise, quand le nageur s'y qualifie)
  const newEntries: Entry[] = [];
  for (const e of entries) {
    if (!DRY && !wanted.has(e.key)) continue;
    if (await claim(`entry|${e.meetKey}|${e.key}|${e.eventNo ?? `${e.distance}-${e.stroke}`}|${e.round}`)) newEntries.push(e);
  }
  if (!fresh.length && !newEntries.length) {
    console.log('Notifications : rien de nouveau.');
    return;
  }

  const name = (m: Result['member']) => `${m.firstName} ${m.lastName.toUpperCase()}`;
  const messages: Message[] = [];
  // Résultats, par nageur : un message par résultat, ou un résumé au-delà de 2. Deux versions : tous les
  // résultats, ou seulement les records perso (pour les téléphones qui n'en veulent pas d'autres).
  for (const kind of ['results', 'pb'] as const) {
    const bySwimmer = new Map<string, typeof fresh>();
    for (const f of fresh) if (kind === 'results' || f.pb) bySwimmer.set(f.r.key, [...(bySwimmer.get(f.r.key) ?? []), f]);
    for (const [key, list] of bySwimmer) {
      const title = `🏊 ${name(list[0].r.member)}`;
      if (list.length <= 2)
        for (const { r, text, pb } of list) messages.push({ swimmer: key, kind, pb, title, body: `${text}\n${r.meetName}`, tag: `${key}-${r.eventNo ?? r.distance}-${r.round}` });
      else
        messages.push({ swimmer: key, kind, pb: list.some((x) => x.pb), title: `${title} · ${list.length} résultats`, body: list.map((x) => x.text).join('\n'), tag: `${key}-lot-${kind}` });
    }
  }
  // Programme, par nageur et par compétition
  const byMeet = new Map<string, Entry[]>();
  for (const e of newEntries) byMeet.set(`${e.key}|${e.meetKey}`, [...(byMeet.get(`${e.key}|${e.meetKey}`) ?? []), e]);
  for (const list of byMeet.values()) {
    list.sort((a, b) => `${a.date} ${a.startTime ?? ''}`.localeCompare(`${b.date} ${b.startTime ?? ''}`));
    const finals = list.every((e) => e.round === 'FINAL' || e.round === 'SEMI');
    const lines = list.slice(0, 6).map(entryLine);
    if (list.length > 6) lines.push(`+ ${list.length - 6} autres épreuves`);
    messages.push({
      swimmer: list[0].key,
      kind: 'entries',
      pb: false,
      title: finals ? `🏁 ${name(list[0].member)} en finale` : `📋 ${name(list[0].member)} au programme`,
      body: `${lines.join('\n')}\n${list[0].meetName}`,
      tag: `${list[0].key}-prog-${list[0].eventNo ?? ''}-${list.length}`,
    });
  }
  if (DRY) {
    for (const m of messages) console.log(`[essai · ${m.kind}] ${m.title}\n        ${m.body.replace(/\n/g, '\n        ')}`);
    return;
  }

  webpush.setVapidDetails('https://cronobots.github.io/ESN/', VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY ?? '');
  let sent = 0;
  for (const s of subs) {
    const kinds = new Set<Kind>(s.kinds ?? ['results', 'entries']);
    // « Records perso seulement » : la version filtrée des résultats ; sinon tous les résultats
    const resultKind: Kind | null = kinds.has('results') ? 'results' : kinds.has('pb') ? 'pb' : null;
    for (const msg of messages) {
      if (!s.swimmers.includes(msg.swimmer)) continue;
      if (msg.kind === 'entries' ? !kinds.has('entries') : msg.kind !== resultKind) continue;
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: msg.title, body: msg.body, tag: msg.tag, url: './#/' }),
          { TTL: 6 * 3600, urgency: 'high' },
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // Abonnement expiré ou supprimé sur le téléphone : retiré de la base
        if (code === 404 || code === 410) {
          await rpc('esn_robot_drop', { p_token: TOKEN, p_endpoint: s.endpoint }).catch(() => undefined);
          break;
        }
        console.warn(`Envoi refusé (${code ?? (e as Error).message})`);
      }
    }
  }
  console.log(`Notifications : ${messages.length} message(s), ${sent} envoi(s).`);
}

main().catch((e) => {
  console.error(`Notifications : ${(e as Error).message}`);
  process.exitCode = 1;
});
