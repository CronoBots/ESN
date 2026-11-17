import { useEffect, useMemo, useState } from 'react';
import type { Course, Stroke, Swim, Swimmer } from '../store/types';
import { pointsFor } from '../lib/stats';
import {
  activeChampionships,
  allroundStatus,
  limitStatus,
  parseQualifying,
  qualifyingSummary,
  relativeLimitGap,
  type Championship,
  type LimitStatus,
  type QualifyingData,
} from '../lib/qualifying';
import { courseLabel, eventLabel } from '../lib/events';
import { formatDate, formatRange, todayISO } from '../lib/dates';
import { formatTime } from '../lib/time';
import { navigate } from '../router';
import { Section, StrokeTag } from './ui';
import { Icon } from './Icon';
import { gapLabel } from './Levels';

/** Temps limites publiés avec l'application (data/), relus à chaque ouverture : ils changent chaque saison. */
const QUALIFYING_URL = './data/qualifying.json';

/** Accueil : limites montrées quand le record est à 10 % au plus. */
const CLOSE_GAP = 0.1;

let loading: Promise<QualifyingData | null> | null = null;

function loadQualifying(): Promise<QualifyingData | null> {
  loading ??= fetch(QUALIFYING_URL, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => (json ? parseQualifying(json) : null))
    .catch(() => null);
  return loading;
}

/** Temps limites des championnats (null tant qu'ils ne sont pas lus, ou s'ils ne sont pas disponibles). */
export function useQualifying(): QualifyingData | null {
  const [data, setData] = useState<QualifyingData | null>(null);
  useEffect(() => {
    let alive = true;
    loadQualifying().then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

/** « Belgique Open 25 m », « Belgique 11-14 ans 50 m » */
export function championshipShort(c: Championship): string {
  return `${c.name.replace(/^Championnats de /, '')} ${courseLabel(c.course)}`;
}

function championshipWhen(c: Championship): string {
  return c.start ? formatRange(c.start, c.end) : `saison ${c.edition - 1}-${c.edition}`;
}

const limitsText = (s: LimitStatus) => s.lines.map((l) => `${l.label === 'Limite' ? '' : `${l.label} `}${formatTime(l.cs)}`).join(' · ');

function statusText(s: LimitStatus): string {
  const c = s.championship;
  if (!s.best) return `Pas de temps depuis le ${formatDate(c.window.from)}`;
  const other = s.best.course !== c.course ? ` (bassin de ${courseLabel(s.best.course)})` : '';
  if (s.reached) {
    const level = s.reached.label === 'Limite' ? '' : ` (limite ${s.reached.label})`;
    const more = s.next?.gapCs != null ? ` · A à ${gapLabel(s.next.gapCs)}` : '';
    return `Qualifié${level} avec ${formatTime(s.best.timeCs)}${other}${more}`;
  }
  const level = s.next && s.next.label !== 'Limite' ? ` pour la limite ${s.next.label}` : '';
  return `Encore ${gapLabel(s.next!.gapCs!)}${level} · record ${formatTime(s.best.timeCs)}${other}`;
}

function ProvisionalBadge({ c }: { c: Championship }) {
  const what = c.allround ? 'règles' : 'limites';
  return c.provisional ? (
    <span className="badge" title={`${what === 'règles' ? 'Règles' : 'Limites'} ${c.limitsEdition}, en attendant celles de ${c.edition}`}>
      {what} {c.limitsEdition}
    </span>
  ) : null;
}

function SourcesFoot({ championships }: { championships: Championship[] }) {
  const provisional = championships.filter((c) => c.provisional);
  return (
    <div className="section-foot">
      Meilleur temps en compétition depuis le début de la période de qualification, à l’âge atteint l’année du championnat.{' '}
      {championships.map((c) => c.note && <span key={c.id}>{championships.length > 1 ? `${championshipShort(c)} : ` : ''}{c.note} </span>)}
      {provisional.length > 0 &&
        `Limites ${provisional[0].limitsEdition} reprises en attendant celles de ${provisional[0].edition}, pas encore publiées. `}
      Sources :{' '}
      {championships.map((c, i) => (
        <span key={c.id}>
          {i > 0 ? ' · ' : ''}
          <a href={c.source} target="_blank" rel="noreferrer">
            {championships.length > 1 ? championshipShort(c) : 'règlement officiel'}
          </a>
        </span>
      ))}
    </div>
  );
}

/** Fiche d'une épreuve : les championnats de ce bassin, limites et écart du nageur. */
export function QualifyingSection({ swimmer, swims, course, distance, stroke }: { swimmer: Swimmer; swims: Swim[]; course: Course; distance: number; stroke: Stroke }) {
  const data = useQualifying();
  const statuses = useMemo(() => {
    if (!data) return [];
    const today = todayISO();
    return activeChampionships(data, today)
      .filter((c) => c.course === course)
      .map((c) => limitStatus(c, swimmer, swims, distance, stroke, today))
      .filter((s): s is LimitStatus => !!s)
      // Championnats par âge toujours ; championnats open seulement si la limite est atteinte ou à portée
      .filter((s) => s.lines[0].label === 'Limite' || s.reached || relativeLimitGap(s) <= CLOSE_GAP);
  }, [data, swimmer, swims, course, distance, stroke]);
  if (!statuses.length) return null;
  return (
    <Section title="Championnats">
      <div className="list">
        {statuses.map((s) => {
          const c = s.championship;
          return (
            <div key={c.id} className={`row lvl-row q-row${s.reached ? ' on' : s.best ? ' next' : ''}`}>
              <span className={`lvl-mark q-mark${s.reached ? ' on' : ''}`} aria-hidden="true">
                {s.reached && <Icon name="check" />}
              </span>
              <div className="row-body">
                <div className="row-title">
                  {c.name.replace(/^Championnats de /, '')} <ProvisionalBadge c={c} />
                </div>
                <div className="row-sub">{statusText(s)}</div>
                <div className="row-sub muted">{championshipWhen(c)}</div>
              </div>
              <span className="row-value tnum q-limits">{limitsText(s)}</span>
            </div>
          );
        })}
      </div>
      <SourcesFoot championships={statuses.map((s) => s.championship)} />
    </Section>
  );
}

/** « 100-FLY » → « 100 m Papillon » */
function eventName(key: string): string {
  const [d, stroke] = key.split('-');
  return eventLabel(Number(d), stroke as Stroke);
}

/** Accueil : total de points pour un championnat classé aux points (Belgique 11-16 ans). */
export function AllroundCard({ swimmer, swims }: { swimmer: Swimmer; swims: Swim[] }) {
  const data = useQualifying();
  const status = useMemo(() => {
    if (!data) return null;
    const today = todayISO();
    for (const c of activeChampionships(data, today)) {
      const s = allroundStatus(c, swimmer, swims, today, (x) => pointsFor(x, swimmer));
      if (s) return s;
    }
    return null;
  }, [data, swimmer, swims]);
  if (!status || !status.events.some((e) => e.best)) return null;
  const c = status.championship;
  const missing = status.events.filter((e) => !e.best);
  return (
    <Section title={c.name.replace(/^Championnats de /, '')} action={<ProvisionalBadge c={c} />}>
      <div className="card allround-card">
        <div className="allround-head">
          <div>
            <div className="tile-label">Total de points</div>
            <div className="allround-total tnum">{status.total.toLocaleString('fr-BE')}</div>
          </div>
          <div className="allround-cat muted small">
            {status.category.label}
            <br />
            {status.events.length - missing.length} épreuve{status.events.length - missing.length > 1 ? 's' : ''} sur {status.events.length}
          </div>
        </div>
        <div className="list">
          {status.events.map((e) => {
            const [d, stroke] = (e.best ? `${e.best.distance}-${e.best.stroke}` : e.events[0]).split('-');
            return (
              <button
                key={e.events.join('/')}
                className="row"
                onClick={() => navigate(`/event/${swimmer.id}/${e.best?.course ?? c.course}/${d}/${stroke}`)}
              >
                <StrokeTag stroke={stroke as Stroke} distance={Number(d)} />
                <div className="row-body">
                  <div className="row-title">{e.events.map(eventName).join(' ou ')}</div>
                  <div className="row-sub">
                    {e.best ? `${formatTime(e.best.timeCs)} · ${courseLabel(e.best.course)} · ${formatDate(e.best.date)}` : 'Pas encore de temps sur la période'}
                  </div>
                </div>
                <div className="row-end">
                  <span className="time-big tnum">{e.points != null ? e.points : '–'}</span>
                  <Icon name="chevronRight" className="chev" />
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="section-foot">
        {status.complete
          ? `Classé avec ${status.total.toLocaleString('fr-BE')} points. `
          : `Un temps sur chaque épreuve est nécessaire pour être classé : il manque ${missing.map((e) => e.events.map(eventName).join(' ou ')).join(', ')}. `}
        Sélection : les {status.category.selected} premiers du classement de la fédération, pour l’âge atteint en {c.edition}. Le nombre
        de points nécessaire n’est connu qu’à la clôture : ce total sert à suivre la progression. Meilleur temps en 25 ou 50 m depuis le{' '}
        {formatDate(c.window.from)}
        {c.provisional ? `, règles de l’édition ${c.limitsEdition}` : ''}.{' '}
        <a href={c.source} target="_blank" rel="noreferrer">
          Règlement
        </a>
      </div>
    </Section>
  );
}

/** Accueil : épreuves qualifiées et limites les plus proches, sur les championnats à venir. */
export function QualifyingGoals({ swimmer, swims, all }: { swimmer: Swimmer; swims: Swim[]; /** Page Championnats : toutes les épreuves */ all?: boolean }) {
  const data = useQualifying();
  const summary = useMemo(() => {
    if (!data) return null;
    const s = qualifyingSummary(data, swimmer, swims, todayISO());
    // Seulement les limites à portée (10 % au plus) : pas l'écart d'un enfant de 10 ans aux championnats open
    return { ...s, close: s.close.filter((x) => relativeLimitGap(x) <= CLOSE_GAP) };
  }, [data, swimmer, swims]);
  if (!summary || (!summary.qualified.length && !summary.close.length)) return null;
  const rows = all
    ? [...summary.qualified, ...summary.close]
    : [...summary.qualified.slice(0, 4), ...summary.close.slice(0, Math.max(2, 5 - Math.min(summary.qualified.length, 4)))];
  const more = summary.qualified.length + summary.close.length - rows.length;
  const shown = [...new Map(rows.map((s) => [s.championship.id, s.championship])).values()];
  return (
    <Section
      title={all ? 'Qualifications' : 'Championnats'}
      action={
        !all && more > 0 ? (
          <button className="section-link" onClick={() => navigate('/championships')}>
            Tout voir
          </button>
        ) : undefined
      }
    >
      <div className="list">
        {rows.map((s) => {
          const c = s.championship;
          return (
            <button
              key={`${c.id}-${s.distance}-${s.stroke}`}
              className="row"
              onClick={() => navigate(`/event/${swimmer.id}/${c.course}/${s.distance}/${s.stroke}`)}
            >
              <StrokeTag stroke={s.stroke} distance={s.distance} />
              <div className="row-body">
                <div className="row-title">{eventLabel(s.distance, s.stroke)}</div>
                <div className="row-sub">
                  {championshipShort(c)} · {limitsText(s)}
                </div>
                <div className="row-sub muted">
                  record {formatTime(s.best!.timeCs)}
                  {s.best!.course !== c.course ? ` en ${courseLabel(s.best!.course)}` : ''}
                </div>
              </div>
              <div className="row-end">
                {s.reached ? (
                  <span className="badge good">
                    <Icon name="check" /> Qualifié{s.reached.label === 'Limite' ? '' : ` ${s.reached.label}`}
                  </span>
                ) : (
                  <div style={{ textAlign: 'right' }}>
                    <div className="time-big tnum">{gapLabel(s.next!.gapCs!)}</div>
                    <div className="small muted">à gagner</div>
                  </div>
                )}
                <Icon name="chevronRight" className="chev" />
              </div>
            </button>
          );
        })}
      </div>
      <div className="section-foot">
        {summary.qualified.length > 0
          ? `Qualifié sur ${summary.qualified.length} épreuve${summary.qualified.length > 1 ? 's' : ''}. `
          : 'Pas encore de limite atteinte : voici les plus proches (à 10 % au plus). '}
        Championnats de Belgique à venir : {shown.map((c) => `${championshipShort(c)} (${championshipWhen(c)})`).join(', ')}.
        {shown.some((c) => c.provisional) &&
          ` Limites ${shown.find((c) => c.provisional)!.limitsEdition} reprises en attendant celles de ${shown.find((c) => c.provisional)!.edition}, pas encore publiées.`}
      </div>
    </Section>
  );
}
