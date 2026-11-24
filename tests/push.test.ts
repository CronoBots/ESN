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

  it('le robot tourne les jours de compétition du club (dès 3 jours avant, pour le programme), avec ou sans livetiming copié', () => {
    const cal = { events: [{ start: '2026-11-28', end: '2026-11-29', city: 'Testville', name: 'Championnats' }, { start: '2026-12-12', name: 'Un jour' }] };
    expect(clubDayEvents(cal, '2026-11-24')).toHaveLength(0);
    expect(clubDayEvents(cal, '2026-11-25')).toHaveLength(1);
    expect(clubDayEvents(cal, '2026-11-29')).toHaveLength(1);
    expect(clubDayEvents(cal, '2026-11-30')).toHaveLength(0);
    expect(clubDayEvents(cal, '2026-12-12')).toHaveLength(1);
  });
});

describe('activation des notifications : la cause exacte sous l’interrupteur', async () => {
  const { inAppBrowser, pushAdvice, pushDevice, pushWaitAdvice, subscribeAdvice } = await import('../src/lib/push');
  const chrome = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  const webview = 'Mozilla/5.0 (Linux; Android 14; SM-S911B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36';
  const facebook = `${chrome} [FB_IAB/FB4A;FBAV/490.0.0.0;]`;
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

  it('reconnaît Android, l’iPhone et les navigateurs intégrés (WhatsApp, Facebook)', () => {
    expect(pushDevice(chrome, false)).toBe('android');
    expect(pushDevice(iphone, false)).toBe('ios');
    expect(inAppBrowser(chrome)).toBe(false);
    expect(inAppBrowser(webview)).toBe(true);
    expect(inAppBrowser(facebook)).toBe(true);
    expect(inAppBrowser(iphone)).toBe(false);
  });

  it('Android : ouvrir dans Chrome, autoriser dans les réglages du site ou de l’application installée', () => {
    expect(pushAdvice('inapp', { device: 'android', installed: false })).toMatch(/Ouvrir dans Chrome/);
    expect(pushAdvice('denied', { device: 'android', installed: true })).toMatch(/Infos sur l’appli/);
    expect(pushAdvice('denied', { device: 'android', installed: false })).toMatch(/Paramètres des sites › Notifications/);
    expect(pushAdvice('denied', { device: 'ios', installed: true })).toMatch(/Réglages de l’iPhone/);
    expect(pushAdvice('off', { device: 'android', installed: false })).toBeNull();
    expect(pushWaitAdvice({ device: 'android', installed: false })).toMatch(/cloche/);
  });

  it('inscription refusée par le service de Google : services Google Play, Brave', () => {
    const abort = Object.assign(new Error('Registration failed - push service error'), { name: 'AbortError' });
    expect(subscribeAdvice(abort, 'android')).toMatch(/services Google Play/);
    expect(subscribeAdvice(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }), 'android')).toMatch(/autorisez-les/);
    expect(subscribeAdvice(Object.assign(new Error('Registration failed - permission denied'), { name: 'AbortError' }), 'android')).toMatch(/Applications › Chrome/);
    expect(subscribeAdvice(new Error('autre'), 'android')).toMatch(/réessayez/);
  });
});
