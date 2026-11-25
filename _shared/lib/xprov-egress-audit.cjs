'use strict';

// ---------------------------------------------------------------------------
// xprov-egress-audit — the always-on, hash-chained record of every Codex runner spawn (audit F-001, bug
// 2026-11-25-plan-review-egress-audit).
//
//   <owner home>/.a1-xprov/egress-audit.jsonl   (file mode 0600, directory as the other owner stores)
//     one JSON object per line: { ts, repo, gate, mode, phase, round, lane, commit, tree, content_sha256, input_sha256,
//                                 feedback_sha256, diff_sha256, model_pinned, prev }
//     `prev` = sha256 (hex) of the previous line's exact text, null on the first line.
//
// One line per `spawnRunner` call, written BEFORE the spawn (audit before effect: a failed append refuses the spawn).
// It does not depend on `--no-log` or A1_KEEP_REVIEW_LOGS (the opt-in review log is unchanged). It holds hashes and names,
// never file contents. Tier 0 like consent-audit.jsonl: the chain makes an edit visible, it prevents nothing; the same OS
// user can rewrite the whole file. Nothing in a1 deletes or rotates this file.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const OH = require('./xprov-owner-home.cjs');
const AUDIT = require('./xprov-audit.cjs');

const EGRESS_FILE = 'egress-audit.jsonl';
const LOCK_FILE = AUDIT.EGRESS_LOCK_FILE;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const TAIL_BYTES = 65536; // one line is far below this; the tail holds the last complete line
const SHA_RE = /^[0-9a-f]{64}$/;
const GIT_ID_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/; // sha1 or sha256 object id
const LINE_KEYS = Object.freeze(['ts', 'repo', 'gate', 'mode', 'phase', 'round', 'lane', 'commit', 'tree', 'content_sha256', 'input_sha256', 'feedback_sha256', 'diff_sha256', 'model_pinned', 'prev']);

const egressPath = () => path.join(X.xprovHome(), EGRESS_FILE);
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const nullableSha = (v) => v === null || (typeof v === 'string' && SHA_RE.test(v));
const nullableText = (v) => v === null || typeof v === 'string';
const nullableGitId = (v) => v === null || (typeof v === 'string' && GIT_ID_RE.test(v));

function validLine(o) {
  if (!C.isPlainObject(o)) return false;
  const keys = Object.keys(o);
  if (keys.length !== LINE_KEYS.length || !LINE_KEYS.every((k) => keys.includes(k))) return false;
  return typeof o.ts === 'string' && typeof o.repo === 'string' && typeof o.gate === 'string' && typeof o.mode === 'string'
    && typeof o.phase === 'string' && Number.isInteger(o.round) && nullableText(o.lane) && nullableGitId(o.commit)
    && nullableGitId(o.tree) && nullableSha(o.content_sha256) && nullableSha(o.feedback_sha256)
    && typeof o.input_sha256 === 'string' && SHA_RE.test(o.input_sha256) && nullableSha(o.diff_sha256)
    && typeof o.model_pinned === 'string' && nullableSha(o.prev);
}

const ensureHome = () => AUDIT.ensureHome('the egress audit');

/** Opens the file without following a symlink; a non-regular target is refused. */
function openAppend(file) {
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, FILE_MODE); } catch (e) {
    throw C.inputError(`the egress audit ${file} cannot be opened for append (${e.code || 'error'}; a symlink or an unwritable file is refused)`, 'egress_audit_open');
  }
  const st = fs.fstatSync(fd);
  if (!st.isFile() || st.nlink !== 1) { fs.closeSync(fd); throw C.inputError(`the egress audit ${file} is not a regular file with one link`, 'egress_audit_open'); }
  return fd;
}

/** sha256 of the last line's text (null for an empty file); throws when the file does not end in a newline. */
function tipOf(fd) {
  const size = fs.fstatSync(fd).size;
  if (size === 0) return null;
  const len = Math.min(size, TAIL_BYTES);
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, size - len);
  const text = buf.toString('utf8');
  if (!text.endsWith('\n')) throw C.inputError('the last egress audit line is incomplete; fix or move the file yourself; nothing written', 'egress_audit_broken');
  const lines = text.slice(0, -1).split('\n');
  const last = lines[lines.length - 1];
  if (lines.length === 1 && size > len) throw C.inputError('the last egress audit line exceeds the tail window; nothing written', 'egress_audit_broken');
  return sha256(last);
}

/**
 * Appends one chained line and returns it. Throws a typed input error (nothing appended) when the home tripwire holds, the
 * target is a symlink or not a regular file, the log ends in a partial line, or the write fails.
 * `r`: { repo, gate, mode, phase, round, lane, commit, tree, content_sha256, input_sha256, feedback_sha256?, diff_sha256?, model_pinned, now? }.
 */
function appendEgress(r) {
  OH.assertWritable();
  const home = ensureHome();
  return AUDIT.withLock(home, () => {
    const fd = openAppend(path.join(home, EGRESS_FILE));
    try {
      const line = {
        ts: r.now || new Date().toISOString(), repo: r.repo, gate: r.gate, mode: r.mode, phase: r.phase, round: r.round,
        lane: r.lane === undefined ? null : r.lane, commit: r.commit === undefined ? null : r.commit,
        tree: r.tree === undefined ? null : r.tree, content_sha256: r.content_sha256 === undefined ? null : r.content_sha256,
        input_sha256: r.input_sha256, feedback_sha256: r.feedback_sha256 === undefined ? null : r.feedback_sha256, diff_sha256: r.diff_sha256 === undefined ? null : r.diff_sha256, model_pinned: r.model_pinned, prev: tipOf(fd),
      };
      if (!validLine(line)) throw C.inputError('egress audit: line is off-format; nothing written', 'egress_audit_input');
      fs.fchmodSync(fd, FILE_MODE);
      fs.writeSync(fd, `${JSON.stringify(line)}\n`);
      fs.fsyncSync(fd);
      return Object.freeze(line);
    } finally { fs.closeSync(fd); }
  }, LOCK_FILE);
}

/** Reads and checks the whole chain: { ok, lines, why }. A missing file is ok with no lines. */
function verifyEgress(file) {
  const target = file || egressPath();
  let text;
  try { text = fs.readFileSync(target, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? { ok: true, lines: [], why: null } : { ok: false, lines: [], why: 'the egress audit cannot be read' }; }
  if (text === '') return { ok: true, lines: [], why: null };
  if (!text.endsWith('\n')) return { ok: false, lines: [], why: 'the last line is incomplete' };
  const raw = text.slice(0, -1).split('\n');
  const lines = [];
  let prev = null;
  for (let i = 0; i < raw.length; i++) {
    let o;
    try { o = JSON.parse(raw[i]); } catch (_e) { return { ok: false, lines, why: `line ${i + 1} is not JSON` }; }
    if (!validLine(o)) return { ok: false, lines, why: `line ${i + 1} is off-format` };
    if (o.prev !== prev) return { ok: false, lines, why: `line ${i + 1} does not chain to line ${i}` };
    lines.push(Object.freeze(o));
    prev = sha256(raw[i]);
  }
  return { ok: true, lines, why: null };
}

/** `xprov egress-verify`: read-only; exit 0 when the chain holds (or the file is absent), 1 with the reason when it is broken. */
function cmdXprovEgressVerify(args) {
  if (args && args.length) return C.usageExit('egress-verify', `takes no argument (got ${JSON.stringify(String(args[0]).slice(0, 80))})`);
  const file = egressPath();
  const v = verifyEgress(file);
  process.stderr.write(`xprov egress-verify: ${v.ok ? `chain ok, ${v.lines.length} line(s)` : `BROKEN: ${v.why}`} (${file})\n`);
  return C.emitJson({ ok: v.ok, lines: v.lines.length, reason: v.why, file }, v.ok ? X.EXIT_PASS : X.EXIT_FAIL, false);
}

module.exports = { cmdXprovEgressVerify, EGRESS_FILE, LOCK_FILE, LINE_KEYS, egressPath, appendEgress, verifyEgress };
