---
type: bug-report
project: a1-specforge
bug_slug: intent-approve-guard
title: "intent approve / seal / device add lack the Claude Code context guard (TTY-only"
status: fixed
severity: major
reported_at: 2026-10-08T10:30
reporter: "a1-analyze F-004 (Samuel), triage + diagnosis by Falk"
affected_repos:
  - a1-specforge
related_deploy: "0a7df78 (main), introduced with spec 011 (PRs"
duplicate_of: null
phase_history:
  - "phase=report completed=2026-10-08T08:30:00Z"
  - "phase=diagnose completed=2026-10-08T08:30:06.833Z"
  - "phase=fix-start completed=2026-10-08T08:59:16.233Z"
  - "phase=verify completed=2026-10-08T09:06:49.180Z"
recommended_code_agent: a1-walter-web-developer
fix_commit: 02efecb
verify_result: "a1-intent suite 1056/1056 green in worktree after fix 02efecb; 8 new F004-A* pty cases pass (approve x3, seal x2, device add x2, export x1); red proof before fix: rc 0 + re-approval/seal/secret printed; negative proof: guard removed -> all 7 pty cases fail"
tags:
  - bug
  - security
  - project/a1-specforge
permalink: vault/project/a1-specforge/fixes/2026-10-08-intent-approve-guard
---

# Bug: intent approve / seal / device add lack the Claude Code context guard (TTY-only check)

## Symptom

`intent approve <path>` and `intent seal` check only that stdin and stdout are terminals and then read the confirmation from `/dev/tty`. An agent can obtain a terminal with `script(1)`, so the check does not prove a human is present. Expected: both refuse like the xprov owner commands and `intent install-agent` do (reason `claude_code_context`, nothing written). Sibling site found by Falk: `intent device add` (`intent-devices.cjs:272-299`) checks only `requireTty()` on stdout and prints a new device secret to `/dev/tty`; under `script` the agent reads that secret and can sign intents directly.

## Reproduction Steps

Derived, NOT executed (it would write to the intent store):

1. Inside a Claude Code Bash tool on the executor host, `A1_VAULT_ROOT` set.
2. `(sleep 2; printf 'yes\n') | script -q /dev/null node _shared/a1-tools.cjs intent approve <vault>/…/rejected/<id>.md`
3. Observed (from the code): summary prints, `drainTty` runs, the delayed "yes" is read as the answer, `reapproveIntent` re-signs the intent with the executor secret.

Expected: refused with exit `EXIT_REFUSED`, reason names the Claude context, nothing written.
Actual: the rejected intent is re-approved; same shape for `intent seal` (new seal without the owner) and `intent device add` (secret disclosed).

## Environment

- macOS executor host (`executor_host === hostname`), any Claude Code session as the same user
- Code as of `0a7df78`; files last changed in `c217928` / `68bb4ea` (spec 011)
- Tenant / role: owner-only commands
- Network: local

## Frequency

always — a missing check, not a race

## Impact

Owner (Robert). An intent he rejected can be re-approved by an agent and then executed by the queue consumer; a re-seal lets an agent change the sealed code base; a disclosed device secret lets an agent sign intents. Same-user precondition (local agent session on the executor host).

## Affected Components

- Repo(s): a1-specforge
- Files: `_shared/lib/intent-approve.cjs` (`cmdIntentApprove` 477-498), `_shared/lib/intent-seal.cjs` (`defaultDeps` 233-242, `prepareSeal` 257-263), `_shared/lib/intent-devices.cjs` (`cmdAdd` 272-299), `_shared/lib/intent-cli.cjs:89-106`, guard sources `_shared/lib/xprov-approve.cjs:281-304,470-471`, `_shared/lib/intent-agent.cjs:113,169-177,209,219-224`
- Fixtures: `_test-fixtures/a1-intent/cases/10-doctor-approve.sh`, `05b-child-seal.sh`, `13-agent.sh`, `stub/a1-tools-as.cjs`

## Recent Changes

Spec 011 introduced the commands without the guard (not a regression — the check was never there). The xprov owner commands received `guardRefusal()` in spec 009 Wave 7c; `intent install-agent` received `claudeContextRefusal()` in spec 011 wave 11.

## Diagnosis (Phase 02 — filled by Falk)

**Hypothesis:** `cmdIntentApprove`, `prepareSeal` and `cmdAdd` have no Claude Code session check, neither on the environment nor on the parent processes. Their only human check is "stdin/stdout is a terminal", and `script` gives an agent that.

**Evidence:**
- `intent-approve.cjs:477-481` — only gate before the prompt is `requireTty(process.stdin) || requireTty(process.stdout)`; `requireTty` (`intent-devices.cjs:252-254`) is `stream.isTTY === true`.
- `intent-approve.cjs:488` `confirmOnTty(...)`, `:440-459` `drainTty` discards only input typed before the prompt; a delayed `printf` counts. `:498` → `reapproveIntent(args[0], { via: 'tty', ... })`.
- `intent-seal.cjs:238` `isTty: () => process.stdin.isTTY === true && process.stdout.isTTY === true`; `:257` `not_a_tty` refusal, then executor-host check, source read, `d.confirm` at 263 — nothing about Claude Code in between.
- `grep guardRefusal|ancestryRefusal|claudeContextRefusal _shared/lib/` matches only xprov modules and `intent-agent.cjs`.
- Safe references: `xprov-approve.cjs:299-304` `guardRefusal()` = real fds are TTYs + no `CLAUDE_ENV_RE` (`/^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*)$/`, line 53) variable + `ancestryRefusal()` (`:281-297`, walks parents up to 256 steps, refuses on `CLAUDE_PID`, a process named `claude`, an executable under `claude/versions/`, or `@anthropic-ai/claude-code` in the command line; fails closed when the tree is unreadable). `cmdApprove` calls it at `:432` before anything else. `intent-agent.cjs:169-177` `claudeContextRefusal(env)` (environment, then `ancestryRefusal()`, fail closed), wired as `defaultDeps.contextRefusal` (`:209`), called in `guardHuman` (`:219-224`) before any write or prompt — but NOT exported (exports at `:584`).
- Hook `.claude/hooks/xprov-deny-allowlist-approve.sh` (header 3-19) matches only the xprov owner commands; it is held by in-flight spec 013 and out of scope here. The library guard alone closes the F-004 attack (`CLAUDECODE` survives `script`; `env -u` still leaves the `claude` parent process). Same-user escapes (detach + reparent to pid 1, `launchctl submit`, AppleScript) remain and are the accepted residual class, identical for the xprov commands.

**Confidence:** high
**Recommended code agent:** a1-walter-web-developer (Node CLI)
**Suggested fix approach:** Export one environment-plus-ancestry helper next to `guardRefusal` in `xprov-approve.cjs` (reuse `CLAUDE_ENV_RE`; `intent-agent.cjs:113` keeps a copy — point it at the export). Call it in `cmdIntentApprove` together with the terminal gate, **before `preflight`** (a preflight refusal records a decision; a Claude-context refusal must write nothing). Call it in `prepareSeal` right after the terminal check via a `contextRefusal` dep in `defaultDeps` (throw `SealRefusal('claude_code_context', why)`; `cmdIntentSeal` already renders that as JSON with `EXIT_INVALID`); do not call `guardRefusal()` there because it reads real fds and bypasses the `d.isTty` seam. Call it in `cmdAdd` before the secret is generated. Require `xprov-approve.cjs` lazily (as `intent-agent.cjs:173` does). Regression fixtures first, copying `13-agent.sh:217-237` (A7a/A7c via `script`, A7b via seam) and `a1-xprov/parts/08-allowlist.sh:610-643` (R30j2-2). Existing positive TTY cases (`10-doctor-approve.sh:232,283,309-311,320,324,480-482`; `05b-child-seal.sh:970,993,1007,1036,1064`) turn red under Claude Code — use a fixture-only seam like `injectAgentDeps` (`intent-agent.cjs:140-145`) driven by `stub/a1-tools-as.cjs`, and add a negative case that stays red if the guard call is removed.

## Fix Plan (Phase 03 — filled by code agent)

**Approach:** One shared helper `claudeContextRefusal(env)` exported next to `guardRefusal` in `xprov-approve.cjs` (reuses `CLAUDE_ENV_RE`; environment first, then `ancestryRefusal()`, fail closed); `intent-agent.cjs` now calls it instead of keeping its own copy. Wired at the three sites, each with a lazy `require`: `cmdIntentApprove` at the terminal gate before `preflight` (refusal writes nothing, not even a decision log line; stderr `intent approve: refused (claude_code_context): <why>`, exit 1); `prepareSeal` through a `contextRefusal` dep in `defaultDeps`, right after the `not_a_tty` check, throwing `SealRefusal('claude_code_context', why)` (JSON reason, exit `EXIT_INVALID` 1); `cmdAdd` before the secret is generated (exit 1, no secret). `intent device revoke`: checked, no change. It has no TTY gate and discloses no secret (it only marks a device revoked), so it does not have the TTY-only shape of F-004. A Claude session can still revoke a device (denial of service, not signing); report as a separate, lower finding if wanted. Positive pty cases run through a fixture-only seam: spec `{"noClaudeGuard":true}` of `stub/a1-tools-as.cjs` replaces the exported helper in the loaded copy. No production seam code was added, the guard is not weakened. Library cases pass `contextRefusal: () => null` (as the seal dep already allowed).
**Files to change:** `_shared/lib/xprov-approve.cjs`, `_shared/lib/intent-agent.cjs`, `_shared/lib/intent-approve.cjs`, `_shared/lib/intent-seal.cjs`, `_shared/lib/intent-devices.cjs`, `_shared/lib/help-intent.cjs`, `_shared/intent-contract.md`; fixtures `_test-fixtures/a1-intent/lib.sh`, `stub/a1-tools-as.cjs`, `stub/seal-lib.cjs`, `cases/03-signature.sh`, `03b-hardening.sh`, `05b-child-seal.sh`, `06a-entry.sh`, `10-doctor-approve.sh`. Commit 02efecb on feature/fix-intent-approve-guard.
**Regression test added:** yes, `_test-fixtures/a1-intent/cases/14-claude-guard.sh` (F004-A1 approve x3: CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, fake `claude` parent; F004-A2 seal x2; F004-A3 device add x2; F004-A4 helper export). All on a real pty via `script`, sandbox HOME and vault. Red before the fix (rc 0, intent re-approved, seal written, secret printed, also under the fake `claude` parent); green after (rc 1, `claude_code_context`, store/rejected file/seal/devices.json unchanged, no 64-hex secret in the output). With the three guard calls removed in a scratch copy, all seven pty cases turn red again. Suites: a1-intent 1056 passed / 0 failed, a1-xprov 1597 passed / 0 failed.
**Risk:** Low. Owner commands now also fail where the owner runs them from inside a Claude Code session (intended). Fail closed: if the process tree cannot be read, the three commands refuse. Residual, same as the xprov owner commands: same-user escapes (detach to pid 1, launchctl submit, AppleScript). The hook pattern for these three commands stays a handoff to spec 013 Wave 4. The suite's positive pty cases depend on the `noClaudeGuard` stub spec; a stub that forgot it would make them refuse, not pass wrongly.

## Verification (Phase 04 — filled by skill)

**Symptom reproduced before fix:** yes — in the fixture sandbox on a real pty: approve rc 0 + "Approve? (yes/no) yes" + intent moved to `queued/`; seal rc 0 + seal written; device add rc 0 + `secret for phone-new: <64 hex>`; same under a fake `claude` parent.
**Symptom present after fix:** no — F004-A1..A5 refuse with exit 1 `claude_code_context` at all three sites (env var, entrypoint var, `claude` parent with env stripped, unreadable ancestry via stub seam); stores byte-identical, no prompt, no secret.
**Regression run:** passed — a1-intent 1059/1059 on macOS (orchestrator re-run after rename: 1056/1056 before A5) and on Linux `node:20` (Walter, Docker); CI #29 green on 84f4881 (all 33 suites incl. a1-xprov 1597). Intermediate CI red on ba5caef (A5 not portable: `/proc` on Linux) fixed in 84f4881.
**verify_result summary:** a1-intent suite green in worktree after fix 02efecb; 8 pty cases pass; red proof before, negative proof (guard removed → 7 fail); PR #29 squash-merged as 4fcfcb3 on 2026-10-08.

## Notes

- Source: analysis `project/a1-specforge/analyses/2026-10-08-general.md` F-004 (audit `docs/product/audits/2026-10-08-general.md`).
- Scope overlap (dry-run): `.claude/hooks/xprov-deny-allowlist-approve.sh` is held by `013-xprov-chat-consent` (claimed 2026-10-08T08:04Z) — excluded from this fix; hook pattern for `intent approve`/`intent seal`/`intent device add` is a handoff to spec 013 Wave 4.
- `device revoke` checked by Walter: no TTY gate, discloses nothing, only marks a device revoked — left unchanged; a session can revoke devices (denial of service, not a signing risk) → possible separate lower finding.
- Review (Reinhard on 02efecb): mergeable, 0 BLOCKER / 0 MAJOR / 2 MINOR / 2 NIT. MINOR-2 + both NITs fixed in ba5caef/84f4881; MINOR-1 (`guardRefusal` keeps its own env-check copy instead of delegating to `claudeContextRefusal`, xprov-approve.cjs:299-304) stays a follow-up because it touches the xprov guard itself.
- Audit auto-close: commit body `Closes F-004` → `product audit-set --status fixed` run in the primary checkout (c4c4b6d).
- Merged: PR #29 squash → `4fcfcb3` on main, 2026-10-08 10:30Z; remote branch deleted.