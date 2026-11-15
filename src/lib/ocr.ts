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

/** Prépare l'image : agrandissement et niveaux de gris contrastés. */
async function prepare(file: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Image illisible'));
      i.src = url;
    });
    // Texte petit sur les captures de téléphone : on vise ~2400 px de large
    const scale = Math.min(3, Math.max(1, 2400 / img.naturalWidth));
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
    for (let i = 0; i < px.length; i += 4) {
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      // Étirement du contraste (fonds gris clairs → blanc, texte → noir)
      const v = lum > 200 ? 255 : lum < 90 ? 0 : Math.round(((lum - 90) / 110) * 255);
      px[i] = px[i + 1] = px[i + 2] = v;
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
