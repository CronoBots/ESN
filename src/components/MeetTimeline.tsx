import { Fragment, useMemo } from 'react';
import type { Swimmer } from '../store/types';
import { useData } from '../store/store';
import { swimsOf, usePbFlags } from '../store/hooks';
import { meetTimeline, pointsFor, type PbInfo, type TimelineEntry } from '../lib/stats';
import { courseLabel, eventLabel, ROUND_LABEL, STATUS_SHORT } from '../lib/events';
import { formatRange, fromISO } from '../lib/dates';
import { formatDelta, formatTime } from '../lib/time';
import { navigate } from '../router';
import { PbDelta, PlaceLabel, StrokeTag } from './ui';
import { Icon } from './Icon';
import { ColumnChart } from './Chart';
import { deName } from '../lib/text';

const MONTHS = ['JANV', 'FÉVR', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];

/** Pavé date (mois + jour) des listes de compétitions. */
export function DateBlock({ iso, accent }: { iso: string; accent?: boolean }) {
  const d = fromISO(iso);
  return (
    <span className={`date-block${accent ? ' accent' : ''}`} aria-hidden="true">
      <span className="m">{MONTHS[d.getMonth()]}</span>
      <span className="d">{d.getDate()}</span>
    </span>
  );
}

/** Compétitions (avec résultats) du nageur, de la plus ancienne à la plus récente. */
export function useTimeline(swimmer: Swimmer | undefined): TimelineEntry[] {
  const data = useData();
  const pbFlags = usePbFlags();
  return useMemo(
    () => (swimmer ? meetTimeline(swimsOf(data.swims, swimmer.id), data.meets, swimmer, pbFlags) : []),
    [data.swims, data.meets, swimmer, pbFlags],
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

function trendLabel(t: number) {
  return `${t > 0 ? '▲ +' : t < 0 ? '▼ −' : '= '}${Math.abs(t)} pts`;
}

/** Carte d'une compétition passée, avec les résultats du nageur. */
export function TimelineMeetCard({
  entry,
  swimmer,
  pbFlags,
}: {
  entry: TimelineEntry;
  swimmer: Swimmer;
  pbFlags: Map<string, PbInfo>;
}) {
  const meta = [formatRange(entry.startDate, entry.endDate), entry.city, entry.course ? courseLabel(entry.course) : null].filter(
    Boolean,
  );
  const open = entry.meet ? () => navigate(`/meet/${entry.meet!.id}`) : undefined;
  return (
    <article className="tl-card">
      <button className="tl-head" type="button" onClick={open} disabled={!open}>
        <DateBlock iso={entry.startDate} />
        <div className="row-body">
          <div className="tl-title">{entry.name}</div>
          <div className="row-sub">{meta.join('\u00a0· ')}</div>
          <div className="tl-badges">
            <span className="badge">{plural(entry.swims.length, 'course')}</span>
            {entry.pbs > 0 && <span className="badge pb">{plural(entry.pbs, 'record')}</span>}
            {entry.trend != null && (
              <span
                className={`badge ${entry.trend > 0 ? 'good' : ''}`}
                title="Meilleure performance comparée à la compétition précédente"
              >
                {trendLabel(entry.trend)}
              </span>
            )}
          </div>
        </div>
        {open && <Icon name="chevronRight" className="chev" />}
      </button>
      <div className="tl-results">
        {entry.swims.map((s) => {
          const pb = pbFlags.get(s.id);
          const pts = pointsFor(s, swimmer);
          const sub = [
            s.round !== 'TIM' ? ROUND_LABEL[s.round] : null,
            s.place ? <PlaceLabel key="p" place={s.place} round={s.round} /> : null,
            pts != null ? `${pts} pts` : null,
          ].filter(Boolean);
          return (
            <button key={s.id} type="button" className="tl-swim" onClick={() => navigate(`/swim/${s.id}`)}>
              <StrokeTag stroke={s.stroke} distance={s.distance} size={30} />
              <div className="row-body">
                <div className="tl-event">{eventLabel(s.distance, s.stroke)}</div>
                {sub.length > 0 && (
                  <div className="tl-sub">
                    {sub.map((x, i) => (
                      <Fragment key={i}>
                        {i > 0 && '\u00a0· '}
                        {x}
                      </Fragment>
                    ))}
                  </div>
                )}
              </div>
              <div className="tl-time">
                <span className="time-big">{s.status === 'OK' || s.status === 'DSQ' ? formatTime(s.timeCs) : ''}</span>
                <span className="hstack" style={{ gap: 4, justifyContent: 'flex-end' }}>
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
              </div>
            </button>
          );
        })}
      </div>
    </article>
  );
}

/**
 * Évolution de compétition en compétition : meilleure performance (points
 * World Aquatics) de chaque compétition, dans l'ordre chronologique.
 */
export function EvolutionCard({ timeline, swimmer, limit }: { timeline: TimelineEntry[]; swimmer: Swimmer; limit?: number }) {
  const withPts = timeline.filter((e) => e.best);
  if (withPts.length < 2) return null;
  const list = limit ? withPts.slice(-limit) : withPts;
  const last = withPts[withPts.length - 1];
  const first = withPts[0];
  const total = last.best!.points - first.best!.points;
  return (
    <div className="card pad evo">
      <div className="evo-head">
        <div>
          <div className="evo-label">Dernière compétition</div>
          <div className="evo-value tnum">
            {last.best!.points} <small>pts</small>
          </div>
        </div>
        {last.trend != null && (
          <div className="evo-delta">
            <span className={`evo-chip ${last.trend > 0 ? 'good' : last.trend < 0 ? 'bad' : ''}`}>{trendLabel(last.trend)}</span>
            <span className="small muted">vs compétition précédente</span>
          </div>
        )}
      </div>
      <ColumnChart
        ariaLabel={`Meilleure performance ${deName(swimmer.firstName)} à chacune de ses ${withPts.length} compétitions, en points World Aquatics`}
        data={list.map((e) => ({
          key: e.key,
          date: e.startDate,
          value: e.best!.points,
          title: e.name,
          lines: [
            `${eventLabel(e.best!.swim.distance, e.best!.swim.stroke)} en ${formatTime(e.best!.swim.timeCs)}`,
            ...(e.pbs ? [plural(e.pbs, 'record') + ' battu' + (e.pbs > 1 ? 's' : '')] : []),
          ],
        }))}
        onOpen={(key) => {
          if (timeline.find((e) => e.key === key)?.meet) navigate(`/meet/${key}`);
        }}
      />
      <div className="evo-foot">
        Chaque colonne = la meilleure course d’une compétition (points World Aquatics : plus c’est haut, mieux c’est).
        {total !== 0 && ` ${total > 0 ? '+' : '−'}${Math.abs(total)} pts depuis la première compétition suivie.`}
      </div>
    </div>
  );
}
