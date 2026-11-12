'use strict';

// `pr merge-check --pr <n> [--base <ref>] [--bug <id>] [--project <dir>] [--slug <project>]`
// (spec 017 FR-036, FR-037, FR-016, FR-025). The last code check before `gh pr merge`.
//   exit 0  nothing red: suites pass (or are red on the base too AND reported with --bug that resolves),
//           no required check red/pending, flaky_base not grown, no pending/overturned/self-reviewed disposition,
//           local HEAD == the PR head (gh headRefOid) on a clean tree, dispositions committed, fidelity and live-probes config unchanged or cleared by a reviewed config_change disposition
//   exit 1  at least one reason; every reason is named in `reasons[]` on stdout
//   exit 2  usage, unreadable state, gh failure, unresolvable base (stdout JSON {ok:false,error,message})
// It runs `verify run --base` in process with noCache (a head cache file is forgeable by the branch author, SEC review round C);
// no nested gate-log line: only the facade logs.
// `gh` is called through the binary seam `A1_GH_BIN` (default `gh`), argv array, no shell. An override is announced on stderr
// (`pr merge-check: gh from A1_GH_BIN=<path>`) and reported as `gh_bin: "override"` (SEC-4).
// The report's `head_sha` is the commit `gh pr merge --match-head-commit` must pin (SEC-1).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseFlags, peekVaultRoot, parseNestedFrontmatter, parseFrontmatter } = require('./io.cjs');
const { emitExit } = require('./emit-exit.cjs');
const { VerifyError, runVerify, resolveCommands, gitSource } = require('./verify-run.cjs');
const vb = require('./verify-base.cjs');
const { resolveMergeBase, flakyBaseGrown } = vb;
const { gitRaw } = require('./verify-check.cjs');
const { pendingOrOverturned, reviewIntegrity, entriesAt, DispositionError } = require('./disposition-store.cjs');
const G = require('./pr-merge-guards.cjs');
const CE = require('./pr-ci-evidence.cjs');

const KNOWN_FLAGS = { pr: 'string', base: 'string', bug: 'string', project: 'string', slug: 'string', 'no-ci-evidence': 'bool' };
const MAX_ARG_LENGTH = 4096;
const GH_TIMEOUT_MS = 60 * 1000;
const GH_MAX_BYTES = 8 * 1024 * 1024;
const PR_RE = /^[1-9][0-9]{0,8}$/;
const BUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,100}$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,200}$/;
const GREEN_BUCKETS = Object.freeze(['pass', 'skipping']);
const PENDING_BUCKET = 'pending';
// gh has exactly two wordings here (cli/cli pkg/cmd/pr/checks/checks.go:303 and :308):
//   no checks reported on the '<branch>' branch            — the repo has no PR check at all
//   no required checks reported on the '<branch>' branch   — checks exist, none is required
// Both mean zero required checks (the merge check then rests on the local suites). Matched
// per line (/m) because a pager warning can precede the message on its own line, and anchored
// at both ends so a gh failure that merely CONTAINS the sentence (an HTTP 5xx body, say) stays
// a gh_failed instead of being read as "nothing required". The branch segment is `.*`, not a
// quote-free class: git accepts an apostrophe in a branch name ("rob's-fix") and gh
// interpolates it unescaped, so a quote-free class would reject the genuine message and block
// a legitimate merge. `.` cannot cross a newline, so the per-line guarantee is unchanged.
const NO_REQUIRED_RE = /^no (required )?checks reported on the '.*' branch\s*$/m;

class MergeCheckError extends Error {
  constructor(reason, message) { super(message || reason); this.reason = reason; }
}

/** Report a failure and exit 2 once the streams drained. Callers `return fail2(...)`. */
function fail2(reason, message) {
  return emitExit(2, `${JSON.stringify({ ok: false, error: reason, message })}\n`, `pr merge-check: ${reason}: ${message}\n`);
}

function parseArgs(args) {
  const flags = parseFlags(args, KNOWN_FLAGS);
  if (flags._.length > 0) throw new MergeCheckError('usage', `unexpected argument ${JSON.stringify(flags._[0])}`);
  for (const [k, v] of Object.entries(flags)) {
    if (k !== '_' && k !== 'no-ci-evidence' && (typeof v !== 'string' || v === '' || v.length > MAX_ARG_LENGTH || v.includes('\0'))) throw new MergeCheckError('usage', `--${k} needs a plain value`);
  }
  if (!PR_RE.test(flags.pr || '')) throw new MergeCheckError('usage', '--pr <number> is required (a positive integer)');
  if (flags.bug !== undefined && !BUG_RE.test(flags.bug)) throw new MergeCheckError('usage', '--bug must be a plain fix-report id (letters, digits, dot, dash, underscore)');
  if (flags.slug !== undefined && !SLUG_RE.test(flags.slug)) throw new MergeCheckError('usage', '--slug must be a plain project slug');
  return { pr: flags.pr, base: flags.base, bug: flags.bug, slug: flags.slug, noCiEvidence: flags['no-ci-evidence'] === true, project: path.resolve(process.cwd(), flags.project || '.') };
}

/** Runs the gh seam. Returns { status, stdout, stderr }; a binary that cannot start is a MergeCheckError (exit 2). */
function runGh(args, cwd) {
  const bin = process.env.A1_GH_BIN || 'gh';
  const r = spawnSync(bin, args, { cwd, shell: false, encoding: 'utf8', timeout: GH_TIMEOUT_MS, maxBuffer: GH_MAX_BYTES, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error) throw new MergeCheckError('gh_failed', `cannot run ${bin}: ${r.error.code || r.error.message}`);
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function parseJsonOrNull(text) {
  try { return JSON.parse(text); } catch (_e) { return null; }
}

/** Required checks of the PR on head: { red:[names], pending:[names], total }. gh exits 1/8 with JSON for red/pending. */
function requiredChecks(pr, cwd) {
  const r = runGh(['pr', 'checks', pr, '--required', '--json', 'name,bucket,state'], cwd);
  const list = parseJsonOrNull(r.stdout);
  if (!Array.isArray(list)) {
    if (NO_REQUIRED_RE.test(r.stderr) && r.stdout.trim() === '') return { red: [], pending: [], total: 0 };
    throw new MergeCheckError('gh_failed', `gh pr checks gave no JSON list (exit ${r.status}): ${r.stderr.trim().slice(0, 200)}`);
  }
  const name = (c) => (c && typeof c.name === 'string' ? c.name : '(unnamed check)');
  const bucket = (c) => (c && typeof c.bucket === 'string' ? c.bucket : 'fail'); // unknown shape fails closed
  return {
    red: list.filter((c) => bucket(c) !== PENDING_BUCKET && !GREEN_BUCKETS.includes(bucket(c))).map(name),
    pending: list.filter((c) => bucket(c) === PENDING_BUCKET).map(name),
    total: list.length,
  };
}

/** All checks of the PR (not only required ones) for the CI-evidence shortcut; null = gh reports no checks at all. */
function allChecks(pr, cwd) {
  const r = runGh(['pr', 'checks', pr, '--json', 'name,bucket,state,workflow,event,link'], cwd);
  const list = parseJsonOrNull(r.stdout);
  if (Array.isArray(list)) return list;
  if (NO_REQUIRED_RE.test(r.stderr) && r.stdout.trim() === '') return null;
  throw new MergeCheckError('gh_failed', `gh pr checks gave no JSON list (exit ${r.status}): ${r.stderr.trim().slice(0, 200)}`);
}

/** The PR head commit gh reports (headRefOid): the commit a merge would take. */
function prHeadSha(pr, cwd) {
  const r = runGh(['pr', 'view', pr, '--json', 'headRefOid'], cwd);
  const info = parseJsonOrNull(r.stdout);
  const oid = info && typeof info.headRefOid === 'string' ? info.headRefOid : '';
  if (r.status !== 0 || !G.SHA_RE.test(oid)) throw new MergeCheckError('gh_failed', 'gh pr view gave no headRefOid (40 hex)');
  return oid;
}

/** The PR base ref: `--base`, else the PR's base branch from gh (origin/<name> first, then <name>). */
function resolveBaseRef(opts) {
  if (opts.base !== undefined) return opts.base;
  const r = runGh(['pr', 'view', opts.pr, '--json', 'baseRefName'], opts.project);
  const info = parseJsonOrNull(r.stdout);
  const name = info && typeof info.baseRefName === 'string' ? info.baseRefName : '';
  if (r.status !== 0 || !BRANCH_RE.test(name)) throw new MergeCheckError('base_unresolved', 'gh pr view gave no base branch; pass --base <ref>');
  return gitRaw(opts.project, ['rev-parse', '--verify', `origin/${name}^{commit}`]) !== null ? `origin/${name}` : name;
}

function projectSlug(opts) {
  if (opts.slug) return opts.slug;
  try {
    const fm = parseNestedFrontmatter(fs.readFileSync(path.join(opts.project, 'docs', 'product', 'ROADMAP.md'), 'utf8')).fm;
    if (fm && typeof fm.project === 'string' && SLUG_RE.test(fm.project)) return fm.project;
  } catch (_e) { /* no roadmap: fall through to the directory name */ }
  return path.basename(opts.project);
}

const BUG_REPORT_TYPE = 'bug-report';
const NONEMPTY = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * SEC-6: only a real a1-fix report counts: frontmatter type bug-report with bug_slug and status. Read with the FLAT
 * parser: fix reports live in the vault, where basic-memory re-dumps them with PyYAML (folded scalars, unindented
 * lists) - valid YAML that the strict nested parser (docs/product/ contract, F-017) rejects. The three keys checked
 * here are plain scalars, so the flat parser is sufficient.
 */
function isFixReportText(text) {
  if (typeof text !== 'string' || !text.startsWith('---')) return false;
  let fm = null;
  try { fm = parseFrontmatter(text).fm; } catch (_e) { return false; }
  return !!fm && fm.type === BUG_REPORT_TYPE && NONEMPTY(fm.bug_slug) && NONEMPTY(fm.status);
}

function readFileOrNull(file) {
  try { return fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8') : null; } catch (_e) { return null; }
}

/**
 * Does `--bug <id>` resolve to an a1-fix report? Vault `project/<slug>/fixes/<id>.md` (read-only peek) or the repo's
 * `.a1/fixes/<id>.md` AS COMMITTED AT THE BASE: a report the branch itself adds proves nothing (SEC-6).
 */
function bugResolves(opts, baseSha) {
  const stem = opts.bug.replace(/\.md$/, '');
  if (stem.endsWith('.postmortem')) return false; // a postmortem is not the fix report
  const peek = peekVaultRoot();
  if (peek && isFixReportText(readFileOrNull(path.join(peek.root, 'project', projectSlug(opts), 'fixes', `${stem}.md`)))) return true;
  return !!baseSha && isFixReportText(gitRaw(opts.project, ['show', `${baseSha}:.a1/fixes/${stem}.md`]));
}

/** Reasons from a flaky_base change: the head's .a1/verify.json lists ids the base's did not. */
function flakyBaseReasons(project, baseSha) {
  const baseText = gitRaw(project, ['show', `${baseSha}:.a1/verify.json`]);
  const headText = gitRaw(project, ['show', 'HEAD:.a1/verify.json']); // the committed head, never the working tree
  return flakyBaseGrown(baseText, headText).map((id) => ({ reason: 'flaky_base_grown', id }));
}

function suiteReasons(record, bugOk, bug) {
  const out = [];
  if (record.verdict !== 'pass') {
    const failed = record.commands.filter((c) => c.reason !== null).map((c) => ({ command: c.id, cause: c.reason, ids: c.failed_ids }));
    out.push({ reason: 'suite_red_on_head', causes: record.reasons, failed });
  }
  if (record.pre_existing_red.length > 0) {
    if (bug === undefined) out.push({ reason: 'base_red_unreported', red_on_base_and_head: record.pre_existing_red });
    else if (!bugOk) out.push({ reason: 'bug_unresolved', bug, red_on_base_and_head: record.pre_existing_red });
  }
  return out;
}

function ghBinMode() { return process.env.A1_GH_BIN ? 'override' : 'default'; }

/** The reasons of the pinning guards (head, committed dispositions, self review, config files: fidelity.json, live-probes.yaml) plus what the report must log. */
function guardReasons(opts, baseSha) {
  const prHead = prHeadSha(opts.pr, opts.project);
  const head = G.headReasons(opts.project, prHead);
  if (head === null) throw new MergeCheckError('git_failed', 'cannot read HEAD or git status of the project');
  const integrity = reviewIntegrity(opts.project, baseSha, 'HEAD');
  const config = G.configChangeChecks(opts.project, baseSha, entriesAt(opts.project, 'HEAD'));
  return {
    prHead,
    reasons: [...head.reasons, ...G.dispositionsUncommitted(opts.project), ...integrity.selfReviewed, ...config.reasons],
    upheld: integrity.upheld,
  };
}

/** Does any command of the HEAD plan have a counting reporter (kind other than none)? An unresolvable plan counts as yes. */
function headPlanCounts(project, rawCfg) {
  try { return resolveCommands(project, rawCfg, gitSource(project, 'HEAD')).commands.some((c) => c.kind !== 'none'); } catch (_e) { return true; }
}

/** The CI-evidence decision: head config from HEAD, base config from the tip of the base ref; no shortcut under a gh override. */
function ciDecision(opts, baseRef, baseSha) {
  if (opts.noCiEvidence) return { used: false, why: 'disabled_by_flag', checks: [], reasons: [] }; // the forced local run never parses ci_evidence
  const raw = vb.parseVerifyJson(gitRaw(opts.project, ['show', 'HEAD:.a1/verify.json']), 'head'); // the committed head, never the working tree
  const evidence = CE.parseCiEvidence(raw);
  let baseEvidence;
  let baseUnreadable = false;
  if (evidence !== null) {
    const baseText = gitRaw(opts.project, ['show', `${baseRef}:.a1/verify.json`]);
    try { const b = baseText === null ? null : vb.parseVerifyJson(baseText, 'base'); baseEvidence = b && typeof b === 'object' ? b.ci_evidence : undefined; } catch (_e) { baseUnreadable = true; }
  }
  return CE.decide({
    project: opts.project, baseSha, evidence, rawEvidence: evidence === null ? undefined : raw.ci_evidence, baseEvidence, baseUnreadable,
    disabled: false, hasCountingReporter: () => headPlanCounts(opts.project, raw), override: !!process.env.A1_GH_BIN, listChecks: () => allChecks(opts.pr, opts.project),
  });
}

/** @returns {{exit:number, report:object}}; throws VerifyError / MergeCheckError / DispositionError (exit 2). */
function mergeCheck(opts) {
  const baseRef = resolveBaseRef(opts);
  const baseSha = resolveMergeBase(opts.project, baseRef);
  const guards = guardReasons(opts, baseSha);
  const ci = ciDecision(opts, baseRef, baseSha);
  const headMoved = ci.used && prHeadSha(opts.pr, opts.project) !== guards.prHead; // TOCTOU: CI was read for a head that is no longer the PR head
  const record = ci.used
    ? { verdict: 'ci_evidence', cache: null, pre_existing_red: [], flaky: [], config_changed: null, suite_removed: null, head_sha: guards.prHead, commands: [] }
    : runVerify({ project: opts.project, base: baseRef, noCache: true });
  const checks = requiredChecks(opts.pr, opts.project);
  const bugOk = opts.bug !== undefined && bugResolves(opts, baseSha);
  const reasons = [
    ...guards.reasons,
    ...(headMoved ? [{ reason: 'head_moved', was: guards.prHead }] : []),
    ...(ci.used ? ci.reasons : suiteReasons(record, bugOk, opts.bug)),
    ...checks.red.map((name) => ({ reason: 'required_check_red', check: name })),
    ...checks.pending.map((name) => ({ reason: 'required_check_pending', check: name })),
    ...flakyBaseReasons(opts.project, baseSha),
    ...pendingOrOverturned(opts.project, baseSha, 'HEAD'),
  ];
  const report = {
    ok: reasons.length === 0, pr: Number(opts.pr), base: baseRef, base_sha: baseSha, head_sha: record.head_sha, gh_bin: ghBinMode(), reasons,
    suites: { verdict: record.verdict, cache: record.cache, pre_existing_red: record.pre_existing_red, flaky: record.flaky, config_changed: record.config_changed || null, suite_removed: record.suite_removed || null },
    ci_evidence: { used: ci.used, why: ci.why, checks: ci.checks },
    required_checks: { total: checks.total, red: checks.red.length, pending: checks.pending.length },
    upheld_dispositions: guards.upheld,
  };
  return { exit: reasons.length === 0 ? 0 : 1, report };
}

/** @param {string|undefined} _sub @param {string[]} rest */
function cmdPrMergeCheck(_sub, rest) {
  let result;
  try {
    if (process.env.A1_GH_BIN) process.stderr.write(`pr merge-check: gh from A1_GH_BIN=${process.env.A1_GH_BIN.replace(/[\u0000-\u001f\u007f]/g, '?')}\n`);
    result = mergeCheck(parseArgs(rest));
  } catch (e) {
    if (e instanceof MergeCheckError || e instanceof VerifyError) return fail2(e.reason, e.message);
    if (e instanceof DispositionError) return fail2(e.code, e.message);
    return fail2('internal', e && e.message ? e.message : String(e));
  }
  return emitExit(result.exit, `${JSON.stringify(result.report)}\n`, '');
}

module.exports = { cmdPrMergeCheck, mergeCheck, requiredChecks, bugResolves, MergeCheckError };
