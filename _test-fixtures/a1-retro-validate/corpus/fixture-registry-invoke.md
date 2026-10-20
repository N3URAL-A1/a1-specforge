# Fixture Gate Registry with the `invoke` column (frozen — do not edit in place)

Checked-in test double for `_shared/gates-registry.md`. Small and frozen ON
PURPOSE so `parseRegistryIds` can be asserted against an EXACT expected list
(R2) rather than a count that moves every time a real gate is registered (the
live table held 31 id rows six commits ago, 32 today — see
`_shared/lib/gate-ids.cjs` header comment and `agent-lessons.md#theo-mutation-question`).

Row shape mirrors the real registry's header exactly, because `parseRegistryIds`
locates the table by that header line and must not care about anything else in
this file.

| id | phase | class | cost | owning file | enforcement | notes | applies_to | invoke |
|---|---|---|---|---|---|---|---|---|
| `alpha-gate` | Plan | deterministic | cheap | fixture | blocking | frozen fixture row 1 with an escaped pipe pass\|fail in notes | | `alpha run` @ a1-new-feature,a1-fix |
| `beta-gate` | Execute | deterministic | cheap | fixture | blocking | frozen fixture row 2 | | `beta run` @ a1-execute; unwired_until=2026-11-30; unwired_reason=spec 017 wave 13 |
| `gamma-gate` | Verify | prompt | med | fixture | blocking | frozen fixture row 3 with a stray | pipe | | none |
| `range-gate1..gate3` | Modernize | human | high | fixture | blocking | frozen fixture range row | | none |

Five ids total once the range row expands: `alpha-gate`, `beta-gate`,
`gamma-gate`, `range-gate1`, `range-gate2`, `range-gate3` — six literal ids.
(Kept the naming: "id" always means one resolvable slug, whether it came from
a literal row or a range row.)

**Alias warning — ids are copied verbatim, never paraphrased.** Observed
drifts in this fixture's imaginary corpus:

- written `beta-gate-old` -> correct id is `beta-gate`

(Deliberately a bullet list, not a table — mirrors the real registry's own
comment explaining why: a markdown table here would share the id-table's row
shape, and a parser scraping `^| \`id\`` anywhere in the file would then
accept this column as valid ids too.)
