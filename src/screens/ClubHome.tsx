import { useMemo } from 'react';
import { useData } from '../store/store';
import { usePbFlags } from '../store/hooks';
import { BrandLogo, NavBar, Section } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate } from '../router';
import { LiveBanner } from '../components/LiveBanner';
import { ClubEventRow, GroupsBadge, useClubCalendar } from '../components/ClubCalendar';
import { DateBlock } from '../components/MeetTimeline';
import { ClubWeekendCard } from './ClubWeekend';
import { ClubCard } from './Home';
import { meetRecap } from '../lib/meetRecap';
import { publishedMeet, upcomingClubEvents, type ClubEvent } from '../lib/clubCalendar';
import { clubMeets } from '../lib/stats';
import { formatRange, relativeDay, todayISO } from '../lib/dates';
import { courseLabel } from '../lib/events';
import { capitalize } from '../lib/text';
import type { Meet } from '../store/types';

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/**
 * Espace du club : la même page pour tous. La compétition en cours, le dernier week-end, les prochaines
 * compétitions (calendrier du club, puis programme publié), les dernières avec leur bilan, puis les
 * nageurs, les records et les classements de l'ESN.
 */
export function ClubHome() {
  const data = useData();
  const pbFlags = usePbFlags();
  const today = todayISO();
  const cal = useClubCalendar();
  const clubMeetIds = useMemo(() => clubMeets(data.swims, data.swimmers), [data.swims, data.swimmers]);
  const members = useMemo(() => new Set(data.swimmers.filter((s) => s.member && !s.former).map((s) => s.id)), [data.swimmers]);

  // Prochaines compétitions : programme publié, puis annonces du calendrier du club
  const coming = useMemo(() => {
    const meets = data.meets
      .filter((m) => (m.endDate ?? m.startDate) >= today && clubMeetIds.has(m.id))
      .map((meet) => ({ meet, start: meet.startDate }));
    const events = upcomingClubEvents(cal, data.meets, today).map((ev) => ({ ev, start: ev.start }));
    return [...meets, ...events].sort((a, b) => (a.start < b.start ? -1 : 1)).slice(0, 4);
  }, [data.meets, clubMeetIds, cal, today]);

  // Dernières compétitions du club, avec leur bilan
  const past = useMemo(() => {
    return data.meets
      .filter((m) => (m.endDate ?? m.startDate) < today && clubMeetIds.has(m.id))
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
      .slice(0, 5)
      .map((meet) => ({ meet, r: meetRecap(meet.id, data.swims, data.swimmers, pbFlags) }));
  }, [data.meets, data.swims, data.swimmers, clubMeetIds, pbFlags, today]);

  const engaged = (m: Meet) => new Set(data.swims.filter((s) => s.meetId === m.id && members.has(s.swimmerId)).map((s) => s.swimmerId)).size;

  return (
    <>
      <NavBar title="Club" subtitle="Ecole Seraing Natation" brand={<BrandLogo height={88} />} />
      <main className="page">
        <LiveBanner />
        <ClubWeekendCard />

        {coming.length > 0 && (
          <Section
            title="Prochaines compétitions"
            action={
              <button className="section-link" onClick={() => navigate('/meets')}>
                Calendrier
              </button>
            }
          >
            <div className="list">
              {coming.map((item) => {
                if ('ev' in item) return cal ? <ClubEventRow key={`cal-${item.ev.start}-${item.ev.city}`} ev={item.ev as ClubEvent} cal={cal} /> : null;
                const m = item.meet;
                const ongoing = m.startDate <= today;
                const n = engaged(m);
                const planned = cal?.events.find((e) => publishedMeet(e, [m]));
                return (
                  <button key={m.id} className="row" onClick={() => navigate(`/meet/${m.id}`)}>
                    <DateBlock iso={m.startDate} accent={ongoing} />
                    <div className="row-body">
                      <div className="row-title">{m.name}</div>
                      <div className="row-sub">{[formatRange(m.startDate, m.endDate), m.city, courseLabel(m.course)].filter(Boolean).join(' · ')}</div>
                      <div className="tl-badges">
                        <span className="badge first">{ongoing ? 'En cours' : capitalize(relativeDay(m.startDate))}</span>
                        {n > 0 && <span className="badge">{plural(n, 'nageur')} de l’ESN</span>}
                        {planned && planned.groups.length > 0 && cal && <GroupsBadge groups={planned.groups} names={cal.groupNames} />}
                      </div>
                    </div>
                    <Icon name="chevronRight" className="chev" />
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        {past.length > 0 && (
          <Section
            title="Dernières compétitions"
            action={
              <button className="section-link" onClick={() => navigate('/meets')}>
                Toutes
              </button>
            }
          >
            <div className="list">
              {past.map(({ meet: m, r }) => (
                <button key={m.id} className="row" onClick={() => navigate(`/meet/${m.id}`)}>
                  <DateBlock iso={m.startDate} />
                  <div className="row-body">
                    <div className="row-title">{m.name}</div>
                    <div className="row-sub">{[formatRange(m.startDate, m.endDate), m.city].filter(Boolean).join(' · ')}</div>
                    <div className="row-sub">
                      {[
                        plural(r.swimmers.length, 'nageur'),
                        plural(r.swum, 'course'),
                        r.pbs ? `${plural(r.pbs, 'record')} perso` : null,
                        r.podiums ? plural(r.podiums, 'podium') : null,
                        r.records.length ? `${r.records.length} record${r.records.length > 1 ? 's' : ''} du club` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <Icon name="chevronRight" className="chev" />
                </button>
              ))}
            </div>
          </Section>
        )}

        <ClubCard />
      </main>
    </>
  );
}
