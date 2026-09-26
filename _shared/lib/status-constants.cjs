'use strict';

const SPEC_STATUSES = new Set([
  'discovering',
  'draft',
  'clarified',
  'planned',
  'awaiting-consistency-fix',
  'implementing',
  'done',
  'cancelled',
]);

const BUG_STATUSES = new Set([
  'reported',
  'diagnosed',
  'fixing',
  'fixed',
  'cant-reproduce',
  'wont-fix',
  'duplicate',
  'cancelled',
]);

const BUG_SEVERITIES = new Set(['blocker', 'major', 'minor', 'nit']);

const ANALYSIS_STATUSES = new Set([
  'scoped',
  'discovered',
  'analyzed',
  'synthesized',
  'reported',
  'cancelled',
]);

const ANALYSIS_FOCUSES = new Set([
  'general',
  'security',
  'architecture',
  'quality',
  'onboarding',
]);

const ANALYSIS_SEVERITIES = new Set(['BLOCKER', 'MAJOR', 'MINOR']);

const CONSTITUTION_STATUSES = new Set([
  'discovering',
  'drafted',
  'reviewed',
  'written',
  'cancelled',
]);

const RECONCILE_STATUSES = new Set([
  'scoped',
  'parsed',
  'probed',
  'reported',
  'cancelled',
]);

const RECONCILE_SCOPE_MODES = new Set(['single', 'project', 'vault-sync']);

const RECONCILE_DRIFT_CLASSES = new Set([
  'MISSING',
  'EXTRA',
  'DIVERGED',
  'STALE',
]);

const MODERNIZE_STATUSES = new Set([
  'scoped',
  'spec-drafted',
  'gap-analyzed',
  'proposals-pending',
  'planned',
  'executing',
  'executed',
  'published',
  'cancelled',
]);

const MODERNIZE_MODES = new Set(['full', 'spec-only']);

const MODERNIZE_PROPOSAL_DECISIONS = new Set([
  'approved',
  'rejected',
  'deferred',
]);

const MODERNIZE_WAVE_STATUSES = new Set([
  'planned',
  'snapshotted',
  'implementing',
  'testing',
  'verifying',
  'done',
  'blocked',
]);

// ---------------------------------------------------------------------------
// Vault cockpit contract (spec 010-vault-cockpit-contract, Wave 1). This file
// is the ONE owner of every vocabulary the cockpit (obsidian-lumen) reads
// through `a1-tools schema export --json`. Any change to a value or shape
// below MUST bump VAULT_CONTRACT_VERSION in the same commit and regenerate
// _test-fixtures/a1-vault-cockpit/golden/schema-export.v<N>.json (FR-021).
// ---------------------------------------------------------------------------

const VAULT_CONTRACT_VERSION = 1;

// FR-016 — a1 subfolder under project/<slug>/ → canonical frontmatter `type:`.
// Measured values are canonical (decided 2026-09-24); only `spec` is new.
const ARTIFACT_TYPES = Object.freeze({
  spec: 'spec',
  plans: 'wave-plan',
  fixes: 'bug-report',
  postmortems: 'postmortem',
  analyses: 'project-analysis',
  quick: 'quick-run',
});

// FR-027 — spec status → roadmap feature status (one entry per SPEC_STATUSES
// member, declared in the same order).
const SPEC_TO_ROADMAP_STATUS = Object.freeze({
  discovering: 'planned',
  draft: 'planned',
  clarified: 'planned',
  planned: 'planned',
  'awaiting-consistency-fix': 'in-flight',
  implementing: 'in-flight',
  done: 'done',
  cancelled: 'cancelled',
});

// Size-triage classes (spec set-size; moved here from spec.cjs in Wave 1).
const SPEC_SIZES = new Set(['S', 'M', 'L']);

// Quick-lane run-record `result:` (skills/a1-quick/templates/run-record-template.md).
const QUICK_RESULTS = new Set(['in-progress', 'completed', 'escalated']);

// Roadmap enums (docs/product/SCHEMA.md §1; moved here from product.cjs in
// Wave 1 — `product validate` imports them back, behaviour unchanged).
const PROJECT_STATUSES = new Set(['active', 'paused', 'done']);
const MILESTONE_STATUSES = new Set(['done', 'in-progress', 'planned']);
const FEATURE_STATUSES = new Set(['done', 'in-flight', 'planned', 'cancelled']);
const FEATURE_STAGES = new Set([null, 'started', 'complete', 'review', 'verify', 'merge', 'origin-cleanup', 'done']);

module.exports = {
  SPEC_STATUSES, BUG_STATUSES, BUG_SEVERITIES,
  ANALYSIS_STATUSES, ANALYSIS_FOCUSES, ANALYSIS_SEVERITIES,
  CONSTITUTION_STATUSES,
  RECONCILE_STATUSES, RECONCILE_SCOPE_MODES, RECONCILE_DRIFT_CLASSES,
  MODERNIZE_STATUSES, MODERNIZE_MODES, MODERNIZE_PROPOSAL_DECISIONS, MODERNIZE_WAVE_STATUSES,
  VAULT_CONTRACT_VERSION, ARTIFACT_TYPES, SPEC_TO_ROADMAP_STATUS,
  SPEC_SIZES, QUICK_RESULTS,
  PROJECT_STATUSES, MILESTONE_STATUSES, FEATURE_STATUSES, FEATURE_STAGES,
};
