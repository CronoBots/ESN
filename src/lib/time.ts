/**
 * Les temps sont stockés en centièmes de seconde (entiers) pour éviter
 * toute erreur d'arrondi : 1:24.62 → 8462.
 */

/** Formate un temps : 3845 → "38.45", 8462 → "1:24.62", 372345 → "1:02:03.45". */
export function formatTime(cs: number | null | undefined): string {
  if (cs == null || !Number.isFinite(cs) || cs < 0) return '–';
  const total = Math.round(cs);
  const hundredths = total % 100;
  const totalSeconds = Math.floor(total / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const hh = String(hundredths).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${hh}`;
  }
  if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, '0')}.${hh}`;
  return `${seconds}.${hh}`;
}

/** Écart signé : -123 → "-1.23", 45 → "+0.45". */
export function formatDelta(cs: number): string {
  const sign = cs < 0 ? '−' : cs > 0 ? '+' : '±';
  return `${sign}${formatTime(Math.abs(cs))}`;
}

/**
 * Progression en pour cent : « −3,0 % » (temps gagné), « +1,2 % ». Rapportée au temps réalisé, comme
 * SplashMe (1:24.62 → 1:22.17 : −2.45, soit −3,0 %), pour que les parents lisent le même chiffre.
 */
export function formatDeltaPct(deltaCs: number, timeCs: number): string {
  if (!(timeCs > 0)) return '';
  const pct = (deltaCs / timeCs) * 100;
  const sign = pct < 0 ? '−' : pct > 0 ? '+' : '±';
  return `${sign}${Math.abs(pct).toLocaleString('fr-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}\u00a0%`;
}

/**
 * Interprète un temps saisi librement. Accepte :
 * "1:24.62", "1.24.62", "1'24\"62", "84.62", "84,62", "38.4" (→ 38.40),
 * "12462" (chiffres seuls, lus de droite à gauche → 1:24.62).
 */
export function parseTime(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input)
    .trim()
    .replace(/[’'′]/g, ':')
    .replace(/["″]/g, '.')
    .replace(/\s+/g, '');
  if (!s) return null;

  if (/^\d+$/.test(s)) return parseDigits(s);

  // h:mm:ss.cc | m:ss.cc | ss.cc | m.ss.cc
  const parts = s.split(/[:.,]/);
  if (parts.some((p) => !/^\d+$/.test(p))) return null;
  let h = 0;
  let m = 0;
  let sec = 0;
  let frac = '0';
  if (parts.length === 2) {
    // "ss.cc" ou "m:ss"
    if (s.includes(':')) {
      m = +parts[0];
      sec = +parts[1];
    } else {
      sec = +parts[0];
      frac = parts[1];
    }
  } else if (parts.length === 3) {
    m = +parts[0];
    sec = +parts[1];
    frac = parts[2];
  } else if (parts.length === 4) {
    h = +parts[0];
    m = +parts[1];
    sec = +parts[2];
    frac = parts[3];
  } else {
    return null;
  }
  if (parts.length >= 3 && sec >= 60) return null;
  const cs = fracToCs(frac);
  if (cs == null) return null;
  return ((h * 60 + m) * 60 + sec) * 100 + cs;
}

function fracToCs(frac: string): number | null {
  if (!/^\d+$/.test(frac)) return null;
  if (frac.length === 1) return +frac * 10;
  return +frac.slice(0, 2);
}

/** "12462" → 8462 (1:24.62) ; "3845" → 3845 ; "5" → 5 (0.05). */
export function parseDigits(digits: string): number | null {
  const d = digits.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (!d) return null;
  if (d.length > 7) return null;
  const padded = d.padStart(6, '0');
  const cs = +padded.slice(-2);
  const sec = +padded.slice(-4, -2);
  const min = +padded.slice(0, -4);
  if (sec >= 60 && min > 0) return null;
  return (min * 60 + sec) * 100 + cs;
}

/** Représentation "chiffres seuls" pour l'éditeur de temps : 8462 → "12462". */
export function toDigits(cs: number | null | undefined): string {
  if (cs == null) return '';
  const total = Math.round(cs);
  const hundredths = total % 100;
  const totalSeconds = Math.floor(total / 100);
  const sec = totalSeconds % 60;
  const min = Math.floor(totalSeconds / 60);
  if (min > 0) return `${min}${String(sec).padStart(2, '0')}${String(hundredths).padStart(2, '0')}`;
  return `${sec}${String(hundredths).padStart(2, '0')}`;
}

/** Allure moyenne aux 100 m. */
export function pacePer100(cs: number, distance: number): number {
  return Math.round((cs / distance) * 100);
}

/** Vitesse moyenne en m/s. */
export function speed(cs: number, distance: number): number {
  return distance / (cs / 100);
}
