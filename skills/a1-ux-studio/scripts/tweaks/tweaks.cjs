#!/usr/bin/env node
'use strict';
// tweaks.cjs (spec 024, FR-026/FR-027, W10). Node core only.
//   build         --run-dir <dir>
//   export-tokens --spec <file> --screen <slug> --values <json>
// build writes result/result.dev.html = result/result.html + the tweaks panel. result.html is never changed.
// export-tokens writes one token block directly under the `UX/<screen>:` line of the spec; a second export replaces it.
// Exit codes: 0 ok, 1 refusal (no result page, spec without the UX line), 2 usage or hostile input, 3 internal error.

const fs = require('fs');
const path = require('path');
const { Refusal, parseArgs, requireSlug, requireText, clean } = require('../run/common.cjs');
const { resolveRunDir, isRegularFile } = require('../run/rundir.cjs');

const MARK = 'data-a1-tweaks';
const PANEL_JS = path.join(__dirname, '..', '..', 'templates', 'tweaks-panel.js');
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const TOKEN_START = (screen) => `<!-- a1-ux-tokens:start ${screen} -->`;
const TOKEN_END = (screen) => `<!-- a1-ux-tokens:end ${screen} -->`;
const FONT_RE = /^[A-Za-z0-9][A-Za-z0-9 ]{0,39}$/;
const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;

function readBounded(file, label) {
  if (!isRegularFile(file)) throw new Refusal(1, `${label} is missing or not a regular file`);
  if (fs.statSync(file).size > MAX_FILE_BYTES) throw new Refusal(2, `${label} is larger than ${MAX_FILE_BYTES} bytes`);
  return fs.readFileSync(file, 'utf8');
}

function writeAtomic(target, text) {
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { flag: 'wx' });
  fs.renameSync(tmp, target);
}

function build(args) {
  const runDir = resolveRunDir(args['run-dir']);
  const src = path.join(runDir, 'result', 'result.html');
  const html = readBounded(src, 'result/result.html');
  if (html.includes(MARK)) throw new Refusal(1, `result/result.html already contains ${MARK}; the exported page must stay free of the panel`);
  const js = fs.readFileSync(PANEL_JS, 'utf8');
  if (/<\/script/i.test(js)) throw new Refusal(3, 'tweaks-panel.js contains a closing script tag');
  const block = `<script ${MARK}="script">\n${js}\n</script>\n`;
  const at = html.toLowerCase().lastIndexOf('</body>');
  const dev = at === -1 ? html + block : html.slice(0, at) + block + html.slice(at);
  writeAtomic(path.join(runDir, 'result', 'result.dev.html'), dev);
  process.stdout.write('result/result.dev.html\n');
  return 0;
}

/** Validated token values: { font, size, accent, motion }; every value is a plain scalar, no markup. */
function parseValues(raw) {
  let v;
  try { v = JSON.parse(requireText('--values', raw)); } catch (e) {
    if (e instanceof Refusal) throw e;
    throw new Refusal(2, 'invalid --values: not JSON');
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Refusal(2, 'invalid --values: want a JSON object');
  const extra = Object.keys(v).filter((k) => !['font', 'size', 'accent', 'motion'].includes(k));
  if (extra.length) throw new Refusal(2, `invalid --values: unknown key ${clean(extra[0]).slice(0, 40)}`);
  const font = v.font === undefined ? '' : v.font;
  if (typeof font !== 'string' || (font !== '' && !FONT_RE.test(font))) throw new Refusal(2, 'invalid --values.font: letters, digits and spaces only');
  if (!Number.isFinite(v.size) || v.size < 8 || v.size > 96) throw new Refusal(2, 'invalid --values.size: want a number from 8 to 96');
  if (typeof v.accent !== 'string' || !ACCENT_RE.test(v.accent)) throw new Refusal(2, 'invalid --values.accent: want #rrggbb');
  if (!Number.isFinite(v.motion) || v.motion < 0 || v.motion > 2) throw new Refusal(2, 'invalid --values.motion: want a number from 0 to 2');
  return Object.freeze({ font, size: v.size, accent: v.accent.toLowerCase(), motion: v.motion });
}

function tokenBlock(screen, t) {
  return [
    TOKEN_START(screen), '```yaml', 'design-tokens:', `  font: ${JSON.stringify(t.font || 'original')}`, `  size: ${t.size}px`,
    `  accent: "${t.accent}"`, `  motion: ${t.motion}`, '```', TOKEN_END(screen),
  ];
}

/** Index of the first line after the frontmatter. */
function bodyStart(lines) {
  if (lines[0] !== '---') return 0;
  const close = lines.findIndex((l, i) => i > 0 && l === '---');
  return close === -1 ? lines.length : close + 1;
}

function exportTokens(args) {
  const screen = requireSlug('--screen', args.screen);
  const values = parseValues(args.values);
  const specPath = requireText('--spec', args.spec);
  const lines = readBounded(specPath, 'spec').split('\n');
  const from = bodyStart(lines);
  const decision = lines.findIndex((l, i) => i >= from && l.startsWith(`UX/${screen}:`));
  if (decision === -1) throw new Refusal(1, `spec has no "UX/${screen}:" decision line; nothing written`);
  const start = TOKEN_START(screen);
  const end = TOKEN_END(screen);
  const rest = lines.slice(decision + 1);
  const s = rest.findIndex((l) => l === start);
  const e = s === -1 ? -1 : rest.findIndex((l, i) => i > s && l === end);
  if (s !== -1 && e === -1) throw new Refusal(1, `spec has a token block start for ${screen} without its end marker; nothing written`);
  // an existing block for this screen anywhere after the decision line is replaced, not duplicated
  const kept = s !== -1 && e !== -1 ? [...rest.slice(0, s), ...rest.slice(e + 1)] : rest;
  const next = [...lines.slice(0, decision + 1), ...tokenBlock(screen, values), ...kept];
  writeAtomic(specPath, next.join('\n'));
  process.stdout.write(`tokens written under UX/${screen}\n`);
  return 0;
}

const USAGE = 'usage: tweaks.cjs build --run-dir <dir>\n       tweaks.cjs export-tokens --spec <file> --screen <slug> --values <json>';
const COMMANDS = Object.freeze({ build, 'export-tokens': exportTokens });

function main(argv) {
  const [cmd, ...rest] = argv;
  if (!Object.prototype.hasOwnProperty.call(COMMANDS, cmd)) throw new Refusal(2, USAGE);
  return COMMANDS[cmd](parseArgs(rest));
}

try { process.exit(main(process.argv.slice(2))); } catch (e) {
  if (e instanceof Refusal) { process.stderr.write(`error: ${clean(e.message)}\n`); process.exit(e.code); }
  process.stderr.write(`error: ${clean(e && e.message ? e.message : e)}\n`);
  process.exit(3);
}
