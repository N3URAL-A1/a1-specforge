# Roadmap Gate — Canonical Existence + Parseability + Membership Check

Shared by `a1-new-feature` Phase 0 (`workflows/00-roadmap-gate.md`) and
`a1-execute` Step 0 (`workflows/01-load.md`) — the one genuinely copy-pasted
gate passage in the repo, centralized in M13 so the grep markers and the
user-facing prompts have a single maintenance point. Deterministic,
read-only, no LLM judgment. The **caller** defines what halts (Discover vs.
wave loading) and where to resume; the checks and prompt wordings below are
canonical.

## 1. Existence (docs/product preferred, legacy fallback)

`docs/product/ROADMAP.md` (schema v1) is the **preferred** source — check it
FIRST. Only fall back to the legacy `.a1/roadmap.md` when it's absent:

```bash
if [ -f docs/product/ROADMAP.md ]; then
  ROADMAP_FILE=docs/product/ROADMAP.md
  echo "EXISTS: $ROADMAP_FILE (preferred)"
elif [ -f .a1/roadmap.md ]; then
  ROADMAP_FILE=.a1/roadmap.md
  echo "EXISTS: $ROADMAP_FILE (legacy — recommend on-touch migration)"
else
  echo "MISSING"
fi
```

## 2. Parseability (only if a file was found)

```bash
if [ "$ROADMAP_FILE" = "docs/product/ROADMAP.md" ]; then
  grep -q '^schema_version:' "$ROADMAP_FILE" && grep -q '<!-- entry:' "$ROADMAP_FILE" && echo "PARSEABLE" || echo "UNPARSEABLE"
else
  grep -q '^---' "$ROADMAP_FILE" && grep -q '<!-- entry:' "$ROADMAP_FILE" && echo "PARSEABLE" || echo "UNPARSEABLE"
fi
```

## 3. Entry membership (only when a linkage slug is known)

Applies once the spec/phase declares `roadmap_entry: <slug>` in frontmatter;
with no linkage field yet, skip this check.

```bash
grep -q "<!-- entry: <slug> -->" "$ROADMAP_FILE" && echo "FOUND" || echo "MISMATCH"
```

## Canonical outcomes + user-facing prompts

**MISSING** → **HALT** (caller names the phase that does not start). Tell the
user (`<work>` = "Feature work" / "Phase execution" per caller):

> No `docs/product/ROADMAP.md` or `.a1/roadmap.md` found for this project.
> \<work\> needs a roadmap to link into. Routing to `a1-roadmap` to create
> one first.

Hand off to `a1-roadmap`; do not proceed until the user has run it.

**EXISTS (legacy fallback)** → **PASS**, but note to the user once (not a
blocker):

> This project's roadmap is still on the legacy `.a1/roadmap.md` path.
> Recommend migrating to `docs/product/ROADMAP.md` (schema v1) on next
> touch via `a1-roadmap`'s adopt mode — never a big-bang conversion (see
> `a1-roadmap` SKILL.md, FR-017).

**UNPARSEABLE** → treat as missing for gating purposes, but the file exists —
**never overwrite it silently**. Warn and wait for explicit confirmation
before routing to `a1-roadmap`:

> `<$ROADMAP_FILE>` exists but does not look like a valid roadmap. I will
> not overwrite it automatically — confirm before I hand off to
> `a1-roadmap`, or fix it yourself and re-run.

**Membership MISMATCH** → **SOFT STOP** (never a hard halt on membership
alone): surface the mismatch, user decides —

> This `roadmap_entry: <slug>` does not match any entry in the project
> roadmap. Continue anyway, fix the roadmap_entry value, or add the missing
> entry to the roadmap first?
