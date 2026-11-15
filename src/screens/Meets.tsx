import { useMemo, useState } from 'react';
import { useData } from '../store/store';
import { fullName, sortSwimmers, usePbFlags } from '../store/hooks';
import { Avatar, Empty, NavBar, Row, Section, Segmented, StrokeTag } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate } from '../router';
import { formatDate, formatLongDay, formatRange, fromISO, relativeDay, seasonLabel, seasonOf, todayISO } from '../lib/dates';
import { eventLabel, courseLabel, ROUND_LABEL } from '../lib/events';
import { formatDelta, formatTime } from '../lib/time';
import { chronoCompare, countsForRecords, isValidResult, pointsFor } from '../lib/stats';
import { buildMeetCalendar, downloadFile, slug } from '../lib/ics';
import type { Meet, Swim } from '../store/types';
import { openMeetForm, openResultForm } from './forms';
import { overlay } from '../components/ui';
import { openResultPhotos } from './ResultPhotos';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const MONTHS = ['JANV', 'FÉVR', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];

function DateBlock({ iso, accent }: { iso: string; accent?: boolean }) {
  const d = fromISO(iso);
  return (
    <span
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: 46,
        height: 48,
        borderRadius: 11,
        background: accent ? 'var(--accent)' : 'var(--fill)',
        color: accent ? '#fff' : 'var(--text)',
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', opacity: 0.8 }}>{MONTHS[d.getMonth()]}</span>
      <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1 }}>{d.getDate()}</span>
    </span>
  );
}

export function Meets() {
  const data = useData();
  const pbFlags = usePbFlags();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const today = todayISO();

  const info = useMemo(() => {
    const map = new Map<string, { swims: Swim[]; pbs: number; swimmers: Set<string> }>();
    for (const s of data.swims) {
      if (!s.meetId) continue;
      const e = map.get(s.meetId) ?? { swims: [], pbs: 0, swimmers: new Set<string>() };
      e.swims.push(s);
      e.swimmers.add(s.swimmerId);
      if (pbFlags.get(s.id)?.isPB) e.pbs++;
      map.set(s.meetId, e);
    }
    return map;
  }, [data.swims, pbFlags]);

  const upcoming = data.meets.filter((m) => (m.endDate ?? m.startDate) >= today).sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const past = data.meets.filter((m) => (m.endDate ?? m.startDate) < today).sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  const list = tab === 'upcoming' ? upcoming : past;

  // Regroupement par saison pour les compétitions passées
  const groups = useMemo(() => {
    const g = new Map<string, Meet[]>();
    for (const m of list) {
      const k = tab === 'past' ? seasonOf(m.startDate) : 'all';
      g.set(k, [...(g.get(k) ?? []), m]);
    }
    return [...g.entries()];
  }, [list, tab]);

  return (
    <>
      <NavBar
        title="Compétitions"
        right={
          <button className="icon-btn" aria-label="Nouvelle compétition" onClick={() => openMeetForm(undefined, (m) => navigate(`/meet/${m.id}`))}>
            <Icon name="plus" />
          </button>
        }
      />
      <main className="page">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { id: 'upcoming', label: `À venir · ${upcoming.length}` },
            { id: 'past', label: `Passées · ${past.length}` },
          ]}
        />
        {list.length === 0 ? (
          <div className="card" style={{ marginTop: 16 }}>
            <Empty
              icon="calendar"
              title={tab === 'upcoming' ? 'Aucune compétition à venir' : 'Aucune compétition passée'}
              text={
                tab === 'upcoming'
                  ? 'Créez la prochaine compétition et ajoutez le programme de votre enfant : heures de passage, séries, lignes. Le jour J, saisissez les temps en direct.'
                  : 'Les compétitions apparaissent ici après la saisie ou l’import de résultats.'
              }
              action={
                <button className="btn small" onClick={() => openMeetForm(undefined, (m) => navigate(`/meet/${m.id}`))}>
                  <Icon name="plus" /> Nouvelle compétition
                </button>
              }
            />
          </div>
        ) : (
          groups.map(([key, meets]) => (
            <Section key={key} title={tab === 'past' ? seasonLabel(key) : undefined}>
              <div className="list">
                {meets.map((m) => {
                  const e = info.get(m.id);
                  const ongoing = m.startDate <= today && (m.endDate ?? m.startDate) >= today;
                  const sub = [
                    formatRange(m.startDate, m.endDate),
                    m.city,
                    courseLabel(m.course),
                  ].filter(Boolean);
                  return (
                    <button key={m.id} className="row" onClick={() => navigate(`/meet/${m.id}`)}>
                      <DateBlock iso={m.startDate} accent={ongoing} />
                      <div className="row-body">
                        <div className="row-title">{m.name}</div>
                        <div className="row-sub">{sub.join(' · ')}</div>
                        {e && (
                          <div className="hstack" style={{ gap: 6, marginTop: 5 }}>
                            <span className="badge">{e.swims.length} course{e.swims.length > 1 ? 's' : ''}</span>
                            {e.pbs > 0 && <span className="badge pb">{e.pbs} PB</span>}
                            {tab === 'upcoming' && <span className="badge first">{ongoing ? 'En cours' : relativeDay(m.startDate)}</span>}
                          </div>
                        )}
                      </div>
                      <Icon name="chevronRight" className="chev" />
                    </button>
                  );
                })}
              </div>
            </Section>
          ))
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
    .map((sw) => ({ swimmer: sw, swims: swims.filter((s) => s.swimmerId === sw.id) }))
    .filter((g) => g.swims.length);
  const pbs = swims.filter((s) => pbFlags.get(s.id)?.isPB);
  const totalGain = pbs.reduce((a, s) => a + -(pbFlags.get(s.id)?.deltaCs ?? 0), 0);
  const swum = swims.filter(isValidResult);

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
        right={
          <button className="icon-btn" onClick={() => openMeetForm(meet)}>
            Modifier
          </button>
        }
      />
      <main className="page">
        <div className="list">
          {!isPast && (
            <Row icon="plus" title="Ajouter une épreuve au programme" chevron onClick={() => openResultForm({ meetId: meet.id, entry: true })} />
          )}
          {meet.startDate <= today && (
            <Row
              icon="upload"
              iconBg="#bf5af2"
              title="Photographier les résultats affichés"
              sub="Les temps de vos enfants sont lus sur les feuilles"
              chevron
              onClick={() => openResultPhotos({ meetId: meet.id })}
            />
          )}
          {swims.length > 0 && (
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
                {Math.max(0, ...swum.map((s) => pointsFor(s, data.swimmers.find((w) => w.id === s.swimmerId)) ?? 0)) || '—'}
              </div>
            </div>
          </div>
        )}

        {bySwimmer.length === 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <Empty
              icon="flag"
              title="Programme vide"
              text={
                isPast
                  ? 'Ajoutez les résultats de cette compétition.'
                  : 'Ajoutez les épreuves de votre enfant (numéro, heure, série, ligne) pour avoir son programme sous la main le jour J.'
              }
            />
          </div>
        )}

        {bySwimmer.map(({ swimmer, swims: list }) => {
          const days = new Map<string, Swim[]>();
          for (const s of list) days.set(s.date, [...(days.get(s.date) ?? []), s]);
          return (
            <Section
              key={swimmer.id}
              title={
                <span className="hstack" style={{ gap: 10 }}>
                  <Avatar swimmer={swimmer} size={30} />
                  {bySwimmer.length > 1 ? fullName(swimmer) : 'Inscriptions'}
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
                      const sub = [
                        s.startTime,
                        s.heat ? `Série ${s.heat}` : null,
                        s.lane != null ? `Ligne ${s.lane}` : null,
                        s.round !== 'TIM' ? ROUND_LABEL[s.round] : null,
                        s.place ? `${s.place}${s.place === 1 ? 're' : 'e'} place` : null,
                      ].filter(Boolean);
                      return (
                        <button
                          key={s.id}
                          className="row"
                          onClick={() =>
                            s.timeCs == null && s.status === 'OK' ? openResultForm({ swim: s, entry: true }) : navigate(`/swim/${s.id}`)
                          }
                        >
                          <StrokeTag stroke={s.stroke} distance={s.distance} size={36} />
                          <div className="row-body">
                            <div className="row-title">
                              {s.eventNo ? `${s.eventNo}. ` : ''}
                              {eventLabel(s.distance, s.stroke)}
                            </div>
                            <div className="row-sub">{sub.join(', ') || formatDate(s.date)}</div>
                          </div>
                          <div className="row-end">
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
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
        })}

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
