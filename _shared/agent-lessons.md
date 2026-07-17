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

## Pablo — extraction MOVE lists miss module-level consts {#pablo-const-sweep}

Added 2026-07-17 (const_sweep_blindspot planning-side, M10 module split:
7+ undocumented constants across 17 waves, 3 audit rounds of BLOCKER
findings; verifier plan_quality observation demanded the sweep "from round 1,
not via audit iteration").

A "locate by function name" boundary grep (`grep -n "^function <name>"`) is
structurally blind to module-level `const`/`let`/RegExp literals sitting next
to the functions that consume them — especially values consumed via
bracket-lookup (`STATUS_TO_PHASE[x]`), `.test()`, or `.includes()` rather
than function calls. In M10 every wave's MOVE list missed at least one such
declaration (SQL_TYPE_ALIASES, REALPATH_DEFAULT_REAL_MARKERS, five separate
`*_STATUS_TO_PHASE` lookup objects, marker-string pairs); each miss is a
latent ReferenceError. Erik's execution-time sweep (rule 3c-quater,
{#erik-const-sweep}) caught all of them — but only as unplanned deviations.
The plan must front-load the sweep: build every MOVE list from a
`grep -n "^const \|^let \|^var "` sweep over the source range, naming every
declaration the moved code consumes.

## Pablo — read-path features must verify the writer {#pablo-writer-check}

Added 2026-07-17 (writer_read_asymmetry: n3ural hotfix PR #73 + spec 041,
plus the earlier billed_invoice_item_id dead-column incident).

When a feature starts READING an existing column or keys logic on a DB
enum/status value, plans and reviews habitually verify only the read side.
In PR #73 the OAuth callback (the column's ONLY writer) stored a hardcoded
stale scope literal, so re-consent could never grant the new scope — three
independent reviews (Samuel/Reinhard/Victor) all checked the read side and
none looked at the writer. In spec 041, cooldown-SELECT and click-gate both
keyed on `kind='briefing'` while the real writer stored `kind='work_done'` —
1350 green tests had cemented the wrong expectation. A plausible column name
is not evidence it is ever populated with the expected value: name the
writer, and verify it produces that value under realistic (non-empty)
conditions.
