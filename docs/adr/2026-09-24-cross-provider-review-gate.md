# ADR: Cross-provider review gate — Codex as a read-only plan and wave reviewer

**Date:** 2026-09-24 · **Status:** accepted; §6 Live smoke recorded 2026-10-03, gates `blocking` · **Context:** On 2026-09-03 Robert decided (vault `record/2026-09-03-ai-harness-option-d.md`) that OpenAI Codex sits in the a1 pipeline as a read-only counter-reviewer: mandatory on `PLAN.md` after Adam's audit, mandatory on every wave diff before Victor. The architecture analysis of 2026-09-24 (`analyses/2026-09-24-architecture.md`) measured that nothing of this existed in the repo — no registry row, no adapter, no attribution slot (F-016, F-017, F-018) — and that the reviewer was not actually read-only: the global `~/.codex/config.toml` enables the `node_repl` MCP server and the claudex-loop runner forces `approval_policy="never"` per call, so a prompt-injected reviewer had an unattended code-execution path with the user's privileges (F-049, BLOCKER; plus F-050, F-051, F-052, F-057). F-049 was mitigated the same day outside the repo (`record/2026-09-24-codex-review-home-gehaertet.md`). Spec `009-cross-provider-review-gate` turns the decision into two gates and an adapter; this ADR records the architectural decisions the spec fixed in its Clarifications of 2026-09-24. It is not itself evidence of integration: the gate exists exactly to the extent that the registry rows `plan-review-xprov` and `wave-inspect-xprov` in `_shared/gates-registry.md` say so — both `blocking` since the Wave 7 flip (FR-005, §6).

## Decision

### 1. Runner-only use
a1 uses the claudex-loop `runner.py` in modes `review`, `inspect` and `check` and nothing else of the plugin. `a1-tools xprov run` invokes it with a fixed argv (`--host claude --repo <snapshot> --plan <absolute PLAN.md> --artifacts <0700 dir> --timeout <s>`, plus `--base` for inspect, `--feedback` for a plan-review round ≥ 2 — never `--resume`, see §6 *Round 2*); no extra flags, never the runner's default root `PLAN.md`; a1 writes `PLAN-REVIEW-LOG.md` itself because the runner has no `--log` (FR-011). Findings are data: validated, rendered as a table, never auto-applied; any change goes through a1-fix or a1-new-feature with a user checkpoint (FR-019, closes F-051).

**No `--model`.** The runner uses the CLI default; pinned variants return HTTP 400 with the ChatGPT login and invariant 6 forbids model ids in skills. The record carries `model_requested: "CLI default (unresolved)"`.

**Model honesty (FR-013).** Every XREVIEW.md section and `index.json` entry records `model_requested` (the passed value or the literal above) and `model_observed` (only from a measured field of the runner record or a captured CLI event stream, otherwise the literal `unknown`). `model_observed` is never copied from `model_requested`. Runner 2.1.0 reports `observed_models: []` for Codex, so it stays `unknown` until a captured fixture shows a field; the parser follows the fixture, never precedes it (testing rule, class 3). No fallback model or provider on failure.

**Closes F-019.** claudex-loop's ADR-FORMAT writes `docs/adr/0001-<slug>.md`; a1 writes `docs/adr/YYYY-MM-DD-<slug>.md`. a1 never invokes the claudex-loop SKILL.md orchestration (Phase 0–3, ADR-FORMAT, CONTEXT-FORMAT) inside an a1 project (FR-024), so no second numbering scheme can arise. a1's convention stands; this directory is its single owner.

### 2. Dedicated CODEX_HOME
`xprov run` sets `CODEX_HOME` for the runner process to `codexHome()`: the value of `A1_XPROV_CODEX_HOME`, or `~/.codex-a1-review` when the variable is unset or empty (`_shared/lib/xprov.cjs`). `xprov init-home` writes the compliant `config.toml` — `sandbox_mode = "read-only"`, `approval_policy = "on-request"`, `cli_auth_credentials_store = "file"` (Wave 7), and `[features]` with `plugins = false` / `remote_plugin = false` plus (Wave 7) six more pins, `apps`, `browser_use`, `computer_use`, `hooks`, `skill_mcp_dependency_install` and `memories`, all `false` — and links `auth.json` (0600) to `~/.codex/auth.json`, so one login exists to rotate. The `[features]` switch is the measured control, not a guess: during the fixture capture runs on 2026-09-24 Codex installed two remote plugins on its own into `plugins/cache/openai-curated-remote/` although the config had no `[plugins.*]` table; `codex features disable plugins remote_plugin` (codex-cli 0.155.1) writes exactly that table and stops the auto-install (`_shared/lib/xprov-preflight.cjs` header).

`xprov preflight` runs 22 checks, reports all of them and exits 1 on any FAIL, before any runner call (FR-014): `codex_home_is_global` (realpath comparison with `~/.codex`, never a string compare), `home_exists`, `config_exists`, `config_is_symlink` (must be a regular file), `home_mode_0700`, `sandbox_read_only`, `auth_store_file` (Wave 7: `cli_auth_credentials_store = "file"`, so the credentials stay in the auth.json symlink, never in a keyring), `mcp_servers_absent`, `plugins_disabled`, `remote_plugin_switch`, `features_pinned_off` (Wave 7: `apps`, `browser_use`, `computer_use`, `hooks`, `skill_mcp_dependency_install`, `memories` all `false`), `unexpected_config_key`, `plugins_cache_empty` (including the remote-install staging dir; a symlinked entry counts), `skills_system_only` (Wave 7: `skills/` holds only `.system` — `skills/<x>` is a user skill root), `skills_real_dirs` (Wave 7: `skills/` and `skills/.system` are real directories of the caller, checked with `lstat`, never a symlink), `home_no_symlinks` (Wave 7: an lstat walk over every directory of the home, runtime dirs included; the only accepted links are the top-level `auth.json` and Codex's own shims `tmp/arg0/codex-arg0<random>/…` whose realpath is the codex binary — measured: the native `vendor/<triple>/bin/codex` of the npm package), `session_tools_exec_only` (newest session log; only `exec`/`shell`/`local_shell` may appear — and, since `e699933`, `wait` narrowly: a function_call named exactly `wait` whose arguments are `cell_id` (a string naming a cell an earlier `exec` in the same log reported as running), `yield_time_ms` (0 < x ≤ the runner timeout in ms) and, as measured live, an optional `max_tokens` (0 < x ≤ 100000), nothing else; `write_stdin` stays disallowed; `xprov-session-tools.cjs`), `etc_codex_absent` (Wave 7: no `/etc/codex/{config,requirements}.toml`), `auth_present` (exit reason `not_logged_in`), `runner_pin`, `python_version`, `codex_cli`. The config is checked against an allowlist, not a denylist: tables `''` and `features`, keys `sandbox_mode`, `approval_policy`, `model`, `model_reasoning_effort`, `cli_auth_credentials_store`, and the eight `features.*` pins (`plugins`, `remote_plugin` and the six above); anything else, including inline or dotted `mcp_servers` shapes, fails. `init-home --pin-features` adds missing pins to an existing home, additively.

**Built-in skills reset (Wave 7, Samuel m7).** `skills/.system` is a skill root Codex trusts as long as its marker file survives. Measured on a copy of the home with the network blocked (`codex debug prompt-input` only, the real home byte-identical by manifest): a canary skill planted next to an intact marker was loaded (m1); with `skills/.system` deleted (m2) or only its marker deleted (m3) Codex re-extracted the built-ins, identical by path, size and sha256, and the canary was gone. So `xprov run` deletes `skills/.system` right before every spawn, after refusing with `fail/preflight_failed` when the home holds a symlink or `skills` / `skills/.system` is not a real own directory.

**Tripwire (FR-015).** Read-only is verified, not trusted. Before the spawn `xprov run` writes a baseline into a `mktemp` file: `git status --porcelain --untracked-files=all` of the primary checkout, `$WORK_PATH` and the snapshot; the `.git` metadata a hostile reviewer could plant — `config`, `hooks/*`, `info/*` from the common git dir, and the `core.hooksPath` target — for checkout and `$WORK_PATH`; and every file of the dedicated home except Codex's runtime dirs and files (`sessions/`, `cache/`, `plugins/`, `*.sqlite`, `history.jsonl`, …), because a planted `AGENTS.md` there would be a persistent prompt injection for every future review. Under `skills/` only `.system` counts as runtime; anything else there is hashed. The runner's child environment is an allowlist (`PATH`, `TMPDIR`, `LANG`, `LC_*`, `TERM`, `USER`, `SHELL`) plus `CODEX_HOME` and `GIT_CONFIG_NOSYSTEM=1`. `HOME` is never the caller's: it is a fresh per-run directory `~/.a1-xprov/run-home-*` (0700, verified empty before the spawn, removed after the run); what the run left there is listed by name and size as an XREVIEW note. Any delta after the run is `fail/tripwire`: result discarded, snapshot delta reverted, BLOCKER note in XREVIEW.md, checkout and worktree untouched (closes F-049 and the read-only half of F-018). Evidence bar as in the vault record: the home's session log shows `exec` as the only tool and `codex mcp list` prints no servers.

### 3. Snapshot, not checkout
The runner never sees the live checkout. `xprov snapshot` builds the review target as a fresh, depth-limited repository in `mktemp -d` under the 0700 parent `~/.a1-xprov/snapshots/`: `git init` + `git fetch --depth 1 <source checkout> <commit>` + `git checkout FETCH_HEAD`, argv arrays, never a shell. A plan review fetches HEAD only; an inspect additionally fetches `<base>` with `--depth 1` (Wave 7, replacing the earlier `rev-list --count <base>..<commit>` + 1), so the runner's `--base` diff resolves inside the snapshot while no commit between base and head — and no secret from an earlier commit — is in its object store. Only tracked files exist in the clone — no untracked or ignored file, no worktree gitdir, no alternates — and it is removed after `normalize`; never a worktree, shared-object clone or directory copy (FR-016, hardened 2026-09-24). After checkout the repo-local Codex inputs `.codex/` (including hooks), `AGENTS.md`, `AGENTS.override.md` and (Wave 7) `.agents/` are removed from the snapshot's working tree and their presence is logged in XREVIEW.md, because Codex reads `AGENTS.md` from its cwd as instructions and the reviewed repo must not steer its own reviewer. Before dispatch every `git ls-files` entry is scanned with the shared secret-pattern list, nothing skipped: latin1 decoding for binary or NUL content, 5 MB windows with a 512-byte overlap, UTF-16LE/BE decoding on a BOM or alternating NULs, symlinks by their link text; a tracked path missing from the working tree (a stripped file) is scanned as its `HEAD:<path>` blob, because the reviewer can still read it from the object store; `files_skipped` must be 0. Wave 7 extends the scan to everything that leaves (see §6 and the `xprov-snapshot.cjs` header): the base-side blobs of every path the outbound diff touches, the PLAN.md and dispositions copies the runner receives, every outbound path name (never allowlisted, never echoed), plus a diff hash compared with the runner's `snapshot.diff_sha256`. `gitleaks detect --no-git` runs additionally when on PATH, with a1's own config, never the reviewed repo's. Any hit removes the snapshot and reports `fail/secret_in_snapshot` with the pattern name only (FR-017); runner output is filtered with the same list (`fail/secret_in_output`, no findings file, FR-018). Sending a repo to OpenAI needs a recorded permission via `xprov permit`: N3URAL repos by Robert, customer repos only with an a1-ludwig-legal record (FR-021, closes F-050). Artifacts live in a 0700 directory, `xprov gc` deletes runs older than 14 days, nothing is committed or synced to the vault (F-057).

### 4. Fail-closed mapping
The mapping is total and only one path yields `pass`: `status != "completed"` → `fail/runner_failed`; missing, empty or non-object file → `fail/malformed`; `mode` ∉ {`review`, `inspect`} → `fail/wrong_mode`; `APPROVED` → `pass`; `REVISE` → `fail-with-findings`; `BLOCKED` → `fail/blocked` (limitations verbatim); anything else → `fail/malformed` (FR-009). `pass` also requires the PLAN.md sha to equal `result.json.plan_sha256` (FR-010), a clean output filter and validated finding paths. Findings land in the Reinhard schema `{summary, blocker[], major[], minor[]}` (FR-008, FR-012; closes F-017). Provider outage is a `fail` that stops at the checkpoint — no retry beyond the runner timeout, no fallback. Caps: 2 plan-review rounds, 2 fix rounds per wave; a cap is a `fail`. The only way past a `fail` is a human waiver, which never yields `verdict: pass` and tags the retro `xprov_waived` (FR-006, FR-007). **Waiver (amended 2026-10-03, Samuel MAJOR).** `xprov waive … --reason <text> --by <name>` runs only behind the guards of the allowlist owner approval (`guardRefusal` of `xprov-approve.cjs`: TTY on stdin and stdout, no `CLAUDECODE`/`CLAUDE_PID`/`CLAUDE_CODE_*`, no Claude Code ancestor; else exit 2, nothing written) and the PreToolUse hook denies any Bash command containing it or the store path. It computes the key itself — realpath of the primary checkout's git-common-dir, phase, gate, sha256 of the raw PLAN.md; for a wave also lane, HEAD of `--work-path` (same git-common-dir) and the full base sha — shows it, wants the gate id typed back, and appends one record to `~/.a1-xprov/waivers.json` under the approval store's rules (lstat, 0700/0600, own uid, O_NOFOLLOW read, temp file + rename). load-check and wave-status accept a waiver only from that store and only for the key they compute; a `waived: true` row in `index.json` is a mirror without authority. A changed PLAN.md invalidates the waiver. Wave passes and wave waivers are bound alike and chained per lane (since `28dc4db`): base ⊑ head, head of wave N = base of the next completed wave, the last wave's head = the lane work path's HEAD; between two waves and after the last one only commits that write the files the workflows write there may sit — the phase's STATUS*.md, VERIFICATION.md, observations.jsonl, PLAN-REVIEW-LOG.md, XREVIEW.md, xreview/*.json|*.md and what `product stage` commits at the 2c checkpoint (docs/product ROADMAP.md, index.json, NEXT.md, CHANGELOG-archive.md, features/<id>/feature.md, .a1/reservations.json; measured: a1-execute commits it between a wave's inspection and the next PRE_WAVE_HEAD) — each as a regular file (`git diff --raw` mode 100644; a deletion — mode 000000 — is never exempt); a pass's head/base come only from `a1-reviewed.json`, which `xprov run` writes into its own run dir after a clean inspect, and a run dir is normalized once. **Rows are pointers (Reinhard M1, since the commit after `d1ce79c`):** load-check and wave-status read every fact from the run dir a row names — it must lie in this repository's artifacts dir (realpath, read with O_NOFOLLOW, `xprov-runrecord.cjs`): a plan pass counts only when its result.json is a completed APPROVED review of the current PLAN.md sha; a wave pass only when its result.json is a completed APPROVED inspect of that sha and its `a1-reviewed.json` agrees with the record — head/base come from there, never from the row. A hand-written row counts for nothing. **Residual:** a fully forged row plus a forged run dir inside the artifacts dir stays possible for a deliberate agent (same class as the HOME redirection below). **Lane consolidation (Reinhard M2):** a STATUS.md heading whose wave number a STATUS-<lane>.md also lists is the consolidation copy and is skipped, so a multi-lane phase passes 03-verify after consolidating; sequential waves keep their own numbers and still count. **Residual (Samuel MINOR 1, accepted, not built):** `X.xprovHome()` follows `$HOME`, so an agent that deliberately runs `HOME=/tmp/x … load-check` against a self-built 0700/0600 store gets a waiver counted, past the hook literal and the settings deny; the allowlist approval store has the same exposure. Under this threat model that is deliberate forgery — the guards, hook and deny stop accidental or helpful use, not a determined agent — and resolving the home through `os.userInfo()` would only be cosmetic. **Residuals, follow-ups (Samuel, recorded 2026-10-04):** MINOR 2 — `--lane-work-path` can be pointed at another checkout of the same repository sitting at an old head (deliberate; later take the lane tip from the lane branch ref); MINOR 3 — the wave list comes from the STATUS headings or `--waves`, not from the bound PLAN.md; MINOR b — zero-width and format characters are not stripped before the instruction-marker check; (The lane STATUS consolidation follow-up — Codex R1 of the final inspect below — is closed by Reinhard M2, see above.) **Residual — docs/product as Markdown (Samuel, 2026-10-04):** the exempt `docs/product/**/*.md` files are inert only while no MDX docs toolchain (Docusaurus v3, MkDocs plugins, Next.js Markdown pages) compiles them; a consumer repository must not put `docs/product` under an MDX docs root. **Watch item:** `product stage` must never delete or rename a listed file — such a change is not exempt and fails closed at the wave boundary; if it ever happens, add a measured delete exemption instead of widening the rule. a1-execute re-runs `load-check --expect-sha <sha accepted at Load>` before every wave (`plan_changed` on a mid-phase edit). Attribution: `xprov-codex` is the single allowed non-`a1-*` agent id (exception to invariant 5, owner `_shared/learning-schema.md`); retros carry `gates_fired` with the two registry ids so a1-evolve counts catches instead of discarding them (FR-025, FR-026).

### 5. Vendoring decision
`runner.py` is vendored at `_shared/vendor/claudex-loop/` with the MIT `LICENSE`, `VENDORED.md` (upstream, version 2.1.0, commit `8cf5e2c1771c5151d90c12642391d0ba8fa71b0e`, sha256, capture date, F-052 audit: stdlib only, no network, argv arrays, prompt via stdin) and a `SHA256SUMS` pin checked by `xprov preflight` and the fixture suite (FR-022, FR-023). a1 never resolves the runner from the plugin cache; a pin bump needs a `VENDORED.md` entry with the upstream diff summary in the same commit. Rejected: a fork into the N3URAL-A1 org — one file with a hash is cheaper than a second marketplace and equally removes the unreviewed-`plugin update` path (decided 2026-09-24).

### 6. Live smoke
Measured 2026-10-02 and 2026-10-03 on branch `feature/009-wave7-live-smoke` of this repository (base `2741abe`), codex-cli 0.155.1, vendored runner 2.1.0 (sha256 `962dfdfe…737c8c`), dedicated home `~/.codex-a1-review`, permission record `.a1/xprov.json` (Robert, record option D). Every run used `env -u A1_VAULT_ROOT -u A1_VAULT_WRITER_HOST -u A1_HOST_ID`. The final runs below are on HEAD `1638616` (the last code commit of the branch; the ADR commits after it are docs only); raw outputs are quoted in full under *Raw evidence* (only `$HOME` is shortened to `~`).

**Targets.** Spec 009 has no `PLAN.md` under `.a1/phases/` (its plan lives in the vault), and `xprov gate --phase X` resolves `<git toplevel>/.a1/phases/X/PLAN.md` — so the review runs on the real, committed phase `M13-residuals`. The inspect runs on a real wave of this repository that is NOT on `origin/main`: a wave already on the default branch is never allowlisted for wave-inspect (FR-030 b, `xprov-allowlist.cjs` resolveAnchor), so the target is Wave 7 itself, `2741abe..HEAD` of this branch.

**Preflight (SC-003), 2026-10-03 on `ae6c281`, re-run on `4abccf3`: 22/22 PASS.**
- `a1-tools xprov preflight` → exit 0, 22/22 PASS (including `features_pinned_off`, `auth_store_file`, `skills_system_only`, `skills_real_dirs`, `home_no_symlinks`, `etc_codex_absent`, `session_tools_exec_only: exec`).
- `A1_XPROV_CODEX_HOME=~/.codex a1-tools xprov preflight` → exit 1, `failed`: codex_home_is_global, auth_store_file, mcp_servers_absent (`table [mcp_servers.node_repl], table [mcp_servers.node_repl.env], table [mcp_servers.computer-use]`), plugins_disabled (9 enabled plugins), remote_plugin_switch, features_pinned_off, unexpected_config_key, plugins_cache_empty.

**Live review round 1 — final, HEAD `1638616`.** Command:
`a1-tools xprov gate --phase M13-residuals --gate plan-review-xprov`
- 15:44:14Z–15:45:59Z, exit 1. stdout (full JSON below): `verdict: fail-with-findings`, `step: normalize`, `enforcement: blocking`, `allowlisted_hits: 21`, `uncovered: []`.
- `result.json`: `status: completed`, `mode: review`, `previous: null`, session `01a10270-0298-…`. Four findings (R1 high, R2–R4 medium; `checklist.cjs` and `skills/a1-new-feature/workflows/04-plan.md`, all paths `<file>:<line>`), none quarantined; `a1-findings.json` in a1's run dir holds them, `quarantined: []`.
- Session log (`rollout-2026-10-03T17-44-17-01a10270-…jsonl`): `custom_tool_call:exec` ×5, no other tool, `"mcp` → 0, skill roots `r0 = ~/.codex-a1-review/skills/.system` only. Run-home `entries: 0`.

**Round 2 — a fresh session, never a resume (Samuel, Wave 7 MAJOR).** `codex exec resume <session>` replays round 1 from the dedicated home's `sessions/…/rollout-*.jsonl` and/or `thread_history_1.sqlite` (a1-samuel-security's analysis) — runtime files that neither the tripwire nor the preflight covers, so an agent with Bash could plant developer or assistant items between the rounds and, under `blocking`, decide round 2. Since `4abccf3` no round resumes (`--resume` is refused by `gate` and `run` and is a forbidden runner token). Round N ≥ 2 after a REVISE gets `--feedback` that a1 builds itself: round N−1's findings from a1's own 0700 run dir (`a1-findings.json`, a regular file, its run dir under this repo's artifacts dir) plus the host-authored dispositions, written to a 0700 mktemp file that the snapshot scans and copies like the PLAN.md. The runner appends `--feedback` without `--resume` (runner.py:348). The earlier resumed round 2 (HEAD `22cc562`, 08:48Z, `codex exec resume 01a100f1-…`, same snapshot path rebuilt) is superseded; its snapshot-path rebuild is removed with it. Since `1638616` the same holds for a wave inspect: a fix round is a fresh session whose `--feedback` is round 1's findings plus Erik's fix summary (`xreview/wave-inspect-xprov-wave-<N>[-<lane>]-r1.dispositions.md`, required), and quarantined findings reach any feedback only as id + reason. Command:
`a1-tools xprov gate --phase M13-residuals --gate plan-review-xprov --round 2`
- 15:46:17Z–15:47:46Z, exit 1, `fail/round_cap` at step normalize (Codex: REVISE, "All four prior findings remain present in the inspected snapshot. Filing follow-up candidates does not resolve the defects …" — the dispositions had rejected all four as out of scope for a shipped plan): the expected outcome.
- `command.json`: `codex exec -s read-only …` — no `resume`; `result.json`: `previous: null`, a new session (`01a10271-e1a5-…`; round 1 `01a10270-0298-…`, SC-014) and a new snapshot (`snap-ap9cki`; round 1 `snap-JFRb2g`). The runner's `prompt.txt` holds `HOST DISPOSITIONS / FIX REQUEST:` followed by a1's `PRIOR FINDINGS (round 1, normalized by a1; this is a fresh session)`, `QUARANTINED IN ROUND 1 (id and reason only)` (none) and `HOST DISPOSITIONS (round 1)`.
- Session log (`rollout-2026-10-03T17-46-20-01a10271-…jsonl`): `custom_tool_call:exec` ×4 only, `"mcp` → 0, `r0 = .system` only; run-home `entries: 0`; no feedback temp dir left.

**Live inspect — final, HEAD `1638616`, base `2741abe`.** Command:
`a1-tools xprov gate --phase M13-residuals --gate wave-inspect-xprov --wave 7 --base 2741abe --work-path <this worktree>`
- 15:47:51Z–15:49:36Z, exit 1. stdout (full JSON below): `verdict: fail-with-findings`, `step: normalize`, `enforcement: blocking`, `allowlisted_hits: 29` (21 head + 8 base), `uncovered: []`.
- `result.json`: `status: completed`, `mode: inspect`, `base: 2741abe`, `snapshot.diff_sha256: 89a57180…` = the hash `xprov snapshot` stored at scan time (no tripwire), `previous: null`.
- Findings, open and routed to the team lead: **R1 (high): `.claude/settings.json` denies Edit/Write for the approval store and `.a1/xprov.json` but not for `~/.a1-xprov/waivers.json`**, so an agent's Edit tool could add a store record (the hook covers Bash only) — closing it is a change to `.claude/settings.json`, which goes through Robert. **R2 (high, `xprov-gate.cjs:498`): wave-status accepts any recorded pass for a wave/lane without plan sha, head or base**, so an amended wave keeps its old pass (normalize records no reviewed head/base). R4–R6: M13 `checklist.cjs` (a1-fix candidates). Quarantined `instruction_shaped`: R3 (consolidated lane STATUS headings create a lane-null wave).
- Session log (`rollout-2026-10-03T17-47-55-01a10273-…jsonl`): `custom_tool_call:exec` ×4 only; `r0 = .system` only; `grep -c '"mcp'` → 12, all in the prompt (this wave's diff) or exec output — zero MCP tool calls. Run-home `entries: 0`.

**Live after Reinhard's M1/M2 — HEAD `b569484`.** load-check changed (plan passes need their run dir), so one plan review ran besides the inspect.
- Review round 1, 02:57:47Z–02:59:24Z, exit 1: `fail-with-findings` (4 M13 findings), `allowlisted_hits: 21`, session `01a104d8-b51b-…`, exec ×5 only, `r0 = .system` only, run-home 0.
- Inspect, 02:59:24Z–03:01:06Z, exit 1: `fail-with-findings`, `allowlisted_hits: 30`, `uncovered: []`, session `01a104da-3ae2-…`, exec ×3 only, run-home 0; `a1-reviewed.json` = {commit `b569484…`, base `2741abe4…`} = the index row's head/base.
- Both: primary checkout porcelain empty before and after, `~/.a1-xprov/snapshots/` unchanged.
- Findings: inspect **R1 (medium, `xprov-runrecord.cjs:43`): a pass now counts only while its run dir exists, but `xprov gc` (also called after every normalize) deletes run dirs older than 14 days** — a phase running longer than that loses its passes and fails closed at 03-verify (routed to the team lead). The rest: M13 `checklist.cjs` and `04-plan.md` (a1-fix candidates).

stdout of review round 1 on `b569484`:
```json
{
  "verdict": "fail-with-findings",
  "reason": null,
  "reason_detail": null,
  "step": "normalize",
  "gate": "plan-review-xprov",
  "phase": "M13-residuals",
  "wave": null,
  "lane": null,
  "round": 1,
  "mode": "review",
  "enforcement": "blocking",
  "findings_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json",
  "xreview_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/XREVIEW.md",
  "result_path": "~/.a1-xprov/artifacts/009-wave7-live-smoke/claudex-sb_2wkdx/result.json",
  "next": {
    "round_cmd": "node ~/claude-projects/a1-worktrees/009-wave7-live-smoke/_shared/a1-tools.cjs xprov gate --phase M13-residuals --gate plan-review-xprov --round 2",
    "dispositions_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md"
  },
  "allowlisted_hits": 21,
  "allowlist_anchor": "2741abe4c7d5a26e2f9d7c359e1ca55495f633d6",
  "allowlist_approved_blob": "d21e526d3448512f59c3593c4b6df8186c8bcd46963708094e7008599d762479",
  "allowlist_stale": [],
  "allowlisted": [
    {"path": ".a1/phases/M7-oss-ready/MAP.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M7-oss-ready/RESEARCH.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M9-robustness/RESEARCH.md", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "doc_example"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern"},
    {"path": "_test-fixtures/a1-vault-cockpit/parts/05-hosts.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/02-normalize.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "github_pat_fine_grained", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "bearer_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake"}
  ],
  "uncovered": [],
  "allowlist_note": null,
  "run_porcelain": {
    "checkout": {
      "before": "?? .a1/phases/M13-residuals/XREVIEW.md\n",
      "after": "?? .a1/phases/M13-residuals/XREVIEW.md\n"
    },
    "snapshot": {
      "before": "",
      "after": ""
    },
    "work": {
      "before": null,
      "after": null
    }
  }
}
```

stdout of the inspect on `b569484`:
```json
{
  "verdict": "fail-with-findings",
  "reason": null,
  "reason_detail": null,
  "step": "normalize",
  "gate": "wave-inspect-xprov",
  "phase": "M13-residuals",
  "wave": 7,
  "lane": null,
  "round": 1,
  "mode": "inspect",
  "enforcement": "blocking",
  "findings_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/wave-inspect-xprov-wave-7-r1.findings.json",
  "xreview_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/XREVIEW.md",
  "result_path": "~/.a1-xprov/artifacts/009-wave7-live-smoke/claudex-7t_62dw2/result.json",
  "next": {
    "fix_round": 1,
    "dispositions_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/wave-inspect-xprov-wave-7-r1.dispositions.md"
  },
  "allowlisted_hits": 30,
  "allowlist_anchor": "2741abe4c7d5a26e2f9d7c359e1ca55495f633d6",
  "allowlist_approved_blob": "d21e526d3448512f59c3593c4b6df8186c8bcd46963708094e7008599d762479",
  "allowlist_stale": [],
  "allowlisted": [
    {"path": ".a1/phases/M7-oss-ready/MAP.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M7-oss-ready/RESEARCH.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M9-robustness/RESEARCH.md", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "doc_example"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern"},
    {"path": "_test-fixtures/a1-vault-cockpit/parts/05-hosts.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/02-normalize.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "github_pat_fine_grained", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "bearer_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/02-normalize.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake", "side": "base"}
  ],
  "uncovered": [],
  "allowlist_note": null,
  "run_porcelain": {
    "checkout": {
      "before": " M .a1/phases/M13-residuals/observations.jsonl\n?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md\n?? .a1/phases/M13-residuals/XREVIEW.md\n?? .a1/phases/M13-residuals/xreview/index.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json\n",
      "after": " M .a1/phases/M13-residuals/observations.jsonl\n?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md\n?? .a1/phases/M13-residuals/XREVIEW.md\n?? .a1/phases/M13-residuals/xreview/index.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json\n"
    },
    "snapshot": {
      "before": "",
      "after": ""
    },
    "work": {
      "before": null,
      "after": null
    }
  }
}
```

**Final live reviews — HEAD `5f724a9` (code = `2e72315`).** The team lead asked for the reviews on the final code too, since `98db221` touched normalize for both paths.
- The real round-2 log of `28dc4db` (`rollout-2026-10-03T22-28-54-01a10374-…jsonl`, exec + two `wait`) judged by the narrow rule: `{"names":["exec","wait"],"disallowed":[]}` — the positive case on the real file; the preflight keeps reading only the newest session log.
- Review round 1, 00:16:51Z–00:17:56Z, exit 1: `fail-with-findings` (3 M13 findings), `allowlisted_hits: 21`, session `01a10445-7013-…`, `previous: null`, exec ×4 only, zero MCP tool calls, `r0 = .system` only, run-home 0.
- Review round 2, 00:17:57Z–00:19:12Z, exit 1: `fail/round_cap` — fresh session `01a10446-6b55-…`, new snapshot, `previous: null`, no `resume`, prompt with a1's sha-bound round-1 findings, QUARANTINED block and dispositions; exec ×4 only, run-home 0.
- Both: primary checkout porcelain empty before and after, `~/.a1-xprov/snapshots/` unchanged.

stdout of review round 1 on `5f724a9`:
```json
{
  "verdict": "fail-with-findings",
  "reason": null,
  "reason_detail": null,
  "step": "normalize",
  "gate": "plan-review-xprov",
  "phase": "M13-residuals",
  "wave": null,
  "lane": null,
  "round": 1,
  "mode": "review",
  "enforcement": "blocking",
  "findings_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json",
  "xreview_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/XREVIEW.md",
  "result_path": "~/.a1-xprov/artifacts/009-wave7-live-smoke/claudex-mvbx01qa/result.json",
  "next": {
    "round_cmd": "node ~/claude-projects/a1-worktrees/009-wave7-live-smoke/_shared/a1-tools.cjs xprov gate --phase M13-residuals --gate plan-review-xprov --round 2",
    "dispositions_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md"
  },
  "allowlisted_hits": 21,
  "allowlist_anchor": "2741abe4c7d5a26e2f9d7c359e1ca55495f633d6",
  "allowlist_approved_blob": "d21e526d3448512f59c3593c4b6df8186c8bcd46963708094e7008599d762479",
  "allowlist_stale": [],
  "allowlisted": [
    {"path": ".a1/phases/M7-oss-ready/MAP.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M7-oss-ready/RESEARCH.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M9-robustness/RESEARCH.md", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "doc_example"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern"},
    {"path": "_test-fixtures/a1-vault-cockpit/parts/05-hosts.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/02-normalize.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "github_pat_fine_grained", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "bearer_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake"}
  ],
  "uncovered": [],
  "allowlist_note": null,
  "run_porcelain": {
    "checkout": {
      "before": "?? .a1/phases/M13-residuals/XREVIEW.md\n",
      "after": "?? .a1/phases/M13-residuals/XREVIEW.md\n"
    },
    "snapshot": {
      "before": "",
      "after": ""
    },
    "work": {
      "before": null,
      "after": null
    }
  }
}
```

stdout of review round 2 on `5f724a9`:
```json
{
  "verdict": "fail",
  "reason": "round_cap",
  "reason_detail": "REVISE at round 2 = cap",
  "step": "normalize",
  "gate": "plan-review-xprov",
  "phase": "M13-residuals",
  "wave": null,
  "lane": null,
  "round": 2,
  "mode": "review",
  "enforcement": "blocking",
  "findings_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r2.findings.json",
  "xreview_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/XREVIEW.md",
  "result_path": "~/.a1-xprov/artifacts/009-wave7-live-smoke/claudex-yh9rw3ul/result.json",
  "next": null,
  "allowlisted_hits": 21,
  "allowlist_anchor": "2741abe4c7d5a26e2f9d7c359e1ca55495f633d6",
  "allowlist_approved_blob": "d21e526d3448512f59c3593c4b6df8186c8bcd46963708094e7008599d762479",
  "allowlist_stale": [],
  "allowlisted": [
    {"path": ".a1/phases/M7-oss-ready/MAP.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M7-oss-ready/RESEARCH.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M9-robustness/RESEARCH.md", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "doc_example"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern"},
    {"path": "_test-fixtures/a1-vault-cockpit/parts/05-hosts.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/02-normalize.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "github_pat_fine_grained", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "bearer_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake"}
  ],
  "uncovered": [],
  "allowlist_note": null,
  "run_porcelain": {
    "checkout": {
      "before": " M .a1/phases/M13-residuals/observations.jsonl\n?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md\n?? .a1/phases/M13-residuals/XREVIEW.md\n?? .a1/phases/M13-residuals/xreview/index.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json\n",
      "after": " M .a1/phases/M13-residuals/observations.jsonl\n?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md\n?? .a1/phases/M13-residuals/XREVIEW.md\n?? .a1/phases/M13-residuals/xreview/index.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json\n"
    },
    "snapshot": {
      "before": "",
      "after": ""
    },
    "work": {
      "before": null,
      "after": null
    }
  }
}
```

**Final live inspect — HEAD `2e72315`, base `2741abe`.** `2e72315` = `98db221` (record mode must match the gate; lanes first-class in `--waves`) + `e699933` (narrow `wait`) + the measured exemption list with mode 100644, also at wave boundaries. Reviews were not rerun: both ran on `28dc4db` (above), and the review path is unchanged since (`98db221` adds a refusal for a mismatched mode only). Preflight first: 22/22 PASS, `session_tools_exec_only: tools: exec, wait` — the live `wait` lines of the `28dc4db` round 2 now pass the narrow rule.
- 00:13:23Z–00:14:41Z, exit 1. stdout (full JSON below): `verdict: fail-with-findings`, `step: normalize`, `enforcement: blocking`, `allowlisted_hits: 30`, `uncovered: []`.
- `result.json`: `status: completed`, `mode: inspect`, `previous: null`, session `01a10442-3679-…`, `snapshot.diff_sha256: 155e45c3…`. The run dir holds `a1-reviewed.json` = {commit `2e72315b…`, base `2741abe4…`, diff `155e45c3…`}, written by `xprov run`, and the index entry carries exactly that head/base — the binding of MAJOR 1, live.
- Session log (`rollout-2026-10-04T02-13-30-01a10442-…jsonl`): `custom_tool_call:exec` ×3 only; `r0 = .system` only; `grep -c '"mcp'` → 14, prompt and exec output only — zero MCP tool calls. Run-home `entries: 0`.
- Porcelain: primary checkout empty before and after; `~/.a1-xprov/snapshots/` unchanged; snapshot porcelain empty. This worktree, after:
```
 M .a1/phases/M13-residuals/observations.jsonl
?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md
?? .a1/phases/M13-residuals/XREVIEW.md
?? .a1/phases/M13-residuals/xreview/index.json
?? .a1/phases/M13-residuals/xreview/wave-inspect-xprov-wave-7-r1.findings.json
```
- Findings: R1 (medium, `xprov-gate.cjs:469`): consolidated lane STATUS headings become lane-null pairs (the known follow-up, recorded under §4 residuals); R2–R4: M13 `checklist.cjs` (a1-fix candidates). Nothing on the chain, the run record, the waiver or the `wait` rule.

stdout of the final inspect on `2e72315`:
```json
{
  "verdict": "fail-with-findings",
  "reason": null,
  "reason_detail": null,
  "step": "normalize",
  "gate": "wave-inspect-xprov",
  "phase": "M13-residuals",
  "wave": 7,
  "lane": null,
  "round": 1,
  "mode": "inspect",
  "enforcement": "blocking",
  "findings_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/wave-inspect-xprov-wave-7-r1.findings.json",
  "xreview_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/XREVIEW.md",
  "result_path": "~/.a1-xprov/artifacts/009-wave7-live-smoke/claudex-oz6flvuk/result.json",
  "next": {
    "fix_round": 1,
    "dispositions_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/wave-inspect-xprov-wave-7-r1.dispositions.md"
  },
  "allowlisted_hits": 30,
  "allowlist_anchor": "2741abe4c7d5a26e2f9d7c359e1ca55495f633d6",
  "allowlist_approved_blob": "d21e526d3448512f59c3593c4b6df8186c8bcd46963708094e7008599d762479",
  "allowlist_stale": [],
  "allowlisted": [
    {"path": ".a1/phases/M7-oss-ready/MAP.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M7-oss-ready/RESEARCH.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M9-robustness/RESEARCH.md", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "doc_example"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern"},
    {"path": "_test-fixtures/a1-vault-cockpit/parts/05-hosts.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/02-normalize.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "github_pat_fine_grained", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "bearer_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/02-normalize.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake", "side": "base"}
  ],
  "uncovered": [],
  "allowlist_note": null,
  "run_porcelain": {
    "checkout": {
      "before": "?? .a1/phases/M13-residuals/XREVIEW.md\n",
      "after": "?? .a1/phases/M13-residuals/XREVIEW.md\n"
    },
    "snapshot": {
      "before": "",
      "after": ""
    },
    "work": {
      "before": null,
      "after": null
    }
  }
}
```

**Final live set — HEAD `28dc4db` (chain binding, a1-reviewed.json, suite isolation).** Review round 1 and 2 ran; the inspect stopped at preflight.
- Review round 1, 20:26:33Z–20:28:02Z, exit 1: `fail-with-findings` (3 M13 findings), `allowlisted_hits: 21`, session `01a10372-7ace-…`, `previous: null`, exec ×4 only, `"mcp` → 0, `r0 = .system` only, run-home 0.
- Review round 2, 20:28:50Z–20:33:39Z, exit 1: `fail/round_cap` (REVISE again) — a fresh session `01a10374-9330-…` on a new snapshot, `previous: null`, no `resume` in `command.json`, the prompt carries a1's sha-bound round-1 findings, the QUARANTINED block and the dispositions. Tools: exec ×4 and **`wait` ×2** (Codex polling a still-running exec cell: `{"cell_id":"1","yield_time_ms":1000}`), `"mcp` → 0, run-home 0.
- Inspect, 20:34:13Z–20:34:23Z, exit 1: **`fail/preflight_failed`, `session_tools_exec_only: disallowed: wait`** — the newest session log now names a tool outside the allowlist (`exec`, `shell`, `local_shell`), so the gate refused before any snapshot or runner call: fail-closed, observed. Whether `wait` (a read-only companion of `exec`, measured here for the first time) joins the allowlist is open and routed to the team lead.
- All three: primary checkout porcelain empty before and after, `~/.a1-xprov/snapshots/` unchanged.

stdout of review round 1 on `28dc4db`:
```json
{
  "verdict": "fail-with-findings",
  "reason": null,
  "reason_detail": null,
  "step": "normalize",
  "gate": "plan-review-xprov",
  "phase": "M13-residuals",
  "wave": null,
  "lane": null,
  "round": 1,
  "mode": "review",
  "enforcement": "blocking",
  "findings_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json",
  "xreview_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/XREVIEW.md",
  "result_path": "~/.a1-xprov/artifacts/009-wave7-live-smoke/claudex-8cz72xey/result.json",
  "next": {
    "round_cmd": "node ~/claude-projects/a1-worktrees/009-wave7-live-smoke/_shared/a1-tools.cjs xprov gate --phase M13-residuals --gate plan-review-xprov --round 2",
    "dispositions_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md"
  },
  "allowlisted_hits": 21,
  "allowlist_anchor": "2741abe4c7d5a26e2f9d7c359e1ca55495f633d6",
  "allowlist_approved_blob": "d21e526d3448512f59c3593c4b6df8186c8bcd46963708094e7008599d762479",
  "allowlist_stale": [],
  "allowlisted": [
    {"path": ".a1/phases/M7-oss-ready/MAP.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M7-oss-ready/RESEARCH.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M9-robustness/RESEARCH.md", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "doc_example"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern"},
    {"path": "_test-fixtures/a1-vault-cockpit/parts/05-hosts.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/02-normalize.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "github_pat_fine_grained", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "bearer_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake"}
  ],
  "uncovered": [],
  "allowlist_note": null,
  "run_porcelain": {
    "checkout": {
      "before": "?? .a1/phases/M13-residuals/XREVIEW.md\n",
      "after": "?? .a1/phases/M13-residuals/XREVIEW.md\n"
    },
    "snapshot": {
      "before": "",
      "after": ""
    },
    "work": {
      "before": null,
      "after": null
    }
  }
}
```

stdout of review round 2 on `28dc4db`:
```json
{
  "verdict": "fail",
  "reason": "round_cap",
  "reason_detail": "REVISE at round 2 = cap",
  "step": "normalize",
  "gate": "plan-review-xprov",
  "phase": "M13-residuals",
  "wave": null,
  "lane": null,
  "round": 2,
  "mode": "review",
  "enforcement": "blocking",
  "findings_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r2.findings.json",
  "xreview_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/XREVIEW.md",
  "result_path": "~/.a1-xprov/artifacts/009-wave7-live-smoke/claudex-b59jjc86/result.json",
  "next": null,
  "allowlisted_hits": 21,
  "allowlist_anchor": "2741abe4c7d5a26e2f9d7c359e1ca55495f633d6",
  "allowlist_approved_blob": "d21e526d3448512f59c3593c4b6df8186c8bcd46963708094e7008599d762479",
  "allowlist_stale": [],
  "allowlisted": [
    {"path": ".a1/phases/M7-oss-ready/MAP.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M7-oss-ready/RESEARCH.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M9-robustness/RESEARCH.md", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "doc_example"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern"},
    {"path": "_test-fixtures/a1-vault-cockpit/parts/05-hosts.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/02-normalize.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "github_pat_fine_grained", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "bearer_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake"}
  ],
  "uncovered": [],
  "allowlist_note": null,
  "run_porcelain": {
    "checkout": {
      "before": " M .a1/phases/M13-residuals/observations.jsonl\n?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md\n?? .a1/phases/M13-residuals/XREVIEW.md\n?? .a1/phases/M13-residuals/xreview/index.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json\n",
      "after": " M .a1/phases/M13-residuals/observations.jsonl\n?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md\n?? .a1/phases/M13-residuals/XREVIEW.md\n?? .a1/phases/M13-residuals/xreview/index.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json\n"
    },
    "snapshot": {
      "before": "",
      "after": ""
    },
    "work": {
      "before": null,
      "after": null
    }
  }
}
```

stdout of the inspect on `28dc4db`:
```json
{
  "verdict": "fail",
  "reason": "preflight_failed",
  "reason_detail": "session_tools_exec_only",
  "step": "preflight",
  "gate": "wave-inspect-xprov",
  "phase": "M13-residuals",
  "wave": 7,
  "lane": null,
  "round": 1,
  "mode": "inspect",
  "enforcement": "blocking",
  "findings_path": null,
  "xreview_path": null,
  "result_path": null,
  "next": null,
  "allowlisted_hits": 0,
  "allowlist_anchor": null,
  "allowlist_approved_blob": null,
  "allowlist_stale": [],
  "allowlisted": [],
  "uncovered": [],
  "allowlist_note": null
}
```

**Final live inspect — HEAD `cf5a86e`, base `2741abe` (after the quota reset).** `cf5a86e` = `da103f3` (passes bound like waivers; the current wave needs its exact head) plus the owner-approved Edit/Write deny for `~/.a1-xprov/waivers.json` in `.claude/settings.json` (closes the `1638616` inspect's R1). Command as above (`--wave 7 --base 2741abe --work-path <this worktree>`); no review rerun (the plan-review path is unchanged since `6672c87`, whose round-2 delta is covered by FR6/FR7).
- 18:48:15Z–18:49:53Z, exit 1. stdout (full JSON below): `verdict: fail-with-findings`, `step: normalize`, `enforcement: blocking`, `allowlisted_hits: 29`, `uncovered: []`.
- `result.json`: `status: completed`, `mode: inspect`, `previous: null`, session `01a10318-805d-…`, `snapshot.diff_sha256: 6fc10dbc…` = the stored scan-time hash (no tripwire). The index entry carries `head: cf5a86e7…` (= the snapshotted HEAD) and `base: 2741abe4…` (full sha) — the new pass/waiver binding, live.
- Session log (`rollout-2026-10-03T20-48-19-01a10318-…jsonl`): `custom_tool_call:exec` ×3 only; `r0 = .system` only; `grep -c '"mcp'` → 8, prompt and exec output only — zero MCP tool calls. Run-home `entries: 0`.
- Porcelain: primary checkout empty before and after; `~/.a1-xprov/snapshots/` unchanged (`snap-jZtQHt` only); snapshot porcelain empty (`run_porcelain.snapshot`). This worktree, after:
```
 M .a1/phases/M13-residuals/observations.jsonl
?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md
?? .a1/phases/M13-residuals/XREVIEW.md
?? .a1/phases/M13-residuals/xreview/index.json
?? .a1/phases/M13-residuals/xreview/wave-inspect-xprov-wave-7-r1.findings.json
```
- Findings, open and routed to the team lead: **R1 (high, `xprov-normalize.cjs:439`): normalize derives head/base from the checkout and its flags, not from `result.json`, and accepts a `review` result for the wave gate** — an old APPROVED plan-review result normalized by hand as `wave-inspect-xprov` would name the current HEAD and satisfy wave-status. **R2 (medium, `xprov-gate.cjs:484`): `wave-status --waves N --current-wave N --lane L` checks the pair (N, null)** — `--waves` builds lane-null pairs, so the documented lane checkpoint does not cover a lane pass. R4–R6: M13 `checklist.cjs` (a1-fix candidates). Quarantined `instruction_shaped`: R3 (lane STATUS consolidation; follow-up).

stdout of the final inspect on `cf5a86e`:
```json
{
  "verdict": "fail-with-findings",
  "reason": null,
  "reason_detail": null,
  "step": "normalize",
  "gate": "wave-inspect-xprov",
  "phase": "M13-residuals",
  "wave": 7,
  "lane": null,
  "round": 1,
  "mode": "inspect",
  "enforcement": "blocking",
  "findings_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/wave-inspect-xprov-wave-7-r1.findings.json",
  "xreview_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/XREVIEW.md",
  "result_path": "~/.a1-xprov/artifacts/009-wave7-live-smoke/claudex-kph597lm/result.json",
  "next": {
    "fix_round": 1,
    "dispositions_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/wave-inspect-xprov-wave-7-r1.dispositions.md"
  },
  "allowlisted_hits": 29,
  "allowlist_anchor": "2741abe4c7d5a26e2f9d7c359e1ca55495f633d6",
  "allowlist_approved_blob": "d21e526d3448512f59c3593c4b6df8186c8bcd46963708094e7008599d762479",
  "allowlist_stale": [],
  "allowlisted": [
    {"path": ".a1/phases/M7-oss-ready/MAP.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M7-oss-ready/RESEARCH.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M9-robustness/RESEARCH.md", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "doc_example"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern"},
    {"path": "_test-fixtures/a1-vault-cockpit/parts/05-hosts.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/02-normalize.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "github_pat_fine_grained", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "bearer_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake", "side": "base"}
  ],
  "uncovered": [],
  "allowlist_note": null,
  "run_porcelain": {
    "checkout": {
      "before": "?? .a1/phases/M13-residuals/XREVIEW.md\n",
      "after": "?? .a1/phases/M13-residuals/XREVIEW.md\n"
    },
    "snapshot": {
      "before": "",
      "after": ""
    },
    "work": {
      "before": null,
      "after": null
    }
  }
}
```

**Re-run on `6672c87` blocked by quota (16:13Z) — observed fail-closed.** `6672c87` (round N−1 findings bound by sha256 in the index entry, O_NOFOLLOW reads, fake runner stamps `mode`) touches the round-2 feedback path, so review round 1, round 2 and the inspect were started again at 16:13:13Z–16:13:31Z. All three stopped at step `run` with `fail/runner_failed` and exit 1 within seconds; `reason_detail` now carried the provider's own reason live: `runner exited 1: You’ve hit your usage limit. … try again at 8:47 PM.` No findings, no snapshot left (`~/.a1-xprov/snapshots/` unchanged), primary checkout and snapshot porcelain empty before and after, the worktree delta only PLAN-REVIEW-LOG.md and XREVIEW.md. The `1638616` runs above remain the last completed live set; the delta to `6672c87` is covered by fixture arms FR6/FR7 (part 10) and R6r (part 06), each killed by its mutation. A completed live run on `6672c87` needs the quota back (after 18:47Z).

**Earlier final runs on `4abccf3` (14:37Z–14:42Z).** Review round 1 REVISE (three M13 findings), round 2 a fresh session (`previous: null`, new session `01a10234-…` and snapshot) → `round_cap`, inspect REVISE with R1 (waivers ignored by load-check, high — closed in `1638616`) and R2 (`<file>:<symbol>` without the space, quarantined — closed in `1638616`). Same isolation evidence (exec only, 0 MCP calls, `.system` only, run-home empty, porcelain unchanged).

**Earlier final runs on `ae6c281` (13:47Z–13:50Z).** Review: fail-with-findings, three M13 findings all quarantined `path_not_in_repo` (Codex wrote `<file>:<symbol>` without the space). Inspect: fail-with-findings, R2/R3 M13, R1 (waivers) and R4 quarantined. Same isolation evidence (exec only, 0 MCP calls, `.system` only, run-home empty, porcelain unchanged); superseded by the `4abccf3` runs above.

**Usage limit, 2026-10-03 11:13Z — observed fail-closed.** The first final inspect (HEAD `e07cb01`) hit the ChatGPT Codex quota. The event stream held one `{"type":"error","message":"You’ve hit your usage limit. …"}` event; runner 2.1.0 recorded `status: failed` and exited 1 with an empty stderr; the gate exited 1 with `fail/runner_failed` and wrote no findings — no retry, no fallback model or provider (§4). The reason was only in the run dir; since `ae6c281` `reason_detail` carries it (`runner exited 1: You’ve hit your usage limit…`, display-filtered, capped at 300 chars; fixture `cases/usage-limit.*`, captured from that run).

**Raw evidence — final runs on `1638616`.** `git status --porcelain --untracked-files=all`, taken by the caller around each gate call. Primary checkout (`~/claude-projects/a1-specforge`, `main`): empty before and after all three runs. `~/.a1-xprov/snapshots/`: the same single pre-existing entry before and after (`snap-jZtQHt`, 2026-10-02, not from these runs). This worktree (the gate's checkout and `$WORK_PATH`, so `run_porcelain.work` is `null`):

- review round 1, before:
```
(empty)
```
- review round 1, after:
```
 M .a1/phases/M13-residuals/observations.jsonl
?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md
?? .a1/phases/M13-residuals/XREVIEW.md
?? .a1/phases/M13-residuals/xreview/index.json
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json
```
- review round 2, before (the dispositions file is the host's own write between the rounds):
```
 M .a1/phases/M13-residuals/observations.jsonl
?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md
?? .a1/phases/M13-residuals/XREVIEW.md
?? .a1/phases/M13-residuals/xreview/index.json
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json
```
- review round 2, after:
```
 M .a1/phases/M13-residuals/observations.jsonl
?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md
?? .a1/phases/M13-residuals/XREVIEW.md
?? .a1/phases/M13-residuals/xreview/index.json
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r2.findings.json
```
- inspect, before:
```
 M .a1/phases/M13-residuals/observations.jsonl
?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md
?? .a1/phases/M13-residuals/XREVIEW.md
?? .a1/phases/M13-residuals/xreview/index.json
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r2.findings.json
```
- inspect, after:
```
 M .a1/phases/M13-residuals/observations.jsonl
?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md
?? .a1/phases/M13-residuals/XREVIEW.md
?? .a1/phases/M13-residuals/xreview/index.json
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r2.findings.json
?? .a1/phases/M13-residuals/xreview/wave-inspect-xprov-wave-7-r1.findings.json
```

The only delta is a1's own writes in `.a1/phases/M13-residuals/` (XREVIEW.md, PLAN-REVIEW-LOG.md, `xreview/*.json`, one observations.jsonl line per run). The snapshot's porcelain is in `run_porcelain.snapshot` below: empty before and after for every run.

**SC-007 (file list under `.a1/phases/M13-residuals/`).** Before round 1: `PLAN.md`, `STATUS.md`, `VERIFICATION.md`, `observations.jsonl`. After the three runs, additionally: `PLAN-REVIEW-LOG.md`, `XREVIEW.md`, `xreview/index.json`, `xreview/plan-review-xprov-plan-r1.findings.json`, `xreview/plan-review-xprov-plan-r1.dispositions.md` (host-authored), `xreview/plan-review-xprov-plan-r2.findings.json`, `xreview/wave-inspect-xprov-wave-7-r1.findings.json`. None of these files holds a diff (`grep -c '^diff --git\|^@@ '` → 0 each) or a transcript (no `response_item`, `custom_tool_call`, `thread_id` or `"type":"turn` in any of them); the session logs and the a1-built feedback stay outside the repo.

stdout of review round 1:
```json
{
  "verdict": "fail-with-findings",
  "reason": null,
  "reason_detail": null,
  "step": "normalize",
  "gate": "plan-review-xprov",
  "phase": "M13-residuals",
  "wave": null,
  "lane": null,
  "round": 1,
  "mode": "review",
  "enforcement": "blocking",
  "findings_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json",
  "xreview_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/XREVIEW.md",
  "result_path": "~/.a1-xprov/artifacts/009-wave7-live-smoke/claudex-zsk9ii_r/result.json",
  "next": {
    "round_cmd": "node ~/claude-projects/a1-worktrees/009-wave7-live-smoke/_shared/a1-tools.cjs xprov gate --phase M13-residuals --gate plan-review-xprov --round 2",
    "dispositions_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md"
  },
  "allowlisted_hits": 21,
  "allowlist_anchor": "2741abe4c7d5a26e2f9d7c359e1ca55495f633d6",
  "allowlist_approved_blob": "d21e526d3448512f59c3593c4b6df8186c8bcd46963708094e7008599d762479",
  "allowlist_stale": [],
  "allowlisted": [
    {"path": ".a1/phases/M7-oss-ready/MAP.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M7-oss-ready/RESEARCH.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M9-robustness/RESEARCH.md", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "doc_example"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern"},
    {"path": "_test-fixtures/a1-vault-cockpit/parts/05-hosts.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/02-normalize.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "github_pat_fine_grained", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "bearer_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake"}
  ],
  "uncovered": [],
  "allowlist_note": null,
  "run_porcelain": {
    "checkout": {
      "before": "?? .a1/phases/M13-residuals/XREVIEW.md\n",
      "after": "?? .a1/phases/M13-residuals/XREVIEW.md\n"
    },
    "snapshot": {
      "before": "",
      "after": ""
    },
    "work": {
      "before": null,
      "after": null
    }
  }
}
```

stdout of review round 2:
```json
{
  "verdict": "fail",
  "reason": "round_cap",
  "reason_detail": "REVISE at round 2 = cap",
  "step": "normalize",
  "gate": "plan-review-xprov",
  "phase": "M13-residuals",
  "wave": null,
  "lane": null,
  "round": 2,
  "mode": "review",
  "enforcement": "blocking",
  "findings_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r2.findings.json",
  "xreview_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/XREVIEW.md",
  "result_path": "~/.a1-xprov/artifacts/009-wave7-live-smoke/claudex-2yw8c7gh/result.json",
  "next": null,
  "allowlisted_hits": 21,
  "allowlist_anchor": "2741abe4c7d5a26e2f9d7c359e1ca55495f633d6",
  "allowlist_approved_blob": "d21e526d3448512f59c3593c4b6df8186c8bcd46963708094e7008599d762479",
  "allowlist_stale": [],
  "allowlisted": [
    {"path": ".a1/phases/M7-oss-ready/MAP.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M7-oss-ready/RESEARCH.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M9-robustness/RESEARCH.md", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "doc_example"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern"},
    {"path": "_test-fixtures/a1-vault-cockpit/parts/05-hosts.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/02-normalize.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "github_pat_fine_grained", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "bearer_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake"}
  ],
  "uncovered": [],
  "allowlist_note": null,
  "run_porcelain": {
    "checkout": {
      "before": " M .a1/phases/M13-residuals/observations.jsonl\n?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md\n?? .a1/phases/M13-residuals/XREVIEW.md\n?? .a1/phases/M13-residuals/xreview/index.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json\n",
      "after": " M .a1/phases/M13-residuals/observations.jsonl\n?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md\n?? .a1/phases/M13-residuals/XREVIEW.md\n?? .a1/phases/M13-residuals/xreview/index.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json\n"
    },
    "snapshot": {
      "before": "",
      "after": ""
    },
    "work": {
      "before": null,
      "after": null
    }
  }
}
```

stdout of the inspect:
```json
{
  "verdict": "fail-with-findings",
  "reason": null,
  "reason_detail": null,
  "step": "normalize",
  "gate": "wave-inspect-xprov",
  "phase": "M13-residuals",
  "wave": 7,
  "lane": null,
  "round": 1,
  "mode": "inspect",
  "enforcement": "blocking",
  "findings_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/wave-inspect-xprov-wave-7-r1.findings.json",
  "xreview_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/XREVIEW.md",
  "result_path": "~/.a1-xprov/artifacts/009-wave7-live-smoke/claudex-ydj6bl2v/result.json",
  "next": {
    "fix_round": 1,
    "dispositions_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/wave-inspect-xprov-wave-7-r1.dispositions.md"
  },
  "allowlisted_hits": 29,
  "allowlist_anchor": "2741abe4c7d5a26e2f9d7c359e1ca55495f633d6",
  "allowlist_approved_blob": "d21e526d3448512f59c3593c4b6df8186c8bcd46963708094e7008599d762479",
  "allowlist_stale": [],
  "allowlisted": [
    {"path": ".a1/phases/M7-oss-ready/MAP.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M7-oss-ready/RESEARCH.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M9-robustness/RESEARCH.md", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "doc_example"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern"},
    {"path": "_test-fixtures/a1-vault-cockpit/parts/05-hosts.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/02-normalize.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "github_pat_fine_grained", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "bearer_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake", "side": "base"}
  ],
  "uncovered": [],
  "allowlist_note": null,
  "run_porcelain": {
    "checkout": {
      "before": " M .a1/phases/M13-residuals/observations.jsonl\n?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md\n?? .a1/phases/M13-residuals/XREVIEW.md\n?? .a1/phases/M13-residuals/xreview/index.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r2.findings.json\n",
      "after": " M .a1/phases/M13-residuals/observations.jsonl\n?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md\n?? .a1/phases/M13-residuals/XREVIEW.md\n?? .a1/phases/M13-residuals/xreview/index.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r2.findings.json\n"
    },
    "snapshot": {
      "before": "",
      "after": ""
    },
    "work": {
      "before": null,
      "after": null
    }
  }
}
```

**Waiver, live.** Not run by an agent: `xprov waive` refuses agent process trees by design. The owner path (pseudo-TTY outside Claude Code, gate id typed back → store record, mirror, load-check `accepted: waiver`) is proven by fixture arms W5–W8, which run in CI (`CI=true` turns their local SKIP into a FAIL); a live waive, when needed, is Robert's, in his own terminal.

**Quarantine, live.** Findings whose evidence quotes an instruction marker are quarantined, not dropped: final inspect R3 (see above), the `4abccf3` review R4 and inspect R2/R5, the `ae6c281` inspect's R1 and R4 and, earlier, R2 (`xprov-normalize.cjs`, quoting "ignore previous") and R6 are listed in XREVIEW.md under `### Quarantined` with reason `instruction_shaped`.

**SC-009 (snapshot allowlist), measured on `main`.** On `2741abe`: `a1-tools xprov snapshot --repo . --commit HEAD` → `ok: true`, `files_skipped: 0`, `allowlisted_hits: 21`, `allowlist_anchor: ed5d5fa`, `approved_blob: d21e526d…2479`, `stale: []`. Counter-tests: a dangling commit with one runtime-built AKIA fake → `secret_in_snapshot`, only that file uncovered; a fresh clone (another repo path, not approved) → `allowlist_invalid`. Re-measured on this branch after every wave-7 commit, last on `1638616`: `ok: true`, `allowlisted_hits: 21`, `uncovered: []`, `stale: []`, `files_skipped: 0`, 579 files scanned. Note on the counter-tests: the spec's "remove one entry → fail" counter-test was not run as such; it is replaced by the two above (a runtime-built AKIA fake that no entry covers, and a fresh clone at another path that is not approved), which prove the same two properties: an uncovered match fails, and an allowlist is only valid where it was approved.

**Canary measurements (skill roots), 2026-10-02.** `codex debug prompt-input` contacts `chatgpt.com:443` (13 CONNECT attempts behind a logging proxy) and renders the same output under `sandbox-exec (deny network-outbound)`, so it was used ONLY under that network block, against a copy of the home (the real home stayed byte-identical by a 128-entry manifest). Measured: `$HOME/.agents/skills` is a skill root that follows `$HOME`; `.agents/skills` at the git root of the cwd is a root (nothing above it); `$CODEX_HOME/skills/<x>` is a user root next to `skills/.system`; `/etc/codex` is absent. Consequences in this wave: a fresh, empty per-run HOME (`~/.a1-xprov/run-home-*`), `.agents` stripped from the snapshot, only `skills/.system` is runtime.

**What the smokes changed.** The live runs found ten defects the fixtures could not see; each was fixed with an arm that was RED first (or proven by mutation) before this flip: skill roots outside the dedicated home (ccc23e7, 64cacad), finding paths written as `file: symbol` (ccc23e7), fixtures that would have broken on the flip (ccc23e7), the run-home note tripping the tripwire and unfiltered run-home names (64cacad, 9e3962a), outbound content not scanned — base side, PLAN.md, dispositions (6ebc943), the plan-review resume that could never run (f2525b7), `xprov run` accepting unscanned inputs (77d9ff9), unscanned path names (00413c7) and stripped files readable as HEAD blobs (0e9e5d5). a1-samuel-security re-verified `035af5e..00413c7`: PASS. After the flip, reviews of the branch added `ae6c281`: the `skills/.system` reset and the symlink refusal (a1-samuel-security m7, measured in §2) and the runner's own error in `reason_detail` (found by the 11:13Z usage-limit run above); then `4abccf3`: no Codex resume (a1-built feedback, Samuel's MAJOR), the narrowed symlink exemption, linked plugin entries, one-line `reason_detail` for every line breaker and bidi control, and the inverted instruction check (only exact fixed runner messages are exempt); then `1638616`: the human-guarded, plan-bound waiver store, fresh inspect fix rounds with feedback, and `<file>:<symbol>` without the space.

**SC-005, SC-006.** SC-006: a1-reinhard-reviewer ran `grep -ril 'integrated' docs/ skills/ _shared/` over the branch; no hit makes a claim about Codex or xprov. SC-005 (`retro validate` and `a1-evolve` collect listing both gate ids with one firing each) needs the retros of the first a1-plan and a1-execute runs after the flip; it is an open post-merge item, not measured here.

**Enforcement.** Commit `4970b6b` flipped `plan-review-xprov` and `wave-inspect-xprov` from `warning` to `blocking` (FR-005, SC-004). `_test-fixtures/a1-xprov/check-enforcement.sh` (CI step after Fixtures) refuses any tree where a row says `blocking` while this section is a placeholder or lacks either `xprov gate` command.

## Consequences
+ Robert's 2026-09-03 decision becomes two registered gates with deterministic exit semantics instead of a belief held in a vault note (invariant 7 applied to the framework itself).
+ The reviewer's blast radius is bounded four times over: tool-less home, tripwire, secret-free snapshot, findings-as-data. A prompt-injected reviewer can produce a bad verdict, but no write, no exfiltrated untracked file, no auto-applied fix.
+ Supply chain is a one-file audit with a hash, redone per pin bump; upstream releases cannot change what runs with Robert's credentials.
− Every plan and wave costs one or two Codex calls from the ChatGPT Plus quota, roughly 30 s each; a provider outage stops the pipeline until a human waives.
− `model_observed` is `unknown` for now, so gate-ROI by model is not measurable until a captured Codex event stream shows the field.
− The two rows sat at `warning` until the Wave 7 flip (2026-10-03, §6); since then a `fail` blocks the pipeline until a human waives it, and check-enforcement.sh keeps the flip tied to the recorded live evidence (invariant 8).

## Addendum 2026-09-28 — Snapshot secret-scan allowlist (Wave 6b, FR-030)
**Context:** the Wave 7 live smoke stopped at `secret_in_snapshot` on this repository itself: 21 pattern matches in 10 tracked files, none a real credential (fixture fakes, two doc examples, and the pattern list in `_shared/lib/xprov.cjs`, which must contain the PEM header prefix). Robert chose a committed, reviewed allowlist (option a).

**Decision.** The scan counts every match and fingerprints the whole line that holds it; a hit passes only when `.a1/xprov-secret-allowlist.json` covers its `(path, pattern)` with that line fingerprint and within `max_count`. Four layers, each fail-closed to "every hit fails":
1. *Trust anchor, not the reviewed tree.* The file is read with `git cat-file blob` at the merge-base of the reviewed commit with `refs/remotes/origin/<default_branch>` in the primary checkout, verified against `git ls-remote origin` (non-interactive, 30 s timeout, the whole process group killed on timeout). `origin/HEAD`, local branches, the snapshot and every working tree are never read. Plan review of a default-branch commit steps to its first parent; wave-inspect of default-branch history applies no allowlist.
2. *No self-approval in a branch.* A reviewed range that touches the file fails with `allowlist_modified` before dispatch; the anchor's last allowlist commit must touch nothing else.
3. *Line fingerprints.* Several patterns match only a prefix (`pem_begin`, `slack_token`, `private_key_header`); a fingerprint over the match would bind no value. Any edit on an allowlisted line needs a new entry.
4. *Human approval (Robert, 2026-09-28).* The sha256 of the anchor's allowlist blob must be in `~/.a1-xprov/allowlist-approvals.json` (checked with `lstat`/`O_NOFOLLOW`, 0600 file in a 0700 directory, current user). Only `a1-tools xprov allowlist approve` writes it, and only from a terminal that is not Claude Code: TTY on stdin and stdout, no `CLAUDECODE`/`CLAUDE_PID`/`CLAUDE_CODE_*` variable, no Claude Code ancestor. A project PreToolUse hook (`.claude/hooks/xprov-deny-allowlist-approve.sh`) and deny rules for Edit/Write on both paths stop agents earlier; they are defence in depth, the guards in `approve` are the control.

gitleaks hits and reviewer output (`secret_in_output`) are never allowlisted.

**Measured for the ancestry guard (2026-09-28, macOS, no values recorded).** Command: `ps -o comm= -p $CLAUDE_PID; lsof -a -d txt -p $CLAUDE_PID -Fn | head -1`, plus a parent-pid walk from the Bash tool. Output: start name `claude`; executable `~/.local/share/claude/versions/2.1.281` (the `claude` on PATH is a symlink `~/.local/bin/claude → …/versions/2.1.283`); the walk from the Bash tool reaches `claude` two levels up; environment names `CLAUDECODE`, `CLAUDE_PID`, `CLAUDE_CODE_*` (plus `CLAUDE_EFFORT`, which the guard does not need). Fixture fakes are derived from this: macOS kills a copy of a system shell unless it is re-signed ad hoc (exit 137), and `/bin/sh` re-execs `/bin/bash`, so the fake parent is a re-signed `bash` copy on macOS and a `sh` copy on Linux (`node:20`: `/proc/<pid>/comm` = copy name, `exe` = copy path).

**Open measurement (Robert):** the Linux form of Claude Code on the aiserver — `cat /proc/$CLAUDE_PID/comm; readlink /proc/$CLAUDE_PID/exe` — to be recorded here. **Open (Robert, steps 3–4 of Wave 6b):** the allowlist commit on `main` and `approve` on every machine that runs the gate; SC-009 measured on a later commit of `main`.
