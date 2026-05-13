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

## Optional — Tobi audit

If the user wants a deeper audit before declaring done, spawn `tobi-the-checker` with this
brief:

> Tobi, mach einen Final-Audit auf die Spec `<spec-path>` und den Code, der unter dem
> Wave-Plan `<plan-path>` implementiert wurde. Cross-cutting Check: Vision (passt es zum
> Produkt?), UX (User Flow nachvollziehbar?), Architektur (saubere Trennung?), Compliance
> (Datenschutz, Security, projekt-spezifische Regeln). Output als BLOCKER / MAJOR / MINOR.

Tobi findings do NOT automatically become verify_failures — the user decides whether a finding
triggers a bug back to Phase 5 or goes to the backlog.
