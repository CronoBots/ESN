import { useEffect } from 'react';
import { getState, useData } from './store/store';
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
import { LevelsScreen } from './screens/Levels';
import { ChampionshipsScreen } from './screens/Championships';
import { ClubScreen, ensureClub, refreshClubRoster } from './screens/Club';
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
  if (p === 'swim' || p === 'swimmer' || p === 'club' || p === 'event' || p === 'club-weekend' || p === 'levels' || p === 'championships') return lastTab;
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
    case 'levels':
      return <LevelsScreen />;
    case 'championships':
      return <ChampionshipsScreen />;
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

  const showOnboarding = data.swimmers.length === 0 && !data.settings.onboarded && route.path[0] !== 'about';

  // Résultats du club : vérification discrète à l'ouverture et au retour dans l'app
  useEffect(() => {
    // Mise à jour silencieuse : un message seulement quand un nageur suivi a de nouveaux résultats
    // (ou un programme de compétition) ; la liste du club et les autres nageurs se mettent à jour sans rien dire
    const notify = (r: LiveSyncResult) => {
      const followed = new Set(getState().swimmers.filter((s) => s.relation === 'child' || s.favorite).map((s) => s.id));
      const mine = (list: LiveSyncResult['swimmers']) => list.some((x) => followed.has(x.swimmer.id));
      if (r.added && mine(r.swimmers)) {
        overlay.toast(resultsMessage(r, 'nouveau'), '🏊');
        if (r.pbs) overlay.celebrate();
      } else if (r.entries && mine(r.entrySwimmers)) {
        overlay.toast(resultsMessage({ added: r.entries, swimmers: r.entrySwimmers }, 'programme'), '📋');
      }
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
      refreshClubRoster().catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, []);

  // Application ouverte à tous : la liste du club se charge toute seule (au lancement, et dès que
  // le téléphone retrouve internet si le premier lancement s'est fait hors connexion)
  useEffect(() => {
    void ensureClub();
    const retry = () => void ensureClub();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, []);

  // Anciens liens et anciennes installations (…?code=… ou #/…?code=…) : l'accès n'a plus à figurer
  // dans l'adresse, on le retire sans rien demander
  const legacyCode = route.query.get('code');
  useEffect(() => {
    if (legacyCode) navigate(route.path[0] === 'club' || !route.path.length ? '/' : `/${route.path.join('/')}`, { replace: true });
  }, [legacyCode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!location.search) return;
    try {
      history.replaceState(history.state, '', `${location.pathname}${location.hash}`);
    } catch {
      /* ignore */
    }
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
