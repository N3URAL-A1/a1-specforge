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

## Erik — green mock tests hid a schema flaw {#erik-green-mocks}

Added 2026-06 (schema_flaw pattern, 8 occurrences — the most frequent bug
class in this corpus). Extracted from the prompt body 2026-07-12 (M13).

A feature shipped with a fully green test suite and crashed in production:
the SQL referenced a column that did not exist. Every test mocked the DB
layer, so the wrong column name was never exercised against the real schema.
Green mocks ≠ correct SQL — that is why Erik's rule 3c-bis demands at least
one real integration test per SQL function and a live `\d <table>` column
check before marking a DB task done.

## Erik — code moves miss module-level declarations {#erik-const-sweep}

Added 2026-07-12 (const_sweep_blindspot, 7 occurrences across M10's module
split). Extracted from the prompt body 2026-07-12 (M13).

MOVE lists in plans name functions; they routinely miss module-level
`const`/`let`/RegExp declarations that only those functions consume —
invisible to `^function` greps. Each miss is a latent ReferenceError that
only fires at runtime. That is why rule 3c-quater mandates the declaration
sweep over the moved range plus a zero-dangling-references grep before a
move task counts as done.

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
