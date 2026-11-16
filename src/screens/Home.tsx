import { useMemo } from 'react';
import { useData, actions } from '../store/store';
import { fullName, hasClubMembers, isActiveMember, mySwimmers, usePbFlags, useSelectedSwimmer } from '../store/hooks';
import { Avatar, BrandLogo, Empty, NavBar, Section, StrokeTag } from '../components/ui';
import { Icon } from '../components/Icon';
import { EvolutionCard, TimelineMeetCard, useTimeline } from '../components/MeetTimeline';
import { StrokeBars } from '../components/Chart';
import { navigate } from '../router';
import { chronoCompare, swimmerSummary } from '../lib/stats';
import { formatDate, formatMonthYear, formatRange, formatShortWeekday, relativeDay, sportAge, todayISO, seasonLabel, seasonOf } from '../lib/dates';
import { eventLabel, STROKE_BY_ID, courseLabel } from '../lib/events';
import { formatDelta, formatTime } from '../lib/time';
import { InstallBanner } from './Install';
import { LevelGoals } from '../components/Levels';
import { awaitingMeets, findResultsNow, SyncBanner, useSyncStatus } from './autoResults';
import { clubSummary, openClubCode, openFollow, openFollowPicker, useRosterAvailable } from './Club';
import type { Swimmer } from '../store/types';

import { capitalize, deName } from '../lib/text';

export function Home() {
  const data = useData();
  const swimmer = useSelectedSwimmer();
  const pbFlags = usePbFlags();
  const swimmers = mySwimmers(data.swimmers, swimmer);
  const clubMode = hasClubMembers(data.swimmers);
  const noChild = clubMode && !data.swimmers.some((s) => s.relation === 'child' || s.favorite);

  if (noChild) {
    return (
      <>
        <NavBar title="Accueil" brand={<BrandLogo height={64} />} />
        <main className="page">
          <Empty
            icon="person"
            title="Quels nageurs suivre ?"
            text="Choisissez dans la liste du club les nageurs à suivre (vos enfants, leurs coéquipiers…) : leurs résultats, records et progression s’afficheront ici."
            action={
              <div className="stack" style={{ width: '100%', maxWidth: 320 }}>
                <button className="btn block" onClick={() => openFollowPicker()}>
                  <Icon name="heart" /> Choisir les nageurs suivis
                </button>
                <button className="btn ghost block" onClick={() => navigate('/club')}>
                  <Icon name="users" /> Voir les nageurs du club
                </button>
              </div>
            }
          />
        </main>
      </>
    );
  }

  if (!swimmer) {
    return (
      <>
        <NavBar title="Accueil" brand={<BrandLogo height={64} />} />
        <main className="page">
          <Empty
            icon="person"
            title="Aucun nageur suivi"
            text="Choisissez dans la liste du club les nageurs à suivre : leurs résultats arrivent tout seuls."
            action={
              <button className="btn" onClick={() => openFollow()}>
                <Icon name="heart" /> Choisir dans la liste du club
              </button>
            }
          />
        </main>
      </>
    );
  }

  return (
    <>
      <NavBar title="Accueil" wide brand={<BrandLogo height={64} />} />
      <main className="page wide">
        {swimmers.length > 0 && (
          <div className="switcher" role="tablist" aria-label="Choisir un nageur">
            {swimmers.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={s.id === swimmer.id}
                className={s.id === swimmer.id ? 'active' : ''}
                onClick={() => actions.selectSwimmer(s.id)}
              >
                <Avatar swimmer={s} size={30} />
                <span className="name">{s.firstName}</span>
              </button>
            ))}
            <button className="add" onClick={() => openFollow()} aria-label="Suivre d’autres nageurs" title="Suivre d’autres nageurs">
              <Icon name="plus" />
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
  const multiDay = !!upcoming?.endDate && upcoming.endDate !== upcoming.startDate;
  const awaiting = useMemo(() => awaitingMeets(data, swimmer.id), [data, swimmer.id]);

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
          <Avatar swimmer={swimmer} size={58} onBrand />
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
            <span>{summary.races > 1 ? 'Courses' : 'Course'}</span>
          </div>
          <div className="hero-stat">
            <b>{summary.pbs}</b>
            <span>{summary.pbs > 1 ? 'Records' : 'Record'}</span>
          </div>
          <div className="hero-stat">
            <b>{summary.meets}</b>
            <span>{summary.meets > 1 ? 'Meetings' : 'Meeting'}</span>
          </div>
          <div className="hero-stat">
            <b>{summary.bestPoints?.points ?? '–'}</b>
            <span>Points max</span>
          </div>
        </div>
      </button>

      <InstallBanner />
      <SyncBanner />

      {awaiting.length > 0 && (
        <Section title="Résultats en attente">
          <div className="list">
            {awaiting.map(({ meet, entries }) => (
              <button key={meet.id} className="row" onClick={() => navigate(`/meet/${meet.id}`)}>
                <span className="row-icon" style={{ background: '#ff9f0a' }}>
                  <Icon name="stopwatch" />
                </span>
                <div className="row-body">
                  <div className="row-title">{meet.name}</div>
                  <div className="row-sub">
                    {[formatRange(meet.startDate, meet.endDate), meet.city, `${entries}\u00a0épreuve${entries > 1 ? 's' : ''} au programme`].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <Icon name="chevronRight" className="chev" />
              </button>
            ))}
          </div>
          <div className="section-foot">
            L’organisateur n’a pas encore publié les résultats : ils s’ajouteront tout seuls dès leur publication.
          </div>
        </Section>
      )}

      {summary.races === 0 && !upcoming && !syncing && awaiting.length === 0 && (
        <Section>
          <div className="card">
            <Empty
              icon="stopwatch"
              title="Pas encore de résultat"
              text={
                swimmer.member
                  ? `Aucune compétition ${deName(swimmer.firstName)} publiée cette saison, et son historique des saisons passées n’a pas encore été ajouté par le club. Ses prochains résultats arriveront tout seuls.`
                  : `Les résultats de compétition ${deName(swimmer.firstName)} sont ajoutés automatiquement dès leur publication par les organisateurs.`
              }
              action={
                <div className="stack" style={{ width: '100%', maxWidth: 320 }}>
                  <button className="btn block" onClick={() => findResultsNow(swimmer.firstName, swimmer.id)}>
                    <Icon name="sparkles" /> Rechercher ses résultats
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
                {upcomingEntries.length > 0 && (
                  <span className="agenda">
                    {upcomingEntries.slice(0, 8).map((s) => (
                      <span key={s.id} className="agenda-row">
                        <span className="agenda-time">
                          {multiDay && s.date ? `${formatShortWeekday(s.date)} ` : ''}
                          {s.startTime ?? ''}
                        </span>
                        <span className="stroke-dot" style={{ background: `var(${STROKE_BY_ID[s.stroke].colorVar})` }} />
                        <span className="agenda-name">{eventLabel(s.distance, s.stroke)}</span>
                        {s.timeCs != null && <b className="tnum">{formatTime(s.timeCs)}</b>}
                      </span>
                    ))}
                    {upcomingEntries.length > 8 && (
                      <span className="agenda-row agenda-more">
                        + {upcomingEntries.length - 8} autre{upcomingEntries.length - 8 > 1 ? 's' : ''} épreuve
                        {upcomingEntries.length - 8 > 1 ? 's' : ''}
                      </span>
                    )}
                  </span>
                )}
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

          <LevelGoals swimmer={swimmer} swims={data.swims} includeTraining={include} />

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
                    {summary.podiums === 0 ? 'en compétition' : summary.wins === 0 ? 'pas encore de victoire' : `dont ${summary.wins} victoire${summary.wins > 1 ? 's' : ''}`}
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

          <ClubCard />
        </div>
      </div>
    </>
  );
}

/** Accès aux nageurs du club (ou au code du club s'il n'est pas encore saisi). */
function ClubCard() {
  const data = useData();
  const available = useRosterAvailable();
  const club = data.settings.club;
  if (!club && !available) return null;
  const members = data.swimmers.filter(isActiveMember);
  return (
    <Section title="Le club">
      {club ? (
        <div className="list">
          <button className="row" onClick={() => navigate('/club')}>
            <span className="row-icon" style={{ background: 'var(--brand-green)' }}>
              <Icon name="users" />
            </span>
            <div className="row-body">
              <div className="row-title">Nageurs de l’ESN</div>
              <div className="row-sub">
                {clubSummary(club.groups, members)}
              </div>
            </div>
            <Icon name="chevronRight" className="chev" />
          </button>
          <button className="row" onClick={() => navigate('/rankings')}>
            <span className="row-icon" style={{ background: 'var(--brand-blue)' }}>
              <Icon name="ranking" />
            </span>
            <div className="row-body">
              <div className="row-title">Classements du club</div>
              <div className="row-sub">Meilleurs temps par épreuve{club.groups.length ? ' et par groupe' : ', par âge'}</div>
            </div>
            <Icon name="chevronRight" className="chev" />
          </button>
        </div>
      ) : (
        <button className="card pad club-card" style={{ width: '100%', textAlign: 'left' }} onClick={() => openClubCode(() => openFollowPicker())}>
          <span className="row-icon club-card-icon" aria-hidden="true">
            <Icon name="shield" />
          </span>
          <div className="grow">
            <div style={{ fontWeight: 600 }}>Membre de l’ESN ?</div>
            <div className="muted small">Entrez le code du club pour retrouver tous les nageurs du club et leurs résultats.</div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </button>
      )}
    </Section>
  );
}

