# Fixture Gate Registry — alias section rewritten as a table (R1 positive trap)

Byte-identical to `fixture-registry.md` EXCEPT the alias section below, which
is deliberately a markdown table instead of a bullet list — same row shape as
the real id table (`| \`id\` | ... |`), with a real-looking id
(`beta-gate-old`) in the left column. A whole-file scraper that greps for
`^| \`...\`` anywhere in the document picks this row up as a sixth literal id
and a seventh via the second alias row; the header-anchored parser must not.

| id | phase | class | cost | owning file | enforcement | notes |
|---|---|---|---|---|---|---|
| `alpha-gate` | Plan | deterministic | cheap | fixture | blocking | frozen fixture row 1 |
| `beta-gate` | Execute | deterministic | cheap | fixture | blocking | frozen fixture row 2 |
| `gamma-gate` | Verify | prompt | med | fixture | blocking | frozen fixture row 3 |
| `range-gate1..gate3` | Modernize | human | high | fixture | blocking | frozen fixture range row |

Five ids total once the range row expands: `alpha-gate`, `beta-gate`,
`gamma-gate`, `range-gate1`, `range-gate2`, `range-gate3` — six literal ids.

**Alias warning — rewritten as a table on purpose (R1 trap).** This section
looks identical in shape to the id table above and must be rejected by any
correct parser:

| written id | correct id |
|---|---|
| `beta-gate-old` | `beta-gate` |
| `lane-split-check` | `lane-split` |

If `parseRegistryIds` on this file returns anything containing
`beta-gate-old`, `lane-split-check`, or `lane-split`, it scraped the whole
file instead of stopping at the first blank line after the id-table header.
