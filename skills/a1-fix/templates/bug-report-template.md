---
type: bug-report
project: <PROJECT_SLUG>
bug_slug: <BUG_SLUG>
title: <ONE_LINE_TITLE>
status: reported
severity: <blocker|major|minor|nit>
reported_at: <YYYY-MM-DDTHH:MM>
reporter: <REPORTER>
affected_repos:
  - <repo-name>
related_deploy: <commit-hash-or-date-or-unknown>
duplicate_of: null
phase_history:
  - phase=report completed=<ISO_TIMESTAMP>
recommended_code_agent: null
fix_commit: null
verify_result: null
tags:
  - bug
  - project/<PROJECT_SLUG>
---

# Bug: <ONE_LINE_TITLE>

## Symptom

<What goes wrong from the user's perspective. One paragraph, no speculation.>

## Reproduction Steps

1. <step>
2. <step>
3. <observed outcome>

Expected: <what should happen>
Actual: <what happens instead>

## Environment

- Browser / OS / Device: <…>
- App version / commit: <…>
- Tenant / user role: <…>
- Network / VPN / region: <…>

## Frequency

<always | intermittent (X of Y) | once | unknown>

## Impact

<Which users are affected, what they cannot do, business consequence.>

## Affected Components

- Repo(s): <…>
- Suspected files / routes / services: <…>

## Recent Changes

<Recent deploys, migrations, config changes within the suspected window.>

## Diagnosis (Phase 02 — filled by Falk)

**Hypothesis:** <root cause>
**Evidence:** <file:line references, git log entries, log excerpts>
**Confidence:** <low | medium | high>
**Recommended code agent:** <a1-walter-web-developer | bernd | a1-aik-ai-engineer | toni | felix | a1-alex-architekt>
**Suggested fix approach:** <one paragraph, no code>

## Fix Plan (Phase 03 — filled by code agent)

**Approach:** <…>
**Files to change:** <…>
**Regression test added:** <yes/no, path>
**Risk:** <…>

## Verification (Phase 04 — filled by skill)

**Symptom reproduced before fix:** <yes/no>
**Symptom present after fix:** <yes/no>
**Regression run:** <not-run | passed | failed (link)>
**verify_result summary:** <one line, copied to frontmatter>

## Notes

<Anything else: links to Slack, related bug reports, prior incidents.>
