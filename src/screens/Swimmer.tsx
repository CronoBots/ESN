import { useMemo, useState } from 'react';
import { actions, useData } from '../store/store';
import { fullName, swimsOf, usePbFlags } from '../store/hooks';
import { Avatar, Empty, NavBar, Row, Section, Toggle } from '../components/ui';
import { SwimRow } from '../components/SwimRow';
import { firstGroups, useProgressive } from '../components/progressive';
import { navigate } from '../router';
import { FollowButton, groupName, isFollowed } from './Club';
import { sportAge, seasonLabel, seasonOf } from '../lib/dates';
import { swimrankingsUrl } from '../lib/swimrankings';
import { achievements, chronoCompare } from '../lib/stats';
import { STROKES, courseLabel } from '../lib/events';
import type { Course, Stroke, Swim } from '../store/types';
import { findResultsNow } from './autoResults';
import { SwimmerMedals } from '../components/Medals';

export function SwimmerProfile({ id }: { id: string }) {
  const data = useData();
  const pbFlags = usePbFlags();
  const swimmer = data.swimmers.find((s) => s.id === id);
  const mine = swimsOf(data.swims, id);
  const trophies = useMemo(() => (swimmer ? achievements(mine, swimmer, data.meets, pbFlags) : []), [mine, swimmer, data.meets, pbFlags]);
  const meetsById = useMemo(() => new Map(data.meets.map((m) => [m.id, m])), [data.meets]);

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
  // Comme la liste ouverte par « Toutes les courses » : temps, forfaits et abandons (sans le programme à venir)
  const count = mine.filter((s) => s.timeCs != null || s.status !== 'OK').length;
  const isSelected = data.settings.selectedSwimmerId === id;
  const noneFollowed = !data.swimmers.some(isFollowed);
  const unlocked = trophies.filter((t) => t.unlocked).length;

  return (
    <>
      <NavBar
        title={fullName(swimmer)}
        back
        large={false}
        right={
          <>
            <FollowButton swimmer={swimmer} />
          </>
        }
      />
      <main className="page">
        <div className="center" style={{ padding: '12px 0 4px' }}>
          <Avatar swimmer={swimmer} size={110} />
          <h1 style={{ margin: '14px 0 2px', fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em' }}>{fullName(swimmer)}</h1>
          <div className="muted" style={{ fontSize: 15 }}>
            {[swimmer.nation, swimmer.club].filter(Boolean).join('\u00a0· ') || (swimmer.relation === 'child' ? 'Mon enfant' : 'Nageur suivi')}
          </div>
          {swimmer.group && (
            <div style={{ marginTop: 8 }}>
              <span className="badge first">{groupName(data.settings.club?.groups ?? [], swimmer.group)}</span>
            </div>
          )}
        </div>

        <Section>
          <div className="list">
            {(!isSelected || noneFollowed) && (
              <Row
                icon="person"
                title="Afficher sur l’accueil"
                chevron
                onClick={() => {
                  // Aucun nageur suivi : l'accueil afficherait « Quels nageurs suivre ? » ; ce nageur devient suivi
                  if (noneFollowed) actions.follow(id, true);
                  actions.selectSwimmer(id);
                  navigate('/');
                }}
              />
            )}
            {swimmer.swimrankingsId ? (
              <Row title="Profil sur swimrankings.net" href={swimrankingsUrl(swimmer.swimrankingsId)} external />
            ) : (
              null
            )}
            {age != null && <Row title="Âge" value={age} />}
            {swimmer.birthYear && <Row title="Année de naissance" value={swimmer.birthYear} />}
            <Row title="Sexe" value={swimmer.gender === 'F' ? 'Fille' : 'Garçon'} />
            <div className="field">
              <span className="label grow">{swimmer.gender === 'F' ? 'Suivre cette nageuse' : 'Suivre ce nageur'}</span>
              <Toggle
                on={swimmer.favorite || swimmer.relation === 'child'}
                onChange={(v) => actions.follow(id, v)}
                label={swimmer.gender === 'F' ? 'Suivre cette nageuse' : 'Suivre ce nageur'}
              />
            </div>
          </div>
        </Section>

        <Section>
          <div className="list">
            <Row icon="list" title="Toutes les courses" value={count} chevron onClick={() => navigate(`/swimmer/${id}/history`)} />
            <Row icon="trophy" iconBg="#ff9f0a" title="Records" chevron onClick={() => { actions.selectSwimmer(id); navigate('/records'); }} />
            <Row icon="chart" iconBg="#30d158" title="Progression" chevron onClick={() => { actions.selectSwimmer(id); navigate('/progress'); }} />
            <Row icon="target" iconBg="var(--lvl-trident)" title="Niveaux FFBN" chevron onClick={() => { actions.selectSwimmer(id); navigate('/levels'); }} />
            <Row
              icon="medal"
              iconBg="#f5a400"
              title="Trophées"
              value={`${unlocked}/${trophies.length}`}
              chevron
              onClick={() => { actions.selectSwimmer(id); navigate('/progress'); }}
            />
            <Row
              icon="sparkles"
              iconBg="#bf5af2"
              title="Résultats des compétitions"
              sub="Ajoutés automatiquement · toucher pour rechercher"
              chevron
              onClick={() => findResultsNow(swimmer.firstName, swimmer.id)}
            />
          </div>
        </Section>

        <SwimmerMedals swimmer={swimmer} swims={mine} meetsById={meetsById} pbFlags={pbFlags} />

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
      swimsOf(data.swims, id)
        .filter(
          (s) =>
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
      const season = m.get(k);
      if (season) season.push(s);
      else m.set(k, [s]);
    }
    return [...m.entries()];
  }, [list]);
  // Longue carrière (plusieurs centaines de courses) : les premières saisons tout de suite, le reste juste après
  const full = useProgressive(`${stroke}|${course}|${onlyPB}`);
  const shown = firstGroups(bySeason, ([, swims]) => swims.length, full);

  // Fiche disparue (doublon réuni à un autre nageur) : titre, retour et marges comme sur le profil
  if (!swimmer) {
    return (
      <>
        <NavBar title="Historique" back large={false} />
        <main className="page">
          <Empty icon="person" title="Nageur introuvable" />
        </main>
      </>
    );
  }

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
            <Empty icon="list" title="Aucune course" text="Modifiez les filtres pour voir d’autres courses." />
          </div>
        ) : (
          shown.map(([season, swims]) => (
            <Section key={season} title={seasonLabel(season)} action={<span className="muted small">{swims.length} courses</span>}>
              <div className="list swim-list">
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
