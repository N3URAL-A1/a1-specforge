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
//   writerHostGate …    FR-034/FR-035: the single vault writer host.
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

// ---------- single vault writer (FR-034 / FR-035) ----------
//
// Exactly one host writes the vault: the one whose os.hostname() equals
// A1_VAULT_WRITER_HOST (exact string match after trimming — the value must be
// what `node -e 'console.log(require("os").hostname())'` prints there). Unset
// or empty → undeclared, every host may write. A non-writer host skips with
// one stderr line; no exit code changes. The gate only decides WHETHER to
// write; the realpath and segment guards decide WHERE, on every host.

const WRITER_HOST_ENV = 'A1_VAULT_WRITER_HOST';
const UNDECLARED_WRITER = 'undeclared';

/** writerHostGate(env?, host?) → fresh frozen { host, writerHost, mayWrite }. */
function writerHostGate(env = process.env, host = os.hostname()) {
  const raw = env[WRITER_HOST_ENV];
  const declared = typeof raw === 'string' ? raw.trim() : '';
  const writerHost = declared === '' ? UNDECLARED_WRITER : declared;
  return Object.freeze({ host, writerHost, mayWrite: declared === '' || declared === host });
}

/** The reason text for a non-writer host. */
function notWriterReason(gate) {
  return `this host is not the vault writer (${gate.host} ≠ ${gate.writerHost})`;
}

/** The non-writer skip every vault WRITE path shares: null when this host may
 * write; otherwise prints `[a1-tools] <what> skipped: <reason>` — `what`
 * names the write that is skipped (`vault mirror`, `vault lint --fix-type`,
 * `vault link-hub`, `spec init hub link`) — and returns the reason. */
function notWriterSkip(what = 'vault mirror', gate = writerHostGate()) {
  if (gate.mayWrite) return null;
  const reason = notWriterReason(gate);
  warnSkipped(what, reason);
  return reason;
}

module.exports = {
  MAX_SLUG_LENGTH, isConflictCopy, isLink, isInside, childDirs,
  externalVaultRoot, rootProblem, warnSkipped,
  writerHostGate, notWriterReason, notWriterSkip, UNDECLARED_WRITER,
};
