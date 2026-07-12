# Sub-Agent Brief Template (Phase 3 — Analyze)

This template is used by `workflows/03-analyze.md` to construct a focused brief
for each sub-agent dispatched via the `Task` tool. The four sections below MUST
all be present in every dispatch.

## Brief structure (fill these four sections)

```
You are <AGENT_NAME>. Task: <FOCUS_HUMAN> analysis of an existing project.

## Project Context

- Project slug: <PROJECT_SLUG>
- Local path: <ANALYZED_PATH>
- Tech stack: <TECH_STACK_LIST>
- LOC: <LOC> in <FILE_COUNT> files
- Last commit: <LAST_COMMIT> on branch <BRANCH>
- Commit activity (30 days): <COMMIT_COUNT_30D>

Analysis file (for your reference, do NOT edit):
<ANALYSIS_PATH>

## Focus

<FOCUS_SPECIFIC_PROMPT>

(see mapping below per agent.)

## Output Contract (HARD)

Return ONLY a JSON list of findings. Per finding:

```json
{
  "severity": "BLOCKER" | "MAJOR" | "MINOR",
  "category": "short label (max 3 words)",
  "location": "file:line OR module/path",
  "description": "what is wrong, factual, 1-3 sentences",
  "recommendation": "what to do about it, actionable"
}
```

Severity definitions:
- BLOCKER: security hole, data-loss risk, compliance violation, broken core flow.
- MAJOR: significant risk / quality / maintainability issue; should be fixed before launch or soon.
- MINOR: polish, style, small improvement, backlog material.

Free-prose responses are rejected. If you find nothing: return empty JSON array `[]`.
If you need more context: return `[]` and a brief prose note explaining what you need.

**Delivery (HARD):** your plain-text final response is NOT automatically visible to
the orchestrator. Once your findings are ready, you MUST call the SendMessage tool
with `to="main"` and the JSON array as the message content. Do not rely on ending
your turn with the findings in your last message — that alone does not deliver them.

## Out of Scope

- HARD READ-ONLY. Return your findings as TEXT (tool output). Write NO files —
  ANYWHERE. Not in <ANALYZED_PATH>, not in docs/, not in /tmp, not in the vault.
  Using the Write or Edit tool at all is a contract breach; the orchestrator runs
  a git tripwire and will discard your findings if the worktree changed.
- NO code changes. NO test runs, NO builds, NO deploys.
- Do NOT modify any files in <ANALYZED_PATH>.
- Do NOT create new files (no report files, no "helpful" docs — findings are tool output only).
- NO discussion of alternative architectures unrelated to the focus.
- NO recommendations that don't fit a concrete `recommendation` field.
```

## Focus-specific prompts

### general

> Provide a high-level overview. What are the 5 most important observations
> about this project (architecture, quality, risks)? One observation per finding.
> Severity based on actual impact, not visual prominence.

### security

> Look for: hardcoded secrets, missing input validation, auth-bypass risks,
> RLS gaps (Supabase/Postgres), insecure default configs, outdated dependencies
> with known CVEs, PII in logs, missing rate limiting, XSS/CSRF vectors.
> Prioritize BLOCKER for anything enabling data exfiltration or account takeover.

### architecture

> Evaluate module boundaries, coupling, abstraction consistency, missing ADRs for
> non-trivial decisions, growth bottlenecks. Are the key architecture decisions
> documented anywhere? Are modules cut such that parallel development is possible?
> BLOCKER only for structural damage (e.g. circular dependencies between core modules).

### quality

> Check code quality: complexity, duplication, missing tests in critical paths,
> dead code, inconsistent patterns, faulty error-handling practices, oversized files
> (>800 lines), deep nesting (>4 levels). BLOCKER only for systemic quality violations
> that block maintenance.

### onboarding

> From the perspective of a new developer: what would accelerate 80% of the onboarding
> journey? Identify missing READMEs, unclear entry points, non-obvious dependencies,
> mental model gaps. Findings here are primarily MINOR/MAJOR —
> real BLOCKERs (e.g. "project does not build without undocumented setup") are rare.

## Dispatch checklist (workflow uses this)

- [ ] All four brief sections present
- [ ] Project Context filled from frontmatter discover[]
- [ ] Focus prompt from table above for the chosen focus
- [ ] Output Contract verbatim, no shortening
- [ ] Out of Scope verbatim, no shortening
- [ ] Agent name set
- [ ] Analysis file path passed (read-only reference)
