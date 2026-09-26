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
const path = require('path');
const { assertSafeSegment } = require('./io.cjs');
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

function isFile(fs, p) {
  try { return fs.statSync(p).isFile(); } catch (_e) { return false; }
}

/** All files under `dir`, as rel paths (posix-joined with `prefix`). */
function walkFiles(fs, dir, prefix) {
  return listDir(fs, dir).flatMap((d) => {
    const rel = prefix ? `${prefix}/${d.name}` : d.name;
    if (d.isDirectory()) return walkFiles(fs, path.join(dir, d.name), rel);
    return d.isFile() ? [rel] : [];
  });
}

/** Expand one set pattern (segments: literal, `*` = one dir, `**` = subtree)
 * against `base`; returns the rel paths of EXISTING files, sorted. Absent
 * sources simply yield nothing (FR-003: missing files are skipped, no error). */
function expandPattern(fs, base, segments, prefix) {
  if (segments.length === 0) return isFile(fs, base) ? [prefix] : [];
  const [head, ...tail] = segments;
  if (head === '**') return walkFiles(fs, base, prefix).sort();
  if (head === '*') {
    return listDir(fs, base).filter((d) => d.isDirectory()).map((d) => d.name).sort()
      .flatMap((name) => expandPattern(fs, path.join(base, name), tail, prefix ? `${prefix}/${name}` : name));
  }
  return expandPattern(fs, path.join(base, head), tail, prefix ? `${prefix}/${head}` : head);
}

function readBytes(fs, p) {
  try { return fs.readFileSync(p); } catch (_e) { return null; }
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
  const a = readBytes(fs, src);
  const b = readBytes(fs, dst);
  if (b === null) return 'add';
  return a !== null && a.equals(b) ? 'unchanged' : 'update';
}

/** Entries for one set: whitelist ∖ excludes, with actions; skipped unsafe segments. */
function planSet({ fs, repoRoot, vaultRoot, slug, set, patterns, excludes, warn }) {
  const base = path.join(repoRoot, ...SET_SOURCE_DIRS[set]);
  const rels = [...new Set(patterns.flatMap((p) => expandPattern(fs, base, p.split('/'), '')))]
    .filter((rel) => !isExcluded(rel, excludes));
  const entries = [];
  const skipped = [];
  for (const srcRel of rels) {
    const rel = targetRel(set, srcRel);
    const t = targetFor(vaultRoot, slug, set, rel);
    if (t.reason) {
      skipped.push({ rel, set, reason: t.reason });
      warn(`[a1-tools] vault mirror: skipped ${set}/${rel} (${t.reason})\n`);
      continue;
    }
    const src = path.join(base, srcRel);
    entries.push({ rel, set, action: classify(fs, src, t.dst), src, dst: t.dst });
  }
  return { entries, skipped };
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
  const extras = ['product', 'phases'].flatMap((set) => extrasFor({ fs, vaultRoot, slug, set, planned }));
  return {
    repoRoot, vaultRoot, slug,
    entries: [...planned, ...extras],
    skipped: parts.flatMap((p) => p.skipped),
  };
}

// ---------- applying ----------

const DEFAULT_OPS = Object.freeze({
  mkdirSync: (p, o) => realFs.mkdirSync(p, o),
  writeFileSync: (p, d) => realFs.writeFileSync(p, d),
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

function assertRealInside(dstDir, realRoot) {
  const real = realFs.realpathSync(dstDir);
  if (!realRoot || !insideRoot(real, realRoot)) throw new Error(`vault mirror: target dir escapes the set folder via a link: ${dstDir}`);
}

function writeAtomic(ops, entry, realRoot) {
  const dir = path.dirname(entry.dst);
  ops.mkdirSync(dir, { recursive: true });
  assertRealInside(dir, realRoot);
  const tmp = `${entry.dst}.tmp.${process.pid}`;
  const bytes = realFs.readFileSync(entry.src);
  try {
    ops.writeFileSync(tmp, bytes);
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
  for (const set of plan.sets || ['product', 'phases']) ops.mkdirSync(setRoot(plan.vaultRoot, plan.slug, set), { recursive: true });
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

module.exports = { planMirror, applyMirror, isConflictCopy, isExcluded, expandPattern };
