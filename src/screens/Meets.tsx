import { Fragment, useMemo, useState } from 'react';
import { useData } from '../store/store';
import { fullName, sortSwimmers, swimsOf, usePbFlags, useSelectedSwimmer } from '../store/hooks';
import { PbDelta, PlaceLabel, Avatar, Empty, NavBar, Row, Section, Segmented, StrokeTag } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate } from '../router';
import { todayISO, formatDate, formatRange, swimDate, swimLongDay, swimDayKey, relativeDay, seasonOf, seasonLabel } from '../lib/dates';
import { eventLabel, courseLabel, ROUND_LABEL, STATUS_SHORT } from '../lib/events';
import { formatDelta, formatTime } from '../lib/time';
import { chronoCompare, clubMeets, countsForRecords, isValidResult } from '../lib/stats';
import { buildMeetCalendar, downloadFile, slug } from '../lib/ics';
import type { Meet, Swim, Swimmer } from '../store/types';
import { overlay } from '../components/ui';
import { DateBlock, TimelineMeetCard, useTimeline } from '../components/MeetTimeline';
import { SwimmerChips } from './Records';
import { findResultsNow } from './autoResults';
import { capitalize, deName } from '../lib/text';
import { ClubEventRow, GroupsBadge, useClubCalendar } from '../components/ClubCalendar';
import { MeetOverviewSections, type OverviewSections } from '../components/MeetOverview';
import { ClubMeetRecap } from '../components/MeetRecap';
import { meetSummaries } from '../lib/meetRecap';
import { publishedMeet, upcomingClubEvents, type ClubEvent } from '../lib/clubCalendar';


type Order = 'recent' | 'chrono';
const ORDER_KEY = 'nageo.meetsOrder';
function readOrder(): Order {
  try {
    return localStorage.getItem(ORDER_KEY) === 'chrono' ? 'chrono' : 'recent';
  } catch {
    return 'recent';
  }
}

const MEETS_VIEW = 'esn-competitions-vue';

export function Meets() {
  const data = useData();
  const pbFlags = usePbFlags();
  const swimmer = useSelectedSwimmer();
  // Deux espaces : toutes les compétitions du club (bilan de l'ESN), ou celles de mes nageurs
  const [view, setViewState] = useState<'club' | 'mine'>(() => {
    try {
      return localStorage.getItem(MEETS_VIEW) === 'mine' ? 'mine' : 'club';
    } catch {
      return 'club';
    }
  });
  const setView = (v: 'club' | 'mine') => {
    setViewState(v);
    try {
      localStorage.setItem(MEETS_VIEW, v);
    } catch {
      /* préférence non mémorisée */
    }
  };
  const clubView = view === 'club';
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
      for (const s of swimsOf(data.swims, swimmer.id)) if (s.meetId) map.set(s.meetId, (map.get(s.meetId) ?? 0) + 1);
    return map;
  }, [data.swims, swimmer]);

  // Nageurs de l'ESN engagés à chaque compétition (vue du club)
  const engagedByMeet = useMemo(() => {
    const members = new Set(data.swimmers.filter((s) => s.member && !s.former).map((s) => s.id));
    const sets = new Map<string, Set<string>>();
    for (const s of data.swims) if (s.meetId && members.has(s.swimmerId)) sets.set(s.meetId, (sets.get(s.meetId) ?? new Set()).add(s.swimmerId));
    return new Map([...sets].map(([id, set]) => [id, set.size]));
  }, [data.swims, data.swimmers]);

  // Compétitions où au moins un membre actuel de l'ESN a nagé ou est inscrit. Celles des seuls anciens
  // membres (souvent déjà dans un autre club) restent sur leur fiche, pas dans ces listes.
  const clubMeetIds = useMemo(() => clubMeets(data.swims, data.swimmers), [data.swims, data.swimmers]);

  const upcoming = data.meets
    .filter((m) => (m.endDate ?? m.startDate) >= today && clubMeetIds.has(m.id))
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  // Calendrier du club : les compétitions annoncées, avant que l'organisateur publie le programme
  const cal = useClubCalendar();
  const calEvents = useMemo(() => upcomingClubEvents(cal, data.meets, today), [cal, data.meets, today]);
  const comingUp: ({ meet: Meet } | { ev: ClubEvent })[] = [...upcoming.map((meet) => ({ meet })), ...calEvents.map((ev) => ({ ev }))].sort((a, b) =>
    ('meet' in a ? a.meet.startDate : a.ev.start) < ('meet' in b ? b.meet.startDate : b.ev.start) ? -1 : 1,
  );

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
      .filter((m) => (m.endDate ?? m.startDate) < today && !seen.has(m.id) && clubMeetIds.has(m.id))
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  }, [data.meets, timeline, today, clubMeetIds]);

  // Compétitions vraiment nagées : au moins un temps valide (pas seulement des forfaits), comme sur l'accueil
  const pastCount = timeline.filter((e) => e.startDate <= today && e.swims.some(isValidResult)).length;
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
          clubView
            ? 'Calendrier et résultats de l’ESN'
            : swimmer && pastCount > 0
            ? `${pastCount} compétition${pastCount > 1 ? 's' : ''} nagée${pastCount > 1 ? 's' : ''} par ${swimmer.firstName}`
            : undefined
        }
      />
      <main className="page">
        <div style={{ marginBottom: 14 }}>
            <Segmented
              value={view}
              onChange={setView}
              ariaLabel="Compétitions affichées"
              options={[
                { id: 'club', label: 'Tout le club' },
                { id: 'mine', label: 'Mes nageurs' },
              ]}
            />
        </div>
        {swimmer && !clubView && <SwimmerChips swimmer={swimmer} />}

        {comingUp.length > 0 && (
          <Section title="À venir">
            <div className="list">
              {comingUp.map((item) => {
                if ('ev' in item) return <ClubEventRow key={`cal-${item.ev.start}-${item.ev.city}`} ev={item.ev} cal={cal!} />;
                const m = item.meet;
                const ongoing = m.startDate <= today;
                const n = entriesByMeet.get(m.id) ?? 0;
                const planned = cal?.events.find((e) => publishedMeet(e, [m]));
                return (
                  <button key={m.id} className="row" onClick={() => navigate(`/meet/${m.id}`)}>
                    <DateBlock iso={m.startDate} accent={ongoing} />
                    <div className="row-body">
                      <div className="row-title">{m.name}</div>
                      <div className="row-sub">
                        {[formatRange(m.startDate, m.endDate), m.city, courseLabel(m.course)].filter(Boolean).join('\u00a0· ')}
                      </div>
                      <div className="tl-badges">
                        <span className="badge first">{ongoing ? 'En cours' : capitalize(relativeDay(m.startDate))}</span>
                        {clubView
                          ? (engagedByMeet.get(m.id) ?? 0) > 0 && (
                              <span className="badge">
                                {engagedByMeet.get(m.id)} nageur{(engagedByMeet.get(m.id) ?? 0) > 1 ? 's' : ''} de l’ESN
                              </span>
                            )
                          : n > 0 &&
                            swimmer && (
                              <span className="badge">
                                {n} épreuve{n > 1 ? 's' : ''} au programme
                              </span>
                            )}
                        {planned && planned.groups.length > 0 && <GroupsBadge groups={planned.groups} names={cal!.groupNames} />}
                      </div>
                    </div>
                    <Icon name="chevronRight" className="chev" />
                  </button>
                );
              })}
            </div>
            {cal && calEvents.length > 0 && (
              <div className="section-foot">
                Annoncées par le calendrier du club (version du {formatDate(cal.version)}, jusqu’au {formatDate(cal.until)}). Le programme de
                chaque nageur s’affiche dès la publication des listes de départ.
              </div>
            )}
          </Section>
        )}


        {clubView ? (
          <ClubPastMeets clubMeetIds={clubMeetIds} />
        ) : (
          <>
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
                      {[formatRange(m.startDate, m.endDate), m.city, courseLabel(m.course)].filter(Boolean).join('\u00a0· ')}
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
            <div className="section-foot">
              Compétitions où {swimmer ? 'd’autres membres' : 'des membres'} de l’ESN ont nagé. Celles des anciens membres restent sur leur fiche.
            </div>
          </Section>
        )}

          </>
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

/** Vue du club : toutes les compétitions passées de l'ESN par saison, avec leur bilan en une ligne. */
function ClubPastMeets({ clubMeetIds }: { clubMeetIds: Set<string> }) {
  const data = useData();
  const pbFlags = usePbFlags();
  const today = todayISO();
  const [all, setAll] = useState(false);
  const summaries = useMemo(() => meetSummaries(data.swims, data.swimmers, pbFlags), [data.swims, data.swimmers, pbFlags]);
  const past = useMemo(
    () =>
      data.meets
        .filter((m) => m.startDate <= today && clubMeetIds.has(m.id) && (summaries.get(m.id)?.swum ?? 0) > 0)
        .sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
    [data.meets, clubMeetIds, summaries, today],
  );
  const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const recent = past.filter((m) => m.startDate >= yearAgo);
  const shown = all || recent.length === 0 ? past : recent;
  const seasons = new Map<string, Meet[]>();
  for (const m of shown) seasons.set(seasonOf(m.startDate), [...(seasons.get(seasonOf(m.startDate)) ?? []), m]);
  const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`;
  if (!past.length) return null;
  return (
    <Section title="Résultats du club">
      {[...seasons.entries()].map(([season, meets]) => (
        <Fragment key={season}>
          <div className="group-head">{seasonLabel(season)}</div>
          <div className="list">
            {meets.map((m) => {
              const r = summaries.get(m.id)!;
              return (
                <button key={m.id} className="row" onClick={() => navigate(`/meet/${m.id}`)}>
                  <DateBlock iso={m.startDate} accent={(m.endDate ?? m.startDate) >= today} />
                  <div className="row-body">
                    <div className="row-title">{m.name}</div>
                    <div className="row-sub">{[formatRange(m.startDate, m.endDate), m.city, courseLabel(m.course)].filter(Boolean).join('\u00a0· ')}</div>
                    <div className="row-sub">
                      {[plural(r.swimmers, 'nageur'), plural(r.swum, 'course'), r.pbs ? `${plural(r.pbs, 'record')} perso` : null, r.podiums ? plural(r.podiums, 'podium') : null]
                        .filter(Boolean)
                        .join('\u00a0· ')}
                    </div>
                  </div>
                  <Icon name="chevronRight" className="chev" />
                </button>
              );
            })}
          </div>
        </Fragment>
      ))}
      {shown.length < past.length && (
        <button className="btn ghost block" style={{ marginTop: 10 }} onClick={() => setAll(true)}>
          Voir les {past.length - shown.length} compétitions plus anciennes
        </button>
      )}
      <div className="section-foot">Compétitions des nageurs actuels de l’ESN, avec le bilan du club : touchez-en une pour le récap complet.</div>
    </Section>
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
  // Navigation chronologique : compétition précédente / suivante du nageur.
  // Le nageur choisi s'il a nagé, sinon un nageur suivi (enfant ou favori) ; jamais un nageur quelconque.
  const selected = useSelectedSwimmer();
  const focus = swims.some((s) => s.swimmerId === selected?.id)
    ? selected
    : swimmers.find((w) => (w.favorite || w.relation === 'child') && swims.some((s) => s.swimmerId === w.id));
  const timeline = useTimeline(focus);
  // Sections de la vue d'ensemble officielle (médailles, programme), pour les raccourcis en haut de page
  const [overview, setOverview] = useState<OverviewSections>(null);

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
  // Courses des nageurs suivis (ou du nageur choisi) : agenda et tuiles. Sans nageur suivi, les tuiles
  // portent sur tout le club (titrées comme telles) et l'agenda ne reçoit que les dates, sans alarme.
  const mine = mineGroups.flatMap((g) => g.swims);

  /** Aller à une partie de la page (défilement doux seulement sur une courte distance). */
  const jumpTo = (target: string) => {
    const el = document.getElementById(target);
    if (!el) return;
    const far = Math.abs(el.getBoundingClientRect().top) > 2 * window.innerHeight;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: far || reduce ? 'auto' : 'smooth', block: 'start' });
  };

  const renderGroup = ({ swimmer, swims: list }: { swimmer: Swimmer; swims: Swim[] }) => {
      const days = new Map<string, Swim[]>();
      for (const s of list) days.set(swimDayKey(s), [...(days.get(swimDayKey(s)) ?? []), s]);
      return (
        <Section
          key={swimmer.id}
          id={`meet-sw-${swimmer.id}`}
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
          action={
            <button className="section-link" onClick={() => navigate(`/swimmer/${swimmer.id}`)} aria-label={`Fiche de ${fullName(swimmer)}`}>
              Fiche
            </button>
          }
        >
          <div className="list">
            {[...days.entries()].map(([day, ds]) => (
              <div key={day}>
                <div className="group-head">{swimLongDay(ds[0])}</div>
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
                  const rank = s.place ? <PlaceLabel place={s.place} round={s.round} /> : null;
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
                        <div className="row-sub">{sub.join('\u00a0· ') || (rank ? null : swimDate(s))}</div>
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
                                  <span className="badge bad">{STATUS_SHORT[s.status]}</span>
                                ) : pb?.isPB ? (
                                  <>
                                    <span className="badge pb">PB</span>
                                    <PbDelta deltaCs={pb.deltaCs!} timeCs={s.timeCs} />
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
              sub={mine.some((s) => s.startTime) ? 'Rappel 30 min avant chaque course' : 'Dates de la compétition'}
              chevron
              onClick={() => {
                downloadFile(`${slug(meet.name)}.ics`, buildMeetCalendar(meet, mine, data.swimmers), 'text/calendar');
                overlay.toast('Calendrier exporté', '📅');
              }}
            />
          )}
        </div>

        {/* Récap du club : chiffres de tous les nageurs de l'ESN, records, limites, finales, puis une ligne par nageur */}
        <ClubMeetRecap meet={meet} onJump={(id) => jumpTo(`meet-sw-${id}`)} />

        {/* Page longue (tous les nageurs de l'ESN, puis la compétition) : raccourcis vers chaque partie */}
        {(bySwimmer.length > 2 || overview) && (
          <nav className="chips jump-chips" aria-label="Aller à">
            {[
              bySwimmer.length > 0 ? ['meet-swimmers', `Nageurs · ${bySwimmer.length}`] : null,
              overview ? ['meet-figures', 'En chiffres'] : null,
              overview?.medals ? ['meet-medals', 'Médailles'] : null,
              overview?.program ? ['meet-program', 'Programme'] : null,
              ['meet-infos', 'Infos'],
            ]
              .filter((x): x is string[] => !!x)
              .map(([target, label]) => (
                <button key={target} className="chip" onClick={() => jumpTo(target)}>
                  {label}
                </button>
              ))}
          </nav>
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

        <div id="meet-swimmers" className="anchor" />
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


        {/* Vue d'ensemble publiée en direct : chiffres, médailles par club, programme */}
        <MeetOverviewSections meet={meet} onSections={setOverview} />

        <Section title="Infos" id="meet-infos">
          <div className="list">
            <Row title="Date" value={formatRange(meet.startDate, meet.endDate)} />
            <Row title="Bassin" value={courseLabel(meet.course)} />
            {meet.city && <Row title="Localité" value={[meet.city, meet.nation].filter(Boolean).join('\u00a0· ')} />}
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
