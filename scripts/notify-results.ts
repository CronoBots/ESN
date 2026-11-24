/**
 * Robot des notifications : les jours de compétition du club, lit les résultats officiels (fichier LENEX
 * de live.swimrankings.net, feuilles PDF du livetiming de la fédération) et envoie à chaque téléphone
 * abonné une notification par résultat de ses nageurs suivis (temps, place, record personnel).
 *
 * Lancé par le relais du direct (scripts/live-relay.mjs), à chaque passage. Regroupé pour Node par
 * rolldown (voir .github/workflows/live-relay.yml). Variables :
 *   ESN_PUSH_TOKEN      jeton du robot (base des abonnements)       — secret GitHub
 *   VAPID_PRIVATE_KEY   clé privée des notifications                — secret GitHub
 *   NOTIFY_DRY=1        essai : rien n'est envoyé ni marqué, les notifications sont affichées
 *   NOTIFY_LIVE_IDS     compétitions de live.swimrankings.net en plus (essai), « 11570,11666 »
 *   NOTIFY_TODAY        jour de référence (essai), « 2026-11-14 »
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import webpush from 'web-push';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { CLUB } from '../src/club';
import { decryptHistory, decryptRoster, keepClubRaces, type RosterMember } from '../src/lib/roster';
import { parseSwimrankings } from '../src/lib/swimrankings';
import { parseLenex, unzipFirst } from '../src/lib/lenex';
import { findSwimmerResult, parseSheetHeader } from '../src/lib/resultSheet';
import { groupLines } from '../src/lib/pdfText';
import { closeSwimmer, normName, sameSwimmer } from '../src/lib/results';
import { eventLabel } from '../src/lib/events';
import { formatTime } from '../src/lib/time';
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

/** Résultats des nageurs du club dans le fichier LENEX d'une compétition de live.swimrankings.net. */
async function lenexResults(liveId: string, members: RosterMember[]): Promise<Result[]> {
  const xml = await cached(`https://live.swimrankings.net/${liveId}/results.lxf`, async (buf) => {
    const b = new Uint8Array(buf);
    return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b ? unzipFirst(buf) : '';
  });
  const l = xml ? parseLenex(xml) : null;
  if (!l) return [];
  const out: Result[] = [];
  for (const a of l.athletes) {
    if (!CLUB.member.test((a.club ?? '').trim())) continue;
    const m = members.find((x) => sameSwimmer(a, x)) ?? members.find((x) => closeSwimmer(a, x));
    const member = m ?? { lastName: a.lastName, firstName: a.firstName, birthYear: a.birthYear };
    const key = await swimmerKey(member);
    for (const s of a.swims) {
      if (s.status === 'OK' && s.timeCs == null) continue; // programme, pas encore nagé
      out.push({
        meetKey: `live:${liveId}`,
        meetName: l.meet.name,
        member,
        key,
        eventNo: s.eventNo,
        distance: s.distance,
        stroke: s.stroke,
        course: s.course,
        round: s.round,
        date: s.date ?? l.meet.startDate,
        status: s.status,
        timeCs: s.timeCs,
        place: s.place,
      });
    }
  }
  return out;
}

/** Résultats des nageurs du club dans les feuilles PDF d'un livetiming de la fédération. */
async function pdfResults(base: string, members: RosterMember[], meetName: string): Promise<Result[]> {
  const page = await fetch(base, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }).then((r) => (r.ok ? r.text() : ''));
  const files = [...new Set([...page.matchAll(/href="(ResultList_\d+\.pdf)"/g)].map((m) => m[1]))];
  const name = (/<title>([^<]*)<\/title>/i.exec(page)?.[1] ?? meetName).replace(/\s*-\s*SPLASH Meet Manager.*$/i, '').trim();
  const out: Result[] = [];
  for (const f of files) {
    const text = await cached(base + f, pdfText).catch(() => null);
    if (!text) continue;
    const h = parseSheetHeader([text]);
    if (!h.distance || !h.stroke) continue;
    const flat = normName(text);
    for (const m of members) {
      if ((h.gender && h.gender !== m.gender) || !flat.includes(normName(m.lastName))) continue;
      const r = findSwimmerResult([text], m, h, CLUB.match);
      if (!r || (r.status === 'OK' && r.timeCs == null)) continue;
      out.push({
        meetKey: `ext:${base}`,
        meetName: name,
        member: m,
        key: await swimmerKey(m),
        eventNo: h.eventNo,
        distance: h.distance,
        stroke: h.stroke,
        course: r.course ?? 'SCM',
        round: h.round,
        date: h.date ?? today,
        status: r.status,
        timeCs: r.timeCs,
        place: r.place,
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
      if (s.timeCs == null || (s.status && s.status !== 'OK')) continue;
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
  const liveIds = new Set<string>((process.env.NOTIFY_LIVE_IDS ?? '').split(',').filter(Boolean));
  if (TOKEN) for (const id of await rpc<string[]>('esn_robot_live_meets', { p_token: TOKEN })) liveIds.add(id);
  if (!mirrored.length && !liveIds.size) {
    console.log('Notifications : aucune compétition à lire.');
    return;
  }

  const roster = await decryptRoster(json('public/data/club-roster.json'), CLUB.accessKey);
  const members = roster.members.filter((m) => !m.former);
  const results: Result[] = [];
  for (const id of liveIds) results.push(...(await lenexResults(id, members).catch((e) => (console.warn(`LENEX ${id} : ${e.message}`), []))));
  for (const e of mirrored) results.push(...(await pdfResults(e.live.replace(/index\.html?$/i, ''), members, e.name).catch((err) => (console.warn(`${e.live} : ${err.message}`), []))));
  results.sort((a, b) => (a.date === b.date ? (a.eventNo ?? 0) - (b.eventNo ?? 0) : a.date < b.date ? -1 : 1));
  console.log(`Notifications : ${results.length} résultats du club lus (${liveIds.size} en direct, ${mirrored.length} livetiming de la fédération).`);
  if (!results.length) return;

  const prevBest = bestTimes(await decryptHistory(json('public/data/club-history.json'), CLUB.accessKey));
  const subs = TOKEN ? await rpc<{ endpoint: string; p256dh: string; auth: string; swimmers: string[] }[]>('esn_robot_subscriptions', { p_token: TOKEN }) : [];
  const wanted = new Set(subs.flatMap((s) => s.swimmers));

  // Nouveaux résultats (une seule fois chacun). Ceux des jours précédents sont marqués sans notification.
  const fresh: { r: Result; text: string }[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const id = `${r.meetKey}|${r.key}|${r.eventNo ?? `${r.distance}-${r.stroke}`}|${r.round}`;
    const text = line(r, prevBest(r, results.slice(0, i)));
    if (DRY) {
      if (r.date === today) fresh.push({ r, text });
      continue;
    }
    if (!wanted.has(r.key)) continue; // personne ne suit ce nageur : rien à envoyer (ni à marquer)
    const claimed = await rpc<boolean>('esn_robot_claim', { p_token: TOKEN, p_key: createHash('sha1').update(id).digest('hex') });
    if (claimed && r.date === today) fresh.push({ r, text });
  }
  if (!fresh.length) {
    console.log('Notifications : rien de nouveau.');
    return;
  }

  // Par nageur : une notification par résultat, ou un résumé s'il y en a plus de 2 d'un coup
  const bySwimmer = new Map<string, { r: Result; text: string }[]>();
  for (const f of fresh) bySwimmer.set(f.r.key, [...(bySwimmer.get(f.r.key) ?? []), f]);
  const messages: { swimmer: string; title: string; body: string; tag: string }[] = [];
  for (const [key, list] of bySwimmer) {
    const m = list[0].r.member;
    const title = `🏊 ${m.firstName} ${m.lastName.toUpperCase()}`;
    if (list.length <= 2)
      for (const { r, text } of list) messages.push({ swimmer: key, title, body: `${text}\n${r.meetName}`, tag: `${key}-${r.eventNo ?? r.distance}-${r.round}` });
    else messages.push({ swimmer: key, title: `${title} · ${list.length} résultats`, body: list.map((x) => x.text).join('\n'), tag: `${key}-lot` });
  }
  if (DRY) {
    for (const m of messages) console.log(`[essai] ${m.title}\n        ${m.body.replace(/\n/g, '\n        ')}`);
    return;
  }
  webpush.setVapidDetails('https://cronobots.github.io/ESN/', VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY ?? '');
  let sent = 0;
  for (const s of subs) {
    for (const msg of messages.filter((m) => s.swimmers.includes(m.swimmer))) {
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
        if (code === 404 || code === 410) await rpc('esn_robot_drop', { p_token: TOKEN, p_endpoint: s.endpoint }).catch(() => undefined);
        else console.warn(`Envoi refusé (${code ?? (e as Error).message})`);
      }
    }
  }
  console.log(`Notifications : ${messages.length} message(s), ${sent} envoi(s).`);
}

main().catch((e) => {
  console.error(`Notifications : ${(e as Error).message}`);
  process.exitCode = 1;
});
