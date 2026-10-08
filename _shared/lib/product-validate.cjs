'use strict';

// product validate and the frontmatter validators it runs.

const fs = require('fs');
const path = require('path');
const { parseNestedFrontmatter, parseFlags } = require('./io.cjs');
const { PROJECT_STATUSES, MILESTONE_STATUSES, FEATURE_STATUSES, FEATURE_STAGES } = require('./status-constants.cjs');
const { PRODUCT_SLUG_RE, FEATURE_ID_RE, YYYY_MM_RE, YYYY_MM_DD_RE, parseInlineFlowObject } = require('./product-schema.cjs');
const { roadmapFeatureIdSet } = require('./product-derived.cjs');
const { productDirFromFlags } = require('./product-txn.cjs');

// ---------------------------------------------------------------------------
// product validate — schema-v1 frontmatter validation (FR-021 round-trip
// oracle; also usable standalone). Hand-rolled against the contract in
// docs/product/SCHEMA.md section 1 / docs/product/index.schema.json — this
// module has zero npm dependencies (see its require() list), so this is
// a purpose-built checker rather than a generic JSON-Schema engine. Field
// names/rules are kept in lockstep with index.schema.json by design; if that
// file's contract changes, update both.
// ---------------------------------------------------------------------------

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
  const flags = parseFlags(args, { dir: 'value', 'spec-status': 'bool' });
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
  // Spec 010 W7 (FR-028): `--spec-status` adds the spec↔roadmap coherence section; without it the output is unchanged.
  const coherence = flags['spec-status'] ? { spec_status: require('./spec-coherence.cjs').specStatusSection(fm) } : {};
  process.stdout.write(JSON.stringify({ valid, errors, warnings, file: roadmapFile, ...coherence }, null, 2) + '\n');
  process.exit(valid && !(coherence.spec_status && coherence.spec_status.violations.length > 0) ? 0 : 1);
}

module.exports = {
  validateRoadmapFm,
  cmdProductValidate,
};
