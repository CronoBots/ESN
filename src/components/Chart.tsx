import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatTime } from '../lib/time';
import { formatDate, fromISO } from '../lib/dates';

export interface ChartPoint {
  date: string;
  cs: number;
  label?: string;
  pb?: boolean;
}

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  points: ChartPoint[];
  /** Affiche la courbe « record » en escalier (meilleur temps à date). */
  bestLine?: boolean;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/**
 * Courbe de progression : axe vertical inversé (plus rapide = plus haut),
 * axe horizontal temporel, réticule + infobulle au survol / toucher / clavier.
 */
export function ProgressChart({
  series,
  goalCs,
  height = 240,
  ariaLabel,
}: {
  series: ChartSeries[];
  goalCs?: number | null;
  height?: number;
  ariaLabel: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.max(260, entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { top: 16, right: 16, bottom: 28, left: 52 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const model = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    if (!all.length) return null;
    const times = all.map((p) => fromISO(p.date).getTime());
    let x0 = Math.min(...times);
    let x1 = Math.max(...times);
    if (x1 - x0 < 30 * 86400000) {
      const mid = (x0 + x1) / 2;
      x0 = mid - 20 * 86400000;
      x1 = mid + 20 * 86400000;
    }
    const span = x1 - x0;
    x0 -= span * 0.04;
    x1 += span * 0.04;
    const ys = all.map((p) => p.cs);
    if (goalCs) ys.push(goalCs);
    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);
    const range = Math.max(yMax - yMin, 100);
    yMin -= range * 0.12;
    yMax += range * 0.12;
    const step = niceStep((yMax - yMin) / 4);
    const tickStart = Math.ceil(yMin / step) * step;
    const yTicks: number[] = [];
    for (let v = tickStart; v <= yMax; v += step) yTicks.push(v);

    // Repères temporels
    const xTicks: { t: number; label: string }[] = [];
    const months = span / (30.44 * 86400000);
    const stepMonths = months > 36 ? 12 : months > 18 ? 6 : months > 8 ? 3 : months > 3 ? 1 : 1;
    const d = new Date(x0);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() + 1);
    while (d.getTime() <= x1) {
      if (d.getMonth() % stepMonths === 0) {
        xTicks.push({
          t: d.getTime(),
          label: stepMonths >= 12 || d.getMonth() === 0 ? String(d.getFullYear()) : MONTHS[d.getMonth()],
        });
      }
      d.setMonth(d.getMonth() + 1);
    }
    return { x0, x1, yMin, yMax, yTicks, xTicks };
  }, [series, goalCs]);

  if (!model) return null;

  const sx = (t: number) => pad.left + ((t - model.x0) / (model.x1 - model.x0)) * innerW;
  // Inversé : temps le plus rapide (petit) en haut
  const sy = (cs: number) => pad.top + ((cs - model.yMin) / (model.yMax - model.yMin)) * innerH;

  // Points à plat (pour le réticule)
  const flat = series
    .flatMap((s, si) => s.points.map((p) => ({ ...p, si, t: fromISO(p.date).getTime() })))
    .sort((a, b) => a.t - b.t);
  const xs = [...new Set(flat.map((p) => p.t))];

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    xs.forEach((t, i) => {
      const dd = Math.abs(sx(t) - px);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    setActive(best);
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight') setActive((a) => Math.min(xs.length - 1, (a ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? xs.length) - 1));
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  };

  const activeT = active != null ? xs[active] : null;
  const activePoints = activeT != null ? flat.filter((p) => p.t === activeT) : [];
  const single = series.length === 1;

  return (
    <div className="chart" ref={wrapRef}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setActive(null);
        }}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        <g className="grid">
          {model.yTicks.map((v) => (
            <line key={v} x1={pad.left} x2={width - pad.right} y1={sy(v)} y2={sy(v)} />
          ))}
        </g>
        <g className="axis">
          {model.yTicks.map((v) => (
            <text key={v} x={pad.left - 8} y={sy(v) + 4} textAnchor="end">
              {formatTime(Math.round(v))}
            </text>
          ))}
          {model.xTicks.map((tk) => (
            <text key={tk.t} x={sx(tk.t)} y={height - 8} textAnchor="middle">
              {tk.label}
            </text>
          ))}
        </g>

        {goalCs != null && (
          <g>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={sy(goalCs)}
              y2={sy(goalCs)}
              stroke="var(--chart-goal)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
          </g>
        )}

        {series.map((s) => {
          const pts = s.points.map((p) => ({ x: sx(fromISO(p.date).getTime()), y: sy(p.cs), p }));
          if (!pts.length) return null;
          const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
          const area = single
            ? `${path}L${pts[pts.length - 1].x.toFixed(1)},${pad.top + innerH}L${pts[0].x.toFixed(1)},${pad.top + innerH}Z`
            : null;
          // Escalier du record
          let best = Infinity;
          const stepPts: string[] = [];
          if (s.bestLine) {
            pts.forEach((p, i) => {
              if (p.p.cs < best) {
                if (i > 0) stepPts.push(`L${p.x.toFixed(1)},${sy(best).toFixed(1)}`);
                best = p.p.cs;
                stepPts.push(`${i ? 'L' : 'M'}${p.x.toFixed(1)},${sy(best).toFixed(1)}`);
              }
            });
            stepPts.push(`L${(width - pad.right).toFixed(1)},${sy(best).toFixed(1)}`);
          }
          return (
            <g key={s.id}>
              {area && <path d={area} fill={s.color} opacity={0.1} />}
              {s.bestLine && (
                <path d={stepPts.join('')} fill="none" stroke="var(--text-3)" strokeWidth={1.5} strokeLinejoin="round" />
              )}
              <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={p.p.pb ? 5 : 4}
                  fill={s.color}
                  stroke={p.p.pb ? 'var(--chart-goal)' : 'var(--card)'}
                  strokeWidth={2}
                />
              ))}
            </g>
          );
        })}

        {activeT != null && (
          <g pointerEvents="none">
            <line x1={sx(activeT)} x2={sx(activeT)} y1={pad.top} y2={pad.top + innerH} stroke="var(--text-3)" strokeWidth={1} />
            {activePoints.map((p, i) => (
              <circle key={i} cx={sx(p.t)} cy={sy(p.cs)} r={6} fill={series[p.si].color} stroke="var(--card)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {activeT != null && activePoints.length > 0 && (
        <div
          className="chart-tip"
          style={{
            left: Math.min(Math.max(sx(activeT), 75), width - 75),
            top: Math.max(0, Math.min(...activePoints.map((p) => sy(p.cs))) - 74),
          }}
        >
          {activePoints.map((p, i) => (
            <div key={i}>
              <div className="v">
                {!single && <span className="line-key" style={{ background: series[p.si].color }} />}
                {formatTime(p.cs)}
                {p.pb && <span className="badge pb" style={{ marginLeft: 6 }}>PB</span>}
              </div>
              <div className="k">
                {!single && `${series[p.si].label} · `}
                {formatDate(p.date)}
              </div>
              {p.label && <div className="k" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number): number {
  const candidates = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 3000, 6000, 12000, 30000];
  return candidates.find((c) => c >= raw) ?? 60000;
}

/** Barres horizontales (points par nage). */
export function StrokeBars({
  rows,
  max,
}: {
  rows: { key: string; label: string; color: string; value: number | null; sub?: string }[];
  max: number;
}) {
  return (
    <div role="list">
      {rows.map((r) => (
        <div className="hbar" key={r.key} role="listitem" aria-label={`${r.label} : ${r.value ?? 'aucun'} points`}>
          <span className="hstack" style={{ gap: 8 }}>
            <span className="stroke-dot" style={{ background: r.color }} />
            {r.label}
          </span>
          <div className="hbar-track">
            <div
              className="hbar-fill"
              style={{ width: r.value ? `${Math.max(2, (r.value / max) * 100)}%` : 0, background: r.color }}
            />
          </div>
          <span className="hbar-val">{r.value ?? '–'}</span>
        </div>
      ))}
    </div>
  );
}
