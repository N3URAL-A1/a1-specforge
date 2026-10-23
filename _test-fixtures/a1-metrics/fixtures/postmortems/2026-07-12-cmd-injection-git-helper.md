---
type: postmortem
bug_slug: cmd-injection-git-helper
project: a1-specforge
date: 2026-07-12
severity: blocker
terminal_status: fixed
root_cause_class:
- schema_flaw
fix_wave_count: 1
diagnosis_rounds: 1
phase_that_produced_most_friction: none
quak_regression: passed
fix_required_test_first: true
one_line_learning: JSON.stringify is not a shell-escaping function — any exec call
  that builds a shell command string from JSON.stringify-quoted args is command-injection-vulnerable;
  only execFileSync's argv-array form is safe
created_at: 2026-07-12 07:40:38.462000+00:00
permalink: vault/project/a1-specforge/postmortems/2026-07-12-cmd-injection-git-helper
---

# Postmortem: cmd-injection-git-helper (2026-07-12)

## Bug Summary

`_shared/a1-tools.cjs` built shell command strings for `git`/`find` by
`JSON.stringify`-quoting arguments and interpolating them into a template
passed to `execSync`. `JSON.stringify` only produces valid JSON string
syntax — it has no awareness of POSIX shell metacharacters, so `$(...)`
and backticks inside a double-quoted token still execute. Surfaced by the
2026-07-12 quality/security audit (finding F-015) as a confirmed, empirically
reproduced RCE reachable via `reconcile parse-spec` on a spec containing a
hostile inline-code file anchor. A sibling-site sweep during diagnosis found
5 more instances of the same anti-pattern across `_shared/a1-tools.cjs`.

## Timeline

| Time | Event |
|------|-------|
| 2026-07-12T07:30 | Reported (sourced from audit finding F-015) |
| 2026-07-12T07:33 | Diagnosed (Falk — confirmed root cause + found 5 sibling sites) |
| 2026-07-12T09:38 (commit 5bf64ce) | Fixed (Walter) |
| 2026-07-12T07:40 | Verified (orchestrator, independent re-check) |

## Root Cause

Manual shell-string construction for `execSync` instead of the argv-array
form of `execFileSync`. `JSON.stringify(arg)` wraps a value in double quotes
and escapes JSON-string specials, which is coincidentally *close enough* to
shell-safe quoting to look correct in casual review, but does not neutralize
shell command-substitution (`$(...)`, backticks) or variable expansion
(`$VAR`) — those remain live inside a double-quoted shell token. Any
attacker-influenced string reaching such a call site (file paths from parsed
specs, `--repo-path`/`--since` CLI flags) achieves arbitrary command
execution.

## Contributing Factors

- The anti-pattern was not isolated to one function — 6 call sites across
  the file used variations of the same manual string-building, because no
  single shared "run git safely" helper existed to funnel all git
  invocations through. `worktree-registry.cjs` had already solved this
  correctly (`execFileSync` argv-array) but the pattern was not applied
  repo-wide when other call sites were added.
- Anchor/path extraction (`extractAnchorsFromSpec`/`classifyAnchor`) only
  gated on "contains `/` and ends with a known extension" — no
  metacharacter filtering at the point untrusted content enters the system.
- No existing regression test exercised a hostile path/ref value through
  these code paths, so the vulnerability shipped silently across several
  milestones (M6–M9) without being caught by the existing fixture suite.

## What Went Well

- The bug was caught by a proactive quality/security audit (a1-analyze),
  not by exploitation — the always-on security lane earned its keep here.
  See `.a1/learnings/projects/a1-specforge/analyses/2026-07-12-quality.md`.
- Diagnosis (Falk) went beyond the single reported site and swept for
  sibling instances of the same anti-pattern before any fix was written —
  this caught 5 additional live injection points that would otherwise have
  been left behind by a narrowly-scoped fix.
- The Isolation Gate (dedicated worktree + branch) meant the fix could be
  built and independently verified without touching the primary checkout.
- Fix included empirically-verified red→green regression tests (stash the
  fix, reproduce real RCE against the vulnerable code, restore the fix,
  confirm green) rather than tests that merely assert the new code path
  runs without checking it actually blocks the exploit.

## What Didn't Go Well

- No friction in this run (single diagnosis round, single fix wave, all
  pre-existing + new tests green on first attempt).

## One-Line Learning

JSON.stringify is not a shell-escaping function — any exec call that builds a shell command string from JSON.stringify-quoted args is command-injection-vulnerable; only execFileSync's argv-array form is safe

## Suggested Lesson (for promote-lessons to evaluate)

Whenever a code agent or reviewer sees `execSync`/`exec` combined with
template-string interpolation of a variable (regardless of what quoting
function wraps it), treat it as a BLOCKER-class finding by default — the fix
is always to switch to `execFileSync`/`spawnSync` with an argv array. This
should become a standing check in a1-reinhard-reviewer's security checklist
and in a1-analyze's always-on security lane, not something that has to be
rediscovered per call site.