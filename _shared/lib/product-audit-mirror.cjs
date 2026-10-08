'use strict';

// product audit-mirror: open audit findings -> ROADMAP features.

const fs = require('fs');
const path = require('path');
const { parseNestedFrontmatter, parseFlags, nowIso } = require('./io.cjs');
const { acquireReservationsLock, exitWithLock, failWithLock, writeAllOrNothing } = require('./locks.cjs');
const { usage } = require('./help.cjs');
const { productMirrorHook } = require('./vault-product-hook.cjs');
const { productDirFromFlags, buildRoadmapWritesWithChangelog } = require('./product-txn.cjs');

/** Zero-padded finding-number fragment ('F-007' -> 'f007', 'F-31' -> 'f031')
 * for the mirrored feature id `<###>-f<NNN>-<slug>` (FR-012). Pure. Falls
 * back to the raw digits (no re-padding) when the finding id doesn't carry
 * exactly the `F-\d+` shape validateAuditFm already enforces, so a malformed
 * finding id surfaces as an assertSlug rejection downstream rather than a
 * silent NaN here. */
function findingNumberSlug(findingId) {
  const m = /^F-(\d+)$/.exec(String(findingId || ''));
  if (!m) return String(findingId || '').toLowerCase();
  return `f${m[1].padStart(3, '0')}`;
}

/** Turn a finding's free-text `category` into a kebab-case slug fragment for
 * the mirrored feature id (FR-012's `<###>-f<NNN>-<slug>`). Pure. Lower-cases,
 * replaces every run of non-alphanumeric characters with a single '-', and
 * trims leading/trailing '-' — the same normalization shape `assertSlug`'s
 * PRODUCT_SLUG_RE accepts, so a mirrored id always passes the existing
 * feature-id validation without a special case. Falls back to 'finding' when
 * the category has no alphanumeric content at all (defensive; audit-publish
 * already defaults an unusable category to 'uncategorized' upstream). */
function categoryToSlug(category) {
  const slug = String(category || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'finding';
}

/** Compute the next available roadmap feature sequence number ('###') from
 * an already-parsed roadmap frontmatter's features[] — one past the highest
 * existing 3-digit prefix, zero-padded, matching the `<###>-slug` convention
 * every other feature id in ROADMAP.md already follows. Pure. Returns '001'
 * for an empty features[] (mirrors cmdProductInit's own first-feature
 * numbering intent, though init itself doesn't call this helper). */
function nextFeatureSequence(features) {
  let maxSeq = 0;
  for (const f of features) {
    const m = /^(\d{3})-/.exec(String(f.id || ''));
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
  }
  return String(maxSeq + 1).padStart(3, '0');
}

/** product audit-mirror --audit <path> --milestone <slug> [--only open]
 * [--all] [--dir]: generate one ROADMAP.md feature per SELECTED finding in
 * the target audit file (FR-012) — the automated form of the niimo 023-053
 * hand-loop. Composes the exact feature shape `cmdProductAddFeature` writes
 * (same field set/defaults), batched into ONE atomic write (one changelog
 * line for the whole mirror run) rather than N separate locked invocations,
 * since `cmdProductAddFeature` owns its own process.exit() and cannot be
 * called in a loop.
 *
 * Selection scope (FR-012): default (neither flag) is OPEN-ONLY
 * (`status === 'open'`); `--all` mirrors every finding regardless of status;
 * `--only open` is the explicit spelling of the same default, accepted for
 * symmetry with the brief's flag name but not required to get open-only
 * behavior. `--only` accepts only the literal value 'open' today (no other
 * scope keyword is defined by FR-012) — any other --only value is a usage
 * error, not a silent no-op.
 *
 * Per selected finding: feature id `<###>-f<NNN>-<slug>` (### = next
 * available roadmap sequence number, computed ONCE against the roadmap's
 * CURRENT features[] and then incremented per new feature so a multi-finding
 * run never reuses a sequence number across its own batch); title
 * `F-0NN: <category>`; status/dates derived from `fixed_commit` — non-null
 * `fixed_commit` -> status 'done', started/finished both set to the audit's
 * `date` field (the finding shape has no per-finding fixed-date field, and
 * `last_validated` is unsuitable — it is rewritten to "today" on EVERY
 * `audit-publish`/`audit-set` call, so a mirror run any time after the audit
 * was triaged would otherwise stamp every done feature with the mirror
 * run's own date rather than a stable historical one; `date` is set once at
 * publish time and never changes, matching how the niimo reference
 * migration used the audit's own analysis date for every fixed finding's
 * started/finished); null `fixed_commit` -> status 'planned', started/
 * finished both null. depends_on is always [] — audit-mirror does not infer
 * dependencies between mirrored findings.
 *
 * Idempotency (FR-013): a finding whose derived feature id ALREADY EXISTS in
 * ROADMAP.md's features[] is skipped (reported, not an error) rather than
 * re-added — a second full run against the same audit is a no-op with zero
 * duplicate ids.
 *
 * `--milestone <slug>` MUST already exist in ROADMAP.md's milestones[] —
 * hard-fails (non-zero exit, no feature written) before any write if it
 * doesn't, mirroring cmdProductAddFeature's own milestone-existence guard.
 * Milestone creation stays a deliberate `product add-milestone`/`a1-roadmap`
 * action, never a side effect of this command. */
function cmdProductAuditMirror(args) {
  const flags = parseFlags(args, { audit: 'value', milestone: 'value', only: 'value', all: 'bool', dir: 'value' });
  if (!flags.audit || !flags.milestone) {
    usage('product audit-mirror requires --audit <path> --milestone <milestone-slug> [--only open] [--all]');
  }
  if (flags.only !== undefined && flags.only !== 'open') {
    usage(`product audit-mirror --only must be 'open' (got: ${flags.only})`);
  }
  const mirrorAll = flags.all === true;

  const dir = productDirFromFlags(flags);
  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  const auditFile = path.resolve(flags.audit);
  if (!fs.existsSync(auditFile)) {
    failWithLock(lockPath, `product audit-mirror: ${auditFile} not found`);
  }
  const auditContent = fs.readFileSync(auditFile, 'utf8');
  const { fm: auditFm } = parseNestedFrontmatter(auditContent);
  const allFindings = Array.isArray(auditFm.findings) ? auditFm.findings : [];

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product audit-mirror: ${roadmapFile} not found (run \`product init\` first)`);
  }
  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm, body: roadmapBody } = parseNestedFrontmatter(roadmapContent);
  const milestones = Array.isArray(roadmapFm.milestones) ? roadmapFm.milestones : [];
  const existingFeatures = Array.isArray(roadmapFm.features) ? roadmapFm.features : [];

  // Hard-fail on an unknown --milestone BEFORE any feature is derived or
  // written (Edge Case / FR-012) — milestone creation is never a side effect
  // of audit-mirror.
  if (!milestones.some((m) => m.id === flags.milestone)) {
    failWithLock(
      lockPath,
      `product audit-mirror: milestone '${flags.milestone}' does not exist in ${roadmapFile} — ` +
        'add it first via `product add-milestone` (audit-mirror never creates milestones)'
    );
  }

  const selectedFindings = mirrorAll
    ? allFindings
    : allFindings.filter((f) => f.status === 'open');

  // Idempotency (FR-013) keys on the `f<NNN>-<slug>` SUFFIX of the mirrored
  // id, not the full `<###>-f<NNN>-<slug>` id — the leading `###` sequence
  // number is assigned fresh on every run (next available slot at the time
  // of the call) and would therefore never collide with a prior run's ids
  // even for the SAME finding, defeating the duplicate check entirely if the
  // full id were used as the dedupe key. Every already-existing feature id
  // that CONTAINS an `f<NNN>-` fragment is indexed by that fragment so a
  // second full run recognizes "this finding was already mirrored" and skips
  // it, regardless of which sequence number it originally landed on.
  const mirroredSuffixSeen = new Set();
  for (const f of existingFeatures) {
    const m = /^\d{3}-(f\d+-.+)$/.exec(String(f.id || ''));
    if (m) mirroredSuffixSeen.add(m[1]);
  }

  let nextSeq = parseInt(nextFeatureSequence(existingFeatures), 10);

  const newFeatures = [];
  const mirrored = [];
  const skipped = [];
  for (const finding of selectedFindings) {
    const slug = `${findingNumberSlug(finding.id)}-${categoryToSlug(finding.category)}`;

    if (mirroredSuffixSeen.has(slug)) {
      skipped.push({ finding: finding.id, feature: `*-${slug}`, reason: 'already mirrored' });
      continue;
    }

    const candidateId = `${String(nextSeq).padStart(3, '0')}-${slug}`;
    const isFixed = finding.fixed_commit !== null && finding.fixed_commit !== undefined;
    const derivedDate = auditFm.date !== undefined ? auditFm.date : null;

    const newFeature = {
      id: candidateId,
      milestone: flags.milestone,
      title: `${finding.id}: ${finding.category}`,
      status: isFixed ? 'done' : 'planned',
      stage: null,
      depends_on: [],
      started: isFixed ? derivedDate : null,
      finished: isFixed ? derivedDate : null,
      spec_path: null,
      plan_path: null,
    };

    newFeatures.push(newFeature);
    mirroredSuffixSeen.add(slug);
    mirrored.push({ finding: finding.id, feature: candidateId });
    nextSeq += 1;
  }

  if (newFeatures.length === 0) {
    // Nothing to write — still a successful (idempotent) run, not an error
    // (FR-013: a fully-already-mirrored re-run must be a no-op, exit 0).
    const out = {
      status: 'OK',
      audit_file: auditFile,
      milestone: flags.milestone,
      mirrored: [],
      skipped,
      files_written: [],
      vault_mirror: productMirrorHook(dir).afterCommit(),
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    exitWithLock(lockPath, 0);
    return;
  }

  const updatedRoadmapFm = {
    ...roadmapFm,
    updated: nowIso().slice(0, 10),
    features: [...existingFeatures, ...newFeatures],
  };

  const { writes } = buildRoadmapWritesWithChangelog(
    dir,
    updatedRoadmapFm,
    roadmapBody,
    `audit-mirror: ${newFeatures.length} feature(s) mirrored from ${path.basename(auditFile)}`,
    `finding(s) ${mirrored.map((m) => m.finding).join(', ')} mirrored into milestone '${flags.milestone}' via \`product audit-mirror\``
  );
  const vaultMirror = writeAllOrNothing(lockPath, writes, 'product audit-mirror', productMirrorHook(dir));

  const out = {
    status: 'OK',
    audit_file: auditFile,
    milestone: flags.milestone,
    mirrored,
    skipped,
    files_written: writes.map((w) => w.target),
    vault_mirror: vaultMirror,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

module.exports = {
  cmdProductAuditMirror,
};
