#!/usr/bin/env node
'use strict';
// Renders the real board fixtures once from skills/a1-ux-studio/templates/board.html (spec 024, W4).
// Usage: node render-fixtures.cjs <out-dir>   (the committed outputs sit next to this file)
const fs = require('fs');
const path = require('path');

const TEMPLATE = path.join(__dirname, '..', '..', '..', '..', 'skills', 'a1-ux-studio', 'templates', 'board.html');
const FAMILIES = { inter: 'Inter', lora: 'Lora', 'space-grotesk': 'Space Grotesk', 'ibm-plex-mono': 'IBM Plex Mono', 'playfair-display': 'Playfair Display' };
const BRIEF = 'Pricing screen for a B2B SaaS; the visitor compares three plans and starts a trial.';

const faces = (ids) => ids.flatMap((id) => [400, 700].map((w) => `@font-face { font-family: "${FAMILIES[id]}"; font-weight: ${w}; font-style: normal; font-display: swap; src: url("fonts/${id}/${id}-latin-${w}-normal.woff2") format("woff2"); }`)).join('\n');
const tile = (id, family, layout, body, extra = '') => `<section data-a1-tile${extra} data-option-id="${id}" data-family="${family}" data-layout="${layout}">
  <header><h2>${id}</h2></header>
  <div class="a1-tile-body" style="font-family: '${FAMILIES[family]}', serif;">${body}</div>
  <footer><p class="a1-pick-hint">To pick this one, say: pick ${id}</p></footer>
</section>`;
const fill = (tpl, vars) => tpl.replace(/<!--[\s\S]*?-->\n/, '').replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k]);

const divergeBody = (name) => `<h3>${name}</h3><p>${BRIEF}</p><button type="button">Start trial</button>`;
const layouts = {
  stacked: '<h3>Pricing</h3><p>Three plans, one trial.</p><ul><li>Starter</li><li>Team</li><li>Scale</li></ul><button type="button">Start trial</button>',
  split: '<div><h3>Pricing</h3><p>Three plans, one trial.</p></div><aside><table><tr><td>Starter</td></tr><tr><td>Team</td></tr></table><a href="#trial">Start trial</a></aside>',
  cards: '<article><h4>Starter</h4><p>Solo</p></article><article><h4>Team</h4><p>Most picked</p></article><article><h4>Scale</h4><p>Everything</p></article><footer><button type="button">Start trial</button></footer>',
};
const colourOnly = (c) => `<div style="background:${c}"><h3>Pricing</h3><p>Three plans, one trial.</p><button type="button">Start trial</button></div>`;

function page(tpl, title, ids, tiles) {
  return fill(tpl, { title, heading: title, instruction: 'Say which tile you want: pick <id>.', font_faces: faces(ids), tiles: tiles.join('\n') });
}

const out = process.argv[2];
if (!out) { process.stderr.write('usage: render-fixtures.cjs <out-dir>\n'); process.exit(2); }
const tpl = fs.readFileSync(TEMPLATE, 'utf8');
const ids = Object.keys(FAMILIES);
fs.writeFileSync(path.join(out, 'diverge.html'), page(tpl, 'Pick a family', ids, ids.map((id) => tile(id, id, 'default', divergeBody(FAMILIES[id])))));
fs.writeFileSync(path.join(out, 'converge.html'), page(tpl, 'Pick a layout', ['lora'], Object.keys(layouts).map((l) => tile(l, 'lora', l, layouts[l]))));
fs.writeFileSync(path.join(out, 'converge-colour-only.html'), page(tpl, 'Pick a layout', ['lora'], ['#fff3d6', '#dff0e4', '#e3e8fb'].map((c, i) => tile(`l${i}`, 'lora', `layout-${i}`, colourOnly(c)))));
