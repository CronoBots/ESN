import { useMemo, useState } from 'react';
import { useData } from '../store/store';
import { fullName, hasClubMembers, useSelectedSwimmer } from '../store/hooks';
import { Empty, NavBar, Section, Segmented, StrokeDot, StrokeTag } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate } from '../router';
import { COURSES, STROKES, distancesFor, eventLabel } from '../lib/events';
import { AGE_BANDS, ageAt, bandForAge, clubRecords, recordComplete, recordKey } from '../lib/clubRecords';
import { formatDate } from '../lib/dates';
import { formatTime } from '../lib/time';
import { pointsFor } from '../lib/stats';
import type { Course, Gender } from '../store/types';
import { ensureClub, isFollowed } from './Club';

/**
 * Records du club : meilleur temps de tous les nageurs de l'ESN (actuels et anciens)
 * sur chaque épreuve, par bassin, filles ou garçons, tous âges ou à un âge donné.
 */
export function ClubRecords() {
  const data = useData();
  const selected = useSelectedSwimmer();
  const [course, setCourse] = useState<Course>(data.settings.defaultCourse);
  const [gender, setGender] = useState<Gender>(selected?.gender ?? 'F');
  const [bandId, setBandId] = useState('all');
  const band = AGE_BANDS.find((b) => b.id === bandId) ?? AGE_BANDS[0];
  const meetsById = useMemo(() => new Map(data.meets.map((m) => [m.id, m])), [data.meets]);
  const records = useMemo(() => clubRecords(data.swims, data.swimmers, { course, gender, band }), [data.swims, data.swimmers, course, gender, band]);
  // Raccourci vers l'âge du nageur suivi cette année (« 12 ans »)
  const mine = selected?.gender === gender ? bandForAge(ageAt({ date: `${new Date().getFullYear()}-01-01` }, selected)) : undefined;

  if (!hasClubMembers(data.swimmers)) {
    return (
      <>
        <NavBar title="Records du club" back="/records" />
        <main className="page">
          <div className="card">
            <Empty
              icon="trophy"
              title="Records du club"
              text="Les meilleurs temps de tous les nageurs de l’ESN, par épreuve et par âge. Ils s’affichent dès que la liste du club est chargée."
              action={
                <button className="btn small" onClick={() => void ensureClub()}>
                  <Icon name="download" /> Charger la liste du club
                </button>
              }
            />
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <NavBar title="Records du club" subtitle="Meilleurs temps des nageurs de l’ESN, actuels et anciens" back="/records" />
      <main className="page">
        <div className="stack" style={{ gap: 8 }}>
          <Segmented value={course} onChange={setCourse} options={COURSES.map((c) => ({ id: c.id, label: c.long.split(' (')[0] }))} />
          <Segmented
            value={gender}
            onChange={setGender}
            options={[
              { id: 'F', label: 'Filles' },
              { id: 'M', label: 'Garçons' },
            ]}
          />
        </div>
        <div className="chips" style={{ marginTop: 10 }} role="group" aria-label="Âge">
          {AGE_BANDS.map((b) => (
            <button key={b.id} className={`chip${bandId === b.id ? ' active' : ''}`} aria-pressed={bandId === b.id} onClick={() => setBandId(b.id)}>
              {b.short}
              {mine?.id === b.id && <span className="count">{selected!.firstName}</span>}
            </button>
          ))}
        </div>

        {records.size === 0 ? (
          <div className="card" style={{ marginTop: 16 }}>
            <Empty icon="trophy" title="Pas encore de record" text="Aucun temps dans cette sélection." />
          </div>
        ) : (
          STROKES.map((st) => {
            const rows = distancesFor(st.id, course)
              .map((d) => ({ d, rec: records.get(recordKey(d, st.id)) }))
              .filter((r) => r.rec);
            if (!rows.length) return null;
            return (
              <Section
                key={st.id}
                title={
                  <span className="hstack" style={{ gap: 8 }}>
                    <StrokeDot stroke={st.id} />
                    {st.label}
                  </span>
                }
              >
                <div className="list">
                  {rows.map(({ d, rec }) => {
                    const { swim, swimmer, age } = rec!;
                    const meet = swim.meetId ? meetsById.get(swim.meetId) : undefined;
                    const pts = pointsFor(swim, swimmer);
                    return (
                      <button key={d} className="row record-row" onClick={() => navigate(`/event/${swimmer.id}/${course}/${d}/${st.id}`)}>
                        <StrokeTag stroke={st.id} distance={d} />
                        <div className="row-body">
                          <div className="row-title">{eventLabel(d, st.id)}</div>
                          <div className="row-sub record-holder">
                            <b className={isFollowed(swimmer) ? 'followed' : undefined}>{fullName(swimmer)}</b>
                            {age != null ? ` · à ${age} ans` : ''}
                            {swimmer.former ? ' · ancien membre' : ''}
                          </div>
                          <div className="row-sub">{[formatDate(swim.date), meet?.name].filter(Boolean).join(' · ')}</div>
                          {!recordComplete(course, d, st.id) && <div className="row-sub record-partial">Meilleur temps connu : anciens membres pas encore relevés</div>}
                        </div>
                        <div className="row-end">
                          <div style={{ textAlign: 'right' }}>
                            <div className="time-big">{formatTime(swim.timeCs)}</div>
                            {pts != null && <div className="small muted tnum">{pts}&nbsp;pts</div>}
                            {swim.masters && <span className="badge masters">Masters</span>}
                          </div>
                          <Icon name="chevronRight" className="chev" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Section>
            );
          })
        )}
        {bandId !== 'all' && (
          <div className="callout" style={{ marginTop: 16 }}>
            <Icon name="info" />
            <div>
              Records par âge à prendre avec prudence : pour la plupart des anciens membres, seul leur meilleur temps à vie est
              connu, pas leurs temps à chaque âge.
            </div>
          </div>
        )}
        <div className="section-foot" style={{ marginTop: 18 }}>
          Temps de compétition des nageurs de la liste du club, d’après swimrankings.net et les résultats officiels. L’âge est celui de
          l’année de la course. Pour un nageur passé par un autre club, un temps réalisé ailleurs peut apparaître.
        </div>
      </main>
    </>
  );
}
