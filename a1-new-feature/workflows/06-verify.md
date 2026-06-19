# Phase 6 — Verify

**Goal:** Walk through every Acceptance Scenario in the spec with the user. Confirm each one
behaves as specified. Document failures in `verify_failures`. Close the spec only when
everything is green.

**Sub-agent:** the skill itself drives the walkthrough. Optionally Tobi for a final audit.

**Status transition:** `implementing` → `done` (all green) or stays `implementing` (failures).

## Precondition

All waves in the wave-plan are marked `⟶ status: done`. Spec status is `implementing`.
E2E-Test aus Step 5b (Phase 5) ist grün. Production-URL oder Preview-URL aus letztem Deploy
ist bekannt — falls nicht, `vercel ls` ausführen und URL notieren.

## Step 0 — Live-URL Reachability Check

Before the scenario walkthrough, confirm every feature route is reachable. This takes 2 minutes and prevents false-negatives from a silent deployment gap.

```bash
# Check each feature route added in the wave plan:
for path in <route-1> <route-2> ...; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "<production-url>$path")
  echo "$path → $code"
done
# Expected: 200 or 30x — never 404/500
```

If any route returns 4xx/5xx: do NOT proceed to the scenario walkthrough. Run `vercel ls` to confirm the active deployment, trigger a fresh deploy if needed, and re-check before continuing. A 404 here means the feature was not deployed — not that it's broken.

## Step 1 — Extract Acceptance Scenarios

Read the spec. Collect every Given/When/Then block under `## Acceptance Scenarios`, grouped
by User Story. Each scenario is one verification item.

## Step 2 — Szenarien gegen die laufende App prüfen (nicht gegen User-Erinnerung)

Für jede User Story (P1 zuerst, dann P2, P3):

**Nicht:** "Hast du das getestet?" — das ist keine Verifikation.

**Sondern:** Gehe die Schritte des Szenarios gegen die Production/Preview-URL durch.
Nutze Browser-Automation wenn verfügbar (mcp__claude-in-chrome__*), sonst gib dem User
eine **konkrete, schrittweise Anleitung mit exakter URL und erwarteter UI-Reaktion**:

> "**Story <US-ID> — <short title>**
>
> Please open: `<production-url>/<path>`
> Step 1: <click/input>
> Step 2: <click/input>
> Expected result: <what exactly should be visible>
>
> Does it behave like this? (yes / no / partially)"

Akzeptiere kein "müsste funktionieren" oder "hab ich nicht getestet" als `ja`.
Nur "ich habe es gerade gemacht und es funktioniert" zählt als grün.

Für technische SCs (Response-Zeit, RLS-Isolation, Error-Handling):
Stelle einen konkreten Verifikations-Command bereit statt eine Frage zu stellen:

```bash
# Beispiel RLS-Isolation:
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer <fremder-token>" \
  "<api-url>/api/expenses/<eigene-expense-id>"
# Erwartung: 404 (nicht 200)

# Beispiel Response-Shape:
curl -s -H "Cookie: <session>" "<api-url>/api/expenses/list" | jq 'keys'
# Erwartung: ["expenses","total"] — NICHT ["data"]
```

Capture the answer:

- **ja** → mark scenario `✓` in your tracking buffer.
- **nein / teilweise** → ask for the exact deviation. Capture as a failure entry:
  ```
  - story: US-<###>-N
    scenario: <kurzer Titel oder erste Zeile des Given>
    expected: <was die Spec sagt>
    actual: <was der User berichtet>
    timestamp: <iso>
  ```

Move to the next scenario only after the current one is answered.

## Step 3 — Edge-case spot check

After the User Stories, walk through the `## Edge Cases` list. For each edge case ask:

> "Edge Case: <text> — wurde das im Code behandelt?"

This is a softer check; flag edge cases that don't have explicit handling and add them as
verify_failures with `kind: edge-case`.

## Step 4 — Success Criteria sanity

Read the SC-### list. Ask the user whether each SC is met (some are quantitative — request
the actual number if available, e.g. response time, test coverage).

## Step 5 — Apply result

### All scenarios green AND all SCs met

```bash
node ~/.claude/skills/_shared/a1-tools.cjs spec update-status \
  <spec-path> done
```

The helper:
- appends `phase: implement, completed: <iso>` and `phase: verify, completed: <iso>` to
  `phase_history`,
- clears `verify_failures` to `[]`.

### Pre-merge check — rebase + migration-number collision (do this BEFORE merging to main)

The feature branch was cut from `origin/main` at the START of Phase 5. By the time Verify
passes, a PARALLEL feature may have merged to `main` and claimed the same migration numbers
or touched the same shared files. Merging naively then either reverts their work or ships two
migrations with the same number (runner breaks). Before `git merge`:

```bash
git -C <repo> fetch origin main
# 1. Is the branch behind origin/main?
git -C <repo> log --oneline <feature-branch>..origin/main        # non-empty → rebase needed
# 2. Migration-number collision? Compare your new migration numbers against origin/main's:
git -C <repo> ls-tree origin/main automation/db/migrations/ | grep -E '<your-new-numbers>'
```

- If behind: `git rebase origin/main`, resolve conflicts (keep BOTH sides for additive files
  like a capability manifest or a shared route's imports — never drop the other feature's lines).
- If migration numbers collide: renumber YOUR migrations (up + down + every in-file and in-code
  comment reference) to the next free numbers AFTER origin/main's highest. Re-run the dry-run.
- "main looks build-red after pull": first rebuild gitignored package `dist/` (`pnpm --filter <pkg> build`)
  before concluding main is broken — a stale local build masquerades as a red main.

Only after a clean rebase + no number collision + green build on the merged tree do you push.

Tell the user:

> "Phase 6 green. Spec is `done`. Wave plan can be archived or used as a reference for
> similar features. Optional: Tobi for a final audit?"

### One or more scenarios failed

Write the failures into the spec frontmatter via the helper. The helper accepts a JSON file
containing the failure entries via `--verify-failures-file <path>`:

```bash
# 1. Write the failures to a temp JSON file:
cat > /tmp/verify-failures.json <<EOF
[
  { "story": "US-001-1", "scenario": "user adds new entry", "expected": "...", "actual": "...", "timestamp": "..." }
]
EOF

# 2. Pass the file path to the helper:
node ~/.claude/skills/_shared/a1-tools.cjs spec update-status \
  <spec-path> implementing --verify-failures-file /tmp/verify-failures.json
```

The helper reads the JSON file, validates the schema, and writes the entries into the
`verify_failures` frontmatter array atomically.

Status stays `implementing`. Tell the user:

> "Phase 6 found N points that don't match. Would you like to:
> a) Send these back to the code agents as bugs (re-run Phase 5 for affected waves)?
> b) Open the spec, if the expectation itself was wrong (back to Phase 2/3)?"

Do not advance to `done` until all failures are resolved and a re-verify is green.

## Step 6 — Retro (mandatory, every run)

After every Phase 6 run — pass or fail — write one structured entry. Takes 2 minutes. Do not skip.

**Create local cache file if it does not exist, then append:**

```bash
cat >> ~/.claude/skills/a1-new-feature/_learning.md <<'EOF'
---
date: <YYYY-MM-DD>
spec: <###>-<feature-slug>
project: <project-slug>
result: <pass|fail>
bugs_found_in_verify: <N>
bug_classes: [<from: missing_wiring, wrong_behavior_vs_spec, deployment_incomplete, schema_flaw, regression, spec_omission>]
gate_that_caught_most: <Gate 1|Gate 2|Gate 3|Phase 6|none>
phase_that_produced_most_bugs: <spec|plan|implement|verify>
one_line_learning: <what would have prevented the main failure, or "no failures">
EOF
```

**Append the same entry to the Vault:**

```
~/Documents/Obsidian Vault/areas/a1-learnings/a1-new-feature.md
```

Use the `bug_classes` tags consistently — they feed into `patterns.md` clustering:
`missing_wiring` | `wrong_behavior_vs_spec` | `deployment_incomplete` | `schema_flaw` | `regression` | `spec_omission`

A run with zero bugs is still useful data — write the entry with `bugs_found_in_verify: 0`.

## Optional — Tobi audit

If the user wants a deeper audit before declaring done, spawn `a1-tobi-tester` with this
brief:

> Tobi, mach einen Final-Audit auf die Spec `<spec-path>` und den Code, der unter dem
> Wave-Plan `<plan-path>` implementiert wurde. Cross-cutting Check: Vision (passt es zum
> Produkt?), UX (User Flow nachvollziehbar?), Architektur (saubere Trennung?), Compliance
> (Datenschutz, Security, projekt-spezifische Regeln). Output als BLOCKER / MAJOR / MINOR.

Tobi findings do NOT automatically become verify_failures — the user decides whether a finding
triggers a bug back to Phase 5 or goes to the backlog.
