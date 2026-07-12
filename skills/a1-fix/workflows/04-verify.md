# Phase 04 — Verify

Goal: confirm the fix actually removed the symptom. Output: `status: fixed` with
`verify_result` recorded — or, if the symptom is still there, back to Phase 2
with the new data point.

## Inputs

- Vault path to the bug-report file (status must be `fixing`, `fix_commit` set)

If `fix_commit` is null: abort and tell the user that Phase 3 is not
complete (no commit recorded).

## Step 1 — Re-run reproduction

Read the bug report's `## Reproduction Steps` section. Walk the user through
each step one at a time:

> "Verify step 1: <step>. Does the symptom still occur?"

Wait for an answer before moving to the next step. If the user reports the
symptom is gone at any step where it was previously reproducible: continue.
If the user reports the symptom still appears: stop the walk-through and skip
to Step 4 (back to Phase 2).

## Step 2 — Optional: a1-tobi-tester QA-regression for severity ≥ MAJOR

If `severity` is `blocker` or `major`, propose a QA regression run:

> "Severity is <severity>. I can trigger a1-tobi-tester for a QA regression suite
> to make sure the fix didn't break anything else. Would you like that?"

If yes: spawn a1-tobi-tester via `Task` with this brief:

> You are a1-tobi-tester. Task: QA regression for a freshly fixed bug.
> **Bug report:** <ABSOLUTE_VAULT_PATH>
> **Fix commit:** <hash>
> **Affected repos:** <list>
>
> Read the bug report, identify critical user journeys that could be affected
> by the fix, and run the project's regression suite (E2E + integration).
> Output: pass/fail per suite plus list of new failures (if any).

If a1-tobi-tester reports failures: do NOT mark `fixed`. Add failures to `## Notes` and
recommend re-opening (Step 4).

## Step 3 — Mark fixed

If reproduction confirms symptom is gone (and a1-tobi-tester is green or skipped):

1. Build a one-line `verify_result` string:
   `"<YYYY-MM-DD>: symptom not reproducible after commit <short-hash>; regression: <passed|skipped>"`

2. Run:

```bash
node <repo>/_shared/a1-tools.cjs fix update-status \
  "<bug-path>" fixed \
  --verify-result "<verify_result_string>"
```

3. Use the Edit tool to fill the `## Verification (Phase 04 — filled by skill)`
   section in the bug report with the verification details.

4. Tell the user:

> "Fix verified. Status: fixed. Bug report:
> `projects/<slug>/fixes/<file>`. Audit trail complete in `phase_history`."

## Step 4 — Symptom still present → back to Phase 2

If the user reports the symptom remains, OR a1-tobi-tester finds a regression:

1. Capture what we learned:
   - Which step reproduced it (or which a1-tobi-tester suite failed)
   - Whether anything changed in behavior (partial fix?)
2. Append to `## Notes` in the bug report:

   ```
   - <YYYY-MM-DD HH:MM> Verify after fix_commit <hash>: symptom still present.
     Detail: <one paragraph with new evidence>
   ```

3. Set verify_result and reset status:

```bash
node <repo>/_shared/a1-tools.cjs fix update-status \
  "<bug-path>" diagnosed \
  --verify-result "<YYYY-MM-DD>: fix incomplete — <one-line>"
```

   We move back to `diagnosed` (not `reported`), so Phase 2 can refine the
   diagnosis with the new data point. The `verify_result` becomes input to the
   next diagnosis round.

4. Tell the user:

> "Symptom still present. Status back to `diagnosed`. Should I restart Phase 2
> with the new findings?"

If yes: proceed to `02-diagnose.md`. Falk should read `## Notes` plus the new
`verify_result` as additional evidence.

## Special exits

- **User wants to close as wont-fix:** run
  `a1-tools fix update-status <bug-path> wont-fix --verify-result "<reason>"`.
  The slot stays.

---

## Postmortem (hard gate after every terminal verdict)

Run this after every terminal status (`fixed`, `wont-fix`, `cant-reproduce`, `duplicate`).
**Not optional.** Canonical source: `wiki/postmortems/<project>/<date>-<bug-slug>.md`.
The `_learning.md` cache is updated as a fast-access mirror.

### Step 1 — Create the Postmortem file

```bash
node <repo>/_shared/a1-tools.cjs fix init-postmortem \
  "<bug-slug>" "<project-slug>" \
  --date "$(date +%F)" \
  --severity "<blocker|major|minor|nit>" \
  --root-cause-class "<tag>" \
  --terminal-status "<fixed|wont-fix|cant-reproduce|duplicate>" \
  --one-line-learning "<what would have prevented the bug>" \
  --fix-wave-count "<N>" \
  --diagnosis-rounds "<N>" \
  --phase-friction "<report|diagnose|fix|verify>" \
  --quak-regression "<passed|failed|skipped>" \
  --fix-required-test-first "<true|false>"
```

Then open the returned file path and fill in:
- **Bug Summary** — 2-3 sentences
- **Timeline** — reported / diagnosed / fixed (commit) / verified with times
- **Root Cause** — one paragraph
- **Contributing Factors** — what conditions allowed this to exist/survive?
- **What Went Well** — diagnosis speed, tooling quality
- **What Didn't Go Well** — friction points
- **Suggested Lesson** — one concrete, actionable rule for prevention

Root cause tags: `missing_wiring` | `schema_flaw` | `regression` | `race_condition` |
`env_config` | `third_party_change` | `ui_state_bug` | `auth_tenant` | `spec_omission` |
`off_by_one`

For `cant-reproduce` / `duplicate`: still write the postmortem — recurrence signal is valuable.

### Step 2 — Update local cache

```bash
cat >> ~/.claude/skills/a1-fix/_learning.md <<EOF
---
date: <YYYY-MM-DD>
bug_id: <bug-slug>
project: <project-slug>
verdict: <fixed|wont-fix|cant-reproduce|duplicate>
root_cause_class: [<tag>]
fix_wave_count: <N>
one_line_learning: <from postmortem>
postmortem: wiki/postmortems/<project>/<date>-<bug-slug>.md
---
EOF
```

The `_learning.md` is a fast-access cache. The Vault postmortem is canonical.

### Step 3 — Check promote-lessons threshold

```bash
# Learning store: defaults to repo-local .a1/learnings/; set A1_VAULT_ROOT for an external vault (e.g. Obsidian)
VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"
# Get last promote timestamp
LAST_PROMOTE=$(node <repo>/_shared/a1-tools.cjs fix count-postmortems-since \
  --since "$(cat "$VAULT/wiki/_state/last_promote.json" | grep -o '"last_promote_at":"[^"]*"' | cut -d'"' -f4)")
```

If the count is ≥5, tell the user:
> "5 new postmortems since the last promote-lessons run. Shall I start promote-lessons?
> It evaluates all new postmortems and writes suggestions to
> `wiki/lessons/<agent>/_suggestions/`. You then decide which suggestions
> move to `_active.md`."

If yes: run promote-lessons (see below).
If no: proceed. Counter accumulates until next run.

### promote-lessons procedure

1. Read all postmortems in `wiki/postmortems/` created since `last_promote.json`
2. Group by `root_cause_class`
3. For each group with ≥3 occurrences: identify the agent most relevant
4. Write a suggestion via:
   ```bash
   node <repo>/_shared/a1-tools.cjs fix write-suggestion \
     "<agent-name>" \
     --title "<lesson title>" \
     --body "<actionable rule text>" \
     --source-postmortem "<path>" \
     --skill "a1-fix"
   ```
5. **Bridge to a1-evolve's primary glob (framework invariant 4).** For each
   promoted lesson, ALSO append a normalized entry in the standard YAML retro
   format to the Vault file `pattern/a1-learnings/a1-fix.md`, so a1-evolve's
   primary collect glob (`pattern/a1-learnings/*.md`) sees the bug corpus. The
   `wiki/` postmortem stays the canonical detail; this is the optimizer-visible
   summary:
   ```bash
   cat >> "$VAULT/pattern/a1-learnings/a1-fix.md" <<EOF

   ## $(date +%F) — <project-slug> / <bug-slug>

   **Skill:** a1-fix
   **Outcome:** <fixed|wont-fix|cant-reproduce|duplicate>
   **root_cause_class:** [<tag>]
   **evidence:** wiki/postmortems/<project>/<date>-<bug-slug>.md; fix_commit <short-hash>

   ### Retro
   ⚠️ <one_line_learning — what would have prevented the bug>
   💡 <the promoted lesson / actionable rule>
   EOF
   ```
6. Update promote state:
   ```bash
   node <repo>/_shared/a1-tools.cjs fix update-promote-state
   ```
7. Tell the user:
   > "promote-lessons complete. New suggestions in:
   > - `wiki/lessons/<agent>/_suggestions/` (N suggestions)
   >
   > Please review the suggestions and manually promote the useful ones to `_active.md`."

**NEVER:** Write to `_active.md`. Never modify `agents/*.md` or `skills/*.md` directly.
