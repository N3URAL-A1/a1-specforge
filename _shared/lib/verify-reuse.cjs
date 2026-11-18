'use strict';

// Report copy and `verify reuse` (spec 027 slice 2, FR-008, D7/D8).
//   - `writeReportCopy` leaves every `verify run` record (without --base) under
//     `<git-common-dir>/a1-verify-reports/<head_sha>[-p<prefix hash>]-<scope>.json`, mode 0600 in a 0700 directory.
//   - `verify reuse --head <sha>` lets the local pre-push run (push-cadence P2) skip a run (read-only; merge-check never calls it).
//
// STATE MODEL. A report copy is reusable for (project P, head H) iff ALL of these hold; `reportReason` is the only
// place that decides, and it checks them in this order (the first failing one names the reason):
//   1. Commit: record.head_sha == H, and no commit between the run's commit and H changed code. Code = everything
//      outside `.a1/` plus `.a1/verify.json` and `.a1/dispositions.json` (CODE_IN_A1, checked in checkReuse because it
//      needs the diff; a `.a1/`-only commit of anything else, e.g. VERIFICATION.md or STATUS.md, is fine). Candidate:
//      the newest `<R>-full.json` among the last 50 commits.        reasons: head_moved, code_changed_after_run, report_sha_mismatch
//   2. Project: record.project_prefix == `git rev-parse --show-prefix` of P (the file name carries the same key).
//                                                                       reason: project_mismatch
//   3. Command set: record.config_digest == sha256 of `git show H:<prefix>.a1/verify.json` ('none' when H has none).
//      The run records the digest of the bytes it actually read, so a run made with an uncommitted edit differs from
//      the committed file; a record without a digest is refused too.   reason: config_mismatch
//   4. Clean tree: tree_clean was true at run time (before and after; verify-base dirtyPaths counts
//      CODE_IN_A1 as code, so an uncommitted verify.json or dispositions.json at run time makes it false) and no code
//      path is dirty now.                                               reasons: run_tree_dirty, tree_dirty
// Besides: the record is a regular 0600 file of ours in a 0700 directory, scope full, verdict pass, commands present,
// nothing skipped on the host, no env_red excuse. Exit 0 reusable / 1 not reusable (reason) / 2 usage.

const fs = require('fs');
const path = require('path');
const { parseFlags } = require('./io.cjs');
const { emitExit } = require('./emit-exit.cjs');
const crypto = require('crypto');
const { gitRaw, headSha, diffNames, SHA_RE } = require('./verify-check.cjs');
const { statusPaths } = require('./verify-run.cjs');
const { isCodeForReuse, configDigest } = require('./verify-base.cjs');

const REPORTS_DIR = 'a1-verify-reports';
const NAME_RE = /^[0-9a-f]{40}(-p[0-9a-f]{12})?-(full|affected)\.json$/;
const KEEP = 100;
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const REUSE_WINDOW = 50;
const MAX_ARG_LENGTH = 4096;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** True inside an `intent run` child: it writes nothing outside its project (spec 017 Q20). */
function inIntentChild() {
  try { return require('./intent-child.cjs').inChildMode() === true; } catch (_e) { return false; }
}

/**
 * @param {string} project
 * @returns {string|null} absolute `<git-common-dir>/a1-verify-reports`, or null outside a git repository
 */
function reportsDir(project) {
  const out = gitRaw(project, ['rev-parse', '--git-common-dir']);
  if (out === null || out.trim() === '') return null;
  return path.join(path.resolve(project, out.trim()), REPORTS_DIR);
}

/** `git rev-parse --show-prefix` of the realpath'd project ('' at the repository root), null when git cannot tell. */
function projectPrefix(project) {
  let real;
  try { real = fs.realpathSync(project); } catch (_e) { return null; }
  const out = gitRaw(real, ['rev-parse', '--show-prefix']);
  return out === null ? null : out.trim();
}

/** File name part that binds a report to its project: '' for the repository root, `-p<12 hex>` for a subdirectory. */
function projectKey(prefix) {
  return prefix === '' ? '' : `-p${crypto.createHash('sha256').update(prefix).digest('hex').slice(0, 12)}`;
}

function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch (_e) { return null; }
}

function ownedByMe(st) {
  return typeof process.getuid !== 'function' || st.uid === process.getuid();
}

/** Keeps the newest KEEP files that match NAME_RE; nothing else is deleted. */
function prune(dir) {
  const rows = [];
  for (const name of fs.readdirSync(dir)) {
    if (!NAME_RE.test(name)) continue;
    const st = lstatOrNull(path.join(dir, name));
    if (st) rows.push({ name, mtime: st.mtimeMs });
  }
  rows.sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : -1));
  for (const r of rows.slice(KEEP)) {
    try { fs.unlinkSync(path.join(dir, r.name)); } catch (_e) { /* best effort */ }
  }
}

/**
 * D7: writes the record next to the repository, never into the tree.
 * @param {string} project
 * @param {object} record the `verify run` record (what `--out` would write)
 * @returns {{path: string|null, error?: string}} `path` is the written file; `error` says why nothing was written
 */
function writeReportCopy(project, record) {
  if (!record || typeof record.head_sha !== 'string' || !SHA_RE.test(record.head_sha)) return { path: null };
  if (inIntentChild()) return { path: null };
  const dir = reportsDir(project);
  if (dir === null) return { path: null, error: 'not a git repository' };
  const prefix = projectPrefix(project);
  if (prefix === null) return { path: null, error: 'cannot resolve the project prefix' };
  const target = path.join(dir, `${record.head_sha}${projectKey(prefix)}-${record.scope === 'affected' ? 'affected' : 'full'}.json`);
  const st = lstatOrNull(dir);
  if (st && !st.isDirectory()) return { path: null, error: 'reports directory is a symlink or not a directory' };
  if (st && (((st.mode & 0o777) !== DIR_MODE) || !ownedByMe(st))) return { path: null, error: 'reports directory has the wrong mode or owner (needs 0700, owned by you)' };
  let tmp = null;
  try {
    if (!st) fs.mkdirSync(dir, { mode: DIR_MODE });
    const tst = lstatOrNull(target);
    if (tst && (tst.isSymbolicLink() || !tst.isFile())) throw new Error('target is a symlink or not a regular file');
    tmp = path.join(dir, `.tmp-${process.pid}-${Date.now()}`);
    fs.writeFileSync(tmp, `${JSON.stringify({ ...record, project_prefix: prefix })}\n`, { flag: 'wx', mode: FILE_MODE });
    fs.renameSync(tmp, target);
    tmp = null;
    prune(dir);
    return { path: target };
  } catch (e) {
    if (tmp) { try { fs.unlinkSync(tmp); } catch (_e) { /* best effort */ } }
    try { fs.unlinkSync(target); } catch (_e) { /* a planted pass file must not outlive a failed write */ }
    return { path: null, error: e.message };
  }
}

/**
 * D8: the newest commit R (HEAD first, at most REUSE_WINDOW commits) that has a `<R>-full.json` entry.
 * @returns {{sha: string|null, path: string|null, a1_only_commits: number}} commits between R and HEAD in `a1_only_commits`
 */
function findCandidate(project, head) {
  const prefix = projectPrefix(project);
  const none = { sha: null, path: null, a1_only_commits: 0 };
  const dir = reportsDir(project);
  const list = gitRaw(project, ['rev-list', `--max-count=${REUSE_WINDOW}`, head]);
  if (dir === null || list === null || prefix === null) return none;
  const shas = list.split('\n').filter((s) => SHA_RE.test(s));
  for (let i = 0; i < shas.length; i++) {
    const file = path.join(dir, `${shas[i]}${projectKey(prefix)}-full.json`);
    if (lstatOrNull(file)) return { sha: shas[i], path: file, a1_only_commits: i };
  }
  return none;
}

function judgeDir(project) {
  const st = lstatOrNull(reportsDir(project));
  return st && st.isDirectory() && (st.mode & 0o777) === DIR_MODE && ownedByMe(st);
}

/** Reads and validates the candidate file; returns {reason} or {report}. */
function loadReport(file) {
  const st = lstatOrNull(file);
  if (!st || !st.isFile() || (st.mode & 0o777) !== FILE_MODE || !ownedByMe(st) || st.size > MAX_REPORT_BYTES) return { reason: 'report_invalid' };
  try {
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    return report && typeof report === 'object' && !Array.isArray(report) ? { report } : { reason: 'report_invalid' };
  } catch (_e) {
    return { reason: 'report_invalid' };
  }
}

/** State rules 2-4 (rule 1 is the candidate search plus the diff in checkReuse), then the record's own claims. Null = reusable. */
function reportReason(report, ctx) {
  if (report.head_sha !== ctx.sha) return 'report_sha_mismatch';
  if (report.project_prefix !== ctx.prefix) return 'project_mismatch';
  if (typeof report.config_digest !== 'string' || report.config_digest !== ctx.configDigest) return 'config_mismatch';
  if (report.scope !== 'full') return 'scope_not_full';
  if (report.verdict !== 'pass') return 'verdict_not_pass';
  if (!Array.isArray(report.commands) || report.commands.length === 0) return 'no_commands';
  if (Array.isArray(report.skipped_on_host) ? report.skipped_on_host.length > 0 : report.skipped_on_host !== undefined) return 'commands_skipped';
  if (Array.isArray(report.env_red) ? report.env_red.length > 0 : report.env_red !== undefined) return 'env_red_excused';
  if (report.tree_clean !== true) return 'run_tree_dirty';
  if (ctx.dirtyNow) return 'tree_dirty';
  return null;
}

/** sha256 of the committed `<prefix>.a1/verify.json` at `sha` ('none' when absent there). */
function committedConfigDigest(project, sha, prefix) {
  return configDigest(gitRaw(project, ['show', `${sha}:${prefix}.a1/verify.json`]));
}

/**
 * D8 decision for `sha` (must be HEAD), in the D8 order.
 * @returns {{exit: 0|1, reason: string|null, report_sha: string|null, report_path: string|null, a1_only_commits: number}}
 */
function checkReuse(project, sha) {
  const res = (exit, reason, c) => ({ exit, reason, report_sha: c ? c.sha : null, report_path: c ? c.path : null, a1_only_commits: c ? c.a1_only_commits : 0 });
  const head = headSha(project);
  if (head === null || reportsDir(project) === null) return res(1, 'not_a_git_repo', null);
  if (head !== sha) return res(1, 'head_moved', null);
  const cand = findCandidate(project, head);
  if (cand.sha === null) return res(1, 'no_report', null);
  const names = diffNames(project, cand.sha, 'HEAD');
  if (names === null) return res(1, 'report_sha_unknown', cand);
  if (names.some(isCodeForReuse)) return res(1, 'code_changed_after_run', cand);
  if (!judgeDir(project)) return res(1, 'report_invalid', cand);
  const loaded = loadReport(cand.path);
  if (loaded.reason) return res(1, loaded.reason, cand);
  const prefix = projectPrefix(project);
  const why = reportReason(loaded.report, {
    sha: cand.sha, prefix, configDigest: committedConfigDigest(project, head, prefix), dirtyNow: statusPaths(project).some(isCodeForReuse),
  });
  return why ? res(1, why, cand) : res(0, null, cand);
}

function usage(msg) {
  return emitExit(2, '', `verify reuse: ${msg}\nusage: a1-tools verify reuse --head <sha> [--project <dir>]\n`);
}

/** @param {string[]} args */
function cmdVerifyReuse(args) {
  const flags = parseFlags(args, { head: 'string', project: 'string' });
  if (flags._.length > 0) return usage(`unexpected argument ${JSON.stringify(String(flags._[0]).slice(0, 80))}`);
  for (const k of ['head', 'project']) {
    const v = flags[k];
    if (v === undefined && k === 'head') return usage('--head is required');
    if (v !== undefined && (typeof v !== 'string' || v === '' || v.length > MAX_ARG_LENGTH || v.includes('\0'))) return usage(`--${k} needs a plain value`);
  }
  if (!SHA_RE.test(flags.head)) return usage('--head must be a 40-hex commit sha');
  const project = path.resolve(process.cwd(), flags.project || '.');
  let isDir = false;
  try { isDir = fs.statSync(project).isDirectory(); } catch (_e) { /* reported below */ }
  if (!isDir) return usage(`--project is not a directory: ${project}`);
  const r = checkReuse(project, flags.head);
  const out = { ok: r.exit === 0, reason: r.reason, head_sha: flags.head, report_sha: r.report_sha, report_path: r.report_path, a1_only_commits: r.a1_only_commits };
  return emitExit(r.exit, `${JSON.stringify(out)}\n`, r.exit === 1 ? `verify reuse: not reusable - ${r.reason}\n` : '');
}

module.exports = { REPORTS_DIR, NAME_RE, KEEP, MAX_REPORT_BYTES, REUSE_WINDOW, reportsDir, writeReportCopy, findCandidate, checkReuse, cmdVerifyReuse };
