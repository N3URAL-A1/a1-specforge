# ADR: What a1-specforge owns, and where host operations and the vault cockpit begin

**Date:** 2026-11-28 · **Status:** accepted (owner decision in chat, 2026-11-27) · **Context:** A blueprint analysis of a large third-party Claude Code distribution (vault `project/a1-specforge/analyses/2026-11-27-general.md`, finding F-007) showed what happens without a boundary: in-session pipeline logic and host operations sit in one flat library, so neither part can be lifted out or reasoned about alone. The ideas adopted from that analysis (context-pressure gate, hook runtime, cost figures, session state) land exactly where a1-specforge meets two companion projects of the maintainer: a host operations repo (`ai-harness`, private) and an Obsidian cockpit plugin (`obsidian-lumen`, private). The owner decided to keep three repos and one rule instead of merging them.

## Decision

### 1. Three owners

| Layer | Owner | Holds |
|---|---|---|
| Inside a Claude Code session | **a1-specforge** (this repo, public plugin) | skills, agents, deterministic gates and their registry, the hook contract and hook runtime, review, learning store, cost parsing from transcripts |
| Around the session process on a host | host operations repo (`ai-harness`) | systemd units, tmux, job queue and sandbox, recovery after reboot or OOM, installers, secret filter for output that leaves the host, session inventory |
| Display and control in the vault | cockpit plugin (`obsidian-lumen`) | views over vault files, writing intent files, settings UI |

"AI harness" as a term names the whole picture. The repo `ai-harness` is only the host operations layer.

### 2. The seams

Two seams, nothing else:

1. **The `a1-tools` CLI** (`_shared/a1-tools.cjs`) with its exit codes and JSON output, plus documented environment variables (`A1_VAULT_ROOT`, `A1_HOST_ID`). Host code calls the CLI as a process.
2. **Files in the vault** with a schema this repo publishes (status mirror, intent queue, run records). A consumer reads or writes the file; it does not reach into the code that produced it.

### 3. No cross-imports

No repo imports, sources or copies code of another one. A consumer that needs the same rule twice (for example a schema check) keeps its own implementation and a parity test against the published contract.

### 4. Where a new idea goes

Ask where the thing runs. Inside the session and the same on every host: here. Needs a service manager, a queue, a second process or knowledge of one machine: host operations. Only shows or triggers something for a human in the vault: cockpit. A feature that needs two layers is split at a seam of section 2, and the contract (CLI output or file schema) is specified on this side first.

## Consequences

- This repo stays installable on its own. Nothing here may require the host operations repo or the cockpit plugin; without them a1-specforge runs with a repo-local learning store.
- Roadmap features 032 (context-pressure gate, hook runtime) and the cost figures stay here. A session inventory, stall detection for jobs and install manifests belong to host operations.
- A change to CLI output, an exit code or a vault file schema is a contract change: it needs a fixture here and is announced to the two consumers.
- Measured on 2026-11-28: no file in the three repos imports code of another one; host operations refers to `a1-tools` in eight files (job library and one handover script) and calls it as a process; the cockpit keeps parity tests against the a1 intent schema; a1-specforge references neither companion.

## Alternatives considered

- **One repo for all three.** Rejected: a public plugin, private host scripts with machine details and an Obsidian plugin with its own build have different audiences, release rhythms and secrets exposure.
- **No written rule.** Rejected: the analysed distribution shows the result, and four of the adopted ideas sit on the boundary.
