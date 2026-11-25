import { useMemo, useState } from 'react';
import { useData } from '../store/store';
import { fullName, usePbFlags } from '../store/hooks';
import { Avatar, overlay, Section, Segmented } from './ui';
import { Icon } from './Icon';
import { championshipShort, useQualifying } from './Qualifying';
import { meetQualifications, meetRecap, recapText, type MeetRecap } from '../lib/meetRecap';
import { capitalize } from '../lib/text';
import { courseLabel, eventLabel } from '../lib/events';
import { formatLongDay, formatShortWeekday } from '../lib/dates';
import { formatTime } from '../lib/time';
import type { Meet } from '../store/types';

const placeText = (p: number) => `${p}${p === 1 ? 're' : 'e'}`;
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
const APP_URL = 'https://cronobots.github.io/ESN/';

/** Partage du récap : feuille de partage du téléphone, sinon copie dans le presse-papiers. */
async function shareText(text: string) {
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(text);
    overlay.toast('Récap copié : collez-le dans le groupe des parents', '📋');
  } catch {
    overlay.toast('Copie impossible sur cet appareil', '⚠️');
  }
}

/**
 * Récap de l'ESN à une compétition : chiffres du club, une ligne par nageur, records du club battus,
 * temps limites atteints et finales ; par jour si la compétition en compte plusieurs ; à partager.
 */
export function ClubMeetRecap({ meet, onJump }: { meet: Meet; onJump?: (swimmerId: string) => void }) {
  const data = useData();
  const pbFlags = usePbFlags();
  const qualifying = useQualifying();
  const [day, setDay] = useState('all');
  const full = useMemo(() => meetRecap(meet.id, data.swims, data.swimmers, pbFlags, undefined, data.officialRecords), [meet.id, data.swims, data.swimmers, pbFlags, data.officialRecords]);
  const shownDay = day !== 'all' && full.days.includes(day) ? day : 'all';
  const r: MeetRecap = useMemo(
    () => (shownDay === 'all' ? full : meetRecap(meet.id, data.swims, data.swimmers, pbFlags, shownDay, data.officialRecords)),
    [full, shownDay, meet.id, data.swims, data.swimmers, data.officialRecords, pbFlags],
  );
  const quals = useMemo(() => {
    if (!qualifying) return [];
    const swims = data.swims.filter((s) => s.meetId === meet.id && (shownDay === 'all' || s.date === shownDay));
    return meetQualifications(swims, data.swims, data.swimmers, qualifying.championships);
  }, [qualifying, data.swims, data.swimmers, meet.id, shownDay]);

  if (!full.swimmers.length) return null;
  const started = full.swum > 0;
  const dayLabel = shownDay === 'all' ? undefined : capitalize(formatLongDay(shownDay));

  return (
    <Section
      title="L’ESN à cette compétition"
      id="meet-club"
      action={
        started ? (
          <button className="section-link" onClick={() => void shareText(recapText(meet, r, quals, championshipShort, APP_URL, dayLabel))}>
            Partager
          </button>
        ) : undefined
      }
    >
      {full.days.length > 1 && started && (
        <div style={{ marginBottom: 12 }}>
          <Segmented
            value={shownDay}
            onChange={setDay}
            ariaLabel="Jour de la compétition"
            options={[
              { id: 'all', label: 'Tout' },
              ...full.days.map((d) => ({ id: d, label: `${capitalize(formatShortWeekday(d))} ${Number(d.slice(8))}` })),
            ]}
          />
        </div>
      )}

      {started && (
        <div className="tiles four">
          <div className="tile">
            <div className="tile-label">Nageurs</div>
            <div className="tile-value">{r.swimmers.length}</div>
            <div className="tile-sub">de l’ESN</div>
          </div>
          <div className="tile">
            <div className="tile-label">Courses</div>
            <div className="tile-value">{r.swum}</div>
            <div className="tile-sub">{r.total > r.swum ? `sur ${r.total} au programme` : 'nagées'}</div>
          </div>
          <div className="tile">
            <div className="tile-label">Records perso</div>
            <div className="tile-value gold">{r.pbs}</div>
            <div className="tile-sub">
              {r.pbs ? `${plural(r.pbSwimmers, 'nageur')} sur ${r.swimmers.length}${r.gain > 0 ? ` · −${formatTime(r.gain)}` : ''}` : 'pas encore'}
            </div>
          </div>
          <div className="tile">
            <div className="tile-label">Podiums</div>
            <div className="tile-value">{r.podiums}</div>
            <div className="tile-sub">{r.finals.length ? plural(r.finals.length, 'finale') : 'places 1 à 3'}</div>
          </div>
        </div>
      )}

      {(r.records.length > 0 || quals.length > 0 || r.finals.length > 0) && (
        <div className="club-record-lines recap-lines">
          {r.records.map(({ swim, swimmer }) => (
            <span key={`r${swim.id}`} className="club-record-line">
              <Icon name="trophy" aria-hidden="true" />
              <span>
                <b>Record du club</b> · {fullName(swimmer)} · {eventLabel(swim.distance, swim.stroke)} {courseLabel(swim.course)} en{' '}
                <b className="tnum">{formatTime(swim.timeCs)}</b>
              </span>
            </span>
          ))}
          {quals.map((q) => (
            <span key={`q${q.swim.id}${q.championship.id}`} className="club-record-line">
              <Icon name="target" aria-hidden="true" />
              <span>
                <b>Temps limite{q.label === 'Limite' ? '' : ` ${q.label}`}</b> · {fullName(q.swimmer)} · {eventLabel(q.swim.distance, q.swim.stroke)} en{' '}
                <b className="tnum">{formatTime(q.swim.timeCs)}</b> · {championshipShort(q.championship)}
              </span>
            </span>
          ))}
          {r.finals.map(({ swim, swimmer }) => (
            <span key={`f${swim.id}`} className="club-record-line">
              <Icon name="flag" aria-hidden="true" />
              <span>
                <b>Finale</b> · {fullName(swimmer)} · {eventLabel(swim.distance, swim.stroke)} en <b className="tnum">{formatTime(swim.timeCs)}</b>
                {swim.place ? ` · ${placeText(swim.place)}` : ''}
              </span>
            </span>
          ))}
        </div>
      )}

      {r.swimmers.length > 1 && (
        <div className="list" style={{ marginTop: started ? 12 : 0 }}>
          {r.swimmers.map((s) => (
            <button key={s.swimmer.id} className="row" onClick={() => onJump?.(s.swimmer.id)}>
              <Avatar swimmer={s.swimmer} size={36} />
              <div className="row-body">
                <div className="row-title">{fullName(s.swimmer)}</div>
                <div className="row-sub">
                  {s.swum === 0
                    ? s.total
                      ? `${plural(s.total, 'course')} au programme`
                      : 'Forfait'
                    : [`${s.swum}${s.total > s.swum ? ` sur ${s.total}` : ''} ${s.swum > 1 || s.total > 1 ? 'courses' : 'course'}`, s.dsq ? `${s.dsq} disq.` : null]
                        .filter(Boolean)
                        .join(' · ')}
                </div>
                {(s.best?.place || s.finals > 0) && (
                  <div className="row-sub">
                    {[
                      s.best?.place
                        ? `${s.best.round === 'HEAT' || s.best.round === 'SEMI' ? 'Meilleur classement des séries' : 'Meilleure place'} : ${placeText(s.best.place)} (${eventLabel(s.best.distance, s.best.stroke)})`
                        : null,
                      s.finals ? plural(s.finals, 'finale') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}
              </div>
              <div className="row-end">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                  {s.pbs > 0 ? (
                    <span className="badge pb">{s.pbs} PB</span>
                  ) : (
                    <span className="small muted">{s.swum ? 'Pas de PB' : s.total ? 'À venir' : ''}</span>
                  )}
                  {s.gain > 0 && <span className="small good tnum">−{formatTime(s.gain)}</span>}
                </div>
                <Icon name="chevronRight" className="chev" />
              </div>
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}
