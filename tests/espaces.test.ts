import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppData, Meet, Swim, Swimmer } from '../src/store/types';

/*
 * Deux espaces (« Mon espace » et « Club ») : accueil du club, compétitions et records vus par le
 * club, interrupteur de mise en ligne. Rendu côté serveur, sans navigateur ; noms et temps fictifs.
 */

const h = vi.hoisted(() => ({ state: null as unknown, hooks: 0, downloads: [] as string[] }));

// Compte les hooks appelés par un écran (même nombre à chaque rendu, sinon React plante)
vi.mock('react', async (orig) => {
  const R = await orig<typeof import('react')>();
  return {
    ...R,
    useMemo: ((...a: Parameters<typeof R.useMemo>) => (h.hooks++, R.useMemo(...a))) as typeof R.useMemo,
    useState: ((...a: Parameters<typeof R.useState>) => (h.hooks++, R.useState(...a))) as typeof R.useState,
  };
});
// Données de l'application : fixées par chaque test
vi.mock('../src/store/store', async (orig) => ({ ...(await orig<object>()), useData: () => h.state }));
// Le routeur lit window.location au chargement : remplacé (aucune navigation pendant ces tests)
vi.mock('../src/router', () => ({
  navigate: vi.fn(),
  goBack: vi.fn(),
  bindLayers: vi.fn(),
  isLayerAbove: () => false,
  pushLayer: () => 'couche',
  popLayer: vi.fn(),
  useRoute: () => ({ path: '/' }),
  href: (p: string) => p,
}));
// « Ajouter au calendrier » : le fichier .ics est gardé au lieu d'être téléchargé
vi.mock('../src/lib/ics', async (orig) => ({
  ...(await orig<object>()),
  downloadFile: (_name: string, content: string) => h.downloads.push(content),
}));

const { normalizeData } = await import('../src/store/store');
const { Meets } = await import('../src/screens/Meets');
const { Records } = await import('../src/screens/Records');
const { ClubHome } = await import('../src/screens/ClubHome');
const { spacesEnabled } = await import('../src/lib/features');

const swimmer = (id: string, firstName: string, extra: Partial<Swimmer> = {}) =>
  ({ id, firstName, lastName: 'EXEMPLE', gender: 'F', birthYear: 2014, color: 0, relation: 'followed', favorite: false, member: true, createdAt: 0, ...extra }) as Swimmer;
const meet = (id: string, startDate: string) => ({ id, name: `Meeting ${id}`, city: 'Ville-Test', startDate, course: 'SCM', createdAt: 0 }) as Meet;
let n = 0;
const swim = (swimmerId: string, meetId: string | undefined, date: string, extra: Partial<Swim> = {}) => {
  n++;
  return { id: `c${n}`, swimmerId, meetId, date, distance: 100, stroke: 'FREE', course: 'SCM', context: 'competition', status: 'OK', round: 'TIM', timeCs: 8000 + n, source: 'live', createdAt: n, updatedAt: n, ...extra } as Swim;
};
const setData = (d: Partial<AppData>) => {
  h.state = normalizeData(d);
};

/** HTML rendu d'un écran. */
const html = <P extends object>(Comp: (p: P) => ReactNode, props: P) => renderToStaticMarkup(createElement(Comp as never, props));

/** localStorage minimal (les tests tournent sous Node). */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const lina = swimmer('lina', 'Lina', { relation: 'child' });
const arthur = swimmer('arthur', 'Arthur');
const zoe = swimmer('zoe', 'Zoé');

describe('deux espaces : Mon espace et Club', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('window', { location: { hash: '#/?espaces=1' }, matchMedia: () => ({ matches: false }) });
    h.hooks = 0;
  });

  it('mise en ligne dimanche soir ; aperçu avant avec ?espaces=1', () => {
    vi.stubGlobal('window', { location: { hash: '#/' } });
    expect(spacesEnabled(Date.parse('2026-11-22T12:00:00Z'))).toBe(false);
    expect(spacesEnabled(Date.parse('2026-11-22T19:00:00Z'))).toBe(true);
    vi.stubGlobal('window', { location: { hash: '#/meets?espaces=1' } });
    expect(spacesEnabled(Date.parse('2026-11-22T12:00:00Z'))).toBe(true);
    // Gardé sur l'appareil, même sans le paramètre ; « ?espaces=0 » le retire
    vi.stubGlobal('window', { location: { hash: '#/' } });
    expect(spacesEnabled(Date.parse('2026-11-22T12:00:00Z'))).toBe(true);
    vi.stubGlobal('window', { location: { hash: '#/?espaces=0' } });
    expect(spacesEnabled(Date.parse('2026-11-22T12:00:00Z'))).toBe(false);
  });

  it('accueil du club : dernières compétitions avec le bilan de l’ESN', () => {
    setData({
      swimmers: [lina, arthur, zoe],
      meets: [meet('m1', '2025-10-11'), meet('m2', '2025-11-15')],
      swims: [swim('lina', 'm1', '2025-10-11', { place: 2 }), swim('arthur', 'm1', '2025-10-11'), swim('zoe', 'm2', '2025-11-15')],
      settings: { selectedSwimmerId: 'lina' } as AppData['settings'],
    });
    const page = html(ClubHome, {});
    expect(page).toContain('Dernières compétitions');
    expect(page).toContain('Meeting m2');
    expect(page).toMatch(/2 nageurs\u00a0· 2 courses\u00a0· 1 podium/);
  });

  it('compétitions : tout le club par défaut, ou mes nageurs', () => {
    setData({
      swimmers: [lina, arthur],
      meets: [meet('m1', '2025-10-11'), meet('m2', '2025-11-15')],
      swims: [swim('lina', 'm1', '2025-10-11'), swim('arthur', 'm2', '2025-11-15')],
      settings: { selectedSwimmerId: 'lina' } as AppData['settings'],
    });
    const club = html(Meets, {});
    expect(club).toContain('Tout le club');
    expect(club).toContain('Résultats du club');
    expect(club).toContain('Meeting m1');
    expect(club).toContain('Meeting m2');
    localStorage.setItem('esn-competitions-vue', 'mine');
    const mine = html(Meets, {});
    expect(mine).not.toContain('Résultats du club');
    expect(mine).toContain('Autres compétitions du club');
  });

  it('records : vue du club (records et classements de l’ESN)', () => {
    setData({ swimmers: [lina], meets: [meet('m1', '2025-10-11')], swims: [swim('lina', 'm1', '2025-10-11')], settings: { selectedSwimmerId: 'lina' } as AppData['settings'] });
    localStorage.setItem('esn-records-vue', 'club');
    const page = html(Records, {});
    expect(page).toContain('Records du club');
    expect(page).toContain('Classements du club');
    expect(page).not.toContain('Meilleurs temps</');
  });
});
