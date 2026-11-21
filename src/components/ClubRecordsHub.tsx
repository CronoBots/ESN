import { useMemo } from 'react';
import { useData } from '../store/store';
import { fullName } from '../store/hooks';
import { Row, Section, StrokeTag } from './ui';
import { Icon } from './Icon';
import { navigate } from '../router';
import { AGE_BANDS, clubRecords, recordComplete, type ClubRecord } from '../lib/clubRecords';
import { courseLabel, eventLabel } from '../lib/events';
import { formatDate, todayISO, addDays } from '../lib/dates';
import { formatTime } from '../lib/time';
import type { Course, Gender } from '../store/types';

/** Onglet Records, côté club : records et classements de l'ESN, et les records du club battus cette année. */
export function ClubRecordsHub() {
  const data = useData();
  // Records du club (tous âges, puis par âge) établis ces 12 derniers mois et toujours en vigueur ;
  // une course record à plusieurs titres est montrée une fois, avec le plus large (« Tous âges » d'abord)
  const recent = useMemo(() => {
    const since = addDays(todayISO(), -365);
    const out = new Map<string, ClubRecord & { band: string }>();
    for (const band of AGE_BANDS.filter((b) => b.id !== 'masters'))
      for (const course of ['SCM', 'LCM'] as Course[])
        for (const gender of ['F', 'M'] as Gender[])
          for (const r of clubRecords(data.swims, data.swimmers, { course, gender, band }).values())
            if (r.swim.date >= since && recordComplete(r.swim.course, r.swim.distance, r.swim.stroke) && !out.has(r.swim.id))
              out.set(r.swim.id, { ...r, band: band.label });
    return [...out.values()].sort((a, b) => (a.swim.date < b.swim.date ? 1 : -1)).slice(0, 15);
  }, [data.swims, data.swimmers]);

  return (
    <>
      <Section title="Le club">
        <div className="list">
          <Row icon="trophy" iconBg="#f5a400" title="Records du club" sub="Meilleurs temps de l’ESN, par épreuve et par âge" chevron onClick={() => navigate('/club-records')} />
          <Row icon="ranking" iconBg="var(--brand-blue)" title="Classements du club" sub="Les nageurs de l’ESN classés sur chaque épreuve" chevron onClick={() => navigate('/rankings')} />
        </div>
      </Section>
      {recent.length > 0 && (
        <Section title="Records du club battus cette année">
          <div className="list">
            {recent.map(({ swim, swimmer, band }) => (
              <button key={swim.id} className="row" onClick={() => navigate(`/swim/${swim.id}`)}>
                <StrokeTag stroke={swim.stroke} distance={swim.distance} size={36} />
                <div className="row-body">
                  <div className="row-title">{fullName(swimmer)}</div>
                  <div className="row-sub">
                    {eventLabel(swim.distance, swim.stroke)} {courseLabel(swim.course)} · {band} · {formatDate(swim.date)}
                  </div>
                </div>
                <span className="row-end">
                  <b className="tnum">{formatTime(swim.timeCs)}</b>
                  <Icon name="chevronRight" className="chev" />
                </span>
              </button>
            ))}
          </div>
          <div className="section-foot">Records du club (tous âges et par âge) encore en vigueur, établis ces 12 derniers mois.</div>
        </Section>
      )}
    </>
  );
}
