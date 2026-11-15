import { useMemo, useState } from 'react';
import { useData } from '../store/store';
import { usePbFlags, useSelectedSwimmer } from '../store/hooks';
import { Empty, NavBar, Section, Segmented, StrokeTag } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate } from '../router';
import { COURSES, STROKES, distancesFor, eventLabel, STROKE_BY_ID, courseLabel } from '../lib/events';
import { achievements, chronoCompare, countsForRecords, eventStats, type Achievement } from '../lib/stats';
import { formatDate, seasonLabel, seasonOf, todayISO, fromISO } from '../lib/dates';
import { formatDelta, formatTime } from '../lib/time';
import type { Course, Swim } from '../store/types';
import { SwimmerChips } from './Records';
import { findResultsNow } from './autoResults';
import { EvolutionCard, useTimeline } from '../components/MeetTimeline';
import { deName } from '../lib/text';

function Sparkline({ swims, color }: { swims: Swim[]; color: string }) {
  if (swims.length < 2) return <div style={{ height: 36 }} />;
  const W = 120;
  const H = 36;
  const xs = swims.map((s) => fromISO(s.date).getTime());
  const ys = swims.map((s) => s.timeCs!);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs) || x0 + 1;
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const sx = (x: number) => 3 + ((x - x0) / (x1 - x0 || 1)) * (W - 6);
  // Plus rapide = plus bas : la courbe descend quand le temps s'améliore
  const sy = (y: number) => 4 + ((y1 - y) / (y1 - y0 || 1)) * (H - 8);
  const d = swims.map((s, i) => `${i ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(s.timeCs!).toFixed(1)}`).join('');
  const last = swims[swims.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-hidden="true" style={{ overflow: 'visible' }}>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={sx(xs[xs.length - 1])} cy={sy(last.timeCs!)} r={3.5} fill={color} stroke="var(--card)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Progression() {
  const data = useData();
  const swimmer = useSelectedSwimmer();
  const pbFlags = usePbFlags();
  const [course, setCourse] = useState<Course>(data.settings.defaultCourse);
  const include = data.settings.includeTraining;
  const timeline = useTimeline(swimmer);

  const events = useMemo(() => {
    if (!swimmer) return [];
    const out: { distance: number; stroke: (typeof STROKES)[number]['id']; swims: Swim[]; stats: ReturnType<typeof eventStats> }[] = [];
    for (const st of STROKES) {
      for (const d of distancesFor(st.id, course)) {
        const swims = data.swims
          .filter((s) => s.swimmerId === swimmer.id && s.course === course && s.distance === d && s.stroke === st.id && countsForRecords(s, include))
          .sort(chronoCompare);
        if (swims.length) out.push({ distance: d, stroke: st.id, swims, stats: eventStats(swims, include) });
      }
    }
    return out;
  }, [data.swims, swimmer, course, include]);

  const trophies = useMemo(
    () => (swimmer ? achievements(data.swims, swimmer, data.goals, data.meets, pbFlags) : []),
    [data.swims, swimmer, data.goals, data.meets, pbFlags],
  );

  // Meilleurs temps par saison (3 dernières saisons)
  const seasons = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) for (const s of e.swims) set.add(seasonOf(s.date));
    return [...set].sort().slice(-3);
  }, [events]);

  const topGains = useMemo(
    () =>
      events
        .filter((e) => e.stats.yearGainCs != null && e.stats.yearGainCs > 0)
        .map((e) => ({ ...e, pct: (e.stats.yearGainCs! / (e.stats.best!.timeCs! + e.stats.yearGainCs!)) * 100 }))
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 3),
    [events],
  );

  if (!swimmer) {
    return (
      <>
        <NavBar title="Progression" />
        <main className="page">
          <Empty icon="chart" title="Aucun nageur" />
        </main>
      </>
    );
  }

  return (
    <>
      <NavBar title="Progression" subtitle={`L’évolution ${deName(swimmer.firstName)}, compétition après compétition et nage par nage`} />
      <main className="page">
        <SwimmerChips swimmer={swimmer} />
        {timeline.length >= 2 && (
          <Section
            title="Par compétition"
            action={
              <button className="section-link" onClick={() => navigate('/meets')}>
                Détail
              </button>
            }
          >
            <EvolutionCard timeline={timeline} swimmer={swimmer} />
          </Section>
        )}
        <Section title="Nage par nage">
          <Segmented value={course} onChange={setCourse} options={COURSES.map((c) => ({ id: c.id, label: `Bassin ${c.label}` }))} />
        </Section>

        {events.length === 0 ? (
          <div className="card" style={{ marginTop: 16 }}>
            <Empty
              icon="chart"
              title={`Aucun temps en ${courseLabel(course)}`}
              text="Les courbes apparaissent dès que des résultats sont publiés pour ce bassin."
              action={
                <button className="btn small" onClick={() => findResultsNow(swimmer.firstName)}>
                  <Icon name="sparkles" /> Rechercher ses résultats
                </button>
              }
            />
          </div>
        ) : (
          <>
            {topGains.length > 0 && (
              <Section title="Plus belles progressions" footer="Gain sur le record au cours des 12 derniers mois.">
                <div className="list">
                  {topGains.map((e, i) => (
                    <button
                      key={`${e.distance}-${e.stroke}`}
                      className="row"
                      onClick={() => navigate(`/event/${swimmer.id}/${course}/${e.distance}/${e.stroke}`)}
                    >
                      <span style={{ fontSize: 22, width: 28, textAlign: 'center' }}>{['🥇', '🥈', '🥉'][i]}</span>
                      <div className="row-body">
                        <div className="row-title">{eventLabel(e.distance, e.stroke)}</div>
                        <div className="row-sub">Record : {formatTime(e.stats.best!.timeCs)}</div>
                      </div>
                      <div className="row-end" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                        <span className="time-big good">{formatDelta(-e.stats.yearGainCs!)}</span>
                        <span className="small muted">−{e.pct.toLocaleString('fr-BE', { maximumFractionDigits: 1 })} %</span>
                      </div>
                    </button>
                  ))}
                </div>
              </Section>
            )}

            <Section title="Toutes les épreuves" footer="Touchez une épreuve pour voir la courbe détaillée, les statistiques et l’historique.">
              <div className="tiles">
                {events.map((e) => {
                  const color = `var(${STROKE_BY_ID[e.stroke].colorVar})`;
                  return (
                    <button
                      key={`${e.distance}-${e.stroke}`}
                      className="tile"
                      style={{ border: 0, textAlign: 'left' }}
                      onClick={() => navigate(`/event/${swimmer.id}/${course}/${e.distance}/${e.stroke}`)}
                    >
                      <div className="hstack" style={{ gap: 8 }}>
                        <StrokeTag stroke={e.stroke} distance={e.distance} size={28} />
                        <span className="tile-label grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {STROKE_BY_ID[e.stroke].label}
                        </span>
                      </div>
                      <div className="tile-value tnum" style={{ marginTop: 8 }}>
                        {formatTime(e.stats.best!.timeCs)}
                      </div>
                      <div style={{ margin: '6px 0 2px' }}>
                        <Sparkline swims={e.swims} color={color} />
                      </div>
                      <div className={`tile-sub ${e.stats.totalGainCs > 0 ? 'good' : ''}`}>
                        {e.stats.totalGainCs > 0 ? `${formatDelta(-e.stats.totalGainCs)} · ` : ''}
                        {e.swims.length} course{e.swims.length > 1 ? 's' : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Section>

            {seasons.length > 1 && (
              <Section title="Saison par saison" footer="Meilleur temps de chaque saison (septembre → août) et écart avec la saison précédente.">
                <div className="card" style={{ overflowX: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Épreuve</th>
                        {seasons.map((s) => (
                          <th key={s} className="r">
                            {seasonLabel(s).replace('Saison ', '')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((e) => {
                        const bestBy = seasons.map((season) => {
                          const list = e.swims.filter((s) => seasonOf(s.date) === season);
                          return list.length ? Math.min(...list.map((s) => s.timeCs!)) : null;
                        });
                        return (
                          <tr key={`${e.distance}-${e.stroke}`}>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span className="stroke-dot" style={{ background: `var(${STROKE_BY_ID[e.stroke].colorVar})`, marginRight: 6 }} />
                              {eventLabel(e.distance, e.stroke)}
                            </td>
                            {bestBy.map((v, i) => {
                              const prev = bestBy.slice(0, i).reverse().find((x) => x != null);
                              return (
                                <td key={i} className="r" style={{ whiteSpace: 'nowrap' }}>
                                  {v != null ? formatTime(v) : '–'}
                                  {v != null && prev != null && (
                                    <div className={`small ${v < prev ? 'good' : 'muted'}`}>{formatDelta(v - prev)}</div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}
          </>
        )}

        <Section
          title="Trophées"
          action={
            <span className="muted small">
              {trophies.filter((t) => t.unlocked).length}/{trophies.length} débloqués
            </span>
          }
        >
          <TrophyGrid trophies={trophies} />
        </Section>
        <div className="section-foot">Mis à jour le {formatDate(todayISO())}.</div>
      </main>
    </>
  );
}

export function TrophyGrid({ trophies }: { trophies: Achievement[] }) {
  const sorted = [...trophies].sort((a, b) => Number(b.unlocked) - Number(a.unlocked));
  return (
    <div className="trophies">
      {sorted.map((t) => (
        <div key={t.id} className={`trophy${t.unlocked ? '' : ' locked'}`}>
          <span className="ti" aria-hidden="true">
            {t.icon}
          </span>
          <span className="tt">{t.title}</span>
          <span className="td">{t.description}</span>
          {t.progress && !t.unlocked && t.progress.target > 1 && (
            <div className="meter" style={{ height: 5, marginTop: 2 }}>
              <div style={{ width: `${(t.progress.value / t.progress.target) * 100}%` }} />
            </div>
          )}
          <span className="tdate">
            {t.unlocked ? (t.date ? formatDate(t.date) : 'Débloqué') : t.progress && t.progress.target > 1 ? `${t.progress.value}/${t.progress.target}` : 'À débloquer'}
          </span>
        </div>
      ))}
    </div>
  );
}
