'use strict';

// ---------------------------------------------------------------------------
// intent-schema — `a1-tools intent schema --json` (spec 011, Wave 9: FR-035),
// the machine half of the contract for obsidian-lumen; the human half is
// _shared/intent-contract.md (FR-036).
//
// One source: every key SET comes from the constants the validator uses
// (INTENT_REQUIRED_KEYS, INTENT_OPTIONAL_KEYS, INTENT_APPROVAL_KEYS,
// INTENT_A1_ONLY_KEYS, RESULT_KEYS), every enum from status-constants.cjs and
// every pattern from the validator's own RegExp objects (`.source`). The form
// tables below (NOTE_FORMS, A1_ONLY_FORMS, RESULT_FORMS, VIA_PAIRING,
// render hints) name keys and codes because a form belongs to one key; each
// table is checked against its constant at load and a drift throws, like the
// ACTION_TABLE / INTENT_ACTIONS check in intent-constants.cjs. So a key the
// validator accepts can never be missing here, and a form without a key
// cannot be exported.
//
// The document is a pure function of the source: no clock, no environment,
// no path. Limits are the DEFAULTS (INTENT_LIMIT_DEFAULTS), not the values an
// A1_INTENT_* override set for this process; an override may only tighten, so
// a writer that keeps to the defaults is refused at worst, never trusted
// more. That is why a golden plus a sha256 pin can freeze it
// (_test-fixtures/a1-intent/cases/09-schema.golden.v<N>.json): any change to
// the exported shape or values bumps INTENT_CONTRACT_VERSION in the same
// commit, into a new golden file.
//
// What the JSON Schema cannot say, and where it is said instead:
//   - file-level rules (byte cap before parsing, empty body, file name
//     <id>.md, payload byte cap): `x-file-rules`;
//   - the executor-device condition of the approval group (FR-045), the
//     realpath half of project_invalid, target_not_found and all
//     authenticity rules: `x-not-expressible`;
//   - the phone-visible part of the action table (kind, target rule,
//     executor-only), never argv, prompt, allowlist or mode: `x-action-table`.
// ---------------------------------------------------------------------------

const {
  INTENT_ACTIONS, INTENT_STATUSES, INTENT_REJECT_REASONS, INTENT_FAILURE_REASONS, INTENT_REFUSAL_CODES,
  VAULT_CONTRACT_VERSION,
} = require('./status-constants.cjs');
const {
  INTENT_TYPE, INTENT_SCHEMA_VERSION, INTENT_REQUIRED_KEYS, INTENT_OPTIONAL_KEYS, INTENT_A1_ONLY_KEYS,
  INTENT_APPROVAL_KEYS, INTENT_ID_RE, INTENT_LIMIT_DEFAULTS, ACTION_TABLE,
  INTENT_TARGET_SHA256_KEY, TARGET_SHA256_RE, INTENT_HOSTNAME_RE,
} = require('./intent-constants.cjs');
const { DEVICE_ID_RE, NONCE_RE, UTC_TIMESTAMP_RE, LIFECYCLE_FOLDERS } = require('./intent-validate.cjs');
const { CANONICAL_STRING_FIELDS, CANONICAL_TARGET_SHA256_FIELD, SIGNATURE_PREFIX } = require('./intent-sign.cjs');
const { APPROVED_VIA } = require('./intent-approval.cjs');
const { RESULT_KEYS } = require('./intent-result.cjs');
const { SLUG_RE } = require('./worktree-registry.cjs');

// Bump together with a new golden (see the header). 2: target_sha256 (spec
// round 6), a1-only value forms, the 8th refusal code display_unsafe.
const INTENT_CONTRACT_VERSION = 2;

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const PROCESSED_DEF = 'processed_intent';
const REJECTED_DEF = 'rejected_reason';
const FAILURE_DEF = 'failure_reason';
const RESULT_TYPE = 'intent-result';
const RESULT_STATUSES = Object.freeze(['done', 'failed']);
const QUEUED_STATUS = 'queued';
// Spec round 6 — the one action whose intent is bound to its target's bytes.
const BOUND_ACTION = 'approve';
const INTENTS_DIR = 'inbox/intents';

// ---------- forms ----------
const str = () => ({ type: 'string' });
const re = (rx) => ({ type: 'string', pattern: rx.source });
const utc = () => ({ type: 'string', pattern: UTC_TIMESTAMP_RE.source, format: 'date-time' });
const nullable = (form) => ({ anyOf: [form, { type: 'null' }] });
const ref = (def) => ({ $ref: `#/$defs/${def}` });

// status is folder-dependent (FR-007, FR-008): the root schema is the
// queued/ note Lumen writes; $defs.processed_intent is claimed/, done/,
// rejected/ as a1 leaves them.
const NOTE_FORMS = Object.freeze({
  type: () => ({ const: INTENT_TYPE }),
  schema_version: () => ({ type: 'integer', const: INTENT_SCHEMA_VERSION }),
  id: () => re(INTENT_ID_RE),
  action: () => ({ enum: [...INTENT_ACTIONS] }),
  project: () => re(SLUG_RE),
  payload: str,
  target: str, // the per-action rule is in allOf (targetRules)
  target_sha256: () => re(TARGET_SHA256_RE), // required for approve, forbidden otherwise (allOf)
  created_at: utc,
  created_by: () => re(DEVICE_ID_RE),
  nonce: () => re(NONCE_RE),
  status: (processed) => (processed ? { enum: [...INTENT_STATUSES] } : { const: QUEUED_STATUS }),
  signature: str, // its form is checked with the signature (signature_invalid), not as a shape rule
  approved_from_device: () => re(DEVICE_ID_RE),
  approved_at: utc,
  approved_via: () => ({ enum: [...APPROVED_VIA] }),
  approved_by_intent: () => ({ type: ['string', 'null'], pattern: INTENT_ID_RE.source }),
});

// FR-045 — approved_by_intent follows approved_via.
const VIA_PAIRING = Object.freeze({
  intent: () => re(INTENT_ID_RE),
  tty: () => ({ type: 'null' }),
});

// FR-008 — written by a1 only, unsigned outside queued/; since spec round 6
// validate checks the same value forms (schema_invalid).
const A1_ONLY_FORMS = Object.freeze({
  claimed_by: () => re(INTENT_HOSTNAME_RE),
  claimed_at: utc,
  started_at: utc,
  finished_at: utc,
  exit_code: () => ({ type: ['integer', 'null'] }),
  rejected_reason: () => ref(REJECTED_DEF),
  rejected_by: () => re(INTENT_HOSTNAME_RE),
  rejected_at: utc,
  failure_reason: () => ref(FAILURE_DEF),
  cancelled_by_intent: () => re(INTENT_ID_RE),
});

// FR-030 — the result note, every key always written (intent-result.cjs).
const RESULT_FORMS = Object.freeze({
  type: () => ({ const: RESULT_TYPE }),
  schema_version: () => ({ type: 'integer', const: INTENT_SCHEMA_VERSION }),
  intent_id: () => re(INTENT_ID_RE),
  action: () => ({ enum: [...INTENT_ACTIONS] }),
  project: () => re(SLUG_RE),
  target: () => ({ type: ['string', 'null'] }),
  status: () => ({ enum: [...RESULT_STATUSES] }),
  failure_reason: () => nullable(ref(FAILURE_DEF)),
  started_at: () => nullable(utc()),
  finished_at: utc,
  duration_s: () => ({ type: ['integer', 'null'] }),
  exit_code: () => ({ type: ['integer', 'null'] }),
  executor_host: str,
  artifacts: () => ({ type: 'array', items: { type: 'string' } }),
  truncated: () => ({ type: 'boolean' }),
});

// FR-036 — one rendering hint per code, German like Lumen's UI. The quoted
// ones are the spec's wording; the rest follow the same voice.
const REJECT_HINTS = Object.freeze({
  schema_invalid: 'Notiz passt nicht zum Vertrag (Felder oder Format)',
  id_mismatch: 'Dateiname passt nicht zur id',
  action_unknown: 'unbekannte Aktion',
  project_invalid: 'Projekt nicht gefunden',
  oversized: 'zu groß: Text kürzen, dann erneut senden',
  target_invalid: 'Ziel fehlt oder hat die falsche Form',
  target_not_found: 'Ziel nicht gefunden',
  approve_from_non_executor_device: 'Freigabe nur am Mac möglich',
  device_unknown: 'wartet auf Freigabe',
  signature_invalid: 'wartet auf Freigabe',
  stale: 'erneut senden',
  replay: 'bereits verarbeitet (doppelt gesendet)',
  not_executor_host: 'nur der Mac führt Aufträge aus',
  ledger_unreadable: 'Auftragsbuch am Mac nicht lesbar; am Mac prüfen',
  tampered: 'nach dem Übernehmen verändert; am Mac prüfen',
  cancelled_by_user: 'abgebrochen',
  workspace_not_isolated: 'am Mac aufräumen: offene Änderungen oder Branch `main`, dann erneut senden',
});
const FAILURE_HINTS = Object.freeze({
  timeout: 'Zeitlimit überschritten',
  expired: 'nicht rechtzeitig gestartet; erneut senden',
  spawn_error: 'Start am Mac fehlgeschlagen',
  nonzero_exit: 'mit Fehler beendet; Ergebnisnotiz ansehen',
  cancelled: 'abgebrochen',
  sandbox_invalid: 'Sandbox-Prüfung am Mac fehlgeschlagen, `intent seal` prüfen',
  parent_step_failed: 'Prüfschritt am Mac fehlgeschlagen: Integritätsprüfung, xprov-Gate oder Postmortem; Protokoll am Mac ansehen',
});

// FR-010, FR-036 — the four signing rules measured in waves 1–3.
const SIGNING_RULES = Object.freeze([
  Object.freeze({ id: 'key_raw_bytes', rule: 'The HMAC-SHA256 key is the device secret\'s 32 raw bytes (hex-decoded), not its 64-character hex text.' }),
  Object.freeze({ id: 'target_empty', rule: 'target absent, target: null and target: "" give the same empty field.' }),
  Object.freeze({ id: 'payload_decoded', rule: 'payload is hashed as UTF-8 after YAML decoding, with CRLF normalised to LF; the raw file bytes are never hashed.' }),
  Object.freeze({ id: 'quote_nonce_created_by', rule: 'nonce and created_by are written as quoted YAML strings; an unquoted value of decimal digits only parses as a number and fails schema_invalid.' }),
]);

const NOT_EXPRESSIBLE = Object.freeze([
  'approval group only under created_by == executor_device of executor.json (FR-045); else schema_invalid after authenticity',
  'project realpath inside ~/claude-projects/ (FR-004); else project_invalid',
  'approve/cancel target names an existing intent, never the intent itself (FR-006); else target_not_found',
  'approve only from the executor device (FR-006); else approve_from_non_executor_device',
  'target_sha256 equals the sha256 of the target file\'s current bytes when the approve is applied (FR-015); else target_not_found',
  'an approve target is neither an approve nor a cancel intent and can be displayed safely (FR-015); else target_invalid',
  'device provisioned, signature, freshness window (FR-010..FR-013)',
]);

function sameSet(label, have, want) {
  const a = [...have].sort().join(',');
  const b = [...want].sort().join(',');
  if (a !== b) throw new Error(`intent-schema: ${label} (${a}) differs from its constant (${b})`);
}

const NOTE_KEYS = Object.freeze([...INTENT_REQUIRED_KEYS, ...INTENT_OPTIONAL_KEYS, INTENT_TARGET_SHA256_KEY, ...INTENT_APPROVAL_KEYS]);
sameSet('NOTE_FORMS', Object.keys(NOTE_FORMS), NOTE_KEYS);
if (!Object.prototype.hasOwnProperty.call(ACTION_TABLE, BOUND_ACTION) || CANONICAL_TARGET_SHA256_FIELD !== INTENT_TARGET_SHA256_KEY) {
  throw new Error('intent-schema: the target_sha256 binding (action, key, canonical field) differs from its constants');
}
sameSet('A1_ONLY_FORMS', Object.keys(A1_ONLY_FORMS), INTENT_A1_ONLY_KEYS);
sameSet('RESULT_FORMS', Object.keys(RESULT_FORMS), RESULT_KEYS);
sameSet('VIA_PAIRING', Object.keys(VIA_PAIRING), APPROVED_VIA);
sameSet('REJECT_HINTS', Object.keys(REJECT_HINTS), INTENT_REJECT_REASONS);
sameSet('FAILURE_HINTS', Object.keys(FAILURE_HINTS), INTENT_FAILURE_REASONS);

// ---------- building blocks ----------
const [ACTION_KEY, TARGET_KEY] = ['action', 'target'];
const [VIA_KEY, BY_INTENT_KEY] = ['approved_via', 'approved_by_intent'];

// FR-006 — per action: the target is required with the row's regex, or absent.
function targetRules() {
  return Object.entries(ACTION_TABLE).map(([action, row]) => ({
    if: { properties: { [ACTION_KEY]: { const: action } }, required: [ACTION_KEY] },
    then: row.targetRequired
      ? { required: [TARGET_KEY], properties: { [TARGET_KEY]: re(row.targetRe) } }
      : { not: { required: [TARGET_KEY] } },
  }));
}

// Spec round 6 — target_sha256 is required for approve and forbidden otherwise.
function targetShaRule() {
  return {
    if: { properties: { [ACTION_KEY]: { const: BOUND_ACTION } }, required: [ACTION_KEY] },
    then: { required: [INTENT_TARGET_SHA256_KEY] },
    else: { not: { required: [INTENT_TARGET_SHA256_KEY] } },
  };
}

function viaRules() {
  return APPROVED_VIA.map((via) => ({
    if: { properties: { [VIA_KEY]: { const: via } }, required: [VIA_KEY] },
    then: { properties: { [BY_INTENT_KEY]: VIA_PAIRING[via]() } },
  }));
}

function approvalDependencies() {
  return Object.fromEntries(INTENT_APPROVAL_KEYS.map((k) => [k, INTENT_APPROVAL_KEYS.filter((o) => o !== k)]));
}

function noteProperties(processed) {
  const own = NOTE_KEYS.map((k) => [k, NOTE_FORMS[k](processed)]);
  const extra = processed ? INTENT_A1_ONLY_KEYS.map((k) => [k, A1_ONLY_FORMS[k]()]) : [];
  return Object.fromEntries([...own, ...extra]);
}

// The intent frontmatter schema; `processed` = claimed/, done/, rejected/.
function buildIntentSchema({ processed = false } = {}) {
  return {
    type: 'object',
    properties: noteProperties(processed),
    required: [...INTENT_REQUIRED_KEYS],
    additionalProperties: false,
    dependentRequired: approvalDependencies(),
    allOf: [...targetRules(), targetShaRule(), ...viaRules()],
  };
}

function buildResultSchema() {
  return {
    type: 'object',
    properties: Object.fromEntries(RESULT_KEYS.map((k) => [k, RESULT_FORMS[k]()])),
    required: [...RESULT_KEYS],
    additionalProperties: false,
  };
}

function actionTable() {
  return Object.fromEntries(Object.entries(ACTION_TABLE).map(([action, row]) => [action, {
    kind: row.kind,
    target_required: row.targetRequired,
    target_pattern: row.targetRe ? row.targetRe.source : null,
    executor_device_only: row.executorDeviceOnly,
    target_sha256_required: action === BOUND_ACTION,
  }]));
}

function fileRules() {
  return {
    folders: [...LIFECYCLE_FOLDERS].map((f) => `${INTENTS_DIR}/${f}/`),
    write_folder: `${INTENTS_DIR}/${QUEUED_STATUS}/`,
    filename: '<id>.md',
    body: 'empty',
    max_bytes: INTENT_LIMIT_DEFAULTS.INTENT_MAX_BYTES,
    payload_max_bytes: INTENT_LIMIT_DEFAULTS.INTENT_PAYLOAD_MAX_BYTES,
    processed_schema: PROCESSED_DEF,
    result_path: 'project/<slug>/intents/<id>.md',
  };
}

function signatureSpec() {
  return {
    prefix: SIGNATURE_PREFIX,
    algorithm: 'HMAC-SHA256',
    encoding: 'lowercase hex, 64 characters',
    join: '\n',
    trailing_newline: false,
    null_or_absent_field: '',
    payload_field: 'sha256 hex of the payload',
    field_order: 'the 9 x-canonical-signature fields, then x-canonical-signature-approve for action approve only, then x-canonical-signature-approval when the group is present',
  };
}

function catalog(codes, hints) {
  return { enum: [...codes], 'x-render-hints': Object.fromEntries([...codes].map((c) => [c, hints[c]])) };
}

// The whole FR-035 document.
function buildSchemaDocument() {
  return {
    $schema: DRAFT,
    title: 'a1 intent note frontmatter (inbox/intents/queued/)',
    'x-contract-version': INTENT_CONTRACT_VERSION,
    'x-vault-contract-version': VAULT_CONTRACT_VERSION,
    ...buildIntentSchema(),
    'x-file-rules': fileRules(),
    'x-limits': { ...INTENT_LIMIT_DEFAULTS },
    'x-canonical-signature': [...CANONICAL_STRING_FIELDS],
    'x-canonical-signature-approve': [CANONICAL_TARGET_SHA256_FIELD],
    'x-canonical-signature-approval': [...INTENT_APPROVAL_KEYS],
    'x-signature': signatureSpec(),
    'x-signing-rules': SIGNING_RULES.map((r) => ({ ...r })),
    'x-approval-keys': [...INTENT_APPROVAL_KEYS],
    'x-a1-only-keys': [...INTENT_A1_ONLY_KEYS],
    'x-refusal-codes': [...INTENT_REFUSAL_CODES],
    'x-action-table': actionTable(),
    'x-not-expressible': [...NOT_EXPRESSIBLE],
    $defs: {
      [PROCESSED_DEF]: buildIntentSchema({ processed: true }),
      result: buildResultSchema(),
      [REJECTED_DEF]: catalog(INTENT_REJECT_REASONS, REJECT_HINTS),
      [FAILURE_DEF]: catalog(INTENT_FAILURE_REASONS, FAILURE_HINTS),
    },
  };
}

// The bytes on stdout: 2-space indent, one trailing newline.
function serializeSchemaDocument(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// `intent schema --json` (FR-035): exactly one argument, `--json`; any host,
// reads and writes nothing (FR-017). Usage errors exit 2 without stdout.
function cmdIntentSchema(args) {
  if (args.length !== 1 || args[0] !== '--json') {
    process.stderr.write('usage error: intent schema --json (exactly one flag, --json)\n');
    process.stderr.write('see: a1-tools --help (section "a1-tools intent")\n');
    process.exitCode = 2;
    return;
  }
  process.stdout.write(serializeSchemaDocument(buildSchemaDocument()));
  process.exitCode = 0;
}

module.exports = {
  INTENT_CONTRACT_VERSION,
  buildIntentSchema,
  buildResultSchema,
  buildSchemaDocument,
  serializeSchemaDocument,
  cmdIntentSchema,
};
