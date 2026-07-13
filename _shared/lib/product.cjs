'use strict';

const fs = require('fs');
const path = require('path');
const io = require('./io.cjs');
const locks = require('./locks.cjs');

const {
  parseNestedFrontmatter,
  serializeNestedFrontmatter,
  parseFlags,
  fail,
  nowIso,
} = io;

const {
  acquireReservationsLock,
  exitWithLock,
  failWithLock,
  writeAllOrNothing,
  loadReservations,
} = locks;

const { usage } = require('./help.cjs');
const { CODE_SCOPE_STAGES } = require('./code-scope.cjs');

const PRODUCT_ROADMAP_KEY_ORDER = [
  'schema_version', 'type', 'project', 'title', 'status', 'updated', 'source',
  'milestones', 'features', 'next',
];

const PRODUCT_FEATURE_KEY_ORDER = [
  'id', 'project', 'milestone', 'title', 'status', 'stage', 'depends_on',
  'started', 'finished', 'spec_path', 'plan_path', 'schema_version',
];

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

const CHANGELOG_ROTATION_LIMIT = 100;

/** Append a changelog line to ROADMAP.md body's `## Changelog` section
 * in-memory (pure — caller is responsible for persisting via the same
 * atomic write set as every other product mutation). Returns
 * { body, archiveAppend } where archiveAppend is a string to append to
 * CHANGELOG-archive.md (or null if no rotation happened this call). */
function appendChangelogEntry(body, what, why) {
  const today = nowIso().slice(0, 10);
  const line = `- **${today}** — ${what} — ${why}`;

  const headingRe = /^## Changelog\s*$/m;
  const match = headingRe.exec(body);
  if (!match) {
    // No Changelog section yet — append one at the end of the body.
    const sep = body.endsWith('\n') ? '' : '\n';
    return { body: `${body}${sep}\n## Changelog\n\n${line}\n`, archiveAppend: null };
  }

  const startIdx = match.index + match[0].length;
  // Find the next "## " heading after Changelog to bound the section.
  const rest = body.slice(startIdx);
  const nextHeadingMatch = /^## /m.exec(rest);
  const sectionEnd = nextHeadingMatch ? startIdx + nextHeadingMatch.index : body.length;

  const before = body.slice(0, startIdx);
  const section = body.slice(startIdx, sectionEnd);
  const after = body.slice(sectionEnd);

  const entryLines = section.split('\n').filter((l) => /^- \*\*\d{4}-\d{2}-\d{2}\*\* —/.test(l));
  const nonEntryPrefix = section.slice(0, section.indexOf(entryLines[0] || '') === -1 ? section.length : section.indexOf(entryLines[0]));

  const updatedEntries = [...entryLines, line];

  let archiveAppend = null;
  let keptEntries = updatedEntries;
  if (updatedEntries.length > CHANGELOG_ROTATION_LIMIT) {
    const overflowCount = updatedEntries.length - CHANGELOG_ROTATION_LIMIT;
    const overflow = updatedEntries.slice(0, overflowCount);
    keptEntries = updatedEntries.slice(overflowCount);
    archiveAppend = overflow.join('\n') + '\n';
  }

  const newSection = `${nonEntryPrefix.trimEnd() ? nonEntryPrefix.trimEnd() + '\n\n' : '\n'}${keptEntries.join('\n')}\n\n`;
  const newBody = `${before}${newSection}${after}`;

  return { body: newBody, archiveAppend };
}

// Slug/id shapes accepted anywhere a user-controlled value is joined into a
// filesystem path for the `product` subcommands. Defined here (ahead of
// their first use in the write-path command handlers below) so every entry
// point can enforce them via assertSlug() before any path.join()/lock
// acquisition happens — see SEC findings on path traversal via unvalidated
// --id/--milestone/--project.
const PRODUCT_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FEATURE_ID_RE = /^[0-9]{3}-[a-z0-9]+(-[a-z0-9]+)*$/;

/** Reject any value that isn't a bare kebab-case slug (or, for kind
 * 'feature-id', a `###-kebab-slug`) BEFORE it is used to build a filesystem
 * path. Throws via fail()/failWithLock() semantics — callers pass an
 * optional lockPath so an already-acquired lock is released on rejection.
 * Must be called at every product-command entry point that joins a
 * user-supplied id/milestone/project into a path, prior to the path.join()
 * and prior to acquireReservationsLock() wherever possible. */
function assertSlug(value, kind, lockPath) {
  const re = kind === 'feature-id' ? FEATURE_ID_RE : PRODUCT_SLUG_RE;
  const label = kind === 'feature-id' ? 'a ###-kebab-slug (e.g. 001-my-feature)' : 'a kebab-case slug (e.g. my-slug)';
  const ok = typeof value === 'string' && re.test(value);
  if (!ok) {
    const msg = `invalid ${kind}: ${JSON.stringify(value)} — must be ${label}, no path separators, dots, or traversal sequences`;
    if (lockPath) failWithLock(lockPath, msg);
    else fail(msg);
  }
}

function productDirFromFlags(flags) {
  return flags.dir ? path.resolve(flags.dir) : path.join(process.cwd(), 'docs', 'product');
}

// writeAllOrNothing lives in lib/locks.cjs

/** Build the writes[] entries for ROADMAP.md (with an appended changelog
 * line) + regenerated index.json/NEXT.md, given the ALREADY-updated
 * roadmap frontmatter + body. Handles the >100-entry archive rotation
 * (FR-010) by adding a 4th write when rotation occurs. Returns
 * { writes, roadmapContent } for the caller to push onto its own writes[]
 * (e.g. feature.md, reservations.json) before calling writeAllOrNothing. */
function buildRoadmapWritesWithChangelog(dir, updatedRoadmapFm, roadmapBody, what, why) {
  const { body: bodyWithEntry, archiveAppend } = appendChangelogEntry(roadmapBody, what, why);
  const { indexJson, nextMd } = regenerateDerived(dir, updatedRoadmapFm);

  const roadmapFmStr = serializeNestedFrontmatter(updatedRoadmapFm, PRODUCT_ROADMAP_KEY_ORDER);
  const roadmapContent = `---\n${roadmapFmStr}\n---\n${bodyWithEntry.startsWith('\n') ? '' : '\n'}${bodyWithEntry}`;

  const writes = [
    { target: path.join(dir, 'ROADMAP.md'), content: roadmapContent },
    { target: path.join(dir, 'index.json'), content: JSON.stringify(indexJson, null, 2) + '\n' },
    { target: path.join(dir, 'NEXT.md'), content: nextMd },
  ];
  if (archiveAppend !== null) {
    const archiveFile = path.join(dir, 'CHANGELOG-archive.md');
    let archiveExisting = '';
    if (fs.existsSync(archiveFile)) {
      archiveExisting = fs.readFileSync(archiveFile, 'utf8');
    } else {
      archiveExisting = '# Changelog Archive\n\nRotated entries beyond the 100-entry ROADMAP.md ' +
        'Changelog window (append-only, oldest first).\n\n';
    }
    const sep = archiveExisting.endsWith('\n') ? '' : '\n';
    writes.push({ target: archiveFile, content: `${archiveExisting}${sep}${archiveAppend}` });
  }
  return { writes, roadmapContent };
}

function cmdProductStatus(args) {
  const flags = parseFlags(args, { dir: 'value' });
  const dir = productDirFromFlags(flags);
  const roadmap = readProductRoadmap(dir);
  if (!roadmap) {
    fail(`product status: ${path.join(dir, 'ROADMAP.md')} not found`);
  }
  const fm = roadmap.fm;
  const features = (Array.isArray(fm.features) ? fm.features : []).map((f) => {
    const featureMd = readProductFeature(dir, f.id);
    if (!featureMd) return { ...f };
    return { ...f, feature_md_path: featureMd.file };
  });
  const out = {
    project: { id: fm.project, title: fm.title, status: fm.status },
    milestones: Array.isArray(fm.milestones) ? fm.milestones : [],
    features,
    next: fm.next !== undefined ? fm.next : null,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

function cmdProductStage(args) {
  const flags = parseFlags(args, { by: 'value', set: 'value', dir: 'value' });
  if (!flags.by || !flags.set) {
    usage('product stage requires --by <feature-id> --set <stage>');
  }
  const dir = productDirFromFlags(flags);
  const targetStage = flags.set;
  if (targetStage !== null && !CODE_SCOPE_STAGES.includes(targetStage)) {
    usage(`product stage --set must be one of: ${CODE_SCOPE_STAGES.join('|')} (got: ${targetStage})`);
  }
  const id = flags.by;

  // Lock file anchor: co-located with the reservations lock convention but
  // scoped to this product dir specifically (docs/product/.product-stage.lock)
  // so a product-stage transaction never contends with unrelated
  // .a1/reservations.json activity, while reusing the exact same
  // acquire/release/exit/fail primitives (no new lock code needed).
  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product stage: ${roadmapFile} not found`);
  }
  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm, body: roadmapBody } = parseNestedFrontmatter(roadmapContent);

  const featuresList = Array.isArray(roadmapFm.features) ? roadmapFm.features : [];
  const featureIdx = featuresList.findIndex((f) => f.id === id);
  if (featureIdx === -1) {
    failWithLock(lockPath, `product stage: feature '${id}' not found in ${roadmapFile}`);
  }
  const existing = featuresList[featureIdx];
  const currentStage = existing.stage !== undefined ? existing.stage : null;

  const currentIdx = currentStage === null ? -1 : CODE_SCOPE_STAGES.indexOf(currentStage);
  const nextIdx = CODE_SCOPE_STAGES.indexOf(targetStage);
  if (currentIdx !== -1 && nextIdx < currentIdx) {
    failWithLock(
      lockPath,
      `product stage: backward transition rejected for '${id}' ` +
        `(current stage '${currentStage}' is ahead of requested '${targetStage}'). ` +
        `Stage transitions must be forward-only: ${CODE_SCOPE_STAGES.join(' -> ')}.`
    );
  }
  const skipped =
    currentIdx !== -1 && nextIdx - currentIdx > 1
      ? CODE_SCOPE_STAGES.slice(currentIdx + 1, nextIdx)
      : [];

  const today = nowIso().slice(0, 10);
  const derivedStatus = targetStage === 'done' ? 'done' : 'in-flight';
  const updatedFeature = { ...existing, stage: targetStage, status: derivedStatus };
  if (currentStage === null && targetStage !== null) {
    if (!updatedFeature.started) updatedFeature.started = today;
  }
  if (targetStage === 'done') {
    if (!updatedFeature.finished) updatedFeature.finished = today;
  }

  const updatedFeaturesList = featuresList.map((f, idx2) => (idx2 === featureIdx ? updatedFeature : f));
  const updatedRoadmapFm = {
    ...roadmapFm,
    updated: today,
    features: updatedFeaturesList,
  };

  // feature.md mirror (only if the directory/file exists already — creation
  // of new feature.md files is out of scope for Wave 2 per FR-015/FR-017).
  const featureMd = readProductFeature(dir, id);
  let updatedFeatureMdContent = null;
  let featureMdFile = null;
  if (featureMd) {
    featureMdFile = featureMd.file;
    const updatedFeatureFm = {
      ...featureMd.fm,
      stage: targetStage,
      status: derivedStatus,
      started: updatedFeature.started !== undefined ? updatedFeature.started : featureMd.fm.started,
      finished: updatedFeature.finished !== undefined ? updatedFeature.finished : featureMd.fm.finished,
    };
    const fmStr = serializeNestedFrontmatter(updatedFeatureFm, PRODUCT_FEATURE_KEY_ORDER);
    updatedFeatureMdContent = `---\n${fmStr}\n---\n${featureMd.body.startsWith('\n') ? '' : '\n'}${featureMd.body}`;
  }

  // reservations.json mirror (best-effort, silently skipped if no matching
  // code_scope reservation exists for this feature id).
  const reservationsFilePath = path.join(process.cwd(), '.a1', 'reservations.json');
  let updatedReservationsData = null;
  if (fs.existsSync(reservationsFilePath)) {
    const resData = loadReservations(reservationsFilePath);
    const resIdx = resData.reservations.findIndex((r) => r.type === 'code_scope' && r.by === id);
    if (resIdx !== -1) {
      const resExisting = resData.reservations[resIdx];
      const resCurrentIdx = CODE_SCOPE_STAGES.indexOf(resExisting.stage);
      const resNextIdx = CODE_SCOPE_STAGES.indexOf(targetStage);
      // Mirror the SAME stage value ROADMAP just decided — do not re-derive
      // a divergent forward-only decision here, just skip mirroring if this
      // reservation is somehow already ahead (defensive; should not happen
      // in practice since ROADMAP is the source of truth for this command).
      if (resCurrentIdx === -1 || resNextIdx >= resCurrentIdx) {
        const updatedRes = { ...resExisting, stage: targetStage };
        updatedReservationsData = {
          reservations: resData.reservations.map((r, i3) => (i3 === resIdx ? updatedRes : r)),
        };
      }
    }
  }

  // Changelog auto-append (FR-010, Wave 3): only on an ACTUAL stage change,
  // never on an idempotent same-stage re-set (keeps the changelog honest and
  // matches the idempotent-dates-unchanged contract already tested in Wave 2).
  const stageActuallyChanged = currentStage !== targetStage;
  const { writes, roadmapContent: updatedRoadmapContent } = stageActuallyChanged
    ? buildRoadmapWritesWithChangelog(
        dir,
        updatedRoadmapFm,
        roadmapBody,
        `${id} -> ${targetStage}`,
        'stage transition via `product stage`'
      )
    : (() => {
        const { indexJson, nextMd } = regenerateDerived(dir, updatedRoadmapFm);
        const roadmapFmStr = serializeNestedFrontmatter(updatedRoadmapFm, PRODUCT_ROADMAP_KEY_ORDER);
        const content = `---\n${roadmapFmStr}\n---\n${roadmapBody.startsWith('\n') ? '' : '\n'}${roadmapBody}`;
        return {
          writes: [
            { target: roadmapFile, content },
            { target: path.join(dir, 'index.json'), content: JSON.stringify(indexJson, null, 2) + '\n' },
            { target: path.join(dir, 'NEXT.md'), content: nextMd },
          ],
          roadmapContent: content,
        };
      })();

  if (updatedFeatureMdContent !== null) {
    writes.push({ target: featureMdFile, content: updatedFeatureMdContent });
  }
  if (updatedReservationsData !== null) {
    writes.push({
      target: reservationsFilePath,
      content: JSON.stringify(updatedReservationsData, null, 2) + '\n',
    });
  }

  writeAllOrNothing(lockPath, writes, 'product stage');
  void updatedRoadmapContent;

  const out = {
    status: 'OK',
    feature: id,
    stage: targetStage,
    derived_status: derivedStatus,
    skipped,
    files_written: writes.map((w) => w.target),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

const MILESTONE_STATUS_VALUES = ['planned', 'in-progress', 'done'];
const PROJECT_STATUS_VALUES = ['active', 'paused', 'done'];

/** product markers --level <project|milestone|feature> [--id <id>] [--set <marker>]
 * (FR-007). With no --set: read-only report of the 3 marker levels — roadmap
 * `next` cursor / project `status`, per-milestone `status`, per-feature
 * `stage` — as JSON, plus warnings[] for detected inconsistencies (e.g.
 * `next` pointing at a done/cancelled feature; an in-flight feature with no
 * matching code_scope reservation). Never mutates any file in this mode.
 * With --set: writes the marker at the given level under the same
 * lock+tmp/rename transaction as `product stage`/`product changelog`, then
 * calls regenerateDerived (index.json + NEXT.md) — matching the Wave 3
 * brief's explicit contract ("writing under the same lock and calling
 * regenerateDerived after"). --level and --set require --id except at
 * project level (there is only one project). Feature-level --set only
 * updates the feature-stage marker directly (bypassing product stage's
 * forward-only stage-transition guard and reservations.json/feature.md
 * mirroring) — use `product stage` instead when those guarantees matter. */
function cmdProductMarkers(args) {
  const flags = parseFlags(args, { dir: 'value', level: 'value', id: 'value', set: 'value' });
  if (flags.set !== undefined) {
    return cmdProductMarkersSet(flags);
  }
  const dir = productDirFromFlags(flags);
  const roadmap = readProductRoadmap(dir);
  if (!roadmap) {
    fail(`product markers: ${path.join(dir, 'ROADMAP.md')} not found`);
  }
  const fm = roadmap.fm;
  const milestones = Array.isArray(fm.milestones) ? fm.milestones : [];
  const features = Array.isArray(fm.features) ? fm.features : [];

  const warnings = [];

  const nextId = fm.next !== undefined ? fm.next : null;
  if (nextId !== null) {
    const nextFeature = features.find((f) => f.id === nextId);
    if (!nextFeature) {
      warnings.push(`next cursor '${nextId}' does not match any feature id in ROADMAP.md`);
    } else if (nextFeature.status === 'done' || nextFeature.status === 'cancelled') {
      warnings.push(`next cursor '${nextId}' points at a feature with status '${nextFeature.status}' (should point at a not-yet-done feature)`);
    }
  }

  const reservationsFilePath = path.join(process.cwd(), '.a1', 'reservations.json');
  let reservationsById = new Map();
  if (fs.existsSync(reservationsFilePath)) {
    const resData = loadReservations(reservationsFilePath);
    reservationsById = new Map(
      resData.reservations.filter((r) => r.type === 'code_scope').map((r) => [r.by, r])
    );
  }

  for (const f of features) {
    if (f.status === 'in-flight' && !reservationsById.has(f.id)) {
      warnings.push(`feature '${f.id}' has status 'in-flight' but no matching code_scope reservation in .a1/reservations.json`);
    }
    if (f.status === 'in-flight' && (f.stage === null || f.stage === undefined)) {
      warnings.push(`feature '${f.id}' has status 'in-flight' but stage is null`);
    }
  }

  const out = {
    project: { id: fm.project, title: fm.title, status: fm.status, marker: 'project-status', value: fm.status },
    next_cursor: { level: 'project', value: nextId },
    milestones: milestones.map((m) => ({ id: m.id, marker: 'milestone-status', value: m.status })),
    features: features.map((f) => ({ id: f.id, marker: 'feature-stage', value: f.stage !== undefined ? f.stage : null, status: f.status })),
    warnings,
  };

  if (flags.level) {
    if (!['project', 'milestone', 'feature'].includes(flags.level)) {
      usage(`product markers --level must be one of: project|milestone|feature (got: ${flags.level})`);
    }
    if (flags.level === 'milestone' && flags.id) {
      out.filtered = out.milestones.filter((m) => m.id === flags.id);
    } else if (flags.level === 'feature' && flags.id) {
      out.filtered = out.features.filter((f) => f.id === flags.id);
    }
  }

  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

/** Write path for `product markers --set` (FR-007). Split out of
 * cmdProductMarkers to keep the read-only report path unchanged. Validates
 * --level/--id/--set, updates the target marker under the same
 * lock+tmp/rename transaction as `product stage`/`product changelog`
 * (including a changelog line + regenerateDerived), then exits. */
function cmdProductMarkersSet(flags) {
  if (!flags.level) {
    usage('product markers --set requires --level <project|milestone|feature>');
  }
  if (!['project', 'milestone', 'feature'].includes(flags.level)) {
    usage(`product markers --level must be one of: project|milestone|feature (got: ${flags.level})`);
  }
  if (flags.level !== 'project' && !flags.id) {
    usage(`product markers --level ${flags.level} --set requires --id <id>`);
  }

  const dir = productDirFromFlags(flags);
  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product markers: ${roadmapFile} not found`);
  }
  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm, body: roadmapBody } = parseNestedFrontmatter(roadmapContent);

  const today = nowIso().slice(0, 10);
  let updatedRoadmapFm;
  let changelogWhat;

  if (flags.level === 'project') {
    if (!PROJECT_STATUS_VALUES.includes(flags.set)) {
      failWithLock(
        lockPath,
        `product markers --level project --set must be one of: ${PROJECT_STATUS_VALUES.join('|')} (got: ${flags.set})`
      );
    }
    updatedRoadmapFm = { ...roadmapFm, status: flags.set, updated: today };
    changelogWhat = `project status -> ${flags.set}`;
  } else if (flags.level === 'milestone') {
    const milestones = Array.isArray(roadmapFm.milestones) ? roadmapFm.milestones : [];
    const idx = milestones.findIndex((m) => m.id === flags.id);
    if (idx === -1) {
      failWithLock(lockPath, `product markers: milestone '${flags.id}' not found in ${roadmapFile}`);
    }
    if (!MILESTONE_STATUS_VALUES.includes(flags.set)) {
      failWithLock(
        lockPath,
        `product markers --level milestone --set must be one of: ${MILESTONE_STATUS_VALUES.join('|')} (got: ${flags.set})`
      );
    }
    const updatedMilestones = milestones.map((m, i) => (i === idx ? { ...m, status: flags.set } : m));
    updatedRoadmapFm = { ...roadmapFm, milestones: updatedMilestones, updated: today };
    changelogWhat = `milestone ${flags.id} status -> ${flags.set}`;
  } else {
    // feature level: sets the feature-stage marker directly. Unlike
    // `product stage`, this does not enforce forward-only transitions and
    // does not mirror reservations.json/feature.md — it is the lightweight
    // marker writer the Wave 3 brief specifies; use `product stage` when
    // those additional guarantees are required.
    const features = Array.isArray(roadmapFm.features) ? roadmapFm.features : [];
    const idx = features.findIndex((f) => f.id === flags.id);
    if (idx === -1) {
      failWithLock(lockPath, `product markers: feature '${flags.id}' not found in ${roadmapFile}`);
    }
    if (!CODE_SCOPE_STAGES.includes(flags.set)) {
      failWithLock(
        lockPath,
        `product markers --level feature --set must be one of: ${CODE_SCOPE_STAGES.join('|')} (got: ${flags.set})`
      );
    }
    const updatedFeatures = features.map((f, i) => (i === idx ? { ...f, stage: flags.set } : f));
    updatedRoadmapFm = { ...roadmapFm, features: updatedFeatures, updated: today };
    changelogWhat = `feature ${flags.id} stage marker -> ${flags.set}`;
  }

  const { writes } = buildRoadmapWritesWithChangelog(
    dir,
    updatedRoadmapFm,
    roadmapBody,
    changelogWhat,
    'marker set via `product markers --set`'
  );
  writeAllOrNothing(lockPath, writes, 'product markers');

  const out = {
    status: 'OK',
    level: flags.level,
    id: flags.id || null,
    set: flags.set,
    files_written: writes.map((w) => w.target),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

/** product changelog --entry "<what>" --why "<why>" [--dir]: appends a
 * changelog line to ROADMAP.md, rotating overflow beyond 100 entries to
 * CHANGELOG-archive.md, and regenerates index.json/NEXT.md — all under the
 * same lock + tmp/rename transaction as `product stage` (FR-010). */
function cmdProductChangelog(args) {
  const flags = parseFlags(args, { entry: 'value', why: 'value', dir: 'value' });
  if (!flags.entry || !flags.why) {
    usage('product changelog requires --entry "<what>" --why "<why>"');
  }
  const dir = productDirFromFlags(flags);
  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product changelog: ${roadmapFile} not found`);
  }
  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm, body: roadmapBody } = parseNestedFrontmatter(roadmapContent);

  const today = nowIso().slice(0, 10);
  const updatedRoadmapFm = { ...roadmapFm, updated: today };

  const { writes } = buildRoadmapWritesWithChangelog(dir, updatedRoadmapFm, roadmapBody, flags.entry, flags.why);
  writeAllOrNothing(lockPath, writes, 'product changelog');

  const out = { status: 'OK', entry: flags.entry, why: flags.why, files_written: writes.map((w) => w.target) };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

/** product init --project <slug> --title <t> [--dir]: scaffold a brand-new
 * docs/product/ROADMAP.md skeleton (schema v1, empty milestones/features) +
 * NEXT.md + index.json. Refuses if ROADMAP.md already exists (FR-017: new =
 * scaffold once, never re-scaffold over an existing contract). */
function cmdProductInit(args) {
  const flags = parseFlags(args, { project: 'value', title: 'value', dir: 'value' });
  if (!flags.project || !flags.title) {
    usage('product init requires --project <slug> --title <title>');
  }
  assertSlug(flags.project, 'project');
  const dir = productDirFromFlags(flags);
  const roadmapFile = path.join(dir, 'ROADMAP.md');

  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  // Overwrite guard MUST run inside the locked section (TOCTOU fix, same
  // pattern as `product import`): otherwise two concurrent `product init`
  // runs could both pass this check before either held the lock.
  if (fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product init: ${roadmapFile} already exists — refusing to overwrite (use add-milestone/add-feature to extend, or product stage to progress it)`);
  }

  const today = nowIso().slice(0, 10);
  const roadmapFm = {
    schema_version: 1,
    type: 'roadmap',
    project: flags.project,
    title: flags.title,
    status: 'active',
    updated: today,
    source: 'scaffolded by a1-tools product init',
    milestones: [],
    features: [],
    next: null,
  };
  const body = `\n# ${flags.title}\n\n## Milestones\n\n(none yet — use \`product add-milestone\`)\n\n## In-flight features\n\nNone.\n\n## Changelog\n\n- **${today}** — project initialized — scaffolded by \`product init\`\n\n## Appendix — migrated details\n\n(none)\n`;

  const roadmapFmStr = serializeNestedFrontmatter(roadmapFm, PRODUCT_ROADMAP_KEY_ORDER);
  const roadmapContent = `---\n${roadmapFmStr}\n---\n${body}`;
  const { indexJson, nextMd } = regenerateDerived(dir, roadmapFm);

  const writes = [
    { target: roadmapFile, content: roadmapContent },
    { target: path.join(dir, 'index.json'), content: JSON.stringify(indexJson, null, 2) + '\n' },
    { target: path.join(dir, 'NEXT.md'), content: nextMd },
  ];
  writeAllOrNothing(lockPath, writes, 'product init');

  const out = { status: 'OK', project: flags.project, files_written: writes.map((w) => w.target) };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

/** product add-milestone --id <slug> --title <t> [--target YYYY-MM] [--goal <s>]:
 * append a new milestone entry to an existing ROADMAP.md's milestones[] list. */
function cmdProductAddMilestone(args) {
  const flags = parseFlags(args, { id: 'value', title: 'value', target: 'value', goal: 'value', status: 'value', dir: 'value' });
  if (!flags.id || !flags.title) {
    usage('product add-milestone requires --id <slug> --title <title>');
  }
  assertSlug(flags.id, 'milestone');
  const dir = productDirFromFlags(flags);
  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product add-milestone: ${roadmapFile} not found (run \`product init\` first)`);
  }
  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm, body: roadmapBody } = parseNestedFrontmatter(roadmapContent);
  const milestones = Array.isArray(roadmapFm.milestones) ? roadmapFm.milestones : [];
  if (milestones.some((m) => m.id === flags.id)) {
    failWithLock(lockPath, `product add-milestone: milestone '${flags.id}' already exists`);
  }

  const newMilestone = {
    id: flags.id,
    title: flags.title,
    status: flags.status || 'planned',
    target: flags.target || null,
  };
  const updatedRoadmapFm = {
    ...roadmapFm,
    updated: nowIso().slice(0, 10),
    milestones: [...milestones, newMilestone],
  };

  const { writes } = buildRoadmapWritesWithChangelog(
    dir,
    updatedRoadmapFm,
    roadmapBody,
    `milestone '${flags.id}' added`,
    flags.goal || 'new milestone via `product add-milestone`'
  );
  writeAllOrNothing(lockPath, writes, 'product add-milestone');

  const out = { status: 'OK', milestone: flags.id, files_written: writes.map((w) => w.target) };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

/** product add-feature --id <###-slug> --milestone <m> --title <t>
 * [--goal <s>] [--depends-on a,b]: append a new feature entry to an existing
 * ROADMAP.md's features[] list (schema-v1 shape, all fields present). */
function cmdProductAddFeature(args) {
  const flags = parseFlags(args, {
    id: 'value', milestone: 'value', title: 'value', goal: 'value',
    'depends-on': 'value', status: 'value', dir: 'value',
  });
  if (!flags.id || !flags.milestone || !flags.title) {
    usage('product add-feature requires --id <###-slug> --milestone <m-slug> --title <title>');
  }
  assertSlug(flags.id, 'feature-id');
  assertSlug(flags.milestone, 'milestone');
  const dir = productDirFromFlags(flags);
  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product add-feature: ${roadmapFile} not found (run \`product init\` first)`);
  }
  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm, body: roadmapBody } = parseNestedFrontmatter(roadmapContent);
  const milestones = Array.isArray(roadmapFm.milestones) ? roadmapFm.milestones : [];
  const features = Array.isArray(roadmapFm.features) ? roadmapFm.features : [];

  if (!milestones.some((m) => m.id === flags.milestone)) {
    failWithLock(lockPath, `product add-feature: milestone '${flags.milestone}' does not exist — add it first via \`product add-milestone\``);
  }
  if (features.some((f) => f.id === flags.id)) {
    failWithLock(lockPath, `product add-feature: feature '${flags.id}' already exists`);
  }

  const dependsOn = flags['depends-on']
    ? flags['depends-on'].split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const newFeature = {
    id: flags.id,
    milestone: flags.milestone,
    title: flags.title,
    status: flags.status || 'planned',
    stage: null,
    depends_on: dependsOn,
    started: null,
    finished: null,
    spec_path: null,
    plan_path: null,
  };
  const updatedRoadmapFm = {
    ...roadmapFm,
    updated: nowIso().slice(0, 10),
    features: [...features, newFeature],
  };

  const { writes } = buildRoadmapWritesWithChangelog(
    dir,
    updatedRoadmapFm,
    roadmapBody,
    `feature '${flags.id}' added`,
    flags.goal || 'new feature via `product add-feature`'
  );
  writeAllOrNothing(lockPath, writes, 'product add-feature');

  const out = { status: 'OK', feature: flags.id, files_written: writes.map((w) => w.target) };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

/** product feature-init --id <###-slug> [--spec-path <p>] [--plan-path <p>]:
 * creates docs/product/features/<id>/feature.md (schema-v1 frontmatter),
 * mirroring the ROADMAP.md features[] entry for <id> (FR-015/FR-017 —
 * on-touch creation, never big-bang). The feature must already be present
 * in ROADMAP.md features[] (via add-feature or init). */
function cmdProductFeatureInit(args) {
  const flags = parseFlags(args, { id: 'value', 'spec-path': 'value', 'plan-path': 'value', dir: 'value' });
  if (!flags.id) {
    usage('product feature-init requires --id <###-feature-slug>');
  }
  assertSlug(flags.id, 'feature-id');
  const dir = productDirFromFlags(flags);
  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product feature-init: ${roadmapFile} not found`);
  }
  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm, body: roadmapBody } = parseNestedFrontmatter(roadmapContent);
  const features = Array.isArray(roadmapFm.features) ? roadmapFm.features : [];
  const feature = features.find((f) => f.id === flags.id);
  if (!feature) {
    failWithLock(lockPath, `product feature-init: feature '${flags.id}' not found in ${roadmapFile} — add it first via \`product add-feature\``);
  }

  const featureDir = path.join(dir, 'features', flags.id);
  const featureFile = path.join(featureDir, 'feature.md');
  if (fs.existsSync(featureFile)) {
    failWithLock(lockPath, `product feature-init: ${featureFile} already exists`);
  }

  const specPath = flags['spec-path'] || null;
  const planPath = flags['plan-path'] || null;

  const featureFm = {
    id: feature.id,
    project: roadmapFm.project,
    milestone: feature.milestone,
    title: feature.title,
    status: feature.status,
    stage: feature.stage !== undefined ? feature.stage : null,
    depends_on: Array.isArray(feature.depends_on) ? feature.depends_on : [],
    started: feature.started !== undefined ? feature.started : null,
    finished: feature.finished !== undefined ? feature.finished : null,
    spec_path: specPath,
    plan_path: planPath,
    schema_version: 1,
  };
  const featureFmStr = serializeNestedFrontmatter(featureFm, PRODUCT_FEATURE_KEY_ORDER);
  const featureContent = `---\n${featureFmStr}\n---\n\n${feature.title} — feature summary (fill in).\n`;

  // Mirror spec_path/plan_path onto the ROADMAP.md features[] entry too, so
  // index.json regeneration (which reads feature.md OR the frontmatter
  // fallback) is consistent even before the next `product stage` call.
  const updatedFeature = { ...feature, spec_path: specPath !== null ? specPath : feature.spec_path, plan_path: planPath !== null ? planPath : feature.plan_path };
  const updatedFeatures = features.map((f) => (f.id === flags.id ? updatedFeature : f));
  const updatedRoadmapFm = { ...roadmapFm, updated: nowIso().slice(0, 10), features: updatedFeatures };

  const { writes } = buildRoadmapWritesWithChangelog(
    dir,
    updatedRoadmapFm,
    roadmapBody,
    `feature.md created for '${flags.id}'`,
    'formal spec/plan attached via `product feature-init`'
  );
  writes.push({ target: featureFile, content: featureContent });
  writeAllOrNothing(lockPath, writes, 'product feature-init');

  const out = { status: 'OK', feature: flags.id, files_written: writes.map((w) => w.target) };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

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
  writeAllOrNothing(lockPath, writes, 'product vision-init');

  const out = { status: 'OK', title: flags.title, pillars: pillars.map((p) => p.id), files_written: writes.map((w) => w.target) };
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
  writeAllOrNothing(lockPath, writes, 'product vision-touch');

  const out = { status: 'OK', updated: today, files_written: writes.map((w) => w.target) };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

const PRODUCT_AUDIT_KEY_ORDER = [
  'schema_version', 'type', 'project', 'focus', 'date', 'source', 'verdict',
  'counts', 'findings', 'last_validated',
];

/** Serialize an inline YAML flow-mapping `{ blocker: N, major: N, minor: N }`
 * (the twin of parseInlineFlowObject, near the validate section below).
 * Pure. Always emits all three keys as bare (unquoted) integers, matching
 * the exact shape docs/product/SCHEMA.md section 7 and every hand-authored
 * audit fixture use. */
function serializeCountsInline(counts) {
  return `{ blocker: ${counts.blocker}, major: ${counts.major}, minor: ${counts.minor} }`;
}

/** Build the full audits/<date>-<focus>.md text (frontmatter + body) from an
 * already-shaped audit frontmatter object. Pure — no I/O. `serializeNested
 * Frontmatter` has no inline-flow-mapping support (see serializeScalar), so
 * `counts` is serialized separately here and spliced into the `counts:` line
 * via a targeted textual replace of the placeholder line the generic
 * serializer emits — the same "serialize generically, then fix up the one
 * field the shared serializer can't express" approach Wave 3's vision-touch
 * fix established for targeted single-field edits. */
function serializeAuditContent(auditFm, body) {
  const fmStr = serializeNestedFrontmatter(auditFm, PRODUCT_AUDIT_KEY_ORDER);
  const countsLineRe = /^counts:.*$/m;
  const fixedFmStr = fmStr.replace(countsLineRe, `counts: ${serializeCountsInline(auditFm.counts)}`);
  return `---\n${fixedFmStr}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
}

/** Parse one a1-analyze finding string of the shape
 * `id=F-001; severity=MAJOR; category=...; location=...; description=...;
 * recommendation=...` (the flat `key=value; key=value` frontmatter-list-item
 * format `lib/io.cjs`'s `parseFrontmatter`/ANALYSIS_KEY_ORDER produces for
 * analysis `findings[]` — see .a1/learnings/projects/&lt;name&gt;/analyses/ .
 * Pure. Returns { id, severity, category } (the three fields the v1.1 audit
 * finding shape needs from the source) or null if `id`/`severity` are
 * missing — a finding lacking those two is not usable as an audit entry.
 * Deliberately tolerant of ';' appearing inside a value (e.g. inside
 * `description`): splits on '; ' then re-joins any trailing fragment whose
 * key doesn't look like a known field back onto the previous field's value,
 * mirroring parsePillarFlag's "cap the split, keep the remainder" approach
 * for a value that itself may contain the separator character. */
function parseAnalysisFindingString(raw) {
  if (typeof raw !== 'string') return null;
  const fields = {};
  let currentKey = null;
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    const m = /^([a-z_]+)=([\s\S]*)$/.exec(trimmed);
    if (m && ['id', 'severity', 'category', 'location', 'description', 'recommendation'].includes(m[1])) {
      currentKey = m[1];
      fields[currentKey] = m[2];
    } else if (currentKey) {
      // Continuation of the previous field's value (it contained a ';').
      fields[currentKey] = `${fields[currentKey]};${part}`;
    }
  }
  if (!fields.id || !fields.severity) return null;
  return {
    id: fields.id.trim(),
    severity: fields.severity.trim(),
    category: (fields.category || 'uncategorized').trim(),
  };
}

/** Read an a1-analyze result file's frontmatter (`lib/io.cjs`'s
 * `parseFrontmatter` — the flat/simple parser, NOT `parseNestedFrontmatter`:
 * analysis `findings[]` is a flat list of quoted `key=value; ...` strings,
 * not the nested-object-list shape ROADMAP.md/VISION.md/audits use — see
 * ANALYSIS_KEY_ORDER in lib/io.cjs) and derive everything `audit-publish`
 * needs: `{ project, focus, date, source, verdict, findings }`. Pure — no
 * writes. Throws (via fail()) on a structurally unusable analysis file
 * (missing focus/date, or a findings[] that isn't an array) — the caller is
 * responsible for translating that into the locked failWithLock() path once
 * a lock is held. */
function readAnalysisForPublish(analysisPath) {
  if (!fs.existsSync(analysisPath)) {
    fail(`product audit-publish: --analysis file not found: ${analysisPath}`);
  }
  const content = fs.readFileSync(analysisPath, 'utf8');
  const { fm } = io.parseFrontmatter(content);

  if (typeof fm.focus !== 'string' || fm.focus.length === 0) {
    fail(`product audit-publish: ${analysisPath} has no usable 'focus' in frontmatter`);
  }
  const dateRaw = typeof fm.created_at === 'string' ? fm.created_at.slice(0, 10) : null;
  if (!dateRaw || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateRaw)) {
    fail(`product audit-publish: ${analysisPath} has no usable 'created_at' date in frontmatter`);
  }

  const rawFindings = Array.isArray(fm.findings) ? fm.findings : [];
  const findings = rawFindings
    .map((raw) => parseAnalysisFindingString(raw))
    .filter((f) => f !== null);

  return {
    project: typeof fm.project === 'string' ? fm.project : null,
    focus: fm.focus,
    date: dateRaw,
    source: analysisPath,
    verdict: typeof fm.title === 'string' && fm.title.length > 0 ? fm.title : `${fm.focus} analysis`,
    findings,
  };
}

/** product audit-publish --analysis <path> [--project <slug>] [--dir]:
 * parse an a1-analyze result's frontmatter findings and create exactly one
 * new docs/product/audits/<date>-<focus>.md (FR-007), every finding
 * initialized to status: open / fixed_commit: null / feature: null.
 * Refuses (non-zero exit, no write) if a file for the same date+focus
 * already exists (FR-008) — audits are append-only history, one file per
 * analyze-run, never a rolling per-focus file that gets overwritten.
 * Zero-findings analyses still produce a valid, empty-findings[] audit file
 * (explicit spec edge case) rather than erroring. Regenerates index.json
 * (audits[] gains a matching entry) under the same lock + tmp/rename
 * transaction as every other product writer (FR-019). --project overrides
 * the analysis frontmatter's own `project` field (useful when publishing an
 * externally-authored analysis, e.g. the niimo reference fixture, into a
 * DIFFERENT project's docs/product/ — Wave 5 reuses this). */
function cmdProductAuditPublish(args) {
  const flags = parseFlags(args, { analysis: 'value', project: 'value', dir: 'value' });
  if (!flags.analysis) {
    usage('product audit-publish requires --analysis <path>');
  }
  const dir = productDirFromFlags(flags);
  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product audit-publish: ${roadmapFile} not found (run \`product init\` first)`);
  }
  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm } = parseNestedFrontmatter(roadmapContent);

  let parsed;
  try {
    parsed = readAnalysisForPublish(path.resolve(flags.analysis));
  } catch (e) {
    failWithLock(lockPath, e.message);
  }

  const project = flags.project || parsed.project || roadmapFm.project;
  if (!project) {
    failWithLock(lockPath, 'product audit-publish: could not determine --project (not in analysis frontmatter, no --project flag, no ROADMAP.md project)');
  }

  const auditsDir = path.join(dir, 'audits');
  const fileName = `${parsed.date}-${parsed.focus}.md`;
  const auditFile = path.join(auditsDir, fileName);

  // Duplicate-date+focus refusal (FR-008) — checked INSIDE the locked
  // section (TOCTOU-safe, same pattern as every other product writer's
  // overwrite guard) so two concurrent publishes of the same analysis can
  // never both pass the check before either holds the lock.
  if (fs.existsSync(auditFile)) {
    failWithLock(
      lockPath,
      `product audit-publish: ${auditFile} already exists — refusing to overwrite (audits are append-only ` +
        'history; publish a differently-dated or differently-focused analysis, or use `product audit-set` ' +
        'to update an existing finding)'
    );
  }

  const counts = { blocker: 0, major: 0, minor: 0 };
  const findings = parsed.findings.map((f) => {
    const severityKey = f.severity === 'BLOCKER' ? 'blocker' : f.severity === 'MAJOR' ? 'major' : f.severity === 'MINOR' ? 'minor' : null;
    if (severityKey) counts[severityKey] += 1;
    return {
      id: f.id,
      severity: f.severity,
      category: f.category,
      status: 'open',
      fixed_commit: null,
      feature: null,
    };
  });

  const today = nowIso().slice(0, 10);
  const auditFm = {
    schema_version: 1,
    type: 'audit',
    project,
    focus: parsed.focus,
    date: parsed.date,
    source: parsed.source,
    verdict: parsed.verdict,
    counts,
    findings,
    last_validated: today,
  };
  const auditBody = `\n# Audit — ${parsed.focus} (${parsed.date})\n\n> Published from \`${parsed.source}\` via ` +
    '`product audit-publish`.\n\n## Changelog\n\n' +
    `- **${today}** — audit published — ${findings.length} finding(s) imported from a1-analyze result\n`;
  const auditContent = serializeAuditContent(auditFm, auditBody);

  // auditFmOverride: the new audit file hasn't landed on disk yet (write
  // happens below, via writeAllOrNothing) — pass the in-memory frontmatter
  // so THIS SAME index.json regeneration already reflects it (FR-007's own
  // "index.json's audits[] gains a matching entry" AC), not one call behind.
  const { indexJson, nextMd } = regenerateDerived(dir, roadmapFm, undefined, { name: fileName, fm: auditFm });
  const writes = [
    { target: auditFile, content: auditContent },
    { target: path.join(dir, 'index.json'), content: JSON.stringify(indexJson, null, 2) + '\n' },
    { target: path.join(dir, 'NEXT.md'), content: nextMd },
  ];
  writeAllOrNothing(lockPath, writes, 'product audit-publish');

  const out = {
    status: 'OK',
    audit_file: auditFile,
    focus: parsed.focus,
    date: parsed.date,
    findings_count: findings.length,
    files_written: writes.map((w) => w.target),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

const AUDIT_SET_STATUS_VALUES = ['open', 'fixed', 'obsolete', 'accepted'];

/** product audit-set --audit <path> --finding F-0NN --status <status>
 * [--commit <sha>] [--feature <id>] [--dir]: mutate EXACTLY the named
 * finding's status/fixed_commit/feature fields, leaving every other finding
 * (and every other frontmatter field, and the prose body) byte-unchanged
 * (FR-009). Appends a one-line changelog entry to the audit body. Fails
 * (non-zero exit, no write) if --finding doesn't match any finding id in the
 * target file (FR-010), if --status is out of the FR-006 enum, or if
 * --feature names an id absent from ROADMAP.md (FR-011, hard validation —
 * reuses roadmapFeatureIdSet(), the same helper `product validate`'s FR-018
 * cross-check uses). A transition FROM 'fixed' back TO 'open' (regression
 * re-open) is explicitly a LEGAL transition — no forward-only guard here,
 * unlike `product stage`'s CODE_SCOPE_STAGES ordering. Regenerates
 * index.json (derived open/fixed counts) under the same lock + tmp/rename
 * transaction as every other product writer (FR-019).
 *
 * Uses a targeted textual replace of ONLY the one finding's 3 fields within
 * the frontmatter block (bounded to the file's `findings:` block, working
 * line-by-line inside the matched finding's `  - id: ...` … next `  - id:`
 * span), NOT a full re-serialize via serializeNestedFrontmatter — the exact
 * same reason Wave 3's vision-touch fix gives: the shared serializer
 * re-quotes every unchanged string value (a category with a comma/colon, a
 * source path with a slash already unquoted by hand, …), which would violate
 * this FR's "other findings are byte-unchanged" contract for any
 * hand-authored or audit-publish-written file that doesn't happen to already
 * match the serializer's exact quoting conventions. */
function cmdProductAuditSet(args) {
  const flags = parseFlags(args, { audit: 'value', finding: 'value', status: 'value', commit: 'value', feature: 'value', dir: 'value' });
  if (!flags.audit || !flags.finding || !flags.status) {
    usage('product audit-set requires --audit <path> --finding F-0NN --status <open|fixed|obsolete|accepted> [--commit <sha>] [--feature <id>]');
  }
  if (!AUDIT_SET_STATUS_VALUES.includes(flags.status)) {
    usage(`product audit-set --status must be one of: ${AUDIT_SET_STATUS_VALUES.join('|')} (got: ${flags.status})`);
  }

  const dir = productDirFromFlags(flags);
  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  const auditFile = path.resolve(flags.audit);
  if (!fs.existsSync(auditFile)) {
    failWithLock(lockPath, `product audit-set: ${auditFile} not found`);
  }

  if (flags.feature) {
    const roadmapFile = path.join(dir, 'ROADMAP.md');
    if (!fs.existsSync(roadmapFile)) {
      failWithLock(lockPath, `product audit-set: ${roadmapFile} not found (cannot validate --feature ${flags.feature})`);
    }
    const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
    const { fm: roadmapFm } = parseNestedFrontmatter(roadmapContent);
    const knownFeatureIds = roadmapFeatureIdSet(roadmapFm);
    if (!knownFeatureIds.has(flags.feature)) {
      failWithLock(
        lockPath,
        `product audit-set: --feature '${flags.feature}' does not exist in ${roadmapFile} — ` +
          'no dangling findings[].feature references are allowed (FR-011; add the feature first via `product add-feature`)'
      );
    }
  }

  const auditContentBefore = fs.readFileSync(auditFile, 'utf8');
  const { fm: auditFm } = parseNestedFrontmatter(auditContentBefore);
  const findings = Array.isArray(auditFm.findings) ? auditFm.findings : [];
  const findingIdx = findings.findIndex((f) => f.id === flags.finding);
  if (findingIdx === -1) {
    failWithLock(
      lockPath,
      `product audit-set: finding '${flags.finding}' not found in ${auditFile} ` +
        `(known ids: ${findings.map((f) => f.id).join(', ') || '(none)'})`
    );
  }

  // Targeted textual replace: locate the matched finding's block within the
  // FRONTMATTER ONLY (bounded to the text between the first two '---'
  // markers, same bounding discipline as vision-touch), so a coincidental
  // "- id: F-0NN" string inside the prose body is never touched.
  if (!auditContentBefore.startsWith('---\n')) {
    failWithLock(lockPath, `product audit-set: ${auditFile} does not start with a '---' frontmatter block`);
  }
  const fmEnd = auditContentBefore.indexOf('\n---', 4);
  if (fmEnd === -1) {
    failWithLock(lockPath, `product audit-set: ${auditFile} frontmatter has no closing '---'`);
  }
  const fmBlockBefore = auditContentBefore.slice(0, fmEnd);
  const restAfterFm = auditContentBefore.slice(fmEnd);
  const fmLines = fmBlockBefore.split('\n');

  const findingStartRe = new RegExp(`^  - id:\\s*${flags.finding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  const startIdx = fmLines.findIndex((l) => findingStartRe.test(l));
  if (startIdx === -1) {
    failWithLock(lockPath, `product audit-set: could not locate finding '${flags.finding}' block in ${auditFile} frontmatter for a targeted replace`);
  }
  let endIdx = fmLines.length;
  for (let i = startIdx + 1; i < fmLines.length; i++) {
    if (/^  - id:/.test(fmLines[i]) || /^[A-Za-z_][A-Za-z0-9_]*:/.test(fmLines[i])) {
      endIdx = i;
      break;
    }
  }
  const blockLines = fmLines.slice(startIdx, endIdx);

  const commitValue = flags.commit || null;
  const featureValue = flags.feature || null;
  const replaceField = (lines, field, value) => {
    const re = new RegExp(`^(    ${field}:).*$`);
    const serialized = value === null ? 'null' : io.serializeScalar(value);
    let replaced = false;
    const out = lines.map((l) => {
      if (re.test(l)) { replaced = true; return `    ${field}: ${serialized}`; }
      return l;
    });
    if (!replaced) {
      out.push(`    ${field}: ${serialized}`);
    }
    return out;
  };
  let updatedBlockLines = replaceField(blockLines, 'status', flags.status);
  // Only touch fixed_commit/feature when the caller actually supplied them —
  // an audit-set call that only changes --status (e.g. the fixed -> open
  // regression re-open case) must not clobber a previously-recorded
  // fixed_commit/feature with null.
  if (flags.commit !== undefined) {
    updatedBlockLines = replaceField(updatedBlockLines, 'fixed_commit', commitValue);
  }
  if (flags.feature !== undefined) {
    updatedBlockLines = replaceField(updatedBlockLines, 'feature', featureValue);
  }

  const updatedFmLines = [
    ...fmLines.slice(0, startIdx),
    ...updatedBlockLines,
    ...fmLines.slice(endIdx),
  ];
  const fmBlockAfter = updatedFmLines.join('\n');

  const today = nowIso().slice(0, 10);
  const changelogLine = `- **${today}** — ${flags.finding} ${flags.status}` +
    (commitValue ? ` — commit ${commitValue}` : '') +
    (featureValue ? ` — feature ${featureValue}` : '') + '\n';

  // Append the changelog line to the body's "## Changelog" section (create
  // one if absent) — same section-bounding approach appendChangelogEntry()
  // uses for ROADMAP.md, but audit files don't share ROADMAP.md's >100-entry
  // rotation contract (audit history is already bounded by one changelog
  // per audit-set call on a naturally small per-file findings[] set), so
  // this is a simple append rather than a reuse of appendChangelogEntry().
  // `restAfterFm` (from the frontmatter-bounding scan above) starts with the
  // closing '\n---' marker line itself — strip exactly that (and the single
  // blank line the source always has right after it, same convention
  // parseNestedFrontmatter's own `body` extraction uses) to get the pure
  // prose body, so re-composing `---\n${fmBlockAfter}\n---\n${bodyAfter}`
  // below produces exactly ONE frontmatter block, not a duplicated one.
  const bodyBefore = restAfterFm.replace(/^\n---\n?/, '');
  const changelogHeadingRe = /^## Changelog\s*$/m;
  let bodyAfter;
  if (changelogHeadingRe.test(bodyBefore)) {
    const match = changelogHeadingRe.exec(bodyBefore);
    const insertAt = match.index + match[0].length;
    bodyAfter = `${bodyBefore.slice(0, insertAt)}\n\n${changelogLine}${bodyBefore.slice(insertAt).replace(/^\n\n/, '')}`;
  } else {
    const sep = bodyBefore.endsWith('\n') ? '' : '\n';
    bodyAfter = `${bodyBefore}${sep}\n## Changelog\n\n${changelogLine}`;
  }
  // fmBlockAfter already carries the opening '---' as its own first line
  // (fmLines[0], since fmBlockBefore = content.slice(0, fmEnd) starts at
  // offset 0) — do NOT prepend another '---\n' here, or the file ends up
  // with a duplicated marker ('---\n---\n...').
  const auditContentAfter = `${fmBlockAfter}\n---\n${bodyAfter}`;

  // In-memory mirror of the ONE finding's mutation (immutable update — new
  // array, new finding object), used ONLY as regenerateDerived's
  // auditFmOverride below so index.json's derived open/fixed split reflects
  // THIS call's change immediately (the on-disk file is still in its PRIOR
  // state until writeAllOrNothing's tmp/rename phase runs) — the textual
  // auditContentAfter string above remains the actual bytes written to disk.
  const updatedFinding = {
    ...findings[findingIdx],
    status: flags.status,
    fixed_commit: flags.commit !== undefined ? commitValue : findings[findingIdx].fixed_commit,
    feature: flags.feature !== undefined ? featureValue : findings[findingIdx].feature,
  };
  const updatedAuditFm = {
    ...auditFm,
    findings: findings.map((f, idx) => (idx === findingIdx ? updatedFinding : f)),
  };

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm } = parseNestedFrontmatter(roadmapContent);
  const { indexJson, nextMd } = regenerateDerived(
    dir,
    roadmapFm,
    undefined,
    { name: path.basename(auditFile), fm: updatedAuditFm }
  );

  const writes = [
    { target: auditFile, content: auditContentAfter },
    { target: path.join(dir, 'index.json'), content: JSON.stringify(indexJson, null, 2) + '\n' },
    { target: path.join(dir, 'NEXT.md'), content: nextMd },
  ];
  writeAllOrNothing(lockPath, writes, 'product audit-set');

  const out = {
    status: 'OK',
    audit_file: auditFile,
    finding: flags.finding,
    new_status: flags.status,
    commit: commitValue,
    feature: featureValue,
    files_written: writes.map((w) => w.target),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

// ---------------------------------------------------------------------------
// product validate — schema-v1 frontmatter validation (FR-021 round-trip
// oracle; also usable standalone). Hand-rolled against the contract in
// docs/product/SCHEMA.md section 1 / docs/product/index.schema.json — this
// file has zero npm dependencies (see require() list at the top), so this is
// a purpose-built checker rather than a generic JSON-Schema engine. Field
// names/rules are kept in lockstep with index.schema.json by design; if that
// file's contract changes, update both.
// ---------------------------------------------------------------------------

// PRODUCT_SLUG_RE / FEATURE_ID_RE are defined earlier (near
// productDirFromFlags/assertSlug) so the write-path command handlers can
// use them ahead of this validate section.
const YYYY_MM_RE = /^[0-9]{4}-[0-9]{2}$/;
const YYYY_MM_DD_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const PROJECT_STATUSES = new Set(['active', 'paused', 'done']);
const MILESTONE_STATUSES = new Set(['done', 'in-progress', 'planned']);
const FEATURE_STATUSES = new Set(['done', 'in-flight', 'planned', 'cancelled']);
const FEATURE_STAGES = new Set([null, 'started', 'complete', 'review', 'verify', 'merge', 'origin-cleanup', 'done']);

// ---------------------------------------------------------------------------
// Schema v1.1 additions (spec 003-product-schema-v1.1-vision-audits, Wave 1):
// VISION.md + docs/product/audits/<date>-<focus>.md. Both file types are
// OPTIONAL — absence is valid under schema v1.1 (FR-002) and MUST NOT affect
// validation of a v1-only project. See docs/product/SCHEMA.md sections 6/7
// for the authoritative prose contract; field names/checks here mirror it.
// ---------------------------------------------------------------------------

const AUDIT_FOCUS_VALUES = new Set(['general', 'security', 'architecture', 'quality', 'onboarding']);
const AUDIT_SEVERITIES = new Set(['BLOCKER', 'MAJOR', 'MINOR']);
const FINDING_STATUSES = new Set(['open', 'fixed', 'obsolete', 'accepted']);

/** Parse a single-line inline YAML flow-mapping like
 * `{ blocker: 5, major: 11, minor: 15 }` into a plain object of scalars.
 * `parseNestedFrontmatter` (lib/io.cjs) has no general nested-object
 * support — it only handles scalars, scalar arrays, and arrays of flat
 * objects — so a top-level flow-mapping value comes back as the raw
 * un-parsed string. This is a small, deliberately narrow helper (only the
 * `counts` field in an audit file uses this shape) rather than a rewrite
 * of the shared parser, which is out of this wave's scope. Returns null if
 * `raw` is not a string or does not look like `{ ... }`. Pure. */
function parseInlineFlowObject(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner === '') return {};
  const obj = {};
  for (const pair of inner.split(',')) {
    const idx = pair.indexOf(':');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const valueRaw = pair.slice(idx + 1).trim();
    if (/^-?[0-9]+$/.test(valueRaw)) {
      obj[key] = parseInt(valueRaw, 10);
    } else if (valueRaw === 'true') {
      obj[key] = true;
    } else if (valueRaw === 'false') {
      obj[key] = false;
    } else if (valueRaw === 'null') {
      obj[key] = null;
    } else {
      obj[key] = valueRaw.replace(/^["']|["']$/g, '');
    }
  }
  return obj;
}

/** Validate a parsed VISION.md frontmatter object against the schema-v1.1
 * contract (docs/product/SCHEMA.md section 6). Pure — no I/O. Returns
 * { valid, errors }. Enforces FR-001's clarified rule: `pillars[]` MUST be
 * present and non-empty (empty array OR omitted key are both INVALID). */
function validateVisionFm(fm) {
  const errors = [];
  const req = (key, ok, msg) => {
    if (!ok) errors.push(`${key}: ${msg}`);
  };

  if (fm.schema_version !== 1) errors.push(`schema_version: must be integer 1, got ${JSON.stringify(fm.schema_version)}`);
  if (fm.type !== 'vision') errors.push(`type: must be "vision", got ${JSON.stringify(fm.type)}`);
  req('project', typeof fm.project === 'string' && PRODUCT_SLUG_RE.test(fm.project), `must be kebab-case slug, got ${JSON.stringify(fm.project)}`);
  req('title', typeof fm.title === 'string' && fm.title.length > 0, 'must be a non-empty string');
  req('updated', typeof fm.updated === 'string' && YYYY_MM_DD_RE.test(fm.updated), `must be YYYY-MM-DD, got ${JSON.stringify(fm.updated)}`);

  const pillars = Array.isArray(fm.pillars) ? fm.pillars : null;
  req('pillars', pillars !== null && pillars.length > 0, 'must be a non-empty array — at least one pillar is required whenever VISION.md exists (empty or omitted pillars[] is invalid)');
  if (pillars) {
    pillars.forEach((p, i) => {
      const prefix = `pillars[${i}]`;
      req(`${prefix}.id`, typeof p.id === 'string' && PRODUCT_SLUG_RE.test(p.id), `must be kebab-case slug, got ${JSON.stringify(p.id)}`);
      req(`${prefix}.title`, typeof p.title === 'string' && p.title.length > 0, 'must be a non-empty string');
      req(`${prefix}.summary`, typeof p.summary === 'string' && p.summary.length > 0, 'must be a non-empty string');
    });
  }

  return { valid: errors.length === 0, errors };
}

/** Validate a parsed audits/<date>-<focus>.md frontmatter object against the
 * schema-v1.1 contract (docs/product/SCHEMA.md section 7). Pure — no I/O.
 * Returns { valid, errors }. Enforces FR-005 (required fields), FR-006
 * (findings[].status enum). Does NOT cross-check findings[].feature against
 * ROADMAP.md — that referential check is FR-018 (Wave 2), a read-time
 * concern layered on top of this shape validation. */
function validateAuditFm(fm) {
  const errors = [];
  const req = (key, ok, msg) => {
    if (!ok) errors.push(`${key}: ${msg}`);
  };

  if (fm.schema_version !== 1) errors.push(`schema_version: must be integer 1, got ${JSON.stringify(fm.schema_version)}`);
  if (fm.type !== 'audit') errors.push(`type: must be "audit", got ${JSON.stringify(fm.type)}`);
  req('project', typeof fm.project === 'string' && PRODUCT_SLUG_RE.test(fm.project), `must be kebab-case slug, got ${JSON.stringify(fm.project)}`);
  req('focus', AUDIT_FOCUS_VALUES.has(fm.focus), `must be one of ${[...AUDIT_FOCUS_VALUES].join('|')}, got ${JSON.stringify(fm.focus)}`);
  req('date', typeof fm.date === 'string' && YYYY_MM_DD_RE.test(fm.date), `must be YYYY-MM-DD, got ${JSON.stringify(fm.date)}`);
  req('source', typeof fm.source === 'string' && fm.source.length > 0, 'must be a non-empty provenance string');
  req('verdict', typeof fm.verdict === 'string' && fm.verdict.length > 0, 'must be a non-empty string');

  const counts = parseInlineFlowObject(fm.counts);
  req('counts', counts !== null, 'must be an inline flow-mapping, e.g. { blocker: 0, major: 0, minor: 0 }');
  if (counts) {
    ['blocker', 'major', 'minor'].forEach((k) => {
      req(`counts.${k}`, typeof counts[k] === 'number' && Number.isInteger(counts[k]), `must be an integer, got ${JSON.stringify(counts[k])}`);
    });
  }

  const findings = Array.isArray(fm.findings) ? fm.findings : null;
  req('findings', findings !== null, 'must be an array (may be empty)');
  if (findings) {
    findings.forEach((f, i) => {
      const prefix = `findings[${i}]`;
      req(`${prefix}.id`, typeof f.id === 'string' && f.id.length > 0, 'must be a non-empty finding id, e.g. F-001');
      req(`${prefix}.severity`, AUDIT_SEVERITIES.has(f.severity), `must be one of ${[...AUDIT_SEVERITIES].join('|')}, got ${JSON.stringify(f.severity)}`);
      req(`${prefix}.category`, typeof f.category === 'string' && f.category.length > 0, 'must be a non-empty string');
      req(`${prefix}.status`, FINDING_STATUSES.has(f.status), `must be one of ${[...FINDING_STATUSES].join('|')}, got ${JSON.stringify(f.status)}`);
      req(`${prefix}.fixed_commit`, f.fixed_commit === null || (typeof f.fixed_commit === 'string' && f.fixed_commit.length > 0), `must be a non-empty commit sha or null, got ${JSON.stringify(f.fixed_commit)}`);
      req(`${prefix}.feature`, f.feature === null || (typeof f.feature === 'string' && FEATURE_ID_RE.test(f.feature)), `must be null or a ###-kebab-slug feature id, got ${JSON.stringify(f.feature)}`);
    });
  }

  req('last_validated', typeof fm.last_validated === 'string' && YYYY_MM_DD_RE.test(fm.last_validated), `must be YYYY-MM-DD, got ${JSON.stringify(fm.last_validated)}`);

  return { valid: errors.length === 0, errors };
}

/** Validate a parsed ROADMAP.md frontmatter object against the schema-v1
 * contract (docs/product/SCHEMA.md section 1). Pure — no I/O. Returns
 * { valid, errors } where errors is a flat array of human-readable strings
 * (empty when valid). Used by both `product validate` and `product import`
 * (import validates its own output before writing — see FR-021 AC "round-
 * trips through schema validation"). */
function validateRoadmapFm(fm) {
  const errors = [];
  const req = (key, ok, msg) => {
    if (!ok) errors.push(`${key}: ${msg}`);
  };

  if (fm.schema_version !== 1) errors.push(`schema_version: must be integer 1, got ${JSON.stringify(fm.schema_version)}`);
  if (fm.type !== 'roadmap') errors.push(`type: must be "roadmap", got ${JSON.stringify(fm.type)}`);
  req('project', typeof fm.project === 'string' && PRODUCT_SLUG_RE.test(fm.project), `must be kebab-case slug, got ${JSON.stringify(fm.project)}`);
  req('title', typeof fm.title === 'string' && fm.title.length > 0, 'must be a non-empty string');
  req('status', PROJECT_STATUSES.has(fm.status), `must be one of ${[...PROJECT_STATUSES].join('|')}, got ${JSON.stringify(fm.status)}`);
  req('updated', typeof fm.updated === 'string' && YYYY_MM_DD_RE.test(fm.updated), `must be YYYY-MM-DD, got ${JSON.stringify(fm.updated)}`);
  req('source', typeof fm.source === 'string' && fm.source.length > 0, 'must be a non-empty provenance string');

  const milestones = Array.isArray(fm.milestones) ? fm.milestones : null;
  req('milestones', milestones !== null, 'must be an array');
  const milestoneIds = new Set();
  if (milestones) {
    milestones.forEach((m, i) => {
      const p = `milestones[${i}]`;
      req(`${p}.id`, typeof m.id === 'string' && PRODUCT_SLUG_RE.test(m.id), `must be kebab-case slug, got ${JSON.stringify(m.id)}`);
      req(`${p}.title`, typeof m.title === 'string' && m.title.length > 0, 'must be a non-empty string');
      req(`${p}.status`, MILESTONE_STATUSES.has(m.status), `must be one of ${[...MILESTONE_STATUSES].join('|')}, got ${JSON.stringify(m.status)}`);
      req(`${p}.target`, m.target === null || (typeof m.target === 'string' && YYYY_MM_RE.test(m.target)), `must be YYYY-MM or null, got ${JSON.stringify(m.target)}`);
      if (typeof m.id === 'string') milestoneIds.add(m.id);
    });
  }

  const features = Array.isArray(fm.features) ? fm.features : null;
  req('features', features !== null, 'must be an array');
  const featureIds = new Set();
  if (features) {
    features.forEach((f, i) => {
      const p = `features[${i}]`;
      req(`${p}.id`, typeof f.id === 'string' && FEATURE_ID_RE.test(f.id), `must be ###-kebab-slug, got ${JSON.stringify(f.id)}`);
      req(`${p}.milestone`, typeof f.milestone === 'string' && milestoneIds.has(f.milestone), `must reference an existing milestones[].id, got ${JSON.stringify(f.milestone)}`);
      req(`${p}.title`, typeof f.title === 'string' && f.title.length > 0, 'must be a non-empty string');
      req(`${p}.status`, FEATURE_STATUSES.has(f.status), `must be one of ${[...FEATURE_STATUSES].join('|')}, got ${JSON.stringify(f.status)}`);
      req(`${p}.stage`, FEATURE_STAGES.has(f.stage === undefined ? null : f.stage), `must be one of ${[...FEATURE_STAGES].map(String).join('|')}, got ${JSON.stringify(f.stage)}`);
      req(`${p}.depends_on`, Array.isArray(f.depends_on), 'must be an array');
      req(`${p}.started`, f.started === null || (typeof f.started === 'string' && YYYY_MM_DD_RE.test(f.started)), `must be YYYY-MM-DD or null, got ${JSON.stringify(f.started)}`);
      req(`${p}.finished`, f.finished === null || (typeof f.finished === 'string' && YYYY_MM_DD_RE.test(f.finished)), `must be YYYY-MM-DD or null, got ${JSON.stringify(f.finished)}`);
      if (typeof f.id === 'string') featureIds.add(f.id);
    });
    // depends_on referential check (second pass — needs full featureIds set).
    features.forEach((f, i) => {
      const p = `features[${i}]`;
      if (Array.isArray(f.depends_on)) {
        f.depends_on.forEach((dep) => {
          if (!featureIds.has(dep)) errors.push(`${p}.depends_on: references unknown feature id ${JSON.stringify(dep)}`);
        });
      }
    });
  }

  req('next', fm.next === null || (typeof fm.next === 'string' && featureIds.has(fm.next)), `must be null or an existing features[].id, got ${JSON.stringify(fm.next)}`);

  return { valid: errors.length === 0, errors };
}

// German-marker heuristic (FR-016 English-only lint) — reuses the exact
// proven pattern from the M8 OSS-Ready German->English sweep gate (see
// .a1/phases/M8-launch-community/PLAN.md Wave 2 Task 2.1): umlauts/ß plus a
// short list of common German function words surrounded by spaces. That
// sweep's own retro (skills/a1-execute/_learning.md, M8 entry) notes this
// grep has false-negative risk (umlaut-free German sentences without any of
// the listed function words can slip through) — acceptable here because this
// is an explicitly best-effort lint (flag, never hard-block), not a proof of
// absence. False positives on English text that happens to contain a listed
// substring as part of a foreign proper noun are likewise accepted per
// FR-016's intent (catch accidental full-German writes, not every borrowed
// word).
const GERMAN_MARKER_RE = /[äöüßÄÖÜ]| (der|die|das|und|nicht|wird|noch|schon|dann|wenn|für|über) /;

/** Best-effort English-only lint (FR-016): scan `content` (a docs/product/
 * file's full text — frontmatter + body) for strong German-language markers.
 * Returns a warning string, or null when no marker was found. Pure — no I/O.
 * Not a hard gate: callers surface this as a warning, never as a validation
 * error, since prose bodies can't be perfectly language-detected and
 * FR-016's intent is to catch accidental full-German writes, not to police
 * every line. */
function detectGermanMarkers(content, label) {
  if (!GERMAN_MARKER_RE.test(content)) return null;
  return `${label}: contains German-language markers (umlauts/ß or common German function words) — docs/product/ artifacts must be authored in English (FR-016). Best-effort lint; review for accidental German prose.`;
}

/** product validate [--dir docs/product]: read-only schema check of
 * <dir>/ROADMAP.md frontmatter against docs/product/SCHEMA.md section 1 /
 * index.schema.json, plus (schema v1.1, Wave 1) VISION.md (section 6) and
 * every docs/product/audits/*.md file (section 7) WHEN PRESENT — both are
 * optional; their absence is valid and adds no error (FR-002). Also runs a
 * best-effort FR-016 English-only lint (warning only, never affects
 * `valid`/exit code). The FR-016 lint covers ALL docs/product/ artifact
 * types named by the FR — ROADMAP.md, NEXT.md, index.json (scanned as raw
 * text; a German string value still trips the marker regex), every
 * features/<###>-<slug>/feature.md, VISION.md, and every audits/*.md.
 * Never writes any file. Exit: 0 valid, 1 invalid or ROADMAP.md missing. */
function cmdProductValidate(args) {
  const flags = parseFlags(args, { dir: 'value' });
  const dir = productDirFromFlags(flags);
  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    process.stdout.write(JSON.stringify({ valid: false, errors: [`ROADMAP.md not found at ${roadmapFile}`] }, null, 2) + '\n');
    process.exit(1);
  }
  const content = fs.readFileSync(roadmapFile, 'utf8');
  const { fm } = parseNestedFrontmatter(content);
  const roadmapResult = validateRoadmapFm(fm);
  const errors = [...roadmapResult.errors];
  const warnings = [];
  const germanWarning = detectGermanMarkers(content, path.basename(roadmapFile));
  if (germanWarning) warnings.push(germanWarning);

  // FR-016 scan sweep — the remaining docs/product/ artifact types.
  const nextFile = path.join(dir, 'NEXT.md');
  if (fs.existsSync(nextFile)) {
    const w = detectGermanMarkers(fs.readFileSync(nextFile, 'utf8'), 'NEXT.md');
    if (w) warnings.push(w);
  }
  const indexFile = path.join(dir, 'index.json');
  if (fs.existsSync(indexFile)) {
    const w = detectGermanMarkers(fs.readFileSync(indexFile, 'utf8'), 'index.json');
    if (w) warnings.push(w);
  }
  const featuresDir = path.join(dir, 'features');
  if (fs.existsSync(featuresDir)) {
    for (const entry of fs.readdirSync(featuresDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const featureFile = path.join(featuresDir, entry.name, 'feature.md');
      if (!fs.existsSync(featureFile)) continue;
      const w = detectGermanMarkers(fs.readFileSync(featureFile, 'utf8'), `features/${entry.name}/feature.md`);
      if (w) warnings.push(w);
    }
  }

  // Schema v1.1 (Wave 1) — VISION.md, WHEN PRESENT (FR-001/FR-002). Absence
  // is a no-op: no error, no entry in the output at all.
  const visionFile = path.join(dir, 'VISION.md');
  if (fs.existsSync(visionFile)) {
    const visionContent = fs.readFileSync(visionFile, 'utf8');
    const { fm: visionFm } = parseNestedFrontmatter(visionContent);
    const visionResult = validateVisionFm(visionFm);
    for (const e of visionResult.errors) errors.push(`VISION.md ${e}`);
    const w = detectGermanMarkers(visionContent, 'VISION.md');
    if (w) warnings.push(w);
  }

  // Schema v1.1 (Wave 2, FR-018) — the set of known ROADMAP.md feature ids,
  // used below to cross-check every audit finding's `feature` reference.
  // Built from the same `fm.features[]` already parsed above (roadmapResult
  // reads the same `fm`), so this adds no extra file read. Shared with the
  // Wave 4 write-time guard (`audit-set --feature`) via roadmapFeatureIdSet().
  const roadmapFeatureIds = roadmapFeatureIdSet(fm);

  // Schema v1.1 (Wave 1) — docs/product/audits/*.md, WHEN PRESENT
  // (FR-005/FR-006/FR-017). An absent or empty audits/ directory is a
  // no-op: no error, no entries in the output at all (FR-002 parity).
  const auditsDir = path.join(dir, 'audits');
  if (fs.existsSync(auditsDir)) {
    const auditFiles = fs.readdirSync(auditsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort();
    for (const name of auditFiles) {
      const auditFile = path.join(auditsDir, name);
      const auditContent = fs.readFileSync(auditFile, 'utf8');
      const { fm: auditFm } = parseNestedFrontmatter(auditContent);
      const auditResult = validateAuditFm(auditFm);
      for (const e of auditResult.errors) errors.push(`audits/${name} ${e}`);

      // FR-018: cross-check every non-null findings[].feature against
      // ROADMAP.md features[].id — the read-time twin of the write-time
      // guard `audit-set --feature` enforces (Wave 4). Only run this check
      // when the shape validation above already found `findings` to be a
      // well-formed array — an audit whose `findings` itself is malformed
      // already fails via auditResult.errors, so this avoids a confusing
      // second error class on the same root cause.
      if (Array.isArray(auditFm.findings)) {
        auditFm.findings.forEach((finding, i) => {
          const featureId = finding && finding.feature;
          if (featureId !== null && featureId !== undefined && !roadmapFeatureIds.has(featureId)) {
            errors.push(
              `audits/${name} findings[${i}].feature: references unknown ROADMAP.md feature id ${JSON.stringify(featureId)}`
            );
          }
        });
      }

      const w = detectGermanMarkers(auditContent, `audits/${name}`);
      if (w) warnings.push(w);
    }
  }

  const valid = errors.length === 0;
  process.stdout.write(JSON.stringify({ valid, errors, warnings, file: roadmapFile }, null, 2) + '\n');
  process.exit(valid ? 0 : 1);
}

// ---------------------------------------------------------------------------
// product import — migrate a legacy hand-rolled roadmap (either of the two
// observed shapes) into a valid schema-v1 docs/product/ROADMAP.md (FR-021,
// FR-022, SC-006, Wave 6).
//
// ONE code path handles both shapes (FR-021 AC: "via one code path, not one
// per consumer"): parseLegacyRoadmap() sniffs the shape, extracts a common
// intermediate representation (milestones + features + un-mappable notes),
// and a single normalizer turns that IR into schema-v1 frontmatter + body.
// Only the shape-specific EXTRACTION step branches; normalization, Appendix
// handling, and the write path are shared.
//
// Shape A — hand-written HTML (Niimo-style): a Frappe-Gantt page with a
//   `const tasks = [...]` JS array literal. Each task becomes one feature;
//   there is no milestone/status vocabulary in the source, so all tasks land
//   under one synthesized milestone and status is inferred from `progress`
//   (100 -> done, else planned) and `custom_class` (gate/active hints go to
//   the Appendix as free-text, since schema-v1 has no gate/blocker concept).
//
// Shape B — data.json + generator (A1/office-style): a JSON document with
//   `S4_phases.phases[].epics[].stories[]`. Each PHASE becomes one milestone;
//   each STORY becomes one feature (status mapped planned/doing/done ->
//   planned/in-flight/done). Story-point badges, epic groupings, and every
//   other S1/S2/S3/S5-S10 section (vision, live-status cards, SVG diagrams,
//   comparison tables, dispatch matrix, changelog) have no schema-v1 home and
//   are preserved verbatim in the Appendix (FR-022).
// ---------------------------------------------------------------------------

/** Detect which legacy shape `content` (already-read file text) matches.
 * Returns 'html-tasks' | 'data-json' | null (unrecognized). Pure. */
function detectLegacyRoadmapShape(content, filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.json') {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && parsed.S4_phases && Array.isArray(parsed.S4_phases.phases)) {
        return 'data-json';
      }
    } catch (_e) {
      // not valid JSON — fall through to null
    }
    return null;
  }
  if (/const\s+tasks\s*=\s*\[/.test(content)) {
    return 'html-tasks';
  }
  return null;
}

/** Extract a slug-safe id fragment from arbitrary source text (task id,
 * story text, …). Lowercases, strips non-alphanumerics to hyphens, trims
 * repeats/edges, and truncates so generated feature ids stay readable. */
function slugifyFragment(s, maxLen) {
  const slug = String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, maxLen || 40)
    // Truncation above can re-expose a trailing hyphen (or leave a
    // hyphen run) that the earlier trim already removed — trim again so
    // the result always satisfies FEATURE_ID_RE (###-kebab-slug, no
    // leading/trailing/doubled hyphens).
    .replace(/^-+|-+$/g, '');
  return slug || 'item';
}

/** Best-effort, non-executing normalization of a JS object/array literal
 * into strict JSON text: quotes bare identifier keys (`id:` -> `"id":`) and
 * drops trailing commas before `]`/`}`. Pure text transformation — no
 * code execution, no eval/Function/vm. Deliberately conservative: it does
 * NOT attempt to handle single-quoted strings, comments, or nested
 * template literals; inputs using those shapes are expected to fail the
 * subsequent JSON.parse and be rejected by the caller rather than silently
 * mis-normalized. */
function normalizeJsLiteralToJson(literal) {
  return literal
    // Bare/unquoted object keys: {id: "x"} / , key: -> "key":. Only matches
    // keys that are plain identifiers directly after `{` or `,` (optionally
    // across whitespace/newlines), so it never touches string contents.
    .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3')
    // Trailing commas before a closing bracket/brace.
    .replace(/,(\s*[\]}])/g, '$1');
}

/** Extract the `const tasks = [ {...}, {...} ]` JS array literal from a
 * Frappe-Gantt-style HTML page as plain objects, without a JS parser
 * dependency and WITHOUT executing any code: isolates the bracketed
 * literal text via brace-matching, then parses it as JSON (falling back to
 * a whitelisted, regex-only normalization pass for the common non-JSON JS
 * literal shapes — unquoted keys, trailing commas — before re-attempting
 * JSON.parse). If the literal still can't be parsed as JSON after
 * normalization, this fails hard rather than falling back to eval/
 * Function/vm — arbitrary code execution on attacker-controlled HTML input
 * is not an acceptable fallback (see security review finding: `new
 * Function` previously allowed RCE via a crafted `data.json`/HTML import
 * file, e.g. an IIFE with `process.mainModule.require(...)` embedded in a
 * task name). */
function extractTasksArrayLiteral(html) {
  const startMatch = /const\s+tasks\s*=\s*(\[)/.exec(html);
  if (!startMatch) return [];
  let depth = 0;
  let i = startMatch.index + startMatch[0].length - 1; // position of the '['
  const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  const literal = html.slice(start, i);

  try {
    return JSON.parse(literal);
  } catch (_e) {
    // Fall through to the whitelisted normalization pass below.
  }

  try {
    return JSON.parse(normalizeJsLiteralToJson(literal));
  } catch (_e) {
    fail(
      'product import: could not parse tasks array as JSON — unsupported HTML shape '
      + '(only JSON-compatible object/array literals are supported: double-quoted or '
      + 'bare-identifier keys, double-quoted string values, no comments, no computed '
      + 'values, no function calls)'
    );
  }
  return []; // unreachable — fail() exits the process
}

/** Shape A extraction: hand-written HTML (Niimo-style, Frappe-Gantt). Returns
 * the common IR: { milestones, features, appendixNotes }. */
function extractFromHtmlTasks(content, sourceLabel) {
  const tasks = extractTasksArrayLiteral(content);
  const titleMatch = /<title>([^<]*)<\/title>/.exec(content);
  const pageTitle = titleMatch ? titleMatch[1].trim() : 'Imported Roadmap';

  const milestoneId = 'migrated';
  const milestones = [{
    id: milestoneId,
    title: 'Migrated tasks',
    status: 'in-progress',
    target: null,
  }];

  const usedIds = new Set();
  const features = [];
  const appendixNotes = [];
  appendixNotes.push(`Source page title: ${pageTitle}`);

  tasks.forEach((t, idx) => {
    const baseSlug = slugifyFragment(t.id || t.name || `task-${idx + 1}`, 30);
    let slug = baseSlug;
    let n = 2;
    while (usedIds.has(slug)) { slug = `${baseSlug}-${n++}`; }
    usedIds.add(slug);
    const id = `${String(idx + 1).padStart(3, '0')}-${slug}`;

    const progress = typeof t.progress === 'number' ? t.progress : 0;
    const status = progress >= 100 ? 'done' : 'planned';
    const dependsOn = typeof t.dependencies === 'string' && t.dependencies.trim()
      ? t.dependencies.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    features.push({
      id,
      milestone: milestoneId,
      title: t.name || t.id || `Task ${idx + 1}`,
      status,
      stage: null,
      depends_on: [], // resolved to real feature ids in a second pass below
      started: typeof t.start === 'string' && YYYY_MM_DD_RE.test(t.start) ? t.start : null,
      finished: status === 'done' && typeof t.end === 'string' && YYYY_MM_DD_RE.test(t.end) ? t.end : null,
      spec_path: null,
      plan_path: null,
      _legacyTaskId: t.id || null,
      _legacyDependsOnRaw: dependsOn,
    });

    const extras = [];
    if (t.start || t.end) extras.push(`dates ${t.start || '?'} → ${t.end || '?'}`);
    if (t.custom_class) extras.push(`class=${t.custom_class}`);
    if (typeof t.progress === 'number' && t.progress !== 0 && t.progress !== 100) extras.push(`progress=${t.progress}%`);
    if (extras.length > 0) {
      appendixNotes.push(`**${id}** (${t.name || t.id}): ${extras.join(', ')}`);
    }
  });

  // Resolve legacy string dependency ids -> generated feature ids.
  const byLegacyId = new Map(features.map((f) => [f._legacyTaskId, f.id]));
  for (const f of features) {
    f.depends_on = f._legacyDependsOnRaw
      .map((legacyId) => byLegacyId.get(legacyId))
      .filter(Boolean);
    delete f._legacyTaskId;
    delete f._legacyDependsOnRaw;
  }

  // Legend/footer text has no schema home — preserve verbatim.
  const legendMatch = /<div class="legend">([\s\S]*?)<\/div>/.exec(content);
  if (legendMatch) {
    const legendText = legendMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (legendText) appendixNotes.push(`Legend: ${legendText}`);
  }
  const footerMatch = /<footer>([\s\S]*?)<\/footer>/.exec(content);
  if (footerMatch) {
    const footerText = footerMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (footerText) appendixNotes.push(`Footer note: ${footerText}`);
  }

  return {
    title: pageTitle,
    milestones,
    features,
    appendixNotes,
    source: `migrated from ${sourceLabel} (hand-written HTML, Frappe-Gantt)`,
  };
}

const DATAJSON_STORY_STATUS_MAP = { planned: 'planned', doing: 'in-flight', done: 'done' };

/** Shape B extraction: data.json + generator (A1/office-style). Returns the
 * common IR: { milestones, features, appendixNotes }. */
function extractFromDataJson(content, sourceLabel) {
  const data = JSON.parse(content);
  const pageTitle = (data.meta && data.meta.title) || 'Imported Roadmap';
  const phases = (data.S4_phases && data.S4_phases.phases) || [];

  const milestones = phases.map((p) => ({
    id: slugifyFragment(p.key || p.name, 20),
    title: p.name || p.key,
    status: 'planned',
    target: null,
  }));
  // If every story in a phase is done, the phase (milestone) is done; if any
  // story is doing/done, it's in-progress; otherwise it stays planned.
  phases.forEach((p, i) => {
    const stories = (p.epics || []).flatMap((e) => e.stories || []);
    const statuses = stories.map((s) => s.status);
    if (stories.length > 0 && statuses.every((s) => s === 'done')) milestones[i].status = 'done';
    else if (statuses.some((s) => s === 'done' || s === 'doing')) milestones[i].status = 'in-progress';
  });

  const usedIds = new Set();
  const features = [];
  const appendixNotes = [];
  appendixNotes.push(`Source document title: ${pageTitle} (${(data.meta && data.meta.version) || 'unversioned'})`);
  if (data.meta && data.meta.totalSP) appendixNotes.push(`Total story points (source): ${data.meta.totalSP} SP`);

  let featureSeq = 0;
  phases.forEach((p, pi) => {
    const milestoneId = milestones[pi].id;
    (p.epics || []).forEach((epic) => {
      const epicSpTotal = (epic.stories || []).reduce((a, s) => a + (s.sp || 0), 0);
      (epic.stories || []).forEach((story) => {
        featureSeq += 1;
        const baseSlug = slugifyFragment(story.text, 30);
        let slug = baseSlug;
        let n = 2;
        while (usedIds.has(slug)) { slug = `${baseSlug}-${n++}`; }
        usedIds.add(slug);
        const id = `${String(featureSeq).padStart(3, '0')}-${slug}`;
        const status = DATAJSON_STORY_STATUS_MAP[story.status] || 'planned';

        features.push({
          id,
          milestone: milestoneId,
          title: story.text,
          status,
          stage: null,
          depends_on: [],
          started: null,
          finished: null,
          spec_path: null,
          plan_path: null,
        });

        const extras = [`epic: ${epic.name}`, `agent: ${epic.agent || 'unassigned'}`, `${story.sp || 0} SP`];
        appendixNotes.push(`**${id}** (${story.text}): ${extras.join(', ')}`);
      });
      appendixNotes.push(`Epic "${epic.name}" total: ${epicSpTotal} SP, agent: ${epic.agent || 'unassigned'}`);
    });
  });

  // Whole sections with no schema-v1 home (vision, live-status, architecture
  // diagrams, EU-cloud comparison, repo-structure decisions, dispatch
  // matrix, next-steps, changelog) — preserve verbatim per-section (FR-022).
  const noHomeSections = [
    ['S1_vision', 'Vision'], ['S2_live', 'Was ist live'], ['S3_timeline', 'Timeline (SVG-rendered)'],
    ['S5_architecture', 'Architecture diagrams'], ['S6_eucloud', 'EU-Cloud comparison'],
    ['S7_repos', 'Repo-structure decisions'], ['S8_dispatch', 'Dispatch matrix'],
    ['S9_nextsteps', 'Next steps & open decisions'], ['S10_changelog', 'Source changelog'],
  ];
  for (const [key, label] of noHomeSections) {
    if (data[key]) {
      appendixNotes.push(`### ${label} (section \`${key}\`, verbatim JSON)\n\n\`\`\`json\n${JSON.stringify(data[key], null, 2)}\n\`\`\``);
    }
  }

  return {
    title: pageTitle,
    milestones,
    features,
    appendixNotes,
    source: `migrated from ${sourceLabel} (data.json + generator)`,
  };
}

/** ONE code path (FR-021): detect the legacy shape, extract via the
 * shape-specific extractor into a common IR, then normalize into schema-v1
 * roadmap frontmatter + body (with an Appendix section for un-mappable
 * content, FR-022). `project` is the target project slug (schema-v1
 * `project` field — distinct from any id/slug found in the source). Pure —
 * no I/O; caller handles file reads and the atomic write. Throws on an
 * unrecognized shape. */
function parseLegacyRoadmap(content, filePath, project) {
  const shape = detectLegacyRoadmapShape(content, filePath);
  if (!shape) {
    throw new Error(
      `unrecognized legacy roadmap shape in ${filePath} — expected either a hand-written HTML page ` +
      `with a Frappe-Gantt "const tasks = [...]" array, or a data.json with an "S4_phases.phases[]" array`
    );
  }

  const ir = shape === 'html-tasks'
    ? extractFromHtmlTasks(content, filePath)
    : extractFromDataJson(content, filePath);

  const today = nowIso().slice(0, 10);
  const roadmapFm = {
    schema_version: 1,
    type: 'roadmap',
    project,
    title: ir.title,
    status: 'active',
    updated: today,
    source: `${ir.source} (${today})`,
    milestones: ir.milestones,
    features: ir.features.map((f) => ({
      id: f.id, milestone: f.milestone, title: f.title, status: f.status, stage: f.stage,
      depends_on: f.depends_on, started: f.started, finished: f.finished,
      spec_path: f.spec_path, plan_path: f.plan_path,
    })),
    next: (() => {
      const firstEligible = ir.features.find((f) => f.status !== 'done' && f.status !== 'cancelled');
      return firstEligible ? firstEligible.id : null;
    })(),
  };

  const milestoneSections = ir.milestones.map((m) => {
    const feats = ir.features.filter((f) => f.milestone === m.id);
    const featLines = feats.map((f) => {
      const mark = f.status === 'done' ? 'x' : f.status === 'in-flight' ? '~' : ' ';
      const deps = f.depends_on.length > 0 ? ` (depends on: ${f.depends_on.join(', ')})` : '';
      return `- [${mark}] **${f.id}** — ${f.title}: migrated from legacy roadmap${deps}`;
    }).join('\n');
    return `### ${m.title} <!-- entry: ${m.id} -->\nStatus: ${m.status} · Target: ${m.target || 'unset'}\nGoal: migrated from legacy roadmap; goals were not explicit in the source.\n\n**Features:**\n${featLines || '(none)'}`;
  }).join('\n\n');

  const appendixBody = ir.appendixNotes.length > 0
    ? ir.appendixNotes.join('\n\n')
    : '(none)';

  const body = `\n# ${ir.title}\n\n> Migrated from a legacy roadmap format by \`a1-tools product import\`. Review milestone/feature titles and statuses for accuracy.\n\n## Milestones\n\n${milestoneSections}\n\n## In-flight features\n\nNone.\n\n## Changelog\n\n- **${today}** — roadmap migrated — ${ir.source}\n\n## Appendix — migrated details\n\n${appendixBody}\n`;

  return { roadmapFm, body, shape };
}

/** product import --file <path> --project <slug> [--title <t>] [--dir docs/product]:
 * migrate a legacy roadmap (hand-written HTML or data.json+generator shape,
 * auto-detected — FR-021) into a fresh schema-v1 docs/product/ROADMAP.md.
 * Un-mappable source content is preserved under '## Appendix — migrated
 * details' (FR-022). Validates its own output (SC-006 round-trip) before
 * writing — refuses (exit 1) if the generated frontmatter would fail
 * `product validate`. Writes through the same regenerateDerived +
 * writeAllOrNothing path as every other product-mutating command, so
 * index.json/NEXT.md regenerate correctly. Refuses to overwrite an existing
 * ROADMAP.md (same guard as `product init`) — mirrors its "not an update
 * command" contract. */
function cmdProductImport(args) {
  const flags = parseFlags(args, { file: 'value', project: 'value', title: 'value', dir: 'value' });
  if (!flags.file || !flags.project) {
    usage('product import requires --file <path-to-legacy-roadmap> --project <slug>');
  }
  const dir = productDirFromFlags(flags);
  const roadmapFile = path.join(dir, 'ROADMAP.md');
  // Source-file existence is not an overwrite guard on the locked target —
  // it's a precondition on the (unlocked, read-only) input path — so it can
  // stay ahead of the lock.
  if (!fs.existsSync(flags.file)) {
    fail(`product import: source file not found: ${flags.file}`);
  }

  const content = fs.readFileSync(flags.file, 'utf8');
  let parsed;
  try {
    parsed = parseLegacyRoadmap(content, flags.file, flags.project);
  } catch (e) {
    fail(`product import: ${e.message}`);
  }
  if (flags.title) parsed.roadmapFm.title = flags.title;

  const { valid, errors } = validateRoadmapFm(parsed.roadmapFm);
  if (!valid) {
    fail(`product import: generated ROADMAP.md would fail schema-v1 validation (internal bug — please report):\n${errors.join('\n')}`);
  }

  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  // Overwrite guard on the locked target MUST run inside the locked section
  // (TOCTOU fix): two concurrent `product import` runs could otherwise both
  // pass an existsSync check taken before either held the lock, and the
  // second to reach writeAllOrNothing would clobber the first's ROADMAP.md.
  if (fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product import: ${roadmapFile} already exists — refusing to overwrite (use add-milestone/add-feature to extend, or start from an empty --dir)`);
  }

  const roadmapFmStr = serializeNestedFrontmatter(parsed.roadmapFm, PRODUCT_ROADMAP_KEY_ORDER);
  const roadmapContent = `---\n${roadmapFmStr}\n---\n${parsed.body}`;
  const { indexJson, nextMd } = regenerateDerived(dir, parsed.roadmapFm);

  const writes = [
    { target: roadmapFile, content: roadmapContent },
    { target: path.join(dir, 'index.json'), content: JSON.stringify(indexJson, null, 2) + '\n' },
    { target: path.join(dir, 'NEXT.md'), content: nextMd },
  ];
  writeAllOrNothing(lockPath, writes, 'product import');

  const out = {
    status: 'OK',
    shape_detected: parsed.shape,
    project: flags.project,
    milestones: parsed.roadmapFm.milestones.length,
    features: parsed.roadmapFm.features.length,
    files_written: writes.map((w) => w.target),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

module.exports = {
  cmdProductStatus,
  cmdProductStage,
  cmdProductMarkers,
  cmdProductChangelog,
  cmdProductInit,
  cmdProductAddMilestone,
  cmdProductAddFeature,
  cmdProductFeatureInit,
  cmdProductImport,
  cmdProductValidate,
  cmdProductVisionInit,
  cmdProductVisionTouch,
  cmdProductAuditPublish,
  cmdProductAuditSet,
};
