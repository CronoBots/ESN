import { useSyncExternalStore } from 'react';
import { overlay } from '../components/ui';
import { syncLive, syncStatus } from '../lib/liveResults';

export function useSyncStatus() {
  return useSyncExternalStore(
    (cb) => syncStatus.subscribe(cb),
    () => syncStatus.value,
  );
}

/** Lance tout de suite la recherche des résultats (nageur ajouté, bouton « Rechercher »). */
export async function findResultsNow(firstName?: string) {
  overlay.toast(firstName ? `Recherche des résultats de ${firstName}…` : 'Recherche des résultats…', '🔎');
  try {
    const r = await syncLive({ force: true });
    if (r.added) {
      const who = [...new Set(r.swimmers.map((x) => x.swimmer.firstName))].join(', ');
      overlay.toast(`${r.added} résultat${r.added > 1 ? 's' : ''} trouvé${r.added > 1 ? 's' : ''} pour ${who}`, '🎉');
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
