import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { bindLayers, goBack, isLayerAbove, popLayer, pushLayer } from '../router';
import { STROKE_BY_ID } from '../lib/events';
import { formatDelta, formatDeltaPct } from '../lib/time';
import { getState } from '../store/store';
import type { Round, Stroke, Swimmer } from '../store/types';

/* ------------------------------------------------------------------------ */
/* Hôte global : feuilles modales, confirmations, toasts, confettis          */
/* ------------------------------------------------------------------------ */

interface SheetEntry {
  id: number;
  render: (close: () => void) => ReactNode;
  closing: boolean;
  /** Entrée d'historique de la fenêtre (bouton retour). */
  layer: string;
}
interface ActionEntry {
  id: number;
  title?: string;
  message?: string;
  actions: { label: string; destructive?: boolean; onSelect: () => void }[];
  cancelLabel: string;
  onCancel?: () => void;
  layer?: string;
}
interface ToastEntry {
  id: number;
  text: string;
  icon?: string;
}

interface UiState {
  sheets: SheetEntry[];
  action: ActionEntry | null;
  toast: ToastEntry | null;
  confetti: number;
}

let ui: UiState = { sheets: [], action: null, toast: null, confetti: 0 };
const uiListeners = new Set<() => void>();
let seq = 1;
const setUi = (patch: Partial<UiState>) => {
  ui = { ...ui, ...patch };
  uiListeners.forEach((l) => l());
};

/** Ferme une feuille ; fermée par un bouton (pas par le bouton retour), elle retire son entrée d'historique. */
function closeSheet(id: number, fromHistory = false) {
  const entry = ui.sheets.find((s) => s.id === id);
  if (!entry || entry.closing) return;
  setUi({ sheets: ui.sheets.map((s) => (s.id === id ? { ...s, closing: true } : s)) });
  setTimeout(() => setUi({ sheets: ui.sheets.filter((s) => s.id !== id) }), 230);
  if (!fromHistory) popLayer(entry.layer);
}

/** Ferme la confirmation ouverte, puis lance l'action choisie (ou l'annulation). */
function dismissAction(run?: () => void, fromHistory = false) {
  const a = ui.action;
  if (!a) return;
  setUi({ action: null });
  if (!fromHistory && a.layer) popLayer(a.layer);
  run?.();
}

// Bouton retour (Android, navigateur, geste de Safari) : il ferme les fenêtres au lieu de changer de page
bindLayers({
  isOpen: (token) => ui.sheets.some((s) => s.layer === token && !s.closing) || ui.action?.layer === token,
  closeAbove: (token) => {
    if (ui.action?.layer && isLayerAbove(ui.action.layer, token)) dismissAction(ui.action.onCancel, true);
    for (const s of [...ui.sheets].reverse()) if (!s.closing && isLayerAbove(s.layer, token)) closeSheet(s.id, true);
  },
});

export const overlay = {
  /** Ouvre une feuille modale ; renvoie une fonction de fermeture. */
  sheet(render: (close: () => void) => ReactNode): () => void {
    const id = seq++;
    setUi({ sheets: [...ui.sheets, { id, render, closing: false, layer: pushLayer() }] });
    return () => closeSheet(id);
  },

  actions(opts: Omit<ActionEntry, 'id' | 'cancelLabel' | 'layer'> & { cancelLabel?: string }) {
    if (ui.action) dismissAction(ui.action.onCancel);
    setUi({ action: { ...opts, cancelLabel: opts.cancelLabel ?? 'Annuler', id: seq++, layer: pushLayer() } });
  },

  confirm(opts: { title: string; message?: string; confirmLabel: string; destructive?: boolean }): Promise<boolean> {
    return new Promise((resolve) => {
      overlay.actions({
        title: opts.title,
        message: opts.message,
        actions: [{ label: opts.confirmLabel, destructive: opts.destructive, onSelect: () => resolve(true) }],
        onCancel: () => resolve(false),
      });
    });
  },

  toast(text: string, icon = '✓') {
    const id = seq++;
    setUi({ toast: { id, text, icon } });
    setTimeout(() => {
      if (ui.toast?.id === id) setUi({ toast: null });
    }, 2600);
  },

  celebrate() {
    // Réglage « Célébrer les records » désactivé : ni confettis ni vibration
    if (!getState().settings.celebrate) return;
    setUi({ confetti: ui.confetti + 1 });
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate?.([30, 40, 30]);
      } catch {
        /* ignore */
      }
    }
  },
};

function useUi(): UiState {
  return useSyncExternalStore(
    (l) => {
      uiListeners.add(l);
      return () => uiListeners.delete(l);
    },
    () => ui,
  );
}

/**
 * Le glissé (dx, dy depuis le début du toucher) peut-il faire défiler un élément de la fenêtre
 * ouverte, sous le doigt ? Une liste en butée (tout en haut et on tire vers le bas, ou tout en bas
 * et on pousse vers le haut) ne défile plus : le geste n'est alors transmis à rien d'autre.
 */
function canScrollInside(target: EventTarget | null, dx: number, dy: number): boolean {
  let el = target instanceof Element ? target : null;
  if (el?.closest('input[type="range"]')) return true;
  const vertical = Math.abs(dy) >= Math.abs(dx);
  while (el && el !== document.body) {
    const st = getComputedStyle(el);
    if (vertical) {
      if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        if (dy > 0) return el.scrollTop > 0;
        if (dy < 0) return el.scrollTop + el.clientHeight < el.scrollHeight - 1;
        return true;
      }
    } else if (/(auto|scroll)/.test(st.overflowX) && el.scrollWidth > el.clientWidth + 1) return true;
    if (el.classList.contains('sheet') || el.classList.contains('action-sheet')) return false;
    el = el.parentElement;
  }
  return false;
}

export function UiHost() {
  const state = useUi();
  const anyOpen = state.sheets.length > 0 || !!state.action;
  useEffect(() => {
    document.body.style.overflow = anyOpen ? 'hidden' : '';
    if (!anyOpen) return;
    // Fenêtre ouverte : un glissé ne fait défiler que la liste de la fenêtre, et seulement si elle
    // peut encore défiler dans ce sens. Sinon rien ne bouge : ni la page derrière, ni (iPhone, clavier
    // ouvert) la zone visible, qui emportait la fenêtre avec elle pendant la saisie.
    let x0 = 0;
    let y0 = 0;
    const onStart = (e: TouchEvent) => {
      x0 = e.touches[0]?.clientX ?? 0;
      y0 = e.touches[0]?.clientY ?? 0;
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !e.cancelable) return;
      const dx = e.touches[0].clientX - x0;
      const dy = e.touches[0].clientY - y0;
      if (!canScrollInside(e.target, dx, dy)) e.preventDefault();
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
    };
  }, [anyOpen]);

  // Clavier ouvert (iPhone) : la page garde sa hauteur, seule la zone visible rétrécit. Les feuilles
  // se placent au-dessus du clavier grâce à --kb (hauteur du clavier) et --vvh (hauteur visible).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement.style;
    const update = () => {
      root.setProperty('--vvh', `${Math.round(vv.height)}px`);
      root.setProperty('--kb', `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (ui.action) dismissAction(ui.action.onCancel);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {state.sheets.map((s) => (
        <SheetFrame key={s.id} entry={s} />
      ))}
      {state.action && (
        <>
          <div
            className="sheet-backdrop"
            style={{ zIndex: 120 }}
            onClick={() => dismissAction(state.action?.onCancel)}
          />
          <div className="action-sheet" role="dialog" aria-modal="true">
            <div className="group">
              {(state.action.title || state.action.message) && (
                <div className="msg">
                  {state.action.title && <strong>{state.action.title}</strong>}
                  {state.action.message}
                </div>
              )}
              {state.action.actions.map((a) => (
                <button
                  key={a.label}
                  className={a.destructive ? 'destructive' : ''}
                  onClick={() => dismissAction(a.onSelect)}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <div className="group cancel">
              <button
                className="cancel"
                onClick={() => dismissAction(state.action?.onCancel)}
              >
                {state.action.cancelLabel}
              </button>
            </div>
          </div>
        </>
      )}
      {state.toast && (
        <div className="toast-wrap" role="status" aria-live="polite">
          <div className="toast" key={state.toast.id}>
            <span className="t-icon">{state.toast.icon}</span>
            {state.toast.text}
          </div>
        </div>
      )}
      {state.confetti > 0 && <Confetti key={state.confetti} />}
    </>
  );
}

function SheetFrame({ entry }: { entry: SheetEntry }) {
  const close = () => closeSheet(entry.id);
  const ref = useRef<HTMLDivElement>(null);
  // Feuille avec une recherche : hauteur fixe (classe plutôt que « :has() », absent des navigateurs plus anciens)
  useLayoutEffect(() => {
    ref.current?.classList.toggle('has-search', !!ref.current.querySelector('.sheet-search'));
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !ui.action && ui.sheets[ui.sheets.length - 1]?.id === entry.id) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <div className={`sheet-backdrop${entry.closing ? ' closing' : ''}`} onClick={close} />
      <div ref={ref} className={`sheet${entry.closing ? ' closing' : ''}`} role="dialog" aria-modal="true">
        {entry.render(close)}
      </div>
    </>
  );
}

/** En-tête + corps standard d'une feuille. */
export function SheetLayout({
  title,
  onCancel,
  cancelLabel = 'Annuler',
  onDone,
  doneLabel = 'OK',
  doneDisabled,
  children,
}: {
  title: string;
  onCancel: () => void;
  cancelLabel?: string;
  onDone?: () => void;
  doneLabel?: string;
  doneDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <div className="sheet-head">
        <div>
          <button className="icon-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
        <div className="sheet-title">{title}</div>
        <div style={{ textAlign: 'right' }}>
          {onDone && (
            <button className="icon-btn strong" onClick={onDone} disabled={doneDisabled} style={doneDisabled ? { opacity: 0.35 } : undefined}>
              {doneLabel}
            </button>
          )}
        </div>
      </div>
      <div className="sheet-body">{children}</div>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Barre de navigation                                                       */
/* ------------------------------------------------------------------------ */

/** Au-delà, le titre ne tient pas dans la barre du haut : il reste aussi en grand dans la page. */

export function NavBar({
  title,
  subtitle,
  back,
  large = true,
  right,
  left,
  wide,
  aside,
  brand,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: string | boolean;
  large?: boolean;
  right?: ReactNode;
  left?: ReactNode;
  wide?: boolean;
  /** À droite du grand titre. */
  aside?: ReactNode;
  /** Logo centré à la place du grand titre (accueil) ; le titre reste lu par les lecteurs d'écran. */
  brand?: ReactNode;
}) {
  // Titre en grand dans la page ; sans titre en grand (fiches), il s'affiche dans la ligne des boutons
  const bigTitle = large;
  return (
    <>
      <header className={`navbar${bigTitle ? '' : ' no-large'}${wide ? ' wide' : ''}${bigTitle && !back && !left && !right ? ' bare' : ''}`}>
        <div className="navbar-row">
          <div className="navbar-left">
            {back ? (
              <button
                className="icon-btn back"
                aria-label="Retour"
                onClick={() => goBack(typeof back === 'string' ? back : '/')}
              >
                <Icon name="chevronLeft" />
              </button>
            ) : (
              left
            )}
          </div>
          <div className="navbar-title">{title}</div>
          <div className="navbar-right">{right}</div>
        </div>
      </header>
      {large && (
        <div className={`large-head${wide ? ' wide' : ''}${brand ? ' brand' : ''}`}>
          {brand ? (
            <>
              <h1 className="sr-only">{title}</h1>
              <div className="large-brand">{brand}</div>
            </>
          ) : (
            <div className="large-title-row">
              <h1 className="large-title">{title}</h1>
              {aside}
            </div>
          )}
          {subtitle && <div className="large-subtitle">{subtitle}</div>}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Petits composants                                                         */
/* ------------------------------------------------------------------------ */

const AVATAR_GRADIENTS = [
  ['#0a84ff', '#5e5ce6'],
  ['#ff375f', '#ff9f0a'],
  ['#30d158', '#00a3a3'],
  ['#bf5af2', '#5e5ce6'],
  ['#ff2d92', '#bf5af2'],
  ['#ff9f0a', '#ff453a'],
  ['#64d2ff', '#0a84ff'],
  ['#8e8e93', '#48484a'],
];

export function Avatar({
  swimmer,
  size = 44,
  onBrand,
}: {
  swimmer: Pick<Swimmer, 'firstName' | 'lastName' | 'color'>;
  size?: number;
  /** Sur un fond bleu ESN : pastille blanche translucide au lieu du dégradé */
  onBrand?: boolean;
}) {
  const [a, b] = AVATAR_GRADIENTS[swimmer.color % AVATAR_GRADIENTS.length];
  const initials = `${swimmer.firstName?.[0] ?? ''}${swimmer.lastName?.[0] ?? ''}`.toUpperCase();
  return (
    <span
      className={`avatar${onBrand ? ' on-brand' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, ${a}, ${b})` }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

export function StrokeTag({ stroke, distance, size = 40 }: { stroke: Stroke; distance?: number; size?: number }) {
  const info = STROKE_BY_ID[stroke];
  return (
    <span
      className="stroke-tag"
      style={
        { '--tag-color': `var(${info.colorVar}-tag)`, width: size, height: size, fontSize: size < 36 ? 10 : 12 } as CSSProperties
      }
      aria-hidden="true"
    >
      {distance ?? info.short}
    </span>
  );
}

export function StrokeDot({ stroke }: { stroke: Stroke }) {
  return <span className="stroke-dot" style={{ background: `var(${STROKE_BY_ID[stroke].colorVar})` }} aria-hidden="true" />;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { id: T; label: ReactNode }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={o.id === value}
          className={o.id === value ? 'active' : ''}
          onClick={() => onChange(o.id)}
          type="button"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
    />
  );
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  placeholder = '–',
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  placeholder?: string;
}) {
  return (
    <div className="stepper">
      <button type="button" aria-label="Diminuer" onClick={() => onChange(value == null || value <= min ? undefined : value - 1)}>
        −
      </button>
      <span>{value ?? placeholder}</span>
      <button type="button" aria-label="Augmenter" onClick={() => onChange(Math.min(max, (value ?? min - 1) + 1))}>
        +
      </button>
    </div>
  );
}

export function Row({
  icon,
  iconBg,
  title,
  sub,
  value,
  chevron,
  onClick,
  href,
  external,
  danger,
  accent,
  children,
  className = '',
}: {
  icon?: IconName;
  iconBg?: string;
  title?: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  chevron?: boolean;
  onClick?: () => void;
  href?: string;
  external?: boolean;
  danger?: boolean;
  accent?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const cls = `row${icon ? ' with-icon' : ''}${danger ? ' danger' : ''}${accent ? ' accent' : ''} ${className}`;
  const content = (
    <>
      {icon && (
        <span className="row-icon" style={iconBg ? { background: iconBg } : undefined}>
          <Icon name={icon} />
        </span>
      )}
      {children ?? (
        <div className="row-body">
          <div className="row-title">{title}</div>
          {sub && <div className="row-sub">{sub}</div>}
        </div>
      )}
      {value != null && <div className="row-value">{value}</div>}
      {external && <Icon name="external" className="chev" style={{ width: 20, height: 20, color: 'var(--accent)' }} />}
      {chevron && <Icon name="chevronRight" className="chev" />}
    </>
  );
  if (href)
    return (
      <a className={cls} href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
        {content}
      </a>
    );
  if (onClick)
    return (
      <button className={cls} onClick={onClick} type="button">
        {content}
      </button>
    );
  return <div className={cls}>{content}</div>;
}

export function Empty({ icon, title, text, action }: { icon: IconName | string; title: string; text?: ReactNode; action?: ReactNode }) {
  const isIcon = icon.length > 2;
  return (
    <div className="empty">
      <span className="empty-icon">{isIcon ? <Icon name={icon as IconName} /> : icon}</span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Section({
  title,
  action,
  caption,
  footer,
  children,
  id,
}: {
  title?: ReactNode;
  action?: ReactNode;
  caption?: string;
  footer?: ReactNode;
  children: ReactNode;
  /** Ancre (raccourcis d'une page longue) */
  id?: string;
}) {
  return (
    <section className="section" id={id}>
      {(title || action) && (
        <div className="section-head">
          {title && <h2 className="section-title">{title}</h2>}
          {action}
        </div>
      )}
      {caption && <p className="section-caption">{caption}</p>}
      {children}
      {footer && <div className="section-foot">{footer}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Confettis (célébration d'un record personnel)                             */
/* ------------------------------------------------------------------------ */

function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    c.width = W * dpr;
    c.height = H * dpr;
    ctx.scale(dpr, dpr);
    const colors = ['#0a84ff', '#ffd60a', '#30d158', '#ff375f', '#bf5af2', '#64d2ff', '#ff9f0a'];
    const parts = Array.from({ length: 140 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * 80,
      y: H * 0.35,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 14 - 6,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    let frame = 0;
    let raf = 0;
    const tick = () => {
      frame++;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += 0.35;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.globalAlpha = Math.max(0, 1 - frame / 160);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
        ctx.restore();
      }
      if (frame < 160) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="confetti" style={{ width: '100vw', height: '100vh' }} />;
}

/* ------------------------------------------------------------------------ */
/* Logo « ESN Compétition » (couleurs officielles en thème clair, version     */
/* éclaircie en thème sombre)                                                 */
/* ------------------------------------------------------------------------ */

export function BrandLogo({
  height = 40,
  variant = 'full',
  className = '',
}: {
  height?: number;
  /** full = logo du club + « COMPÉTITION » ; mark = logo du club seul (petites tailles) */
  variant?: 'full' | 'mark';
  className?: string;
}) {
  const base = variant === 'full' ? 'esn-competition' : 'esn-mark';
  return (
    <span className={`brand-logo ${className}`} style={{ height }} role="img" aria-label={variant === 'full' ? 'ESN Compétition' : 'ESN Seraing'}>
      <img src={`./brand/${base}.png`} alt="" height={height} />
    </span>
  );
}

/**
 * Place dans une épreuve : sur le podium d'une finale (ou d'une finale directe), aux couleurs de la
 * médaille ; sinon en texte simple. Les séries ne donnent pas de médaille.
 */
export function PlaceLabel({ place, round }: { place: number; round?: Round }) {
  const label = `${place}${place === 1 ? 're' : 'e'}\u00a0place`;
  if (place > 3 || (round && round !== 'TIM' && round !== 'FINAL')) return <>{label}</>;
  return <span className={`place-pill place-${place}`}>{label}</span>;
}

/** Gain sur le record personnel : « −2.45 (−3,0 %) » ; sur un petit écran, le pourcentage passe à la ligne. */
export function PbDelta({ deltaCs, timeCs }: { deltaCs: number; timeCs?: number | null }) {
  const pct = timeCs != null ? formatDeltaPct(deltaCs, timeCs) : '';
  return (
    <span className="small good tnum pb-delta">
      {formatDelta(deltaCs)}
      {pct && <span className="pb-pct"> ({pct})</span>}
    </span>
  );
}
