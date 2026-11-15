import { actions, loadDemo } from '../store/store';
import { Icon, type IconName } from '../components/Icon';
import { navigate } from '../router';
import { openSwimmerForm } from './forms';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'stopwatch', title: 'Saisie éclair au bord du bassin', text: 'Tapez 1 2 4 6 2 → 1:24.62. Record détecté instantanément.' },
  { icon: 'chart', title: 'Progression nage par nage', text: 'Courbes, tendances, saison par saison, comparaison entre nageurs.' },
  { icon: 'calendar', title: 'Programme des compétitions', text: 'Épreuves, séries, lignes, rappels dans le calendrier.' },
  { icon: 'target', title: 'Objectifs & trophées', text: 'Temps limites, estimation de la date d’atteinte, badges à débloquer.' },
  { icon: 'download', title: 'Import swimrankings.net', text: 'Récupérez l’historique en deux gestes.' },
];

export function Onboarding() {
  return (
    <main className="onboard">
      <img className="onboard-logo" src="./icons/icon-192.png" alt="Nageo" width={88} height={88} />
      <h1>
        Chaque centième
        <br />
        <span>compte.</span>
      </h1>
      <p className="lead">Le carnet de performances des parents de nageurs.</p>
      <div style={{ marginTop: 14 }}>
        <span className="free-tag">✓ Gratuit · sans pub · sans compte</span>
      </div>
      <div className="features">
        {FEATURES.map((f) => (
          <div className="feature" key={f.title}>
            <span className="fi">
              <Icon name={f.icon} />
            </span>
            <div>
              <b>{f.title}</b>
              <span>{f.text}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="onboard-actions">
        <button className="btn block" onClick={() => openSwimmerForm(undefined, () => navigate('/', { replace: true }))}>
          <Icon name="plus" /> Ajouter mon enfant
        </button>
        <button
          className="btn secondary block"
          onClick={() => {
            actions.updateSettings({ onboarded: true });
            navigate('/import');
          }}
        >
          <Icon name="download" /> Importer de swimrankings
        </button>
        <button className="btn ghost block" onClick={() => loadDemo()}>
          <Icon name="sparkles" /> Découvrir avec un exemple
        </button>
      </div>
    </main>
  );
}
