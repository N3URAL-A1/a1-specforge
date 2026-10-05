'use strict';

// ---------------------------------------------------------------------------
// intent-tick — `a1-tools intent tick` and `intent watch` (spec 011, Wave 8:
// FR-032, FR-009), the one-shot executor entry point launchd calls.
//
// tick: executor host (FR-017) before anything is listed -> the four
// lifecycle folders exist -> one pass over queued/ (oldest created_at first,
// then filename; a file whose created_at does not parse sorts by name after
// the others), sync-conflict copies never touched (vault-common
// isConflictCopy, FR-009): each file is claimed (FR-018) or, when claim
// refuses it with an FR-016 reason, rejected (FR-019). A claim refused with
// already_claimed or ledger_busy leaves the file for the next tick; a
// ledger_unreadable or not_executor_host refusal ends the pass (an operator
// problem, never the intent's fault). Then every claimed queue-control
// intent (approve, cancel) is applied BEFORE any run, so a cancel that
// arrived with its target wins; then, if no run holds the executor lock,
// the oldest claimed intent runs (FR-020..FR-029) — one spawn at most, and
// tick returns only after that run returned.
//
// Apply (spec rounds 3 and 6): a target equal to the intent's own id ->
// target_not_found. cancel -> intent-lifecycle cancelTarget (queued/claimed
// -> rejected cancelled_by_user; the running intent -> marker + kill;
// done/rejected -> target_not_found). approve -> intent-approve
// reapproveIntent with via "intent" and the approve's signed target_sha256
// as expectSha256 (never null): a mismatch at apply time (already_moved) or
// a missing target -> target_not_found; an approve/cancel target or one the
// TTY path refuses as display_unsafe -> target_invalid. Either way the
// queue-control intent then reaches done/ ONLY through finishQueueControl
// (no result note; `intent complete` refuses it), or rejected/ with the code.
//
// applyCancelFor(id) is the scan of `run`'s cancel poll (intent-run.cjs):
// only a cancel whose target is the running id is claimed; nothing else in
// queued/ is validated, claimed or rejected, and a cancel that fails
// validation stays in queued/ for the next tick's normal pass.
//
// watch --interval <s>: tick, then the next tick after <s> seconds, until
// SIGTERM/SIGINT; a signal while idle ends it with exit 0 (during a run,
// run's own stop-signal handling applies, Wave 7).
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');

const { isConflictCopy } = require('./vault-common.cjs');
const { INTENT_ID_RE, ACTION_TABLE } = require('./intent-constants.cjs');
const { INTENT_REJECT_REASONS } = require('./status-constants.cjs');

const FOLDERS = Object.freeze(['queued', 'claimed', 'done', 'rejected']);
const INTENTS_DIR = path.join('inbox', 'intents');
const [EXIT_OK, EXIT_REFUSED, EXIT_OPERATOR] = [0, 1, 2];
const STOP_REFUSALS = Object.freeze(new Set(['ledger_unreadable', 'not_executor_host'])); // end the pass
const RUN_STOP_REASONS = Object.freeze(new Set(['executor_busy', 'rate_limited', 'ledger_busy', 'ledger_unreadable', 'not_executor_host']));
const APPROVE_NOT_FOUND = Object.freeze(new Set(['target_not_found', 'already_moved']));
const APPROVE_INVALID = Object.freeze(new Set(['target_invalid', 'display_unsafe'])); // the action filter and the display refusal (Reinhard m3)
const APPLY_LEASE_MS = 10 * 60 * 1000; // an .applying marker older than this belongs to a crashed apply
const CANCEL_HEAD_BYTES = 1024; // the poll's pre-filter reads at most this much of a queued file (Samuel s3)
const WATCH_INTERVAL_RE = /^[1-9][0-9]{0,5}$/;

const tickDeps = (deps = {}) => ({
  hostname: os.hostname(), homedir: os.homedir, now: Date.now, vault: process.env.A1_VAULT_ROOT || null,
  runIntent: (file, runDeps) => require('./intent-run.cjs').runIntent(file, runDeps),
  runDeps: {},
  beforeApply: () => {}, // fixture seam (library calls only): after the claims, before an approve is applied
  beforeVerify: () => {}, // fixture seam (library calls only): between listing a claimed note and verifying it
  beforeFinish: () => {}, // fixture seam (library calls only): after an applied effect, before the move to done/
  afterEffect: () => {}, // fixture seam (library calls only): right after a successful effect, before its .applied marker
  ...deps,
});
const lifeDeps = (d) => ({ hostname: d.hostname, homedir: d.homedir, now: d.now, vault: d.vault });
const isQueueControl = (fm) => ACTION_TABLE[fm.action] !== undefined && ACTION_TABLE[fm.action].kind === 'queue-control';
const firstReason = (r) => (r && r.out && Array.isArray(r.out.reasons) ? r.out.reasons[0] : null);

function logTick(d, outcome, reason, extra = {}) {
  require('./intent-log.cjs').logDecision({ command: 'tick', intentId: null, outcome, reason, hostname: d.hostname, ...extra }, { homedir: d.homedir, now: d.now });
}

// The frontmatter of one lifecycle file (bounded read), {} when unreadable;
// an error other than a vanished file is logged (Reinhard n1).
function readFm(file, d) {
  const { readIntentFile, parseIntentFrontmatter } = require('./intent-validate.cjs');
  try {
    const read = readIntentFile(file, { maxBytes: require('./intent-constants.cjs').INTENT_CLAIMED_MAX_BYTES });
    const parsed = read.ok ? parseIntentFrontmatter(read.content) : { ok: false };
    return parsed.ok ? parsed.fm : {};
  } catch (e) {
    if (e && e.code !== 'ENOENT' && d) logTick(d, 'error', null, { intentId: null, detail: `read ${path.basename(file)}: ${String(e.code || e.message).slice(0, 80)}` });
    return {};
  }
}

// The regular, non-conflict .md files of one folder, oldest created_at
// first, then by name; an unparsable created_at after the rest, by name.
function listFolder(root, folder, d = null) {
  const dir = path.join(root, folder);
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md') && !isConflictCopy(e.name))
    .map((e) => {
      const file = path.join(dir, e.name);
      const fm = readFm(file, d);
      const t = typeof fm.created_at === 'string' ? Date.parse(fm.created_at) : NaN;
      return { name: e.name, file, fm, t: Number.isFinite(t) ? t : Infinity };
    });
  const cmp = (x, y) => (x === y ? 0 : x < y ? -1 : 1);
  return entries.sort((a, b) => cmp(a.t, b.t) || cmp(a.name, b.name));
}

function ensureFolders(root) {
  for (const f of FOLDERS) fs.mkdirSync(path.join(root, f), { recursive: true });
}

// One queued file: claim, or reject with claim's own FR-016 reason.
// -> { claimed?, rejected?, skipped?, stop? }.
function passFile(entry, d) {
  const { claimIntent, rejectIntent } = require('./intent-lifecycle.cjs');
  const c = claimIntent(entry.file, lifeDeps(d));
  if (c.exitCode === EXIT_OK) return c.out && c.out.claimed ? { claimed: c.out.id } : { skipped: 'vanished' };
  const reason = firstReason(c);
  if (c.exitCode !== EXIT_REFUSED || reason === null) return { stop: c.usage || c.stderr || 'claim_error' };
  if (STOP_REFUSALS.has(reason)) return { stop: reason };
  if (!INTENT_REJECT_REASONS.has(reason)) return { skipped: reason }; // a refusal code (already_claimed, ledger_busy): left for the next tick
  const r = rejectIntent(entry.file, reason, lifeDeps(d));
  return r.exitCode === EXIT_OK ? { rejected: reason } : { skipped: firstReason(r) || 'reject_refused' };
}

// <root>/<folder>/<id>.md of the first folder holding it as a regular file.
function findTarget(root, id, folders) {
  if (typeof id !== 'string' || !INTENT_ID_RE.test(id)) return null;
  for (const folder of folders) {
    const file = path.join(root, folder, `${id}.md`);
    const st = fs.lstatSync(file, { throwIfNoEntry: false });
    if (st && st.isFile()) return file;
  }
  return null;
}

// FR-032 (spec round 3) — the only way a queue-control intent reaches done/.
function finishQueueControl(claimedPath, deps = {}) {
  const d = tickDeps(deps);
  const L = require('./intent-lifecycle.cjs');
  const name = path.basename(String(claimedPath));
  try {
    const loc = L.locateLifecycleFile(claimedPath, ['claimed'], d.vault);
    if (!loc.ok || loc.missing) return L.decide(d, 'finish', EXIT_REFUSED, { finished: false, reasons: ['already_moved'] }, { intentId: name, outcome: 'refused', reason: 'already_moved' });
    return require('./intent-ledger.cjs').withLedgerLock(() => finishLocked(loc, d), { homedir: d.homedir, hostname: d.hostname, now: d.now });
  } catch (e) {
    return L.decideError(d, 'finish', name, e);
  }
}

function finishLocked(loc, d) {
  const L = require('./intent-lifecycle.cjs');
  const { loadLedger, findRow, updateRow, writeLedger } = require('./intent-ledger.cjs');
  const { readClaimedFile, tamperDetail, sha256 } = require('./intent-run.cjs');
  const stem = path.basename(loc.path, '.md');
  const content = readClaimedFile(loc.path);
  const { rows } = loadLedger({ homedir: d.homedir });
  const detail = tamperDetail(content, INTENT_ID_RE.test(stem) ? findRow(rows, stem) : null);
  if (detail !== null) return L.decide(d, 'finish', EXIT_REFUSED, { finished: false, reasons: ['tampered'] }, { intentId: stem, outcome: 'refused', reason: 'tampered', detail });
  const fm = require('./intent-validate.cjs').parseIntentFrontmatter(content).fm || {};
  if (!isQueueControl(fm)) return Object.freeze({ exitCode: EXIT_OPERATOR, out: null, usage: 'finishQueueControl: only approve and cancel intents' });
  const dest = path.join(loc.root, 'done', path.basename(loc.path));
  if (fs.lstatSync(dest, { throwIfNoEntry: false })) fs.renameSync(dest, L.freeRejectedPath(loc.root, `${stem}.done-conflict.md`, d));
  try {
    fs.renameSync(loc.path, dest);
  } catch (e) {
    if (e && e.code === 'ENOENT') return L.decide(d, 'finish', EXIT_REFUSED, { finished: false, reasons: ['already_moved'] }, { intentId: stem, outcome: 'refused', reason: 'already_moved' });
    throw e;
  }
  const finishedAt = new Date(d.now()).toISOString();
  const text = L.rewriteFrontmatter(content, { status: 'done', finished_at: finishedAt });
  require('./io.cjs').writeTextAtomic(dest, text);
  const closing = { finished_at: finishedAt, outcome: 'done', result_path: null, result_sha256: null, file_sha256: sha256(text) };
  writeLedger(updateRow(rows, stem, closing), { homedir: d.homedir });
  return L.decide(d, 'finish', EXIT_OK, { finished: true, id: stem, path: dest }, { intentId: stem, outcome: 'done', reason: null, detail: fm.action });
}

// ---------- queue-control apply (spec rounds 3 and 6; W8 review round) ----------
// One note in claimed/ goes through these steps, each recorded so that no
// step is silently re-attempted on every tick (Samuel BLOCKER-1 and s4,
// Reinhard m2):
//   1. verifyControl reads the note ONCE (O_NOFOLLOW, size cap) and, under
//      the ledger lock, binds it to its OPEN row (claimed_sha256 = those
//      bytes, its id and action, claimed_by = this host). Unverified ->
//      rejected/ tampered, once; the target is never touched.
//   2. the effect, from exactly the verified fields. A target problem the
//      spec names -> rejected/ with that code; anything else (a refusal code,
//      an internal error) leaves the note claimed and logged (Reinhard m3).
//   3. the apply state lives in two marker files beside the run dirs,
//      ~/.a1-intents/runs/<id>.applying and <id>.applied (Samuel r1,
//      Reinhard r1). verifyControl creates <id>.applying (O_EXCL) in the SAME
//      ledger-lock section as the verification, so two processes can never
//      both verify and apply one note; a fresh .applying elsewhere -> skipped.
//      The effect itself cannot sit in that section (reapproveIntent and
//      cancelTarget take the ledger lock themselves), so the claim marker comes
//      BEFORE the effect. After a successful effect .applying is renamed to
//      .applied, which needs no lock: a busy ledger cannot lose it. From then
//      on the effect is never repeated; a later tick only retries step 4. A
//      refused or failed effect removes .applying again. An .applying older
//      than APPLY_LEASE_MS is a crashed apply and is taken over (the effect
//      may repeat once, which ends as target_not_found).
//   4. finishQueueControl moves it to done/; refused as tampered (the bytes
//      changed after step 1) -> rejected/ tampered (s4); refused otherwise
//      (ledger_busy) -> retried next tick, effect not repeated.

const markerPath = (stem, kind, d) => path.join(d.homedir(), '.a1-intents', 'runs', `${stem}.${kind}`);
const dropMarker = (stem, kind, d) => fs.rmSync(markerPath(stem, kind, d), { force: true });

// The marker holds the sha256 of the verified note bytes (Samuel W8 m1): an
// .applied counts only as a regular file (never a link) with exactly that
// content; anything else is planted or stale and is removed.
function markerHolds(file, noteSha) {
  const st = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!st) return false;
  const ok = st.isFile() && st.size === noteSha.length && fs.readFileSync(file, 'utf8') === noteSha;
  if (!ok) fs.rmSync(file, { force: true });
  return ok;
}

// Under the ledger lock, right after the verification: 'applied' (only the
// finish is left), 'busy' (a fresh .applying of another process) or 'mine'
// (this process now holds .applying; takeover when it replaced a stale one).
function claimApply(stem, noteSha, d) {
  if (markerHolds(markerPath(stem, 'applied', d), noteSha)) return { state: 'applied' };
  const applying = markerPath(stem, 'applying', d);
  const st = fs.lstatSync(applying, { throwIfNoEntry: false });
  if (st && d.now() - st.mtimeMs < APPLY_LEASE_MS) return { state: 'busy' };
  if (st) fs.rmSync(applying, { force: true }); // a crashed apply: taken over
  fs.mkdirSync(path.dirname(applying), { recursive: true, mode: 0o700 });
  let fd;
  try {
    fd = fs.openSync(applying, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  } catch (e) {
    if (e && e.code === 'EEXIST') return { state: 'busy' };
    throw e;
  }
  try {
    fs.writeSync(fd, noteSha);
  } finally {
    fs.closeSync(fd);
  }
  return { state: 'mine', takeover: Boolean(st) };
}

function verifyControl(file, d) {
  const { withLedgerLock, loadLedger, findRow } = require('./intent-ledger.cjs');
  const { readClaimedFile, tamperDetail } = require('./intent-run.cjs');
  const stem = path.basename(file, '.md');
  return withLedgerLock(() => {
    const content = readClaimedFile(file);
    const row = INTENT_ID_RE.test(stem) ? findRow(loadLedger({ homedir: d.homedir }).rows, stem) : null;
    const detail = tamperDetail(content, row);
    if (detail !== null) return { ok: false, detail };
    const parsed = require('./intent-validate.cjs').parseIntentFrontmatter(content);
    const fm = parsed.ok ? parsed.fm : null;
    const mine = fm !== null && fm.id === stem && fm.action === row.action && fm.claimed_by === d.hostname && isQueueControl(fm);
    return mine ? { ok: true, fm, ...claimApply(stem, require('./intent-run.cjs').sha256(content), d) } : { ok: false, detail: 'not_claimed_here' };
  }, { homedir: d.homedir, hostname: d.hostname, now: d.now });
}

// The effect happened: .applying -> .applied (no ledger lock involved).
// -> false when the claim is gone (a takeover that only DELETED it). A takeover that REPLACED it with
// its own fresh .applying is not detected: the effect then runs twice, which is the documented
// harmless residual (the repeat ends as target_not_found) — Reinhard W11 minor.
function markApplied(stem, d) {
  try {
    fs.renameSync(markerPath(stem, 'applying', d), markerPath(stem, 'applied', d));
    return true;
  } catch (e) {
    if (e && e.code === 'ENOENT') return false;
    throw e;
  }
}

const noteOf = (entry, extra) => ({ id: entry.fm.id || entry.name, action: entry.fm.action, ...extra });

function rejectNote(entry, code, d, detail) {
  const stem = path.basename(entry.file, '.md');
  dropMarker(stem, 'applying', d);
  dropMarker(stem, 'applied', d);
  if (detail) logTick(d, 'rejected', code, { intentId: INTENT_ID_RE.test(String(entry.fm.id)) ? entry.fm.id : null, detail });
  const r = require('./intent-lifecycle.cjs').rejectIntent(entry.file, code, lifeDeps(d));
  return noteOf(entry, { applied: false, rejected: code, reject: r.exitCode });
}

// Step 4 (also for a note whose effect an earlier tick already applied).
function finishNote(entry, d) {
  d.beforeFinish(entry);
  const f = finishQueueControl(entry.file, d);
  if (f.exitCode === EXIT_OK) {
    dropMarker(path.basename(entry.file, '.md'), 'applied', d);
    return noteOf(entry, { applied: true, finished: true });
  }
  const reason = firstReason(f) || 'finish_error';
  if (reason === 'tampered') return rejectNote(entry, 'tampered', d, 'queue_control_changed_after_apply');
  logTick(d, 'skipped', null, { intentId: entry.fm.id, detail: `finish refused: ${reason}; applied, retried next tick` });
  return noteOf(entry, { applied: true, finished: false, skipped: reason });
}

// Step 2 for a cancel. -> { code } (null = applied) | { retry }.
function cancelEffect(fm, root, d) {
  const target = fm.target === fm.id ? null : findTarget(root, fm.target, FOLDERS);
  if (target === null) return { code: 'target_not_found' };
  const r = require('./intent-lifecycle.cjs').cancelTarget(target, fm.id, lifeDeps(d));
  return { code: r.ok ? null : 'target_not_found' };
}

// Step 2 for an approve; only the codes the spec names reject the note.
async function approveEffect(entry, root, d) {
  const fm = entry.fm;
  const target = fm.target === fm.id ? null : findTarget(root, fm.target, ['queued', 'rejected']);
  if (target === null) return { code: 'target_not_found' };
  await d.beforeApply({ approve: entry.file, target });
  const { reapproveIntent } = require('./intent-approve.cjs');
  const r = reapproveIntent(target, { via: 'intent', approveId: fm.id, expectSha256: fm.target_sha256 }, lifeDeps(d));
  if (r.exitCode === EXIT_OK) return { code: null };
  const reason = firstReason(r);
  if (APPROVE_NOT_FOUND.has(reason)) return { code: 'target_not_found' };
  if (APPROVE_INVALID.has(reason)) return { code: 'target_invalid' };
  return { retry: reason || String(r.usage || r.stderr || 'approve_error').slice(0, 120) };
}

async function applyOne(entry, root, d) {
  d.beforeVerify(entry);
  const v = verifyControl(entry.file, d);
  if (!v.ok) return rejectNote(entry, 'tampered', d, `queue_control_unverified: ${v.detail}`);
  const verified = { ...entry, fm: v.fm };
  const stem = path.basename(entry.file, '.md');
  if (v.state === 'applied') return finishNote(verified, d);
  if (v.state === 'busy') {
    logTick(d, 'skipped', null, { intentId: verified.fm.id, detail: 'being applied by another process' });
    return noteOf(verified, { applied: false, skipped: 'applying_elsewhere' });
  }
  let e;
  try {
    e = verified.fm.action === 'cancel' ? cancelEffect(verified.fm, root, d) : await approveEffect(verified, root, d);
  } catch (err) {
    dropMarker(stem, 'applying', d);
    throw err;
  }
  if (e.retry) {
    dropMarker(stem, 'applying', d);
    logTick(d, 'skipped', null, { intentId: verified.fm.id, detail: `apply refused: ${e.retry}; stays claimed` });
    return noteOf(verified, { applied: false, skipped: e.retry });
  }
  // Samuel W8 m2: after a takeover the crashed applier may already have acted
  if (e.code !== null) return rejectNote(verified, e.code, d, v.takeover && e.code === 'target_not_found' ? 'effect_may_have_applied' : undefined);
  d.afterEffect(verified);
  if (!markApplied(stem, d)) {
    logTick(d, 'skipped', null, { intentId: verified.fm.id, detail: 'taken over by another process' });
    return noteOf(verified, { applied: true, finished: false, skipped: 'taken_over' });
  }
  return finishNote(verified, d);
}

async function applyQueueControl(root, d) {
  const applied = [];
  for (const entry of listFolder(root, 'claimed', d).filter((e) => isQueueControl(e.fm))) {
    try {
      applied.push(await applyOne(entry, root, d));
    } catch (e) {
      if (!e || e.code !== 'A1_LEDGER_BUSY') throw e;
      applied.push(noteOf(entry, { applied: false, skipped: 'ledger_busy' }));
    }
  }
  return applied;
}

// Cheap pre-filter of the poll (Samuel s3): the first CANCEL_HEAD_BYTES of a
// queued file must hold an `action: cancel` line and the running id.
function headMatches(file, runningId) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const buf = Buffer.alloc(CANCEL_HEAD_BYTES);
    const head = buf.subarray(0, fs.readSync(fd, buf, 0, CANCEL_HEAD_BYTES, 0)).toString('utf8');
    return /^action: "?cancel"?\s*$/m.test(head) && head.includes(runningId);
  } catch (_e) {
    return false; // gone or not a regular file: the next tick's pass decides
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// FR-032 — the cancel scan of run's poll: every queued cancel naming
// `runningId` in turn (Reinhard m1), until one claims and verifies (its
// target read from the claimed bytes, Samuel s1); nothing else in queued/
// is touched. -> true when one was applied (marker only: run kills its own
// groups); its finish is recorded like the tick's (finishNote).
function applyCancelFor(runningId, deps = {}) {
  const d = tickDeps(deps);
  const root = path.join(d.vault, INTENTS_DIR);
  const { claimIntent, cancelTarget } = require('./intent-lifecycle.cjs');
  const dir = path.join(root, 'queued');
  const names = fs.readdirSync(dir).filter((n) => n.endsWith('.md') && !isConflictCopy(n) && headMatches(path.join(dir, n), runningId));
  for (const name of names.sort()) {
    const c = claimIntent(path.join(dir, name), lifeDeps(d));
    if (c.exitCode !== EXIT_OK || !c.out || !c.out.claimed) continue; // invalid: left for the next tick's pass
    const entry = { name, file: c.out.path, fm: {} };
    const v = verifyControl(entry.file, d);
    if (v.ok && v.state === 'mine' && (v.fm.action !== 'cancel' || v.fm.target !== runningId || v.fm.id === runningId)) dropMarker(path.basename(entry.file, '.md'), 'applying', d);
    if (!v.ok || v.state !== 'mine' || v.fm.action !== 'cancel' || v.fm.target !== runningId || v.fm.id === runningId) continue; // the tick applies it
    const verified = { ...entry, fm: v.fm };
    const r = cancelTarget(path.join(root, 'claimed', `${runningId}.md`), v.fm.id, { ...lifeDeps(d), markOnly: true });
    if (!r.ok) {
      rejectNote(verified, 'target_not_found', d);
      continue;
    }
    if (markApplied(path.basename(entry.file, '.md'), d)) finishNote(verified, d); // else the taker-over finishes it
    return true;
  }
  return false;
}

// The oldest claimed intent that runs; one spawn at most. -> { id, exitCode, out } | null.
async function runOldest(root, d) {
  // No pre-check of executor.lock (Reinhard W8-M1): run itself judges it,
  // reclaims a stale one (Wave 7), and refuses executor_busy otherwise.
  for (const entry of listFolder(root, 'claimed', d).filter((e) => !isQueueControl(e.fm))) {
    const r = await d.runIntent(entry.file, d.runDeps);
    const ran = { id: entry.fm.id || entry.name, exitCode: r.exitCode, out: r.out };
    if (r.out && r.out.run === true) return ran;
    if (RUN_STOP_REASONS.has(firstReason(r))) return ran;
  }
  return null;
}

// FR-032 -> Promise<{ exitCode, out }>.
async function tick(deps = {}) {
  const d = tickDeps(deps);
  const L = require('./intent-lifecycle.cjs');
  try {
    if (!d.vault) return Object.freeze({ exitCode: EXIT_OPERATOR, out: null, usage: 'intent tick: A1_VAULT_ROOT is not set' });
    if (L.requireExecutorHost(d) === null) return L.decide(d, 'tick', EXIT_REFUSED, { ticked: false, reasons: ['not_executor_host'] }, { intentId: null, outcome: 'refused', reason: 'not_executor_host' });
    const root = path.join(d.vault, INTENTS_DIR);
    ensureFolders(root);
    const pass = { claimed: [], rejected: [], skipped: [] };
    for (const entry of listFolder(root, 'queued', d)) {
      const r = passFile(entry, d);
      if (r.stop) return L.decide(d, 'tick', EXIT_REFUSED, { ticked: false, reasons: [r.stop], ...pass }, { intentId: null, outcome: 'refused', reason: r.stop });
      if (r.claimed) pass.claimed.push(r.claimed);
      if (r.rejected) pass.rejected.push({ file: entry.name, reason: r.rejected });
      if (r.skipped) pass.skipped.push({ file: entry.name, reason: r.skipped });
    }
    const applied = await applyQueueControl(root, d);
    const ran = await runOldest(root, d);
    const out = { ticked: true, ...pass, applied, ran };
    logTick(d, 'ticked', null, { detail: `claimed ${pass.claimed.length}, rejected ${pass.rejected.length}, applied ${applied.length}, ran ${ran ? ran.id : 'none'}` });
    return Object.freeze({ exitCode: EXIT_OK, out });
  } catch (e) {
    return L.decideError(d, 'tick', null, e);
  }
}

// `a1-tools intent tick`
function cmdIntentTick(args) {
  const { emit } = require('./intent-lifecycle.cjs');
  if (args.length !== 0) return emit({ exitCode: EXIT_OPERATOR, out: null, usage: 'intent tick (no arguments)' });
  return tick().then(emit, (e) => {
    process.stderr.write(`internal error: ${e && e.message}\n`);
    process.exitCode = EXIT_OPERATOR;
  });
}

// FR-032 — ticks every `intervalS` seconds until SIGTERM/SIGINT.
function watch(intervalS, deps = {}) {
  return new Promise((resolve) => {
    let timer = null;
    let stopped = false;
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      ['SIGTERM', 'SIGINT'].forEach((s) => process.removeListener(s, stop));
      resolve(EXIT_OK);
    };
    ['SIGTERM', 'SIGINT'].forEach((s) => process.on(s, stop));
    const loop = async () => {
      const r = await tick(deps);
      if (r.exitCode !== EXIT_OK) process.stderr.write(`intent watch: tick exited ${r.exitCode} ${JSON.stringify(r.out || r.usage || null).slice(0, 200)}\n`);
      if (!stopped) timer = setTimeout(loop, intervalS * 1000);
    };
    loop();
  });
}

// `a1-tools intent watch --interval <s>`
function cmdIntentWatch(args) {
  const { emit } = require('./intent-lifecycle.cjs');
  const ok = args.length === 2 && args[0] === '--interval' && WATCH_INTERVAL_RE.test(String(args[1]));
  if (!ok) return emit({ exitCode: EXIT_OPERATOR, out: null, usage: 'intent watch --interval <seconds> (1 to 999999)' });
  return watch(Number(args[1])).then((code) => { process.exitCode = code; });
}

module.exports = {
  tick, watch, cmdIntentTick, cmdIntentWatch, finishQueueControl, applyCancelFor, listFolder, isConflictCopy,
  cmdIntentList: (args) => require('./intent-list.cjs').cmdIntentList(args), // FR-034 lives in intent-list.cjs
};
