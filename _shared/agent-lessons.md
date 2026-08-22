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

## Verify — a local QA server can serve a stale build {#verify-stale-server}

Added 2026-08-02 (stale_local_server_qa: a1-office-landing specs 001 and 002
on the same day, plus a maison-muelhens quick run).

`pkill -f "next start"` never matches the process it is aimed at: the running
process is named `next-server (vX.Y.Z)`, and the parentheses break the regex
silently — pkill exits 0 having killed nothing. The old server keeps the port,
the "restarted" QA session serves the PREVIOUS build, and the resulting
screenshots become manufactured bug evidence. In spec 001 this produced a
false FR-010 regression report; in spec 002 the same trap recurred hours later.

Two rules, both cheap:
- Kill by port, never by name pattern: `kill $(lsof -ti :PORT)`.
- Before trusting any local-server result, verify the serving process identity:
  `lsof -p <pid> | grep cwd` must point at the checkout you think you are
  testing (a worktree QA run pointing at the primary checkout is the same class
  of error).

Related environment trap from the same corpus: a `.env.local` present only in
the primary checkout (e.g. a `SITE_PASSWORD` gate) makes an e2e suite fail
everywhere with "element not found" while the identical suite is green in a
worktree. The tell is 307 redirects plus a runtime far above the usual.

## Pablo — missing `@returns` on `.mjs` exports cascades across waves {#pablo-mjs-returns}

Added 2026-08-22 (type_error_cascade: n3ural-contentbot M1-P1-engine-core,
waves 2, 5, 6, 9 — same defect class recurring 3 separate times in one
project; the executor's own wave-9 retro named it "identische Fehlerklasse
wie Wave 5").

`.mjs` (or other JSDoc-typed, non-`.ts`) pipeline modules have no native
TypeScript types — `tsc --noEmit` infers return shapes from JSDoc alone
(via `allowJs`/`checkJs`). A function exported without an explicit
`@returns {{...}}` block naming its fields gets inferred as a generic
`object`. Any later wave's consuming test or module that then accesses a
specific property (`result.status`, `result.exitCode`, `outcome.iteration`)
fails with TS2339/TS7016 — after the code is written and wired up, not
before. Every instance was caught and fixed inline via the executor's Rule 2
(auto-fix type errors), so nothing shipped broken — but the same avoidable
class fired in 3 separate waves before anyone named the pattern, each one
costing a full type-error round-trip that a plan-time checklist item would
have prevented. The fix is cheap and structural: any task that creates or
modifies a multi-field-returning `.mjs` export must require the `@returns`
block as part of its own "done when," not left to Rule 2 to catch reactively
every time.
