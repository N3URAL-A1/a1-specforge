# ADR: Gate wiring contract - registry `invoke` column, gate log, dispositions, project config files

**Date:** 2026-10-14 (written 2026-10-20, wave 1 of spec 017) · **Status:** accepted · **Context:** 32 defects escaped since 2026-08 (analysis `analyses/2026-10-14-autonomy-self-control.md`). The registry (`_shared/gates-registry.md`) names gates that no workflow ever called, retros self-report `gates_fired`, and the verifier ignored exit codes. Spec `017-enforced-self-checks` (vault `project/a1-specforge/spec/`) turns six lessons into deterministic CLI checks. This ADR fixes the contracts every later wave reads. Wave 14 adds the measured results at the end (section "Results").

## Decision

### 1. The `invoke` column
`_shared/gates-registry.md` gets a LAST column `invoke` (after `applies_to`). Each cell is exactly one of:

| Form | Meaning |
|---|---|
| `` `<subcommand>` @ skill,skill `` | The `a1-tools` subcommand the named skill directories must call. Skill names match `[a-z0-9-]+`; the subcommand is the literal words after `a1-tools.cjs` (for example `realpath-check run`, `product validate --spec-status`). |
| `external` | The CLI lives in another repo (`no-imported-expectations`, `branch-coverage`, the `proorc-release` rows). |
| `none` | Class `prompt` or `human`. |

Exemption suffix, both parts mandatory: `; unwired_until=<YYYY-MM-DD>; unwired_reason=<text>`. `gates lint` lists every exemption on every run, passes through the date (inclusive), and exits 1 the day after. The only wave-1 use is "spec 017 wave <N>" (the wave that wires the row; 13 for rows settled there); wave 13 removes all of them.

Parsing (`_shared/lib/gate-ids.cjs`): cells split on UNESCAPED pipes; `\|` stays inside its cell. Real notes also hold stray unescaped pipes inside backticks (`pass|fail`), so only the first six columns and the last (columns - 7) are positional and everything between is `notes`. A row with fewer cells than the header is `malformed_row`. `invokeMap()` returns `{subcommand -> gateId}`; each subcommand maps to exactly ONE gate id (`verify run` is the invoke of the existing `gate-1-build` row; there is no `verify-run` row).

### 2. `gates lint`
Exit 0 all wired / 1 at least one finding / 2 usage, unknown flag, hostile value, unreadable registry. Rules: `no_invoke_column`, `malformed_row`, `invoke_invalid`, `blocking_unwired` (deterministic + blocking with `none`), `prompt_names_command`, `duplicate_subcommand`, `unknown_skill`, `unwired`, `exemption_expired`. A skill is wired for a gate only when a fenced `bash` block in `skills/<skill>/SKILL.md` or `skills/<skill>/workflows/*.md` holds `a1-tools.cjs <subcommand>` (continuation lines joined; comment, `echo` and `printf` lines do not count; word boundary after the last word). Prose never counts. Calls from skills the cell does not name are allowed. Fenced-bash extraction is imported from `workflow-lint.cjs`. A live exemption suppresses `blocking_unwired` and `unwired` for its row. CI runs the command as its own step.

### 3. Gate log (built in wave 2; contract fixed here)
One JSON line per invocation of a subcommand named in an `invoke` cell, appended to `.a1/phases/<scope>/gate-log.jsonl`. Fields: `ts` (UTC ISO), `gate` (registry row whose `invoke` names the subcommand, resolved via `gate-ids.cjs`), `verdict`, `exit`, `head_sha`, `scope`, `prev` (sha256 of the previous line's bytes; first line 64 zeros). `<scope>` comes from `--phase <scope>` at every call site: a1-execute the phase name, a1-new-feature the spec id, a1-fix `fix-<bug-slug>`, a1-pr-review `pr-<number>`. No flag: `.a1/phases/_unscoped/gate-log.jsonl` plus one stderr notice.

A generic hook in the facade appends the line after the subcommand returns, so existing gates log without per-module edits. Nested calls are in-process function calls (`verify run` inside `pr merge-check`) and never append. Appends run under `locks.cjs` with one `O_APPEND` write per record (the chain needs read-then-append; `O_APPEND` alone lets two writers chain to the same predecessor). The log is never committed: `.gitignore` lists `.a1/phases/*/gate-log.jsonl`, and the first write in any repo adds the same pattern to `<git-common-dir>/info/exclude` (idempotent). `gates lint --log <file>` checks the chain. `retro validate --gate-log` and `gates fired --log` derive `gates_fired` from it. Residual risk: a same-user forger can rewrite log and VERIFICATION.md together; the chain detects partial edits only.

Wave 2 settled these details (built as specified above):
- `prev` is the sha256 of the previous line's text without its newline. A torn last line gets a leading newline from the next writer, so one bad line never merges into the next record.
- The hook runs at process exit (`process.on('exit')`) because gate commands call `process.exit` themselves. A logging failure goes to stderr and never changes the gate's exit code. Verdict from exit code: 0 pass, 1 fail, anything else error. Retros use `pass|fail|not_applicable`, so `gates fired` and the retro cross-check read `error` as `fail`.
- `--phase` is stripped only when argv names a subcommand from an `invoke` cell; a flagged key (`product validate --spec-status`) also needs its flag in argv. A scope matches `[A-Za-z0-9_][A-Za-z0-9._-]{0,99}` without `..`; anything else exits 2 before the command runs.
- Outside a git work tree nothing is logged (stderr notice); the log is per work tree, found from the current directory.
- `gates lint --log <file>` checks only the log (registry rules do not run). `gates fired --log` prints the last verdict per gate id and `caught: true` when the log holds a `fail` line for it.
- Lock (deviation from the FR-010 wording): appends serialise on an atomic `mkdir` lock in the git common dir, not on `locks.cjs`. `acquireReservationsLock` creates the lock file first and writes its payload afterwards; a reader in that gap sees an empty lock, calls it stale and steals it, which forked the chain under load (measured: 12 broken links in the 2 x 50 writer test). The intent of FR-010 (serialised read-then-append) holds; the `locks.cjs` race is a separate bug.
- Intent children (spec 017 Q15, same detection as the sandbox guard): the hook strips `--phase` but appends no line and writes no `info/exclude` entry, whatever the exit code (77 included), because a child must not write outside its project. Headless intent runs therefore leave no gate log, and a retro written for such a run cannot pass `--gate-log`. No env switch exists for normal runs.
- `retro validate --gate-log` exits 2 when the log is missing, malformed or its chain is broken. `--enforced-since YYYY-MM-DD` overrides the constant for tests only.

### 4. Dispositions
A finding (fidelity finding, skip increase, accepted class-sweep match) is cleared only by an entry in the committed `.a1/dispositions.json`: `{kind: fidelity|skip_increase|class_sweep, fingerprint, reason, date, by, review}` with `review: pending` on creation. The executing agent records it with `disposition add`; no owner question. No check CLI has a `--skip` or `--ignore` flag. In a1-pr-review the Reinhard step reviews every disposition added or changed between base and head and records `disposition review <fingerprint> --verdict upheld|overturned --reason <text>`. `pr merge-check` exits 1 with `disposition_unreviewed` for a `pending` entry and `disposition_overturned` for an overturned one. The fingerprint is `rule + file + normalised line`.

### 5. `ENFORCED_SINCE`
One code constant in `_shared/lib/enforced-since.cjs` (the 017 release date, set in wave 14; until then a far-future date keeps every new rule dormant for old records). Retros dated before it skip the gate-log cross-check; bug files dated before it skip the `class_query` requirement. Legacy records are skipped, never rewritten.

### 6. Project config files (repo root `.a1/`)
- `.a1/verify.json`: `{commands: [{id, argv: [..], timeout_s, cwd?}], no_tests_reason?, flaky_base: [<test id>]}`. a1-specforge declares one command per `_test-fixtures/*/run*.sh` (glob expanded in node, argv `["bash", <suite>]`, no shell); the suite path is the test id. `flaky_base` is frozen: only the PR that creates the file may set the initial list; growth blocks the merge.
- `.a1/fidelity.json`: `{db_wrappers: [..], test_globs: [..], ci_globs: [..], ci?: {none: true, reason}}`. Each `ci_globs` entry must appear literally in a `run:` line of a workflow file. Defaults: `db_wrappers` = `withTenantContext`, `pool`, `db`, `query`; test globs `*.test.*`, `*.spec.*`, `test_*.py`, `*_test.py`.
- `.a1/dispositions.json`: see section 4.

### 7. Safety rules shared by all new subcommands
Child processes via argv arrays (`spawnSync(cmd, args, {shell: false})`), git output NUL-separated, every internal error exits 2 (never 0), gate log and VERIFICATION.md hold counts and exit codes only (any stored excerpt passes `intent-redact.cjs`), no new owner terminal step.

## Consequences
- A registered gate can no longer exist without a call in its owner skill, or a dated, visible exemption. The exemption date (2026-11-30) is a deadline for wave 13, not a permanent escape.
- `gate-0-self-report`, `gate-0.5-surface` and `gate-2-deploy` are reclassified to `prompt`: no CLI exists for them, and the registry stops claiming a deterministic check that never ran.
- `workflow-pipeline-exit`, `roadmap-gate`, `quick-escalation` and `phase-artifacts-exist` have no skill-side call yet; wave 13 wires, externalises or reclassifies each (spec FR-007 rule).
- The lint reads text, not behaviour: a fenced call that is never reached still counts. The gate log (wave 2) and `retro validate --gate-log` close that gap for retros.

## Results
(Wave 14 adds the measured results.)
