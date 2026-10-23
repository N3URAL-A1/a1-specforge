---
type: bug-report
project: a1-specforge
bug_slug: xprov-preflight-config-allowlist
title: "xprov preflight rejects the Codex review config written by codex-cli 0.155.1"
status: duplicate
severity: major
reported_at: 2026-10-04T12:00
reporter: Robert
affected_repos:
  - a1-specforge
related_deploy: unknown
duplicate_of: "main #18 (xprov 1.10.0, features_pinned_off)"
phase_history:
  - "phase=report completed=2026-10-04T10:00:00.000Z"
  - "phase=diagnose completed=2026-10-04T09:48:57.052Z"
  - "phase=fix-start completed=2026-10-04T10:14:44.007Z"
  - "phase=duplicate completed=2026-10-04T10:26:55.469Z"
recommended_code_agent: a1-walter-web-developer
fix_commit: 2f5eba9
verify_result: null
tags:
  - bug
  - project/a1-specforge
permalink: vault/project/a1-specforge/fixes/2026-10-04-xprov-preflight-config-allowlist
---

# Bug: xprov preflight rejects the Codex review config written by codex-cli 0.155.1

## Symptom

`xprov gate` stops at `preflight_failed` / `unexpected_config_key`. No wave diff can reach Codex.
Found while inspecting Wave 1 of feature 059-object-types in n3ural-platform.

## Reproduction Steps

1. Review home `~/.codex-a1-review/config.toml` as written by codex-cli 0.155.1.
2. `node _shared/a1-tools.cjs xprov preflight`
3. Check `unexpected_config_key` FAILs, all other 15 checks PASS.

Expected: PASS, because every extra key only switches a feature off.
Actual: FAIL — keys: cli_auth_credentials_store, features.apps, features.browser_use, features.computer_use,
features.hooks, features.memories, features.skill_mcp_dependency_install.

## Environment

- Browser / OS / Device: macOS, Darwin 25.5.0
- App version / commit: a1-specforge 1.9.0 (clone at `e4c04e6`), codex-cli 0.155.1
- Tenant / user role: n/a
- Network / VPN / region: n/a

## Frequency

always

## Impact

The cross-provider gate (`wave-inspect-xprov`, `plan-review-xprov`) cannot run on this machine.
Enforcement is `warning`, so execution continues, but every wave lacks the second review.

## Affected Components

- Repo(s): a1-specforge
- Suspected files / routes / services: `_shared/lib/xprov-preflight.cjs` (`ALLOWED_KEYS`, ~line 180),
  tests in `_test-fixtures/a1-xprov/parts/04-preflight-permit.sh`

## Recent Changes

Codex CLI newer than the plugin's allowlist (not verified which version added the keys).

## Diagnosis (Phase 02 — filled by Falk)

**Hypothesis:** `ALLOWED_KEYS` is a fixed list; the CLI now writes more keys.
**Evidence:** `xprov preflight` output (measured 2026-10-04), `xprov-preflight.cjs:180-183`.
**Confidence:** high
**Recommended code agent:** a1-walter-web-developer
**Suggested fix approach:** Extend the allowlist with value checks. `features.*` only with `false`,
`cli_auth_credentials_store` only with `"file"`. Any other value stays FAIL. Red-first tests incl. counter-test.

## Fix Plan (Phase 03 — filled by code agent)

## Verification (Phase 04 — filled by skill)

## Notes

Decision Robert 2026-10-04: way B (extend the allowlist in the plugin, no change to the review home).
Scope overlaps the reservation of spec 009-cross-provider-review-gate (warning only).