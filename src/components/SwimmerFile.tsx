import { useMemo, type ReactNode } from 'react';
import { actions, useData } from '../store/store';
import { fullName, isActiveMember, swimsOf, usePbFlags } from '../store/hooks';
import { Avatar, Empty, Row, Section, StrokeDot, StrokeTag, Toggle } from './ui';
import { Icon } from './Icon';
import { TimelineMeetCard, useTimeline } from './MeetTimeline';
import { navigate } from '../router';
import { achievements, chronoCompare, pointsFor, swimmerSummary } from '../lib/stats';
import { formatDate, formatRange, formatShortWeekday, relativeDay, sportAge, seasonLabel, todayISO } from '../lib/dates';
import { courseLabel, eventLabel, STROKE_BY_ID } from '../lib/events';
import { formatDelta, formatTime } from '../lib/time';
import { LEVELS } from '../lib/levels';
import { rankCategory, rankLabel } from '../lib/rankings';
import { bestTimesTable, careerSpan, clubRecordsHeld, seasonsSummary, topRanks } from '../lib/profile';
import { upcomingClubEvents } from '../lib/clubCalendar';
import { swimrankingsUrl } from '../lib/swimrankings';
import { capitalize, deName } from '../lib/text';
import { LevelGoals, useLevelGoals } from './Levels';
import { AllroundCard, QualifyingGoals } from './Qualifying';
import { SwimmerMedals } from './Medals';
import { ClubEventCard, useClubCalendar } from './ClubCalendar';
import { awaitingMeets, findResultsNow, useSyncStatus } from '../screens/autoResults';
import { FollowButton, isFollowed } from '../screens/Club';
import type { Swimmer } from '../store/types';

/**
 * Fiche complète d'un nageur : la même sur l'accueil (nageur choisi) et sur la page d'un nageur du
 * club. Tout y est, sans rien à deviner : ce qui arrive, ce qui vient de se passer, ses meilleurs
 * temps, ses records, ses objectifs, son parcours saison par saison. Tout est recalculé à partir des
 * données : la fiche se met à jour d'elle-même (résultats, historique, classements).
 *
 * `home` : sur l'accueil (pas de bouton « Afficher sur l'accueil ») ; `afterHero` : bandeau sous l'en-tête
 * (installation) ; `children` : à la fin de la 2e colonne (la vie du club, sur l'accueil).
 */
export function SwimmerFile({ swimmer, home, afterHero, children }: { swimmer: Swimmer; home?: boolean; afterHero?: ReactNode; children?: ReactNode }) {
  const data = useData();
  const pbFlags = usePbFlags();
  const id = swimmer.id;
  const include = false;
  const mine = swimsOf(data.swims, id);
  const summary = useMemo(() => swimmerSummary(mine, swimmer, include, pbFlags), [mine, swimmer, include, pbFlags]);
  const today = todayISO();
  const age = sportAge(swimmer.birthYear);
  const meetsById = useMemo(() => new Map(data.meets.map((m) => [m.id, m])), [data.meets]);

  // Prochaine compétition : inscriptions à venir ou compétition en cours
  const upcoming = useMemo(() => {
    const meetIds = new Set(mine.filter((s) => s.meetId).map((s) => s.meetId!));
    return data.meets
      .filter((m) => (m.endDate ?? m.startDate) >= today && meetIds.has(m.id))
      .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0];
  }, [data.meets, mine, today]);
  const upcomingEntries = upcoming ? mine.filter((s) => s.meetId === upcoming.id).sort(chronoCompare) : [];
  const multiDay = !!upcoming?.endDate && upcoming.endDate !== upcoming.startDate;
  const awaiting = useMemo(() => awaitingMeets(data, id), [data, id]);
  // Pas encore de programme publié : la prochaine compétition annoncée par le calendrier du club (la même pour tous)
  const cal = useClubCalendar();
  const clubNext = useMemo(
    () => (upcoming || swimmer.former ? undefined : upcomingClubEvents(cal, data.meets, today)[0]),
    [upcoming, swimmer.former, cal, data.meets, today],
  );
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

  const trophies = useMemo(() => achievements(mine, swimmer, data.meets, pbFlags), [mine, swimmer, data.meets, pbFlags]);
  const span = useMemo(() => careerSpan(mine), [mine]);
  const bests = useMemo(() => bestTimesTable(mine), [mine]);
  const held = useMemo(() => (swimmer.member ? clubRecordsHeld(data.swims, data.swimmers, swimmer) : []), [data.swims, data.swimmers, swimmer]);
  const seasons = useMemo(() => seasonsSummary(mine, swimmer, pbFlags), [mine, swimmer, pbFlags]);
  const ranks = useMemo(() => topRanks(data.rankings, id), [data.rankings, id]);
  const { reached } = useLevelGoals(swimmer, mine, false);
  const levelTotal = LEVELS.reduce((a, l) => a + reached[l], 0);

  // Comme la liste ouverte par « Toutes les courses » : temps, forfaits et abandons (sans le programme à venir)
  const count = mine.filter((s) => s.timeCs != null || s.status !== 'OK').length;
  const isSelected = data.settings.selectedSwimmerId === id;
  const noneFollowed = !data.swimmers.some(isFollowed);
  const unlocked = trophies.filter((t) => t.unlocked).length;
  const lastCheck = data.settings.liveSync.lastCheck;
  const bestsCount = bests.reduce((a, r) => a + (r.scm ? 1 : 0) + (r.lcm ? 1 : 0), 0);
  // Les pages Records, Progression… montrent le nageur choisi sur l'accueil
  const openFor = (path: string) => () => {
    actions.selectSwimmer(id);
    navigate(path);
  };
  const sub = [
    swimmer.former ? 'Ancien membre de l’ESN' : swimmer.member || isActiveMember(swimmer) ? 'Ecole Seraing Natation' : swimmer.club,
    age != null ? `${age} ans` : null,
    span.first && swimmer.member ? `au club depuis ${span.first.date.slice(0, 4)}` : null,
  ].filter(Boolean);

  return (
    <>
      <div className="hero">
        <div className="hero-top">
          <Avatar swimmer={swimmer} size={58} onBrand />
          <div className="grow">
            <div className="hero-name">{fullName(swimmer)}</div>
            <div className="hero-sub">{sub.join('\u00a0· ')}</div>
          </div>
          {!home && <FollowButton swimmer={swimmer} />}
        </div>
        <div className="hero-stats">
          <div className="hero-stat">
            <b>{summary.meets}</b>
            <span>{summary.meets > 1 ? 'Compétitions' : 'Compétition'}</span>
          </div>
          <div className="hero-stat">
            <b>{summary.races}</b>
            <span>{summary.races > 1 ? 'Courses' : 'Course'}</span>
          </div>
          <div className="hero-stat">
            <b>{bestsCount}</b>
            <span>Records perso</span>
          </div>
          <div className="hero-stat">
            <b>{summary.bestPoints?.points ?? '–'}</b>
            <span>Points max</span>
          </div>
        </div>
        {(held.length > 0 || levelTotal > 0 || ranks.length > 0) && (
          <div className="hero-badges">
            {held.length > 0 && (
              <span>
                <Icon name="trophy" /> {held.length} record{held.length > 1 ? 's' : ''} du club
              </span>
            )}
            {levelTotal > 0 && (
              <span>
                <Icon name="target" /> {LEVELS.filter((l) => reached[l]).map((l) => `${reached[l]} ${l}`).join(' · ')}
              </span>
            )}
            {ranks[0] && (
              <span>
                <Icon name="ranking" /> {rankLabel(ranks[0].rank)} en Belgique · {rankCategory(ranks[0].label)}
              </span>
            )}
          </div>
        )}
      </div>

      {!home && (
        <div className="file-actions">
          {(!isSelected || noneFollowed) && (
            <button
              className="btn block"
              onClick={() => {
                // Aucun nageur suivi : l'accueil afficherait « Quels nageurs suivre ? » ; ce nageur devient suivi
                if (noneFollowed) actions.follow(id, true);
                actions.selectSwimmer(id);
                navigate('/');
              }}
            >
              <Icon name="home" /> Afficher sur l’accueil
            </button>
          )}
        </div>
      )}

      {afterHero}

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
                    {[formatRange(meet.startDate, meet.endDate), meet.city, `${entries}\u00a0épreuve${entries > 1 ? 's' : ''} au programme`].filter(Boolean).join('\u00a0· ')}
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
                  ? `Aucune compétition ${deName(swimmer.firstName)} avec l’ESN pour l’instant. Ses prochains résultats arriveront tout seuls.`
                  : `Les résultats de compétition ${deName(swimmer.firstName)} sont ajoutés automatiquement dès leur publication par les organisateurs.`
              }
              action={
                <div className="stack" style={{ width: '100%', maxWidth: 320 }}>
                  <button className="btn block" onClick={() => findResultsNow(swimmer.firstName, id)}>
                    <Icon name="sparkles" /> Rechercher ses résultats
                  </button>
                </div>
              }
            />
          </div>
        </Section>
      )}

      {/* Colonne 1 : ce qui arrive, ce qui vient de se passer, les meilleurs temps.
          Colonne 2 : objectifs, records, parcours, puis le club (sur l'accueil). */}
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
                          .join('\u00a0· ')}
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

          {!upcoming && clubNext && cal && (
            <Section
              title={clubNext.start <= today ? 'Compétition en cours' : 'Prochaine compétition'}
              action={
                <button className="section-link" onClick={() => navigate('/meets')}>
                  Calendrier
                </button>
              }
            >
              <ClubEventCard ev={clubNext} cal={cal} />
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
          {bests.length > 0 && (
            <Section title="Meilleurs temps" action={<button className="section-link" onClick={openFor('/records')}>Détail</button>}>
              <div className="card bt-table">
                <div className="bt-head" aria-hidden="true">
                  <span>Épreuve</span>
                  <span>25 m</span>
                  <span>50 m</span>
                </div>
                {bests.map((r) => (
                  <button
                    key={`${r.distance}-${r.stroke}`}
                    className="bt-row"
                    onClick={() => navigate(`/event/${id}/${r.scm ? 'SCM' : 'LCM'}/${r.distance}/${r.stroke}`)}
                  >
                    <span className="bt-event">
                      <StrokeDot stroke={r.stroke} />
                      {eventLabel(r.distance, r.stroke)}
                    </span>
                    {[r.scm, r.lcm].map((b, i) => (
                      <span key={i} className="bt-cell">
                        {b ? (
                          <>
                            <b className="tnum">{formatTime(b.timeCs)}</b>
                            <small>{[pointsFor(b, swimmer) != null ? `${pointsFor(b, swimmer)} pts` : null, b.date.slice(0, 4)].filter(Boolean).join(' · ')}</small>
                          </>
                        ) : (
                          <span className="muted">–</span>
                        )}
                      </span>
                    ))}
                  </button>
                ))}
              </div>
              <div className="section-foot">Meilleur temps en compétition de chaque épreuve, avec ses points World Aquatics et son année. Touchez une épreuve pour sa courbe.</div>
            </Section>
          )}

          {held.length > 0 && (
            <Section title="Records du club" action={<button className="section-link" onClick={() => navigate('/club-records')}>Tous</button>}>
              <div className="list">
                {held.slice(0, 12).map((h) => (
                  <div key={`${h.band.id}-${h.course}-${h.swim.distance}-${h.swim.stroke}`} className="row">
                    <StrokeTag stroke={h.swim.stroke} distance={h.swim.distance} />
                    <div className="row-body">
                      <div className="row-title">
                        {eventLabel(h.swim.distance, h.swim.stroke)} · {courseLabel(h.course)}
                      </div>
                      <div className="row-sub">
                        {h.band.id === 'all' ? 'Record absolu du club' : h.band.label} · {formatDate(h.swim.date)}
                      </div>
                    </div>
                    <span className="row-value tnum">{formatTime(h.swim.timeCs)}</span>
                  </div>
                ))}
              </div>
              {held.length > 12 && <div className="section-foot">Et {held.length - 12} autres records du club.</div>}
            </Section>
          )}
        </div>

        <div className="col">
          {!swimmer.former && <LevelGoals swimmer={swimmer} swims={mine} includeTraining={include} />}

          {!swimmer.former && <QualifyingGoals swimmer={swimmer} swims={mine} />}

          {!swimmer.former && <AllroundCard swimmer={swimmer} swims={mine} />}

          <SwimmerMedals swimmer={swimmer} swims={mine} meetsById={meetsById} pbFlags={pbFlags} />

          {ranks.length > 0 && (
            <Section
              title="Classements nationaux"
              footer="Meilleurs rangs de la dernière saison de chaque bassin (25 m et 50 m), dans la catégorie d’âge ou au classement général, publiés sur swimrankings.net."
            >
              <div className="list">
                {ranks.map((r) => (
                  <button key={`${r.course}-${r.distance}-${r.stroke}`} className="row" onClick={() => navigate(`/event/${id}/${r.course}/${r.distance}/${r.stroke}`)}>
                    <StrokeTag stroke={r.stroke} distance={r.distance} />
                    <div className="row-body">
                      <div className="row-title">
                        {eventLabel(r.distance, r.stroke)} · {courseLabel(r.course)}
                      </div>
                      <div className="row-sub">
                      {r.label} · {r.season}
                    </div>
                    </div>
                    <div className="row-end">
                      <div style={{ textAlign: 'right' }}>
                        <div className="time-big tnum">{rankLabel(r.rank)}</div>
                        {r.of != null && <div className="small muted tnum">sur {r.of}</div>}
                      </div>
                      <Icon name="chevronRight" className="chev" />
                    </div>
                  </button>
                ))}
              </div>
            </Section>
          )}

          {seasons.length > 0 && (
            <Section title="Saison par saison">
              <div className="card season-table">
                <div className="st-head" aria-hidden="true">
                  <span>Saison</span>
                  <span>Compét.</span>
                  <span>Courses</span>
                  <span>Records</span>
                  <span>Points</span>
                </div>
                {seasons.map((s) => (
                  <div key={s.season} className="st-row">
                    <span>{seasonLabel(s.season).replace('Saison ', '')}</span>
                    <span className="tnum">{s.meets}</span>
                    <span className="tnum">{s.races}</span>
                    <span className="tnum">{s.pbs}</span>
                    <span className="tnum">{s.bestPoints ?? '–'}</span>
                  </div>
                ))}
              </div>
              <div className="section-foot">Records : records personnels battus dans la saison. Points : meilleur total World Aquatics d’une course.</div>
            </Section>
          )}

          <Section>
            <div className="list">
              <Row icon="list" title="Toutes les courses" value={count} chevron onClick={() => navigate(`/swimmer/${id}/history`)} />
              <Row icon="chart" iconBg="#30d158" title="Progression" chevron onClick={openFor('/progress')} />
              <Row icon="target" iconBg="var(--lvl-trident)" title="Niveaux FFBN" chevron onClick={openFor('/levels')} />
              <Row icon="medal" iconBg="#f5a400" title="Trophées" value={`${unlocked}/${trophies.length}`} chevron onClick={openFor('/progress')} />
              {swimmer.swimrankingsId && <Row title="Profil sur swimrankings.net" href={swimrankingsUrl(swimmer.swimrankingsId)} external />}
              <div className="field">
                <span className="label grow">{swimmer.gender === 'F' ? 'Suivre cette nageuse' : 'Suivre ce nageur'}</span>
                <Toggle
                  on={swimmer.favorite || swimmer.relation === 'child'}
                  onChange={(v) => actions.follow(id, v)}
                  label={swimmer.gender === 'F' ? 'Suivre cette nageuse' : 'Suivre ce nageur'}
                />
              </div>
            </div>
          </Section>

          <div className="section-foot profile-updated">
            <Icon name="sparkles" /> Fiche mise à jour automatiquement : résultats des compétitions
            {lastCheck ? ` vérifiés ${sinceLabel(lastCheck)}` : ' vérifiés à chaque ouverture'} (toutes les 3 h, toutes les 15 min pendant un week-end de
            compétition) ; historique et classements nationaux dès leur publication par le club.
          </div>

          {children}
        </div>
      </div>
    </>
  );
}

/** « à l'instant », « il y a 25 min », « il y a 3 h », « il y a 2 jours ». */
function sinceLabel(at: number): string {
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 2) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return `il y a ${d} jour${d > 1 ? 's' : ''}`;
}

