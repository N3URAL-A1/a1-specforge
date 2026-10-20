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

function buildMatcher(state, inv) {
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
  const r = m.root ? rel.slice(m.root.length + 1) : rel;
  if (!m.include.some((re) => re.test(r)) || m.exclude.some((re) => re.test(r))) return 'no';
  if (m.filters.length > 0 && m.filters.some((f) => rel.includes(f))) return 'yes';
  if (m.filters.length === 0 && !m.dynamicFilter) return 'yes';
  return m.dynamicFilter ? 'unknown' : 'no';
}

module.exports = { readText, joinDir, parentOf, buildMatcher, judge, globToRegex };
