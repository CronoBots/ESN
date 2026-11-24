import { describe, expect, it } from 'vitest';
import { swimmerKey } from '../src/lib/pushKey';
// @ts-expect-error script Node sans types
import { clubDayEvents } from '../scripts/live-relay.mjs';

describe('notifications des résultats', () => {
  it('même code pour un nageur dans l’application et chez le robot (casse et accents ignorés), jamais le nom en clair', async () => {
    const a = await swimmerKey({ lastName: 'DUPONT', firstName: 'Émma', birthYear: 2015 });
    expect(a).toBe(await swimmerKey({ lastName: 'Dupont', firstName: 'Emma', birthYear: 2015 }));
    expect(a).not.toBe(await swimmerKey({ lastName: 'DUPONT', firstName: 'Emma', birthYear: 2014 }));
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    expect(a).not.toContain('dupont');
  });

  it('le robot tourne les jours de compétition du club (veille comprise), avec ou sans livetiming copié', () => {
    const cal = { events: [{ start: '2026-11-28', end: '2026-11-29', city: 'Testville', name: 'Championnats' }, { start: '2026-12-12', name: 'Un jour' }] };
    expect(clubDayEvents(cal, '2026-11-26')).toHaveLength(0);
    expect(clubDayEvents(cal, '2026-11-27')).toHaveLength(1);
    expect(clubDayEvents(cal, '2026-11-29')).toHaveLength(1);
    expect(clubDayEvents(cal, '2026-11-30')).toHaveLength(0);
    expect(clubDayEvents(cal, '2026-12-12')).toHaveLength(1);
  });
});
