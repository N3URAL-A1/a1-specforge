# Phase 4b: Cross-provider plan review (`plan-review-xprov`)

Send the audited PLAN.md to a second provider (Codex, through the vendored
claudex-loop runner) and route on its verdict. One deterministic driver call;
the orchestrator reads the stdout JSON and decides — nothing here spawns an
agent until the driver has spoken.

Spec `009-cross-provider-review-gate` (FR-002, FR-006, FR-007). Registry row:
`plan-review-xprov` in `_shared/gates-registry.md` — that row's `enforcement`
cell (`warning` today, `blocking` after the Wave 7 flip) is read by the driver
and echoed as `enforcement` in its stdout JSON. This workflow applies it; the
driver never does (the flip changes one registry cell and no code).

## Precondition

- `.a1/phases/<phase_name>/AUDIT.md` exists and its verdict is **PASS**. A FAIL
  audit never reaches this phase — `04-audit.md` routes it back to Phase 3.
- The project permits external review: `.a1/xprov.json` with
  `external_review: allowed` (FR-021). The driver checks this first and stops
  with `reason: external_review_not_permitted` otherwise — for customer
  repositories that decision belongs to a1-ludwig-legal, not to this skill.

## Inputs

- `.a1/phases/<phase_name>/PLAN.md` — the reviewed artifact (sha256 recorded
  in `xreview/index.json`; a1-execute's Load check compares against it).
- `<repo>` — the a1-specforge checkout that owns `_shared/a1-tools.cjs`.

## Step 1 — Run the gate (round 1)

Capture stdout to a file, then test `$?` — never behind a pipe
(`_shared/retro-template.md` owns that rule; `workflow lint` enforces it):

```bash
XREVIEW_DIR=".a1/phases/<phase_name>/xreview"
mkdir -p "$XREVIEW_DIR"
GATE_OUT="$XREVIEW_DIR/plan-review-xprov.last-run.json"
node <repo>/_shared/a1-tools.cjs xprov gate --phase <phase_name> --gate plan-review-xprov > "$GATE_OUT"; RC=$?
echo "xprov gate exit=$RC"
```

Exit contract (house rule for every `xprov` subcommand): 0 = `verdict: pass` ·
1 = any fail, stdout JSON names `reason` · 2 = usage error, **no stdout JSON**
(fix the invocation; this is never a review result).

Read these fields from `$GATE_OUT` (a real run always emits them):

```bash
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); for (const k of ["verdict","enforcement","reason","findings_path","xreview_path","result_path","next"]) console.log(k+"="+JSON.stringify(r[k]===undefined?null:r[k]))' "$GATE_OUT"
```

The driver has already appended verdict, XREVIEW.md path and result path to
`.a1/phases/<phase_name>/PLAN-REVIEW-LOG.md` and written one observation
(`agent: xprov-codex`, `pattern: xprov_finding`) — do not duplicate either.

## Step 2 — Route by `verdict` and `enforcement`

| `verdict` | `enforcement` | Action |
|---|---|---|
| `pass` | any | Inform user: **"Plan ready, cross-provider approved."** Show the PLAN.md summary (goal, wave count, success criteria) and suggest: "Run `a1-execute` to start implementation." |
| `fail-with-findings` | any | REVISE — go to Step 3 (one revision round, then Step 4). |
| `fail` (any `reason`) | `warning` | Print the warning block below, then treat the plan as ready **with the warning attached** to the summary. The retro records `verdict: fail`. |
| `fail` (any `reason`) | `blocking` | **HALT.** Print the block below as an error; do not suggest `a1-execute`. Surface the `reason` and the two ways out: fix the cause (e.g. `preflight_failed`, `not_logged_in`, `external_review_not_permitted`) and re-run Step 1, or a human waiver (Step 5). |

Warning / halt block — same text, only the first line differs:

```
⚠ Cross-provider plan review did not pass (gate plan-review-xprov, enforcement: warning)
   reason:   <reason>
   details:  <xreview_path> (section for this round)
   The pipeline continues because the registry row is still `warning`;
   a1-execute will print the same warning at Load until a pass entry exists.
```

For `blocking` the first line reads `❌ … enforcement: blocking — execution is
not permitted until this passes or a human waives it.`

`round_cap` is a `fail` like any other: it means two review rounds completed
without APPROVED — surface it to the user, never start a third round.

## Step 3 — REVISE: revision round (only after `fail-with-findings`)

1. **Pablo, revision mode.** Spawn `a1-pablo-planner` exactly as `03-plan.md`'s
   revision mode does, but with the external findings as input:
   ```
   Revise PLAN.md against these external review findings. Reinhard schema
   ({summary, blocker[], major[], minor[]}); address every blocker and major,
   or state in the dispositions why not.

   <files_to_read>
   - .a1/phases/<phase_name>/PLAN.md
   - <findings_path>
   - .a1/phases/<phase_name>/AUDIT.md
   </files_to_read>
   ```
2. **Adam again.** Re-run `04-audit.md` on the revised plan. A FAIL here follows
   `04-audit.md`'s own routing (it counts toward its 2-cycle limit); only a PASS
   continues.
3. **Dispositions file — host-authored, never by the provider.** Write
   `.a1/phases/<phase_name>/xreview/plan-review-xprov-plan-r1.dispositions.md`:
   one line per finding id from `<findings_path>` — `accepted` (what changed in
   the plan) or `rejected` (why, in one sentence). Every id appears; an id
   without a disposition is a gap Codex will re-raise.
4. **Round 2.** Same driver, `--round 2`; the driver adds
   `--resume <previous result.json> --feedback <dispositions>` itself (the
   `next.resume_cmd` field of round 1 shows the exact resumed invocation — read
   it, do not hand-build it):
   ```bash
   node <repo>/_shared/a1-tools.cjs xprov gate --phase <phase_name> --gate plan-review-xprov --round 2 > "$GATE_OUT"; RC=$?
   echo "xprov gate round 2 exit=$RC"
   ```
   Route the result with the Step 2 table. A second `fail-with-findings` is
   reported by the driver as `fail` with `reason: round_cap` (FR-006) — there is
   no round 3. Only completed reviews count as rounds — `pass` and
   `fail-with-findings`; a failed attempt (`blocked`, `runner_failed`,
   `tripwire`, `secret_*`) consumes no round, so fixing its cause and re-running
   Step 1 does not move you closer to the cap.

## Step 4 — Retro fields (owned by `04-audit.md`'s Retro block)

The a1-plan retro is written once, after this phase — not after Phase 4. Add:

```yaml
gates_fired:
  - {id: plan-audit,        verdict: pass, caught: <true|false>}
  - {id: plan-review-xprov, verdict: <pass|fail>, caught: <true if a finding changed the plan>}
```

`verdict: fail` for every non-pass outcome, including `round_cap` and a
`warning`-enforced continue. If a waiver exists for this gate (Step 5), add
`xprov_waived` to `issues`. Validate with `retro validate` before appending, as
`04-audit.md` describes.

## Step 5 — Waiver (human only — never executed by this skill)

A waiver is a decision, not a step. When the provider is unavailable or the
user accepts the risk, tell the user the command and stop; the human runs
`a1-tools xprov waive --phase <phase_name> --gate plan-review-xprov --reason "<text>"`
in their own shell. It records `{waived: true, reason, by: human, ts}` in
`xreview/index.json` and a `## Waiver` section in XREVIEW.md, never
`verdict: pass`. No `bash` block in any skill contains that command — fixture
R7 greps for exactly that.

## Edge cases

- **Exit 2 (usage / module not shipped).** No stdout JSON. Do not route; fix
  the call or install the plugin version that ships `xprov-gate.cjs`.
- **`tripwire`, `secret_in_snapshot`, `secret_in_output`, `quarantined`.** The
  result was discarded by design; XREVIEW.md carries a BLOCKER note. Treat as
  `fail` per the table — and read the note before re-running, the cause is in
  the checkout, not in the plan.
- **PLAN.md edited after a pass** (e.g. a manual touch-up). The pass entry's
  `plan_sha256` no longer matches; a1-execute's Load check reports
  `plan_review_missing`. Re-run Step 1 — do not hand-edit `index.json`.
- **Multi-lane plans.** One review of the whole PLAN.md; lanes are inspected
  per wave by `wave-inspect-xprov` in a1-execute, not here.
