import { useState } from 'react';
import { actions, getState } from '../store/store';
import { Avatar, overlay, Segmented, SheetLayout } from '../components/ui';
import { Icon } from '../components/Icon';
import { CLUB } from '../club';
import { formatDate } from '../lib/dates';
import { loadIndex, sameSwimmer, searchClub, type ClubMatch } from '../lib/clubSync';
import { navigate } from '../router';
import type { Gender, Swimmer } from '../store/types';
import { fullName } from '../store/hooks';

/** Ouvre la recherche d'un nageur dans les résultats publiés par le club. */
export function openClubFinder(opts: { swimmer?: Swimmer } = {}) {
  overlay.sheet((close) => <ClubFinder close={close} swimmer={opts.swimmer} />);
}

function ClubFinder({ close, swimmer }: { close: () => void; swimmer?: Swimmer }) {
  const [firstName, setFirstName] = useState(swimmer?.firstName ?? '');
  const [lastName, setLastName] = useState(swimmer?.lastName ?? '');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [matches, setMatches] = useState<ClubMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ClubMatch | null>(null);
  const [gender, setGender] = useState<Gender>(swimmer?.gender ?? 'F');

  const search = async () => {
    if (!lastName.trim() && !firstName.trim()) return;
    setError(null);
    setMatches(null);
    setChosen(null);
    setProgress({ done: 0, total: 0 });
    try {
      const res = await searchClub({ firstName, lastName }, setProgress);
      setMatches(res);
      if (res.length === 1) setChosen(res[0]);
    } catch (e) {
      setError(navigator.onLine ? `Résultats du club indisponibles pour le moment (${(e as Error).message}).` : 'Pas de connexion internet.');
    } finally {
      setProgress(null);
    }
  };

  const confirm = async (m: ClubMatch) => {
    const state = getState();
    let target = swimmer ?? state.swimmers.find((s) => sameSwimmer(m, s));
    if (!target) {
      target = actions.addSwimmer({
        firstName: m.firstName,
        lastName: m.lastName,
        gender,
        birthYear: m.birthYear,
        club: CLUB.name,
        relation: 'child',
      });
    } else {
      const patch: Partial<Swimmer> = {};
      if (!target.birthYear && m.birthYear) patch.birthYear = m.birthYear;
      if (!target.club) patch.club = CLUB.name;
      if (Object.keys(patch).length) actions.updateSwimmer(target.id, patch);
    }
    const res = actions.importClubResults(target.id, m.reports);
    // Tous les rapports ont été lus pour ce nageur : la synchro automatique ne prendra que les nouveaux
    try {
      const idx = await loadIndex();
      const processed = { ...getState().settings.clubSync.processed };
      for (const r of idx.reports) processed[r.url] = [...new Set([...(processed[r.url] ?? []), target.id])];
      actions.updateClubSync({ processed, lastCheck: Date.now(), enabled: true });
    } catch {
      /* le catalogue sera relu à la prochaine synchronisation */
    }
    actions.selectSwimmer(target.id);
    actions.updateSettings({ onboarded: true });
    close();
    navigate('/', { replace: true });
    overlay.celebrate();
    overlay.toast(
      res.added ? `${res.added} résultats importés pour ${target.firstName}` : `${target.firstName} est à jour`,
      '🎉',
    );
  };

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <SheetLayout title="Retrouver mon enfant" onCancel={close} cancelLabel="Fermer">
      <div className="callout" style={{ marginBottom: 14 }}>
        <Icon name="sparkles" />
        <div>
          Nageo parcourt les résultats publiés par l’<b>{CLUB.short}</b> sur son site et récupère automatiquement ceux de votre enfant.
          Ensuite, chaque nouvelle compétition publiée par le club est ajoutée toute seule.
        </div>
      </div>

      <div className="list">
        <div className="field">
          <label htmlFor="cf-first">Prénom</label>
          <input id="cf-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="cf-last">Nom</label>
          <input
            id="cf-last"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Nom de famille"
            autoComplete="off"
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
        </div>
      </div>
      <button className="btn block" style={{ marginTop: 14 }} onClick={search} disabled={!!progress || (!lastName.trim() && !firstName.trim())}>
        <Icon name="sparkles" /> {progress ? 'Recherche…' : 'Rechercher dans les résultats du club'}
      </button>

      {progress && (
        <div style={{ marginTop: 14 }}>
          <div className="meter">
            <div style={{ width: `${pct}%` }} />
          </div>
          <div className="muted small center" style={{ marginTop: 6 }}>
            {progress.total ? `Lecture des résultats du club… ${progress.done}/${progress.total} compétitions` : 'Chargement du catalogue…'}
          </div>
        </div>
      )}

      {error && (
        <div className="callout warn" style={{ marginTop: 14 }}>
          <Icon name="info" />
          <div>{error}</div>
        </div>
      )}

      {matches && matches.length === 0 && (
        <div className="callout warn" style={{ marginTop: 14 }}>
          <Icon name="info" />
          <div>
            Aucun résultat trouvé pour « {[firstName, lastName].filter(Boolean).join(' ')} ». Vérifiez l’orthographe (comme sur la licence), ou
            importez depuis swimrankings.net : le club ne publie pas toutes les compétitions.
          </div>
        </div>
      )}

      {matches && matches.length > 0 && (
        <div className="section" style={{ marginTop: 18 }}>
          <p className="section-caption">{matches.length > 1 ? 'Choisissez votre enfant' : 'Nageur trouvé'}</p>
          <div className="list">
            {matches.map((m) => {
              const on = chosen?.license === m.license;
              return (
                <button key={m.license} className="row" onClick={() => setChosen(m)} aria-pressed={on}>
                  <span className={`check${on ? ' on' : ''}`}>{on && <Icon name="check" />}</span>
                  <Avatar swimmer={{ firstName: m.firstName, lastName: m.lastName, color: 0 }} size={38} />
                  <div className="row-body">
                    <div className="row-title">{fullName(m)}</div>
                    <div className="row-sub">
                      {[m.birthYear ? `né(e) en ${m.birthYear}` : null, `${m.swimCount} courses`, `${m.reports.length} compétitions`].filter(Boolean).join(' · ')}
                    </div>
                    {m.lastMeet && <div className="row-sub">Dernière : {formatDate(m.lastMeet)}</div>}
                  </div>
                </button>
              );
            })}
          </div>
          {chosen && !swimmer && !getState().swimmers.some((s) => sameSwimmer(chosen, s)) && (
            <div className="list" style={{ marginTop: 12 }}>
              <div className="field">
                <span className="label">Sexe</span>
                <div style={{ flex: 1, maxWidth: 220, marginLeft: 'auto' }}>
                  <Segmented
                    value={gender}
                    onChange={setGender}
                    options={[
                      { id: 'F', label: 'Fille' },
                      { id: 'M', label: 'Garçon' },
                    ]}
                  />
                </div>
              </div>
            </div>
          )}
          <button className="btn block" style={{ marginTop: 14 }} disabled={!chosen} onClick={() => chosen && confirm(chosen)}>
            {chosen ? `Importer les ${chosen.swimCount} courses de ${chosen.firstName}` : 'Choisissez un nageur'}
          </button>
        </div>
      )}
      <div className="section-foot center" style={{ marginTop: 16 }}>
        Les fichiers de résultats sont lus sur votre appareil : rien n’est envoyé ailleurs.
      </div>
    </SheetLayout>
  );
}
