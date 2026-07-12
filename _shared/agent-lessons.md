# Agent Lessons — Incident Narratives Behind Prompt Principles

Agent prompt files keep **one-line principles**; the incident stories that
motivated them live here (M12, decision doc 7.3a). This bounds prompt growth:
`a1-evolve`'s Apply phase appends new lesson narratives to THIS file — a new
one-line principle is added to the agent prompt itself only when the lesson
introduces a rule category no existing principle covers.

Format per lesson: heading `## <agent> — <slug>`, date + provenance line,
then the narrative with the concrete observed failure mode (keep it — the
specific symptom is what makes the rule persuasive).

---

## Pablo — tenant-context self-calls {#pablo-tenant-context}

Added 2026-06-08 (pattern from 4 postmortems, via a1-evolve synthesis).
Extracted from the prompt body 2026-07-12 (M12).

Self-calls from a Server Component to your own API routes hide failures
behind silent fallbacks (observed failure mode: KPI cards silently showing 0
instead of surfacing the error) and cause cold-start cascades under load.
Always call the DB layer directly via `withTenantContext`. Multi-query server
components get one `withTenantContext` call per query, each with its own
`.catch()` — a shared `.catch()` around a `Promise.all` turns one failed
query into a silent all-zero render.
