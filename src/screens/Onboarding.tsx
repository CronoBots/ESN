import { actions, loadDemo } from '../store/store';
import { Icon, type IconName } from '../components/Icon';
import { navigate } from '../router';
import { BrandLogo } from '../components/ui';
import { openSwimmerForm } from './forms';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'download', title: 'Résultats officiels automatiques', text: 'Ajoutez votre enfant : ses résultats de compétition arrivent tout seuls.' },
  { icon: 'chart', title: 'Progression compétition après compétition', text: 'Points, records battus et courbes nage par nage, saison par saison.' },
  { icon: 'trophy', title: 'Records et classements', text: 'Meilleurs temps à vie ou de la saison, en 25 m et en 50 m.' },
  { icon: 'calendar', title: 'Programme des compétitions', text: 'Épreuves, séries, lignes, rappels dans le calendrier.' },
  { icon: 'target', title: 'Objectifs & temps limites', text: 'Estimation de la date d’atteinte, badges à débloquer.' },
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
