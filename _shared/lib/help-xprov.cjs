'use strict';

// help-xprov — the help text of the spec 009 commands (a1-tools xprov <sub>),
// split out of help.cjs to keep it under the 800-line cap (Reinhard, Wave 7
// branch review). help.cjs interpolates the string in place; the rendered
// --help output is byte-identical to the unsplit text.

const XPROV_HELP = `  a1-tools xprov <sub> [flags]
                  Spec 009-cross-provider-review-gate. Cross-provider review
                  gate: sends a phase's PLAN.md (gate plan-review-xprov, a1-plan
                  Phase 4b) or a wave diff (gate wave-inspect-xprov, a1-execute
                  step 2b-x) to Codex through the VENDORED claudex-loop runner
                  (_shared/vendor/claudex-loop/runner.py, sha-pinned in
                  SHA256SUMS next to it, resolved relative to lib/xprov.cjs —
                  never from a plugin cache) and maps the result fail-closed
                  onto exactly one of pass | fail-with-findings | fail/<reason>.
                  Runner modes a1 uses: review, inspect, check — never build.
                  Codex runs under a DEDICATED, tool-less CODEX_HOME: default
                  ~/.codex-a1-review, env A1_XPROV_CODEX_HOME overrides it;
                  ~/.codex itself is always refused by preflight.
                  Exit contract shared by EVERY subcommand (house rule, differs
                  from the facade default below): 0 pass/ok · 1 fail, stdout
                  JSON names \`reason\` · 2 usage error OR subcommand whose
                  module has not shipped yet ("xprov <sub>: not implemented
                  yet (planned wave N)") — no stdout JSON on 2. Human text
                  goes to stderr only; stdout is the machine contract.
                  Subcommands (module → wave it ships in):
    normalize <result.json> --phase <name> --gate <id> [--wave N] [--round N]
              [--lane <id>] [--work-path <dir>] [--allowlisted-hits N]
              [--allowlist-anchor <sha>] [--allowlist-approved-blob <sha256>]
                  (xprov-normalize.cjs, wave 2) total mapping of a runner
                  record: status!=completed → runner_failed; mode not
                  review|inspect → wrong_mode; APPROVED → pass (only after
                  plan sha, secret filter and quarantine agree), REVISE →
                  fail-with-findings, BLOCKED → blocked, else malformed.
                  Writes .a1/phases/<name>/XREVIEW.md, xreview/*.findings.json,
                  xreview/index.json atomically; exit 0 only on pass.
                  The allowlist flags (wave 6b, passed by gate) put the
                  snapshot's allowlist result into that one index entry;
                  without them the entry is unchanged.
    gc [--slug <repo-slug>] [--max-age-days N]
                  (xprov-artifacts.cjs, wave 3) remove runner run dirs under
                  ~/.a1-xprov/artifacts/<repo-slug>/ and orphaned snap-* clones
                  under ~/.a1-xprov/snapshots/ older than 14 days; per-run HOMEs
                  ~/.a1-xprov/run-home-* left by a killed run older than 24 h
                  (lstat, same owner, symlinks never followed).
    preflight [--allow-plugins <name>[,<name>…]]
                  (xprov-preflight.cjs, wave 4) proves the dedicated home is
                  tool-less BEFORE any runner call: not ~/.codex, 0700,
                  sandbox_mode = "read-only", no [mcp_servers.*] table at all,
                  no enabled [plugins.*], auth.json present, runner pin
                  matches SHA256SUMS, python3 >= 3.10, codex --version ok.
                  Wave 7: all eight [features] pins false (plugins,
                  remote_plugin, apps, browser_use, computer_use, hooks,
                  skill_mcp_dependency_install, memories),
                  cli_auth_credentials_store = "file", skills/ holds only
                  .system (skills/<x> is a user skill root), skills/ and
                  skills/.system real own dirs (skills_real_dirs), no symlink
                  in the home besides auth.json (home_no_symlinks; Codex's
                  runtime dirs are not descended), no
                  /etc/codex/{config,requirements}.toml.
                  Lists EVERY check with its measured value; exit 1 if any fails.
    init-home [--prune-marketplaces] [--pin-features]
                  (xprov-preflight.cjs, wave 4) create the dedicated home
                  idempotently; never overwrites an existing config.toml.
                  --pin-features (wave 7) appends the missing pins to an
                  existing home — cli_auth_credentials_store = "file" after the
                  last root key, '<pin> = false' lines to [features]; additive
                  only, a value a human set differently is refused (exit 1,
                  file unchanged).
    permit-check [--repo <git-toplevel>]
                  (xprov-permit.cjs, wave 4) reads .a1/xprov.json; anything
                  but external_review: allowed → external_review_not_permitted.
                  Customer repositories need an a1-ludwig-legal decision.
    permit --by <name> --record <vault-path> [--repo <git-toplevel>]
           [--default-branch <name>]
                  (xprov-permit.cjs, wave 4) the ONLY writer of .a1/xprov.json.
                  --default-branch (wave 6b) names the branch whose
                  refs/remotes/origin/<name> anchors the snapshot allowlist
                  (default main); checked with git check-ref-format --branch
                  on write (invalid → exit 1, nothing written) and on read.
    observe --agent xprov-codex|a1-<first>-<role> --skill <s> --phase <name>
            --type gap|blocker --severity <sev> --msg "<text>" [--wave N] [--lane <id>]
            [--pattern xprov_finding|xprov_waived] [--provider codex]
            [--model-requested <m>] [--model-observed <m>] [--repo <git-toplevel>]
                  (xprov-observe.cjs, wave 4) one observations.jsonl line with
                  pattern xprov_finding, model_requested, model_observed.
    snapshot --repo <path> --commit <sha> [--base <sha>] [--plan <file>] [--feedback <file>] | --remove <dir>
                  (xprov-snapshot.cjs, wave 5) fresh depth-limited fetch under
                  ~/.a1-xprov/snapshots/ (git init + fetch --depth 1 + checkout
                  FETCH_HEAD; with --base (inspect) base is fetched --depth 1
                  too — nothing between them, no parent commit's secret, is in
                  the snapshot); .codex/, AGENTS.md, AGENTS.override.md
                  and (wave 7) .agents/ are removed from the working tree,
                  because Codex reads .agents/skills at the git root of its
                  cwd as skill instructions; every tracked file is
                  secret-scanned (shared pattern list, windowed, UTF-16 aware,
                  + gitleaks with a1's own config when on PATH) before dispatch.
                  Wave 6b: the scan COUNTS every match and fingerprints its
                  line; a hit passes only when the approved allowlist at the
                  trust anchor covers it (see allowlist below). --repo must
                  share the git-common-dir of the cwd's checkout. stdout adds
                  allowlisted_hits, allowlist_anchor, allowlist_approved_blob,
                  allowlist_stale, allowlisted, uncovered, allowlist_note.
                  Wave 7: everything that LEAVES is scanned — with --base the
                  base-side blob of every path the outbound diff touches
                  (git diff --name-only --no-renames <base> of the stripped
                  working tree: deletions, removed lines, stripped files), and
                  the PLAN.md / dispositions COPIES the gate places in
                  <snapshot>.inputs/ (0700); same allowlist per side (entries
                  carry side: base|input), gitleaks over all of them. The diff
                  the runner will hash is hashed here and kept as
                  <snapshot>.inputs/diff.sha256. Path NAMES (tracked paths and
                  every base-side path, deletions and both rename sides) are
                  scanned first; a hit is never allowlisted and is reported as
                  pattern + a 12-character sha256 of the path, never the path.
                  --plan/--feedback copy and
                  scan those files into <snapshot>.inputs/ and record their
                  sha256 (inputs.json) — the only inputs xprov run accepts.
    run --mode review|inspect --snapshot <dir> --plan <abs PLAN.md> --phase <name>
        --gate <id> [--wave N] [--round N] [--lane <id>] [--base <sha>]
        [--feedback <file>] [--timeout N] [--work-path <dir>] [--no-log]
                  (xprov-run.cjs, wave 5) exact runner argv, allowlisted env with
                  CODEX_HOME set to the dedicated home, tripwire (git status
                  baseline of checkout, work path and snapshot, .git/ metadata,
                  the whole dedicated home except its runtime dirs; skills/
                  only .system) — any delta → tripwire. Wave 7: HOME is a fresh
                  ~/.a1-xprov/run-home-* per run (mkdtemp, 0700, verified empty
                  before the spawn → else run_home_unsafe), removed afterwards;
                  what Codex wrote there (names and sizes, never contents) is
                  reported as run_home_manifest, kept as run-home.manifest.json
                  in the run dir and noted in XREVIEW.md when non-empty (a
                  note, not a fail). run-home-* dirs a SIGKILL left behind are
                  swept by xprov gc. XDG_* is not passed; TMPDIR is. The cwd is the
                  snapshot root; a root still holding .agents/.codex/AGENTS.md
                  → snapshot_failed, no spawn. Inspect needs the scanned diff
                  hash next to the snapshot (else snapshot_failed, no spawn)
                  and compares it with the runner's snapshot.diff_sha256 after
                  the run — a mismatch is a tripwire. GIT_CONFIG_NOSYSTEM=1.
                  --resume is refused (exit 2): no session is ever resumed, a
                  resumed one replays rollout files the tripwire does not
                  cover; --feedback is review-only.
                  --plan/--feedback must be the snapshot's copies
                  <snapshot>.inputs/{PLAN.md,feedback.md}, re-hashed against
                  inputs.json before the spawn (else snapshot_failed, no
                  spawn). Every run first sweeps stale run-home-* (gc's sweep).
                  Right before the spawn the dedicated home must hold no symlink
                  besides auth.json and skills/, skills/.system must be real
                  dirs (else preflight_failed); skills/.system is then removed —
                  Codex re-extracts it (measured), so nothing planted there is
                  loaded. On runner_failed, reason_detail carries the runner's
                  own reason (the codex error event, else result.json error,
                  else stderr), secret- or instruction-shaped text withheld.
    gate --phase <name> --gate <id> [--wave N --base <sha> --work-path <p>]
         [--lane <id>] [--round N] [--timeout N]
                  (xprov-gate.cjs, wave 6) the driver the workflows call once:
                  permit-check → preflight → snapshot → run → normalize →
                  observe → cleanup, stopping at the first non-zero step;
                  round > 2 → round_cap. Every round is a fresh Codex session
                  (--resume/--feedback refused, exit 2). Plan round N ≥ 2 after
                  a REVISE gets a1-built feedback: round N−1's findings from
                  a1's run dir (a1-findings.json, regular file, under the
                  artifacts dir) + the dispositions file, scanned and copied
                  like the PLAN.md; next.round_cmd shows the call. Enforcement (warning|blocking) is READ
                  from the registry row and echoed in stdout, never applied here.
    load-check --phase <name> [--expect-sha <sha256>]
                  (xprov-gate.cjs, wave 6) newest plan-review-xprov pass entry
                  — counted only when its run dir in a1's artifacts holds a
                  completed APPROVED review of this PLAN.md — must match the
                  current PLAN.md sha256, or a waiver in the
                  guarded store ~/.a1-xprov/waivers.json must be bound to it
                  (accepted: pass|waiver) → else plan_review_missing.
                  --expect-sha: the sha accepted at Load; a different PLAN.md
                  now → plan_changed (a1-execute runs it before every wave).
    wave-status --phase <name> [--waves 1,2,3 [--lane <id>]] [--work-path <dir>]
                [--lane-work-path <lane>=<dir>[,…]]
                  (xprov-gate.cjs, wave 6) every completed wave needs a
                  wave-inspect-xprov pass or a store waiver, both bound to this
                  PLAN.md's sha and chained per lane: base an ancestor of head,
                  head of wave N = base of the next completed wave, the last
                  wave's head = the lane work path's HEAD; between waves and
                  after the last one only commits writing the measured
                  workflow files (phase STATUS*/VERIFICATION/observations/
                  XREVIEW/PLAN-REVIEW-LOG/xreview, product-stage files) as
                  mode 100644 may sit. Pass rows are pointers: head/base come from
                  the run dir's a1-reviewed.json (written by xprov run); a lane
                  without --lane-work-path lacks. index.json waived: true rows
                  count for nothing.
    allowlist propose --commit <rev> [--json] [--repo <git-toplevel>]
                  (xprov-approve.cjs, wave 6b) every secret-pattern match at
                  <rev> as path:line:column, pattern, proposed class, masked
                  excerpt (first 4 characters + length), high_confidence —
                  never the matched text. --json prints a DRAFT allowlist with
                  empty reason fields. Never writes a file.
    allowlist approve --repo <path> [--revoke <sha256>]
                  (xprov-approve.cjs, wave 6b) HUMAN ONLY, in a separate
                  terminal: exit 2 and nothing written unless stdin and stdout
                  are TTYs, no CLAUDECODE / CLAUDE_PID / CLAUDE_CODE_* variable
                  is set and no ancestor process is Claude Code (start name
                  claude, an executable under claude/versions/, or
                  @anthropic-ai/claude-code in argv). Shows the listing, asks
                  for the entry count, then records the sha256 of the allowlist
                  blob at the verified origin/<default_branch> tip.
                  Allowlist (FR-030): .a1/xprov-secret-allowlist.json, read
                  only at the anchor = merge-base(reviewed commit,
                  refs/remotes/origin/<default_branch>) verified by git
                  ls-remote origin (30 s timeout); never origin/HEAD, a local
                  branch, the snapshot or a working tree. Schema: exactly
                  {version: 1, owner, entries: [{path, pattern, max_count 1–8,
                  fingerprints, class, reason, reviewed_by, added_on}]}, at most
                  32 entries, duplicate JSON keys rejected. A reviewed range
                  that touches the file → allowlist_modified; the file's last
                  commit must touch nothing else; owner = decided_by. Approval
                  store ~/.a1-xprov/allowlist-approvals.json (0600, dir 0700,
                  no symlinks): {"version":1,"repos":{"<realpath of
                  git-common-dir>":["<sha256 of the blob>", …]}}.
                  reason_detail: allowlist_anchor_unresolved,
                  allowlist_not_separate_commit, allowlist_owner_mismatch,
                  allowlist_unapproved. gitleaks hits and reviewer output are
                  never allowlisted.
    waive --phase <name> --gate <id> [--wave <N> [--lane <id>] --base <sha>
          [--work-path <dir>]] --reason "<text>" --by <name>
                  (xprov-gate.cjs + xprov-waivers.cjs, wave 7) HUMAN-only, in a
                  separate terminal: the owner-approval guards (TTY on stdin
                  and stdout, no CLAUDECODE/CLAUDE_PID/CLAUDE_CODE_*, no Claude
                  Code ancestor; else exit 2, nothing written), the key
                  computed here (git-common-dir, phase, gate, PLAN.md sha256;
                  for a wave also lane, head of --work-path and full base),
                  the gate id typed back, then one record in
                  ~/.a1-xprov/waivers.json (0600, atomic) plus an index.json /
                  XREVIEW.md mirror without authority — never verdict: pass.
                  Skills print the command; no skill bash block executes it.
                  Reasons (stdout \`reason\` on exit 1): runner_failed,
                  malformed, wrong_mode, blocked, plan_changed, tripwire,
                  secret_in_snapshot, secret_in_output, quarantined, round_cap,
                  external_review_not_permitted, snapshot_failed, not_logged_in,
                  preflight_failed, plan_review_missing, wave_inspect_missing,
                  allowlist_invalid, allowlist_modified.
                  Paths a1 owns: ~/.a1-xprov/artifacts/<repo-slug>/ (0700,
                  runner --artifacts, never inside a checkout or under
                  A1_VAULT_ROOT), ~/.a1-xprov/snapshots/ (clones, removed after
                  normalize), .a1/phases/<name>/XREVIEW.md + xreview/*.json +
                  PLAN-REVIEW-LOG.md, .a1/xprov.json (permit record),
                  ~/.a1-xprov/allowlist-approvals.json (written only by
                  allowlist approve).
                  ENV: A1_XPROV_CODEX_HOME (optional; default ~/.codex-a1-review).
                  Fixture suite: _test-fixtures/a1-xprov/run-tests.sh (harness)
                  + parts/NN-<wave>.sh; runner fakes live in fake/, captured
                  runner records in cases/ (each with a .meta provenance file).`;

module.exports = { XPROV_HELP };
