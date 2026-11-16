import { useEffect, useMemo, useState } from 'react';
import type { Meet, Swim, Swimmer } from '../store/types';
import { Section } from './ui';
import { loadEventSheet } from '../lib/liveResults';
import type { EventSheet, SheetRow } from '../lib/heatSheet';
import { normName } from '../lib/results';
import { formatDate, todayISO } from '../lib/dates';
import { formatTime } from '../lib/time';
import { placeLabel } from '../lib/text';

/** « DUPONT, Hugo » → « Hugo DUPONT » (les feuilles de résultats écrivent « DUPONT Hugo »). */
function displayName(name: string): string {
  const m = /^([^,]+),\s*(.+)$/.exec(name);
  return m ? `${m[2]} ${m[1]}` : name;
}

const fullYear = (yy?: string) => (yy ? (Number(yy) < 40 ? `20${yy}` : `19${yy}`) : undefined);

/** La ligne du nageur suivi : nom, prénom et année de naissance. */
function isSwimmer(row: SheetRow, sw: Swimmer): boolean {
  const n = normName(row.name);
  if (!n.includes(normName(sw.lastName)) || !n.includes(normName(sw.firstName))) return false;
  return !(row.yy && sw.birthYear && row.yy !== String(sw.birthYear % 100).padStart(2, '0'));
}

function useSheet(meet: Meet, swim: Swim) {
  const today = todayISO();
  const from = new Date(new Date(meet.startDate).getTime() - 86400000).toISOString().slice(0, 10);
  const live = today >= from && today <= (meet.endDate ?? meet.startDate);
  const [sheet, setSheet] = useState<EventSheet | null | undefined>(undefined);
  useEffect(() => {
    if (!meet.liveId || !swim.eventNo) return;
    let alive = true;
    const load = () =>
      loadEventSheet(meet.liveId!, swim.eventNo!, live)
        .then((s) => alive && setSheet(s))
        .catch(() => alive && setSheet((cur) => cur ?? null));
    load();
    // Pendant la compétition : séries et résultats rafraîchis toutes les 2 minutes
    const timer = live ? setInterval(load, 120000) : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [meet.liveId, swim.eventNo, live]);
  return { sheet, live };
}

/**
 * Pendant une compétition : la série du nageur (tous les nageurs, lignes,
 * clubs, temps d'engagement, heure estimée), son record personnel, puis le
 * classement de sa catégorie dès que les résultats sont publiés.
 */
export function HeatPanel({ meet, swim, swimmer, pb }: { meet: Meet; swim: Swim; swimmer: Swimmer; pb?: Swim }) {
  const { sheet, live } = useSheet(meet, swim);
  const [allGroups, setAllGroups] = useState(false);

  const heat = useMemo(() => {
    if (!sheet) return undefined;
    return (
      sheet.heats.find((h) => h.rows.some((r) => isSwimmer(r, swimmer))) ?? (swim.heat ? sheet.heats.find((h) => h.heat === swim.heat) : undefined)
    );
  }, [sheet, swimmer, swim.heat]);

  const groups = sheet?.results ?? [];
  const mineGroup = groups.find((g) => g.rows.some((r) => isSwimmer(r, swimmer)));
  const shownGroups = allGroups ? groups : mineGroup ? [mineGroup] : groups.slice(0, 1);

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
          <div className="tile-sub">{swim.date ? formatDate(swim.date) : ''}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Engagement</div>
          <div className="tile-value tnum">{entry ? formatTime(entry) : 'NT'}</div>
          <div className="tile-sub">{heat ? `série ${heat.heat}${heat.total ? `/${heat.total}` : ''}${swim.lane != null ? `, ligne ${swim.lane}` : ''}` : ''}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Record perso</div>
          <div className="tile-value tnum">{pb?.timeCs != null ? formatTime(pb.timeCs) : '—'}</div>
          <div className="tile-sub">{pb ? formatDate(pb.date) : 'pas encore de temps'}</div>
        </div>
      </div>

      {heat && (
        <Section title={`Série ${heat.heat}${heat.total ? ` sur ${heat.total}` : ''}`} action={heat.start ? <span className="muted">≈ {heat.start}</span> : undefined}>
          <div className="list">
            {heat.rows.map((r, i) => {
              const mine = isSwimmer(r, swimmer);
              return (
                <div key={i} className={`row heat-row${mine ? ' mine' : ''}`}>
                  <span className="lane tnum" aria-label={`Ligne ${r.lane ?? '?'}`}>
                    {r.lane ?? '–'}
                  </span>
                  <div className="row-body">
                    <div className="row-title">{displayName(r.name)}</div>
                    <div className="row-sub">{[r.club, fullYear(r.yy)].filter(Boolean).join(' · ')}</div>
                  </div>
                  <span className="row-end tnum heat-time">
                    {r.timeCs != null ? formatTime(r.timeCs) : r.status !== 'OK' ? r.status : r.entryCs ? formatTime(r.entryCs) : 'NT'}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="section-foot">
            {heat.rows.some((r) => r.timeCs != null)
              ? 'À droite : temps réalisé dans la série.'
              : 'À droite : temps d’engagement (meilleur temps annoncé par chaque club). Heure estimée d’après les temps des séries précédentes.'}
          </div>
        </Section>
      )}

      {groups.length > 0 && (
        <Section
          title={mineGroup?.category && !allGroups ? `Résultats · ${mineGroup.category}` : 'Résultats'}
          action={
            groups.length > 1 ? (
              <button className="section-link" onClick={() => setAllGroups((v) => !v)}>
                {allGroups ? 'Sa catégorie' : 'Toutes les catégories'}
              </button>
            ) : undefined
          }
        >
          {shownGroups.map((g, gi) => (
            <div key={gi} style={gi ? { marginTop: 14 } : undefined}>
              {allGroups && g.category && <div className="heat-cat">{g.category}</div>}
              <div className="list">
                {g.rows.map((r, i) => {
                  const mine = isSwimmer(r, swimmer);
                  return (
                    <div key={i} className={`row heat-row${mine ? ' mine' : ''}`}>
                      <span className="lane tnum">{r.place ?? '–'}</span>
                      <div className="row-body">
                        <div className="row-title">{displayName(r.name)}</div>
                        <div className="row-sub">
                          {[r.club, fullYear(r.yy), r.points != null ? `${r.points} pts` : null].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <span className="row-end tnum heat-time">
                        {r.timeCs != null ? formatTime(r.timeCs) : r.status === 'DSQ' ? 'Disq.' : r.status === 'DNS' ? 'Forfait' : 'Abandon'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {mineGroup && (
            <div className="section-foot">
              {(() => {
                const r = mineGroup.rows.find((x) => isSwimmer(x, swimmer));
                return r?.place ? `${swimmer.firstName} : ${placeLabel(r.place)} sur ${mineGroup.rows.length}${mineGroup.category ? ` (${mineGroup.category.charAt(0).toLowerCase()}${mineGroup.category.slice(1)})` : ''}.` : '';
              })()}
            </div>
          )}
        </Section>
      )}
    </>
  );
}
