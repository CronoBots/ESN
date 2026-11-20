import type { Meet, Swim } from '../store/types';
import type { PbInfo } from '../lib/stats';
import { eventLabel, ROUND_LABEL, STATUS_SHORT, courseLabel } from '../lib/events';
import { formatDelta, formatTime } from '../lib/time';
import { formatDate, todayISO } from '../lib/dates';
import { Fragment, type ReactNode } from 'react';
import { PlaceLabel, StrokeTag } from './ui';
import { Icon } from './Icon';
import { navigate } from '../router';

export function SwimBadges({ swim, pb }: { swim: Swim; pb?: PbInfo }) {
  if (swim.status !== 'OK') return <span className="badge bad">{STATUS_SHORT[swim.status]}</span>;
  return (
    <>
      {swim.context === 'training' && <span className="badge training">ENTR.</span>}
      {swim.masters && (
        <span className="badge masters" title="Temps réalisé en compétition masters">
          Masters
        </span>
      )}
      {pb?.isPB && <span className="badge pb">PB</span>}
      {pb?.isFirst && <span className="badge first">1er temps</span>}
    </>
  );
}

/** Ligne de résultat : épreuve, contexte, temps et badges. */
export function SwimRow({
  swim,
  pb,
  meet,
  showMeet = true,
  showCourse = true,
  onClick,
}: {
  swim: Swim;
  pb?: PbInfo;
  meet?: Meet;
  showMeet?: boolean;
  showCourse?: boolean;
  onClick?: () => void;
}) {
  const where = showMeet ? meet?.name ?? (swim.context === 'training' ? 'Entraînement' : 'Compétition') : null;
  const details: ReactNode[] = [formatDate(swim.date)];
  if (showCourse) details.push(courseLabel(swim.course));
  if (swim.round !== 'TIM' && swim.context === 'competition') details.push(ROUND_LABEL[swim.round]);
  if (swim.place) details.push(<PlaceLabel place={swim.place} round={swim.round} />);
  return (
    <button className="row" type="button" onClick={onClick ?? (() => navigate(`/swim/${swim.id}`))}>
      <StrokeTag stroke={swim.stroke} distance={swim.distance} />
      <div className="row-body">
        <div className="row-title">{eventLabel(swim.distance, swim.stroke)}</div>
        {where && <div className="row-sub">{where}</div>}
        <div className="row-sub">
          {details.map((d, i) => (
            <Fragment key={i}>
              {i > 0 && '\u00a0· '}
              {d}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="row-end">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
          {swim.timeCs != null ? (
            <span className="time-big">{formatTime(swim.timeCs)}</span>
          ) : swim.status === 'OK' ? (
            <span className="badge first">{swim.date >= todayISO() ? 'Programmé' : 'Sans temps'}</span>
          ) : null}
          <span className="hstack" style={{ gap: 4 }}>
            <SwimBadges swim={swim} pb={pb} />
            {pb && !pb.isFirst && pb.deltaCs != null && swim.status === 'OK' && (
              <span className={`small tnum ${pb.deltaCs < 0 ? 'good' : 'muted'}`} style={{ fontWeight: 600 }}>
                {formatDelta(pb.deltaCs)}
              </span>
            )}
          </span>
        </div>
        <Icon name="chevronRight" className="chev" />
      </div>
    </button>
  );
}
