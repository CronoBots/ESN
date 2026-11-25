import { useMemo, useState } from 'react';
import { useData } from '../store/store';
import { fullName, hasClubMembers, useSelectedSwimmer } from '../store/hooks';
import { Empty, NavBar, Section, Segmented, StrokeDot, StrokeTag } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate } from '../router';
import { COURSES, STROKES, courseLabel, distancesFor, eventLabel } from '../lib/events';
import { AGE_BANDS, ageAt, bandForAge, clubRecords, recordComplete, recordKey, shortcutSwimmer } from '../lib/clubRecords';
import { OFFICIAL_SECTIONS, officialStandings, type OfficialStanding } from '../lib/officialRecords';
import { formatDate, swimDate } from '../lib/dates';
import { formatTime } from '../lib/time';
import { pointsFor } from '../lib/stats';
import type { Course, Gender } from '../store/types';
import { ensureClub, isFollowed } from './Club';

/** Vue : liste officielle du club (tous bassins), ou meilleurs temps relevés d'un bassin. */
type View = 'list' | Course;

/**
 * Records du club. Avec la liste officielle publiée par le club : ses records par catégorie, mis à jour par les
 * courses des membres nagées depuis sa date. À côté : meilleur temps relevé de tous les nageurs de l'ESN (actuels et
 * anciens) sur chaque épreuve, par bassin, filles ou garçons, tous âges ou à un âge donné.
 */
export function ClubRecords() {
  const data = useData();
  const official = data.officialRecords;
  // Nageur suivi ou ajouté à la main seulement (pas un nageur du club pris par défaut quand on n'en suit aucun)
  const selected = shortcutSwimmer(useSelectedSwimmer());
  const [view, setView] = useState<View>(official ? 'list' : data.settings.defaultCourse);
  const shown: View = view === 'list' && !official ? data.settings.defaultCourse : view;
  const course: Course = shown === 'list' ? data.settings.defaultCourse : shown;
  const [gender, setGender] = useState<Gender>(selected?.gender ?? 'F');
  const [bandId, setBandId] = useState('all');
  const [sectionId, setSectionId] = useState('all');
  const band = AGE_BANDS.find((b) => b.id === bandId) ?? AGE_BANDS[0];
  const meetsById = useMemo(() => new Map(data.meets.map((m) => [m.id, m])), [data.meets]);
  const records = useMemo(
    () => (shown === 'list' ? new Map() : clubRecords(data.swims, data.swimmers, { course, gender, band })),
    [data.swims, data.swimmers, shown, course, gender, band],
  );
  const standings = useMemo(
    () => (shown === 'list' && official ? officialStandings(official, data.swims, data.swimmers, gender, sectionId) : []),
    [shown, official, data.swims, data.swimmers, gender, sectionId],
  );
  // Raccourci vers l'âge du nageur suivi cette année (« 12 ans »)
  const ageNow = selected ? ageAt({ date: `${new Date().getFullYear()}-01-01` }, selected) : undefined;
  const mine = selected?.gender === gender ? bandForAge(ageNow) : undefined;
  const mySection = selected?.gender === gender ? OFFICIAL_SECTIONS.find((s) => s.id !== 'all' && s.test(ageNow)) : undefined;

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

  const asOf = official ? formatDate(official.asOf) : '';
  return (
    <>
      <NavBar
        title="Records du club"
        subtitle={shown === 'list' ? `Liste officielle du club au ${asOf}, et records battus depuis` : 'Meilleurs temps relevés des nageurs de l’ESN, actuels et anciens'}
        back="/records"
      />
      <main className="page">
        <div className="stack" style={{ gap: 8 }}>
          <Segmented
            value={shown}
            onChange={setView}
            ariaLabel="Records"
            options={[
              ...(official ? [{ id: 'list' as View, label: 'Liste du club' }] : []),
              ...COURSES.map((c) => ({ id: c.id as View, label: official ? `Relevés ${courseLabel(c.id)}` : c.long.split(' (')[0] })),
            ]}
          />
          <Segmented
            value={gender}
            onChange={setGender}
            options={[
              { id: 'F', label: 'Filles' },
              { id: 'M', label: 'Garçons' },
            ]}
          />
        </div>
        {shown === 'list' ? (
          <div className="chips" style={{ marginTop: 10 }} role="group" aria-label="Catégorie">
            {OFFICIAL_SECTIONS.map((s) => (
              <button key={s.id} className={`chip${sectionId === s.id ? ' active' : ''}`} aria-pressed={sectionId === s.id} onClick={() => setSectionId(s.id)}>
                {s.short}
                {mySection?.id === s.id && <span className="count">{selected!.firstName}</span>}
              </button>
            ))}
          </div>
        ) : (
          <div className="chips" style={{ marginTop: 10 }} role="group" aria-label="Âge">
            {AGE_BANDS.map((b) => (
              <button key={b.id} className={`chip${bandId === b.id ? ' active' : ''}`} aria-pressed={bandId === b.id} onClick={() => setBandId(b.id)}>
                {b.short}
                {mine?.id === b.id && <span className="count">{selected!.firstName}</span>}
              </button>
            ))}
          </div>
        )}

        {shown === 'list' ? (
          <OfficialList standings={standings} />
        ) : records.size === 0 ? (
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
                            {age != null ? ` · à ${age} ans` : ''}
                            {swimmer.former ? ' · ancien membre' : ''}
                          </div>
                          <div className="row-sub">{[swimDate(swim), meet?.name].filter(Boolean).join(' · ')}</div>
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
        {shown !== 'list' && bandId !== 'all' && (
          <div className="callout" style={{ marginTop: 16 }}>
            <Icon name="info" />
            <div>
              Meilleurs temps relevés : pour la plupart des anciens membres, seul leur meilleur temps à vie est connu, pas leurs temps à
              chaque âge.{official ? ' Les records officiels sont dans « Liste du club ».' : ''}
            </div>
          </div>
        )}
        <div className="section-foot" style={{ marginTop: 18 }}>
          {shown === 'list' ? (
            <>
              Liste officielle des records du club au {asOf} (site du club), tous bassins. Depuis cette date, une course plus rapide d’un
              membre devient le record. L’âge est celui de l’année de la course.
            </>
          ) : (
            <>
              Temps de compétition des nageurs de la liste du club, d’après swimrankings.net et les résultats officiels. L’âge est celui de
              l’année de la course. Pour un nageur passé par un autre club, un temps réalisé ailleurs peut apparaître.
            </>
          )}
        </div>
      </main>
    </>
  );
}

/** Records d'une catégorie de la liste officielle, par nage. */
function OfficialList({ standings }: { standings: OfficialStanding[] }) {
  if (!standings.length)
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <Empty icon="trophy" title="Pas de record" text="La liste du club n’a pas de record dans cette catégorie." />
      </div>
    );
  return (
    <>
      {STROKES.map((st) => {
        const rows = standings.filter((r) => r.stroke === st.id);
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
              {rows.map((r) => (
                <OfficialRow key={`${r.distance}-${r.stroke}`} row={r} />
              ))}
            </div>
          </Section>
        );
      })}
    </>
  );
}

function OfficialRow({ row }: { row: OfficialStanding }) {
  const { distance, stroke, official, holder, newer } = row;
  // Record battu depuis la liste : la course du membre, et l'ancien record de la liste en dessous
  if (newer) {
    const { swim, swimmer, age } = newer;
    return (
      <button className="row record-row" onClick={() => navigate(`/event/${swimmer.id}/${swim.course}/${distance}/${stroke}`)}>
        <StrokeTag stroke={stroke} distance={distance} />
        <div className="row-body">
          <div className="row-title">{eventLabel(distance, stroke)}</div>
          <div className="row-sub record-holder">
            <b className={isFollowed(swimmer) ? 'followed' : undefined}>{fullName(swimmer)}</b>
            {age != null ? ` · à ${age} ans` : ''}
          </div>
          <div className="row-sub">{[swimDate(swim), courseLabel(swim.course)].join(' · ')}</div>
          {official && (
            <div className="row-sub muted">
              Ancien record : {formatTime(official.timeCs)} · {official.holder}
              {official.date ? `, ${official.date.slice(0, 4)}` : ''}
            </div>
          )}
        </div>
        <div className="row-end">
          <div style={{ textAlign: 'right' }}>
            <div className="time-big">{formatTime(swim.timeCs)}</div>
            <span className="badge pb">Nouveau</span>
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>
      </button>
    );
  }
  if (!official) return null;
  const where = [official.place, official.course ? courseLabel(official.course) : undefined].filter(Boolean).join(' · ');
  const body = (
    <>
      <StrokeTag stroke={stroke} distance={distance} />
      <div className="row-body">
        <div className="row-title">{eventLabel(distance, stroke)}</div>
        <div className="row-sub record-holder">
          <b className={holder && isFollowed(holder) ? 'followed' : undefined}>{holder ? fullName(holder) : official.holder}</b>
          {holder?.former ? ' · ancien membre' : ''}
        </div>
        {(where || official.date) && <div className="row-sub">{[official.date ? formatDate(official.date) : '', where].filter(Boolean).join(' · ')}</div>}
      </div>
      <div className="row-end">
        <div style={{ textAlign: 'right' }}>
          {/* Liste officielle du club : affichée telle quelle, sans mention de vérification (choix du club) */}
          <div className="time-big">{formatTime(official.timeCs)}</div>
        </div>
        {holder && official.course && <Icon name="chevronRight" className="chev" />}
      </div>
    </>
  );
  // Détenteur connu et bassin indiqué : on ouvre sa fiche de l'épreuve
  return holder && official.course ? (
    <button className="row record-row" onClick={() => navigate(`/event/${holder.id}/${official.course}/${distance}/${stroke}`)}>
      {body}
    </button>
  ) : (
    <div className="row record-row">{body}</div>
  );
}
