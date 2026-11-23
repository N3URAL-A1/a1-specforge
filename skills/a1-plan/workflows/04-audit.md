# Phase 4: Audit

Spawn `a1-adam-auditor` to validate the PLAN.md before execution.

## Prompt template

```
Audit this PLAN.md for quality and coverage gaps. Write AUDIT.md.

<files_to_read>
- .a1/phases/<phase_name>/PLAN.md
- .a1/phases/<phase_name>/RESEARCH.md
- .a1/phases/<phase_name>/MAP.md
- <spec_path> (if provided)
</files_to_read>

**Output path:** .a1/phases/<phase_name>/AUDIT.md
```

## Completion and routing

### If verdict is PASS
- Inform user: "Audit passed. No blockers found."
- **Findings on a verification line are fixed now, not later.** A MAJOR or MINOR that names
  a `Verification` command or a "Done when" probe (red-line missing, green by construction —
  Adam Step 2) goes back to Pablo in revision mode with only these findings; then lane-split
  and depth-check run again (03-plan.md), no re-audit. The round does not count toward the
  2-cycle limit but adds 1 to the retro `revisions` field. Reason: 04b records the PLAN.md
  sha256 and a1-execute binds it at Load (`--expect-sha`), so a fix after 04b costs a
  re-review (`_shared/agent-lessons.md#plan-probe-red-line`). Other MINORs stay notes.
- **Then the permit state decides** (step below, after the vault mirror has started).
  The PLAN.md summary and the "Run `a1-execute`" suggestion are given by Phase 4b
  after the second provider has spoken, or by the denied branch — a PASS audit
  alone no longer ends the pipeline.
- **Before loading 04b, mirror the phase into the vault** (spec 010, FR-008):
  PLAN.md and AUDIT.md are final at this point, and the cockpit reads
  `project/<slug>/phases/` from the vault, never the repo. `<project-slug>` is
  the `project:` of `docs/product/ROADMAP.md`; a repo without a roadmap passes
  `--slug <slug>` instead of the positional slug, in the `vault sync` line (phases
  only) and in the `dashboard build` line alike. Anything 04b
  writes into the phase directory is picked up by the next sync (a1-execute
  step 2b-v). The step is skipped silently when `A1_VAULT_ROOT` is not set
  (tier repo-local), and a failed sync never blocks the pipeline. It runs in the
  background before the permit step and 04b: neither waits for it, and its warnings appear in the
  log file named on stdout:

  <!-- a1:background id=vault-mirror join=no -->
  ```bash
  VMIRROR_LOG="$(mktemp)"
  (
  if [ -n "${A1_VAULT_ROOT:-}" ]; then
    VSYNC_OUT="$(mktemp)"
    node <repo>/_shared/a1-tools.cjs vault sync <project-slug> --phases > "$VSYNC_OUT"; RC=$?
    if [ $RC -ne 0 ]; then echo "⚠ vault sync --phases exit=$RC — vault mirror not updated, continuing (stderr above, JSON in $VSYNC_OUT)"; fi
    node <repo>/_shared/a1-tools.cjs dashboard build <project-slug> >/dev/null; RC=$?
    if [ $RC -ne 0 ]; then echo "⚠ dashboard build exit=$RC — dashboard not refreshed, continuing"; fi
  fi
  ) > "$VMIRROR_LOG" 2>&1 &
  echo "vault mirror runs in the background, log: $VMIRROR_LOG"
  ```

- **Permit state (spec 027 FR-028).** After the mirror has started, read the owner's permit
  state. Only `denied` skips Phase 4b; every other outcome, an unreadable output included, loads it:

  ```bash
  PC_OUT="$(mktemp)"
  node <repo>/_shared/a1-tools.cjs xprov permit-check > "$PC_OUT"; RC=$?
  STATE="$(node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).state||"unknown"))}catch(e){process.stdout.write("unreadable")}' "$PC_OUT")"
  echo "xprov permit-check exit=$RC state=$STATE"
  ```

  - `state=denied`, or exit 77 (an intent child: the sandbox refuses every `xprov` call) — the **denied branch**.
    Print `ℹ Cross-provider plan review not applicable — the owner denied external review for this repository (permit-check state denied); Reinhard-only, continuing.`,
    show the PLAN.md summary (goal, wave count, success criteria) and suggest "Run `a1-execute`". Add to the retro
    `{id: plan-review-xprov, verdict: not_applicable, caught: false}` plus the issue tag `xprov_not_applicable`; design review
    is not applicable either. Nothing else is read.
  - Every other outcome: load `04b-xprov-review.md` (Phase 4b, cross-provider plan review, gate `plan-review-xprov`).

### If verdict is FAIL
- Inform user: "Plan has <N> blocker(s):"
- List each BLOCKER finding in one line
- Route back to Phase 3 (revision mode)
- Maximum 2 revision cycles — if still FAIL after 2, surface to user for manual decision

### Revision limit reached
If this is the second audit and still FAIL:
```
⚠ Plan still has blockers after 2 revision cycles.

Remaining blockers:
<list>

Options:
1. I can try to fix these manually — tell me which to address
2. Proceed anyway (I'll flag these as known risks)
3. Cancel and start fresh
```

---

## Retro (mandatory, every run)

After every a1-plan run — PASS (written once, after Phase 4b has routed) or
revision-limit-reached — write one retro entry per `_shared/retro-template.md`
(entry format + write targets: learning store first, dev cache best-effort),
with skill = `a1-plan` and these **additional fields** beyond the base schema:

```
phase: <phase-name>
spec: <spec-path or "none">
result: <pass|pass-after-revision|blocked>
revisions: <0|1|2>
audit_findings: <total-blocker-count-across-rounds>
finding_classes: [<from: missing_acceptance_criteria, vague_tasks, no_success_criteria, wave_too_large, missing_dependency, unverifiable_goal, spec_omission>]
phase_that_produced_issues: [<from: research, map, plan>]
```

Use the `finding_classes` tags consistently — they feed `patterns.md`
clustering. A run with zero findings still gets an entry (`audit_findings: 0`).

**`gates_fired` is required** — a1-plan runs registered gates (`plan-audit`,
`plan-review-xprov`, `depth-pass` on every plan, and `lane-split` on plans with a `lanes:` block). One
line per gate that ran, ids verbatim from `_shared/gates-registry.md`;
Phase 4b Step 4 defines the `plan-review-xprov` line (on the denied branch: the row above). Add
`xprov_waived` to `issues` (the base field of `_shared/retro-template.md`;
a1-execute's retro uses its own `issue_classes` — a1-evolve reads both) when a
waiver exists for this phase. Validate before appending — capture-then-check,
never a pipe:

```bash
GATE_LOG=".a1/phases/<phase_name>/gate-log.jsonl"
node <repo>/_shared/a1-tools.cjs gates fired --log "$GATE_LOG"; RC=$?
if [ $RC -ne 0 ]; then echo "gate log unreadable or broken (exit $RC) - fix it before the entry counts"; exit $RC; fi
node <repo>/_shared/a1-tools.cjs retro validate "$RETRO_FILE" --gate-log "$GATE_LOG" --phase retro-<phase_name>; RC=$?
if [ $RC -ne 0 ]; then echo "fix the gates_fired block above before the entry counts"; exit $RC; fi
```
