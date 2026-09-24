# Vendored: claudex-loop `runner.py`

Spec `009-cross-provider-review-gate`, FR-022 / FR-023. This directory holds the ONLY copy
of the claudex-loop runner that a1 executes. a1 never resolves the runner from the Claude
plugin cache — `_shared/lib/xprov.cjs` `vendoredRunnerPath()` points here, relative to
its own module, and the fixture suite greps `_shared/lib` and `skills/` for the cache path
literal on every run (case R22).

## Provenance

| Field | Value |
|---|---|
| Upstream repository | https://github.com/chaseai-yt/claudex-loop (author: Chase AI) |
| Upstream version | 2.1.0 (`.claude-plugin/plugin.json` of the installed plugin) |
| Upstream commit | `8cf5e2c1771c5151d90c12642391d0ba8fa71b0e` — "Add standalone Claudex Route skill (#17)"; recorded as `gitCommitSha` in `~/.claude/plugins/installed_plugins.json` and as HEAD of the marketplace clone `~/.claude/plugins/marketplaces/claudex-loop` |
| Upstream path | `skills/claudex-loop/scripts/runner.py` |
| Captured from | `~/.claude/plugins/cache/claudex-loop/claudex-loop/2.1.0/skills/claudex-loop/scripts/runner.py` (plugin installed on 2026-09-20) |
| Capture date | 2026-09-24 |
| sha256 | `962dfdfe5d67b75eb73ec7c38b9186e6e6e0ca96a68d4ec82595305d8f737c8c` (420 lines, 23 422 bytes) |
| License | MIT — `LICENSE` in this directory is the upstream file, copied verbatim |
| Pin file | `SHA256SUMS` (`shasum -a 256 -c SHA256SUMS` format) |

The copy was compared byte for byte with the plugin-cache file (`cmp`) before the pin was
written, and the sha256 above was verified against the value the architecture analysis
recorded on 2026-09-24 BEFORE the file was copied.

## Audit summary (analysis finding F-052, re-read on 2026-09-24 against this exact file)

- **Standard library only.** Imports: `argparse, hashlib, json, os, pathlib, shutil,
  signal, subprocess, sys, tempfile, time, uuid`. No third-party package, no
  `requirements.txt` needed. Python 3.10+ (uses `X | None` annotations).
- **No network code.** No `urllib`, `http`, `socket`, `requests`, `ssl`. The only outbound
  traffic is what the Codex CLI process itself makes; the runner never opens a connection.
- **Argv arrays, never a shell.** Every subprocess call passes a list: `subprocess.run(["git",
  *args], cwd=repo, …)` for git, `subprocess.run(prefix + ["--version"], …)` for the CLI
  version probe, `subprocess.Popen(argv, cwd=repo, stdin=PIPE, …)` for the provider call.
  `shell=True` does not occur. The Windows `.cmd`/`.bat` shim branch (`os.name == "nt"`) is
  dead code on macOS and Linux.
- **Prompt via stdin.** The provider argv ends in `-`; the prompt (plan body, instructions,
  optional change manifest and feedback) is written to the child's stdin with
  `proc.communicate(prompt.encode("utf-8"), timeout=…)`. Plan text never becomes an argv
  token.
- **No environment access.** `os.environ` / `os.getenv` do not occur (0 hits). `CODEX_HOME`
  and `PATH` reach the Codex child only because the runner inherits the parent's
  environment unchanged — a1's `xprov run` (FR-014) is therefore the sole place that sets
  `CODEX_HOME`, and the runner cannot override or leak it.
- **Codex review argv is read-only by construction — two forms** (`command()`, lines
  149-152). Fresh session: `codex exec -s read-only -c approval_policy="never" --json -o
  <run>/reply.txt --skip-git-repo-check --output-schema <run>/schema.json [-m <model>] [-c
  model_reasoning_effort="…"] -`. Resumed review (`--resume <previous result.json>`):
  `codex exec resume <session-id> -c sandbox_mode="read-only" -c approval_policy="never"
  --json -o … --skip-git-repo-check --output-schema … -` — the sandbox arrives as a `-c`
  override instead of `-s`, same effect. In `build` mode the sandbox would be
  `workspace-write` — a1 never uses `build` (FR-024).
- **Writes, and never deletes anything.** The runner writes only into its run directory
  under `--artifacts` (`result.json`, `schema.json`, `prompt.txt`, `command.json`,
  `stdout.txt`, `stderr.txt`, `reply.txt` via the CLI's `-o`, `snapshot.json` in inspect
  mode) and removes nothing — `prompt.txt`, `stdout.txt` and `reply.txt` stay behind even
  after an early failure. Retention is a1's job: `xprov gc` (FR-020) removes run dirs after
  14 days, and `xprov run` cleans up a failed run's dir on every `fail/<reason>` except
  `secret_in_output`, which the user must inspect. Modes of what it creates: the artifacts
  ROOT (`root.mkdir(parents=True, exist_ok=True)`, line 310) is created with the process
  umask (typically 0755) — a1 pre-creates it as 0700 (FR-020) so the runner never has to;
  only the per-run `mkdtemp` directory is 0700 by construction. It refuses an
  `--artifacts` path that is the repo or lies inside it ("Keep run artifacts outside the
  target checkout", line 309). Without `--artifacts` it falls back to
  `tempfile.gettempdir()` — a1 always passes `--artifacts` (FR-020).
- **Timeout handling.** `--timeout` (default 600 s, must be ≥ 1) kills the whole child
  process group (`os.killpg(…, SIGKILL)`) and records `status: failed` with
  `error: "Run timed out or was interrupted; no approval recorded."` — this is the
  `failed` fixture case, captured live with `--timeout 1`.
- **Result validation.** `validate_review` enforces the response contract: exactly the keys
  `verdict, summary, findings, coverage, limitations`; verdict ∈ `APPROVED|REVISE|BLOCKED`;
  every finding has exactly `id, severity, path, evidence, fix` (non-empty strings), unique
  ids, severity ∈ `high|medium|low`; `coverage` must be non-empty for every verdict except
  BLOCKED (line 122); APPROVED may not carry high/medium findings; REVISE needs ≥ 1
  finding; BLOCKED needs ≥ 1 limitation. `cases/response.schema.json` in the
  fixture suite is the runner's own `schema.json` output and equals `REVIEW_SCHEMA` here.

## Runner facts a1 depends on (measured, not assumed)

- There is **no `--log` flag**. a1 writes `PLAN-REVIEW-LOG.md` itself (FR-011, `a1-tools xprov run`).
- `observed_models` is **always `[]` for Codex** (`parse_result` hardcodes it), so a1 reports
  `model_observed: unknown` (FR-013) until a measured field exists.
- `--artifacts` inside the repo is **refused** by the runner; a1 uses
  `~/.a1-xprov/artifacts/<repo-slug>/`.
- `requested_model` is `null` unless `--model` is passed; a1 passes no `--model` (ADR
  2026-09-24) and reports `model_requested: CLI default (unresolved)`.
- **Two failure shapes, not one.** Once the run directory exists, every outcome — including
  a failed provider call or a timeout — ends with the full record printed to stdout as the
  last JSON document after a one-line `{provider, model, mode, artifacts}` header, exit 0
  only for `status: completed`, else 1. Refusals BEFORE the run directory is created
  behave differently: an unresolvable `--repo`/`--plan` (`resolve(strict=True)`, line
  275), `--artifacts` inside the repo (line 309) or `--timeout < 1` (line 409) print one
  `claudex-loop: <message>` line to stderr, write NO JSON and NO `result.json`, and exit
  1. a1's `xprov run` treats "exit 1 and no result.json" as `runner_failed` with that
  stderr line as `reason_detail`, never as `malformed`.
- **Codex reads `AGENTS.md`.** The Codex CLI loads `AGENTS.md` from its cwd — the snapshot
  — and from parent directories as developer instructions; the runner does not (and
  cannot) suppress that. Accepted residual risk: the snapshot is a fresh clone of a commit
  a1 already controls, and the reviewer runs read-only. `xprov run` logs whether the
  reviewed commit ships an `AGENTS.md` so a reviewer verdict can be read against it.

## What a1 uses, and what it never uses

Used: modes `review`, `inspect`, `check`. Never used: mode `build`, `--unreviewed-spec`,
`--proof`, `roles`, the claudex-loop `SKILL.md` orchestration (Phase 0–3, ADR-FORMAT,
CONTEXT-FORMAT). The fixture suite asserts that no recorded runner argv ever contains
`build`, `--unreviewed-spec` or `--proof` (fixture R24 in `_test-fixtures/a1-xprov/`, FR-024).

## Update rule (binding)

A pin change is a supply-chain event, not a routine bump:

1. Copy the new upstream file, verify its sha256 against an independently recorded value
   (upstream release notes, or a second machine) BEFORE writing `SHA256SUMS`.
2. Re-read the file against the audit checklist above (stdlib only · no network · argv
   arrays · prompt via stdin · no `os.environ` access, 0 hits — `CODEX_HOME`/`PATH` come
   only from the parent · writes only under `--artifacts`, never deletes · build mode
   still unused) and record what changed.
3. **The same commit** that changes `SHA256SUMS` must add a row to the changelog below
   with the upstream version, commit, new sha256, and a summary of the upstream diff
   (`git diff <old> <new> -- skills/claudex-loop/scripts/runner.py` in the upstream clone).
4. `_test-fixtures/a1-xprov/run-tests.sh` must exit 0 (R22 verifies the pin against the real
   tree; R23 proves a mismatch is refused). Captured fixture cases keep their `.meta`
   `runner_sha256` — they document the runner that produced them, not the current pin.
5. `a1-tools xprov preflight` (FR-014) refuses to run while the vendored file and the pin
   disagree; an unreadable `SHA256SUMS` is a FAIL, never a skip.

## Changelog

| Date | Upstream version / commit | sha256 | Change |
|---|---|---|---|
| 2026-09-24 | 2.1.0 / `8cf5e2c1771c5151d90c12642391d0ba8fa71b0e` | `962dfdfe5d67b75eb73ec7c38b9186e6e6e0ca96a68d4ec82595305d8f737c8c` | Initial vendoring (spec 009, Wave 1). Decided 2026-09-24: vendor + pin, no fork into the N3URAL-A1 org. |
