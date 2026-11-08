'use strict';

// ---------------------------------------------------------------------------
// fidelity-ci-runners — spec 017 FR-021 helper of fidelity-ci. Runner dialect
// globs (braces, extglob, classes), vitest / jest / pytest config readers and
// the per-file verdict of one runner invocation. Nothing is executed; JS
// configs are read from the masked source (fidelity-tokenizer).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { mask, isWordChar } = require('./fidelity-tokenizer.cjs');
const { globMatch, FidelityConfigError } = require('./fidelity-resolve.cjs');

const MAX_TEXT_BYTES = 1024 * 1024;
const VALUE_FLAGS = new Set(['--config', '-c', '--root', '-r', '--reporter', '--exclude', '--project', '--pool', '--environment',
  '--outputFile', '--rootdir', '-k', '-m', '-p', '-o', '--tb', '--maxfail', '--junitxml', '-n', '--cov', '--shard', '-t']);
const VITEST_CONFIGS = ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.cts', 'vitest.config.cjs',
  'vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs'];
const JEST_CONFIGS = ['jest.config.ts', 'jest.config.js', 'jest.config.mjs', 'jest.config.cjs'];
const VITEST_INCLUDE = ['**/*.{test,spec}.?(c|m)[jt]s?(x)'];
const VITEST_EXCLUDE = ['**/node_modules/**', '**/dist/**', '**/.git/**'];
const JEST_MATCH = ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'];
// Not modelled (the verdict stays 'yes' although fewer tests may run): --grep/-g/-G title filters, `grep` options, `respectGitIgnore`, project
// `dependencies`/`teardown`. Playwright's file selection itself (testDir, testMatch, testIgnore) is modelled as in playwright 1.65 (util.js
// createFileMatcher, configLoader resolveConfigFile): config from --config or the call dir only, `**/` prefix, case-insensitive, dot:true.
// Playwright resolves a config dir in this order (common/configLoader resolveConfigFile).
const PLAYWRIGHT_CONFIGS = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mts', 'playwright.config.mjs', 'playwright.config.cts', 'playwright.config.cjs'];
const PLAYWRIGHT_MATCH = ['**/*.@(spec|test).?(c|m)[jt]s?(x)'];
// Flags that take exactly one value token (program.js testOptions). Boolean flags (-x, --pass-with-no-tests, --fail-on-flaky-tests, ...) are
// NOT listed: a following token is a positional file filter. Optional-value flags (--debug, -u, --only-changed, --shuffle) are treated as boolean:
// a token after them counts as a filter, which fails closed. --project is variadic: only its first value is consumed, the rest count as filters.
const PLAYWRIGHT_VALUE_FLAGS = new Set(['--config', '-c', '--project', '--grep', '-g', '--grep-invert', '-G', '--reporter', '--add-reporter', '--workers', '-j',
  '--shard', '--retries', '--timeout', '--output', '--max-failures', '--repeat-each', '--browser', '--tsconfig', '--trace', '--global-timeout',
  '--ui-host', '--ui-port', '--update-source-method', '--last-failed-file', '--run-agents', '--test-list', '--test-list-invert']);
// Flags that run only part of the files: the verdict for a file is unknown.
const PLAYWRIGHT_SUBSET_FLAGS = new Set(['--last-failed', '--only-changed', '--test-list', '--test-list-invert']);
const PYTEST_SOURCES = [['pytest.ini', 'pytest'], ['pyproject.toml', 'tool.pytest.ini_options'], ['tox.ini', 'pytest'], ['setup.cfg', 'tool:pytest']];
const PYTEST_FILES = ['test_*.py', '*_test.py'];

const MAX_GLOB = 256;
const MAX_SCAN = 200000;

function readText(file) {
  let st;
  try { st = fs.lstatSync(file); } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw new FidelityConfigError(`unreadable ${file}: ${e.message}`);
  }
  if (!st.isFile() || st.size > MAX_TEXT_BYTES) throw new FidelityConfigError(`unreadable or oversized ${file}`);
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { throw new FidelityConfigError(`unreadable ${file}: ${e.message}`); }
}

/** Project-relative posix dir after `cd dir` from `cwd`, or null if dynamic or outside the repo. */
function joinDir(cwd, dir) {
  if (!dir || /[$~`]/.test(dir) || dir.startsWith('/')) return null;
  const r = path.posix.normalize(path.posix.join(cwd || '.', dir));
  if (r === '..' || r.startsWith('../')) return null;
  return r === '.' ? '' : r;
}

const parentOf = (d) => (path.posix.dirname(d) === '.' ? '' : path.posix.dirname(d));

// ---------- globs (runner dialect: braces, extglob, classes) ----------

function globToRegex(glob) {
  if (glob.length > MAX_GLOB) return null;
  const g = glob.replace(/^\.\//, '');
  const stack = [];
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    const open = /[?@+*!]/.test(c) && g[i + 1] === '(';
    if (open) { re += '(?:'; stack.push({ ext: true, close: c === '?' ? ')?' : c === '+' ? ')+' : c === '*' ? ')*' : ')' }); i++; continue; }
    if (c === '{') { re += '(?:'; stack.push({ ext: false, close: ')' }); continue; }
    if ((c === '}' || c === ')') && stack.length > 0) { re += stack.pop().close; continue; }
    if (c === ',' && stack.length > 0 && !stack[stack.length - 1].ext) { re += '|'; continue; }
    if (c === '|' && stack.length > 0) { re += '|'; continue; }
    if (c === '*' && g[i + 1] === '*') { const slash = g[i + 2] === '/'; re += slash ? '(?:.*/)?' : '.*'; i += slash ? 2 : 1; continue; }
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') { const e = g.indexOf(']', i + 1); if (e < 0) return null; re += g.slice(i, e + 1); i = e; } else re += c.replace(/[.\\^$()+|{}\]]/g, '\\$&');
  }
  if (stack.length > 0) return null;
  try { return new RegExp(`^${re}$`); } catch (_e) { return null; }
}

function compileAll(globs) {
  const out = globs.map(globToRegex);
  return out.every((r) => r !== null) ? out : null;
}

// ---------- JS config arrays (vitest/jest), read from masked source ----------

function topKeys(code, open) {
  const keys = new Map();
  let depth = 0;
  const end = Math.min(code.length, open + MAX_SCAN);
  for (let i = open; i < end; i++) {
    const c = code[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') { depth--; if (depth === 0) break; } else if (depth === 1 && /[A-Za-z_$]/.test(c) && !isWordChar(code[i - 1] || ' ')) {
      let j = i;
      while (j < end && isWordChar(code[j])) j++;
      let k = j;
      while (k < end && /\s/.test(code[k])) k++;
      if (code[k] === ':') keys.set(code.slice(i, j), k + 1);
      i = j - 1;
    }
  }
  return keys;
}

/** String list of the array literal at `pos`, or null when it is not a plain list of string literals. */
function stringArray(code, strings, pos) {
  let p = pos;
  while (/\s/.test(code[p] || '')) p++;
  if (code[p] !== '[') return null;
  const out = [];
  for (let i = p + 1; i < Math.min(code.length, p + MAX_SCAN); i++) {
    const c = code[i];
    if (c === ']') return out;
    if (c === '"' || c === "'" || c === '`') {
      const v = strings.get(i);
      const close = code.indexOf(c, i + 1);
      if (typeof v !== 'string' || close < 0) return null;
      out.push(v);
      i = close;
    } else if (!/[\s,]/.test(c)) return null;
  }
  return null;
}

/** {dynamic, arrays} for a vitest (`test: {}`) or jest (top-level export) config source. */
function readJsConfig(text, kind, wanted, blockers) {
  const { code, strings } = mask(text, 'js');
  const re = kind === 'vitest' ? /\btest\s*:\s*\{/ : /(?:export\s+default|module\.exports\s*=)[^{;]{0,200}\{/;
  const m = re.exec(code);
  const arrays = {};
  if (kind === 'vitest' && /\b(?:projects|workspace)\s*:/.test(code)) return { dynamic: true, arrays };
  if (m === null) return { dynamic: kind === 'jest', arrays };
  const keys = topKeys(code, m.index + m[0].length - 1);
  if (blockers.some((b) => keys.has(b))) return { dynamic: true, arrays };
  for (const k of wanted) {
    if (!keys.has(k)) continue;
    const list = stringArray(code, strings, keys.get(k));
    if (list === null) return { dynamic: true, arrays };
    arrays[k] = list;
  }
  return { dynamic: false, arrays };
}

// ---------- runner matchers ----------

function runnerArgs(args) {
  let config = null;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--config' || a === '-c') config = args[++i];
    else if (a.startsWith('--config=')) config = a.slice(9);
    else if (a.startsWith('-')) { if (VALUE_FLAGS.has(a)) i++; } else positional.push(a);
  }
  return { config, positional };
}

function firstExisting(state, dir, names) {
  for (const n of names) {
    const rel = dir ? `${dir}/${n}` : n;
    if (readCached(state, rel) !== null) return rel;
  }
  return null;
}

function readCached(state, rel) {
  const key = `text:${rel}`;
  if (!state.cache.has(key)) state.cache.set(key, readText(path.join(state.root, rel)));
  return state.cache.get(key);
}

function nodeMatcher(state, inv) {
  const { config, positional } = runnerArgs(inv.args);
  const vitest = inv.kind === 'vitest';
  const subs = vitest ? positional.filter((p, i) => !(i === 0 && ['run', 'watch', 'dev'].includes(p))) : positional;
  const m = { root: inv.cwd, dynamic: false, include: [], exclude: [], filters: subs.filter((p) => !p.includes('$')), dynamicFilter: subs.some((p) => p.includes('$')) };
  let cfg = config ? joinDir(inv.cwd, config) : null;
  if (config && cfg === null) return { ...m, dynamic: true };
  if (!cfg) cfg = vitest ? firstExisting(state, inv.cwd, VITEST_CONFIGS) : walkUp(state, inv.cwd, JEST_CONFIGS);
  let include = vitest ? VITEST_INCLUDE : JEST_MATCH;
  let exclude = vitest ? VITEST_EXCLUDE : [];
  if (cfg !== null) {
    if (!vitest) m.root = parentOf(cfg);
    const r = cfg.endsWith('package.json') ? jestFromPackage(state, cfg) : readJsConfig(readCached(state, cfg) || '', inv.kind,
      vitest ? ['include', 'exclude'] : ['testMatch'], vitest ? ['root'] : ['testRegex', 'projects', 'roots', 'rootDir']);
    if (r.dynamic) return { ...m, dynamic: true };
    include = (vitest ? r.arrays.include : r.arrays.testMatch) || include;
    exclude = vitest ? (r.arrays.exclude || exclude) : exclude;
  }
  const inc = compileAll(include);
  const exc = compileAll(exclude);
  return inc === null || exc === null ? { ...m, dynamic: true } : { ...m, include: inc, exclude: exc };
}

function jestFromPackage(state, rel) {
  const pkg = JSON.parse(readCached(state, rel));
  const j = pkg.jest;
  const bad = ['testRegex', 'projects', 'roots', 'rootDir'].some((k) => j[k] !== undefined);
  const mt = j.testMatch;
  if (bad || (mt !== undefined && !(Array.isArray(mt) && mt.every((x) => typeof x === 'string')))) return { dynamic: true, arrays: {} };
  return { dynamic: false, arrays: mt === undefined ? {} : { testMatch: mt } };
}

/** Nearest dir (cwd upwards) holding a config file name, or a package.json with a "jest" key. */
function walkUp(state, dir, names) {
  let d = dir;
  for (;;) {
    const hit = firstExisting(state, d, names);
    if (hit !== null) return hit;
    const pj = d ? `${d}/package.json` : 'package.json';
    const text = readCached(state, pj);
    if (text !== null) {
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) { throw new FidelityConfigError(`malformed ${pj}: ${e.message}`); }
      if (parsed && typeof parsed === 'object' && parsed.jest && typeof parsed.jest === 'object') return pj;
    }
    if (d === '') return null;
    d = parentOf(d);
  }
}

function iniValue(lines, key) {
  const i = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*[=:]`).test(l));
  if (i < 0) return null;
  let text = lines[i].replace(/^[^=:]*[=:]/, '');
  let depth = (text.match(/\[/g) || []).length - (text.match(/\]/g) || []).length;
  for (let j = i + 1; j < lines.length && (depth > 0 || /^\s+\S/.test(lines[j])); j++) {
    text += ` ${lines[j]}`;
    depth += (lines[j].match(/\[/g) || []).length - (lines[j].match(/\]/g) || []).length;
  }
  return text.replace(/[#;].*$/gm, '').replace(/[[\]",']/g, ' ').split(/\s+/).filter(Boolean);
}

function pytestConfig(state, dir) {
  let d = dir;
  for (;;) {
    for (const [file, section] of PYTEST_SOURCES) {
      const text = readCached(state, d ? `${d}/${file}` : file);
      if (text === null) continue;
      const lines = [];
      let on = false;
      let found = false;
      for (const l of text.split(/\r?\n/)) {
        const h = /^\s*\[([^\]]+)\]\s*$/.exec(l);
        if (h) { on = h[1].trim() === section; found = found || on; } else if (on) lines.push(l);
      }
      if (found) return { dir: d, testpaths: iniValue(lines, 'testpaths'), files: iniValue(lines, 'python_files') };
    }
    if (d === '') return { dir: dir, testpaths: null, files: null };
    d = parentOf(d);
  }
}

function pytestMatcher(state, inv) {
  const cfg = pytestConfig(state, inv.cwd);
  const { positional } = runnerArgs(inv.args);
  const given = positional.map((p) => p.split('::')[0]);
  const rooted = given.map((p) => joinDir(inv.cwd, p));
  if (rooted.includes(null)) return { dynamic: true, root: inv.cwd };
  const paths = given.length > 0 ? rooted : (cfg.testpaths || ['']).map((p) => (p === '' ? cfg.dir : joinDir(cfg.dir, p)));
  if (paths.includes(null)) return { dynamic: true, root: inv.cwd };
  return { py: true, dynamic: false, paths, files: cfg.files && cfg.files.length > 0 ? cfg.files : PYTEST_FILES, root: '' };
}

// ---------- playwright.config (testDir, testMatch, testIgnore) ----------

/** Index after the bracket that closes the one at `open` (masked code), or -1. */
function closeOf(code, open) {
  let depth = 0;
  for (let i = open; i < Math.min(code.length, open + MAX_SCAN); i++) {
    if ('{(['.includes(code[i])) depth++;
    else if ('})]'.includes(code[i])) { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

/** Depth-1 comma-separated segments [{start, end}] between the bracket at `open` and its match, or null. */
function segments(code, open) {
  const close = closeOf(code, open);
  if (close < 0) return null;
  const out = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close - 1; i++) {
    const c = code[i];
    if ('{(['.includes(c)) depth++;
    else if ('})]'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { out.push({ start, end: i }); start = i + 1; }
  }
  out.push({ start, end: close - 1 });
  return out.filter((sg) => code.slice(sg.start, sg.end).trim() !== '');
}

/** {key: {start, end}} of an object literal at `open`; null when any member is not a plain `ident: value` (shorthand, quoted, computed, spread, method). */
function members(code, open) {
  const segs = segments(code, open);
  if (segs === null) return null;
  const out = {};
  for (const sg of segs) {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(code.slice(sg.start, sg.end));
    if (m === null) return null;
    out[m[1]] = { start: sg.start + m[0].length, end: sg.end };
  }
  return out;
}

/** A single plain string literal value in [start,end), or null. */
function literal(code, strings, { start, end }) {
  const t = code.slice(start, end);
  const p = start + (t.length - t.trimStart().length);
  const body = t.trim();
  const v = strings.get(p);
  if (body.length < 2 || !'"\'`'.includes(body[0]) || body[body.length - 1] !== body[0] || !/^\s*$/.test(body.slice(1, -1)) || typeof v !== 'string') return null;
  return v;
}

/** String or array of strings; null when anything else (regex, call, identifier, concat). */
function patternList(code, strings, span) {
  const one = literal(code, strings, span);
  if (one !== null) return [one];
  const t = code.slice(span.start, span.end);
  const p = span.start + (t.length - t.trimStart().length);
  if (code[p] !== '[' || closeOf(code, p) !== span.start + t.trimEnd().length) return null;
  return stringArray(code, strings, p);
}

const RESERVED = ['testDir', 'testMatch', 'testIgnore', 'projects'];
const SELECTION = ['testDir', 'testMatch', 'testIgnore'];

/** Projects must be an array literal of object literals with plain members and no own file selection. */
function projectsAreSimple(code, span) {
  const t = code.slice(span.start, span.end);
  const p = span.start + (t.length - t.trimStart().length);
  if (code[p] !== '[' || closeOf(code, p) !== span.start + t.trimEnd().length) return false;
  const elements = segments(code, p);
  return elements !== null && elements.every((el) => {
    const q = el.start + (code.slice(el.start, el.end).length - code.slice(el.start, el.end).trimStart().length);
    const mem = code[q] === '{' && closeOf(code, q) === el.start + code.slice(el.start, el.end).trimEnd().length ? members(code, q) : null;
    return mem !== null && SELECTION.every((k) => !(k in mem));
  });
}

/** Playwright prefixes `**\/` to patterns lacking it and matches case-insensitively with dot:true (util.js createFileMatcher). */
function playwrightPattern(g) {
  if (g === '' || /^[!/.]/.test(g) || g.includes('\\')) return null;
  return g.startsWith('**/') ? g : `**/${g}`;
}

const PLAYWRIGHT_DEFINE = /(?:import\s*\{[^}]*\bdefineConfig\b[^}]*\}\s*from|require\s*\()\s*['"](?:@playwright\/test|playwright\/test)['"]/;

function readPlaywrightConfig(text) {
  const dynamic = { dynamic: true, testDir: '', match: PLAYWRIGHT_MATCH, ignore: [], risky: false };
  const { code, strings } = mask(text, 'js');
  const m = /(?:export\s+default|module\.exports\s*=)\s*(defineConfig\s*\(\s*)?\{/.exec(code);
  if (m === null) return dynamic;
  const open = m.index + m[0].length - 1;
  const close = closeOf(code, open);
  // defineConfig(a, b) merges the later arguments over the first: only a single object argument is read.
  if (close < 0 || (m[1] && !/^\s*\)/.test(code.slice(close)))) return dynamic;
  // A defineConfig that does not come from Playwright (own wrapper) can rewrite the object.
  if (m[1] && !PLAYWRIGHT_DEFINE.test(text)) return dynamic;
  // A second export or merge after the literal (module.exports[k] = ..., Object.assign(module.exports, x), module.exports = require(..)) can override it;
  // a string literal naming a reserved key can be a bracket-notation write.
  const exportsSeen = (code.match(/(?<![\w$.])exports\b|module\.exports\b|export\s+default\b/g) || []).length;
  if (exportsSeen > 1 || /\bObject\s*\.\s*assign\b/.test(code) || [...strings.values()].some((v) => RESERVED.includes(v))) return dynamic;
  const mem = members(code, open);
  if (mem === null) return dynamic;
  // A reserved name that appears more often than as its own member key (mutation, shorthand, spread source) cannot be followed.
  const count = (k) => (code.match(new RegExp(`(?<![\\w$])${k}(?![\\w$])`, 'g')) || []).length;
  if (RESERVED.some((k) => count(k) > (k in mem ? 1 : 0))) return dynamic;
  const out = { ...dynamic, dynamic: false };
  if ('projects' in mem && !projectsAreSimple(code, mem.projects)) return dynamic;
  if ('testDir' in mem) {
    const v = literal(code, strings, mem.testDir);
    if (v === null || /[$~`]/.test(v)) return dynamic;
    out.testDir = v;
  }
  for (const [key, field] of [['testMatch', 'match'], ['testIgnore', 'ignore']]) {
    if (!(key in mem)) continue;
    const list = patternList(code, strings, mem[key]);
    const pats = list === null ? null : list.map(playwrightPattern);
    if (pats === null || pats.includes(null)) return dynamic;
    out[field] = pats;
  }
  // An ignore pattern with a directory part could also match a directory above the repo root (it is tested on the absolute path).
  out.risky = out.ignore.some((g) => g.slice(3).includes('/') || g.endsWith('**'));
  return out;
}

/** {file, dir}: Playwright reads --config (file or directory) or else only the call dir, never a parent. undefined: path missing. */
function playwrightConfigFile(state, inv, config) {
  const target = config ? joinDir(inv.cwd, config) : inv.cwd;
  if (target === null) return undefined;
  const isDir = isDirectory(path.join(state.root, target));
  if (config && !isDir) return readCached(state, target) !== null ? { file: target, dir: parentOf(target) } : undefined;
  const hit = firstExisting(state, target, PLAYWRIGHT_CONFIGS);
  if (hit !== null) return { file: hit, dir: target };
  return { file: null, dir: target };
}

function isDirectory(abs) {
  try { return fs.statSync(abs).isDirectory(); } catch (_e) { return false; }
}

function playwrightArgs(args) {
  let config = null;
  let subset = false;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const flag = a.split('=')[0];
    if (a === '--config' || a === '-c') config = args[++i];
    else if (a.startsWith('--config=')) config = a.slice(9);
    else if (a.startsWith('-c') && a.length > 2 && a[1] !== '-') config = a.slice(2);
    else if (a.startsWith('-')) {
      if (PLAYWRIGHT_SUBSET_FLAGS.has(flag)) subset = true;
      if (!a.includes('=') && PLAYWRIGHT_VALUE_FLAGS.has(a)) i++;
    } else positional.push(a);
  }
  return { config, positional, subset };
}

const caseless = (res) => res.map((re) => new RegExp(re.source, 'i'));

function playwrightMatcher(state, inv) {
  const { config, positional, subset } = playwrightArgs(inv.args);
  const filterWhy = positional.length > 0 ? `playwright: positional filter ${JSON.stringify(positional[0])}` : subset ? 'playwright: subset flag (--last-failed, --only-changed or --test-list)' : '';
  const m = { root: inv.cwd, full: true, dynamic: false, include: [], exclude: [], filters: [], dynamicFilter: filterWhy !== '', why: filterWhy };
  const loc = playwrightConfigFile(state, inv, config);
  if (loc === undefined) return { ...m, dynamic: true, why: `playwright: config ${JSON.stringify(config || '.')} not found` };
  const parsed = loc.file === null ? { dynamic: false, testDir: '', match: PLAYWRIGHT_MATCH, ignore: [], risky: false } : readPlaywrightConfig(readCached(state, loc.file) || '');
  const root = joinDir(loc.dir, parsed.testDir || '.');
  const inc = compileAll(parsed.match);
  const exc = compileAll([...parsed.ignore, '**/node_modules/**']);
  if (parsed.dynamic || root === null || inc === null || exc === null) return { ...m, dynamic: true, why: `playwright: dynamic config ${loc.file || loc.dir}` };
  const risky = parsed.risky ? `playwright: directory testIgnore pattern ${JSON.stringify(parsed.ignore.join(' '))} may match above the repo root` : '';
  return { ...m, root, include: caseless(inc), exclude: caseless(exc), risky: parsed.risky, riskWhy: risky };
}

function buildMatcher(state, inv) {
  if (inv.kind === 'playwright') return playwrightMatcher(state, inv);
  return inv.kind === 'pytest' ? pytestMatcher(state, inv) : nodeMatcher(state, inv);
}

/** 'yes' | 'no' | 'unknown' for one changed test file against one runner invocation. */
function judge(m, rel) {
  if (m.py) {
    const under = m.paths.some((p) => p === '' || rel === p || rel.startsWith(`${p}/`));
    return under && m.files.some((g) => globMatch(g, rel)) ? 'yes' : 'no';
  }
  if (m.root && rel !== m.root && !rel.startsWith(`${m.root}/`)) return 'no';
  if (m.dynamic) return 'unknown';
  const r = m.full || !m.root ? rel : rel.slice(m.root.length + 1);
  if (!m.include.some((re) => re.test(r)) || m.exclude.some((re) => re.test(r))) return 'no';
  if (m.risky) return 'unknown'; // an ignore pattern with a directory part may also match above the repo root
  if (m.filters.length > 0 && m.filters.some((f) => rel.includes(f))) return 'yes';
  if (m.filters.length === 0 && !m.dynamicFilter) return 'yes';
  return m.dynamicFilter ? 'unknown' : 'no';
}

/** The concrete cause of an 'unknown' verdict of one runner invocation ('' when the matcher names none). */
function judgeWhy(m, rel) {
  if (m.dynamic && !(m.root && rel !== m.root && !rel.startsWith(`${m.root}/`))) return m.why || '';
  if (m.risky && !m.dynamicFilter) return m.riskWhy || '';
  return m.why || '';
}

module.exports = { readText, joinDir, parentOf, buildMatcher, judge, judgeWhy, globToRegex };
