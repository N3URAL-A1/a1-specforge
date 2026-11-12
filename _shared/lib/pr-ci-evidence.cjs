'use strict';

// CI-evidence shortcut of `pr merge-check`: when the project opted in (`.a1/verify.json` key `ci_evidence`) and GitHub CI is green
// on the exact PR head, the local suite runs (head and merge-base) are skipped. Pure decision logic; the gh seam is injected.
// `ci_evidence` = { checks: [non-empty names], unchanged?: [repo-relative paths] }. Read from the committed HEAD only.
// Any doubt (config or protected path changed, a configured check missing/duplicated, git failure) means NO shortcut: the local run.

const { spawnSync } = require('child_process');
const { VerifyError } = require('./verify-run.cjs');

const CONFIG_FILE = '.a1/verify.json';
const ALLOWED_KEYS = Object.freeze(['checks', 'unchanged']);
const MAX_ENTRIES = 200;
const MAX_NAME_LENGTH = 512;
const GIT_TIMEOUT_MS = 60 * 1000;

function bad(msg) { return new VerifyError('bad_config', `.a1/verify.json ci_evidence: ${msg}`); }

function checkName(v, where) {
  if (typeof v !== 'string' || v.trim() === '' || v.length > MAX_NAME_LENGTH || v.includes('\0')) throw bad(`${where} needs a non-empty string`);
}

function checkRelPath(v, where) {
  checkName(v, where);
  if (v.startsWith('/') || v.startsWith('-') || v.includes('\\') || /^[A-Za-z]:/.test(v) || v.split('/').includes('..')) throw bad(`${where} must be a repo-relative path without ".." (got ${JSON.stringify(v)})`);
}

/**
 * Validate the `ci_evidence` value of a parsed verify.json (undefined = not configured).
 * @returns {{checks: string[], unchanged: string[]}|null}
 */
function parseCiEvidence(cfg) {
  if (cfg === null || cfg === undefined || typeof cfg !== 'object' || cfg.ci_evidence === undefined) return null;
  const ev = cfg.ci_evidence;
  if (ev === null || typeof ev !== 'object' || Array.isArray(ev)) throw bad('must be an object');
  for (const k of Object.keys(ev)) if (!ALLOWED_KEYS.includes(k)) throw bad(`unknown key ${JSON.stringify(k)}`);
  if (!Array.isArray(ev.checks) || ev.checks.length === 0 || ev.checks.length > MAX_ENTRIES) throw bad('checks must be a non-empty array');
  ev.checks.forEach((c, i) => checkName(c, `checks[${i}]`));
  const unchanged = ev.unchanged === undefined ? [] : ev.unchanged;
  if (!Array.isArray(unchanged) || unchanged.length > MAX_ENTRIES) throw bad('unchanged must be an array');
  unchanged.forEach((p, i) => checkRelPath(p, `unchanged[${i}]`));
  return { checks: [...ev.checks], unchanged: [...unchanged] };
}

/** True when any of the paths differs between the commits; a git failure counts as changed. */
function pathsChanged(project, baseSha, paths) {
  if (paths.length === 0) return false;
  const r = spawnSync('git', ['-C', project, 'diff', '--quiet', baseSha, 'HEAD', '--', ...paths], { shell: false, stdio: 'ignore', timeout: GIT_TIMEOUT_MS });
  return r.error || r.status !== 0;
}

/**
 * @param {{project:string, baseSha:string, evidence:{checks:string[],unchanged:string[]}|null, disabled:boolean, listChecks:()=>(Array|null)}} a
 *   listChecks returns all PR checks as gh reports them, or null when gh reports no checks at all.
 * @returns {{used:boolean, why:string, checks:object[], reasons:object[]}}
 */
function decide(a) {
  const no = (why, checks = []) => ({ used: false, why, checks, reasons: [] });
  if (a.evidence === null) return no('not_configured');
  if (a.disabled) return no('disabled_by_flag');
  if (pathsChanged(a.project, a.baseSha, [CONFIG_FILE])) return no('verify_config_changed');
  if (pathsChanged(a.project, a.baseSha, a.evidence.unchanged)) return no('protected_path_changed');
  const list = a.listChecks();
  if (!Array.isArray(list)) return no('check_missing');
  const named = (n) => list.filter((c) => c && c.name === n);
  if (a.evidence.checks.some((n) => named(n).length !== 1)) return no('check_missing', list.map((c) => ({ name: c && c.name, bucket: c && c.bucket })));
  const seen = a.evidence.checks.map((n) => ({ name: n, bucket: typeof named(n)[0].bucket === 'string' ? named(n)[0].bucket : 'fail' }));
  const reasons = seen.filter((c) => c.bucket !== 'pass').map((c) => (c.bucket === 'pending' ? { reason: 'ci_check_pending', check: c.name } : { reason: 'ci_check_red', check: c.name }));
  return { used: true, why: 'ok', checks: seen, reasons };
}

module.exports = { parseCiEvidence, decide, pathsChanged };
