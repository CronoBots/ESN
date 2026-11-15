import { useEffect } from 'react';
import { useData } from './store/store';
import { useRoute, navigate } from './router';
import { UiHost, overlay } from './components/ui';
import { isSyncing, shouldAutoSyncLive, syncLive } from './lib/liveResults';
import { Icon, type IconName } from './components/Icon';
import { Home } from './screens/Home';
import { Meets, MeetDetail } from './screens/Meets';
import { Records, Rankings } from './screens/Records';
import { EventDetail } from './screens/EventDetail';
import { Progression } from './screens/Progression';
import { SwimDetail } from './screens/SwimDetail';
import { SwimmerHistory, SwimmerProfile } from './screens/Swimmer';
import { ImportScreen } from './screens/Import';
import { About, Settings, APP_VERSION } from './screens/Settings';
import { Onboarding } from './screens/Onboarding';
import type { Course, Stroke } from './store/types';

const TABS: { id: string; path: string; label: string; icon: IconName }[] = [
  { id: 'home', path: '/', label: 'Accueil', icon: 'home' },
  { id: 'meets', path: '/meets', label: 'Compétitions', icon: 'calendar' },
  { id: 'progress', path: '/progress', label: 'Progression', icon: 'chart' },
  { id: 'records', path: '/records', label: 'Records', icon: 'trophy' },
  { id: 'settings', path: '/settings', label: 'Réglages', icon: 'gear' },
];

function activeTab(path: string[]): string {
  const p = path[0] ?? '';
  if (p === 'meets' || p === 'meet') return 'meets';
  if (p === 'records' || p === 'rankings' || p === 'event') return 'records';
  if (p === 'progress') return 'progress';
  if (p === 'settings' || p === 'import' || p === 'about') return 'settings';
  return 'home';
}

function Screen({ path }: { path: string[] }) {
  const [a, b, c, d, e] = path;
  switch (a) {
    case undefined:
      return <Home />;
    case 'meets':
      return <Meets />;
    case 'meet':
      return <MeetDetail id={b} key={b} />;
    case 'records':
      return <Records />;
    case 'rankings':
      return <Rankings />;
    case 'progress':
      return <Progression />;
    case 'event':
      return <EventDetail key={path.join('/')} swimmerId={b} course={c as Course} distance={Number(d)} stroke={e as Stroke} />;
    case 'swim':
      return <SwimDetail id={b} key={b} />;
    case 'swimmer':
      return c === 'history' ? <SwimmerHistory id={b} key={`h${b}`} /> : <SwimmerProfile id={b} key={b} />;
    case 'import':
      return <ImportScreen />;
    case 'settings':
      return <Settings />;
    case 'about':
      return <About />;
    default:
      return <Home />;
  }
}

export function App() {
  const route = useRoute();
  const data = useData();
  const theme = data.settings.theme;

  useEffect(() => {
    const root = document.documentElement;
    // En mode « auto », on ne touche pas à un thème posé par l'environnement d'accueil
    if (theme !== 'auto') {
      root.setAttribute('data-theme', theme);
      root.dataset.nageoTheme = '1';
    } else if (root.dataset.nageoTheme) {
      root.removeAttribute('data-theme');
      delete root.dataset.nageoTheme;
    }
    const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#000000' : '#f2f2f7'));
  }, [theme]);

  const showOnboarding =
    data.swimmers.length === 0 && !data.settings.onboarded && route.path[0] !== 'import' && route.path[0] !== 'about';

  // Résultats du club : vérification discrète à l'ouverture et au retour dans l'app
  useEffect(() => {
    const notify = (r: { added: number; pbs: number; swimmers: { swimmer: { firstName: string } }[] }) => {
      if (!r.added) return;
      const who = [...new Set(r.swimmers.map((x) => x.swimmer.firstName))].join(', ');
      overlay.toast(`${r.added} nouveau${r.added > 1 ? 'x' : ''} résultat${r.added > 1 ? 's' : ''} pour ${who}`, '🏊');
      if (r.pbs) overlay.celebrate();
    };
    const run = () => {
      // hors-ligne ou site indisponible : nouvel essai à la prochaine ouverture
      if (!isSyncing() && shouldAutoSyncLive()) syncLive().then(notify).catch(() => {});
    };
    const t = setTimeout(run, 1500);
    // Pendant une compétition, vérification régulière tant que l'app est ouverte
    const every = setInterval(run, 5 * 60 * 1000);
    const onVisible = () => document.visibilityState === 'visible' && run();
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(t);
      clearInterval(every);
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [data.swimmers.length]);

  // Fin de l'écran de bienvenue : on repart du haut de la page
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [showOnboarding]);

  if (showOnboarding) {
    return (
      <>
        <Onboarding />
        <UiHost />
      </>
    );
  }

  const tab = activeTab(route.path);

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Navigation principale">
        <div className="sidebar-brand">
          <img src="./icons/icon-192.png" alt="" />
          Nageo
        </div>
        {TABS.map((t) => (
          <button key={t.id} className={`side-item${tab === t.id ? ' active' : ''}`} onClick={() => navigate(t.path)} aria-current={tab === t.id ? 'page' : undefined}>
            <Icon name={t.icon} />
            {t.label}
          </button>
        ))}
        <div className="sidebar-foot">
          Nageo {APP_VERSION}
          <br />
          Gratuit · données sur votre appareil
        </div>
      </nav>
      <div className="main" key={route.path.join('/') || 'home'}>
        <Screen path={route.path} />
      </div>
      <nav className="tabbar" aria-label="Navigation principale">
        {TABS.map((t) => (
          <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => navigate(t.path)} aria-current={tab === t.id ? 'page' : undefined}>
            <Icon name={t.icon} />
            {t.label}
          </button>
        ))}
      </nav>
      <UiHost />
    </div>
  );
}
