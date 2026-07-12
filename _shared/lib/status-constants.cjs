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

module.exports = {
  SPEC_STATUSES, BUG_STATUSES, BUG_SEVERITIES,
  ANALYSIS_STATUSES, ANALYSIS_FOCUSES, ANALYSIS_SEVERITIES,
  CONSTITUTION_STATUSES,
  RECONCILE_STATUSES, RECONCILE_SCOPE_MODES, RECONCILE_DRIFT_CLASSES,
  MODERNIZE_STATUSES, MODERNIZE_MODES, MODERNIZE_PROPOSAL_DECISIONS, MODERNIZE_WAVE_STATUSES,
};
