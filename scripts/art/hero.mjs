// Draws the README's title banner: the wordmark beside a seam being stitched, one stitch per merged
// change, with one that never reached production. Writes docs/assets/hero.svg (one dark banner,
// used in both themes).
//   node scripts/art/hero.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'assets', 'hero.svg');
const W = 1280;
const H = 420;
const LOOP = 9; // seconds
const SEAM_X = 930;
const TOP = 62;
const STEP = 50;
const CHANGES = [
  { pr: '#12', ok: true },
  { pr: '#13', ok: true },
  { pr: '#14', ok: true },
  { pr: '#15', ok: true },
  { pr: '#16', ok: false },
  { pr: '#17', ok: true },
];
const pct = (seconds) => `${Math.round((seconds / LOOP) * 1000) / 10}%`;

const o = [];
const css = [];
o.push(`<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0c1622"/><stop offset="1" stop-color="#101f33"/></linearGradient>
<linearGradient id="word" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#9db8ff"/></linearGradient>
<pattern id="weaveL" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="#17263a"/><rect width="12" height="1.2" fill="#22364f"/></pattern>
<pattern id="weaveR" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="12" height="12" fill="#143026"/><rect width="12" height="1.2" fill="#1d4536"/></pattern>
<clipPath id="card"><rect width="${W}" height="${H}" rx="20"/></clipPath>
</defs>`);
o.push(`<g clip-path="url(#card)"><rect width="${W}" height="${H}" fill="url(#bg)"/>`);

// Two panels of cloth with a gap between them: merged on the left, live on the right.
o.push(`<path d="M690,0 H${SEAM_X - 7} V${H} H640 Z" fill="url(#weaveL)"/>`);
o.push(`<path d="M${SEAM_X + 7},0 H${W} V${H} H${SEAM_X + 7} Z" fill="url(#weaveR)"/>`);
o.push(`<rect x="${SEAM_X - 7}" y="0" width="14" height="${H}" fill="#070c13"/>`);
o.push(`<text class="m" x="${SEAM_X - 26}" y="36" font-size="15" fill="#8fa9d8" text-anchor="end" letter-spacing="2">MERGED</text>`);
o.push(`<text class="m" x="${SEAM_X + 26}" y="36" font-size="15" fill="#7fd3ac" letter-spacing="2">LIVE</text>`);

// One stitch per change. A change that is live gets a thread across the seam; one that is not
// leaves the gap open, and says so.
CHANGES.forEach((c, i) => {
  const y = TOP + i * STEP + 22;
  const at = 1.2 + i * 0.75;
  const cls = `st${i}`;
  css.push(`.${cls}{animation:${cls} ${LOOP}s linear infinite}@keyframes ${cls}{0%,${pct(at)}{opacity:0}${pct(at + 0.25)},94%{opacity:1}100%{opacity:0}}`);
  o.push(`<g class="${cls}">`);
  o.push(`<rect x="${SEAM_X - 152}" y="${y - 15}" width="64" height="30" rx="7" fill="#0c1622" stroke="#34507a"/>`);
  o.push(`<text class="m" x="${SEAM_X - 120}" y="${y + 5}" font-size="15" font-weight="700" fill="#dbe6ff" text-anchor="middle">${c.pr}</text>`);
  if (c.ok) {
    o.push(`<path d="M${SEAM_X - 80},${y} C${SEAM_X - 40},${y - 12} ${SEAM_X + 40},${y + 12} ${SEAM_X + 80},${y}" fill="none" stroke="#f2f5fa" stroke-width="4" stroke-linecap="round" stroke-dasharray="14 9"/>`);
    o.push(`<circle cx="${SEAM_X + 112}" cy="${y}" r="13" fill="#2fbf7f"/><path d="M${SEAM_X + 105},${y} l5,5 l9,-10" fill="none" stroke="#06200f" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`);
    o.push(`<text class="m" x="${SEAM_X + 136}" y="${y + 5}" font-size="14" fill="#9fe3c2">live</text>`);
  } else {
    o.push(`<path d="M${SEAM_X - 80},${y} h44" fill="none" stroke="#ff7b6e" stroke-width="4" stroke-linecap="round" stroke-dasharray="14 9"/>`);
    o.push(`<circle cx="${SEAM_X + 112}" cy="${y}" r="13" fill="#ff7b6e"/><path d="M${SEAM_X + 106},${y - 6} l12,12 m0,-12 l-12,12" fill="none" stroke="#2a0b08" stroke-width="3.2" stroke-linecap="round"/>`);
    o.push(`<text class="m" x="${SEAM_X + 136}" y="${y + 5}" font-size="14" fill="#ffb1a8">not live</text>`);
  }
  o.push(`</g>`);
});

// The needle travels down the seam as the stitches land.
const travel = CHANGES.length * STEP;
css.push(`.needle{animation:needle ${LOOP}s linear infinite}@keyframes needle{0%,${pct(1)}{transform:translateY(0);opacity:0}${pct(1.2)}{opacity:1}${pct(1.2 + CHANGES.length * 0.75)}{transform:translateY(${travel}px);opacity:1}${pct(2.2 + CHANGES.length * 0.75)},100%{transform:translateY(${travel}px);opacity:0}}`);
o.push(`<g class="needle"><path d="M${SEAM_X},${TOP - 26} l5,34 l-5,14 l-5,-14 z" fill="#dfe7f2"/><circle cx="${SEAM_X}" cy="${TOP - 14}" r="2.4" fill="#0c1622"/></g>`);

// The wordmark, the question, and a terminal line that types itself and answers.
o.push(`<g transform="translate(70,0)">`);
o.push(`<g transform="translate(0,84)"><rect width="44" height="44" rx="11" fill="#2752c9"/><path d="M15,8 V36 M29,8 V36" stroke="#ffffff" stroke-width="3.4" stroke-linecap="round"/><path d="M15,14 H29 M15,22 H29 M15,30 H29" stroke="#ffd66b" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 3"/></g>`);
o.push(`<text class="s" x="60" y="124" font-size="64" font-weight="800" fill="url(#word)" letter-spacing="-1.5">seamkit</text>`);
o.push(`<text class="s" x="0" y="184" font-size="27" font-weight="600" fill="#e8eef5">Is your merged change actually live?</text>`);
o.push(`<text class="s" x="0" y="218" font-size="18" fill="#93a6b9">Deterministic production checks for teams whose code is written by agents.</text>`);
const cmd = 'npx seamkit audit --url https://your.app';
const chars = cmd.length;
o.push(`<g transform="translate(0,252)"><rect width="560" height="104" rx="12" fill="#070c13" stroke="#22364f"/>`);
o.push(`<circle cx="20" cy="18" r="5" fill="#ff7b6e"/><circle cx="38" cy="18" r="5" fill="#e9b752"/><circle cx="56" cy="18" r="5" fill="#46d394"/>`);
o.push(`<text class="m" x="20" y="54" font-size="17" fill="#6f98ff">$</text>`);
o.push(`<clipPath id="type"><rect class="typing" x="38" y="34" width="${chars * 10.3 + 6}" height="28"/></clipPath>`);
o.push(`<text class="m" x="40" y="54" font-size="17" fill="#e8eef5" clip-path="url(#type)">${cmd}</text>`);
o.push(`<g class="answer"><text class="m" x="20" y="86" font-size="17"><tspan fill="#46d394" font-weight="700">LIVE 5 of 6</tspan><tspan fill="#93a6b9">  ·  </tspan><tspan fill="#ff7b6e" font-weight="700">FAIL</tspan><tspan fill="#93a6b9">  ·  exit code </tspan><tspan fill="#ffffff" font-weight="700">1</tspan></text></g></g>`);
o.push(`</g>`);
css.push(`.typing{animation:typing ${LOOP}s steps(${chars}) infinite;transform-box:fill-box;transform-origin:left}@keyframes typing{0%{transform:scaleX(0)}${pct(1.2)},100%{transform:scaleX(1)}}`);
css.push(`.answer{animation:answer ${LOOP}s linear infinite}@keyframes answer{0%,${pct(1.2 + CHANGES.length * 0.75)}{opacity:0}${pct(1.6 + CHANGES.length * 0.75)},94%{opacity:1}100%{opacity:0}}`);
o.push(`</g>`);

const style = `.s{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif}.m{font-family:ui-monospace,"SFMono-Regular","SF Mono",Menlo,Consolas,"Liberation Mono","DejaVu Sans Mono",monospace}${css.join('')}@media (prefers-reduced-motion:reduce){*{animation:none!important}.needle{opacity:0}}`;
const desc = 'The seamkit wordmark with the question: is your merged change actually live? A terminal runs npx seamkit audit and answers LIVE 5 of 6, FAIL, exit code 1. Beside it, two panels of cloth labelled merged and live are stitched together, one stitch per pull request: 12, 13, 14, 15 and 17 are live, and 16 is not live, where the seam stays open.';
writeFileSync(OUT, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d"><title id="t">seamkit</title><desc id="d">${desc}</desc><style>${style}</style>${o.join('')}</svg>\n`);
console.log('hero: wrote docs/assets/hero.svg');
