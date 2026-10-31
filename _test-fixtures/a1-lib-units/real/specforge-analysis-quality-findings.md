---
type: project-analysis
project: a1-specforge
focus: quality
title: quality analysis of a1-specforge
status: reported
created_at: 2026-07-12 07:14:34.537000+00:00
analyzed_path: /Users/rob/code/a1-skills
phase_history:
- phase=scope completed=2026-07-12T07:14:34.537Z
- phase=discover completed=2026-07-12T07:14:54.188Z
- phase=synthesize completed=2026-07-12T07:22:32.141Z
- phase=report completed=2026-07-12T07:23:51.725Z
discover:
- project_path=/Users/rob/code/a1-skills
- tech_stack=github-actions,node-cli,markdown-skills
- loc=34170
- file_count=286
- last_commit=2026-07-12T08:32:26+02:00
- branch=main
- commit_count_30d=116
agents_dispatched: []
findings:
- id=F-001; severity=MAJOR; category=vault vs repo-local drift; location=skills/a1-evolve/SKILL.md:19-20
  and _shared/a1-tools.cjs:158,6209; description=a1-evolve's SKILL.md description
  and input-source table call the Obsidian Vault the 'canonical' / 'primary source
  of truth' for learnings, and a1-tools.cjs docstrings still say the vault root defaults
  to '~/N3URAL-Vault'. This contradicts the vision/roadmap decision (docs/roadmap.md
  M7, validated 2026-07-05) that the learning store is repo-local (.a1/learnings/)
  by default with the vault as an optional external sink via A1_VAULT_ROOT. The actual
  shipped workflow code (workflows/01-collect.md, 04-apply.md) correctly implements
  the repo-local default — only the description text and CLI help strings are stale.;
  recommendation=Update SKILL.md's 'Vault pattern/a1-learnings/*.md' row to say 'optional
  external sink (A1_VAULT_ROOT)' instead of 'canonical... primary source of truth',
  and fix the two a1-tools.cjs docstring lines to state the repo-local .a1/learnings/
  default with vault as opt-in override.
- id=F-002; severity=MAJOR; category=self-hosting gap; location=.a1/roadmap.md (does
  not exist); description=The a1-specforge repo manages its own milestones via .a1/phases/M6..M9
  and a hand-maintained docs/roadmap.md, but never ran its own a1-roadmap skill to
  produce .a1/roadmap.md — the state file that a1-roadmap's own SKILL.md documents
  as the canonical scaffold output (referenced at skills/a1-roadmap/SKILL.md:57,85,150,206,249,267,289-290)
  and that a1-progress/a1-plan expect to find. The framework does not dogfood its
  own roadmap convention on itself.; recommendation=Either run a1-roadmap once against
  this repo to backfill .a1/roadmap.md from the M6-M9 phase history, or explicitly
  document in CLAUDE.md/README that a1-specforge's own roadmap intentionally lives
  only in docs/roadmap.md (product doc) and not .a1/roadmap.md, so the divergence
  from the documented convention isn't silently confusing to a new contributor reading
  a1-roadmap's SKILL.md.
- id=F-003; severity=MAJOR; category=roadmap sync gap; location=docs/roadmap.md (M9-robustness
  absent); description=M9-robustness is fully shipped and verified (.a1/phases/M9-robustness/VERIFICATION.md,
  verdict PASS 8/8, dated 2026-07-12) but docs/roadmap.md — the document a new contributor
  or the owner would read to understand current state — only lists M6/M7/M8 and stops
  at M8's still-open items. The product's own north-star roadmap doc is one full milestone
  behind reality.; recommendation=Add an M9-robustness section to docs/roadmap.md
  (or a 'History' entry like the M0-M5 table) summarizing scope and linking .a1/phases/M9-robustness/VERIFICATION.md,
  so the roadmap doc stays the single source of truth it claims to be.
- 'id=F-004; severity=MINOR; category=gate-pack coverage; location=packs/ (only postgres-rls
  exists); description=docs/VISION.md''s Gate-Packs pillar explicitly names three
  example packs (''Postgres-RLS pack'', ''Next.js deploy pack'', ''Flutter parity
  pack'') as the core of the community-learning moat, but only packs/postgres-rls/
  has shipped. Consistent with M8''s roadmap scope (which only committed to ''first
  published gate-pack''), so not a broken promise, but VISION.md reads as though multiple
  packs already exist.; recommendation=Either soften the VISION.md wording to mark
  the other two as future examples (e.g. ''(candidates: ...)''), or track ''nextjs-deploy
  pack'' and ''flutter-parity pack'' as explicit backlog items in docs/roadmap.md
  so the gap is tracked rather than implied-but-silent.'
- 'id=F-005; severity=MINOR; category=backlog vs vision framing; location=docs/roadmap.md:87-88
  vs docs/VISION.md:45-47; description=VISION.md''s ''Creative directions (prioritized)''
  table ranks a1-dashboard (#2) and a1-test (#4) ahead of GitHub Actions gates (#5)
  and plugin distribution (#6) — yet #2 and #4 are demoted to the unordered ''Backlog
  (Someday / Maybe)'' section in roadmap.md while #5 and #6 already shipped in M7/M8.
  The prioritization signal in VISION.md no longer matches execution order.; recommendation=Add
  a one-line note in VISION.md''s creative-directions table (or a footnote) clarifying
  that shipped order diverged from the original priority ranking, pointing to docs/roadmap.md
  as the authoritative sequencing.'
- 'id=F-006; severity=MAJOR; category=oversized file; location=_shared/a1-tools.cjs
  (7148 lines); description=The CLI facade is 7148 lines — ~9x the project''s own
  800-line hard limit (coding-style.md). The Wave-9 module split extracted product/worktree-registry/io/locks
  into lib/, but the bulk (spec, fix, analyze, check, checklist, constitution, reconcile,
  modernize, schema-check, cost, phantom, pack, code-scope, realpath-check groups)
  still lives in one file. This is the single largest maintainability liability in
  the repo.; recommendation=Continue the module split established in Wave 9: extract
  each remaining command group (or clusters like fix+spec, analyze+reconcile+modernize)
  into _shared/lib/<group>.cjs behind the same lazy-require + init() facade pattern
  already proven for product.cjs. Target <800 lines for the dispatcher facade.'
- 'id=F-007; severity=MAJOR; category=missing tests; location=_test-fixtures/ (no
  fixture for fix, constitution groups); description=The ''fix'' command group (~439
  lines: find-duplicates, integrity-check, init-postmortem, count-postmortems-since,
  update-promote-state — the a1-fix learning-loop state machine) and the ''constitution''
  group (~371 lines: init/discover/set-body/next-version/archive-current state machine)
  have zero fixture coverage under _test-fixtures/ and are not exercised by CI. These
  are among the more logic-heavy, stateful groups, so regressions after future edits
  (or further module splits) would ship undetected.; recommendation=Add _test-fixtures/a1-fix/run-tests.sh
  and _test-fixtures/a1-constitution/run-tests.sh following the existing CONVENTIONS.md
  fixture pattern, asserting exit codes and JSON output for the state transitions.
  The CI glob (_test-fixtures/*/run*.sh) will pick them up automatically.'
- id=F-008; severity=MAJOR; category=stale help text; location=_shared/a1-tools.cjs:5881
  (HELP const); description=The 'modernize' command group (13 subcommands, 27 code
  references, fully wired in dispatch) is completely absent from the HELP string,
  while every other group (spec, fix, analyze, check, checklist, constitution, worktree,
  pr, phantom, reconcile, schema-check, cost, pack, product, code-scope, realpath-check)
  is documented. Users running a1-tools with a bad arg get usage output that silently
  omits an entire working feature.; recommendation=Add the modernize subcommand block
  to the HELP const (next-slot, init, update-status, discover-stack, add-proposal,
  approve-proposal, add-wave, snapshot-behavior, start-wave, complete-wave, verify-parity,
  publish-notion, list), mirroring the format of the other groups.
- 'id=F-009; severity=MINOR; category=long functions; location=_shared/a1-tools.cjs:
  usage (L5875, 365 lines), runChecklistChecks (L2228, 246), main (L6928, 221), cmdCostRun
  (L5046, 187), cmdSchemaCheckRun (L4843, 153); description=Five functions exceed
  the project''s 50-line function limit substantially. usage()/HELP is a single 365-line
  string (low risk, but should move to a data-driven help registry). main() is a 221-line
  if/else dispatch chain (86 ''if (sub ==='' branches) — flat, but a growing switch
  that a per-group dispatch table would shrink. runChecklistChecks and cmdCostRun
  mix parsing, computation, and output in one body.; recommendation=When splitting
  groups into lib/ modules (see the oversized-file finding), let each group own its
  own sub-dispatch table so main() collapses to a group->module lookup. Split runChecklistChecks/cmdCostRun
  into parse -> compute -> format helpers.'
- 'id=F-010; severity=MINOR; category=inconsistent naming; location=_test-fixtures/*/
  (run.sh vs run-test.sh vs run-tests.sh); description=Test fixture entrypoints use
  three different names: run.sh (a1-cost, a1-phantom, product-*, roadmap-gate), run-test.sh
  (a1-pr-review), and run-tests.sh (a1-checklist, a1-reconcile, a1-worktree, a1-check,
  a1-analyze-cli). CI tolerates this via the run*.sh glob, but the inconsistency is
  a papercut for contributors and risks a fixture being silently skipped if someone
  names one runtests.sh or test.sh.; recommendation=Standardize on one name (run-tests.sh)
  per CONVENTIONS.md and rename the outliers. Optionally tighten the CI glob to the
  canonical name so a misnamed runner fails loudly instead of being skipped.'
- id=F-011; severity=MINOR; category=coupling risk; location=_shared/lib/product.cjs:32
  (usage/CODE_SCOPE_STAGES injected via init); description=product.cjs depends on
  usage() and CODE_SCOPE_STAGES being injected by the facade's init() before any cmdProduct*
  call. The guard (throw if uninitialized) is correct, but this hidden temporal coupling
  means any future caller that requires product.cjs without calling init() first will
  crash at runtime rather than import time. As more groups are extracted with the
  same pattern, this shared-mutable-facade-injection approach will multiply.; recommendation=Acceptable
  for now given the guard. If further groups adopt this pattern, consider passing
  shared deps as explicit function arguments or a single frozen context object required
  at module top, rather than module-level mutable let usage, to make the dependency
  contract enforced by signature rather than by call-order convention.
- 'id=F-012; severity=MAJOR; category=broken agent link; location=skills/a1-analyze/agents/walter-link.md:8;
  description=Agent link file references ''a1-walter-web-developer-web-developer.md''
  (doubled suffix) instead of ''a1-walter-web-developer.md''. This breaks the pointer
  to Walter''s agent definition and will fail at runtime when the a1-analyze onboarding
  focus tries to spawn Walter as the web-heavy stack specialist.; recommendation=Fix
  line 8: change ''a1-walter-web-developer-web-developer.md'' to ''a1-walter-web-developer.md''.'
- id=F-013; severity=MINOR; category=sparse learning file; location=skills/a1-progress/_learning.md;
  description=The _learning.md file for a1-progress is empty (0 lines). Not an error,
  but indicates the skill has not yet captured any lessons or observations from runs.;
  recommendation=Informational only. a1-progress can populate _learning.md as it encounters
  learning opportunities during execution.
- id=F-014; severity=MINOR; category=incomplete agent metadata; location=agents/a1-*.md
  (all 18 agent files); description=Agent definition files lack consistent frontmatter.
  17 of 18 agents missing 'role:' field, 3 missing 'model:' field. This makes agent
  metadata incomplete for automated tooling and agent routing.; recommendation=Add
  consistent frontmatter to all agent files with 'role:' (e.g. researcher, executor,
  reviewer) and 'model:' fields. Can auto-generate from the a1-[firstname]-[role].md
  filename convention.
- 'id=F-015; severity=MAJOR; category=command injection; location=_shared/a1-tools.cjs:4271
  (gitLastTouchIso); description=Command injection in gitLastTouchIso(). File-path
  refs are interpolated into an execSync shell string via `git ${args.map(a => JSON.stringify(a)).join(''
  '')}`. JSON.stringify only double-quotes each token, it does NOT escape shell command-substitution,
  so a ref like ''a/$(touch /tmp/pwned).md'' is executed by the shell inside the double
  quotes (confirmed empirically end-to-end by the security lane). Refs originate from
  cmdReconcileParseSpec inline-code file anchors whose only gate is ''contains / and
  ends with a known extension'' — shell metacharacters pass through freely. Reachable
  via `a1-tools reconcile parse-spec`, specs are also machine-generated by a1-modernize/a1-rafael
  from analyzed (potentially untrusted) codebases, so a hostile file path in a target
  repo can surface verbatim as an anchor ref.; recommendation=Do not build a shell
  string. Use execFileSync(''git'', [''log'',''-1'',''--format=%cI'',''--'', ...filtered],
  {cwd: repoPath}) with the argument-array form (as _shared/lib/worktree-registry.cjs
  already does), which passes each ref as a literal argv entry with no shell involved.
  As defense-in-depth, reject refs containing shell metacharacters ($ ` , | & < >
  ( ) newline) before use.'
findings_count:
- blocker=0
- major=8
- minor=7
suggested_next:
- skill=a1-fix; reason=Confirmed command-injection RCE in reconcile git helper; target_findings=F-015
- skill=a1-new-feature; reason=Continue M9 module split of a1-tools.cjs + add fixtures
  + register modernize in HELP; target_findings=F-006,F-007,F-008,F-009,F-011
- skill=backlog; reason=Docs-vs-reality sync + convention self-consistency; target_findings=F-001,F-002,F-003,F-004,F-005,F-010,F-012,F-013,F-014
tags:
- analysis
- project/a1-specforge
- focus/quality
permalink: vault/project/a1-specforge/analyses/2026-07-12-quality
---
