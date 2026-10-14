'use strict';

// ---------------------------------------------------------------------------
// xprov-consent-marker — the pending marker and the pending-yes of a consent question (spec 016 FR-003, FR-005; wave 2).
//
//   <owner home>/.a1-xprov/consent-markers/<sha256(repo key NUL kind)>.json   (dir 0700, file 0600)
//     { version, repo, kind, hash, nonce, tool_use_id, session_id, created, used, answer }
//
// Lifecycle: the plugin hook (wave 4) calls `openMarker` on PreToolUse of a canonical question; on PostToolUse it calls
// `answerMarker` with the decision read from the real answer; `xprov consent record` calls `claimMarker`, which checks
// the binding and marks the marker used, once. Facts enforced here:
//   - one unexpired marker per repo + kind (the file name IS the key; a second asker gets `marker_pending` and polls
//     `xprov consent ensure` instead of asking again);
//   - 10 minutes from creation, usable once;
//   - bound to repo key, kind, question hash, nonce and the tool_use_id + session_id of the PreToolUse call; the answer
//     must carry the same ids and nonce (a copied marker names another repo, so it fails the repo check);
//   - every mutation runs under the audit lock (one writer at a time); create uses `wx`, replace is rename.
// Tier 0: the same OS user can write these files by hand. The marker keeps a forgery from needing no effort; it does not
// prevent one, and the audit chain shows the consent line that `record` appends.
// Request-scoped: clock, paths and ids are parameters; no module-global state.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const OH = require('./xprov-owner-home.cjs');
const AU = require('./xprov-audit.cjs');
const Q = require('./xprov-consent-question.cjs');

const MARKER_DIR = 'consent-markers';
const TTL_MS = 10 * 60 * 1000;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const ID_MAX_CHARS = 200;
const MAX_SCAN_FILES = 200;
const STATE = Object.freeze({ NONE: 'none', PENDING: 'pending', ANSWERED: 'answered', EXPIRED: 'expired', USED: 'used' });
const MARKER_KEYS = Object.freeze(['version', 'repo', 'kind', 'hash', 'nonce', 'tool_use_id', 'session_id', 'created', 'used', 'answer']);
const ANSWER_KEYS = Object.freeze(['decision', 'label', 'nonce', 'tool_use_id', 'session_id', 'permission_mode', 'at']);
const SHA_RE = /^[0-9a-f]{64}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;
const BAD_ID_RE = /[\u0000-\u001f\u007f-\u009f\u{2028}\u{2029}\p{Cf}]/u;

const markerDir = () => path.join(X.xprovHome(), MARKER_DIR);
const markerId = (repo, kind) => crypto.createHash('sha256').update(`${repo}\0${kind}`).digest('hex');
const markerFile = (repo, kind) => path.join(markerDir(), `${markerId(repo, kind)}.json`);
const nowMs = (now) => (now === undefined ? Date.now() : Date.parse(now));
const nowIso = (now) => now || new Date().toISOString();
const plainId = (v) => typeof v === 'string' && v !== '' && v.length <= ID_MAX_CHARS && !BAD_ID_RE.test(v);
const nullableId = (v) => v === null || plainId(v);

function validAnswer(a) {
  return a === null || (C.isPlainObject(a) && Object.keys(a).length === ANSWER_KEYS.length && ANSWER_KEYS.every((k) => k in a)
    && (a.decision === 'yes' || a.decision === 'no') && plainId(a.label) && NONCE_RE.test(a.nonce) && plainId(a.tool_use_id) && plainId(a.session_id)
    && nullableId(a.permission_mode) && typeof a.at === 'string' && !Number.isNaN(Date.parse(a.at)));
}

function parseMarker(doc) {
  if (!C.isPlainObject(doc) || Object.keys(doc).length !== MARKER_KEYS.length || !MARKER_KEYS.every((k) => k in doc) || doc.version !== 1) return null;
  const ok = plainId(doc.repo) && Q.kindDef(doc.kind) !== null && SHA_RE.test(doc.hash) && NONCE_RE.test(doc.nonce) && plainId(doc.tool_use_id) && plainId(doc.session_id)
    && typeof doc.created === 'string' && !Number.isNaN(Date.parse(doc.created)) && (doc.used === null || (typeof doc.used === 'string' && !Number.isNaN(Date.parse(doc.used)))) && validAnswer(doc.answer);
  return ok ? Object.freeze({ ...doc }) : null;
}

/** NONE | PENDING | ANSWERED | EXPIRED | USED for a parsed marker at `now` (a used marker stays USED; expiry is checked next). */
function stateOf(marker, now) {
  if (marker === null || marker === undefined) return STATE.NONE;
  if (marker.used !== null) return STATE.USED;
  if (nowMs(now) - Date.parse(marker.created) > TTL_MS) return STATE.EXPIRED;
  return marker.answer === null ? STATE.PENDING : STATE.ANSWERED;
}

/** The directory, created 0700 when missing; refuses a symlink or a non-directory. */
function ensureDir() {
  OH.assertWritable();
  const home = X.xprovHome();
  const dirs = [home, markerDir()];
  for (const d of dirs) {
    try { fs.mkdirSync(d, { mode: DIR_MODE }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const st = fs.lstatSync(d);
    if (st.isSymbolicLink() || !st.isDirectory()) throw C.inputError(`${d} is not a real directory; refusing to write a consent marker`, 'marker_dir');
    fs.chmodSync(d, DIR_MODE);
  }
  return home;
}

/** { marker } | { missing: true } | { bad: why } — read without following a symlink, parsed strictly. */
function readFile(file) {
  const guarded = require('./xprov-allowlist.cjs').readGuardedStore(file, 'consent marker', (doc) => parseMarker(doc));
  if (guarded.ok) return { marker: guarded.value };
  return guarded.missing && guarded.why === 'no consent marker yet' ? { missing: true } : { bad: guarded.why };
}

function writeAtomic(file, doc, exclusive) {
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  if (exclusive) {
    const fd = fs.openSync(file, 'wx', FILE_MODE);
    try { fs.fchmodSync(fd, FILE_MODE); fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return;
  }
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'wx', FILE_MODE);
  try { fs.fchmodSync(fd, FILE_MODE); fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

/** Creates the marker of a question. { ok: true, marker } or { ok: false, reason, state, hint } (marker_pending: poll `consent ensure`). */
function openMarker(o) {
  if (!o || typeof o.repo !== 'string' || o.repo === '') throw C.inputError('marker: repo is required', 'marker_input');
  if (Q.kindDef(o.kind) === null) throw C.inputError('marker: unknown question kind', 'marker_input');
  if (!SHA_RE.test(String(o.hash)) || !plainId(o.toolUseId) || !plainId(o.sessionId)) throw C.inputError('marker: hash, tool_use_id and session_id are required plain values', 'marker_input');
  const home = ensureDir();
  const file = markerFile(o.repo, o.kind);
  return AU.withLock(home, () => {
    const existing = readFile(file);
    const state = existing.marker ? stateOf(existing.marker, o.now) : STATE.NONE;
    if (state === STATE.PENDING || state === STATE.ANSWERED) {
      return Object.freeze({ ok: false, reason: 'marker_pending', state, hint: `a ${o.kind} question is already open for this repository; poll \`xprov consent ensure --kind ${o.kind}\` instead of asking again` });
    }
    const marker = Object.freeze({
      version: 1, repo: o.repo, kind: o.kind, hash: o.hash, nonce: crypto.randomBytes(16).toString('hex'),
      tool_use_id: o.toolUseId, session_id: o.sessionId, created: nowIso(o.now), used: null, answer: null,
    });
    writeAtomic(file, marker, existing.missing === true);
    return Object.freeze({ ok: true, marker });
  });
}

/** The marker of repo + kind: { state, marker? , why? }. Never throws on a missing or unusable file. */
function peekMarker(repo, kind, now) {
  const r = readFile(markerFile(repo, kind));
  if (r.marker) return { state: stateOf(r.marker, now), marker: r.marker };
  return r.missing ? { state: STATE.NONE } : { state: STATE.NONE, why: r.bad };
}

/** Sets the answer of the PENDING marker that PreToolUse opened for this tool_use_id + session_id (the PostToolUse hook). */
function answerMarker(o) {
  if (!o || !plainId(o.toolUseId) || !plainId(o.sessionId)) return Object.freeze({ ok: false, reason: 'no_marker' });
  if (o.decision !== 'yes' && o.decision !== 'no') return Object.freeze({ ok: false, reason: 'no_decision' });
  const home = ensureDir();
  return AU.withLock(home, () => {
    const dir = markerDir();
    const names = fs.readdirSync(dir).filter((n) => /^[0-9a-f]{64}\.json$/.test(n)).slice(0, MAX_SCAN_FILES);
    for (const name of names) {
      const r = readFile(path.join(dir, name));
      const m = r.marker;
      if (!m || m.tool_use_id !== o.toolUseId || m.session_id !== o.sessionId) continue;
      if (stateOf(m, o.now) !== STATE.PENDING) return Object.freeze({ ok: false, reason: 'marker_not_pending', state: stateOf(m, o.now) });
      const label = Q.kindDef(m.kind).labels[o.decision];
      const answer = { decision: o.decision, label, nonce: m.nonce, tool_use_id: m.tool_use_id, session_id: m.session_id, permission_mode: plainId(o.permissionMode) ? o.permissionMode : null, at: nowIso(o.now) };
      writeAtomic(path.join(dir, name), { ...m, answer }, false);
      return Object.freeze({ ok: true, decision: o.decision });
    }
    return Object.freeze({ ok: false, reason: 'no_marker' });
  });
}

/** The reason `marker` cannot be used to record `kind` for `repo` with question `hash` at `now`, or null. */
function refusalFor(marker, state, want) {
  if (state === STATE.NONE) return 'no_marker';
  if (marker.repo !== want.repo || marker.kind !== want.kind) return 'marker_foreign';
  if (state === STATE.EXPIRED) return 'marker_expired';
  if (state === STATE.USED) return 'marker_used';
  if (state === STATE.PENDING) return 'marker_unanswered';
  const a = marker.answer;
  if (a.tool_use_id !== marker.tool_use_id || a.session_id !== marker.session_id || a.nonce !== marker.nonce) return 'marker_unbound';
  return marker.hash === want.hash ? null : 'question_changed';
}

/** Read-only check: { ok: true, marker } or { ok: false, reason }. */
function checkMarker(want) {
  const p = peekMarker(want.repo, want.kind, want.now);
  const reason = refusalFor(p.marker, p.state, want);
  return reason === null ? Object.freeze({ ok: true, marker: p.marker }) : Object.freeze({ ok: false, reason });
}

/** Checks again under the lock and marks the marker used (once). { ok: true, marker } or { ok: false, reason }. */
function claimMarker(want) {
  const home = ensureDir();
  return AU.withLock(home, () => {
    const file = markerFile(want.repo, want.kind);
    const r = readFile(file);
    const state = r.marker ? stateOf(r.marker, want.now) : STATE.NONE;
    const reason = refusalFor(r.marker, state, want);
    if (reason !== null) return Object.freeze({ ok: false, reason });
    const used = Object.freeze({ ...r.marker, used: nowIso(want.now) });
    writeAtomic(file, used, false);
    return Object.freeze({ ok: true, marker: used });
  });
}

/** Removes every marker of a repository (revoke: an unused yes must not outlive the revocation). Returns the count removed. */
function dropMarkers(repo) {
  const home = ensureDir();
  return AU.withLock(home, () => {
    let n = 0;
    for (const kind of Q.kindNames()) {
      const file = markerFile(repo, kind);
      if (fs.existsSync(file)) { fs.rmSync(file, { force: true }); n += 1; }
    }
    return n;
  });
}

module.exports = { MARKER_DIR, TTL_MS, STATE, markerDir, markerFile, stateOf, openMarker, answerMarker, peekMarker, checkMarker, claimMarker, dropMarkers, parseMarker };
