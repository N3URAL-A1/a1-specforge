'use strict';

// `feature close` (spec 027 FR-026, plan D16): the idempotent close of a feature after its PR merged. It deletes local
// branches and exits a worktree, so it fails closed: it deletes only what is proven merged (the branch tip is an ancestor of
// origin/<base>, or a merged PR whose head equals the local tip), never a branch with unmerged commits (those go to kept[]),
// and it stops at the first failed step. The refusals before the first state change (spec file, PR state, remote branch,
// worktree match) run before anything is touched; later refusals (a dirty worktree at the exit, a failed stage) stop the run
// part-way and a second call resumes it (the steps are idempotent). `--check-only` runs only the refusals that need no state
// change. Every child is an argv-only process (no shell); git runs without GIT_* redirects. A1_GH_BIN replaces gh for the
// fixtures: it must be absolute, is reported (`gh_bin: "override"`), and its merged-PR verdicts delete only when the fixture
// marker A1_FEATURE_CLOSE_TEST=1 is set; otherwise only the git-provable ancestry rule deletes.
// Shared state is never committed here (push-cadence P3): a tracked, changed .a1/reservations.json is only reported.
// Spec 027 slice 5 (FR-031, plan D6): the close plan is checkPr, checkRemote, findWorktree, recordRuns, machineRetro, exitWorktree, ...
// machineRetro appends ONE machine record per PR to the learning store before the worktree (and its gate logs) is gone; it is not
// part of the delete path and fails closed (an exit-2 store error stops the run before the worktree exit). `--check-only` ends with
// decideRetro and prints `retro: {gates_fired, result, prose_required, reasons}`; `--issues <tags>` forces prose_required.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { emitExit } = require('./emit-exit.cjs');
const { parseFlags, readMd, peekVaultRoot } = require('./io.cjs');
const { gitSafe } = require('./git-safe.cjs');
const { envWithoutGitRedirects } = require('./git-env.cjs');
const { SCOPE_RE } = require('./gate-log.cjs');
const { listGateLogs } = require('./worktree-gatelog.cjs');
const { repoProjectSlug } = require('./project-slug.cjs');
const { storeDir } = require('./run-record.cjs');
const MR = require('./machine-retro.cjs');

const FACADE = path.join(__dirname, '..', 'a1-tools.cjs');
const PR_RE = /^[1-9][0-9]{0,6}$/;
const ISSUES_RE = /^[a-z0-9][a-z0-9_-]{0,40}(,[a-z0-9][a-z0-9_-]{0,40}){0,19}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const STAGES = Object.freeze(['started', 'complete', 'review', 'verify', 'merge', 'origin-cleanup', 'done']);
const USAGE = 'a1-tools feature close --by <spec-id> --pr <n> [--repo <dir>] [--spec <path>] [--worktree <id>] [--check-only] [--issues <tags>] | feature close --cleanup-only [--repo <dir>]';

class CloseError extends Error {
  constructor(reason, step, detail) { super(detail || reason); this.reason = reason; this.step = step; this.detail = detail || ''; }
}
class UsageError extends Error {}

/** git through the audited exec path, without GIT_* redirect variables. @returns {{code:number,out:string,err:string}} */
function git(repo, args) {
  const r = gitSafe(repo, args, { allowFail: true, env: envWithoutGitRedirects() });
  if (typeof r === 'string') return { code: 0, out: r, err: '' };
  return { code: typeof r.__code === 'number' ? r.__code : 127, out: '', err: String(r.__error || '') };
}

function child(bin, args, cwd) {
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8', shell: false, env: envWithoutGitRedirects(), maxBuffer: 16 * 1024 * 1024 });
  return { code: r.status === null ? 127 : r.status, out: r.stdout || '', err: (r.stderr || '') + (r.error ? String(r.error.message) : '') };
}
const cli = (repo, args) => child(process.execPath, [FACADE, ...args], repo);
const ghOverride = () => typeof process.env.A1_GH_BIN === 'string' && process.env.A1_GH_BIN !== '';
const ghBin = () => (ghOverride() ? process.env.A1_GH_BIN : 'gh');
const gh = (repo, args) => child(ghBin(), args, repo);
/** A merged-PR verdict deletes only from the real gh, or from a fixture gh that the fixture marker names. */
const ghTrusted = () => !ghOverride() || process.env.A1_FEATURE_CLOSE_TEST === '1';
const safeText = (v) => String(v).replace(/[\u0000-\u001f\u007f]/g, '?');
/** A local branch name: valid as refs/heads/<name> (so `@{-1}` and the like are not expanded), no leading dash. */
const validBranch = (b, repo) => typeof b === 'string' && b !== '' && !b.startsWith('-') && git(repo, ['check-ref-format', `refs/heads/${b}`]).code === 0;

function parseJson(text, reason, step) {
  try { return JSON.parse(text); } catch (_e) { throw new CloseError(reason, step, `unparseable output: ${String(text).slice(0, 120)}`); }
}

/** @returns {{by:string|null,pr:number|null,repo:string,spec:string|null,worktree:string|null,cleanupOnly:boolean,checkOnly:boolean,issues:string[]}} @throws UsageError */
function parseArgs(rest) {
  const f = parseFlags(rest, { by: 'value', pr: 'value', repo: 'value', spec: 'value', worktree: 'value', issues: 'value', 'cleanup-only': 'bool', 'check-only': 'bool' });
  if (f._.length > 0) throw new UsageError(`unexpected argument ${JSON.stringify(String(f._[0]).slice(0, 60))}`);
  const clean = f['cleanup-only'] === true;
  const checkOnly = f['check-only'] === true;
  if (clean && checkOnly) throw new UsageError('--cleanup-only and --check-only exclude each other');
  if (clean && (f.by !== undefined || f.pr !== undefined || f.spec !== undefined || f.worktree !== undefined)) throw new UsageError('--cleanup-only takes only --repo');
  if (clean && f.issues !== undefined) throw new UsageError('--cleanup-only takes only --repo');
  if (f.issues !== undefined && (typeof f.issues !== 'string' || !ISSUES_RE.test(f.issues))) throw new UsageError('--issues must be 1-20 comma-separated tags (a-z, 0-9, _ -)');
  if (!clean) {
    if (typeof f.by !== 'string' || !SCOPE_RE.test(f.by) || f.by.includes('..')) throw new UsageError('--by must be a safe spec id (letters, digits, . _ -)');
    if (typeof f.pr !== 'string' || !PR_RE.test(f.pr)) throw new UsageError('--pr must be a positive integer of at most 7 digits');
    if (f.worktree !== undefined && (typeof f.worktree !== 'string' || !ID_RE.test(f.worktree))) throw new UsageError('--worktree must be a registry id');
    if (f.spec !== undefined && (typeof f.spec !== 'string' || f.spec === '' || f.spec.includes('\0'))) throw new UsageError('--spec must be a file path');
  }
  const repo = f.repo === undefined ? process.cwd() : f.repo;
  if (typeof repo !== 'string' || repo === '' || repo.includes('\0')) throw new UsageError('--repo must be a directory path');
  let isDir = false;
  try { isDir = fs.statSync(repo).isDirectory(); } catch (_e) { /* not there */ }
  if (!isDir) throw new UsageError('--repo is not an existing directory');
  return { by: clean ? null : f.by, pr: clean ? null : Number(f.pr), repo: path.resolve(repo), spec: f.spec === undefined ? null : f.spec, worktree: f.worktree === undefined ? null : f.worktree, cleanupOnly: clean, checkOnly, issues: f.issues === undefined ? [] : f.issues.split(',') };
}

/** Step 1: the git toplevel of --repo, which must be a primary checkout. @returns {string} */
function resolveRepo(dir) {
  const r = git(dir, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir']);
  const [top, gdir, common] = r.out.split('\n');
  if (r.code !== 0 || !top || !gdir || !common) throw new CloseError('not_a_repo', 'repo', r.err);
  if (path.resolve(gdir) !== path.resolve(common)) throw new CloseError('run_from_worktree', 'repo', 'run feature close from the primary checkout, not from a linked worktree');
  return top;
}

/** Spec path: --spec, else <vault>/project/<slug>/spec/<id>.md. Missing file -> spec_not_found (checked before any change). */
function resolveSpec(ctx) {
  let p = ctx.opts.spec === null ? null : path.resolve(ctx.opts.repo, ctx.opts.spec);
  if (p === null) {
    const peek = peekVaultRoot();
    if (peek) p = path.join(peek.root, 'project', repoProjectSlug(ctx.repo), 'spec', `${ctx.opts.by}.md`);
  }
  let isFile = false;
  try { isFile = p !== null && fs.statSync(p).isFile(); } catch (_e) { /* not there */ }
  if (!isFile) throw new CloseError('spec_not_found', 'args', `spec file not found: ${p}`);
  ctx.specPath = p;
}

/** Step 2: the PR must be MERGED. */
function checkPr(ctx) {
  const r = gh(ctx.repo, ['pr', 'view', String(ctx.opts.pr), '--json', 'state,headRefName,baseRefName,headRefOid']);
  if (r.code !== 0) throw new CloseError('gh_failed', 'pr', r.err.trim().slice(0, 200));
  const pr = parseJson(r.out, 'gh_failed', 'pr');
  if (pr.state !== 'MERGED') throw new CloseError('pr_not_merged', 'pr', `PR ${ctx.opts.pr} is ${String(pr.state)}`);
  if (!validBranch(pr.headRefName, ctx.repo)) throw new CloseError('bad_branch_name', 'pr', 'the PR head branch name is not a valid branch name');
  ctx.head = pr.headRefName;
  if (validBranch(pr.baseRefName, ctx.repo)) ctx.base = pr.baseRefName;
  ctx.steps.push({ step: 'pr', result: 'done' });
}

/** Step 3: the remote branch must be gone (the merge deleted it). */
function checkRemote(ctx) {
  const r = git(ctx.repo, ['ls-remote', '--heads', 'origin', `refs/heads/${ctx.head}`]);
  if (r.code !== 0) throw new CloseError('git_failed', 'remote', r.err.slice(0, 200));
  if (r.out !== '') throw new CloseError('remote_branch_present', 'remote', `origin still has ${ctx.head}`);
  ctx.steps.push({ step: 'remote', result: 'done' });
}

const real = (p) => { try { return fs.realpathSync(p); } catch (_e) { return path.resolve(p); } };

/** Step 4: the registry entry of the feature worktree (or none / cleaned -> steps 5-6 are skipped). */
function findWorktree(ctx) {
  const r = cli(ctx.repo, ['worktree', 'list', '--repo-root', ctx.repo]);
  if (r.code !== 0) throw new CloseError('step_failed', 'worktree', r.err.trim().slice(0, 200));
  const all = (parseJson(r.out, 'step_failed', 'worktree').worktrees || []).filter((e) => real(e.repo_root) === real(ctx.repo));
  const entry = ctx.opts.worktree !== null ? all.find((e) => e.id === ctx.opts.worktree) : all.find((e) => e.branch === ctx.head && e.status !== 'cleaned');
  if (ctx.opts.worktree !== null && !entry) throw new CloseError('worktree_mismatch', 'worktree', `no registry entry ${ctx.opts.worktree} for this repository`);
  if (entry && entry.status !== 'cleaned') {
    if (entry.branch !== ctx.head || real(entry.worktree_path) === real(ctx.repo)) throw new CloseError('worktree_mismatch', 'worktree', 'the registry entry is not the worktree of the merged branch');
    ctx.entry = entry;
  }
  ctx.steps.push({ step: 'worktree', result: ctx.entry ? 'done' : 'skipped' });
}

/** Step 5: `run record` for every gate-log scope of the worktree, so the exit finds nothing unrecorded (audit M9). */
function recordRuns(ctx) {
  if (!ctx.entry) return ctx.steps.push({ step: 'record-runs', result: 'skipped' });
  const scopes = listGateLogs(ctx.entry.worktree_path);
  for (const scope of scopes) {
    const r = cli(ctx.repo, ['run', 'record', '--repo', ctx.entry.worktree_path, '--scope', scope, '--pr', String(ctx.opts.pr)]);
    if (r.code === 2) throw new CloseError('step_failed', 'record-runs', `run record ${scope}: ${r.err.trim().slice(0, 200)}`);
    if (r.code !== 0) ctx.warnings.push(`run record ${scope} exit ${r.code}: ${r.err.trim().slice(0, 120)}`);
  }
  return ctx.steps.push({ step: 'record-runs', result: scopes.length ? 'done' : 'skipped' });
}

/** The learning-store directory, or null when there is none (exit 1 of `run record`: a warning, not a failure). */
function storeOrNull() {
  try { return storeDir(); } catch (e) { if (e && e.exit === 1) return null; throw e; }
}

const retroView = (retro, decision, source) => ({ gates_fired: retro.gates_fired, result: retro.result, prose_required: decision.required, reasons: decision.reasons, source });

/** Last step of `--check-only` (D6): the prose decision from the worktree logs, else from the stored machine record, else `no_record`. */
function decideRetro(ctx) {
  if (ctx.entry) {
    const rs = MR.readScopes(ctx.entry.worktree_path);
    const retro = MR.deriveRetro({ records: rs.records, issues: ctx.opts.issues });
    ctx.retro = retroView(retro, MR.proseDecision({ ...retro, issues: ctx.opts.issues, problem: rs.problem }), 'worktree');
  } else {
    const store = storeOrNull();
    const rec = store === null ? { found: false, prose_required: true } : MR.findMachineRecord({ store, spec: ctx.opts.by, pr: ctx.opts.pr });
    const reasons = !rec.found ? ['no_record'] : [...(rec.prose_required ? ['stored_record'] : []), ...(ctx.opts.issues.length ? ['issues'] : [])];
    ctx.retro = { gates_fired: [], result: null, prose_required: rec.prose_required || ctx.opts.issues.length > 0, reasons, source: rec.found ? 'stored' : 'none' };
  }
}

/** Step 5b (D6): append the machine record before the worktree exit. No store: warning + skipped; exit-2 store error: step_failed. */
function machineRetro(ctx) {
  const skip = (why) => { if (why) ctx.warnings.push(`machine-retro: ${why}`); return ctx.steps.push({ step: 'machine-retro', result: 'skipped' }); };
  if (!ctx.entry) return skip(null);
  const rs = MR.readScopes(ctx.entry.worktree_path);
  const retro = MR.deriveRetro({ records: rs.records, issues: ctx.opts.issues });
  const decision = MR.proseDecision({ ...retro, issues: ctx.opts.issues, problem: rs.problem });
  ctx.retro = retroView(retro, decision, 'worktree'); // set before any skip: the logs die with the worktree exit
  const store = storeOrNull();
  if (store === null) return skip('no learning store; no machine record written');
  if (rs.problem) return skip(`${rs.problem}; no machine record written`);
  if (rs.records.length === 0) return skip(null);
  const entry = MR.renderEntry({ date: new Date().toISOString().slice(0, 10), spec: ctx.opts.by, pr: ctx.opts.pr, project: repoProjectSlug(ctx.repo), retro, decision, issues: ctx.opts.issues });
  let r;
  try { r = MR.appendMachineRetro({ store, spec: ctx.opts.by, pr: ctx.opts.pr, entry }); } catch (e) {
    if (e && e.exit === 2) throw new CloseError('step_failed', 'machine-retro', String(e.message).slice(0, 200));
    throw e;
  }
  return ctx.steps.push({ step: 'machine-retro', result: r.status === 'appended' ? 'done' : 'skipped' });
}

/** Step 6: `worktree exit --mode discard`, never --force-discard. */
function exitWorktree(ctx) {
  if (!ctx.entry) return ctx.steps.push({ step: 'worktree-exit', result: 'skipped' });
  const r = cli(ctx.repo, ['worktree', 'exit', ctx.entry.id, '--mode', 'discard']);
  if (r.code !== 0) throw new CloseError('worktree_exit_refused', 'worktree-exit', r.err.trim().slice(0, 400));
  return ctx.steps.push({ step: 'worktree-exit', result: 'done' });
}

function reservation(ctx) {
  const r = cli(ctx.repo, ['code-scope', 'list']);
  if (r.code !== 0) throw new CloseError('step_failed', 'stages', `code-scope list: ${r.err.trim().slice(0, 200)}`);
  return (parseJson(r.out, 'step_failed', 'stages').reservations || []).find((x) => x.type === 'code_scope' && x.by === ctx.opts.by) || null;
}

/** Step 7: advance `merge`, then `origin-cleanup`, each only when the stage is still before it. */
function advanceStages(ctx) {
  const res = reservation(ctx);
  if (!res) return ctx.steps.push({ step: 'stages', result: 'skipped' });
  let moved = false;
  let stage = res.stage;
  for (const target of ['merge', 'origin-cleanup']) {
    if (STAGES.indexOf(stage) >= STAGES.indexOf(target)) continue;
    const r = cli(ctx.repo, ['code-scope', 'stage', '--by', ctx.opts.by, '--set', target]);
    if (r.code !== 0) throw new CloseError('step_failed', 'stages', `code-scope stage ${target}: ${r.err.trim().slice(0, 200)}`);
    stage = target; moved = true;
  }
  return ctx.steps.push({ step: 'stages', result: moved ? 'done' : 'skipped' });
}

/** Step 8: release the code_scope reservation. */
function releaseScope(ctx) {
  if (!reservation(ctx)) return ctx.steps.push({ step: 'release', result: 'skipped' });
  const r = cli(ctx.repo, ['code-scope', 'release', '--by', ctx.opts.by]);
  if (r.code !== 0) throw new CloseError('step_failed', 'release', `code-scope release: ${r.err.trim().slice(0, 200)}`);
  return ctx.steps.push({ step: 'release', result: 'done' });
}

/** Step 9: the spec goes to `done` unless it already is. */
function closeSpec(ctx) {
  let status = null;
  try { status = readMd(ctx.specPath).fm.status; } catch (_e) { /* an unreadable spec fails in update-status */ }
  if (status === 'done') return ctx.steps.push({ step: 'spec', result: 'skipped' });
  const r = cli(ctx.repo, ['spec', 'update-status', ctx.specPath, 'done']);
  if (r.code !== 0) throw new CloseError('step_failed', 'spec', `spec update-status: ${r.err.trim().slice(0, 200)}`);
  return ctx.steps.push({ step: 'spec', result: 'done' });
}

/** The local default branch(es) to protect: origin/HEAD when it resolves, else main and master (a name that is absent is harmless). */
function defaultBranches(ctx) {
  const r = git(ctx.repo, ['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD']);
  const name = r.code === 0 ? r.out.replace(/^origin\//, '') : '';
  return name !== '' && validBranch(name, ctx.repo) ? [name] : ['main', 'master'];
}

const hasRef = (ctx, ref) => git(ctx.repo, ['rev-parse', '--verify', '--quiet', ref]).code === 0;

/** The branch the ancestry rule measures against: the PR base, else the first default branch that exists on origin. */
function baseBranch(ctx, defaults) {
  if (ctx.base) return ctx.base;
  return defaults.find((n) => hasRef(ctx, `refs/remotes/origin/${n}`)) || defaults[0];
}

/** Branches that are never candidates: the default branch(es), the PR base, the current one, and any branch checked out in a worktree. */
function protectedBranches(ctx, defaults) {
  const keep = new Set(defaults);
  if (ctx.base) keep.add(ctx.base);
  const cur = git(ctx.repo, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (cur.code === 0) keep.add(cur.out);
  for (const n of ['main', 'master']) if (hasRef(ctx, `refs/heads/${n}`)) keep.add(n); // always, even when origin/HEAD names another branch
  for (const b of checkedOutBranches(ctx)) keep.add(b);
  return keep;
}

/** Every local branch checked out in some worktree, read fresh from `git worktree list --porcelain`. */
function checkedOutBranches(ctx) {
  const wt = git(ctx.repo, ['worktree', 'list', '--porcelain']);
  if (wt.code !== 0) throw new CloseError('git_failed', 'sweep', wt.err.slice(0, 200));
  return wt.out.split('\n').filter((l) => l.startsWith('branch refs/heads/')).map((l) => l.slice('branch refs/heads/'.length));
}

/**
 * Decide one candidate: {del:true} only when proven merged, else {del:false, reason}. Rule (b) is git ancestry (the tip is
 * contained in origin/<base>): a commit+revert or an --allow-empty branch has an empty diff but is not contained, so it is kept.
 * A fresh branch with no commits has its tip on the base, is contained, and loses nothing when deleted.
 */
function judge(ctx, base, branch, tip) {
  const r = gh(ctx.repo, ['pr', 'list', '--state', 'merged', '--head', branch, '--json', 'headRefOid']);
  if (r.code !== 0) throw new CloseError('gh_failed', 'sweep', `gh pr list ${branch}: ${r.err.trim().slice(0, 200)}`);
  const merged = parseJson(r.out, 'gh_failed', 'sweep');
  const list = Array.isArray(merged) ? merged : [];
  if (hasRef(ctx, `refs/remotes/origin/${base}`) && git(ctx.repo, ['merge-base', '--is-ancestor', `refs/heads/${branch}`, `refs/remotes/origin/${base}`]).code === 0) return { del: true };
  if (list.some((e) => e && e.headRefOid === tip)) return ghTrusted() ? { del: true } : { del: false, reason: 'gh_override' };
  return { del: false, reason: list.length > 0 ? 'tip_differs' : 'unmerged_commits' };
}

/**
 * Delete one branch by compare-and-swap on the judged tip, after a fresh worktree check (`update-ref -d` has no checked-out
 * refusal of its own). @returns {'deleted'|'tip_moved'|'checked_out'|'already_gone'}
 */
function deleteAtTip(ctx, branch, tip) {
  const dropConfig = () => git(ctx.repo, ['config', '--remove-section', `branch.${branch}`]);
  if (checkedOutBranches(ctx).includes(branch)) return 'checked_out';
  const d = git(ctx.repo, ['update-ref', '-d', `refs/heads/${branch}`, tip]);
  if (d.code === 0) { dropConfig(); return 'deleted'; }
  const now = git(ctx.repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (now.code === 0 && now.out !== tip) return 'tip_moved';
  if (now.code !== 0) { dropConfig(); return 'already_gone'; } // someone else removed the ref: a leftover branch.<name> section goes too
  throw new CloseError('git_failed', 'sweep', `git update-ref -d ${branch}: ${d.err.slice(0, 200)}`);
}

/** Step 10: fetch --prune, then the branch sweep. All verdicts first (a gh failure deletes nothing), then the deletions. */
function sweepBranches(ctx) {
  const f = git(ctx.repo, ['fetch', '--prune', 'origin']);
  if (f.code !== 0) throw new CloseError('git_failed', 'sweep', `git fetch --prune: ${f.err.slice(0, 200)}`);
  const defaults = defaultBranches(ctx);
  const base = baseBranch(ctx, defaults);
  const keep = protectedBranches(ctx, defaults);
  const refs = git(ctx.repo, ['for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/heads']);
  if (refs.code !== 0) throw new CloseError('git_failed', 'sweep', refs.err.slice(0, 200));
  const verdicts = [];
  for (const line of refs.out.split('\n').filter(Boolean)) {
    const [ref, tip] = line.split('\t');
    const branch = ref.slice('refs/heads/'.length);
    if (keep.has(branch) || !validBranch(branch, ctx.repo)) continue;
    verdicts.push({ branch, tip, ...judge(ctx, base, branch, tip) });
  }
  for (const v of verdicts) {
    if (!v.del) { ctx.kept.push({ branch: v.branch, reason: v.reason }); continue; }
    const outcome = deleteAtTip(ctx, v.branch, v.tip);
    if (outcome === 'deleted') ctx.deleted.push(v.branch);
    else ctx.kept.push({ branch: v.branch, reason: outcome });
  }
  ctx.steps.push({ step: 'sweep', result: ctx.deleted.length ? 'done' : 'skipped' });
}

/** Step 11: report a tracked, changed .a1/reservations.json for the caller to commit; this command never does. */
function pendingSharedState(ctx) {
  const rel = '.a1/reservations.json';
  const tracked = git(ctx.repo, ['ls-files', '--error-unmatch', '--', rel]).code === 0;
  const changed = tracked && git(ctx.repo, ['diff', '--quiet', '--', rel]).code === 1;
  if (changed) {
    ctx.pending = rel;
    ctx.warnings.push(`${rel} is tracked and changed: commit it on main (push-cadence P3 finish step)`);
  }
  ctx.steps.push({ step: 'shared-state', result: changed ? 'done' : 'skipped' });
}

/** @param {object} opts parsed arguments @returns {{ok, mode, steps, deleted, kept, warnings, reservations_commit_pending}} */
function closeFeature(opts) {
  const ctx = { opts, repo: null, specPath: null, head: null, base: null, entry: null, retro: null, steps: [], warnings: [], deleted: [], kept: [], pending: null };
  const mode = opts.cleanupOnly ? 'cleanup-only' : opts.checkOnly ? 'check-only' : 'close';
  const extra = ghOverride() ? { gh_bin: 'override' } : {};
  try {
    ctx.repo = resolveRepo(opts.repo);
    if (!opts.cleanupOnly) resolveSpec(ctx);
    const plan = opts.cleanupOnly ? [sweepBranches] : opts.checkOnly ? [checkPr, findWorktree, decideRetro] : [checkPr, checkRemote, findWorktree, recordRuns, machineRetro, exitWorktree, advanceStages, releaseScope, closeSpec, sweepBranches, pendingSharedState];
    for (const step of plan) step(ctx);
    if (!opts.cleanupOnly && !ctx.retro) decideRetro(ctx); // a close run with no worktree left reads the stored record
  } catch (e) {
    if (!(e instanceof CloseError)) throw e;
    return { ok: false, reason: e.reason, step: e.step, detail: e.detail, mode, ...extra, steps: ctx.steps, deleted: ctx.deleted, kept: ctx.kept, warnings: ctx.warnings };
  }
  const out = { ok: true, mode, ...extra, pr: opts.pr, spec: ctx.specPath, steps: ctx.steps, deleted: ctx.deleted, kept: ctx.kept, warnings: ctx.warnings };
  if (ctx.retro) out.retro = ctx.retro;
  if (ctx.pending) out.reservations_commit_pending = ctx.pending;
  return out;
}

/** @param {string[]} rest */
function cmdFeatureClose(rest) {
  if (rest.length === 1 && (rest[0] === '--help' || rest[0] === '-h')) return emitExit(0, `usage: ${USAGE}\n`, '');
  let opts;
  try { opts = parseArgs(rest); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    return emitExit(2, '', `feature close: ${e.message}\nusage: ${USAGE}\n`);
  }
  if (ghOverride() && !path.isAbsolute(process.env.A1_GH_BIN)) return emitExit(2, '', `feature close: A1_GH_BIN must be an absolute path (got ${safeText(process.env.A1_GH_BIN).slice(0, 120)})\n`);
  const notes = ghOverride() ? `feature close: gh binary override A1_GH_BIN=${safeText(process.env.A1_GH_BIN)}\n` : '';
  const out = closeFeature(opts);
  if (out.ok && out.reservations_commit_pending) {
    return emitExit(0, `${JSON.stringify(out)}\n`, `${notes}feature close: commit ${out.reservations_commit_pending} on main (push-cadence P3 finish step)\n`);
  }
  if (!out.ok) return emitExit(1, `${JSON.stringify(out)}\n`, `${notes}feature close: ${out.reason} (step ${out.step})${out.detail ? `: ${out.detail}` : ''}\n`);
  return emitExit(0, `${JSON.stringify(out)}\n`, notes);
}

module.exports = { cmdFeatureClose, closeFeature, parseArgs };
