// Draws the portal's preset wallpapers (spec 048) and renders them to JPEG in
// apps/web/public/wallpapers. Run: node apps/web/scripts/wallpapers.mjs
// Every scene fades to near-black at the bottom, so text and cards over it stay readable.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 1170;
const H = 2532;
const out = join(dirname(fileURLToPath(import.meta.url)), '../public/wallpapers');
mkdirSync(out, { recursive: true });

// A small seeded random, so a re-run draws the same stars and lights.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const fade = `<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0.38" stop-color="#07080c" stop-opacity="0"/>
  <stop offset="0.72" stop-color="#07080c" stop-opacity="0.82"/>
  <stop offset="1" stop-color="#07080c" stop-opacity="1"/></linearGradient>`;
const sky = (id, stops) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops
    .map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`)
    .join('')}</linearGradient>`;
const ridge = (y, amp, step, fill, opacity = 1) => {
  let d = `M0 ${y}`;
  for (let x = 0; x <= W + step; x += step) d += ` L${x} ${y - rnd() * amp}`;
  return `<path d="${d} L${W} ${H} L0 ${H}Z" fill="${fill}" opacity="${opacity}"/>`;
};
const stars = (n, maxY, opacity = 0.8) =>
  Array.from({ length: n }, () => `<circle cx="${rnd() * W}" cy="${rnd() * maxY}" r="${0.8 + rnd() * 2.2}" fill="#fff" opacity="${(0.3 + rnd() * 0.7) * opacity}"/>`).join('');
const blob = (cx, cy, r, color, opacity) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="${opacity}" filter="url(#soft)"/>`;
const soft = `<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="120"/></filter>`;

const scenes = {
  dusk: () => `${sky('s', [[0, '#f6b04a'], [0.25, '#ec6a2c'], [0.45, '#8a2c1f'], [0.7, '#2a1512']])}
    <rect width="${W}" height="${H}" fill="url(#s)"/>
    <circle cx="760" cy="760" r="170" fill="#ffe3a1" opacity="0.92"/>
    ${ridge(1050, 260, 130, '#5b2a22')}${ridge(1240, 220, 110, '#3b1d19')}${ridge(1420, 160, 90, '#22110f')}`,
  aurora: () => `${sky('s', [[0, '#04121f'], [0.5, '#06222a'], [1, '#05080c']])}
    <rect width="${W}" height="${H}" fill="url(#s)"/>${stars(140, 1300)}
    ${blob(300, 600, 380, '#2ee6a8', 0.55)}${blob(800, 480, 320, '#38bdf8', 0.45)}${blob(620, 860, 300, '#a3e635', 0.3)}
    ${ridge(1350, 180, 120, '#071b1d')}${ridge(1500, 140, 90, '#040d0f')}`,
  ocean: () => `${sky('s', [[0, '#0c2a5b'], [0.42, '#1a4f8f'], [0.43, '#0b3366'], [1, '#03101f']])}
    <rect width="${W}" height="${H}" fill="url(#s)"/>${stars(70, 700, 0.6)}
    <circle cx="380" cy="620" r="110" fill="#e8f1ff" opacity="0.95"/>
    <rect x="340" y="1090" width="80" height="420" fill="#cfe1ff" opacity="0.18" filter="url(#soft)"/>
    ${Array.from({ length: 14 }, (_, i) => `<rect x="${200 + rnd() * 300}" y="${1100 + i * 32}" width="${60 + rnd() * 160}" height="4" rx="2" fill="#dbe8ff" opacity="${0.5 - i * 0.03}"/>`).join('')}`,
  dunes: () => `${sky('s', [[0, '#f7c6a3'], [0.3, '#e98f7a'], [0.55, '#8c4a5e'], [1, '#2a1622']])}
    <rect width="${W}" height="${H}" fill="url(#s)"/>
    <circle cx="300" cy="820" r="140" fill="#fff1d6" opacity="0.85"/>
    <path d="M0 1150 Q 400 980 760 1160 T ${W} 1120 L${W} ${H} L0 ${H}Z" fill="#b8604f"/>
    <path d="M0 1320 Q 300 1180 640 1330 T ${W} 1290 L${W} ${H} L0 ${H}Z" fill="#7d3a3f"/>
    <path d="M0 1500 Q 500 1380 ${W} 1520 L${W} ${H} L0 ${H}Z" fill="#45202a"/>`,
  forest: () => `${sky('s', [[0, '#9fc7bf'], [0.35, '#4f8a83'], [0.7, '#183634'], [1, '#081312']])}
    <rect width="${W}" height="${H}" fill="url(#s)"/>
    ${[0, 1, 2].map((row) => Array.from({ length: 16 }, () => { const x = rnd() * W; const y = 950 + row * 190 + rnd() * 60; const h = 260 + rnd() * 200; return `<path d="M${x} ${y - h} L${x + 70} ${y} L${x - 70} ${y}Z" fill="${['#3d6f69', '#24504b', '#12302d'][row]}"/>`; }).join('') + `<rect y="${1000 + row * 190}" width="${W}" height="${H}" fill="${['#3d6f69', '#24504b', '#12302d'][row]}"/>`).join('')}
    <rect y="820" width="${W}" height="260" fill="#cfe6e0" opacity="0.18" filter="url(#soft)"/>`,
  nebula: () => `<rect width="${W}" height="${H}" fill="#0a0616"/>${stars(220, H)}
    ${blob(320, 640, 420, '#a855f7', 0.55)}${blob(820, 900, 380, '#ec4899', 0.45)}${blob(560, 1250, 340, '#3b82f6', 0.35)}
    ${stars(40, 1400, 1)}`,
  alpine: () => `${sky('s', [[0, '#bcd7f5'], [0.35, '#7aa6de'], [0.6, '#2c4a7a'], [1, '#0b1424']])}
    <rect width="${W}" height="${H}" fill="url(#s)"/>
    <path d="M-50 1300 L320 640 L470 860 L640 560 L1000 1150 L${W + 50} 1300Z" fill="#e8eef8"/>
    <path d="M320 640 L400 800 L360 900 L470 860Z M640 560 L720 760 L680 820 L780 900Z" fill="#b9c8de"/>
    ${ridge(1300, 120, 90, '#33507f')}${ridge(1460, 110, 80, '#1b2c4c')}`,
  lavender: () => `${sky('s', [[0, '#c4b5fd'], [0.35, '#8b5cf6'], [0.65, '#3b1d6e'], [1, '#110a22']])}
    <rect width="${W}" height="${H}" fill="url(#s)"/>
    ${Array.from({ length: 6 }, (_, i) => `<path d="M0 ${900 + i * 120} C 300 ${820 + i * 120}, 800 ${1020 + i * 120}, ${W} ${880 + i * 120} L${W} ${H} L0 ${H}Z" fill="#${['7c3aed', '6d28d9', '5b21b6', '4c1d95', '3b1677', '2a1057'][i]}" opacity="0.75"/>`).join('')}`,
  city: () => `${sky('s', [[0, '#1e1b4b'], [0.45, '#312e81'], [0.7, '#1a1740'], [1, '#07060f']])}
    <rect width="${W}" height="${H}" fill="url(#s)"/>${stars(90, 900, 0.7)}
    ${blob(600, 1150, 420, '#f472b6', 0.25)}
    ${Array.from({ length: 22 }, (_, i) => { const w = 60 + rnd() * 90; const h = 260 + rnd() * 620; const x = i * 56 - 30; const y = 1500 - h; const lights = Array.from({ length: 14 }, () => `<rect x="${x + 8 + rnd() * (w - 20)}" y="${y + 12 + rnd() * (h - 30)}" width="7" height="10" fill="#fde68a" opacity="${0.35 + rnd() * 0.6}"/>`).join(''); return `<rect x="${x}" y="${y}" width="${w}" height="${h + 400}" fill="${rnd() > 0.5 ? '#151338' : '#0f0d2a'}"/>${lights}`; }).join('')}`,
  ember: () => `<rect width="${W}" height="${H}" fill="#140806"/>
    ${blob(260, 520, 460, '#f97316', 0.7)}${blob(900, 760, 420, '#dc2626', 0.6)}${blob(520, 1100, 380, '#facc15', 0.35)}${blob(980, 300, 300, '#fb7185', 0.45)}`,
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const tops = {};
for (const [name, draw] of Object.entries(scenes)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${fade}${soft}</defs>${draw()}<rect width="${W}" height="${H}" fill="url(#fade)"/></svg>`;
  await page.setContent(`<style>*{margin:0}body{background:#000}</style>${svg}`);
  await page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 78 });
  // The status bar's colour on Android: the average of the top rows.
  tops[name] = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 60; c.height = 4;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, img.width, 60, 0, 0, 60, 4);
    const d = g.getImageData(0, 0, 60, 4).data;
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return '#' + [r, gg, b].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
  }, 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
}
await browser.close();
console.log(JSON.stringify(tops));
