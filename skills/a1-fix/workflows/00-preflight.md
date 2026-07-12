# Phase 00 — Pre-Flight

Run this before Phase 01 (Report) on every new bug. Four checks in sequence
plus a non-blocking scope-overlap check.
Total time: ~30 seconds. Do not skip.

## Check 1 — Integrity Check

Verify that agent and skill files have not drifted from the canonical lock file:

```bash
node <repo>/_shared/a1-tools.cjs fix integrity-check
```

**If status is `"bootstrapped"`:** Lock file was just created from the current state.
Proceed — first run is always safe.

**If status is `"ok"`:** All good. Proceed.

**If status is `"mismatch"`:** **STOP IMMEDIATELY.**

Tell the user:
> "⛔ Integrity error: The following agent/skill files have changed since the last
> lock:
> - <file>: expected <expected>, actual <actual>
>
> Possible causes: an uncommitted edit, manual intervention, or the lock is stale.
>
> I will not write anything until this state is resolved.
>
> Options:
> 1. Run `node <repo>/_shared/a1-tools.cjs fix integrity-check` after every
>    intentional agent edit — but NOT automatically; you must confirm it.
> 2. Re-bootstrap the lock manually (delete `wiki/_canonical/agents.lock.json`) if
>    the changes were intentional.
>
> What should I do?"

Do NOT proceed with the bug pipeline until the user resolves the mismatch.

## Check 2 — Bug Patterns Lookup

Load project-specific patterns into context for Falk:

```bash
# Learning store: defaults to repo-local .a1/learnings/; set A1_VAULT_ROOT for an external vault (e.g. Obsidian)
VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"
# Read the project's pattern file if it exists
cat "$VAULT/wiki/bug-patterns/<project-slug>.md"
cat "$VAULT/wiki/bug-patterns/_cross-cutting.md"
```

If either file doesn't exist: skip silently. Do not create it here.

Hold this content in context. When spawning Falk in Phase 01 Step 2, include
a summary of the 2–3 most relevant patterns based on the symptom keywords.
Add to Falk's brief:

> **Known patterns for <project>:** <2-3 sentence summary of relevant patterns>
> Use this to cross-check during diagnosis — is this a known recurrence?

## Check 3 — Postmortem Search

Search for similar past bugs:

```bash
node <repo>/_shared/a1-tools.cjs fix find-duplicates <project-slug> <kw1> <kw2> [<kw3>]
```

Also search postmortems directly:

```bash
grep -l "<symptom-keyword>" "$VAULT/wiki/postmortems/<project-slug>/"
```

If postmortems found with the same keyword: tell the user:
> "Similar bugs in the postmortem database:
> - <file> — <one_line_learning>
>
> Is this a recurrence of the same problem?"

If yes → note it on the new bug report as `related_postmortem`.
If no → proceed normally.

## Check 4 — Scope Overlap Check (non-blocking — never stops the fix)

Once the target files for the fix are roughly known (even a first guess from
the bug symptom is enough — this check can be re-run once Falk's diagnosis
narrows the file list), compare them against every in-flight feature's
declared code scope:

```bash
node <repo>/_shared/a1-tools.cjs code-scope check \
  --by fix-<bug-slug> --scope <target-file-paths-comma-separated>
```

- **Exit 1 (CONFLICT)** — the fix's files overlap an in-flight feature. **Do
  NOT block.** Print a warning naming the overlapping feature id(s) (from
  stderr) to the user, e.g.:

  > "⚠️ Heads up: this fix touches files also claimed by in-flight feature
  > `<feature-id>` (currently at stage `<stage>` per `code-scope list`).
  > Proceeding anyway — a1-fix never blocks on feature scope, but expect a
  > possible merge conflict with that feature later."

  Then continue to Phase 01 (Report) normally.
- **Exit 0 (OK)** — no overlap. Proceed silently, no warning.

**Never call `code-scope claim` for a hotfix** — only the dry-run `check`
subcommand. The fix's files are never reserved; this check exists purely to
surface a heads-up warning, not to gate anything.

## Hand-off

Pre-Flight complete. Proceed to `01-report.md`.

Context to carry forward into Phase 01:
- Project slug (confirmed)
- Bug-patterns summary (for Falk's brief)
- Any related postmortem files found
