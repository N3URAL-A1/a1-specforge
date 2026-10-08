'use strict';

// product vision-init | vision-touch (VISION.md, schema v1.1).

const fs = require('fs');
const path = require('path');
const { parseNestedFrontmatter, serializeNestedFrontmatter, parseFlags, nowIso } = require('./io.cjs');
const { acquireReservationsLock, exitWithLock, failWithLock, writeAllOrNothing } = require('./locks.cjs');
const { usage } = require('./help.cjs');
const { productMirrorHook } = require('./vault-product-hook.cjs');
const { regenerateDerived } = require('./product-derived.cjs');
const { assertSlug, productDirFromFlags } = require('./product-txn.cjs');

const PRODUCT_VISION_KEY_ORDER = ['schema_version', 'type', 'project', 'title', 'updated', 'pillars'];

/** Collect every occurrence of a repeatable `--<name> <value>` /
 * `--<name>=<value>` flag from the raw args array. `parseFlags` (lib/io.cjs)
 * has no 'multi' flag kind — it overwrites flags[name] on each match — so a
 * repeatable flag like `--pillar` (0 or more times per FR-003) needs this
 * small dedicated scan instead. Pure; does not mutate `args`. */
function collectRepeatableFlag(args, name) {
  const values = [];
  const eqPrefix = `--${name}=`;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === `--${name}`) {
      values.push(args[i + 1]);
      i++;
    } else if (a.startsWith(eqPrefix)) {
      values.push(a.slice(eqPrefix.length));
    }
  }
  return values;
}

/** Parse one `--pillar id:title:summary` flag value into a pillar object.
 * Pure. Throws (via fail()/failWithLock() at the call site) when the shape
 * is wrong — callers pass the raw flag value and a lockPath (or null before
 * any lock is held) for the error path. Splits on ':' with a max of 3 parts
 * so a summary containing ':' is preserved verbatim (only id/title must be
 * colon-free by construction — a kebab-slug and a short title rarely need
 * one, but a summary sentence often does, e.g. "id:Title:note: detail"). */
function parsePillarFlag(raw) {
  const parts = raw.split(':');
  if (parts.length < 3) return null;
  const id = parts[0].trim();
  const title = parts[1].trim();
  const summary = parts.slice(2).join(':').trim();
  if (!id || !title || !summary) return null;
  return { id, title, summary };
}

/** product vision-init --title <t> [--pillar id:title:summary ...] [--dir]:
 * scaffold docs/product/VISION.md (schema v1.1, FR-003). Refuses (non-zero
 * exit, no write) if VISION.md already exists — mirrors cmdProductFeatureInit's
 * duplicate-refusal contract (existence check performed INSIDE the locked
 * section, same TOCTOU-safe pattern as cmdProductInit). Requires at least
 * one --pillar flag: validateVisionFm (Wave 1, FR-001) rejects an empty/
 * omitted pillars[] outright, so accepting zero --pillar flags here would
 * only produce a VISION.md that immediately fails `product validate` —
 * reject at the CLI boundary instead, with a clear error, rather than
 * writing a file that's DOA. Each pillar id is validated via assertSlug
 * (kebab-case) before any path/lock work, consistent with every other
 * product-command entry point. After writing, regenerates index.json (via
 * buildRoadmapWritesWithChangelog's shared regenerateDerived call) so its
 * `vision` block becomes non-null (FR-014). */
function cmdProductVisionInit(args) {
  const flags = parseFlags(args, { title: 'value', dir: 'value' });
  if (!flags.title) {
    usage('product vision-init requires --title <title> [--pillar id:title:summary ...]');
  }
  const pillarFlags = collectRepeatableFlag(args, 'pillar');
  if (pillarFlags.length === 0) {
    usage('product vision-init requires at least one --pillar id:title:summary (VISION.md must have a non-empty pillars[] per schema v1.1)');
  }
  const pillars = pillarFlags.map((raw) => {
    const p = parsePillarFlag(raw);
    if (!p) {
      usage(`product vision-init: invalid --pillar value ${JSON.stringify(raw)} — expected id:title:summary (all three parts non-empty)`);
    }
    return p;
  });
  for (const p of pillars) {
    assertSlug(p.id, 'pillar');
  }
  const pillarIds = new Set();
  for (const p of pillars) {
    if (pillarIds.has(p.id)) {
      usage(`product vision-init: duplicate --pillar id ${JSON.stringify(p.id)}`);
    }
    pillarIds.add(p.id);
  }

  const dir = productDirFromFlags(flags);
  const visionFile = path.join(dir, 'VISION.md');

  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  // Overwrite guard runs INSIDE the locked section (TOCTOU fix, same pattern
  // as cmdProductInit/cmdProductImport) — otherwise two concurrent
  // `vision-init` runs could both pass this check before either held the
  // lock, and the second one to write would silently clobber the first.
  if (fs.existsSync(visionFile)) {
    failWithLock(lockPath, `product vision-init: ${visionFile} already exists — refusing to overwrite (use \`product vision-touch\` to bump 'updated', or edit the file by hand)`);
  }

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product vision-init: ${roadmapFile} not found (run \`product init\` first)`);
  }

  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm } = parseNestedFrontmatter(roadmapContent);

  const today = nowIso().slice(0, 10);
  const visionFm = {
    schema_version: 1,
    type: 'vision',
    project: roadmapFm.project,
    title: flags.title,
    updated: today,
    pillars,
  };
  const visionFmStr = serializeNestedFrontmatter(visionFm, PRODUCT_VISION_KEY_ORDER);
  const visionContent = `---\n${visionFmStr}\n---\n\n# ${flags.title}\n\n(fill in the vision narrative here.)\n`;

  const { indexJson, nextMd } = regenerateDerived(dir, roadmapFm, visionFm);
  const writes = [
    { target: visionFile, content: visionContent },
    { target: path.join(dir, 'index.json'), content: JSON.stringify(indexJson, null, 2) + '\n' },
    { target: path.join(dir, 'NEXT.md'), content: nextMd },
  ];
  const vaultMirror = writeAllOrNothing(lockPath, writes, 'product vision-init', productMirrorHook(dir));

  const out = { status: 'OK', title: flags.title, pillars: pillars.map((p) => p.id), files_written: writes.map((w) => w.target), vault_mirror: vaultMirror };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

/** product vision-touch [--dir]: bump VISION.md's frontmatter `updated`
 * field to today's date and regenerate index.json (FR-004) — the prose
 * body and `pillars[]` (indeed every other frontmatter field) are left
 * byte-for-byte unchanged. Fails (non-zero exit, no write) if VISION.md
 * does not exist yet — there is nothing to touch (use `vision-init`
 * first). Reuses the same lock + tmp/rename transaction as every other
 * product writer (FR-019). */
function cmdProductVisionTouch(args) {
  const flags = parseFlags(args, { dir: 'value' });
  const dir = productDirFromFlags(flags);
  const visionFile = path.join(dir, 'VISION.md');

  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  if (!fs.existsSync(visionFile)) {
    failWithLock(lockPath, `product vision-touch: ${visionFile} not found — run \`product vision-init\` first`);
  }
  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product vision-touch: ${roadmapFile} not found`);
  }

  const visionContentBefore = fs.readFileSync(visionFile, 'utf8');
  const { fm: visionFm } = parseNestedFrontmatter(visionContentBefore);
  if (typeof visionFm.updated !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(visionFm.updated)) {
    failWithLock(lockPath, `product vision-touch: ${visionFile} has no valid 'updated: YYYY-MM-DD' frontmatter line to bump — run \`product validate\` to diagnose the file first`);
  }

  const today = nowIso().slice(0, 10);
  const updatedVisionFm = { ...visionFm, updated: today };

  // Deliberately NOT re-serializing the whole frontmatter object here (unlike
  // every other product writer): serializeNestedFrontmatter/serializeScalar
  // re-quotes any string containing punctuation (e.g. an em dash in `title`,
  // a period in a pillar `summary`) even when its VALUE is unchanged, which
  // would violate FR-004's explicit "prose body AND pillars[] are byte-
  // unchanged" contract for every hand-authored VISION.md that doesn't
  // happen to already use this serializer's exact quoting conventions.
  // Instead, do a targeted textual replace of ONLY the `updated:` line
  // WITHIN THE FRONTMATTER BLOCK (bounded to the text between the first two
  // "---" markers, so a coincidental "updated:"-looking line inside the
  // prose body below is never touched), leaving every other line —
  // including whatever whitespace/quoting the user or vision-init originally
  // wrote — untouched.
  if (!visionContentBefore.startsWith('---\n')) {
    failWithLock(lockPath, `product vision-touch: ${visionFile} does not start with a '---' frontmatter block`);
  }
  const fmEnd = visionContentBefore.indexOf('\n---', 4);
  if (fmEnd === -1) {
    failWithLock(lockPath, `product vision-touch: ${visionFile} frontmatter has no closing '---'`);
  }
  const fmBlockBefore = visionContentBefore.slice(0, fmEnd);
  const restAfterFm = visionContentBefore.slice(fmEnd);
  const updatedLineRe = /^updated:.*$/m;
  if (!updatedLineRe.test(fmBlockBefore)) {
    failWithLock(lockPath, `product vision-touch: ${visionFile} frontmatter has no 'updated:' line to replace`);
  }
  const fmBlockAfter = fmBlockBefore.replace(updatedLineRe, `updated: ${today}`);
  const visionContentAfter = `${fmBlockAfter}${restAfterFm}`;

  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm } = parseNestedFrontmatter(roadmapContent);
  const { indexJson, nextMd } = regenerateDerived(dir, roadmapFm, updatedVisionFm);

  const writes = [
    { target: visionFile, content: visionContentAfter },
    { target: path.join(dir, 'index.json'), content: JSON.stringify(indexJson, null, 2) + '\n' },
    { target: path.join(dir, 'NEXT.md'), content: nextMd },
  ];
  const vaultMirror = writeAllOrNothing(lockPath, writes, 'product vision-touch', productMirrorHook(dir));

  const out = { status: 'OK', updated: today, files_written: writes.map((w) => w.target), vault_mirror: vaultMirror };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

module.exports = {
  cmdProductVisionInit,
  cmdProductVisionTouch,
};
