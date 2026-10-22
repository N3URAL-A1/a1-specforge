'use strict';

// ---------------------------------------------------------------------------
// fix class-sweep — spec 017 FR-027..FR-031. The bug report's `class_query` is hostile input:
// it runs as an argv array (no shell, minimal env), under one deadline, with capped output.
//   a1-tools fix class-sweep --record <bug> [--project <dir>]
//   a1-tools fix class-sweep --verify <bug> [--project <dir>] [--guard <fingerprint>=<test-file>]... [--diff-base <ref>]
// Exit 0 ok / 1 refusal (JSON on stdout: ok:false, reason) / 2 usage, missing engine, timeout, git or
// disposition-file failure (stderr, no stdout). `statusGate` is the hook of `fix update-status`.
//
// Frontmatter is the FLAT parser, so the query is a list (the only round-trip-stable value shape):
//   class_query:  [- pattern: <regex>, - glob: <path glob>, - engine: rg | grep -E]   root_site: <file>:<line>
// A match is { file, line, fingerprint }; fingerprint = class-sweep:<file>:<hash of the normalised line>.
// A match is cleared when it is `guarded` (a test file that exists and is in the fix diff, named with
// --guard) or `accepted` (a class_sweep disposition, FR-025); `fixed` = the fingerprint is gone.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { readMd, writeMdAtomic, resolveVaultPath } = require('./io.cjs');
const { ENFORCED_SINCE } = require('./enforced-since.cjs');
const D = require('./disposition-store.cjs');

const MAX_MATCHES = 50; // FR-031: a code constant, not a flag
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_OUT_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 20000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const CHUNK = 200;
const MAX_PATTERN = 500;
const MAX_GLOB = 200;
const MAX_STARS = 8;
const MAX_DOUBLE_STARS = 3;
const GIT_TIMEOUT_MS = 20000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const GATED = Object.freeze(['diagnosed', 'fixing', 'fixed']);
const RULE = 'class-sweep';
const ENGINES = Object.freeze({
  rg: ['rg', ['--no-config', '--null', '-n', '-H', '--no-heading', '--color', 'never']],
  'grep -E': ['grep', ['-E', '-n', '-H', '-I', '--null', '--color=never']],
});

class SweepError extends Error {
  /** @param {'refuse'|'internal'} kind */
  constructor(kind, reason, message, extra) { super(message || reason); this.kind = kind; this.reason = reason; this.extra = extra || {}; }
}
const refuse = (reason, message, extra) => new SweepError('refuse', reason, message, extra);
const internal = (message) => new SweepError('internal', 'internal', message);

// ---------- query (from the bug report) ----------

function listField(list, key) {
  if (!Array.isArray(list)) return undefined;
  const hit = list.find((x) => typeof x === 'string' && x.startsWith(`${key}: `));
  return hit === undefined ? undefined : hit.slice(key.length + 2);
}

function globProblem(g) {
  if (typeof g !== 'string' || g === '' || g.length > MAX_GLOB) return true;
  if (/[\u0000-\u001f\u007f]/.test(g) || g.startsWith('/') || g.split('/').some((s) => s === '..')) return true;
  return (g.match(/\*\*/g) || []).length > MAX_DOUBLE_STARS || (g.match(/\*/g) || []).length > MAX_STARS;
}

function parseRootSite(v) {
  const m = typeof v === 'string' ? /^(.+):([1-9]\d{0,8})$/.exec(v) : null;
  return m && D.isSafeFile(m[1]) ? { file: m[1], line: Number(m[2]) } : null;
}

/** { ok:true, query, root } or { ok:false, problems:[field…] }. */
function readQuery(fm) {
  const pattern = listField(fm.class_query, 'pattern');
  const glob = listField(fm.class_query, 'glob');
  const engine = listField(fm.class_query, 'engine');
  const root = parseRootSite(fm.root_site);
  const problems = [];
  if (typeof pattern !== 'string' || pattern === '' || pattern.length > MAX_PATTERN || /[\0\r\n]/.test(pattern)) problems.push('class_query.pattern');
  if (globProblem(glob)) problems.push('class_query.glob');
  if (!Object.prototype.hasOwnProperty.call(ENGINES, engine)) problems.push('class_query.engine');
  if (root === null) problems.push('root_site');
  return problems.length > 0 ? { ok: false, problems } : { ok: true, query: { pattern, glob, engine }, root };
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] !== '*') re += '[^/]*';
      else { i++; if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; }
    } else re += c === '?' ? '[^/]' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 's');
}

// ---------- git + search ----------

function git(project, args) {
  const r = spawnSync('git', ['-C', project, ...args], { shell: false, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error || r.status !== 0) throw internal(`git ${args[0]} failed in ${project}: ${r.error ? r.error.message : String(r.stderr).slice(0, 160)}`);
  return r.stdout.toString('utf8');
}

function isPlainFile(project, rel) {
  try { const st = fs.lstatSync(path.join(project, rel)); return st.isFile() && st.size <= MAX_FILE_BYTES; } catch (_e) { return false; }
}

function listFiles(project, glob) {
  const re = globToRegExp(glob);
  const files = git(project, ['ls-files', '-z', '-c', '-o', '--exclude-standard']).split('\0')
    .filter((n) => n !== '' && re.test(n) && isPlainFile(project, n));
  if (files.length > MAX_FILES) throw internal(`glob matches more than ${MAX_FILES} files`);
  return files;
}

function parseOutput(buf, fileSet) {
  const s = buf.toString('utf8');
  const out = [];
  let pos = 0;
  while (pos < s.length) {
    const nul = s.indexOf('\0', pos);
    let nl = s.indexOf('\n', nul + 1);
    if (nl < 0) nl = s.length;
    const m = nul < 0 ? null : /^(\d+)[:-]([\s\S]*)$/.exec(s.slice(nul + 1, nl));
    const file = nul < 0 ? '' : s.slice(pos, nul);
    if (!m || !fileSet.has(file)) throw internal('unparseable engine output');
    out.push({ file, line: Number(m[1]), text: m[2].replace(/\r$/, '') });
    pos = nl + 1;
  }
  return out;
}

function timeoutMs() {
  const v = Number(process.env.A1_CLASS_SWEEP_TIMEOUT_MS); // test knob: can only shorten the deadline
  return Number.isInteger(v) && v > 0 && v < DEFAULT_TIMEOUT_MS ? v : DEFAULT_TIMEOUT_MS;
}

function runEngine(query, files, project) {
  const [bin, base] = ENGINES[query.engine];
  const deadline = Date.now() + timeoutMs();
  const fileSet = new Set(files);
  const found = [];
  for (let i = 0; i < files.length && found.length <= MAX_MATCHES; i += CHUNK) {
    const left = deadline - Date.now();
    if (left <= 0) throw internal(`class_query timed out after ${timeoutMs()} ms`);
    const r = spawnSync(bin, [...base, '-e', query.pattern, '--', ...files.slice(i, i + CHUNK)], {
      cwd: project, shell: false, timeout: left, killSignal: 'SIGKILL', maxBuffer: MAX_OUT_BYTES,
      env: { PATH: process.env.PATH || '', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (r.error && r.error.code === 'ENOBUFS') throw refuse('query_too_broad', `class_query output exceeds ${MAX_OUT_BYTES} bytes`, { max: MAX_MATCHES });
    if (r.error && r.error.code === 'ENOENT') throw internal(`engine "${query.engine}" not found (binary ${bin} is not on PATH)`);
    if (r.error) throw internal(`class_query timed out after ${timeoutMs()} ms (${r.error.code || r.error.message})`);
    if (r.status === 1 && r.stdout.length === 0) continue;
    if (r.status !== 0 && r.status !== 1) throw internal(`engine "${query.engine}" exited ${r.status}: ${String(r.stderr).slice(0, 160)}`);
    found.push(...parseOutput(r.stdout, fileSet));
  }
  return found;
}

function fingerprintFor(file, text) {
  const safe = D.isSafeFile(file) ? file : `unsafe-path-${crypto.createHash('sha256').update(file).digest('hex').slice(0, 8)}`;
  return D.fingerprintOf(RULE, safe, text);
}

/** Sorted, de-duplicated matches [{ file, line, fingerprint }] (at most MAX_MATCHES + 1 are collected). */
function sweep(project, query) {
  const seen = new Set();
  const matches = runEngine(query, listFiles(project, query.glob), project)
    .filter((h) => !seen.has(`${h.file}\0${h.line}`) && seen.add(`${h.file}\0${h.line}`))
    .map((h) => ({ file: h.file, line: h.line, fingerprint: fingerprintFor(h.file, h.text) }));
  return matches.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
}

/** Files changed since `base` (committed, staged, unstaged) plus untracked ones. */
function changedFiles(project, base) {
  if (typeof base !== 'string' || base === '' || base.startsWith('-') || /[\0\s]/.test(base)) return new Set();
  const diff = git(project, ['diff', '--name-only', '-z', base, '--']).split('\0');
  const fresh = git(project, ['ls-files', '-z', '-o', '--exclude-standard']).split('\0');
  return new Set([...diff, ...fresh].filter((n) => n !== ''));
}

// ---------- stored state (flat frontmatter lists of JSON items) ----------

function decodeList(list, key) {
  if (list === undefined || list === null) return null;
  try { return list.map((s) => JSON.parse(s)); } catch (_e) { throw internal(`${key} in the bug file is not valid`); }
}

function withSweep(fm, patch) {
  const base = Object.fromEntries(Object.entries(fm).filter(([k]) => !(k in patch) || patch[k] !== undefined));
  const set = Object.entries(patch).filter(([, v]) => v !== undefined).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => JSON.stringify(x)) : v]);
  return { ...base, ...Object.fromEntries(set) };
}

function guardOk(project, changed, test) {
  return D.isSafeFile(test) && isPlainFile(project, test) && changed.has(test);
}

/** Splits `after` into { open, guarded, accepted } using stored guards, dispositions and the fix diff. */
function classify(project, fm, after, base) {
  const guards = new Map((decodeList(fm.class_sweep_guards, 'class_sweep_guards') || []).map((g) => [g.fingerprint, g.test]));
  const cleared = D.clearedFingerprints(D.loadEntries(project), 'class_sweep');
  const changed = changedFiles(project, base);
  const res = { open: [], guarded: [], accepted: [] };
  for (const m of after) {
    if (guards.has(m.fingerprint) && guardOk(project, changed, guards.get(m.fingerprint))) res.guarded.push(m);
    else if (cleared.has(m.fingerprint)) res.accepted.push(m);
    else res.open.push(m);
  }
  return res;
}

// ---------- record / verify ----------

function requireQuery(fm) {
  const q = readQuery(fm);
  if (!q.ok) throw refuse('class_query_missing', `bug report lacks a valid ${q.problems.join(', ')}`, { problems: q.problems });
  return q;
}

function recompute(project, query) {
  const matches = sweep(project, query);
  if (matches.length > MAX_MATCHES) throw refuse('query_too_broad', `class_query yields more than ${MAX_MATCHES} matches in its glob scope`, { max: MAX_MATCHES });
  return matches;
}

function doRecord(bugPath, project) {
  const { fm, body } = readMd(bugPath);
  const q = requireQuery(fm);
  const matches = recompute(project, q.query);
  if (!matches.some((m) => m.file === q.root.file && m.line === q.root.line)) {
    throw refuse('root_site_not_matched', `class_query does not match root_site ${q.root.file}:${q.root.line}`, { count: matches.length });
  }
  let base = null;
  try { base = git(project, ['rev-parse', 'HEAD']).trim(); } catch (_e) { base = null; }
  writeMdAtomic(bugPath, withSweep(fm, { class_sweep_base: base, class_sweep_at_diagnosis: matches, class_sweep_after_fix: undefined, class_sweep_guards: undefined }), body);
  return { ok: true, action: 'record', count: matches.length, base };
}

function checkGuard(project, spec, after, changed) {
  const eq = spec.indexOf('=');
  const fingerprint = eq < 0 ? '' : spec.slice(0, eq);
  const test = eq < 0 ? '' : spec.slice(eq + 1);
  try { D.checkFingerprint('class_sweep', fingerprint); } catch (_e) { throw refuse('guard_invalid', `--guard needs <class-sweep fingerprint>=<test-file>: ${JSON.stringify(spec.slice(0, 80))}`); }
  if (!after.some((m) => m.fingerprint === fingerprint)) throw refuse('guard_unknown_match', `no current match has fingerprint ${fingerprint}`);
  if (!guardOk(project, changed, test)) throw refuse('guard_invalid', `guard test file ${JSON.stringify(test.slice(0, 120))} must exist in the repo and be added or modified in the fix diff`);
  return { fingerprint, test };
}

function doVerify(bugPath, project, guardSpecs, diffBase) {
  const { fm, body } = readMd(bugPath);
  const q = requireQuery(fm);
  if (decodeList(fm.class_sweep_at_diagnosis, 'class_sweep_at_diagnosis') === null) throw refuse('class_sweep_not_recorded', 'run `fix class-sweep --record` at diagnosis first');
  const base = diffBase || fm.class_sweep_base || null;
  const after = recompute(project, q.query);
  const changed = changedFiles(project, base);
  const given = guardSpecs.map((s) => checkGuard(project, s, after, changed));
  const stored = (decodeList(fm.class_sweep_guards, 'class_sweep_guards') || []).filter((g) => !given.some((n) => n.fingerprint === g.fingerprint));
  const next = withSweep(fm, { class_sweep_after_fix: after, class_sweep_guards: [...stored, ...given] });
  writeMdAtomic(bugPath, next, body);
  const res = classify(project, next, after, base);
  const counts = { total: after.length, open: res.open.length, guarded: res.guarded.length, accepted: res.accepted.length };
  if (res.open.length > 0) throw refuse('class_sweep_open', `${res.open.length} match(es) without guarded/accepted disposition`, { counts, open: res.open });
  return { ok: true, action: 'verify', counts };
}

// ---------- hook of `fix update-status` ----------

function dayOf(fm, bugPath) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(typeof fm.reported_at === 'string' ? fm.reported_at : path.basename(bugPath));
  return m ? m[1] : null;
}

function checkFixed(fm, q, project) {
  if (decodeList(fm.class_sweep_at_diagnosis, 'class_sweep_at_diagnosis') === null) throw refuse('class_sweep_open', 'no class_sweep.at_diagnosis recorded - run `fix class-sweep --record`, then `--verify`');
  const res = classify(project, fm, recompute(project, q.query), fm.class_sweep_base || null);
  if (res.open.length > 0) throw refuse('class_sweep_open', `${res.open.length} match(es) without guarded/accepted disposition`, { open: res.open });
}

/** null = allowed; else { exit, body } for the caller to print. `flags['enforced-since']` can only move the date earlier. */
function statusGate(fm, newStatus, bugPath, flags) {
  if (!GATED.includes(newStatus)) return null;
  const override = flags && /^\d{4}-\d{2}-\d{2}$/.test(flags['enforced-since'] || '') ? flags['enforced-since'] : null;
  const since = override !== null && override < ENFORCED_SINCE ? override : ENFORCED_SINCE;
  const day = dayOf(fm, bugPath);
  if (day !== null && day < since) return null; // legacy bug file (FR-027)
  try {
    const q = requireQuery(fm);
    if (newStatus === 'fixed') checkFixed(fm, q, path.resolve((flags && flags.project) || process.cwd()));
    return null;
  } catch (e) {
    if (!(e instanceof SweepError || e instanceof D.DispositionError)) throw e;
    if (e.kind === 'refuse') return { exit: 1, body: { ok: false, reason: e.reason, message: e.message, ...e.extra } };
    return { exit: 2, body: { ok: false, reason: 'class_sweep_error', message: e.message } };
  }
}

// ---------- CLI ----------

function parseArgs(rest) {
  const o = { mode: null, bug: null, project: process.cwd(), guards: [], diffBase: null };
  const val = (i, name) => {
    if (typeof rest[i + 1] !== 'string' || rest[i + 1] === '' || rest[i + 1].includes('\0')) throw internal(`${name} needs a value`);
    return rest[i + 1];
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--record' || a === '--verify') { if (o.mode) throw internal('use exactly one of --record / --verify'); o.mode = a.slice(2); }
    else if (a === '--project') o.project = val(i++, a);
    else if (a === '--guard') o.guards.push(val(i++, a));
    else if (a === '--diff-base') o.diffBase = val(i++, a);
    else if (a.startsWith('--') || o.bug !== null) throw internal(`unexpected argument ${JSON.stringify(a.slice(0, 60))}`);
    else o.bug = a;
  }
  if (!o.mode || !o.bug) throw internal('need --record or --verify and a <bug-path>');
  return { ...o, project: path.resolve(o.project) };
}

function emit(body, code) {
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
  process.exitCode = code;
}

/** @param {string|undefined} _sub @param {string[]} rest */
function cmdFixClassSweep(_sub, rest) {
  try {
    const o = parseArgs(rest);
    const bugPath = resolveVaultPath(o.bug);
    if (!fs.existsSync(bugPath)) throw internal(`bug file not found: ${bugPath}`);
    emit(o.mode === 'record' ? doRecord(bugPath, o.project) : doVerify(bugPath, o.project, o.guards, o.diffBase), 0);
  } catch (e) {
    if (e instanceof SweepError && e.kind === 'refuse') return emit({ ok: false, reason: e.reason, message: e.message, ...e.extra }, 1);
    process.stderr.write(`fix class-sweep: ${e && e.message ? e.message : String(e)}\n`);
    process.exitCode = 2;
    return undefined;
  }
  return undefined;
}

module.exports = { cmdFixClassSweep, statusGate, readQuery, MAX_MATCHES };
