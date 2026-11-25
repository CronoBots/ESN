import type { Swim, Swimmer } from '../store/types';
import { activeChampionships, limitStatus, type Championship, type QualifyingData } from './qualifying';
import { isValidResult } from './stats';

/** Temps à viser sur une épreuve du programme : limite d'un championnat, record du club de son âge. */
export interface EntryTarget {
  kind: 'limit' | 'club';
  cs: number;
  /** « Belgique 11-14 ans 50 m », « record du club 11 ans » */
  label: string;
  /** Centièmes à gagner sur son meilleur temps (record perso ou temps d'engagement). */
  gapCs?: number;
}

/**
 * Temps à viser pour une épreuve pas encore nagée : la prochaine limite des championnats dont la période
 * comprend la compétition et qui acceptent son bassin (limite pas encore atteinte), puis le record du club
 * de son âge (records officiels du fichier d'inscriptions) s'il ne le détient pas déjà. Seulement ceux à
 * portée (`REACH`), du plus accessible au plus difficile.
 */
export function entryTargets(
  s: Swim,
  swimmer: Pick<Swimmer, 'id' | 'gender' | 'birthYear'>,
  swims: Swim[],
  data: QualifyingData | null,
  today: string,
  short: (c: Championship) => string,
): EntryTarget[] {
  if (s.timeCs != null || s.status !== 'OK') return [];
  // Record personnel dans ce bassin, avant la compétition
  const pb = swims
    .filter((x) => x.swimmerId === swimmer.id && x.id !== s.id && x.course === s.course && x.distance === s.distance && x.stroke === s.stroke && x.date <= s.date && isValidResult(x))
    .reduce<number | undefined>((m, x) => (m == null || x.timeCs! < m ? x.timeCs! : m), undefined);
  // Référence de l'écart : le meilleur du record perso et du temps d'engagement (le club connaît parfois une
  // course plus récente que l'historique) ; sans temps du tout, rien à viser
  const ref = pb != null && s.entryCs ? Math.min(pb, s.entryCs) : (pb ?? s.entryCs ?? undefined);
  if (ref == null) return [];
  const gap = (cs: number) => (ref > cs ? ref - cs : undefined);
  const out: EntryTarget[] = [];
  for (const c of data ? activeChampionships(data, today) : []) {
    if (!c.accepts.includes(s.course) || s.date < c.window.from || s.date > c.window.to) continue;
    const st = limitStatus(c, swimmer, swims, s.distance, s.stroke, today);
    if (!st?.next) continue;
    out.push({ kind: 'limit', cs: st.next.cs, label: `${short(c)}${st.next.label !== 'Limite' ? ` (limite ${st.next.label})` : ''}`, gapCs: gap(st.next.cs) });
  }
  const club = s.records?.club;
  if (club && swimmer.birthYear && ref > club) {
    const age = Number(s.date.slice(0, 4)) - swimmer.birthYear;
    out.push({ kind: 'club', cs: club, label: `record du club ${age} ans`, gapCs: gap(club) });
  }
  // À portée seulement (10 % au plus du record personnel, comme les limites de l'accueil)
  return out.filter((t) => (ref - t.cs) / ref <= REACH).sort((a, b) => b.cs - a.cs);
}

/** Écart maximal (relatif au record personnel) d'un temps à viser montré. */
export const REACH = 0.1;
