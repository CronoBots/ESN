import { useMemo } from 'react';
import { useData } from '../store/store';
import { fullName, usePbFlags } from '../store/hooks';
import { Empty, NavBar, Row, Section, StrokeTag, overlay } from '../components/ui';
import { Icon } from '../components/Icon';
import { SwimBadges } from '../components/SwimRow';
import { eventLabel, ROUND_LABEL, STATUS_LABEL, courseLabel } from '../lib/events';
import { formatDate } from '../lib/dates';
import { formatDelta, formatTime, pacePer100, speed } from '../lib/time';
import { personalBests, pointsFor, swimKey } from '../lib/stats';
import { HeatPanel } from '../components/HeatPanel';
import { navigate } from '../router';
import { openResultForm } from './forms';

export function SwimDetail({ id }: { id: string }) {
  const data = useData();
  const pbFlags = usePbFlags();
  const swim = data.swims.find((s) => s.id === id);
  const bests = useMemo(
    () => (swim ? personalBests(data.swims, swim.swimmerId, data.settings.includeTraining) : new Map()),
    [data.swims, swim, data.settings.includeTraining],
  );
  if (!swim) {
    return (
      <>
        <NavBar title="Course" back large={false} />
        <main className="page">
          <Empty icon="stopwatch" title="Course introuvable" />
        </main>
      </>
    );
  }
  const swimmer = data.swimmers.find((s) => s.id === swim.swimmerId);
  const meet = swim.meetId ? data.meets.find((m) => m.id === swim.meetId) : undefined;
  const pb = pbFlags.get(swim.id);
  const pts = pointsFor(swim, swimmer);
  const t = swim.timeCs;

  // Analyse des passages : temps par tronçon
  const laps: { from: number; to: number; cs: number }[] = [];
  if (swim.splits?.length && t) {
    const marks = swim.distance === 50 ? [25] : Array.from({ length: swim.splits.length }, (_, i) => (i + 1) * 50);
    let prevCs = 0;
    let prevM = 0;
    swim.splits.forEach((cs, i) => {
      if (cs > prevCs) {
        laps.push({ from: prevM, to: marks[i], cs: cs - prevCs });
        prevCs = cs;
        prevM = marks[i];
      }
    });
    laps.push({ from: prevM, to: swim.distance, cs: t - prevCs });
  }
  const fastestLap = laps.length ? Math.min(...laps.map((l) => l.cs / (l.to - l.from))) : 0;

  const share = async () => {
    if (!swimmer || !t) return;
    const txt = `${swimmer.firstName} a nagé le ${eventLabel(swim.distance, swim.stroke)} (${courseLabel(swim.course)}) en ${formatTime(t)}${
      pb?.isPB && pb.deltaCs != null ? ` — nouveau record personnel (${formatDelta(pb.deltaCs)}) ! 🎉` : ''
    }${meet ? ` · ${meet.name}` : ''} · ${formatDate(swim.date)}`;
    try {
      if (navigator.share) await navigator.share({ text: txt });
      else {
        await navigator.clipboard.writeText(txt);
        overlay.toast('Texte copié', '📋');
      }
    } catch {
      /* partage annulé */
    }
  };

  return (
    <>
      <NavBar
        title={eventLabel(swim.distance, swim.stroke)}
        back
        large={false}
        right={
          <button className="icon-btn" onClick={() => openResultForm({ swim })}>
            Modifier
          </button>
        }
      />
      <main className="page">
        <div className="card result-hero">
          <div className="hstack" style={{ justifyContent: 'center' }}>
            <StrokeTag stroke={swim.stroke} distance={swim.distance} size={34} />
            <span className="muted">
              {swimmer ? fullName(swimmer) : ''} · {courseLabel(swim.course)}
            </span>
          </div>
          <div className="rt" style={{ marginTop: 12 }}>
            {t != null ? formatTime(t) : swim.status === 'OK' ? 'À nager' : '—'}
          </div>
          <div className="hstack" style={{ justifyContent: 'center', marginTop: 10, gap: 6 }}>
            <SwimBadges swim={swim} pb={pb} />
            {pb?.deltaCs != null && swim.status === 'OK' && (
              <span className={`tnum ${pb.deltaCs < 0 ? 'good' : 'muted'}`} style={{ fontWeight: 700 }}>
                {formatDelta(pb.deltaCs)} {pb.deltaCs < 0 ? 'sur le record' : 'du record'}
              </span>
            )}
          </div>
          {pb?.isPB && pb.prevBestCs != null && (
            <div className="muted small" style={{ marginTop: 6 }}>
              Ancien record : {formatTime(pb.prevBestCs)}
            </div>
          )}
          {t != null && swim.status === 'OK' && (
            <div className="tiles three" style={{ marginTop: 18, textAlign: 'left' }}>
              <div className="tile" style={{ background: 'var(--fill)', boxShadow: 'none' }}>
                <div className="tile-label">Points</div>
                <div className="tile-value">{pts ?? '—'}</div>
                <div className="tile-sub">{swim.points != null ? 'officiels' : 'estimés'}</div>
              </div>
              <div className="tile" style={{ background: 'var(--fill)', boxShadow: 'none' }}>
                <div className="tile-label">Allure</div>
                <div className="tile-value tnum">{formatTime(pacePer100(t, swim.distance))}</div>
                <div className="tile-sub">aux 100 m</div>
              </div>
              <div className="tile" style={{ background: 'var(--fill)', boxShadow: 'none' }}>
                <div className="tile-label">Vitesse</div>
                <div className="tile-value tnum">{speed(t, swim.distance).toLocaleString('fr-BE', { maximumFractionDigits: 2 })}</div>
                <div className="tile-sub">m/s</div>
              </div>
            </div>
          )}
        </div>

        {meet && swimmer && swim.context === 'competition' && (
          <HeatPanel meet={meet} swim={swim} swimmer={swimmer} pb={bests.get(swimKey(swim))} />
        )}

        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn secondary" onClick={() => navigate(`/event/${swim.swimmerId}/${swim.course}/${swim.distance}/${swim.stroke}`)}>
            <Icon name="chart" /> Progression
          </button>
          {t != null && (
            <button className="btn ghost" onClick={share}>
              <Icon name="share" /> Partager
            </button>
          )}
        </div>

        {laps.length > 1 && (
          <Section title="Temps de passage">
            <div className="card">
              <table className="table">
                <thead>
                  <tr>
                    <th>Tronçon</th>
                    <th className="r">Passage</th>
                    <th className="r">Tronçon</th>
                    <th className="r">/ 50 m</th>
                  </tr>
                </thead>
                <tbody>
                  {laps.map((l, i) => {
                    const cum = laps.slice(0, i + 1).reduce((a, x) => a + x.cs, 0);
                    const per50 = Math.round((l.cs / (l.to - l.from)) * 50);
                    const fastest = l.cs / (l.to - l.from) === fastestLap;
                    return (
                      <tr key={i}>
                        <td>
                          {l.from}–{l.to} m
                        </td>
                        <td className="r">{formatTime(cum)}</td>
                        <td className="r" style={{ fontWeight: 600 }}>
                          {formatTime(l.cs)}
                        </td>
                        <td className={`r ${fastest ? 'good' : ''}`}>{formatTime(per50)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {laps.length >= 2 && (
              <div className="section-foot">
                {(() => {
                  const half = Math.floor(laps.length / 2);
                  const first = laps.slice(0, half).reduce((a, l) => a + l.cs, 0);
                  const second = laps.slice(laps.length - half).reduce((a, l) => a + l.cs, 0);
                  const diff = second - first;
                  return diff < 0
                    ? `Split négatif : 2e moitié plus rapide de ${formatTime(-diff)}. Belle gestion de course !`
                    : `2e moitié plus lente de ${formatTime(diff)}.`;
                })()}
              </div>
            )}
          </Section>
        )}

        <Section title="Détails">
          <div className="list">
            <Row title="Date" value={`${formatDate(swim.date)}${swim.startTime ? ` · ${swim.startTime}` : ''}`} />
            {swim.context === 'competition' ? (
              <Row
                title="Compétition"
                value={meet?.name ?? '—'}
                chevron={!!meet}
                onClick={meet ? () => navigate(`/meet/${meet.id}`) : undefined}
              />
            ) : (
              <Row title="Contexte" value="Entraînement" />
            )}
            <Row title="Bassin" value={courseLabel(swim.course)} />
            {swim.context === 'competition' && <Row title="Tour" value={ROUND_LABEL[swim.round]} />}
            <Row title="Statut" value={STATUS_LABEL[swim.status]} />
            {(swim.eventNo || swim.heat || swim.lane != null) && (
              <Row
                title="Épreuve / série / ligne"
                value={[swim.eventNo ? `n° ${swim.eventNo}` : null, swim.heat ? `série ${swim.heat}` : null, swim.lane != null ? `ligne ${swim.lane}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              />
            )}
            {swim.place && <Row title="Classement" value={`${swim.place}${swim.place === 1 ? 're' : 'e'}`} />}
            <Row
              title="Engagement"
              value={
                swim.entryCs
                  ? `${formatTime(swim.entryCs)}${t ? ` (${formatDelta(t - swim.entryCs)})` : ''}`
                  : 'NT'
              }
            />
            <Row title="Chronométrage" value={swim.timing === 'manual' ? 'Manuel' : 'Électronique'} />
            <Row title="Source" value={swim.source === 'swimrankings' ? 'swimrankings.net' : swim.source === 'live' ? 'Résultats officiels (organisateur)' : swim.source === 'club' ? 'Résultats du club' : 'Saisie manuelle'} />
          </div>
          {swim.notes && (
            <div className="card pad" style={{ marginTop: 10, whiteSpace: 'pre-wrap', fontSize: 15 }}>
              {swim.notes}
            </div>
          )}
        </Section>
      </main>
    </>
  );
}
