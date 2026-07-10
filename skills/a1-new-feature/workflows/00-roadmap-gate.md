# Phase 0 — Roadmap Gate (hard gate, before Discover)

**Goal:** Ensure a feature is never discovered/planned in a vacuum — verify a
project roadmap exists and, once a `roadmap_entry` is known, that it maps to a
real entry. Deterministic, read-only, no LLM judgment calls.

**Runs:** before Phase 1 (Discover), on every invocation of `a1-new-feature`
(new feature or resuming an existing spec).

## Step 1 — Roadmap existence check

```bash
test -f .a1/roadmap.md && echo "EXISTS" || echo "MISSING"
```

- **MISSING** → **HALT.** Do not start Discover. Tell the user:

  > No `.a1/roadmap.md` found for this project. Feature work needs a roadmap
  > to link into. Routing to `a1-roadmap` to create one first.

  Hand off to the `a1-roadmap` skill. Do not proceed further in this skill
  until the user has run it.

## Step 2 — Parseability check

If the file exists, verify it minimally parses (has frontmatter and at least
one `<!-- entry: ... -->` marker):

```bash
grep -q '^---' .a1/roadmap.md && grep -q '<!-- entry:' .a1/roadmap.md && echo "PARSEABLE" || echo "UNPARSEABLE"
```

- **UNPARSEABLE** (file exists but empty, malformed, or has no entry markers)
  → treat as **missing** for gating purposes (do not proceed to Discover), but
  the file already exists — **never silently overwrite it**. Tell the user:

  > `.a1/roadmap.md` exists but does not look like a valid roadmap (no
  > parseable entries found). I will not overwrite it automatically — please
  > confirm before I hand off to `a1-roadmap` to fix or rebuild it, or fix it
  > yourself and re-run.

  Wait for explicit user confirmation before routing to `a1-roadmap`.

## Step 3 — Roadmap-entry membership check (only if a `roadmap_entry` is known)

This only applies once the feature has a spec with a `roadmap_entry:`
frontmatter field (i.e. usually from Phase 2 Specify onward, or if the user
supplies it up front). On first-time Discover for a brand-new feature there
is no `roadmap_entry` yet — skip Step 3 and proceed to Phase 1.

If a `roadmap_entry: <slug>` value exists (read from the spec frontmatter):

```bash
grep -q "<!-- entry: <slug> -->" .a1/roadmap.md && echo "FOUND" || echo "MISMATCH"
```

- **FOUND** → proceed normally.
- **MISMATCH** → **soft stop.** Do not halt outright — surface a notice and
  let the user decide:

  > This feature's `roadmap_entry: <slug>` does not match any entry in
  > `.a1/roadmap.md`. Continue anyway, fix the roadmap_entry value, or add the
  > missing entry to the roadmap first?

  Proceed only after explicit user confirmation to continue.

## Outcome

| Check | Result | Action |
|---|---|---|
| roadmap.md missing | HALT | Route to `a1-roadmap`, do not start Discover |
| roadmap.md exists, unparseable | HALT (treated as missing) | Warn "do not overwrite", confirm before routing to `a1-roadmap` |
| roadmap.md parseable, no `roadmap_entry` yet | PASS | Proceed to Phase 1 (Discover) |
| roadmap.md parseable, `roadmap_entry` matches | PASS | Proceed |
| roadmap.md parseable, `roadmap_entry` mismatch | SOFT STOP | Surface mismatch notice, user confirms to continue |

On PASS, load `workflows/01-discover.md` (or the phase indicated by the
spec's current `status`, per the Routing table in SKILL.md).
