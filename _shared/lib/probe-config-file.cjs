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

const GIT_ENV_DROP = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_NAMESPACE', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'];

/** Environment for the git checks: an inherited GIT_DIR / GIT_WORK_TREE must not point git at another repository. */
function gitEnv() {
  const env = { ...process.env };
  for (const k of GIT_ENV_DROP) delete env[k];
  return env;
}

/**
 * SEC-11: the probe file is read from a work tree whose copy was reviewed. Refused (`probes_file_uncommitted`): the project is not a git
 * work tree, the file is not tracked (untracked, assume-unchanged, skip-worktree), or it differs from HEAD (staged or unstaged).
 * Fixed argv through the audited git helper (execFileSync, no shell); the path follows `--`.
 */
function assertCommitted(projectDir) {
  const { gitSafe } = require(path.join(__dirname, 'git-safe.cjs'));
  const opts = { allowFail: true, env: gitEnv() };
  const git = (args) => gitSafe(projectDir, ['-c', 'core.fsmonitor=false', ...args], opts);
  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') fail('probes_file_uncommitted', FILE_REL);
  const tracked = git(['ls-files', '-v', '--', FILE_REL.split(path.sep).join('/')]);
  if (typeof tracked !== 'string' || !tracked.startsWith('H ')) fail('probes_file_uncommitted', FILE_REL);
  const same = git(['diff', '--quiet', '--no-ext-diff', 'HEAD', '--', FILE_REL.split(path.sep).join('/')]);
  if (typeof same !== 'string') fail('probes_file_uncommitted', FILE_REL);
}

/** Text of the probe file, or null when it does not exist. The file must be committed and unmodified (assertCommitted) before it is read. */
function readProbeFile(file, projectDir) {
  let st;
  try { st = fs.lstatSync(file); } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    return fail('unreadable', FILE_REL);
  }
  if (!st.isFile()) fail('not_a_regular_file', FILE_REL);
  assertCommitted(projectDir);
  if (st.size > MAX_BYTES) fail('file_too_large', FILE_REL);
  if (st.size === 0) fail('empty_file', FILE_REL);
  let buf;
  try { buf = fs.readFileSync(file); } catch (_e) { return fail('unreadable', FILE_REL); }
  if (buf.length > MAX_BYTES) fail('file_too_large', FILE_REL);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_e) { return fail('invalid_utf8', FILE_REL); }
}

module.exports = { ProbeConfigError, fail, FILE_REL, MAX_BYTES, assertPlainConfigDir, readProbeFile };
