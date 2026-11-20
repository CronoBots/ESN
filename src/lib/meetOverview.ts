import type { MeetEvent, MeetOverview } from './lenex';
import { eventLabel, STROKE_BY_ID } from './events';

/** « Messieurs, 800 m Libre », « Dames, 4 × 50 m 4 nages », « Mixte, 100 m Libre ». */
export function meetEventLabel(e: MeetEvent): string {
  const who = e.gender === 'F' ? 'Dames' : e.gender === 'M' ? 'Messieurs' : 'Mixte';
  const what =
    e.relay > 1
      ? `${e.relay} × ${e.distance} m${e.stroke ? ` ${STROKE_BY_ID[e.stroke].label.toLowerCase()}` : ''}`
      : e.stroke
        ? eventLabel(e.distance, e.stroke)
        : `${e.distance} m`;
  return `${who}, ${what}`;
}

export interface ClubMedals {
  club: string;
  code?: string;
  total: [number, number, number];
  men: [number, number, number];
  women: [number, number, number];
}

/** Tableau des médailles par club (or, puis argent, puis bronze), comme les statistiques de Splash. */
export function medalTable(overview: MeetOverview): ClubMedals[] {
  const by = new Map<string, ClubMedals>();
  for (const m of overview.medals) {
    const c = by.get(m.club) ?? { club: m.club, code: m.code, total: [0, 0, 0], men: [0, 0, 0], women: [0, 0, 0] };
    c.total[m.place - 1]++;
    if (m.gender === 'F') c.women[m.place - 1]++;
    else if (m.gender === 'M') c.men[m.place - 1]++;
    by.set(m.club, c);
  }
  return [...by.values()].sort((a, b) => b.total[0] - a.total[0] || b.total[1] - a.total[1] || b.total[2] - a.total[2] || a.club.localeCompare(b.club));
}

