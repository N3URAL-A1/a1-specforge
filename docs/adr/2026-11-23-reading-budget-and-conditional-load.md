# ADR: Reading budget, conditional load and the machine retro

**Date:** 2026-11-23 (spec 027, slice 5) · **Status:** accepted · **Context:** Slices 1 to 4 of the lean pipeline cut waits and spawns. The remaining cost is reading: an a1-new-feature run loads about 2,560 lines of skill text before the first agent works, and a skill file that grows is never noticed. Slice 5 (FR-027 to FR-032) makes the size of that default reading path a measured, ratcheted number, moves rarely used text behind a trigger, and lets the close-out write prose only when a machine decision says so.

## Decision

### 1. Counting rule
The default path of a skill is `skills/<skill>/SKILL.md` plus every `skills/<skill>/workflows/*.md` (not recursive) whose first line is not a conditional header. Lines are newline characters (`wc -l`). `workflow budget` and `workflow lint` use the same module (`_shared/lib/workflow-lint-budget.cjs`), so the CLI and the lint cannot disagree. `skills/reading-budget.json` holds `{schema, rule, budgets}` with sorted keys. Permanent rule: `lines <= budget`. Equality on the merge head of a slice is a one-time condition recorded in STATUS.md, not a suite case, so a later PR that shortens a skill is not forced to edit the file.

### 2. Conditional header and reference rule (D3)
A workflow file that is read only on a trigger starts with `<!-- load: conditional trigger=<group> [<sub>] -->` and does not count in the default path. A line of a default-path file that names such a file must come after a line of the same Markdown section that contains `a1-tools.cjs <trigger>` (bash fence or inline code). Headings are detected outside fences only. Two conditional files with one basename are a finding. Prose that must name the file elsewhere uses the phase name instead. A malformed header is `conditional_header_malformed`.

### 3. Ratchet and its merge-step location (D8)
CI checks every skill against its budget (`workflow lint`), but the CI checkout has depth 1, so the ratchet cannot run there. It runs in `05-merge.md` 5.3: `workflow budget --base "$(git merge-base origin/<base> HEAD)"`. An entry that grew against the base needs a `budget-raise: <skill>` trailer in `<base>..HEAD`, else `budget_raised:<skill>`, exit 1. An unresolvable base, or a base budget file that is invalid, exits 2 (fail closed). A base without a budget file reports `base.budget == "absent"` and exits 0. A root without `skills/` or without `_shared/a1-tools.cjs` (every consumer repo) is out of scope: `scope: "out"`, exit 0, before any git call. The same scope test limits the budget check inside `workflow lint`, so fixture trees that copy `skills/` alone do not need headroom (D12a).

### 4. Forbidden-pattern rule and marker (D10)
`workflow lint` scans every line of every `skills/**/*.md` outside `skills/a1-worktree/` for `worktree add` and `--delete-branch`. A documented counter-example carries `<!-- lint-allow: forbidden-example -->` on the same line. The a1-worktree skill owns worktree creation and is exempt. Fixture corpora under `_test-fixtures/` are outside the scan.

### 5. Opt-in log and reader check (D9)
`PLAN-REVIEW-LOG.md` is written only with `A1_KEEP_REVIEW_LOGS=1`. The per-repair detail that the log used to hold goes to the observation line as `recovery` (always on, at most 8 compact items, no error text). Every other `*.last-run.json` file has a reader and stays on. `bin/check-optin-readers.cjs --name <file>` lists every reader of a file name in skills, agents and lib, minus the lines `optin-logs.cjs` allows, so a log that nothing reads is visible. Sync placement (D11) is checked by anchored call regexes over fenced lines: no vault sync or dashboard build per wave, one at phase end, one `cost run` in a closing file. `VAULT_SYNC_CALL_RE` is exported by `workflow-lint.cjs` and passed to the reading-path module, which fails closed (`A1_INPUT`) when it is missing.

### 6. Machine retro (D6, D7)
`feature close` derives `gates_fired` and `result` from the merged gate logs of every worktree scope except `retro-*` (the rule `run record` and `retro validate --gate-log` already use) and appends one machine entry per PR to the learning store, idempotent by `machine_record: <spec-id>#<n>`. It does this before the worktree exit and fails closed: a refused write path stops the close. Prose is required only when a gate caught something, the result is not `pass`, or the caller names issue tags. `feature close --check-only` prints that decision as `retro.prose_required` and `retro.reasons`; `05-merge.md` close-out item 1 runs it (block T) and writes the prose retro (`retro-prose.md`) only on `true`. a1-pr-review writes no retro of its own when a caller handed over a spec id. The slice 4 close rules stay as they were: ancestry check before a branch delete, compare-and-swap on the tip, `A1_GH_BIN` distrust.

## Consequences
- A skill cannot grow silently: lint fails above the budget, the merge step fails on a raise without a trailer.
- A ratchet compares entries, not sizes. A PR that shortens a skill without lowering its entry leaves slack that a later PR can use. This is what "a later change may lower an entry" permits; a `budget_slack` warning is the cheap alternative if the owner wants the tighter lock.
- `workflow-lint.cjs` stays the single place that composes the rules; the new rules live in `workflow-lint-budget.cjs`, `workflow-lint-read.cjs` and `workflow-budget.cjs`.
