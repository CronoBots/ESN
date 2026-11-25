import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppData, Swimmer } from '../src/store/types';
import type { OfficialRecordsList } from '../src/lib/officialRecords';

/*
 * Écran « Records du club », vue « Liste du club » : la liste officielle du club est affichée telle quelle,
 * sans mention de vérification ni de doute. Rendu côté serveur ; noms et temps fictifs.
 */

const h = vi.hoisted(() => ({ state: null as unknown }));
vi.mock('../src/store/store', async (orig) => ({ ...(await orig<object>()), useData: () => h.state }));
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

const { normalizeData } = await import('../src/store/store');
const { ClubRecords } = await import('../src/screens/ClubRecords');

const member = (id: string, firstName: string, lastName: string, extra: Partial<Swimmer> = {}) =>
  ({ id, firstName, lastName, gender: 'F', birthYear: 2012, color: 0, relation: 'club', member: true, createdAt: 0, ...extra }) as Swimmer;

const LIST: OfficialRecordsList = {
  title: 'RECORDS 31.12.2025',
  asOf: '2025-12-31',
  source: 'test',
  records: [
    // Course pas retrouvée dans les résultats relevés, et record signalé douteux : affichés comme les autres
    { section: 'all', gender: 'F', distance: 50, stroke: 'FREE', timeCs: 2744, holder: 'DUPONT Emma', place: 'Liège', course: 'SCM', date: '2025-07-21', verified: false, doubt: 'Temps à vérifier : raison de test.' },
    { section: 'all', gender: 'F', distance: 100, stroke: 'BREAST', timeCs: 7400, holder: 'LEROY Zoé', verified: true },
  ],
};

describe('records du club : liste officielle', () => {
  it('affiche chaque record de la liste sans « Non vérifié » ni « À vérifier »', () => {
    h.state = normalizeData({ swimmers: [member('emma', 'Emma', 'DUPONT', { former: true }), member('ana', 'Ana', 'MARTIN')], meets: [], swims: [], officialRecords: LIST } as Partial<AppData>);
    const page = renderToStaticMarkup(createElement(ClubRecords));
    expect(page).toContain('Liste du club');
    expect(page).toContain('27.44');
    expect(page).toContain('1:14.00');
    expect(page).toContain('LEROY Zoé');
    expect(page).not.toContain('Non vérifié');
    expect(page).not.toContain('À vérifier');
    expect(page).not.toContain('raison de test');
  });
});
