'use strict';

// ---------------------------------------------------------------------------
// xprov-artifacts — where runner artifacts live, and when they die
// (spec 009-cross-provider-review-gate, Wave 3; FR-020).
//
//   ensureArtifactsDir(slug?) → absolute path of ~/.a1-xprov/artifacts/<slug>/
//     Created 0700 (mkdirSync with mode, then chmodSync to defeat the umask —
//     the runner's own `root.mkdir()` would otherwise leave a 0755 root, see
//     VENDORED.md). Refuses with a typed error (code A1_INPUT, reason
//     artifacts_inside_checkout_or_vault) when the resolved path is the
//     primary checkout, lies inside it, or lies under $A1_VAULT_ROOT. The
//     default slug is basename(repoRoot()) through assertSafeSegment.
//
//   gc({ now, maxAgeDays, root }) → { root, removed: [...], kept: [...] }
//     Removes run directories (the runner's `claudex-*` dirs) whose mtime is
//     older than now - maxAgeDays; anything not named `claudex-*` is left
//     alone. Exposed as `a1-tools xprov gc` and called by normalize at the end
//     of every real run.
//
// Retention model (decided 2026-09-24, Samuel's Wave 1 review): the runner
// never deletes anything — prompt.txt, stdout.txt and reply.txt stay behind
// even after an early failure. a1 owns retention in two layers: `xprov run`
// (Wave 5) removes a run's directory on every fail/<reason> EXCEPT
// secret_in_output (the user must be able to inspect what leaked), and this
// module's 14-day gc sweeps whatever remains — passes, reviewed failures and
// runs whose caller died before cleanup.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { repoRoot, assertSafeSegment, parseFlags } = require('./io.cjs');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
// Shared helpers — one definition each, in xprov-common.cjs (mkdir0700's typed
// errors are the generic path_is_file / path_too_long reasons).
const { mkdir0700 } = C;

const RUN_DIR_PREFIX = 'claudex-';
const SNAPSHOT_PREFIX = 'snap-'; // xprov-snapshot.cjs' SNAP_PREFIX (not imported: snapshot requires this module)
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const REASON_INSIDE = 'artifacts_inside_checkout_or_vault';

function repoSlug() {
  return assertSafeSegment(path.basename(repoRoot()), 'repo slug');
}

/** realpath of `p` even when its tail does not exist yet: resolve the deepest
 * existing ancestor and re-append the rest. Needed because git reports the
 * checkout as /private/var/… on macOS while $HOME may say /var/… . */
function realpathBestEffort(p) {
  let head = path.resolve(p);
  const tail = [];
  while (!fs.existsSync(head)) {
    tail.unshift(path.basename(head));
    const up = path.dirname(head);
    if (up === head) return path.resolve(p);
    head = up;
  }
  return path.join(fs.realpathSync(head), ...tail);
}

/** True when `child` equals `parent` or lies below it (both realpath'd). */
function isUnder(child, parent) {
  const rel = path.relative(realpathBestEffort(parent), realpathBestEffort(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function forbiddenRoots() {
  const roots = [repoRoot()];
  const vault = process.env.A1_VAULT_ROOT;
  if (vault && vault.trim() !== '') roots.push(vault);
  return roots;
}

/** The one rule for every artifacts path a1 touches: under ~/.a1-xprov/artifacts/,
 * never under the checkout or the vault. Applied to ensureArtifactsDir() and to
 * gc()'s `root` alike. */
function assertArtifactsRoot(dir) {
  for (const root of forbiddenRoots()) {
    if (isUnder(dir, root)) {
      throw C.inputError(`artifacts dir ${dir} would lie under ${root}; runner artifacts must never sit inside a checkout or the vault`, REASON_INSIDE);
    }
  }
  if (!isUnder(dir, path.join(X.xprovHome(), 'artifacts'))) {
    throw C.inputError(`${dir} is not under ${path.join(X.xprovHome(), 'artifacts')}`, 'artifacts_outside_xprov_home');
  }
  return dir;
}

function ensureArtifactsDir(slug) {
  const safeSlug = slug === undefined ? repoSlug() : assertSafeSegment(slug, 'artifacts slug');
  const dir = assertArtifactsRoot(path.resolve(X.artifactsDir(safeSlug)));
  mkdir0700(X.xprovHome());
  mkdir0700(path.dirname(dir));
  mkdir0700(dir);
  return dir;
}

/** Remove `claudex-*` run dirs older than the cutoff. Pure over its inputs
 * except for the removals; returns new arrays, never touches other entries.
 * `opts.root` is INTERNAL-ONLY (tests and the run module); it is not a CLI
 * flag and still has to pass assertArtifactsRoot() — gc can never be pointed
 * at a checkout, the vault or anything outside ~/.a1-xprov/artifacts/. */
function gc(opts) {
  const o = opts || {};
  const now = typeof o.now === 'number' ? o.now : Date.now();
  const maxAgeDays = typeof o.maxAgeDays === 'number' ? o.maxAgeDays : X.ARTIFACT_MAX_AGE_DAYS;
  const root = assertArtifactsRoot(path.resolve(o.root || X.artifactsDir(o.slug === undefined ? repoSlug() : assertSafeSegment(o.slug, 'artifacts slug'))));
  const cutoff = now - maxAgeDays * MS_PER_DAY;
  const runs = sweepDirs(root, RUN_DIR_PREFIX, cutoff);
  // Orphaned snapshots (Reinhard PR review): a gate process killed between
  // `snapshot` and its cleanup leaves the clone forever — same age rule.
  const snaps = sweepDirs(path.resolve(X.snapshotsDir()), SNAPSHOT_PREFIX, cutoff);
  return { root, removed: runs.removed, kept: runs.kept, snapshots_root: snaps.root, snapshots_removed: snaps.removed, snapshots_kept: snaps.kept };
}

/** Remove `<prefix>*` directories under `dir` whose mtime is older than cutoff. */
function sweepDirs(dir, prefix, cutoff) {
  const out = { root: dir, removed: [], kept: [] };
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(prefix)) continue;
    const full = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(full); } catch (_e) { continue; }
    if (!st.isDirectory()) continue;
    if (st.mtimeMs < cutoff) { fs.rmSync(full, { recursive: true, force: true }); out.removed.push(full); } else out.kept.push(full);
  }
  return out;
}

// ---------- CLI: a1-tools xprov gc [--slug <slug>] [--max-age-days N] ----------

function cmdXprovGc(args) {
  const flags = parseFlags(args, { slug: 'str', 'max-age-days': 'str' });
  if (flags._.length) {
    return C.usageExit('gc', `takes no positional arguments (got ${JSON.stringify(String(flags._[0]).slice(0, 80))})`);
  }
  let maxAgeDays = X.ARTIFACT_MAX_AGE_DAYS;
  if (flags['max-age-days'] !== undefined) {
    if (!/^\d+$/.test(String(flags['max-age-days']))) {
      return C.usageExit('gc', '--max-age-days must be a non-negative integer');
    }
    maxAgeDays = Number(flags['max-age-days']);
  }
  const result = gc({ now: Date.now(), maxAgeDays, slug: flags.slug }); // a hostile --slug throws A1_INPUT → facade exit 2
  process.stderr.write(`xprov gc: removed ${result.removed.length}, kept ${result.kept.length} under ${result.root}; snapshots removed ${result.snapshots_removed.length}, kept ${result.snapshots_kept.length}\n`);
  return C.emitJson(result, X.EXIT_PASS);
}

module.exports = { ensureArtifactsDir, gc, cmdXprovGc, repoSlug, isUnder, REASON_INSIDE };
