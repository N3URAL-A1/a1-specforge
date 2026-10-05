'use strict';

// ---------------------------------------------------------------------------
// intent-list — `a1-tools intent list` (spec 011, Wave 8: FR-034, FR-009).
// Read-only: one JSON row { path, state, id, action, project, created_by,
// created_at, reason } per .md file under inbox/intents/<folder>/.
//
//   state     the folder (queued|claimed|done|rejected); `ignored` for a
//             sync-conflict copy (vault-common isConflictCopy: the measured
//             Obsidian, Syncthing and Dropbox names; never read, FR-009);
//             `tampered` for a file a1 wrote last whose bytes differ from the
//             hash the ledger recorded at that write (claimed/: the open
//             row's claimed_sha256, or no row at all; done/ and rejected/:
//             the row's file_sha256). queued/ is never tampered (a1 never
//             wrote it); a done/ or rejected/ file without a recorded hash
//             (rejected before any claim, or a row from before Wave 8)
//             cannot be judged and keeps its folder state.
//   reason    rejected_reason in rejected/, failure_reason in done/, else null.
//
// The tamper judgement needs this host's ledger: off the executor host
// (FR-017) every file keeps its folder state. Non-.md entries and anything
// that is not a regular file are skipped silently (Obsidian dotfiles). `list`
// never reads ~/.a1-intents/runs/.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { isConflictCopy } = require('./vault-common.cjs');
const { INTENT_ID_RE } = require('./intent-constants.cjs');

const FOLDERS = Object.freeze(['queued', 'claimed', 'done', 'rejected']);
const LIST_STATES = Object.freeze([...FOLDERS, 'ignored', 'tampered', 'all']);
const INTENTS_DIR = path.join('inbox', 'intents');
const [EXIT_OK, EXIT_REFUSED, EXIT_OPERATOR] = [0, 1, 2];

const sha256 = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

// The fields of one file (bounded read through the validator's reader), or
// nulls when it cannot be read or parsed.
function readFields(file) {
  const { readIntentFile, parseIntentFrontmatter } = require('./intent-validate.cjs');
  try {
    const read = readIntentFile(file, { maxBytes: require('./intent-constants.cjs').INTENT_CLAIMED_MAX_BYTES });
    if (!read.ok) return { content: null, fm: {} };
    const parsed = parseIntentFrontmatter(read.content);
    return { content: read.content, fm: parsed.ok ? parsed.fm : {} };
  } catch (_e) {
    return { content: null, fm: {} }; // vanished between readdir and read
  }
}

const str = (v) => (typeof v === 'string' ? v : null);

// FR-034 — tampered: a1's last recorded write of this file differs from it.
function isTampered(folder, stem, content, rows) {
  if (rows === null || folder === 'queued') return false;
  const { findRow } = require('./intent-ledger.cjs');
  const row = INTENT_ID_RE.test(stem) ? findRow(rows, stem) : null;
  if (folder === 'claimed') {
    if (row === null) return true; // a claimed file without a claim
    if (row.finished_at !== null && row.finished_at !== undefined) return false; // judged by its own folder later
    return content === null || sha256(content) !== row.claimed_sha256;
  }
  const recorded = row === null ? null : str(row.file_sha256);
  return recorded !== null && (content === null || sha256(content) !== recorded);
}

function rowOf(root, folder, name, rows) {
  const rel = path.join(INTENTS_DIR, folder, name);
  if (isConflictCopy(name)) {
    return { path: rel, state: 'ignored', id: null, action: null, project: null, created_by: null, created_at: null, reason: null };
  }
  const { content, fm } = readFields(path.join(root, folder, name));
  const stem = path.basename(name, '.md');
  const reason = folder === 'rejected' ? str(fm.rejected_reason) : folder === 'done' ? str(fm.failure_reason) : null;
  return {
    path: rel,
    state: isTampered(folder, stem, content, rows) ? 'tampered' : folder,
    id: str(fm.id), action: str(fm.action), project: str(fm.project), created_by: str(fm.created_by), created_at: str(fm.created_at), reason,
  };
}

// Regular .md files of one folder, by name; a missing folder is empty.
function mdFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name).sort();
}

// -> the ledger rows when this is the executor host, else null (no judgement).
function ledgerRowsIfExecutor(d) {
  const { requireExecutorHost } = require('./intent-lifecycle.cjs');
  if (requireExecutorHost(d) === null) return null;
  return require('./intent-ledger.cjs').loadLedger({ homedir: d.homedir }).rows;
}

// FR-034 -> { exitCode, out: rows[] }; `state` filters (all = every row).
function listIntents(state = 'all', deps = {}) {
  const os = require('os');
  const d = { hostname: os.hostname(), homedir: os.homedir, now: Date.now, vault: process.env.A1_VAULT_ROOT || null, ...deps };
  if (!LIST_STATES.includes(state)) return Object.freeze({ exitCode: EXIT_OPERATOR, out: null, usage: `intent list: --state must be one of ${LIST_STATES.join(', ')}` });
  if (!d.vault) return Object.freeze({ exitCode: EXIT_OPERATOR, out: null, usage: 'intent list: A1_VAULT_ROOT is not set' });
  const root = path.join(d.vault, INTENTS_DIR);
  const rows = ledgerRowsIfExecutor(d);
  const all = FOLDERS.flatMap((folder) => mdFiles(path.join(root, folder)).map((name) => rowOf(root, folder, name, rows)));
  return Object.freeze({ exitCode: EXIT_OK, out: state === 'all' ? all : all.filter((r) => r.state === state) });
}

// `a1-tools intent list [--state <s>]`
function cmdIntentList(args) {
  const { emit, decideError } = require('./intent-lifecycle.cjs');
  const usage = (text) => emit({ exitCode: EXIT_OPERATOR, out: null, usage: text });
  const i = args.indexOf('--state');
  const state = i === -1 ? 'all' : args[i + 1];
  const rest = args.filter((_a, j) => i === -1 || (j !== i && j !== i + 1));
  if (rest.length > 0 || state === undefined) return usage(`intent list [--state ${LIST_STATES.join('|')}]`);
  let r;
  try {
    r = listIntents(state);
  } catch (e) {
    const os = require('os');
    r = decideError({ hostname: os.hostname(), homedir: os.homedir, now: Date.now }, 'list', null, e);
  }
  if (r.usage) return emit(r);
  process.stdout.write(`${JSON.stringify(r.out, null, 2)}\n`);
  process.exitCode = r.exitCode;
  return undefined;
}

module.exports = { listIntents, cmdIntentList, isTampered, LIST_STATES, EXIT_REFUSED };
