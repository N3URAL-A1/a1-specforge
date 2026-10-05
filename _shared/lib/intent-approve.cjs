'use strict';

// ---------------------------------------------------------------------------
// intent-approve — the approve step and `a1-tools intent approve <path>`
// (spec 011, Wave 10: FR-015, FR-045). The only path that turns an untrusted
// file into a trusted one: whatever it re-signs runs as the owner.
//
// reapproveIntent(targetPath, { via, approveId, expectSha256 }, deps) is the
// shared routine of the TTY command here (via "tty", approveId null) and the
// approve queue-control intent of tick (via "intent", approveId = its id,
// Wave 8). Executor host only, under the ledger lock (so it never interleaves
// with a claim of the same file):
//   1. target: <root>/rejected/<name> with rejected_reason device_unknown or
//      signature_invalid, or <root>/queued/<name>; read once through the
//      validator's reader (one descriptor, O_NOFOLLOW, bounded). Anything
//      else -> target_not_found. `expectSha256` (the TTY path: the bytes the
//      owner saw) differing from the bytes read now -> already_moved.
//   2. a NEW frontmatter object (the parsed one is never mutated): id kept,
//      created_by = executor device, fresh nonce, created_at = now,
//      status queued, the ten a1-only keys and any old group removed, the
//      four group keys added, signed with the executor device's secret over
//      the canonical string including the group.
//   3. a line-preserving rewrite (not io.writeMdAtomic, which reorders keys):
//      untouched lines stay byte for byte, patched keys are replaced in place,
//      dropped keys leave with their continuation lines, the group is appended.
//      Every patched string is written double-quoted (a nonce of digits only
//      must stay a string). The result must parse back to exactly the new
//      object.
//   4. the new bytes are validated before anything is written (the executor
//      device injected; status queued and no a1-only key make the folder
//      context of rejected/ as strict as queued/). Invalid -> exit 1 with the
//      validator's reasons, nothing written.
//   5. a queued/ target is rewritten in place (tmp + rename). A rejected/
//      target is written complete to a tmp name in queued/, published with
//      link(2), and only then removed from rejected/: the opposite order of
//      claim on purpose, a file must be complete before it becomes visible
//      as queued, or tick could claim a half-approved file. It never replaces
//      an existing queued/ file (already_moved), and queued/ must be a real
//      directory (a symlinked queued/ would carry the signed file out of the
//      vault: exit 2).
//   6. one log line, outcome approved.
//
// Never approvable (security review of waves 9–10): an approve or cancel
// intent (target_invalid, MAJOR-2: it would act on a target the owner never
// saw), and a file with a character the owner cannot see in any shown value
// (display_unsafe, BLOCKER-2: format, private-use, unassigned, separator,
// tag, a printable-but-blank code point or an overlay mark, or more than two
// combining marks in a row; re-review n1). Both hold for the tick path too;
// there, display_unsafe becomes target_invalid, and the routine refuses to
// run without the approve intent's target_sha256 (re-review n2).
//
// The TTY command refuses `--yes` (exit 2) and a non-TTY stdin or stdout
// (exit 1). It shows action, project, target, the sender (marked
// unverified) and the WHOLE payload with its length on /dev/tty, wrapped by
// grapheme cluster, through an allowlist: letters, marks, numbers,
// punctuation, symbols and the ASCII space as they are, everything else
// escaped (an ESC sequence must not repaint what the owner reads, a no-break
// space must not pass for a space). It discards type-ahead, a partial line
// included (raw mode for the drain), then reads one line typed after the
// prompt from /dev/tty. Only "yes" approves; an empty answer is "no".
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const tty = require('tty');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeTextAtomic } = require('./io.cjs');
const { assertVaultWriteContained, tmpPathFor } = require('./fs-safe.cjs');
const {
  INTENT_A1_ONLY_KEYS, INTENT_APPROVAL_KEYS, INTENT_ID_RE, INTENT_PAYLOAD_MAX_BYTES, TARGET_SHA256_RE,
} = require('./intent-constants.cjs');
const { parseIntentFrontmatter, readIntentFile, validateIntentFile } = require('./intent-validate.cjs');
const { sign } = require('./intent-sign.cjs');
const { loadDevices, lookupDevice, requireTty } = require('./intent-devices.cjs');
const { withLedgerLock } = require('./intent-ledger.cjs');
const {
  requireExecutorHost, locateLifecycleFile, decide, decideError,
} = require('./intent-lifecycle.cjs');

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;
const APPROVABLE_REASONS = Object.freeze(['device_unknown', 'signature_invalid']);
const TARGET_FOLDERS = Object.freeze(['rejected', 'queued']);
const NONCE_BYTES = 16;
const ANSWER_MAX_BYTES = 256;
const TTY_PATH = '/dev/tty';
const KEY_LINE_RE = /^([a-z_][a-z0-9_]*):/;
const QUEUE_CONTROL_ACTIONS = Object.freeze(['approve', 'cancel']);
const WRAP_CHARS = 76;
const BACKSLASH = String.fromCharCode(92);
// Display allowlist (security review of waves 9–10, BLOCKER-2; re-review
// n1): letters, marks, numbers, punctuation, symbols and the ASCII space are
// shown as they are; every other code point is shown escaped as \u{hex}. On top, the
// code points below render as nothing or as blank although their category is
// "printable" (Hangul fillers, braille blank, combining grapheme joiner,
// variation selectors, Mongolian and Khmer invisibles, invisible operators).
const PRINTABLE_RE = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]$/u;
const MARK_RE = /^\p{M}$/u;
const MAX_MARK_RUN = 2;
const FORMAT_RE = /^[\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}]$/u;
const INVISIBLE_RANGES = Object.freeze([
  [0x00ad, 0x00ad], [0x034f, 0x034f], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180b, 0x180f],
  [0x2060, 0x2064], [0x2800, 0x2800], [0x3164, 0x3164], [0xfe00, 0xfe0f], [0xffa0, 0xffa0],
  [0xe0000, 0xe007f], [0xe0100, 0xe01ef],
]);
// Overlay marks (canonical combining class 1) draw through their base: "="
// with U+0338 reads as "≠". Never shown, never approved (re-review n1).
const OVERLAY_RANGES = Object.freeze([
  [0x0334, 0x0338], [0x1cd4, 0x1cd4], [0x1ce2, 0x1ce8], [0x20d2, 0x20d3], [0x20d8, 0x20da],
  [0x20e5, 0x20e6], [0x20ea, 0x20eb], [0x10a39, 0x10a39], [0x16af0, 0x16af4], [0x1bc9e, 0x1bc9e],
  [0x1d167, 0x1d169],
]);
const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' });

function lifecycleDeps(deps) {
  return {
    hostname: os.hostname(),
    homedir: os.homedir,
    now: Date.now,
    link: fs.linkSync,
    unlink: fs.unlinkSync,
    writeText: writeTextAtomic,
    validate: validateIntentFile,
    vault: process.env.A1_VAULT_ROOT || null,
    randomBytes: crypto.randomBytes,
    ...deps,
  };
}

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const has = (fm, key) => Object.prototype.hasOwnProperty.call(fm, key);

const NOT_FOUND = Object.freeze({ ok: false, reason: 'target_not_found' });
const refused = (reason) => Object.freeze({ ok: false, reason });

// ---------- what the owner sees ----------

const inRanges = (ranges, cp) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
const isInvisible = (cp) => inRanges(INVISIBLE_RANGES, cp) || inRanges(OVERLAY_RANGES, cp);

// A code point the owner cannot see as it is: format, private-use,
// unassigned, line or paragraph separator, tag, a printable-but-blank code
// point, or an overlay mark.
function isHiddenChar(ch) {
  return FORMAT_RE.test(ch) || isInvisible(ch.codePointAt(0));
}

// More than MAX_MARK_RUN combining marks in a row stack above or below the
// line and can spill into neighbouring lines (re-review n1). One or two are
// ordinary text (decomposed umlauts, Vietnamese).
function hasMarkRun(v) {
  let run = 0;
  for (const ch of v) {
    run = MARK_RE.test(ch) ? run + 1 : 0;
    if (run > MAX_MARK_RUN) return true;
  }
  return false;
}

// One value for the terminal: allowlisted code points as they are, the
// backslash doubled (so an escape is never ambiguous), everything else as
// \u{hex}. Newlines are escaped too; the payload is split into lines first.
function terminalSafe(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return [...s].map((ch) => {
    if (ch === BACKSLASH) return BACKSLASH + BACKSLASH;
    if (PRINTABLE_RE.test(ch) && !isInvisible(ch.codePointAt(0))) return ch;
    return `${BACKSLASH}u{${ch.codePointAt(0).toString(16)}}`;
  }).join('');
}

const DISPLAYED_KEYS = Object.freeze(['action', 'project', 'target', 'created_by', 'rejected_reason', 'payload']);

// true when a displayed value holds a character the owner cannot see, or
// the payload is above its cap (it could not be shown whole): such a file is
// never offered for approval (reason display_unsafe), escaped or not.
function displayUnsafe(fm, name) {
  const values = [name, ...DISPLAYED_KEYS.map((k) => fm[k])].filter((v) => typeof v === 'string');
  const tooLong = typeof fm.payload === 'string' && Buffer.byteLength(fm.payload, 'utf8') > INTENT_PAYLOAD_MAX_BYTES;
  return tooLong || values.some((v) => hasMarkRun(v) || [...v].some(isHiddenChar));
}

// -> { ok: true, path, root, folder, name, content, fm, sha256 } | NOT_FOUND.
// Nothing is written.
function readApprovalTarget(targetPath, deps = {}) {
  const d = lifecycleDeps(deps);
  const loc = locateLifecycleFile(targetPath, TARGET_FOLDERS, d.vault);
  if (!loc.ok || loc.missing) return NOT_FOUND;
  let read;
  try {
    read = readIntentFile(loc.path);
  } catch (e) {
    if (e && e.code === 'ENOENT') return NOT_FOUND;
    throw e;
  }
  const parsed = read.ok ? parseIntentFrontmatter(read.content) : { ok: false };
  if (!parsed.ok) return NOT_FOUND;
  if (loc.folder === 'rejected' && !APPROVABLE_REASONS.includes(parsed.fm.rejected_reason)) return NOT_FOUND;
  // An approve or cancel re-signed by the executor would act on a target the
  // owner never saw (review MAJOR-2): approving one is refused.
  if (QUEUE_CONTROL_ACTIONS.includes(parsed.fm.action)) return refused('target_invalid');
  if (displayUnsafe(parsed.fm, path.basename(loc.path))) return refused('display_unsafe');
  return Object.freeze({
    ok: true, path: loc.path, root: loc.root, folder: loc.folder, name: path.basename(loc.path),
    content: read.content, fm: parsed.fm, sha256: sha256(read.content),
  });
}

// The new frontmatter object; `fm` is not touched.
function approvedFrontmatter(fm, { via, approveId, executorDevice, nowIso, nonce }) {
  const dropped = new Set([...INTENT_A1_ONLY_KEYS, ...INTENT_APPROVAL_KEYS, 'signature']);
  const kept = Object.entries(fm).filter(([k]) => !dropped.has(k));
  return Object.freeze(Object.assign(Object.create(null), Object.fromEntries(kept), {
    created_by: executorDevice,
    nonce,
    created_at: nowIso,
    status: 'queued',
    approved_from_device: fm.created_by,
    approved_at: nowIso,
    approved_via: via,
    approved_by_intent: via === 'intent' ? approveId : null,
  }));
}

const yamlValue = (v) => (v === null ? 'null' : JSON.stringify(String(v)));

// Line-preserving rewrite: `patch` keys replaced in place (or appended, in
// patch order), `drop` keys removed with their continuation lines. Throws
// when the result does not parse back to exactly `expected`.
function rewriteForApproval(content, patch, drop, expected) {
  const lines = String(content).replace(/\r\n/g, '\n').split('\n');
  const close = lines.indexOf('---', 1);
  if (lines[0] !== '---' || close === -1) throw new Error('rewriteForApproval: no frontmatter');
  const out = [];
  const seen = new Set();
  let skipping = false;
  for (const line of lines.slice(1, close)) {
    const m = line.match(KEY_LINE_RE);
    if (m) skipping = has(patch, m[1]) || drop.has(m[1]);
    if (m && has(patch, m[1])) {
      seen.add(m[1]);
      out.push(`${m[1]}: ${yamlValue(patch[m[1]])}`);
    } else if (!skipping) out.push(line);
  }
  for (const k of Object.keys(patch)) if (!seen.has(k)) out.push(`${k}: ${yamlValue(patch[k])}`);
  const next = ['---', ...out, ...lines.slice(close)].join('\n');
  const back = parseIntentFrontmatter(next);
  const same = back.ok && Object.keys(back.fm).sort().join(',') === Object.keys(expected).sort().join(',')
    && Object.keys(expected).every((k) => back.fm[k] === expected[k]);
  if (!same) throw new Error('rewriteForApproval: result does not parse back');
  return next;
}

// decideError for the catalog errors; anything else is exit 2 with one line
// (FR-016), never a stack trace (review m3). Nothing was written: every
// write comes after the last check that can throw.
function approveError(d, name, e) {
  try {
    return decideError(d, 'approve', name, e);
  } catch (other) {
    const why = String(other && other.message ? other.message : other).split('\n')[0].slice(0, 200);
    return Object.freeze({ exitCode: EXIT_USAGE, out: null, stderr: `intent approve: internal error (${why}); nothing was written` });
  }
}

function refuseApprove(d, intentId, reasons) {
  return decide(d, 'approve', EXIT_REFUSED, { approved: false, reasons }, { intentId, outcome: 'refused', reason: reasons.join(',') });
}

// A directory that is not a symlink and resolves to itself (review m4).
function isRealDir(dir) {
  const st = fs.lstatSync(dir, { throwIfNoEntry: false });
  return Boolean(st && st.isDirectory() && fs.realpathSync(dir) === dir);
}

// The new bytes go to a tmp name in queued/ (not *.md, so no reader takes
// it), complete and fsynced; link(2) then publishes them under <name> and
// fails with EEXIST instead of replacing a queued/ file created after the
// check above (review m4). Only then are the tmp name and the rejected/ file
// removed. -> false on EEXIST, with nothing changed.
function publishNoClobber(text, source, dest, d) {
  assertVaultWriteContained(dest);
  const tmp = tmpPathFor(dest);
  const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW } = fs.constants;
  const fd = fs.openSync(tmp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o644);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    d.link(tmp, dest);
  } catch (e) {
    fs.unlinkSync(tmp);
    if (e && e.code === 'EEXIST') return false;
    throw e;
  }
  fs.unlinkSync(tmp);
  d.unlink(source);
  return true;
}

// The reasons differ by path (spec round 6): path (a), the approve intent of
// tick, rejects with catalog reasons (they land in the approve intent's
// file); the TTY path reports refusal codes on the terminal only.
const PATH_A_REASON = Object.freeze({
  intent: Object.freeze({ display_unsafe: 'target_invalid', changed: 'target_not_found' }),
  tty: Object.freeze({ changed: 'already_moved' }),
});

// Steps 1–6 under the ledger lock.
function approveLocked(targetPath, opts, config, d) {
  const t = readApprovalTarget(targetPath, d);
  if (!t.ok) return refuseApprove(d, path.basename(String(targetPath)), [PATH_A_REASON[opts.via][t.reason] || t.reason]);
  const intentId = typeof t.fm.id === 'string' ? t.fm.id : t.name;
  if (opts.expectSha256 && opts.expectSha256 !== t.sha256) return refuseApprove(d, intentId, [PATH_A_REASON[opts.via].changed]);
  const dest = path.join(t.root, 'queued', t.name);
  if (t.folder === 'rejected' && !isRealDir(path.join(t.root, 'queued'))) {
    return Object.freeze({ exitCode: EXIT_USAGE, out: null, stderr: 'intent approve: inbox/intents/queued/ is not a real directory inside the vault; nothing was written' });
  }
  if (t.folder === 'rejected' && fs.lstatSync(dest, { throwIfNoEntry: false })) return refuseApprove(d, intentId, ['already_moved']);
  const secret = lookupDevice(loadDevices({ homedir: d.homedir }), config.executor_device);
  if (secret === null) return refuseApprove(d, intentId, ['device_unknown']);
  const nowIso = new Date(d.now()).toISOString();
  const unsigned = approvedFrontmatter(t.fm, {
    ...opts, executorDevice: config.executor_device, nowIso, nonce: d.randomBytes(NONCE_BYTES).toString('hex'),
  });
  const next = Object.freeze(Object.assign(Object.create(null), unsigned, { signature: sign(unsigned, secret) }));
  const patch = Object.fromEntries(['created_by', 'nonce', 'created_at', 'status', 'signature', ...INTENT_APPROVAL_KEYS].map((k) => [k, next[k]]));
  const drop = new Set([...INTENT_A1_ONLY_KEYS, ...INTENT_APPROVAL_KEYS].filter((k) => !has(patch, k)));
  const text = rewriteForApproval(t.content, patch, drop, next);
  const v = d.validate(t.path, { readFile: () => text, homedir: d.homedir, now: d.now, executorDevice: config.executor_device });
  if (!v.valid) return refuseApprove(d, intentId, [...v.reasons]);
  if (t.folder === 'queued') d.writeText(t.path, text);
  else if (!publishNoClobber(text, t.path, dest, d)) return refuseApprove(d, intentId, ['already_moved']);
  return decide(d, 'approve', EXIT_OK, { approved: true, id: next.id, path: dest, via: opts.via }, { intentId, outcome: 'approved', reason: null, detail: opts.via });
}

// FR-015 -> { exitCode, out, usage?, stderr? }; the log line is written here.
function reapproveIntent(targetPath, opts = {}, deps = {}) {
  const d = lifecycleDeps(deps);
  const via = opts.via;
  const approveId = opts.approveId === undefined ? null : opts.approveId;
  // Path (a) binds the target bytes (spec round 6): without the approve
  // intent's target_sha256 the routine refuses instead of approving whatever
  // the file holds now (re-review n2).
  const okIntent = via === 'intent' && typeof approveId === 'string' && INTENT_ID_RE.test(approveId)
    && typeof opts.expectSha256 === 'string' && TARGET_SHA256_RE.test(opts.expectSha256);
  const okVia = (via === 'tty' && approveId === null) || okIntent;
  if (!okVia) return Object.freeze({ exitCode: EXIT_USAGE, out: null, usage: 'reapproveIntent: via "tty" with no approve id, or via "intent" with the approve intent\'s v4 id and its target_sha256 (64 lowercase hex)' });
  const name = path.basename(String(targetPath));
  try {
    const config = requireExecutorHost(d);
    if (config === null) return refuseApprove(d, name, ['not_executor_host']);
    const run = () => approveLocked(targetPath, { via, approveId, expectSha256: opts.expectSha256 || null }, config, d);
    return withLedgerLock(run, { homedir: d.homedir, hostname: d.hostname, now: d.now });
  } catch (e) {
    return approveError(d, name, e);
  }
}

// ---------- the TTY command ----------

// Wrap of one escaped line by grapheme clusters: a combining mark never
// lands on the next line without its base (re-review n1).
function wrap(line) {
  const gs = [...GRAPHEMES.segment(line)].map((g) => g.segment);
  const out = [];
  for (let i = 0; i < gs.length; i += WRAP_CHARS) out.push(gs.slice(i, i + WRAP_CHARS).join(''));
  return out.length === 0 ? [''] : out;
}

// The whole payload (it is at most INTENT_PAYLOAD_MAX_BYTES), with its length,
// line by line and wrapped, each line escaped (review MAJOR-1: nothing the
// owner approves is hidden behind a cut). Every value is attacker-chosen
// until the executor signs it, so the sender is marked unverified (m2).
function summaryLines(t) {
  const payload = typeof t.fm.payload === 'string' ? t.fm.payload : '';
  const chars = [...payload].length;
  const bytes = Buffer.byteLength(payload, 'utf8');
  const body = payload.replace(/\n$/, '').split('\n').flatMap((l) => wrap(terminalSafe(l))).map((l) => `  | ${l}`);
  const why = t.folder === 'rejected' ? `rejected: ${terminalSafe(t.fm.rejected_reason)}` : 'queued, not yet validated';
  return [
    `intent approve — ${t.folder}/${terminalSafe(t.name)}`,
    `  action:   ${terminalSafe(t.fm.action)}`,
    `  project:  ${terminalSafe(t.fm.project)}`,
    `  target:   ${terminalSafe(t.fm.target)}`,
    `  from:     ${terminalSafe(t.fm.created_by)} (UNVERIFIED sender — ${why})`,
    `  payload (${chars} characters, ${bytes} bytes, shown in full):`,
    ...body,
    '',
  ].join('\n');
}

// One line from the terminal, at most ANSWER_MAX_BYTES; blocking read.
function readTtyLine(fd) {
  const buf = Buffer.alloc(ANSWER_MAX_BYTES);
  let got = 0;
  let n = 1;
  while (got < ANSWER_MAX_BYTES && n > 0 && !buf.subarray(0, got).includes(0x0a)) {
    n = fs.readSync(fd, buf, got, ANSWER_MAX_BYTES - got, null);
    got += n;
  }
  return buf.subarray(0, got).toString('utf8').split('\n')[0].trim();
}

function emitLine(r) {
  if (r.usage) {
    process.stderr.write(`usage error: ${r.usage}\n`);
    process.stderr.write('see: a1-tools --help (section "a1-tools intent")\n');
  }
  if (r.stderr) process.stderr.write(`${r.stderr}\n`);
  if (r.out) process.stdout.write(`${JSON.stringify(r.out)}\n`);
  process.exitCode = r.exitCode;
}

const usage = (text) => emitLine({ exitCode: EXIT_USAGE, out: null, usage: text });

// Host check before the target is read; -> the target, or a result to emit.
function preflight(targetPath, d) {
  try {
    if (requireExecutorHost(d) === null) return { result: refuseApprove(d, path.basename(targetPath), ['not_executor_host']) };
    const t = readApprovalTarget(targetPath, d);
    return t.ok ? { target: t } : { result: refuseApprove(d, path.basename(targetPath), [t.reason]) };
  } catch (e) {
    return { result: approveError(d, path.basename(targetPath), e) };
  }
}

// Discards whatever was typed or pasted before the prompt (review m6,
// re-review n4): a "yes" on its way before the owner saw the summary never
// counts, with or without Enter. In canonical mode a line without Enter sits
// in the terminal's line buffer, invisible to a read; the terminal is
// switched to raw mode for the drain so that partial line becomes readable
// too, then back. A second, non-blocking descriptor; reads until EAGAIN.
function drainTty() {
  const fd = fs.openSync(TTY_PATH, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  const stream = new tty.ReadStream(fd);
  const buf = Buffer.alloc(ANSWER_MAX_BYTES);
  try {
    stream.setRawMode(true);
    let n = 1;
    while (n > 0) {
      try {
        n = fs.readSync(fd, buf, 0, buf.length, null);
      } catch (e) {
        if (e && (e.code === 'EAGAIN' || e.code === 'EWOULDBLOCK')) return;
        throw e;
      }
    }
  } finally {
    stream.setRawMode(false);
    stream.destroy(); // closes fd
  }
}

function confirmOnTty(t, openTty, drain) {
  const fd = openTty();
  try {
    fs.writeSync(fd, summaryLines(t));
    drain();
    fs.writeSync(fd, 'Approve? (yes/no) ');
    return readTtyLine(fd) === 'yes';
  } finally {
    fs.closeSync(fd);
  }
}

// `a1-tools intent approve <path>` — `deps.openTty` for library cases.
function cmdIntentApprove(args, deps = {}) {
  if (args.includes('--yes')) return usage('intent approve: --yes is refused; approving needs the owner\'s answer on the terminal');
  if (args.length !== 1 || args[0].startsWith('-')) return usage('intent approve <path> (one rejected/ or queued/ intent file, no flags)');
  if (!requireTty(process.stdin) || !requireTty(process.stdout)) {
    process.stderr.write('intent approve: stdin and stdout must be a TTY; approving needs the owner at the terminal. Nothing was written.\n');
    process.exitCode = EXIT_REFUSED;
    return undefined;
  }
  const d = lifecycleDeps(deps);
  if (!d.vault) return usage('intent approve: A1_VAULT_ROOT is not set');
  const pre = preflight(args[0], d);
  if (pre.result) return emitLine(pre.result);
  let yes;
  try {
    yes = confirmOnTty(pre.target, deps.openTty || (() => fs.openSync(TTY_PATH, 'r+')), deps.drainTty || drainTty);
  } catch (e) {
    process.stderr.write(`intent approve: cannot use ${TTY_PATH} (${e && e.code ? e.code : 'error'}). Nothing was written.\n`);
    process.exitCode = EXIT_REFUSED;
    return undefined;
  }
  if (!yes) {
    decide(d, 'approve', EXIT_REFUSED, null, { intentId: pre.target.fm.id, outcome: 'declined', reason: null });
    process.stderr.write('intent approve: not approved; nothing changed.\n');
    process.exitCode = EXIT_REFUSED;
    return undefined;
  }
  return emitLine(reapproveIntent(args[0], { via: 'tty', approveId: null, expectSha256: pre.target.sha256 }, deps));
}

module.exports = {
  readApprovalTarget,
  reapproveIntent,
  cmdIntentApprove,
  terminalSafe,
};
