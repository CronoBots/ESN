import { useMemo, useState } from 'react';
import { actions, useData } from '../store/store';
import { fullName, usePbFlags } from '../store/hooks';
import { Avatar, Empty, NavBar, Row, Section } from '../components/ui';
import { Icon } from '../components/Icon';
import { SwimRow } from '../components/SwimRow';
import { navigate } from '../router';
import { sportAge, seasonLabel, seasonOf } from '../lib/dates';
import { swimrankingsUrl } from '../lib/swimrankings';
import { achievements, chronoCompare } from '../lib/stats';
import { STROKES, courseLabel } from '../lib/events';
import { openSwimmerForm } from './forms';
import type { Course, Stroke, Swim } from '../store/types';
import { TrophyGrid } from './Progression';

export function SwimmerProfile({ id }: { id: string }) {
  const data = useData();
  const pbFlags = usePbFlags();
  const swimmer = data.swimmers.find((s) => s.id === id);
  const trophies = useMemo(
    () => (swimmer ? achievements(data.swims, swimmer, data.goals, data.meets, pbFlags) : []),
    [data.swims, swimmer, data.goals, data.meets, pbFlags],
  );

  if (!swimmer) {
    return (
      <>
        <NavBar title="Nageur" back large={false} />
        <main className="page">
          <Empty icon="person" title="Nageur introuvable" />
        </main>
      </>
    );
  }
  const age = sportAge(swimmer.birthYear);
  const count = data.swims.filter((s) => s.swimmerId === id && s.timeCs != null).length;
  const isSelected = data.settings.selectedSwimmerId === id;
  const unlocked = trophies.filter((t) => t.unlocked).length;

  return (
    <>
      <NavBar
        title={fullName(swimmer)}
        back
        large={false}
        right={
          <>
            <button
              className="icon-btn"
              aria-label={swimmer.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              onClick={() => actions.updateSwimmer(id, { favorite: !swimmer.favorite })}
            >
              <Icon name={swimmer.favorite ? 'heartFill' : 'heart'} />
            </button>
            <button className="icon-btn" onClick={() => openSwimmerForm(swimmer)}>
              Modifier
            </button>
          </>
        }
      />
      <main className="page">
        <div className="center" style={{ padding: '12px 0 4px' }}>
          <Avatar swimmer={swimmer} size={110} />
          <h1 style={{ margin: '14px 0 2px', fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em' }}>{fullName(swimmer)}</h1>
          <div style={{ fontWeight: 500 }}>
            {[swimmer.nation, swimmer.club].filter(Boolean).join(' - ') || (swimmer.relation === 'child' ? 'Mon enfant' : 'Nageur suivi')}
          </div>
        </div>

        <Section>
          <div className="list">
            {!isSelected && (
              <Row
                icon="person"
                title="Afficher sur l’accueil"
                chevron
                onClick={() => {
                  actions.selectSwimmer(id);
                  navigate('/');
                }}
              />
            )}
            {swimmer.swimrankingsId ? (
              <Row title="Profil sur swimrankings.net" href={swimrankingsUrl(swimmer.swimrankingsId)} external />
            ) : (
              <Row title="Lier le profil swimrankings.net" accent chevron onClick={() => openSwimmerForm(swimmer)} />
            )}
            {age != null && <Row title="Âge" value={age} />}
            {swimmer.birthYear && <Row title="Année de naissance" value={swimmer.birthYear} />}
            <Row title="Sexe" value={swimmer.gender === 'F' ? 'Fille' : 'Garçon'} />
            <Row title="Type" value={swimmer.relation === 'child' ? 'Mon enfant' : 'Nageur suivi'} />
          </div>
        </Section>

        <Section>
          <div className="list">
            <Row icon="list" title="Toutes les courses" value={count} chevron onClick={() => navigate(`/swimmer/${id}/history`)} />
            <Row icon="trophy" iconBg="#ff9f0a" title="Records" chevron onClick={() => { actions.selectSwimmer(id); navigate('/records'); }} />
            <Row icon="chart" iconBg="#30d158" title="Progression" chevron onClick={() => { actions.selectSwimmer(id); navigate('/progress'); }} />
            <Row icon="download" iconBg="#5e5ce6" title="Importer depuis swimrankings.net" chevron onClick={() => navigate(`/import?swimmer=${id}`)} />
          </div>
        </Section>

        <Section title="Trophées" action={<span className="muted small">{unlocked}/{trophies.length}</span>}>
          <TrophyGrid trophies={trophies} />
        </Section>
      </main>
    </>
  );
}

/* ======================================================================== */
/* Historique complet                                                         */
/* ======================================================================== */

export function SwimmerHistory({ id }: { id: string }) {
  const data = useData();
  const pbFlags = usePbFlags();
  const swimmer = data.swimmers.find((s) => s.id === id);
  const [stroke, setStroke] = useState<Stroke | 'ALL'>('ALL');
  const [course, setCourse] = useState<Course | 'ALL'>('ALL');
  const [onlyPB, setOnlyPB] = useState(false);
  const meetsById = useMemo(() => new Map(data.meets.map((m) => [m.id, m])), [data.meets]);

  const list = useMemo(
    () =>
      data.swims
        .filter(
          (s) =>
            s.swimmerId === id &&
            (s.timeCs != null || s.status !== 'OK') &&
            (stroke === 'ALL' || s.stroke === stroke) &&
            (course === 'ALL' || s.course === course) &&
            (!onlyPB || pbFlags.get(s.id)?.isPB),
        )
        .sort(chronoCompare)
        .reverse(),
    [data.swims, id, stroke, course, onlyPB, pbFlags],
  );

  const bySeason = useMemo(() => {
    const m = new Map<string, Swim[]>();
    for (const s of list) {
      const k = seasonOf(s.date);
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()];
  }, [list]);

  if (!swimmer) return <Empty icon="person" title="Nageur introuvable" />;

  return (
    <>
      <NavBar title="Historique" subtitle={fullName(swimmer)} back={`/swimmer/${id}`} />
      <main className="page">
        <div className="chips">
          <button className={`chip${stroke === 'ALL' ? ' active' : ''}`} onClick={() => setStroke('ALL')}>
            Toutes
          </button>
          {STROKES.map((s) => (
            <button key={s.id} className={`chip${stroke === s.id ? ' active' : ''}`} onClick={() => setStroke(s.id)}>
              <span className="stroke-dot" style={{ background: `var(${s.colorVar})` }} />
              {s.label}
            </button>
          ))}
        </div>
        <div className="chips" style={{ marginTop: 8 }}>
          {(['ALL', 'SCM', 'LCM'] as const).map((c) => (
            <button key={c} className={`chip${course === c ? ' active' : ''}`} onClick={() => setCourse(c)}>
              {c === 'ALL' ? 'Tous bassins' : courseLabel(c)}
            </button>
          ))}
          <button className={`chip${onlyPB ? ' active' : ''}`} onClick={() => setOnlyPB((v) => !v)}>
            🏆 Records uniquement
          </button>
        </div>
        {list.length === 0 ? (
          <div className="card" style={{ marginTop: 16 }}>
            <Empty icon="list" title="Aucune course" text="Modifiez les filtres ou ajoutez un temps." />
          </div>
        ) : (
          bySeason.map(([season, swims]) => (
            <Section key={season} title={seasonLabel(season)} action={<span className="muted small">{swims.length} courses</span>}>
              <div className="list">
                {swims.map((s) => (
                  <SwimRow key={s.id} swim={s} pb={pbFlags.get(s.id)} meet={s.meetId ? meetsById.get(s.meetId) : undefined} />
                ))}
              </div>
            </Section>
          ))
        )}
      </main>
    </>
  );
}
