import { describe, expect, it } from 'vitest';
import { formatTime, parseTime, parseDigits, toDigits, formatDelta } from '../src/lib/time';
import { computePoints, timeForPoints } from '../src/lib/points';

describe('temps', () => {
  it('formate', () => {
    expect(formatTime(3845)).toBe('38.45');
    expect(formatTime(8462)).toBe('1:24.62');
    expect(formatTime(38933)).toBe('6:29.33');
    expect(formatTime(5)).toBe('0.05');
    expect(formatTime(null)).toBe('–');
    expect(formatDelta(-123)).toBe('−1.23');
  });

  it('interprète les saisies', () => {
    expect(parseTime('1:24.62')).toBe(8462);
    expect(parseTime('1.24.62')).toBe(8462);
    expect(parseTime('84.62')).toBe(8462);
    expect(parseTime('84,62')).toBe(8462);
    expect(parseTime('38.4')).toBe(3840);
    expect(parseTime('12462')).toBe(8462);
    expect(parseTime('1:75.00')).toBeNull();
    expect(parseTime('abc')).toBeNull();
    expect(parseTime('')).toBeNull();
  });

  it('saisie chiffre par chiffre', () => {
    expect(parseDigits('3845')).toBe(3845);
    expect(parseDigits('62933')).toBe(38933);
    expect(toDigits(8462)).toBe('12462');
    expect(toDigits(3845)).toBe('3845');
  });
});

describe('points', () => {
  it('correspond aux points FINA 2026 de swimrankings', () => {
    expect(computePoints(8462, 'SCM', 'F', 100, 'FREE')).toBe(205);
    expect(computePoints(38933, 'SCM', 'F', 400, 'FREE')).toBe(206);
    expect(computePoints(11661, 'SCM', 'F', 100, 'BREAST')).toBe(152);
  });
  it('temps pour un score donné', () => {
    const t = timeForPoints(205, 'SCM', 'F', 100, 'FREE')!;
    expect(computePoints(t, 'SCM', 'F', 100, 'FREE')).toBeGreaterThanOrEqual(204);
  });
});
