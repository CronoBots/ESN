/**
 * Extraction du texte d'un PDF, ligne par ligne (pdf.js, chargé à la demande).
 */

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

/** Regroupe les morceaux de texte d'une page en lignes (même ordonnée). */
export function groupLines(items: TextItem[]): string[] {
  // Les cellules d'une même rangée sont légèrement décalées en hauteur (jusqu'à
  // ~4 points) : on regroupe à partir du haut de chaque rangée.
  const sorted = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({ x: it.transform[4], y: it.transform[5], w: it.width, s: it.str }))
    .sort((a, b) => b.y - a.y);
  const rows: { y: number; parts: { x: number; w: number; s: string }[] }[] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && row.y - it.y <= 4.5) row.parts.push(it);
    else rows.push({ y: it.y, parts: [it] });
  }
  return rows.map((r) => {
    r.parts.sort((a, b) => a.x - b.x);
    let out = '';
    let end = -Infinity;
    for (const p of r.parts) {
      const gap = p.x - end;
      // Club long collé au temps (« Natation1:05.34 », « 991:15.61 ») : on sépare lettres/chiffres et nombres
      const glued = /[\p{L}\d]$/u.test(out) && /^\d/.test(p.s);
      if (out) out += gap > 6 ? '   ' : (gap > 0.8 || glued) && !out.endsWith(' ') && !p.s.startsWith(' ') ? ' ' : '';
      out += p.s;
      end = p.x + p.w;
    }
    return out.replace(/\s+$/, '');
  });
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

/** Copie profonde minimale (objets, tableaux, Map, Set, dates, tableaux binaires) pour les navigateurs sans structuredClone. */
function deepClone<T>(value: T, seen = new Map<unknown, unknown>()): T {
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return seen.get(value) as T;
  let out: unknown;
  if (value instanceof ArrayBuffer) out = value.slice(0);
  else if (ArrayBuffer.isView(value)) {
    const v = value as unknown as { constructor: new (b: ArrayBuffer) => unknown; buffer: ArrayBuffer; byteOffset: number; byteLength: number };
    out = new v.constructor(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  } else if (value instanceof Date) out = new Date(value.getTime());
  else if (value instanceof Map) {
    const m = new Map();
    seen.set(value, m);
    value.forEach((x, k) => m.set(deepClone(k, seen), deepClone(x, seen)));
    return m as T;
  } else if (value instanceof Set) {
    const st = new Set();
    seen.set(value, st);
    value.forEach((x) => st.add(deepClone(x, seen)));
    return st as T;
  } else {
    const o: Record<string, unknown> = Array.isArray(value) ? ([] as unknown as Record<string, unknown>) : {};
    seen.set(value, o);
    for (const k of Object.keys(value)) o[k] = deepClone((value as Record<string, unknown>)[k], seen);
    return o as T;
  }
  seen.set(value, out);
  return out as T;
}

/**
 * Navigateurs plus anciens (iPhone avant iOS 17.4, Chrome avant 119) : il leur manque quelques
 * fonctions récentes dont le lecteur PDF a besoin. On les ajoute, et le lecteur travaille alors
 * dans la page (où ces ajouts existent) plutôt que dans un « worker » séparé.
 * Renvoie true si le navigateur a eu besoin de cette aide.
 */
function helpOlderBrowser(): boolean {
  const P = Promise as unknown as { withResolvers?: () => unknown };
  if (typeof P.withResolvers === 'function') return false;
  P.withResolvers = () => {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const define = (proto: object, name: string, value: (this: ArrayLike<unknown>, ...args: never[]) => unknown) => {
    if (typeof (proto as Record<string, unknown>)[name] !== 'function') Object.defineProperty(proto, name, { configurable: true, writable: true, value });
  };
  // Tableaux, chaînes et tableaux binaires : at, findLast, findLastIndex (iOS < 15.4, Chrome < 97)
  const typed = Object.getPrototypeOf(Int8Array.prototype) as object;
  for (const proto of [Array.prototype, String.prototype, typed])
    define(proto, 'at', function (this: ArrayLike<unknown>, n: number) {
      const i = Math.trunc(n) || 0;
      const k = i < 0 ? this.length + i : i;
      return k < 0 || k >= this.length ? undefined : this[k];
    });
  for (const proto of [Array.prototype, typed]) {
    define(proto, 'findLastIndex', function (this: ArrayLike<unknown>, fn: (v: unknown, i: number, a: unknown) => boolean, thisArg?: unknown) {
      for (let i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return i;
      return -1;
    });
    define(proto, 'findLast', function (this: ArrayLike<unknown>, fn: (v: unknown, i: number, a: unknown) => boolean, thisArg?: unknown) {
      for (let i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return this[i];
      return undefined;
    });
  }
  const O = Object as unknown as { hasOwn?: unknown };
  if (typeof O.hasOwn !== 'function') O.hasOwn = (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k);
  const g = globalThis as unknown as { structuredClone?: unknown };
  if (typeof g.structuredClone !== 'function') g.structuredClone = (v: unknown) => deepClone(v);
  return true;
}

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const older = helpOlderBrowser();
      const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.min.mjs')) as unknown as typeof import('pdfjs-dist');
      if (older) {
        // Lecteur dans la page : pdf.js prend le module du worker déjà chargé (« pdfjsWorker »)
        (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
      } else {
        const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
      }
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export async function pdfLines(data: ArrayBuffer): Promise<string[]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  const lines: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      lines.push(...groupLines(content.items as TextItem[]), '');
    }
  } finally {
    await task.destroy();
  }
  return lines;
}
