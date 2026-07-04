# Expected totals — a1-cost fixture

Fixture: `session-sample.jsonl` (main session, 19 lines) +
`session-sample/subagents/agent-atest0000000000000.jsonl` (sub-agent, 4 lines).
Anonymized: message content redacted, structure + usage fields kept
(derived from real Claude Code 2.1.185 logs, see `_shared/cost-format-notes.md`).

## Usage events (after dedup by `message.id` — streamed duplicates count ONCE)

| Source | message.id | model | input | output | cache_read | cache_creation | timestamp |
|---|---|---|---|---|---|---|---|
| main | msg_A (3 dup lines) | claude-opus-4-8 | 1000 | 200 | 0 | 5000 | 2026-07-01T10:00:05Z |
| main | msg_B (2 dup lines) | claude-opus-4-8 | 2000 | 300 | 10000 | 0 | 2026-07-01T10:01:10Z |
| main | msg_C | claude-sonnet-4-6 | 500 | 100 | 2000 | 300 | 2026-07-01T10:05:03Z |
| main | msg_D | claude-opus-4-8 | 4000 | 700 | 20000 | 1000 | 2026-07-02T09:00:04Z |
| sub | msg_S1 (2 dup lines) | claude-haiku-4-5 | 800 | 150 | 0 | 400 | 2026-07-01T10:02:05Z |
| sub | msg_S2 | claude-haiku-4-5 | 900 | 250 | 1500 | 0 | 2026-07-01T10:02:30Z |

Note: `msg_E` (assistant line WITHOUT `usage`) must be ignored. Naive per-line summing
(no dedup) would yield wrong totals — that is the regression this fixture locks.

## Expected session totals (session `session-sample`, incl. sub-agent)

- input_tokens: **9200**
- output_tokens: **1700**
- cache_read_input_tokens: **33500**
- cache_creation_input_tokens: **6700**
- total (in + out + cache_read + cache_creation): **51100**

Summary line: `Cost: 51100 tokens (in 9200, out 1700, cache 40200)`

## Per model

| model | input | output | cache_read | cache_creation |
|---|---|---|---|---|
| claude-opus-4-8 | 7000 | 1200 | 30000 | 6000 |
| claude-sonnet-4-6 | 500 | 100 | 2000 | 300 |
| claude-haiku-4-5 | 1700 | 400 | 1500 | 400 |

## Time-window check (`--since 2026-07-02T00:00:00Z`)

Only msg_D counts → input 4000, output 700, cache_read 20000, cache_creation 1000, total 25700.

## Malformed-line handling

The committed fixture contains only valid JSON lines (Done-when of Task 1.3 requires
every line to parse). Task 2.2's `run.sh` must additionally test skip-on-malformed-line
by appending a broken line to a TEMP COPY at test time — do not commit broken JSON here.
