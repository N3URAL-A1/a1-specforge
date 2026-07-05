# ADR: Model routing matrix for a1 agents

**Date:** 2026-07-05 · **Status:** proposed · **Basis:** first empirical cost data (`a1-tools cost`), sampled subagent runs (~40 meta/jsonl pairs), current frontmatter pins.

## Problem (from the data)

1. **The three most dispatch-heavy pipeline agents are unpinned** — a1-erik-executor, a1-pablo-planner, a1-victor-verifier inherit the session default (currently `claude-fable-5[1m]`, tomorrow whatever Robert runs). The executor is the single biggest output producer (~15.6k tokens/run observed) and runs once per wave.
2. **Two conventions, all stale:** bare aliases (`opus`, `sonnet`) age gracefully; versioned pins (`claude-opus-4-7`, `claude-sonnet-4-6`, dated haiku) are all one generation behind and never get bumped.
3. Prose in a1-new-feature/a1-fix hardcodes "Opus 4.7" independently of the frontmatter — double drift.

## Decision

### Rule 1 — Aliases only, everywhere
Frontmatter `model:` is `haiku` | `sonnet` | `opus` or **absent** (= inherit session model). Versioned IDs are banned in skills/agents/rules (constitution invariant 6). Prose never names models; it says "the pinned model" or "reasoning-tier".

### Rule 2 — Pin by role, not by prestige
Inherit (no pin) is reserved for agents whose quality directly bounds the whole run AND that benefit from the strongest available model. Everything else pins down.

| Agent | Today | → Pin | Rationale (role × observed load) |
|---|---|---|---|
| a1-pablo-planner | inherit (fable) | **inherit** | Plan quality bounds everything downstream; audit loop proves reasoning failures here are expensive |
| a1-adam-auditor | sonnet-4-6 | **inherit** | The audit caught real blockers in both M6+M7 only via cross-reading — this is the adversarial safety net; underpowering it is false economy |
| a1-victor-verifier | inherit (fable) | **inherit** | Last line of defense; FMEA-1 makes it spec-facing — needs judgment |
| a1-falk-fault-finder | opus-4-7 | **opus** | Root-cause reasoning; alias fixes staleness |
| a1-alex-architekt | opus | opus (keep) | Architecture judgment; highest observed output (23.8k) is fine at this frequency |
| a1-reinhard-reviewer | opus | opus (keep) | Security review — do not cheapen |
| a1-erik-executor | inherit (fable) | **sonnet** | Biggest saving. Executes a *precise, audited plan* — the intelligence already happened upstream; M6 evidence: doc/CLI waves were mechanical. Escape hatch: wave brief may request `model: opus` for waves flagged `complexity: high` by the planner |
| a1-rafael-reverse-spec | sonnet-4-6 | **sonnet** | Worked flawlessly in M5 validation on sonnet-class |
| a1-theo-test-engineer | sonnet-4-6 | **sonnet** | Skeleton tests = pattern application |
| a1-walter-web-developer / a1-aik / a1-vincente / a1-tobi | sonnet | sonnet (keep) | |
| a1-uwe-ux-expert / a1-ludwig-legal | opus | **sonnet** / opus | Uwe: design execution is sonnet-class (drop); Ludwig: legal risk stays opus |
| a1-marco-mapper | haiku-4-5-dated | **haiku** | Highest output (18.5k) at lowest tier — exactly right; but see caveat below |
| a1-rico-researcher | haiku-4-5-dated | **sonnet** | Research errors cost real money downstream: M7 research/map produced contradictory inventory counts, and a1-plan retros show `finding_classes: missing_dependency` traced to research/map 5 of 6 runs. One tier up here is cheaper than one audit cycle |
| a1-rene-requirement-engineer | haiku | **sonnet** | Spec writing seeds every AC; spec_omission (4×) is a top-3 bug class — haiku here contradicts the corpus |

**Caveat marco/haiku:** if `missing_dependency` findings persist after rico→sonnet, mapper is the next suspect — revisit with the next 5 runs of data.

### Rule 3 — Measure per-agent ROI from now on
The cost CLI already separates subagent logs. Add to a1-evolve's collect phase: per-agent (output tokens × runs) joined with retro `finding_classes` attribution — after ~10 runs this table gets re-derived from data instead of judgment.

## Expected effect
Erik (highest-volume agent) drops from top-tier to sonnet ≈ biggest single saving in every execute run; two safety-critical upgrades (rico, rene) are paid for many times over by one avoided audit cycle or spec_omission escape. Net: cheaper *and* safer, with drift structurally removed (aliases only).

## Execution note (mechanical, Opus-suitable)
1. Frontmatter sweep per table (15 files) + delete dated/versioned IDs.
2. Prose sweep: "Opus 4.7"/model names out of a1-new-feature/a1-fix SKILL+workflows.
3. Wave-brief schema: optional `complexity: high` → executor dispatch overrides to `opus`.
4. Add the constitution invariant-6 grep to CI lint (M7 Wave 4 already builds the workflow).
