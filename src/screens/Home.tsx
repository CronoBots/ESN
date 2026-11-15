import { useMemo } from 'react';
import { useData, actions } from '../store/store';
import { fullName, sortSwimmers, usePbFlags, useSelectedSwimmer } from '../store/hooks';
import { Avatar, Empty, NavBar, Section, StrokeTag } from '../components/ui';
import { Icon } from '../components/Icon';
import { EvolutionCard, TimelineMeetCard, useTimeline } from '../components/MeetTimeline';
import { StrokeBars } from '../components/Chart';
import { navigate } from '../router';
import { chronoCompare, countsForRecords, goalAchievedDate, projectGoal, swimmerSummary, eventHistory } from '../lib/stats';
import { formatDate, formatMonthYear, formatRange, relativeDay, sportAge, todayISO, seasonLabel, seasonOf } from '../lib/dates';
import { eventLabel, STROKE_BY_ID, courseLabel } from '../lib/events';
import { formatDelta, formatTime } from '../lib/time';
import { openGoalForm, openSwimmerForm } from './forms';
import { InstallBanner } from './Install';
import { findResultsNow, SyncBanner, useSyncStatus } from './autoResults';
import { openResultPhotos } from './ResultPhotos';
import type { Goal, Swimmer } from '../store/types';

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
import { deName } from '../lib/text';

export function Home() {
  const data = useData();
  const swimmer = useSelectedSwimmer();
  const pbFlags = usePbFlags();
  const swimmers = sortSwimmers(data.swimmers);

  if (!swimmer) {
    return (
      <>
        <NavBar title="Accueil" />
        <main className="page">
          <Empty
            icon="person"
            title="Aucun nageur"
            text="Ajoutez votre enfant pour commencer à suivre ses performances."
            action={
              <button className="btn" onClick={() => openSwimmerForm()}>
                <Icon name="plus" /> Ajouter un nageur
              </button>
            }
          />
        </main>
      </>
    );
  }

  return (
    <>
      <NavBar
        title="Accueil"
        wide
        right={
          <button className="icon-btn" aria-label="Ajouter un nageur" onClick={() => openSwimmerForm()}>
            <Icon name="plus" />
          </button>
        }
      />
      <main className="page wide">
        {swimmers.length > 1 && (
          <div className="switcher" role="tablist" aria-label="Choisir un nageur">
            {swimmers.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={s.id === swimmer.id}
                className={s.id === swimmer.id ? 'active' : ''}
                onClick={() => actions.selectSwimmer(s.id)}
              >
                <Avatar swimmer={s} size={52} />
                <span className="name">{s.firstName}</span>
              </button>
            ))}
            <button onClick={() => openSwimmerForm()} aria-label="Ajouter un nageur">
              <span className="add">
                <Icon name="plus" style={{ width: 22, height: 22 }} />
              </span>
              <span className="name">Ajouter</span>
            </button>
          </div>
        )}
        <HomeContent swimmer={swimmer} pbFlags={pbFlags} />
      </main>
    </>
  );
}

function HomeContent({ swimmer, pbFlags }: { swimmer: Swimmer; pbFlags: ReturnType<typeof usePbFlags> }) {
  const data = useData();
  const include = data.settings.includeTraining;
  const summary = useMemo(() => swimmerSummary(data.swims, swimmer, include, pbFlags), [data.swims, swimmer, include, pbFlags]);
  const mine = useMemo(() => data.swims.filter((s) => s.swimmerId === swimmer.id), [data.swims, swimmer.id]);
  const today = todayISO();
  const age = sportAge(swimmer.birthYear);

  // Prochaine compétition : inscriptions à venir ou compétition en cours
  const upcoming = useMemo(() => {
    const meetIds = new Set(mine.filter((s) => s.meetId).map((s) => s.meetId!));
    return data.meets
      .filter((m) => (m.endDate ?? m.startDate) >= today && meetIds.has(m.id))
      .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0];
  }, [data.meets, mine, today]);
  const upcomingEntries = upcoming ? mine.filter((s) => s.meetId === upcoming.id).sort(chronoCompare) : [];

  const recentPBs = useMemo(
    () =>
      mine
        .filter((s) => pbFlags.get(s.id)?.isPB)
        .sort(chronoCompare)
        .reverse()
        .slice(0, 4),
    [mine, pbFlags],
  );
  const timeline = useTimeline(swimmer);
  const lastMeet = [...timeline].reverse().find((e) => e.startDate <= today);
  const goals = data.goals.filter((g) => g.swimmerId === swimmer.id);
  const syncing = useSyncStatus() != null;
  const maxPts = Math.max(400, ...summary.strokePoints.map((s) => s.points ?? 0));

  return (
    <>
      <button
        className="hero"
        style={{
          display: 'block',
          width: '100%',
          border: 0,
          textAlign: 'left',
        }}
        onClick={() => navigate(`/swimmer/${swimmer.id}`)}
      >
        <div className="hero-top">
          <Avatar swimmer={swimmer} size={58} />
          <div className="grow">
            <div className="hero-name">{fullName(swimmer)}</div>
            <div className="hero-sub">
              {[swimmer.club, age != null ? `${age} ans` : null].filter(Boolean).join(' · ') || 'Voir le profil'}
            </div>
          </div>
          <Icon name="chevronRight" style={{ width: 18, height: 18, opacity: 0.7 }} />
        </div>
        <div className="hero-stats">
          <div className="hero-stat">
            <b>{summary.races}</b>
            <span>Courses</span>
          </div>
          <div className="hero-stat">
            <b>{summary.pbs}</b>
            <span>Records</span>
          </div>
          <div className="hero-stat">
            <b>{summary.meets}</b>
            <span>Compét.</span>
          </div>
          <div className="hero-stat">
            <b>{summary.bestPoints?.points ?? '–'}</b>
            <span>Max pts</span>
          </div>
        </div>
      </button>

      <InstallBanner />
      <SyncBanner />

      {summary.races === 0 && !upcoming && !syncing && (
        <Section>
          <div className="card">
            <Empty
              icon="stopwatch"
              title="Pas encore de résultat"
              text={`Les résultats de compétition ${deName(swimmer.firstName)} sont ajoutés automatiquement dès leur publication par les organisateurs. Pour l’historique plus ancien, utilisez l’import.`}
              action={
                <div className="stack" style={{ width: '100%', maxWidth: 320 }}>
                  <button className="btn block" onClick={() => findResultsNow(swimmer.firstName)}>
                    <Icon name="sparkles" /> Rechercher ses résultats
                  </button>
                  <button className="btn ghost block" onClick={() => navigate(`/import?swimmer=${swimmer.id}`)}>
                    <Icon name="download" /> Importer depuis swimrankings
                  </button>
                </div>
              }
            />
          </div>
        </Section>
      )}

      <div className="home-cols">
        <div className="col">
          {upcoming && (
            <Section
              title={upcoming.startDate <= today ? 'Compétition en cours' : 'Prochaine compétition'}
              action={
                <button className="section-link" onClick={() => navigate(`/meet/${upcoming.id}`)}>
                  Programme
                </button>
              }
            >
              <button
                className="card"
                style={{
                  display: 'block',
                  width: '100%',
                  border: 0,
                  textAlign: 'left',
                  padding: 0,
                }}
                onClick={() => navigate(`/meet/${upcoming.id}`)}
              >
                <div style={{ padding: '14px 16px 10px' }}>
                  <div className="hstack between">
                    <div className="grow">
                      <div style={{ fontWeight: 700, fontSize: 18 }}>{upcoming.name}</div>
                      <div className="muted small" style={{ marginTop: 2 }}>
                        {[formatRange(upcoming.startDate, upcoming.endDate), upcoming.city, courseLabel(upcoming.course)]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <span className="badge first" style={{ height: 24, fontSize: 12 }}>
                      {capitalize(relativeDay(upcoming.startDate))}
                    </span>
                  </div>
                </div>
                {upcoming.startDate <= today && (
                  <div style={{ padding: '0 16px 12px' }}>
                    <span
                      role="button"
                      className="btn secondary small"
                      onClick={(e) => {
                        e.stopPropagation();
                        openResultPhotos({ meetId: upcoming.id });
                      }}
                    >
                      <Icon name="upload" /> Résultats affichés : photographier
                    </span>
                  </div>
                )}
                <div className="chips" style={{ padding: '0 16px 14px', flexWrap: 'wrap' }}>
                  {upcomingEntries.slice(0, 8).map((s) => (
                    <span key={s.id} className="chip" style={{ boxShadow: 'none', background: 'var(--fill)' }}>
                      <span
                        className="stroke-dot"
                        style={{
                          background: `var(${STROKE_BY_ID[s.stroke].colorVar})`,
                        }}
                      />
                      {eventLabel(s.distance, s.stroke)}
                      {s.startTime && <span className="count">{s.startTime}</span>}
                      {s.timeCs != null && <b className="tnum">{formatTime(s.timeCs)}</b>}
                    </span>
                  ))}
                </div>
              </button>
            </Section>
          )}

          {lastMeet && (
            <Section
              title="Dernière compétition"
              action={
                <button className="section-link" onClick={() => navigate('/meets')}>
                  Toutes
                </button>
              }
            >
              <TimelineMeetCard entry={lastMeet} swimmer={swimmer} pbFlags={pbFlags} />
            </Section>
          )}

          {timeline.length >= 2 && (
            <Section title="Évolution">
              <EvolutionCard timeline={timeline} swimmer={swimmer} limit={12} />
            </Section>
          )}
        </div>

        <div className="col">
          {recentPBs.length > 0 && (
            <Section
              title="Derniers records"
              action={
                <button className="section-link" onClick={() => navigate('/records')}>
                  Tous
                </button>
              }
            >
              <div className="tiles">
                {recentPBs.map((s) => {
                  const info = pbFlags.get(s.id)!;
                  return (
                    <button
                      key={s.id}
                      className="tile"
                      style={{ border: 0, textAlign: 'left' }}
                      onClick={() => navigate(`/event/${swimmer.id}/${s.course}/${s.distance}/${s.stroke}`)}
                    >
                      <div className="hstack" style={{ gap: 8 }}>
                        <StrokeTag stroke={s.stroke} distance={s.distance} size={28} />
                        <div
                          className="tile-label grow"
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {STROKE_BY_ID[s.stroke].label} · {courseLabel(s.course)}
                        </div>
                      </div>
                      <div className="tile-value tnum" style={{ marginTop: 10 }}>
                        {formatTime(s.timeCs)}
                      </div>
                      <div className="tile-sub good">
                        {formatDelta(info.deltaCs ?? 0)} · {formatDate(s.date)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Section>
          )}

          <Section
            title="Objectifs"
            action={
              <button className="section-link" onClick={() => openGoalForm({ swimmerId: swimmer.id })}>
                Ajouter
              </button>
            }
          >
            {goals.length === 0 ? (
              <button
                className="card pad"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  width: '100%',
                  border: 0,
                  textAlign: 'left',
                }}
                onClick={() => openGoalForm({ swimmerId: swimmer.id })}
              >
                <span className="empty-icon" style={{ width: 48, height: 48, borderRadius: 14 }}>
                  <Icon name="target" style={{ width: 26, height: 26 }} />
                </span>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>Fixez un objectif</div>
                  <div className="muted small">Un temps limite, un chrono à battre… Nageo estime quand il sera atteint.</div>
                </div>
              </button>
            ) : (
              <div className="stack">
                {goals.map((g) => (
                  <GoalCard key={g.id} goal={g} />
                ))}
              </div>
            )}
          </Section>

          {summary.races > 0 && (
            <Section title="Profil de nageur" footer="Meilleur score World Aquatics obtenu dans chaque nage (indicatif).">
              <div className="card pad">
                <StrokeBars
                  max={maxPts}
                  rows={summary.strokePoints.map((sp) => ({
                    key: sp.stroke,
                    label: STROKE_BY_ID[sp.stroke].label,
                    color: `var(${STROKE_BY_ID[sp.stroke].colorVar})`,
                    value: sp.points,
                  }))}
                />
                {(() => {
                  const top = [...summary.strokePoints].filter((s) => s.points).sort((a, b) => b.points! - a.points!)[0];
                  return top ? (
                    <div className="muted small" style={{ marginTop: 8 }}>
                      Nage de prédilection : <b style={{ color: 'var(--text)' }}>{STROKE_BY_ID[top.stroke].label}</b>
                      {top.best && ` (${eventLabel(top.best.distance, top.best.stroke)} en ${formatTime(top.best.timeCs)})`}
                    </div>
                  ) : null;
                })()}
              </div>
            </Section>
          )}

          {summary.races > 0 && (
            <Section>
              <div className="tiles three">
                <div className="tile">
                  <div className="tile-label">{seasonLabel(seasonOf(today))}</div>
                  <div className="tile-value">{summary.pbsThisSeason}</div>
                  <div className="tile-sub">records battus</div>
                </div>
                <div className="tile">
                  <div className="tile-label">Distance nagée</div>
                  <div className="tile-value">
                    {(summary.distanceRaced / 1000).toLocaleString('fr-BE', {
                      maximumFractionDigits: 1,
                    })}{' '}
                    <small>km</small>
                  </div>
                  <div className="tile-sub">en compétition</div>
                </div>
                <div className="tile">
                  <div className="tile-label">Podiums</div>
                  <div className="tile-value">{summary.podiums}</div>
                  <div className="tile-sub">
                    dont {summary.wins} victoire{summary.wins > 1 ? 's' : ''}
                  </div>
                </div>
              </div>
              {summary.lastRace && (
                <div className="section-foot">
                  Dernière course : {formatMonthYear(summary.lastRace.date)}.{' '}
                  <button
                    className="section-link"
                    style={{ fontSize: 13 }}
                    onClick={() => navigate(`/swimmer/${swimmer.id}/history`)}
                  >
                    Voir tout l’historique
                  </button>
                </div>
              )}
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

export function GoalCard({ goal }: { goal: Goal }) {
  const data = useData();
  const include = data.settings.includeTraining;
  const history = eventHistory(data.swims, goal.swimmerId, goal.course, goal.distance, goal.stroke);
  const valid = history.filter((s) => countsForRecords(s, include));
  const best = valid.length ? Math.min(...valid.map((s) => s.timeCs!)) : null;
  const first = valid.length ? valid[0].timeCs! : null;
  const achieved = goalAchievedDate(goal, data.swims, include);
  const remaining = best != null ? best - goal.targetCs : null;
  // Progression : du premier temps vers l'objectif
  let pct = 0;
  if (achieved) pct = 100;
  else if (best != null && first != null && first > goal.targetCs)
    pct = Math.max(0, Math.min(99, ((first - best) / (first - goal.targetCs)) * 100));
  const projection = !achieved ? projectGoal(history, goal.targetCs, include) : null;

  return (
    <button
      className="card pad"
      style={{ display: 'block', width: '100%', border: 0, textAlign: 'left' }}
      onClick={() => navigate(`/event/${goal.swimmerId}/${goal.course}/${goal.distance}/${goal.stroke}`)}
    >
      <div className="hstack">
        <StrokeTag stroke={goal.stroke} distance={goal.distance} size={36} />
        <div className="grow">
          <div style={{ fontWeight: 600 }}>
            {goal.label || `${eventLabel(goal.distance, goal.stroke)} en ${formatTime(goal.targetCs)}`}
          </div>
          <div className="muted small">
            {eventLabel(goal.distance, goal.stroke)} · {courseLabel(goal.course)} · objectif {formatTime(goal.targetCs)}
            {goal.deadline && ` · avant le ${formatDate(goal.deadline)}`}
          </div>
        </div>
        <span
          className="icon-btn"
          role="button"
          aria-label="Modifier l’objectif"
          onClick={(e) => {
            e.stopPropagation();
            openGoalForm({ goal, swimmerId: goal.swimmerId });
          }}
        >
          <Icon name="edit" style={{ width: 20, height: 20 }} />
        </span>
      </div>
      <div className={`meter${achieved ? ' gold' : ''}`} style={{ marginTop: 12 }}>
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="hstack between small" style={{ marginTop: 8 }}>
        <span className="muted">{best != null ? `Record : ${formatTime(best)}` : 'Pas encore de temps'}</span>
        <span style={{ fontWeight: 600 }} className={achieved ? 'gold' : ''}>
          {achieved ? `🏆 Atteint le ${formatDate(achieved)}` : remaining != null ? `Encore ${formatTime(remaining)}` : ''}
        </span>
      </div>
      {projection && (
        <div className="small" style={{ marginTop: 6, color: 'var(--accent)' }}>
          📈 Au rythme actuel : atteint vers {formatMonthYear(projection)}
        </div>
      )}
    </button>
  );
}
