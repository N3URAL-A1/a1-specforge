'use strict';

// ---------------------------------------------------------------------------
// metrics phase-time (spec 027-lean-pipeline, FR-003, FR-004, FR-005, D6, D7).
// Sums the measured duration_ms per scope and gate from two sources:
//   live   <repo>/.a1/phases/<scope>/gate-log.jsonl                  (chain-verified)
//   store  <store>/pattern/a1-learnings/_runs/<project>.jsonl        (written by `run record`)
// A record without duration_ms is counted in no_duration, never summed as 0. When the store holds a
// row for a scope, the live rows of that scope are shown with also_in_store and left out of the totals.
// `--baseline` writes <repo>/.a1/phases/027-lean-pipeline/BASELINE.json from two existing `verify run`
// reports plus a host-context file; it never starts a run itself.
// Exit: 0 report / 1 usage error or a refused baseline input / 2 unreadable repo or refused write path.
// `_unscoped` (gate lines written outside a phase: suites, verify runs) is left out of the report and the
// baseline unless --include-unscoped is given or --scope _unscoped names it.
// This file spawns no process and opens no network connection (a1-metrics AU4b enforces it); the only
// spawn on its path is the vault-root lookup in io-roots.cjs (`git rev-parse`, when A1_VAULT_ROOT is unset).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const os = require('os');
const { verifyChain, validateScope } = require('./gate-log.cjs');
const { peekVaultRoot, parseFlags } = require('./io.cjs');
const { assertAncestorInside, writeTextAtomic } = require('./fs-safe.cjs');
const { repoProjectSlug } = require('./project-slug.cjs');
const { usage } = require('./help.cjs');
const { emitExit } = require('./emit-exit.cjs');

const FLAGS = {
  repo: 'string', scope: 'string', last: 'string', json: 'bool', baseline: 'bool', force: 'bool', 'include-unscoped': 'bool',
  'verify-report': 'string', 'merge-report': 'string', 'host-context': 'string', 'host-label': 'string',
};
const BASELINE_ONLY = ['verify-report', 'merge-report', 'host-context', 'host-label'];
const BASELINE_REL = path.join('.a1', 'phases', '027-lean-pipeline', 'BASELINE.json');
const MAX_REPO_CHARS = 4096;
const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const MAX_HOST_CONTEXT_BYTES = 64 * 1024;
const MAX_STORE_BYTES = 20 * 1024 * 1024;
const LABEL_RE = /^[a-z][a-z0-9-]{0,39}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const MERGE_CHECK = 'pr-merge-check';
const UNSCOPED = '_unscoped';
const RUN_KEYS = ['load5_start', 'load5_end', 'cpus', 'host_busy', 'checks'];
const CTX_KEYS = ['verify_head_only', 'merge_check_long_path'];

class PTError extends Error {
  constructor(exit, code, message) { super(message); this.exit = exit; this.code = code; }
}

const sameKeys = (o, keys) => Object.keys(o).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------- arguments ----------

/** @returns {string|null} the first directory at or above cwd that holds a .git entry */
function findRepo() {
  let cur = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}

/** @param {string[]} args @returns {Object} validated options; usage() exits 1 on a bad flag */
function parseArgs(args) {
  const f = parseFlags(args, FLAGS);
  if (f._.length > 0) usage(`metrics phase-time: unexpected argument ${JSON.stringify(String(f._[0]).slice(0, 60))}`);
  if (typeof f.repo === 'string' && f.repo.length > MAX_REPO_CHARS) usage('metrics phase-time: --repo is longer than 4096 characters');
  let last = null;
  if (f.last !== undefined) {
    if (!/^[0-9]{1,4}$/.test(f.last) || Number(f.last) < 1 || Number(f.last) > 1000) usage('metrics phase-time: --last must be 1..1000');
    last = Number(f.last);
  }
  if (f.scope !== undefined) { try { validateScope(f.scope); } catch (e) { usage(`metrics phase-time: ${e.message}`); } }
  const given = BASELINE_ONLY.filter((k) => f[k] !== undefined);
  if (f.baseline && given.length !== BASELINE_ONLY.length) usage('metrics phase-time: --baseline needs --verify-report, --merge-report, --host-context and --host-label');
  if (!f.baseline && given.length > 0) usage(`metrics phase-time: --${given[0]} needs --baseline`);
  if (f.force && !f.baseline) usage('metrics phase-time: --force needs --baseline');
  if (f.baseline && !LABEL_RE.test(String(f['host-label']))) usage('metrics phase-time: --host-label must match ^[a-z][a-z0-9-]{0,39}$');
  return { f, last, scope: f.scope, includeUnscoped: f['include-unscoped'] === true };
}

/** @returns {string} the repo root @throws PTError exit 2 */
function resolveRepo(given) {
  const repo = given === undefined ? findRepo() : given;
  let ok = false;
  try { ok = repo !== null && fs.statSync(repo).isDirectory(); } catch (_e) { /* missing */ }
  if (!ok) throw new PTError(2, 'repo_unreadable', 'metrics phase-time: --repo is not a readable directory (and no git repository above the current directory)');
  return path.resolve(repo);
}

// ---------- sources ----------

const addGate = (acc, id, rec) => {
  const cur = acc.get(id) || { runs: 0, sum: 0, timed: 0, noDuration: 0 };
  const timed = Number.isInteger(rec.duration_ms);
  acc.set(id, { runs: cur.runs + 1, sum: cur.sum + (timed ? rec.duration_ms : 0), timed: cur.timed + (timed ? 1 : 0), noDuration: cur.noDuration + (timed ? 0 : 1) });
  return acc;
};

/** @returns {{rows: Object[], brokenLogs: Object[], stamps: Map<string, number>, why: Map<string, Object>}} */
function readLive(repo) {
  const out = { rows: [], brokenLogs: [], stamps: new Map(), why: new Map() };
  const phases = path.join(repo, '.a1', 'phases');
  let names = [];
  try { names = fs.readdirSync(phases).sort(); } catch (_e) { return out; }
  for (const scope of names) {
    const file = path.join(phases, scope, 'gate-log.jsonl');
    let st = null;
    try { st = fs.lstatSync(file); } catch (_e) { continue; }
    if (!st.isFile()) continue;
    const res = verifyChain(file);
    if (!res.ok) {
      const problem = `line ${res.problems[0].line}: ${res.problems[0].rule}`;
      out.brokenLogs.push({ scope, problem });
      process.stderr.write(`metrics phase-time: gate log of ${scope.slice(0, 60)} is not trustworthy (${problem}); not summed\n`);
      continue;
    }
    const gates = res.records.reduce((acc, r) => addGate(acc, r.gate, r), new Map());
    for (const [gate, g] of gates) out.rows.push({ source: 'live', scope, gate, runs: g.runs, duration_ms_sum: g.timed === 0 ? null : g.sum, no_duration: g.noDuration });
    out.stamps.set(scope, res.records.map((r) => Date.parse(r.ts)).filter((n) => !Number.isNaN(n)).reduce((a, b) => Math.max(a, b), 0));
    const why = Object.create(null);
    for (const r of res.records.filter((x) => x.gate === MERGE_CHECK)) { const k = typeof r.ci_evidence_why === 'string' ? r.ci_evidence_why : 'unknown'; why[k] = (why[k] || 0) + 1; }
    out.why.set(scope, why);
  }
  return out;
}

const isCount = (v) => Number.isInteger(v) && v >= 0;
/** @returns {boolean} true when a store row has the shape `run record` writes: counts are non-negative integers or null */
function validStoreRow(o) {
  if (!isObj(o) || typeof o.scope !== 'string' || !Array.isArray(o.gates)) return false;
  return o.gates.every((g) => isObj(g) && typeof g.id === 'string' && isCount(g.runs)
    && (g.duration_ms_sum === undefined || g.duration_ms_sum === null || isCount(g.duration_ms_sum))
    && (g.no_duration === undefined || isCount(g.no_duration)));
}

/** @returns {{rows: Object[], unparsable: number, stamps: Map<string, number>, why: Map<string, Object>}} */
function readStore(repo) {
  const out = { rows: [], unparsable: 0, stamps: new Map(), why: new Map() };
  const peek = peekVaultRoot();
  if (!peek) return out;
  const file = path.join(peek.root, 'pattern', 'a1-learnings', '_runs', `${repoProjectSlug(repo)}.jsonl`);
  let text = '';
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > MAX_STORE_BYTES) return out;
    text = fs.readFileSync(file, 'utf8');
  } catch (_e) { return out; }
  for (const line of text.split('\n').filter(Boolean)) {
    let o = null;
    try { o = JSON.parse(line); } catch (_e) { out.unparsable += 1; continue; }
    if (!validStoreRow(o)) { out.unparsable += 1; continue; }
    out.stamps.set(o.scope, Math.max(out.stamps.get(o.scope) || 0, Date.parse(o.recorded_at) || 0));
    const why = out.why.get(o.scope) || Object.create(null);
    for (const g of o.gates) {
      out.rows.push({ source: 'store', scope: o.scope, pr: o.pr === undefined ? null : o.pr, gate: g.id, runs: g.runs, duration_ms_sum: g.duration_ms_sum === undefined ? null : g.duration_ms_sum, no_duration: g.no_duration || 0 });
      if (isObj(g.ci_evidence_why)) for (const [k, n] of Object.entries(g.ci_evidence_why)) why[k] = (why[k] || 0) + (Number.isInteger(n) ? n : 0);
    }
    out.why.set(o.scope, why);
  }
  return out;
}

// ---------- report ----------

const sumRows = (rows) => ({ duration_ms_sum: rows.reduce((a, r) => a + (r.duration_ms_sum || 0), 0), no_duration: rows.reduce((a, r) => a + r.no_duration, 0) });
const addWhy = (into, map) => { for (const [k, n] of Object.entries(map)) into[k] = (into[k] || 0) + n; return into; };

/** @returns {Object} the report: rows (deduplicated per D6), totals, why counts */
function buildReport(repo, opts) {
  const live = readLive(repo);
  const store = readStore(repo);
  const stamps = new Map([...live.stamps, ...store.stamps].map(([k]) => [k, Math.max(live.stamps.get(k) || 0, store.stamps.get(k) || 0)]));
  const wanted = (s) => (opts.scope === undefined ? opts.includeUnscoped || s !== UNSCOPED : s === opts.scope);
  let scopes = [...stamps.keys()].filter(wanted);
  if (opts.last !== null) scopes = scopes.sort((a, b) => stamps.get(b) - stamps.get(a)).slice(0, opts.last);
  const keep = new Set(scopes);
  const stored = new Set(store.rows.map((r) => r.scope));
  const liveRows = live.rows.filter((r) => keep.has(r.scope)).map((r) => ({ ...r, also_in_store: stored.has(r.scope) }));
  const storeRows = store.rows.filter((r) => keep.has(r.scope));
  const counted = liveRows.filter((r) => !r.also_in_store);
  const why = Object.create(null);
  for (const s of scopes) addWhy(why, stored.has(s) ? (store.why.get(s) || {}) : (live.why.get(s) || {}));
  const totals = { live: sumRows(counted), store: sumRows(storeRows) };
  return {
    repo, project: repoProjectSlug(repo), rows: [...liveRows, ...storeRows], totals,
    no_duration: totals.live.no_duration + totals.store.no_duration, ci_evidence_why: why,
    broken_logs: live.brokenLogs, store_unparsable: store.unparsable,
  };
}

function printText(rep) {
  const lines = rep.rows.map((r) => `${r.source}\t${r.scope}\t${r.gate}\truns=${r.runs}\tduration_ms_sum=${r.duration_ms_sum === null ? 'n/a' : r.duration_ms_sum}\tno_duration=${r.no_duration}${r.also_in_store ? '\talso_in_store' : ''}`);
  lines.push(`totals live: duration_ms_sum=${rep.totals.live.duration_ms_sum} no_duration=${rep.totals.live.no_duration}`);
  lines.push(`totals store: duration_ms_sum=${rep.totals.store.duration_ms_sum} no_duration=${rep.totals.store.no_duration}`);
  lines.push(`ci_evidence_why: ${JSON.stringify(rep.ci_evidence_why)}`);
  return `${lines.join('\n')}\n`;
}

// ---------- baseline ----------

/** @returns {Object} the parsed JSON of a size-limited regular file @throws PTError exit 1 */
function readJson(file, maxBytes, label) {
  let text;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > maxBytes) throw new Error('not a regular file or too large');
    text = fs.readFileSync(file, 'utf8');
  } catch (_e) { throw new PTError(1, 'input_unreadable', `metrics phase-time: ${label} is not readable (a regular file of at most ${maxBytes} bytes)`); }
  try { return JSON.parse(text); } catch (_e) { throw new PTError(1, 'input_invalid', `metrics phase-time: ${label} is not valid JSON`); }
}

function checkReport(r, label) {
  if (!isObj(r) || !SHA_RE.test(String(r.head_sha)) || !Array.isArray(r.commands) || !isObj(r.duration_ms)) {
    throw new PTError(1, 'report_invalid', `metrics phase-time: ${label} is not a verify run report (head_sha, commands, duration_ms)`);
  }
}

/** @returns {{verify: Object, merge: Object}} the two reports, checked against D7 */
function readReports(f) {
  const verify = readJson(f['verify-report'], MAX_REPORT_BYTES, '--verify-report');
  const merge = readJson(f['merge-report'], MAX_REPORT_BYTES, '--merge-report');
  checkReport(verify, '--verify-report'); checkReport(merge, '--merge-report');
  if (verify.duration_ms.base !== null) throw new PTError(1, 'report_invalid', 'metrics phase-time: --verify-report must be a head-only run (duration_ms.base null)');
  if (!Number.isInteger(merge.duration_ms.base) || !SHA_RE.test(String(merge.base_sha))) throw new PTError(1, 'report_invalid', 'metrics phase-time: --merge-report must be a run with --base (integer duration_ms.base, 40-hex base_sha)');
  if (verify.head_sha !== merge.head_sha) throw new PTError(1, 'report_invalid', 'metrics phase-time: the two reports have different head_sha values');
  return { verify, merge };
}

function checkRun(run, name) {
  const bad = (key) => new PTError(1, 'host_context_invalid', `metrics phase-time: host_context_invalid: ${name}.${key}`);
  if (!isObj(run)) throw bad('(object)');
  if (!sameKeys(run, RUN_KEYS)) throw bad(RUN_KEYS.find((k) => !(k in run)) || Object.keys(run).find((k) => !RUN_KEYS.includes(k)));
  const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!num(run.load5_start)) throw bad('load5_start');
  if (!num(run.load5_end)) throw bad('load5_end');
  if (!Number.isInteger(run.cpus) || run.cpus < 1 || run.cpus > 4096) throw bad('cpus');
  if (typeof run.host_busy !== 'boolean') throw bad('host_busy');
  if (!Number.isInteger(run.checks) || run.checks < 1 || run.checks > 64) throw bad('checks');
}

/** @returns {Object} the host-context file, schema-checked @throws PTError exit 1 host_context_invalid */
function readHostContext(file) {
  const ctx = readJson(file, MAX_HOST_CONTEXT_BYTES, '--host-context');
  if (!isObj(ctx) || !sameKeys(ctx, CTX_KEYS)) throw new PTError(1, 'host_context_invalid', `metrics phase-time: host_context_invalid: expected exactly the keys ${CTX_KEYS.join(', ')}`);
  for (const k of CTX_KEYS) checkRun(ctx[k], k);
  return ctx;
}

/** @returns {string} the refused-safe target path @throws PTError exit 2 or 1 */
function baselineTarget(repo, force) {
  const target = path.join(repo, BASELINE_REL);
  try {
    assertAncestorInside(path.dirname(target), fs.realpathSync(repo));
    let st = null;
    try { st = fs.lstatSync(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (st && st.isSymbolicLink()) throw new Error('the baseline file is a symlink');
    if (st && !force) throw new PTError(1, 'baseline_exists', 'metrics phase-time: baseline_exists (use --force to rewrite)');
  } catch (e) {
    if (e instanceof PTError) throw e;
    throw new PTError(2, 'refused_write_path', `metrics phase-time: refusing ${BASELINE_REL}: ${e.message}`);
  }
  return target;
}

const cmdRows = (c) => ({ id: c.id, duration_ms: c.duration_ms === undefined ? null : c.duration_ms });

function baselineDoc(rep, reports, ctx, label) {
  const { verify, merge } = reports;
  const perGate = new Map();
  for (const r of rep.rows.filter((x) => !x.also_in_store)) {
    const cur = perGate.get(r.gate) || { gate: r.gate, runs: 0, duration_ms_sum: 0, no_duration: 0 };
    perGate.set(r.gate, { gate: r.gate, runs: cur.runs + (r.runs || 0), duration_ms_sum: cur.duration_ms_sum + (r.duration_ms_sum || 0), no_duration: cur.no_duration + r.no_duration });
  }
  return {
    schema: 1, feature: '027-lean-pipeline', host_label: label, platform: os.platform(), node: process.version,
    cpus: os.cpus().length, date: new Date().toISOString(), sha: verify.head_sha, base_sha: merge.base_sha,
    gates: [...perGate.values()],
    verify_head_only: { head_sha: verify.head_sha, verdict: verify.verdict, total_ms: verify.duration_ms.total, commands: verify.commands.map(cmdRows), host_load: ctx.verify_head_only },
    merge_check_long_path: {
      path: 'serial', source: 'verify run --base <merge-base sha> --no-cache (runVerify of pr merge-check)', head_sha: merge.head_sha, base_sha: merge.base_sha,
      verdict: merge.verdict, head_ms: merge.duration_ms.head, base_ms: merge.duration_ms.base, total_ms: merge.duration_ms.total,
      commands: merge.commands.map((c) => ({ ...cmdRows(c), base_duration_ms: c.base_duration_ms === undefined ? null : c.base_duration_ms })),
      host_load: ctx.merge_check_long_path,
    },
  };
}

/** @returns {{out: string, err: string}} stdout and stderr text of a written baseline */
function writeBaseline(repo, f, rep) {
  const reports = readReports(f);
  const ctx = readHostContext(f['host-context']);
  const target = baselineTarget(repo, f.force === true);
  const doc = baselineDoc(rep, reports, ctx, f['host-label']);
  try { writeTextAtomic(target, `${JSON.stringify(doc, null, 2)}\n`); } catch (e) { throw new PTError(2, 'io', `metrics phase-time: ${e.message}`); }
  const busy = CTX_KEYS.filter((k) => ctx[k].host_busy);
  return {
    out: `${JSON.stringify({ written: target, host_busy: busy.length > 0 })}\n`,
    err: busy.length > 0 ? `metrics phase-time: baseline taken on a busy host (${busy.join(', ')})\n` : '',
  };
}

/**
 * @param {string[]} args - metrics phase-time flags
 */
function cmdMetricsPhaseTime(args) {
  const { f, last, scope, includeUnscoped } = parseArgs(args);
  try {
    const repo = resolveRepo(f.repo);
    const rep = buildReport(repo, { last, scope, includeUnscoped });
    if (f.baseline) { const r = writeBaseline(repo, f, rep); return emitExit(0, r.out, r.err); }
    return emitExit(0, f.json ? `${JSON.stringify(rep)}\n` : printText(rep), '');
  } catch (e) {
    if (!(e instanceof PTError)) return emitExit(2, '', `metrics phase-time: ${e && e.message ? e.message : String(e)}\n`);
    return emitExit(e.exit, '', `${e.message}\n`);
  }
}

module.exports = { cmdMetricsPhaseTime, BASELINE_REL };
