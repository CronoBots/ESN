import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { markPhotoFailed, swimmerPhotoUrls } from '../src/lib/photo';
import type { Swimmer } from '../src/store/types';

// Le routeur lit window.location au chargement : remplacé (aucune navigation ici)
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
const { Avatar } = await import('../src/components/ui');

// Nageurs fictifs, identifiants inventés
const sw = (extra: Partial<Swimmer>) => ({ firstName: 'Emma', lastName: 'DUPONT', color: 0, member: true, ...extra }) as Swimmer;
const URL = 'https://www.swimrankings.net/data/images/athletes';

describe('photo swimrankings d’un nageur du club', () => {
  it('adresse de la photo : dossier des 3 derniers chiffres de l’identifiant', () => {
    expect(swimmerPhotoUrls(sw({ swimrankingsId: '1234567' }))).toEqual([`${URL}/567/1234567.jpg`]);
  });

  it('identifiant finissant par 0xx : les deux écritures du dossier sont essayées', () => {
    expect(swimmerPhotoUrls(sw({ swimrankingsId: '1234067' }))).toEqual([`${URL}/067/1234067.jpg`, `${URL}/67/1234067.jpg`]);
    expect(swimmerPhotoUrls(sw({ swimrankingsId: '1234507' }))).toEqual([`${URL}/507/1234507.jpg`]);
    expect(swimmerPhotoUrls(sw({ swimrankingsId: '1234000' }))).toEqual([`${URL}/000/1234000.jpg`, `${URL}/0/1234000.jpg`]);
  });

  it('seulement les nageurs actifs du club qui ont un identifiant', () => {
    expect(swimmerPhotoUrls(sw({ swimrankingsId: '1234567', former: true }))).toEqual([]);
    expect(swimmerPhotoUrls(sw({ swimrankingsId: '1234567', member: false }))).toEqual([]);
    expect(swimmerPhotoUrls(sw({}))).toEqual([]);
    expect(swimmerPhotoUrls(sw({ swimrankingsId: 'abc' }))).toEqual([]);
  });

  it('la pastille montre la photo sur les initiales, et les initiales seules sans photo', () => {
    const withPhoto = renderToStaticMarkup(createElement(Avatar, { swimmer: sw({ swimrankingsId: '7654321' }) }));
    expect(withPhoto).toContain('ED');
    expect(withPhoto).toContain(`src="${URL}/321/7654321.jpg"`);
    const without = renderToStaticMarkup(createElement(Avatar, { swimmer: sw({ member: false, swimrankingsId: '7654321' }) }));
    expect(without).toContain('ED');
    expect(without).not.toContain('<img');
  });

  it('photo introuvable : adresse suivante, puis les initiales', () => {
    const s = sw({ swimrankingsId: '7654031' });
    markPhotoFailed(`${URL}/031/7654031.jpg`);
    expect(renderToStaticMarkup(createElement(Avatar, { swimmer: s }))).toContain(`src="${URL}/31/7654031.jpg"`);
    markPhotoFailed(`${URL}/31/7654031.jpg`);
    expect(renderToStaticMarkup(createElement(Avatar, { swimmer: s }))).not.toContain('<img');
  });
});
