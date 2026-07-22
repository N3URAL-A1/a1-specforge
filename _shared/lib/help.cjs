'use strict';

const {
  SPEC_STATUSES, BUG_STATUSES, BUG_SEVERITIES,
  ANALYSIS_STATUSES, ANALYSIS_FOCUSES, ANALYSIS_SEVERITIES,
  CONSTITUTION_STATUSES,
  RECONCILE_STATUSES, RECONCILE_SCOPE_MODES, RECONCILE_DRIFT_CLASSES,
} = require('./status-constants.cjs');

function usage(msg) {
  process.stderr.write(`usage error: ${msg}\n`);
  process.stderr.write(`\n${HELP}\n`);
  process.exit(1);
}

const HELP = `a1-tools — file-ops helper for a1-* skills

Usage:
  a1-tools spec next-number <project-slug>
  a1-tools spec update-status <spec-path> <new-status> [flags]
  a1-tools spec set-size <spec-path> <S|M|L>
  a1-tools spec list <project-slug> [--status=<s>]

  a1-tools fix next-suffix <project-slug> <YYYY-MM-DD>
  a1-tools fix update-status <bug-path> <new-status> [flags]
  a1-tools fix list <project-slug> [--status=<s>] [--severity=<s>]
  a1-tools fix find-duplicates <project-slug> <keyword> [<keyword>...]

  a1-tools analyze next-slot <project-slug> <focus> [--date YYYY-MM-DD]
  a1-tools analyze init <project-slug> <focus> [--project-path /abs] [--date YYYY-MM-DD] [--title <text>]
  a1-tools analyze update-status <analysis-path> <new-status> [--phase-data <json>]
  a1-tools analyze discover <project-path>
  a1-tools analyze add-finding <analysis-path> <severity> <category> <location> <description> [--recommendation <text>]
  a1-tools analyze add-findings <analysis-path> --json <file|->   (batch: JSON array of finding objects)
  a1-tools analyze list <project-slug> [--status=<s>] [--focus=<s>]

  a1-tools check reservations --claim <type>:<value> --by <spec-id> [--file <path>]
  a1-tools check reservations --list [--file <path>]
                  Cross-run claim registry (.a1/reservations.json) for migration
                  numbers, route paths, etc. Conflicting claim (held by another
                  spec) exits 1; same-spec re-claim is idempotent (exit 0).
  a1-tools check reservations --release --by <spec-id> [--claim <type>:<value>] [--file <path>]
                  release own claims; foreign claim -> exit 1; missing claim -> idempotent exit 0
  a1-tools code-scope claim --by <feature-id> --scope <path>[,<path>...] [--file <path>]
                  Path-list scope claim (same .a1/reservations.json registry).
                  Deterministic prefix/glob overlap check against every other
                  in-flight feature's code_scope. Overlap -> exit 1, JSON
                  {status:"CONFLICT", overlaps:[...]}, stderr names holder(s).
                  No overlap -> atomic write, exit 0. Same-feature identical
                  re-claim is idempotent (exit 0).
  a1-tools code-scope check --by <feature-id> --scope <path>[,<path>...] [--file <path>]
                  Dry-run variant of claim: same overlap comparison, never writes.
  a1-tools code-scope stage --by <feature-id> --set <stage> [--file <path>]
                  Advances the lifecycle stage on a feature's code_scope entry.
                  <stage> one of: started|complete|review|verify|merge|
                  origin-cleanup|done. Unknown feature-id -> exit 1. Invalid
                  stage -> exit 1. Rebuilds the reservation immutably, atomic
                  write, exit 0.
                  Forward-only monotonic transitions: the new stage's index in
                  the list above must be >= the current stage's index. Moving
                  BACKWARD (e.g. verify -> review) -> exit 1 with a clear
                  message. Skipping AHEAD (e.g. started -> merge) is allowed;
                  the JSON output then includes a "skipped": [...] warning
                  array listing the stage names that were bypassed.
  a1-tools code-scope release --by <feature-id> [--file <path>]
                  Removes a feature's code_scope reservation entirely, freeing
                  its scope for other features to claim (auto-unblock).
                  Idempotent: no matching entry -> exit 0, {released:false}.
  a1-tools code-scope list [--file <path>] [--stale-days <n>]
                  Lists all code_scope reservations (feature, stage, paths).
                  With --stale-days <n>: adds stale:true/false per entry based
                  on deterministic date math against <n> days ago (no
                  auto-release). Stale entries also get a hint field:
                  "release via a1-tools code-scope release --by <id>".

  a1-tools checklist run <project-slug>[/<feature-id>] [--format json|human] [--save] [--vault <path>] [--only <ids>]
                  --only 9,10 = spec<->plan consistency gate subset (former
                  "check run"): FR coverage + frontmatter link. Exit: 0 PASS,
                  1 FAIL (BLOCKER), 2 ERROR (setup).
                  Pre-flight checklist: 8 structural checks before implementation.
                  Severities: BLOCKER (exit 1), MAJOR/MINOR (exit 0, warnings).
                  Exit: 0 PASS or PASS_WITH_WARNINGS, 1 FAIL (blocker), 2 ERROR (setup).
                  With --save: writes report to projects/<slug>/checklist/<###>-<date>.md.
  a1-tools checklist list <project-slug> [--vault <path>]
                  List recent saved checklist reports for a project.

  a1-tools constitution init <project-slug> [--title <text>]
  a1-tools constitution discover <project-slug> [--project-path <abs>]
  a1-tools constitution update-status <constitution-path> <new-status>
  a1-tools constitution set-body <constitution-path> --body-file <path>
  a1-tools constitution next-version <project-slug>
  a1-tools constitution archive-current <project-slug> [--date YYYY-MM-DD]
  a1-tools constitution write-mirror <project-slug> --repo-root <abs>
  a1-tools constitution link-claudemd <project-slug> --repo-root <abs>
  a1-tools constitution list [--status=<s>]

  a1-tools worktree prepare <repo-root> <slug> [--branch <name>] [--base <branch>] [--force-reset]
                  Pre-Flight validation + registry entry. Exit: 0 PASS, 1 BLOCKER, 2 ERROR.
  a1-tools worktree enter <id>
                  Runs 'git worktree add'. Registry: prepared -> active.
  a1-tools worktree status <id>
                  Reports commit_count, has_uncommitted, branch_ahead/behind.
  a1-tools worktree exit <id> --mode <keep|discard|handoff> [--force-discard]
                  keep: remove worktree, keep branch. discard: remove both (refuses on unmerged commits without --force-discard). handoff: keep both for a1-pr-review.
  a1-tools worktree list [--status=<s>] [--repo-root=<abs>]
  a1-tools worktree gc [--dry-run]
                  Reconcile registry with on-disk state. Mark missing worktrees as cleaned.
  a1-tools worktree adopt <repo-root> <slug> [--worktree-path <abs>] [--branch <name>] [--base <branch>]
                  Register an EXISTING git worktree (created outside a1) as status=active, fields from git truth.
  a1-tools worktree reconcile <repo-root> [--prune]
                  Diff registry vs 'git worktree list' both ways. Read-only by default; --prune marks orphaned registry entries cleaned. Unregistered worktrees are listed as adopt candidates.

  a1-tools pr list-handoff [--repo-root=<abs>]
                  List registry entries with status=handoff (ready for review).
  a1-tools pr mark-status <id-or-slug> <handoff|in-review|reviewed|pr-open>
                  Update worktree status during the review lifecycle.
  a1-tools pr mark-pr-open <id-or-slug> <pr-url>
                  Mark a worktree as having an open PR (terminal status).
  a1-tools pr findings-summary <id-or-slug> | --worktree-path <abs>
                  Read <worktree>/.a1-review/findings.json and return counts + markdown
                  snippets for blocker_md, major_md, inline_minor_md.

  a1-tools phantom check <plan-path> [--repo-path <abs>] [--since <git-ref>]
                          [--format json|human]
                  Detect [X]-tasks in PLAN.md that have no corresponding code-change
                  in git diff. Warning-level: always exits 0. Tasks tagged with
                  "# no-code" are skipped. Default --since is the commit before the
                  one that last modified the PLAN file.
  a1-tools phantom list-tasks <plan-path>
                  Debug helper: parse PLAN.md and list all checkbox tasks with line
                  numbers, completed flag and no-code flag.

  a1-tools reconcile next-slot <project-slug> [--date YYYY-MM-DD]
                  Compute next free drift-<date>[-N].md slot for the project.
  a1-tools reconcile init <project-slug> --scope <single|project|vault-sync>
                          [--spec <###-feature-slug>] [--project-path /abs]
                          [--date YYYY-MM-DD] [--title <text>]
                  Create a drift report with frontmatter and empty body skeleton.
                  For --scope single, --spec is required.
  a1-tools reconcile parse-spec <drift-path>
                  Extract FR-### + inline-code anchors (file/function/endpoint)
                  from each scope target's spec. Computes STALE pre-filter via git.
                  Writes parsed_targets[] and stale_candidates[].
  a1-tools reconcile update-status <drift-path> <new-status> [--phase-data <json>]
                  Atomic frontmatter status transition. Appends phase_history.
  a1-tools reconcile add-drift <drift-path> <MISSING|EXTRA|DIVERGED|STALE>
                              <artifact> <description>
                              [--recommendation <text>] [--spec-ref <FR-###>]
                              [--code-ref <path:line>]
                  Append one drift to drifts[]. Auto-IDs (D-001, …). Recomputes
                  drifts_count.
  a1-tools reconcile list <project-slug> [--status=<s>]
                  List drift reports for a project. Use slug "_vault-sync" for
                  the cross-project sweep folder.

  a1-tools modernize next-slot <project-slug> [<focus>] [--date YYYY-MM-DD]
                  Compute next free modernize run slot for the project.
  a1-tools modernize init <project-slug> <mode> [--project-path /abs]
                          [--date YYYY-MM-DD]
                  Create a modernize master file (mode: spec-only|full) with
                  frontmatter and empty body skeleton.
  a1-tools modernize update-status <master-path> <new-status>
                          [--phase-data <json>] [--approved-by <human|harness:reason>]
                  Atomic frontmatter status transition. Appends phase_history.
  a1-tools modernize discover-stack <project-path>
                  Deterministic tech-stack + LOC + file-count scan of a
                  project on disk, for Phase 1 (Discover) context.
  a1-tools modernize add-proposal <master-path> --title <t> --rationale <r>
                          --risk low|medium|high --effort <e> --rollback <rb>
                  Append one modernization proposal to proposals[]. Auto-IDs.
  a1-tools modernize approve-proposal <master-path> <proposal-id>
                          approved|rejected|deferred [--reason <text>]
                          [--approved-by <human|harness:reason>]
                  Record a human decision on a proposal.
  a1-tools modernize add-wave <master-path> --title <t>
                          [--depends-on W-01,W-02]
                  Append one execution wave to waves[]. Auto-IDs (W-01, …).
  a1-tools modernize snapshot-behavior <master-path>
                          [--baseline-tests <path>] [--manual-smoke <path>]
                  Record the pre-modernization behavior snapshot used later
                  for parity verification.
  a1-tools modernize start-wave <master-path> <wave-id>
                          [--approved-by <human|harness:reason>]
                  Mark a wave as started. Requires prior human approval gate.
  a1-tools modernize complete-wave <master-path> <wave-id>
                          --snapshot-replay pass|fail [--replay-file <path>]
                          --fr-ac-checks <json>
                  Mark a wave complete with replay + FR/AC evidence.
  a1-tools modernize verify-parity <master-path>
                  Goal-backward check: does the modernized codebase still do
                  what the behavior snapshot says it did?
  a1-tools modernize publish-notion <master-path> [--notion-parent <page-id>]
                  Export the master file to Notion, or to a local
                  modernize-export/ fallback dir if no Notion parent is set.
  a1-tools modernize list [<project-slug>] [--status=<s>] [--slug=<s>]
                  List modernize runs for a project, or all projects if no
                  slug is given.

  a1-tools schema-check run --migrations <dir> [--tables t1,t2]
                            [--trigger-pattern 'audit|log'] [--json]
                  Deterministic schema pre-gate: (A) audit trigger exists per
                  table, (B) RLS enabled (warn if no FORCE), (C) FK column type
                  matches referenced PK type. Per-table PASS/FAIL + summary;
                  --json emits structured findings.
                  Exit: 0 pass, 1 findings, 2 error (dir/pattern/setup).
  a1-tools schema-check parse --migrations <dir> [--json]
                  Debug: dump the parsed SQL schema model (tables, columns, PKs,
                  FKs, triggers, RLS) as JSON.
                  Supported SQL subset: top-level semicolon-terminated statements;
                  '…' strings and $$…$$ bodies are opaque; no quoted identifiers;
                  CREATE TABLE (inline + table-level PK/FK), ALTER TABLE ADD
                  CONSTRAINT … FOREIGN KEY, ALTER TABLE … ENABLE/FORCE ROW LEVEL
                  SECURITY, CREATE TRIGGER … ON <table> (header only). Unsupported
                  constructs are skipped, never crash.

  a1-tools cost run --project <claude-projects-dir> [--since ISO] [--until ISO] [--json]
                  Aggregate token spend from Claude Code session JSONL logs
                  (~/.claude/projects/<flattened-cwd>/). Dedups streamed
                  assistant events by message.id, includes sub-agent logs
                  (<sessionId>/subagents/*.jsonl), skips malformed lines with a
                  warning counter. Per-session table + summary line
                  "Cost: N tokens (in X, out Y, cache Z)"; --json for machines.
                  Exit: 0 ok, 2 error (dir missing / no JSONL files).

  a1-tools realpath-check run --diff-base <git-ref> [--project <dir>]
                              [--evidence <file>] [--real-markers <pattern>] [--json]
                  Gate 0.7: scan the diff <base>..HEAD for real-backend surfaces
                  (SQL / RLS / external non-localhost HTTP). If found, require a
                  test-evidence file (default .a1/realpath-evidence.md) with a
                  '## <category>' section per detected surface, containing a
                  command + non-mock output + a real-execution marker (default
                  /postgres|postgresql://|HTTP/|rows|Connected/i).
                  Exit: 0 pass (no surfaces or all proven), 1 lacking proof,
                  2 bad args / no git.

  a1-tools pack validate <dir>
                  Validate a Gate-Pack (ADR 2026-07-05): pack.yaml required
                  fields (name, semver version, stacks[], provenance{occurrences,
                  severity,date_range,source}, anonymization A1|A2|A3, patterns[],
                  requires_cli), every listed pattern file exists with required
                  fields (id, class, trigger_signature, target{kind∈brief-line|
                  gate-step|cli-check, skill, anchor}, diff, evidence_schema), and
                  checks/ contains ONLY .json/.args.json (no executable payloads).
                  Exit: 0 valid, 1 invalid, 2 error (dir/manifest missing).
  a1-tools pack import <dir> [--dest <repo>]
                  validate → copy to <repo>/.a1/packs/<name>/ → stops. NEVER
                  applies (application happens only via a1-evolve, provenance
                  capped at 2). Re-import same version: idempotent (0). Different
                  version: replaces. Exit: 0 staged, 1 invalid, 2 error.
  a1-tools pack export --patterns <id,..> --anonymize A2|A3 --out <dir>
                       [--source <label>]
                  Build a pack skeleton from Vault patterns.md entries. Enforces
                  the anonymization deny-regex (/Users/, vault paths, e-mails,
                  tenant names) — a hit in generated output → exit 1 listing the
                  leak (nothing written). A3 additionally strips code blocks from
                  diffs. Exit: 0 exported, 1 leak/usage, 2 error (Vault missing).

  a1-tools product status [--dir docs/product]
                  Read-only. Prints { project, milestones, features, next }
                  parsed from <dir>/ROADMAP.md frontmatter, merging in
                  <dir>/features/<id>/feature.md (feature_md_path) when
                  present. Never writes any file. Exit: 0 ok, 1 ROADMAP.md
                  missing.
  a1-tools product stage --by <feature-id> --set <stage> [--dir docs/product]
                  Transactional stage transition (schema v1, see
                  docs/product/SCHEMA.md). <stage> reuses CODE_SCOPE_STAGES:
                  started|complete|review|verify|merge|origin-cleanup|done.
                  Forward-only (backward -> exit 1, nothing written).
                  Same-stage re-set is idempotent (exit 0, dates untouched,
                  no changelog line appended). On an actual stage change,
                  auto-appends a "<feature-id> -> <stage>" changelog line
                  (see 'product changelog'). Under one lock
                  (docs/product/.product-stage.lock.json): updates
                  ROADMAP.md frontmatter, mirrors features/<id>/feature.md
                  if it exists, mirrors a matching code_scope reservation's
                  .stage in .a1/reservations.json if one exists, regenerates
                  index.json + NEXT.md. All writes are staged as .tmp files
                  first and renamed only after every tmp write succeeds —
                  any failure rolls back with none of the originals
                  touched. Exit: 0 ok, 1 usage/validation/write error.
  a1-tools product markers [--dir docs/product] [--level project|milestone|feature --id <id>]
                  Read-only report (no --set) of the 3 marker levels:
                  project-level 'next' cursor + 'status', per-milestone
                  'status', per-feature 'stage'. Flags inconsistencies as
                  warnings[] (e.g. 'next' pointing at a done/cancelled
                  feature, or an in-flight feature missing a code_scope
                  reservation / with a null stage). Never writes any file in
                  this mode. Exit: 0 ok, 1 ROADMAP.md missing.
  a1-tools product markers --level <project|milestone|feature> [--id <id>] --set <value> [--dir docs/product]
                  Writer mode: updates the marker at the given level under
                  the same lock + tmp/rename transaction as 'product stage'
                  / 'product changelog', appends a changelog line, and
                  regenerates index.json + NEXT.md. --id required except at
                  project level. --set values: project ->
                  active|paused|done; milestone -> planned|in-progress|done;
                  feature -> reuses CODE_SCOPE_STAGES (same set as 'product
                  stage'), but does NOT enforce forward-only transitions or
                  mirror reservations.json/feature.md — use 'product stage'
                  for those guarantees. Exit: 0 ok, 1 usage/validation/write
                  error.
  a1-tools product changelog --entry "<what>" --why "<why>" [--dir docs/product]
                  Appends "- **YYYY-MM-DD** — <what> — <why>" under
                  ROADMAP.md's '## Changelog' section and regenerates
                  index.json + NEXT.md, under the same lock + tmp/rename
                  transaction as 'product stage'. When the Changelog holds
                  more than 100 entries, the oldest overflow is rotated
                  (append-only) into docs/product/CHANGELOG-archive.md in
                  the same transaction. Exit: 0 ok, 1 usage/write error.
  a1-tools product init --project <slug> --title <title> [--dir docs/product]
                  Scaffold a brand-new docs/product/ROADMAP.md (schema v1,
                  empty milestones[]/features[]) + NEXT.md + index.json.
                  Refuses (exit 1) if ROADMAP.md already exists — use
                  add-milestone/add-feature to extend an existing roadmap
                  instead. Exit: 0 ok, 1 usage/already-exists/write error.
  a1-tools product add-milestone --id <slug> --title <title>
                  [--target YYYY-MM] [--goal <text>] [--status <status>]
                  [--dir docs/product]
                  Append a new milestone to an existing ROADMAP.md
                  milestones[] list; auto-appends a changelog line and
                  regenerates index.json/NEXT.md. Exit: 0 ok, 1 usage/
                  duplicate-id/write error.
  a1-tools product add-feature --id <###-slug> --milestone <m-slug>
                  --title <title> [--goal <text>] [--depends-on a,b]
                  [--status <status>] [--dir docs/product]
                  Append a new feature to an existing ROADMAP.md features[]
                  list (schema-v1 shape); requires the milestone to already
                  exist. Auto-appends a changelog line and regenerates
                  index.json/NEXT.md. Exit: 0 ok, 1 usage/missing-
                  milestone/duplicate-id/write error.
  a1-tools product feature-init --id <###-slug> [--spec-path <path>]
                  [--plan-path <path>] [--dir docs/product]
                  Creates docs/product/features/<id>/feature.md (schema-v1
                  frontmatter: id/project/milestone/title/status/stage/
                  depends_on/spec_path/plan_path), mirrored from the
                  feature's existing ROADMAP.md features[] entry (which
                  must already exist — add it first via 'product
                  add-feature'). Refuses if feature.md already exists.
                  Auto-appends a changelog line and regenerates
                  index.json/NEXT.md. Exit: 0 ok, 1 usage/missing-feature/
                  already-exists/write error.
  a1-tools product vision-init --title <text>
                  --pillar id:title:summary [--pillar ...] [--dir docs/product]
                  Scaffolds docs/product/VISION.md (schema v1.1: schema_
                  version/type/project/title/updated/pillars[]). At least
                  one --pillar is required (empty/omitted pillars[] is
                  invalid per schema v1.1 — see 'product validate').
                  Refuses (exit 1, no write) if VISION.md already exists —
                  use 'product vision-touch' to bump 'updated' instead.
                  Regenerates index.json (vision block becomes non-null)
                  under the same lock/tmp/rename transaction as every other
                  product-mutating command. Exit: 0 ok, 1 usage/already-
                  exists/write error.
  a1-tools product vision-touch [--dir docs/product]
                  Bumps VISION.md's frontmatter 'updated' field to today's
                  date and regenerates index.json — a targeted textual
                  replace of ONLY the 'updated:' line, so the prose body
                  and every other frontmatter field (including pillars[])
                  stay byte-for-byte unchanged. Refuses (exit 1) if
                  VISION.md does not exist yet — run 'product vision-init'
                  first. Same lock/tmp/rename transaction as every other
                  product-mutating command. Exit: 0 ok, 1 usage/missing-
                  file/write error.
  a1-tools product audit-publish --analysis <path> [--project <slug>]
                  [--dir docs/product]
                  Parses an a1-analyze result's frontmatter findings[] into a
                  new docs/product/audits/<date>-<focus>.md (schema v1.1:
                  schema_version/type/project/focus/date/source/verdict/
                  counts/findings[]/last_validated). Every finding starts at
                  status: open / fixed_commit: null / feature: null. Refuses
                  (exit 1, no write) if a file for the same date+focus
                  already exists — audits are append-only history, one file
                  per analyze-run, never overwritten. A zero-findings
                  analysis still produces a valid empty-findings[] audit
                  file. Regenerates index.json (audits[] gains an entry)
                  under the same lock/tmp/rename transaction as every other
                  product-mutating command. Exit: 0 ok, 1 usage/analysis-
                  unreadable/already-exists/write error.
  a1-tools product audit-set --audit <path> --finding F-0NN
                  --status <open|fixed|obsolete|accepted> [--commit <sha>]
                  [--feature <id>] [--dir docs/product]
                  Mutates EXACTLY the named finding's status/fixed_commit/
                  feature fields (every other finding, and every other
                  frontmatter field, stay byte-unchanged — a targeted
                  textual replace, not a full re-serialize) and appends a
                  one-line changelog entry to the audit file's body. Fails
                  (exit 1, no write) if --finding doesn't match any finding
                  id in the target file, or if --feature names an id absent
                  from ROADMAP.md (hard validation, no warning-only mode —
                  same cross-check 'product validate' runs). A transition
                  FROM 'fixed' back TO 'open' (regression re-open) is a
                  legal transition, not blocked. Regenerates index.json
                  (derived open/fixed counts) under the same lock/tmp/rename
                  transaction as every other product-mutating command.
                  Exit: 0 ok, 1 usage/not-found/unknown-finding/unknown-
                  feature/write error.
  a1-tools product validate [--dir docs/product]
                  Read-only. Validates <dir>/ROADMAP.md frontmatter against
                  the schema-v1 contract (docs/product/SCHEMA.md section 1 /
                  index.schema.json): required fields, enums, id/date
                  patterns, milestone/feature cross-references. Also runs a
                  best-effort FR-016 English-only lint (German-marker
                  heuristic: umlauts/ß or common German function words)
                  over the file content, surfaced as warnings[] — never
                  affects valid/exit code (flag, not a hard block). Prints
                  { valid, errors[], warnings[], file }. Never writes any
                  file. Exit: 0 valid, 1 invalid or ROADMAP.md missing.
  a1-tools product import --file <path> --project <slug>
                  [--title <text>] [--dir docs/product]
                  Migrate a legacy hand-rolled roadmap into a fresh
                  schema-v1 ROADMAP.md (FR-021/FR-022, Wave 6). ONE code
                  path auto-detects and handles both observed legacy
                  shapes — no per-consumer parser:
                    - hand-written HTML (Niimo-style): a Frappe-Gantt page
                      with a "const tasks = [...]" array; each task becomes
                      one feature under a single synthesized milestone.
                    - data.json + generator (A1/office-style): a JSON doc
                      with S4_phases.phases[].epics[].stories[]; each phase
                      becomes a milestone, each story a feature.
                  Content with no schema-v1 field (story points, epic/agent
                  groupings, vision/architecture/dispatch sections, gate/
                  blocker hints, legend text, …) is preserved verbatim under
                  '## Appendix — migrated details' — never dropped (FR-022).
                  Validates its own output against "product validate" before
                  writing (SC-006 round-trip); refuses to write on a
                  validation failure. Refuses to overwrite an existing
                  ROADMAP.md (same guard as "product init"). Writes through
                  regenerateDerived + the same lock/tmp/rename transaction
                  as every other product-mutating command, so index.json/
                  NEXT.md regenerate correctly. Exit: 0 ok, 1 usage/
                  unrecognized-shape/already-exists/validation/write error.

Spec statuses: ${[...SPEC_STATUSES].join(', ')}
Bug statuses:  ${[...BUG_STATUSES].join(', ')}
Bug severities: ${[...BUG_SEVERITIES].join(', ')}
Analysis statuses: ${[...ANALYSIS_STATUSES].join(', ')}
Analysis focuses:  ${[...ANALYSIS_FOCUSES].join(', ')}
Analysis severities: ${[...ANALYSIS_SEVERITIES].join(', ')}
Constitution statuses: ${[...CONSTITUTION_STATUSES].join(', ')}
Reconcile statuses: ${[...RECONCILE_STATUSES].join(', ')}
Reconcile scope modes: ${[...RECONCILE_SCOPE_MODES].join(', ')}
Reconcile drift classes: ${[...RECONCILE_DRIFT_CLASSES].join(', ')}

Learning store root: repo-local ".a1/learnings/" by default; env A1_VAULT_ROOT
overrides this to point at an external vault (e.g. Obsidian).
Exit codes: 0 success, 1 user/usage error, 2 internal error.`;

module.exports = { usage, HELP };
