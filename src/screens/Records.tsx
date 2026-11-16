import { useMemo, useState } from 'react';
import { actions, useData } from '../store/store';
import { fullName, hasClubMembers, mySwimmers, useSelectedSwimmer } from '../store/hooks';
import { Avatar, Empty, NavBar, Section, Segmented, StrokeDot, StrokeTag } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate } from '../router';
import { COURSES, STROKES, STROKE_BY_ID, distancesFor, eventLabel, courseLabel } from '../lib/events';
import { countsForRecords, pointsFor, chronoCompare } from '../lib/stats';
import { formatDate, seasonLabel, seasonOf, todayISO, sportAge } from '../lib/dates';
import { formatTime } from '../lib/time';
import type { Course, Gender, Stroke, Swim, Swimmer } from '../store/types';
import { findResultsNow } from './autoResults';
import { deName } from '../lib/text';
import { groupName } from './Club';

export function SwimmerChips({ swimmer }: { swimmer: Swimmer }) {
  const data = useData();
  const swimmers = mySwimmers(data.swimmers, swimmer);
  if (swimmers.length < 2) return null;
  return (
    <div className="chips" style={{ marginBottom: 12 }}>
      {swimmers.map((s) => (
        <button key={s.id} className={`chip${s.id === swimmer.id ? ' active' : ''}`} onClick={() => actions.selectSwimmer(s.id)}>
          <Avatar swimmer={s} size={22} />
          {s.firstName}
        </button>
      ))}
    </div>
  );
}

export function Records() {
  const data = useData();
  const swimmer = useSelectedSwimmer();
  const [course, setCourse] = useState<Course>(data.settings.defaultCourse);
  const [scope, setScope] = useState<'all' | 'season'>('all');
  const include = data.settings.includeTraining;
  const season = seasonOf(todayISO());
  const meetsById = useMemo(() => new Map(data.meets.map((m) => [m.id, m])), [data.meets]);

  const bests = useMemo(() => {
    const map = new Map<string, { best: Swim; count: number }>();
    if (!swimmer) return map;
    for (const s of data.swims) {
      if (s.swimmerId !== swimmer.id || s.course !== course || !countsForRecords(s, include)) continue;
      if (scope === 'season' && seasonOf(s.date) !== season) continue;
      const k = `${s.distance}-${s.stroke}`;
      const cur = map.get(k);
      if (!cur) map.set(k, { best: s, count: 1 });
      else {
        cur.count++;
        if (s.timeCs! < cur.best.timeCs! || (s.timeCs === cur.best.timeCs && chronoCompare(s, cur.best) < 0)) cur.best = s;
      }
    }
    return map;
  }, [data.swims, swimmer, course, include, scope, season]);

  // Compteurs pour les onglets de bassin
  const courseCounts = useMemo(() => {
    const c: Record<Course, Set<string>> = { SCM: new Set(), LCM: new Set() };
    if (swimmer)
      for (const s of data.swims)
        if (s.swimmerId === swimmer.id && countsForRecords(s, include)) c[s.course].add(`${s.distance}-${s.stroke}`);
    return c;
  }, [data.swims, swimmer, include]);

  return (
    <>
      <NavBar
        title="Records"
        subtitle={swimmer ? `Meilleurs temps ${deName(swimmer.firstName)}` : undefined}
        right={
          <button className="icon-btn" onClick={() => navigate('/rankings')} aria-label="Classements">
            <Icon name="ranking" />
          </button>
        }
      />
      <main className="page">
        {!swimmer ? (
          <Empty icon="trophy" title="Aucun nageur" text="Ajoutez un nageur pour voir ses records." />
        ) : (
          <>
            <SwimmerChips swimmer={swimmer} />
            <div className="stack" style={{ gap: 8 }}>
              <Segmented
                value={course}
                onChange={setCourse}
                options={COURSES.map((c) => ({
                  id: c.id,
                  label: `${c.long.split(' (')[0]} · ${courseCounts[c.id].size}`,
                }))}
              />
              <Segmented
                value={scope}
                onChange={setScope}
                options={[
                  { id: 'all', label: 'Meilleurs à vie' },
                  { id: 'season', label: seasonLabel(season) },
                ]}
              />
            </div>

            {bests.size === 0 ? (
              <div className="card" style={{ marginTop: 16 }}>
                <Empty
                  icon="trophy"
                  title={`Aucun temps en ${courseLabel(course)}`}
                  text={scope === 'season' ? 'Aucune course cette saison dans ce bassin.' : 'Les records apparaissent dès que des résultats sont publiés.'}
                  action={
                    <button className="btn small" onClick={() => findResultsNow(swimmer.firstName, swimmer.id)}>
                      <Icon name="sparkles" /> Rechercher ses résultats
                    </button>
                  }
                />
              </div>
            ) : (
              STROKES.map((st) => {
                const rows = distancesFor(st.id, course)
                  .map((d) => ({ d, entry: bests.get(`${d}-${st.id}`) }))
                  .filter((r) => r.entry);
                if (!rows.length) return null;
                return (
                  <Section key={st.id} title={<span className="hstack" style={{ gap: 8 }}><StrokeDot stroke={st.id} />{st.label}</span>}>
                    <div className="list">
                      {rows.map(({ d, entry }) => {
                        const s = entry!.best;
                        const pts = pointsFor(s, swimmer);
                        const meet = s.meetId ? meetsById.get(s.meetId) : undefined;
                        return (
                          <button
                            key={d}
                            className="row"
                            onClick={() => navigate(`/event/${swimmer.id}/${course}/${d}/${st.id}`)}
                          >
                            <StrokeTag stroke={st.id} distance={d} />
                            <div className="row-body">
                              <div className="row-title">{eventLabel(d, st.id)}</div>
                              <div className="row-sub">
                                {formatDate(s.date)}
                                {entry!.count > 1 ? ` · ${entry!.count} courses` : ''}
                              </div>
                              {(meet || s.context === 'training') && (
                                <div className="row-sub">{meet ? meet.name : 'Entraînement'}</div>
                              )}
                            </div>
                            <div className="row-end">
                              <div style={{ textAlign: 'right' }}>
                                <div className="time-big">{formatTime(s.timeCs)}</div>
                                {pts != null && <div className="small muted tnum">{pts} pts</div>}
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
            <div className="section-foot" style={{ marginTop: 18 }}>
              Points World Aquatics : officiels pour les temps importés de swimrankings.net, calculés (indicatifs) pour les temps saisis.
              {!include && ' Les temps d’entraînement ne comptent pas dans les records (modifiable dans Réglages).'}
            </div>
          </>
        )}
      </main>
    </>
  );
}

/* ======================================================================== */
/* Classements                                                               */
/* ======================================================================== */

export function Rankings() {
  const data = useData();
  const selected = useSelectedSwimmer();
  const [stroke, setStroke] = useState<Stroke>('FREE');
  const [distance, setDistance] = useState(100);
  const [course, setCourse] = useState<Course>(data.settings.defaultCourse);
  const [gender, setGender] = useState<'all' | Gender>('all');
  const [sameYear, setSameYear] = useState(false);
  const groups = data.settings.club?.groups ?? [];
  const clubMode = hasClubMembers(data.swimmers);
  const club = clubMode && groups.length > 0;
  const [group, setGroup] = useState<string>(() => (club && selected?.group ? selected.group : 'all'));
  const include = data.settings.includeTraining;
  const distances = distancesFor(stroke, course);
  const dist = distances.includes(distance) ? distance : distances[0];

  const ranking = useMemo(() => {
    const rows: { swimmer: Swimmer; best: Swim }[] = [];
    for (const sw of data.swimmers) {
      if (gender !== 'all' && sw.gender !== gender) continue;
      if (sameYear && selected?.birthYear && sw.birthYear !== selected.birthYear) continue;
      if (club && group !== 'all' && sw.group !== group) continue;
      let best: Swim | undefined;
      for (const s of data.swims) {
        if (s.swimmerId !== sw.id || s.course !== course || s.distance !== dist || s.stroke !== stroke) continue;
        if (!countsForRecords(s, include)) continue;
        if (!best || s.timeCs! < best.timeCs!) best = s;
      }
      if (best) rows.push({ swimmer: sw, best });
    }
    return rows.sort((a, b) => a.best.timeCs! - b.best.timeCs!);
  }, [data.swimmers, data.swims, gender, sameYear, selected, course, dist, stroke, include, club, group]);

  const leader = ranking[0]?.best.timeCs;

  return (
    <>
      <NavBar
        title="Classements"
        subtitle={club ? 'Meilleurs temps des nageurs du club, par groupe' : clubMode ? 'Meilleurs temps des nageurs du club' : 'Entre vos nageurs et les nageurs suivis'}
        back="/records"
      />
      <main className="page">
        <div className="card" style={{ padding: '12px 12px 8px' }}>
          {club && (
            <div style={{ marginBottom: 10 }}>
              <Segmented
                value={group}
                onChange={setGroup}
                options={[{ id: 'all', label: 'Club' }, ...groups.map((g) => ({ id: g.id, label: g.name }))]}
              />
            </div>
          )}
          <div className="chips">
            {STROKES.map((s) => (
              <button key={s.id} className={`chip${stroke === s.id ? ' active' : ''}`} onClick={() => setStroke(s.id)}>
                <StrokeDot stroke={s.id} />
                {s.label}
              </button>
            ))}
          </div>
          <div className="chips" style={{ marginTop: 8 }}>
            {distances.map((d) => (
              <button key={d} className={`chip${dist === d ? ' active' : ''}`} onClick={() => setDistance(d)}>
                {d} m
              </button>
            ))}
          </div>
          <div className="stack" style={{ gap: 8, marginTop: 10 }}>
            <Segmented value={course} onChange={setCourse} options={COURSES.map((c) => ({ id: c.id, label: `Bassin ${c.label}` }))} />
            <Segmented
              value={gender}
              onChange={setGender}
              options={[
                { id: 'all', label: 'Tous' },
                { id: 'F', label: 'Filles' },
                { id: 'M', label: 'Garçons' },
              ]}
            />
          </div>
          {selected?.birthYear && (
            <label className="hstack between" style={{ padding: '12px 4px 4px', fontSize: 15 }}>
              <span>Même année que {selected.firstName} ({selected.birthYear})</span>
              <button
                type="button"
                role="switch"
                aria-checked={sameYear}
                className={`toggle${sameYear ? ' on' : ''}`}
                onClick={() => setSameYear((v) => !v)}
              />
            </label>
          )}
        </div>

        <Section title={`${eventLabel(dist, stroke)} · ${courseLabel(course)}`}>
          {ranking.length === 0 ? (
            <div className="card">
              <Empty
                icon="ranking"
                title="Pas encore de classement"
                text={
                  clubMode
                    ? 'Aucun nageur de cette sélection n’a encore de temps sur cette épreuve.'
                    : 'Ajoutez des nageurs suivis (coéquipiers, amis) dans Réglages pour comparer les meilleurs temps.'
                }
              />
            </div>
          ) : (
            <div className="list">
              {ranking.map((r, i) => {
                const age = sportAge(r.swimmer.birthYear);
                return (
                  <button key={r.swimmer.id} className="row" onClick={() => navigate(`/event/${r.swimmer.id}/${course}/${dist}/${stroke}`)}>
                    <span style={{ width: 28, textAlign: 'center', fontWeight: 800, fontSize: i < 3 ? 22 : 16 }} className="tnum">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                    </span>
                    <Avatar swimmer={r.swimmer} size={38} />
                    <div className="row-body">
                      <div className="row-title" style={{ fontWeight: r.swimmer.relation === 'child' ? 700 : 400 }}>
                        {fullName(r.swimmer)}
                      </div>
                      <div className="row-sub">
                        {[age != null ? `${age}\u00a0ans` : null, club ? groupName(groups, r.swimmer.group) : clubMode ? r.swimmer.birthYear : r.swimmer.club]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                      <div className="row-sub">{formatDate(r.best.date)}</div>
                    </div>
                    <div className="row-end" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                      <span className="time-big">{formatTime(r.best.timeCs)}</span>
                      {i > 0 && leader != null && <span className="small muted tnum">+{formatTime(r.best.timeCs! - leader)}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Section>
        {STROKE_BY_ID[stroke] && !clubMode && (
          <div className="section-foot">
            Astuce : importez la page swimrankings.net d’un coéquipier en tant que « nageur suivi » pour l’ajouter au classement.
          </div>
        )}
      </main>
    </>
  );
}
