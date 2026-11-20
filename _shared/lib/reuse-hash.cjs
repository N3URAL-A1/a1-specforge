'use strict';

// Input-hash reuse of three cheap consistency gates (spec 027 FR-020, plan decision D6).
// A pass is reused only when every declared input, the call arguments and the gate's own code
// (entry modules plus their local requires, two levels deep) are byte-identical to the call that passed.
// The key is an action-cache key: a plugin update that changes the gate must not reuse an old verdict.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gateLog = require('./gate-log.cjs');
const { gitSafe } = require('./git-safe.cjs');
const { emitExit } = require('./emit-exit.cjs');

const LIB_DIR = __dirname;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const CLOSURE_DEPTH = 2;
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

/** Local requires of one lib file (`./x.cjs` and `path.join(__dirname, 'x.cjs')`). */
function localRequires(file) {
  let text = '';
  try { text = fs.readFileSync(path.join(LIB_DIR, file), 'utf8'); } catch (_e) { return []; }
  return [...text.matchAll(/require\((?:'\.\/([^']+\.cjs)'|path\.join\(__dirname,\s*'([^']+\.cjs)'\))\)/g)].map((m) => m[1] || m[2]);
}

/**
 * The entry modules plus their local requires, two levels deep.
 * @param {string[]} entries
 * @returns {string[]} sorted, deduplicated file names inside `_shared/lib`
 */
function toolClosure(entries) {
  const seen = new Set();
  let layer = [...entries];
  for (let depth = 0; depth <= CLOSURE_DEPTH && layer.length; depth++) {
    const next = [];
    for (const f of layer) {
      if (seen.has(f)) continue;
      seen.add(f);
      next.push(...localRequires(f));
    }
    layer = next;
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

function treeClean(dir) {
  try { return gitSafe(dir, ['status', '--porcelain', '--untracked-files=no']) === ''; } catch (_e) { return false; }
}

/**
 * Looks for a reusable pass in the gate log of `scope`.
 * @param {{root: string, scope: string, gate: string, hash: string, requireHead: boolean, projectDir: string}} q
 * @returns {{hit: boolean, reason: string}} reason names the miss (no_log, untrusted_log, no_record, not_pass, head_moved, dirty_tree) or `pass`
 */
function lookupPass(q) {
  const file = gateLog.logPathFor(q.root, q.scope);
  let chain;
  try { chain = gateLog.verifyChain(file); } catch (_e) { return { hit: false, reason: 'no_log' }; }
  if (!chain.ok) return { hit: false, reason: 'untrusted_log' };
  let last = null;
  for (const r of chain.records) if (r.gate === q.gate && r.input_hash === q.hash) last = r;
  if (!last) return { hit: false, reason: 'no_record' };
  if (last.verdict !== 'pass') return { hit: false, reason: 'not_pass' };
  if (q.requireHead) {
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
      const args = { target: `${t.slug}/${t.feature}`, only: '9,10,11', format: 'json', roadmap: rm && rm.file ? 'file' : 'roadmap:none' };
      if (tryReuse({ gate: 'gate-4.5-fr-consistency', files, args }).reused) return undefined;
    } catch (_e) { /* any read problem: the gate runs */ }
  }
  return runner(rest);
}

module.exports = { TOOLS, ReuseMiss, toolClosure, computeHash, lookupPass, tryReuse, setPostRunHash, checklistRunWithReuse };
