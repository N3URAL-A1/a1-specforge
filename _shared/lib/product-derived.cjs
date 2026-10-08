'use strict';

// Read side of docs/product/: ROADMAP.md / feature.md readers and the
// derived index.json + NEXT.md generation (regenerateDerived). No writes.

const fs = require('fs');
const path = require('path');
const { parseNestedFrontmatter, nowIso } = require('./io.cjs');
const { parseInlineFlowObject } = require('./product-schema.cjs');

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

/** Pure/side-effect-free: compute regenerated index.json and NEXT.md content
 * strings from the ROADMAP frontmatter (source of truth) and productDir (only
 * read to fill spec_path/plan_path from feature.md when present — never
 * written to). Returns { indexJson, nextMd }. `auditFmOverride` (Wave 4,
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
  const statusById = new Map(features.map((f) => [f.id, f.status]));
  let cursor = null;
  for (const f of features) {
    if (f.status === 'done' || f.status === 'cancelled') continue;
    const depsOk = (f.depends_on || []).every((dep) => statusById.get(dep) === 'done');
    if (depsOk) {
      cursor = f.id;
      break;
    }
  }

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
  };

  const inFlight = features.filter((f) => f.status === 'in-flight');
  const milestonesInProgress = milestones.filter((m) => m.status === 'in-progress');
  const today = nowIso().slice(0, 10);

  const nextMdLines = [
    '# NEXT.md',
    '',
    '<!-- generated file — do not hand-edit. Regenerated by `a1-tools product ...` -->',
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
  nextMdLines.push('', '## In-flight features', '');
  if (inFlight.length === 0) {
    nextMdLines.push('None.');
  } else {
    for (const f of inFlight) {
      const scopeHint = f.spec_path || f.plan_path
        ? ` — scope: ${[f.spec_path, f.plan_path].filter(Boolean).join(', ')}`
        : '';
      nextMdLines.push(`- **${f.id}** — ${f.title} (milestone: ${f.milestone}, stage: ${f.stage || 'none'})${scopeHint}`);
    }
  }
  nextMdLines.push('', '## Next cursor', '');
  if (cursor === null) {
    nextMdLines.push('None — no eligible feature (all done/cancelled, or blocked by unmet dependencies).');
  } else {
    const cursorFeature = features.find((f) => f.id === cursor);
    const rationale = cursorFeature && (cursorFeature.depends_on || []).length > 0
      ? `all dependencies (${cursorFeature.depends_on.join(', ')}) are done`
      : 'no unmet dependencies, first eligible feature in roadmap order';
    nextMdLines.push(`**${cursor}** — recommended next feature (${rationale}).`);
  }
  nextMdLines.push('', '## How to continue', '');
  nextMdLines.push(
    cursor === null
      ? 'Run `a1-progress` to review overall project state and decide the next milestone.'
      : 'Run `a1-plan` to create an executable plan for the next-cursor feature, or `a1-execute` if a plan already exists.'
  );
  nextMdLines.push('');
  const nextMd = nextMdLines.join('\n');

  return { indexJson, nextMd };
}

module.exports = {
  readProductRoadmap,
  readProductFeature,
  roadmapFeatureIdSet,
  regenerateDerived,
};
