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
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/**
 * Courbe de progression : axe vertical naturel (plus rapide = plus bas, la
 * courbe descend quand le temps s'améliore),
 * axe horizontal temporel, réticule au survol / toucher / clavier et lecture
 * des temps sous le tracé (jamais par-dessus les courbes).
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
    const yTicks = timeTicks(yMin, yMax);

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
  // Temps le plus rapide (petit) en bas : la courbe descend quand le nageur progresse
  const sy = (cs: number) => pad.top + ((model.yMax - cs) / (model.yMax - model.yMin)) * innerH;

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
  const single = series.length === 1;
  // Lecture : pour chaque série, son temps à la date pointée (ou le dernier
  // connu avant), sinon son dernier temps. Sous le tracé : rien ne le masque.
  const readout = series.map((s, si) => {
    const pts = flat.filter((p) => p.si === si);
    const at = activeT == null ? pts[pts.length - 1] : [...pts].reverse().find((p) => p.t <= activeT);
    return { s, p: at, exact: activeT == null || at?.t === activeT };
  });

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
              {formatTime(Math.round(v)).replace(/\.00$/, '')}
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

        {/* Le nageur principal (1re série) est dessiné en dernier : jamais caché par un autre */}
        {[...series].reverse().map((s) => {
          const pts = s.points.map((p) => ({
            x: sx(fromISO(p.date).getTime()),
            y: sy(p.cs),
            p,
          }));
          if (!pts.length) return null;
          const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
          // Seul le record actuel (meilleur temps) est cerclé d'or ; les records
          // battus en chemin restent signalés par « PB » dans la lecture
          const bestIdx = pts.reduce((b, p, i) => (p.p.cs < pts[b].p.cs ? i : b), 0);
          const area = single
            ? `${path}L${pts[pts.length - 1].x.toFixed(1)},${pad.top + innerH}L${pts[0].x.toFixed(1)},${pad.top + innerH}Z`
            : null;
          return (
            <g key={s.id}>
              {area && <path d={area} fill={s.color} opacity={0.1} />}
              <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={i === bestIdx ? 5.5 : 3.5}
                  fill={s.color}
                  stroke={i === bestIdx ? 'var(--chart-goal)' : 'var(--card)'}
                  strokeWidth={i === bestIdx ? 2.5 : 1.5}
                />
              ))}
            </g>
          );
        })}

        {activeT != null && (
          <g pointerEvents="none">
            <line x1={sx(activeT)} x2={sx(activeT)} y1={pad.top} y2={pad.top + innerH} stroke="var(--text-3)" strokeWidth={1} strokeDasharray="3 3" />
            {readout.map(({ s, p }) =>
              p ? <circle key={s.id} cx={sx(p.t)} cy={sy(p.cs)} r={6} fill={s.color} stroke="var(--card)" strokeWidth={2} /> : null,
            )}
          </g>
        )}
      </svg>
      <div className={`chart-readout${single ? ' single' : ''}`}>
        {readout.map(({ s, p, exact }) => (
          <div key={s.id} className={`readout-row${exact ? '' : ' before'}`}>
            {!single && <span className="line-key" style={{ background: s.color }} aria-hidden="true" />}
            <span className="readout-value tnum">{p ? formatTime(p.cs) : '—'}</span>
            <span className="readout-body">
              <span className="readout-title">
                <span className="t">{single ? (p?.label ?? (p ? formatDate(p.date) : '')) : s.label}</span>
                {p?.pb && <span className="badge pb">PB</span>}
              </span>
              <span className="readout-sub">
                {!p
                  ? 'pas encore de temps à cette date'
                  : single
                    ? p.label
                      ? formatDate(p.date)
                      : ''
                    : [formatDate(p.date), p.label].filter(Boolean).join('\u00a0· ')}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Repères de l'axe des temps (centièmes) : le plus grand pas « rond » qui donne
 * encore au moins 3 repères dans la plage, pour que chaque point soit lisible.
 */
function timeTicks(min: number, max: number): number[] {
  const steps = [60000, 30000, 12000, 6000, 3000, 2000, 1000, 500, 250, 200, 100, 50, 25, 20, 10];
  let ticks: number[] = [];
  for (const step of steps) {
    ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
    if (ticks.length >= 3) break;
  }
  return ticks;
}

/** Barres horizontales (points par nage). */
export function StrokeBars({
  rows,
  max,
}: {
  rows: {
    key: string;
    label: string;
    color: string;
    value: number | null;
    sub?: string;
  }[];
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
              style={{
                width: r.value ? `${Math.max(2, (r.value / max) * 100)}%` : 0,
                background: r.color,
              }}
            />
          </div>
          <span className="hbar-val">{r.value ?? '–'}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Colonnes : une valeur par compétition, dans l'ordre chronologique          */
/* ------------------------------------------------------------------------ */

export interface ColumnDatum {
  key: string;
  date: string;
  value: number;
  /** Titre de l'infobulle (nom de la compétition). */
  title: string;
  /** Lignes complémentaires de l'infobulle. */
  lines?: string[];
}

const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function niceCeil(v: number): { max: number; step: number } {
  const raw = v / 4;
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  return { max: Math.ceil(v / step) * step, step };
}

/**
 * Histogramme chronologique (une colonne par compétition). Barres fines à
 * extrémité arrondie, grille discrète, valeur affichée sur la dernière et la
 * meilleure colonne seulement, infobulle au survol / toucher / clavier.
 */
export function ColumnChart({
  data,
  height = 190,
  unit = 'pts',
  ariaLabel,
  onOpen,
}: {
  data: ColumnDatum[];
  height?: number;
  unit?: string;
  ariaLabel: string;
  /** Ouverture de l'élément (clic souris, second toucher, Entrée). */
  onOpen?: (key: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [active, setActive] = useState<number | null>(null);
  const lastPointer = useRef<string>('mouse');

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.max(240, entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { top: 22, right: 6, bottom: 24, left: 34 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  // Au-delà de ce qui tient lisiblement, on garde les plus récentes
  const fit = Math.max(4, Math.floor(innerW / 10));
  const shown = data.length > fit ? data.slice(-fit) : data;
  const n = shown.length;
  if (!n) return null;

  const { max, step } = niceCeil(Math.max(...shown.map((d) => d.value)) * 1.08 || 100);
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
  const slot = innerW / n;
  const barW = Math.max(4, Math.min(24, slot * 0.6));
  const cx = (i: number) => pad.left + slot * (i + 0.5);
  const sy = (v: number) => pad.top + innerH - (v / max) * innerH;
  const base = pad.top + innerH;

  const bestIdx = shown.reduce((b, d, i) => (d.value > shown[b].value ? i : b), 0);
  const labelled = new Set([n - 1, bestIdx]);

  // Repères de date : premier mois de chaque groupe, espacés d'au moins 54 px
  const xLabels: { i: number; text: string }[] = [];
  let lastX = -Infinity;
  let lastMonth = -1;
  shown.forEach((d, i) => {
    const dt = fromISO(d.date);
    const key = dt.getFullYear() * 12 + dt.getMonth();
    if (key === lastMonth) return;
    lastMonth = key;
    if (cx(i) - lastX < 54) return;
    const yy = String(dt.getFullYear()).slice(2);
    xLabels.push({
      i,
      text: `${SHORT_MONTHS[dt.getMonth()]}\u00a0${yy}`,
    });
    lastX = cx(i);
  });

  const pick = (clientX: number, rect: DOMRect) => {
    const i = Math.floor((clientX - rect.left - pad.left) / slot);
    return Math.max(0, Math.min(n - 1, i));
  };
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    lastPointer.current = e.pointerType;
    const i = pick(e.clientX, e.currentTarget.getBoundingClientRect());
    if (e.pointerType !== 'mouse' && i === active && onOpen) onOpen(shown[i].key);
    else setActive(i);
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== 'mouse') return;
    setActive(pick(e.clientX, e.currentTarget.getBoundingClientRect()));
  };
  const onClick = () => {
    if (lastPointer.current === 'mouse' && active != null && onOpen) onOpen(shown[active].key);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1));
    else if (e.key === 'Enter' && active != null && onOpen) onOpen(shown[active].key);
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  };

  const bar = (x: number, v: number) => {
    const y = sy(v);
    const h = base - y;
    const r = Math.min(4, barW / 2, h);
    const x0 = x - barW / 2;
    const x1 = x + barW / 2;
    return `M${x0},${base}V${y + r}Q${x0},${y} ${x0 + r},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${base}Z`;
  };

  const a = active != null ? shown[active] : null;
  return (
    <div className="chart" ref={wrapRef}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onMove}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
        onClick={onClick}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        style={{ cursor: onOpen ? 'pointer' : undefined }}
      >
        <g className="grid">
          {ticks.map((v) => (
            <line key={v} x1={pad.left} x2={width - pad.right} y1={sy(v)} y2={sy(v)} />
          ))}
        </g>
        <g className="axis">
          {ticks.map((v) => (
            <text key={v} x={pad.left - 6} y={sy(v) + 4} textAnchor="end">
              {v}
            </text>
          ))}
          {xLabels.map((l) => (
            <text key={l.i} x={cx(l.i)} y={height - 6} textAnchor="middle">
              {l.text}
            </text>
          ))}
        </g>
        {shown.map((d, i) => (
          <path
            key={d.key}
            d={bar(cx(i), d.value)}
            fill="var(--chart-line)"
            opacity={active == null || active === i ? 1 : 0.45}
          />
        ))}
        <g className="axis">
          {[...labelled].map((i) => (
            <text
              key={i}
              x={cx(i)}
              y={sy(shown[i].value) - 6}
              textAnchor="middle"
              style={{ fill: 'var(--text)', fontWeight: 600 }}
            >
              {shown[i].value}
            </text>
          ))}
        </g>
      </svg>
      {a && active != null && (
        <div
          className="chart-tip wrap"
          style={{
            left: Math.min(Math.max(cx(active), 95), width - 95),
            top: Math.max(0, sy(a.value) - 92),
          }}
        >
          <div className="v">
            {a.value} <span style={{ fontSize: 12, fontWeight: 600 }}>{unit}</span>
          </div>
          <div className="t">{a.title}</div>
          <div className="k">{formatDate(a.date)}</div>
          {a.lines?.map((l) => (
            <div key={l} className="k">
              {l}
            </div>
          ))}
        </div>
      )}
      {data.length > n && <div className="chart-note">{n} dernières compétitions</div>}
    </div>
  );
}
