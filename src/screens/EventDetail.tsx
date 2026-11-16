import { useMemo, useState } from 'react';
import { useData } from '../store/store';
import { fullName, sortSwimmers, usePbFlags } from '../store/hooks';
import { Avatar, Empty, NavBar, Section, Segmented, StrokeTag } from '../components/ui';
import { Icon } from '../components/Icon';
import { ProgressChart, type ChartSeries } from '../components/Chart';
import { SwimRow } from '../components/SwimRow';
import { COURSES, distancesFor, eventLabel, courseLabel, isValidEvent } from '../lib/events';
import { countsForRecords, eventHistory, eventStats, pointsFor } from '../lib/stats';
import { formatDate } from '../lib/dates';
import { formatDelta, formatTime, pacePer100 } from '../lib/time';
import { navigate } from '../router';
import type { Course, Stroke } from '../store/types';
import { findResultsNow } from './autoResults';

const COMPARE_COLORS = ['var(--chart-line)', 'var(--chart-2)', 'var(--chart-3)'];

export function EventDetail({ swimmerId, course, distance, stroke }: { swimmerId: string; course: Course; distance: number; stroke: Stroke }) {
  const data = useData();
  const pbFlags = usePbFlags();
  const swimmer = data.swimmers.find((s) => s.id === swimmerId);
  const include = data.settings.includeTraining;
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const meetsById = useMemo(() => new Map(data.meets.map((m) => [m.id, m])), [data.meets]);

  const history = useMemo(() => eventHistory(data.swims, swimmerId, course, distance, stroke), [data.swims, swimmerId, course, distance, stroke]);
  const stats = useMemo(() => eventStats(history, include), [history, include]);
  const others = sortSwimmers(data.swimmers).filter(
    (s) => s.id !== swimmerId && data.swims.some((x) => x.swimmerId === s.id && x.course === course && x.distance === distance && x.stroke === stroke && countsForRecords(x, include)),
  );

  if (!swimmer) return <Empty icon="person" title="Nageur introuvable" />;

  const valid = history.filter((s) => countsForRecords(s, include));
  const series: ChartSeries[] = [
    {
      id: swimmer.id,
      label: swimmer.firstName,
      color: COMPARE_COLORS[0],
      bestLine: compareIds.length === 0,
      points: valid.map((s) => ({
        date: s.date,
        cs: s.timeCs!,
        pb: pbFlags.get(s.id)?.isPB,
        label: s.meetId ? meetsById.get(s.meetId)?.name : s.context === 'training' ? 'Entraînement' : undefined,
      })),
    },
    ...compareIds
      .map((id, i) => {
        const sw = data.swimmers.find((s) => s.id === id);
        if (!sw) return null;
        return {
          id,
          label: sw.firstName,
          color: COMPARE_COLORS[(i + 1) % COMPARE_COLORS.length],
          points: eventHistory(data.swims, id, course, distance, stroke)
            .filter((s) => countsForRecords(s, include))
            .map((s) => ({ date: s.date, cs: s.timeCs!, label: s.meetId ? meetsById.get(s.meetId)?.name : undefined })),
        } as ChartSeries;
      })
      .filter((s): s is ChartSeries => !!s),
  ];
  const best = stats.best;
  const bestPts = best ? pointsFor(best, swimmer) : null;
  const otherCourse: Course = course === 'SCM' ? 'LCM' : 'SCM';
  const otherValid = isValidEvent(distance, stroke, otherCourse);
  const go = (c: Course, d: number) => navigate(`/event/${swimmerId}/${c}/${d}/${stroke}`, { replace: true });

  return (
    <>
      <NavBar
        title={eventLabel(distance, stroke)}
        subtitle={`${fullName(swimmer)} · bassin de ${courseLabel(course)}`}
        back="/records"
      />
      <main className="page">
        <div className="stack" style={{ gap: 8 }}>
          <div className="chips">
            {distancesFor(stroke, course).map((d) => (
              <button key={d} className={`chip${d === distance ? ' active' : ''}`} onClick={() => go(course, d)}>
                {d} m
              </button>
            ))}
          </div>
          {otherValid && (
            <Segmented value={course} onChange={(c) => go(c, distance)} options={COURSES.map((c) => ({ id: c.id, label: `Bassin ${c.label}` }))} />
          )}
        </div>

        {valid.length === 0 ? (
          <div className="card" style={{ marginTop: 16 }}>
            <Empty
              icon="chart"
              title="Pas encore de temps"
              text={`Aucun ${eventLabel(distance, stroke)} en bassin de ${courseLabel(course)} pour ${swimmer.firstName}.`}
              action={
                <button className="btn small" onClick={() => findResultsNow(swimmer.firstName)}>
                  <Icon name="sparkles" /> Rechercher ses résultats
                </button>
              }
            />
          </div>
        ) : (
          <>
            <div className="card" style={{ marginTop: 16, padding: '18px 16px 8px' }}>
              <div className="hstack" style={{ alignItems: 'flex-start' }}>
                <StrokeTag stroke={stroke} distance={distance} size={44} />
                <div className="grow">
                  <div className="muted small" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    Record personnel
                  </div>
                  <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05 }} className="tnum">
                    {formatTime(best!.timeCs)}
                  </div>
                  <div className="muted small" style={{ marginTop: 2 }}>
                    {formatDate(best!.date)}
                    {best!.meetId && meetsById.get(best!.meetId) ? ` · ${meetsById.get(best!.meetId)!.name}` : ''}
                    {bestPts != null ? ` · ${bestPts} pts` : ''}
                  </div>
                </div>
              </div>

              {others.length > 0 && (
                <div className="chips" style={{ marginTop: 14 }}>
                  <span className="muted small" style={{ alignSelf: 'center', marginRight: 2 }}>
                    Comparer :
                  </span>
                  {others.map((o) => {
                    const on = compareIds.includes(o.id);
                    return (
                      <button
                        key={o.id}
                        className={`chip${on ? ' active' : ''}`}
                        onClick={() => setCompareIds((ids) => (on ? ids.filter((x) => x !== o.id) : [...ids, o.id].slice(-2)))}
                      >
                        <Avatar swimmer={o} size={20} />
                        {o.firstName}
                      </button>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                {series.length > 1 ? (
                  <div className="legend" aria-hidden="true">
                    {series.map((s) => (
                      <span key={s.id}>
                        <i style={{ background: s.color }} />
                        {s.label}
                      </span>
                    ))}
                    {series.length === 1 && (
                      <span>
                        <i style={{ background: 'var(--text-3)' }} />
                        Record
                      </span>
                    )}
                  </div>
                ) : null}
                <ProgressChart
                  series={series}
                  height={250}
                  ariaLabel={`Progression sur ${eventLabel(distance, stroke)} : ${valid.length} temps, record ${formatTime(best!.timeCs)}`}
                />
                <div className="muted small center" style={{ padding: '4px 0 8px' }}>
                  La courbe descend quand le temps s’améliore · touchez-la pour le détail
                </div>
              </div>
            </div>

            <Section title="Statistiques">
              <div className="tiles">
                <div className="tile">
                  <div className="tile-label">Progression totale</div>
                  <div className={`tile-value tnum ${stats.totalGainCs > 0 ? 'good' : ''}`}>
                    {stats.totalGainCs > 0 ? formatDelta(-stats.totalGainCs) : '—'}
                  </div>
                  <div className="tile-sub">
                    {stats.totalGainCs > 0 ? `${stats.totalGainPct.toLocaleString('fr-BE', { maximumFractionDigits: 1 })} % depuis le 1er temps` : 'depuis le premier temps'}
                  </div>
                </div>
                <div className="tile">
                  <div className="tile-label">12 derniers mois</div>
                  <div className={`tile-value tnum ${stats.yearGainCs && stats.yearGainCs > 0 ? 'good' : ''}`}>
                    {stats.yearGainCs != null && stats.yearGainCs > 0 ? formatDelta(-stats.yearGainCs) : '—'}
                  </div>
                  <div className="tile-sub">{stats.yearGainCs != null && stats.yearGainCs <= 0 ? 'pas de record cette année' : 'gagnées sur le record'}</div>
                </div>
                <div className="tile">
                  <div className="tile-label">Dernier temps</div>
                  <div className="tile-value tnum">{formatTime(stats.latest!.timeCs)}</div>
                  <div className={`tile-sub ${stats.latestVsBestCs === 0 ? 'good' : ''}`}>
                    {stats.latestVsBestCs === 0 ? 'C’est le record !' : `${formatDelta(stats.latestVsBestCs!)} du record`}
                  </div>
                </div>
                <div className="tile">
                  <div className="tile-label">Tendance</div>
                  <div className={`tile-value tnum ${stats.trendCsPerMonth != null && stats.trendCsPerMonth < 0 ? 'good' : ''}`}>
                    {stats.trendCsPerMonth != null ? formatDelta(Math.round(stats.trendCsPerMonth)) : '—'}
                  </div>
                  <div className="tile-sub">{stats.trendCsPerMonth != null ? 'par mois (10 dernières)' : 'min. 3 courses'}</div>
                </div>
                <div className="tile">
                  <div className="tile-label">Régularité</div>
                  <div className="tile-value tnum">{stats.consistencyCs != null ? `±${formatTime(stats.consistencyCs)}` : '—'}</div>
                  <div className="tile-sub">écart sur les 5 dernières</div>
                </div>
                <div className="tile">
                  <div className="tile-label">Courses</div>
                  <div className="tile-value">{stats.count}</div>
                  <div className="tile-sub">dont {stats.pbCount} record{stats.pbCount > 1 ? 's' : ''} battu{stats.pbCount > 1 ? 's' : ''}</div>
                </div>
                <div className="tile">
                  <div className="tile-label">Allure record</div>
                  <div className="tile-value tnum">{formatTime(pacePer100(best!.timeCs!, distance))}</div>
                  <div className="tile-sub">aux 100 m</div>
                </div>
                <div className="tile">
                  <div className="tile-label">Points (record)</div>
                  <div className="tile-value">{bestPts ?? '—'}</div>
                  <div className="tile-sub">World Aquatics{best!.points == null ? ' (estimé)' : ''}</div>
                </div>
              </div>
            </Section>
          </>
        )}

        {history.length > 0 && (
          <Section title="Historique" footer={`${history.length} course${history.length > 1 ? 's' : ''} sur cette épreuve.`}>
            <div className="list">
              {[...history].reverse().map((s) => (
                <SwimRow key={s.id} swim={s} pb={pbFlags.get(s.id)} meet={s.meetId ? meetsById.get(s.meetId) : undefined} showCourse={false} />
              ))}
            </div>
          </Section>
        )}
      </main>
    </>
  );
}
