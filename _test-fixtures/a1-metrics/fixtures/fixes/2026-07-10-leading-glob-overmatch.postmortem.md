---
type: bug-report
project: a1-specforge
bug: 2026-07-10-leading-glob-overmatch
severity: MINOR
status: fixed
fix_commit: e500a7d
merged: e55addf
date: 2026-07-10
permalink: vault/wiki/postmortems/a1-specforge/2026-07-10-leading-glob-overmatch-1
---

# Postmortem — Leading-glob over-match in code-scope overlap gate

**What happened:** The glob-containment branch added to `scopePathsOverlap`
in review-fix commit ae0d409 ran directory-containment tests with an empty
`nonGlobPrefix` (`isSegmentPrefix([], x)` is trivially true), so every
leading-glob pattern (`**/x`, `*`, `*/x`) conflicted with every path.

**How it was found:** Reinhard's re-review of the fix commit itself —
the reviewer probed the new branch with a degenerate input the fixtures
didn't cover. Fail-safe direction (over-block), so no real damage possible.

**Root cause class:** boundary-condition of a helper (`nonGlobPrefix` → `[]`)
feeding a predicate whose vacuous-truth case was unhandled.

**Fix:** guard all four containment tests with `prefix.length > 0`;
`segmentsMatchGlob` verdict untouched. TDD: 3 RED regressions written first,
then fix, then 72/72 green + 2 guard fixtures proving real matches still block.

**Lessons:**
1. When a review fix ADDS a new code branch, the re-review should probe that
   branch's degenerate inputs (empty prefix, bare `**`, single `*`) — the
   original fixtures only covered the reported cases.
2. Vacuous truth (`every` over empty array, prefix-of-empty) is a recurring
   predicate trap; check emptiness explicitly at helper boundaries.
3. Fail-safe over-blocking is the right default for gates — this bug cost a
   spurious warning, never a silent miss.