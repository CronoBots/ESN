import { useMemo } from 'react';
import type { Meet, Swim, Swimmer } from '../store/types';
import type { PbInfo } from '../lib/stats';
import { chronoCompare } from '../lib/stats';
import { countedMedalSwims, MEDALS_SINCE, medalCount, placesKnownSince, SHOW_MEDAL_COUNTS, type MedalCount } from '../lib/medals';
import { seasonOf, seasonShort } from '../lib/dates';
import { Section } from './ui';
import { SwimRow } from './SwimRow';

const KINDS = [
  { id: 'gold', label: 'Or', place: '1re place' },
  { id: 'silver', label: 'Argent', place: '2e place' },
  { id: 'bronze', label: 'Bronze', place: '3e place' },
] as const;

/** « ● 2  ● 1  ● 3 » : or, argent, bronze. */
export function MedalTally({ count }: { count: MedalCount }) {
  return (
    <span className="medal-tally" aria-label={`${count.gold} or, ${count.silver} argent, ${count.bronze} bronze`}>
      {KINDS.map((k) => (
        <span key={k.id} className={`medal-pill medal-${k.id}`}>
          <span className="medal-dot" aria-hidden="true" />
          {count[k.id]}
        </span>
      ))}
    </span>
  );
}

/** Fiche d'un membre actif : médailles depuis MEDALS_SINCE (pas pour un ancien : seuls ses temps comptent). */
export function SwimmerMedals({
  swimmer,
  swims,
  meetsById,
  pbFlags,
}: {
  swimmer: Swimmer;
  swims: Swim[];
  meetsById: Map<string, Meet>;
  pbFlags: Map<string, PbInfo>;
}) {
  const { list, count, since, older } = useMemo(() => {
    const list = countedMedalSwims(swims, swimmer.id).sort(chronoCompare).reverse();
    const counted = swims.filter((s) => s.date >= MEDALS_SINCE);
    // Courses en compétition plus anciennes : leurs classements ne sont pas encore tous relevés
    const older = swims.some((s) => s.swimmerId === swimmer.id && s.context === 'competition' && s.date < MEDALS_SINCE);
    return { list, count: medalCount(list), since: placesKnownSince(counted, swimmer.id), older };
  }, [swims, swimmer.id]);
  if (!SHOW_MEDAL_COUNTS || swimmer.former || !since) return null;
  return (
    <Section title="Médailles" action={count.total ? <span className="muted small">{count.total}</span> : undefined}>
      <div className="tiles three">
        {KINDS.map((k) => (
          <div key={k.id} className={`tile medal-tile medal-${k.id}`}>
            <div className="tile-label">
              <span className="medal-dot" aria-hidden="true" /> {k.label}
            </div>
            <div className="tile-value">{count[k.id]}</div>
            <div className="tile-sub">{k.place}</div>
          </div>
        ))}
      </div>
      {list.length > 0 && (
        <div className="list swim-list" style={{ marginTop: 12 }}>
          {list.slice(0, 5).map((s) => (
            <SwimRow key={s.id} swim={s} pb={pbFlags.get(s.id)} meet={s.meetId ? meetsById.get(s.meetId) : undefined} />
          ))}
        </div>
      )}
      <div className="section-foot">
        {list.length > 5 ? `Les 5 dernières sur ${list.length}. ` : ''}
        Place dans sa catégorie, telle que publiée dans les résultats
        {older ? `, depuis la saison ${seasonShort(seasonOf(MEDALS_SINCE))} : les classements plus anciens ne sont pas encore tous relevés.` : '.'}
      </div>
    </Section>
  );
}
