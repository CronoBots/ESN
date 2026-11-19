import { actions, getState, useData } from '../store/store';
import { fullName, isActiveMember, mySwimmers } from '../store/hooks';
import { Avatar, NavBar, Row, Section, Segmented, Toggle, overlay } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate } from '../router';
import { groupName, isFollowed, loadClub, openFollow, useRosterAvailable } from './Club';
import { downloadFile } from '../lib/ics';
import { formatDate, relativeDay, toISO, todayISO } from '../lib/dates';
import { COURSES, eventLabel, ROUND_LABEL, STATUS_LABEL } from '../lib/events';
import { formatTime } from '../lib/time';
import { computePbFlags } from '../lib/stats';
import type { Swim } from '../store/types';
import { isStandalone, promptInstall } from './Install';
import { openShareApp } from '../components/Invite';
import { CLUB } from '../club';
import { syncLive } from '../lib/liveResults';
import { useState } from 'react';

export const APP_VERSION = '1.0.0';

async function shareOrDownload(name: string, content: string, type: string) {
  try {
    const file = new File([content], name, { type });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
      await navigator.share({ files: [file], title: name });
      return true;
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return false;
  }
  downloadFile(name, content, type);
  return true;
}

function exportCsv() {
  const data = getState();
  const sw = new Map(data.swimmers.map((s) => [s.id, s]));
  const meets = new Map(data.meets.map((m) => [m.id, m]));
  const header = ['Nageur', 'Date', 'Épreuve', 'Bassin', 'Temps', 'Statut', 'Tour', 'Place', 'Compétition', 'Lieu', 'Contexte', 'Points', 'Notes'];
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = data.swims
    .filter((s) => s.timeCs != null || s.status !== 'OK')
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((s) => {
      const m = s.meetId ? meets.get(s.meetId) : undefined;
      const swimmer = sw.get(s.swimmerId);
      return [
        swimmer ? fullName(swimmer) : '',
        s.date,
        eventLabel(s.distance, s.stroke),
        s.course === 'SCM' ? '25m' : '50m',
        s.timeCs != null ? formatTime(s.timeCs) : '',
        STATUS_LABEL[s.status],
        ROUND_LABEL[s.round],
        s.place ?? '',
        m?.name ?? '',
        m?.city ?? '',
        s.context === 'training' ? 'Entraînement' : 'Compétition',
        s.points ?? '',
        s.notes ?? '',
      ]
        .map(esc)
        .join(';');
    });
  const csv = '﻿' + [header.join(';'), ...rows].join('\n');
  shareOrDownload(`esn-competition-resultats-${todayISO()}.csv`, csv, 'text/csv').then((ok) => ok && overlay.toast('Export CSV prêt', '📊'));
}

export function Settings() {
  const data = useData();
  const swimmers = mySwimmers(data.swimmers);
  const club = data.settings.club;
  const rosterAvailable = useRosterAvailable();
  const [loadingClub, setLoadingClub] = useState(false);
  const s = data.settings;

  return (
    <>
      <NavBar title="Réglages" />
      <main className="page">
        <Section title="Nageurs suivis">
          <div className="list">
            {swimmers.map((sw) => (
              <button key={sw.id} className="row" onClick={() => navigate(`/swimmer/${sw.id}`)}>
                <Avatar swimmer={sw} size={38} />
                <div className="row-body">
                  <div className="row-title">
                    {fullName(sw)}
                  </div>
                  <div className="row-sub">
                    {[sw.birthYear, groupName(club?.groups ?? [], sw.group) ?? sw.club].filter(Boolean).join('\u00a0· ')}
                  </div>
                </div>
                <Icon name="chevronRight" className="chev" />
              </button>
            ))}
            <Row icon="heart" title="Choisir les nageurs suivis" accent onClick={() => openFollow()} />
          </div>
          <div className="section-foot">
            Les nageurs suivis s’affichent sur l’accueil et dans les sélecteurs. Dans la liste du club, touchez le cœur d’un nageur pour le
            suivre.
          </div>
        </Section>

        {(club || rosterAvailable) && (
          <Section title="Le club">
            <div className="list">
              {club ? (
                <>
                  <Row
                    icon="users"
                    iconBg="var(--brand-green)"
                    title="Nageurs de l’ESN"
                    value={`${data.swimmers.filter(isActiveMember).length}`}
                    chevron
                    onClick={() => navigate('/club')}
                  />
                  <Row icon="trophy" iconBg="#f5a400" title="Records du club" chevron onClick={() => navigate('/club-records')} />
                  <Row icon="ranking" iconBg="var(--brand-blue)" title="Classements du club" chevron onClick={() => navigate('/rankings')} />
                  <Row icon="qr" iconBg="#34c759" title="Partager l’application aux parents" sub="QR code à scanner, lien ou affiche" chevron onClick={openShareApp} />
                </>
              ) : (
                <Row
                  icon="download"
                  iconBg="var(--brand-green)"
                  title={loadingClub ? 'Chargement de la liste du club…' : 'Charger la liste du club'}
                  chevron={!loadingClub}
                  onClick={
                    loadingClub
                      ? undefined
                      : () => {
                          setLoadingClub(true);
                          void loadClub().finally(() => setLoadingClub(false));
                        }
                  }
                />
              )}
              <Row icon="info" iconBg="#8e8e93" title="Infos du club" chevron onClick={() => navigate('/about')} />
            </div>
            {club && <div className="section-foot">Liste du {formatDate(club.updated)}, mise à jour automatiquement quand le club en publie une nouvelle.</div>}
          </Section>
        )}

        <Section title="Résultats automatiques">
          <div className="list">
            <SyncNowRow />
          </div>
          <div className="section-foot">
            Tout est automatique : programme et résultats publiés par les organisateurs (live.swimrankings.net ou livetiming de la fédération, fichiers
            officiels et feuilles PDF), historique des saisons passées relevé par le club, nouveaux nageurs de l’ESN ajoutés à la liste. Vérification à
            chaque ouverture, et toutes les 5 min pendant une compétition.
          </div>
        </Section>

        <Section title="Données">
          <div className="list">
            <Row icon="list" iconBg="#8e8e93" title="Exporter les résultats (Excel / CSV)" chevron onClick={exportCsv} />
          </div>
          <div className="section-foot">
            Les données sont gardées sur cet appareil. Sur un autre téléphone, il suffit d’ouvrir l’application : la liste du club et
            les résultats reviennent automatiquement ; choisissez à nouveau vos nageurs suivis.
          </div>
        </Section>

        <Section title="Préférences">
          <div className="list">
            <div className="field">
              <span className="label">Bassin par défaut</span>
              <div style={{ flex: 1, maxWidth: 200, marginLeft: 'auto' }}>
                <Segmented value={s.defaultCourse} onChange={(v) => actions.updateSettings({ defaultCourse: v })} options={COURSES.map((c) => ({ id: c.id, label: c.label }))} />
              </div>
            </div>
            <div className="field">
              <span className="label grow">Célébrer les records 🎉</span>
              <Toggle on={s.celebrate} onChange={(v) => actions.updateSettings({ celebrate: v })} label="Animation lors d’un nouveau record" />
            </div>
          </div>
        </Section>

        <Section title="Application">
          <div className="list">
            {!isStandalone() && <Row icon="phone" title="Installer sur l’écran d’accueil" chevron onClick={promptInstall} />}
            <Row icon="info" iconBg="#8e8e93" title="À propos" chevron onClick={() => navigate('/about')} />
          </div>
        </Section>

        <Section>
          <div className="list">
            <button
              className="row danger"
              onClick={async () => {
                const ok = await overlay.confirm({
                  title: 'Effacer toutes les données ?',
                  message: 'Nageurs, courses et compétitions seront supprimés de cet appareil. La liste du club et les résultats reviendront automatiquement.',
                  confirmLabel: 'Tout effacer',
                  destructive: true,
                });
                if (ok) {
                  actions.resetAll();
                  navigate('/', { replace: true });
                }
              }}
            >
              <div className="row-body center">Effacer toutes les données</div>
            </button>
          </div>
        </Section>
        <div className="section-foot center" style={{ marginTop: 18 }}>
          ESN Compétition {APP_VERSION} · gratuit, sans publicité, sans compte
          <br />
          {data.swims.length} courses · {data.meets.length} compétitions · {formatDate(todayISO())}
        </div>
      </main>
    </>
  );
}

export function About() {
  return (
    <>
      <NavBar title="À propos" back="/settings" />
      <main className="page">
        <div className="center" style={{ padding: '8px 0 6px' }}>
          <div className="muted">
            L’application compétition des nageurs de l’Ecole Seraing Natation
          </div>
          <div style={{ marginTop: 10 }}>
            <span className="free-tag">✓ 100 % gratuit · toutes les fonctions</span>
          </div>
        </div>
        <Section title="Le club">
          <div className="list">
            <Row title={CLUB.legal} sub={`Fondé en ${CLUB.founded} · ${CLUB.pool}`} />
            <Row title={CLUB.address} sub="Adresse" />
            <Row title="Téléphone" value={CLUB.phone} />
            <Row title="E-mail" value={CLUB.email} />
            <Row title="Site du club" href={CLUB.website} external />
          </div>
          <div className="section-foot">{CLUB.sections.join('\u00a0· ')}</div>
        </Section>
        <Section title="Vos données">
          <div className="card pad" style={{ fontSize: 15, lineHeight: 1.5 }}>
            Tout est enregistré <b>uniquement sur votre appareil</b>&nbsp;: pas de compte, pas de serveur, pas de publicité. Sur un autre
            téléphone, il suffit d’ouvrir l’application&nbsp;: la liste du club et les résultats reviennent automatiquement&nbsp;;
            choisissez à nouveau vos nageurs suivis.
          </div>
        </Section>
        <Section title="Points World Aquatics">
          <div className="card pad" style={{ fontSize: 15, lineHeight: 1.5 }}>
            Points = 1000 × (temps de base ÷ temps)³. Le temps de base est le record du monde de l’épreuve (par bassin et par sexe).
            Les points officiels publiés avec les résultats sont conservés ; à défaut, ils sont calculés et peuvent différer de quelques
            points du barème officiel de la saison.
          </div>
        </Section>
        <Section title="swimrankings.net">
          <div className="card pad" style={{ fontSize: 15, lineHeight: 1.5 }}>
            L’application ESN Compétition n’est pas affiliée à swimrankings.net. Elle lit les résultats publiés par les organisateurs sur
            live.swimrankings.net ou sur le livetiming de la fédération, et l’historique relevé par le club ; aucune donnée n’est envoyée
            à un tiers.
          </div>
        </Section>
        <Section title="Hors-ligne">
          <div className="card pad" style={{ fontSize: 15, lineHeight: 1.5 }}>
            Une fois installée, l’application fonctionne sans connexion — pratique au bord du bassin quand le réseau est saturé.
          </div>
        </Section>
      </main>
    </>
  );
}

/** Course nagée (temps, forfait, disqualification), et non une épreuve au programme. */
const swum = (x: Swim) => x.timeCs != null || x.status !== 'OK';

/**
 * Un nageur suivi a-t-il battu un record parmi les résultats arrivés depuis `before` (courses déjà
 * nagées avant la recherche) ? Les records des autres nageurs du club ne se fêtent pas.
 */
export function followedRecord(before: Set<string>): boolean {
  const s = getState();
  const followed = new Set(s.swimmers.filter(isFollowed).map((x) => x.id));
  const flags = computePbFlags(s.swims, s.settings.includeTraining);
  return s.swims.some((x) => swum(x) && !before.has(x.id) && followed.has(x.swimmerId) && !!flags.get(x.id)?.isPB);
}

function SyncNowRow() {
  const data = useData();
  const [busy, setBusy] = useState<string | null>(null);
  const last = data.settings.liveSync.lastCheck;
  return (
    <Row
      icon="download"
      iconBg="#34c759"
      title={busy ?? 'Vérifier maintenant'}
      sub={last ? `Dernière vérification : ${relativeDay(toISO(new Date(last)))}` : 'Jamais vérifié'}
      chevron={!busy}
      onClick={
        busy
          ? undefined
          : async () => {
              setBusy('Recherche des nouveaux résultats…');
              try {
                // Courses déjà nagées : un programme qui reçoit son temps garde son identifiant
                const before = new Set(getState().swims.filter(swum).map((x) => x.id));
                const r = await syncLive({ force: true, onProgress: (p) => p.total && setBusy(`Lecture des résultats… ${p.done}/${p.total}`) });
                if (r.added) {
                  overlay.toast(`${r.added} nouveaux résultats ajoutés`, '🏊');
                  if (r.pbs && followedRecord(before)) overlay.celebrate();
                } else overlay.toast('Tout est à jour', '✓');
              } catch {
                overlay.toast(navigator.onLine ? 'Résultats du club indisponibles pour le moment' : 'Pas de connexion internet', '⚠️');
              } finally {
                setBusy(null);
              }
            }
      }
    />
  );
}
