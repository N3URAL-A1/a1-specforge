'use strict';

// ---------------------------------------------------------------------------
// vault-common — the rules every vault-*.cjs module shares (spec
// 010-vault-cockpit-contract, review fix m2). One definition each, so lint,
// status, sync, link-hub and the product hook can no longer disagree:
//
//   isConflictCopy      FR-014: which basenames are sync-conflict copies;
//   externalVaultRoot   FR-001: only tier env/legacy is a vault, and the
//                       refusal is decided BEFORE vaultRootInfo() runs (the
//                       repo-local tier would create .a1/learnings/);
//   rootProblem         FR-010: a configured root that is missing, not a
//                       directory or lacks the access the command needs;
//   hostIdentity        FR-039: the id this host goes by (writer gate in
//                       vault-writer.cjs, lock payloads in locks.cjs).
//
// Library only: no process.exit, no module-level state.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const { peekVaultRoot, vaultRootInfo } = require('./io.cjs');

/** Upper bound for a project slug that reaches the filesystem (ENAMETOOLONG guard). */
const MAX_SLUG_LENGTH = 100;

// ---------- conflict copies (FR-014) ----------

// The forms the sync tools write next to the original:
//   Obsidian Sync  `001-x (conflict 2).md`, `001-x (conflict 2026-09-25).md`
//   Dropbox        `001-x (conflicted copy 2026-09-25).md` (any case)
//   Syncthing      `001-x.sync-conflict-20260925-101010-ABCDEFG.md`
const CONFLICT_COPY_RE = /\((?:conflict|conflicted copy)\b|\.sync-conflict-/i;

/** True for a sync-conflict copy: reported, never pruned, never linked. */
function isConflictCopy(basename) {
  return CONFLICT_COPY_RE.test(basename);
}

// ---------- small fs predicates ----------

/** True for a symlink (lstat); false when the path does not exist. */
function isLink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch (_e) { return false; }
}

/** Lexical containment: `candidate` is `root` or lies below it. */
function isInside(candidate, root) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/** Absolute paths of the real (non-link) subdirectories of `root`; [] if unreadable. */
function childDirs(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(root, d.name));
  } catch (_e) {
    return [];
  }
}

// ---------- activation (FR-001) and root checks (FR-010) ----------

const EXTERNAL_TIERS = new Set(['env', 'legacy']);

/**
 * `{ root }` (resolved) when an external vault root is configured, else
 * `{ refusal }` naming what is missing. The tier is looked up read-only first
 * (peekVaultRoot), so a refusal writes nothing and prints nothing; only an
 * accepted tier goes through vaultRootInfo(), which announces it once.
 */
function externalVaultRoot() {
  const peek = peekVaultRoot();
  if (!peek || !EXTERNAL_TIERS.has(peek.source)) {
    const tier = peek ? `tier ${peek.source}` : 'nothing resolves';
    return { refusal: `no external vault root (${tier}); set A1_VAULT_ROOT` };
  }
  return { root: path.resolve(vaultRootInfo().root) };
}

/** null when `root` is a directory with `mode` access (fs.constants.R_OK /
 * W_OK), else the FR-010 reason, which always names the root. */
function rootProblem(root, mode) {
  try {
    if (!fs.statSync(root).isDirectory()) return `vault root is not a directory: ${root}`;
    fs.accessSync(root, mode);
    return null;
  } catch (e) {
    return e.code === 'ENOENT' ? `vault root does not exist: ${root}` : `vault root not accessible: ${root} (${e.code})`;
  }
}

/** The one FR-010 / FR-034 stderr line: `[a1-tools] <what> skipped: <reason>`. */
function warnSkipped(what, reason) {
  process.stderr.write(`[a1-tools] ${what} skipped: ${reason}\n`);
}

// ---------- host identity (FR-039) ----------
//
// The id this host goes by for the per-project writer (FR-038..FR-040) and
// for lock payloads (FR-032/FR-033): A1_HOST_ID when set and non-empty, else
// os.hostname(); trimmed and lowercased. A value that fails HOST_ID_RE, is a
// YAML special or is purely numeric gives source `invalid` and the display
// host INVALID_HOST — the raw value is never echoed. The writer gate itself
// lives in vault-writer.cjs.

const HOST_ID_ENV = 'A1_HOST_ID';
const HOST_ID_RE = /^[a-z0-9]([a-z0-9.-]{0,61}[a-z0-9])?$/;
const YAML_SPECIALS = new Set(['true', 'false', 'yes', 'no', 'on', 'off', 'null', '~']);
const NUMERIC_RE = /^[0-9]+$/;
const INVALID_HOST = '<invalid>';

/** The normalised id, or null when `raw` is not a valid host id. */
function normalizeHostId(raw) {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().toLowerCase();
  if (!HOST_ID_RE.test(id) || YAML_SPECIALS.has(id) || NUMERIC_RE.test(id)) return null;
  return id;
}

/** hostIdentity(env?, osHost?) → fresh frozen { host, source }; source ∈
 * env | os | invalid, host is INVALID_HOST when the source is invalid. */
function hostIdentity(env = process.env, osHost = os.hostname()) {
  const raw = env[HOST_ID_ENV];
  const fromEnv = typeof raw === 'string' && raw.trim() !== '';
  const id = normalizeHostId(fromEnv ? raw : String(osHost));
  if (id === null) return Object.freeze({ host: INVALID_HOST, source: 'invalid' });
  return Object.freeze({ host: id, source: fromEnv ? 'env' : 'os' });
}

module.exports = {
  MAX_SLUG_LENGTH, isConflictCopy, isLink, isInside, childDirs,
  externalVaultRoot, rootProblem, warnSkipped,
  HOST_ID_ENV, INVALID_HOST, normalizeHostId, hostIdentity,
};
