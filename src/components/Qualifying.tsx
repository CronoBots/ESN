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
import { todayISO, formatDate, formatRange, swimDate } from '../lib/dates';
import { formatTime } from '../lib/time';
import { navigate } from '../router';
import { Empty, Section, StrokeTag } from './ui';
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

const limitsText = (s: LimitStatus) => s.lines.map((l) => `${l.label === 'Limite' ? '' : `${l.label} `}${formatTime(l.cs)}`).join('\u00a0· ');

function statusText(s: LimitStatus, today: string): string {
  const c = s.championship;
  if (!s.best) return `Pas de temps depuis le ${formatDate(c.window.from)}`;
  const other = s.best.course !== c.course ? ` (bassin de ${courseLabel(s.best.course)})` : '';
  if (s.reached) {
    const level = s.reached.label === 'Limite' ? '' : ` (limite ${s.reached.label})`;
    // Écart à la limite A seulement tant que la période de qualification est ouverte
    const more = s.next?.gapCs != null && today <= c.window.to ? ` · A à ${gapLabel(s.next.gapCs)}` : '';
    // Limites de l'édition pas encore publiées : « limite atteinte », pas encore « qualifié »
    return `${c.provisional ? 'Limite atteinte' : 'Qualifié'}${level} avec ${formatTime(s.best.timeCs)}${other}${more}`;
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
      // Période de qualification close : seulement les qualifications acquises
      .filter((s) => s.reached || today <= s.championship.window.to)
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
                <div className="row-sub">{statusText(s, todayISO())}</div>
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
  // « Les 4 meilleurs sur 5 » : nombre de résultats comptés et d'épreuves encore à nager pour être classé
  const need = status.category.counted ?? status.events.length;
  const toSwim = Math.max(0, need - (status.events.length - missing.length));
  // Repère : total du dernier sélectionné de l'édition précédente (ex. « 70e et dernier garçon sélectionné »)
  const bench = status.benchmark;
  const girl = swimmer.gender === 'F';
  const catShort = status.category.label.split(' (')[0];
  const lastSelected = `${status.category.selected}e et ${girl ? 'dernière fille sélectionnée' : 'dernier garçon sélectionné'}`;
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
        <div className="allround-rule">
          Pas de temps limite : sélection au classement, connue après le {formatDate(c.window.to)}.
        </div>
        {bench && (
          <div className="allround-bench">
            <div className="allround-bench-head">
              <b>Repère {bench.edition}</b>
              <b className="tnum nowrap">{bench.points.toLocaleString('fr-BE')} pts</b>
            </div>
            <div className="muted small">
              {lastSelected} en {catShort} l’an dernier
              {bench.official !== bench.points && ` (${bench.official.toLocaleString('fr-BE')} au barème de la fédération)`}
            </div>
            <div
              className={`allround-bar${bench.gap >= 0 ? ' above' : ''}`}
              role="img"
              aria-label={`${status.total} points sur un repère de ${bench.points}`}
            >
              <span style={{ width: `${Math.min(100, Math.round((status.total / bench.points) * 100))}%` }} />
            </div>
            <div className="allround-bench-text">
              {bench.gap >= 0
                ? `${bench.gap.toLocaleString('fr-BE')} points au-dessus du repère : en bonne voie, sans garantie.`
                : `Encore ${(-bench.gap).toLocaleString('fr-BE')} points pour l’atteindre, soit environ ${bench.perEvent} points de plus sur chacun des ${need} résultats comptés.`}
            </div>
          </div>
        )}
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
                    {e.best ? `${formatTime(e.best.timeCs)} · ${courseLabel(e.best.course)} · ${swimDate(e.best)}` : 'Pas encore de temps sur la période'}
                  </div>
                </div>
                <div className="row-end">
                  {e.points != null && !e.counted ? (
                    // Résultat le plus faible, hors des meilleurs comptés : écrit en toutes lettres
                    <div className="allround-skip">
                      <span className="time-big tnum">{e.points}</span>
                      <span>non compté</span>
                    </div>
                  ) : (
                    <span className="time-big tnum">{e.points != null ? e.points : '–'}</span>
                  )}
                  <Icon name="chevronRight" className="chev" />
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="section-foot">
        {need < status.events.length ? `Comptent les ${need} meilleurs résultats sur ${status.events.length}. ` : ''}
        {status.complete
          ? `Assez d’épreuves pour figurer au classement, avec ${status.total.toLocaleString('fr-BE')} points. `
          : need < status.events.length
            ? `Un temps sur au moins ${need} épreuves est nécessaire pour être classé : encore ${toSwim} à nager. `
            : `Un temps sur chaque épreuve est nécessaire pour être classé : il manque ${missing.map((e) => e.events.map(eventName).join(' ou ')).join(', ')}. `}
        <br />
        <b>Comment se fait la sélection.</b> La fédération classe {girl ? 'toutes les filles' : 'tous les garçons'} de Belgique de la catégorie (âge atteint
        en {c.edition}) sur ce total, avec leur meilleur temps en 25 ou 50 m entre le {formatDate(c.window.from)} et le {formatDate(c.window.to)}.
        Le classement est arrêté à cette date, puis les {status.category.selected} premiers sont sélectionnés. Personne ne peut donc être sûr
        d’être qualifié avant : le nombre de points nécessaire dépend des autres nageurs.
        {bench &&
          ` Le repère ${bench.edition} en donne une idée : c’est le total du ${lastSelected} lors de l’édition ${bench.edition} (classement officiel de la fédération).`}
        {bench &&
          bench.official !== bench.points &&
          ` La fédération calcule ses points avec un barème World Aquatics plus ancien, environ ${(Math.round(((c.allround?.pointsScale ?? 1) - 1) * 1000) / 10).toLocaleString('fr-BE')} % plus généreux : le repère est ramené au barème de l’application pour comparer ce qui est comparable.`}
        {c.provisional ? ` Règles de l’édition ${c.limitsEdition}, en attendant celles de ${c.edition}.` : ''}{' '}
        <a href={c.source} target="_blank" rel="noreferrer">
          Règlement
        </a>
        {c.allround?.ranking && (
          <>
            {' · '}
            <a href={c.allround.ranking} target="_blank" rel="noreferrer">
              Classement de la fédération
            </a>
          </>
        )}
      </div>
    </Section>
  );
}

/** Accueil : épreuves qualifiées et limites les plus proches, sur les championnats à venir. */
/** Badge d'une limite atteinte : « Qualifié » seulement quand les limites de l'édition sont publiées. */
export function reachedLabel(s: LimitStatus): string {
  const label = s.reached!.label === 'Limite' ? '' : s.reached!.label;
  // Court (la limite est écrite sur la ligne) : « Atteinte », « A atteinte » ; « Qualifié » une fois les limites publiées
  return s.championship.provisional ? (label ? `${label} atteinte` : 'Atteinte') : `Qualifié${label ? ` ${label}` : ''}`;
}

/**
 * Sous la liste des temps limites : ces championnats se gagnent au temps (pas de sélection en fin de
 * période), et pourquoi « limite atteinte » plutôt que « qualifié » tant que les limites sont provisoires.
 */
function goalsFoot(summary: { qualified: LimitStatus[] }, shown: Championship[], otherSystem: string | false): string {
  const n = summary.qualified.length;
  const parts = [
    n > 0 ? `${n} limite${n > 1 ? 's' : ''} atteinte${n > 1 ? 's' : ''}.` : 'Pas encore de limite atteinte : voici les plus proches (à 10 % au plus).',
    `Ces championnats se gagnent au temps limite : un temps sous la limite, nagé pendant la période de qualification, suffit pour être engagé sur l’épreuve, sans attendre la fin de la période${
      shown.some((c) => c.aOnlyUpTo != null) ? ' (aux championnats Open, la limite B dépend des places restantes)' : ''
    }.`,
    `Période : ${shown.map((c) => `${championshipShort(c)}, du ${formatDate(c.window.from)} au ${formatDate(c.window.to)}`).join(' ; ')}.`,
  ];
  const prov = shown.find((c) => c.provisional);
  if (prov) {
    // La limite atteinte le plus juste : celle qui risque le plus de changer avec les nouvelles limites
    const tight = summary.qualified
      .filter((q) => q.championship.provisional)
      .sort((a, b) => a.reached!.cs - a.best!.timeCs - (b.reached!.cs - b.best!.timeCs))[0];
    parts.push(
      `Les limites ${prov.edition} ne sont pas encore publiées : celles de ${prov.limitsEdition} sont reprises. Si elles deviennent plus rapides, une limite atteinte de justesse peut ne plus suffire${
        tight ? ` (la plus juste : ${eventLabel(tight.distance, tight.stroke)}, ${gapLabel(tight.reached!.cs - tight.best!.timeCs)} d’avance)` : ''
      }. C’est pourquoi l’application écrit « atteinte », et « qualifié » une fois les limites ${prov.edition} publiées.`,
    );
  }
  if (otherSystem) parts.push(otherSystem);
  return parts.join(' ');
}

export function QualifyingGoals({ swimmer, swims, all }: { swimmer: Swimmer; swims: Swim[]; /** Page Championnats : toutes les épreuves */ all?: boolean }) {
  const data = useQualifying();
  // Championnat classé aux points pour ce nageur (11-16 ans) : il fonctionne autrement, on le dit
  const otherSystem = useMemo(() => {
    if (!data || !swimmer.birthYear) return '';
    const c = activeChampionships(data, todayISO()).find((x) =>
      x.allround?.categories.some((cat) => x.edition - swimmer.birthYear! >= cat.minAge && x.edition - swimmer.birthYear! <= cat.maxAge),
    );
    return c ? `Le championnat ${championshipShort(c)} (plus bas) fonctionne autrement : pas de temps limite, mais une sélection au classement, connue seulement après le ${formatDate(c.window.to)}.` : '';
  }, [data, swimmer.birthYear]);
  const summary = useMemo(() => {
    if (!data) return null;
    const s = qualifyingSummary(data, swimmer, swims, todayISO());
    // Seulement les limites à portée (10 % au plus) : pas l'écart d'un enfant de 10 ans aux championnats open
    return { ...s, close: s.close.filter((x) => relativeLimitGap(x) <= CLOSE_GAP) };
  }, [data, swimmer, swims]);
  if (!summary || (!summary.qualified.length && !summary.close.length)) {
    // Page Championnats : dire pourquoi elle est vide plutôt que n'afficher qu'une note
    return all && summary ? (
      <Section title="Temps limites">
        <div className="card">
          <Empty
            icon="trophy"
            title="Pas encore de limite à portée"
            text={`Les championnats apparaissent ici dès que ${swimmer.firstName} réalise un temps limite ou s’en approche (moins de 10 % d’écart).`}
          />
        </div>
      </Section>
    ) : null;
  }
  const rows = all
    ? [...summary.qualified, ...summary.close]
    : [...summary.qualified.slice(0, 4), ...summary.close.slice(0, Math.max(2, 5 - Math.min(summary.qualified.length, 4)))];
  const more = summary.qualified.length + summary.close.length - rows.length;
  const shown = [...new Map(rows.map((s) => [s.championship.id, s.championship])).values()];
  return (
    <Section
      title={all ? 'Temps limites' : 'Championnats'}
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
                <div className="row-sub">{championshipShort(c)}</div>
                {/* Morceaux insécables : la ligne se coupe après un « · », jamais devant */}
                <div className="row-sub muted">
                  <span className="nowrap">limite {limitsText(s)}</span>
                  {'\u00a0· '}
                  <span className="nowrap">
                    record {formatTime(s.best!.timeCs)}
                    {s.best!.course !== c.course ? ` en ${courseLabel(s.best!.course)}` : ''}
                  </span>
                </div>
              </div>
              <div className="row-end">
                {s.reached ? (
                  <div style={{ textAlign: 'right' }}>
                    <span className="badge good">
                      <Icon name="check" /> {reachedLabel(s)}
                    </span>
                    <div className="small muted">{gapLabel(s.reached.cs - s.best!.timeCs)} d’avance</div>
                  </div>
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
      <div className="section-foot">{goalsFoot(summary, shown, all ? otherSystem : false)}</div>
    </Section>
  );
}
