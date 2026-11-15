// Génère le logo « ESN Compétition » et les icônes de l'application (npm run icons).
// Sources : logo officiel du club dans brand/ (non publié tel quel).
// Playwright est préinstallé globalement dans certains environnements : NODE_PATH=$(npm root -g) npm run icons
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const source = (file) =>
  `data:image/png;base64,${readFileSync(new URL(`../brand/${file}`, import.meta.url)).toString('base64')}`;
const folder = (name) => {
  const url = new URL(`../public/${name}/`, import.meta.url);
  mkdirSync(url, { recursive: true });
  return url;
};
const save = (dir, file, dataUrl) => writeFileSync(new URL(file, dir), Buffer.from(dataUrl.split(',')[1], 'base64'));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

/**
 * Logo officiel du club, intact, avec « COMPÉTITION » à la place de « NATATION »
 * (capitales grasses, vert du club, centrées sous le logo comme l'original).
 * `text: false` : logo seul (petites tailles). Renvoie { url, width, height }.
 */
const compose = (mark, color, width, text = true) =>
  page.evaluate(
    async ({ mark, color, width, text }) => {
      const img = new Image();
      img.src = mark;
      await img.decode();
      const TEXT = 'COMPÉTITION';
      const big = document.createElement('canvas');
      const g = big.getContext('2d');
      const setFont = (size) => {
        g.font = `700 ${size}px "Liberation Sans", Arial, Helvetica, sans-serif`;
        g.letterSpacing = `${size * 0.02}px`;
        return g.measureText(TEXT);
      };
      let m = setFont(100);
      const size = (100 * img.width * 0.9) / (m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
      m = setFont(size);
      const gap = img.width * 0.025;
      big.width = img.width;
      big.height = text ? Math.ceil(img.height + gap + m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + 4) : img.height;
      g.drawImage(img, 0, 0);
      if (text) {
        setFont(size);
        g.fillStyle = color;
        const textWidth = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
        g.fillText(TEXT, (big.width - textWidth) / 2 + m.actualBoundingBoxLeft, img.height + gap + m.actualBoundingBoxAscent);
      }
      const out = document.createElement('canvas');
      out.width = width;
      out.height = Math.round((big.height * width) / big.width);
      const o = out.getContext('2d');
      o.imageSmoothingQuality = 'high';
      o.drawImage(big, 0, 0, out.width, out.height);
      return { url: out.toDataURL('image/png'), width: out.width, height: out.height };
    },
    { mark, color, width, text },
  );

const MARK = source('esn-mark.png');
const MARK_DARK = source('esn-mark-dark.png');

// Logos affichés dans l'application (thème clair / sombre)
const brand = folder('brand');
save(brand, 'esn-competition.png', (await compose(MARK, '#015B1C', 720)).url);
save(brand, 'esn-competition-dark.png', (await compose(MARK_DARK, '#4CAF6A', 720)).url);
save(brand, 'esn-mark.png', (await compose(MARK, '', 360, false)).url);
save(brand, 'esn-mark-dark.png', (await compose(MARK_DARK, '', 360, false)).url);

// Icônes : logo sur fond blanc, liseré d'eau aux couleurs du club en bas
const LOCKUP = await compose(MARK, '#015B1C', 1200);
const SMALL = await compose(MARK, '', 1200, false);
const icon = ({ logo, rounded, width, lift = 14 }) => {
  const h = (width * logo.height) / logo.width;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
    <defs>
      <linearGradient id="w" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#015B1C"/><stop offset="1" stop-color="#002CA4"/>
      </linearGradient>
      <clipPath id="c"><rect width="512" height="512" ${rounded ? 'rx="114"' : ''}/></clipPath>
    </defs>
    <g clip-path="url(#c)">
      <rect width="512" height="512" fill="#ffffff"/>
      <path d="M0 452 q64 -20 128 0 t128 0 t128 0 t128 0 V512 H0z" fill="url(#w)"/>
      <image href="${logo.url}" x="${(512 - width) / 2}" y="${(512 - h) / 2 - lift}" width="${width}" height="${h}"/>
    </g>
  </svg>`;
};

const icons = folder('icons');
async function render(svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace(/width="512" height="512">/, `width="${size}" height="${size}">`)}</body></html>`,
  );
  await page.waitForTimeout(100);
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(new URL(file, icons), buf);
}
await render(icon({ logo: LOCKUP, rounded: true, width: 420 }), 192, 'icon-192.png');
await render(icon({ logo: LOCKUP, rounded: true, width: 420 }), 512, 'icon-512.png');
await render(icon({ logo: LOCKUP, rounded: false, width: 330 }), 512, 'maskable-512.png');
await render(icon({ logo: LOCKUP, rounded: false, width: 420 }), 180, 'apple-touch-icon.png');
await render(icon({ logo: SMALL, rounded: true, width: 460, lift: 18 }), 64, 'favicon-64.png');
await browser.close();
console.log('Logo et icônes générés.');
