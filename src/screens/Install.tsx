import { useEffect, useState, type ReactNode } from 'react';
import { overlay, Segmented, SheetLayout } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

function useInstallState() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return deferred;
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

type Platform = 'ios' | 'android' | 'desktop';

function detectPlatform(): Platform {
  if (isIOS()) return 'ios';
  if (/Android/i.test(navigator.userAgent)) return 'android';
  return 'desktop';
}

/** Navigateur intégré d'une autre application (Facebook, Instagram, Messenger…) : il ne sait pas installer. */
function inAppBrowser(): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|Snapchat|LinkedInApp|GSA\//i.test(navigator.userAgent);
}

/** Navigateur autre que Safari sur iPhone (Chrome, Firefox, Edge). */
function iosOtherBrowser(): boolean {
  return /CriOS|FxiOS|EdgiOS/i.test(navigator.userAgent);
}

/** Bouton tel qu'il apparaît à l'écran, dans le texte d'une étape. */
function Key({ icon, children }: { icon?: IconName; children?: ReactNode }) {
  return (
    <span className="ui-key">
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}

interface Step {
  title: ReactNode;
  note?: ReactNode;
}

function steps(platform: Platform): Step[] {
  if (platform === 'ios') {
    const list: Step[] = [];
    if (inAppBrowser())
      list.push({
        title: (
          <>
            Ouvrez la page dans <b>Safari</b> : touchez <Key icon="more" /> ou <Key icon="external" />, puis « Ouvrir dans Safari ».
          </>
        ),
        note: 'Le navigateur intégré à cette application ne permet pas l’installation.',
      });
    list.push(
      iosOtherBrowser()
        ? {
            title: (
              <>
                Touchez <Key icon="share" /> dans la barre d’adresse.
              </>
            ),
            note: 'Chrome, Firefox et Edge permettent aussi l’installation sur iPhone. Avec Safari, c’est le plus simple.',
          }
        : {
            title: (
              <>
                Touchez <Key icon="more" /> en bas à droite de Safari, puis <Key icon="share">Partager</Key>.
              </>
            ),
            note: (
              <>
                Sur un iPhone plus ancien, le bouton <Key icon="share" /> est directement dans la barre du bas.
              </>
            ),
          },
      {
        title: (
          <>
            Faites défiler et touchez <Key icon="addSquare">Sur l’écran d’accueil</Key>.
          </>
        ),
        note: 'Laissez « Ouvrir comme app web » activé s’il est proposé.',
      },
      {
        title: (
          <>
            Touchez <Key>Ajouter</Key> en haut à droite.
          </>
        ),
      },
      {
        title: (
          <>
            Ouvrez <b>ESN Compétition</b> depuis l’écran d’accueil.
          </>
        ),
        note: 'Elle s’ouvre en plein écran, directement sur les nageurs de l’ESN. Sur iPhone, choisissez à nouveau vos nageurs suivis la première fois.',
      },
    );
    return list;
  }
  if (platform === 'android')
    return [
      {
        title: (
          <>
            Touchez <Key icon="dotsV" /> en haut à droite de Chrome.
          </>
        ),
        note: 'Samsung Internet : touchez ☰ en bas à droite. Edge et Firefox : touchez le menu.',
      },
      {
        title: (
          <>
            Touchez <Key icon="phone">Installer l’application</Key>.
          </>
        ),
        note: 'Selon le téléphone : « Ajouter à l’écran d’accueil ».',
      },
      {
        title: (
          <>
            Confirmez avec <Key>Installer</Key>.
          </>
        ),
        note: 'ESN Compétition rejoint vos autres applications.',
      },
    ];
  return [
    {
      title: (
        <>
          Chrome ou Edge : cliquez sur <Key icon="install" /> à droite de la barre d’adresse, puis <Key>Installer</Key>.
        </>
      ),
      note: 'Ou menu ⋮ → « Installer ESN Compétition » (dans Chrome : sous « Caster, enregistrer et partager »).',
    },
    {
      title: (
        <>
          Safari sur Mac : menu <b>Fichier</b> → <Key>Ajouter au Dock</Key>.
        </>
      ),
    },
  ];
}

const BENEFITS: { icon: IconName; text: string }[] = [
  { icon: 'phone', text: 'Icône sur l’écran d’accueil' },
  { icon: 'bolt', text: 'Plein écran, ouverture immédiate' },
  { icon: 'pool', text: 'Fonctionne au bord du bassin, même sans réseau' },
  { icon: 'sparkles', text: 'Se met à jour toute seule' },
];

function InstallGuide({ close }: { close: () => void }) {
  const prompt = useInstallState();
  const [platform, setPlatform] = useState<Platform>(detectPlatform);
  const installNow = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    notify();
    if (outcome === 'accepted') {
      close();
      overlay.toast('ESN Compétition est installée', '✅');
    }
  };

  return (
    <SheetLayout title="Installer l’application" onCancel={close} cancelLabel="Plus tard">
      <div className="install-hero">
        <img src="./icons/icon-192.png" alt="" width={68} height={68} />
        <div>
          <div className="install-name">ESN Compétition</div>
          <div className="install-sub">Gratuite, sans compte, sans publicité</div>
        </div>
      </div>
      <ul className="install-benefits">
        {BENEFITS.map((b) => (
          <li key={b.text}>
            <Icon name={b.icon} />
            {b.text}
          </li>
        ))}
      </ul>

      {prompt && platform !== 'ios' ? (
        <div className="install-now">
          <button className="btn block" onClick={installNow}>
            <Icon name="download" /> Installer maintenant
          </button>
          <div className="install-or">ou à la main :</div>
        </div>
      ) : null}

      <Segmented
        value={platform}
        onChange={setPlatform}
        ariaLabel="Appareil"
        options={[
          { id: 'ios', label: 'iPhone, iPad' },
          { id: 'android', label: 'Android' },
          { id: 'desktop', label: 'Ordinateur' },
        ]}
      />
      <ol className="guide-steps">
        {steps(platform).map((s, i) => (
          <li key={i}>
            <span className="guide-n" aria-hidden="true">
              {i + 1}
            </span>
            <div>
              <div className="guide-title">{s.title}</div>
              {s.note && <div className="guide-note">{s.note}</div>}
            </div>
          </li>
        ))}
      </ol>
    </SheetLayout>
  );
}

/** Guide d'installation (et installation en un toucher quand le navigateur le permet). */
export function promptInstall() {
  overlay.sheet((close) => <InstallGuide close={close} />);
}

const OFFERED_KEY = 'esn.install-offered';

/**
 * Première visite par le QR code : l'installation est proposée une fois, après
 * le choix des nageurs. Vrai si le guide va s'ouvrir.
 */
export function offerInstall(): boolean {
  if (isStandalone()) return false;
  try {
    if (localStorage.getItem(OFFERED_KEY)) return false;
    localStorage.setItem(OFFERED_KEY, '1');
  } catch {
    /* stockage indisponible : on propose quand même */
  }
  setTimeout(promptInstall, 450);
  return true;
}

const DISMISS_KEY = 'nageo:install-dismissed';

export function InstallBanner() {
  const prompt = useInstallState();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (dismissed || isStandalone()) return null;
  if (!prompt && detectPlatform() === 'desktop') return null;
  return (
    <div className="install-banner">
      <img src="./icons/icon-192.png" alt="" />
      <div className="grow">
        <div style={{ fontWeight: 600, fontSize: 15 }}>Installer ESN Compétition</div>
        <div className="muted small">Sur l’écran d’accueil, en 3 gestes</div>
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
