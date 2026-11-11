'use strict';
// `asset-slot` and `asset-missing` commands (spec 024, FR-008, W5). Node core only.
// run.md `## Assets` holds:
//   - slot <n>: <name> generated file=assets/<name>.png
//   - slot <n>: <name> missing
//   - missing: <name> reason=<one line>
// A run generates at most MAX_SLOTS images; the next slot needs --approved (the caller asks Robert first).
// Generation is `python3 ~/.claude/skills/imagegen/scripts/generate.py` via spawnSync with an argument array.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { Refusal, requireSlug, requireText, clean } = require('./common.cjs');
const { resolveRunDir, inside, isRegularFile } = require('./rundir.cjs');

const MAX_SLOTS = 8;
const HEADING = '## Assets';
const GATE_START = '<!-- gate-record:start -->';
const SLOT_RE = /^- slot (\d+): ([a-z0-9][a-z0-9-]{0,63}) (generated file=assets\/[a-z0-9-]+\.png|missing)$/;
const MISSING_RE = /^- missing: ([a-z0-9][a-z0-9-]{0,63}) reason=.*$/;
const GENERATE_TIMEOUT_MS = 180000;
const MAX_REASON_CHARS = 200;
const MAX_RESULT_BYTES = 5 * 1024 * 1024;
const PLACEHOLDER_STYLE = 'display:grid;place-items:center;min-height:12rem;padding:1rem;border:2px dashed currentColor;text-align:center';

const imagegenScript = () => path.join(os.homedir(), '.claude', 'skills', 'imagegen', 'scripts', 'generate.py');

function readAssets(runDir) {
  const lines = fs.readFileSync(path.join(runDir, 'run.md'), 'utf8').split('\n');
  const start = lines.findIndex((l) => l.trimEnd() === HEADING);
  if (start === -1) throw new Refusal(1, 'run.md has no "## Assets" section');
  const rest = lines.slice(start + 1).findIndex((l) => /^## /.test(l) || l.trimEnd() === GATE_START);
  const end = rest === -1 ? lines.length : start + 1 + rest;
  return Object.freeze({ before: lines.slice(0, start), section: lines.slice(start + 1, end), after: lines.slice(end) });
}

function writeAssets(runDir, parts, entries) {
  const text = [...parts.before, HEADING, '', ...entries, '', ...parts.after].join('\n');
  const target = path.join(runDir, 'run.md');
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { flag: 'wx' });
  fs.renameSync(tmp, target);
}

const entriesOf = (section) => section.map((l) => l.trimEnd()).filter((l) => SLOT_RE.test(l) || MISSING_RE.test(l));
const missingName = (l) => (MISSING_RE.exec(l) || [])[1];
const withoutMissing = (section, name) => entriesOf(section).filter((l) => missingName(l) !== name);
const slotsOf = (section) => section.map((l) => SLOT_RE.exec(l.trimEnd())).filter(Boolean);

/** assets/ inside the run folder, created on demand; a symlinked or foreign assets/ is refused. */
function assetsDir(runDir) {
  const dir = path.join(runDir, 'assets');
  if (fs.existsSync(dir)) {
    if (!inside(runDir, fs.realpathSync(dir))) throw new Refusal(1, 'assets/ resolves outside the run folder');
  } else {
    fs.mkdirSync(dir);
  }
  return dir;
}

/** Runs the generator for one image. Returns null on success or a one-line failure reason. */
function generate(dir, name, prompt) {
  const script = imagegenScript();
  if (!isRegularFile(script)) return 'imagegen is not installed';
  const out = path.join(dir, `${name}.png`);
  const r = spawnSync('python3', [script, `--prompt=${prompt}`, `--out=${out}`, `--slug=${name}`, '--n=1'], {
    encoding: 'utf8', timeout: GENERATE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error) return `imagegen could not run: ${r.error.code || 'error'}`;
  if (r.status !== 0) return `imagegen exited with status ${r.status}`;
  if (!isRegularFile(out) || !isRegularFile(path.join(dir, `${name}.json`))) return 'imagegen reported success but wrote no image and sidecar';
  return null;
}

function assetSlot(args) {
  const name = requireSlug('--name', args.name);
  const prompt = requireText('--prompt', args.prompt);
  const runDir = resolveRunDir(args['run-dir']);
  const parts = readAssets(runDir);
  const slots = slotsOf(parts.section);
  if (slots.some((m) => m[2] === name)) throw new Refusal(1, `asset "${name}" already has a slot; pick another name`);
  if (slots.length >= MAX_SLOTS && !args.approved) {
    throw new Refusal(1, `question: ${slots.length} images were generated for this run (cap ${MAX_SLOTS}). Ask Robert whether to generate "${name}" as well, then repeat with --approved`);
  }
  const reason = generate(assetsDir(runDir), name, prompt);
  const n = slots.length + 1;
  const kept = withoutMissing(parts.section, name);
  if (reason === null) {
    const entry = `- slot ${n}: ${name} generated file=assets/${name}.png`;
    writeAssets(runDir, parts, [...kept, entry]);
    process.stdout.write(`${entry}\n`);
    return 0;
  }
  writeAssets(runDir, parts, [...kept, `- slot ${n}: ${name} missing`, `- missing: ${name} reason=${clean(reason).slice(0, MAX_REASON_CHARS)}`]);
  applyPlaceholder(runDir, name);
  throw new Refusal(1, `missing: ${name} (${clean(reason)}); recorded in run.md and replaced by a labeled placeholder`);
}

function placeholderHtml(name) {
  return `<div data-a1-asset-placeholder="${name}" role="img" aria-label="Placeholder: image ${name} not generated" style="${PLACEHOLDER_STYLE}">Placeholder: image "${name}" not generated</div>`;
}

/** Swaps `<img ... data-a1-asset="<name>" ...>` in result/result.html for a labeled placeholder. Returns true if it changed. */
function applyPlaceholder(runDir, name) {
  const dir = path.join(runDir, 'result');
  const file = path.join(dir, 'result.html');
  if (!isRegularFile(file) || !inside(runDir, fs.realpathSync(dir))) return false;
  if (fs.statSync(file).size > MAX_RESULT_BYTES) throw new Refusal(2, 'result/result.html is too large');
  const html = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`<img\\b[^>]*\\bdata-a1-asset="${name}"[^>]*>`, 'g');
  const next = html.replace(re, () => placeholderHtml(name));
  if (next === html) return false;
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, next, { flag: 'wx' });
  fs.renameSync(tmp, file);
  return true;
}

function assetMissing(args) {
  const runDir = resolveRunDir(args['run-dir']);
  const parts = readAssets(runDir);
  if (args.name === undefined) {
    const names = entriesOf(parts.section).map(missingName).filter(Boolean);
    process.stdout.write(names.length === 0 ? '' : `${names.join('\n')}\n`);
    return 0;
  }
  const name = requireSlug('--name', args.name);
  const reason = clean(requireText('--reason', args.reason)).slice(0, MAX_REASON_CHARS);
  const kept = withoutMissing(parts.section, name);
  writeAssets(runDir, parts, [...kept, `- missing: ${name} reason=${reason}`]);
  const swapped = applyPlaceholder(runDir, name);
  process.stdout.write(`- missing: ${name} reason=${reason}${swapped ? ' (placeholder applied)' : ''}\n`);
  return 0;
}

module.exports = Object.freeze({ assetSlot, assetMissing, MAX_SLOTS });
