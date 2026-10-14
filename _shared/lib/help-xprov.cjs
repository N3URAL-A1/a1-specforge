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
                  Spec 014: findings that cite PLAN.md (or the input copy) are
                  mapped to the phase's PLAN.md; a quarantined finding that is
                  not an instruction marker shows a clipped display_detail; the
                  count of quarantined high-severity items under a REVISE is
                  quarantined_blocking (stdout, index entry, gate stdout) and
                  they are listed in the findings file as quarantined_blockers.
                  Writes .a1/phases/<name>/XREVIEW.md, xreview/*.findings.json,
                  xreview/index.json atomically; exit 0 only on pass.
                  The allowlist flags (wave 6b, passed by gate) put the
                  snapshot's allowlist result into that one index entry;
                  without them the entry is unchanged.
    gc [--slug <repo-slug>] [--max-age-days N] [--pass-max-age-days N]
                  (xprov-artifacts.cjs, wave 3) remove runner run dirs under
                  ~/.a1-xprov/artifacts/<repo-slug>/ and orphaned snap-* clones
                  under ~/.a1-xprov/snapshots/ older than 14 days; per-run HOMEs
                  ~/.a1-xprov/run-home-* left by a killed run older than 24 h
                  (lstat, same owner, symlinks never followed). A run dir
                  that carries a1's own pass marker (a1-pass.json, written by
                  normalize only on a pass) and whose result.json is a completed
                  APPROVED review or inspect is a pass load-check/wave-status
                  still read: kept 180 days (--pass-max-age-days N overrides;
                  then a re-review is needed). A run a1 discarded keeps 14.
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
                  (xprov-permit.cjs, wave 4) reads .a1/xprov.json AND the owner's
                  stores ~/.a1-xprov/permit-denials.json and (spec 014)
                  ~/.a1-xprov/permits.json; stdout \`state\` is allowed | denied |
                  absent | invalid | denial_mismatch | permit_mismatch |
                  home_mismatch | origin_changed (exit 0 only for allowed).
                  Spec 016: the owner stores resolve under the home of the OS
                  user record, never $HOME; when $HOME differs, no store is
                  written and the state is home_mismatch (owner_home_mismatch).
                  An entry written since spec 016 is bound to the repository's
                  git-common-dir and raw remote.origin.url; an origin that
                  changes, appears or disappears voids the permit (origin_changed,
                  external_review_not_permitted). Every result carries
                  \`enforcement: unenforced\` and \`audit: ok|missing|broken\`: the
                  consent is a record the same OS user could write; the hash-
                  chained ~/.a1-xprov/consent-audit.jsonl makes a naive forgery
                  or a hand-written entry visible (permits of before spec 016
                  stay allowed and report audit: missing). It prevents nothing. allowed needs the file to say allowed AND
                  the permit store to hold an entry for this repository's
                  git-common-dir with the same decided_by, decided_on, record
                  (and default_branch when either side has one); a hand-written
                  file alone → permit_mismatch → external_review_permit_mismatch,
                  nothing leaves. Migration: the owner re-runs permit once per
                  permitted repository. absent/invalid → external_review_not_permitted;
                  denied (file and store agree on decided_by + decided_on) →
                  external_review_denied; every other combination (file-only
                  denied, a store denial next to an allowed file, an unusable
                  store) → external_review_denial_mismatch, fail closed.
                  Customer repositories need an a1-ludwig-legal decision.
                  The allowed line prints what leaves: the full tracked tree of
                  the reviewed commit, the base-side blobs of changed files,
                  PLAN.md and the dispositions (read-only sandbox).
    permit --by <name> --record <vault-path> [--repo <git-toplevel>]
           [--default-branch <name>]
    permit --deny --by <name> [--record <vault-path>] [--repo <git-toplevel>]
           [--default-branch <name>]
                  (xprov-permit.cjs, wave 4; owner guards spec 012) HUMAN-only,
                  in a separate terminal, like waive: stdin and stdout a TTY, no
                  CLAUDECODE/CLAUDE_PID/CLAUDE_CODE_*, no Claude Code ancestor
                  (else exit 2, nothing written); it shows the repository key
                  (git-common-dir) and the decision, and asks for the word
                  \`allowed\` resp. \`denied\` typed back. --deny writes the owner's
                  store first, then .a1/xprov.json (--record optional); a failing
                  file step leaves denial_mismatch. permit (allowed) first removes
                  this repository's denial, then (spec 014) writes the entry in
                  ~/.a1-xprov/permits.json, then .a1/xprov.json; a failing file
                  step leaves permit_mismatch until the owner re-runs permit.
                  An unusable store is never overwritten.
                  The ONLY writer of .a1/xprov.json, the denial store and the
                  permit store.
                  --default-branch (wave 6b) names the branch whose
                  refs/remotes/origin/<name> anchors the snapshot allowlist
                  (default main); checked with git check-ref-format --branch
                  on write (invalid → exit 1, nothing written) and on read.
    observe --agent xprov-codex|a1-<first>-<role> --skill <s> --phase <name>
            --type gap|blocker --severity <sev> --msg "<text>" [--wave N] [--lane <id>]
            [--pattern xprov_finding|xprov_waived|xprov_not_applicable] [--provider codex]
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
                  allowlist_stale, allowlisted, uncovered, allowlist_note,
                  scoped_hits, scoped_uncovered (allowlist v2, counts only).
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
                  Spec 014: a snapshot that passed every check writes a scan
                  record ~/.a1-xprov/scan-records/<snap-basename>.json (0600,
                  dir 0700, no symlinks): commit, base, tree, sha256 of
                  git ls-files -s -z (index) and of git status --porcelain=v1 -z
                  --untracked-files=all --ignored (status), sha256 of the
                  snapshot's git metadata (.git/config, hooks/, info/), diff
                  hash, input hashes, gitleaks (bool), a nonce. gitleaks is
                  REQUIRED for a blocking registry row, resolved to an absolute
                  path: snapshot itself still runs without it and records
                  gitleaks:false; gate refuses a blocking row at step preflight
                  (preflight_failed / gitleaks_missing, brew install gitleaks)
                  before it snapshots, and run refuses such a record on a
                  blocking row. On a warning row gate degrades — one stderr
                  warning line, stdout gitleaks:false. Every a1 git call on a
                  snapshot (and the runner's env) is hermetic: every inherited
                  GIT_* variable is dropped, then a1 sets GIT_CONFIG_GLOBAL=
                  /dev/null, GIT_CONFIG_NOSYSTEM, GIT_ATTR_NOSYSTEM,
                  GIT_NO_REPLACE_OBJECTS and the clone's own GIT_DIR,
                  GIT_COMMON_DIR, GIT_WORK_TREE; it pins core.fsmonitor=false,
                  core.hooksPath, core.attributesFile, core.excludesFile=
                  /dev/null, core.trustctime=true, core.checkStat=default,
                  core.untrackedCache=false via GIT_CONFIG_COUNT/KEY_n/VALUE_n.
                  The clone is built with an empty --template=. So no global
                  clean filter, include, template, replace ref or inherited
                  GIT_* can steer a check. The clone's .git must hold no
                  commondir, gitdir, objects/info/alternates, info/grafts,
                  refs/replace (loose or in packed-refs) and no include or
                  includeIf in its config; config, hooks, info, refs,
                  packed-refs and shallow are bound by the record's metadata
                  hash. The record also binds a git-free sha256 of every file
                  in the work tree (content_sha256, filter-independent).
                  Spec 014 secret patterns (appended): seven more named
                  patterns incl. env_assignment_unquoted (whole line NAME=value,
                  at least 12 characters of [A-Za-z0-9+/_.~=-] with a digit); all-letter
                  secrets pass this layer and rely on gitleaks (blocking rows).
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
                  Spec 014: --gate takes plan-review-xprov or wave-inspect-xprov
                  only (else exit 2). After the permit check \`run\` binds the
                  snapshot to its scan record: a direct snap-* child of
                  ~/.a1-xprov/snapshots by realpath (the realpath is used from
                  then on), a record that matches commit, base, tree, diff hash
                  and nonce, the same repository, unchanged git metadata, and for
                  a blocking row a gitleaks-checked scan. Refusals (exit 1, no
                  spawn): snapshot_not_scanned (not_under_snapshots_dir |
                  no_scan_record | record_mismatch | repo_mismatch),
                  snapshot_changed_after_scan (git_dir_forbidden_entry |
                  git_meta_mismatch | index_mismatch | untracked_or_modified_file |
                  content_mismatch | diff_mismatch (inspect) | record_mismatch
                  (HEAD moved); checked again, before the tripwire baseline and right
                  before the spawn), preflight_failed / gitleaks_missing.
                  The runner file must match both SHA256SUMS and the constant
                  RUNNER_SHA256 (else runner_failed, constant_mismatch); python3
                  and codex are resolved to absolute paths and codex is passed
                  as --cli. The runner's PATH drops empty and relative
                  entries and starts with the real git's directory.
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
                  --wave N counts from 0 (0..9999); --round and --timeout from 1.
                  A repository whose permit state is denied, on a registry row
                  with applies_to: permitted-repos, gets verdict not_applicable
                  (reason external_review_denied, exit 1, one log entry and one
                  xprov_not_applicable observation, no run); on an applies_to:
                  all row it fails external_review_not_permitted.
    load-check --phase <name> [--expect-sha <sha256>]
                  (xprov-gate.cjs, wave 6) newest plan-review-xprov pass entry
                  — counted only when its run dir in a1's artifacts holds a
                  completed APPROVED review of this PLAN.md — must match the
                  current PLAN.md sha256, or a waiver in the
                  guarded store ~/.a1-xprov/waivers.json must be bound to it
                  (accepted: pass|waiver) → else plan_review_missing.
                  --expect-sha: the sha accepted at Load; a different PLAN.md
                  now → plan_changed (a1-execute runs it before every wave).
                  A denied repository (applies_to: permitted-repos) → exit 0,
                  accepted: not_applicable (read from the permit state at check
                  time, never from an index row).
    wave-status --phase <name> [--waves 0,1,2 [--lane <id>]] [--work-path <dir>]
                [--lane-work-path <lane>=<dir>[,…]]
                  (xprov-gate.cjs, wave 6) waves are numbered from 0. A denied
                  repository (applies_to: permitted-repos) → exit 0 with every
                  completed wave under not_applicable, no chain computed.
                  Otherwise every completed wave needs a
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
    allowlist propose --commit <rev> [--json] [--scopes] [--repo <git-toplevel>]
                  (xprov-approve.cjs, wave 6b) every secret-pattern match at
                  <rev> as path:line:column, pattern, proposed class, masked
                  excerpt (first 4 characters + length), high_confidence —
                  never the matched text. --json prints a DRAFT allowlist with
                  empty reason fields. Never writes a file.
                  --scopes (spec 012 FR-024) groups the matches for an
                  allowlist v2: per (prefix, pattern) the count, the proposed
                  class and the heuristic kinds (env_reference, placeholder,
                  code_expression, unclassified), the high-confidence counts
                  (never scopable: v1 entries), the number of root-level
                  matches, and the path:line list (masked) of what the
                  heuristics could not classify. With --json: a DRAFT v2
                  document (entries [], one scope per pair, reasons empty).
    allowlist approve --repo <path> [--revoke <sha256>] [--by <name>]
                  --by (spec 016) is an optional plain name; the value owner-chat is
                  reserved for chat-written entries and rejected here (exit 2).
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
                  commit must touch nothing else; owner = decided_by.
                  Version 2 (spec 012, FR-019..FR-023) adds scopes: [{prefix,
                  pattern, class, max_count 1–2000, reason, reviewed_by,
                  added_on}] (top level exactly version 2, owner, entries,
                  scopes; at most 32 scopes, a separate cap). prefix = a
                  directory that is a tree at the anchor, ends in /, not the
                  root, no glob or escape; (prefix, pattern) unique; pattern is
                  never a high-confidence key shape. A scope covers a match
                  only on a line UNCHANGED between the anchor and the reviewed
                  commit (base side: anchor and --base); a match without a
                  line, in a binary, added, renamed or unparseable diff counts
                  as changed and takes the v1 path. Never the input side or
                  path names. Per (prefix, pattern) at most max_count covered
                  matches (longest matching prefix counts a match). Result and
                  XREVIEW.md: scoped_hits, scoped_uncovered — counts only.
                  scoped_uncovered.reason: changed_line, no_line, max_count,
                  diff_unreadable (git failed, binary or unparseable diff),
                  blob_mismatch (scanned bytes are not the committed blob),
                  git_timeout (each git read is bounded to 30 s).
                  A v2 blob needs its own approval; the typed count is
                  entries + scopes. Approval
                  store ~/.a1-xprov/allowlist-approvals.json (0600, dir 0700,
                  no symlinks): {"version":1,"repos":{"<realpath of
                  git-common-dir>":["<sha256 of the blob>", …]}}.
                  reason_detail: allowlist_anchor_unresolved,
                  allowlist_not_separate_commit, allowlist_owner_mismatch,
                  allowlist_unapproved. gitleaks hits and reviewer output are
                  never allowlisted.
    consent (spec 016, planned wave 2)
                  Not shipped yet: the dispatch entry exists, the module does not;
                  until then the command exits 2 ("not implemented yet"), which
                  keeps every consent path closed.
    scope --paths <file> | --base <sha> [--head <sha>] [--repo <git-toplevel>]
                  (spec 016 FR-015, FR-016; xprov-scope.cjs + xprov-scope-globs.json)
                  Deterministic, no LLM: classifies a path list (one path per line)
                  or the files of a git range (default --head HEAD, renames split
                  so both sides count) as security surface and as docs only.
                  stdout (exit 0): {version, security_surface, docs_only, total,
                  matched:[{path, category, glob}]}, matched sorted by path.
                  security_surface = auth/session/permission, payment, tenant/RLS,
                  migration and SQL, route/API, manifest and lockfile, secrets and
                  env templates, CI, deploy/Docker/Terraform, plus quick.cjs
                  FORBIDDEN_SURFACE_GLOBS (included by reference, never copied).
                  docs_only = every path is *.md, docs/** or LICENSE and nothing
                  is security surface. A path that cannot be classified (empty,
                  absolute, "..", NUL, over 4096 chars) counts as security surface,
                  category "unclassifiable". Matching is case-insensitive.
                  Any input or glob-file problem exits 2 with an empty stdout:
                  treat a non-zero exit as "guarded".
    dispose (spec 016, planned wave 9)
                  Not shipped yet (exit 2, "not implemented yet").
    waive --phase <name> --gate <id> [--wave <N> [--lane <id>] --base <sha>
          [--work-path <dir>]] --reason "<text>" --by <name>
                  (spec 016) --by owner-chat is reserved for chat-written entries
                  and rejected in the terminal commands permit, permit --deny and
                  waive (exit 2). Every owner write appends a hash-chained line to
                  ~/.a1-xprov/consent-audit.jsonl first.
                  (xprov-gate.cjs + xprov-waivers.cjs, wave 7; --wave 0 is valid) HUMAN-only, in a
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
                  external_review_not_permitted, external_review_denied,
                  external_review_denial_mismatch, external_review_permit_mismatch,
                  snapshot_failed, snapshot_not_scanned, snapshot_changed_after_scan,
                  run_home_unsafe, not_logged_in,
                  preflight_failed, plan_review_missing, wave_inspect_missing,
                  allowlist_invalid, allowlist_modified.
                  Paths a1 owns: ~/.a1-xprov/artifacts/<repo-slug>/ (0700,
                  runner --artifacts, never inside a checkout or under
                  A1_VAULT_ROOT), ~/.a1-xprov/snapshots/ (clones, removed after
                  normalize), .a1/phases/<name>/XREVIEW.md + xreview/*.json +
                  PLAN-REVIEW-LOG.md, .a1/xprov.json (permit record), ~/.a1-xprov/permits.json (owner permit store,
                  written only by permit), ~/.a1-xprov/scan-records/ (written by snapshot),
                  ~/.a1-xprov/allowlist-approvals.json (written only by
                  allowlist approve), ~/.a1-xprov/permit-denials.json (written
                  only by permit / permit --deny).
                  ENV: A1_XPROV_CODEX_HOME (optional; default ~/.codex-a1-review).
                  Fixture suite: _test-fixtures/a1-xprov/run-tests.sh (harness)
                  + parts/NN-<wave>.sh; runner fakes live in fake/, captured
                  runner records in cases/ (each with a .meta provenance file).`;

module.exports = { XPROV_HELP };
