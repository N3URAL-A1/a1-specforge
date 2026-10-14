'use strict';

// ---------------------------------------------------------------------------
// xprov scope — spec 016 (xprov autonomy), Wave 6 (FR-015, FR-016). Sole
// writer: this wave. Deterministic, no LLM, no network.
//
// Classifies a path list (or the file list of a git range) as
//   security_surface  — the union of the globs in xprov-scope-globs.json, which
//                       includes quick.cjs#FORBIDDEN_SURFACE_GLOBS BY REFERENCE
//                       (plan decision D-4: resolved at run time, never copied);
//   docs_only         — every path is documentation (`*.md`, `docs/**`,
//                       `LICENSE`) AND no path is security surface.
//
// Fail closed (plan D-5): a path that cannot be classified safely — empty,
// absolute, containing `..` or NUL, longer than MAX_PATH_CHARS — counts as
// security surface with category `unclassifiable`. Any failure to run at all
// (unreadable input, bad revision, broken glob file) exits 2 with no stdout:
// the caller treats a non-zero exit as "guarded".
//
// stdout (exit 0): { version, security_surface, docs_only, total, matched:
// [{ path, category, glob }] } — matched sorted by path, paths clipped, the
// same input gives the same bytes. Waves 7 and 10 call the pure
// classifyPaths()/classify() directly.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const io = require('./io.cjs');
const xprov = require('./xprov.cjs');
const C = require('./xprov-common.cjs');

const GLOBS_FILE = path.join(__dirname, 'xprov-scope-globs.json');
const GLOBS_VERSION = 1;
const OUTPUT_VERSION = 1;
const MAX_PATH_CHARS = 4096; // PATH_MAX on Linux; anything longer is not a path git would hand us
const MATCHED_PATH_ECHO_CHARS = 300; // a hostile 10 000-char name is not echoed whole
const MAX_PATHS = 200000;
const MAX_PATHS_FILE_BYTES = 16 * 1024 * 1024;
const MAX_GLOBS = 2000;
const MAX_GLOB_CHARS = 200;
const INCLUDE_MODULES = Object.freeze({ 'quick.cjs': './quick.cjs' }); // the only modules a glob file may name
const REV_RE = /^(?:[0-9a-fA-F]{4,64}|HEAD)$/;
const CATEGORY_UNCLASSIFIABLE = 'unclassifiable';
const ABSOLUTE_RE = /^(?:[\\/]|[A-Za-z]:)/;

// ---------- glob compilation and matching ----------

/** One glob → segment matchers: the string '**' or a RegExp for a segment in which `*` and `?` stay inside the segment. */
function compileGlob(glob) {
  return String(glob).split('/').filter((s) => s !== '').map((seg) => {
    if (seg === '**') return '**';
    const re = seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
    return new RegExp(`^${re}$`);
  });
}

function matchSegments(pattern, segs) {
  const memo = new Map();
  const walk = (pi, si) => {
    const key = pi * (segs.length + 1) + si;
    if (memo.has(key)) return memo.get(key);
    let result;
    if (pi === pattern.length) result = si === segs.length;
    else if (pattern[pi] === '**') result = walk(pi + 1, si) || (si < segs.length && walk(pi, si + 1));
    else result = si < segs.length && pattern[pi].test(segs[si]) && walk(pi + 1, si + 1);
    memo.set(key, result);
    return result;
  };
  return walk(0, 0);
}

// ---------- glob set ----------

function checkGlobList(list, what) {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_GLOBS) throw C.inputError(`xprov scope: ${what} must be a non-empty glob list of at most ${MAX_GLOBS} entries`, 'scope_globs_invalid');
  for (const g of list) {
    if (typeof g !== 'string' || g === '' || g.length > MAX_GLOB_CHARS || g.startsWith('/') || g.includes('..')) throw C.inputError(`xprov scope: ${what} holds an invalid glob`, 'scope_globs_invalid');
  }
  return list;
}

/** The list named by `include` (`module#export`), read from the live module so a change there changes the result. */
function resolveInclude(spec) {
  const m = /^([a-z][a-z0-9.-]*)#([A-Z][A-Z0-9_]*)$/.exec(String(spec));
  if (!m || !Object.prototype.hasOwnProperty.call(INCLUDE_MODULES, m[1])) throw C.inputError(`xprov scope: include ${JSON.stringify(C.clip(spec, 80))} names no allowed module`, 'scope_globs_invalid');
  const mod = require(INCLUDE_MODULES[m[1]]);
  return checkGlobList(mod[m[2]], `include ${m[1]}#${m[2]}`);
}

/** Reads xprov-scope-globs.json. Returns { categories: [{ name, globs, compiled }], docs: [{ glob, compiled }] }. */
function loadGlobs(file) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file || GLOBS_FILE, 'utf8')); } catch (e) {
    throw C.inputError(`xprov scope: the glob file is unreadable (${C.clip(e && e.message, 120)})`, 'scope_globs_invalid');
  }
  if (!C.isPlainObject(raw) || raw.version !== GLOBS_VERSION || !C.isPlainObject(raw.categories)) throw C.inputError('xprov scope: the glob file is off-schema', 'scope_globs_invalid');
  const sets = [{ name: String(raw.include_category || 'forbidden_surface'), globs: resolveInclude(raw.include) }];
  for (const [name, list] of Object.entries(raw.categories)) sets.push({ name, globs: checkGlobList(list, `category ${name}`) });
  const lower = (list) => list.map((g) => g.toLowerCase());
  return {
    categories: sets.map((s) => ({ name: s.name, entries: lower(s.globs).map((g) => ({ glob: g, compiled: compileGlob(g) })) })),
    docs: lower(checkGlobList(raw.docs, 'docs')).map((g) => ({ glob: g, compiled: compileGlob(g) })),
  };
}

// ---------- classification (pure) ----------

/** Normalized segments of a repo-relative path, or null when the path cannot be classified safely. */
function segmentsOf(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_PATH_CHARS || raw.includes('\0')) return null;
  if (ABSOLUTE_RE.test(raw)) return null;
  const segs = raw.replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.');
  if (segs.length === 0 || segs.includes('..')) return null;
  return segs.map((s) => s.toLowerCase());
}

function firstMatch(entries, segs) {
  for (const e of entries) if (matchSegments(e.compiled, segs)) return e.glob;
  return null;
}

function classifyOne(raw, globs) {
  const segs = segmentsOf(raw);
  if (segs === null) return { category: CATEGORY_UNCLASSIFIABLE, glob: null, docs: false };
  for (const c of globs.categories) {
    const glob = firstMatch(c.entries, segs);
    if (glob !== null) return { category: c.name, glob, docs: false };
  }
  return { category: null, glob: null, docs: firstMatch(globs.docs, segs) !== null };
}

/** `paths` (array of strings) → the report object. Pure given `globs` (default: loadGlobs()). */
function classifyPaths(paths, globs) {
  const set = globs || loadGlobs();
  const unique = Array.from(new Set(Array.isArray(paths) ? paths.map((p) => (typeof p === 'string' ? p : String(p))) : []));
  const matched = [];
  let docsCount = 0;
  for (const p of unique) {
    const r = classifyOne(p, set);
    if (r.category !== null) matched.push({ path: C.clip(p, MATCHED_PATH_ECHO_CHARS), category: r.category, glob: r.glob });
    else if (r.docs) docsCount += 1;
  }
  matched.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const securitySurface = matched.length > 0;
  return {
    version: OUTPUT_VERSION,
    security_surface: securitySurface,
    docs_only: !securitySurface && unique.length > 0 && docsCount === unique.length,
    total: unique.length,
    matched,
  };
}

const classify = (paths) => classifyPaths(paths, loadGlobs());

// ---------- input ----------

/** Newline-separated list (CRLF tolerated, blank lines dropped) → paths. */
function parsePathList(text) {
  const lines = String(text).split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l)).filter((l) => l !== '');
  if (lines.length > MAX_PATHS) throw C.inputError(`xprov scope: more than ${MAX_PATHS} paths`, 'scope_too_many_paths');
  return lines;
}

function readPathsFile(file) {
  const buf = C.readNoFollow(path.resolve(String(file)), MAX_PATHS_FILE_BYTES);
  if (buf === null) throw C.inputError(`xprov scope: --paths is not a readable regular file of at most ${MAX_PATHS_FILE_BYTES} bytes: ${JSON.stringify(C.clip(file, 120))}`, 'scope_paths_unreadable');
  return parsePathList(buf.toString('utf8'));
}

/** File list of base..head: argv-array git, hermetic env, renames split so both sides are seen. */
function diffPaths(repoRoot, base, head) {
  for (const [flag, rev] of [['--base', base], ['--head', head]]) {
    if (!REV_RE.test(String(rev))) throw C.inputError(`xprov scope: ${flag} must be a commit sha (4-64 hex digits) or HEAD, got ${JSON.stringify(C.clip(rev, 80))}`, 'scope_rev_invalid');
  }
  const r = C.gitSpawn(['-C', repoRoot, 'diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', base, head, '--'], { env: C.pinnedGitEnv(null) });
  if (r.status !== 0) throw C.inputError(`xprov scope: git diff ${C.clip(base, 20)} ${C.clip(head, 20)} failed: ${C.clip(r.stderr, 200)}`, 'scope_diff_failed');
  const names = r.stdout.split('\0').filter((n) => n !== '');
  if (names.length > MAX_PATHS) throw C.inputError(`xprov scope: more than ${MAX_PATHS} paths`, 'scope_too_many_paths');
  return names;
}

// ---------- CLI ----------

function cmdXprovScope(args) {
  const flags = io.parseFlags(args || [], { paths: 'string', base: 'string', head: 'string', repo: 'string' });
  if (flags._.length) return C.usageExit('scope', `unexpected argument ${JSON.stringify(C.clip(flags._[0], 80))}`);
  const hasPaths = flags.paths !== undefined;
  const hasBase = flags.base !== undefined;
  if (hasPaths === hasBase) return C.usageExit('scope', 'needs exactly one of --paths <file> or --base <sha> [--head <sha>]');
  if (flags.head !== undefined && !hasBase) return C.usageExit('scope', '--head needs --base');
  if (hasPaths && flags.repo !== undefined) return C.usageExit('scope', '--repo only goes with --base');
  let report;
  try {
    let paths;
    if (hasPaths) paths = readPathsFile(flags.paths);
    else paths = diffPaths(C.resolveRepoFlag(flags.repo), flags.base, flags.head === undefined ? 'HEAD' : flags.head);
    report = classifyPaths(paths, loadGlobs());
  } catch (e) {
    if (e && e.code === 'A1_INPUT') {
      process.stderr.write(`error: ${e.message}\n`);
      process.exitCode = xprov.EXIT_USAGE;
      return null;
    }
    throw e;
  }
  return C.emitJson(report, xprov.EXIT_PASS, true);
}

module.exports = {
  GLOBS_FILE, MAX_PATH_CHARS, CATEGORY_UNCLASSIFIABLE,
  compileGlob, loadGlobs, classifyPaths, classify, parsePathList, cmdXprovScope,
};
