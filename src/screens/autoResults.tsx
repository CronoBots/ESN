import { useSyncExternalStore } from 'react';
import { overlay } from '../components/ui';
import { getState } from '../store/store';
import type { LiveSyncResult } from '../lib/liveResults';
import type { AppData, Meet } from '../store/types';
import { todayISO } from '../lib/dates';
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
export function resultsMessage(r: Pick<LiveSyncResult, 'added' | 'swimmers'>, word: 'nouveau' | 'trouvé' | 'programme'): string {
  const ids = new Set(getState().swimmers.filter((s) => s.relation === 'child' || s.favorite).map((s) => s.id));
  const mine = [...new Set(r.swimmers.filter((x) => ids.has(x.swimmer.id) || !x.swimmer.member).map((x) => x.swimmer.firstName))];
  const others = r.swimmers.filter((x) => !ids.has(x.swimmer.id) && x.swimmer.member).length;
  const s = r.added > 1 ? 's' : '';
  const head =
    word === 'programme'
      ? 'Programme de compétition ajouté'
      : word === 'nouveau'
        ? `${r.added} nouveau${r.added > 1 ? 'x' : ''} résultat${s}`
        : `${r.added} résultat${s} trouvé${s}`;
  const club = others ? `${others} nageur${others > 1 ? 's' : ''} du club` : '';
  const who = mine.length > 3 ? [...mine.slice(0, 3), `${mine.length - 3} autres`] : mine;
  const parts = [...who, club].filter(Boolean);
  return `${head} pour ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}` : parts[0]}`;
}

/**
 * Compétitions terminées (30 derniers jours) où le nageur était inscrit mais
 * dont les résultats ne sont pas encore publiés par l'organisateur.
 */
export function awaitingMeets(data: Pick<AppData, 'meets' | 'swims'>, swimmerId: string): { meet: Meet; entries: number }[] {
  const today = todayISO();
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const out: { meet: Meet; entries: number }[] = [];
  for (const meet of data.meets) {
    const end = meet.endDate ?? meet.startDate;
    if (end >= today || end < since) continue;
    const swims = data.swims.filter((s) => s.swimmerId === swimmerId && s.meetId === meet.id && s.context === 'competition');
    const planned = swims.filter((s) => s.timeCs == null && s.status === 'OK');
    if (planned.length && planned.length === swims.length) out.push({ meet, entries: planned.length });
  }
  return out.sort((a, b) => (a.meet.startDate < b.meet.startDate ? 1 : -1));
}

/** Lance tout de suite la recherche des résultats (nageur ajouté, bouton « Rechercher »). */
export async function findResultsNow(firstName?: string, swimmerId?: string) {
  overlay.toast(firstName ? `Recherche des résultats ${deName(firstName)}…` : 'Recherche des résultats…', '🔎');
  try {
    const r = await syncLive({ force: true });
    if (r.added) {
      overlay.toast(resultsMessage(r, 'trouvé'), '🎉');
      if (r.pbs) overlay.celebrate();
    } else {
      const waiting = swimmerId ? awaitingMeets(getState(), swimmerId)[0] : undefined;
      overlay.toast(
        waiting
          ? `Résultats du ${waiting.meet.name} pas encore publiés par l’organisateur : ils s’ajouteront tout seuls`
          : r.entries
            ? resultsMessage({ added: r.entries, swimmers: r.entrySwimmers }, 'programme')
            : firstName
              ? `Aucun nouveau résultat publié pour ${firstName}`
              : 'Tout est à jour',
        waiting ? '⏳' : '✓',
      );
    }
  } catch {
    overlay.toast(navigator.onLine ? 'Résultats indisponibles pour le moment, nouvel essai plus tard' : 'Pas de connexion internet', '⚠️');
  }
}
