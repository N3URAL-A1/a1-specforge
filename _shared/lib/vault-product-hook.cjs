'use strict';

// ---------------------------------------------------------------------------
// vault-product-hook — the product transaction hook (spec
// 010-vault-cockpit-contract, Wave 4: FR-007 / FR-010), split out of
// vault-mirror.cjs.
//
// Every product-mutating command passes productMirrorHook(dir) as the
// `afterCommit` option of locks.writeAllOrNothing: it runs after the rename
// phase, before the lock is released, and its return value becomes the
// command's `vault_mirror` result key. It NEVER throws and never changes the
// exit code or the repo write; a failure is one stderr line per hook.
//
// Activation: only an explicit A1_VAULT_ROOT (tier env). Without it the hook
// touches nothing and prints nothing — no vaultRootInfo() call, because
// resolving the repo-local tier creates <repo>/.a1/learnings/ as a side effect.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { assertSafeSegment, parseFrontmatter } = require('./io.cjs');
const { planMirror, applyMirror } = require('./vault-mirror.cjs');
const { PRODUCT_MIRROR_SET, MIRROR_EXCLUDES } = require('./vault-contract.cjs');
const { MAX_SLUG_LENGTH, rootProblem, writerHostGate, notWriterReason } = require('./vault-common.cjs');

// Without a configured vault SC-002/FR-037 win over FR-007's "inactive" value
// (team-lead decision 2026-09-26): stdout stays byte-identical to the
// pre-feature release, so the hook returns undefined and JSON.stringify
// drops the `vault_mirror` key.
const EMIT_INACTIVE_RESULT = false;
const PRODUCT_DIR_TAIL = Object.freeze(['docs', 'product']);

/** <repo> for <repo>/docs/product, else null (a free --dir has no repo set). */
function repoRootOfProductDir(dir) {
  const abs = path.resolve(dir);
  const [docs, product] = PRODUCT_DIR_TAIL;
  const parent = path.dirname(abs);
  return path.basename(abs) === product && path.basename(parent) === docs ? path.dirname(parent) : null;
}

/** The roadmap `project:` of the committed ROADMAP.md (FR-009), or throws. */
function committedSlug(dir) {
  const { project } = parseFrontmatter(fs.readFileSync(path.join(dir, 'ROADMAP.md'), 'utf8')).fm;
  if (typeof project !== 'string' || project === '') throw new Error('ROADMAP.md has no frontmatter project:');
  if (project.length > MAX_SLUG_LENGTH) throw new Error(`ROADMAP.md project: longer than ${MAX_SLUG_LENGTH} characters`);
  return assertSafeSegment(project, 'ROADMAP.md project');
}

/** Mirror the product set of the repo owning `dir`. Returns a fresh result;
 * throws only for the caller to turn into `skipped`. */
function mirrorProductNow(dir) {
  const gate = writerHostGate();
  if (!gate.mayWrite) throw new Error(notWriterReason(gate));
  const repoRoot = repoRootOfProductDir(dir);
  if (!repoRoot) throw new Error(`product dir is not <repo>/docs/product: ${path.resolve(dir)}`);
  const vaultRoot = path.resolve(process.env.A1_VAULT_ROOT);
  const problem = rootProblem(vaultRoot, fs.constants.W_OK);
  if (problem) throw new Error(problem);
  const slug = committedSlug(dir);
  const plan = planMirror({ repoRoot, vaultRoot, slug, sets: { product: PRODUCT_MIRROR_SET, phases: [], excludes: MIRROR_EXCLUDES } });
  const productOnly = { ...plan, sets: ['product'], entries: plan.entries.filter((e) => e.set === 'product') };
  const counts = applyMirror(productOnly);
  return { status: 'ok', files: counts.added + counts.updated };
}

/**
 * productMirrorHook(dir) → { afterCommit } for writeAllOrNothing. One closure
 * per command invocation: the skipped line is printed at most once for it,
 * however often afterCommit runs (FR-010).
 */
function productMirrorHook(dir) {
  let warned = false;
  const afterCommit = () => {
    if (!process.env.A1_VAULT_ROOT) return EMIT_INACTIVE_RESULT ? { status: 'inactive', files: 0 } : undefined;
    try {
      return mirrorProductNow(dir);
    } catch (e) {
      if (!warned) process.stderr.write(`[a1-tools] vault mirror skipped: ${e.message}\n`);
      warned = true;
      return { status: 'skipped', files: 0, reason: e.message };
    }
  };
  return Object.freeze({ afterCommit });
}

module.exports = { productMirrorHook };
