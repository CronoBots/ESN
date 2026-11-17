import { useMemo } from 'react';
import type { Meet, Swim, Swimmer } from '../store/types';
import type { PbInfo } from '../lib/stats';
import { chronoCompare } from '../lib/stats';
import { medalCount, medalSwims, placesKnownSince, SHOW_MEDAL_COUNTS, type MedalCount } from '../lib/medals';
import { formatDate } from '../lib/dates';
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

/** Fiche du nageur : médailles des compétitions dont le classement est connu. */
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
  const { list, count, since } = useMemo(() => {
    const list = medalSwims(swims, swimmer.id).sort(chronoCompare).reverse();
    return { list, count: medalCount(list), since: placesKnownSince(swims, swimmer.id) };
  }, [swims, swimmer.id]);
  if (!SHOW_MEDAL_COUNTS || !since) return null;
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
        Place dans sa catégorie, pour les compétitions suivies par l’application depuis le {formatDate(since)}. L’historique
        swimrankings ne donne pas les classements.
      </div>
    </Section>
  );
}
