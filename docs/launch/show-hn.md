> DRAFT — publication is Robert's manual action. Do not post same-day as Reddit.
> Author voice: first person (Robert). Verify all numbers against the repo on the day of posting.

# Show HN

**Title (literal, paste as-is):**

```
Show HN: A1-Specforge – a self-improving spec-driven pipeline for Claude Code
```

**URL:** https://github.com/mellow-rob/a1-specforge

---

## Post body

I build features with Claude Code all day, and the same thing kept happening: every session started from zero. Specs were vague, plans drifted, and the mistake I fixed last week showed up again in a new file. The model was fine — the *process* around it had no memory.

A1-Specforge is my attempt to give that process a backbone. It's a set of auto-activating skills and sub-agents for Claude Code that run a feature from idea → spec → plan → implementation → review, with deterministic gates between the phases. When you describe what you want, the right skill activates; it hands off to sub-agents (planner, executor, verifier, reviewer) automatically.

The part I actually care about is the loop. Each run writes structured observations when something deviates from plan — a missing import, a schema flaw, a gate that let a bug through. Those observations get clustered into patterns, and once a pattern shows up enough times it gets applied back into the skill files as a new gate. So the pipeline that plans your next feature is measurably stricter than the one that planned your last one.

Concrete numbers, all checkable in the repo:

- 17 skills, 18 sub-agents.
- 13 patterns have been clustered from the retro corpus and applied back into skill/agent files, each with dated provenance (e.g. `schema_flaw` surfaced across a 17-run backfill on 2026-06-19; `request_scoped_not_module_global`, a concurrency leak, applied 2026-07-04). The applied-pattern log lives in `_shared/learnings-index.md`.
- The gate mechanism is deterministic and severity-tiered: BLOCKER (exit 1, stops the build), MAJOR/MINOR (exit 0, warnings). Examples: a schema pre-gate that fails a migration missing Row-Level Security, a spec↔plan consistency check, a phantom-task detector (plan claims a task done but git shows no matching change).
- The CLI (`_shared/a1-tools.cjs`) is zero-dependency — Node ≥18 built-ins only, no npm install.
- 14 fixture test suites cover the gate logic, run in CI on a clean `$HOME`.
- MIT licensed. Installs as a Claude Code plugin (self-hosted marketplace) or via a symlink script for contributors.

## Honest limitations

- **Single maintainer.** This is my project; there's no team behind it yet. PR review happens when I have time, not on a schedule.
- **The corpus comes from one production project.** The 13 applied patterns were learned from my own work (a multi-tenant SaaS with Postgres RLS), so they lean toward backend/database failure modes. Your stack may surface different patterns — the gate-pack format exists so you can contribute your own, but the seeded corpus is not stack-neutral yet.
- **German-language roots.** I built the first version in German and translated the workflow bodies to English; a few learning-cache files are still German. If you find a stray German line, it's a leftover, not a feature.
- **Outcome claims are deliberately absent.** I'm not going to sell you a productivity multiplier. What it demonstrably does is prevent a fixed list of mistakes from recurring, and record why each gate exists.

Happy to go into the gate mechanism or the pattern-clustering in the comments.

---

## Prepared author top-level comment (post after the story goes up)

The clustering is deliberately boring and inspectable — no ML, just counting. After each run the executor and verifier append JSONL observations (`type`, `severity`, `pattern` tag) to a per-phase file. A synthesis step groups them by pattern tag; when a tag crosses a threshold (3+ independent occurrences) it becomes a proposal: a concrete diff to a named workflow file plus a one-line changelog with the occurrence count and date. Nothing is applied silently — every applied pattern is a line in `_shared/learnings-index.md` with its provenance, so you can trace any gate back to the incidents that justified it.

The reason I ship the *patterns as gates* rather than as advice: advice in a CLAUDE.md gets ignored under context pressure; a gate that exits 1 does not. The trade-off is false positives — a gate that's too strict is friction — so severity tiers matter (most learned checks are warnings, not blockers).

The gate-pack format (there's a worked example under `packs/postgres-rls/`) is the piece I'm least sure about and most interested in feedback on: it's meant to let people export patterns from their own corpus and share them, anonymized, without shipping executable payloads. Whether that ever becomes a real exchange depends entirely on whether the format is good enough — reviews welcome.
