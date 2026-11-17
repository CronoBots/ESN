import { Icon, type IconName } from '../components/Icon';
import { navigate } from '../router';
import { BrandLogo } from '../components/ui';
import { canPasteLink, joinFromClipboard, openFollowPicker, scanToJoin } from './Club';
import { isStandalone } from './Install';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'download', title: 'Résultats officiels automatiques', text: 'Suivez votre enfant : ses résultats de compétition arrivent tout seuls.' },
  { icon: 'chart', title: 'Progression compétition après compétition', text: 'Points, records battus et courbes nage par nage, saison par saison.' },
  { icon: 'trophy', title: 'Records et classements', text: 'Meilleurs temps à vie ou de la saison, en 25\u00a0m et en 50\u00a0m.' },
  { icon: 'calendar', title: 'Programme des compétitions', text: 'Épreuves, séries, lignes, rappels dans le calendrier.' },
  { icon: 'stopwatch', title: 'Séries et classements', text: 'Toutes les séries d’une épreuve, heure estimée et classement final.' },
];

export function Onboarding() {
  // Application installée : l'appareil photo du téléphone ouvrirait Safari, on scanne depuis l'application
  const installed = isStandalone();
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
        <div className="onboard-join">
          <span className="join-icon" aria-hidden="true">
            <Icon name="qr" />
          </span>
          <div>
            <b>{installed ? 'Reliez l’application au club' : 'Scannez le QR code de l’ESN'}</b>
            <span>
              {installed
                ? 'Scannez une seule fois le QR code de l’ESN (affiche du club, téléphone d’un autre parent) : tous les nageurs du club apparaissent.'
                : 'Avec l’appareil photo du téléphone, ou touchez le lien reçu du club : l’application s’ouvre aussitôt, sans compte ni mot de passe.'}
            </span>
          </div>
        </div>
        <button className="btn block" onClick={() => scanToJoin(() => navigate('/', { replace: true }))}>
          <Icon name="qr" /> Scanner le QR code
        </button>
        {canPasteLink() && (
          <button
            className="btn ghost block"
            onClick={async () => {
              if (await joinFromClipboard()) openFollowPicker(() => navigate('/', { replace: true }));
            }}
          >
            <Icon name="link" /> J’ai copié le lien d’invitation
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
