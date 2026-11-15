import { useEffect, useState } from 'react';
import { overlay, SheetLayout } from '../components/ui';
import { Icon } from '../components/Icon';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export async function promptInstall() {
  if (deferred) {
    await deferred.prompt();
    deferred = null;
    listeners.forEach((l) => l());
    return;
  }
  overlay.sheet((close) => <InstallHelp close={close} />);
}

function InstallHelp({ close }: { close: () => void }) {
  const ios = isIOS();
  return (
    <SheetLayout title="Installer Nageo" onCancel={close} cancelLabel="Fermer">
      <div className="center" style={{ padding: '10px 0 18px' }}>
        <img src="./icons/icon-192.png" alt="" width={72} height={72} style={{ borderRadius: 18, boxShadow: '0 10px 30px rgba(10,132,255,.35)' }} />
        <p className="muted" style={{ margin: '12px auto 0', maxWidth: 360 }}>
          Ajoutez Nageo sur votre écran d’accueil : l’application s’ouvre en plein écran, fonctionne sans connexion et vos
          données restent sur votre appareil.
        </p>
      </div>
      <div className="card pad">
        {ios ? (
          <ol className="steps">
            <li>
              Ouvrez cette page dans <b>Safari</b>.
            </li>
            <li>
              Touchez le bouton <b>Partager</b> <Icon name="share" style={{ width: 18, height: 18, verticalAlign: '-3px', color: 'var(--accent)' }} /> en bas de l’écran.
            </li>
            <li>
              Choisissez <b>« Sur l’écran d’accueil »</b>, puis <b>Ajouter</b>.
            </li>
          </ol>
        ) : (
          <ol className="steps">
            <li>
              Ouvrez le menu du navigateur (<b>⋮</b> en haut à droite dans Chrome / Edge).
            </li>
            <li>
              Choisissez <b>« Installer l’application »</b> ou <b>« Ajouter à l’écran d’accueil »</b>.
            </li>
            <li>Confirmez : Nageo apparaît avec vos autres applications.</li>
          </ol>
        )}
      </div>
      {ios && (
        <div className="callout" style={{ marginTop: 14 }}>
          <Icon name="info" />
          <div>
            Sur iPhone, l’application installée a son propre espace de stockage : si vous aviez déjà saisi des temps dans Safari,
            faites une sauvegarde (Réglages › Sauvegarder) puis restaurez-la dans l’application installée.
          </div>
        </div>
      )}
    </SheetLayout>
  );
}

const DISMISS_KEY = 'nageo:install-dismissed';

export function InstallBanner() {
  const [, force] = useState(0);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  if (dismissed || isStandalone()) return null;
  if (!deferred && !isIOS()) return null;
  return (
    <div className="install-banner">
      <img src="./icons/icon-192.png" alt="" />
      <div className="grow">
        <div style={{ fontWeight: 600, fontSize: 15 }}>Installer Nageo</div>
        <div className="muted small">Plein écran et hors-ligne</div>
      </div>
      <button className="btn small" onClick={promptInstall}>
        Installer
      </button>
      <button
        className="icon-btn"
        aria-label="Masquer"
        style={{ minWidth: 32, color: 'var(--text-3)' }}
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(DISMISS_KEY, '1');
          } catch {
            /* ignore */
          }
        }}
      >
        <Icon name="close" style={{ width: 18, height: 18 }} />
      </button>
    </div>
  );
}
