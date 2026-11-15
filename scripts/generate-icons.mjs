// Génère les icônes PNG de l'application à partir du logo du club (npm run icons).
// Playwright est préinstallé globalement dans certains environnements : NODE_PATH=$(npm root -g) npm run icons
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const logo = `data:image/png;base64,${readFileSync(new URL('../public/brand/esn-logo-white.png', import.meta.url)).toString('base64')}`;
const RATIO = 491 / 1200; // hauteur / largeur du logo

// Fond : vert du club vers le bleu du « S », avec des lignes d'eau
const bg = (rounded) => `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1B5B3F"/><stop offset=".45" stop-color="#2E7D52"/><stop offset="1" stop-color="#1E5FAF"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" ${rounded ? 'rx="114"' : ''} fill="url(#g)"/>
  <g stroke="#fff" stroke-opacity=".10" stroke-width="10" stroke-linecap="round" fill="none">
    <path d="M40 410 q54 -26 108 0 t108 0 t108 0 t108 0"/>
    <path d="M40 452 q54 -26 108 0 t108 0 t108 0 t108 0"/>
  </g>`;

const icon = ({ rounded, width }) => {
  const h = width * RATIO;
  const x = (512 - width) / 2;
  const y = (512 - h) / 2 - 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512">${bg(rounded)}
    <image href="${logo}" x="${x}" y="${y}" width="${width}" height="${h}"/></svg>`;
};

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.waitForTimeout(100);
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(new URL(file, out), buf);
}
await render(icon({ rounded: true, width: 420 }), 192, 'icon-192.png');
await render(icon({ rounded: true, width: 420 }), 512, 'icon-512.png');
await render(icon({ rounded: false, width: 340 }), 512, 'maskable-512.png');
await render(icon({ rounded: false, width: 430 }), 180, 'apple-touch-icon.png');
await render(icon({ rounded: true, width: 440 }), 64, 'favicon-64.png');
await browser.close();
console.log('Icônes générées.');
