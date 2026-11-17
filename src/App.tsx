import { useEffect } from 'react';
import { useData } from './store/store';
import { useRoute, navigate } from './router';
import { UiHost, overlay } from './components/ui';
import { isSyncing, shouldAutoSyncLive, syncLive, type LiveSyncResult } from './lib/liveResults';
import { Icon, type IconName } from './components/Icon';
import { Home } from './screens/Home';
import { Meets, MeetDetail } from './screens/Meets';
import { Records, Rankings } from './screens/Records';
import { ClubRecords } from './screens/ClubRecords';
import { ClubWeekendScreen } from './screens/ClubWeekend';
import { EventDetail } from './screens/EventDetail';
import { Progression } from './screens/Progression';
import { SwimDetail } from './screens/SwimDetail';
import { SwimmerHistory, SwimmerProfile } from './screens/Swimmer';
import { About, Settings, APP_VERSION } from './screens/Settings';
import { Onboarding } from './screens/Onboarding';
import { ClubScreen, refreshClubRoster } from './screens/Club';
import { resultsMessage } from './screens/autoResults';
import type { Course, Stroke } from './store/types';

const TABS: { id: string; path: string; label: string; icon: IconName }[] = [
  { id: 'home', path: '/', label: 'Accueil', icon: 'home' },
  { id: 'meets', path: '/meets', label: 'Compétitions', icon: 'calendar' },
  { id: 'progress', path: '/progress', label: 'Progression', icon: 'chart' },
  { id: 'records', path: '/records', label: 'Records', icon: 'trophy' },
  { id: 'settings', path: '/settings', label: 'Réglages', icon: 'gear' },
];

/** Onglet de la dernière page rattachée à un onglet : une fiche (course, nageur, club)
 * ouverte depuis Compétitions garde Compétitions en surbrillance. */
let lastTab = 'home';

function activeTab(path: string[]): string {
  const p = path[0] ?? '';
  if (p === 'swim' || p === 'swimmer' || p === 'club' || p === 'event' || p === 'club-weekend') return lastTab;
  if (p === 'meets' || p === 'meet') lastTab = 'meets';
  else if (p === 'records' || p === 'rankings' || p === 'club-records') lastTab = 'records';
  else if (p === 'progress') lastTab = 'progress';
  else if (p === 'settings' || p === 'about') lastTab = 'settings';
  else lastTab = 'home';
  return lastTab;
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
    case 'club-records':
      return <ClubRecords />;
    case 'club-weekend':
      return <ClubWeekendScreen />;
    case 'progress':
      return <Progression />;
    case 'event':
      return <EventDetail key={path.join('/')} swimmerId={b} course={c as Course} distance={Number(d)} stroke={e as Stroke} />;
    case 'swim':
      return <SwimDetail id={b} key={b} />;
    case 'swimmer':
      return c === 'history' ? <SwimmerHistory id={b} key={`h${b}`} /> : <SwimmerProfile id={b} key={b} />;
    case 'settings':
      return <Settings />;
    case 'about':
      return <About />;
    case 'club':
      return <ClubScreen />;
    default:
      return <Home />;
  }
}

export function App() {
  const route = useRoute();
  const data = useData();

  const showOnboarding =
    data.swimmers.length === 0 &&
    !data.settings.onboarded &&
    route.path[0] !== 'about' &&
    !(route.path[0] === 'club' && route.query.has('code'));

  // Résultats du club : vérification discrète à l'ouverture et au retour dans l'app
  useEffect(() => {
    const notify = (r: LiveSyncResult) => {
      if (r.newMembers.length) {
        const n = r.newMembers.length;
        // Après le message des résultats, pour qu'on ait le temps de lire les deux
        setTimeout(() => overlay.toast(`${n} nouveau${n > 1 ? 'x' : ''} nageur${n > 1 ? 's' : ''} de l’ESN dans la liste du club`, '🏊'), r.added || r.entries ? 3500 : 0);
      }
      if (!r.added) {
        if (r.entries) overlay.toast(resultsMessage({ added: r.entries, swimmers: r.entrySwimmers }, 'programme'), '📋');
        return;
      }
      overlay.toast(resultsMessage(r, 'nouveau'), '🏊');
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

  // Liste des membres du club : nouvelle version publiée par le club → mise à jour
  useEffect(() => {
    const t = setTimeout(() => {
      refreshClubRoster()
        .then((n) => n && overlay.toast(`${n} nouveau${n > 1 ? 'x' : ''} nageur${n > 1 ? 's' : ''} dans la liste du club`, '🏊'))
        .catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, []);

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
        {TABS.map((t) => (
          <button key={t.id} className={`side-item${tab === t.id ? ' active' : ''}`} onClick={() => navigate(t.path)} aria-current={tab === t.id ? 'page' : undefined}>
            <Icon name={t.icon} />
            {t.label}
          </button>
        ))}
        <div className="sidebar-foot">
          ESN Compétition {APP_VERSION}
          <br />
          Gratuit · données sur votre appareil
        </div>
      </nav>
      <div className="main" key={route.path.join('/') || 'home'}>
        <Screen path={route.path} />
      </div>
      <div className="tabbar-fade" aria-hidden="true" />
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
