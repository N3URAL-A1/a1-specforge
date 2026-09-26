'use strict';

// ---------------------------------------------------------------------------
// vault-mirror — one-way, verbatim, atomic mirror of the product and phases
// sets into <vault>/project/<slug>/{product,phases}/ (spec
// 010-vault-cockpit-contract, Wave 2). LIBRARY ONLY: no CLI, no module-level
// state, no process.exit. Wave 3 (`vault sync` / `vault status`) and Wave 4
// (product transaction hook) call planMirror/applyMirror.
//
// Guarantees, each pinned by a fixture case in parts/02-mirror.sh:
//   FR-002/003  the sets come from vault-contract.cjs and nothing else;
//   FR-004      MIRROR_EXCLUDES apply by basename everywhere;
//   FR-005      every target segment passes assertSafeSegment; a failing
//               segment is SKIPPED with one stderr line, never aborts; apply
//               refuses (throws, before any write) a dst outside the two set
//               folders; the hub note is never touched;
//   FR-006      write <dst>.tmp.<pid>, then rename over <dst>; bytes verbatim.
// Immutability: inputs are never mutated; every return is a fresh object.
// ---------------------------------------------------------------------------

const realFs = require('fs');
const os = require('os');
const path = require('path');
const { assertSafeSegment, parseFrontmatter, tmpPathFor, assertAncestorInside } = require('./io.cjs');
const { PRODUCT_MIRROR_SET, PHASES_MIRROR_SET, MIRROR_EXCLUDES } = require('./vault-contract.cjs');

// Source base per set, and the source prefix that is DROPPED on the way into
// the vault set folder (FR-003: .a1/phases/<p>/X → phases/<p>/X, .a1/RESEARCH.md
// → phases/RESEARCH.md).
const SET_SOURCE_DIRS = Object.freeze({ product: ['docs', 'product'], phases: ['.a1'] });
const SET_STRIP_PREFIX = Object.freeze({ product: '', phases: 'phases/' });

/** Vault-relative path (inside the set folder) for a source-relative one. */
function targetRel(set, srcRel) {
  const strip = SET_STRIP_PREFIX[set];
  return strip && srcRel.startsWith(strip) ? srcRel.slice(strip.length) : srcRel;
}
const CONFLICT_COPY_RES = Object.freeze([/ \(conflict/i, /\.sync-conflict-/]);

// ---------- small pure helpers ----------

/** `*.lock*` → /^.*\.lock.*$/ — the only wildcard the exclude list uses. */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function isExcluded(rel, excludes) {
  const base = path.basename(rel);
  return excludes.some((g) => globToRegExp(g).test(base));
}

/** Obsidian/Dropbox/Syncthing conflict copies: reported as extra, never pruned. */
function isConflictCopy(basename) {
  return CONFLICT_COPY_RES.some((re) => re.test(basename));
}

function listDir(fs, dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return []; }
}

/** All files under `dir`, as rel paths (posix-joined with `prefix`).
 * `withLinks` (source side only): also every non-directory entry that is not
 * a regular file — a symlink, fifo, socket — so planSet can refuse it with a
 * stderr line instead of dropping it silently. Never descends into a link. */
function walkFiles(fs, dir, prefix, withLinks = false) {
  return listDir(fs, dir).flatMap((d) => {
    const rel = prefix ? `${prefix}/${d.name}` : d.name;
    if (d.isDirectory()) return walkFiles(fs, path.join(dir, d.name), rel, withLinks);
    return d.isFile() || withLinks ? [rel] : [];
  });
}

/** lstat-based existence: true for anything that is not a directory,
 * including a dangling symlink (so it is reported, not silently absent). */
function existsNonDir(fs, p) {
  try { return !fs.lstatSync(p).isDirectory(); } catch (_e) { return false; }
}

/** Expand one set pattern (segments: literal, `*` = one dir, `**` = subtree)
 * against `base`; returns the rel paths of EXISTING files, sorted. Absent
 * sources simply yield nothing (FR-003: missing files are skipped, no error). */
function expandPattern(fs, base, segments, prefix) {
  if (segments.length === 0) return existsNonDir(fs, base) ? [prefix] : [];
  const [head, ...tail] = segments;
  if (head === '**') return walkFiles(fs, base, prefix, true).sort();
  if (head === '*') {
    // a linked directory is expanded too — every file under it then fails the
    // realpath containment in planSet and is reported, never mirrored
    return listDir(fs, base).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name).sort()
      .flatMap((name) => expandPattern(fs, path.join(base, name), tail, prefix ? `${prefix}/${name}` : name));
  }
  return expandPattern(fs, path.join(base, head), tail, prefix ? `${prefix}/${head}` : head);
}

function readBytes(fs, p) {
  try { return fs.readFileSync(p); } catch (_e) { return null; }
}

/** Source bytes without following a final-component symlink (O_NOFOLLOW):
 * a source swapped for a link between plan and write fails with ELOOP
 * instead of carrying the link target into the vault. */
function readSourceNoFollow(src) {
  const fd = realFs.openSync(src, realFs.constants.O_RDONLY | realFs.constants.O_NOFOLLOW);
  try { return realFs.readFileSync(fd); } finally { realFs.closeSync(fd); }
}

function readSourceOrNull(src) {
  try { return readSourceNoFollow(src); } catch (_e) { return null; }
}

function setRoot(vaultRoot, slug, set) {
  return path.join(vaultRoot, 'project', assertSafeSegment(slug, 'slug'), set);
}

// ---------- planning ----------

/** dst for one rel path, or a skip record when a segment is unsafe. */
function targetFor(vaultRoot, slug, set, rel) {
  try {
    const segs = rel.split('/').map((s) => assertSafeSegment(s, 'mirror path segment'));
    return { dst: path.join(vaultRoot, 'project', assertSafeSegment(slug, 'slug'), set, ...segs) };
  } catch (e) {
    return { reason: e.message };
  }
}

function classify(fs, src, dst) {
  const a = readSourceOrNull(src);
  const b = readBytes(fs, dst);
  if (b === null) return 'add';
  return a !== null && a.equals(b) ? 'unchanged' : 'update';
}

// ---------- source guards (Wave 5, security review MAJOR 1) ----------
//
// Only regular files are mirrored. A source that is a symlink (or fifo,
// socket, …) is skipped with one stderr line, and so is every source whose
// realpath leaves realpath(<repo>)/docs/product resp. realpath(<repo>)/.a1 —
// which also refuses a linked intermediate folder. A set base that is itself
// a link out of the repo refuses the whole set (one line); a refused set
// reports no extras, so `--prune` can never delete the vault copy because
// the repo side was replaced by a link.

/** realpath(<repo>) joined with the set's source dirs; null if unresolvable. */
function realSourceBase(fs, repoRoot, set) {
  try { return path.join(fs.realpathSync(repoRoot), ...SET_SOURCE_DIRS[set]); } catch (_e) { return null; }
}

/** null when the set base is absent or real; else the refusal reason. */
function baseProblem(fs, base, realBase) {
  let real;
  try { real = fs.realpathSync(base); } catch (_e) { return null; }
  return realBase && real === realBase ? null : `source folder resolves outside the repo via a link: ${real}`;
}

/** null when `src` is a regular file inside `realBase`; else the reason. */
function sourceProblem(fs, src, realBase) {
  let st;
  try { st = fs.lstatSync(src); } catch (e) { return `source not readable (${e.code})`; }
  if (st.isSymbolicLink()) return 'source is a symbolic link';
  if (!st.isFile()) return 'source is not a regular file';
  let real;
  try { real = fs.realpathSync(src); } catch (e) { return `source not resolvable (${e.code})`; }
  return insideRoot(real, realBase) ? null : `source resolves outside the repo set folder via a link: ${real}`;
}

/** Entries for one set: whitelist ∖ excludes, with actions; skipped unsafe
 * segments and refused sources. `refused` marks a set whose base is a link. */
function planSet({ fs, repoRoot, vaultRoot, slug, set, patterns, excludes, warn }) {
  const base = path.join(repoRoot, ...SET_SOURCE_DIRS[set]);
  const realBase = realSourceBase(fs, repoRoot, set);
  const refusal = baseProblem(fs, base, realBase);
  if (refusal) {
    warn(`[a1-tools] vault mirror: skipped ${set}/ (${refusal})\n`);
    return { entries: [], skipped: [{ rel: '', set, reason: refusal }], refused: true };
  }
  const rels = [...new Set(patterns.flatMap((p) => expandPattern(fs, base, p.split('/'), '')))]
    .filter((rel) => !isExcluded(rel, excludes));
  const entries = [];
  const skipped = [];
  for (const srcRel of rels) {
    const rel = targetRel(set, srcRel);
    const src = path.join(base, srcRel);
    const t = targetFor(vaultRoot, slug, set, rel);
    const reason = t.reason || sourceProblem(fs, src, realBase);
    if (reason) {
      skipped.push({ rel, set, reason });
      warn(`[a1-tools] vault mirror: skipped ${set}/${rel} (${reason})\n`);
      continue;
    }
    entries.push({ rel, set, action: classify(fs, src, t.dst), src, dst: t.dst });
  }
  return { entries, skipped, refused: false };
}

/** Files under the vault set folder that no entry produces → `extra`. */
function extrasFor({ fs, vaultRoot, slug, set, planned }) {
  const root = setRoot(vaultRoot, slug, set);
  const known = new Set(planned.map((e) => e.dst));
  return walkFiles(fs, root, '').sort()
    .map((rel) => ({ rel, set, action: 'extra', src: null, dst: path.join(root, ...rel.split('/')) }))
    .filter((e) => !known.has(e.dst));
}

/**
 * planMirror({repoRoot, vaultRoot, slug, sets?, fs?, warn?}) → fresh
 * { repoRoot, vaultRoot, slug, entries: [{rel, set, action, src, dst}], skipped: [{rel, set, reason}] }.
 * Pure: reads only. `sets` defaults to the vault-contract lists.
 */
function planMirror(opts) {
  const fs = opts.fs || realFs;
  const warn = opts.warn || ((line) => process.stderr.write(line));
  const sets = opts.sets || { product: PRODUCT_MIRROR_SET, phases: PHASES_MIRROR_SET, excludes: MIRROR_EXCLUDES };
  const { repoRoot, vaultRoot, slug } = opts;
  if (!repoRoot || !vaultRoot || !slug) throw new Error('planMirror requires repoRoot, vaultRoot and slug');
  assertSafeSegment(slug, 'slug');
  const parts = ['product', 'phases'].map((set) => planSet({
    fs, repoRoot, vaultRoot, slug, set, patterns: sets[set], excludes: sets.excludes, warn,
  }));
  const planned = parts.flatMap((p) => p.entries);
  const extras = ['product', 'phases']
    .filter((set, i) => !parts[i].refused)
    .flatMap((set) => extrasFor({ fs, vaultRoot, slug, set, planned }));
  return {
    repoRoot, vaultRoot, slug,
    entries: [...planned, ...extras],
    skipped: parts.flatMap((p) => p.skipped),
  };
}

// ---------- applying ----------

const DEFAULT_OPS = Object.freeze({
  mkdirSync: (p, o) => realFs.mkdirSync(p, o),
  writeFileSync: (p, d, o) => realFs.writeFileSync(p, d, o),
  renameSync: (a, b) => realFs.renameSync(a, b),
  unlinkSync: (p) => realFs.unlinkSync(p),
});

function insideRoot(candidate, root) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/** Lexical containment for EVERY entry before any write (defence in depth). */
function assertPlanContained(plan) {
  const roots = { product: path.resolve(setRoot(plan.vaultRoot, plan.slug, 'product')), phases: path.resolve(setRoot(plan.vaultRoot, plan.slug, 'phases')) };
  for (const e of plan.entries) {
    if (!roots[e.set] || !insideRoot(path.resolve(e.dst), roots[e.set])) {
      throw new Error(`vault mirror: refusing target outside project/${plan.slug}/${e.set}/: ${e.dst}`);
    }
  }
}

/** Realpath containment of the (now existing) target dir — catches symlinks. */
/** The REAL set folder: the set name joined to the realpath of
 * project/<slug>/, never realpath(setRoot) — a set folder that is itself a
 * link out of the vault resolves elsewhere and would pass a comparison with
 * its own realpath. null while project/<slug>/ does not exist yet. */
function realSetRoot(vaultRoot, slug, set) {
  const projectDir = path.join(vaultRoot, 'project', assertSafeSegment(slug, 'slug'));
  try { return path.join(realFs.realpathSync(projectDir), set); } catch (_e) { return null; }
}

/** Before the first write: every EXISTING set folder must resolve to its real
 * set root. Throws, nothing written. */
function assertSetRootsReal(plan, sets) {
  for (const set of sets) {
    let real;
    try { real = realFs.realpathSync(setRoot(plan.vaultRoot, plan.slug, set)); } catch (_e) { continue; }
    if (real !== realSetRoot(plan.vaultRoot, plan.slug, set)) {
      throw new Error(`vault mirror: project/${plan.slug}/${set}/ resolves outside the project folder via a link: ${real}`);
    }
  }
}

/** realpath of the vault root; null when it cannot be resolved. */
function realVaultRoot(vaultRoot) {
  try { return realFs.realpathSync(vaultRoot); } catch (_e) { return null; }
}

function assertRealInside(dstDir, realRoot) {
  const real = realFs.realpathSync(dstDir);
  if (!realRoot || !insideRoot(real, realRoot)) throw new Error(`vault mirror: target dir escapes the set folder via a link: ${dstDir}`);
}

function writeAtomic(ops, entry, realRoot) {
  const dir = path.dirname(entry.dst);
  assertAncestorInside(dir, realRoot); // before mkdir: no folder created through a link
  ops.mkdirSync(dir, { recursive: true });
  assertRealInside(dir, realRoot);
  // random name + 'wx': a link planted at a guessable tmp name cannot catch the bytes
  const tmp = tmpPathFor(entry.dst);
  const bytes = readSourceNoFollow(entry.src);
  try {
    ops.writeFileSync(tmp, bytes, { flag: 'wx' });
    ops.renameSync(tmp, entry.dst);
  } catch (e) {
    try { ops.unlinkSync(tmp); } catch (_e) { /* tmp may not exist */ }
    throw e;
  }
}

/**
 * applyMirror(plan, {prune=false, fsOps}) → fresh counts
 * { added, updated, unchanged, extra, pruned, skipped }. Writes add/update
 * entries atomically; `extra` entries are left alone unless prune, and
 * conflict copies are never pruned.
 */
function applyMirror(plan, opts) {
  const o = opts || {};
  const ops = { ...DEFAULT_OPS, ...(o.fsOps || {}) };
  const prune = o.prune === true;
  assertPlanContained(plan);
  const touched = [...new Set([...(plan.sets || ['product', 'phases']), ...plan.entries.map((e) => e.set)])];
  assertSetRootsReal(plan, touched);
  // plan.sets (optional, Wave 3 `vault sync --product|--phases`) limits the
  // set folders created; a deselected set must not appear in the vault.
  const realVault = realVaultRoot(plan.vaultRoot);
  for (const set of plan.sets || ['product', 'phases']) {
    const root = setRoot(plan.vaultRoot, plan.slug, set);
    assertAncestorInside(root, realVault); // project/<slug> linked out of the vault → refused, nothing created
    ops.mkdirSync(root, { recursive: true });
  }
  const counts = { added: 0, updated: 0, unchanged: 0, extra: 0, pruned: 0, skipped: plan.skipped.length };
  for (const e of plan.entries) {
    if (e.action === 'add' || e.action === 'update') {
      writeAtomic(ops, e, realSetRoot(plan.vaultRoot, plan.slug, e.set));
      counts[e.action === 'add' ? 'added' : 'updated'] += 1;
    } else if (e.action === 'extra') {
      counts.extra += 1;
      if (prune && !isConflictCopy(path.basename(e.dst))) { ops.unlinkSync(e.dst); counts.pruned += 1; }
    } else {
      counts.unchanged += 1;
    }
  }
  return counts;
}

// ---------- single vault writer (Wave 5, FR-034 / FR-035) ----------
//
// Exactly one host writes the mirror: the one whose os.hostname() equals
// A1_VAULT_WRITER_HOST (exact string match after trimming — the value must be
// what `node -e 'console.log(require("os").hostname())'` prints there). Unset
// or empty → undeclared, every host may write (the pre-Wave-5 behaviour). A
// non-writer host skips with one stderr line; no exit code changes (Clarify
// 2026-09-24: tightening to exit 2 is reconsidered after four weeks without
// conflict copies). The gate only decides WHETHER to write; the realpath and
// segment guards decide WHERE, on every host.

const WRITER_HOST_ENV = 'A1_VAULT_WRITER_HOST';
const UNDECLARED_WRITER = 'undeclared';

/** writerHostGate(env?, host?) → fresh frozen { host, writerHost, mayWrite }. */
function writerHostGate(env = process.env, host = os.hostname()) {
  const raw = env[WRITER_HOST_ENV];
  const declared = typeof raw === 'string' ? raw.trim() : '';
  const writerHost = declared === '' ? UNDECLARED_WRITER : declared;
  return Object.freeze({ host, writerHost, mayWrite: declared === '' || declared === host });
}

/** The reason text after "vault mirror skipped: " for a non-writer host. */
function notWriterReason(gate) {
  return `this host is not the vault writer (${gate.host} ≠ ${gate.writerHost})`;
}

/** The non-writer skip every vault WRITE path shares (mirror hook, `vault
 * sync`, `vault lint --fix-type`, `vault link-hub`, the hub link of `spec
 * init`): null when this host may write; otherwise prints the one skip line
 * and returns the reason. Exit codes are the caller's and never change. */
function notWriterSkip(gate = writerHostGate()) {
  if (gate.mayWrite) return null;
  const reason = notWriterReason(gate);
  process.stderr.write(`[a1-tools] vault mirror skipped: ${reason}\n`);
  return reason;
}

// ---------- product transaction hook (Wave 4, FR-007 / FR-010) ----------
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

// Without a configured vault SC-002/FR-037 win over FR-007's "inactive" value
// (team-lead decision 2026-09-26): stdout stays byte-identical to the
// pre-feature release, so the hook returns undefined and JSON.stringify
// drops the `vault_mirror` key.
const EMIT_INACTIVE_RESULT = false;
const PRODUCT_DIR_TAIL = Object.freeze(['docs', 'product']);
const MAX_HOOK_SLUG_LENGTH = 100;

/** <repo> for <repo>/docs/product, else null (a free --dir has no repo set). */
function repoRootOfProductDir(dir) {
  const abs = path.resolve(dir);
  const [docs, product] = PRODUCT_DIR_TAIL;
  const parent = path.dirname(abs);
  return path.basename(abs) === product && path.basename(parent) === docs ? path.dirname(parent) : null;
}

/** null when the root is an existing writable directory, else the reason. */
function vaultRootProblem(root) {
  try {
    if (!realFs.statSync(root).isDirectory()) return `vault root is not a directory: ${root}`;
    realFs.accessSync(root, realFs.constants.W_OK);
    return null;
  } catch (e) {
    return e.code === 'ENOENT' ? `vault root does not exist: ${root}` : `vault root not accessible: ${root} (${e.code})`;
  }
}

/** The roadmap `project:` of the committed ROADMAP.md (FR-009), or throws. */
function committedSlug(dir) {
  const { project } = parseFrontmatter(realFs.readFileSync(path.join(dir, 'ROADMAP.md'), 'utf8')).fm;
  if (typeof project !== 'string' || project === '') throw new Error('ROADMAP.md has no frontmatter project:');
  if (project.length > MAX_HOOK_SLUG_LENGTH) throw new Error(`ROADMAP.md project: longer than ${MAX_HOOK_SLUG_LENGTH} characters`);
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
  const problem = vaultRootProblem(vaultRoot);
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

module.exports = {
  planMirror, applyMirror, isConflictCopy, isExcluded, expandPattern, productMirrorHook,
  writerHostGate, notWriterReason, notWriterSkip, UNDECLARED_WRITER,
};
