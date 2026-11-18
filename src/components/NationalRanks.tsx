import { useData } from '../store/store';
import type { Course, Stroke } from '../store/types';
import { rankLabel, ranksFor } from '../lib/rankings';
import { formatTime } from '../lib/time';
import { Section } from './ui';

/** Fiche d'une épreuve : classements nationaux relevés sur swimrankings, saison par saison. */
export function NationalRankSection({ swimmerId, course, distance, stroke }: { swimmerId: string; course: Course; distance: number; stroke: Stroke }) {
  const data = useData();
  const list = ranksFor(data.rankings, swimmerId, course, distance, stroke);
  if (!list.length) return null;
  return (
    <Section title="Classements nationaux" footer="Classements officiels publiés sur swimrankings.net, relevés pour le club.">
      <div className="list">
        {list.map((r) => (
          <div key={`${r.season}-${r.label}`} className="row">
            <div className="row-body">
              <div className="row-title">{r.label}</div>
              <div className="row-sub">
                Saison {r.season}
                {r.timeCs != null ? ` · ${formatTime(r.timeCs)}` : ''}
              </div>
            </div>
            <div className="row-end">
              <div style={{ textAlign: 'right' }}>
                <div className="time-big tnum">{rankLabel(r.rank)}</div>
                {r.of != null && <div className="small muted tnum">sur {r.of}</div>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
