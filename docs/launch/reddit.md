> DRAFT — publication is Robert's manual action. Do not post same-day as the Show HN post.
> Target: r/ClaudeAI. Different copy from the HN post (not a cross-post). Practitioner tone.
> Requires the rendered demo GIF (docs/assets/demo.gif) — attach it or link the raw GitHub URL.

# Reddit — r/ClaudeAI

**Suggested title:**

```
I gave Claude Code a memory for its own mistakes — a spec-driven pipeline that turns recurring bugs into gates [OSS, MIT]
```

---

## Post body

Author disclosure up front: I built this, it's my project, and I'm posting it here because r/ClaudeAI is where I'd want feedback from people who actually use Claude Code daily.

**The problem it solves:** if you drive Claude Code across a real codebase, you've felt the amnesia. Every session re-derives the same specs, the same plan shape, and re-introduces the same class of bug you already fixed once. The model isn't the bottleneck — the process around it forgets everything the moment the context window clears.

**What I did about it:** A1-Specforge is a set of auto-activating skills + sub-agents that run a feature end to end (spec → plan → build → verify → review), with deterministic gates in between. The gates are the point. When a run deviates — a plan claims a task is done but git shows no code, a migration forgets Row-Level Security, a sub-agent's "tests are green" is actually a mock — it gets recorded as a structured observation. Those observations cluster into patterns, and once a pattern recurs enough it's written back into the skills as a new gate. The pipeline literally gets stricter over time from its own postmortems.

**Demo** (real commands against the repo's own test fixtures — no faked output):

![a1-specforge gate demo](https://raw.githubusercontent.com/N3URAL-A1/a1-specforge/main/docs/assets/demo.gif)

The GIF shows the schema gate failing a migration that's missing RLS (exit 1), the corrected migration passing the same gate, and validating a shareable "gate-pack."

**By the numbers (all in the repo):**

- 17 skills, 18 sub-agents, MIT.
- 13 patterns clustered from the retro corpus and applied back into the skills, each with dated provenance in `_shared/learnings-index.md`.
- Zero-dependency Node CLI (≥18, built-ins only — no npm install), 14 fixture suites in CI.
- Gates are severity-tiered: BLOCKER stops the build (exit 1), MAJOR/MINOR are warnings.

**Honest caveats:** single maintainer, and the learned patterns come from one production project (multi-tenant SaaS + Postgres), so they skew backend/DB. It started life in German — a few cache files still are. I'm not selling a speed multiplier; what it does is stop a known list of mistakes from recurring and keep a paper trail of *why* each gate exists.

**If you want to poke at it:** there are a handful of good-first-issues (add a fixture for an uncovered subcommand, contribute a gate-pack from your own stack using `packs/postgres-rls/` as a template, improve an install error message). Repo: https://github.com/N3URAL-A1/a1-specforge

Genuinely after critique on the pattern-clustering and the gate-pack format — happy to answer anything about the mechanism in the comments.
