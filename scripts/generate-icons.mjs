// Génère les icônes PNG de l'application à partir du dessin SVG (npm run icons).
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
// Playwright est préinstallé globalement dans certains environnements : NODE_PATH=$(npm root -g)
const { chromium } = createRequire(import.meta.url)('playwright');

const mark = (scale = 1) => {
  const t = (256 * (1 - scale)).toFixed(1);
  return `<g transform="translate(${t} ${t}) scale(${scale})">
    <circle cx="338" cy="178" r="40" fill="#fff"/>
    <path d="M112 300 C 160 196, 262 150, 318 262" stroke="#fff" stroke-width="36" fill="none" stroke-linecap="round"/>
    <path d="M92 352 q41 -30 82 0 t82 0 t82 0 t82 0" stroke="#fff" stroke-width="30" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M92 420 q41 -30 82 0 t82 0 t82 0 t82 0" stroke="#fff" stroke-opacity=".55" stroke-width="30" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;
};
const defs = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A84FF"/><stop offset=".55" stop-color="#0A6CF0"/><stop offset="1" stop-color="#00C2E0"/></linearGradient></defs>`;
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}<rect width="512" height="512" rx="114" fill="url(#g)"/>${mark(1)}</svg>`;
const square = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}<rect width="512" height="512" fill="url(#g)"/>${mark(scale)}</svg>`;

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('favicon.svg', out), rounded);

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(new URL(file, out), buf);
}
await render(rounded, 192, 'icon-192.png');
await render(rounded, 512, 'icon-512.png');
await render(square(0.78), 512, 'maskable-512.png');
await render(square(0.86), 180, 'apple-touch-icon.png');
await browser.close();
console.log('Icônes générées.');
