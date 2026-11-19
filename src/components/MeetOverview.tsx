import { useEffect, useMemo, useState } from 'react';
import { CLUB } from '../club';
import type { Meet } from '../store/types';
import { fetchLiveResults, isMirrored, isSettled, loadEventSheet } from '../lib/liveResults';
import type { MeetEvent, MeetOverview } from '../lib/lenex';
import { medalTable, meetEventLabel } from '../lib/meetOverview';
import { overallRanking, type EventSheet, type SheetRow } from '../lib/heatSheet';
import { addDays, formatLongDay, todayISO } from '../lib/dates';
import { ROUND_LABEL } from '../lib/events';
import { formatTime } from '../lib/time';
import { capitalize } from '../lib/text';
import { overlay, Section, Segmented, SheetLayout } from './ui';
import { Icon } from './Icon';
import { displayName, fullYear, statusLabel } from './HeatPanel';

/*
 * Page d'une compétition : la vue d'ensemble que donnent les applications de résultats (SplashMe),
 * lue dans le même fichier officiel (live.swimrankings.net) : chiffres, médailles par club, programme
 * et classement de chaque épreuve. Rien à saisir : tout vient des résultats publiés.
 */

const isEsn = (club?: string) => CLUB.match.test(club ?? '');

function useOverview(meet: Meet) {
  const today = todayISO();
  const live = today >= addDays(meet.startDate, -1) && today <= (meet.endDate ?? meet.startDate);
  const settled = isSettled(meet.endDate ?? meet.startDate, today);
  const [state, setState] = useState<{ overview: MeetOverview | null; at: number } | undefined>(undefined);
  useEffect(() => {
    if (!meet.liveId) return;
    let alive = true;
    const load = () =>
      fetchLiveResults(meet.liveId!, live, settled)
        .then((l) => alive && setState({ overview: l?.overview ?? null, at: Date.now() }))
        .catch(() => alive && setState((s) => s ?? { overview: null, at: Date.now() }));
    load();
    // Pendant la compétition : relu toutes les 5 minutes
    const timer = live ? setInterval(load, 300000) : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [meet.liveId, live, settled]);
  return { ...state, live, settled };
}

const dash = (n: number) => (n ? String(n) : '–');

/** Chiffres, médailles par club et programme d'une compétition publiée en direct. */
export function MeetOverviewSections({ meet }: { meet: Meet }) {
  const { overview, at, live, settled } = useOverview(meet);
  const [allClubs, setAllClubs] = useState(false);
  const table = useMemo(() => (overview ? medalTable(overview) : []), [overview]);
  const sessions = useMemo(() => {
    const out: { key: string; date?: string; time?: string; events: MeetEvent[] }[] = [];
    for (const e of overview?.events ?? []) {
      // Une séance (réunion) du fichier : son jour et son heure de début, comme sur le programme officiel
      const key = `${e.date ?? ''} ${e.session ?? e.sessionTime ?? ''}`;
      const last = out[out.length - 1];
      if (last && last.key === key) last.events.push(e);
      else out.push({ key, date: e.date, time: e.sessionTime ?? e.time, events: [e] });
    }
    return out;
  }, [overview]);
  if (!meet.liveId || !overview) return null;

  const esnIndex = table.findIndex((c) => isEsn(c.club));
  const shown = allClubs ? table : table.filter((_, i) => i < 6 || i === esnIndex);
  const updated = at ? new Date(at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <>
      <Section title="La compétition en chiffres">
        <div className="tiles three">
          <div className="tile">
            <div className="tile-label">Nageurs</div>
            <div className="tile-value">{overview.athletes}</div>
            <div className="tile-sub">au total</div>
          </div>
          <div className="tile">
            <div className="tile-label">Clubs</div>
            <div className="tile-value">{overview.clubs}</div>
            <div className="tile-sub">engagés</div>
          </div>
          <div className="tile">
            <div className="tile-label">Courses</div>
            <div className="tile-value">{overview.entries}</div>
            <div className="tile-sub">{overview.relayEntries ? `+ ${overview.relayEntries} relais` : 'individuelles'}</div>
          </div>
        </div>
        <div className="section-foot">
          {overview.organizer ? `Organisation : ${overview.organizer}. ` : ''}Résultats officiels publiés sur{' '}
          {isMirrored(meet.liveId) ? 'le livetiming de l’organisateur' : 'live.swimrankings.net'}
          {live ? `, relus toutes les 5 minutes (dernière lecture à ${updated})` : settled ? ', définitifs' : ''}.
        </div>
      </Section>

      {table.length > 0 && (
        <Section title="Médailles par club" action={esnIndex >= 0 ? <span className="muted small">ESN : {esnIndex + 1}e</span> : undefined}>
          <div className="card medal-table" role="table" aria-label="Médailles par club">
            <div className="mt-head" role="row">
              <span role="columnheader">Club</span>
              <span role="columnheader" aria-label="Or">
                <span className="medal-dot gold" />
              </span>
              <span role="columnheader" aria-label="Argent">
                <span className="medal-dot silver" />
              </span>
              <span role="columnheader" aria-label="Bronze">
                <span className="medal-dot bronze" />
              </span>
            </div>
            {shown.map((c) => {
              const rank = table.indexOf(c) + 1;
              return (
                <div key={c.club} className={`mt-row${isEsn(c.club) ? ' mine' : ''}`} role="row">
                  <span className="mt-club" role="cell">
                    <b className="tnum">{rank}</b>
                    <span>
                      <span className="mt-name">{c.club.replace(/\s+a\.?s\.?b\.?l\.?$/i, '')}</span>
                      <small>
                        Garçons {c.men.join(' · ')} · Filles {c.women.join(' · ')}
                      </small>
                    </span>
                  </span>
                  {c.total.map((n, i) => (
                    <span key={i} className="mt-n tnum" role="cell">
                      {dash(n)}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
          {table.length > shown.length && (
            <button className="btn ghost block" style={{ marginTop: 10 }} onClick={() => setAllClubs(true)}>
              Voir les {table.length} clubs
            </button>
          )}
          <div className="section-foot">Une médaille par place de 1 à 3 de chaque classement par catégorie d’âge, comme sur les feuilles officielles.</div>
        </Section>
      )}

      {sessions.length > 0 && (
        <Section title={`Programme · ${overview.events.length} épreuves`}>
          {sessions.map((s) => (
            <div key={s.key} className="program-session">
              <div className="group-head">
                {s.date ? capitalize(formatLongDay(s.date)) : 'Programme'}
                {s.time ? ` · ${s.time}` : ''}
              </div>
              <div className="list">
                {s.events.map((e, i) => (
                  <button key={`${e.no ?? i}`} className="row program-row" onClick={() => openMeetEvent(meet, e, live, settled)} disabled={!e.no}>
                    <span className="lane tnum">{e.no ?? '–'}</span>
                    <div className="row-body">
                      <div className="row-title">{meetEventLabel(e)}</div>
                      <div className="row-sub">
                        {ROUND_LABEL[e.round]}
                        {e.time ? ` · ${e.time}` : ''}
                      </div>
                    </div>
                    <Icon name="chevronRight" className="chev" />
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="section-foot">Touchez une épreuve pour ses séries et son classement ; les nageurs de l’ESN sont mis en évidence.</div>
        </Section>
      )}
    </>
  );
}

function EventSheetBody({ meet, ev, live, settled }: { meet: Meet; ev: MeetEvent; live: boolean; settled: boolean }) {
  const [sheet, setSheet] = useState<EventSheet | null | undefined>(undefined);
  const [view, setView] = useState<'overall' | 'category'>('overall');
  useEffect(() => {
    let alive = true;
    loadEventSheet(meet.liveId!, ev.no!, live, settled)
      .then((s) => alive && setSheet(s))
      .catch(() => alive && setSheet(null));
    return () => {
      alive = false;
    };
  }, [meet.liveId, ev.no, live, settled]);
  if (sheet === undefined) return <div className="section-foot center">Chargement…</div>;
  if (!sheet || (!sheet.results.length && !sheet.heats.length))
    return <div className="section-foot center">Pas encore de séries ni de classement publiés pour cette épreuve.</div>;
  const groups = sheet.results;
  const overall = overallRanking(groups);
  const row = (r: SheetRow, lead: string | number, extra?: string) => (
    <div className={`row heat-row${isEsn(r.club) ? ' mine' : ''}`}>
      <span className="lane tnum">{lead}</span>
      <div className="row-body">
        <div className="row-title">{displayName(r.name)}</div>
        <div className="row-sub">{[r.club, fullYear(r.yy), extra].filter(Boolean).join(' · ')}</div>
      </div>
      <span className="row-end heat-end">
        <span className="tnum heat-time">{r.timeCs != null && r.status === 'OK' ? formatTime(r.timeCs) : r.status !== 'OK' ? statusLabel(r) : r.entryCs ? formatTime(r.entryCs) : 'NT'}</span>
        {r.points != null && <span className="heat-pts tnum">{r.points} pts</span>}
      </span>
    </div>
  );
  if (groups.length) {
    return (
      <>
        {groups.length > 1 && (
          <div className="heat-switch">
            <Segmented
              value={view}
              onChange={setView}
              ariaLabel="Classement affiché"
              options={[
                { id: 'overall', label: 'Général' },
                { id: 'category', label: `Par catégorie (${groups.length})` },
              ]}
            />
          </div>
        )}
        {view === 'overall' || groups.length === 1 ? (
          <div className="list">{overall.map((r, i) => <div key={i}>{row(r, r.overall ?? '–', groups.length > 1 ? r.category : undefined)}</div>)}</div>
        ) : (
          groups.map((g, gi) => (
            <div key={gi} className="heat-block">
              <div className="heat-cat">{g.category ?? 'Classement'}</div>
              <div className="list">{g.rows.map((r, i) => <div key={i}>{row(r, r.place ?? '–')}</div>)}</div>
            </div>
          ))
        )}
      </>
    );
  }
  return (
    <>
      {sheet.heats.map((h) => (
        <div key={h.heat} className="heat-block">
          <div className="heat-cat">
            Série {h.heat}
            {h.total ? ` sur ${h.total}` : ''}
            {h.start ? ` · ≈ ${h.start}` : ''}
          </div>
          <div className="list">{h.rows.map((r, i) => <div key={i}>{row(r, r.lane ?? '–')}</div>)}</div>
        </div>
      ))}
    </>
  );
}

/** Séries et classement d'une épreuve de la compétition (tous les nageurs, ceux de l'ESN en évidence). */
export function openMeetEvent(meet: Meet, ev: MeetEvent, live: boolean, settled: boolean) {
  if (!meet.liveId || !ev.no) return;
  overlay.sheet((close) => (
    <SheetLayout title={`${ev.no}. ${meetEventLabel(ev)}`} onCancel={close} cancelLabel="Fermer">
      <EventSheetBody meet={meet} ev={ev} live={live} settled={settled} />
    </SheetLayout>
  ));
}
