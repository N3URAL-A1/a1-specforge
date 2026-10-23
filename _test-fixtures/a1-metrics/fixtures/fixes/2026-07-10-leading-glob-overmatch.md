---
id: 2026-07-10-leading-glob-overmatch
project: a1-specforge
title: Leading-glob scope patterns over-match in code-scope overlap gate
status: fixed
created: 2026-07-10
phase_history:
- phase=diagnose completed=2026-07-10T11:48:35.419Z
- phase=fix-start completed=2026-07-10T11:48:44.431Z
- phase=verify completed=2026-07-10T11:51:26.117Z
fix_commit: e500a7d
found_by: a1-reinhard-reviewer (re-review of ae0d409)
recommended_code_agent: a1-walter-web-developer
severity: MINOR
verify_result: '72/72 + 6/6 green; live CLI verified: unrelated path OK, real glob
  match still CONFLICT'
permalink: vault/project/a1-specforge/fixes/2026-07-10-leading-glob-overmatch
---

# Leading-glob over-match in `scopePathsOverlap`

## Symptom

A `code_scope` pattern that BEGINS with a glob (e.g. `**/util.js`) reports
CONFLICT against ANY other path, even ones the glob cannot match.
Verified: `**/util.js` vs `docs/readme.md` → exit 1 (CONFLICT), although
`readme.md` ≠ `util.js`.

## Root cause (from review)

`_shared/a1-tools.cjs`, glob-containment branch of `scopePathsOverlap`
(added in ae0d409): `nonGlobPrefix('**/util.js')` returns `[]`, and
`isSegmentPrefix([], anySegments)` is trivially `true`, so the
directory-containment test fires for every counterpart path. The
`segmentsMatchGlob` branch would correctly reject; the two branches disagree.

## Impact

Fail-safe direction (over-blocks — spurious conflicts, never a missed real
one). Severity MINOR. Leading-glob scopes are rare but legal.

## Expected fix

When `nonGlobPrefix` of a side is empty, skip the empty-prefix containment
test for that side and rely on `segmentsMatchGlob` alone.

## Regression scenarios

- `**/util.js` vs `docs/readme.md` → OK (no conflict) — currently wrong.
- `**/util.js` vs `src/a/util.js` → CONFLICT (glob genuinely matches).
- Existing 63 fixtures stay green (esp. `glob-vs-ancestor-dir`,
  `star-vs-deep-file` from ae0d409).