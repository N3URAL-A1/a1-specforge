'use strict';

// probe-config-file — file access of `.a1/live-probes.yaml` (spec 020-live-probes, SEC-1/2/8/9 and the shared error type).
// Split out of probe-config.cjs: everything that touches the filesystem lives here, the grammar and policy stay there.
// No network, no module-global state, no process spawning of its own: the one git check (SEC-11) goes through git-safe.cjs. The file is read by its exact, byte-for-byte name from a real
// `.a1` directory; every refusal is a ProbeConfigError (callers exit 2).

const fs = require('fs');
const path = require('path');

const FILE_REL = path.join('.a1', 'live-probes.yaml');
const MAX_BYTES = 256 * 1024;

class ProbeConfigError extends Error {
  constructor(code, where, line) {
    super(`${code}${where ? `: ${where}` : ''}${line ? ` (line ${line})` : ''}`);
    this.name = 'ProbeConfigError';
    this.code = code;
    this.where = where || '';
  }
}
const fail = (code, where, line) => { throw new ProbeConfigError(code, where, line); };

const FILE_NAME = path.basename(FILE_REL);
const DIR_NAME = path.dirname(FILE_REL);
const NON_ASCII_RE = /[^\u0000-\u007f]/;

/** Entries of `dir` that could be a differently spelled name of `exact`: any non-ASCII name or an ASCII case variant (what a folding filesystem can alias). */
function aliasCandidates(names, exact) {
  return names.filter((n) => n !== exact && (NON_ASCII_RE.test(n) || n.toLowerCase() === exact));
}
const sameNode = (a, b) => a.ino === b.ino && a.dev === b.dev;

/**
 * `exact` must be listed byte-for-byte in `dir`, and no other entry may be the same file or directory (same ino+dev). A filesystem
 * that folds case or Unicode (APFS: U+017F -> s) would otherwise open `live-probeſ.yaml` when asked for `live-probes.yaml`, and the
 * merge guard, which compares git paths, would never have seen that name. Never open a name that is not byte-exact.
 */
function assertByteExact(dir, exact, st) {
  let names;
  try { names = fs.readdirSync(dir); } catch (_e) { return fail('unreadable', FILE_REL); }
  if (!names.includes(exact)) fail('config_name_variant', FILE_REL);
  for (const n of aliasCandidates(names, exact)) {
    let other;
    try { other = fs.lstatSync(path.join(dir, n)); } catch (_e) { continue; }
    if (sameNode(st, other)) fail('config_name_variant', FILE_REL);
  }
  return names;
}

/**
 * SEC-1/SEC-2/SEC-8/SEC-9: the file must be read from a real `.a1` directory under the project (not a symlink, not a submodule),
 * by its exact name. Refused: a symlinked `.a1` or one whose real path leaves the project (`a1_dir_symlink`), a submodule checkout
 * (`a1_dir_submodule`), a case variant of the file name (`config_case_variant`), and any name variant the filesystem aliases onto
 * the guarded name (`config_name_variant`).
 */
function assertPlainConfigDir(projectDir) {
  const dir = path.join(projectDir, DIR_NAME);
  let st;
  try { st = fs.lstatSync(dir); } catch (e) {
    if (e && e.code === 'ENOENT') return;
    fail('unreadable', FILE_REL);
  }
  if (st.isSymbolicLink()) fail('a1_dir_symlink', FILE_REL);
  if (!st.isDirectory()) fail('not_a_regular_file', FILE_REL);
  assertByteExact(projectDir, DIR_NAME, st);
  let real; let realProject;
  try { real = fs.realpathSync.native(dir); realProject = fs.realpathSync.native(projectDir); } catch (_e) { return fail('unreadable', FILE_REL); }
  if (real !== path.join(realProject, DIR_NAME)) fail('a1_dir_symlink', FILE_REL);
  try { fs.lstatSync(path.join(dir, '.git')); fail('a1_dir_submodule', FILE_REL); } catch (e) { if (e instanceof ProbeConfigError) throw e; }
  let names;
  try { names = fs.readdirSync(dir); } catch (_e) { return fail('unreadable', FILE_REL); }
  if (names.some((n) => n !== FILE_NAME && n.toLowerCase() === FILE_NAME)) fail('config_case_variant', FILE_REL);
  let fst = null;
  try { fst = fs.lstatSync(path.join(dir, FILE_NAME)); } catch (e) { if (!e || e.code !== 'ENOENT') fail('unreadable', FILE_REL); }
  if (fst === null) return;
  assertByteExact(dir, FILE_NAME, fst);
}

const REL_GIT = FILE_REL.split(path.sep).join('/');
const REVIEWED_REFS = ['refs/remotes/origin/HEAD', 'refs/remotes/origin/main'];
const CAT_MAX_BUFFER = 8 * 1024 * 1024;

/** Environment for the git calls: no inherited repository selection and no injected configuration (filters, fsmonitor, aliases). */
function gitEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_CONFIG') && !/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|NAMESPACE|ALTERNATE_OBJECT_DIRECTORIES|REPLACE_REF_BASE)$/.test(k)) env[k] = v;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  return env;
}

/** Runner of fixed-argv git calls through the audited helper. Returns trimmed stdout, or null when git fails. */
function gitRunner(projectDir, extra) {
  const { gitSafe } = require(path.join(__dirname, 'git-safe.cjs'));
  const opts = { allowFail: true, env: gitEnv(), ...extra };
  return (args) => {
    const r = gitSafe(projectDir, ['--no-replace-objects', '-c', 'core.fsmonitor=false', ...args], opts);
    return typeof r === 'string' ? r : null;
  };
}

/**
 * SEC-11 (working tree): the file must be tracked and equal to HEAD, so the message for an edited, staged or untracked file is clear.
 * Refused (`probes_file_uncommitted`): not a git work tree, untracked / assume-unchanged / skip-worktree, or differs from HEAD.
 * This is only the first line of defence; the text itself comes from the git object (readReviewedBlob), never from the file.
 */
function assertCommitted(git) {
  if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') fail('probes_file_uncommitted', FILE_REL);
  const tracked = git(['ls-files', '-v', '--', REL_GIT]);
  if (tracked === null || !tracked.startsWith('H ')) fail('probes_file_uncommitted', FILE_REL);
  if (git(['diff', '--quiet', '--no-ext-diff', 'HEAD', '--', REL_GIT]) === null) fail('probes_file_uncommitted', FILE_REL);
}

/**
 * SEC-11 (review binding): blob(HEAD:path) must equal blob(<reviewed ref>:path), where the reviewed ref is origin/HEAD, else origin/main.
 * A local, unpushed commit therefore never counts as reviewed. Returns the blob id.
 */
function reviewedBlob(git) {
  const head = git(['rev-parse', '--verify', '-q', `HEAD:./${REL_GIT}`]);
  if (head === null) fail('probes_file_uncommitted', FILE_REL);
  const ref = REVIEWED_REFS.find((r) => git(['rev-parse', '--verify', '-q', `${r}^{commit}`]) !== null);
  if (!ref) fail('probes_no_reviewed_ref', FILE_REL);
  if (git(['rev-parse', '--verify', '-q', `${ref}:./${REL_GIT}`]) !== head) fail('probes_file_unreviewed', FILE_REL);
  return head;
}

const objectHash = (oid, buf) => require('crypto').createHash(oid.length === 64 ? 'sha256' : 'sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

/**
 * Bytes of blob `oid` straight from the object store (`cat-file --batch`, never --filters). The blob is requested twice so the content
 * sits between two header lines: git-safe trims the ends of stdout, and a trailing tab or CR must reach the control-character check.
 * The bytes are verified against the object id before they are used.
 */
function readBlob(projectDir, oid) {
  const size = Number(gitRunner(projectDir, {})(['cat-file', '-s', oid]));
  if (!Number.isInteger(size)) fail('unreadable', FILE_REL);
  if (size > MAX_BYTES) fail('file_too_large', FILE_REL);
  if (size === 0) fail('empty_file', FILE_REL);
  const out = gitRunner(projectDir, { encoding: 'latin1', input: `${oid}\n${oid}\n`, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: CAT_MAX_BUFFER })(['cat-file', '--batch']);
  const header = `${oid} blob ${size}\n`;
  if (out === null || !out.startsWith(header)) fail('unreadable', FILE_REL);
  const buf = Buffer.from(out.slice(header.length, header.length + size), 'latin1');
  if (buf.length !== size || objectHash(oid, buf) !== oid) fail('unreadable', FILE_REL);
  return buf;
}

/**
 * Text of the probe file, or null when no file is on disk. The text is never read from the filesystem: it is the reviewed git blob
 * (see assertCommitted, reviewedBlob, readBlob), so a clean filter, a local commit or a change after the check cannot alter what runs.
 */
function readProbeFile(file, projectDir) {
  let st;
  try { st = fs.lstatSync(file); } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    return fail('unreadable', FILE_REL);
  }
  if (!st.isFile()) fail('not_a_regular_file', FILE_REL);
  const git = gitRunner(projectDir, {});
  assertCommitted(git);
  const buf = readBlob(projectDir, reviewedBlob(git));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_e) { return fail('invalid_utf8', FILE_REL); }
}

module.exports = { ProbeConfigError, fail, FILE_REL, MAX_BYTES, assertPlainConfigDir, readProbeFile };
