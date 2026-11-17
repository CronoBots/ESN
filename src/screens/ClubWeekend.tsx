import { useMemo } from 'react';
import { useData } from '../store/store';
import { fullName, usePbFlags } from '../store/hooks';
import { Avatar, Empty, NavBar, Section, StrokeTag } from '../components/ui';
import { Icon } from '../components/Icon';
import { SwimRow } from '../components/SwimRow';
import { navigate } from '../router';
import { lastClubWeekend, type ClubWeekend } from '../lib/clubWeekend';
import { addDays, formatRange, todayISO } from '../lib/dates';
import { courseLabel, eventLabel } from '../lib/events';
import { chronoCompare } from '../lib/stats';
import { formatTime } from '../lib/time';
import type { Swim, Swimmer } from '../store/types';

/** Dernier week-end de compétition des nageurs du club (null s'il n'y en a pas). */
export function useClubWeekend(): ClubWeekend | null {
  const data = useData();
  const pbFlags = usePbFlags();
  return useMemo(
    () => lastClubWeekend(data.swims, data.swimmers, data.meets, pbFlags, todayISO()),
    [data.swims, data.swimmers, data.meets, pbFlags],
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

function weekendTitle(w: ClubWeekend): string {
  return w.end >= addDays(todayISO(), -6) ? 'Le club ce week-end' : 'Dernière compétition du club';
}

function meetsLine(w: ClubWeekend): string {
  const names = w.meets.map((m) => m.name);
  const shown = names.length > 2 ? [...names.slice(0, 2), `${names.length - 2} autre${names.length > 3 ? 's' : ''}`] : names;
  return [shown.join(' · '), formatRange(w.start, w.end)].filter(Boolean).join(' · ');
}

function WeekendTiles({ w }: { w: ClubWeekend }) {
  return (
    <div className="tiles three weekend-tiles">
      <div className="tile">
        <div className="tile-label">Nageurs</div>
        <div className="tile-value">{w.swimmerIds.length}</div>
        <div className="tile-sub">{plural(w.swims.length, 'course')}</div>
      </div>
      <div className="tile">
        <div className="tile-label">Records perso</div>
        <div className="tile-value">{w.pbs}</div>
        <div className="tile-sub">{w.firsts ? `+ ${w.firsts} premier${w.firsts > 1 ? 's' : ''} temps` : 'battus'}</div>
      </div>
      <div className="tile">
        <div className="tile-label">Podiums</div>
        <div className="tile-value">{w.podiums}</div>
        <div className="tile-sub">places 1 à 3</div>
      </div>
    </div>
  );
}

function RecordLines({ w }: { w: ClubWeekend }) {
  if (!w.records.length) return null;
  return (
    <div className="club-record-lines weekend-records">
      {w.records.map(({ swim, swimmer }) => (
        <span key={swim.id} className="club-record-line">
          <Icon name="trophy" aria-hidden="true" />
          <span>
            <b>Record du club</b> · {fullName(swimmer)} · {eventLabel(swim.distance, swim.stroke)} {courseLabel(swim.course)} en{' '}
            <b className="tnum">{formatTime(swim.timeCs)}</b>
          </span>
        </span>
      ))}
    </div>
  );
}

/** Carte de l'accueil : le dernier week-end de compétition du club en un coup d'œil. */
export function ClubWeekendCard() {
  const w = useClubWeekend();
  if (!w) return null;
  return (
    <Section
      title={weekendTitle(w)}
      action={
        <button className="section-link" onClick={() => navigate('/club-weekend')}>
          Tout voir
        </button>
      }
    >
      <button className="card weekend-card" onClick={() => navigate('/club-weekend')}>
        <div className="weekend-meets">{meetsLine(w)}</div>
        <WeekendTiles w={w} />
        <RecordLines w={w} />
        {w.progress.length > 0 && (
          <>
            <div className="weekend-label">Plus belles progressions</div>
            <div className="weekend-progress">
              {w.progress.map(({ swim, swimmer, deltaCs, pct }) => (
                <span key={swim.id} className="weekend-progress-row">
                  <StrokeTag stroke={swim.stroke} distance={swim.distance} size={30} />
                  <span className="grow">
                    <b>{fullName(swimmer)}</b>
                    <span className="muted small"> · {eventLabel(swim.distance, swim.stroke)} {courseLabel(swim.course)}</span>
                  </span>
                  <span className="weekend-gain">
                    <span className="good tnum weekend-delta">−{formatTime(deltaCs)}</span>
                    <span className="muted small tnum">{pct.toLocaleString('fr-BE', { maximumFractionDigits: 1 })} %</span>
                  </span>
                </span>
              ))}
            </div>
          </>
        )}
      </button>
    </Section>
  );
}

/** Écran « Résultats du club » : toutes les courses des nageurs de l'ESN du dernier week-end. */
export function ClubWeekendScreen() {
  const data = useData();
  const pbFlags = usePbFlags();
  const w = useClubWeekend();
  const meetsById = useMemo(() => new Map(data.meets.map((m) => [m.id, m])), [data.meets]);
  const bySwimmer = useMemo(() => {
    if (!w) return [];
    const swimmers = new Map(data.swimmers.map((s) => [s.id, s]));
    const groups = new Map<string, Swim[]>();
    for (const s of w.swims) {
      const g = groups.get(s.swimmerId);
      if (g) g.push(s);
      else groups.set(s.swimmerId, [s]);
    }
    return [...groups.entries()]
      .map(([id, swims]) => ({ swimmer: swimmers.get(id)!, swims: swims.sort(chronoCompare) }))
      .filter((g): g is { swimmer: Swimmer; swims: Swim[] } => !!g.swimmer)
      .sort((a, b) => `${a.swimmer.lastName} ${a.swimmer.firstName}`.localeCompare(`${b.swimmer.lastName} ${b.swimmer.firstName}`, 'fr'));
  }, [w, data.swimmers]);

  if (!w) {
    return (
      <>
        <NavBar title="Résultats du club" back="/" />
        <main className="page">
          <div className="card">
            <Empty icon="trophy" title="Pas encore de résultats" text="Les résultats des nageurs du club apparaissent ici après chaque compétition." />
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <NavBar title="Résultats du club" subtitle={meetsLine(w)} back="/" />
      <main className="page">
        <WeekendTiles w={w} />
        <RecordLines w={w} />
        {bySwimmer.map(({ swimmer, swims }) => {
          const pbs = swims.filter((s) => pbFlags.get(s.id)?.isPB).length;
          return (
            <Section
              key={swimmer.id}
              title={
                <button className="weekend-swimmer" onClick={() => navigate(`/swimmer/${swimmer.id}`)}>
                  <Avatar swimmer={swimmer} size={28} />
                  {fullName(swimmer)}
                </button>
              }
              action={pbs ? <span className="badge pb">{plural(pbs, 'record')}</span> : undefined}
            >
              <div className="list swim-list">
                {swims.map((s) => (
                  <SwimRow key={s.id} swim={s} pb={pbFlags.get(s.id)} meet={s.meetId ? meetsById.get(s.meetId) : undefined} showMeet={w.meets.length > 1} />
                ))}
              </div>
            </Section>
          );
        })}
        <div className="section-foot" style={{ marginTop: 18 }}>
          Résultats officiels publiés par les organisateurs, pour les nageurs actuels du club.
        </div>
      </main>
    </>
  );
}
