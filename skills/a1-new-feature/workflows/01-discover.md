# Phase 1 — Discover

**Goal:** Capture the raw feature idea via a structured interview. Produce a `discovering`-status
spec file with bullet-point answers to ten mandatory topics. No formal spec yet.

**Sub-agent:** Rene (`~/.claude/agents/a1-rene-requirement-engineer.md`).

**Status transition:** (none yet) → `discovering`.

## Step 1 — Identify project + feature slug

Ask the user which project this feature belongs to and a short kebab-case slug
for the feature. Example: project `my-project`, slug `meal-swap-history`.

The `project/<slug>/spec/` directory does not need to exist yet — `spec init` in Step 2
creates it.

## Step 2 — Create spec file via `spec init`

The CLI is the only writer of a fresh spec file (spec 010, FR-017). Never `Read` the template
and `Write` it by hand — the command picks the next number, stamps the frontmatter
(`type: spec` first, then `id`, `project`, `feature_slug`, `title`, `status: discovering`,
`size`, `created`) and links the spec from the project hub note:

```bash
node <repo>/_shared/a1-tools.cjs spec init <project-slug> <feature-slug> \
  --title "<working title from the user>"
```

Read the JSON result:

- `spec_path` — the file Rene appends to in Step 3. Discovery answers go under the
  `## Discovery — <Topic>` headers via `Edit`; the frontmatter is never edited by hand.
- `hub: "linked"` — `project/<project-slug>.md` gained one
  `- references [[project/<project-slug>/spec/<###>-<feature-slug>]]` line under `## Relations`.
- `hub: "missing"` — the project has no hub note yet. The spec is still created; tell the user
  in one sentence that the hub is missing (hubs are created by Otto/humans, never by the CLI)
  and continue. Once a hub exists, `a1-tools vault link-hub <project-slug> --spec <id>` adds
  the line idempotently.
- `hub: "unchanged"` — the hub already held that exact line; nothing was written. Continue.
- `hub: "skipped-non-writer"` — this host is not `A1_VAULT_WRITER_HOST` (e.g. the AI server),
  so the hub note is left to the writer host; stderr carries one
  `spec init hub link skipped: …` line. The spec is created. Tell the user in one sentence that
  the writer host links it later with `a1-tools vault link-hub <project-slug> --spec <id>`, and
  continue.
- `hub: "refused-link"` — the hub note or the project folder is a symbolic link, which the
  CLI refuses to write through (stderr names which). The spec is created. Report the refusal
  to the user in one sentence and continue; never edit the hub by hand.

The command refuses a feature slug that is not kebab-case and a title over 200 characters
(exit 1) — fix the input, do not work around the CLI.

## Step 2b — XS eligibility check

Before spawning Rene, run the deterministic XS gate against what is already
known from Step 1 (project + slug) and whatever intent/scope the user has
already stated in this conversation:

```bash
node <repo>/_shared/a1-tools.cjs quick eligibility \
  --intent "<1-2 sentence intent as stated so far>" --files <n> --diff-lines <estimate> \
  --scope <path>[,<path>...] --no-migration --no-new-route --no-new-dep \
  --by <project-slug>-<feature-slug>
```

Do **not** run an extra interview turn just to fill in eligibility flags —
if intent or scope are not yet known confidently enough to state real
values, that uncertainty itself fails the gate closed (see the "ambiguous →
fail closed" behavior in `quick eligibility`'s own contract), and this step
simply proceeds to Step 3 as normal.

- **Exit 0 (ELIGIBLE)** → do **not** run Step 3. Tell the user this looks
  like a tiny, low-risk change and it is being routed to the `a1-quick`
  lane instead of the full Discovery interview. Hand off to `a1-quick`
  (pass along the project/slug and the intent/scope just used) and stop —
  this workflow ends here.
- **Exit 1 (NOT_ELIGIBLE)** → proceed to Step 3 unchanged. The `reasons[]`
  are informational only at this point; no need to recite them unless the
  user asks.

**Override, either direction:** same house rule as the S/M/L triage in
Step 3b — the user can force a switch in either direction at any point
("treat as quick" / "run the full pipeline"), and forcing *out* of the
quick lane into the full pipeline is always honored without discussion.
Forcing *into* the quick lane despite a NOT_ELIGIBLE result is honored
without discussion for any reason **except** a forbidden-surface hit or a
reservation conflict — those two are hard-blocked and not overridable,
because they encode safety/consistency invariants the quick lane cannot
soundly skip.

## Step 3 — Spawn Rene with the Discovery brief

Use the **Agent** tool with `subagent_type: "a1-rene-requirement-engineer"` and this brief:

> You are Rene conducting the discovery for a new feature idea. Your task: run a
> structured interview, **one question per turn**. You must cover the following
> ten required topics in this order:
>
> 1. Problem — What is the problem being solved?
> 2. Primary User — Who is the main persona that benefits?
> 3. User Journey — What does the ideal flow look like?
> 4. Acceptance Criteria — How does the user know it works?
> 5. Success Metrics — How do we measure success? (quantitative if possible)
> 6. Out of Scope — What is explicitly NOT included?
> 7. Edge Cases — Which special cases must be considered now?
> 8. Compliance — Privacy, legal, industry rules, etc.?
> 9. Dependencies — Does this feature depend on other features, APIs, or data?
> 10. Priority — How urgent? Which user story is P1, which P2/P3?
>
> One question per turn. If the answer is vague, ask a follow-up question before
> moving to the next topic. Keep your language concise and let the user talk.
>
> After each user turn: append the answer as a bullet under the matching
> `## Discovery — <Topic>` header in the spec file. Raw notes are fine for now.
> When all ten topics are done, report "Discovery complete. Ready for Phase 2 (Specify)?"

Rene appends to the spec file directly while the interview runs.

## Step 3b — Size triage (S/M/L)

Classify the feature using the criteria in SKILL.md ("Size triage & fast
path"). **ALL** S-criteria must hold — any doubt → M. Tell the user the class
and its consequence in one sentence, e.g.:

> "This looks like Size S (2 FRs, existing screen, no migration): compact
> clarify, single-wave plan, all gates still run. Override if you disagree."

Accept an override in either direction without discussion. Phase 2 writes the
final class to the spec frontmatter (`size:`) via the template fill-in.

**Size-S shortcut for Steps 3–4:** on S, Rene's Discovery + Specify briefs
may be combined into one pass producing the mini-spec directly (1–2 FRs with
ACs) — the ten Discovery sections may be compressed to the ones with content,
but FR/AC formality is never dropped (Gate 4.5 and Gate C depend on it).

## Step 4 — Confirm completion

When Rene reports "Discovery complete":

1. Verify all ten Discovery sections in the spec have at least one bullet
   (Size S: the compressed section set from Step 3b is acceptable).
2. Ask the user: "Discovery looks like this — does it look right, or is anything important missing?"
3. On confirmation, do **not** advance status yet. Phase 2 (Specify) updates status to `draft`
   when Rene writes the formal spec.

## Hand-off to Phase 2

Tell the user: "Phase 1 complete. Should I have Rene write the formal spec now (Phase 2)?"

If yes: load `workflows/02-specify.md`.
If the user wants to abandon the idea: run
`a1-tools spec update-status <spec-path> cancelled`.
