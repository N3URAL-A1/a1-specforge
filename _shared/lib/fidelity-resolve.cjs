'use strict';

// ---------------------------------------------------------------------------
// fidelity-resolve — spec 017 FR-020 / FR-019. Module specifier resolution
// (relative, tsconfig `paths`, one `extends` level, one re-export hop), glob
// matching and test-file detection. Fails closed: an unreadable or malformed
// tsconfig throws FidelityConfigError (the CLI maps it to exit 2).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { mask } = require('./fidelity-tokenizer.cjs');

const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.py'];
const DEFAULT_TEST_GLOBS = ['*.test.*', '*.spec.*', 'test_*.py', '*_test.py'];
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_GLOB_LENGTH = 256;
const REEXPORT_RE = /\bexport\b[^;'"`]{0,300}?\bfrom[ \t\r\n]{0,64}['"]/g;

class FidelityConfigError extends Error {}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (_e) { return false; }
}

// ---------- JSONC ----------

/** Strip comments and trailing commas outside strings (tsconfig is JSONC). */
function stripJsonc(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2; continue;
    }
    out += c; i++;
  }
  return dropTrailingCommas(out);
}

function dropTrailingCommas(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += text[i + 1] || ''; i++; } else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

function readJsonc(file) {
  let text;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_CONFIG_BYTES) throw new Error('not a regular file or too large');
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new FidelityConfigError(`unreadable config ${file}: ${e.message}`);
  }
  try {
    return JSON.parse(stripJsonc(text));
  } catch (e) {
    throw new FidelityConfigError(`malformed config ${file}: ${e.message}`);
  }
}

// ---------- tsconfig paths ----------

function pathsOf(file, cfg) {
  const co = cfg && typeof cfg === 'object' && cfg.compilerOptions && typeof cfg.compilerOptions === 'object' ? cfg.compilerOptions : {};
  const dir = path.dirname(file);
  const baseUrl = typeof co.baseUrl === 'string' ? path.resolve(dir, co.baseUrl) : null;
  const paths = co.paths && typeof co.paths === 'object' && !Array.isArray(co.paths) ? co.paths : null;
  return { baseUrl, paths, dir };
}

/**
 * Load `compilerOptions.paths` of <project>/tsconfig.json, following one relative
 * `extends` level. A missing tsconfig.json yields no aliases. Package `extends`
 * values ("@tsconfig/node20") are not followed.
 * @returns {{base: string, mappings: Array<{pattern: string, targets: string[]}>}}
 */
function loadAliases(projectRoot) {
  const file = path.join(projectRoot, 'tsconfig.json');
  if (!isFile(file)) return { base: projectRoot, mappings: [] };
  const cfg = readJsonc(file);
  let own = pathsOf(file, cfg);
  if (own.paths === null && typeof cfg.extends === 'string' && cfg.extends.startsWith('.')) {
    const ext = path.resolve(path.dirname(file), cfg.extends.endsWith('.json') ? cfg.extends : `${cfg.extends}.json`);
    own = pathsOf(ext, readJsonc(ext));
  }
  if (own.paths === null) return { base: projectRoot, mappings: [] };
  const mappings = Object.entries(own.paths)
    .filter(([, t]) => Array.isArray(t) && t.every((x) => typeof x === 'string'))
    .map(([pattern, targets]) => ({ pattern, targets }));
  return { base: own.baseUrl || own.dir, mappings };
}

function matchAlias(pattern, spec) {
  const star = pattern.indexOf('*');
  if (star < 0) return pattern === spec ? '' : null;
  const pre = pattern.slice(0, star);
  const post = pattern.slice(star + 1);
  if (spec.length < pre.length + post.length) return null;
  if (!spec.startsWith(pre) || !spec.endsWith(post)) return null;
  return spec.slice(pre.length, spec.length - post.length);
}

// ---------- resolution ----------

function candidateFile(projectRoot, absBase) {
  const tries = [];
  if (EXTENSIONS.includes(path.extname(absBase))) tries.push(absBase);
  for (const ext of EXTENSIONS) tries.push(absBase + ext);
  for (const ext of EXTENSIONS) tries.push(path.join(absBase, `index${ext}`));
  for (const t of tries) {
    const rel = path.relative(projectRoot, t);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    if (isFile(t)) return rel.split(path.sep).join('/');
  }
  return null;
}

/**
 * Resolve a specifier imported from `fromRel` (project-relative, posix) to a
 * project-relative file, or null. Package specifiers never resolve.
 */
function resolveSpecifier(ctx, fromRel, spec) {
  if (typeof spec !== 'string' || spec === '' || spec.includes('\0')) return null;
  if (spec.startsWith('.')) {
    const abs = path.resolve(ctx.projectRoot, path.dirname(fromRel), spec);
    return candidateFile(ctx.projectRoot, abs);
  }
  for (const { pattern, targets } of ctx.aliases.mappings) {
    const star = matchAlias(pattern, spec);
    if (star === null) continue;
    for (const t of targets) {
      const abs = path.resolve(ctx.aliases.base, t.replace('*', star));
      const hit = candidateFile(ctx.projectRoot, abs);
      if (hit !== null) return hit;
    }
  }
  return null;
}

/** Files re-exported by `rel` (one hop): `export * from 'x'`, `export {a} from 'x'`. */
function reexportsOf(ctx, rel) {
  const abs = path.join(ctx.projectRoot, rel);
  let text;
  try {
    if (fs.statSync(abs).size > ctx.maxFileBytes) return [];
    text = fs.readFileSync(abs, 'utf8');
  } catch (_e) { return []; }
  const { code, strings } = mask(text, rel.endsWith('.py') ? 'py' : 'js');
  const out = [];
  REEXPORT_RE.lastIndex = 0;
  let m;
  while ((m = REEXPORT_RE.exec(code)) !== null) {
    const spec = strings.get(m.index + m[0].length - 1);
    const hit = typeof spec === 'string' ? resolveSpecifier(ctx, rel, spec) : null;
    if (hit !== null) out.push(hit);
  }
  return out;
}

/** The resolved file plus its one-hop re-export targets. */
function subjectFiles(ctx, fromRel, spec) {
  const hit = resolveSpecifier(ctx, fromRel, spec);
  if (hit === null) return [];
  return [hit, ...reexportsOf(ctx, hit)];
}

// ---------- globs ----------

function matchSegment(pat, str) {
  let p = 0;
  let s = 0;
  let star = -1;
  let mark = 0;
  while (s < str.length) {
    if (p < pat.length && (pat[p] === '?' || pat[p] === str[s])) { p++; s++; }
    else if (p < pat.length && pat[p] === '*') { star = p++; mark = s; }
    else if (star >= 0) { p = star + 1; s = ++mark; }
    else return false;
  }
  while (p < pat.length && pat[p] === '*') p++;
  return p === pat.length;
}

function matchSegments(pat, segs) {
  const memo = new Map();
  const go = (i, j) => {
    const key = i * (segs.length + 1) + j;
    if (memo.has(key)) return memo.get(key);
    let r;
    if (i === pat.length) r = j === segs.length;
    else if (pat[i] === '**') r = go(i + 1, j) || (j < segs.length && go(i, j + 1));
    else r = j < segs.length && matchSegment(pat[i], segs[j]) && go(i + 1, j + 1);
    memo.set(key, r);
    return r;
  };
  return go(0, 0);
}

/** Glob match on a posix project-relative path. A glob without `/` matches the basename. */
function globMatch(glob, rel) {
  if (typeof glob !== 'string' || glob === '' || glob.length > MAX_GLOB_LENGTH) return false;
  const segs = rel.split('/');
  if (!glob.includes('/')) return matchSegment(glob, segs[segs.length - 1]);
  return matchSegments(glob.replace(/^\.\//, '').split('/'), segs);
}

function isTestFile(rel, extraGlobs) {
  return [...DEFAULT_TEST_GLOBS, ...extraGlobs].some((g) => globMatch(g, rel));
}

module.exports = {
  EXTENSIONS, DEFAULT_TEST_GLOBS, FidelityConfigError,
  loadAliases, resolveSpecifier, subjectFiles, globMatch, isTestFile, stripJsonc,
};
