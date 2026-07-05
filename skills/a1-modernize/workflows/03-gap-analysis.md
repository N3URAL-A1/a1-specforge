# Phase 03 — Gap-Analysis

Goal: compare code reality against the reverse-spec. Find inconsistencies,
dead paths, spec gaps, security/quality findings. Output: `gaps` section in
master file, status `gap-analyzed`.

**This is the END STATE for `spec-only` mode.** After this phase, spec-only
runs show `suggested_next` and stop.

## Step 1 — Parallel agent dispatch

Spawn all three in the same turn:

**Brief for a1-reinhard-reviewer:**
```
Project path: <analyzed_path>
Reverse-spec: <master-file-dir>/reverse-spec.md
Focus: security and quality gaps
Task: Compare code against the reverse-spec. Find:
  - Security issues (auth gaps, injection risks, secrets exposure)
  - Quality issues (dead code, error handling gaps, missing validation)
  - Cases where spec says X but code does Y
Output contract: {severity: BLOCKER|MAJOR|MINOR, category, location: file:line,
  description, recommendation, source_agent: "reinhard"}
Out of scope: architecture design, tech recommendations, test writing.
```

**Brief for a1-alex-architekt:**
```
Project path: <analyzed_path>
Reverse-spec: <master-file-dir>/reverse-spec.md
Focus: architectural gaps
Task: Compare code against the reverse-spec. Find:
  - Architectural inconsistencies (layer violations, circular deps, coupling)
  - Missing abstractions that the spec implies
  - Scalability concerns given observed usage patterns
Output contract: {severity: BLOCKER|MAJOR|MINOR, category, location: file:line,
  description, recommendation, source_agent: "alex"}
Out of scope: security details, test writing, tech stack recommendations.
```

**Run a1-reconcile as sub-process:**
If `a1-reconcile` is available as a skill (check via `search_skills reconcile`):
```bash
# Use a1-reconcile to compare the reverse-spec against code
# Pass the reverse-spec as the "spec" input and the project path as "implementation"
```

Otherwise: manually compare each FR in the reverse-spec against the codebase —
check if the described behavior exists in code. Mark each as:
- `CONFIRMED` — code matches spec
- `MISSING` — spec describes behavior not found in code
- `EXTRA` — code has behavior not in spec
- `DIVERGED` — code behavior differs from spec description

## Step 2 — Aggregate findings

Collect all findings from Reinhard, Alex, and the reconcile check. Deduplicate
(same file:line reported by multiple agents → merge, keep highest severity).

Append each finding to master file:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs modernize update-status \
  "<master-path>" gap-analyzed \
  --phase-data '{"findings_count": {"blocker": <N>, "major": <N>, "minor": <N>}}'
```

## Step 3 — Present results to Robert

```
Gap analysis complete for <project-slug>.

Findings:
- BLOCKER: <N>  (e.g. unsanitized user input in /api/upload)
- MAJOR:   <N>
- MINOR:   <N>

Spec-Drift:
- MISSING: <N> behaviors in spec not found in code
- EXTRA:   <N> behaviors in code not in spec
- DIVERGED: <N> behaviors that differ

Full gap list: `projects/<slug>/modernize/<date>/reverse-spec.md`
```

## Step 4 — spec-only end state

If mode is `spec-only`:

```
Spec-only run complete.

The reverse-spec and gap analysis are in the Vault:
→ `projects/<slug>/modernize/<date>/reverse-spec.md`

Recommendations for next steps:
```

Show `suggested_next` from frontmatter. **Stop here for spec-only.**

## Step 5 — full mode: confirm Phase 4

For `full` mode:

> "Shall I start Phase 4 (Tech Proposals — which stack improvements would be worthwhile)?"

Do not proceed without confirmation. Proceed to `04-tech-proposals.md`.
