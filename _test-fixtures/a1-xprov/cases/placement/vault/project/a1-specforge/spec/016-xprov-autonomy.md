---
id: 016-xprov-autonomy
project: a1-specforge
feature_slug: xprov-autonomy
title: "xprov autonomy: chat consent, review at the right places, self-recovering aborts"
status: implementing
created: 2026-10-14
phase_history:
  - "phase=discover completed=2026-10-14T07:03:04.738Z"
  - "phase=specify completed=2026-10-14T07:03:04.785Z"
  - "phase=clarify completed=2026-10-14T07:03:04.786Z"
  - "phase=plan completed=2026-10-14T07:12:19.401Z"
wave_plan_path: project/a1-specforge/plans/016-xprov-autonomy-wave-plan.md
verify_failures: []
permalink: vault/project/a1-specforge/spec/016-xprov-autonomy
size: L
type: spec
---

# xprov autonomy: chat consent, review at the right places, self-recovering aborts

> Spec ID: `016-xprov-autonomy` · Project: `a1-specforge` · Status: `implementing`

---

## Discovery — Problem

- Source: analysis 2026-10-14 section B, owner record 2026-10-14. 40 owner terminal hand-offs observed: `xprov waive` 15 (6 sessions), `xprov allowlist approve` 13 (5 sessions, gitleaks false positives), `xprov permit` 12 (7 sessions, 6 repos); 7 owner complaints in 5 sessions (2026-10-06, 10-11, 10-12).
- The code contradicts the global rule `xprov-codex.md` step 3: the rule says "no permit means Reinhard-only path", the code returns a blocking `fail` (`external_review_not_permitted`); only a terminal `permit --deny` yields `not_applicable`.
- Codex is placed badly (analysis section C): plan reviews passed 0 of 3 (all ended in round_cap then waiver), waves 4 of 8 clean; a1-new-feature, a1-fix and a1-pr-review never call xprov. Value sits in migrations, infra/deploy scripts and validators.
- 11 aborts in real runs (secret 4, network 2, blocked 2, preflight 1, snapshot base 1, round lock 1) each stopped the pipeline and needed the owner.
- The repo PreToolUse hook blocks read-only `grep` that merely mentions `xprov permit`, `xprov waive` or `allowlist approve`.

## Discovery — Primary User

- Robert (owner, solo operator of the N3URAL repos; not a developer). Agents run the gates on his behalf.

## Discovery — User Journey

- First Codex use in a repo: one chat question (AskUserQuestion, canonical text); yes means all later gates in that repo run without further owner input; no or no answer means Reinhard-only path, never a blocking fail.
- A gate fails and a waiver is the only way on: the agent reports the finding and puts a separate waiver question in chat; on yes the waiver is recorded as evidence.
- Gitleaks hits: unchanged files are excluded from the snapshot automatically and noted in the report; hits in changed lines produce a chat question with a masked excerpt.
- Review flow per PR: Codex diff review on the whole diff in parallel with Reinhard, wired into a1-pr-review (so a1-new-feature and a1-fix get it). Plan review only for size L or security surface; per-wave only for security-surface waves later waves build on.
- After a plugin update the owner runs exactly one batched terminal step (`intent seal` plus `install-agent --force`).

## Discovery — Acceptance Criteria

- Binding decisions (owner record 2026-10-14): repo permit and waivers via chat confirmation stored as evidence; customer repos still need an a1-ludwig-legal record; secret hits in unchanged files auto-excluded, in changed lines chat question with masked excerpt; `intent device add` and `intent approve` stay terminal-only; `intent seal` and `install-agent` batched into one step.
- Missing permit and no answer: `not_applicable` with the Reinhard-only path, matching the global rule.
- Skip rule: size S without security surface and docs-only diffs get `not_applicable` with reason `scope_exempt`.
- Hard stops stay (analysis C): secret in changed lines, `secret_in_output`, `tripwire`, `quarantined`, `run_home_unsafe`, `snapshot_changed_after_scan`, `allowlist_invalid`, `allowlist_modified`, mismatches.

## Discovery — Success Metrics

- Owner terminal hand-offs per phase for xprov in a permitted repo: 0 (today about 40 over the observed sessions).
- Codex runs per phase: at most 3.
- Aborts from `runner_failed` or preflight config that do not self-recover: 0.
- Bytes sent to Codex without recorded consent: 0 (carried over from the paused consent spec).

## Discovery — Out of Scope

- Tier 1 and tier 2 hardening of the consent (sandbox, writer outside the agent's reach, send in a privileged process), Touch ID presence.
- `intent device add`, `intent approve` (stay terminal).
- New providers besides Codex; changing what the reviewers judge or the findings schema.
- The roadmap-drift gate and the escaped-bug measures from analysis sections A and D.

## Discovery — Edge Cases

- Hostile: a prompt-injected agent answers its own consent question or fabricates the marker; a forged evidence file; a consent question with non-canonical wording or several questions; a copied record from another repo; changed origin after consent; `HOME` redirect.
- Parallel agents/lanes asking the same question; no chat reachable (CI, headless, subagent): no new consent, Reinhard-only path.
- Plan edited after a plan review: delta review instead of full re-review.
- Docs-only diff that touches a CI file; size S that touches a migration.

## Discovery — Compliance

- Sending code to Codex is a third-party data transfer. Customer repos (origin missing or outside org N3URAL-A1) need an a1-ludwig-legal record before any consent; a chat yes never replaces it.
- Threat model 2026-10-06: without an OS-level boundary no consent is unforgeable; chat consent is tier 0 (tamper-evident, not tamper-proof). No text may claim more. The owner accepted this equivalence to the terminal guard on 2026-10-14.

## Discovery — Dependencies

- Spec 013 (paused, planned): absorbed as a narrow cut, see Dependencies. Spec 014 owner permit store (merged). Spec 012 xprov gate (done).
- Code: `_shared/lib/xprov-*.cjs`, `_shared/gates-registry.md`, `.claude/hooks/xprov-deny-allowlist-approve.sh`, skills a1-plan 04b, a1-execute 01/02/03, a1-pr-review, a1-new-feature 05/06, a1-fix; global rule `~/.claude/rules/common/xprov-codex.md`.

## Discovery — Priority

- P1 (owner record 2026-10-14: autonomy first). Size L (touches consent, gates, runner recovery, hook, three skills, rule text).

---

<!--
  Phase 2 (Specify) appends from here downward. Until Phase 2 runs, the sections below are
  placeholders and may be empty.
-->

## Overview

xprov sends plans and diffs to Codex as a second, cross-provider review. Today it costs the owner about 40 terminal hand-offs (permit, waiver, allowlist approval), aborts on failures that could self-recover, runs where it finds little (plan reviews) and not where it finds most (whole-PR diffs, migrations, infra scripts), and contradicts the global rule by blocking when no permit exists. This feature moves permit, waiver and allowlist approval to an in-chat owner confirmation stored as evidence, places Codex by a deterministic rule, makes recoverable aborts recover on their own, and fixes the repo hook and the post-update owner step. Chat consent is tier 0: tamper-evident, not tamper-proof, and no text may claim more.

## User Stories

### P1 (Must-have)

**US-016-1** — **As a** repo owner, **I want** to confirm the first send of a repo to Codex with one yes in chat, **So that** I type nothing in a terminal and all later gates in that repo run automatically.

**US-016-2** — **As a** repo owner, **I want** a repo without permit and without my answer to take the Reinhard-only path instead of a blocking failure, **So that** the pipeline never stops on a missing Codex permit (as the global rule already says).

**US-016-3** — **As a** repo owner, **I want** an agent to be unable to create a consent, waiver or approval through its tool path without my real chat answer, and a naive forgery to be detectable afterwards, **So that** removing the terminal step does not let an agent approve a third-party code transfer on its own.

**US-016-4** — **As a** repo owner, **I want** to confirm a waiver or an allowlist approval in chat, bound to the exact plan, wave or file blob, **So that** I decide on what failed without a terminal and an old confirmation never covers a changed target.

**US-016-5** — **As a** repo owner, **I want** Codex to review once per PR on the whole diff in parallel with Reinhard, to review plans only for size L or security surface, and to skip small or docs-only work, **So that** Codex runs where it found real defects and at most 3 times per phase.

**US-016-6** — **As a** repo owner, **I want** recoverable Codex aborts (runner failure, blocked, snapshot base, preflight config, secret hits in unchanged files, round cap) to resolve on their own, **So that** a Codex hiccup never becomes a hand-off to me; only real hard stops reach me.

### P2 (Should-have)

**US-016-7** — **As an** agent working in the a1-specforge repo, **I want** the repo hook to allow read-only commands that merely mention xprov command names, **So that** I can grep and read the code without a false deny.

**US-016-8** — **As a** repo owner, **I want** one batched terminal step after a plugin update (intent seal plus install-agent), **So that** I do not re-learn two commands per update.

**US-016-9** — **As a** repo owner, **I want** the new text for the global rule `xprov-codex.md` prepared in the repo and applied only after the chat path ships, **So that** the rule and the code agree and my file is changed once, deliberately.

### P3 (Nice-to-have)

**US-016-10** — **As a** maintainer, **I want** each xprov run to record hand-offs, Codex runs and abort recoveries as observations, **So that** the success metrics are measured, not assumed.

## Functional Requirements

**Consent (chat instead of terminal)**

- **FR-001** — With no recorded permit for a repo, every command that would send repo content to Codex sends zero bytes (default DENY).
- **FR-002** — Before the first send in a repo without permit, the agent asks exactly one canonical chat question generated by `xprov consent question --kind consent`: German text, one question, two fixed labels with the No label first, naming repo name, absolute path, origin URL, classification, recipient (OpenAI Codex, external third party), what leaves the repo (the exposure sentence of the permit module), that the yes is permanent for the repo, that it covers no waiver, and how to revoke. Free text or any other answer counts as No. The ask happens in exactly these places, each immediately before its `xprov gate` call and only when `xprov permit-check` reports neither permit nor denial: a1-plan `workflows/04b-xprov-review.md` Step 1, a1-execute `workflows/02-execute.md` step 2b-x, and a1-pr-review `workflows/02-review.md` (new step 2.2b, FR-017); a1-execute `01-load.md` Step 0c and `03-verify.md` never ask. Per repo the question is put at most once per phase (`.a1/phases/<name>`) or per PR review run; an unanswered question is not repeated in that phase. Enforced in code (amended 2026-10-15, wave 5): `xprov consent question --kind consent|classification` requires `--phase <name>` (the exact on-disk name of an existing `.a1/phases/<name>`; a case-variant resolves to the listed name and the entry also holds the directory's device + inode, so a renamed phase is the same phase; `--run <id>` is reserved for the PR diff gate, wave 10, and refused with exit 2 until then) and records the ask in the owner store `~/.a1-xprov/consent-asked.json` (audit line `consent-asked`); the hook enforces the same ledger (wave 5 review W5-1): the canonical consent or classification AskUserQuestion is let through only after `consent question` recorded it (`consent_not_asked` otherwise), and one entry opens exactly one marker (`consent_already_asked` for a second ask after the marker was used or expired); a later question for the same repo + kind + phase is refused (`already_asked_this_scope`, no question text) after an owner No, an unanswered question and after `xprov consent revoke` (revoke never touches that store); the same question is shown again only while its marker is still open. A new phase may ask once.
- **FR-003** — A yes answer creates a valid permit without any terminal input: the hook records a pending-yes from the real answer (PostToolUse payload only), and `xprov consent record` turns a matching pending-yes into the entry in the owner permit store `permits.json` plus an evidence entry in `consent.json` (who, when, header, classification, origin, question hash, answer label). `record` writes nothing when no matching, unexpired, unused pending-yes exists.
- **FR-004** — The plugin hook rejects any AskUserQuestion whose header is a consent header (`xprov-Freigabe`, `xprov-Waiver`, `xprov-Allowlist`, `xprov-Einstufung`) unless the question is byte-equal to the canonical one, has exactly one question, and carries no `answers` field; it denies Edit, Write and NotebookEdit on the owner stores and `.a1/xprov.json`; when the hook itself fails, every guarded call is blocked (fail closed). The hook ships in a new plugin file `hooks/hooks.json` (PreToolUse and PostToolUse on AskUserQuestion; PreToolUse on Edit, Write, NotebookEdit). Hardening level is exactly these accept-rules plus the marker binding of FR-005 and the audit chain of FR-010; the plugin contains no Claude Code version canary list, no scan for foreign AskUserQuestion hooks, no answer-duration heuristic and no static writer-allowlist check (all stay deferred, see Dependencies).
- **FR-005** — Each pending marker is bound to repo key, kind, question hash, nonce, and the `tool_use_id` and `session_id` of the PreToolUse call; it expires after 10 minutes, is usable once, and per repo and kind at most one unexpired marker exists (a second asker polls `xprov consent ensure` instead of asking).
- **FR-006** — The permit is permanent per repo (no re-ask after PLAN edit, new phase or new worktree). Repo identity is the realpath of the primary checkout's git-common-dir plus the raw `remote.origin.url` recorded in the evidence; any later difference (including origin appearing or disappearing) voids the permit and the question is asked again.
- **FR-007** — A consent for a customer repo (no `origin`, or `origin` outside org N3URAL-A1) is refused until the owner answered the canonical classification question (`xprov-Einstufung`, read from the stored answer, never from an agent argument) and an a1-ludwig-legal vault record is passed via `--ludwig-record`.
- **FR-008** — Revocation (`xprov consent revoke`, chat or terminal) removes the repo's permit entry and its denial entry whatever channel wrote them; afterwards the repo is back to DENY with no recorded answer and the next send asks again.
- **FR-009** — All owner stores (`permits.json`, `permit-denials.json`, `waivers.json`, `allowlist-approvals.json`, `hit-approvals.json`, `consent.json`, `consent-audit.jsonl`, scan records) resolve under the home directory from the OS user record, never from `$HOME`; when `os.homedir()` differs from `os.userInfo().homedir`, no owner-store writer writes and `permit-check` is not ok.
- **FR-010** — Every consent, revocation, waiver, allowlist approval and denial appends an audit line (timestamp, repo, action, `tool_use_id`, `session_id`, `permission_mode`) chained by the hash of the previous line; `xprov permit-check` reports `enforcement: unenforced` and `audit: ok|missing|broken`, and no help text, rule or report claims the consent is unforgeable.
- **FR-011** — The terminal commands `xprov permit`, `xprov permit --deny`, `xprov waive` and `xprov allowlist approve` keep working behind their TTY guard; the value `owner-chat` is reserved for chat-written entries and rejected as `--by` value in the terminal.

**Missing permit and waivers**

- **FR-012** — For a repo with no permit and no answer (question unanswered, answered No, or no chat reachable), `xprov gate` returns verdict `not_applicable` with reason `external_review_not_permitted`, `xprov load-check` (a1-execute `01-load.md` Step 0c and the pre-wave check in `02-execute.md`) and `xprov wave-status` (`03-verify.md`) accept it with exit 0, the `not_applicable` rows of the routing tables in a1-plan `04b-xprov-review.md` Step 2 and a1-execute `02-execute.md` step 2b-x and the new a1-pr-review step 2.2b continue with Reinhard-only review and a one-line notice, and the retro records `verdict: not_applicable` with issue tag `xprov_not_applicable`; the exit path is never a blocking `fail`. A No answer is recorded by `xprov consent record` as an `owner-chat` denial in `permit-denials.json` (same effect as `xprov permit --deny`, reason `external_review_denied`), so the question is not asked again in that repo until `xprov consent revoke` removes the denial; an unanswered question or a run without chat records nothing. A corrupt or mismatching store (denial next to permit, unusable store) stays a fail-closed mismatch.
- **FR-013** — A waiver is a separate chat decision, asked at most once per phase (`.a1/phases/<name>`) or per PR review run: the agent first reports what failed, then `xprov consent question --kind waiver --phase <name>` (or `--work-path <worktree>` for `pr-diff-xprov`) produces one canonical question (header `xprov-Waiver`) that lists every gate target that is failed at that moment, read by the command itself from `xreview/index.json` and the run records, never from agent arguments; each listed target shows gate id, the key fields of the existing waiver record (repo, phase, gate, PLAN.md sha, wave, lane, head, base, as applicable), the fail reason and the titles of open BLOCKER/MAJOR findings. On yes, `xprov consent waive` writes one waiver record per listed target, identical in shape to `xprov waive` with `by: owner-chat`, and only against a matching, unexpired, unused pending-yes. The yes covers exactly the listed targets: a target whose key changes afterwards (new PLAN.md sha, new head) and a gate that fails after the question was put are not covered and need a new question. No answer or No writes nothing; the targets stay failed and the existing `blocking` routing (halt) applies. The consent to send (FR-002) never implies a waiver.
- **FR-014** — An allowlist approval is a separate chat decision: `xprov consent question --kind allowlist` produces one canonical question per secret scan (header `xprov-Allowlist`) that lists every hit in a changed line of that scan, each with file path, blob sha, rule id and a masked excerpt (matched value replaced by a fixed mask, never the secret); on yes `xprov consent allowlist` writes one hit-approval record per listed hit (repo key, path, rule id, blob sha, scan, `by: owner-chat`, audit link) into its own store `~/.a1-xprov/hit-approvals.json`, which only the FR-029 hit check reads; it never writes `allowlist-approvals.json`, the allowlist evaluation never reads the hit store, and a hit blob that parses as an allowlist document is refused (approving an allowlist file stays the terminal `xprov allowlist approve`); the yes covers exactly the listed hits, and a changed blob or a new hit needs a new question.

**Placement of Codex**

- **FR-015** — `xprov scope` (new, deterministic, no LLM) classifies a path list or diff as `security_surface: true|false` with the matched paths. Security surface is the union of: the `FORBIDDEN_SURFACE_GLOBS` used by `quick eligibility`; auth, session and permission code; payment code; tenant-boundary and row-level-security code; migration directories and SQL files; route and API-endpoint definitions; dependency manifests and lockfiles; secrets and env templates; CI workflows; deploy, Docker, Terraform and other infra scripts. The glob list lives in one file, `_shared/lib/xprov-scope-globs.json` (new), which imports `FORBIDDEN_SURFACE_GLOBS` from `_shared/lib/quick.cjs` rather than copying it; identical input yields identical output.
- **FR-016** — `xprov scope` classifies a diff as `docs_only` when every changed path is documentation (`*.md`, `docs/**`, `LICENSE`, images under `docs/`) and no changed path is security surface.
- **FR-017** — a1-pr-review `workflows/02-review.md` gets a new step 2.2b that runs `xprov gate --gate pr-diff-xprov --work-path <worktree_path> --base <merge-base sha of main...HEAD> [--spec <spec path>]` in parallel with the Reinhard spawn of step 2.2; the gate takes no `--phase` and keeps its index, run records, observations and dispositions under `<worktree_path>/.a1-review/xreview/`. Step 2.4 writes Codex findings into `findings.json` next to Reinhard's, each tagged `source: codex` or `source: reinhard`; BLOCKER and MAJOR findings follow the existing a1-pr-review rules (step 2.6 and the Hand-offs fix-then-merge rule). a1-new-feature (`06-verify.md` hand-off to a1-pr-review, which passes the spec path as `--spec`) and a1-fix (`SKILL.md` worktree step 3 hand-off, no `--spec`) reach this step only through a1-pr-review; neither skill nor a1-new-feature `05-implement.md` calls xprov anywhere else. a1-new-feature feature wave plans (vault `project/<slug>/plans/`) get no plan review and no wave review.
- **FR-018** — The PR diff review runs at most once per head sha; a repeat on the same sha reuses the recorded result, and a new head sha after fixes triggers a delta run on the commits since the reviewed sha.
- **FR-019** — Plan review (`xprov gate --gate plan-review-xprov`, a1-plan `04b-xprov-review.md` Step 1) runs only when the size is L or `xprov scope` reports security surface for the files the plan names; otherwise the gate returns `not_applicable` with reason `scope_exempt` and sends zero bytes. The gate determines both inputs itself, never from an agent flag: size is the `size:` field of the spec file named by PLAN.md's frontmatter `spec:` (missing file, inline description or missing field = size unknown, decided by security surface alone); the plan's files are the backtick-quoted relative paths inside its `## Wave` sections.
- **FR-020** — Wave review (`xprov gate --gate wave-inspect-xprov`, a1-execute `02-execute.md` step 2b-x) runs only for a wave whose diff (`--base <PRE_WAVE_HEAD>` to HEAD) is security surface and that a later wave of the same PLAN.md names in its `**Depends on:** Wave <N>` line (the field the lane-split check already parses); every other wave returns `not_applicable` with reason `scope_exempt`, and `xprov wave-status` accepts it.
- **FR-021** — `pr-diff-xprov` returns `not_applicable` with reason `scope_exempt` and sends zero bytes when the diff is `docs_only`, or when the `--spec` file's `size:` is S and the diff has no security surface; without `--spec` (a1-fix, direct calls) only the `docs_only` exemption applies. Plan and wave gates of a size-S phase without security surface are exempt through FR-019 and FR-020. The retro records `verdict: not_applicable` with the reason `scope_exempt`.
- **FR-022** — Codex runs per phase (plan review, wave reviews, PR diff review; rounds, retries and delta runs of one gate target count as one run) never exceed 3 in a fixture a1-plan/a1-execute phase of size L with one security-surface wave on which a later wave depends, followed by its a1-pr-review run.
- **FR-023** — `_shared/gates-registry.md` registers the new gate id `pr-diff-xprov` (a1-pr-review `02-review.md` step 2.2b, `applies_to: permitted-repos`) with enforcement `warning`: a Codex `fail` puts a warning block into the PR review report and does not block the merge. The cell flips to `blocking` only in the commit that records one live PR diff review in the ADR `docs/adr/2026-09-24-cross-provider-review-gate.md` section "Live smoke", the rule the two existing gates followed. The descriptions of `plan-review-xprov` and `wave-inspect-xprov` are updated for the placement rule, the `scope_exempt` and `codex_blocked_fallback` reasons, the round-cap dispositions (FR-025) and the no-permit `not_applicable`; `check-enforcement.sh` exits 0.

**Self-recovery**

- **FR-024** — On `runner_failed` whose cause is network, timeout or an HTTP 5xx answer, `xprov gate` retries the runner call at most 2 times, waiting 30 s before the first and 120 s before the second retry; `runner_failed` of any other cause (schema, quarantine, local error) is not retried. Each attempt and the final reason are written to the run record; after the second failed retry the gate returns `fail` with reason `runner_failed`.
- **FR-025** — On `round_cap` (round 2 completed without APPROVED) of any of the three gates: when round 2 holds no entry in `blocker[]`, the agent writes the round-2 dispositions file (`xreview/<gate>-<target>-r2.dispositions.md`, one line per finding id: `fixed: <what changed>` or `accepted: <reason>`, a `quarantined_blockers[]` entry is disposed like a MAJOR) and runs the new `xprov dispose` with the gate's target flags; `dispose` succeeds only when every MAJOR, MINOR and quarantined id carries `fixed` or a non-empty `accepted` reason, then writes an index entry `accepted: dispositions` bound to the target key at dispose time (for the plan gate the PLAN.md sha after the fixes). `xprov load-check` and `xprov wave-status` accept that entry, no waiver record and no owner question is created, and the retro records `verdict: fail` with the issue tag `xprov_disposed` (added to the tag lists in a1-plan `04b-xprov-review.md` Step 4 and a1-execute `03-verify.md` `issue_classes`). A MAJOR the agent leaves without `fixed`/`accepted` makes `dispose` fail, and that target goes into the per-phase waiver question of FR-013. Any open BLOCKER in round 2 keeps the hard stop: `dispose` refuses, the gate stays `fail`, and only the FR-013 waiver path leads on.
- **FR-026** — On `blocked`, the run retries once; if it is blocked again the gate returns `not_applicable` with reason `codex_blocked_fallback`, `xprov load-check` and `xprov wave-status` accept it, the report states that Reinhard review is the only review for this target, and no owner question is asked.
- **FR-027** — On `snapshot_failed` caused by an unresolvable base, the runner recomputes the base once (merge-base against the default branch, fetching the ref when missing) and retries; if the recomputed base fails too, the run stops with the original reason.
- **FR-028** — On `preflight_failed`, the gate repairs only inside the dedicated review home (`CODEX_HOME` of the xprov runner, `~/.codex-a1-review`, never `~/.codex`) and only with the three existing additive actions: remove `$CODEX_HOME/plugins` (the `plugins_cache_empty` remedy of `04b-xprov-review.md`), `xprov init-home --pin-features`, and `--prune-marketplaces`; it re-runs preflight once and records the repair in the run record. A check these actions cannot fix (a human-set `true` that `--pin-features` refuses, `etc_codex_absent`, `not_logged_in`) is not repaired, and a repair that does not verify stops with `preflight_failed` (or `not_logged_in`).
- **FR-029** — A secret-scan hit in a file that has no change in the diff excludes that file from the snapshot, rescans the reduced snapshot, and notes path and rule id (never the matched value) in the run record and report; sending fewer files is always safe. A hit in a changed line sends nothing and puts the allowlist question of FR-014 to the owner; No, no answer or no chat ends the gate with `not_applicable` and reason `secret_declined`, Reinhard-only, and `xprov load-check` and `xprov wave-status` accept it.
- **FR-030** — After a PLAN.md change following a passed plan review, the gate runs a delta review (the changed `## Wave` sections plus the frontmatter, Goal and Success Criteria sections as context) instead of a full re-review; a change that touches only whitespace or heading text needs no run, and `xprov load-check` then accepts the earlier pass for the new PLAN.md sha.
- **FR-031** — These stops are never auto-recovered and always reported with their reason: a secret in a changed line sends nothing until the owner approves (FR-029), `secret_in_output`, `tripwire`, `quarantined`, `run_home_unsafe`, `snapshot_changed_after_scan`, `allowlist_invalid`, `allowlist_modified`, and any permit/denial/store mismatch.

**Hook, update step, rule text, measurement**

- **FR-032** — `.claude/hooks/xprov-deny-allowlist-approve.sh` allows a Bash command when every command segment (split on `;`, `&&`, `||`, `|`, newline) starts with a read-only program (`grep`, `rg`, `cat`, `head`, `tail`, `wc`, `ls`, `sed -n`, `git log`, `git diff`, `git show`) and the text contains no redirect, `-i`, command substitution or backtick; any other segment is matched against the existing deny patterns, so `grep x; xprov permit` and `xprov permit` itself stay denied, `xprov permit-check` stays allowed, and `xprov consent ...` is allowed.
- **FR-033** — A single owner command (`a1-tools intent post-update`) runs `intent seal` and `install-agent --force` together behind the same TTY guards as today, prints one combined result, and the post-update owner instructions (`_shared/intent-contract.md`, `_shared/lib/help-intent.cjs`, and the stderr hints in `_shared/lib/intent-cli.cjs` and `_shared/lib/intent-agent.cjs` that today name `install-agent --force`) name only this command; `intent device add` and `intent approve` are unchanged and stay terminal-only.
- **FR-034** — The repo contains the full proposed text for `~/.claude/rules/common/xprov-codex.md` at `docs/xprov-codex-rule-proposal.md` (chat consent flow, no-permit Reinhard path, placement rule, tier-0 wording, customer-repo rule, hard stops); the owner's file is changed only as the last step of the last wave, after the chat path is merged and verified, with record `2026-10-14-a1-autonomy-chat-consent` as authority.
- **FR-035** — Each `xprov gate` run appends one observation line (through `xprov observe`, to `.a1/phases/<name>/observations.jsonl`, or to `<worktree>/.a1-review/xreview/observations.jsonl` for `pr-diff-xprov`) with `owner_handoffs` (owner chat questions put plus terminal commands the run told the owner to type, for that gate target), `codex_runs` (0 or 1 per FR-022 counting), `abort_reason` (reason code or null) and `recovered` (true/false), and the line never contains secret values or repo content.
- **FR-036** — `check-enforcement.sh` and `bash bin/verify-install-sync.sh` exit 0 after the change, and all fixture suites under `_test-fixtures/` pass, with the real owner store unchanged (sha256 and mtime) after the run.

## Success Criteria

- **SC-001** — Owner terminal hand-offs for xprov per phase: 0, measured over one fixture phase (plan, execute, PR) in a permitted repo including one waiver and one allowlist approval answered in chat.
- **SC-002** — Codex runs per phase: at most 3, measured over a fixture phase of size L with one security-surface wave; and 0 runs for size-S non-surface and docs-only fixtures.
- **SC-003** — Aborts from `runner_failed`, `blocked`, base `snapshot_failed`, preflight config, unchanged-file secret hits and `round_cap` without BLOCKER that do not self-recover: 0, measured across an injected-failure matrix with one case per reason.
- **SC-004** — Bytes sent to Codex without a recorded permit: 0, measured in runs with no permit, answer No, no answer, and no chat (headless).
- **SC-005** — No-permit repos: 100 % of runs end `not_applicable` (reason `external_review_not_permitted`) and 0 end in a blocking fail, measured over the three gates.
- **SC-006** — Forgery tests: 100 % of agent-only tool-path attempts (Edit/Write on stores, non-canonical or multi-question consent prompt, model-supplied `answers`, forged marker without matching `tool_use_id`/`session_id`, expired or reused marker, record copied to another repo, origin change, `HOME` redirect, waiver for a changed plan sha) are rejected with zero bytes sent; same-user Bash forgeries are listed as accepted residual risk and each leaves an audit mismatch or `enforcement: unenforced` in `permit-check`.
- **SC-007** — Scope classification: at least 25 fixture diffs (auth, migration, CI, deploy script, lockfile, docs-only, docs plus CI file, size S with and without surface) all classified as expected, and 3 repeated runs per fixture give identical output.
- **SC-008** — Hook: 0 false denials over at least 10 read-only commands that name xprov commands; 100 % denial of at least 8 invocation and evasion forms (`xprov permit`, `xprov waive`, `allowlist approve`, `grep x; xprov permit`, `xprov $v`, tab-separated forms).
- **SC-009** — After a plugin update the owner runs exactly 1 terminal command for the intent queue (down from 2).
- **SC-010** — All fixture suites, `check-enforcement.sh` and `verify-install-sync.sh` exit 0, and the real owner store is byte-identical before and after the suite run.

## Acceptance Scenarios

### US-016-1

**Given** a repo of org N3URAL-A1 without permit and an agent about to start the first plan review
**When** the agent puts the canonical consent question and the owner picks the yes label
**Then** a permit and its evidence exist, the review runs, and the owner typed nothing in a terminal; a later PLAN edit, phase and worktree ask nothing.

### US-016-2

**Given** a repo without permit
**When** the owner answers No, does not answer, or the run is headless
**Then** `xprov gate` returns `not_applicable` (`external_review_not_permitted`), zero bytes are sent, Reinhard reviews alone, and no phase stops.

### US-016-3

**Given** a repo without permit and an agent that received no owner answer
**When** the agent writes a consent via Edit/Write, calls `xprov consent record` without a matching pending-yes, asks a non-canonical or two-question consent prompt, supplies `answers` itself, replays an expired or used marker, copies a record from another repo, or redirects `HOME`
**Then** every attempt is rejected, zero bytes go to Codex, and the attempt is visible in the audit log or as `unenforced` in `permit-check`.

### US-016-4

**Given** a failed plan-review gate with an open BLOCKER and a gitleaks hit in a changed line
**When** the agent puts the waiver question and the allowlist question and the owner answers yes to each
**Then** a waiver for exactly that plan sha and an allowlist approval for exactly that blob exist; **and when** the PLAN.md or the blob changes afterwards, **then** both confirmations no longer apply and a new question is required.

### US-016-5

**Given** an a1-plan/a1-execute phase whose PLAN.md names a size-L spec and has five waves, one of them a migration wave named by a later wave's `**Depends on:**` line, in a permitted repo
**When** the phase runs a1-plan 04b, a1-execute and a1-pr-review
**Then** Codex runs on the plan once, on the migration wave once, and on the whole PR diff once in parallel with Reinhard (3 runs), and the other waves return `not_applicable` (`scope_exempt`); **and given** a size-S docs-only change, **then** all three gates return `scope_exempt` with zero bytes sent; **and given** an a1-new-feature or a1-fix branch, **then** only `pr-diff-xprov` runs.

### US-016-6

**Given** a permitted repo and injected failures: `runner_failed` once, `blocked` twice, an unresolvable base, a broken review-home config, a secret hit in an unchanged file, and `round_cap` with only MAJOR findings
**When** the gates run
**Then** each case recovers or falls back as specified (retry succeeds, Reinhard fallback after the second `blocked`, base recomputed, config repaired, file excluded and noted, dispositions recorded) without an owner question; **and given** a secret in a changed line, `tripwire` or `quarantined`, **then** the run stops with its reason.

### US-016-7

**Given** the a1-specforge repo hook
**When** an agent runs `grep -n "xprov permit" _shared/lib/xprov-permit.cjs`, `rg "allowlist approve" skills`, `sed -n 1,20p` on a file naming `xprov waive`
**Then** the hook allows them; **and when** the agent runs `xprov permit --by x`, `grep x; xprov waive`, or `xprov $cmd`, **then** the hook denies them.

### US-016-8

**Given** a plugin update just finished
**When** the owner follows the update instructions
**Then** one command (`a1-tools intent post-update`) seals the intent queue and reinstalls the agent, and `intent device add` and `intent approve` still need their own terminal steps.

### US-016-9

**Given** the chat consent path is merged and verified
**When** the last wave runs
**Then** `docs/xprov-codex-rule-proposal.md` exists in the repo, and only then `~/.claude/rules/common/xprov-codex.md` is replaced with that text, citing the owner record.

### US-016-10

**Given** any xprov run
**When** it ends
**Then** an observation line with `owner_handoffs`, `codex_runs`, `abort_reason`, `recovered` is appended and holds no secret value.

## Edge Cases

- Hostile: a prompt-injected agent writes a consent question with header `xprov-Freigabe` but different text, or bundles the consent as one of several questions: the hook denies it (FR-004). The agent cannot answer its own question: the pending-yes comes only from the PostToolUse payload of a real answer; a model-supplied `answers` field is rejected before the call.
- Hostile: a forged `consent.json` or `permits.json` written by Bash (same OS user): not preventable at tier 0; the audit chain shows `missing|broken` for naive forgeries and `permit-check` reports `unenforced`; accepted residual risk, stated in plain words in help text and rule.
- Hostile: an evidence file copied from repo A to repo B fails the repo-key check; a changed origin voids the permit; a denial written by an agent is treated like a forged consent.
- Hostile: a prompt-injected agent adds a secret-looking string to a changed line to trigger the allowlist question and nudge the owner into approving: the excerpt is masked and the question names the blob sha, so the approval covers only that blob.
- A hit-bearing file that is unchanged but is the object of the review (for example a security config the PR depends on): it is excluded and noted; the report lists excluded files so Reinhard can cover them.
- No chat reachable (CI, headless, subagent without AskUserQuestion): no new consent, `not_applicable` Reinhard-only path; an already recorded permit is honored without a question.
- Parallel agents or lanes ask the same question: one marker per repo and kind; the second agent polls `ensure`.
- Owner answers after the run timed out: nothing is sent retroactively; the next gate run sees the permit.
- A diff that is docs-only but includes a CI workflow file: security surface wins, not `scope_exempt`.
- Size S that touches a migration: security surface, so it is not exempt; PR diff review runs.
- Existing terminal permits without evidence (three entries of 2026-10-12): count as **no permit** (state `unbound_legacy`, reason `external_review_not_permitted`, `audit: missing`) whatever their `ts`; after Wave 5 the repo runs Reinhard-only and the chat consent question asks once again. (Amended 2026-10-14 during implementation, see Clarifications.)
- Plan edited during a running plan review: the running review is not reused; the delta review applies to the new sha.
- Retry storm: retries are bounded (FR-024, FR-026, FR-027, FR-028); a gate never loops.
- Customer repo with a yes in chat but no a1-ludwig-legal record: refused, the agent points to the missing record.

## Out of Scope

- Tier 1 and tier 2 hardening (strict sandbox, writer outside the agent's reach, send in a privileged process, network egress limits) and OS user presence (Touch ID).
- `intent device add` and `intent approve` (terminal-only by owner decision).
- New review providers besides Codex; changing what Codex or Reinhard judge, the findings schema, or the snapshot and gitleaks rule set (beyond FR-029).
- Roadmap-drift gate (analysis section D) and the escaped-bug measures from analysis section A (gate-0.7 wiring, Victor exit codes, post-deploy probes).
- Codex review inside a1-quick (size S is exempt by FR-021).
- Changing customer-repo decisions (they stay with a1-ludwig-legal).
- Applying the global rule text before the chat path is verified (FR-034).

## Dependencies

- Paused spec 013 (xprov chat consent, status planned, 30 requirements, plan exists). **Absorbed by this spec (narrow cut):** the canonical consent question and its fixed headers; the pending marker with nonce, expiry and one-per-repo-and-kind rule; the hook that records a pending-yes from the real answer and rejects non-canonical consent questions; `xprov consent` subcommands for question, ensure, record, revoke, waive; the evidence store and the hash-chained audit log; the repo-identity and origin-binding rule; the customer-repo classification trigger and legal-record requirement; the OS-user-home resolution with the `HOME` tripwire; the waiver question bound to the waiver record fields; the `owner-chat` reserved value; tier-0 wording rules; the repo-hook adjustment for read-only commands. **Stays deferred (hardening beyond the owner's accepted tier 0, decided in Clarify 2026-10-14, FR-004):** the canary-checked Claude Code version list, the foreign-AskUserQuestion-hook scan, the minimum answer-duration heuristic, the static writer-allowlist check on the permits module, the Bash-text guard on library calls to the permit modules, the write-form-only Bash guard for the mirror file, and the `onFailure: block` per-matcher refinement beyond fail-closed behavior for guarded calls. When 016 is planned, spec 013 is marked superseded-in-part with a pointer here.
- Spec 014 (owner permit store `permits.json`, merged) and spec 012 (xprov gate, `permitted-repos` applicability, merged): the stores and `permit-check` states this spec extends.
- Threat model `project/a1-specforge/analyses/2026-10-06-xprov-consent-threat-model.md` (source for the forgery tests and tier-0 wording) and the owner record `record/2026-10-14-a1-autonomy-chat-consent.md` (authority).
- ADR `docs/adr/2026-09-24-cross-provider-review-gate.md`: addendum for the new gate and `scope_exempt`; `check-enforcement.sh` reads its "Live smoke" section and must not break.
- Code touched: `_shared/lib/xprov-*.cjs`, `_shared/lib/help-xprov.cjs`, `_shared/gates-registry.md`, `.claude/hooks/xprov-deny-allowlist-approve.sh`, a new plugin `hooks/hooks.json` (the plugin has none today), skills a1-plan (04b), a1-execute (01, 02, 03), a1-pr-review, a1-new-feature (05, 06), a1-fix, intent CLI (`post-update`).
- Reservation conflict check: 015 docs-consolidation holds a claim; verify no overlap on `docs/` before planning.
- Global rule `~/.claude/rules/common/xprov-codex.md` (owner's file; changed only per FR-034).
- Security review by a1-samuel-security of the consent path and the hook is required in Plan (auth/secrets surface).

## Clarifications

<!-- Filled by Phase 3. Format: -->
<!-- - **YYYY-MM-DD** — <topic>: <decision>. Reason: <one-sentence>. -->

- (implementation, 2026-10-15) Wave 4 accepted residuals (orchestrator decision after two Samuel review rounds; the source list is measured from the official docs and sits at the top of `_shared/lib/xprov-hook-paths.cjs`): the plugin hook denies Edit, Write, NotebookEdit and MultiEdit on the owner stores (path and device+inode, also when the store directory does not exist yet), `.a1/xprov.json`, the installed a1-specforge plugin cache, and every file of the hook-source class (settings*.json at user, project and local level, managed-settings*.json, `hooks/hooks.json` outside this checkout, `plugin.json` and `marketplace.json`, any `.json` under `~/.claude/plugins`, `SKILL.md` and `.md` files below `agents/` or `commands/`; `$CLAUDE_CONFIG_DIR` counts as `~/.claude`; the lexical and the real path are both matched) by one monotone rule (round 4): an edit that changes such a file is denied when the OLD or the NEW whole content holds `pretooluse`/`permissionrequest`, an escape sequence (in an `.md` only inside the frontmatter region; a file that is the same device+inode as a known settings file counts too), `disableAllHooks`/`allowManagedHooksOnly`, an a1-specforge `enabledPlugins` entry, or (manifests) a `hooks` key. Consequence: a settings file that already holds a hook (this repo's `.claude/settings.json`) can be edited only by the owner or through Bash; dev edits of this repo's own `hooks/hooks.json` from a worktree are denied when the hook runs from the plugin cache, so use Bash (the dev copy is no live hook source); a NotebookEdit of such a file is denied. Accepted tier-0 residuals, named: (1) Bash writes to any of these files; (2) the script of a hook that already exists; (3) MDM and server-managed settings; (4) the `--settings`, `--agents` and `--plugin-dir` launch flags; (5) a hooks `.json` named by a `plugin.json` path outside `~/.claude/plugins` that is not called `hooks.json`; (6) cloud and self-hosted sessions; (7) `claude plugin disable` and the `/plugin` UI; (8) a foreign PreToolUse hook that prefills `updatedInput.answers` is invisible to this hook (Pre sees the input before it, Post `tool_input` always carries `answers`, `duration_ms` is 0). Hook entries set `onFailure: "block"` (Claude Code 2.1.295 or later; older versions ignore the key). The repo hook treats `git` as not read-only (diff.external, textconv and fsmonitor run commands from a config).
- (implementation, 2026-10-15) Wave 5 accepted residuals (Samuel round 2 PASS): the ask-once rule binds repo + kind + phase (exact on-disk name of `.a1/phases/<name>` plus device+inode); a new phase directory, created by Bash or by the Write tool, is a new phase and may ask once — visible in git and in the audit chain (`consent-asked` line), not highlighted to the owner (tier 0). A customer-classified repo uses up the phase's ask when the question is printed (fail-safe: Reinhard-only until the next phase). `--run` is refused until Wave 10 binds it to a verifiable PR run.
- Q: Which hardening level for the consent hook (FR-004)? → A: Option A, lean: canonical-question accept-rules, store write deny, fail closed, marker binding (FR-005) and audit chain (FR-010); version canary list, foreign-hook scan, duration heuristic and static writer-allowlist check stay deferred. Reason: the owner accepted tier 0, and each deferred item defends only against a same-user Bash forger. (orchestrator decision 2026-10-14 per Rene recommendation)
- Q: How granular is a waiver confirmation (FR-013)? → A: Option B: one question per phase (or per PR review run) listing all currently failed gate targets; the yes covers exactly those listed targets (gate id plus target sha/wave/head as listed); a target that changes afterwards or a gate that fails later needs a new question. Reason: fewer interruptions while each yes stays bound to concrete, listed keys. (owner 2026-10-14)
- Q: Enforcement of the new PR diff review gate (FR-023)? → A: Option A: `pr-diff-xprov` ships as `warning` and flips to `blocking` in the commit that records one live PR review in the ADR section "Live smoke". Reason: `check-enforcement.sh` refuses a blocking cell without live evidence, the rule the two existing gates followed. (orchestrator decision 2026-10-14 per Rene recommendation)
- Q: Retry parameters on `runner_failed` (FR-024)? → A: Option A: 2 retries, 30 s then 120 s, only for network/timeout/5xx causes. Reason: covers the observed transient outages and delays a phase by at most 2.5 minutes. (orchestrator decision 2026-10-14 per Rene recommendation)
- Q: Is `round_cap` with only MAJOR/MINOR findings a completion without waiver (FR-025)? → A: Option A: the agent records a disposition (fixed / accepted with reason) per finding and proceeds without waiver; a MAJOR that cannot be disposed with a stated reason goes into the per-phase waiver question; any BLOCKER keeps the hard stop. Applies to all three gates; mechanism is the new `xprov dispose` writing an `accepted: dispositions` index entry. Reason: plan reviews passed 0 of 3 and the hard cap produced waivers, not safety. (owner 2026-10-14)
- Q: Where does the PR diff review live, given a1-fix branches have no `.a1/phases/<name>`? → A: New gate id `pr-diff-xprov` in a1-pr-review `02-review.md` step 2.2b, no `--phase`, state under `<worktree>/.a1-review/xreview/`. Reason: a1-pr-review is the one path shared by a1-new-feature and a1-fix (owner journey), and its state already lives in `.a1-review/`. (Rene decision 2026-10-14 per owner record and a1-pr-review SKILL.md state mechanics)
- Q: Does a1-new-feature get plan and wave reviews? → A: No; a1-new-feature plans feature waves in the vault (Vincente) and implements without a1-plan 04b or a1-execute 2b-x, so it gets Codex only through a1-pr-review. FR-019/FR-020 apply to a1-plan/a1-execute phases; US-016-5 scenario rewritten accordingly. Reason: the owner journey says the PR review is wired in "so a1-new-feature and a1-fix get it"; `05-implement.md` has no xprov step to hook. (Rene decision 2026-10-14 per owner record and skill sources)
- Q: (implementation, 2026-10-14) Do unbound legacy permits stay allowed? → A: No. An entry without `repo`/`origin`/`audit` binding is treated as no permit, of any date. Reason: the Wave 1 security re-review (Samuel, MAJOR-1) showed a date cutoff is forgeable (the attacker writes `ts`), and copying one of the three real legacy entries to another repo key would bypass the binding; the cost is one chat consent question per affected repo, with no terminal step. (orchestrator decision, surfaced to owner in the 016 report)
- Q: (implementation, 2026-10-14) Accepted residuals from the Wave 2 security re-review? → A: (1) `consent revoke` is open to any caller and also removes a terminal `permit --deny`; an agent can therefore make the owner be asked again, but a permit always needs a new owner yes in chat (the "ask once per phase" rule is enforced in code in Wave 5). (2) The `--ludwig-record` existence check only stops typos and invented paths: the vault is agent-writable and `A1_VAULT_ROOT` is agent-controlled, so the real control is that the owner reads the legal-record path in the canonical classification question before answering. Both are tier 0 (same-user agent), consistent with FR-010 "tamper-evident, not tamper-proof". Reason: closing them needs a terminal step or a signed record, which the owner ruled out for the normal path. (orchestrator decision, surfaced in the 016 report)
- Q: Where do the size and the file list for the placement rule come from? → A: Read by the gate, never from agent flags: plan gate = `size:` of the spec named in PLAN.md frontmatter `spec:` plus backtick-quoted paths in `## Wave` sections; wave gate = wave diff plus `**Depends on:** Wave <N>` lines; PR gate = `size:` of the `--spec` file a1-new-feature passes, none for a1-fix (then only `docs_only` exempts). Unknown size = decided by security surface alone. Reason: a size an agent can pass would let it skip review; the sources already carry these fields. (Rene decision 2026-10-14 per agents/a1-pablo-planner.md PLAN.md template and owner journey)
- Q: What does a No to the consent question record? → A: An `owner-chat` denial in `permit-denials.json` (same effect as `xprov permit --deny`), so the repo is not asked again until `xprov consent revoke` removes it; an unanswered question records nothing and is not repeated within the same phase. Reason: the spec already treats denials as audited owner records (FR-010, Edge Cases), and asking again every phase after a No would be the hand-off load this feature removes. (Rene decision 2026-10-14 per owner record item 2 and FR-010)
- Q: Allowlist questions when one scan has several changed-line hits? → A: One question per scan listing every hit (path, blob sha, rule id, masked excerpt); the yes covers exactly the listed blobs. Reason: mirrors the owner's per-phase waiver choice and the record's "a chat question with a masked excerpt". (Rene decision 2026-10-14 per owner record item 3 and FR-013 owner answer)
- Q: Which preflight failures may self-repair (FR-028)? → A: Only the three existing additive actions inside `~/.codex-a1-review` (remove `plugins/`, `init-home --pin-features`, `--prune-marketplaces`); human-set values, `etc_codex_absent` and `not_logged_in` are not repaired. Reason: `xprov-preflight.cjs` already refuses to overwrite a human's value, and login needs the owner. (Rene decision 2026-10-14 per `_shared/lib/xprov-preflight.cjs` header and 04b edge cases)
- Q: What happens to existing terminal waivers and allowlist approvals? → A: They stay valid unchanged; chat-written waivers use the same shape with `by: owner-chat` in the same store. Chat allowlist answers are hit approvals in their own store (see the Wave 3 clarification below). Reason: FR-011 keeps the terminal path. (Rene decision 2026-10-14 per FR-011, amended 2026-10-15)
- Q: (implementation, 2026-10-15) May a chat yes to a secret-scan hit be stored as an allowlist blob approval? → A: No. The Wave 3 security review (Samuel, SEC-1 BLOCKER) showed that a hit file whose bytes are a valid allowlist document, once approved in chat, is accepted by the allowlist loader when the same bytes are later committed as `.a1/xprov-secret-allowlist.json`; real secrets would then go to Codex without the owner ever seeing an allowlist question. Chat hit approvals therefore live in `hit-approvals.json`, read only by the FR-029 hit check; blobs that parse as an allowlist are refused; allowlist file approval stays terminal-only. `hit-approvals.json` and `scan-records/` join the Wave 4 store-path guard. Reason: two consumers of one approval set let a yes to one question act as a yes to another. (orchestrator decision, security tightening, surfaced in the 016 report)

## Review Checklist

- [x] All P1 stories have at least one Acceptance Scenario
- [x] All FRs are binary and testable
- [x] All SCs are measurable
- [x] No clarification markers remain
- [x] Out of Scope is non-empty (be explicit, not implicit)
- [x] Dependencies are listed or explicitly "none"
- [x] Gate C AC dry-run: all PASS

## AC Dry-Run

Text walkthrough against the a1-specforge repo at `e1ccfbf` (read-only; no build, no run). There is no UI: each path is the skill-workflow step and CLI sequence that exists today, with new parts flagged `NEW:`.

- FR-001: PASS — a1-plan `04b-xprov-review.md` Step 1 → `a1-tools xprov gate --phase <p> --gate plan-review-xprov` → existing permit-check step in `_shared/lib/xprov-gate.cjs` (returns before snapshot/run when not permitted); fixture asserts zero runner calls.
- FR-002: PASS — `xprov permit-check` (exists) reports no permit/denial → NEW: `xprov consent question --kind consent` builds the text from `EXPOSURE_SENTENCE` in `_shared/lib/xprov-permit.cjs` → agent puts it via AskUserQuestion in 04b Step 1, `02-execute.md` 2b-x, or NEW: a1-pr-review `02-review.md` step 2.2b.
- FR-003: PASS — owner answers → NEW: PostToolUse hook in NEW: plugin `hooks/hooks.json` writes the pending-yes → NEW: `xprov consent record` writes `~/.a1-xprov/permits.json` (store of spec 014, `xprov-permits.cjs`) and NEW: `consent.json`.
- FR-004: PASS — NEW: PreToolUse hook in `hooks/hooks.json` on AskUserQuestion (header/byte/answers check) and on Edit/Write/NotebookEdit for `~/.a1-xprov/*` and `.a1/xprov.json`; fail-closed exit on hook error; deferred items listed in Dependencies.
- FR-005: PASS — NEW: marker store written by the PreToolUse hook keyed by repo key + kind with `tool_use_id`/`session_id` from the hook payload; NEW: `xprov consent ensure` for the second asker.
- FR-006: PASS — repo key computed from `git rev-parse --git-common-dir` realpath + `git config remote.origin.url`, compared by `xprov permit-check` (exists) against the NEW evidence fields.
- FR-007: PASS — NEW: `xprov consent question --kind classification` (header `xprov-Einstufung`) → stored answer → `xprov consent record --ludwig-record <vault path>`; NEW: origin-org test (no org check exists in `xprov-permit.cjs` today).
- FR-008: PASS — NEW: `xprov consent revoke` removes entries from `permits.json` (`xprov-permits.cjs`) and `permit-denials.json` (`xprov-denials.cjs`); next `permit-check` reports no record.
- FR-009: PASS — owner-store root `path.join(os.homedir(), XPROV_HOME_DIRNAME)` in `_shared/lib/xprov.cjs` switches to `os.userInfo().homedir`; `xprov permit-check` (exists) gains the `HOME` mismatch check.
- FR-010: PASS — NEW: `~/.a1-xprov/consent-audit.jsonl` appended by each consent writer; `xprov permit-check` (exists) gains `enforcement` and `audit` fields; tier-0 wording checked in `_shared/lib/help-xprov.cjs`.
- FR-011: PASS — existing `xprov permit`, `permit --deny`, `waive`, `allowlist approve` (`xprov-permit.cjs`, `xprov-gate.cjs`, `xprov-approve.cjs`) keep their TTY guard; `--by owner-chat` rejected in their argument parsers.
- FR-012: PASS — `xprov gate` permit-check branch in `xprov-gate.cjs` (today `fail` with `external_review_not_permitted`) → `not_applicable`; `xprov load-check` in `01-load.md` Step 0c / `02-execute.md` pre-wave and `xprov wave-status` in `03-verify.md` accept it; routing rows in `04b` Step 2 and `02-execute.md` 2b-x; NEW: a1-pr-review step 2.2b row; No → NEW: `xprov consent record` writes `permit-denials.json`.
- FR-013: PASS — gate fails → agent reports → NEW: `xprov consent question --kind waiver --phase <p>` reads `.a1/phases/<p>/xreview/index.json` → AskUserQuestion → NEW: `xprov consent waive` writes `~/.a1-xprov/waivers.json` (same shape as `xprov waive` in `xprov-gate.cjs`) → `load-check`/`wave-status` accept the waiver as today.
- FR-014: PASS — gitleaks hit from `xprov snapshot` (`xprov-snapshot.cjs`, `xprov-gitleaks.toml`) → NEW: `xprov consent question --kind allowlist` → NEW: `xprov consent allowlist` writes `hit-approvals.json` (own store, read only by the FR-029 hit check; amended 2026-10-15).
- FR-015: PASS — NEW: `xprov scope` + NEW: `_shared/lib/xprov-scope-globs.json`, importing `FORBIDDEN_SURFACE_GLOBS` from `_shared/lib/quick.cjs`.
- FR-016: PASS — NEW: `xprov scope` `docs_only` field over the same path list.
- FR-017: PASS — a1-new-feature `06-verify.md` / a1-fix `SKILL.md` step 3 → `a1-worktree exit --mode handoff` → a1-pr-review `01-detect.md` → `02-review.md` step 2.1 computes `main...HEAD` → step 2.2 Reinhard spawn ∥ NEW: step 2.2b `xprov gate --gate pr-diff-xprov --work-path --base [--spec]` → step 2.4 writes `findings.json` with `source` tags.
- FR-018: PASS — NEW: `pr-diff-xprov` index under `<worktree>/.a1-review/xreview/` keyed by head sha; re-run on the same head returns the stored result; new head → delta from the reviewed sha.
- FR-019: PASS — 04b Step 1 → `xprov gate --gate plan-review-xprov` reads PLAN.md frontmatter `spec:` (template in `agents/a1-pablo-planner.md` Step 5) → spec `size:` → NEW: `xprov scope` over backticked paths in `## Wave` sections → `not_applicable`/`scope_exempt` or run.
- FR-020: PASS — `02-execute.md` 2b-x → `xprov gate --gate wave-inspect-xprov --wave <N> --base $PRE_WAVE_HEAD` → NEW: scope of the wave diff + `**Depends on:** Wave <N>` lookup (parser in `_shared/lib/lane-split.cjs`) → `scope_exempt` accepted by `wave-status` in `03-verify.md`.
- FR-021: PASS — a1-pr-review step 2.2b → `pr-diff-xprov` reads `--spec` frontmatter `size:` + NEW: `xprov scope` `docs_only`; a1-fix call carries no `--spec`.
- FR-022: PASS — fixture phase through 04b, `02-execute.md` 2b-x, a1-pr-review 2.2b; count from NEW: `codex_runs` observation field (FR-035).
- FR-023: PASS — `_shared/gates-registry.md` NEW: row `pr-diff-xprov` (`warning`); rows `plan-review-xprov`/`wave-inspect-xprov` updated; `_test-fixtures/a1-xprov/check-enforcement.sh` reads `docs/adr/2026-09-24-cross-provider-review-gate.md` §6 "Live smoke".
- FR-024: PASS — `xprov gate` runner call (`stepRun` → `runSub` → `xprov run` in `xprov-gate.cjs`) gains bounded retry on `runner_failed` network/timeout/5xx; attempts into the run record (`xprov-runrecord.cjs`).
- FR-025: PASS — round 2 `fail`/`round_cap` from `xprov-gate.cjs` → agent writes `xreview/<gate>-<target>-r2.dispositions.md` (round-1 pattern in 04b Step 3.3) → NEW: `xprov dispose` → index entry `accepted: dispositions` → `load-check`/`wave-status` accept; undisposed MAJOR → FR-013 question; BLOCKER → stop.
- FR-026: PASS — `xprov gate` `blocked` reason from `xprov run` → one retry → `not_applicable`/`codex_blocked_fallback` accepted by `load-check`/`wave-status`.
- FR-027: PASS — `xprov snapshot` `snapshot_failed` (`xprov-snapshot.cjs`) → recompute `git merge-base` against the default branch (fetch when missing) → one retry.
- FR-028: PASS — `xprov preflight` (`xprov-preflight.cjs`) fails → remove `~/.codex-a1-review/plugins`, `xprov init-home --pin-features`, `--prune-marketplaces` (all exist) → preflight once more → run record.
- FR-029: PASS — `xprov snapshot` + gitleaks hit → unchanged file: exclude and rescan (snapshot module) → changed line: FR-014 question → No/no answer: `not_applicable`/`secret_declined`.
- FR-030: PASS — `01-load.md` Step 0c `load-check` sees a new PLAN.md sha → NEW: delta mode of `xprov gate --gate plan-review-xprov` (changed `## Wave` sections + frontmatter/Goal/Success Criteria); whitespace/heading-only → pass carried to the new sha.
- FR-031: PASS — existing reasons `secret_in_output`, `tripwire`, `quarantined`, `run_home_unsafe`, `snapshot_changed_after_scan`, `allowlist_invalid`, `allowlist_modified` in `REASON_LIST` (`_shared/lib/xprov.cjs`) stay outside every retry path; fixture per reason.
- FR-032: PASS — `.claude/hooks/xprov-deny-allowlist-approve.sh` (exists, registered in `.claude/settings.json`) gains the read-only segment rule.
- FR-033: PASS — NEW: `a1-tools intent post-update` in `_shared/lib/intent-cli.cjs` calling existing `intent seal` (`intent-seal.cjs`) and `intent install-agent --force` (`intent-agent.cjs`); text changes in `_shared/intent-contract.md`, `help-intent.cjs`, and the two stderr hints.
- FR-034: PASS — NEW: `docs/xprov-codex-rule-proposal.md` (check reservation 015 on `docs/` first); last-wave copy to `~/.claude/rules/common/xprov-codex.md` citing `record/2026-10-14-a1-autonomy-chat-consent.md`.
- FR-035: PASS — `xprov observe` (`xprov-observe.cjs`, writes `.a1/phases/<p>/observations.jsonl`) gains the four fields; NEW: target `<worktree>/.a1-review/xreview/observations.jsonl` for `pr-diff-xprov`.
- FR-036: PASS — `_test-fixtures/a1-xprov/check-enforcement.sh`, `bash bin/verify-install-sync.sh`, `for r in _test-fixtures/*/run*.sh` (CLAUDE.md Commands) with `unset A1_VAULT_ROOT` and a sha256/mtime check of `~/.a1-xprov/` before and after.