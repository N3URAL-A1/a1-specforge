# Cost-Tracker v1 — Claude Code Session-JSONL Format Notes

> Spike artifact of M6 Task 1.3 (2026-07-04). **This is the implementation contract for
> `a1-tools cost` (Wave 2, Task 2.2).** Investigated against real logs in
> `~/.claude/projects/-Users-rob-code-a1-skills/` (Claude Code version 2.1.185).

**No deviation from RESEARCH.md assumptions** — token data DOES live in the session JSONL
files, on `assistant` events. Two findings that change the naive implementation, though:

1. **Duplicate usage per message (MUST dedup):** streamed assistant messages are written
   as MULTIPLE JSONL lines that all carry the same `message.id` and the same (cumulative)
   `usage` object. Real sample: 272 assistant-with-usage lines → only 152 unique
   `message.id`s (up to 4 lines per id). **Aggregate once per unique `message.id`
   (take the LAST line seen for an id), never per line** — otherwise totals are ~1.8× too high.
2. **Sub-agent logs are SEPARATE, not duplicated:** sub-agent (Task-tool) API calls are
   logged in `<projects-dir>/<sessionId>/subagents/agent-*.jsonl` with the same event
   schema. The main session log only records the `tool_use`/`tool_result` envelope, NOT
   the sub-agent's own token usage. → `cost` MUST also read `*/subagents/*.jsonl` and ADD
   them to the owning session's totals (no double-counting risk; dedup by `message.id`
   still applies within each file).

## Directory layout

```
~/.claude/projects/<flattened-cwd>/            e.g. -Users-rob-code-a1-skills/
├── <sessionId>.jsonl                          main session log (one JSON object per line)
├── <sessionId>/
│   ├── subagents/
│   │   ├── agent-<id>.jsonl                   sub-agent session log (same schema)
│   │   └── agent-<id>.meta.json               {"agentType","description","toolUseId","spawnDepth"}
│   └── tool-results/                          ignore (hook text dumps)
└── memory/                                    ignore (markdown, no JSONL usage data)
```

## Event schema — exact field paths (Wave 2 blocks on these)

Only lines with `type === "assistant"` AND `message.usage` present carry token data.
All other event types (`user`, `attachment`, `hook_*`, `mode`, `message`, `tool_use`,
`file-history-snapshot`, …) are skipped.

| Datum | Field path (on the parsed JSONL line) |
|---|---|
| event type filter | `.type === "assistant"` |
| dedup key | `.message.id` (e.g. `msg_019spc…`) — count each id ONCE (last wins) |
| model | `.message.model` (e.g. `"claude-opus-4-8"`) |
| input tokens | `.message.usage.input_tokens` |
| output tokens | `.message.usage.output_tokens` |
| cache read | `.message.usage.cache_read_input_tokens` |
| cache creation | `.message.usage.cache_creation_input_tokens` |
| timestamp | `.timestamp` (ISO 8601, e.g. `"2026-06-21T12:55:53.208Z"`) |
| session id | `.sessionId` (also = filename stem of the main log) |
| cwd / project | `.cwd` (absolute path — sanity check vs. projects dir name) |
| git branch | `.gitBranch` (optional metadata) |
| sub-agent type | sibling `agent-<id>.meta.json` → `.agentType` (optional per-agent breakdown) |

Notes:
- `usage.server_tool_use`, `usage.cache_creation.ephemeral_*`, `usage.iterations` exist
  but are NOT part of the v1 aggregate.
- Malformed lines occur (partial writes) → parse line-by-line inside try/catch, count
  skipped lines in a warning counter, never crash.
- Some housekeeping lines (`last-prompt`, `mode`, …) have no `timestamp` — irrelevant,
  they are filtered out by the type check anyway.

## Aggregation contract

- Unit of aggregation: **session** (main log file + its `subagents/*.jsonl`).
- Per session and per model: sum of input / output / cache-read / cache-creation tokens
  over unique `message.id`s; plus grand total across sessions.
- Time-window filter: `--since` / `--until` (ISO) compare against each assistant event's
  `.timestamp`; a session appears if ≥1 of its usage events falls in the window (only
  in-window events are summed). Simplest v1 spec/phase mapping: caller supplies the phase
  time window (e.g. from `.a1/phases/<phase>/` file mtimes or PLAN.md `created:`), no
  git-commit correlation in v1.

## CLI interface (v1)

```
a1-tools cost run --project <claude-projects-dir> [--since ISO] [--until ISO] [--json]
```

- `--project`: directory containing `*.jsonl` (+ optional `*/subagents/*.jsonl`).
- Human output: per-session table (session, models, in/out/cache tokens) + summary line
  `Cost: <total> tokens (in <input>, out <output>, cache <cache_read+cache_creation>)`.
- `--json`: `{ sessions: [...], totals: {input, output, cacheRead, cacheCreation, total}, skippedLines }`.
- Exit codes: 0 = ok, 2 = error (project dir missing / no JSONL files).

## Fixture

`_test-fixtures/a1-cost/session-sample.jsonl` — 24 anonymized lines derived from the real
log structure (content redacted, structure + usage fields kept), incl. duplicate
`message.id` streaming lines and non-assistant noise lines. Expected totals in
`_test-fixtures/a1-cost/expected.md`. A sub-agent sample lives in
`_test-fixtures/a1-cost/<sessionId>/subagents/` to exercise the subagent path.
