// Génère les icônes PNG de l'application à partir du logo du club (npm run icons).
// Playwright est préinstallé globalement dans certains environnements : NODE_PATH=$(npm root -g) npm run icons
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const dataUri = (file) =>
  `data:image/png;base64,${readFileSync(new URL(`../public/brand/${file}`, import.meta.url)).toString('base64')}`;
const LOGO = { src: dataUri('esn-logo.png'), ratio: 674 / 1200 }; // logo officiel « ESN Natation »

// Icône : logo officiel sur fond blanc, liseré d'eau aux couleurs du club en bas
const icon = ({ rounded, width, size = 512 }) => {
  const h = width * LOGO.ratio;
  const x = (512 - width) / 2;
  const y = (512 - h) / 2 - 14;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
    <defs>
      <linearGradient id="w" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#015B1C"/><stop offset="1" stop-color="#002CA4"/>
      </linearGradient>
      <clipPath id="c"><rect width="512" height="512" ${rounded ? 'rx="114"' : ''}/></clipPath>
    </defs>
    <g clip-path="url(#c)">
      <rect width="512" height="512" fill="#ffffff"/>
      <path d="M0 448 q64 -22 128 0 t128 0 t128 0 t128 0 V512 H0z" fill="url(#w)"/>
      <image href="${LOGO.src}" x="${x}" y="${y}" width="${width}" height="${h}"/>
    </g>
  </svg>`;
};

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="512" height="512">/, `width="${size}" height="${size}">`)}</body></html>`);
  await page.waitForTimeout(100);
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(new URL(file, out), buf);
}
await render(icon({ rounded: true, width: 420 }), 192, 'icon-192.png');
await render(icon({ rounded: true, width: 420 }), 512, 'icon-512.png');
await render(icon({ rounded: false, width: 330 }), 512, 'maskable-512.png');
await render(icon({ rounded: false, width: 420 }), 180, 'apple-touch-icon.png');
await render(icon({ rounded: true, width: 440 }), 64, 'favicon-64.png');
await browser.close();
console.log('Icônes générées.');
