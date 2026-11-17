import { Icon, type IconName } from '../components/Icon';
import { navigate } from '../router';
import { BrandLogo } from '../components/ui';
import { ensureClub } from './Club';
import { useEffect, useState } from 'react';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'download', title: 'Résultats officiels automatiques', text: 'Suivez votre enfant : ses résultats de compétition arrivent tout seuls.' },
  { icon: 'chart', title: 'Progression compétition après compétition', text: 'Points, records battus et courbes nage par nage, saison par saison.' },
  { icon: 'trophy', title: 'Records et classements', text: 'Meilleurs temps à vie ou de la saison, en 25\u00a0m et en 50\u00a0m.' },
  { icon: 'calendar', title: 'Programme des compétitions', text: 'Épreuves, séries, lignes, rappels dans le calendrier.' },
  { icon: 'stopwatch', title: 'Séries et classements', text: 'Toutes les séries d’une épreuve, heure estimée et classement final.' },
];

export function Onboarding() {
  // Écran affiché seulement pendant le premier chargement de la liste du club (ou s'il a échoué hors connexion)
  const [loading, setLoading] = useState(true);
  const retry = () => {
    setLoading(true);
    void ensureClub().then((ok) => {
      if (ok) navigate('/', { replace: true });
      else setLoading(false);
    });
  };
  useEffect(retry, []);
  return (
    <main className="onboard">
      <BrandLogo height={110} />
      <h1>
        Chaque centième
        <br />
        <span>compte.</span>
      </h1>
      <p className="lead">L’application compétition des nageurs de l’ESN Seraing : résultats officiels, records et progression.</p>
      <div style={{ marginTop: 14 }}>
        <span className="free-tag">✓ Gratuit · sans pub · sans compte</span>
      </div>
      <div className="onboard-actions">
        <div className="onboard-join" role="status">
          <span className="join-icon" aria-hidden="true">
            <Icon name={loading ? 'users' : 'info'} />
          </span>
          <div>
            <b>{loading ? 'Chargement des nageurs de l’ESN…' : 'Connexion internet nécessaire'}</b>
            <span>
              {loading
                ? 'Quelques secondes, la première fois seulement.'
                : 'Les nageurs du club se chargent dès que le téléphone est connecté à internet, la première fois seulement.'}
            </span>
          </div>
        </div>
        {!loading && (
          <button className="btn block" onClick={retry}>
            <Icon name="download" /> Réessayer
          </button>
        )}
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
    </main>
  );
}
