'use strict';

// ---------------------------------------------------------------------------
// intent-validate — the note-contract validator (spec 011, Wave 1: FR-001 to
// FR-004; Wave 2: FR-005 to FR-008). Pure functions: nothing here writes,
// renames or spawns. Every
// check returns a reason code from INTENT_REJECT_REASONS; one call reports
// every failing check, deduplicated, in check order.
//
// The strict frontmatter parser lives in intent-parse.cjs and is re-exported
// here unchanged (parseIntentFrontmatter), so no caller changes.
//
// One descriptor (MINOR-1 of the security review of waves 1–3):
// readIntentFile opens the file ONCE with O_RDONLY | O_NOFOLLOW | O_NONBLOCK,
// fstats that descriptor and reads from it. A symlink, a FIFO, a directory or
// any other non-regular file is refused as `schema_invalid` with detail
// `not_regular_file` and never blocks; nothing is ever re-opened or stat'ed
// by path, so there is no stat->read race. Size before parse (FR-005): the
// fstat size is checked before any byte is read, then the bytes actually read
// once more (the file may have grown in between) — both before the parser
// runs. Folder context (FR-007, FR-008): a file in queued/ (or in any folder
// that is not one of the lifecycle folders) must carry `status: queued` and
// none of the a1-only keys; in claimed/, done/ and rejected/ the a1-only keys
// are known keys and `status` is any of INTENT_STATUSES.
//
// `deps` injects `fstat` and `readFile` (both get the descriptor), `realpath`,
// `stat`, `lstat`, `homedir`, `now` and `parseFrontmatter` so fixtures can pin the filesystem and the clock and
// count parser calls; `intentsRoot` (default $A1_VAULT_ROOT/inbox/intents),
// `executorDevice` (the executor device id, read from executor.json from
// Wave 4 on; default null = no approve passes) and `runningId` (the id of
// the running intent, from the executor lock in Wave 7; default null) feed
// the queue-control target rules (FR-006). `loadDevices` and
// `timingSafeEqual` feed the authenticity check (Wave 3).
//
// Check order, three stages, each only when the one before passed:
//   1. shape — syntax only, no filesystem: key set, id, action, project slug
//      syntax, payload, target syntax, timestamps, author fields, status,
//      a1-only keys. Every failing shape rule is reported.
//   2. authenticity (FR-010 to FR-013) — the device of `created_by` is looked
//      up, the signature verified and the freshness window checked, in that
//      order, stopping at the first failure (device_unknown,
//      signature_invalid, stale).
//   3. environment — project realpath (project_invalid), queue-control target
//      lookup (target_not_found), the executor-device rule
//      (approve_from_non_executor_device) and, for the approval audit group
//      of FR-045 (shape rules in stage 1, intent-approval.cjs), `created_by`
//      equal to the executor device (schema_invalid; no executor.json -> no
//      executor device -> refused).
// So an unauthenticated intent only ever gets a shape or an authenticity
// reason (MINOR-2 of the review): once reasons land in the vault, a writer
// without a key learns nothing about which projects, intent ids or devices
// exist. The result carries `detail`
// (stale_past | stale_future) and `payloadSha256` for the log line; it never
// carries a secret or the canonical string.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { assertSafeSegment } = require('./io.cjs');
const { assertNoShellMetachar } = require('./git-safe.cjs');
const { SLUG_RE } = require('./worktree-registry.cjs');
const {
  INTENT_ACTIONS, INTENT_STATUSES, INTENT_REJECT_REASONS, INTENT_FAILURE_REASONS,
} = require('./status-constants.cjs');
const {
  INTENT_TYPE, INTENT_SCHEMA_VERSION, INTENT_REQUIRED_KEYS, INTENT_OPTIONAL_KEYS, INTENT_A1_ONLY_KEYS,
  INTENT_ID_RE, INTENT_MAX_BYTES, INTENT_PAYLOAD_MAX_BYTES, ACTION_TABLE,
  INTENT_FRESHNESS_MS, INTENT_CLOCK_SKEW_MS, INTENT_APPROVAL_KEYS,
  INTENT_TARGET_SHA256_KEY, TARGET_SHA256_RE, INTENT_HOSTNAME_RE,
} = require('./intent-constants.cjs');
const { checkAuthenticity, payloadSha256 } = require('./intent-sign.cjs');
const { loadDevices, lookupDevice } = require('./intent-devices.cjs');
const { parseIntentFrontmatter } = require('./intent-parse.cjs');
const { approvalGroupShape, approvalGroupEnv } = require('./intent-approval.cjs');

const PROJECTS_DIR = 'claude-projects';
const SUMMARY_KEYS = Object.freeze(['id', 'action', 'project', 'target', 'created_by']);

// FR-007 — ISO-8601 UTC with a Z suffix, optional milliseconds; the calendar
// round trip in validateTimestamps refuses days that do not exist.
const UTC_TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/;
const DEVICE_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;

const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
const INTENT_OPEN_FLAGS = O_RDONLY | O_NOFOLLOW | O_NONBLOCK;
const NOT_REGULAR = Object.freeze({ ok: false, reason: 'schema_invalid', detail: 'not_regular_file' });
const OVERSIZED = Object.freeze({ ok: false, reason: 'oversized', detail: null });

const QUEUED_FOLDER = 'queued';
const LIFECYCLE_FOLDERS = Object.freeze(new Set(['queued', 'claimed', 'done', 'rejected']));
// FR-006 — where a queue-control target may live. `cancel` additionally
// accepts the currently running intent (deps.runningId).
const QUEUE_TARGET_FOLDERS = Object.freeze({
  approve: Object.freeze(['queued', 'claimed', 'rejected']),
  cancel: Object.freeze(['queued', 'claimed']),
});

// Reads at most INTENT_MAX_BYTES + 1 bytes from `fd`, so a file that grew
// between the fstat gate and the read never reaches memory whole; one byte
// over the cap is enough for checkContentSize to refuse it. Same call shape as
// readFileSync (fd, 'utf8') so fixtures can inject a counting reader.
function readFdBounded(fd, _encoding, maxBytes = INTENT_MAX_BYTES) {
  const cap = maxBytes + 1;
  const buf = Buffer.alloc(cap);
  let got = 0;
  let n = 1;
  while (got < cap && n > 0) {
    n = fs.readSync(fd, buf, got, cap - got, null);
    got += n;
  }
  return buf.subarray(0, got).toString('utf8');
}

const defaultDeps = () => ({
  fstat: fs.fstatSync,
  readFile: readFdBounded,
  realpath: fs.realpathSync,
  stat: fs.statSync,
  lstat: fs.lstatSync,
  homedir: os.homedir,
  now: Date.now,
  loadDevices,
  timingSafeEqual: crypto.timingSafeEqual,
  parseFrontmatter: parseIntentFrontmatter,
  intentsRoot: process.env.A1_VAULT_ROOT ? path.join(process.env.A1_VAULT_ROOT, 'inbox', 'intents') : null,
  executorDevice: null,
  runningId: null,
});

// FR-001 — exact key set, empty body, type and schema_version. `extraKeys`
// are further known keys (the a1-only keys outside queued/, FR-008).
function validateShape(fm, body, extraKeys = []) {
  const allowed = new Set([...INTENT_REQUIRED_KEYS, ...INTENT_OPTIONAL_KEYS, ...extraKeys]);
  const keys = Object.keys(fm);
  const ok = keys.every((k) => allowed.has(k))
    && INTENT_REQUIRED_KEYS.every((k) => keys.includes(k))
    && String(body).trim() === ''
    && fm.type === INTENT_TYPE
    && fm.schema_version === INTENT_SCHEMA_VERSION;
  return ok ? null : 'schema_invalid';
}

// FR-002 — lowercase v4 UUID equal to the filename stem.
function validateId(fm, filename) {
  const stem = path.basename(String(filename), '.md');
  const ok = typeof fm.id === 'string' && INTENT_ID_RE.test(fm.id) && fm.id === stem;
  return ok ? null : 'id_mismatch';
}

// FR-003 — the enum decides; the table row is returned for later use.
function validateAction(fm) {
  const action = fm.action;
  if (typeof action !== 'string' || !INTENT_ACTIONS.has(action)) return { reason: 'action_unknown', row: null };
  return { reason: null, row: ACTION_TABLE[action] };
}

function isSafeSegment(slug) {
  try {
    assertSafeSegment(slug, 'project');
    return true;
  } catch (e) {
    if (e && e.code === 'A1_INPUT') return false;
    throw e;
  }
}

// FR-004, syntax half — slug regex and safe segment; no filesystem.
function isProjectSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug) && isSafeSegment(slug);
}

// FR-004 — slug regex, safe segment, realpath strictly inside
// realpath(~/claude-projects) + separator, and a directory. Returns the
// realpath, never the raw slug, for later use as the child's cwd.
function resolveProject(slug, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const invalid = { ok: false, reason: 'project_invalid', realpath: null };
  if (!isProjectSlug(slug)) return invalid;
  const root = path.join(d.homedir(), PROJECTS_DIR);
  let rootReal;
  let real;
  try {
    rootReal = d.realpath(root);
    real = d.realpath(path.join(root, slug));
  } catch (e) {
    if (e && typeof e.code === 'string') return invalid; // ENOENT, ENAMETOOLONG, ELOOP, EACCES …
    throw e;
  }
  if (!real.startsWith(rootReal + path.sep)) return invalid;
  if (!d.stat(real).isDirectory()) return invalid;
  return { ok: true, reason: null, realpath: real };
}

const has = (fm, key) => Object.prototype.hasOwnProperty.call(fm, key);

// The lifecycle folder a file sits in; anything else counts as queued/, the
// strictest context.
function folderOf(filePath) {
  const folder = path.basename(path.dirname(String(filePath)));
  return LIFECYCLE_FOLDERS.has(folder) ? folder : QUEUED_FOLDER;
}

// FR-005 — the size gate on the fstat of the open descriptor; runs before
// any byte is read, so an oversized file never reaches memory or the parser.
function checkSizeBeforeParse(st, maxBytes = INTENT_MAX_BYTES) {
  return st.size > maxBytes ? 'oversized' : null;
}

// FR-005 — the same cap on the bytes that were read (the file may have grown
// after the stat; the default reader stops one byte past the cap). A
// multibyte character cut at the cap decodes to U+FFFD, which is never
// shorter than the bytes it replaces, so the refusal still holds.
function checkContentSize(content, maxBytes = INTENT_MAX_BYTES) {
  return Buffer.byteLength(content, 'utf8') > maxBytes ? 'oversized' : null;
}

// FR-005 — payload is a string of at most INTENT_PAYLOAD_MAX_BYTES UTF-8 bytes.
function validatePayload(fm) {
  if (!has(fm, 'payload')) return null; // missing key: validateShape reports it
  if (typeof fm.payload !== 'string') return 'schema_invalid';
  return Buffer.byteLength(fm.payload, 'utf8') > INTENT_PAYLOAD_MAX_BYTES ? 'oversized' : null;
}

function isFreeOfShellMetachar(value) {
  try {
    assertNoShellMetachar(value, 'target');
    return true;
  } catch (e) {
    if (e instanceof Error && /disallowed shell metacharacters/.test(e.message)) return false;
    throw e;
  }
}

// FR-006 — presence, shell metacharacters, then the row's own regex. For a
// row without a target (`targetRequired: false`) the key must be absent, not
// merely empty.
function validateTarget(fm, row) {
  const present = has(fm, 'target');
  if (!row.targetRequired) return present ? 'target_invalid' : null;
  if (!present || typeof fm.target !== 'string') return 'target_invalid';
  if (!isFreeOfShellMetachar(fm.target)) return 'target_invalid';
  return row.targetRe.test(fm.target) ? null : 'target_invalid';
}

// A regular file (not a symlink, not a conflict copy) named <id>.md.
function isIntentFileIn(root, folder, id, d) {
  try {
    return d.lstat(path.join(root, folder, `${id}.md`)).isFile();
  } catch (e) {
    if (e && typeof e.code === 'string') return false; // ENOENT, ENOTDIR, EACCES …
    throw e;
  }
}

// sha256 of the raw bytes of `file`, read through one O_NOFOLLOW descriptor;
// null when it is not a regular file, larger than TARGET_READ_MAX_BYTES or
// gone. (Spec round 6, FR-006: an approve's target_sha256.)
const TARGET_READ_MAX_BYTES = 2 * INTENT_MAX_BYTES;
function targetSha256(file) {
  let fd;
  try {
    fd = fs.openSync(file, INTENT_OPEN_FLAGS);
  } catch (e) {
    if (e && typeof e.code === 'string') return null; // gone, a link, no permission
    throw e;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > TARGET_READ_MAX_BYTES) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(fd)).digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

// FR-006 — approve/cancel: the target must name an existing intent in the
// action's folders (cancel: or the running intent); approve must come from
// the executor device, and its target_sha256 must equal the sha256 of the
// target file found (re-review n3; tick repeats the comparison when it
// applies the approve). Unknown root or executor device fails closed.
function resolveQueueControlTarget(fm, row, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  if (!row || row.kind !== 'queue-control') return Object.freeze([]);
  const found = [];
  if (validateTarget(fm, row) === null) {
    const folders = QUEUE_TARGET_FOLDERS[fm.action] || [];
    const running = fm.action === 'cancel' && typeof d.runningId === 'string' && d.runningId === fm.target;
    const folder = typeof d.intentsRoot === 'string'
      ? folders.find((f) => isIntentFileIn(d.intentsRoot, f, fm.target, d)) : undefined;
    const bound = fm.action !== 'approve' || folder === undefined
      || targetSha256(path.join(d.intentsRoot, folder, `${fm.target}.md`)) === fm[INTENT_TARGET_SHA256_KEY];
    if (!(running || folder !== undefined) || !bound) found.push('target_not_found');
  }
  const fromExecutor = typeof d.executorDevice === 'string' && d.executorDevice !== '' && fm.created_by === d.executorDevice;
  if (row.executorDeviceOnly && !fromExecutor) found.push('approve_from_non_executor_device');
  return Object.freeze(found);
}

// FR-007 — created_at is ISO-8601 UTC with Z and names a real instant.
function validateTimestamps(fm) {
  if (!has(fm, 'created_at')) return null;
  const m = typeof fm.created_at === 'string' ? fm.created_at.match(UTC_TIMESTAMP_RE) : null;
  if (!m) return 'schema_invalid';
  const [y, mo, day, h, mi, sec] = m.slice(1, 7).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, day, h, mi, sec));
  const same = t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === day
    && t.getUTCHours() === h && t.getUTCMinutes() === mi && t.getUTCSeconds() === sec;
  return same ? null : 'schema_invalid';
}

// FR-007 — created_by is a device id, nonce is 128 bit as lowercase hex.
function validateAuthorFields(fm) {
  const badDevice = has(fm, 'created_by') && !(typeof fm.created_by === 'string' && DEVICE_ID_RE.test(fm.created_by));
  const badNonce = has(fm, 'nonce') && !(typeof fm.nonce === 'string' && NONCE_RE.test(fm.nonce));
  return badDevice || badNonce ? 'schema_invalid' : null;
}

// FR-007, FR-008 — `queued` in queued/; one of the six statuses elsewhere.
function validateStatus(fm, folder) {
  if (!has(fm, 'status')) return null;
  if (folder === QUEUED_FOLDER) return fm.status === 'queued' ? null : 'schema_invalid';
  return typeof fm.status === 'string' && INTENT_STATUSES.has(fm.status) ? null : 'schema_invalid';
}

// FR-008 — only a1 writes the lifecycle keys; a queued/ file carrying one is
// refused.
function validateNoA1OnlyKeys(fm, folder) {
  if (folder !== QUEUED_FOLDER) return null;
  return INTENT_A1_ONLY_KEYS.some((k) => has(fm, k)) ? 'schema_invalid' : null;
}

// FR-001, FR-006 (spec round 6) — target_sha256 is required for approve,
// forbidden for every other action, and 64 lowercase hex.
function validateTargetSha256(fm) {
  const present = has(fm, INTENT_TARGET_SHA256_KEY);
  if (fm.action !== 'approve') return present ? 'schema_invalid' : null;
  const v = fm[INTENT_TARGET_SHA256_KEY];
  return present && typeof v === 'string' && TARGET_SHA256_RE.test(v) ? null : 'schema_invalid';
}

const isUtc = (v) => validateTimestamps({ created_at: v }) === null;
const isHostname = (v) => typeof v === 'string' && INTENT_HOSTNAME_RE.test(v);

// FR-016 (spec round 6) — the value forms of the a1-only keys; a1 writes
// them unsigned outside queued/, so a vault writer could put anything there.
const A1_ONLY_FORMS = Object.freeze({
  claimed_by: isHostname,
  claimed_at: isUtc,
  started_at: isUtc,
  finished_at: isUtc,
  exit_code: (v) => v === null || Number.isSafeInteger(v),
  rejected_reason: (v) => typeof v === 'string' && INTENT_REJECT_REASONS.has(v),
  rejected_by: isHostname,
  rejected_at: isUtc,
  failure_reason: (v) => typeof v === 'string' && INTENT_FAILURE_REASONS.has(v),
  cancelled_by_intent: (v) => typeof v === 'string' && INTENT_ID_RE.test(v),
});

function validateA1OnlyValues(fm, folder) {
  if (folder === QUEUED_FOLDER) return null; // the keys themselves are refused there
  return Object.entries(A1_ONLY_FORMS).every(([k, ok]) => !has(fm, k) || ok(fm[k])) ? null : 'schema_invalid';
}

function summarize(fm) {
  return Object.fromEntries(SUMMARY_KEYS.map((k) => [k, typeof fm[k] === 'string' ? fm[k] : null]));
}

function refuse(reasons, detail = null) {
  return Object.freeze({
    valid: false, reasons: Object.freeze(reasons), intent: null, realpath: null, detail, payloadSha256: null,
  });
}

// MINOR-1 — one descriptor for the whole read. -> { ok: true, content } |
// { ok: false, reason, detail }. A vanished file (ENOENT) still throws: the
// caller decides (claim reads it as "claimed by someone else").
function readIntentFile(filePath, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  let fd;
  try {
    fd = fs.openSync(filePath, INTENT_OPEN_FLAGS);
  } catch (e) {
    if (e && (e.code === 'ELOOP' || e.code === 'EMLINK')) return NOT_REGULAR; // a symlink (EMLINK: FreeBSD)
    throw e;
  }
  try {
    const st = d.fstat(fd);
    if (!st.isFile()) return NOT_REGULAR;
    // `run` re-validates a claimed file with INTENT_CLAIMED_MAX_BYTES (FR-020);
    // every other caller keeps INTENT_MAX_BYTES.
    const max = d.maxBytes === undefined ? INTENT_MAX_BYTES : d.maxBytes;
    if (checkSizeBeforeParse(st, max)) return OVERSIZED;
    const content = d.readFile(fd, 'utf8', max);
    if (checkContentSize(content, max)) return OVERSIZED;
    return Object.freeze({ ok: true, content });
  } finally {
    fs.closeSync(fd);
  }
}

const AUTH_SKIPPED = Object.freeze({ reason: null, detail: null });

// FR-010 to FR-013 (Wave 3) — device lookup -> signature -> freshness, only
// for an intent that passed every shape rule: the canonical string needs
// well-typed fields, and an unauthenticated created_at means nothing. The
// devices file is read here, per call; a corrupt one throws
// A1_DEVICES_UNREADABLE (fail closed and loud, never "no devices").
function authenticate(fm, d) {
  const devices = d.loadDevices({ homedir: d.homedir });
  const lookupSecret = (id) => lookupDevice(devices, id);
  // Wave 7: `run` re-validates a claimed intent that may wait for hours
  // (rate_limited, project_busy; FR-026, FR-028): freshness was judged at
  // claim time, the ledger row binds the bytes since, and expiry
  // (INTENT_CLAIMED_MAX_AGE_MS) replaces it. The signature is still checked.
  const limits = d.skipFreshness ? { freshnessMs: Infinity, skewMs: Infinity } : { freshnessMs: INTENT_FRESHNESS_MS, skewMs: INTENT_CLOCK_SKEW_MS };
  return checkAuthenticity(fm, lookupSecret, d.now(), limits, { timingSafeEqual: d.timingSafeEqual });
}

const rowOf = (fm) => (fm.action === undefined ? null : validateAction(fm).row);

// Stage 1 — syntax only; nothing here touches the filesystem.
function shapeReasons(fm, body, filePath) {
  const folder = folderOf(filePath);
  const row = rowOf(fm);
  const found = [
    validateShape(fm, body, [...INTENT_A1_ONLY_KEYS, ...INTENT_APPROVAL_KEYS, INTENT_TARGET_SHA256_KEY]),
    validateTargetSha256(fm), // spec round 6
    approvalGroupShape(fm), // Wave 10 (FR-045): all four keys or none, in their forms
    fm.id === undefined ? null : validateId(fm, filePath),
    fm.action === undefined ? null : validateAction(fm).reason,
    fm.project === undefined || isProjectSlug(fm.project) ? null : 'project_invalid',
    validatePayload(fm),
    row ? validateTarget(fm, row) : null,
    validateTimestamps(fm),
    validateAuthorFields(fm),
    validateStatus(fm, folder),
    validateNoA1OnlyKeys(fm, folder),
    validateA1OnlyValues(fm, folder), // spec round 6
  ];
  return [...new Set(found.filter((r) => r !== null))];
}

// Stage 3 — only for an authenticated intent.
function environmentReasons(fm, d) {
  const project = resolveProject(fm.project, d);
  const found = [
    project.ok ? null : project.reason,
    ...resolveQueueControlTarget(fm, rowOf(fm), d),
    approvalGroupEnv(fm, d.executorDevice), // Wave 10 (FR-045): the group only under the executor device
  ];
  return { reasons: [...new Set(found.filter((r) => r !== null))], realpath: project.ok ? project.realpath : null };
}

// -> { valid, reasons, intent, realpath, detail, payloadSha256 } (frozen).
// `intent` is null when the file is not a regular file, is oversized or does
// not parse; `realpath` is the project realpath when the intent is
// authenticated and the project resolves.
function validateIntentFile(filePath, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const read = readIntentFile(filePath, d);
  if (!read.ok) return refuse([read.reason], read.detail);
  const parsed = d.parseFrontmatter(read.content);
  if (!parsed.ok) return refuse(['schema_invalid']);
  const { fm, body } = parsed;
  const shape = shapeReasons(fm, body, filePath);
  const auth = shape.length === 0 ? authenticate(fm, d) : AUTH_SKIPPED;
  const authed = shape.length === 0 && auth.reason === null;
  const env = authed ? environmentReasons(fm, d) : { reasons: [], realpath: null };
  let reasons = env.reasons;
  if (!authed) reasons = shape.length > 0 ? shape : [auth.reason];
  return Object.freeze({
    valid: reasons.length === 0,
    reasons: Object.freeze(reasons),
    intent: Object.freeze(summarize(fm)),
    realpath: env.realpath,
    detail: auth.detail, // 'stale_past' | 'stale_future' | null — for the Wave 4 log line
    payloadSha256: payloadSha256(fm), // the only payload-derived value a log may carry
  });
}

module.exports = {
  DEVICE_ID_RE, NONCE_RE, UTC_TIMESTAMP_RE, LIFECYCLE_FOLDERS, // Wave 9: the patterns intent-schema.cjs publishes
  parseIntentFrontmatter,
  validateShape,
  validateId,
  validateAction,
  resolveProject,
  checkSizeBeforeParse,
  checkContentSize,
  validatePayload,
  validateTarget,
  resolveQueueControlTarget,
  validateTimestamps,
  validateAuthorFields,
  validateStatus,
  validateNoA1OnlyKeys,
  validateTargetSha256,
  validateA1OnlyValues,
  readIntentFile,
  validateIntentFile,
};
