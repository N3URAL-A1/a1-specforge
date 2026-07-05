# Phase 02 — Parse (deterministic, no sub-agents)

Goal: extract the spec's testable anchors — FR-### identifiers, referenced
file paths, function/class names, and HTTP endpoints — and store them in the
drift report's frontmatter as `parsed_targets[]`. Status moves to `parsed`.

## Step 1 — Invoke the CLI

For each entry in `scope_targets[]`:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs reconcile parse-spec "<drift-path>"
```

The CLI reads each target spec from disk and extracts:

| Anchor type | Regex / heuristic |
|---|---|
| FR-IDs | `\bFR-\d{3,}\b` |
| File paths | inline-code spans `` `path/to/file.ext` `` where the path contains a `/` and an extension |
| Functions/classes | inline-code spans matching `[A-Za-z_][A-Za-z0-9_]*\(\)` or PascalCase identifiers in headings/lists |
| HTTP endpoints | inline-code spans matching `(GET|POST|PUT|PATCH|DELETE)\s+/\S+` |

Each anchor is recorded as one entry in `parsed_targets[]`:

```yaml
- spec_id: 001-login
  fr: FR-002
  kind: file | function | endpoint | other
  ref: "path/to/credentials.ts"
  context: "FR-002: System validates credentials against the user store."
```

Anchors deduplicate per (spec_id, kind, ref). The `other` kind captures FR-IDs
that have no inline-code anchor in their bullet — they are still probed (the
agent will get the FR text as a hint, but the location field will be empty).

## Step 2 — Compute STALE candidates (deterministic)

For each spec with `status: shipped`:

1. Read `updated:` from the spec frontmatter (fallback: file mtime).
2. The CLI shells out to git: `git log -1 --format=%cI -- <referenced files>`
   in the resolved `repo_path`, computing the most recent commit that touched
   any referenced artifact.
3. If `spec.updated > last_code_touch` → mark the spec as a STALE candidate
   in `parsed_targets[].stale_candidate: true`.

This is a fast pre-filter; the actual STALE classification happens in Phase 4
based on probe results too (a STALE candidate that probes as MISSING is
reported as MISSING — the more specific class wins).

## Step 3 — Update status

The CLI does this atomically as part of `parse-spec`. After the run:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs reconcile update-status \
  "<drift-path>" parsed \
  --phase-data '{"target_count": <n>, "stale_candidates": <m>}'
```

(The skill calls this if `parse-spec` didn't already transition the status —
the CLI is conservative: it writes `parsed_targets[]` but leaves status
updates to an explicit call, so the skill can review and add metadata.)

## Step 4 — Summarize for the user

> "Phase 2 (Parse) complete.
>  - <n> acceptance criteria anchors extracted across <s> spec(s).
>  - Of which <m> are STALE candidates (spec newer than code).
>  - Distribution: <files> files, <functions> functions, <endpoints> endpoints, <other> without concrete ref.
>
>  Should I start Phase 3 (Probe — sub-agents check code state)?"

If yes: proceed to `03-probe.md`.
If no: stop. Status `parsed` persists.

## Edge cases

- **Spec has 0 inline-code anchors:** every FR ends up as `kind: other`. Phase 3
  will probe these heuristically (sub-agent scans for FR-relevant keywords).
- **Spec references files that no longer exist in the repo:** the CLI still
  records them — Phase 3 will classify them as MISSING.
- **Repo path is wrong / not a git repo:** `git log` fails; CLI emits a
  warning into `parse_warnings[]` and falls back to file mtime for the STALE
  pre-filter. Phase continues.
- **Spec frontmatter has no `updated:` field:** the CLI falls back to the
  file's mtime; STALE pre-filter is best-effort.
