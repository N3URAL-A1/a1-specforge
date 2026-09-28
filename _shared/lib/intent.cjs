'use strict';

// ---------------------------------------------------------------------------
// intent — facade of the intent queue modules (spec 011-intent-queue-consumer).
// Pure re-exports, one line per module; each later wave appends its own line
// and nothing else. The CLI router is intent-cli.cjs, not this file.
// ---------------------------------------------------------------------------

const {
  INTENT_ACTIONS, INTENT_STATUSES, INTENT_REJECT_REASONS, INTENT_FAILURE_REASONS, INTENT_REFUSAL_CODES,
} = require('./status-constants.cjs');

module.exports = {
  INTENT_ACTIONS, INTENT_STATUSES, INTENT_REJECT_REASONS, INTENT_FAILURE_REASONS, INTENT_REFUSAL_CODES,
  ...require('./intent-constants.cjs'), // Wave 1: limits, key sets, ACTION_TABLE
  ...require('./intent-validate.cjs'), // Wave 1: parser, shape/id/action/project checks
  ...require('./intent-sign.cjs'), // Wave 3: canonicalString, sign, verify, checkFreshness, checkAuthenticity
  ...require('./intent-ledger.cjs'), // Wave 4: fail-closed replay ledger + ledger lock
  ...require('./intent-log.cjs'), // Wave 4: logDecision (decision log, never the payload)
  ...require('./intent-lifecycle.cjs'), // Wave 4: executorConfig, claimIntent, rejectIntent
  ...require('./intent-result.cjs'), // Wave 5: redact, snapshotProject, buildResultNote, completeIntent
  ...require('./intent-devices.cjs'), // Wave 3: device registry
  ...require('./intent-seal.cjs'), // Wave 5b: sealPlugin, verifySeal, rootHash
  ...require('./intent-schema.cjs'), // Wave 9: buildSchemaDocument, cmdIntentSchema (FR-035)
  ...require('./intent-approval.cjs'), // Wave 10: approval audit group rules (FR-045)
  ...require('./intent-approve.cjs'), // Wave 10: readApprovalTarget, reapproveIntent, cmdIntentApprove (FR-015)
  ...require('./intent-doctor.cjs'), // Wave 10: runDoctor, cmdIntentDoctor, injectDoctorDeps (FR-037)
  ...require('./intent-argv.cjs'), // Wave 6B: buildArgv, buildStageArgv, buildEnv, guardArgv, guardStageArgv (FR-021, FR-022, FR-039)
  ...require('./intent-worktree.cjs'), // Wave 6B: createIntentWorktree, finishIntentWorktree (FR-043)
  runIntent: require('./intent-run.cjs').runIntent, // Wave 6B: FR-020
};
