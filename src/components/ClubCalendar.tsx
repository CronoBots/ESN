import { useEffect, useState } from 'react';
import { eventAsMeet, groupsLabel, groupsShort, parseClubCalendar, type ClubCalendar, type ClubEvent } from '../lib/clubCalendar';
import { courseLabel } from '../lib/events';
import { formatDate, formatRange, relativeDay, todayISO } from '../lib/dates';
import { buildMeetCalendar, downloadFile, slug } from '../lib/ics';
import { capitalize } from '../lib/text';
import { DateBlock } from './MeetTimeline';
import { overlay, SheetLayout } from './ui';
import { Icon } from './Icon';

const CALENDAR_URL = './data/club-calendar.json';
let loading: Promise<ClubCalendar | null> | null = null;

/** Calendrier du club : réseau d'abord, dernière copie hors connexion (service worker). */
function loadClubCalendar(): Promise<ClubCalendar | null> {
  loading ??= fetch(CALENDAR_URL, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then(parseClubCalendar)
    .catch(() => null);
  return loading;
}

export function useClubCalendar(): ClubCalendar | null {
  const [cal, setCal] = useState<ClubCalendar | null>(null);
  useEffect(() => {
    let alive = true;
    loadClubCalendar().then((c) => alive && setCal(c));
    return () => {
      alive = false;
    };
  }, []);
  return cal;
}

const where = (ev: ClubEvent) => [ev.dates ? `${formatRange(ev.start, ev.end)} (${ev.dates})` : formatRange(ev.start, ev.end), ev.city, ev.course && courseLabel(ev.course)].filter(Boolean).join(' · ');

function DetailSheet({ ev, cal, close }: { ev: ClubEvent; cal: ClubCalendar; close: () => void }) {
  const today = todayISO();
  const addToAgenda = () => {
    const meet = eventAsMeet(ev);
    downloadFile(`${slug(ev.name)}.ics`, buildMeetCalendar(meet, [], []), 'text/calendar');
  };
  return (
    <SheetLayout title="Calendrier du club" onCancel={close} cancelLabel="Fermer">
      <div className="club-event">
        <div className="club-event-head">
          <DateBlock iso={ev.start} accent={ev.start <= today} />
          <div className="grow">
            <div className="club-event-name">{ev.name}</div>
            <div className="muted small">{where(ev)}</div>
          </div>
        </div>
        <div className="tl-badges">
          <span className="badge first">{ev.start <= today ? 'En cours' : capitalize(relativeDay(ev.start))}</span>
          {ev.groups.length > 0 && <GroupsBadge groups={ev.groups} names={cal.groupNames} />}
        </div>
        {ev.groups.length > 0 && (
          <div className="club-event-groups">
            <span className="muted small">Groupes concernés</span>
            {ev.groups.map((g) => (
              <span key={g} className="club-event-group">
                <b>{g}</b>
                {cal.groupNames[g] ? ` · ${cal.groupNames[g]}` : ''}
              </span>
            ))}
          </div>
        )}
        {ev.note && (
          <p className="club-event-note">
            <Icon name="info" /> {ev.note}
          </p>
        )}
        <p className="club-event-text">
          Le programme de chaque nageur (épreuves, séries, lignes et heures de passage) s’affichera ici dès que l’organisateur publie
          les listes de départ, en général quelques jours avant la compétition.
        </p>
        <button className="btn ghost block" onClick={addToAgenda}>
          <Icon name="calendar" /> Ajouter à mon agenda
        </button>
        <div className="section-foot">
          {cal.title}, version du {formatDate(cal.version)}. {cal.note}
        </div>
      </div>
    </SheetLayout>
  );
}

/** Groupes concernés, avec le prénom de leur entraîneur (« Guillaume, Emilie »). */
export function GroupsBadge({ groups, names }: { groups: string[]; names: Record<string, string> }) {
  return (
    <span className="badge" aria-label={groupsLabel(groups, names)}>
      <Icon name="users" /> {groupsShort(groups, names)}
    </span>
  );
}

export function openClubEvent(ev: ClubEvent, cal: ClubCalendar) {
  overlay.sheet((close) => <DetailSheet ev={ev} cal={cal} close={close} />);
}

/** Ligne de la liste « À venir » : compétition du calendrier dont le programme n'est pas encore publié. */
export function ClubEventRow({ ev, cal }: { ev: ClubEvent; cal: ClubCalendar }) {
  const today = todayISO();
  const ongoing = ev.start <= today;
  return (
    <button className="row" onClick={() => openClubEvent(ev, cal)}>
      <DateBlock iso={ev.start} accent={ongoing} />
      <div className="row-body">
        <div className="row-title">{ev.name}</div>
        <div className="row-sub">{where(ev)}</div>
        <div className="tl-badges">
          <span className="badge first">{ongoing ? 'En cours' : capitalize(relativeDay(ev.start))}</span>
          {ev.groups.length > 0 && <GroupsBadge groups={ev.groups} names={cal.groupNames} />}
          <span className="badge muted-badge">Programme à venir</span>
        </div>
      </div>
      <Icon name="chevronRight" className="chev" />
    </button>
  );
}

/** Accueil : prochaine compétition du club (la même pour tous les nageurs), avant la publication du programme. */
export function ClubEventCard({ ev, cal }: { ev: ClubEvent; cal: ClubCalendar }) {
  const today = todayISO();
  return (
    <button className="card club-event-card" onClick={() => openClubEvent(ev, cal)}>
      <div className="hstack between">
        <div className="grow">
          <div style={{ fontWeight: 700, fontSize: 18 }}>{ev.name}</div>
          <div className="muted small" style={{ marginTop: 2 }}>
            {where(ev)}
          </div>
        </div>
        <span className="badge first" style={{ height: 24, fontSize: 12 }}>
          {ev.start <= today ? 'En cours' : capitalize(relativeDay(ev.start))}
        </span>
      </div>
      <div className="club-event-meta">
        {ev.groups.length > 0 && <span>{groupsLabel(ev.groups, cal.groupNames)}</span>}
        {ev.note && <span>{ev.note}</span>}
      </div>
      <div className="club-event-wait">
        <Icon name="bell" /> Programme du nageur publié quelques jours avant
      </div>
    </button>
  );
}
