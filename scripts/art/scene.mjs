// Draws the README's architecture illustration: an isometric scene with your pipeline in the front
// row (repository, build, deploy, production) and seamkit in the back row (callers, the referee,
// its three outputs). Writes docs/assets/scene-light.svg and scene-dark.svg.
//   node scripts/art/scene.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'assets');
const W = 1280;
const H = 790;
const OX = 372;
const OY = 318;
const K = 0.8;
const C = Math.cos(Math.PI / 6);
const S = 0.5;

const THEMES = {
  light: {
    bg: '#f6f8fb', ink: '#111d29', mute: '#566676', line: '#b9c4d0',
    slab: '#e3e9f1', repo: '#d9e2f5', prod: '#dcefe4', seam: '#eef1f6', belt: '#3b4a5c',
    accent: '#2752c9', green: '#1d7a4b', amber: '#a8740d', red: '#b83a2e',
    commit: ['#2752c9', '#4a70d8', '#6f8fe2'], crate: '#c9973a', tower: '#31465e', window: '#ffd66b',
    paper: '#ffffff', chip: '#111d29', chipInk: '#ffffff',
  },
  dark: {
    bg: '#0d1620', ink: '#e8eef5', mute: '#93a6b9', line: '#33475c',
    slab: '#1b2836', repo: '#1c2a47', prod: '#173428', seam: '#141f2b', belt: '#090f16',
    accent: '#6f98ff', green: '#46d394', amber: '#e9b752', red: '#ff7b6e',
    commit: ['#5b84f0', '#4670dc', '#345cc4'], crate: '#d9a441', tower: '#2a3d54', window: '#ffd66b',
    paper: '#3a516b', chip: '#e8eef5', chipInk: '#0d1620',
  },
};

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const shade = (c, k) => `#${hex(c).map((v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0')).join('')}`;
const r1 = (n) => Math.round(n * 10) / 10;
const P = (x, y, z = 0) => [r1(OX + (x - y) * C * K), r1(OY + ((x + y) * S - z) * K)];
const pts = (list) => list.map((p) => p.join(',')).join(' ');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function scene(name) {
  const t = THEMES[name];
  const o = [];
  const poly = (list, fill, extra = '') => o.push(`<polygon points="${pts(list)}" fill="${fill}" ${extra}/>`);

  /** A box with its top, left-front and right-front faces. */
  function box(x, y, z, w, d, h, color, opts = {}) {
    const top = opts.top ?? color;
    poly([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)], shade(color, 0.82));
    poly([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)], shade(color, 0.66));
    poly([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], top);
  }
  /** Text lying on a top face, reading along the x axis. */
  const onTop = (s, x, y, z, size, fill, weight = 700) => {
    const [sx, sy] = P(x, y, z);
    o.push(`<text class="m" transform="matrix(${r1(C * 10) / 10},${S},${-r1(C * 10) / 10},${S},${sx},${sy})" font-size="${r1(size * K)}" font-weight="${weight}" fill="${fill}">${esc(s)}</text>`);
  };
  /** Text on a left-front face (a plane of constant y), reading along the x axis. */
  const onLeft = (s, x, y, z, size, fill, weight = 700) => {
    const [sx, sy] = P(x, y, z);
    o.push(`<text class="m" transform="matrix(${C.toFixed(3)},${S},0,1,${sx},${sy})" font-size="${r1(size * K)}" font-weight="${weight}" fill="${fill}">${esc(s)}</text>`);
  };
  /** A flat caption with an optional second line, anchored at a world point plus a screen offset. */
  const label = (title, sub, x, y, z, dx, dy, anchor = 'start') => {
    const [sx, sy] = P(x, y, z);
    o.push(`<text class="s" x="${sx + dx}" y="${sy + dy}" font-size="17" font-weight="700" fill="${t.ink}" text-anchor="${anchor}">${esc(title)}</text>`);
    (Array.isArray(sub) ? sub : sub ? [sub] : []).forEach((line, i) =>
      o.push(`<text class="s" x="${sx + dx}" y="${sy + dy + 19 + i * 17}" font-size="13.5" fill="${t.mute}" text-anchor="${anchor}">${esc(line)}</text>`));
  };
  const beam = (a, b, color, cls) => o.push(`<line class="${cls}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${color}" stroke-width="2.5" stroke-dasharray="7 7" stroke-linecap="round"/>`);

  o.push(`<rect width="${W}" height="${H}" rx="18" fill="${t.bg}"/>`);

  // ---- back row: seamkit -------------------------------------------------------------------
  box(-70, -420, 0, 930, 210, 14, t.slab);
  // callers
  [['agent', t.accent], ['CI', t.amber], ['human', t.green]].forEach(([who, color], i) => {
    const x = -40 + i * 74;
    box(x, -400, 14, 50, 50, 34, color);
    onLeft(who, x + 5, -350, 38, 12, '#ffffff');
  });
  // the referee: a tower with a lens
  box(360, -350, 14, 96, 96, 20, t.tower);
  box(374, -336, 34, 68, 68, 120, t.tower);
  box(366, -344, 154, 84, 84, 12, shade(t.tower, 1.25));
  const lens = P(408, -302, 196);
  o.push(`<ellipse cx="${lens[0]}" cy="${lens[1]}" rx="25" ry="25" fill="${t.bg}" stroke="${t.accent}" stroke-width="5"/>`);
  o.push(`<circle class="pulse" cx="${lens[0]}" cy="${lens[1]}" r="11" fill="${t.accent}"/>`);
  onLeft('core', 386, -268, 86, 15, '#ffffff');
  // outputs
  box(560, -340, 14, 70, 70, 16, t.chip);
  onTop('0', 578, -288, 30, 40, t.chipInk, 800);
  box(662, -340, 14, 70, 70, 16, t.green);
  const tick = P(697, -305, 30);
  o.push(`<path d="M${tick[0] - 13},${tick[1]} l8,7 l17,-12" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
  [0, 1, 2, 3].forEach((i) => box(764, -340, 14 + i * 13, 70, 70, 10, i === 3 ? t.accent : shade(t.accent, 0.8 - i * 0.04), {}));
  o.push(`<g class="drop">`);
  box(764, -340, 14 + 4 * 13, 70, 70, 10, t.amber);
  o.push(`</g>`);

  // ---- beams: read-only ------------------------------------------------------------------
  const eye = [lens[0], lens[1]];
  beam(eye, P(105, 95, 110), t.accent, 'flow');
  beam(eye, P(715, 80, 196), t.accent, 'flow');

  // ---- front row: your pipeline ----------------------------------------------------------
  box(-40, -30, 0, 300, 250, 14, t.repo);
  box(540, -30, 0, 320, 250, 14, t.prod);
  // the bridge over the seam, with a belt
  box(260, 60, 2, 280, 70, 10, t.belt);
  [300, 345, 390, 435, 480].forEach((x) => poly([P(x, 62, 12.2), P(x + 14, 62, 12.2), P(x + 14, 128, 12.2), P(x, 128, 12.2)], shade(t.belt, name === 'dark' ? 2.4 : 1.35)));
  // commits, stacked
  [0, 1, 2, 3, 4, 5].forEach((i) => box(40, 40, 14 + i * 14, 130, 110, 11, t.commit[i % 3]));
  onTop('#17', 62, 122, 14 + 6 * 14 - 3, 26, '#ffffff', 800);
  onLeft('main', 48, 150, 30, 13, '#ffffff');
  // a scope card leaning beside the stack
  box(190, 150, 14, 50, 60, 4, t.paper);
  onTop('card', 196, 196, 18, 11, t.mute);
  // crates on the belt, each stamped
  o.push(`<g class="belt">`);
  [0, 1, 2].forEach((i) => {
    const x = 262 + i * 94;
    box(x, 78, 12, 34, 34, 26, t.crate);
    poly([P(x + 8, 86, 38.2), P(x + 26, 86, 38.2), P(x + 26, 104, 38.2), P(x + 8, 104, 38.2)], '#ffffff');
  });
  o.push(`</g>`);
  // the stamp press over the belt
  box(318, 46, 12, 8, 8, 78, t.tower);
  box(318, 136, 12, 8, 8, 78, t.tower);
  box(312, 46, 90, 20, 98, 14, t.accent);
  o.push(`<g class="press">`);
  box(316, 82, 62, 12, 26, 28, shade(t.accent, 0.8));
  o.push(`</g>`);
  // production: a tower that answers /version.json
  box(600, 20, 14, 150, 150, 26, t.tower);
  box(620, 40, 40, 110, 110, 140, t.tower);
  [0, 1, 2, 3].forEach((row) => [0, 1, 2].forEach((col) => {
    const x = 632 + col * 32;
    const z = 60 + row * 28;
    poly([P(x, 150, z), P(x + 20, 150, z), P(x + 20, 150, z + 16), P(x, 150, z + 16)], (row + col) % 3 === 0 ? t.window : shade(t.tower, 1.5), (row + col) % 3 === 0 ? 'class="blink"' : '');
  }));
  box(668, 88, 180, 6, 6, 44, t.mute);
  const beacon = P(671, 91, 228);
  o.push(`<circle class="pulse" cx="${beacon[0]}" cy="${beacon[1]}" r="7" fill="${t.green}"/>`);
  box(780, 120, 14, 6, 6, 44, t.mute);
  box(756, 118, 54, 56, 6, 24, t.paper);
  onLeft('/version', 760, 124, 62, 10.5, t.ink);

  // ---- captions ----------------------------------------------------------------------------
  label('Your repository', ['merged pull requests on main,', 'each with an optional seamkit-card'], -40, 220, 0, -150, 44);
  label('Build', ['seamkit stamp writes the commit', 'into version.json'], 400, 130, 0, -150, 62);
  label('The seam', ['a merge is not a deploy'], 400, 60, 0, 6, -84);
  label('Production', ['answers which commit it runs', 'and serves what the change added'], 860, 100, 0, 44, -44);
  label('Asked by', ['agents, CI and people,', 'through the CLI, MCP or the Action'], -40, -400, 48, -52, 6, 'end');
  label('seamkit core', ['deterministic, no model inside', 'reads git and production, GET only'], 408, -302, 196, 44, -22);
  label('Three answers', ['an exit code, a check run, and a', 'ledger that replays byte for byte'], 860, -420, 0, -8, 80, 'end');

  const css = `
.s{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif}
.m{font-family:ui-monospace,"SFMono-Regular","SF Mono",Menlo,Consolas,"Liberation Mono","DejaVu Sans Mono",monospace}
.flow{animation:flow 1.1s linear infinite}
.pulse{animation:pulse 2.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.blink{animation:blink 5s steps(1) infinite}
.belt{animation:belt 3.2s linear infinite}
.press{animation:press 3.2s ease-in-out infinite}
.drop{animation:drop 4.8s ease-in infinite}
@keyframes flow{to{stroke-dashoffset:-14}}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.72)}}
@keyframes blink{0%,60%{opacity:1}61%,74%{opacity:.25}75%,100%{opacity:1}}
@keyframes belt{from{transform:translate(0,0)}to{transform:translate(${r1(94 * C * K)}px,${r1(94 * S * K)}px)}}
@keyframes press{0%,18%,60%,100%{transform:translateY(0)}32%,44%{transform:translateY(17px)}}
@keyframes drop{0%{transform:translateY(-38px);opacity:0}18%{opacity:1}30%,100%{transform:translateY(0);opacity:1}}
@media (prefers-reduced-motion:reduce){.flow,.pulse,.blink,.belt,.press,.drop{animation:none}}`;

  const desc = 'An isometric scene in two rows. In the front row is your pipeline: a repository holding a stack of merged pull requests and a scope card; a bridge across a gap, the seam, where a press stamps each build with a version document; and production, a tower that answers /version. In the back row is seamkit: agents, CI and people ask; the core, a tower with a lens and no model inside, reads the repository and production over two dashed read-only beams; and it gives three answers: an exit code, a check run, and a ledger of stacked blocks that replays byte for byte.';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d"><title id="t">How seamkit sits beside your pipeline</title><desc id="d">${desc}</desc><style>${css}</style>${o.join('')}</svg>\n`;
}

for (const name of Object.keys(THEMES)) writeFileSync(join(OUT, `scene-${name}.svg`), scene(name));
console.log('scene: wrote docs/assets/scene-light.svg and scene-dark.svg');
