# Phase 0 — Roadmap Gate (hard gate, before Discover)

**Goal:** Ensure a feature is never discovered/planned in a vacuum — verify a
project roadmap exists and, once a `roadmap_entry` is known, that it maps to a
real entry. Deterministic, read-only, no LLM judgment calls.

**Runs:** before Phase 1 (Discover), on every invocation of `a1-new-feature`
(new feature or resuming an existing spec).

## Step 1 — Roadmap existence check (docs/product/ preferred, .a1/roadmap.md fallback)

`docs/product/ROADMAP.md` (schema v1) is the **preferred** source — check it
FIRST. Only fall back to the legacy `.a1/roadmap.md` when it's absent:

```bash
if [ -f docs/product/ROADMAP.md ]; then
  echo "EXISTS: docs/product/ROADMAP.md (preferred)"
elif [ -f .a1/roadmap.md ]; then
  echo "EXISTS: .a1/roadmap.md (legacy — recommend on-touch migration)"
else
  echo "MISSING"
fi
```

- **EXISTS: docs/product/ROADMAP.md** → proceed to Step 2 against that file.
- **EXISTS: .a1/roadmap.md (legacy)** → proceed to Step 2 against that file,
  but note to the user once (not a blocker):

  > This project's roadmap is still on the legacy `.a1/roadmap.md` path.
  > Recommend migrating to `docs/product/ROADMAP.md` (schema v1) on next
  > touch via `a1-roadmap`'s adopt mode — never a big-bang conversion (see
  > `a1-roadmap` SKILL.md, FR-017).

- **MISSING** (neither file exists) → **HALT.** Do not start Discover. Tell
  the user:

  > No `docs/product/ROADMAP.md` or `.a1/roadmap.md` found for this project.
  > Feature work needs a roadmap to link into. Routing to `a1-roadmap` to
  > create one first.

  Hand off to the `a1-roadmap` skill. Do not proceed further in this skill
  until the user has run it.

## Step 2 — Parseability check

If a roadmap file was found in Step 1, verify it minimally parses. The check
differs slightly by source:

```bash
# docs/product/ROADMAP.md (schema v1: frontmatter + milestones[]/features[] + entry markers)
if [ -f docs/product/ROADMAP.md ]; then
  grep -q '^schema_version:' docs/product/ROADMAP.md && grep -q '<!-- entry:' docs/product/ROADMAP.md && echo "PARSEABLE" || echo "UNPARSEABLE"
else
  # legacy .a1/roadmap.md
  grep -q '^---' .a1/roadmap.md && grep -q '<!-- entry:' .a1/roadmap.md && echo "PARSEABLE" || echo "UNPARSEABLE"
fi
```

- **UNPARSEABLE** (file exists but empty, malformed, or has no entry markers)
  → treat as **missing** for gating purposes (do not proceed to Discover), but
  the file already exists — **never silently overwrite it**. Tell the user
  (substitute the actual path found in Step 1):

  > `<docs/product/ROADMAP.md | .a1/roadmap.md>` exists but does not look like
  > a valid roadmap (no parseable entries found). I will not overwrite it
  > automatically — please confirm before I hand off to `a1-roadmap` to fix or
  > rebuild it, or fix it yourself and re-run.

  Wait for explicit user confirmation before routing to `a1-roadmap`.

## Step 3 — Roadmap-entry membership check (only if a `roadmap_entry` is known)

This only applies once the feature has a spec with a `roadmap_entry:`
frontmatter field (i.e. usually from Phase 2 Specify onward, or if the user
supplies it up front). On first-time Discover for a brand-new feature there
is no `roadmap_entry` yet — skip Step 3 and proceed to Phase 1.

If a `roadmap_entry: <slug>` value exists (read from the spec frontmatter),
check against whichever roadmap file Step 1 found:

```bash
ROADMAP_FILE=docs/product/ROADMAP.md
[ -f "$ROADMAP_FILE" ] || ROADMAP_FILE=.a1/roadmap.md
grep -q "<!-- entry: <slug> -->" "$ROADMAP_FILE" && echo "FOUND" || echo "MISMATCH"
```

- **FOUND** → proceed normally.
- **MISMATCH** → **soft stop.** Do not halt outright — surface a notice and
  let the user decide:

  > This feature's `roadmap_entry: <slug>` does not match any entry in the
  > project roadmap. Continue anyway, fix the roadmap_entry value, or add the
  > missing entry to the roadmap first?

  Proceed only after explicit user confirmation to continue.

## Outcome

| Check | Result | Action |
|---|---|---|
| both roadmap files missing | HALT | Route to `a1-roadmap`, do not start Discover |
| roadmap file exists, unparseable | HALT (treated as missing) | Warn "do not overwrite", confirm before routing to `a1-roadmap` |
| `docs/product/ROADMAP.md` found | PASS (preferred path) | Proceed to Step 2 against it |
| only `.a1/roadmap.md` found (legacy) | PASS (fallback) | Proceed to Step 2 against it; note recommended on-touch migration |
| roadmap parseable, no `roadmap_entry` yet | PASS | Proceed to Phase 1 (Discover) |
| roadmap parseable, `roadmap_entry` matches | PASS | Proceed |
| roadmap parseable, `roadmap_entry` mismatch | SOFT STOP | Surface mismatch notice, user confirms to continue |

On PASS, load `workflows/01-discover.md` (or the phase indicated by the
spec's current `status`, per the Routing table in SKILL.md).
