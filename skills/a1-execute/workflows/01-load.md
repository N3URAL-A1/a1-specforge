# Phase 1: Load Plan

Read the plan and confirm with the user before executing.

## Step 0 — Roadmap Gate (hard gate, before anything else)

Run the canonical check exactly as defined in
`_shared/roadmap-gate-check.md` (existence with docs/product preference →
parseability), using its bash snippets and user-facing prompt wordings
verbatim. Caller-specific values for this skill:

- `<work>` in the MISSING prompt = **"Phase execution"**.
- **MISSING / UNPARSEABLE** → HALT: do not load or execute any wave until
  the user has run `a1-roadmap` (unparseable additionally requires the
  explicit do-not-overwrite confirmation before handing off).
- **PARSEABLE** → proceed to Step 0b.

## Step 0b — Roadmap-entry membership check (only if a phase-to-roadmap linkage is known)

Same canonical membership check as `_shared/roadmap-gate-check.md` §3.
This only applies once the phase declares which roadmap entry it belongs to — read
the `roadmap_entry:` (or equivalent linkage) field from `GOAL.md` / `PLAN.md`
frontmatter in `.a1/phases/<phase_name>/`. If no such field exists yet, skip this
check and proceed to Step 1.

If a `roadmap_entry: <slug>` value exists, run the membership check **exactly as
`_shared/roadmap-gate-check.md` §3 defines it** — do not restate the snippet here.
It accepts both encodings (the `product import` comment and the frontmatter
`- id:` that `product init` writes); a copy of the older single-grep form in this
file reported MISMATCH for 74 of 85 real specs whose slug was present (measured
2026-09-20, invariant 1).

- **FOUND** → proceed to Step 1.
- **MISMATCH** → **soft stop.** Do not halt outright — surface a notice and let
  the user decide:

  > This phase's `roadmap_entry: <slug>` does not match any entry in the
  > project roadmap. Continue anyway, fix the roadmap_entry value, or add the
  > missing entry to the roadmap first?

  Proceed only after explicit user confirmation to continue.

## Step 0c — Plan review check (`load-check`, gate `plan-review-xprov`)

Before the Isolation Gate and before any wave loads: the current PLAN.md must
have been approved by the cross-provider review (a1-plan Phase 4b,
`skills/a1-plan/workflows/04b-xprov-review.md`). The check is deterministic —
the newest `plan-review-xprov` entry in `.a1/phases/<phase_name>/xreview/index.json`
with `verdict: pass` must carry the sha256 of the PLAN.md on disk right now
(FR-003). A plan edited after its review is an unreviewed plan.

```bash
mkdir -p .a1/phases/<phase_name>/xreview
node <repo>/_shared/a1-tools.cjs xprov load-check --phase <phase_name> > .a1/phases/<phase_name>/xreview/load-check.last-run.json; RC=$?
echo "xprov load-check exit=$RC"
```

(The `mkdir -p` matters: if a1-plan never ran Phase 4b the directory does not
exist, the redirect itself would fail with RC=1 and no JSON — indistinguishable
in the routing below from a real `plan_review_missing`. With the directory in
place the check fails with that reason, which is the correct answer.)

- **Exit 0** → proceed to Step 1. Keep `plan_sha256` from the stdout JSON as
  `$LOADED_PLAN_SHA` (and `accepted`: `pass` or `waiver`): every wave re-checks
  against it (`02-execute.md`, before 2a). `accepted: "not_applicable"` (the
  owner recorded `xprov permit --deny` for this repository and the owner's store
  confirms it) is also exit 0: **continue**, print the one-line notice
  `ℹ Plan review not applicable — the owner denied external review for this repository; continuing.`
  and record `{id: plan-review-xprov, verdict: not_applicable, caught: false}`
  in the retro (issue tag `xprov_not_applicable`). It is not a pass.
  **Spec 016 accepted verdicts.** Step 0c never asks the owner anything: the
  consent question belongs to a1-plan `04b-xprov-review.md` Step 1.0 and
  `02-execute.md` 2b-x.0. `accepted: "not_applicable"` is exit 0 for a denied
  repository (`permit_state: denied`) and for a repository with no permit
  (`permit_state: absent`, `origin_changed` or `unbound_legacy`): **continue**,
  print `ℹ Plan review not applicable — no Codex permit for this repository; Reinhard-only, continuing.`
  (denied: the line above). When `permit_state` is `origin_changed` or `unbound_legacy`, the
  line names it instead — `ℹ Codex review skipped: permit void (<permit_state>) — the owner should re-consent; Reinhard-only, continuing.` —
  and the retro records the state; Reinhard-only must never look like a plain absent permit. Record `{id: plan-review-xprov, verdict: not_applicable, caught: false}`
  with the issue tag `xprov_not_applicable`. `accepted: "not_applicable"` with `placement: "scope_exempt"` (spec 016
  FR-019: the spec is not size L and the plan names no security surface) is exit 0 as well: print
  `ℹ Plan review not applicable — scope_exempt: spec is not size L and the plan names no security surface; Reinhard-only, continuing.`
  and record the same retro entry with reason `scope_exempt`. `accepted: "codex_blocked_fallback"` (spec 016 FR-026: Codex answered BLOCKED
  twice for exactly this PLAN.md) is exit 0 too: print `ℹ Plan review not applicable — Codex answered BLOCKED twice; the Reinhard review is the only review for this plan, continuing.`
  and record the retro entry with reason `codex_blocked_fallback` (issue tag `xprov_not_applicable`). `accepted: "dispositions"` (FR-025: round 2 closed by recorded dispositions, no BLOCKER) and `accepted: "secret_declined"` (FR-029: the owner declined the allowlist question for a changed-line secret hit) are exit 0 too: record `xprov_disposed` respectively `xprov_not_applicable` (reason `secret_declined`) in the retro. `wave-status` lists such waves under `disposed` and `declined` next to `blocked_fallback`; a `carried_from` field in the `load-check` output means a whitespace- or heading-only PLAN.md edit kept the earlier pass (FR-030). A mismatch or broken state
  (`*_mismatch`, `audit_broken`, `invalid`) stays exit 1.
- **Exit 1, `reason: plan_review_missing`** → read `enforcement` from the
  stdout JSON (it echoes the `plan-review-xprov` row of
  `_shared/gates-registry.md`; the workflow applies it, the CLI never does):
  - `warning` → print the block below and **continue** to Step 1. The retro
    records `{id: plan-review-xprov, verdict: fail, caught: false}`.
  - `blocking` → **STOP before the Isolation Gate.** Print the block with the
    first line `❌ … enforcement: blocking`; route the user to `a1-plan`
    Phase 4b (re-run the review on the current PLAN.md). The only other way
    forward is a waiver by the owner. Main path (chat): a1-plan
    `04b-xprov-review.md` Step 5 with `--phase <phase_name>` — report what failed,
    `xprov consent question --kind waiver --phase <phase_name>`, AskUserQuestion
    exactly as printed, then `xprov consent ensure --kind waiver --phase <phase_name>` and `xprov consent waive --phase <phase_name>`. Fallback
    for headless runs (no chat to ask): tell the owner the terminal command and
    wait; an agent never runs it:
    `a1-tools xprov waive --phase <phase_name> --gate plan-review-xprov --reason "<text>" --by <name>`.
    The terminal command refuses without a TTY, under Claude Code's environment or with a Claude Code ancestor; it shows the key it computed itself (the PLAN.md sha256), asks for the gate id typed back and records the waiver in the guarded store
    `~/.a1-xprov/waivers.json`; load-check accepts it only while PLAN.md still has that sha256. A
    `waived: true` row in `index.json` is a mirror and unblocks nothing (spec 009 FR-003, FR-007).
- **Exit 2** → usage error or `xprov-gate.cjs` not shipped in this plugin
  version; no stdout JSON. Fix the call, do not treat it as a pass.

```
⚠ Plan review missing for the PLAN.md about to execute (gate plan-review-xprov, enforcement: warning)
   reason:  plan_review_missing — no pass entry matches the current PLAN.md sha256
   fix:     run a1-plan Phase 4b on this phase, or edit nothing and re-check
   Continuing because the registry row is still `warning`.
```

## Steps

1. Find PLAN.md at `.a1/phases/<phase_name>/PLAN.md`
   - If not found: "No plan found. Run `a1-plan` first to create one."

2. Read PLAN.md — extract:
   - Goal
   - Wave count and names
   - Success criteria
   - Total task count

3. Check STATUS for already-completed waves. Multi-lane phases write one file
   per lane (`STATUS-<lane-id>.md`), so read the whole set — reading only the
   plain file during a lane run makes completed waves look untouched and
   re-executes them:
   ```bash
   cat .a1/phases/<phase_name>/STATUS*.md 2>/dev/null
   ```

4. Check git status:
   ```bash
   git status --short
   git log --oneline -5
   ```

5. Present to user:
   ```
   Ready to execute: <phase name>
   Goal: <one sentence>
   
   Waves:
   → Wave 1: <name> (3 tasks) [ready]
   ✓ Wave 2: <name> (2 tasks) [already done — skip]
   
   This will create ~<N> commits.
   
   Proceed? [y/n]
   ```

6. Wait for user confirmation before proceeding to Phase 2.
