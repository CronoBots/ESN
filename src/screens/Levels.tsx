import { useMemo, useState } from 'react';
import { useData } from '../store/store';
import { useSelectedSwimmer } from '../store/hooks';
import { Empty, NavBar, Section, Segmented } from '../components/ui';
import { Icon } from '../components/Icon';
import { LevelChip, gapLabel, levelYear, useLevelGoals } from '../components/Levels';
import { levelStatus, LEVELS, type Level, type LevelStatus } from '../lib/levels';
import { FFBN_GRID_URL } from '../lib/ffbnGrid';
import { personalBests } from '../lib/stats';
import { COURSES, STROKES, distancesFor, eventLabel, fullEventKey } from '../lib/events';
import { formatTime } from '../lib/time';
import { navigate } from '../router';
import type { Course, Stroke } from '../store/types';
import { SwimmerChips } from './Records';

interface Row {
  distance: number;
  stroke: Stroke;
  bestCs: number;
  status: LevelStatus;
}

/** Case d'un niveau : atteint (coche), prochain (temps à gagner), plus loin (temps à viser), ou pas de temps pour cet âge. */
function LevelCell({ status, level }: { status: LevelStatus; level: Level }) {
  const l = status.levels.find((x) => x.level === level);
  if (!l) {
    return (
      <span className="lv-cell none" aria-label={`${level} : pas de temps de référence à cet âge`}>
        –
      </span>
    );
  }
  if (l.reached) {
    return (
      <span className={`lv-cell done lvl-${level.toLowerCase()}`} aria-label={`${level} atteint (${formatTime(l.cs)})`}>
        <Icon name="check" />
      </span>
    );
  }
  if (status.next?.level === level) {
    return (
      <span className={`lv-cell next lvl-${level.toLowerCase()}`} aria-label={`${level} : encore ${gapLabel(l.gapCs!)} à gagner (${formatTime(l.cs)})`}>
        <b>−{gapLabel(l.gapCs!).replace(' s', '')}</b>
        <small>{formatTime(l.cs)}</small>
      </span>
    );
  }
  return (
    <span className="lv-cell later" aria-label={`${level} : ${formatTime(l.cs)} à réaliser`}>
      {formatTime(l.cs)}
    </span>
  );
}

/**
 * Niveaux FFBN d'un nageur sur toutes ses épreuves : une ligne par épreuve
 * nagée, une colonne par niveau (Mistral, Trident, Requin).
 */
export function LevelsScreen() {
  const data = useData();
  const swimmer = useSelectedSwimmer();
  const include = data.settings.includeTraining;
  const { reached } = useLevelGoals(swimmer, data.swims, include);
  const year = levelYear();

  const rowsBy = useMemo(() => {
    const out: Record<Course, Row[]> = { SCM: [], LCM: [] };
    if (!swimmer) return out;
    const bests = personalBests(data.swims, swimmer.id, include);
    for (const c of COURSES)
      for (const st of STROKES)
        for (const d of distancesFor(st.id, c.id)) {
          const best = bests.get(fullEventKey(c.id, d, st.id));
          if (!best?.timeCs) continue;
          const status = levelStatus(swimmer, c.id, d, st.id, year, best.timeCs);
          if (status) out[c.id].push({ distance: d, stroke: st.id, bestCs: best.timeCs, status });
        }
    return out;
  }, [data.swims, swimmer, include, year]);

  const [course, setCourse] = useState<Course>(() => (rowsBy.SCM.length >= rowsBy.LCM.length ? 'SCM' : 'LCM'));
  if (!swimmer) return <Empty icon="person" title="Aucun nageur suivi" />;

  const rows = rowsBy[course];
  const columns = LEVELS.filter((l) => rows.some((r) => r.status.levels.some((x) => x.level === l)));
  const age = rows[0]?.status.age ?? rowsBy.SCM[0]?.status.age ?? rowsBy.LCM[0]?.status.age;

  return (
    <>
      <NavBar title="Niveaux FFBN" subtitle={age ? `${swimmer.firstName} · ${age >= 19 ? '19 ans et plus' : `${age} ans`} en ${year}` : swimmer.firstName} back="/" />
      <main className="page">
        <SwimmerChips swimmer={swimmer} />

        <div className="lv-summary" role="list" aria-label="Épreuves par plus haut niveau atteint">
          {LEVELS.map((l) => {
            // Requin : seulement dès 13 ans ; avant, pas de « 0 » décourageant
            const later = l === 'Requin' && age != null && age < 13;
            return (
              <div key={l} className={`lv-tile lvl-${l.toLowerCase()}${reached[l] ? ' on' : ''}`} role="listitem">
                <span className="lv-tile-n">{later ? '–' : reached[l]}</span>
                <span className="lv-tile-l">{l}</span>
                <span className="lv-tile-s">{later ? 'dès 13 ans' : `épreuve${reached[l] > 1 ? 's' : ''}`}</span>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 14 }}>
          <Segmented
            value={course}
            onChange={setCourse}
            ariaLabel="Bassin"
            options={COURSES.map((c) => ({ id: c.id, label: `Bassin ${c.label} · ${rowsBy[c.id].length}` }))}
          />
        </div>

        {rows.length === 0 ? (
          <div className="card" style={{ marginTop: 14 }}>
            <Empty icon="trophy" title="Pas encore d’épreuve" text={`Aucune épreuve avec un temps de référence en bassin de ${course === 'SCM' ? '25' : '50'} m.`} />
          </div>
        ) : (
          <Section>
            <div className="lv-table" style={{ ['--lv-cols' as string]: columns.length }}>
              <div className="lv-head" aria-hidden="true">
                <span>Épreuve</span>
                {columns.map((l) => (
                  <span key={l}>
                    <LevelChip level={l} />
                  </span>
                ))}
              </div>
              {rows.map((r) => (
                <button
                  key={`${r.distance}-${r.stroke}`}
                  className="lv-row"
                  onClick={() => navigate(`/event/${swimmer.id}/${course}/${r.distance}/${r.stroke}`)}
                >
                  <span className="lv-event">
                    <span className="lv-name">{eventLabel(r.distance, r.stroke)}</span>
                    <span className="lv-best">record {formatTime(r.bestCs)}</span>
                  </span>
                  {columns.map((l) => (
                    <LevelCell key={l} status={r.status} level={l} />
                  ))}
                </button>
              ))}
            </div>
          </Section>
        )}

        <div className="lv-legend">
          <span>
            <span className="lv-cell done lvl-trident" aria-hidden="true">
              <Icon name="check" />
            </span>
            atteint
          </span>
          <span>
            <b>−2.35</b> à gagner pour le prochain niveau
          </span>
          <span className="muted">2:33.66 temps à viser ensuite</span>
        </div>
        <div className="section-foot">
          Temps de référence de la fédération francophone (grille 2026-2028) pour l’âge atteint en {year}, comparés au record de chaque
          épreuve. Requin : bassin de 50&nbsp;m, dès 13 ans. Touchez une épreuve pour sa courbe.{' '}
          <a href={FFBN_GRID_URL} target="_blank" rel="noreferrer">
            Voir la grille
          </a>
        </div>
      </main>
    </>
  );
}
