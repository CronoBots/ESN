import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData, Swimmer } from '../src/store/types';
import { todayISO } from '../src/lib/dates';

/*
 * Compétition copiée avec le site (livetiming de la fédération) : l'application ouverte repère chaque minute
 * une nouvelle feuille et la lit tout de suite, au lieu d'attendre la recherche des 5 minutes.
 * Nom et compétition fictifs.
 */

let site: Record<string, string | Error>;
let calls: string[];

beforeEach(() => {
  site = {};
  calls = [];
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    const a = site[url];
    if (a === undefined) return new Response('', { status: 404 });
    if (a instanceof Error) throw a;
    return new Response(a);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const alice: Swimmer = { id: 'a1', firstName: 'Alice', lastName: 'FICTIF', gender: 'F', birthYear: 2015, color: 0, relation: 'followed', favorite: false, createdAt: 0 };

const data = (engine: number): AppData => ({
  version: 1,
  swimmers: [alice],
  meets: [],
  swims: [],
  goals: [],
  settings: { theme: 'auto', includeTraining: false, defaultCourse: 'SCM', onboarded: true, celebrate: true, liveSync: { enabled: true, processed: {}, engine } },
});

async function fresh() {
  vi.resetModules();
  const store = await import('../src/store/store');
  const live = await import('../src/lib/liveResults');
  return { ...store, ...live };
}

const files = (f: Record<string, string>) => JSON.stringify({ files: f });

describe('direct : nouvelle feuille copiée lue tout de suite', () => {
  it('repère une feuille publiée depuis la dernière recherche, sans attendre le cache d’une minute', async () => {
    const today = todayISO();
    site['./live/meets.json'] = JSON.stringify({ meets: [{ id: 'ext-T', name: 'Championnats fictifs', startDate: today, endDate: today }] });
    site['./live/ext-T/files.json'] = files({ 'StartList_1.pdf': 'a1' });
    const app = await fresh();
    app.actions.replaceAll(data(app.SYNC_ENGINE));
    // Jamais cherché : à lire
    expect(await app.mirroredChanged()).toBe(true);
    await app.syncLive();
    // Rien de nouveau depuis la recherche
    expect(await app.mirroredChanged()).toBe(false);
    // Feuille de résultats copiée : repérée à la vérification suivante (liste relue à chaque fois)
    site['./live/ext-T/files.json'] = files({ 'StartList_1.pdf': 'a1', 'ResultList_1.pdf': 'b2' });
    expect(await app.mirroredChanged()).toBe(true);
    await app.syncLive();
    expect(await app.mirroredChanged()).toBe(false);
    // Hors connexion : pas de recherche inutile
    site['./live/ext-T/files.json'] = new Error('hors ligne');
    expect(await app.mirroredChanged()).toBe(false);
  });

  it('rien à vérifier sans compétition copiée en cours', async () => {
    site['./live/meets.json'] = JSON.stringify({ meets: [{ id: 'ext-T', name: 'Championnats fictifs', startDate: '2099-01-10', endDate: '2099-01-11' }] });
    const app = await fresh();
    expect(await app.mirroredChanged()).toBe(false);
    expect(calls.some((u) => u.includes('files.json'))).toBe(false);
  });

  it('séries en direct : la feuille de l’épreuve est relue à chaque rafraîchissement d’une minute', async () => {
    site['./live/ext-T/files.json'] = files({ 'StartList_1.pdf': 'a1' });
    const app = await fresh();
    const t0 = 1_900_000_000_000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
    await app.loadEventSheet('ext-T', 1, true);
    now.mockReturnValue(t0 + 60000);
    await app.loadEventSheet('ext-T', 1, true);
    // Avant : gardée 2 minutes, la liste des feuilles n'était relue qu'un rafraîchissement sur deux
    expect(calls.filter((u) => u.includes('files.json'))).toHaveLength(2);
  });
});
