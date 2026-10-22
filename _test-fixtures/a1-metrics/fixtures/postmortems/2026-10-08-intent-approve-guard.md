---
type: postmortem
bug_slug: intent-approve-guard
project: a1-specforge
date: 2026-10-08
severity: major
terminal_status: fixed
root_cause_class:
- missing_wiring
fix_wave_count: 1
diagnosis_rounds: 1
phase_that_produced_most_friction: fix
quak_regression: passed
fix_required_test_first: true
one_line_learning: A guard that exists for one owner-command family must be a shared,
  exported helper that every owner command in the repo calls — three later commands
  copied the TTY check but not the Claude-context guard; a suite-level case 'every
  command that reads /dev/tty refuses under CLAUDECODE=1' would have caught it at
  merge.
created_at: 2026-10-08 09:07:07.423000+00:00
permalink: vault/project/a1-specforge/postmortems/2026-10-08-intent-approve-guard
---

# Postmortem: intent-approve-guard (2026-10-08)

## Bug Summary

`intent approve`, `intent seal` and `intent device add` accepted any caller whose stdin/stdout was a terminal and read the confirmation (or printed a new device secret) on `/dev/tty`. `script(1)` gives an agent a terminal, so a Claude Code session could re-approve a rejected intent, re-seal the code base or read a fresh device secret. The xprov owner commands and `intent install-agent` already had the environment-plus-ancestry guard; these three did not.

## Timeline

| Time | Event |
|------|-------|
| 2026-10-08 10:15 | Reported — a1-analyze F-004 (Samuel security lane), orchestrator re-measured at file level |
| 2026-10-08 10:35 | Diagnosed — Falk: root cause with file:line, found the sibling site `intent device add` |
| 2026-10-08 10:58 | Fixed (commit 02efecb) — Walter: shared `claudeContextRefusal(env)` export, three call sites, 8 pty fixtures red → green |
| 2026-10-08 11:05 | Verified — a1-intent suite 1056/1056 in the worktree, F004-A1..A4 PASS |
| 2026-10-08 11:25 | Review (Reinhard) mergeable, 0 BLOCKER/MAJOR; follow-ups ba5caef (CI red on Linux) → 84f4881 (portable, measured in Docker node:20) |
| 2026-10-08 12:30 | Merged — PR #29 squash `4fcfcb3`, CI green (33 suites) |

## Root Cause

`missing_wiring`. Spec 011 shipped the three owner commands with a copy of the TTY check (`requireTty` / `isTty`) but without the Claude-context guard that spec 009 Wave 7c had introduced for the xprov owner commands (`guardRefusal` → `ancestryRefusal`). The guard helper `claudeContextRefusal` existed in `intent-agent.cjs` only as a private function, so the next command authors could not reuse it and did not know it was required. `drainTty` discards only input typed before the prompt, so a delayed `printf 'yes\n'` through `script` is read as the owner's answer.

## Contributing Factors

- The guard was private to one module (`intent-agent.cjs`) and duplicated `CLAUDE_ENV_RE` — no single export to call.
- No suite-level invariant "every command that reads `/dev/tty` refuses under `CLAUDECODE=1`"; each command's fixtures test its own happy path.
- The project PreToolUse hook matches only the xprov owner-command text, so it offered no backstop for `intent *`.
- Review of spec 011 (Samuel + Reinhard) looked at the commands individually and did not compare them against the xprov guard set.

## What Went Well

- The analysis finding carried exact file:line evidence; the orchestrator verified it in one grep before dispatch.
- Falk found the worse sibling (`device add` discloses a signing secret) and the right seam for `seal` (do not call `guardRefusal()` there — it reads real fds and bypasses the `d.isTty` test seam).
- Red-first on a real pty with three variants (env, entrypoint, fake `claude` parent with env stripped); negative proof by removing the guard in a scratch copy — all 7 pty cases went red.
- Scope dry-run flagged the hook as held by in-flight spec 013, so the fix stayed library-only and did not collide.

## What Didn't Go Well

- Walter renamed the case labels after his last full run and only did `bash -n`; the orchestrator re-ran the suite (green) — a rename must trigger a rerun.
- The hook pattern for the three commands is a handoff to spec 013 Wave 4, not closed here.
- Same-user escapes (detach to pid 1, `launchctl submit`, AppleScript) remain for all owner commands — accepted residual, same as for xprov.
- CI red on Linux for the review follow-up (ba5caef): F004-A5 simulated an unreadable process tree with `env -i PATH=/nonexistent` (no `ps`); on Linux `ancestryRefusal` reads `/proc` (xprov-approve.cjs:260-267), so the guard passed and `seal` really wrote in the sandbox. Reviewer and executor both measured on macOS only — the recorded lesson "CI-Portabilität: Check statt Lehre" (2026-10-03) recurred. Replaced by a stub-seam throw (`ancestryThrows`) identical on both platforms and measured under Linux before the re-push.

## One-Line Learning

A guard that exists for one owner-command family must be a shared, exported helper that every owner command in the repo calls — three later commands copied the TTY check but not the Claude-context guard; a suite-level case 'every command that reads /dev/tty refuses under CLAUDECODE=1' would have caught it at merge.

## Suggested Lesson (for promote-lessons to evaluate)

Agent: a1-walter-web-developer / a1-reinhard-reviewer. Rule: any new CLI command that prompts on `/dev/tty`, writes a guarded store or prints a secret MUST call the one exported Claude-context guard (`claudeContextRefusal` in `xprov-approve.cjs`) before its first write or prompt, and the review checklist compares every owner command against that guard set. Add a suite-level case that greps the lib for `/dev/tty` readers and runs each under `CLAUDECODE=1` expecting refusal.