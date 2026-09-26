'use strict';

// ---------------------------------------------------------------------------
// vault-sync — `a1-tools vault sync` and `a1-tools vault status` (spec
// 010-vault-cockpit-contract, Wave 3: FR-001, FR-011..FR-014, plus the slug
// rules FR-009/FR-015 the CLI needs to be safe to call). Both commands are
// thin shells over vault-mirror.cjs (planMirror/applyMirror); this module
// adds argument handling, slug resolution, activation and the drift report.
//
// Exit codes (each command owns its own and calls process.exit):
//   sync    0 applied / dry-run / skipped (root missing or read-only FR-010,
//             non-writer host FR-034)
//           1 input error (unknown flag, unsafe slug, slug mismatch, duplicate claim)
//           2 cannot run (no external vault root, not a git repo, apply refused)
//   status  0 no drift, or skipped (root missing or unreadable, FR-010) ·
//           1 drift · 2 cannot run — including every input error, so that 1
//           always means "drift" (FR-013).
//
// Activation (FR-001): only an explicit A1_VAULT_ROOT activates. Both commands
// require a git repo, and inside a git repo the only other tier vaultRoot()
// can resolve is repo-local — refused by vault-common's externalVaultRoot()
// with a read-only lookup, because resolving that tier creates
// <repo>/.a1/learnings/ as a side effect and a refusal must write nothing.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { codeRoots, parseFlags, parseFrontmatter, assertSafeSegment } = require('./io.cjs');
const { planMirror, applyMirror } = require('./vault-mirror.cjs');
const {
  MAX_SLUG_LENGTH, isConflictCopy, isInside, childDirs, externalVaultRoot, rootProblem, warnSkipped,
  writerHostGate, notWriterReason,
} = require('./vault-common.cjs');
const { PRODUCT_MIRROR_SET, PHASES_MIRROR_SET, MIRROR_EXCLUDES } = require('./vault-contract.cjs');
const { emitJson, writeStdoutSync } = require('./xprov-common.cjs');

const SETS = Object.freeze(['product', 'phases']);
const SET_PATTERNS = Object.freeze({ product: PRODUCT_MIRROR_SET, phases: PHASES_MIRROR_SET });
const ROADMAP_REL = Object.freeze(['docs', 'product', 'ROADMAP.md']);
const SYNC_FLAGS = Object.freeze({ product: 'bool', phases: 'bool', 'dry-run': 'bool', prune: 'bool', json: 'bool', slug: 'value' });
const STATUS_FLAGS = Object.freeze({ json: 'bool', slug: 'value' });
const EXIT_CODES = Object.freeze({
  sync: { input: 1, cannot_run: 2 },
  status: { input: 2, cannot_run: 2 },
});
const DRIFT_CLASS = Object.freeze({ add: 'missing', update: 'stale', extra: 'extra' });

// ---------- errors ----------

/** kind ∈ input | cannot_run; each command maps it to its exit code. */
function vaultError(kind, message) {
  const err = new Error(message);
  err.vaultKind = kind;
  return err;
}

function exitWith(cmd, err) {
  if (!err || !err.vaultKind) throw err; // internal fault → facade prints it
  process.stderr.write(`[a1-tools] vault ${cmd}: ${err.message}\n`);
  process.exit(EXIT_CODES[cmd][err.vaultKind]);
}

// ---------- argument and slug handling ----------

function parseArgs(args, known, cmd) {
  const flags = parseFlags(args, known);
  const stray = flags._.filter((a) => a.startsWith('--'));
  if (stray.length > 0) throw vaultError('input', `unknown flag ${stray[0]} (usage: a1-tools --help)`);
  if (flags._.length > 1) throw vaultError('input', `takes at most one <slug>, got ${flags._.length} positional arguments`);
  if (Object.prototype.hasOwnProperty.call(flags, 'slug') && !flags.slug) {
    throw vaultError('input', '--slug needs a value');
  }
  const [arg] = flags._;
  if (arg && flags.slug && arg !== flags.slug) {
    throw vaultError('input', `<slug> ${JSON.stringify(arg)} and --slug ${JSON.stringify(flags.slug)} disagree`);
  }
  return { flags, requested: arg || flags.slug || null, cmd };
}

/** assertSafeSegment first (traversal, separators), then the product slug
 * shape and a length bound — a 10 000-char identifier passes the segment
 * guard but would reach the filesystem as ENAMETOOLONG. */
function assertSlug(value, label) {
  try {
    assertSafeSegment(value, label);
  } catch (e) {
    throw vaultError('input', e.message);
  }
  if (value.length > MAX_SLUG_LENGTH) {
    throw vaultError('input', `${label} must be at most ${MAX_SLUG_LENGTH} characters (got ${value.length})`);
  }
  // Lazy: product.cjs will require the mirror (Wave 4); a top-level require
  // here would be circular.
  const { PRODUCT_SLUG_RE } = require('./product.cjs');
  if (!PRODUCT_SLUG_RE.test(value)) {
    throw vaultError('input', `${label} must be a kebab-case slug (got: ${JSON.stringify(value)})`);
  }
  return value;
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (_e) {
    return null;
  }
}

function findRepoRoot() {
  const top = git(['rev-parse', '--show-toplevel'], process.cwd());
  if (!top) throw vaultError('cannot_run', 'must run inside a git repo (the mirror source is the repo)');
  return top;
}

/** `{exists, project}` from docs/product/ROADMAP.md frontmatter. */
function readRoadmapProject(repoRoot) {
  const file = path.join(repoRoot, ...ROADMAP_REL);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (_e) {
    return { exists: false, project: null };
  }
  const { project } = parseFrontmatter(text).fm;
  return { exists: true, project: typeof project === 'string' && project !== '' ? project : null };
}

/** FR-009 seam: the roadmap `project:` is the slug; an argv slug must agree.
 * Without a roadmap an explicit slug is required (phases-only mirror). */
function resolveSlug(requested, roadmap) {
  if (requested) assertSlug(requested, 'slug');
  if (!roadmap.exists) {
    if (!requested) throw vaultError('input', 'no docs/product/ROADMAP.md — pass --slug <slug> (phases are mirrored only)');
    return requested;
  }
  if (!roadmap.project) throw vaultError('input', 'docs/product/ROADMAP.md has no frontmatter project: — cannot resolve the slug');
  assertSlug(roadmap.project, 'ROADMAP.md project');
  if (requested && requested !== roadmap.project) {
    throw vaultError('input', `slug mismatch: argument "${requested}" but docs/product/ROADMAP.md says project: "${roadmap.project}"`);
  }
  return roadmap.project;
}

function selectSets(flags, roadmapExists) {
  const asked = SETS.filter((s) => flags[s] === true);
  if (!roadmapExists && flags.product === true) {
    throw vaultError('input', '--product needs docs/product/ROADMAP.md; this repo has none');
  }
  const chosen = asked.length > 0 ? asked : SETS;
  return Object.freeze(chosen.filter((s) => roadmapExists || s !== 'product'));
}

// ---------- activation ----------

function requireExternalRoot() {
  const ext = externalVaultRoot();
  if (ext.refusal) throw vaultError('cannot_run', ext.refusal);
  return ext.root;
}

// ---------- duplicate-claim scan (FR-015) ----------

function realOrSelf(p) {
  try { return fs.realpathSync(p); } catch (_e) { return path.resolve(p); }
}

/** Two checkouts of ONE repository (git worktrees) share the common dir. */
function sameRepository(a, b) {
  const common = (dir) => {
    const c = git(['rev-parse', '--git-common-dir'], dir);
    return c ? realOrSelf(path.resolve(dir, c)) : null;
  };
  const ca = common(a);
  return ca !== null && ca === common(b);
}

function findDuplicateClaims(repoRoot, slug) {
  const self = realOrSelf(repoRoot);
  return codeRoots().flatMap(childDirs)
    .filter((dir) => realOrSelf(dir) !== self)
    .filter((dir) => readRoadmapProject(dir).project === slug)
    .filter((dir) => !sameRepository(dir, repoRoot));
}

// ---------- planning helpers ----------

function buildPlan(ctx) {
  const sets = { excludes: MIRROR_EXCLUDES };
  for (const s of SETS) sets[s] = ctx.sets.includes(s) ? SET_PATTERNS[s] : [];
  const plan = planMirror({ repoRoot: ctx.repoRoot, vaultRoot: ctx.vaultRoot, slug: ctx.slug, sets });
  return {
    ...plan,
    sets: ctx.sets,
    entries: plan.entries.filter((e) => ctx.sets.includes(e.set)),
    skipped: plan.skipped.filter((e) => ctx.sets.includes(e.set)),
  };
}

const vaultRel = (e) => `${e.set}/${e.rel}`;
const willPrune = (e, prune) => prune && e.action === 'extra' && !isConflictCopy(path.basename(e.dst));

function plannedList(plan, prune) {
  return plan.entries
    .filter((e) => e.action !== 'unchanged')
    .map((e) => ({ action: willPrune(e, prune) ? 'delete' : e.action, path: vaultRel(e) }));
}

function countPlan(plan, prune) {
  const n = (pred) => plan.entries.filter(pred).length;
  return {
    added: n((e) => e.action === 'add'),
    updated: n((e) => e.action === 'update'),
    unchanged: n((e) => e.action === 'unchanged'),
    extra: n((e) => e.action === 'extra'),
    pruned: n((e) => willPrune(e, prune)),
    skipped: plan.skipped.length,
  };
}

/** Prune boundary (FR-012): only a regular file whose real parent lies inside
 * the REAL project/<slug>/<set>/ folder, and never a conflict copy. The set
 * folder is resolved through the real project folder, so a set folder that is
 * itself a link out of the vault is refused too. */
function guardedUnlink(vaultRoot, slug) {
  const projectReal = realOrSelf(path.join(vaultRoot, 'project', slug));
  const roots = SETS.map((s) => path.join(projectReal, s));
  return (p) => {
    const parent = realOrSelf(path.dirname(p));
    const inside = roots.some((r) => isInside(parent, r));
    if (!inside || isConflictCopy(path.basename(p)) || !fs.lstatSync(p).isFile()) {
      throw new Error(`vault sync: refusing to delete ${p} (outside the mirror folders, a conflict copy or not a regular file)`);
    }
    fs.unlinkSync(p);
  };
}

// ---------- conflict copies (FR-014) ----------

/** Every conflict copy under project/<slug>/ (all subfolders), as paths
 * relative to that folder. Read-only; symlinks are not followed. */
function findConflictCopies(vaultRoot, slug) {
  const base = path.join(vaultRoot, 'project', assertSafeSegment(slug, 'slug'));
  const walk = (dir, prefix) => {
    let dirents;
    try { dirents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return []; }
    return dirents.flatMap((d) => {
      const rel = prefix ? `${prefix}/${d.name}` : d.name;
      if (d.isDirectory()) return walk(path.join(dir, d.name), rel);
      return d.isFile() && isConflictCopy(d.name) ? [rel] : [];
    });
  };
  return walk(base, '').sort();
}

function driftFindings(plan, conflicts) {
  const fromPlan = plan.entries
    .filter((e) => DRIFT_CLASS[e.action] && !(e.action === 'extra' && isConflictCopy(path.basename(e.dst))))
    .map((e) => ({ class: DRIFT_CLASS[e.action], path: vaultRel(e) }));
  const fromConflicts = conflicts.map((rel) => ({ class: 'conflict', path: rel }));
  return [...fromPlan, ...fromConflicts].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// ---------- shared context ----------

function resolveContext(parsed) {
  if (parsed.requested) assertSlug(parsed.requested, 'slug');
  const repoRoot = findRepoRoot();
  const vaultRoot = requireExternalRoot();
  const roadmap = readRoadmapProject(repoRoot);
  const slug = resolveSlug(parsed.requested, roadmap);
  const sets = selectSets(parsed.flags, roadmap.exists);
  return { repoRoot, vaultRoot, slug, sets };
}

function header(cmd, ctx) {
  return { command: `vault ${cmd}`, slug: ctx.slug, repo: ctx.repoRoot, vault_root: ctx.vaultRoot, sets: [...ctx.sets] };
}

// ---------- commands ----------

function runSync(args) {
  const parsed = parseArgs(args, SYNC_FLAGS, 'sync');
  const ctx = resolveContext(parsed);
  const dupes = findDuplicateClaims(ctx.repoRoot, ctx.slug);
  if (dupes.length > 0) {
    throw vaultError('input', `two repos claim project "${ctx.slug}": ${ctx.repoRoot} and ${dupes.join(', ')}`);
  }
  const dryRun = parsed.flags['dry-run'] === true;
  const prune = parsed.flags.prune === true;
  const gate = writerHostGate();
  const problem = gate.mayWrite ? rootProblem(ctx.vaultRoot, fs.constants.W_OK) : notWriterReason(gate);
  if (problem) {
    warnSkipped('vault mirror', problem);
    return { ...header('sync', ctx), status: 'skipped', reason: problem, dry_run: dryRun, prune };
  }
  const plan = buildPlan(ctx);
  const counts = dryRun
    ? countPlan(plan, prune)
    : applyWithGuard(plan, ctx, prune);
  return { ...header('sync', ctx), status: 'ok', dry_run: dryRun, prune, ...counts, planned: plannedList(plan, prune) };
}

function applyWithGuard(plan, ctx, prune) {
  try {
    return applyMirror(plan, { prune, fsOps: { unlinkSync: guardedUnlink(ctx.vaultRoot, ctx.slug) } });
  } catch (e) {
    throw vaultError('cannot_run', e.message);
  }
}

function runStatus(args) {
  const parsed = parseArgs(args, STATUS_FLAGS, 'status');
  const ctx = resolveContext(parsed);
  // FR-010: a configured root that is missing or unreadable is transient
  // (vault not mounted yet) — one warning, exit 0, never exit 2.
  const problem = rootProblem(ctx.vaultRoot, fs.constants.R_OK);
  if (problem) {
    warnSkipped('vault status', problem);
    return { json: parsed.flags.json === true, skipped: true, report: { ...header('status', ctx), status: 'skipped', reason: problem } };
  }
  const plan = buildPlan(ctx);
  const findings = driftFindings(plan, findConflictCopies(ctx.vaultRoot, ctx.slug));
  const count = (c) => findings.filter((f) => f.class === c).length;
  const gate = writerHostGate();
  return {
    json: parsed.flags.json === true,
    report: {
      ...header('status', ctx),
      host: gate.host,
      writer_host: gate.writerHost,
      may_write: gate.mayWrite,
      in_sync: plan.entries.filter((e) => e.action === 'unchanged').length,
      drift: findings.length,
      counts: { missing: count('missing'), stale: count('stale'), extra: count('extra'), conflict: count('conflict') },
      findings,
      skipped: plan.skipped.map((s) => ({ path: `${s.set}/${s.rel}`, reason: s.reason })),
    },
  };
}

/** `a1-tools vault sync [<slug>] [--product] [--phases] [--dry-run] [--prune] [--slug <s>] [--json]` */
function cmdVaultSync(args) {
  let report;
  try {
    report = runSync(args);
  } catch (e) {
    exitWith('sync', e);
  }
  emitJson(report, 0);
  process.exit(0);
}

/** `a1-tools vault status [<slug>] [--slug <s>] [--json]` */
function cmdVaultStatus(args) {
  let out;
  try {
    out = runStatus(args);
  } catch (e) {
    exitWith('status', e);
  }
  if (out.skipped) {
    if (out.json) emitJson(out.report, 0);
    process.exit(0);
  }
  const code = out.report.drift > 0 ? 1 : 0;
  if (out.json) {
    emitJson(out.report, code);
  } else {
    writeStdoutSync(out.report.findings.map((f) => `${f.class}  ${f.path}\n`).join(''));
    const r = out.report;
    process.stderr.write(`[a1-tools] vault status: ${r.drift} drift, ${r.in_sync} in sync\n`);
    process.stderr.write(`[a1-tools] vault writer: host ${r.host}, writer_host ${r.writer_host}, may_write ${r.may_write}\n`);
  }
  process.exit(code);
}

module.exports = { cmdVaultSync, cmdVaultStatus, findConflictCopies, resolveSlug };
