---
type: bug-report
project: a1-specforge
bug_slug: frontmatter-backslash-doubling
title: Frontmatter round trip doubles backslashes (parse does not unescape, serialize
  escapes)
status: reported
severity: minor
reported_at: 2026-10-21T10:00
reporter: orchestrator (found by spec 017 Wave 9 implementer)
affected_repos:
- a1-specforge
related_deploy: 1469281
duplicate_of: null
phase_history:
- phase=report completed=2026-10-21T08:00:00.000Z
recommended_code_agent: null
fix_commit: null
verify_result: null
tags:
- bug
- project/a1-specforge
permalink: vault/project/a1-specforge/fixes/2026-10-21-frontmatter-backslash-doubling
---

# Bug: Frontmatter round trip doubles backslashes (parse does not unescape, serialize escapes)

## Symptom

Every read-modify-write of a markdown frontmatter through `_shared/lib/io-frontmatter.cjs` doubles each backslash in string values. A regex such as `a\.b` becomes `a\\.b` after one `spec update-status` / `fix update-status`, then `a\\\\.b`, and so on. Spec 017 Wave 9 had to store `class_query` as flat list items to avoid it. The parser also has no nested objects.

## Reproduction Steps

1. `parseFrontmatter('---\nr: a\\.b\n---\n')` → `{ r: 'a\\.b' }` (one backslash, correct).
2. `serializeFrontmatter` → `r: "a\\.b"` (escaped).
3. Parse the serialized text again → `{ r: 'a\\\\.b' }` (two backslashes).

Expected: parse(serialize(x)) === x.
Actual: each cycle doubles backslashes inside double-quoted values.

## Environment

- Browser / OS / Device: macOS, Node 24
- App version / commit: main 1469281
- Tenant / user role: n/a
- Network / VPN / region: n/a

## Frequency

always

## Impact

Any frontmatter value with a backslash (regex, Windows path) is corrupted by the next CLI status update; silent data drift in specs, bug reports and plans.

## Affected Components

- Repo(s): a1-specforge
- Suspected files / routes / services: `_shared/lib/io-frontmatter.cjs` `parseFrontmatter` (:14, double-quoted scalars not unescaped) vs `serializeFrontmatter` (:217, escapes backslashes)

## Recent Changes

unknown

## Notes

Fix: unescape `\\` and `\"` when parsing double-quoted scalars (YAML double-quote semantics), plus a round-trip property test over hostile strings. Nested-object support is a separate feature, not this bug.