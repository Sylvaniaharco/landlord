// Bikin PNG ikon dari icons/icon.svg (jalankan hanya kalau desain ikon berubah; butuh Playwright):
//   node scripts/icons.cjs
// "any" = kotak sudut bulat dengan bingkai emas (gaya Mahjong Kung2); "maskable" = latar penuh, gambar diperkecil ke zona aman.
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const dir = join(__dirname, '..', 'icons');
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
const inner = svg.slice(svg.indexOf('<defs>'), svg.lastIndexOf('</svg>'));
const defs = inner.slice(0, inner.indexOf('<g id="art">'));
const art = inner.slice(inner.indexOf('<g id="art">'));


const FONT = ''; // tulisan memakai font serif sistem (tanpa unduhan)
const page = (maskable) => `${FONT}<body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%" style="display:block">
  ${defs}
  ${maskable
    ? `<rect width="512" height="512" fill="url(#felt)"/><g transform="translate(256 256) scale(.83) translate(-256 -259)">${art}</g>`
    : `<rect x="4" y="4" width="504" height="504" rx="112" fill="url(#goldline)"/><rect x="10" y="10" width="492" height="492" rx="106" fill="#5a3a0c" opacity=".55"/>
       <rect x="16" y="16" width="480" height="480" rx="100" fill="url(#felt)"/><clipPath id="in"><rect x="16" y="16" width="480" height="480" rx="100"/></clipPath>
       <g clip-path="url(#in)"><g transform="translate(256 256) scale(.97) translate(-256 -258)">${art}</g></g>`}
</svg></body>`;

(async () => {
  const b = await chromium.launch();
  for (const [name, size, maskable] of [
    ['icon-512.png', 512, false], ['icon-192.png', 192, false], ['icon-maskable-512.png', 512, true],
    ['apple-touch-icon.png', 180, true], ['favicon-32.png', 32, false],
  ]) {
    const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await p.setContent(page(maskable), { waitUntil: 'load' });

    await p.screenshot({ path: join(dir, name), omitBackground: !maskable });
    await p.close();
  }
  await b.close();
  console.log('Ikon dibuat di', dir);
})();
