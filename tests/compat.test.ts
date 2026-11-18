import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Garde-fous de compatibilité : l'application doit s'ouvrir sur les iPhone (iOS 15 et plus),
 * les téléphones Android, les tablettes et les ordinateurs (Chrome, Edge, Firefox, Safari).
 */

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full, ext) : ext.test(name) ? [full] : [];
  });
}

const code = files('src', /\.(ts|tsx)$/).map((f) => ({ f, text: readFileSync(f, 'utf8') }));
const css = readFileSync('src/styles/global.css', 'utf8');

describe('compatibilité des navigateurs', () => {
  it('aucune expression régulière avec « lookbehind » (absent avant iOS 16.4 : l’application ne démarrait plus)', () => {
    const found = code.filter(({ text }) => /\(\?<[=!]/.test(text)).map(({ f }) => f);
    expect(found).toEqual([]);
  });

  it('pas de DecompressionStream (« deflate-raw » absent avant iOS 16.4 et Chrome 103)', () => {
    const found = code.filter(({ text }) => /new DecompressionStream/.test(text)).map(({ f }) => f);
    expect(found).toEqual([]);
  });

  it('chaque hauteur en dvh a son repli en vh juste avant (iOS < 15.4, Chrome < 108)', () => {
    const lines = css.split('\n');
    const missing = lines
      .map((l, i) => ({ l: l.trim(), prev: (lines[i - 1] ?? '').trim(), n: i + 1 }))
      .filter(({ l }) => /^(min-|max-)?height:\s*[^;]*\bdvh\b/.test(l) && !/var\(--vvh/.test(l))
      .filter(({ l, prev }) => prev.split(':')[0] !== l.split(':')[0] || !/\bvh\b/.test(prev))
      .map(({ n, l }) => `ligne ${n} : ${l}`);
    expect(missing).toEqual([]);
  });

  it('chaque color-mix a une couleur de repli juste avant (iOS < 16.2, Chrome < 111)', () => {
    const lines = css.split('\n');
    const missing = lines
      .map((l, i) => ({ l: l.trim(), prev: (lines[i - 1] ?? '').trim(), n: i + 1 }))
      .filter(({ l }) => /color-mix\(/.test(l))
      .filter(({ l, prev }) => prev.split(':')[0] !== l.split(':')[0] || /color-mix\(/.test(prev))
      .map(({ n, l }) => `ligne ${n} : ${l}`);
    expect(missing).toEqual([]);
  });

  it('la hauteur des fenêtres de recherche ne dépend pas de :has() (absent avant Firefox 121)', () => {
    expect(css).not.toMatch(/\.sheet:has\(/);
    expect(css).toMatch(/\.sheet\.has-search/);
  });

  it('le manifeste ne bloque pas l’orientation (tablettes, ordinateurs, téléphone couché)', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    expect(manifest.orientation).toBeUndefined();
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  });
});
