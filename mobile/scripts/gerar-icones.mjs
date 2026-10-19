// Gera os ícones e a imagem da tela de abertura do app a partir da identidade da clínica.
// Uso (na raiz do projeto): node mobile/scripts/gerar-icones.mjs   (precisa de tests/node_modules e do Chrome)
// Ícone: monograma "RA" (fonte Jost, a mesma do sistema) em dourado sobre o vinho da marca.
// Abertura: o logotipo com o fundo branco removido (fica bom no modo claro e no escuro).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const puppeteer = createRequire(path.join(ROOT, 'tests', 'package.json'))('puppeteer-core');
const OUT = path.join(ROOT, 'mobile', 'assets');
const font = fs.readFileSync(path.join(ROOT, 'assets', 'fonts', 'jost-latin.woff2')).toString('base64');
const logo = fs.readFileSync(path.join(ROOT, 'assets', 'logo.png')).toString('base64');
const VINHO = '#53102F';
const DOURADO = '#E2C2A2';

const monogram = ({ size, background, color, scale }) => `<!doctype html><html><head><style>
  @font-face { font-family: Jost; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 300 600; }
  html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${background}; }
  .m { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .t { font: 400 ${Math.round(size * 0.36 * scale)}px/1 Jost; letter-spacing: ${Math.round(size * 0.02 * scale)}px; color: ${color}; padding-left: ${Math.round(size * 0.02 * scale)}px; }
  .l { width: ${Math.round(size * 0.30 * scale)}px; height: ${Math.max(2, Math.round(size * 0.012 * scale))}px; background: ${color}; margin-top: ${Math.round(size * 0.035 * scale)}px; opacity: .85; }
</style></head><body><div class="m"><div class="t">RA</div><div class="l"></div></div></body></html>`;

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
async function render(file, html, size, transparent = false) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, file), omitBackground: transparent });
  console.log('✔', file);
}

// iOS e lojas: 1024 px, sem transparência.
await render('icon.png', monogram({ size: 1024, background: VINHO, color: DOURADO, scale: 1 }), 1024);
// Android adaptativo: frente transparente (área segura ~66% do centro), fundo liso e versão monocromática.
await render('android-icon-foreground.png', monogram({ size: 512, background: 'transparent', color: DOURADO, scale: 0.72 }), 512, true);
await render('android-icon-background.png', `<html><body style="margin:0;width:512px;height:512px;background:${VINHO}"></body></html>`, 512);
await render('android-icon-monochrome.png', monogram({ size: 432, background: 'transparent', color: '#FFFFFF', scale: 0.72 }), 432, true);
await render('favicon.png', monogram({ size: 48, background: VINHO, color: DOURADO, scale: 1.1 }), 48);

// Logotipo sem o fundo branco: a transparência vem da distância até o branco.
await page.setViewport({ width: 1024, height: 1024 });
await page.setContent('<html><body style="margin:0"></body></html>');
const data = await page.evaluate(async (src) => {
  const image = new Image();
  image.src = `data:image/png;base64,${src}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const width = 900, height = Math.round(width * image.height / image.width);
  ctx.drawImage(image, (1024 - width) / 2, (1024 - height) / 2, width, height);
  const pixels = ctx.getImageData(0, 0, 1024, 1024);
  const p = pixels.data;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] === 0) continue; // fora do logotipo: já transparente
    const alpha = Math.min(1, (255 - Math.min(p[i], p[i + 1], p[i + 2])) / 140);
    if (alpha <= 0.02) { p[i + 3] = 0; continue; }
    for (let c = 0; c < 3; c++) p[i + c] = Math.max(0, Math.min(255, Math.round((p[i + c] - 255 * (1 - alpha)) / alpha)));
    p[i + 3] = Math.round(alpha * 255);
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png').split(',')[1];
}, logo);
fs.writeFileSync(path.join(OUT, 'splash-icon.png'), Buffer.from(data, 'base64'));
console.log('✔ splash-icon.png');

// Google Play: ícone de 512 px e imagem de destaque (1024 × 500), em mobile/store/.
const STORE = path.join(ROOT, 'mobile', 'store');
fs.mkdirSync(STORE, { recursive: true });
await page.setViewport({ width: 512, height: 512 });
await page.setContent(monogram({ size: 512, background: VINHO, color: DOURADO, scale: 1 }), { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(STORE, 'icone-512.png') });
console.log('✔ store/icone-512.png');
await page.setViewport({ width: 1024, height: 500 });
await page.setContent(`<html><body style="margin:0;width:1024px;height:500px;background:#F5EFE7;display:flex;align-items:center;justify-content:center">
  <img src="data:image/png;base64,${data}" style="width:760px"></body></html>`, { waitUntil: 'load' });
await page.screenshot({ path: path.join(STORE, 'destaque-1024x500.png') });
console.log('✔ store/destaque-1024x500.png');
await browser.close();
