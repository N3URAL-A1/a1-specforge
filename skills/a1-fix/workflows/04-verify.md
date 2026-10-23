# Phase 04 — Verify

Goal: confirm the fix actually removed the symptom. Output: `status: fixed` with
`verify_result` recorded — or, if the symptom is still there, back to Phase 2
with the new data point.

## Inputs

- Vault path to the bug-report file (status must be `fixing`, `fix_commit` set)

If `fix_commit` is null: abort and tell the user that Phase 3 is not
complete (no commit recorded).

## Step 0 — Code gates (spec 017, before any symptom question)

Three deterministic checks run first, in this order. Each block ends the run on a non-zero exit. A user
"yes" on the symptom question (Step 1) alone never sets `status: fixed`: `fix update-status … fixed` repeats
the class-sweep check and refuses while a match stays open. `<fix-base>` is the commit the fix branched
from (`git merge-base HEAD <default-branch>`); `<bug-slug>` is the slug of the bug report.

### 0.1 Real-backend evidence

```bash
node <repo>/_shared/a1-tools.cjs realpath-check run --diff-base <fix-base> --phase fix-<bug-slug>; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: realpath-check exit=$RC; fix has SQL/RLS/external-API changes without real-backend evidence"; exit "$RC"; fi
```

### 0.2 Test fidelity

```bash
node <repo>/_shared/a1-tools.cjs test-fidelity --diff-base <fix-base> --phase fix-<bug-slug>; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: test-fidelity exit=$RC; read the findings (rule, file, line) on stdout"; exit "$RC"; fi
```

Exit 1 means the fix's tests mock the subject, skip, or return early. Fix the test (never weaken it to go
green). A finding that is correct as written gets a `disposition add --kind fidelity` with a reason; Reinhard
reviews it at the PR (`a1-pr-review` Step 5.1).

### 0.3 Class sweep

Pass one `--guard <fingerprint>=<test-file>` per remaining sibling site that a new test in the fix diff guards.
A site that is intentionally left gets `disposition add --kind class_sweep` first.

```bash
node <repo>/_shared/a1-tools.cjs fix class-sweep --verify "<bug-path>" --diff-base <fix-base> --phase fix-<bug-slug>; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: fix class-sweep --verify exit=$RC (class_sweep_open: a sibling site is neither guarded nor accepted); status stays fixing"; exit "$RC"; fi
```

Exit 1 with `class_sweep_open`: fix the sibling sites (back to Phase 3), then run Step 0 again.

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

If yes: spawn a1-tobi-tester via `Agent` with this brief:

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

Only after Step 0 exited 0 on all three blocks. If reproduction confirms symptom is gone (and a1-tobi-tester is green or skipped):

1. Build a one-line `verify_result` string:
   `"<YYYY-MM-DD>: symptom not reproducible after commit <short-hash>; regression: <passed|skipped>"`

2. Run:

```bash
node <repo>/_shared/a1-tools.cjs fix update-status \
  "<bug-path>" fixed \
  --verify-result "<verify_result_string>"; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: fix update-status fixed exit=$RC (class_sweep_open: a sibling site is neither guarded nor accepted - back to Step 0.3; class_query_missing: fill class_query and root_site); status stays fixing"; exit "$RC"; fi
```

Exit 1 prints a JSON refusal on stdout. `class_sweep_open` means a sibling site of the defect class is still
open: go back to Phase 3 (guard or fix it) and run Step 0 again. `class_query_missing` means the report has no
valid `class_query` (Phase 2 fills it). The report stays at `fixing`; do not tell the user the bug is fixed.

3. Use the Edit tool to fill the `## Verification (Phase 04 — filled by skill)`
   section in the bug report with the verification details.

   Live verification of a fix runs in a1-pr-review 5.5 after the merge (the probe CLI measures the merged effect from outside); this step does not run it.

4. Append the cost line to the fix report body (same format as Victor's step; the line is never omitted).
   `<fix-start>` is the ISO time the fix began (the report's `fixing` entry in `phase_history`):

```bash
node <repo>/_shared/a1-tools.cjs cost run --project <claude-projects-dir> --since <fix-start>; RC=$?
if [ "$RC" -ne 0 ]; then echo "cost run exit=$RC; write 'Cost: unavailable (<reason>)' instead"; fi
```

   On exit 0 append `Cost: N tokens (in X, out Y, cache Z)` to the fix report body; on a non-zero exit
   append `Cost: unavailable (<reason>)`. The cost report of spec 018 reads this line back.

5. Tell the user:

> "Fix verified. Status: fixed. Bug report:
> `project/<slug>/fixes/<file>`. Audit trail complete in `phase_history`."

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
**Not optional.** Canonical source: `project/<project>/postmortems/<date>-<bug-slug>.md`.
The `_learning.md` cache is updated as a fast-access mirror.

### Step 1 — Create the Postmortem file

```bash
node <repo>/_shared/a1-tools.cjs fix init-postmortem \
  "<bug-slug>" "<project-slug>" \
  --date "$(date +%F)" \
  --severity "<blocker|major|minor|nit>" \
  --root-cause-class "<tag>" \
  --found-by "<user|post-merge-ci|production|unknown|<gate-id>|reviewer:<agent>>" \
  --should-have-caught "<none|unknown|<gate-id>|reviewer:<agent>>" \
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

`--found-by` says who or what found the bug. A bug found after merge by the user is `found_by: user`.
`--should-have-caught` names the gate ID (from `_shared/gates-registry.md`) or `reviewer:<agent>` that
should have caught it, or `none` when no gate could. `unknown` is allowed only with a stated reason in the
postmortem's Contributing Factors. A bad value exits 1 and writes no file; `fix validate-postmortem <file>`
re-checks an existing postmortem.

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
postmortem: project/<project>/postmortems/<date>-<bug-slug>.md
---
EOF
```

The `_learning.md` is a fast-access cache. The Vault postmortem is canonical.

### Step 2b — Append the optimizer-visible retro (MANDATORY, every terminal verdict)

**Not optional, not batched, not deferred to promote-lessons.** a1-evolve's
primary collect glob is `pattern/a1-learnings/*.md` (framework invariant 4);
a postmortem that exists only under `project/*/postmortems/` is invisible to the optimizer.
Because promote-lessons is an opt-in offer that only fires at ≥5 postmortems,
relying on it silently strands whole bug corpora — observed 2026-08-02: niimo
had 16 postmortems and niimo-web 2, with zero entries in the optimizer-visible
glob. Write the entry to a standalone file first, validate it, then append
per terminal verdict — full contract and exit codes in
`_shared/retro-template.md`, which is the owner of this instruction:

```bash
VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"
mkdir -p "$VAULT/pattern/a1-learnings"
RETRO_FILE="$(mktemp)"
cat > "$RETRO_FILE" <<EOF
---
date: $(date +%F)
task: <bug-slug> — <one-line what was fixed>
project: <project-slug>
result: <fixed|wont-fix|cant-reproduce|duplicate>
bug_classes: [<root-cause-tag>]
evidence: project/<project>/postmortems/<date>-<bug-slug>.md; fix_commit <short-hash>
gates_fired:
  - {id: fix-integrity, verdict: <pass|fail>, caught: <true|false>}
one_line_learning: <from postmortem>
---
EOF
GATE_LOG=".a1/phases/fix-<bug-slug>/gate-log.jsonl"
node <repo>/_shared/a1-tools.cjs gates fired --log "$GATE_LOG"; RC=$?
if [ $RC -ne 0 ]; then echo "gate log unreadable or broken (exit $RC) - fix it before the entry counts"; exit $RC; fi
node <repo>/_shared/a1-tools.cjs retro validate "$RETRO_FILE" --gate-log "$GATE_LOG" --phase retro-fix-<bug-slug>; RC=$?
if [ $RC -ne 0 ]; then echo "fix the gates_fired block above before the entry counts"; exit $RC; fi
cat "$RETRO_FILE" >> "$VAULT/pattern/a1-learnings/a1-fix.md"
```

`evidence:` is required (invariant 3) — it is what the retro-integrity
cross-check reads. If promote-lessons later runs, it does NOT re-append these
entries; it only writes suggestions.

### Step 3 — Check promote-lessons threshold

```bash
# Learning store: defaults to repo-local .a1/learnings/; set A1_VAULT_ROOT for an external vault (e.g. Obsidian)
VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"
# Get last promote timestamp
LAST_PROMOTE=$(node <repo>/_shared/a1-tools.cjs fix count-postmortems-since \
  --since "$(cat "$VAULT/pattern/a1-learnings/_state/last_promote.json" | grep -o '"last_promote_at":"[^"]*"' | cut -d'"' -f4)")
```

If the count is ≥5, tell the user:
> "5 new postmortems since the last promote-lessons run. Shall I start promote-lessons?
> It evaluates all new postmortems and writes suggestions to
> `pattern/a1-learnings/lessons/<agent>/_suggestions/`. You then decide which suggestions
> move to `_active.md`."

If yes: run promote-lessons (see below).
If no: proceed. Counter accumulates until next run.

### promote-lessons procedure

1. Read all postmortems in `project/*/postmortems/` created since `last_promote.json`
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
5. **Do NOT re-append per-bug retros here.** The optimizer-visible entries are
   written per terminal verdict in Step 2b above (framework invariant 4, one
   owner per fact — invariant 1). Appending again here would double-count every
   bug in a1-evolve's frequency scoring. Backfill is the only exception: if
   `pattern/a1-learnings/a1-fix.md` is missing entries for postmortems written
   before Step 2b existed, append those once, using Step 2b's format.
6. Update promote state:
   ```bash
   node <repo>/_shared/a1-tools.cjs fix update-promote-state
   ```
7. Tell the user:
   > "promote-lessons complete. New suggestions in:
   > - `pattern/a1-learnings/lessons/<agent>/_suggestions/` (N suggestions)
   >
   > Please review the suggestions and manually promote the useful ones to `_active.md`."

**NEVER:** Write to `_active.md`. Never modify `agents/*.md` or `skills/*.md` directly.
