'use strict';

// ---------------------------------------------------------------------------
// intent-result — `intent complete`: result note + secret filter (spec 011,
// Wave 5: FR-029, FR-030, FR-031; log line FR-033). Spawns nothing.
//
// complete (executor host only): host check before any file is read ->
// claimed/ path -> stdout/stderr tails, optional before-snapshot -> under the
// ledger lock: one bounded read of the claimed file, which needs an OPEN
// ledger row whose claimed_sha256 equals those bytes (else `tampered`,
// nothing moved) -> note project/<slug>/intents/<id>.md -> rename to done/ ->
// line-preserving rewrite of exactly the checked bytes -> ledger row closed
// -> one log line. approve/cancel get no note: exit 2 (tick, Wave 8).
//
// Filter before cut (intent-redact): the filter runs over all text read,
// with every device secret of devices.json as an exact value; tails and the
// cap come after. The filter runs BEFORE the ledger lock, so a slow input
// never holds the queue. The note is written explicitly: io.writeMdAtomic
// orders keys spec-first, then alphabetic, not in the 15-key order.
// `artifacts` diffs two snapshots of project/<slug>/; the before-snapshot and
// (FR-049) --stdout/--stderr are read only from private files: the outputs
// directly in ~/.a1-intents/runs/<id>/ of the intent's own id. A planted
// done/<id>.md moves to rejected/; an unsafe result path is result_path_unsafe.
// Wave 6 part B (FR-030, FR-043): for a write action the note names the
// intent worktree's `branch` and home-relative `worktree_path` (null
// otherwise), and the registry entry is finished (done -> handoff; failed ->
// stays active with the reason). A registry problem never undoes a completed
// intent; it is named in the log detail. Review M2: for a claude row whose
// stdout is the measured `--output-format json` object, the Summary is its
// `result` text, and is_error true fails the intent (nonzero_exit).
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeTextAtomic, serializeScalar, projectsPath, assertSafeSegment } = require('./io.cjs');
const { assertVaultWriteContained } = require('./fs-safe.cjs');
const { INTENT_FAILURE_REASONS } = require('./status-constants.cjs');
const { INTENT_CLAIMED_MAX_BYTES, INTENT_RESULT_MAX_BYTES, INTENT_ID_RE, ACTION_TABLE, INTENT_WRITE_ACTIONS } = require('./intent-constants.cjs');
const { knownSecrets, redact, filterOutput, tailLines, prepareOutput, fitSections, fenceFor } = require('./intent-redact.cjs');
const { loadDevices, openPrivate, devicesDir } = require('./intent-devices.cjs');
const { parseIntentFrontmatter } = require('./intent-validate.cjs');
const { loadLedger, findRow, updateRow, writeLedger, withLedgerLock } = require('./intent-ledger.cjs');
const { openRunOutput } = require('./intent-run.cjs');
const { requireExecutorHost, locateLifecycleFile, rewriteFrontmatter, decide, decideError, emit, freeRejectedPath } = require('./intent-lifecycle.cjs');

const [EXIT_OK, EXIT_REFUSED, EXIT_OPERATOR] = [0, 1, 2];
const [SUMMARY_LINES, STDERR_LINES] = [40, 20];
const OUTPUT_READ_MAX_BYTES = 4 * 1024 * 1024; // tail of stdout/stderr that is read at all
const SNAPSHOT_READ_MAX_BYTES = 16 * 1024 * 1024;
const SNAPSHOT_HASH_MAX_BYTES = 1024 * 1024; // larger files compare by size + mtime only
const SNAPSHOT_MAX_FILES = 20000;
const ARTIFACTS_PRETRIM = 400;
const OPEN_FLAGS = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
const [EXIT_CODE_RE, EXIT_CODE_MAX] = [/^(0|[1-9][0-9]{0,2})$/, 255];
const RESULT_KEYS = Object.freeze(['type', 'schema_version', 'intent_id', 'action', 'project', 'target', 'status',
  'failure_reason', 'started_at', 'finished_at', 'duration_s', 'exit_code', 'executor_host', 'branch', 'worktree_path', 'artifacts', 'truncated']);
const FLAGS = Object.freeze({
  '--exit-code': 'exitCode', '--stdout': 'stdoutFile', '--stderr': 'stderrFile',
  '--snapshot': 'snapshotFile', '--failure-reason': 'failureReason',
});
const USAGE = 'intent complete <path> --exit-code <0-255|null> --stdout <file> --stderr <file> [--snapshot <file>] [--failure-reason <code>]';

const defaultDeps = () => ({
  hostname: os.hostname(), homedir: os.homedir, now: Date.now, rename: fs.renameSync, writeText: writeTextAtomic,
  vault: process.env.A1_VAULT_ROOT || null, envSecrets: [],
});

const [sha256, byteLen] = [(t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex'), (t) => Buffer.byteLength(t, 'utf8')];
const usageResult = (why) => Object.freeze({ exitCode: EXIT_OPERATOR, out: null, usage: why });

// ---------- bounded reads ----------
// The last `maxBytes` of a regular file (never a link, FIFO or directory).
function readOutput(file, maxBytes = OUTPUT_READ_MAX_BYTES) {
  const fd = fs.openSync(file, OPEN_FLAGS);
  try {
    return readOutputFd(fd, maxBytes);
  } finally {
    fs.closeSync(fd);
  }
}

function readOutputFd(fd, maxBytes = OUTPUT_READ_MAX_BYTES) {
  const st = fs.fstatSync(fd);
  if (!st.isFile()) throw Object.assign(new Error('not a regular file'), { code: 'A1_NOT_REGULAR' });
  const start = Math.max(0, st.size - maxBytes);
  const buf = Buffer.alloc(st.size - start);
  const n = buf.length === 0 ? 0 : fs.readSync(fd, buf, 0, buf.length, start);
  return Object.freeze({ text: buf.subarray(0, n).toString('utf8'), cut: start > 0 });
}

// The claimed file's bytes, or null when it is too large to be one a1 wrote.
function readClaimed(file) {
  const r = readOutput(file, INTENT_CLAIMED_MAX_BYTES);
  return r.cut ? null : r.text;
}

// ---------- artifacts: vault snapshot of project/<slug>/ (FR-030) ----------
// Hashed through one fd (O_NOFOLLOW|O_NONBLOCK), never re-read by path: an
// entry swapped for a FIFO or a link after the lstat is skipped (null).
function fileEntry(abs) {
  const fd = fs.openSync(abs, OPEN_FLAGS);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return null;
    const hash = st.size <= SNAPSHOT_HASH_MAX_BYTES ? crypto.createHash('sha256') : null;
    const buf = Buffer.alloc(hash ? Math.min(st.size, 64 * 1024) || 1 : 0);
    for (let n = hash ? fs.readSync(fd, buf, 0, buf.length, null) : 0; n > 0; n = fs.readSync(fd, buf, 0, buf.length, null)) hash.update(buf.subarray(0, n));
    return Object.freeze({ size: st.size, mtimeMs: st.mtimeMs, sha256: hash ? hash.digest('hex') : null });
  } catch (e) {
    if (e && ['ELOOP', 'EMLINK', 'ENOENT', 'ENXIO'].includes(e.code)) return null;
    throw e;
  } finally {
    fs.closeSync(fd);
  }
}

// Regular files only, links never followed, sorted, at most SNAPSHOT_MAX_FILES.
function walkFiles(absDir, relDir, acc) {
  if (acc.length >= SNAPSHOT_MAX_FILES) return acc;
  const names = fs.readdirSync(absDir).sort();
  return names.reduce((out, name) => {
    if (out.length >= SNAPSHOT_MAX_FILES || name.includes('.tmp.')) return out;
    const abs = path.join(absDir, name);
    const rel = `${relDir}/${name}`;
    const st = fs.lstatSync(abs);
    if (st.isDirectory()) return walkFiles(abs, rel, out);
    const entry = st.isFile() ? fileEntry(abs) : null;
    return entry ? [...out, [rel, entry]] : out;
  }, acc);
}

// -> { project, files: { 'project/<slug>/…': { size, mtimeMs, sha256 } } }
function snapshotProject(slug, deps = {}) {
  const vault = deps.vault || process.env.A1_VAULT_ROOT;
  if (!vault) throw new Error('snapshotProject: A1_VAULT_ROOT is not set');
  assertSafeSegment(slug, 'project slug');
  const root = path.join(vault, 'project', slug);
  const st = fs.lstatSync(root, { throwIfNoEntry: false });
  const entries = st && st.isDirectory() ? walkFiles(root, `project/${slug}`, []) : [];
  return Object.freeze({ project: slug, files: Object.freeze(Object.fromEntries(entries)) });
}

const sameEntry = (a, b) => a.size === b.size && a.mtimeMs === b.mtimeMs && a.sha256 === b.sha256;

// Paths created or modified between the two snapshots, sorted.
function diffSnapshots(before, after) {
  return Object.keys(after.files).filter((rel) => {
    const was = Object.prototype.hasOwnProperty.call(before.files, rel) ? before.files[rel] : null;
    return was === null || !sameEntry(was, after.files[rel]);
  }).sort();
}

const isEntry = (e) => e !== null && typeof e === 'object' && Number.isFinite(e.size) && Number.isFinite(e.mtimeMs)
  && (e.sha256 === null || typeof e.sha256 === 'string');

// The snapshot's directory must lie in ~/.a1-intents (private, checked by
// requireExecutorHost) and the file must be a private regular file.
function snapshotInPrivateDir(file, d) {
  const home = fs.realpathSync(devicesDir(d.homedir));
  const parent = fs.realpathSync(path.dirname(path.resolve(file)));
  return parent === home || parent.startsWith(home + path.sep);
}

// -> the snapshot document, or { error } for a usage error.
function loadSnapshot(file, d) {
  let doc;
  try {
    if (!snapshotInPrivateDir(file, d)) return { error: '--snapshot must lie under ~/.a1-intents' };
    const fd = openPrivate(file, 'file', d, (why) => Object.assign(new Error(why), { code: 'A1_SNAPSHOT_UNSAFE' }));
    if (fd === null) return { error: '--snapshot file does not exist' };
    fs.closeSync(fd);
    const r = readOutput(file, SNAPSHOT_READ_MAX_BYTES);
    doc = r.cut ? null : JSON.parse(r.text);
  } catch (e) {
    if (e && e.code === 'A1_SNAPSHOT_UNSAFE') return { error: `--snapshot is not a private file (${e.message})` };
    return { error: `--snapshot ${e.code === 'ENOENT' ? 'file does not exist' : 'is not a readable JSON file'}` };
  }
  const files = doc && typeof doc === 'object' ? doc.files : null;
  const ok = doc && typeof doc.project === 'string' && files && typeof files === 'object' && !Array.isArray(files)
    && Object.entries(files).every(([k, v]) => k.startsWith(`project/${doc.project}/`) && isEntry(v));
  return ok ? Object.freeze({ project: doc.project, files }) : { error: '--snapshot is not a project snapshot' };
}

// ---------- the note (FR-030) ----------
function outcomeOf(exitCode, failureReason) {
  if (failureReason) return Object.freeze({ status: 'failed', failure_reason: failureReason });
  if (exitCode === 0) return Object.freeze({ status: 'done', failure_reason: null });
  return Object.freeze({ status: 'failed', failure_reason: 'nonzero_exit' });
}

function serializeResultFm(fm) {
  const lines = RESULT_KEYS.map((k) => {
    const v = fm[k];
    if (!Array.isArray(v)) return `${k}: ${serializeScalar(v)}`;
    return v.length === 0 ? `${k}: []` : [`${k}:`, ...v.map((x) => `  - ${serializeScalar(x)}`)].join('\n');
  });
  return `---\n${lines.join('\n')}\n---\n`;
}

const block = (fence, lines) => `${fence}\n${lines.length === 0 ? '' : `${lines.join('\n')}\n`}${fence}\n`;

function renderNote(fm, summary, stderr, fences) {
  return `${serializeResultFm(fm)}\n## Summary\n\n${block(fences[0], summary)}\n## Stderr\n\n${block(fences[1], stderr)}`;
}

// Artifacts may fill at most half of the note; the body gets the rest.
function capArtifacts(fm) {
  let list = fm.artifacts.slice(0, ARTIFACTS_PRETRIM);
  while (list.length > 0 && byteLen(serializeResultFm({ ...fm, artifacts: list })) > INTENT_RESULT_MAX_BYTES / 2) list = list.slice(0, -1);
  return Object.freeze({ list, cut: list.length < fm.artifacts.length });
}

function resultFrontmatter(input) {
  const { fm, row, outcome, exitCode, artifacts, finishedAt, hostname, worktree = null } = input;
  const startedAt = row.started_at || row.claimed_at || null;
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  return Object.freeze({
    type: 'intent-result', schema_version: 1, intent_id: fm.id, action: fm.action, project: fm.project,
    target: fm.target === undefined ? null : fm.target, status: outcome.status, failure_reason: outcome.failure_reason,
    started_at: startedAt, finished_at: finishedAt, duration_s: Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : null,
    exit_code: exitCode, executor_host: hostname, branch: worktree ? worktree.branch : null,
    worktree_path: worktree ? worktree.worktree_path : null, artifacts, truncated: false,
  });
}

// -> the whole note text, <= INTENT_RESULT_MAX_BYTES (else it throws). The
// outputs come prepared (prepareOutput): filtered first, then cut.
function buildResultNote(input) {
  const [summaryAll, stderrAll] = [input.stdout.lines, input.stderr.lines];
  const fences = [fenceFor(summaryAll), fenceFor(stderrAll)];
  const base = resultFrontmatter(input);
  const arts = capArtifacts(base);
  const fm = { ...base, artifacts: arts.list }; // truncated: false is the longer spelling
  const fit = fitSections([summaryAll, stderrAll], INTENT_RESULT_MAX_BYTES - byteLen(renderNote(fm, [], [], fences)));
  const truncated = arts.cut || fit.cut || input.stdout.cut || input.stderr.cut;
  const note = renderNote({ ...fm, truncated }, fit.summary, fit.stderr, fences);
  if (byteLen(note) > INTENT_RESULT_MAX_BYTES) throw new Error('buildResultNote: the frontmatter alone exceeds INTENT_RESULT_MAX_BYTES');
  return note;
}

// ---------- complete (FR-029) ----------
function refuse(d, intentId, reason, detail) {
  return decide(d, 'complete', EXIT_REFUSED, { completed: false, reasons: [reason] }, { intentId, outcome: 'refused', reason, detail });
}

// null when the claimed bytes are the ones recorded at claim time.
function tamperDetail(content, row) {
  if (row === null) return 'no_ledger_row';
  if (row.finished_at !== null && row.finished_at !== undefined) return 'row_closed';
  if (content === null) return 'not_readable';
  if (sha256(content) !== row.claimed_sha256) return 'sha_mismatch';
  const parsed = parseIntentFrontmatter(content);
  const known = parsed.ok && parsed.fm.id === row.id && ACTION_TABLE[parsed.fm.action] !== undefined;
  return known ? null : 'unparsable';
}

function intentPatch(outcome, finishedAt, exitCode) {
  const failure = outcome.failure_reason === null ? {} : { failure_reason: outcome.failure_reason };
  return { status: outcome.status, finished_at: finishedAt, exit_code: exitCode, ...failure };
}

// MINOR-E: a done/<id>.md that is not ours (a1 writes it only after the
// ledger row, which is still open) is moved to rejected/, never overwritten.
function clearDoneSlot(dest, loc, d) {
  if (!fs.lstatSync(dest, { throwIfNoEntry: false })) return null;
  d.rename(dest, freeRejectedPath(loc.root, `${path.basename(dest, '.md')}.done-conflict.md`, d));
  return 'done_conflict_moved';
}

// FR-043 (e) — the intent worktree of a write action: its branch and path for
// the note before, the registry update after the ledger closed. A registry
// problem never undoes a completed intent; it is named in the log detail.
function worktreeOf(fm) {
  if (!INTENT_WRITE_ACTIONS.includes(fm.action)) return { info: null, problem: null };
  try {
    return { info: require('./intent-worktree.cjs').intentWorktreeInfo(fm.id), problem: null };
  } catch (e) {
    return { info: null, problem: `registry_unreadable: ${String(e && e.message).slice(0, 120)}` };
  }
}

function finishWorktree(fm, outcome) {
  if (!INTENT_WRITE_ACTIONS.includes(fm.action)) return null;
  try {
    require('./intent-worktree.cjs').finishIntentWorktree(fm.id, outcome.status, outcome.failure_reason);
    return null;
  } catch (e) {
    return `registry_update_failed: ${String(e && e.message).slice(0, 120)}`;
  }
}

function finishIntent(ctx, d) {
  const { loc, fm, row, rows, opts, inputs, content } = ctx;
  const dest = path.join(loc.root, 'done', path.basename(loc.path));
  const notePath = projectsPath(fm.project, 'intents', `${fm.id}.md`);
  try {
    assertVaultWriteContained(notePath);
  } catch (_e) {
    return refuse(d, fm.id, 'result_path_unsafe'); // a linked folder on the way out of the vault
  }
  const moved = clearDoneSlot(dest, loc, d);
  const finishedAt = new Date(d.now()).toISOString();
  const artifacts = inputs.snapshot ? diffSnapshots(inputs.snapshot, snapshotProject(fm.project, d)) : [];
  const claude = ACTION_TABLE[fm.action].kind === 'claude' ? inputs.claude : null;
  const outcome = outcomeOf(opts.exitCode, opts.failureReason || (claude && claude.isError ? CLAUDE_ERROR_REASON : undefined));
  const worktree = worktreeOf(fm);
  const note = buildResultNote({
    fm, row, outcome, exitCode: opts.exitCode, stdout: claude ? claude.summary : inputs.stdout, stderr: inputs.stderr, artifacts, finishedAt, hostname: d.hostname, worktree: worktree.info,
  });
  const resultPath = `project/${fm.project}/intents/${fm.id}.md`;
  d.writeText(notePath, note);
  try {
    d.rename(loc.path, dest);
  } catch (e) {
    if (e && e.code === 'ENOENT') return refuse(d, fm.id, 'already_moved');
    throw e;
  }
  const doneText = rewriteFrontmatter(content, intentPatch(outcome, finishedAt, opts.exitCode));
  d.writeText(dest, doneText);
  // FR-034 (Wave 8): file_sha256 = the bytes a1 wrote last, for list's tamper state
  const closing = { finished_at: finishedAt, outcome: outcome.status, result_path: resultPath, result_sha256: sha256(note), file_sha256: sha256(doneText) };
  writeLedger(updateRow(rows, fm.id, closing), { homedir: d.homedir });
  const detail = [moved, worktree.problem, finishWorktree(fm, outcome)].filter(Boolean).join('; ') || undefined;
  const out = { completed: true, id: fm.id, status: outcome.status, failure_reason: outcome.failure_reason, result_path: resultPath, path: dest };
  return decide(d, 'complete', EXIT_OK, out, { intentId: fm.id, outcome: outcome.status, reason: outcome.failure_reason, detail });
}

function completeLocked(loc, opts, inputs, d) {
  const stem = path.basename(loc.path, '.md');
  const content = readClaimed(loc.path);
  const { rows } = loadLedger({ homedir: d.homedir });
  const row = INTENT_ID_RE.test(stem) ? findRow(rows, stem) : null;
  const detail = tamperDetail(content, row);
  if (detail !== null) return refuse(d, stem, 'tampered', detail);
  const { fm } = parseIntentFrontmatter(content);
  if (ACTION_TABLE[fm.action].kind === 'queue-control') {
    const why = `intent complete: ${fm.action} intents get no result note; tick finishes them`;
    return Object.freeze({ ...decide(d, 'complete', EXIT_OPERATOR, null, { intentId: fm.id, outcome: 'refused', reason: 'queue_control' }), usage: why });
  }
  if (inputs.snapshot && inputs.snapshot.project !== fm.project) return usageResult('intent complete: --snapshot belongs to another project');
  return finishIntent({ loc, fm, row, rows, opts, inputs, content }, d);
}

// FR-049 — only a private file of the intent's own run directory, read
// through the one descriptor openRunOutput checked.
function readOutputFile(flag, file, id, d) {
  const opened = openRunOutput(file, id, { homedir: d.homedir });
  if (!opened.ok) return { ok: false, why: `intent complete: ${flag} ${opened.why}` };
  try {
    return { ok: true, value: readOutputFd(opened.fd) };
  } finally {
    fs.closeSync(opened.fd);
  }
}

// FR-030 (part B review M2, measured in RESEARCH.md round 1, P1-P8): a
// `claude -p --output-format json` child prints ONE JSON object with
// subtype, is_error, num_turns, result, permission_denials, session_id.
// When stdout (not cut) is exactly such an object, the Summary is its
// `result` text; is_error true marks the intent failed (P12: exit 1 with
// is_error true). -> { text, isError } | null.
const CLAUDE_ERROR_REASON = 'nonzero_exit'; // the closest existing failure reason: the child reported an error
function claudeResult(read) {
  const text = read.cut ? '' : read.text.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return null;
  let o;
  try {
    o = JSON.parse(text);
  } catch (_e) {
    return null;
  }
  const shaped = o && typeof o === 'object' && !Array.isArray(o) && typeof o.subtype === 'string' && typeof o.is_error === 'boolean'
    && typeof o.result === 'string' && typeof o.session_id === 'string';
  return shaped ? { text: o.result, isError: o.is_error } : null;
}

// stdout, stderr and the snapshot, read after the host check and filtered
// with the device secrets (fail closed: A1_DEVICES_UNREADABLE) before the lock.
function readInputs(opts, id, d) {
  const [stdout, stderr] = [readOutputFile('--stdout', opts.stdoutFile, id, d), readOutputFile('--stderr', opts.stderrFile, id, d)];
  const snapshot = opts.snapshotFile === undefined ? null : loadSnapshot(opts.snapshotFile, d);
  const failed = [stdout, stderr].find((r) => !r.ok);
  if (failed) return failed;
  if (snapshot && snapshot.error) return { ok: false, why: `intent complete: ${snapshot.error}` };
  const secrets = knownSecrets(loadDevices({ homedir: d.homedir }), d.envSecrets); // FR-049: run passes spawnEnvSecrets(env)
  const cr = claudeResult(stdout.value);
  const claude = cr ? { summary: prepareOutput({ text: cr.text, cut: false }, secrets, SUMMARY_LINES), isError: cr.isError } : null;
  return { ok: true, stdout: prepareOutput(stdout.value, secrets, SUMMARY_LINES), stderr: prepareOutput(stderr.value, secrets, STDERR_LINES), claude, snapshot };
}

// Ledger errors refuse (1); a corrupt executor.json or devices.json and an
// unsafe ~/.a1-intents are exit 2 (decideError); the rest is rethrown.
function completeError(d, name, e) {
  const code = e && e.code;
  if (code === 'A1_LEDGER_UNREADABLE') return refuse(d, name, 'ledger_unreadable');
  if (code === 'A1_LEDGER_BUSY') return refuse(d, name, 'ledger_busy');
  return decideError(d, 'complete', name, e);
}

// FR-029 -> { exitCode, out, usage?, stderr? }; opts come checked from parseCompleteArgs.
function completeIntent(filePath, opts, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const name = path.basename(String(filePath));
  try {
    if (requireExecutorHost(d) === null) return refuse(d, name, 'not_executor_host');
    const loc = locateLifecycleFile(filePath, ['claimed'], d.vault);
    if (!loc.ok || loc.missing) return usageResult(`intent complete: ${loc.ok ? 'no such file' : loc.why}`);
    const inputs = readInputs(opts, path.basename(loc.path, '.md'), d);
    if (!inputs.ok) return usageResult(inputs.why);
    return withLedgerLock(() => completeLocked(loc, opts, inputs, d), { homedir: d.homedir, hostname: d.hostname, now: d.now });
  } catch (e) {
    return completeError(d, name, e);
  }
}

// ---------- CLI ----------
function checkOpts(o) {
  if (!o.stdoutFile || !o.stderrFile || o.exitCode === undefined) return 'needs --exit-code, --stdout and --stderr';
  const code = o.exitCode === 'null' ? null : EXIT_CODE_RE.test(o.exitCode) && Number(o.exitCode) <= EXIT_CODE_MAX ? Number(o.exitCode) : undefined;
  if (code === undefined) return '--exit-code must be 0-255 or null';
  if (o.failureReason !== undefined && !INTENT_FAILURE_REASONS.has(o.failureReason)) {
    return `--failure-reason must be one of ${[...INTENT_FAILURE_REASONS].join(', ')}`;
  }
  if (o.failureReason === 'nonzero_exit' && (code === 0 || code === null)) return '--failure-reason nonzero_exit needs a nonzero --exit-code';
  if (code === null && (o.failureReason === undefined || o.failureReason === 'nonzero_exit')) return '--exit-code null needs a --failure-reason';
  return { ...o, exitCode: code };
}

// -> { path, opts } | { why }.
function parseCompleteArgs(args) {
  const found = args.reduce((acc, a, i) => {
    if (acc.why || acc.skip === i) return acc;
    if (Object.prototype.hasOwnProperty.call(FLAGS, a)) {
      const key = FLAGS[a];
      if (args[i + 1] === undefined || acc.opts[key] !== undefined) return { why: `${a} needs exactly one value` };
      return { ...acc, skip: i + 1, opts: { ...acc.opts, [key]: args[i + 1] } };
    }
    if (a.startsWith('-')) return { why: `unknown flag ${JSON.stringify(a.slice(0, 32))}` };
    return { ...acc, paths: [...acc.paths, a] };
  }, { opts: {}, paths: [], skip: -1 });
  if (found.why) return found;
  if (found.paths.length !== 1) return { why: 'exactly one claimed/ intent file' };
  const opts = checkOpts(found.opts);
  return typeof opts === 'string' ? { why: opts } : { path: found.paths[0], opts };
}

// `a1-tools intent complete <path> --exit-code <n> --stdout <f> --stderr <f> …`
function cmdIntentComplete(args) {
  const parsed = parseCompleteArgs(args);
  if (parsed.why) return emit(usageResult(`${USAGE} (${parsed.why})`));
  return emit(completeIntent(parsed.path, parsed.opts));
}

module.exports = {
  RESULT_KEYS, // Wave 9: the result-note key order, exported for intent-schema.cjs
  redact, filterOutput, prepareOutput, tailLines, readOutput, snapshotProject, diffSnapshots, buildResultNote, completeIntent, cmdIntentComplete,
};
