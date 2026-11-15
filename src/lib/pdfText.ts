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
      if (out) out += gap > 6 ? '   ' : gap > 0.8 && !out.endsWith(' ') && !p.s.startsWith(' ') ? ' ' : '';
      out += p.s;
      end = p.x + p.w;
    }
    return out.replace(/\s+$/, '');
  });
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.min.mjs')) as unknown as typeof import('pdfjs-dist');
      const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
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
