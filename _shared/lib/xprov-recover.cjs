'use strict';

// ---------------------------------------------------------------------------
// xprov-recover — self-recovery of the gate driver (spec 016 Wave 8: FR-024, FR-026, FR-027, FR-028).
//
// Four failures used to stop the pipeline and ask the owner. Each now recovers ONCE, bounded, on a closed list:
//   runner_failed     cause network | timeout | HTTP 5xx only      → at most 2 retries, 30 s then 120 s      (runWithRetry)
//   blocked           the run is repeated once; blocked again       → not_applicable/codex_blocked_fallback   (reviewSteps)
//   snapshot_failed   base that does not resolve (inspect only)     → merge-base against the default branch,
//                                                                      fetching it when missing, one retry     (snapshotWithBase)
//   preflight_failed  only checks that the three additive actions fix, only in the dedicated review home
//                                                                    → repair, preflight once more            (preflightWithRepair)
// Everything else is a HARD STOP and passes through untouched: isRecoverable() is a closed allowlist, so a reason
// nobody listed here (secret_in_snapshot, secret_in_output, tripwire, quarantined, run_home_unsafe,
// snapshot_changed_after_scan, allowlist_invalid, allowlist_modified, every permit/store mismatch, round_cap, …) is never retried.
// The cause of a runner failure is read from the runner's own display-safe detail (xprov-run.cjs runnerFailureDetail); a detail
// that was withheld (secret- or instruction-shaped) matches nothing and is not retried.
//
// D-3: the delays are constants; the fixture suite rewrites RETRY_DELAYS_MS in its tree copy, so it never sleeps.
// Every recovery is returned as data (`recovery`); the gate writes it to the run record and the observation line.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const PF = require('./xprov-preflight.cjs');
const RR = require('./xprov-runrecord.cjs');
const HM = require('./xprov-homemark.cjs');

const RETRY_DELAYS_MS = Object.freeze([30000, 120000]);
const FETCH_TIMEOUT_MS = 60000;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,100}$/;
const FETCH_BRANCHES = Object.freeze(['main', 'master']);
const REMOTE = 'origin';
const DEFAULT_BRANCH_REFS = Object.freeze(['refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master']);
const FETCH_SSH_COMMAND = 'ssh -o BatchMode=yes'; // no ssh prompt (host key, passphrase) may stall an unattended fetch; GIT_TERMINAL_PROMPT=0 covers https
const BLOCKED_NOTICE = 'not_applicable — Codex answered BLOCKED twice; the Reinhard review is the only review for this target, no owner question is asked';
const CAUSES = Object.freeze({ TIMEOUT: 'timeout', NETWORK: 'network', HTTP_5XX: 'http_5xx' });

// The reasons a recovery exists for. A reason NOT in this list is a hard stop (FR-031).
const RECOVERABLE_REASONS = Object.freeze([X.REASONS.runner_failed, X.REASONS.blocked, X.REASONS.snapshot_failed, X.REASONS.preflight_failed]);
const isRecoverable = (reason) => RECOVERABLE_REASONS.includes(reason);

// ---------- cause classification (FR-024) ----------

// Shapes of the runner's own failure text (xprov-run.cjs runnerFailureDetail): its fixed timeout message, the Codex stream/transport
// errors, an HTTP 5xx status. Anything else — usage limit, schema, pin mismatch, local errors — matches none and is not retried.
const TIMEOUT_RE = /\bRun timed out or was interrupted; no approval recorded\b/;
const HTTP_5XX_RE = /\b(?:unexpected status|status(?: code)?|http(?: error)?|error)[: ]+5\d\d\b|\b5\d\d (?:Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b/i;
const NETWORK_RE = /\b(?:error sending request|stream disconnected|connection (?:reset|refused|closed|aborted)|dns error|failed to lookup address|network is unreachable|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b/i;

// ---------- outage classification (spec 025 W6, FR-019; Samuel SEC-2, SEC-6) ----------
// `codex_unavailable` is an ALLOWLIST over the RAW record of a failed run (never over the display-safe detail, in which a refusal can lose its
// `claudex-loop: ` prefix and a validation error can look like anything): only what means "Codex itself could not answer" counts. Everything else the runner
// records — schema, integrity and validation errors ("Invalid review verdict.", "Review must contain exactly…", "APPROVED cannot contain unresolved…",
// "Plan changed during the run…", "CLI resumed a different session…", "CLI version probe failed…") and every pre-run refusal — stays `runner_failed` (fail).
const TIMEOUT_MESSAGE = 'Run timed out or was interrupted; no approval recorded.'; // runner.py's own text for a killed/timed-out Codex process
const CODEX_EXIT_RE = /^codex exited \d+(?:;|$)/; // runner.py:366 — the Codex process itself ended non-zero (usage limit, transport error, any Codex error event)
const KILLED_RE = /^runner killed by \w+ after \d+ s$/; // xprov-run.cjs spawnRunner: the runner did not return within timeout + grace
const USAGE_LIMIT_RE = /\busage limit\b/i;
const OUTAGE_CAUSES = Object.freeze({ ...CAUSES, USAGE_LIMIT: 'usage_limit' });
// SEC-7: a timeout is only a timeout when the run really lasted that long (a SIGINT or an early kill makes runner.py write the same message); small slack for rounding.
const TIMEOUT_ELAPSED_SLACK_SECONDS = 2;
const reachedTimeout = (r) => Number.isFinite(r.elapsedSeconds) && Number.isFinite(r.timeoutSeconds) && r.elapsedSeconds >= r.timeoutSeconds - TIMEOUT_ELAPSED_SLACK_SECONDS;

/** The error texts Codex wrote itself: `{"type":"error"|"turn.failed"}` event messages of stdout.txt and plain `ERROR: …` lines. */
function codexErrorTexts(stdoutText) {
  const out = [];
  for (const line of String(stdoutText || '').split('\n')) {
    try {
      const ev = JSON.parse(line);
      if (ev && ev.type === 'error' && typeof ev.message === 'string') out.push(ev.message);
      else if (ev && ev.type === 'turn.failed' && ev.error && typeof ev.error.message === 'string') out.push(ev.error.message);
    } catch (_e) { if (/^ERROR: /.test(line)) out.push(line); }
  }
  return out;
}

/**
 * The outage cause of a failed run (one of OUTAGE_CAUSES' values) or null when it is not a Codex outage. `raw` = { resultError (result.json `error`, raw), elapsedSeconds, timeoutSeconds (SEC-7),
 * stdout (stdout.txt), stderr (stderr.txt + the runner's own stderr), runnerStderr (the runner's own stderr), status }. Pure.
 */
function outageCause(raw) {
  const r = raw || {};
  const err = typeof r.resultError === 'string' ? r.resultError.trim() : '';
  if (err === TIMEOUT_MESSAGE) return reachedTimeout(r) ? OUTAGE_CAUSES.TIMEOUT : null;
  if (err === '' && r.status === null && KILLED_RE.test(String(r.runnerStderr || '').trim())) return reachedTimeout(r) ? OUTAGE_CAUSES.TIMEOUT : null;
  if (!CODEX_EXIT_RE.test(err)) return null;
  const text = [...codexErrorTexts(r.stdout), String(r.stderr || '')].join('\n');
  if (USAGE_LIMIT_RE.test(text)) return OUTAGE_CAUSES.USAGE_LIMIT;
  if (HTTP_5XX_RE.test(text)) return OUTAGE_CAUSES.HTTP_5XX;
  if (NETWORK_RE.test(text)) return OUTAGE_CAUSES.NETWORK;
  return null; // SEC-2b: a generic Codex error (e.g. a context-window error a plan author can provoke with a bloated PLAN.md) is no proven outage: it stays runner_failed
}

/** The retryable cause of a `runner_failed` detail, or null. */
function causeOf(reason, detail) {
  if (reason !== X.REASONS.runner_failed || typeof detail !== 'string') return null;
  if (TIMEOUT_RE.test(detail)) return CAUSES.TIMEOUT;
  if (HTTP_5XX_RE.test(detail)) return CAUSES.HTTP_5XX;
  if (NETWORK_RE.test(detail)) return CAUSES.NETWORK;
  return null;
}

/** A synchronous wait (the gate is synchronous end to end). */
function sleepSync(ms) {
  if (Number.isInteger(ms) && ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const attemptRecord = (n, r, waited) => Object.freeze({ attempt: n, waited_ms: waited, outcome: r.ok ? 'ok' : r.reason, cause: r.ok ? null : causeOf(r.reason, r.detail) });

/**
 * The runner call with bounded retry. `attempt()` returns the stepRun shape ({ ok, ... } | { ok: false, reason, detail }).
 * Returns that shape of the LAST attempt plus `attempts` (one record per call: number, ms waited before it, outcome, cause).
 */
function runWithRetry(attempt, sleep) {
  const wait = sleep || sleepSync;
  let r = attempt();
  const attempts = [attemptRecord(1, r, 0)];
  for (let i = 0; i < RETRY_DELAYS_MS.length && !r.ok && causeOf(r.reason, r.detail) !== null; i += 1) {
    const ms = RETRY_DELAYS_MS[i];
    wait(ms);
    r = attempt();
    attempts.push(attemptRecord(attempts.length + 1, r, ms));
  }
  return Object.freeze({ ...r, attempts });
}

// ---------- run → normalize with the blocked retry (FR-026) ----------

/**
 * `run()` is the stepRun call, `normalize(resultPath)` the stepNormalize call. A `blocked` verdict repeats the whole pair once;
 * blocked again sets `fallback`. Returns { ran, norm, runs (the attempt records of each run), blocked_retry, fallback } — ran/norm are the LAST pair.
 */
function reviewSteps(run, normalize, sleep) {
  const once = () => {
    const ran = runWithRetry(run, sleep);
    return { ran, norm: ran.ok ? normalize(ran.resultPath) : null };
  };
  const isBlocked = (p) => p.norm !== null && p.norm.ok && p.norm.reason === X.REASONS.blocked;
  const first = once();
  if (!isBlocked(first)) return Object.freeze({ ...first, runs: [first.ran.attempts], blocked_retry: false, fallback: false });
  const second = once();
  return Object.freeze({ ...second, runs: [first.ran.attempts, second.ran.attempts], blocked_retry: true, fallback: isBlocked(second) });
}

/** The recovery notes of a reviewSteps result: one `runner_retry` per run that needed more than one call, one `blocked_retry`. */
function runnerRecovery(rv) {
  const retries = rv.runs.filter((attempts) => attempts.length > 1)
    .map((attempts) => Object.freeze({ action: 'runner_retry', ok: attempts[attempts.length - 1].outcome === 'ok', attempts }));
  return rv.blocked_retry ? [...retries, Object.freeze({ action: 'blocked_retry', ok: true, fallback: rv.fallback })] : retries;
}

/** A recovery worked somewhere in this run (FR-035 `recovered`). */
const recovered = (notes) => notes.some((n) => n.ok === true);

/** a1's own marker in the run dir of the second BLOCKED answer: load-check accepts the fallback only with it. */
function markFallback(resultPath, gate, planSha, root) {
  if (typeof planSha !== 'string' || !RR.inOwnArtifacts(resultPath, root)) return false;
  const file = path.join(path.dirname(path.resolve(resultPath)), RR.BLOCKED_MARKER_FILE);
  fs.writeFileSync(file, `${JSON.stringify({ gate, plan_sha256: planSha, blocked_twice: true }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return true;
}

// ---------- base recompute (FR-027) ----------

function resolveCommit(workPath, rev) {
  const out = C.gitOut(['-C', workPath, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  return out === null ? null : out.trim();
}

/** The merge-base of the default branch (first of DEFAULT_BRANCH_REFS that resolves) and `tip`, or null. Moved here from the deleted xprov-wave-ranges.cjs (spec 025). */
function anchorOf(workPath, tip) {
  for (const ref of DEFAULT_BRANCH_REFS) {
    const def = resolveCommit(workPath, ref);
    if (def === null) continue;
    const mb = C.gitOut(['-C', workPath, 'merge-base', def, tip]);
    return mb === null ? null : mb.trim();
  }
  return null;
}

const BASE_UNRESOLVED_RE = /^base \S+ does not resolve in /;

/** `fetch origin +refs/heads/<b>:refs/remotes/origin/<b>` for the default branch names; true when one succeeded. */
function fetchDefaultBranch(workPath) {
  if (C.gitOut(['-C', workPath, 'config', '--get', `remote.${REMOTE}.url`]) === null) return false;
  return FETCH_BRANCHES.some((b) => BRANCH_RE.test(b) && C.gitSpawn(['-C', workPath, 'fetch', '--no-tags', '--quiet', REMOTE, `+refs/heads/${b}:refs/remotes/${REMOTE}/${b}`],
    { timeout: FETCH_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: FETCH_SSH_COMMAND } }).status === 0);
}

/** merge-base of the default branch and the work path's HEAD (fetching the ref when no default branch resolves): { base, fetched } | null. */
function recomputeBase(workPath) {
  const head = C.gitOut(['-C', workPath, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  if (head === null) return null;
  let base = anchorOf(workPath, head.trim());
  let fetched = false;
  if (base === null && fetchDefaultBranch(workPath)) { fetched = true; base = anchorOf(workPath, head.trim()); }
  return base === null || !/^[0-9a-f]{40,64}$/.test(base) ? null : { base, fetched };
}

/**
 * `snap(base)` is the stepSnapshot call. A snapshot_failed whose detail says the base does not resolve is retried ONCE with the
 * recomputed base; a second failure returns the ORIGINAL failure. Returns { snapped, base, recovery } (recovery null when untouched).
 */
function snapshotWithBase(ctx, snap) {
  const first = snap(ctx.base);
  if (first.ok || first.reason !== X.REASONS.snapshot_failed || ctx.isPlan || !BASE_UNRESOLVED_RE.test(String(first.detail || ''))) return Object.freeze({ snapped: first, base: ctx.base, recovery: null });
  const re = recomputeBase(ctx.workPath);
  const note = (ok, to) => Object.freeze({ action: 'base_recomputed', from: ctx.base, to: to || null, fetched: re !== null && re.fetched, ok });
  if (re === null || re.base === ctx.base) return Object.freeze({ snapped: first, base: ctx.base, recovery: note(false, null) });
  const second = snap(re.base);
  return second.ok
    ? Object.freeze({ snapped: second, base: re.base, recovery: note(true, re.base) })
    : Object.freeze({ snapped: first, base: ctx.base, recovery: note(false, re.base) });
}

// ---------- preflight repair (FR-028) ----------

// The checks the three actions fix: remove plugins/ (plugins_cache_empty), `init-home --pin-features` (the pins, the auth store key and the model/effort pins),
// and --prune-marketplaces. A failing check outside this list — a human-set `true` stays failing, etc_codex_absent, auth_present (not_logged_in),
// plugins_disabled, mcp_servers_absent, … — means nothing is touched.
const REPAIRABLE_CHECKS = Object.freeze(['plugins_cache_empty', 'remote_plugin_switch', 'features_pinned_off', 'auth_store_file', 'model_pinned']); // model_pinned: spec 025 W6 — absent keys are appended; another value stays a pin_conflict
const PLUGINS_DIR = 'plugins';

/**
 * The repair touches ONLY the dedicated review home: `home` is the home preflight checked, `expected` the review home the gate computes on its
 * own (xprov.codexHome(env)); the two must be the same path. Not the global ~/.codex (realpath), nothing inside it, and a home the owner made:
 * the marker `xprov init-home` writes, or the default `~/.codex-a1-review` (W8-3).
 */
function reviewHomeProblem(home, expected, homedir) {
  if (typeof home !== 'string' || !path.isAbsolute(home) || typeof expected !== 'string' || path.resolve(home) !== path.resolve(expected)) return 'the home to repair is not the review home the gate expects';
  if (PF.isGlobalHome(home, homedir)) return 'the home is the global ~/.codex';
  const global = path.join(homedir, '.codex');
  const real = (p) => { try { return fs.realpathSync(p); } catch (_e) { return path.resolve(p); } };
  const rel = path.relative(real(global), real(home));
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return 'the home lies inside the global ~/.codex';
  if (!HM.hasOwnerMarker(home) && !HM.isCanonicalHome(home, homedir)) return 'the home carries no owner marker (run `xprov init-home` in a terminal)';
  return null;
}

/** The review home the runner will use (the same function the runner's env uses); null for a hostile override. */
function expectedHome(env) {
  try { return X.codexHome(env); } catch (_e) { return null; }
}

/** `rm -rf $CODEX_HOME/plugins` — a real directory directly under the home, never a link. */
function removePlugins(home) {
  const dir = path.join(home, PLUGINS_DIR);
  let st = null;
  try { st = fs.lstatSync(dir); } catch (_e) { return false; }
  if (!st.isDirectory()) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * `pre` is the first preflight report. Returns { pre, recovery }: the report the gate acts on (the SECOND one after a repair) and what was done.
 * One repair, one re-check. A repair that does not verify keeps the second report's reason (preflight_failed or not_logged_in).
 */
function preflightWithRepair(opts, pre0) {
  const o = opts || {};
  const run = () => PF.preflight({ pluginAllowlist: o.pluginAllowlist, env: o.env, homedir: o.homedir, codexHome: o.codexHome });
  const first = pre0 || run();
  if (first.ok || first.reason !== X.REASONS.preflight_failed || !first.failed.every((n) => REPAIRABLE_CHECKS.includes(n))) return Object.freeze({ pre: first, recovery: null });
  const homedir = o.homedir || require('os').homedir();
  const problem = reviewHomeProblem(first.codex_home, expectedHome(o.env), homedir);
  if (problem !== null) return Object.freeze({ pre: first, recovery: Object.freeze({ action: 'preflight_repair', ok: false, refused: problem, actions: [] }) });
  const actions = [];
  // an owner who allowlisted plugins (--allow-plugins) keeps them: the plugins dir is not removed then, the repair cannot verify and the run stops
  const keepPlugins = Array.isArray(o.pluginAllowlist) && o.pluginAllowlist.length > 0;
  if (first.failed.includes('plugins_cache_empty') && !keepPlugins && removePlugins(first.codex_home)) actions.push('remove_plugins');
  const init = PF.initHome({ codexHome: first.codex_home, homedir, env: o.env, pinFeatures: true, pruneMarketplaces: true });
  if (init.pinned && init.pinned.length) actions.push('pin_features');
  if (init.upgraded && init.upgraded.length) actions.push('upgrade_pins'); // SEC-4: a value an earlier a1 release wrote for model / effort
  if (init.pruned && init.pruned.attempted) actions.push('prune_marketplaces');
  const second = run();
  return Object.freeze({ pre: second, recovery: Object.freeze({ action: 'preflight_repair', ok: second.ok, actions, failed_before: first.failed, failed_after: second.failed }) });
}

module.exports = {
  RETRY_DELAYS_MS, RECOVERABLE_REASONS, REPAIRABLE_CHECKS, BLOCKED_NOTICE, CAUSES,
  isRecoverable, causeOf, outageCause, TIMEOUT_MESSAGE, OUTAGE_CAUSES, sleepSync, removePlugins, runWithRetry, reviewSteps, runnerRecovery, recovered, markFallback, snapshotWithBase, recomputeBase, anchorOf, preflightWithRepair, reviewHomeProblem,
};
