'use strict';

// Input-hash reuse of three cheap consistency gates (spec 027 FR-020, plan decision D6).
// A pass is reused only when every declared input, the call arguments and the gate's own code
// (entry modules plus the whole closure of their local requires) are byte-identical to the call that passed.
// The key is an action-cache key: a plugin update that changes the gate must not reuse an old verdict.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gateLog = require('./gate-log.cjs');
const { gitSafe } = require('./git-safe.cjs');
const { emitExit } = require('./emit-exit.cjs');

const LIB_DIR = __dirname;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const SAFE_SEG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const HEX40_RE = /^[0-9a-f]{40}$/;

/** Entry modules whose code is part of the key, per gate id. */
const TOOLS = Object.freeze({
  'gate-4.5-fr-consistency': Object.freeze(['checklist.cjs', 'check.cjs']),
  'lane-split': Object.freeze(['lane-split.cjs']),
  'fix-class-sweep': Object.freeze(['fix-class-sweep.cjs']),
});

class ReuseMiss extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Local requires of one lib file (`./x.cjs` in single or double quotes, and `path.join(__dirname, 'x.cjs')`). */
function localRequires(file) {
  let text = '';
  try { text = fs.readFileSync(path.join(LIB_DIR, file), 'utf8'); } catch (_e) { return []; }
  const re = /require\(\s*(?:(['"])\.\/([^'"]+\.cjs)\1|path\.join\(\s*__dirname\s*,\s*(['"])([^'"]+\.cjs)\3\s*\))\s*\)/g;
  return [...text.matchAll(re)].map((m) => m[2] || m[4]);
}

/**
 * The entry modules plus every local require reachable from them (visited set, no depth bound):
 * an edit of any module the gate can load changes the key.
 * @param {string[]} entries
 * @returns {string[]} sorted, deduplicated file names inside `_shared/lib`
 */
function toolClosure(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    queue.push(...localRequires(f));
  }
  return [...seen].sort();
}

function toolDigests(gate) {
  const entries = TOOLS[gate];
  if (!entries) throw new ReuseMiss('unknown_gate');
  return toolClosure(entries).map((f) => {
    try { return [f, sha256(fs.readFileSync(path.join(LIB_DIR, f)))]; } catch (_e) { return [f, 'missing']; }
  });
}

function readInput(p) {
  let st;
  try { st = fs.statSync(p); } catch (_e) { throw new ReuseMiss('input_missing'); }
  if (!st.isFile()) throw new ReuseMiss('input_missing');
  if (st.size > MAX_INPUT_BYTES) throw new ReuseMiss('input_too_large');
  return fs.readFileSync(p);
}

/**
 * @param {{gate: string, files: {label: string, path: string}[], args: Object}} spec
 * @returns {{hash: string}} sha256 over version, gate, tool digests, call args and input digests
 * @throws {ReuseMiss} input_missing, input_too_large or unknown_gate
 */
function computeHash(spec) {
  const files = spec.files.map((f) => [f.label, sha256(readInput(f.path))]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const key = JSON.stringify({ v: 1, gate: spec.gate, tool: toolDigests(spec.gate), args: spec.args, files });
  return { hash: sha256(key) };
}

function headOf(dir) {
  try {
    const h = gitSafe(dir, ['rev-parse', 'HEAD']);
    return HEX40_RE.test(h) ? h : null;
  } catch (_e) { return null; }
}

/**
 * True only when `git status` shows nothing: no tracked change and no untracked, non-ignored file.
 * The three gates read untracked files too (class-sweep scans `ls-files -o`, lane-split reads lane paths from disk),
 * so an untracked file is an input the head sha does not cover. The gate log itself is excluded by gate-log.cjs.
 */
function treeClean(dir) {
  try { return gitSafe(dir, ['status', '--porcelain', '--untracked-files=all']) === ''; } catch (_e) { return false; }
}

/** True when `dir` lies in the work tree whose log is read: the head and the log must come from one repository. */
function sameRepo(root, dir) {
  try {
    const ctx = gateLog.gitContext(dir);
    return Boolean(ctx) && fs.realpathSync(ctx.root) === fs.realpathSync(root);
  } catch (_e) { return false; }
}

/**
 * Looks for a reusable pass in the gate log of `scope`.
 * @param {{root: string, scope: string, gate: string, hash: string, requireHead: boolean, projectDir: string}} q
 * @returns {{hit: boolean, reason: string}} reason names the miss (no_log, untrusted_log (tracked, symlinked, oversized or broken chain), root_mismatch, no_record, not_pass, head_moved, dirty_tree) or `pass`
 */
function lookupPass(q) {
  const trusted = gateLog.readTrustedChain(q.root, q.scope);
  if (!trusted.ok) return { hit: false, reason: trusted.reason };
  const chain = trusted.chain;
  let last = null;
  for (const r of chain.records) if (r.gate === q.gate && r.input_hash === q.hash) last = r;
  if (!last) return { hit: false, reason: 'no_record' };
  if (last.verdict !== 'pass') return { hit: false, reason: 'not_pass' };
  if (q.requireHead) {
    if (!sameRepo(q.root, q.projectDir)) return { hit: false, reason: 'root_mismatch' };
    if (last.head_sha !== headOf(q.projectDir)) return { hit: false, reason: 'head_moved' };
    if (!treeClean(q.projectDir)) return { hit: false, reason: 'dirty_tree' };
  }
  return { hit: true, reason: 'pass' };
}

/** The log root the hook itself writes to for this call. */
function hookRoot() {
  const ctx = gateLog.gitContext(gateLog.projectDirOf(process.argv.slice(2)));
  return ctx ? ctx.root : null;
}

/**
 * Hit: records `reused`, writes the reuse lines and exits 0 without running the gate. Miss: hands the hash to the hook.
 * @param {{gate: string, files: {label: string, path: string}[], args: Object, requireHead?: boolean, projectDir?: string, out?: Object}} c
 * @returns {{reused: boolean, hash: string|null, reason: string}}
 */
function tryReuse(c) {
  const scope = gateLog.currentScope();
  let hash = null;
  try { hash = computeHash(c).hash; } catch (e) {
    return { reused: false, hash: null, reason: e instanceof ReuseMiss ? e.reason : 'hash_error' };
  }
  if (!scope) return { reused: false, hash, reason: 'no_scope' };
  const root = hookRoot();
  const found = root
    ? lookupPass({ root, scope, gate: c.gate, hash, requireHead: Boolean(c.requireHead), projectDir: c.projectDir || process.cwd() })
    : { hit: false, reason: 'no_repo' };
  if (!found.hit) {
    gateLog.setRecordExtra({ input_hash: hash });
    return { reused: false, hash, reason: found.reason };
  }
  gateLog.setRecordExtra({ input_hash: hash, reused: true });
  const body = { ok: true, reused: true, gate: c.gate, input_hash: hash, ...(c.out || {}) };
  emitExit(0, `${JSON.stringify(body)}\n`, `reused: ${c.gate} @ ${hash}\n`);
  return { reused: true, hash, reason: 'pass' };
}

/**
 * class-sweep rewrites its own input, so the key of the NEXT identical call is the hash of the file as written:
 * computed after the run.
 * @param {{gate: string, files: {label: string, path: string}[], args: Object}} c
 * @returns {string|null} the hash handed to the hook, or null when an input is unreadable
 */
function setPostRunHash(c) {
  try {
    const { hash } = computeHash(c);
    gateLog.setRecordExtra({ input_hash: hash });
    return hash;
  } catch (_e) { return null; }
}

// ---- gate 4.5: `checklist run <slug>/<feature> --only 9,10,11` ----

/** @returns {{slug: string, feature: string}|null} */
function splitTarget(target) {
  const parts = String(target || '').split('/');
  if (parts.length !== 2 || !parts.every((p) => SAFE_SEG_RE.test(p) && !p.includes('..'))) return null;
  return { slug: parts[0], feature: parts[1] };
}

/** Strict parse of the reusable call shape; anything else (--save, --vault, other flags) is not reusable. */
function parseChecklistCall(rest) {
  const t = splitTarget(rest[0]);
  if (!t) return null;
  let only = null;
  let format = 'json';
  for (let i = 1; i < rest.length; i++) {
    if (rest[i] === '--only' && typeof rest[i + 1] === 'string') only = rest[++i];
    else if (rest[i] === '--format' && typeof rest[i + 1] === 'string') format = rest[++i];
    else return null;
  }
  const set = only === null ? [] : [...new Set(only.split(',').map((s) => s.trim()))].sort();
  if (set.join(',') !== '10,11,9' || format !== 'json') return null;
  return t;
}

/**
 * Check 11 reads the spec a roadmap entry's `spec_path` names. When that resolves to a file other than the hashed
 * spec, the file is an input the key does not cover: the call is not reusable (m2).
 * @throws {ReuseMiss} spec_path_elsewhere
 */
function assertSpecIsHashed(rm, t, specPath, vaultRoot) {
  const feats = rm && rm.fm && Array.isArray(rm.fm.features) ? rm.fm.features : [];
  const entry = feats.find((f) => f && f.id === t.feature);
  if (!entry || typeof entry.spec_path !== 'string' || entry.spec_path.trim() === '') return;
  const res = require('./spec-coherence.cjs').resolveSpecFile(entry, vaultRoot, t.slug);
  let hashed = null;
  try { hashed = fs.realpathSync(specPath); } catch (_e) { /* compared as null below */ }
  if (!res.abs || res.abs !== hashed) throw new ReuseMiss('spec_path_elsewhere');
}

/**
 * Facade entry of `checklist run`: reuses a gate-4.5 pass or calls `runner(rest)` unchanged.
 * Inputs are the spec, the wave plan and the roadmap check 11 reads (never looser than FR-020).
 * @param {string[]} rest @param {function(string[]): *} runner the real `cmdChecklistRun`
 * @returns {*} whatever `runner` returns, or undefined after a reuse
 */
function checklistRunWithReuse(rest, runner) {
  const t = parseChecklistCall(rest);
  if (t) {
    try {
      const io = require('./io.cjs');
      const spec = io.projectsPath(t.slug, 'spec', `${t.feature}.md`);
      const plan = io.projectsPath(t.slug, 'plans', `${t.feature}-wave-plan.md`);
      const rm = require('./spec-coherence.cjs').findProjectRoadmap(t.slug, { vaultRoot: io.vaultRoot(), quiet: true });
      const files = [{ label: 'spec', path: spec }, { label: 'wave-plan', path: plan }];
      if (rm && rm.file) files.push({ label: 'roadmap', path: rm.file });
      assertSpecIsHashed(rm, t, spec, io.vaultRoot());
      const args = { target: `${t.slug}/${t.feature}`, only: '9,10,11', format: 'json', roadmap: rm && rm.file ? 'file' : 'roadmap:none' };
      if (tryReuse({ gate: 'gate-4.5-fr-consistency', files, args }).reused) return undefined;
    } catch (e) {
      // any read problem: the gate runs; a plain miss or a missing file stays silent, anything else is named
      if (!(e instanceof ReuseMiss) && !(e && e.code === 'ENOENT')) process.stderr.write(`reuse check failed: ${e && e.message ? e.message : e}\n`);
    }
  }
  return runner(rest);
}

module.exports = { TOOLS, ReuseMiss, toolClosure, computeHash, lookupPass, tryReuse, setPostRunHash, checklistRunWithReuse };
