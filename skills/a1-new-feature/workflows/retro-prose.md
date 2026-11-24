<!-- load: conditional trigger=feature close -->
# Prose retro (only when `feature close --check-only` prints `"prose_required":true`)

Written when 05-merge item 1 says so; the reasons (`caught:<id>`, `result:fail`, `issues`) go into `issues`/`one_line_learning`. Validate against both logs as 05-merge item 1 says.

### Step 6a — Additional fields beyond the base schema

```
spec: <###>-<feature-slug>
result: <pass|partial|fail>
waves_total: <N>
bugs_found_in_verify: <N>
bug_classes: [<from: missing_wiring, wrong_behavior_vs_spec, deployment_incomplete, schema_flaw, regression, spec_omission, gate_friction, agent_self_report_false, parallel_collision>]
gate_that_caught_most: <Gate 0|Gate 1|Gate 2|Gate 3|Phase 6|none>
phase_that_produced_most_bugs: <discover|specify|clarify|plan|implement|verify>
retro_of: <spec-id>#<pr>
```

**No `gates_fired` here.** `feature close` writes the machine entry that carries it (one gate-ROI carrier per run); a second
list would count the run twice in a1-evolve. `retro_of` is the same `<spec>#<pr>` the close uses (never `machine_record`).
`gate_that_caught_most` stays as free text.

Use the `bug_classes` tags consistently — they feed `patterns.md` clustering.
A run with zero bugs is still useful data — write the entry with
`bugs_found_in_verify: 0` and `one_line_learning: no failures`.

Before appending this retro, validate it against the logs — contract and exit codes in
`_shared/retro-template.md`:

```bash
GATE_LOG=".a1/phases/<spec-id>/gate-log.jsonl"
node <repo>/_shared/a1-tools.cjs gates fired --log "$GATE_LOG"; RC=$?
if [ $RC -ne 0 ]; then echo "gate log unreadable or broken (exit $RC) - fix it before the entry counts"; exit $RC; fi
node <repo>/_shared/a1-tools.cjs retro validate "$RETRO_FILE" --gate-log "$GATE_LOG" --phase retro-<spec-id>; RC=$?
if [ $RC -ne 0 ]; then echo "fix the problems above before the entry counts"; exit $RC; fi
```

### Step 6b — Threshold check

Count entries in the **learning store** (not the dev cache — plugin installs
have no cache):

```bash
VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"
STORE="$VAULT/pattern/a1-learnings/a1-new-feature.md"
ALL=$(grep -c "^date:" "$STORE" 2>/dev/null); MACHINE=$(grep -c "^kind: machine" "$STORE" 2>/dev/null)
ENTRY_COUNT=$(( ${ALL:-0} - ${MACHINE:-0} ))  # a machine entry is no prose retro
```
If `$ENTRY_COUNT` is a multiple of 5:
> "5 new a1-new-feature learnings accumulated in the learning store. Run `a1-evolve`?"
