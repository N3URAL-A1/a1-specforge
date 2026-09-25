'use strict';

// ---------------------------------------------------------------------------
// xprov-common — the ONE copy of every helper the xprov modules share
// (spec 009-cross-provider-review-gate; extracted 2026-09-25 after
// a1-reinhard-reviewer's PR review measured drift between duplicated copies:
// three different positive-integer bounds, two `clip` semantics, `--lane`
// validated by LANE_RE in three modules and by assertSafeSegment in a fourth).
//
// Rules for this file: no CLI surface, no module-level I/O, one definition per
// helper, and the bounds below are the bounds — a module that needs another one
// changes it HERE, with the reason, not locally.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const io = require('./io.cjs');
const X = require('./xprov.cjs');

// ---------- shared constants ----------

const REGISTRY_PATH = path.join(__dirname, '..', 'gates-registry.md');
// Lane ids: one shape for gate, run, observe and normalize (normalize used to
// accept anything assertSafeSegment allowed, e.g. `foo bar`, which the gate then
// refused — Reinhard PR review).
const LANE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
// Positive integers for --wave, --round, --timeout, --waves: 1–9999. This is the
// tightest of the three bounds the modules carried (gate 1–9999, run/normalize
// unbounded, observe 1–999 — `--wave 1000` passed the gate and failed in
// stepObserve as fail/malformed). 9999 leaves room for a 3600 s timeout and any
// plausible wave count while refusing garbage.
const POSITIVE_INT_RE = /^[1-9]\d{0,3}$/;
const POSITIVE_INT_MAX = 9999;
const DETAIL_MAX_CHARS = 500; // reason_detail, echoed limitations, stderr tails, log cells
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const DIR_MODE = 0o700;

// ---------- errors and CLI plumbing ----------

/** Typed user error: the facade prints `error: <message>` and exits 2; callers
 * that want a machine `reason` read `err.reason`. */
function inputError(message, reason) {
  const err = new Error(message);
  err.code = 'A1_INPUT';
  err.reason = reason || 'invalid_input';
  return err;
}

/** stdout is a pipe more often than not: process.stdout.write + process.exit
 * truncates at 64 KiB (Samuel, measured: 3 MB → 65 536 bytes). Write the whole
 * buffer synchronously on fd 1 and let the process end by itself. */
function writeStdoutSync(text) {
  const buf = Buffer.from(text, 'utf8');
  let off = 0;
  while (off < buf.length) {
    try { off += fs.writeSync(1, buf, off, buf.length - off); } catch (e) { if (e.code !== 'EAGAIN') throw e; }
  }
}

/** stdout: the JSON contract; exit code via exitCode (never process.exit). */
function emitJson(report, code, pretty) {
  writeStdoutSync(`${pretty === false ? JSON.stringify(report) : JSON.stringify(report, null, 2)}\n`);
  process.exitCode = code;
  return null;
}

/** Usage error: stderr only, exit 2 via exitCode, returns null so callers can
 * `return usageExit(...)`. Never writes stdout. */
function usageExit(sub, msg) {
  process.stderr.write(`usage error: xprov ${sub ? `${sub} ` : ''}${msg}\n`);
  process.exitCode = X.EXIT_USAGE;
  return null;
}

/** Same message, but for call sites deep inside argument resolution that cannot
 * return: throws a typed error the facade turns into exit 2 (stderr `error: …`). */
function usageThrow(sub, msg) {
  throw inputError(`xprov ${sub ? `${sub} ` : ''}${msg}`, 'usage');
}

// ---------- small pure helpers ----------

/** Bounded string: total length ≤ max, ellipsis when cut. */
function clip(value, max) {
  const s = String(value == null ? '' : value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Last DETAIL_MAX_CHARS of a trimmed stderr, ellipsis in front when cut. */
function stderrTail(text) {
  const t = String(text || '').trim();
  return t.length > DETAIL_MAX_CHARS ? `…${t.slice(-(DETAIL_MAX_CHARS - 1))}` : t;
}

/** One-line, bounded rendering for log cells; null/undefined → 'none'. */
function oneLine(value) {
  return value == null ? 'none' : clip(String(value).replace(/[\r\n\t]+/g, ' '), DETAIL_MAX_CHARS);
}

function parsePositive(value, name) {
  if (!POSITIVE_INT_RE.test(String(value))) throw inputError(`--${name} must be an integer between 1 and ${POSITIVE_INT_MAX} (got ${JSON.stringify(clip(value, 80))})`);
  return Number(value);
}

function parseLane(value) {
  if (value === undefined || value === null) return null;
  if (!LANE_RE.test(String(value))) throw inputError(`--lane must match ${LANE_RE} (got ${JSON.stringify(clip(value, 80))})`);
  return String(value);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (_e) { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (_e) { return false; } };

// ---------- filesystem ----------

/** mkdir + chmod 0700 (chmod defeats the umask and tightens a pre-existing dir).
 * Filesystem refusals become typed user errors, not internal faults. */
function mkdir0700(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    fs.chmodSync(dir, DIR_MODE);
  } catch (e) {
    if (e && (e.code === 'EEXIST' || e.code === 'ENOTDIR')) throw inputError(`${dir} exists but is not a directory`, 'path_is_file');
    if (e && e.code === 'ENAMETOOLONG') throw inputError(`${dir} exceeds the filesystem's path length limit`, 'path_too_long');
    throw e;
  }
}

// ---------- xreview/index.json ----------

/** [] when absent, the array when every entry is a plain object, else null. */
function readIndex(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(arr) && arr.every(isPlainObject) ? arr : null;
  } catch (_e) {
    return null;
  }
}

const sameWave = (entry, wave) => (wave === null ? entry.wave === null || entry.wave === undefined : Number(entry.wave) === wave);
const sameLane = (entry, lane) => (lane === null ? entry.lane === null || entry.lane === undefined : entry.lane === lane);

// ---------- git ----------

/** One git call, argv array, never a shell. Returns { status, stdout, stderr, error }. */
function gitSpawn(args, opts) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'], ...(opts || {}) });
  return { status: r.status, stdout: r.stdout || '', stderr: (r.stderr || '').trim(), error: r.error || null };
}

/** stdout of a successful git call, else null. */
function gitOut(args) {
  const r = gitSpawn(args);
  return r.status === 0 ? r.stdout : null;
}

/** `--repo` must be a git TOPLEVEL (compared by realpath). Undefined → the
 * primary checkout (io.repoRoot()). A subdirectory or a non-repo directory is
 * a usage error, never a silent fallback. */
function resolveRepoFlag(repoFlag) {
  if (repoFlag === undefined || repoFlag === null) return io.repoRoot();
  const dir = path.resolve(String(repoFlag));
  const top = gitOut(['-C', dir, 'rev-parse', '--show-toplevel']);
  if (top === null) throw inputError(`--repo is not inside a git repository: ${dir}`);
  let same = false;
  try { same = fs.realpathSync(top.trim()) === fs.realpathSync(dir); } catch (_e) { same = false; }
  if (!same) throw inputError(`--repo must be the git toplevel (${top.trim()}), got ${dir}`);
  return dir;
}

module.exports = {
  REGISTRY_PATH, LANE_RE, POSITIVE_INT_RE, POSITIVE_INT_MAX, DETAIL_MAX_CHARS, GIT_MAX_BUFFER, DIR_MODE,
  inputError, writeStdoutSync, emitJson, usageExit, usageThrow,
  clip, stderrTail, oneLine, parsePositive, parseLane, sha256, isPlainObject, isDir, isFile,
  mkdir0700, readIndex, sameWave, sameLane, gitSpawn, gitOut, resolveRepoFlag,
};
