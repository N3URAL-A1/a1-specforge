'use strict';

// product status | stage | markers | changelog.

const fs = require('fs');
const path = require('path');
const { parseNestedFrontmatter, serializeNestedFrontmatter, parseFlags, fail, nowIso } = require('./io.cjs');
const { acquireReservationsLock, exitWithLock, failWithLock, writeAllOrNothing, loadReservations } = require('./locks.cjs');
const { usage } = require('./help.cjs');
const { productMirrorHook } = require('./vault-product-hook.cjs');
const { CODE_SCOPE_STAGES } = require('./code-scope.cjs');
const { PRODUCT_ROADMAP_KEY_ORDER, PRODUCT_FEATURE_KEY_ORDER } = require('./product-schema.cjs');
const { readProductRoadmap, readProductFeature, regenerateDerived } = require('./product-derived.cjs');
const { productDirFromFlags, buildRoadmapWritesWithChangelog } = require('./product-txn.cjs');

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

  const vaultMirror = writeAllOrNothing(lockPath, writes, 'product stage', productMirrorHook(dir));
  void updatedRoadmapContent;

  const out = {
    status: 'OK',
    feature: id,
    stage: targetStage,
    derived_status: derivedStatus,
    skipped,
    files_written: writes.map((w) => w.target),
    vault_mirror: vaultMirror,
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
  const vaultMirror = writeAllOrNothing(lockPath, writes, 'product markers', productMirrorHook(dir));

  const out = {
    status: 'OK',
    level: flags.level,
    id: flags.id || null,
    set: flags.set,
    files_written: writes.map((w) => w.target),
    vault_mirror: vaultMirror,
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
  const vaultMirror = writeAllOrNothing(lockPath, writes, 'product changelog', productMirrorHook(dir));

  const out = { status: 'OK', entry: flags.entry, why: flags.why, files_written: writes.map((w) => w.target), vault_mirror: vaultMirror };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

module.exports = {
  cmdProductStatus,
  cmdProductStage,
  cmdProductMarkers,
  cmdProductMarkersSet,
  cmdProductChangelog,
};
