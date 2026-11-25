import { useMemo } from 'react';
import { useData } from '../store/store';
import { usePbFlags } from '../store/hooks';
import { Icon } from './Icon';
import { navigate } from '../router';
import { liveClubMeets, meetRecap } from '../lib/meetRecap';
import { todayISO } from '../lib/dates';

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Bandeau « En direct » : la compétition du club en cours, avec le récap de l'ESN en une ligne. */
export function LiveBanner() {
  const data = useData();
  const pbFlags = usePbFlags();
  const today = todayISO();
  const live = useMemo(() => {
    return liveClubMeets(data.meets, data.swims, data.swimmers, today).map((meet) => ({
      meet,
      r: meetRecap(meet.id, data.swims, data.swimmers, pbFlags, undefined, data.officialRecords),
    }));
  }, [data.meets, data.swims, data.swimmers, data.officialRecords, pbFlags, today]);
  if (!live.length) return null;
  return (
    <div className="live-banners">
      {live.map(({ meet, r }) => (
        <button key={meet.id} className="live-banner" onClick={() => navigate(`/meet/${meet.id}`)}>
          <span className="live-dot" aria-hidden="true" />
          <span className="live-banner-text">
            <span className="live-banner-title">
              En direct · {meet.name}
            </span>
            <span className="live-banner-sub">
              {[
                r.total ? `${r.swum}/${r.total} courses` : null,
                `${plural(r.pbs, 'record')} perso`,
                r.podiums ? plural(r.podiums, 'podium') : null,
                r.finals.length ? plural(r.finals.length, 'finale') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          <Icon name="chevronRight" className="chev" />
        </button>
      ))}
    </div>
  );
}
