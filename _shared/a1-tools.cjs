#!/usr/bin/env node
/**
 * a1-tools.cjs — shared deterministic file-ops helper for a1-* skills.
 *
 * Subcommand hierarchy:
 *
 *   a1-tools spec next-number <project-slug>
 *       → JSON { project, next, padded, dir }
 *
 *   a1-tools spec update-status <spec-path> <new-status> [flags]
 *       Flags:
 *         --wave-plan-path <path>         set frontmatter wave_plan_path
 *         --verify-failures-file <path>   replace verify_failures with JSON array from file
 *         --clear-verify-failures         set verify_failures to []
 *       → JSON { spec_path, status, phase_history, wave_plan_path, verify_failures }
 *
 *   a1-tools spec list <project-slug> [--status=<s>]
 *       → JSON { project, count, specs: [...] }
 *
 *   a1-tools fix next-suffix <project-slug> <YYYY-MM-DD>
 *       → JSON { project, date, suffix, padded, dir }
 *         suffix is "" for first bug of day, "-2" / "-3" for follow-ups.
 *
 *   a1-tools fix update-status <bug-path> <new-status> [flags]
 *       Flags:
 *         --recommended-code-agent <name>  set frontmatter recommended_code_agent
 *         --fix-commit <hash>              set frontmatter fix_commit
 *         --verify-result <text>           set frontmatter verify_result (string)
 *         --duplicate-of <path>            set frontmatter duplicate_of
 *       → JSON { bug_path, status, phase_history, ...changed }
 *
 *   a1-tools fix list <project-slug> [--status=<s>] [--severity=<s>]
 *       → JSON { project, count, bugs: [...] }
 *
 *   a1-tools fix find-duplicates <project-slug> <symptom-keywords...>
 *       → JSON { project, window_days: 30, matches: [...] }
 *         grep over projects/<slug>/fixes/*.md within 30 days, case-insensitive.
 *
 *   a1-tools fix integrity-check [--agents-dir <abs>] [--skills-dir <abs>]
 *       → JSON { status: "ok"|"mismatch"|"bootstrapped", mismatches: [], files_checked }
 *         On first run: bootstraps wiki/_canonical/agents.lock.json from current state.
 *         On subsequent runs: compares SHA256 hashes. status="mismatch" means skill STOPS.
 *
 *   a1-tools fix init-postmortem <bug-slug> <project-slug> [flags]
 *       Flags: --date --severity --root-cause-class --terminal-status --one-line-learning
 *              --fix-wave-count --diagnosis-rounds --phase-friction --quak-regression
 *              --fix-required-test-first
 *       → JSON { path, project, bug_slug, date, filename }
 *         Creates wiki/postmortems/<project>/<date>-<bug-slug>.md with YAML frontmatter.
 *
 *   a1-tools fix count-postmortems-since --since <ISO-timestamp>
 *       → JSON { count, since, files: [...] }
 *         Counts postmortem files in wiki/postmortems/ modified after the given timestamp.
 *
 *   a1-tools fix update-promote-state [--at <ISO-timestamp>]
 *       → JSON { last_promote_at, path }
 *         Writes wiki/_state/last_promote.json with promote timestamp.
 *
 *   a1-tools fix write-suggestion <agent-name> [--title <t>] [--body-file <path>|--body <text>]
 *                                              [--source-postmortem <path>] [--skill <name>]
 *       → JSON { path, agent, title, date, filename }
 *         Creates wiki/lessons/<agent>/_suggestions/<date>-<slug>.md. NEVER writes _active.md.
 *
 *   a1-tools analyze next-slot <project-slug> <focus> [--date YYYY-MM-DD]
 *       → JSON { project, focus, date, suffix, filename, path, dir }
 *
 *   a1-tools analyze init <project-slug> <focus> [flags]
 *       Flags: --project-path <abs> --date <YYYY-MM-DD> --title <text>
 *       → JSON { path, project, focus, status }
 *         Creates analyses/<date>-<focus>[-N].md with status=scoped.
 *
 *   a1-tools analyze update-status <analysis-path> <new-status> [--phase-data <json>]
 *       phase-data is merged into frontmatter based on target status:
 *         discovered → fills `discover` from object
 *         analyzed   → fills `agents_dispatched` from .agents_dispatched[]
 *         synthesized → fills `findings_count` from .findings_count
 *         reported   → fills `suggested_next` from .suggested_next[]
 *       → JSON { analysis_path, status, phase_history, ... }
 *
 *   a1-tools analyze discover <project-path>
 *       → JSON { tech_stack[], loc, file_count, last_commit, branch, commit_count_30d }
 *
 *   a1-tools analyze add-finding <analysis-path> <severity> <category> <location> <description> [--recommendation <text>]
 *       severity: BLOCKER | MAJOR | MINOR
 *       → JSON { analysis_path, finding_id, total_findings }
 *
 *   a1-tools analyze add-findings <analysis-path> --json <file|->
 *       batch mode: JSON array of {severity, category, location, description, recommendation?}
 *       '-' reads from stdin. Single atomic write, no shell-quoting pitfalls.
 *       → JSON { analysis_path, finding_ids[], added, total_findings }
 *
 *   a1-tools analyze list <project-slug> [--status=<s>] [--focus=<s>]
 *       → JSON { project, count, analyses: [...] }
 *
 *   a1-tools constitution init <project-slug> [--title <text>]
 *       → JSON { path, project, status, version }
 *
 *   a1-tools constitution discover <project-slug> [--project-path <abs>]
 *       → JSON { project, project_path, claudemd_present, claudemd_excerpt,
 *                repo_constitution_present, global_rules: [...],
 *                has_link_to_constitution }
 *
 *   a1-tools constitution update-status <constitution-path> <new-status>
 *       → JSON { constitution_path, status, version, phase_history, last_written_at }
 *
 *   a1-tools constitution set-body <constitution-path> --body-file <path>
 *       → JSON { constitution_path, body_bytes }
 *
 *   a1-tools constitution next-version <project-slug>
 *       → JSON { project, next, history_dir }
 *
 *   a1-tools constitution archive-current <project-slug> [--date YYYY-MM-DD]
 *       → JSON { project, snapshot, new_version }
 *         Copies current constitution.md to history/YYYY-MM-DD-vN.md,
 *         increments version in live file.
 *
 *   a1-tools constitution write-mirror <project-slug> --repo-root <abs>
 *       → JSON { project, mirror_path, bytes, version }
 *         Writes stripped-down mirror to <repo-root>/constitution.md atomically.
 *
 *   a1-tools constitution link-claudemd <project-slug> --repo-root <abs>
 *       → JSON { project, claudemd_path, action: 'appended' | 'updated' }
 *         Idempotent: managed block delimited by HTML comment markers.
 *
 *   a1-tools constitution list [--status=<s>]
 *       → JSON { count, constitutions: [...] }
 *
 *   a1-tools schema-check run --migrations <dir> [--tables t1,t2]
 *                             [--trigger-pattern 'audit|log'] [--json]
 *       Deterministic schema pre-gate (audit trigger, RLS, FK type match).
 *       Owns exit code: 0 pass, 1 findings, 2 error.
 *
 *   a1-tools schema-check parse --migrations <dir> [--json]
 *       → JSON schema model { files, tables, triggers, rls, skippedStatements }
 *         Debug mode for the bounded SQL parser (see supported subset in HELP).
 *
 *   a1-tools cost run --project <claude-projects-dir> [--since ISO] [--until ISO] [--json]
 *       Token spend aggregation per session (+ sub-agent logs), dedup by
 *       message.id. Contract: _shared/cost-format-notes.md.
 *       Owns exit code: 0 ok, 2 error.
 *
 *   a1-tools realpath-check run --diff-base <git-ref> [--project <dir>]
 *                               [--evidence <file>] [--real-markers <pattern>] [--json]
 *       Gate 0.7 — kills the mock-test blind spot. Greps the wave diff for
 *       real-backend surfaces (SQL / RLS / external HTTP) and, if any are
 *       present, requires a test-evidence file proving each category ran
 *       against the real backend (non-mock output + real-execution marker).
 *       Owns exit code: 0 pass (no surfaces or all proven), 1 lacking proof,
 *       2 bad args / no git.
 *
 *   a1-tools check reservations --claim <type>:<value> --by <spec-id> [--file <path>]
 *   a1-tools check reservations --list [--file <path>]
 *       P7 cross-run coordination registry (.a1/reservations.json). Claim a
 *       migration number / route / etc. for a spec. Claiming a value already
 *       held by ANOTHER spec → exit 1 (holder info). Same spec re-claim → exit 0
 *       (idempotent). Atomic tmp+rename write.
 *
 * Learning store root: repo-local ".a1/learnings/" by default; env
 * A1_VAULT_ROOT overrides this to point at an external vault (e.g. Obsidian).
 * All writes are atomic: read → modify → write to <path>.tmp.<pid> → rename.
 *
 * Exit codes: 0 success, 1 user/usage error, 2 internal error.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- valid status sets (lib/status-constants.cjs) ----------
const {
  SPEC_STATUSES, BUG_STATUSES, BUG_SEVERITIES,
  ANALYSIS_STATUSES, ANALYSIS_FOCUSES, ANALYSIS_SEVERITIES,
  CONSTITUTION_STATUSES,
  RECONCILE_STATUSES, RECONCILE_SCOPE_MODES, RECONCILE_DRIFT_CLASSES,
  MODERNIZE_STATUSES, MODERNIZE_MODES, MODERNIZE_PROPOSAL_DECISIONS, MODERNIZE_WAVE_STATUSES,
} = require(path.join(__dirname, 'lib', 'status-constants.cjs'));

// ---------- core I/O, frontmatter parsing, flag parsing (lib/io.cjs) ----------
const {
  vaultRoot,
  resolveVaultPath,
  parseFrontmatter,
  serializeScalar,
  detectKeyOrder,
  serializeFrontmatter,
  readMd,
  writeMdAtomic,
  nowIso,
  writeTextAtomic,
  parseScalarToken,
  parseNestedFrontmatter,
  serializeNestedFrontmatter,
  writeNestedMdAtomic,
  parseFlags,
  fail,
} = require(path.join(__dirname, 'lib', 'io.cjs'));

// ---------- reservations lock machinery + transactional writes (lib/locks.cjs) ----------
const {
  writeJsonAtomic,
  acquireReservationsLock,
  releaseReservationsLock,
  exitWithLock,
  failWithLock,
  reservationsFile,
  loadReservations,
  isLockStale,
  isPidDead,
  sleepSyncMs,
  writeAllOrNothing,
} = require(path.join(__dirname, 'lib', 'locks.cjs'));

// ---------- safe git exec (argv-array, no shell) + metachar guard (lib/git-safe.cjs) ----------
const { gitSafe, assertNoShellMetachar } = require(path.join(__dirname, 'lib', 'git-safe.cjs'));


// ---------- product command group (lib/product.cjs, lazily required below) ----------


// ---------- spec group (lib/spec.cjs) ----------
const {
  appendPhaseHistory,
  cmdSpecNextNumber,
  cmdSpecUpdateStatus,
  cmdSpecSetSize,
  cmdSpecList,
} = require(path.join(__dirname, 'lib', 'spec.cjs'));

// ---------- fix group (lib/fix.cjs) ----------
const {
  cmdFixNextSuffix,
  cmdFixUpdateStatus,
  cmdFixList,
  cmdFixFindDuplicates,
  cmdFixIntegrityCheck,
  cmdFixInitPostmortem,
  cmdFixCountPostmortemsSince,
  cmdFixUpdatePromoteState,
  cmdFixWriteSuggestion,
} = require(path.join(__dirname, 'lib', 'fix.cjs'));

// ---------- analyze group (lib/analyze.cjs) ----------
const {
  cmdAnalyzeNextSlot,
  cmdAnalyzeInit,
  cmdAnalyzeUpdateStatus,
  cmdAnalyzeDiscover,
  cmdAnalyzeAddFinding,
  cmdAnalyzeAddFindings,
  cmdAnalyzeList,
} = require(path.join(__dirname, 'lib', 'analyze.cjs'));

// ---------- constitution group (lib/constitution.cjs) ----------
const {
  cmdConstitutionInit,
  cmdConstitutionDiscover,
  cmdConstitutionUpdateStatus,
  cmdConstitutionSetBody,
  cmdConstitutionNextVersion,
  cmdConstitutionArchiveCurrent,
  cmdConstitutionWriteMirror,
  cmdConstitutionLinkClaudemd,
  cmdConstitutionList,
} = require(path.join(__dirname, 'lib', 'constitution.cjs'));

// ---------- checklist group (lib/checklist.cjs) ----------
const { cmdChecklistRun, cmdChecklistList } = require(path.join(__dirname, 'lib', 'checklist.cjs'));

// ---------- worktree group (lib/worktree.cjs) ----------
const {
  cmdWorktreePrepare,
  cmdWorktreeEnter,
  cmdWorktreeStatus,
  cmdWorktreeExit,
  cmdWorktreeList,
  cmdWorktreeGc,
  cmdWorktreeAdopt,
  cmdWorktreeReconcile,
} = require(path.join(__dirname, 'lib', 'worktree.cjs'));

// ---------- pr group (lib/pr.cjs) ----------
const {
  cmdPrListHandoff,
  cmdPrMarkStatus,
  cmdPrMarkPrOpen,
  cmdPrFindingsSummary,
} = require(path.join(__dirname, 'lib', 'pr.cjs'));

// ---------- modernize group (lib/modernize.cjs) ----------
const {
  cmdModernizeNextSlot,
  cmdModernizeInit,
  cmdModernizeUpdateStatus,
  cmdModernizeDiscoverStack,
  cmdModernizeAddProposal,
  cmdModernizeApproveProposal,
  cmdModernizeAddWave,
  cmdModernizeSnapshotBehavior,
  cmdModernizeStartWave,
  cmdModernizeCompleteWave,
  cmdModernizeVerifyParity,
  cmdModernizePublishNotion,
  cmdModernizeList,
} = require(path.join(__dirname, 'lib', 'modernize.cjs'));

// ---------- reconcile group (lib/reconcile.cjs) ----------
const {
  cmdReconcileNextSlot,
  cmdReconcileInit,
  cmdReconcileParseSpec,
  cmdReconcileUpdateStatus,
  cmdReconcileAddDrift,
  cmdReconcileList,
} = require(path.join(__dirname, 'lib', 'reconcile.cjs'));

// ---------- schema-check group (lib/schema-check.cjs) ----------
const { cmdSchemaCheckParse, cmdSchemaCheckRun } = require(path.join(__dirname, 'lib', 'schema-check.cjs'));

// ---------- cost group (lib/cost.cjs) ----------
const { cmdCostRun } = require(path.join(__dirname, 'lib', 'cost.cjs'));

// ---------- realpath-check group (lib/realpath-check.cjs) ----------
const { cmdRealpathCheckRun } = require(path.join(__dirname, 'lib', 'realpath-check.cjs'));

// ---------- check-reservations group (lib/check-reservations.cjs) ----------
const { cmdCheckReservations } = require(path.join(__dirname, 'lib', 'check-reservations.cjs'));

// ---------- check group ----------
// `check run` retired in M13 — the spec↔plan consistency gate lives in
// `checklist run --only 9,10` (lib/checklist.cjs reuses lib/check.cjs
// primitives). Only `check reservations` remains in this group.

// ---------- code-scope group (lib/code-scope.cjs) ----------
const {
  cmdCodeScopeClaim,
  cmdCodeScopeStage,
  cmdCodeScopeRelease,
  cmdCodeScopeList,
  cmdCodeScopeCheck,
} = require(path.join(__dirname, 'lib', 'code-scope.cjs'));

const { usage, HELP } = require(path.join(__dirname, 'lib', 'help.cjs'));
const { cmdPhantomCheck, cmdPhantomListTasks } = require(path.join(__dirname, 'lib', 'phantom.cjs'));

const { cmdPackValidate, cmdPackImport, cmdPackExport } = require(path.join(__dirname, 'lib', 'pack.cjs'));

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(`${HELP}\n`);
    process.exit(0);
  }
  const [group, sub, ...rest] = argv;
  let result;
  try {
    if (group === 'spec') {
      if (sub === 'next-number') result = cmdSpecNextNumber(rest);
      else if (sub === 'update-status') result = cmdSpecUpdateStatus(rest);
      else if (sub === 'set-size') result = cmdSpecSetSize(rest);
      else if (sub === 'list') result = cmdSpecList(rest);
      else usage(`unknown spec subcommand: ${sub}`);
    } else if (group === 'fix') {
      if (sub === 'next-suffix') result = cmdFixNextSuffix(rest);
      else if (sub === 'update-status') result = cmdFixUpdateStatus(rest);
      else if (sub === 'list') result = cmdFixList(rest);
      else if (sub === 'find-duplicates') result = cmdFixFindDuplicates(rest);
      else if (sub === 'integrity-check') result = cmdFixIntegrityCheck(rest);
      else if (sub === 'init-postmortem') result = cmdFixInitPostmortem(rest);
      else if (sub === 'count-postmortems-since') result = cmdFixCountPostmortemsSince(rest);
      else if (sub === 'update-promote-state') result = cmdFixUpdatePromoteState(rest);
      else if (sub === 'write-suggestion') result = cmdFixWriteSuggestion(rest);
      else usage(`unknown fix subcommand: ${sub}`);
    } else if (group === 'analyze') {
      if (sub === 'next-slot') result = cmdAnalyzeNextSlot(rest);
      else if (sub === 'init') result = cmdAnalyzeInit(rest);
      else if (sub === 'update-status') result = cmdAnalyzeUpdateStatus(rest);
      else if (sub === 'discover') result = cmdAnalyzeDiscover(rest);
      else if (sub === 'add-finding') result = cmdAnalyzeAddFinding(rest);
      else if (sub === 'add-findings') result = cmdAnalyzeAddFindings(rest);
      else if (sub === 'list') result = cmdAnalyzeList(rest);
      else usage(`unknown analyze subcommand: ${sub}`);
    } else if (group === 'check') {
      // `check reservations` is an independent subcommand (owns exit 0/1).
      if (sub === 'reservations') {
        cmdCheckReservations(rest);
        return; // unreachable — cmdCheckReservations calls process.exit()
      }
      usage(
        `unknown check subcommand: ${sub} (the spec↔plan gate moved to "checklist run <slug>/<feature> --only 9,10" in M13)`
      );
    } else if (group === 'code-scope') {
      // code-scope claim/check own their exit code (0/1) and JSON output.
      if (sub === 'claim') {
        cmdCodeScopeClaim(rest);
        return; // unreachable — cmdCodeScopeClaim calls process.exit()
      } else if (sub === 'check') {
        cmdCodeScopeCheck(rest);
        return; // unreachable — cmdCodeScopeCheck calls process.exit()
      } else if (sub === 'stage') {
        cmdCodeScopeStage(rest);
        return; // unreachable — cmdCodeScopeStage calls process.exit()
      } else if (sub === 'release') {
        cmdCodeScopeRelease(rest);
        return; // unreachable — cmdCodeScopeRelease calls process.exit()
      } else if (sub === 'list') {
        cmdCodeScopeList(rest);
        return; // unreachable — cmdCodeScopeList calls process.exit()
      } else {
        usage(`unknown code-scope subcommand: ${sub}`);
      }
    } else if (group === 'realpath-check') {
      if (sub === 'run') {
        // owns its own exit code (0 pass / 1 findings / 2 error) and stdout
        cmdRealpathCheckRun(rest);
        return; // unreachable — cmdRealpathCheckRun calls process.exit()
      } else usage(`unknown realpath-check subcommand: ${sub}`);
    } else if (group === 'checklist') {
      if (sub === 'run') {
        // checklist run owns its own exit code (0/1/2) and report format.
        cmdChecklistRun(rest);
        return; // unreachable — cmdChecklistRun calls process.exit()
      } else if (sub === 'list') {
        result = cmdChecklistList(rest);
      } else {
        usage(`unknown checklist subcommand: ${sub}`);
      }
    } else if (group === 'constitution') {
      if (sub === 'init') result = cmdConstitutionInit(rest);
      else if (sub === 'discover') result = cmdConstitutionDiscover(rest);
      else if (sub === 'update-status') result = cmdConstitutionUpdateStatus(rest);
      else if (sub === 'set-body') result = cmdConstitutionSetBody(rest);
      else if (sub === 'next-version') result = cmdConstitutionNextVersion(rest);
      else if (sub === 'archive-current') result = cmdConstitutionArchiveCurrent(rest);
      else if (sub === 'write-mirror') result = cmdConstitutionWriteMirror(rest);
      else if (sub === 'link-claudemd') result = cmdConstitutionLinkClaudemd(rest);
      else if (sub === 'list') result = cmdConstitutionList(rest);
      else usage(`unknown constitution subcommand: ${sub}`);
    } else if (group === 'worktree') {
      if (sub === 'prepare') result = cmdWorktreePrepare(rest);
      else if (sub === 'enter') result = cmdWorktreeEnter(rest);
      else if (sub === 'status') result = cmdWorktreeStatus(rest);
      else if (sub === 'exit') result = cmdWorktreeExit(rest);
      else if (sub === 'list') result = cmdWorktreeList(rest);
      else if (sub === 'gc') result = cmdWorktreeGc(rest);
      else if (sub === 'adopt') result = cmdWorktreeAdopt(rest);
      else if (sub === 'reconcile') result = cmdWorktreeReconcile(rest);
      else usage(`unknown worktree subcommand: ${sub}`);
    } else if (group === 'pr') {
      if (sub === 'list-handoff') result = cmdPrListHandoff(rest);
      else if (sub === 'mark-status') result = cmdPrMarkStatus(rest);
      else if (sub === 'mark-pr-open') result = cmdPrMarkPrOpen(rest);
      else if (sub === 'findings-summary') result = cmdPrFindingsSummary(rest);
      else usage(`unknown pr subcommand: ${sub}`);
    } else if (group === 'phantom') {
      if (sub === 'check') {
        // owns its own exit code and stdout (json or human)
        cmdPhantomCheck(rest);
        return; // unreachable
      } else if (sub === 'list-tasks') {
        result = cmdPhantomListTasks(rest);
      } else {
        usage(`unknown phantom subcommand: ${sub}`);
      }
    } else if (group === 'reconcile') {
      if (sub === 'next-slot') result = cmdReconcileNextSlot(rest);
      else if (sub === 'init') result = cmdReconcileInit(rest);
      else if (sub === 'parse-spec') result = cmdReconcileParseSpec(rest);
      else if (sub === 'update-status') result = cmdReconcileUpdateStatus(rest);
      else if (sub === 'add-drift') result = cmdReconcileAddDrift(rest);
      else if (sub === 'list') result = cmdReconcileList(rest);
      else usage(`unknown reconcile subcommand: ${sub}`);
    } else if (group === 'modernize') {
      if (sub === 'next-slot') result = cmdModernizeNextSlot(rest);
      else if (sub === 'init') result = cmdModernizeInit(rest);
      else if (sub === 'update-status') result = cmdModernizeUpdateStatus(rest);
      else if (sub === 'discover-stack') result = cmdModernizeDiscoverStack(rest);
      else if (sub === 'add-proposal') result = cmdModernizeAddProposal(rest);
      else if (sub === 'approve-proposal') result = cmdModernizeApproveProposal(rest);
      else if (sub === 'add-wave') result = cmdModernizeAddWave(rest);
      else if (sub === 'snapshot-behavior') result = cmdModernizeSnapshotBehavior(rest);
      else if (sub === 'start-wave') result = cmdModernizeStartWave(rest);
      else if (sub === 'complete-wave') result = cmdModernizeCompleteWave(rest);
      else if (sub === 'verify-parity') result = cmdModernizeVerifyParity(rest);
      else if (sub === 'publish-notion') result = cmdModernizePublishNotion(rest);
      else if (sub === 'list') result = cmdModernizeList(rest);
      else usage(`unknown modernize subcommand: ${sub}`);
    } else if (group === 'schema-check') {
      if (sub === 'parse') result = cmdSchemaCheckParse(rest);
      else if (sub === 'run') {
        // owns its own exit code (0 pass / 1 findings / 2 error) and stdout
        cmdSchemaCheckRun(rest);
        return; // unreachable — cmdSchemaCheckRun calls process.exit()
      } else usage(`unknown schema-check subcommand: ${sub}`);
    } else if (group === 'cost') {
      if (sub === 'run') {
        // owns its own exit code (0 ok / 2 error) and stdout (table or json)
        cmdCostRun(rest);
        return; // unreachable — cmdCostRun calls process.exit()
      } else usage(`unknown cost subcommand: ${sub}`);
    } else if (group === 'product') {
      // Lazy require — only paid when `product ...` is actually invoked.
      const product = require(path.join(__dirname, 'lib', 'product.cjs'));
      // product status/stage own their exit code (0/1) and JSON output.
      if (sub === 'status') {
        product.cmdProductStatus(rest);
        return; // unreachable — cmdProductStatus calls process.exit()
      } else if (sub === 'stage') {
        product.cmdProductStage(rest);
        return; // unreachable — cmdProductStage calls process.exit()
      } else if (sub === 'markers') {
        product.cmdProductMarkers(rest);
        return; // unreachable — cmdProductMarkers calls process.exit()
      } else if (sub === 'changelog') {
        product.cmdProductChangelog(rest);
        return; // unreachable — cmdProductChangelog calls process.exit()
      } else if (sub === 'init') {
        product.cmdProductInit(rest);
        return; // unreachable — cmdProductInit calls process.exit()
      } else if (sub === 'add-milestone') {
        product.cmdProductAddMilestone(rest);
        return; // unreachable — cmdProductAddMilestone calls process.exit()
      } else if (sub === 'add-feature') {
        product.cmdProductAddFeature(rest);
        return; // unreachable — cmdProductAddFeature calls process.exit()
      } else if (sub === 'feature-init') {
        product.cmdProductFeatureInit(rest);
        return; // unreachable — cmdProductFeatureInit calls process.exit()
      } else if (sub === 'vision-init') {
        product.cmdProductVisionInit(rest);
        return; // unreachable — cmdProductVisionInit calls process.exit()
      } else if (sub === 'vision-touch') {
        product.cmdProductVisionTouch(rest);
        return; // unreachable — cmdProductVisionTouch calls process.exit()
      } else if (sub === 'audit-publish') {
        product.cmdProductAuditPublish(rest);
        return; // unreachable — cmdProductAuditPublish calls process.exit()
      } else if (sub === 'audit-set') {
        product.cmdProductAuditSet(rest);
        return; // unreachable — cmdProductAuditSet calls process.exit()
      } else if (sub === 'audit-mirror') {
        product.cmdProductAuditMirror(rest);
        return; // unreachable — cmdProductAuditMirror calls process.exit()
      } else if (sub === 'import') {
        product.cmdProductImport(rest);
        return; // unreachable — cmdProductImport calls process.exit()
      } else if (sub === 'validate') {
        product.cmdProductValidate(rest);
        return; // unreachable — cmdProductValidate calls process.exit()
      } else {
        usage(`unknown product subcommand: ${sub}`);
      }
    } else if (group === 'pack') {
      // pack subcommands own their exit codes (0/1/2) and stdout.
      if (sub === 'validate') {
        cmdPackValidate(rest);
        return; // unreachable — cmdPackValidate calls process.exit()
      } else if (sub === 'import') {
        cmdPackImport(rest);
        return; // unreachable — cmdPackImport calls process.exit()
      } else if (sub === 'export') {
        cmdPackExport(rest);
        return; // unreachable — cmdPackExport calls process.exit()
      } else usage(`unknown pack subcommand: ${sub}`);
    } else if (group === 'quick') {
      // Lazy require — only paid when `quick ...` is actually invoked.
      const quick = require(path.join(__dirname, 'lib', 'quick.cjs'));
      // quick eligibility owns its own exit code (0 eligible / 1 not
      // eligible) and JSON output (spec 004-xs-quick-lane, Wave 1).
      if (sub === 'eligibility') {
        quick.cmdQuickEligibility(rest);
        return; // unreachable — cmdQuickEligibility calls process.exit()
      } else {
        usage(`unknown quick subcommand: ${sub}`);
      }
    } else {
      usage(`unknown command group: ${group} (expected "spec", "fix", "analyze", "check", "checklist", "constitution", "worktree", "pr", "phantom", "reconcile", "modernize", "schema-check", "cost", "pack", "product", "quick", or "realpath-check"). fix supports: next-suffix, update-status, list, find-duplicates, integrity-check, init-postmortem, count-postmortems-since, update-promote-state, write-suggestion`);
    }
  } catch (e) {
    // Input-validation errors (e.g. path-traversal guard) are user errors,
    // not internal faults — same exit 2, honest prefix.
    const prefix = e && e.code === 'A1_INPUT' ? 'error' : 'internal error';
    process.stderr.write(`${prefix}: ${e.message}\n`);
    if (process.env.A1_DEBUG) process.stderr.write(`${e.stack}\n`);
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

main();
