import { Fragment, useMemo, useState } from 'react';
import { useData } from '../store/store';
import { fullName, sortSwimmers, usePbFlags, useSelectedSwimmer } from '../store/hooks';
import { Avatar, Empty, NavBar, Row, Section, Segmented, StrokeTag } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate } from '../router';
import { formatDate, formatLongDay, formatRange, relativeDay, seasonLabel, seasonOf, todayISO } from '../lib/dates';
import { eventLabel, courseLabel, ROUND_LABEL } from '../lib/events';
import { formatDelta, formatTime } from '../lib/time';
import { chronoCompare, countsForRecords, isValidResult, pointsFor } from '../lib/stats';
import { buildMeetCalendar, downloadFile, slug } from '../lib/ics';
import type { Swim, Swimmer } from '../store/types';
import { overlay } from '../components/ui';
import { DateBlock, TimelineMeetCard, useTimeline } from '../components/MeetTimeline';
import { SwimmerChips } from './Records';
import { findResultsNow } from './autoResults';
import { capitalize, deName, placeLabel } from '../lib/text';


type Order = 'recent' | 'chrono';
const ORDER_KEY = 'nageo.meetsOrder';
function readOrder(): Order {
  try {
    return localStorage.getItem(ORDER_KEY) === 'chrono' ? 'chrono' : 'recent';
  } catch {
    return 'recent';
  }
}

export function Meets() {
  const data = useData();
  const pbFlags = usePbFlags();
  const swimmer = useSelectedSwimmer();
  const timeline = useTimeline(swimmer);
  const [order, setOrderState] = useState<Order>(readOrder);
  const setOrder = (o: Order) => {
    setOrderState(o);
    try {
      localStorage.setItem(ORDER_KEY, o);
    } catch {
      /* stockage indisponible : préférence non mémorisée */
    }
  };
  const today = todayISO();

  const entriesByMeet = useMemo(() => {
    const map = new Map<string, number>();
    if (swimmer)
      for (const s of data.swims) if (s.meetId && s.swimmerId === swimmer.id) map.set(s.meetId, (map.get(s.meetId) ?? 0) + 1);
    return map;
  }, [data.swims, swimmer]);

  const upcoming = data.meets
    .filter((m) => (m.endDate ?? m.startDate) >= today)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));

  // Chronologie par saison, dans l'ordre choisi
  const seasons = useMemo(() => {
    const list = timeline.filter((e) => e.startDate <= today);
    const sorted = order === 'chrono' ? list : [...list].reverse();
    const g = new Map<string, typeof list>();
    for (const e of sorted) {
      const k = seasonOf(e.startDate);
      g.set(k, [...(g.get(k) ?? []), e]);
    }
    return [...g.entries()];
  }, [timeline, order, today]);

  // Compétitions passées sans résultat du nageur sélectionné
  const others = useMemo(() => {
    const seen = new Set(timeline.map((e) => e.key));
    return data.meets
      .filter((m) => (m.endDate ?? m.startDate) < today && !seen.has(m.id))
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  }, [data.meets, timeline, today]);

  const pastCount = timeline.filter((e) => e.startDate <= today).length;
  // Autres compétitions du club : les 12 derniers mois d'abord, tout l'historique sur demande
  const [allOthers, setAllOthers] = useState(false);
  const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const recentOthers = others.filter((m) => m.startDate >= yearAgo);
  const shownOthers = allOthers || recentOthers.length === 0 ? others : recentOthers;

  return (
    <>
      <NavBar
        title="Compétitions"
        subtitle={
          swimmer && pastCount > 0
            ? `${pastCount} compétition${pastCount > 1 ? 's' : ''} nagée${pastCount > 1 ? 's' : ''} par ${swimmer.firstName}`
            : undefined
        }
      />
      <main className="page">
        {swimmer && <SwimmerChips swimmer={swimmer} />}

        {upcoming.length > 0 && (
          <Section title="À venir">
            <div className="list">
              {upcoming.map((m) => {
                const ongoing = m.startDate <= today;
                const n = entriesByMeet.get(m.id) ?? 0;
                return (
                  <button key={m.id} className="row" onClick={() => navigate(`/meet/${m.id}`)}>
                    <DateBlock iso={m.startDate} accent={ongoing} />
                    <div className="row-body">
                      <div className="row-title">{m.name}</div>
                      <div className="row-sub">
                        {[formatRange(m.startDate, m.endDate), m.city, courseLabel(m.course)].filter(Boolean).join(' · ')}
                      </div>
                      <div className="tl-badges">
                        <span className="badge first">{ongoing ? 'En cours' : capitalize(relativeDay(m.startDate))}</span>
                        {n > 0 && swimmer && (
                          <span className="badge">
                            {n} épreuve{n > 1 ? 's' : ''} au programme
                          </span>
                        )}
                      </div>
                    </div>
                    <Icon name="chevronRight" className="chev" />
                  </button>
                );
              })}
            </div>
          </Section>
        )}


        {seasons.length === 0 ? (
          <Section title={upcoming.length ? 'Résultats' : undefined}>
            <div className="card">
              <Empty
                icon="calendar"
                title="Aucun résultat de compétition"
                text={
                  swimmer
                    ? `Les compétitions ${deName(swimmer.firstName)} apparaissent ici, dans l’ordre, avec ses temps, ses places et ses records, dès que les résultats sont publiés.`
                    : 'Ajoutez un nageur pour suivre ses compétitions.'
                }
                action={
                  swimmer ? (
                    <button className="btn small" onClick={() => findResultsNow(swimmer.firstName)}>
                      <Icon name="sparkles" /> Rechercher ses résultats
                    </button>
                  ) : undefined
                }
              />
            </div>
          </Section>
        ) : (
          swimmer && (
            <Section
              title="Résultats"
            >
              <Segmented
                value={order}
                onChange={setOrder}
                ariaLabel="Ordre des compétitions"
                options={[
                  { id: 'recent', label: 'Récentes d’abord' },
                  { id: 'chrono', label: 'Ordre chronologique' },
                ]}
              />
              <div className="timeline" style={{ marginTop: 14 }}>
                {seasons.map(([season, entries]) => (
                  <Fragment key={season}>
                    <div className="tl-season">{seasonLabel(season)}</div>
                    {entries.map((e) => (
                      <div key={e.key} className={`tl-item${e.pbs > 0 ? ' pb' : ''}`}>
                        <TimelineMeetCard entry={e} swimmer={swimmer} pbFlags={pbFlags} />
                      </div>
                    ))}
                  </Fragment>
                ))}
              </div>
            </Section>
          )
        )}

        {others.length > 0 && (
          <Section title={swimmer ? 'Autres compétitions du club' : 'Compétitions passées'}>
            <div className="list">
              {shownOthers.map((m) => (
                <button key={m.id} className="row" onClick={() => navigate(`/meet/${m.id}`)}>
                  <DateBlock iso={m.startDate} />
                  <div className="row-body">
                    <div className="row-title">{m.name}</div>
                    <div className="row-sub">
                      {[formatRange(m.startDate, m.endDate), m.city, courseLabel(m.course)].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <Icon name="chevronRight" className="chev" />
                </button>
              ))}
            </div>
            {shownOthers.length < others.length && (
              <button className="btn ghost block" style={{ marginTop: 10 }} onClick={() => setAllOthers(true)}>
                Voir les {others.length - shownOthers.length} compétitions plus anciennes
              </button>
            )}
            {swimmer && <div className="section-foot">Compétitions où d’autres nageurs de l’ESN ont nagé.</div>}
          </Section>
        )}

        {data.meets.length === 0 && seasons.length === 0 && (
          <div className="section-foot" style={{ marginTop: 12 }}>
            Les compétitions apparaissent toutes seules : programme dès la publication des listes de départ, puis résultats.
          </div>
        )}
      </main>
    </>
  );
}

/* ======================================================================== */
/* Détail d'une compétition                                                   */
/* ======================================================================== */

export function MeetDetail({ id }: { id: string }) {
  const data = useData();
  const pbFlags = usePbFlags();
  const meet = data.meets.find((m) => m.id === id);
  const swims = useMemo(() => data.swims.filter((s) => s.meetId === id).sort(chronoCompare), [data.swims, id]);
  const swimmers = sortSwimmers(data.swimmers);
  const include = data.settings.includeTraining;
  // Navigation chronologique : compétition précédente / suivante du nageur
  const selected = useSelectedSwimmer();
  const focus = swims.some((s) => s.swimmerId === selected?.id)
    ? selected
    : (swimmers.find((w) => swims.some((s) => s.swimmerId === w.id)) ?? selected);
  const timeline = useTimeline(focus);

  if (!meet) {
    return (
      <>
        <NavBar title="Compétition" back="/meets" large={false} />
        <main className="page">
          <Empty icon="calendar" title="Compétition introuvable" />
        </main>
      </>
    );
  }

  const today = todayISO();
  const isPast = (meet.endDate ?? meet.startDate) < today;
  const bySwimmer = swimmers
    .map((sw) => ({
      swimmer: sw,
      swims: swims.filter((s) => s.swimmerId === sw.id),
    }))
    .filter((g) => g.swims.length)
    // Le nageur choisi en premier, puis les nageurs suivis, puis les autres (ordre de sortSwimmers)
    .sort((a, b) => Number(b.swimmer.id === focus?.id) - Number(a.swimmer.id === focus?.id));
  const followedIds = new Set(swimmers.filter((w) => w.favorite || w.relation === 'child').map((w) => w.id));
  const mineGroups = bySwimmer.filter((g) => g.swimmer.id === focus?.id || followedIds.has(g.swimmer.id));
  const otherGroups = bySwimmer.filter((g) => !mineGroups.includes(g));
  const pbs = swims.filter((s) => pbFlags.get(s.id)?.isPB);
  const totalGain = pbs.reduce((a, s) => a + -(pbFlags.get(s.id)?.deltaCs ?? 0), 0);
  const swum = swims.filter(isValidResult);

  const renderGroup = ({ swimmer, swims: list }: { swimmer: Swimmer; swims: Swim[] }) => {
      const days = new Map<string, Swim[]>();
      for (const s of list) days.set(s.date, [...(days.get(s.date) ?? []), s]);
      return (
        <Section
          key={swimmer.id}
          title={
            <span className="hstack" style={{ gap: 10 }}>
              <Avatar swimmer={swimmer} size={30} />
              {bySwimmer.length > 1
                ? fullName(swimmer)
                : isPast || list.some((x) => x.timeCs != null)
                  ? 'Résultats'
                  : 'Programme'}
            </span>
          }
        >
          <div className="list">
            {[...days.entries()].map(([day, ds]) => (
              <div key={day}>
                <div className="group-head">{capitalize(formatLongDay(day))}</div>
                {ds.map((s) => {
                  const pb = pbFlags.get(s.id);
                  const prev = bestOf(swimmer.id, s);
                  // Ligne 1 : quand et où nager ; ligne 2 : le classement
                  const sub = [
                    s.startTime,
                    s.heat ? `Série\u00a0${s.heat}` : null,
                    s.lane != null ? `Ligne\u00a0${s.lane}` : null,
                    s.round !== 'TIM' ? ROUND_LABEL[s.round] : null,
                  ].filter(Boolean);
                  const rank = s.place ? placeLabel(s.place) : null;
                  return (
                    <button
                      key={s.id}
                      className="row"
                      onClick={() => navigate(`/swim/${s.id}`)}
                    >
                      <StrokeTag stroke={s.stroke} distance={s.distance} size={36} />
                      <div className="row-body">
                        <div className="row-title">
                          {s.eventNo ? `${s.eventNo}. ` : ''}
                          {eventLabel(s.distance, s.stroke)}
                        </div>
                        <div className="row-sub">{sub.join(' · ') || (rank ? null : formatDate(s.date))}</div>
                        {rank && <div className="row-sub">{rank}</div>}
                      </div>
                      <div className="row-end">
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-end',
                            gap: 3,
                          }}
                        >
                          {s.timeCs != null || s.status !== 'OK' ? (
                            <>
                              <span className="time-big">
                                {s.status === 'OK' || s.status === 'DSQ' ? formatTime(s.timeCs) : ''}
                              </span>
                              <span className="hstack" style={{ gap: 4 }}>
                                {s.status !== 'OK' ? (
                                  <span className="badge bad">{s.status}</span>
                                ) : pb?.isPB ? (
                                  <>
                                    <span className="badge pb">PB</span>
                                    <span className="small good tnum" style={{ fontWeight: 600 }}>
                                      {formatDelta(pb.deltaCs!)}
                                    </span>
                                  </>
                                ) : pb?.isFirst ? (
                                  <span className="badge first">1er temps</span>
                                ) : pb?.deltaCs != null ? (
                                  <span className="small muted tnum">{formatDelta(pb.deltaCs)}</span>
                                ) : null}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="time-big muted">{s.entryCs ? formatTime(s.entryCs) : 'NT'}</span>
                              {prev != null ? (
                                <span className="hstack small muted tnum" style={{ gap: 4 }}>
                                  <span className="badge">PB</span>
                                  {formatTime(prev)}
                                </span>
                              ) : null}
                            </>
                          )}
                        </div>
                        <Icon name="chevronRight" className="chev" />
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </Section>
      );
  };

  const bestOf = (swimmerId: string, s: Swim) => {
    const list = data.swims.filter(
      (x) =>
        x.swimmerId === swimmerId &&
        x.id !== s.id &&
        x.course === s.course &&
        x.distance === s.distance &&
        x.stroke === s.stroke &&
        countsForRecords(x, include) &&
        x.date <= s.date,
    );
    return list.length ? Math.min(...list.map((x) => x.timeCs!)) : null;
  };

  return (
    <>
      <NavBar
        title={meet.name}
        subtitle={`${formatRange(meet.startDate, meet.endDate)}${meet.city ? ` · ${meet.city}` : ''}`}
        back="/meets"
      />
      <main className="page">
        <div className="list">
          {swims.length > 0 && !isPast && (
            <Row
              icon="bell"
              iconBg="#ff9f0a"
              title="Ajouter au calendrier"
              sub="Rappel 30 min avant chaque course"
              chevron
              onClick={() => {
                downloadFile(`${slug(meet.name)}.ics`, buildMeetCalendar(meet, swims, data.swimmers), 'text/calendar');
                overlay.toast('Calendrier exporté', '📅');
              }}
            />
          )}
        </div>

        {swum.length > 0 && (
          <div className="tiles four" style={{ marginTop: 14 }}>
            <div className="tile">
              <div className="tile-label">Courses</div>
              <div className="tile-value">{swum.length}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Records</div>
              <div className="tile-value gold">{pbs.length}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Temps gagné</div>
              <div className="tile-value good tnum">{totalGain > 0 ? formatTime(totalGain) : '—'}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Meilleurs pts</div>
              <div className="tile-value">
                {Math.max(
                  0,
                  ...swum.map(
                    (s) =>
                      pointsFor(
                        s,
                        data.swimmers.find((w) => w.id === s.swimmerId),
                      ) ?? 0,
                  ),
                ) || '—'}
              </div>
            </div>
          </div>
        )}

        {bySwimmer.length === 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <Empty
              icon="flag"
              title={isPast ? 'Pas encore de résultat' : 'Programme vide'}
              text={
                isPast
                  ? 'Les résultats sont ajoutés automatiquement dès leur publication par l’organisateur.'
                  : 'Le programme (épreuves, séries, lignes, heures) apparaît tout seul dès que l’organisateur publie les listes de départ.'
              }
            />
          </div>
        )}

        {mineGroups.map(renderGroup)}

        {(() => {
          const i = timeline.findIndex((e) => e.key === meet.id);
          if (i < 0 || timeline.length < 2) return null;
          const prev = timeline[i - 1];
          const next = timeline[i + 1];
          return (
            <Section title={focus ? `Parcours ${deName(focus.firstName)}` : undefined}>
              <div className="meet-nav">
                {prev ? (
                  <button
                    className="meet-nav-btn"
                    disabled={!prev.meet}
                    onClick={() => navigate(`/meet/${prev.key}`, { replace: true })}
                  >
                    <span className="small muted">← Précédente</span>
                    <span className="meet-nav-name">{prev.name}</span>
                    <span className="small muted">{formatDate(prev.startDate)}</span>
                  </button>
                ) : (
                  <span className="meet-nav-btn empty">Première compétition suivie</span>
                )}
                {next ? (
                  <button
                    className="meet-nav-btn r"
                    disabled={!next.meet}
                    onClick={() => navigate(`/meet/${next.key}`, { replace: true })}
                  >
                    <span className="small muted">Suivante →</span>
                    <span className="meet-nav-name">{next.name}</span>
                    <span className="small muted">{formatDate(next.startDate)}</span>
                  </button>
                ) : (
                  <span className="meet-nav-btn r empty">Dernière compétition</span>
                )}
              </div>
              {timeline[i].trend != null && (
                <div className="section-foot">
                  Meilleure performance : {timeline[i].best!.points} pts ({timeline[i].trend! >= 0 ? '+' : '−'}
                  {Math.abs(timeline[i].trend!)} pts par rapport à la compétition précédente).
                </div>
              )}
            </Section>
          );
        })()}

        {otherGroups.length > 0 && (
          <>
            {mineGroups.length > 0 && <div className="group-title">Les autres nageurs de l’ESN · {otherGroups.length}</div>}
            {otherGroups.map(renderGroup)}
          </>
        )}


        <Section title="Infos">
          <div className="list">
            <Row title="Date" value={formatRange(meet.startDate, meet.endDate)} />
            <Row title="Bassin" value={courseLabel(meet.course)} />
            {meet.city && <Row title="Localité" value={[meet.city, meet.nation].filter(Boolean).join(' · ')} />}
            {meet.organizer && <Row title="Organisateur" value={meet.organizer} />}
            {meet.city && (
              <Row
                title="Itinéraire"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`piscine ${meet.city}`)}`}
                external
              />
            )}
          </div>
          {meet.notes && (
            <div className="card pad" style={{ marginTop: 10, whiteSpace: 'pre-wrap', fontSize: 15 }}>
              {meet.notes}
            </div>
          )}
        </Section>
      </main>
    </>
  );
}
