import { useEffect, useMemo, useState } from 'react';
import type { Meet, Swim, Swimmer } from '../store/types';
import { Section, Segmented } from './ui';
import { isSettled, loadEventSheet } from '../lib/liveResults';
import { overallRanking, type EventSheet, type SheetRow } from '../lib/heatSheet';
import { normName, swimmerNames } from '../lib/results';
import { todayISO, swimDate } from '../lib/dates';
import { formatTime } from '../lib/time';
import { placeLabel } from '../lib/text';

/** « DUPONT, Hugo » → « Hugo DUPONT » (les feuilles de résultats écrivent « DUPONT Hugo »). */
export function displayName(name: string): string {
  const m = /^([^,]+),\s*(.+)$/.exec(name);
  return m ? `${m[2]} ${m[1]}` : name;
}

export const fullYear = (yy?: string) => (yy ? (Number(yy) < 40 ? `20${yy}` : `19${yy}`) : undefined);

/** La ligne du nageur suivi : nom, prénom (le sien ou l'un de ses autres noms) et année de naissance. */
function isSwimmer(row: SheetRow, sw: Swimmer): boolean {
  const n = normName(row.name);
  return swimmerNames(sw).some(
    (x) => n.includes(normName(x.lastName)) && n.includes(normName(x.firstName)) && !(row.yy && x.birthYear && row.yy !== String(x.birthYear % 100).padStart(2, '0')),
  );
}

function HeatRow({ row, mine, lead, time, sub, pts }: { row: SheetRow; mine: boolean; lead: string | number; time: string; sub: string; pts?: number }) {
  return (
    <div className={`row heat-row${mine ? ' mine' : ''}`}>
      <span className="lane tnum">{lead}</span>
      <div className="row-body">
        <div className="row-title">{displayName(row.name)}</div>
        {sub && <div className="row-sub">{sub}</div>}
      </div>
      <span className="row-end heat-end">
        <span className="tnum heat-time">{time}</span>
        {pts != null && <span className="heat-pts tnum">{pts} pts</span>}
      </span>
    </div>
  );
}

export const statusLabel = (r: SheetRow) => (r.status === 'DSQ' ? 'Disq.' : r.status === 'DNS' ? 'Forfait' : r.status === 'DNF' ? 'Abandon' : '—');

function useSheet(meet: Meet, swim: Swim) {
  const today = todayISO();
  const from = new Date(new Date(meet.startDate).getTime() - 86400000).toISOString().slice(0, 10);
  const live = today >= from && today <= (meet.endDate ?? meet.startDate);
  // Finie depuis plus de 2 jours : classement définitif, gardé sur l'appareil après la première lecture
  const settled = isSettled(meet.endDate ?? meet.startDate, today);
  const [sheet, setSheet] = useState<EventSheet | null | undefined>(undefined);
  useEffect(() => {
    if (!meet.liveId || !swim.eventNo) return;
    let alive = true;
    const load = () =>
      loadEventSheet(meet.liveId!, swim.eventNo!, live, settled)
        .then((s) => alive && setSheet(s))
        .catch(() => alive && setSheet((cur) => cur ?? null));
    load();
    // Pendant la compétition : séries et résultats rafraîchis toutes les minutes
    const timer = live ? setInterval(load, 60000) : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [meet.liveId, swim.eventNo, live, settled]);
  return { sheet, live };
}

/**
 * Pendant et après une compétition : la série du nageur ou toutes les séries
 * de l'épreuve (lignes, clubs, temps d'engagement, heures estimées), son
 * record personnel, puis le classement final dès que les résultats sont
 * publiés : général (toutes catégories) ou par catégorie.
 */
export function HeatPanel({ meet, swim, swimmer, pb }: { meet: Meet; swim: Swim; swimmer: Swimmer; pb?: Swim }) {
  const { sheet, live } = useSheet(meet, swim);
  const [heatView, setHeatView] = useState<'mine' | 'all'>('mine');
  const [rankView, setRankView] = useState<'overall' | 'category'>('overall');
  const overall = useMemo(() => overallRanking(sheet?.results ?? []), [sheet]);

  const heat = useMemo(() => {
    if (!sheet) return undefined;
    return (
      sheet.heats.find((h) => h.rows.some((r) => isSwimmer(r, swimmer))) ?? (swim.heat ? sheet.heats.find((h) => h.heat === swim.heat) : undefined)
    );
  }, [sheet, swimmer, swim.heat]);

  const groups = sheet?.results ?? [];
  const mineGroup = groups.find((g) => g.rows.some((r) => isSwimmer(r, swimmer)));
  // Par catégorie : celle du nageur d'abord
  const byCategory = mineGroup ? [mineGroup, ...groups.filter((g) => g !== mineGroup)] : groups;
  const showAllHeats = heatView === 'all' || !heat;
  const mineOverall = overall.find((r) => isSwimmer(r, swimmer));
  const mineCat = mineGroup?.rows.find((r) => isSwimmer(r, swimmer));
  const placeNote = [
    mineOverall?.overall ? `${swimmer.firstName} : ${placeLabel(mineOverall.overall)} sur ${overall.length} au général` : null,
    groups.length > 1 && mineCat?.place
      ? `${placeLabel(mineCat.place)} sur ${mineGroup!.rows.length}${mineGroup!.category ? ` en ${mineGroup!.category.charAt(0).toLowerCase()}${mineGroup!.category.slice(1)}` : ' dans sa catégorie'}`
      : null,
  ]
    .filter(Boolean)
    .join(', ');

  if (!meet.liveId || !swim.eventNo) return null;
  if (sheet === undefined) {
    return live ? <div className="section-foot center" style={{ marginTop: 18 }}>Chargement de la série…</div> : null;
  }
  if (sheet === null || (!heat && !groups.length)) {
    return live ? (
      <div className="section-foot center" style={{ marginTop: 18 }}>
        La liste des séries de cette épreuve n’est pas encore publiée par l’organisateur.
      </div>
    ) : null;
  }

  const entry = swim.entryCs ?? heat?.rows.find((r) => isSwimmer(r, swimmer))?.entryCs;
  return (
    <>
      <div className="tiles three heat-summary">
        <div className="tile">
          <div className="tile-label">Heure estimée</div>
          <div className="tile-value tnum">{heat?.start ? `≈ ${heat.start}` : swim.startTime ?? '—'}</div>
          <div className="tile-sub">{swim.date ? swimDate(swim) : ''}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Engagement</div>
          <div className="tile-value tnum">{entry ? formatTime(entry) : 'NT'}</div>
          <div className="tile-sub">{heat ? `série ${heat.heat}${heat.total ? `/${heat.total}` : ''}${swim.lane != null ? `, ligne ${swim.lane}` : ''}` : ''}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Record perso</div>
          <div className="tile-value tnum">{pb?.timeCs != null ? formatTime(pb.timeCs) : '—'}</div>
          <div className="tile-sub">{pb ? swimDate(pb) : 'pas encore de temps'}</div>
        </div>
      </div>

      {sheet.heats.length > 0 && (
        <Section
          title={showAllHeats ? `Séries · ${sheet.heats.length}` : `Série ${heat!.heat}${heat!.total ? ` sur ${heat!.total}` : ''}`}
          action={!showAllHeats && heat?.start ? <span className="muted">≈ {heat.start}</span> : undefined}
        >
          {heat && sheet.heats.length > 1 && (
            <div className="heat-switch">
              <Segmented
                value={heatView}
                onChange={setHeatView}
                ariaLabel="Séries affichées"
                options={[
                  { id: 'mine', label: 'Sa série' },
                  { id: 'all', label: `Toutes les séries (${sheet.heats.length})` },
                ]}
              />
            </div>
          )}
          {(showAllHeats ? sheet.heats : [heat!]).map((h) => (
            <div key={h.heat} className="heat-block">
              {showAllHeats && (
                <div className="heat-cat">
                  Série {h.heat}
                  {h.total ? ` sur ${h.total}` : ''}
                  {h.start ? ` · ≈ ${h.start}` : ''}
                </div>
              )}
              <div className="list">
                {h.rows.map((r, i) => (
                  <HeatRow
                    key={i}
                    row={r}
                    mine={isSwimmer(r, swimmer)}
                    lead={r.lane ?? '–'}
                    sub={[r.club, fullYear(r.yy)].filter(Boolean).join('\u00a0· ')}
                    time={r.timeCs != null ? formatTime(r.timeCs) : r.status !== 'OK' ? statusLabel(r) : r.entryCs ? formatTime(r.entryCs) : 'NT'}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="section-foot">
            {sheet.heats.some((h) => h.rows.some((r) => r.timeCs != null))
              ? 'À gauche : la ligne ; à droite : le temps réalisé (ou d’engagement si la série n’a pas encore nagé).'
              : 'À gauche : la ligne ; à droite : le temps d’engagement (meilleur temps annoncé par chaque club). Heures estimées d’après les séries précédentes.'}
          </div>
        </Section>
      )}

      {groups.length > 0 && (
        <Section title="Classement final">
          {groups.length > 1 && (
            <div className="heat-switch">
              <Segmented
                value={rankView}
                onChange={setRankView}
                ariaLabel="Classement affiché"
                options={[
                  { id: 'overall', label: 'Général' },
                  { id: 'category', label: `Par catégorie (${groups.length})` },
                ]}
              />
            </div>
          )}
          {rankView === 'overall' || groups.length === 1 ? (
            <div className="list">
              {overall.map((r, i) => (
                <HeatRow
                  key={i}
                  row={r}
                  mine={isSwimmer(r, swimmer)}
                  lead={r.overall ?? '–'}
                  sub={[r.club, fullYear(r.yy), groups.length > 1 ? r.category : null].filter(Boolean).join('\u00a0· ')}
                  pts={r.points}
                  time={r.timeCs != null && r.status === 'OK' ? formatTime(r.timeCs) : statusLabel(r)}
                />
              ))}
            </div>
          ) : (
            byCategory.map((g, gi) => (
              <div key={gi} className="heat-block">
                {g.category && <div className="heat-cat">{g.category}</div>}
                <div className="list">
                  {g.rows.map((r, i) => (
                    <HeatRow
                      key={i}
                      row={r}
                      mine={isSwimmer(r, swimmer)}
                      lead={r.place ?? '–'}
                      sub={[r.club, fullYear(r.yy)].filter(Boolean).join('\u00a0· ')}
                      pts={r.points}
                      time={r.timeCs != null && r.status === 'OK' ? formatTime(r.timeCs) : statusLabel(r)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
          {placeNote && <div className="section-foot">{placeNote}</div>}
        </Section>
      )}
    </>
  );
}
