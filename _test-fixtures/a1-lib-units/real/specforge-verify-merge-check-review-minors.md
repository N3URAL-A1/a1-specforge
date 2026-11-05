---
type: bug-report
project: a1-specforge
bug_slug: verify-merge-check-review-minors
title: Spec 017 review follow-ups — verify/merge-check MINORs left open at merge of
  PR
status: reported
severity: minor
reported_at: 2026-10-22T01:00
reporter: orchestrator (Reinhard round D, Samuel re-review, PR
affected_repos:
- a1-specforge
related_deploy: null
duplicate_of: null
phase_history:
- phase=report completed=2026-10-21T23:00:00.000Z
recommended_code_agent: null
fix_commit: null
verify_result: null
class_query: null
root_site: null
tags:
- bug
- project/a1-specforge
permalink: vault/project/a1-specforge/fixes/2026-10-22-verify-merge-check-review-minors
---

# Bug: Spec 017 review follow-ups — verify/merge-check MINORs left open at merge of PR #55

## Symptom

Reviews of PR #55 approved the merge with these MINORs open. None blocks the merge; each is a fail-open edge or a hygiene gap.

1. `_shared/lib/verify-run.cjs:110-113` — `expandEach` falls back to the live working tree on ANY git failure (64 MiB buffer overflow, offline partial clone, missing object), not only when the repo has no commit. Under `--base` both sides then list live-tree files; the base snapshot lacks them, the base goes red, and a head failure can be relabelled `pre_existing_red`. Fix: fall back only when `ref === 'HEAD'` and there is no commit; otherwise `VerifyError`; pass the literal leading path segments as an `ls-tree` pathspec.
2. `verify-run.cjs:139-140` — without `--base`, a new suite that is not yet committed is not run (PASS while it never ran). Option: `git ls-files -z --cached --others --exclude-standard`.
3. `verify-run.cjs:453-462` — `headCommands` does not enforce `MAX_COMMANDS` (500) on the head re-expansion (cost/DoS only).
4. `_shared/lib/xprov-hook-merge.cjs:40` — the merge hook accepts but does not require `--match-head-commit`; a merge without the pin passes the hook (hook inactive while the Codex permit is denied).
5. Samuel MINOR-C [THEORETICAL] — intent deny rules are exact case-sensitive paths; on case-insensitive APFS `.A1/Verify.json` may reach the same file. Needs a measurement with a real child.
6. SEC-9 residual (documented in ADR §6): suites run with the owner's env (vault vars now dropped) and the base snapshot links the head `node_modules`.
7. `pr merge-check` has no per-run timeout override and no `--help`. On a loaded machine (2026-10-22, PR #55 at 43cef25) `a1-xprov` and `a1-vault-cockpit` exceeded the 30-min `timeout_ms` and the check went red with cause `timeout`, while CI on the same head was green. Raising `timeout_ms` in `.a1/verify.json` is a config change that needs a new disposition. Option: `--timeout-ms` that may only raise the limit and is recorded in the report. Interim fix in PR #55 (6843a33): file-wide `timeout_ms` 120 min, upheld by Reinhard with a MINOR: a hung suite now costs up to 2 h; `each` has no per-suite timeout, so add `each_timeouts` (or per-glob override) and set 60 min only for a1-vault-cockpit and a1-xprov.
8. NITs: `suiteEnv` sits between the group-runner JSDoc and `groupRunnerMain`; ADR sentence that a `suite_removed` fingerprint over the same id set replays across PRs.

## Reproduction Steps

See the probes named in each item (Reinhard round D report, Samuel re-review of PR #55).

## Environment

- App version / commit: feature/017-enforced-self-checks 43cef25

## Frequency

edge cases only

## Impact

Rare fail-open paths in `verify run --base` / `pr merge-check`; no known exploitation by an over-helpful agent in the normal flow.

## Affected Components

- `_shared/lib/verify-run.cjs`, `_shared/lib/xprov-hook-merge.cjs`, `_shared/lib/intent-sandbox.cjs`, `docs/adr/2026-10-14-gate-invoke-and-log.md`

## Notes

Owner decision needed separately (not part of this fix): make the CI `test` job a required check on `main` (branch protection) — today `pr merge-check` sees zero required checks.