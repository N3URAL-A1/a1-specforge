'use strict';

// Read side of docs/product/: ROADMAP.md / feature.md readers and the
// derived index.json + NEXT.md generation (regenerateDerived). No writes.

const fs = require('fs');
const path = require('path');
const { parseNestedFrontmatter, nowIso } = require('./io.cjs');
const { parseInlineFlowObject, PRODUCT_SLUG_RE } = require('./product-schema.cjs');
const mods = require('./product-modules.cjs');

function readProductRoadmap(dir) {
  const file = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, 'utf8');
  const parsed = parseNestedFrontmatter(content);
  return { file, content, ...parsed };
}

function readProductFeature(dir, id) {
  const file = path.join(dir, 'features', id, 'feature.md');
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, 'utf8');
  const parsed = parseNestedFrontmatter(content);
  return { file, content, ...parsed };
}

/** Build the set of known ROADMAP.md feature ids from an already-parsed
 * roadmap frontmatter object (FR-018/FR-011). Shared by the `product
 * validate` read-time cross-check (Wave 2) and the `audit-set --feature`
 * write-time guard (Wave 4) — one source of truth for "does this feature id
 * exist", per the Wave 4 brief's "reuse the Wave 2 helper" instruction. Pure. */
function roadmapFeatureIdSet(roadmapFm) {
  return new Set(
    (Array.isArray(roadmapFm.features) ? roadmapFm.features : [])
      .map((f) => f.id)
      .filter((id) => typeof id === 'string')
  );
}

/** Read `docs/product/VISION.md` (if present) and return the `vision` block
 * for `index.json` (FR-014): `{ path, updated, pillars }` mirrored from
 * frontmatter, or `null` when the file is absent. Pure read, no writes.
 * Deliberately tolerant of a still-invalid VISION.md (e.g. mid-edit) — index
 * regeneration must not throw; `product validate` is the place that enforces
 * the pillars-non-empty rule (FR-001), not this derivation.
 *
 * `fmOverride` (optional): when a caller is mutating VISION.md's frontmatter
 * IN THE SAME transaction (`vision-init`/`vision-touch`, Wave 3), the file on
 * disk is still the OLD content at the point `regenerateDerived` runs (the
 * write only lands after `writeAllOrNothing`'s tmp/rename phase). Passing the
 * already-updated in-memory frontmatter here avoids index.json reflecting a
 * stale `vision` block for one command's own write — the same reason
 * `roadmapFm` itself is passed as an argument rather than re-read from disk. */
function readVisionBlock(productDir, fmOverride) {
  if (fmOverride !== undefined) {
    const fm = fmOverride;
    return {
      path: 'docs/product/VISION.md',
      updated: fm.updated !== undefined ? fm.updated : null,
      pillars: Array.isArray(fm.pillars)
        ? fm.pillars.map((p) => ({ id: p.id, title: p.title, summary: p.summary }))
        : [],
    };
  }
  const visionFile = path.join(productDir, 'VISION.md');
  if (!fs.existsSync(visionFile)) return null;
  const content = fs.readFileSync(visionFile, 'utf8');
  const { fm } = parseNestedFrontmatter(content);
  return {
    path: 'docs/product/VISION.md',
    updated: fm.updated !== undefined ? fm.updated : null,
    pillars: Array.isArray(fm.pillars)
      ? fm.pillars.map((p) => ({ id: p.id, title: p.title, summary: p.summary }))
      : [],
  };
}

/** Build one `audits[]` entry (the derived shape index.json exposes, FR-015)
 * from an already-parsed audit frontmatter object + its filename. Pure. Split
 * out of readAuditsBlock so both the on-disk read path AND an in-memory
 * override (auditFmOverride below) can share the exact same derivation. */
function auditFmToIndexEntry(name, fm) {
  const findings = Array.isArray(fm.findings) ? fm.findings : [];
  const open = findings.filter((f) => f.status === 'open').length;
  const fixed = findings.filter((f) => f.status === 'fixed').length;
  const counts = parseInlineFlowObject(fm.counts) || fm.counts || { blocker: 0, major: 0, minor: 0 };

  return {
    path: `docs/product/audits/${name}`,
    date: fm.date !== undefined ? fm.date : null,
    focus: fm.focus !== undefined ? fm.focus : null,
    verdict: fm.verdict !== undefined ? fm.verdict : null,
    counts: {
      blocker: typeof counts.blocker === 'number' ? counts.blocker : 0,
      major: typeof counts.major === 'number' ? counts.major : 0,
      minor: typeof counts.minor === 'number' ? counts.minor : 0,
    },
    open,
    fixed,
    last_validated: fm.last_validated !== undefined ? fm.last_validated : null,
  };
}

/** Read every `docs/product/audits/*.md` file (if the directory exists) and
 * return the `audits[]` array for `index.json` (FR-015): one entry per file
 * with `path`/`date`/`focus`/`verdict`/`counts`/derived `open`+`fixed`
 * (computed from `findings[].status` — only `open` and `fixed` count toward
 * this derived split; `obsolete`/`accepted` findings are excluded from both,
 * per the spec's index.json shape)/`last_validated`. Returns `[]` when the
 * directory is absent or empty. Sorted by filename (= date+focus) for a
 * deterministic, diffable index.json. Pure read, no writes.
 *
 * `auditFmOverride` (optional, Wave 4): `{ name, fm }` for ONE audit file a
 * caller is mutating IN THE SAME transaction (`audit-publish`'s new file,
 * `audit-set`'s targeted-replace) — the file on disk is still in its PRIOR
 * state at the point `regenerateDerived` runs (the write only lands after
 * `writeAllOrNothing`'s tmp/rename phase), same reasoning as
 * `readVisionBlock`'s `fmOverride` parameter (Wave 3). Without this, an
 * `audit-set` call's own index.json regeneration would reflect the finding's
 * PREVIOUS status/counts, one call behind reality. When `name` matches an
 * on-disk file, the override REPLACES that entry; when it doesn't (a brand
 * new file from `audit-publish`), the override is APPENDED, keeping the
 * same sorted-by-filename order the on-disk read already produces. */
function readAuditsBlock(productDir, auditFmOverride) {
  const auditsDir = path.join(productDir, 'audits');
  const files = fs.existsSync(auditsDir)
    ? fs.readdirSync(auditsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort()
    : [];

  const entries = files.map((name) => {
    if (auditFmOverride && auditFmOverride.name === name) {
      return auditFmToIndexEntry(name, auditFmOverride.fm);
    }
    const auditFile = path.join(auditsDir, name);
    const content = fs.readFileSync(auditFile, 'utf8');
    const { fm } = parseNestedFrontmatter(content);
    return auditFmToIndexEntry(name, fm);
  });

  if (auditFmOverride && !files.includes(auditFmOverride.name)) {
    entries.push(auditFmToIndexEntry(auditFmOverride.name, auditFmOverride.fm));
    entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  return entries;
}


const MODULES_DIR = 'modules';
const GENERATED_FILE_NAMES = ['ROADMAP.md', 'NEXT.md'];
const PREFIX_SLACK_BYTES = 2;

/** Resolve `target` and require it to sit under the resolved `productDir`
 * (a symlink anywhere in the chain pointing outside is refused). Returns an
 * error text or null. */
function outsideProductDir(productDir, target) {
  const base = fs.realpathSync(productDir);
  const real = fs.realpathSync(target);
  return real === base || real.startsWith(base + path.sep)
    ? null
    : `${path.relative(productDir, target) || target} resolves outside the product directory (${real}) — nothing was written`;
}

/** lstat-based guard for a directory the generator would read or write
 * through: must be a real directory (no symlink, no file) inside productDir.
 * Always lstats the exact path given, never a directory listing, so a
 * case-insensitive filesystem cannot route it through a differently spelled
 * symlink. Returns an error text, or null when fine or absent. */
function unsafeDirError(productDir, dir) {
  const rel = path.relative(productDir, dir);
  let st;
  try { st = fs.lstatSync(dir); } catch (e) {
    return e.code === 'ENOENT' ? null : `cannot inspect ${rel}: ${e.message} — nothing was written`;
  }
  if (st.isSymbolicLink()) return `${rel} is a symbolic link — refusing to follow it; replace it by a real directory; nothing was written`;
  if (!st.isDirectory()) return `${rel} is not a directory — move it away; nothing was written`;
  return outsideProductDir(productDir, dir);
}

/** True when `candidate` is the very same directory as `dir` (same inode). */
function sameDir(candidate, dir) {
  try {
    const a = fs.statSync(candidate);
    const b = fs.statSync(dir);
    return a.ino === b.ino && a.dev === b.dev;
  } catch (_e) { return false; }
}

/** First `maxBytes` of a file as text, or null when it cannot be read. */
function readPrefix(file, maxBytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(maxBytes);
    const n = fs.readSync(fd, buf, 0, maxBytes, 0);
    return buf.toString('utf8', 0, n);
  } catch (_e) { return null; } finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch (_e2) { /* nothing to do */ } } }
}

/** Is `child` (a Dirent of stale module dir `name`) a file the generator wrote?
 * Name first, then only the prefix needed for the header check. A read error
 * makes it foreign (false), never an abort. */
function isOurGeneratedFile(dir, child, name) {
  if (!GENERATED_FILE_NAMES.includes(child.name) || !child.isFile()) return false;
  const head = `${mods.moduleFileTitle(child.name, name)}\n\n${mods.GENERATED_HEADER}\n`;
  const prefix = readPrefix(path.join(dir, child.name), Buffer.byteLength(head) + PREFIX_SLACK_BYTES);
  return prefix !== null && mods.isGeneratedModuleFile(child.name, name, prefix);
}

/** Plan the cleanup of ONE stale module dir (on disk, not in use). Only the
 * generator's own ROADMAP.md / NEXT.md go (content check); anything else is
 * foreign and stays — the dir is removed only when nothing foreign is left.
 * An unreadable dir counts as foreign. Returns { deletes, warnings, kept }. */
function planStaleDir(productDir, root, name) {
  const dir = path.join(root, name);
  const deletes = [];
  const warnings = [];
  let children;
  try {
    children = fs.readdirSync(dir, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name));
  } catch (e) {
    return { deletes, warnings: [`left in place (cannot read): ${path.relative(productDir, dir)}`], kept: true };
  }
  let kept = false;
  for (const c of children) {
    const file = path.join(dir, c.name);
    if (isOurGeneratedFile(dir, c, name)) { deletes.push({ target: file, delete: true }); continue; }
    kept = true;
    warnings.push(`left in place (not generated by a1-tools): ${path.relative(productDir, file)}`);
  }
  if (!kept) deletes.push({ target: dir, rmdir: true });
  return { deletes, warnings, kept };
}

/** Guard every in-use module id on the exact path the writer will use,
 * independent of the directory listing, plus case collisions: an entry whose
 * lowercase name equals an in-use id but is spelled differently must be the
 * same directory (case-insensitive filesystem), else it is a collision.
 * Returns an error text or null. */
function inUseModuleError(productDir, root, inUse, names) {
  for (const id of inUse) {
    const err = unsafeDirError(productDir, path.join(root, id));
    if (err) return err;
  }
  for (const n of names) {
    const id = inUse.find((u) => u !== n && u === n.toLowerCase());
    if (id !== undefined && !sameDir(path.join(root, n), path.join(root, id))) {
      return `${MODULES_DIR}/${n} collides with module ${JSON.stringify(id)} on a case-insensitive filesystem — rename or remove it; nothing was written`;
    }
  }
  return null;
}

/** Walk `modules/`: classify every entry (in use / case variant of an in-use
 * dir / stale / foreign). With no module in use everything foreign stays
 * silently; with modules in use it is reported once per entry. */
function planModulesRoot(productDir, root, inUse) {
  const withModules = inUse.length > 0;
  const entries = fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const err = inUseModuleError(productDir, root, inUse, entries.map((e) => e.name));
  if (err) return { error: err };
  const moduleDeletes = [];
  const moduleWarnings = [];
  let kept = false;
  const foreign = (sub, why) => {
    kept = true;
    if (withModules) moduleWarnings.push(`left in place (${why}): ${path.relative(productDir, sub)}`);
  };
  for (const entry of entries) {
    const sub = path.join(root, entry.name);
    if (inUse.includes(entry.name) || inUse.includes(entry.name.toLowerCase())) { kept = true; continue; }
    if (!entry.isDirectory() || !PRODUCT_SLUG_RE.test(entry.name)) {
      foreign(sub, entry.isSymbolicLink() ? 'symbolic link, not followed' : 'not a module directory');
      continue;
    }
    const plan = planStaleDir(productDir, root, entry.name);
    moduleDeletes.push(...plan.deletes);
    if (withModules) moduleWarnings.push(...plan.warnings);
    kept = kept || plan.kept;
  }
  if (!kept && !withModules) moduleDeletes.push({ target: root, rmdir: true });
  return { moduleDeletes, moduleWarnings };
}

/** `modules/` itself: 'absent' | 'real' | an error text for a symlink/non-dir. */
function modulesRootState(productDir, root) {
  const err = unsafeDirError(productDir, root);
  if (err) return { err };
  return { state: fs.existsSync(root) ? 'real' : 'absent' };
}

/** Module files to write and stale module paths to delete (spec 023 FR-006,
 * FR-007, FR-013). Reads the existing `modules/` listing only.
 * Module in use: `modules/` and every in-use module dir (checked by lstat on
 * the exact write path) must be real directories under `productDir`, and no
 * differently spelled entry may collide with one — otherwise `error` (caller
 * aborts, nothing is written). Foreign or unreadable entries are kept and
 * reported in `warnings`.
 * No module in use: never an error (FR-005). A symlinked / non-directory
 * `modules/` gets one warning and is skipped; in a real `modules/` only the
 * generated files of stale slug dirs are deleted, everything else stays,
 * silently. `modules/` goes only when empty. Any fs failure is returned as
 * `error` (module in use) or skipped with a warning, never thrown. */
function deriveModuleOutputs(productDir, roadmapFm, features, milestones, today) {
  const fail = (error) => ({ moduleFiles: [], moduleDeletes: [], warnings: [], error });
  const inUse = mods.modulesInUse(roadmapFm);
  const moduleFiles = [];
  for (const id of inUse) {
    if (!PRODUCT_SLUG_RE.test(id)) return fail(`module id ${JSON.stringify(id)} is not a kebab-case slug`);
    moduleFiles.push(
      { rel: `${MODULES_DIR}/${id}/ROADMAP.md`, content: mods.renderModuleRoadmap(id, milestones, features, today) },
      { rel: `${MODULES_DIR}/${id}/NEXT.md`, content: mods.renderModuleNext(id, { features, milestones }, today) }
    );
  }
  const root = path.join(productDir, MODULES_DIR);
  const skip = (msg) => ({ moduleFiles, moduleDeletes: [], warnings: [msg], error: null });
  try {
    const { err, state } = modulesRootState(productDir, root);
    if (err) return inUse.length > 0 ? fail(err) : skip(`${MODULES_DIR}/ skipped: ${err.replace(/ — nothing was written$/, '').replace(/; nothing was written$/, '')}`);
    if (state === 'absent') return { moduleFiles, moduleDeletes: [], warnings: [], error: null };
    const plan = planModulesRoot(productDir, root, inUse);
    if (plan.error) return fail(plan.error);
    return { moduleFiles, moduleDeletes: plan.moduleDeletes, warnings: plan.moduleWarnings, error: null };
  } catch (e) {
    return inUse.length > 0 ? fail(`cannot read ${MODULES_DIR}/: ${e.message} — nothing was written`) : skip(`${MODULES_DIR}/ skipped: cannot read: ${e.message}`);
  }
}


/** Side-effect-free (reads only, never writes): compute the derived outputs
 * from the ROADMAP frontmatter (source of truth) and productDir (read for
 * spec_path/plan_path from feature.md and for the existing `modules/` listing).
 * Returns { indexJson, nextMd, moduleFiles, moduleDeletes, moduleWarnings,
 * moduleError } — the module keys are consumed by product-txn.derivedWrites. `auditFmOverride` (Wave 4,
 * optional): see readAuditsBlock's own doc comment — passed through
 * unchanged so audit-publish/audit-set's OWN in-flight write is reflected in
 * the index.json this same call regenerates. */
function regenerateDerived(productDir, roadmapFm, visionFmOverride, auditFmOverride) {
  const milestones = Array.isArray(roadmapFm.milestones) ? roadmapFm.milestones : [];
  const featuresIn = Array.isArray(roadmapFm.features) ? roadmapFm.features : [];

  const features = featuresIn.map((f) => {
    let spec_path = f.spec_path !== undefined ? f.spec_path : null;
    let plan_path = f.plan_path !== undefined ? f.plan_path : null;
    const featureMd = readProductFeature(productDir, f.id);
    if (featureMd) {
      if ((spec_path === null || spec_path === undefined) && featureMd.fm.spec_path) {
        spec_path = featureMd.fm.spec_path;
      }
      if ((plan_path === null || plan_path === undefined) && featureMd.fm.plan_path) {
        plan_path = featureMd.fm.plan_path;
      }
    }
    return {
      id: f.id,
      milestone: f.milestone,
      title: f.title,
      status: f.status,
      stage: f.stage !== undefined ? f.stage : null,
      depends_on: Array.isArray(f.depends_on) ? f.depends_on : [],
      started: f.started !== undefined ? f.started : null,
      finished: f.finished !== undefined ? f.finished : null,
      spec_path: spec_path !== undefined ? spec_path : null,
      plan_path: plan_path !== undefined ? plan_path : null,
    };
  });

  // cursor: first not-yet-done/cancelled feature (array order) whose
  // depends_on are all 'done' among sibling features; null if none qualify.
  const cursor = mods.firstEligible(features, mods.statusMap(features));

  const modulesSummary = mods.modulesSummary(roadmapFm, features);
  const modulesActive = modulesSummary !== null;

  const indexJson = {
    schema_version: 1,
    generated: nowIso(),
    project: {
      id: roadmapFm.project,
      title: roadmapFm.title,
      status: roadmapFm.status,
    },
    milestones: milestones.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      target: m.target !== undefined ? m.target : null,
      // Spec 023 FR-011: `module` only when a module is in use (never absent-as-null noise).
      ...(modulesActive ? { module: mods.moduleOfMilestone(m) } : {}),
    })),
    features,
    next: roadmapFm.next !== undefined ? roadmapFm.next : null,
    cursor,
    // Schema v1.1 additions (spec 003-product-schema-v1.1-vision-audits,
    // Wave 2, FR-014/FR-015): both degrade gracefully (null / []) when the
    // corresponding optional file/directory is absent — see readVisionBlock/
    // readAuditsBlock above and index.schema.json's optional-property
    // extension (FR-016) for the byte-identical-when-absent contract.
    vision: readVisionBlock(productDir, visionFmOverride),
    audits: readAuditsBlock(productDir, auditFmOverride),
    // Schema v1.2 (spec 023 FR-011): present only when a module is in use.
    ...(modulesActive ? { modules: modulesSummary } : {}),
  };

  const milestonesInProgress = milestones.filter((m) => m.status === 'in-progress');
  const today = nowIso().slice(0, 10);

  const nextMdLines = [
    '# NEXT.md',
    '',
    mods.GENERATED_HEADER,
    '',
    `# ${roadmapFm.title || roadmapFm.project || 'Project'}`,
    '',
    `updated: ${today}`,
    '',
    '## You are here',
    '',
  ];
  if (milestonesInProgress.length === 0) {
    nextMdLines.push('No milestone currently in progress.');
  } else {
    for (const m of milestonesInProgress) {
      nextMdLines.push(`- **${m.id}** — ${m.title} (target: ${m.target || 'unset'})`);
    }
  }
  nextMdLines.push('', '## In-flight features', '', ...mods.inFlightLines(features));
  nextMdLines.push('', '## Next cursor', '');
  nextMdLines.push(cursor === null ? mods.NO_ELIGIBLE_PROJECT_TEXT : mods.cursorLine(cursor, features));
  nextMdLines.push(...mods.projectModuleSections(roadmapFm, features));
  nextMdLines.push('', '## How to continue', '');
  nextMdLines.push(mods.howToContinueLine(cursor));
  nextMdLines.push('');
  const nextMd = nextMdLines.join('\n');

  const modOut = deriveModuleOutputs(productDir, roadmapFm, features, milestones, today);
  return {
    indexJson,
    nextMd,
    moduleFiles: modOut.moduleFiles,
    moduleDeletes: modOut.moduleDeletes,
    moduleWarnings: modOut.warnings,
    moduleError: modOut.error,
  };
}

module.exports = {
  readProductRoadmap,
  readProductFeature,
  roadmapFeatureIdSet,
  regenerateDerived,
};
