import { useSyncExternalStore } from 'react';
import { overlay } from '../components/ui';
import { getState } from '../store/store';
import type { LiveSyncResult } from '../lib/liveResults';
import { syncLive, syncStatus } from '../lib/liveResults';
import { deName } from '../lib/text';

export function useSyncStatus() {
  return useSyncExternalStore(
    (cb) => syncStatus.subscribe(cb),
    () => syncStatus.value,
  );
}

/**
 * « 12 nouveaux résultats pour Emma et 18 nageurs du club » : les prénoms de mes
 * nageurs d'abord, les autres nageurs du club comptés.
 */
export function resultsMessage(r: Pick<LiveSyncResult, 'added' | 'swimmers'>, word: 'nouveau' | 'trouvé'): string {
  const ids = new Set(getState().swimmers.filter((s) => s.relation === 'child' || s.favorite).map((s) => s.id));
  const mine = [...new Set(r.swimmers.filter((x) => ids.has(x.swimmer.id) || !x.swimmer.member).map((x) => x.swimmer.firstName))];
  const others = r.swimmers.filter((x) => !ids.has(x.swimmer.id) && x.swimmer.member).length;
  const s = r.added > 1 ? 's' : '';
  const head = word === 'nouveau' ? `${r.added} nouveau${r.added > 1 ? 'x' : ''} résultat${s}` : `${r.added} résultat${s} trouvé${s}`;
  const club = others ? `${others} nageur${others > 1 ? 's' : ''} du club` : '';
  const who = mine.length > 3 ? [...mine.slice(0, 3), `${mine.length - 3} autres`] : mine;
  const parts = [...who, club].filter(Boolean);
  return `${head} pour ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}` : parts[0]}`;
}

/** Lance tout de suite la recherche des résultats (nageur ajouté, bouton « Rechercher »). */
export async function findResultsNow(firstName?: string) {
  overlay.toast(firstName ? `Recherche des résultats ${deName(firstName)}…` : 'Recherche des résultats…', '🔎');
  try {
    const r = await syncLive({ force: true });
    if (r.added) {
      overlay.toast(resultsMessage(r, 'trouvé'), '🎉');
      if (r.pbs) overlay.celebrate();
    } else {
      overlay.toast(firstName ? `Pas de nouveau résultat pour ${firstName} : ils arriveront après sa prochaine compétition` : 'Tout est à jour', '✓');
    }
  } catch {
    overlay.toast(navigator.onLine ? 'Résultats indisponibles pour le moment, nouvel essai plus tard' : 'Pas de connexion internet', '⚠️');
  }
}

/** Bandeau affiché pendant la recherche des résultats. */
export function SyncBanner() {
  const st = useSyncStatus();
  if (!st) return null;
  const pct = st.total ? Math.round((st.done / st.total) * 100) : 5;
  return (
    <div className="card pad" style={{ marginTop: 14 }} role="status" aria-live="polite">
      <div className="hstack" style={{ gap: 8, fontWeight: 600, fontSize: 15 }}>
        <span aria-hidden="true">🔎</span>
        Recherche des résultats…
        <span className="muted small" style={{ marginLeft: 'auto', fontWeight: 500 }}>
          {st.total ? `${st.done}/${st.total} compétitions` : ''}
        </span>
      </div>
      <div className="meter" style={{ marginTop: 10, height: 6 }}>
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
