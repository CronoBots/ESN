import { useMemo, useState } from 'react';
import { actions, useData } from '../store/store';
import { fullName, swimsOf, usePbFlags } from '../store/hooks';
import { Avatar, Empty, NavBar, Row, Section, StrokeDot, StrokeTag, Toggle } from '../components/ui';
import { Icon } from '../components/Icon';
import { SwimRow } from '../components/SwimRow';
import { firstGroups, useProgressive } from '../components/progressive';
import { navigate } from '../router';
import { FollowButton, groupName, isFollowed } from './Club';
import { formatDate, formatRange, sportAge, seasonLabel, seasonOf, todayISO } from '../lib/dates';
import { swimrankingsUrl } from '../lib/swimrankings';
import { achievements, chronoCompare, pointsFor, swimmerSummary } from '../lib/stats';
import { STROKES, courseLabel, eventLabel } from '../lib/events';
import { formatTime } from '../lib/time';
import { LEVELS } from '../lib/levels';
import { rankLabel } from '../lib/rankings';
import { bestTimesTable, careerSpan, clubRecordsHeld, seasonsSummary, topRanks } from '../lib/profile';
import { upcomingClubEvents } from '../lib/clubCalendar';
import type { Course, Stroke, Swim } from '../store/types';
import { SwimmerMedals } from '../components/Medals';
import { LevelGoals, useLevelGoals } from '../components/Levels';
import { QualifyingGoals } from '../components/Qualifying';
import { DateBlock, TimelineMeetCard, useTimeline } from '../components/MeetTimeline';
import { ClubEventRow, useClubCalendar } from '../components/ClubCalendar';

export function SwimmerProfile({ id }: { id: string }) {
  const data = useData();
  const pbFlags = usePbFlags();
  const swimmer = data.swimmers.find((s) => s.id === id);
  const mine = swimsOf(data.swims, id);
  const trophies = useMemo(() => (swimmer ? achievements(mine, swimmer, data.meets, pbFlags) : []), [mine, swimmer, data.meets, pbFlags]);
  const meetsById = useMemo(() => new Map(data.meets.map((m) => [m.id, m])), [data.meets]);
  const summary = useMemo(() => (swimmer ? swimmerSummary(mine, swimmer, false, pbFlags) : null), [mine, swimmer, pbFlags]);
  const span = useMemo(() => careerSpan(mine), [mine]);
  const bests = useMemo(() => bestTimesTable(mine), [mine]);
  const held = useMemo(() => (swimmer?.member ? clubRecordsHeld(data.swims, data.swimmers, swimmer) : []), [data.swims, data.swimmers, swimmer]);
  const seasons = useMemo(() => (swimmer ? seasonsSummary(mine, swimmer, pbFlags) : []), [mine, swimmer, pbFlags]);
  const ranks = useMemo(() => topRanks(data.rankings, id), [data.rankings, id]);
  const { reached } = useLevelGoals(swimmer, mine, false);
  const timeline = useTimeline(swimmer);
  const cal = useClubCalendar();
  const today = todayISO();
  const nextMeet = useMemo(() => {
    const ids = new Set(mine.filter((s) => s.meetId).map((s) => s.meetId!));
    return data.meets.filter((m) => (m.endDate ?? m.startDate) >= today && ids.has(m.id)).sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0];
  }, [data.meets, mine, today]);
  const nextClub = !nextMeet && swimmer?.member && !swimmer.former ? upcomingClubEvents(cal, data.meets, today)[0] : undefined;

  if (!swimmer || !summary) {
    return (
      <>
        <NavBar title="Nageur" back large={false} />
        <main className="page">
          <Empty icon="person" title="Nageur introuvable" />
        </main>
      </>
    );
  }
  const age = sportAge(swimmer.birthYear);
  // Comme la liste ouverte par « Toutes les courses » : temps, forfaits et abandons (sans le programme à venir)
  const count = mine.filter((s) => s.timeCs != null || s.status !== 'OK').length;
  const isSelected = data.settings.selectedSwimmerId === id;
  const noneFollowed = !data.swimmers.some(isFollowed);
  const unlocked = trophies.filter((t) => t.unlocked).length;
  const lastMeet = [...timeline].reverse().find((e) => e.startDate <= today);
  const status = swimmer.former ? 'Ancien membre' : swimmer.member || swimmer.discovered ? 'Membre de l’ESN' : swimmer.club;
  const levelTotal = LEVELS.reduce((a, l) => a + reached[l], 0);
  const lastCheck = data.settings.liveSync.lastCheck;
  // Les pages Records, Progression… montrent le nageur choisi sur l'accueil
  const openFor = (path: string) => () => {
    actions.selectSwimmer(id);
    navigate(path);
  };

  return (
    <>
      <NavBar title={fullName(swimmer)} back large={false} right={<FollowButton swimmer={swimmer} />} />
      <main className="page">
        <div className="center" style={{ padding: '12px 0 4px' }}>
          <Avatar swimmer={swimmer} size={104} />
          <h1 className="profile-name">{fullName(swimmer)}</h1>
          <div className="muted" style={{ fontSize: 15 }}>
            {[age != null ? `${age} ans` : null, swimmer.birthYear ? `${swimmer.gender === 'F' ? 'née' : 'né'} en ${swimmer.birthYear}` : null, swimmer.gender === 'F' ? 'nageuse' : 'nageur']
              .filter(Boolean)
              .join('\u00a0· ')}
          </div>
          <div className="tl-badges" style={{ justifyContent: 'center', marginTop: 8 }}>
            {status && <span className={`badge${swimmer.former ? '' : ' first'}`}>{status}</span>}
            {swimmer.group && <span className="badge">{groupName(data.settings.club?.groups ?? [], swimmer.group)}</span>}
            {span.first && <span className="badge">{swimmer.member ? 'À l’ESN depuis' : 'En compétition depuis'} {span.first.date.slice(0, 4)}</span>}
          </div>
        </div>

        <Section title="En chiffres">
          <div className="tiles three">
            <div className="tile">
              <div className="tile-label">Compétitions</div>
              <div className="tile-value">{summary.meets}</div>
              <div className="tile-sub">{summary.races} courses</div>
            </div>
            <div className="tile">
              <div className="tile-label">Records perso</div>
              <div className="tile-value">{bests.reduce((a, r) => a + (r.scm ? 1 : 0) + (r.lcm ? 1 : 0), 0)}</div>
              <div className="tile-sub">épreuves × bassins</div>
            </div>
            <div className="tile">
              <div className="tile-label">Meilleurs points</div>
              <div className="tile-value">{summary.bestPoints?.points ?? '–'}</div>
              <div className="tile-sub">{summary.bestPoints ? eventLabel(summary.bestPoints.swim.distance, summary.bestPoints.swim.stroke) : 'World Aquatics'}</div>
            </div>
            {swimmer.member && (
              <div className="tile">
                <div className="tile-label">Records du club</div>
                <div className="tile-value">{held.length}</div>
                <div className="tile-sub">détenus aujourd’hui</div>
              </div>
            )}
            <div className="tile">
              <div className="tile-label">Niveaux FFBN</div>
              <div className="tile-value">{levelTotal}</div>
              <div className="tile-sub">{levelTotal ? LEVELS.filter((l) => reached[l]).map((l) => `${reached[l]} ${l}`).join(', ') : 'épreuves'}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Classement belge</div>
              <div className="tile-value">{ranks[0] ? rankLabel(ranks[0].rank) : '–'}</div>
              <div className="tile-sub">{ranks[0] ? `${eventLabel(ranks[0].distance, ranks[0].stroke)} · ${courseLabel(ranks[0].course)}` : 'meilleur rang'}</div>
            </div>
          </div>
          {span.last && (
            <div className="section-foot">
              Dernière course le {formatDate(span.last.date)}
              {span.last.meetId && meetsById.get(span.last.meetId) ? ` (${meetsById.get(span.last.meetId)!.name})` : ''}.
            </div>
          )}
        </Section>

        {(nextMeet || nextClub) && (
          <Section title="Prochaine compétition">
            <div className="list">
              {nextMeet ? (
                <button className="row" onClick={() => navigate(`/meet/${nextMeet.id}`)}>
                  <DateBlock iso={nextMeet.startDate} accent={nextMeet.startDate <= today} />
                  <div className="row-body">
                    <div className="row-title">{nextMeet.name}</div>
                    <div className="row-sub">{[formatRange(nextMeet.startDate, nextMeet.endDate), nextMeet.city, courseLabel(nextMeet.course)].filter(Boolean).join('\u00a0· ')}</div>
                  </div>
                  <Icon name="chevronRight" className="chev" />
                </button>
              ) : (
                <ClubEventRow ev={nextClub!} cal={cal!} />
              )}
            </div>
          </Section>
        )}

        {lastMeet && (
          <Section title="Dernière compétition" action={<button className="section-link" onClick={openFor('/meets')}>Toutes</button>}>
            <TimelineMeetCard entry={lastMeet} swimmer={swimmer} pbFlags={pbFlags} />
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

        <SwimmerMedals swimmer={swimmer} swims={mine} meetsById={meetsById} pbFlags={pbFlags} />

        {!swimmer.former && <LevelGoals swimmer={swimmer} swims={mine} includeTraining={false} />}

        {!swimmer.former && <QualifyingGoals swimmer={swimmer} swims={mine} />}

        {ranks.length > 0 && (
          <Section title="Classements nationaux" footer={`Meilleurs rangs de la saison ${ranks[0].season}, publiés sur swimrankings.net.`}>
            <div className="list">
              {ranks.map((r) => (
                <button key={`${r.course}-${r.distance}-${r.stroke}`} className="row" onClick={() => navigate(`/event/${id}/${r.course}/${r.distance}/${r.stroke}`)}>
                  <StrokeTag stroke={r.stroke} distance={r.distance} />
                  <div className="row-body">
                    <div className="row-title">
                      {eventLabel(r.distance, r.stroke)} · {courseLabel(r.course)}
                    </div>
                    <div className="row-sub">{r.label}</div>
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
            {(!isSelected || noneFollowed) && (
              <Row
                icon="home"
                title="Afficher sur l’accueil"
                chevron
                onClick={() => {
                  // Aucun nageur suivi : l'accueil afficherait « Quels nageurs suivre ? » ; ce nageur devient suivi
                  if (noneFollowed) actions.follow(id, true);
                  actions.selectSwimmer(id);
                  navigate('/');
                }}
              />
            )}
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
      </main>
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
