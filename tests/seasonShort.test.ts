import { describe, expect, it } from 'vitest';
import { seasonLabel, seasonShort } from '../src/lib/dates';

describe('écriture des saisons', () => {
  it('« 2026/27 » partout, comme le tableau des saisons', () => {
    expect(seasonShort('2026-2027')).toBe('2026/27');
    expect(seasonShort('2099-2100')).toBe('2099/00');
    // Grand bassin : l'année civile reste telle quelle
    expect(seasonShort('2026')).toBe('2026');
    expect(seasonLabel('2026-2027')).toBe(`Saison ${seasonShort('2026-2027')}`);
  });
});
