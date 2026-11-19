import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppData, Meet, Swim, Swimmer } from '../src/store/types';

/*
 * Revue des écrans (groupe « ecrans-a ») : fiche d'une épreuve, fiche d'une course,
 * liste et fiche des compétitions. Rendu côté serveur, sans navigateur ; noms et temps fictifs.
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
const { EventDetail } = await import('../src/screens/EventDetail');
const { SwimDetail } = await import('../src/screens/SwimDetail');
const { Meets, MeetDetail } = await import('../src/screens/Meets');

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

/** Appelle l'écran pendant un rendu : renvoie ce qu'il affiche (sans le rendre) et le nombre de hooks appelés. */
function run<P>(Comp: (p: P) => ReactNode, props: P) {
  let tree: ReactNode = null;
  let hooks = 0;
  const Probe = () => {
    const before = h.hooks;
    tree = Comp(props);
    hooks = h.hooks - before;
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  return { tree, hooks };
}

/** Propriétés du premier élément qui vérifie la condition. */
function find(node: ReactNode, pred: (p: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const x of node) {
      const r = find(x, pred);
      if (r) return r;
    }
    return undefined;
  }
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as ReactElement).props as Record<string, unknown>;
    return pred(props) ? props : find(props.children as ReactNode, pred);
  }
  return undefined;
}

beforeEach(() => {
  h.downloads.length = 0;
});

describe('fiche d’une épreuve', () => {
  const props = { swimmerId: 'lina', course: 'SCM' as const, distance: 100, stroke: 'FREE' as const };

  it('appelle les mêmes hooks quand le nageur disparaît (pas d’écran blanc)', () => {
    setData({ swimmers: [swimmer('lina', 'Lina', { relation: 'child' })], meets: [meet('m1', '2025-10-11')], swims: [swim('lina', 'm1', '2025-10-11')] });
    const present = run(EventDetail, props).hooks;
    // Fiche réunie avec un doublon par la liste du club : elle n'existe plus
    setData({ swimmers: [], meets: [], swims: [] });
    const absent = run(EventDetail, props).hooks;
    expect(absent).toBe(present);
  });

  it('garde un bouton retour quand le nageur est introuvable', () => {
    setData({ swimmers: [], meets: [], swims: [] });
    const page = html(EventDetail, props);
    expect(page).toContain('Nageur introuvable');
    expect(page).toContain('aria-label="Retour"');
  });
});

describe('fiche d’une course : temps de passage', () => {
  it('suit les passages tous les 25 m sur un 100 m', () => {
    const s = swim('lina', undefined, '2025-10-11', { timeCs: 6000, splits: [1400, 2900, 4450], splitEvery: 25 });
    setData({ swimmers: [swimmer('lina', 'Lina', { relation: 'child' })], swims: [s] });
    const page = html(SwimDetail, { id: s.id });
    for (const lap of ['0–25 m', '25–50 m', '50–75 m', '75–100 m']) expect(page).toContain(lap);
    expect(page).not.toContain('150–100 m');
  });

  it('n’affiche pas de tableau quand les passages dépassent la distance', () => {
    // Trois passages sur un 100 m sans indication de pas : 50, 100, 150 m ne tombent pas juste
    const s = swim('lina', undefined, '2025-10-11', { timeCs: 6000, splits: [1400, 2900, 4450] });
    setData({ swimmers: [swimmer('lina', 'Lina', { relation: 'child' })], swims: [s] });
    expect(html(SwimDetail, { id: s.id })).not.toContain('Temps de passage');
  });
});

describe('fiche d’une compétition', () => {
  const lina = swimmer('lina', 'Lina', { relation: 'child' });
  const arthur = swimmer('arthur', 'Arthur');
  const zoe = swimmer('zoe', 'Zoé');

  it('tuiles du nageur suivi, forfait affiché « FOR »', () => {
    setData({
      swimmers: [lina, arthur, zoe],
      meets: [meet('m1', '2025-10-11')],
      swims: [
        swim('lina', 'm1', '2025-10-11'),
        swim('lina', 'm1', '2025-10-11', { stroke: 'BACK', status: 'DNS', timeCs: null }),
        swim('arthur', 'm1', '2025-10-11'),
        swim('arthur', 'm1', '2025-10-11', { stroke: 'BACK' }),
        swim('zoe', 'm1', '2025-10-11'),
      ],
      settings: { selectedSwimmerId: 'lina' } as AppData['settings'],
    });
    const page = html(MeetDetail, { id: 'm1' });
    // Une seule course valide pour Lina (pas les 4 du club)
    expect(page).toMatch(/tile-label">Courses<\/div><div class="tile-value">1</);
    expect(page).toContain('>FOR<');
    expect(page).not.toContain('>DNS<');
    expect(page).not.toContain('L’ESN à cette compétition');
  });

  it('ne met pas en avant un nageur non suivi', () => {
    setData({
      swimmers: [lina, arthur, zoe],
      meets: [meet('m1', '2025-10-11'), meet('m2', '2025-11-15')],
      swims: [
        swim('lina', 'm1', '2025-10-11'),
        swim('arthur', 'm1', '2025-10-11'),
        swim('arthur', 'm2', '2025-11-15'),
        swim('zoe', 'm2', '2025-11-15'),
      ],
      settings: { selectedSwimmerId: 'lina' } as AppData['settings'],
    });
    // Lina n'a pas nagé m2 : ni « Parcours d’Arthur », ni « autres nageurs », les tuiles sont celles du club
    const page = html(MeetDetail, { id: 'm2' });
    expect(page).not.toContain('Parcours');
    expect(page).not.toContain('Les autres nageurs');
    expect(page).toContain('L’ESN à cette compétition');
    expect(page).toMatch(/tile-label">Courses<\/div><div class="tile-value">2</);
  });

  it('« Ajouter au calendrier » : seulement les courses du nageur suivi', () => {
    setData({
      swimmers: [lina, arthur, zoe],
      meets: [meet('m3', '2027-03-06')],
      swims: [
        swim('lina', 'm3', '2027-03-06', { timeCs: null, startTime: '09:30' }),
        swim('arthur', 'm3', '2027-03-06', { timeCs: null, startTime: '09:40' }),
        swim('arthur', 'm3', '2027-03-06', { timeCs: null, startTime: '10:15', stroke: 'BACK' }),
        swim('zoe', 'm3', '2027-03-06', { timeCs: null, startTime: '11:00' }),
      ],
      settings: { selectedSwimmerId: 'lina' } as AppData['settings'],
    });
    const row = find(run(MeetDetail, { id: 'm3' }).tree, (p) => p.title === 'Ajouter au calendrier');
    expect(row?.sub).toBe('Rappel 30 min avant chaque course');
    (row!.onClick as () => void)();
    const ics = h.downloads[0];
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(1);
    expect(ics).toContain('Lina');
    expect(ics).not.toMatch(/Arthur|Zoé/);
  });

  it('« Ajouter au calendrier » sans nageur suivi : les dates, sans alarme', () => {
    setData({
      swimmers: [lina, arthur],
      meets: [meet('m4', '2027-03-06')],
      swims: [swim('arthur', 'm4', '2027-03-06', { timeCs: null, startTime: '09:40' })],
      settings: { selectedSwimmerId: 'lina' } as AppData['settings'],
    });
    const row = find(run(MeetDetail, { id: 'm4' }).tree, (p) => p.title === 'Ajouter au calendrier');
    expect(row?.sub).toBe('Dates de la compétition');
    (row!.onClick as () => void)();
    const ics = h.downloads[0];
    expect(ics).toContain('DTSTART;VALUE=DATE:20270306');
    expect(ics).not.toContain('VALARM');
    expect(ics).not.toContain('Arthur');
  });
});

describe('liste des compétitions', () => {
  it('ne compte pas comme nagée une compétition entièrement en forfait', () => {
    setData({
      swimmers: [swimmer('lina', 'Lina', { relation: 'child' })],
      meets: [meet('m1', '2025-10-11'), meet('m2', '2025-11-15')],
      swims: [swim('lina', 'm1', '2025-10-11'), swim('lina', 'm2', '2025-11-15', { status: 'DNS', timeCs: null })],
      settings: { selectedSwimmerId: 'lina' } as AppData['settings'],
    });
    const page = html(Meets, {});
    expect(page).toContain('1 compétition nagée par Lina');
  });
});
