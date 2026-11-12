'use strict';

// CI-evidence shortcut of `pr merge-check`: when the project opted in (`.a1/verify.json` key `ci_evidence`) and GitHub CI is green
// on the exact PR head, the local suite runs (head and merge-base) are skipped. Pure decision logic; the gh seam is injected.
// `ci_evidence` = { workflow: <GitHub Actions workflow name>, checks: [non-empty names], unchanged?: [repo-relative paths] }.
// Read from the committed HEAD, and it must equal the one at the tip of the base ref (a PR cannot opt itself in).
// Only entries of that workflow, event pull_request, linked to github.com/.../actions/runs/ count (commit statuses and other apps are ignored).
// Only for plans without a counting reporter (those verdicts exist only in `verify run`). EVERY counted entry must pass (`checks` is the minimum set that must be present). Under an A1_GH_BIN override there is no shortcut.
// Any doubt (config or protected path changed, a configured check missing/duplicated, git failure) means NO shortcut: the local run.

const { spawnSync } = require('child_process');
const { VerifyError } = require('./verify-run.cjs');
const vb = require('./verify-base.cjs');

const CONFIG_FILE = '.a1/verify.json';
const ALLOWED_KEYS = Object.freeze(['workflow', 'checks', 'unchanged']);
const RUN_LINK_PREFIX = 'https://github.com/';
const RUN_LINK_PART = '/actions/runs/';
const PR_EVENT = 'pull_request';
const MAX_ENTRIES = 200;
const MAX_NAME_LENGTH = 512;
const GIT_TIMEOUT_MS = 60 * 1000;

function bad(msg) { return new VerifyError('bad_config', `.a1/verify.json ci_evidence: ${msg}`); }

function checkName(v, where) {
  if (typeof v !== 'string' || v.trim() === '' || v.length > MAX_NAME_LENGTH || v.includes('\0')) throw bad(`${where} needs a non-empty string`);
}

function checkRelPath(v, where) {
  checkName(v, where);
  if (v.startsWith('/') || v.startsWith('-') || v.startsWith(':') || v.includes('\\') || /^[A-Za-z]:/.test(v) || v.split('/').includes('..')) throw bad(`${where} must be a repo-relative path without ".." (got ${JSON.stringify(v)})`);
}

/**
 * Validate the `ci_evidence` value of a parsed verify.json (undefined = not configured).
 * @returns {{workflow: string, checks: string[], unchanged: string[]}|null}
 */
function parseCiEvidence(cfg) {
  if (cfg === null || cfg === undefined || typeof cfg !== 'object' || cfg.ci_evidence === undefined) return null;
  const ev = cfg.ci_evidence;
  if (ev === null || typeof ev !== 'object' || Array.isArray(ev)) throw bad('must be an object');
  for (const k of Object.keys(ev)) if (!ALLOWED_KEYS.includes(k)) throw bad(`unknown key ${JSON.stringify(k)}`);
  checkName(ev.workflow, 'workflow');
  if (!Array.isArray(ev.checks) || ev.checks.length === 0 || ev.checks.length > MAX_ENTRIES) throw bad('checks must be a non-empty array');
  ev.checks.forEach((c, i) => checkName(c, `checks[${i}]`));
  const unchanged = ev.unchanged === undefined ? [] : ev.unchanged;
  if (!Array.isArray(unchanged) || unchanged.length > MAX_ENTRIES) throw bad('unchanged must be an array');
  unchanged.forEach((p, i) => checkRelPath(p, `unchanged[${i}]`));
  return { workflow: ev.workflow, checks: [...ev.checks], unchanged: [...unchanged] };
}

/** True when any of the paths differs between the commits; a git failure counts as changed. */
function pathsChanged(project, baseSha, paths) {
  if (paths.length === 0) return false;
  const r = spawnSync('git', ['-C', project, '--literal-pathspecs', 'diff', '--quiet', baseSha, 'HEAD', '--', ...paths], { shell: false, stdio: 'ignore', timeout: GIT_TIMEOUT_MS });
  return r.error || r.status !== 0;
}

const BUCKET_PASS = 'pass';
const BUCKET_PENDING = 'pending';
const BUCKETS_RED = Object.freeze(['fail', 'cancel']);

/** An entry counts as CI evidence only when it is a pull_request run of the configured workflow on github.com. */
function isCounted(c, workflow) {
  return !!c && typeof c.name === 'string' && c.workflow === workflow && c.event === PR_EVENT
    && typeof c.link === 'string' && c.link.startsWith(RUN_LINK_PREFIX) && c.link.includes(RUN_LINK_PART);
}

/** Reasons from the counted entries: every one must pass; a configured name that is absent while something is pending is pending. */
function judge(evidence, counted) {
  const bucket = (c) => (typeof c.bucket === 'string' ? c.bucket : 'fail');
  const names = new Set(counted.map((c) => c.name));
  const listedBad = (c) => evidence.checks.includes(c.name);
  const reasons = [];
  for (const c of counted) {
    const b = bucket(c);
    if (b === BUCKET_PASS) continue;
    if (b === BUCKET_PENDING) reasons.push({ reason: 'ci_check_pending', check: c.name });
    else if (BUCKETS_RED.includes(b) || listedBad(c)) reasons.push({ reason: 'ci_check_red', check: c.name });
    else return { fallback: 'workflow_entry_not_pass' }; // an unlisted skipped job: not proof, run locally
  }
  const missing = evidence.checks.filter((n) => !names.has(n));
  if (missing.length > 0 && !counted.some((c) => bucket(c) === BUCKET_PENDING)) return { fallback: 'check_missing' };
  for (const n of missing) reasons.push({ reason: 'ci_check_pending', check: n });
  return { reasons };
}

/**
 * @param {{project:string, baseSha:string, evidence:object|null, baseEvidence:object|null|undefined, baseUnreadable:boolean, disabled:boolean,
 *   override:boolean, hasCountingReporter:()=>boolean, listChecks:()=>(Array|null)}} a
 *   baseEvidence = raw ci_evidence of the base ref tip (undefined = none there); listChecks = all PR checks as gh reports them, or null when gh reports none.
 * @returns {{used:boolean, why:string, checks:object[], reasons:object[]}}
 */
function decide(a) {
  const no = (why, checks = []) => ({ used: false, why, checks, reasons: [] });
  if (a.evidence === null) return no('not_configured');
  if (a.disabled) return no('disabled_by_flag');
  if (a.override) return no('gh_override');
  if (a.baseUnreadable || a.baseEvidence === undefined) return no('base_not_configured');
  if (vb.canon(a.baseEvidence) !== vb.canon(a.rawEvidence)) return no('base_config_differs');
  if (pathsChanged(a.project, a.baseSha, [CONFIG_FILE])) return no('verify_config_changed');
  if (pathsChanged(a.project, a.baseSha, a.evidence.unchanged)) return no('protected_path_changed');
  if (a.hasCountingReporter()) return no('counting_reporter'); // skip_increase, zero_tests, implausible_crash, retry and --bug exist only in `verify run`
  const list = a.listChecks();
  if (!Array.isArray(list)) return no('check_missing');
  const counted = list.filter((c) => isCounted(c, a.evidence.workflow));
  const seen = counted.map((c) => ({ name: c.name, bucket: typeof c.bucket === 'string' ? c.bucket : 'fail' }));
  if (a.evidence.checks.some((n) => counted.filter((c) => c.name === n).length > 1)) return no('check_missing', seen);
  const j = judge(a.evidence, counted);
  if (j.fallback) return no(j.fallback, seen);
  return { used: true, why: 'ok', checks: seen, reasons: j.reasons };
}

module.exports = { parseCiEvidence, decide, pathsChanged };
