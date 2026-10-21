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
Exit 0 all wired / 1 at least one finding / 2 usage, unknown flag, hostile value, unreadable registry. Rules: `no_invoke_column`, `malformed_row`, `invoke_invalid`, `blocking_unwired` (deterministic + blocking with `none`), `prompt_names_command`, `duplicate_subcommand`, `unknown_skill`, `unwired`, `exemption_expired`, `call_without_phase` (review round C: a skill that wires `retro validate --gate-log` must pass `--phase <scope>` on every call of a named gate, otherwise the line lands in `_unscoped` and the retro misses it). A skill is wired for a gate only when a fenced `bash` block in `skills/<skill>/SKILL.md` or `skills/<skill>/workflows/*.md` holds `a1-tools.cjs <subcommand>` (continuation lines joined; comment, `echo` and `printf` lines do not count; word boundary after the last word). Prose never counts. Calls from skills the cell does not name are allowed. Fenced-bash extraction is imported from `workflow-lint.cjs`. A live exemption suppresses `blocking_unwired` and `unwired` for its row. CI runs the command as its own step.

### 3. Gate log (built in wave 2; contract fixed here)
One JSON line per invocation of a subcommand named in an `invoke` cell, appended to `.a1/phases/<scope>/gate-log.jsonl`. Fields: `ts` (UTC ISO), `gate` (registry row whose `invoke` names the subcommand, resolved via `gate-ids.cjs`), `verdict`, `exit`, `head_sha`, `scope`, `prev` (sha256 of the previous line's bytes; first line 64 zeros). `<scope>` comes from `--phase <scope>` at every call site: a1-execute the phase name, a1-new-feature the spec id, a1-fix `fix-<bug-slug>`, a1-pr-review `pr-<number>`. No flag: `.a1/phases/_unscoped/gate-log.jsonl` plus one stderr notice.

A generic hook in the facade appends the line after the subcommand returns, so existing gates log without per-module edits. Nested calls are in-process function calls (`verify run` inside `pr merge-check`) and never append. Appends run under an atomic `mkdir` lock in the git common dir (not `locks.cjs`, see the lock deviation below) with one `O_APPEND` write per record (the chain needs read-then-append; `O_APPEND` alone lets two writers chain to the same predecessor). The log is never committed: `.gitignore` lists `.a1/phases/*/gate-log.jsonl`, and the first write in any repo adds the same pattern to `<git-common-dir>/info/exclude` (idempotent). `gates lint --log <file>` checks the chain. `retro validate --gate-log` and `gates fired --log` derive `gates_fired` from it. Residual risk: a same-user forger can rewrite log and VERIFICATION.md together; the chain detects partial edits only.

Wave 2 settled these details (built as specified above):
- `prev` is the sha256 of the previous line's text without its newline. A torn last line gets a leading newline from the next writer, so one bad line never merges into the next record.
- The hook runs at process exit (`process.on('exit')`) because gate commands call `process.exit` themselves. A logging failure goes to stderr and never changes the gate's exit code. Verdict from exit code: 0 pass, 1 fail, anything else error. Retros use `pass|fail|not_applicable`, so `gates fired` and the retro cross-check read `error` as `fail`.
- `--phase` is stripped only when argv names a subcommand from an `invoke` cell; a flagged key (`product validate --spec-status`) also needs its flag in argv. A scope matches `[A-Za-z0-9_][A-Za-z0-9._-]{0,99}` without `..`; anything else exits 2 before the command runs.
- Outside a git work tree nothing is logged (stderr notice); the log is per work tree, found from the directory `--project <dir>` names when the call passes it (a directory that exists), else from the current directory; `head_sha` is that work tree's HEAD (spec 017 review m2).
- Before the append the hook checks that `.a1`, `.a1/phases` and `.a1/phases/<scope>` (where they exist) resolve inside the work tree, that none is a dangling symlink and that the log file is not a symlink; otherwise it writes nothing and reports the refusal on stderr, the gate exit code unchanged (SEC-8). The file is opened with `O_NOFOLLOW`.
- The lock directory holds an `owner` file with `pid:nonce`. A lock older than 30 s is stolen by renaming it aside; after the rename the moved directory must still carry the owner token read when it was judged stale and still be old, else it is put back (SEC-7). A release removes only a lock whose token is the holder's. The `info/exclude` edit runs inside the lock.
- `gates lint --log <file>` checks only the log (registry rules do not run). `gates fired --log` prints the last verdict per gate id and `caught: true` when the log holds a `fail` line for it.
- Lock (deviation from the FR-010 wording): appends serialise on an atomic `mkdir` lock in the git common dir, not on `locks.cjs`. `acquireReservationsLock` creates the lock file first and writes its payload afterwards; a reader in that gap sees an empty lock, calls it stale and steals it, which forked the chain under load (measured: 12 broken links in the 2 x 50 writer test). The intent of FR-010 (serialised read-then-append) holds; the `locks.cjs` race is a separate bug.
- Intent children (spec 017 Q20, same detection as the sandbox guard): the hook strips `--phase` but appends no line and writes no `info/exclude` entry, whatever the exit code (77 included), because a child must not write outside its project. Headless intent runs therefore leave no gate log, and a retro written for such a run cannot pass `--gate-log`. No env switch exists for normal runs.
- `retro validate --gate-log` exits 2 when the log is missing, malformed or its chain is broken. `--enforced-since YYYY-MM-DD` overrides the constant for tests only.

### 4. Dispositions
A finding (fidelity finding, skip increase, accepted class-sweep match) is cleared only by an entry in the committed `.a1/dispositions.json`: `{kind: fidelity|skip_increase|class_sweep, fingerprint, reason, date, by, review}` with `review: pending` on creation. The executing agent records it with `disposition add`; no owner question. No check CLI has a `--skip` or `--ignore` flag. In a1-pr-review the Reinhard step reviews every disposition added or changed between base and head and records `disposition review <fingerprint> --verdict upheld|overturned --reason <text>`. `pr merge-check` exits 1 with `disposition_unreviewed` for a `pending` entry and `disposition_overturned` for an overturned one. The fingerprint is `rule + file + normalised line`.

### 5. `ENFORCED_SINCE`
One code constant in `_shared/lib/enforced-since.cjs` (the 017 release date, set in wave 14; until then a far-future date keeps every new rule dormant for old records). Retros dated before it skip the gate-log cross-check; bug files dated before it skip the `class_query` requirement. Legacy records are skipped, never rewritten.

### 6. Project config files (repo root `.a1/`)
- `.a1/verify.json`: `{commands?: [{id, argv: [..], reporter?, timeout_ms?}], each?: <glob>, argv_prefix?: [..], timeout_ms?, requires_env?: [..], no_tests_reason?, flaky_base: [<test id>]}`. There is no `cwd` and no `timeout_s`: commands run in the project root, and timeouts are milliseconds (default 15 minutes, per command or file-wide). a1-specforge declares `each: "_test-fixtures/*/run*.sh"` with `argv_prefix: ["bash"]` (glob expanded in node, no shell); the suite path is the test id. `flaky_base` is frozen: only the PR that creates the file may set the initial list; growth blocks the merge. With `--base` the command set comes from the merge-base's file, not from the head's (SEC-2); a head file that differs from the base file in anything but a shorter `flaky_base` makes `verify run` exit 1 with `verify_config_changed`, unless a committed, non-overturned `config_change` disposition names exactly that head content.
- `.a1/fidelity.json`: `{db_wrappers: [..], test_globs: [..], ci_globs: [..], ci?: "none", ci_reason?: <text>}` (`ci: "none"` needs a non-empty `ci_reason`). Each `ci_globs` entry must appear literally in a `run:` line of a workflow file. Defaults: `db_wrappers` = `withTenantContext`, `pool`, `db`, `query`; test globs `*.test.*`, `*.spec.*`, `test_*.py`, `*_test.py`.
- `.a1/dispositions.json`: see section 4.
- **Owner-side execution and residual risk (Q24, review round C)**: `verify run` and `fix class-sweep` run owner-side after an intent child ends, never inside the child (the child's spawn guard refuses them, exit 77). The workflows say so: when `A1_INTENT_CHILD=1`, gate 1 is skipped with the note "verify deferred to owner"; the owner runs `verify run` before any merge, and `pr merge-check` enforces it anyway (it runs the suites itself with `--no-cache`, because the head cache file is forgeable by the branch author; the intent child also gets Edit/Write deny rules for `.a1/verify-cache/**`). `fidelity_config_changed` and `verify_config_changed` clear only through an upheld `config_change` disposition reviewed by someone other than its author; no flag exists. **SEC-9 (residual, accepted)**: the base snapshot (`git archive` of the merge-base) links the head checkout's `node_modules`, and the suites run with the owner's full environment. A PR can therefore run code as the owner during `pr merge-check`. Use the merge check on trusted PRs only (own branches, reviewed contributors); an untrusted PR needs a container or a separate account, which this spec does not provide.

### 7. Safety rules shared by all new subcommands
Child processes via argv arrays (`spawnSync(cmd, args, {shell: false})`), git output NUL-separated, every internal error exits 2 (never 0), gate log and VERIFICATION.md hold counts and exit codes only (any stored excerpt passes `intent-redact.cjs`), no new owner terminal step.

## Consequences
- A registered gate can no longer exist without a call in its owner skill, or a dated, visible exemption. The exemption date (2026-11-30) is a deadline for wave 13, not a permanent escape.
- `gate-0-self-report`, `gate-0.5-surface` and `gate-2-deploy` are reclassified to `prompt`: no CLI exists for them, and the registry stops claiming a deterministic check that never ran.
- `workflow-pipeline-exit`, `roadmap-gate`, `quick-escalation` and `phase-artifacts-exist` have no skill-side call yet; wave 13 wires, externalises or reclassifies each (spec FR-007 rule).
- The lint reads text, not behaviour: a fenced call that is never reached still counts. The gate log (wave 2) and `retro validate --gate-log` close that gap for retros.

## Results

Measured at wave 14 (2026-10-21, branch `feature/017-enforced-self-checks`).

### Registry (`gates lint`)
| | main (before 017) | after wave 13 |
|---|---|---|
| gate rows | 44 | 47 (+`test-fidelity`, `fix-class-sweep`, `pr-merge-check`) |
| class `deterministic` | 27 | 24 |
| class `prompt` | 10 | 16 |
| class `human` | 7 | 7 |
| live `unwired_until` exemptions | 0 (column did not exist) | 0 (11 after wave 1, 0 after wave 13) |

Six rows were reclassified from `deterministic` to `prompt` because no CLI exists for them: `gate-0-self-report`, `gate-0.5-surface`, `gate-2-deploy` (wave 1), `phase-artifacts-exist`, `quick-escalation`, `roadmap-gate` (wave 13). `workflow-pipeline-exit` got its call (`workflow lint` in a1-pr-review); `gate-0.6-schema`, `gate-0.7-realpath`, `gate-1-build` and `spec-roadmap-status-coherent` got theirs in waves 11 to 13. `gates lint` exits 0 with `exemptions: []`. The 2026-11-30 deadline was never needed.

### Implementation decisions taken during the build
- **Q20 (wave 2)**: intent children append no gate-log line and write no `info/exclude` (same class as the nested-call exception); suites that compare stderr pass `--phase`; the log lock is an atomic `mkdir` (see section 3).
- **Q21 (wave 4)**: the corrected claudia test still wraps `withTenantContext` in a pass-through mock and calls `ctx.skip()`. The `mock-of-subject` flag is a true positive and stays; SC-005 reads as exit 0 on the corrected quote test, exit 1 on the claudia test until a reviewed wave 8 disposition records the reason. The fixture asserts both states.
- **Q22 (wave 7)**: `test_globs` for this repo narrowed to the entry points `_test-fixtures/*/run*.sh` (sub-scripts run through them); the four fixture-data `real/*.test.ts` files stay flagged and carry reviewed dispositions (review pending until the PR review).
- **Q23 (wave 13/14, intent sandbox)**: the wired commands were in neither `INTENT_CHILD_ALLOWLIST` nor `INTENT_CHILD_EXCLUSIONS` (`a1-intent` 5b-H7a and 5b-H7c red). Allowed: `verify run`, `verify check`, `test-fidelity` for new-feature, continue-feature and execute; `realpath-check run` and `schema-check run` for execute; `realpath-check run`, `test-fidelity` and `fix class-sweep` for fix. Excluded for every action that runs a skill: `disposition add` and `disposition review` ("an autonomous child must not clear its own findings"). `test-fidelity` has no subcommand, so the guard keys a flag-only group (`INTENT_FLAG_ONLY_GROUPS`) by the group name and validates the option-shaped word like any other argument (`--diff-base` still needs a revision).
- **Open edge of Q23**: `verify run` starts the project's test command and `fix class-sweep` starts `grep -E`. The child's spawn guard (FR-048) refuses every program except git with exit 77. Both commands are therefore allowed but refused at the spawn in a child (measured: 5b-P in-variant exit 77, nothing written). That fails closed: a child cannot produce a green `verify_run`. A spawn policy for these two is a separate decision.
- **`ENFORCED_SINCE`** is `2026-10-21`. Fixtures that need another day copy `_shared/` and replace the constant line.

### Defects the new checks found while they were being built
- **Wave 12**: the wave 10 `05-merge.md` passed `--phase` to `disposition review`, which takes none (exit 2). The wave 10 test had asserted the text of the line, not the flag. Fixed in wave 13.
- **Wave 13 call-site sweep** (`check-callsite-flags.cjs`: every fenced `a1-tools` call, 216 calls, flags compared with the command's own help): 7 real hits. `05-merge.md` `disposition review --phase`; `verify check --phase` in three workflows; `code-scope check --phase` in the a1-fix preflight; `product init`, `product feature-init` and `add-*` called with flags the command silently ignored; a call to a non-existent `consistency-check` subcommand. All fixed; the sweep stays in `a1-gates-lint` so a new call site is checked.
- **Wave 2**: `locks.cjs` creates the lock file before writing its payload, so a reader saw an empty lock and stole it (12 broken chain links in the 2 x 50 writer test). The gate log uses its own `mkdir` lock; the `locks.cjs` race is filed as a separate bug.
- **Wave 3/6**: a timeout kill left grandchildren running; `verify run` now kills the process group (wave 6).
- **Wave 4/7**: the JS and Python skip rules ran on files of the other language; gated by language in wave 7.
- **Wave 14**: the `test-fidelity` help listed three rules and omitted `test-not-in-ci`, `no_ci_config`, `ci_glob_not_in_workflow` and `--phase`; corrected from the code.

### Audit (FR-040, FR-041)
Each new subcommand has its own suite with green, red-per-rule, mutation-proof and hostile-input cases (`a1-gates-lint`, `a1-verify`, `a1-test-fidelity`, `a1-disposition`, `a1-fix-class-sweep`, `a1-pr-merge-check`). The wave 14 suite `a1-exit2-audit` adds one internal-error case per subcommand (a directory in place of the file it reads, or a failing `gh`), the help-lists-it check, and a count assert that no "not implemented" stub path remains.
