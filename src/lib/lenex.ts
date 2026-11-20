import type { Course, Gender, Round, Stroke } from '../store/types';
import { inflateSync } from 'fflate';
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

/**
 * « 00:01:24.62 » → centièmes ; « NT », vide ou « 00:00:00.00 » → null (temps nul laissé par Splash sur une
 * disqualification, un forfait ou un passage non chronométré : ce n'est pas un temps).
 */
export function lenexTime(t: string | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2}):(\d{2})\.(\d{2})$/.exec(t.trim());
  if (!m) return null;
  return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 100 + +m[4] || null;
}

const STROKE: Record<string, Stroke> = { FREE: 'FREE', BACK: 'BACK', BREAST: 'BREAST', FLY: 'FLY', MEDLEY: 'IM' };
// Barrages (SOP, SOS, SOQ : après les séries, demi-finales, quarts) et quarts de finale : comme une série
const ROUND: Record<string, Round> = { TIM: 'TIM', PRE: 'HEAT', QUA: 'HEAT', SEM: 'SEMI', FIN: 'FINAL', SOP: 'HEAT', SOS: 'HEAT', SOQ: 'HEAT' };

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

/** Une épreuve au programme (relais et épreuves de 25 m compris), pour l'horaire d'une compétition. */
export interface MeetEvent {
  no?: number;
  gender?: 'F' | 'M' | 'X';
  distance: number;
  stroke?: Stroke;
  /** Nombre de nageurs par équipe (1 : épreuve individuelle). */
  relay: number;
  round: Round;
  date?: string;
  time?: string;
  /** Séance (réunion) : numéro et heure de début. */
  session?: number;
  sessionTime?: string;
}

/**
 * Vue d'ensemble d'une compétition, comptée comme les statistiques de Splash (SplashMe) : tous les
 * nageurs, clubs et courses du fichier, et une médaille pour chaque place 1 à 3 de chaque classement
 * par catégorie d'âge.
 */
export interface MeetOverview {
  organizer?: string;
  athletes: number;
  clubs: number;
  entries: number;
  relayEntries: number;
  events: MeetEvent[];
  medals: { club: string; code?: string; gender?: Gender; place: 1 | 2 | 3 }[];
}

export interface LenexMeet {
  meet: ReportMeet & { nation?: string; resultUrl?: string };
  athletes: LenexAthlete[];
  overview?: MeetOverview;
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
    /** Barrage : sa place n'est pas un classement de l'épreuve. */
    swimOff: boolean;
    date?: string;
    time?: string;
  }
  const events = new Map<string, Ev>();
  const heats = new Map<string, number>();
  const places = new Map<string, { place: number; width: number }>();
  const dates: string[] = [];
  const allEvents: MeetEvent[] = [];
  const podium: { resultid: string; place: 1 | 2 | 3 }[] = [];
  for (const session of walk(meetNode, 'SESSION')) {
    const date = session.attrs.date;
    if (date) dates.push(date);
    for (const ev of walk(session, 'EVENT')) {
      const style = first(ev, 'SWIMSTYLE');
      if (!style) continue;
      // Programme complet et médailles (toutes épreuves, relais et 25 m compris ; pas les barrages)
      const g = ev.attrs.gender;
      allEvents.push({
        no: ev.attrs.number ? +ev.attrs.number : undefined,
        gender: g === 'F' || g === 'M' || g === 'X' ? g : undefined,
        distance: +style.attrs.distance || 0,
        stroke: STROKE[style.attrs.stroke],
        relay: +(style.attrs.relaycount ?? 1) || 1,
        round: ROUND[ev.attrs.round] ?? 'TIM',
        date,
        time: ev.attrs.daytime || session.attrs.daytime,
        session: session.attrs.number ? +session.attrs.number : undefined,
        sessionTime: session.attrs.daytime,
      });
      if (!/^SO[PSQ]$/.test(ev.attrs.round ?? ''))
        for (const ag of walk(ev, 'AGEGROUP'))
          for (const r of walk(ag, 'RANKING')) {
            const place = +(r.attrs.place ?? 0);
            if (r.attrs.resultid && place >= 1 && place <= 3) podium.push({ resultid: r.attrs.resultid, place: place as 1 | 2 | 3 });
          }
      const stroke = STROKE[style.attrs.stroke];
      const distance = +style.attrs.distance;
      // Relais et épreuves spéciales (technique : jambes, bras, départ, virage…) ignorés
      if (!stroke || !distance || +(style.attrs.relaycount ?? 1) > 1 || style.attrs.technique) continue;
      events.set(ev.attrs.eventid, {
        no: ev.attrs.number ? +ev.attrs.number : undefined,
        distance,
        stroke,
        round: ROUND[ev.attrs.round] ?? 'TIM',
        swimOff: /^SO[PSQ]$/.test(ev.attrs.round ?? ''),
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
  // Chaque résultat (individuel ou relais) → son club et le sexe, pour les médailles par club
  const owner = new Map<string, { club: string; code?: string; gender?: Gender }>();
  let athleteCount = 0;
  let clubCount = 0;
  let entries = 0;
  let relayEntries = 0;
  for (const club of walk(meetNode, 'CLUB')) {
    const clubName = club.attrs.name || club.attrs.shortname;
    let used = false;
    for (const rel of walk(club, 'RELAY'))
      for (const r of kids(first(rel, 'RESULTS'), 'RESULT')) {
        used = true;
        relayEntries++;
        const g = rel.attrs.gender;
        if (r.attrs.resultid) owner.set(r.attrs.resultid, { club: clubName ?? '?', code: club.attrs.code, gender: g === 'F' || g === 'M' ? g : undefined });
      }
    for (const a of walk(club, 'ATHLETE')) {
      athleteCount++;
      used = true;
      for (const r of kids(first(a, 'RESULTS'), 'RESULT')) {
        entries++;
        const g = a.attrs.gender;
        if (r.attrs.resultid) owner.set(r.attrs.resultid, { club: clubName ?? '?', code: club.attrs.code, gender: g === 'F' || g === 'M' ? g : undefined });
      }
      const swims: LenexSwim[] = [];
      for (const r of kids(first(a, 'RESULTS'), 'RESULT')) {
        const ev = events.get(r.attrs.eventid);
        if (!ev || !isValidEvent(ev.distance, ev.stroke, course)) continue;
        const st = r.attrs.status;
        if (st === 'WDR') continue; // forfait déclaré avant l'épreuve
        const status: LenexSwim['status'] = st === 'DSQ' ? 'DSQ' : st === 'DNS' ? 'DNS' : st === 'DNF' ? 'DNF' : 'OK';
        // Disqualification ou forfait sans temps (absent ou « 00:00:00.00 ») : course gardée, sans temps
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
          place: ev.swimOff ? undefined : places.get(r.attrs.resultid)?.place,
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
    // Comme SplashMe : tous les clubs du fichier, même inscrits sans nageur
    if (used || club.attrs.name || club.attrs.code) clubCount++;
  }
  const medals = podium.flatMap(({ resultid, place }) => {
    const o = owner.get(resultid);
    return o ? [{ ...o, place }] : [];
  });

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
    overview: {
      organizer: meetNode.attrs.organizer,
      athletes: athleteCount,
      clubs: clubCount,
      entries,
      relayEntries,
      events: allEvents,
      medals,
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
  // fflate plutôt que DecompressionStream (« deflate-raw » absent avant iOS 16.4 et Chrome 103)
  return new TextDecoder('utf-8').decode(inflateSync(data));
}
