import { useRef } from 'react';
import { actions, getState, loadDemo, normalizeData, useData } from '../store/store';
import { fullName, sortSwimmers } from '../store/hooks';
import { Avatar, BrandLogo, NavBar, Row, Section, Segmented, Toggle, overlay } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate } from '../router';
import { downloadFile } from '../lib/ics';
import { formatDate, relativeDay, toISO, todayISO } from '../lib/dates';
import { COURSES, eventLabel, ROUND_LABEL, STATUS_LABEL } from '../lib/events';
import { formatTime } from '../lib/time';
import { openSwimmerForm } from './forms';
import { isStandalone, promptInstall } from './Install';
import type { AppData } from '../store/types';
import { CLUB } from '../club';

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

export function exportBackup() {
  const data = getState();
  const name = `nageo-sauvegarde-${todayISO()}.json`;
  shareOrDownload(name, JSON.stringify({ app: 'nageo', exportedAt: new Date().toISOString(), ...data }, null, 2), 'application/json').then(
    (ok) => {
      if (ok) {
        actions.updateSettings({ lastBackupAt: Date.now() });
        overlay.toast('Sauvegarde créée', '💾');
      }
    },
  );
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
  shareOrDownload(`nageo-resultats-${todayISO()}.csv`, csv, 'text/csv').then((ok) => ok && overlay.toast('Export CSV prêt', '📊'));
}

export function Settings() {
  const data = useData();
  const fileRef = useRef<HTMLInputElement>(null);
  const swimmers = sortSwimmers(data.swimmers);
  const s = data.settings;
  const lastBackup = s.lastBackupAt ? toISO(new Date(s.lastBackupAt)) : null;
  const daysSince = s.lastBackupAt ? Math.floor((Date.now() - s.lastBackupAt) / 86400000) : null;

  const onFile = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as AppData;
      const parsed = normalizeData(raw);
      if (!parsed.swimmers.length && !parsed.swims.length) throw new Error('vide');
      overlay.actions({
        title: 'Restaurer la sauvegarde ?',
        message: `${parsed.swimmers.length} nageur(s), ${parsed.swims.length} course(s), ${parsed.meets.length} compétition(s).`,
        actions: [
          {
            label: 'Ajouter à mes données',
            onSelect: () => {
              actions.mergeAll(parsed);
              overlay.toast('Données fusionnées');
            },
          },
          {
            label: 'Remplacer toutes mes données',
            destructive: true,
            onSelect: () => {
              actions.replaceAll({ ...parsed, settings: { ...parsed.settings, onboarded: true } });
              overlay.toast('Sauvegarde restaurée');
            },
          },
        ],
      });
    } catch {
      overlay.toast('Fichier de sauvegarde invalide', '⚠️');
    }
  };

  return (
    <>
      <NavBar title="Réglages" />
      <main className="page">
        <Section title="Nageurs">
          <div className="list">
            {swimmers.map((sw) => (
              <button key={sw.id} className="row" onClick={() => navigate(`/swimmer/${sw.id}`)}>
                <Avatar swimmer={sw} size={38} />
                <div className="row-body">
                  <div className="row-title">
                    {fullName(sw)} {sw.favorite && <Icon name="heartFill" style={{ width: 14, height: 14, color: '#ff375f', verticalAlign: '-1px' }} />}
                  </div>
                  <div className="row-sub">
                    {[sw.relation === 'child' ? 'Mon enfant' : 'Suivi', sw.birthYear, sw.club].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <Icon name="chevronRight" className="chev" />
              </button>
            ))}
            <Row icon="plus" title="Ajouter un nageur" accent onClick={() => openSwimmerForm()} />
          </div>
          <div className="section-foot">Ajoutez vos enfants, mais aussi des coéquipiers « suivis » pour les classements et les comparaisons.</div>
        </Section>

        <Section title="Données">
          <div className="list">
            <Row icon="download" iconBg="#5e5ce6" title="Importer depuis swimrankings.net" chevron onClick={() => navigate('/import')} />
            <Row
              icon="upload"
              iconBg="#30d158"
              title="Sauvegarder mes données"
              sub={lastBackup ? `Dernière sauvegarde : ${relativeDay(lastBackup)}` : 'Aucune sauvegarde pour l’instant'}
              chevron
              onClick={exportBackup}
            />
            <Row icon="download" iconBg="#64d2ff" title="Restaurer une sauvegarde" chevron onClick={() => fileRef.current?.click()} />
            <Row icon="list" iconBg="#8e8e93" title="Exporter les résultats (Excel / CSV)" chevron onClick={exportCsv} />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />
          <div className="section-foot">
            Vos données restent sur cet appareil (aucun compte, aucun serveur).{' '}
            {daysSince == null || daysSince > 30 ? <b>Pensez à faire une sauvegarde régulièrement</b> : 'Sauvegarde à jour.'} Le fichier
            permet aussi de transférer les données vers un autre téléphone ou de les partager avec l’autre parent.
          </div>
        </Section>

        <Section title="Préférences">
          <div className="list">
            <div className="field">
              <span className="label">Apparence</span>
              <div style={{ flex: 1, maxWidth: 240, marginLeft: 'auto' }}>
                <Segmented
                  value={s.theme}
                  onChange={(v) => actions.updateSettings({ theme: v })}
                  options={[
                    { id: 'auto', label: 'Auto' },
                    { id: 'light', label: 'Clair' },
                    { id: 'dark', label: 'Sombre' },
                  ]}
                />
              </div>
            </div>
            <div className="field">
              <span className="label">Bassin par défaut</span>
              <div style={{ flex: 1, maxWidth: 200, marginLeft: 'auto' }}>
                <Segmented value={s.defaultCourse} onChange={(v) => actions.updateSettings({ defaultCourse: v })} options={COURSES.map((c) => ({ id: c.id, label: c.label }))} />
              </div>
            </div>
            <div className="field">
              <span className="label grow">Entraînements dans les records</span>
              <Toggle on={s.includeTraining} onChange={(v) => actions.updateSettings({ includeTraining: v })} label="Compter les temps d’entraînement dans les records" />
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
            <Row
              icon="sparkles"
              iconBg="#bf5af2"
              title="Charger un exemple"
              sub="Une nageuse fictive pour découvrir toutes les fonctions"
              chevron
              onClick={async () => {
                const ok = await overlay.confirm({
                  title: 'Ajouter la nageuse d’exemple ?',
                  message: '« Emma Exemple » et ses courses seront ajoutées. Vous pourrez la supprimer à tout moment.',
                  confirmLabel: 'Ajouter l’exemple',
                });
                if (ok) {
                  loadDemo();
                  overlay.toast('Exemple ajouté', '✨');
                }
              }}
            />
            <Row icon="shield" iconBg="var(--brand-green)" title="Le club ESN Seraing" chevron onClick={() => navigate('/about')} />
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
                  message: 'Nageurs, courses, compétitions et objectifs seront supprimés de cet appareil. Faites une sauvegarde avant.',
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
          ESN Natation {APP_VERSION} · gratuit, sans publicité, sans compte
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
          <BrandLogo height={120} />
          <div className="muted" style={{ marginTop: 14 }}>Le carnet de performances des parents de nageurs de l’Ecole Seraing Natation</div>
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
          <div className="section-foot">{CLUB.sections.join(' · ')}</div>
        </Section>
        <Section title="Vos données">
          <div className="card pad" style={{ fontSize: 15, lineHeight: 1.5 }}>
            Tout est enregistré <b>uniquement sur votre appareil</b> : pas de compte, pas de serveur, pas de publicité. Utilisez
            « Sauvegarder mes données » pour garder une copie ou transférer vers un autre appareil.
          </div>
        </Section>
        <Section title="Points World Aquatics">
          <div className="card pad" style={{ fontSize: 15, lineHeight: 1.5 }}>
            Points = 1000 × (temps de base ÷ temps)³. Le temps de base est le record du monde de l’épreuve (par bassin et par sexe).
            Pour les temps importés de swimrankings.net, les points officiels sont conservés ; pour les temps saisis, ils sont calculés et
            peuvent différer de quelques points du barème officiel de la saison.
          </div>
        </Section>
        <Section title="swimrankings.net">
          <div className="card pad" style={{ fontSize: 15, lineHeight: 1.5 }}>
            ESN Natation n’est pas affilié à swimrankings.net. L’import lit uniquement la page que vous ouvrez vous-même dans votre navigateur ;
            aucune donnée n’est envoyée à un tiers.
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
