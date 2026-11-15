/**
 * Lecture d'une capture d'écran (reconnaissance de texte dans le navigateur).
 * Le moteur (tesseract.js) n'est chargé qu'au premier usage ; les données de
 * langue sont téléchargées une fois puis gardées en cache par le navigateur.
 */

export interface OcrProgress {
  /** 0 → 1 */
  progress: number;
  label: string;
}

export type Prep = 'stretch' | 'adaptive';

/**
 * Prépare l'image pour la lecture :
 * - « stretch » : niveaux de gris contrastés (captures d'écran) ;
 * - « adaptive » : seuil local, robuste aux reflets et aux ombres (photos).
 */
async function prepare(file: Blob, mode: Prep = 'stretch'): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Image illisible'));
      i.src = url;
    });
    // Texte petit sur les captures de téléphone : on vise ~2400 px de large
    const scale = Math.min(3, Math.max(0.4, 2400 / img.naturalWidth));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    const gray = new Float32Array(w * h);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) gray[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (mode === 'adaptive') {
      // Seuil local : un pixel est « encre » s'il est nettement plus sombre que son voisinage
      const integral = new Float64Array((w + 1) * (h + 1));
      for (let y = 0; y < h; y++) {
        let row = 0;
        for (let x = 0; x < w; x++) {
          row += gray[y * w + x];
          integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
        }
      }
      const r = Math.max(8, Math.round(w / 90));
      for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - r);
        const y1 = Math.min(h, y + r + 1);
        for (let x = 0; x < w; x++) {
          const x0 = Math.max(0, x - r);
          const x1 = Math.min(w, x + r + 1);
          const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
          const mean = sum / ((x1 - x0) * (y1 - y0));
          const v = gray[y * w + x] < mean * 0.88 ? 0 : 255;
          const k = (y * w + x) * 4;
          px[k] = px[k + 1] = px[k + 2] = v;
        }
      }
    } else {
      for (let j = 0, i = 0; j < gray.length; j++, i += 4) {
        const lum = gray[j];
        // Étirement du contraste (fonds gris clairs → blanc, texte → noir)
        const v = lum > 200 ? 255 : lum < 90 ? 0 : Math.round(((lum - 90) / 110) * 255);
        px[i] = px[i + 1] = px[i + 2] = v;
      }
    }
    ctx.putImageData(data, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Corrige les confusions courantes de la reconnaissance dans les nombres. */
export function normalizeOcrText(text: string): string {
  return (
    text
      // Lettres prises pour des chiffres dans les temps : 1:2O.6l → 1:20.61
      .replace(/[\dOolI|]*\d[\dOolI|]*[:.,][\dOolI|.,:]*\d[\dOolI|]*/g, (m) =>
        m.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1'),
      )
      // « 1.24.62 » → « 1:24.62 »
      .replace(/(?<![\d:.,])(\d{1,2})[.;](\d{2})[.,](\d{2})(?![\d.,])/g, '$1:$2.$3')
      // « 25rn » → « 25m »
      .replace(/(\d)\s?rn\b/g, '$1m')
      // Espaces insécables et tabulations
      .replace(/[ \t]/g, '  ')
  );
}

export async function recognizeScreenshots(files: Blob[], onProgress: (p: OcrProgress) => void): Promise<string> {
  onProgress({ progress: 0, label: 'Chargement du lecteur de texte…' });
  const Tesseract = await import('tesseract.js');
  const worker = await Tesseract.createWorker(['fra', 'eng'], Tesseract.OEM.LSTM_ONLY, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress({ progress: 0.25 + m.progress * 0.75, label: 'Lecture des temps…' });
      else if (m.status.includes('loading')) onProgress({ progress: 0.05 + m.progress * 0.2, label: 'Téléchargement du lecteur (une seule fois)…' });
    },
  });
  try {
    await worker.setParameters({
      // Lecture ligne par ligne : chaque rangée du tableau reste sur une ligne
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '1',
    });
    const texts: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const canvas = await prepare(files[i]);
      const { data } = await worker.recognize(canvas);
      texts.push(data.text);
      onProgress({ progress: (i + 1) / files.length, label: `Image ${i + 1}/${files.length} lue` });
    }
    return normalizeOcrText(texts.join('\n'));
  } finally {
    await worker.terminate();
  }
}

/**
 * Photos de feuilles de résultats : chaque photo est lue avec le seuil local ;
 * si le résultat attendu n'est pas trouvé (ou pas vérifié), une seconde
 * lecture avec un autre traitement est ajoutée.
 */
export async function recognizePhotos(
  files: Blob[],
  onProgress: (p: OcrProgress) => void,
  isGood: (texts: string[]) => boolean,
): Promise<string[][]> {
  onProgress({ progress: 0, label: 'Chargement du lecteur de texte…' });
  const Tesseract = await import('tesseract.js');
  let current = 0;
  const worker = await Tesseract.createWorker(['fra', 'eng'], Tesseract.OEM.LSTM_ONLY, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text')
        onProgress({ progress: (current + Math.min(0.95, m.progress)) / files.length, label: `Lecture de la photo ${current + 1}/${files.length}…` });
      else if (m.status.includes('loading')) onProgress({ progress: 0.02, label: 'Téléchargement du lecteur (une seule fois)…' });
    },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
    const out: string[][] = [];
    for (let i = 0; i < files.length; i++) {
      current = i;
      const texts: string[] = [];
      for (const mode of ['adaptive', 'stretch'] as Prep[]) {
        const canvas = await prepare(files[i], mode);
        const { data } = await worker.recognize(canvas);
        texts.push(normalizeOcrText(data.text));
        if (isGood(texts)) break;
      }
      out.push(texts);
    }
    onProgress({ progress: 1, label: 'Lecture terminée' });
    return out;
  } finally {
    await worker.terminate();
  }
}
