# Phase 04 — Tech-Proposals

Goal: generate concrete modernization proposals for the tech stack. Each
proposal is fully documented and requires individual Robert approval before
entering a wave. Output: `proposals` array in frontmatter, status
`proposals-pending` → eventually all proposals have a decision.

**Stop-gate G2 after this phase.** Robert approves each proposal individually.

## Step 1 — Determine which agents to spawn

Read `discover.tech_stack` from frontmatter. Spawn only agents whose domain
is present:

| tech_stack contains | Spawn |
|---|---|
| react, next, vue, angular, svelte | a1-walter-web-developer |
| flutter, swift, kotlin, react-native | felix-flutter-engineer |
| docker, k8s, terraform, github-actions, ci/cd | dirk-devops-engineer |
| openai, anthropic, langchain, embeddings, vector | a1-aik-ai-engineer |

If none match, walter is the safe default.

## Step 2 — Brief for each spawned agent

```
Project path: <analyzed_path>
Reverse-spec: <master-file-dir>/reverse-spec.md
Gap findings: <N> BLOCKER, <N> MAJOR, <N> MINOR
Focus: <agent's domain — e.g. "web frontend modernization">
Task: Propose concrete stack improvements. For each proposal provide:
  - title (short, action-oriented)
  - rationale (why this matters for this specific project)
  - risk: low | medium | high
  - effort_estimate (e.g. "2h", "1 day", "1 week")
  - rollback_path (how to undo if it goes wrong)
  - connection to gap findings (which BLOCKER/MAJOR does this address?)
Out of scope: implement anything, write code, run commands.
Limit: max 5 proposals per agent. Quality over quantity.
```

## Step 3 — Add proposals to frontmatter

For each proposal returned by agents:

```bash
node <repo>/_shared/a1-tools.cjs modernize add-proposal \
  "<master-path>" \
  --title "<title>" \
  --rationale "<rationale>" \
  --risk low|medium|high \
  --effort "<estimate>" \
  --rollback "<rollback>"
```

## Step 4 — Update status

```bash
node <repo>/_shared/a1-tools.cjs modernize update-status \
  "<master-path>" proposals-pending
```

## Step 5 — Gate G2: present proposals to Robert individually

Present each proposal one at a time (or as a table if fewer than 5 total).
For each, ask: approve / reject / defer?

```
Tech proposals for <project-slug>:

P-001: <title>
Rationale: <rationale>
Risk: <risk> | Effort: <effort>
Rollback: <rollback>
→ approve / reject / defer?

P-002: ...
```

For each decision:
```bash
node <repo>/_shared/a1-tools.cjs modernize approve-proposal \
  "<master-path>" P-001 approved|rejected|deferred [--reason "<text>"]
```

`deferred` = good idea, but not in this run. Stored in frontmatter backlog.
`rejected` = not wanted. Reason optional but encouraged.

## Step 6 — Confirm Phase 5

After all proposals have a decision:

> "All proposals decided. Approved proposals: <N>.
>
> Shall I start Phase 5 (Plan — wave decomposition with your approved proposals)?"

Proceed to `05-plan.md` on confirmation.
