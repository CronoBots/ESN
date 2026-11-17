import { useMemo, useState } from 'react';
import { useData } from '../store/store';
import { fullName, hasClubMembers, sortSwimmers, usePbFlags } from '../store/hooks';
import { ageAt, bandForAge, clubRecords, recordKey, type ClubRecord } from '../lib/clubRecords';
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
import { addCompare, openComparePicker, type CompareCandidate } from '../components/ComparePicker';
import { LevelLadder, levelYear } from '../components/Levels';
import { levelStatus } from '../lib/levels';

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
  // Nageurs ayant nagé cette épreuve, avec leur meilleur temps (un seul passage sur les courses)
  const candidates = useMemo<CompareCandidate[]>(() => {
    const bestBy = new Map<string, number>();
    for (const x of data.swims) {
      if (x.swimmerId === swimmerId || x.course !== course || x.distance !== distance || x.stroke !== stroke) continue;
      if (x.timeCs == null || !countsForRecords(x, include)) continue;
      const b = bestBy.get(x.swimmerId);
      if (b == null || x.timeCs < b) bestBy.set(x.swimmerId, x.timeCs);
    }
    return data.swimmers.filter((s) => bestBy.has(s.id)).map((s) => ({ swimmer: s, bestCs: bestBy.get(s.id)! }));
  }, [data.swims, data.swimmers, swimmerId, course, distance, stroke, include]);
  const byId = new Map(candidates.map((c) => [c.swimmer.id, c]));
  // Raccourcis : les nageurs suivis (pas encore comparés), les autres via la recherche
  const shortcuts = sortSwimmers(candidates.map((c) => c.swimmer).filter((s) => (s.favorite || s.relation === 'child') && !compareIds.includes(s.id))).slice(0, 3);

  if (!swimmer) return <Empty icon="person" title="Nageur introuvable" />;

  const valid = history.filter((s) => countsForRecords(s, include));
  const series: ChartSeries[] = [
    {
      id: swimmer.id,
      label: swimmer.firstName,
      color: COMPARE_COLORS[0],
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
  // Records du club sur cette épreuve : tous âges et à l'âge du nageur cette année
  const clubRecs = useMemo(() => {
    if (!swimmer?.member || !hasClubMembers(data.swimmers)) return [];
    const band = bandForAge(ageAt({ date: `${new Date().getFullYear()}-01-01` }, swimmer));
    const k = recordKey(distance, stroke);
    const out: { label: string; rec: ClubRecord }[] = [];
    const atAge = band ? clubRecords(data.swims, data.swimmers, { course, gender: swimmer.gender, band }).get(k) : undefined;
    if (band && atAge) out.push({ label: `à ${band.label}`, rec: atAge });
    const all = clubRecords(data.swims, data.swimmers, { course, gender: swimmer.gender }).get(k);
    if (all && all.swim.id !== atAge?.swim.id) out.push({ label: 'tous âges', rec: all });
    return out;
  }, [data.swims, data.swimmers, swimmer, course, distance, stroke]);
  // Niveaux FFBN de l'âge atteint cette année, comparés au record
  const levels = levelStatus(swimmer, course, distance, stroke, levelYear(), best?.timeCs);
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

              {clubRecs.length > 0 && (
                <button className="club-record-lines" onClick={() => navigate('/club-records')}>
                  {clubRecs.map(({ label, rec }) => {
                    const own = rec.swimmer.id === swimmer.id;
                    const gap = best?.timeCs != null ? best.timeCs - rec.swim.timeCs : 0;
                    return (
                      <span key={label} className="club-record-line">
                        <Icon name="trophy" aria-hidden="true" />
                        <span>
                          Record du club {label} :{' '}
                          {own ? (
                            <b>{swimmer.firstName} le détient ({formatTime(rec.swim.timeCs)})</b>
                          ) : (
                            <>
                              <b className="tnum">{formatTime(rec.swim.timeCs)}</b> · {fullName(rec.swimmer)}, {rec.swim.date.slice(0, 4)}
                              {gap > 0 ? <span className="muted tnum"> · encore {formatTime(gap)}</span> : null}
                            </>
                          )}
                        </span>
                      </span>
                    );
                  })}
                </button>
              )}

              {candidates.length > 0 && (
                <div className="compare-bar">
                  <div className="compare-label">Comparer avec</div>
                  <div className="compare-chips">
                    {compareIds.map((id, i) => {
                      const c = byId.get(id);
                      if (!c) return null;
                      return (
                        <button
                          key={id}
                          className="chip active"
                          onClick={() => setCompareIds((ids) => ids.filter((x) => x !== id))}
                          aria-label={`Retirer ${fullName(c.swimmer)} de la comparaison`}
                        >
                          <span className="line-key" style={{ background: COMPARE_COLORS[(i + 1) % COMPARE_COLORS.length] }} />
                          {c.swimmer.firstName}
                          <Icon name="close" />
                        </button>
                      );
                    })}
                    {shortcuts.map((o) => (
                      <button key={o.id} className="chip" onClick={() => setCompareIds((ids) => addCompare(ids, o.id))}>
                        <Avatar swimmer={o} size={20} />
                        {o.firstName}
                      </button>
                    ))}
                    <button
                      className="chip"
                      onClick={() =>
                        openComparePicker({
                          main: swimmer,
                          eventName: eventLabel(distance, stroke),
                          candidates,
                          initial: compareIds,
                          onDone: setCompareIds,
                        })
                      }
                    >
                      <Icon name="search" />
                      {compareIds.length || shortcuts.length ? 'Autre nageur' : 'Choisir un nageur'}
                    </button>
                  </div>
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                <ProgressChart
                  series={series}
                  goalCs={levels?.next?.cs}
                  height={250}
                  ariaLabel={`Progression sur ${eventLabel(distance, stroke)} : ${valid.length} temps, record ${formatTime(best!.timeCs)}`}
                />
                <div className="muted small center" style={{ padding: '4px 0 8px' }}>
                  Plus bas = plus rapide · cercle doré : record{levels?.next ? ` · pointillé : niveau ${levels.next.level}` : ''} · touchez la courbe pour le détail
                </div>
              </div>
            </div>

            {levels && <LevelLadder status={levels} course={course} />}

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
