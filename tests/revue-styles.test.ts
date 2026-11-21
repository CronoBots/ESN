import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/*
 * Revue « styles » : service worker (src/sw-template.js), écran d'ouverture et barre d'état
 * (index.html), contrastes et règles de global.css. Données fictives uniquement.
 */

const BASE = 'https://club.test/app/';
const template = readFileSync('src/sw-template.js', 'utf8');
const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/styles/global.css', 'utf8');

/* --------------------------------------------- Service worker dans un faux navigateur */

type Req = { url: string; method?: string; mode?: string };
const href = (r: Req | string) => new URL(typeof r === 'string' ? r : r.url, BASE).href;
const noSearch = (u: string) => u.split('?')[0];

class FakeCache {
  entries = new Map<string, Response>();
  async match(r: Req | string, opts?: { ignoreSearch?: boolean }) {
    const key = href(r);
    for (const [k, res] of this.entries)
      if (k === key || (opts?.ignoreSearch && noSearch(k) === noSearch(key))) return res.clone();
    return undefined;
  }
  async put(r: Req | string, res: Response) {
    this.entries.set(href(r), res);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async addAll(list: string[]) {
    for (const f of list) this.entries.set(href(f), new Response(`précache ${f}`));
  }
}

class FakeCaches {
  stores = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)!;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async match(r: Req | string, opts?: { ignoreSearch?: boolean }) {
    for (const c of this.stores.values()) {
      const res = await c.match(r, opts);
      if (res) return res;
    }
    return undefined;
  }
}

type Net = (r: Req | string, init?: RequestInit) => Promise<Response>;

/** Charge une version du service worker (comme le fait vite.config.ts au build). */
function loadSw(version: string, store: FakeCaches, net: { fetch: Net }) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const self = {
    location: new URL('sw.js', BASE),
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const source = template.replace('__CACHE_VERSION__', version).replace('__PRECACHE_FILES__', JSON.stringify(['./']));
  new Function('self', 'caches', 'fetch', source)(self, store, (r: Req | string, init?: RequestInit) => net.fetch(r, init));
  const lifecycle = async (type: 'install' | 'activate') => {
    const waits: Promise<unknown>[] = [];
    handlers[type]({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  const request = (path: string, mode = 'cors') => {
    const ev = {
      request: { url: new URL(path, BASE).href, method: 'GET', mode },
      response: undefined as Promise<Response | undefined> | undefined,
      respondWith(p: Promise<Response | undefined>) {
        this.response = Promise.resolve(p);
      },
      waitUntil() {},
    };
    handlers.fetch(ev);
    return ev;
  };
  return { lifecycle, request };
}

// Les copies en cache sont rangées sans attendre (comme dans un vrai service worker)
const settle = () => new Promise((r) => setTimeout(r, 0));
const offline: Net = () => Promise.reject(new TypeError('hors connexion'));

describe('service worker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('la copie hors connexion des données (calendrier, temps limites) survit à une mise à jour de l’appli', async () => {
    const store = new FakeCaches();
    const net = { fetch: (async () => new Response('{"club":"Club Fictif"}')) as Net };
    const v1 = loadSw('v1', store, net);
    await v1.lifecycle('install');
    await v1.lifecycle('activate');
    const r1 = await v1.request('data/club-calendar.json').response;
    expect(await r1!.text()).toBe('{"club":"Club Fictif"}');
    await settle();

    // Nouvelle version publiée : installée puis activée (les anciens caches de l'appli sont supprimés)
    const v2 = loadSw('v2', store, net);
    await v2.lifecycle('install');
    await v2.lifecycle('activate');
    expect(await store.keys()).not.toContain('nageo-v1');

    // À la piscine, sans réseau
    net.fetch = offline;
    const r2 = await v2.request('data/club-calendar.json').response;
    expect(r2 && (await r2.text())).toBe('{"club":"Club Fictif"}');
  });

  it('les données rangées par une version précédente (dans son cache) sont reprises avant sa suppression', async () => {
    const store = new FakeCaches();
    // Version précédente : les données dans le cache versionné de l'appli
    const old = await store.open('nageo-ancienne');
    await old.put('./', new Response('<p>ancienne</p>'));
    await old.put('data/qualifying.json', new Response('{"limites":"fictives"}'));

    const net = { fetch: (async () => new Response('neuf')) as Net };
    const sw = loadSw('v2', store, net);
    await sw.lifecycle('install');
    await sw.lifecycle('activate');
    expect(await store.keys()).not.toContain('nageo-ancienne');

    net.fetch = offline;
    const res = await sw.request('data/qualifying.json').response;
    expect(res && (await res.text())).toBe('{"limites":"fictives"}');
  });

  it('une page d’erreur de l’hébergeur (panne 503) ne remplace pas la page de l’appli gardée hors connexion', async () => {
    const store = new FakeCaches();
    const net = { fetch: (async () => new Response('<p>appli</p>')) as Net };
    const sw = loadSw('v1', store, net);
    await sw.lifecycle('install');
    await sw.lifecycle('activate');
    await (await sw.request('./', 'navigate').response)!.text();
    await settle();

    // Panne : la page d'erreur est montrée en ligne…
    net.fetch = async () => new Response('Service indisponible', { status: 503 });
    const panne = await sw.request('./', 'navigate').response;
    expect(panne!.status).toBe(503);
    await settle();

    // … mais, plus tard hors connexion, l'icône ouvre toujours l'appli
    net.fetch = offline;
    const res = await sw.request('./', 'navigate').response;
    expect(res && (await res.text())).toBe('<p>appli</p>');
  });

  it('ouverture avec un réseau qui ne répond pas : la copie en cache s’affiche après 3 s', async () => {
    const store = new FakeCaches();
    const net = { fetch: (async () => new Response('<p>appli</p>')) as Net };
    const sw = loadSw('v1', store, net);
    await sw.lifecycle('install');
    await sw.lifecycle('activate');
    await (await sw.request('./', 'navigate').response)!.text();
    await settle();

    // Une barre de signal : la requête reste bloquée sans jamais échouer
    vi.useFakeTimers();
    net.fetch = () => new Promise(() => {});
    const ev = sw.request('./?code=fictif', 'navigate');
    await vi.advanceTimersByTimeAsync(3000);
    vi.useRealTimers();
    const res = await Promise.race([ev.response, new Promise((r) => setTimeout(() => r('écran blanc'), 50))]);
    expect(res).toBeInstanceOf(Response);
    expect(await (res as Response).text()).toBe('<p>appli</p>');
  });

  it('ouverture en ligne : la page du réseau reste prioritaire et met à jour la copie', async () => {
    const store = new FakeCaches();
    const net = { fetch: (async () => new Response('<p>v1</p>')) as Net };
    const sw = loadSw('v1', store, net);
    await sw.lifecycle('install');
    await sw.lifecycle('activate');
    await (await sw.request('./', 'navigate').response)!.text();
    await settle();

    net.fetch = async () => new Response('<p>v2</p>');
    const res = await sw.request('./', 'navigate').response;
    expect(await res!.text()).toBe('<p>v2</p>');
    await settle();

    net.fetch = offline;
    const hors = await sw.request('./', 'navigate').response;
    expect(hors && (await hors.text())).toBe('<p>v2</p>');
  });

  it('ouverture juste après une mise à jour : la page est redemandée au serveur, jamais l’ancienne copie du navigateur', async () => {
    const store = new FakeCaches();
    // Le navigateur garde la page 10 minutes : sans revalidation, il rend encore l'ancienne version (fichiers supprimés)
    const net = { fetch: (async (_r, init) => new Response(init?.cache === 'no-cache' ? '<p>v2</p>' : '<p>v1 périmée</p>')) as Net };
    const sw = loadSw('v2', store, net);
    await sw.lifecycle('install');
    await sw.lifecycle('activate');
    expect(await (await sw.request('./', 'navigate').response)!.text()).toBe('<p>v2</p>');
    expect(await (await sw.request('./?code=fictif', 'navigate').response)!.text()).toBe('<p>v2</p>');
  });
});

/* --------------------------------------------- Écran d'ouverture, barre d'état, styles */

const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const over = (fg: number[], alpha: number, bg: number[]) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Bloc de déclarations d'un sélecteur (première occurrence). */
function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
}

describe('écran d’ouverture et barre d’état', () => {
  it('sans JavaScript, l’écran d’ouverture est masqué et laisse voir le message', () => {
    expect(html).toMatch(/<noscript>\s*<style>[^<]*#splash\s*\{\s*display:\s*none/);
  });

  it('barre d’état « default » : heure et batterie lisibles sur le fond clair avant iOS 26', () => {
    expect(html).toMatch(/name="apple-mobile-web-app-status-bar-style" content="default"/);
  });
});

describe('styles', () => {
  it('--text-3 atteint 4,5:1 sur les cartes blanches et sur le fond', () => {
    const m = css.match(/--text-3:\s*rgba\(24, 24, 27, ([\d.]+)\)/);
    expect(m).not.toBeNull();
    const text = [24, 24, 27];
    for (const bg of ['#ffffff', '#f4f4f5']) expect(ratio(over(text, Number(m![1]), hex(bg)), hex(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('libellés de la carte du nageur et pastille Mistral à 4,5:1 au moins', () => {
    expect(rule('.hero-stat span')).not.toMatch(/opacity/);
    const cell = over([255, 255, 255], 0.14, hex('#2357d0'));
    expect(ratio([255, 255, 255], cell)).toBeGreaterThanOrEqual(4.5);
    const color = rule('.lvl-chip.lvl-mistral').match(/color:\s*(#[0-9a-f]{6})/);
    expect(color).not.toBeNull();
    expect(ratio(hex(color![1]), over(hex('#0d8478'), 0.13, [255, 255, 255]))).toBeGreaterThanOrEqual(4.5);
  });

  it('le message toast ne capte pas les touchers destinés aux boutons du haut', () => {
    expect(rule('.toast')).toMatch(/pointer-events:\s*none/);
  });

  it('les dates et le lieu grisés d’un championnat ne sont pas forcés en gras noir', () => {
    expect(css).not.toMatch(/\.lvl-row\.next \.row-sub \{/);
    expect(css).toMatch(/\.lvl-row\.next \.row-sub:not\(\.muted\) \{/);
  });

  it('la barre latérale tient compte des zones sûres (paysage)', () => {
    const side = css.slice(css.indexOf('  .sidebar {', css.indexOf('@media (min-width: 900px)')));
    const block = side.slice(0, side.indexOf('}'));
    expect(block).toMatch(/padding:[^;]*var\(--safe-left\)/);
    expect(block).toMatch(/width:\s*calc\(264px \+ var\(--safe-left\)\)/);
  });

  it('le titre caché de la ligne des boutons ne prend pas de hauteur et n’est pas lu', () => {
    const block = rule('.navbar:not(.no-large) .navbar-title');
    expect(block).toMatch(/visibility:\s*hidden/);
    expect(block).toMatch(/height:\s*0/);
  });
});
