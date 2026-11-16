import { Icon, type IconName } from '../components/Icon';
import { navigate } from '../router';
import { BrandLogo } from '../components/ui';
import { openClubCode, openFollowPicker } from './Club';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'download', title: 'Résultats officiels automatiques', text: 'Ajoutez votre enfant : ses résultats de compétition arrivent tout seuls.' },
  { icon: 'chart', title: 'Progression compétition après compétition', text: 'Points, records battus et courbes nage par nage, saison par saison.' },
  { icon: 'trophy', title: 'Records et classements', text: 'Meilleurs temps à vie ou de la saison, en 25\u00a0m et en 50\u00a0m.' },
  { icon: 'calendar', title: 'Programme des compétitions', text: 'Épreuves, séries, lignes, rappels dans le calendrier.' },
  { icon: 'stopwatch', title: 'Séries et classements', text: 'Toutes les séries d’une épreuve, heure estimée et classement final.' },
];

export function Onboarding() {
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
        <button className="btn block" onClick={() => openClubCode(() => openFollowPicker(() => navigate('/', { replace: true })))}>
          <Icon name="shield" /> Je suis membre de l’ESN
        </button>
      </div>
    </main>
  );
}
