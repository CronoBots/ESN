import { useMemo, useState } from 'react';
import { useData } from '../store/store';
import { fullName, swimsOf, usePbFlags } from '../store/hooks';
import { Empty, NavBar, Section } from '../components/ui';
import { SwimRow } from '../components/SwimRow';
import { firstGroups, useProgressive } from '../components/progressive';
import { seasonLabel, seasonOf } from '../lib/dates';
import { chronoCompare } from '../lib/stats';
import { STROKES, courseLabel } from '../lib/events';
import type { Course, Stroke, Swim } from '../store/types';
import { SwimmerFile } from '../components/SwimmerFile';

export function SwimmerProfile({ id }: { id: string }) {
  const data = useData();
  const swimmer = data.swimmers.find((s) => s.id === id);
  if (!swimmer) {
    return (
      <>
        <NavBar title="Nageur" back large={false} />
        <main className="page">
          <Empty icon="person" title="Nageur introuvable" />
        </main>
      </>
    );
  }
  // La même fiche que sur l'accueil : un nageur s'affiche partout de la même façon
  return (
    <>
      <NavBar title={fullName(swimmer)} back large={false} wide />
      <main className="page wide">
        <SwimmerFile swimmer={swimmer} />
      </main>
    </>
  );
}

/* ======================================================================== */
/* Historique complet                                                         */
/* ======================================================================== */

export function SwimmerHistory({ id }: { id: string }) {
  const data = useData();
  const pbFlags = usePbFlags();
  const swimmer = data.swimmers.find((s) => s.id === id);
  const [stroke, setStroke] = useState<Stroke | 'ALL'>('ALL');
  const [course, setCourse] = useState<Course | 'ALL'>('ALL');
  const [onlyPB, setOnlyPB] = useState(false);
  const meetsById = useMemo(() => new Map(data.meets.map((m) => [m.id, m])), [data.meets]);

  const list = useMemo(
    () =>
      swimsOf(data.swims, id)
        .filter(
          (s) =>
            (s.timeCs != null || s.status !== 'OK') &&
            (stroke === 'ALL' || s.stroke === stroke) &&
            (course === 'ALL' || s.course === course) &&
            (!onlyPB || pbFlags.get(s.id)?.isPB),
        )
        .sort(chronoCompare)
        .reverse(),
    [data.swims, id, stroke, course, onlyPB, pbFlags],
  );

  const bySeason = useMemo(() => {
    const m = new Map<string, Swim[]>();
    for (const s of list) {
      const k = seasonOf(s.date);
      const season = m.get(k);
      if (season) season.push(s);
      else m.set(k, [s]);
    }
    return [...m.entries()];
  }, [list]);
  // Longue carrière (plusieurs centaines de courses) : les premières saisons tout de suite, le reste juste après
  const full = useProgressive(`${stroke}|${course}|${onlyPB}`);
  const shown = firstGroups(bySeason, ([, swims]) => swims.length, full);

  // Fiche disparue (doublon réuni à un autre nageur) : titre, retour et marges comme sur le profil
  if (!swimmer) {
    return (
      <>
        <NavBar title="Historique" back large={false} />
        <main className="page">
          <Empty icon="person" title="Nageur introuvable" />
        </main>
      </>
    );
  }

  return (
    <>
      <NavBar title="Historique" subtitle={fullName(swimmer)} back={`/swimmer/${id}`} />
      <main className="page">
        <div className="chips">
          <button className={`chip${stroke === 'ALL' ? ' active' : ''}`} onClick={() => setStroke('ALL')}>
            Toutes
          </button>
          {STROKES.map((s) => (
            <button key={s.id} className={`chip${stroke === s.id ? ' active' : ''}`} onClick={() => setStroke(s.id)}>
              <span className="stroke-dot" style={{ background: `var(${s.colorVar})` }} />
              {s.label}
            </button>
          ))}
        </div>
        <div className="chips" style={{ marginTop: 8 }}>
          {(['ALL', 'SCM', 'LCM'] as const).map((c) => (
            <button key={c} className={`chip${course === c ? ' active' : ''}`} onClick={() => setCourse(c)}>
              {c === 'ALL' ? 'Tous bassins' : courseLabel(c)}
            </button>
          ))}
          <button className={`chip${onlyPB ? ' active' : ''}`} onClick={() => setOnlyPB((v) => !v)}>
            🏆 Records uniquement
          </button>
        </div>
        {list.length === 0 ? (
          <div className="card" style={{ marginTop: 16 }}>
            <Empty icon="list" title="Aucune course" text="Modifiez les filtres pour voir d’autres courses." />
          </div>
        ) : (
          shown.map(([season, swims]) => (
            <Section key={season} title={seasonLabel(season)} action={<span className="muted small">{swims.length} courses</span>}>
              <div className="list swim-list">
                {swims.map((s) => (
                  <SwimRow key={s.id} swim={s} pb={pbFlags.get(s.id)} meet={s.meetId ? meetsById.get(s.meetId) : undefined} />
                ))}
              </div>
            </Section>
          ))
        )}
      </main>
    </>
  );
}
