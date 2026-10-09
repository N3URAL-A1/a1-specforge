'use strict';

// ---------------------------------------------------------------------------
// xprov permit-check / permit — spec 009-cross-provider-review-gate, Wave 4
// (FR-021). Sole writer: this wave. Spec 012 Wave B (FR-001, FR-007, FR-014,
// FR-016) added the five permit states, `permit --deny`, the owner guards and
// the exposure sentence; the denial store lives in xprov-denials.cjs.
//
// The permission record `.a1/xprov.json` says whether this repository's code
// may be sent to an external reviewer. Default is DENY: a missing file, an
// unparseable file, a missing field or any `external_review` value other than
// the string `allowed` is `external_review_not_permitted`. `permit` is the
// only writer of the file; the human runs it once per repository with the
// vault note that records the decision (customer repositories need an
// a1-ludwig-legal decision as that record).
//
// Wave 6b (FR-030 b): `permit --default-branch <name>` records the branch whose
// `refs/remotes/origin/<name>` anchors the snapshot allowlist (`main` when the
// field is absent). The name is validated with `git check-ref-format --branch`
// here and again on every read; an invalid name exits 1 and writes nothing.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const io = require('./io.cjs');
const xprov = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const D = require('./xprov-denials.cjs');
const PM = require('./xprov-permits.cjs');
// Shared helpers — one definition each, in xprov-common.cjs.
const { inputError } = C;
const usageExit = (msg) => C.usageExit('', msg);
const finish = (report, code) => C.emitJson(report, code, false);
const resolveRoot = (flags) => C.resolveRepoFlag(flags.repo);

const PERMIT_FILE = path.join('.a1', 'xprov.json');
const ALLOWED = 'allowed';
const DENIED = 'denied';
// The six permit states (spec 012 FR-001, spec 014 FR-002), computed from the
// working-tree file AND the owner's denial store AND the owner's permit store.
const STATES = Object.freeze({ ALLOWED, DENIED, ABSENT: 'absent', INVALID: 'invalid', DENIAL_MISMATCH: 'denial_mismatch', PERMIT_MISMATCH: 'permit_mismatch' });
const REQUIRED_FIELDS = Object.freeze(['external_review', 'decided_by', 'decided_on', 'record']);
const DENIED_REQUIRED_FIELDS = Object.freeze(['external_review', 'decided_by', 'decided_on']); // `record` is optional for a denial
// Vault-relative note: `record/…` or `project/…`, markdown, no `..` segment.
const RECORD_RE = /^(record|project)\/[A-Za-z0-9][A-Za-z0-9._\/-]*\.md$/;
const BY_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const DENY_MESSAGE = 'External review not permitted for this repository. '
  + 'N3URAL-owned repo: `a1-tools xprov permit --by robert --record <vault-note>`. '
  + 'Customer repo: needs an a1-ludwig-legal decision as `--record`, or the owner records that no external review applies: '
  + '`a1-tools xprov permit --deny --by <name>` (both in a real terminal).';
// One sentence for every place that says "allowed" (spec 012 FR-016): what actually leaves.
const EXPOSURE_SENTENCE = 'What leaves for the external reviewer: the full tracked tree of the reviewed commit, the base-side blobs of changed files, '
  + 'PLAN.md and the dispositions; the provider reads the tree in a read-only sandbox.';
const HINT_ABSENT = 'run `xprov permit` or `xprov permit --deny` in a real terminal (the owner decides, not an agent)';
const HINT_MISMATCH = '.a1/xprov.json and the owner\'s denial store disagree — the owner re-runs `xprov permit` or `xprov permit --deny` in a real terminal';
// Spec 014 FR-004: the detail of `permit_mismatch` and the migration hint for repositories permitted by the file only.
const HINT_PERMIT_MISMATCH = '.a1/xprov.json says allowed but the owner\'s permit store holds no matching entry — the owner re-runs `xprov permit --by <name> --record <note>` in a real terminal';
const TYPED_WORD = Object.freeze({ [ALLOWED]: ALLOWED, [DENIED]: DENIED });

function permitPath(repoRoot) {
  return path.join(repoRoot, PERMIT_FILE);
}

// ---------- reading ----------

/** The working-tree file as { kind: missing|invalid|allowed|denied, detail, rec }; never throws. */
function readPermitFile(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
    return e && e.code === 'ENOENT' ? { kind: 'missing', detail: 'missing .a1/xprov.json' } : { kind: 'invalid', detail: 'unreadable .a1/xprov.json' };
  }
  let rec;
  try { rec = JSON.parse(raw); } catch (_e) { return { kind: 'invalid', detail: 'unparseable .a1/xprov.json' }; }
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { kind: 'invalid', detail: 'malformed .a1/xprov.json (not an object)' };
  const required = rec.external_review === DENIED ? DENIED_REQUIRED_FIELDS : REQUIRED_FIELDS;
  const missing = required.filter((f) => typeof rec[f] !== 'string' || rec[f] === '');
  if (missing.length) return { kind: 'invalid', detail: `missing field: ${missing.join(', ')}` };
  if (rec.external_review !== ALLOWED && rec.external_review !== DENIED) return { kind: 'invalid', detail: `external_review: ${rec.external_review}` };
  return { kind: rec.external_review, detail: null, rec };
}

/** True when the owner's permit entry and the working-tree record state the same decision (spec 014 FR-002). */
function permitAgrees(rec, entry) {
  const sameBranch = rec.default_branch === entry.default_branch; // both absent (undefined) counts as equal
  return entry.decided_by === rec.decided_by && entry.decided_on === rec.decided_on && entry.record === rec.record && sameBranch;
}

const permitMismatch = (detail) => ({ state: STATES.PERMIT_MISMATCH, detail });
const fileWord = (kind) => (kind === 'missing' ? 'absent' : 'invalid');

/** The state of one repository from file x denial store x permit store (spec 012 FR-001, spec 014 FR-002):
 * { state, detail }. `permit` is { ok, missing, why, entry }: the permit-store read plus this repository's entry. */
function classify(fileState, store, denial, permit) {
  const hasDenial = denial !== undefined;
  const decided = fileState.kind === ALLOWED || fileState.kind === DENIED;
  const pstore = permit || { ok: true, missing: true, entry: undefined };
  const entry = pstore.ok ? pstore.entry : undefined;
  if (decided && !store.ok && !store.missing) return { state: STATES.DENIAL_MISMATCH, detail: `the owner's denial store is not usable (${store.why})` };
  if (fileState.kind === ALLOWED) {
    if (hasDenial) return { state: STATES.DENIAL_MISMATCH, detail: 'the owner\'s denial store holds a denial for this repository but .a1/xprov.json says allowed' };
    if (!pstore.ok && !pstore.missing) return permitMismatch(`the owner's permit store is not usable (${pstore.why}); ${HINT_PERMIT_MISMATCH}`);
    if (!entry) return permitMismatch(HINT_PERMIT_MISMATCH);
    if (!permitAgrees(fileState.rec, entry)) return permitMismatch(`decided_by/decided_on/record/default_branch in .a1/xprov.json and in the owner's permit store differ; ${HINT_PERMIT_MISMATCH}`);
    return { state: STATES.ALLOWED, detail: null };
  }
  if (fileState.kind === DENIED) {
    if (!hasDenial) return { state: STATES.DENIAL_MISMATCH, detail: '.a1/xprov.json says denied but the owner\'s denial store holds no denial for this repository' };
    const same = denial.decided_by === fileState.rec.decided_by && denial.decided_on === fileState.rec.decided_on;
    if (!same) return { state: STATES.DENIAL_MISMATCH, detail: 'decided_by/decided_on in .a1/xprov.json and in the owner\'s denial store differ' };
    return entry ? { state: STATES.DENIAL_MISMATCH, detail: 'the owner\'s permit store holds an entry for this repository but .a1/xprov.json says denied' } : { state: STATES.DENIED, detail: null };
  }
  if (hasDenial) return { state: STATES.DENIAL_MISMATCH, detail: `the owner's denial store holds a denial for this repository but .a1/xprov.json is ${fileWord(fileState.kind)}` };
  if (entry) return permitMismatch(`the owner's permit store holds an entry for this repository but .a1/xprov.json is ${fileWord(fileState.kind)}; ${HINT_PERMIT_MISMATCH}`);
  return { state: fileState.kind === 'missing' ? STATES.ABSENT : STATES.INVALID, detail: fileState.detail };
}

const REASON_OF_STATE = Object.freeze({
  [STATES.ABSENT]: xprov.REASONS.external_review_not_permitted,
  [STATES.INVALID]: xprov.REASONS.external_review_not_permitted,
  [STATES.DENIED]: xprov.REASONS.external_review_denied,
  [STATES.DENIAL_MISMATCH]: xprov.REASONS.external_review_denial_mismatch,
  [STATES.PERMIT_MISMATCH]: xprov.REASONS.external_review_permit_mismatch,
});

/** Reads the record and the store; never throws. `ok` is true only for state
 * `allowed`. `denied` and every other state are `ok: false` with a reason. */
function permitCheck(opts) {
  const root = (opts && opts.repoRoot) || io.repoRoot();
  const file = permitPath(root);
  const fileState = readPermitFile(file);
  const key = C.commonDirOf(root);
  const store = D.readDenials();
  const pstore = PM.readPermits();
  const permit = { ok: pstore.ok, missing: pstore.missing, why: pstore.why, entry: key === null ? undefined : pstore.permits[key] };
  const { state, detail } = classify(fileState, store, key === null ? undefined : store.denials[key], permit);
  if (state === STATES.ALLOWED) {
    const r = fileState.rec;
    return Object.freeze({ ok: true, state, file, external_review: ALLOWED, decided_by: r.decided_by, decided_on: r.decided_on, record: r.record });
  }
  const denied = state === STATES.DENIED ? { decided_by: fileState.rec.decided_by, decided_on: fileState.rec.decided_on } : {};
  return Object.freeze({ ok: false, state, reason: REASON_OF_STATE[state], file, detail: detail || state, ...denied });
}

/** The one-line stderr hint for a failing permit state (spec 012 FR-003), or null. */
function permitHint(state) {
  if (state === STATES.DENIAL_MISMATCH) return HINT_MISMATCH;
  if (state === STATES.PERMIT_MISMATCH) return HINT_PERMIT_MISMATCH;
  return state === STATES.ABSENT || state === STATES.INVALID ? HINT_ABSENT : null;
}

// ---------- writing (library; the CLI guard sits in cmdXprovPermit) ----------

function validateBy(by) {
  if (typeof by !== 'string' || !BY_RE.test(by)) throw inputError(`--by must be a plain name (letters, digits, . _ -), got ${JSON.stringify(String(by).slice(0, 80))}`);
  return by;
}

function validateRecord(record) {
  const r = typeof record === 'string' ? record : '';
  if (!RECORD_RE.test(r) || r.split('/').includes('..') || /[\0-\x1f\x7f]/.test(r)) {
    throw inputError(`--record must be a vault-relative note under record/ or project/ (e.g. project/<slug>/record/<date>-xprov.md), got ${JSON.stringify(r.slice(0, 80))}`);
  }
  return r;
}

/** `git check-ref-format --branch` accepts the name unchanged (no `@{-1}` expansion). */
function isValidBranchName(root, name) {
  if (typeof name !== 'string' || name === '') return false;
  const r = spawnSync('git', ['-C', root, 'check-ref-format', '--branch', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 && String(r.stdout).trim() === name;
}

const invalidBranch = (root, name) => Object.freeze({ ok: false, reason: 'invalid_default_branch', file: permitPath(root), detail: `--default-branch ${JSON.stringify(String(name).slice(0, 80))} is not a valid branch name (git check-ref-format --branch)` });

function repoKey(root) {
  const key = C.commonDirOf(root);
  if (!key) throw inputError(`no git-common-dir for ${root}`);
  return key;
}

function writeRecordFile(root, record) {
  io.writeTextAtomic(permitPath(root), `${JSON.stringify(record, null, 2)}\n`);
}

/** The denial store as a writer sees it: { denials } to extend, or { refusal } — an
 * unusable store is never overwritten (rule of appendWaiver). */
function storeForWrite() {
  const s = D.readDenials();
  if (s.ok || s.missing) return { denials: s.denials };
  return { refusal: Object.freeze({ ok: false, reason: 'denial_store_unusable', detail: `the existing denial store is not usable (${s.why}); fix or remove ${D.denialsPath()} yourself; nothing written` }) };
}

/** Store write that reports a failure as a string instead of throwing. */
function tryWriteDenials(denials) {
  try { D.writeDenials(denials); return null; } catch (e) { return `cannot write the denial store (${e && e.code === 'A1_INPUT' ? e.message : (e && e.code) || 'error'})`; }
}

/** The permit store as a writer sees it (spec 014 FR-003): { permits } to extend, or
 * { refusal } — an unusable store is never overwritten. */
function permitStoreForWrite() {
  const s = PM.readPermits();
  if (s.ok || s.missing) return { permits: s.permits };
  return { refusal: Object.freeze({ ok: false, reason: 'permit_store_unusable', detail: `the existing permit store is not usable (${s.why}); fix or remove ${PM.permitsPath()} yourself; nothing written` }) };
}

/** Runs one permit-store write (a closure, so the writer is referenced only inside `permit` / `permitDeny`,
 * spec 014 AC-003.4) and reports a failure as a string instead of throwing. */
function tryPermitStore(write) {
  try { write(); return null; } catch (e) { return `cannot write the permit store (${e && e.code === 'A1_INPUT' ? e.message : (e && e.code) || 'error'})`; }
}

/** `permit` (allowed), spec 014 FR-003 order: (1) removes this repository's store
 * denial, (2) writes the permit entry, (3) writes the file atomically. Returns a fresh
 * {ok, file, record}; {ok: false, reason} with nothing written for an invalid branch or
 * an unusable store; the half-write messages say which state the failure leaves. */
function permit(opts) {
  const o = opts || {};
  const root = o.repoRoot || io.repoRoot();
  if (o.defaultBranch !== undefined && !isValidBranchName(root, o.defaultBranch)) return invalidBranch(root, o.defaultBranch);
  const record = Object.freeze({
    external_review: ALLOWED,
    decided_by: validateBy(o.by),
    decided_on: (o.today || io.nowIso()).slice(0, 10),
    record: validateRecord(o.record),
    ...(o.defaultBranch !== undefined ? { default_branch: o.defaultBranch } : {}),
  });
  const key = repoKey(root);
  const store = storeForWrite();
  if (store.refusal) return store.refusal;
  const pstore = permitStoreForWrite();
  if (pstore.refusal) return pstore.refusal;
  const hadDenial = Boolean(store.denials[key]);
  if (hadDenial) {
    const failed = tryWriteDenials(D.withDenial(store.denials, key, null));
    if (failed) return Object.freeze({ ok: false, reason: 'denial_store_unusable', detail: `${failed}; nothing written` });
  }
  const entry = Object.freeze({
    decided_by: record.decided_by, decided_on: record.decided_on, record: record.record, ts: o.now || io.nowIso(),
    ...(record.default_branch !== undefined ? { default_branch: record.default_branch } : {}),
  });
  const storeFailed = tryPermitStore(() => PM.writePermits(PM.withPermit(pstore.permits, key, entry)));
  if (storeFailed) {
    return hadDenial
      ? Object.freeze({ ok: false, reason: xprov.REASONS.external_review_denial_mismatch, file: permitPath(root), detail: `the denial was removed from the store but the permit entry could not be written (${storeFailed}); the file still says denied, so the state is denial_mismatch until the owner re-runs permit` })
      : Object.freeze({ ok: false, reason: 'permit_write_failed', file: permitPath(root), detail: `${storeFailed}; nothing changed` });
  }
  try { writeRecordFile(root, record); } catch (e) {
    const code = (e && e.code) || 'error';
    return hadDenial
      ? Object.freeze({ ok: false, reason: xprov.REASONS.external_review_denial_mismatch, file: permitPath(root), detail: `the denial was removed from the store but ${PERMIT_FILE} could not be written (${code}); the file still says denied, so the state is denial_mismatch until the owner re-runs permit` })
      : Object.freeze({ ok: false, reason: xprov.REASONS.external_review_permit_mismatch, file: permitPath(root), detail: `the permit entry was written but ${PERMIT_FILE} could not be written (${code}); the file is absent or old next to the entry, so the state is permit_mismatch until the owner re-runs permit` });
  }
  return Object.freeze({ ok: true, file: permitPath(root), record });
}

/** `permit --deny`: the store first, then the file. A failing file step leaves the
 * state `denial_mismatch` (fail closed) and says so. */
function permitDeny(opts) {
  const o = opts || {};
  const root = o.repoRoot || io.repoRoot();
  if (o.defaultBranch !== undefined && !isValidBranchName(root, o.defaultBranch)) return invalidBranch(root, o.defaultBranch);
  const by = validateBy(o.by);
  const day = (o.today || io.nowIso()).slice(0, 10);
  const record = Object.freeze({
    external_review: DENIED, decided_by: by, decided_on: day,
    ...(o.record !== undefined ? { record: validateRecord(o.record) } : {}),
    ...(o.defaultBranch !== undefined ? { default_branch: o.defaultBranch } : {}),
  });
  const key = repoKey(root);
  const store = storeForWrite();
  if (store.refusal) return store.refusal;
  // Spec 014 FR-003 order: permit store, then denial store, then file. A store without this repo's entry is not rewritten.
  const pstore = permitStoreForWrite();
  if (pstore.refusal) return pstore.refusal;
  if (pstore.permits[key]) {
    const permitFailed = tryPermitStore(() => PM.writePermits(PM.withPermit(pstore.permits, key, null)));
    if (permitFailed) return Object.freeze({ ok: false, reason: 'permit_write_failed', detail: `${permitFailed}; nothing written` });
  }
  const entry = Object.freeze({ decided_by: by, decided_on: day, ts: o.now || io.nowIso() });
  const failed = tryWriteDenials(D.withDenial(store.denials, key, entry));
  if (failed) {
    const removed = Boolean(pstore.permits[key]);
    return Object.freeze({ ok: false, reason: 'denial_store_unusable', detail: removed ? `${failed}; the permit entry was already removed, so the state is permit_mismatch until the owner re-runs permit` : `${failed}; nothing written` });
  }
  try { writeRecordFile(root, record); } catch (e) {
    return Object.freeze({ ok: false, reason: xprov.REASONS.external_review_denial_mismatch, file: permitPath(root), detail: `the denial store was written but ${PERMIT_FILE} could not be (${(e && e.code) || 'error'}); the state is denial_mismatch until the owner re-runs permit` });
  }
  return Object.freeze({ ok: true, file: permitPath(root), record, store: D.denialsPath() });
}

// ---------- CLI ----------

// stdout/exitCode plumbing and --repo resolution come from xprov-common.cjs.

function cmdXprovPermitCheck(args) {
  const flags = io.parseFlags(args || [], { repo: 'string' });
  if (flags._.length) return usageExit(`permit-check: unexpected argument ${JSON.stringify(String(flags._[0]).slice(0, 80))}`);
  let root;
  try { root = resolveRoot(flags); } catch (e) {
    if (e && e.code === 'A1_INPUT') return usageExit(`permit-check: ${e.message}`);
    throw e;
  }
  const r = permitCheck({ repoRoot: root });
  if (r.ok) process.stderr.write(`permit-check: allowed by ${r.decided_by} on ${r.decided_on} (${r.record})\n${EXPOSURE_SENTENCE}\n`);
  else if (r.state === STATES.DENIED) process.stderr.write(`permit-check: denied by ${r.decided_by} on ${r.decided_on} (the owner's denial store agrees): external review does not apply to this repository\n`);
  else process.stderr.write(`${DENY_MESSAGE} (${r.detail})${permitHint(r.state) ? `\npermit-check: ${permitHint(r.state)}` : ''}\n`);
  return finish(r, r.ok ? xprov.EXIT_PASS : xprov.EXIT_FAIL);
}

/** Flag shape of `permit`/`permit --deny`; usage errors (exit 2) before any guard text. */
function permitArgs(flags) {
  const deny = flags.deny === true;
  if (!flags.by || (!deny && !flags.record)) throw inputError(deny ? 'permit --deny requires --by <name> [--record <vault-path>] [--default-branch <name>]' : 'permit requires --by <name> --record <vault-path> [--default-branch <name>]');
  validateBy(flags.by);
  if (flags.record !== undefined) validateRecord(flags.record);
  return { deny, by: flags.by, record: flags.record, defaultBranch: flags['default-branch'] };
}

/** The owner's confirmation: guards, key + decision shown, the typed-back word. Returns a refusal text or null. */
function ownerRefusal(root, a, today) {
  const refusal = require('./xprov-approve.cjs').guardRefusal();
  if (refusal) return `${refusal}. Run it yourself in a separate terminal (not through an agent and not via the ! prefix). Nothing written.`;
  const word = a.deny ? DENIED : ALLOWED;
  const err = (line) => process.stderr.write(`${line}\n`);
  err(`${a.deny ? 'Denial' : 'Permission'} for ${root}`);
  err(`  repo: ${repoKey(root)}`); err(`  decided_by: ${a.by}`); err(`  decided_on: ${today}`);
  if (a.record !== undefined) err(`  record: ${a.record}`);
  err(a.deny ? 'External review will not apply to this repository: gates report not_applicable and no code leaves.' : EXPOSURE_SENTENCE);
  process.stderr.write(`Type the word (${word}) to record it: `);
  const typed = require('./xprov-approve.cjs').readTypedLine();
  return typed === TYPED_WORD[word] ? null : `typed ${JSON.stringify(C.clip(typed, 40))}, expected ${word}; nothing written`;
}

function cmdXprovPermit(args) {
  const flags = io.parseFlags(args || [], { by: 'string', record: 'string', repo: 'string', 'default-branch': 'string', deny: 'bool' });
  if (flags._.length) return usageExit(`permit: unexpected argument ${JSON.stringify(String(flags._[0]).slice(0, 80))}`);
  let r;
  try {
    const a = permitArgs(flags);
    const root = resolveRoot(flags);
    const today = io.nowIso().slice(0, 10);
    const refusal = ownerRefusal(root, a, today);
    if (refusal) return usageExit(`permit: ${refusal}`);
    const call = { repoRoot: root, by: a.by, record: a.record, defaultBranch: a.defaultBranch, today };
    r = a.deny ? permitDeny(call) : permit(call);
  } catch (e) {
    if (e && e.code === 'A1_INPUT') return usageExit(`permit: ${e.message}`);
    throw e;
  }
  if (!r.ok) {
    process.stderr.write(`permit: ${r.detail}\n`);
    return finish(r, xprov.EXIT_FAIL);
  }
  process.stderr.write(`permit: wrote ${r.file}${r.store ? ` and ${r.store}` : ''}\n`);
  return finish(r, xprov.EXIT_PASS);
}

module.exports = {
  PERMIT_FILE, DENY_MESSAGE, EXPOSURE_SENTENCE, HINT_PERMIT_MISMATCH, STATES, permitPath, permitCheck, permitHint, permit, permitDeny, isValidBranchName,
  cmdXprovPermitCheck, cmdXprovPermit,
};
