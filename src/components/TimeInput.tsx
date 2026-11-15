import { useEffect, useRef, useState, type ReactNode } from 'react';
import { parseDigits, parseTime, toDigits } from '../lib/time';

/**
 * Saisie d'un temps façon chronomètre : on tape uniquement les chiffres,
 * ils se remplissent de droite à gauche (1 2 4 6 2 → 1:24.62).
 */
export function TimeInput({
  value,
  onChange,
  autoFocus,
  hint,
  hintClass,
  label = 'Temps',
}: {
  value: number | null | undefined;
  onChange: (cs: number | null) => void;
  autoFocus?: boolean;
  hint?: ReactNode;
  hintClass?: string;
  label?: string;
}) {
  const [digits, setDigits] = useState(() => toDigits(value ?? null));
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Synchronise si la valeur change de l'extérieur
    const cur = parseDigits(digits);
    if ((value ?? null) !== cur) setDigits(toDigits(value ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (autoFocus) setTimeout(() => ref.current?.focus({ preventScroll: true }), 350);
  }, [autoFocus]);

  const update = (d: string) => {
    const clean = d.replace(/\D/g, '').replace(/^0+/, '').slice(0, 7);
    setDigits(clean);
    onChange(clean ? parseDigits(clean) : null);
  };

  const padded = digits.padStart(5, '0');
  const ghostCount = Math.max(0, 5 - digits.length);
  const mins = padded.slice(0, -4);
  const secs = padded.slice(-4, -2);
  const hund = padded.slice(-2);
  const chars: { c: string; ghost: boolean }[] = [];
  let idx = 0;
  const pushDigits = (s: string) => {
    for (const ch of s) {
      chars.push({ c: ch, ghost: idx < ghostCount });
      idx++;
    }
  };
  pushDigits(mins);
  chars.push({ c: ':', ghost: idx <= ghostCount && ghostCount >= mins.length });
  pushDigits(secs);
  chars.push({ c: '.', ghost: false });
  pushDigits(hund);

  const invalid = digits.length > 0 && parseDigits(digits) == null;

  return (
    <div className="time-input" onClick={() => ref.current?.focus()}>
      <div className="display" aria-hidden="true" style={invalid ? { color: 'var(--danger)' } : undefined}>
        {chars.map((ch, i) => (
          <span key={i} className={ch.ghost ? 'ghost' : ''}>
            {ch.c}
          </span>
        ))}
        {focused && <span className="caret" />}
      </div>
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        aria-label={`${label} (chiffres uniquement, ex. 12462 pour 1:24.62)`}
        value={digits}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => update(e.target.value)}
        onPaste={(e) => {
          const txt = e.clipboardData.getData('text');
          const cs = parseTime(txt);
          if (cs != null) {
            e.preventDefault();
            update(toDigits(cs));
          }
        }}
      />
      <div className={`hint ${hintClass ?? ''}`}>
        {invalid ? 'Temps invalide (secondes ≥ 60)' : hint ?? (focused || digits ? '' : 'Touchez pour saisir le temps')}
      </div>
    </div>
  );
}
