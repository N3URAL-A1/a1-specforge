'use strict';

// product init | add-milestone | add-feature | feature-init.

const fs = require('fs');
const path = require('path');
const { parseNestedFrontmatter, serializeNestedFrontmatter, parseFlags, nowIso } = require('./io.cjs');
const { acquireReservationsLock, exitWithLock, failWithLock, writeAllOrNothing } = require('./locks.cjs');
const { usage } = require('./help.cjs');
const { productMirrorHook } = require('./vault-product-hook.cjs');
const { PRODUCT_ROADMAP_KEY_ORDER, PRODUCT_FEATURE_KEY_ORDER } = require('./product-schema.cjs');
const { regenerateDerived } = require('./product-derived.cjs');
const { assertSlug, productDirFromFlags, buildRoadmapWritesWithChangelog } = require('./product-txn.cjs');

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
  const vaultMirror = writeAllOrNothing(lockPath, writes, 'product init', productMirrorHook(dir));

  const out = { status: 'OK', project: flags.project, files_written: writes.map((w) => w.target), vault_mirror: vaultMirror };
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
  const vaultMirror = writeAllOrNothing(lockPath, writes, 'product add-milestone', productMirrorHook(dir));

  const out = { status: 'OK', milestone: flags.id, files_written: writes.map((w) => w.target), vault_mirror: vaultMirror };
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
  const vaultMirror = writeAllOrNothing(lockPath, writes, 'product add-feature', productMirrorHook(dir));

  const out = { status: 'OK', feature: flags.id, files_written: writes.map((w) => w.target), vault_mirror: vaultMirror };
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
  const vaultMirror = writeAllOrNothing(lockPath, writes, 'product feature-init', productMirrorHook(dir));

  const out = { status: 'OK', feature: flags.id, files_written: writes.map((w) => w.target), vault_mirror: vaultMirror };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

module.exports = {
  cmdProductInit,
  cmdProductAddMilestone,
  cmdProductAddFeature,
  cmdProductFeatureInit,
};
