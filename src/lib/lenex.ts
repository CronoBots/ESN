import type { Course, Gender, Round, Stroke } from '../store/types';
import { isValidEvent } from './events';
import type { ReportMeet } from './results';

/**
 * LENEX : format standard d'échange des résultats de natation (fichiers .lxf
 * = archive zip contenant un .lef XML), produit par Splash Meet Manager et
 * publié sur live.swimrankings.net.
 */

interface XNode {
  tag: string;
  attrs: Record<string, string>;
  children: XNode[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

/** Analyseur XML minimal (LENEX n'utilise que des éléments et attributs). */
export function parseXml(xml: string): XNode {
  const root: XNode = { tag: '#root', attrs: {}, children: [] };
  const stack: XNode[] = [root];
  const tagRe = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>/g;
  const attrRe = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml))) {
    if (!m[2]) continue; // commentaire, déclaration…
    if (m[1]) {
      // fermeture
      while (stack.length > 1 && stack.pop()!.tag !== m[2]) {
        /* tolère les balises mal fermées */
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(m[3]))) attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
    const node: XNode = { tag: m[2], attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}

function* walk(n: XNode, tag: string): Generator<XNode> {
  for (const c of n.children) {
    if (c.tag === tag) yield c;
    yield* walk(c, tag);
  }
}
const first = (n: XNode, tag: string) => walk(n, tag).next().value as XNode | undefined;
const kids = (n: XNode | undefined, tag: string) => (n ? n.children.filter((c) => c.tag === tag) : []);

/** « 00:01:24.62 » → centièmes ; « NT » ou vide → null */
export function lenexTime(t: string | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2}):(\d{2})\.(\d{2})$/.exec(t.trim());
  if (!m) return null;
  return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 100 + +m[4];
}

const STROKE: Record<string, Stroke> = { FREE: 'FREE', BACK: 'BACK', BREAST: 'BREAST', FLY: 'FLY', MEDLEY: 'IM' };
const ROUND: Record<string, Round> = { TIM: 'TIM', PRE: 'HEAT', SEM: 'SEMI', SOP: 'SEMI', FIN: 'FINAL', SOS: 'TIM' };

export interface LenexSwim {
  eventNo?: number;
  distance: number;
  stroke: Stroke;
  course: Course;
  round: Round;
  date?: string;
  startTime?: string;
  timeCs?: number;
  status: 'OK' | 'DSQ' | 'DNS' | 'DNF';
  points?: number;
  place?: number;
  splits?: number[];
  entryCs?: number;
  heat?: number;
  lane?: number;
  /** Raison de la disqualification */
  comment?: string;
}

export interface LenexAthlete {
  firstName: string;
  lastName: string;
  birthYear?: number;
  gender?: Gender;
  license?: string;
  /** Identifiant swimrankings.net du nageur (attribut LENEX « swrid »). */
  swrid?: string;
  club?: string;
  swims: LenexSwim[];
}

export interface LenexMeet {
  meet: ReportMeet & { nation?: string; resultUrl?: string };
  athletes: LenexAthlete[];
}

export function parseLenex(xml: string): LenexMeet | null {
  const root = parseXml(xml);
  const meetNode = first(root, 'MEET');
  if (!meetNode) return null;
  const course: Course = meetNode.attrs.course === 'LCM' ? 'LCM' : 'SCM';

  // Épreuves (date de la session, n°, heure, nage, tour) et classements
  interface Ev {
    no?: number;
    distance: number;
    stroke: Stroke;
    round: Round;
    date?: string;
    time?: string;
  }
  const events = new Map<string, Ev>();
  const heats = new Map<string, number>();
  const places = new Map<string, { place: number; width: number }>();
  const dates: string[] = [];
  for (const session of walk(meetNode, 'SESSION')) {
    const date = session.attrs.date;
    if (date) dates.push(date);
    for (const ev of walk(session, 'EVENT')) {
      const style = first(ev, 'SWIMSTYLE');
      if (!style) continue;
      const stroke = STROKE[style.attrs.stroke];
      const distance = +style.attrs.distance;
      if (!stroke || !distance || +(style.attrs.relaycount ?? 1) > 1) continue;
      events.set(ev.attrs.eventid, {
        no: ev.attrs.number ? +ev.attrs.number : undefined,
        distance,
        stroke,
        round: ROUND[ev.attrs.round] ?? 'TIM',
        date,
        time: ev.attrs.daytime || session.attrs.daytime,
      });
      for (const h of walk(ev, 'HEAT')) if (h.attrs.heatid) heats.set(h.attrs.heatid, +h.attrs.number);
      for (const ag of walk(ev, 'AGEGROUP')) {
        const min = +(ag.attrs.agemin ?? -1);
        const max = +(ag.attrs.agemax ?? -1);
        // Classement le plus précis : groupe d'âge le plus étroit
        const width = min < 0 || max < 0 ? 1000 : max - min;
        for (const r of walk(ag, 'RANKING')) {
          if (!r.attrs.resultid || !r.attrs.place || +r.attrs.place < 1) continue;
          const prev = places.get(r.attrs.resultid);
          if (!prev || width < prev.width) places.set(r.attrs.resultid, { place: +r.attrs.place, width });
        }
      }
    }
  }
  dates.sort();

  const athletes: LenexAthlete[] = [];
  for (const club of walk(meetNode, 'CLUB')) {
    const clubName = club.attrs.name || club.attrs.shortname;
    for (const a of walk(club, 'ATHLETE')) {
      const swims: LenexSwim[] = [];
      for (const r of kids(first(a, 'RESULTS'), 'RESULT')) {
        const ev = events.get(r.attrs.eventid);
        if (!ev || !isValidEvent(ev.distance, ev.stroke, course)) continue;
        const st = r.attrs.status;
        if (st === 'WDR') continue; // forfait déclaré avant l'épreuve
        const status: LenexSwim['status'] = st === 'DSQ' ? 'DSQ' : st === 'DNS' ? 'DNS' : st === 'DNF' ? 'DNF' : 'OK';
        const time = lenexTime(r.attrs.swimtime) ?? undefined;
        if (status === 'OK' && time == null) continue;
        const splits = kids(first(r, 'SPLITS'), 'SPLIT')
          .map((sp) => ({ at: +sp.attrs.distance, cs: lenexTime(sp.attrs.swimtime) }))
          .filter((sp) => sp.cs != null && sp.at < ev.distance && sp.at % (ev.distance === 50 ? 25 : 50) === 0)
          .sort((x, y) => x.at - y.at);
        const step = ev.distance === 50 ? 25 : 50;
        const splitArr: number[] = [];
        for (const sp of splits) splitArr[sp.at / step - 1] = sp.cs!;
        const entry = lenexTime(r.attrs.entrytime);
        swims.push({
          eventNo: ev.no,
          distance: ev.distance,
          stroke: ev.stroke,
          course,
          round: ev.round,
          date: ev.date,
          startTime: ev.time,
          timeCs: time,
          status,
          points: r.attrs.points && +r.attrs.points > 0 ? +r.attrs.points : undefined,
          place: places.get(r.attrs.resultid)?.place,
          splits: splitArr.length ? splitArr : undefined,
          entryCs: entry ?? undefined,
          heat: r.attrs.heatid ? heats.get(r.attrs.heatid) : undefined,
          lane: r.attrs.lane ? +r.attrs.lane : undefined,
          comment: r.attrs.comment || undefined,
        });
      }
      if (!swims.length) continue;
      const bd = a.attrs.birthdate;
      athletes.push({
        firstName: (a.attrs.firstname ?? '').trim(),
        lastName: (a.attrs.lastname ?? '').trim(),
        birthYear: bd && /^\d{4}/.test(bd) ? +bd.slice(0, 4) : undefined,
        gender: a.attrs.gender === 'F' ? 'F' : a.attrs.gender === 'M' ? 'M' : undefined,
        license: a.attrs.license,
        swrid: /^\d+$/.test(a.attrs.swrid ?? '') ? a.attrs.swrid : undefined,
        club: clubName,
        swims,
      });
    }
  }

  return {
    meet: {
      name: (meetNode.attrs.name ?? 'Compétition').replace(/\s+/g, ' ').trim(),
      city: meetNode.attrs.city,
      organizer: meetNode.attrs.organizer,
      nation: meetNode.attrs.nation,
      course,
      startDate: dates[0] ?? '',
      endDate: dates.length > 1 && dates[dates.length - 1] !== dates[0] ? dates[dates.length - 1] : undefined,
      resultUrl: meetNode.attrs['result.url'],
    },
    athletes,
  };
}

/* ------------------------------------------------------------------------ */
/* Archive .lxf (zip)                                                        */
/* ------------------------------------------------------------------------ */

/** Extrait le premier fichier d'une archive zip (méthode « stored » ou « deflate »). */
export async function unzipFirst(buf: ArrayBuffer): Promise<string> {
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // Fin du répertoire central
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Archive invalide');
  const cd = dv.getUint32(eocd + 16, true);
  if (dv.getUint32(cd, true) !== 0x02014b50) throw new Error('Archive invalide');
  const method = dv.getUint16(cd + 10, true);
  const size = dv.getUint32(cd + 20, true);
  const local = dv.getUint32(cd + 42, true);
  const nameLen = dv.getUint16(local + 26, true);
  const extraLen = dv.getUint16(local + 28, true);
  const data = bytes.subarray(local + 30 + nameLen + extraLen, local + 30 + nameLen + extraLen + size);
  if (method === 0) return new TextDecoder('utf-8').decode(data);
  if (method !== 8) throw new Error('Compression non prise en charge');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(stream).text();
}
