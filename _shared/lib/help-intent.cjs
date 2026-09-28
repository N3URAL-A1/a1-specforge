'use strict';

// help-intent — the help text of the `intent` command group (spec
// 011-intent-queue-consumer), kept out of help.cjs for its 800-line cap the
// same way help-vault.cjs is. help.cjs interpolates INTENT_HELP after the
// vault block; every other line of --help is unchanged. Written once in
// Wave 1 for all 13 subcommands (Wave 5b added seal); later waves change
// wording only if a flag changes.

const INTENT_HELP = `  a1-tools intent <sub> [flags]
                  Spec 011-intent-queue-consumer. Consumes signed intent notes
                  that obsidian-lumen writes into
                  $A1_VAULT_ROOT/inbox/intents/queued/<id>.md and runs one a1
                  action per note on the executor Mac only. Lifecycle folders:
                  queued/ -> claimed/ -> done/ | rejected/ (running is a status
                  inside claimed/, failed a status inside done/). Result notes:
                  project/<slug>/intents/<id>.md. State outside the vault:
                  ~/.a1-intents/ (devices.json, executor.json, executor.lock,
                  locks/, runs/, log.jsonl, tmp/), ~/.a1-intents-ledger.json and
                  the sealed plugin copy in ~/.a1-intents-seal/.
                  Exit contract shared by EVERY intent subcommand (differs from
                  the facade default below): 0 ok/valid · 1 refused/invalid,
                  stdout JSON names the reason code(s) · 2 usage error OR a
                  subcommand whose module has not shipped yet ("intent <sub>:
                  not implemented yet (wave N)") — no stdout on 2. Human text
                  goes to stderr only; stdout is the machine contract.
                  Reason codes: schema_invalid, id_mismatch, action_unknown,
                  project_invalid, oversized, target_invalid, target_not_found,
                  approve_from_non_executor_device, device_unknown,
                  signature_invalid, stale, replay, not_executor_host,
                  ledger_unreadable, tampered, cancelled_by_user,
                  workspace_not_isolated. Failure reasons (status: failed):
                  timeout, expired, spawn_error, nonzero_exit, cancelled,
                  sandbox_invalid, parent_step_failed. Refusal codes (stdout
                  and log only, never in an intent file): already_claimed,
                  already_moved, ledger_busy, project_busy, executor_busy,
                  rate_limited, result_path_unsafe.
                  Child mode (A1_INTENT_CHILD=1, or a live executor.lock of the
                  passwd home whose pid is an ancestor; the context — action,
                  project, vault root — comes only from that lock): every
                  a1-tools command outside the action's allowlist or with a
                  path outside the project exits 77 with {ok:false, error:
                  "intent_child_refused", reason, detail}.
                  ENV (fixtures only, never forwarded to a child):
                  A1_INTENT_<LIMIT>, e.g. A1_INTENT_TIMEOUT_MS=2000, overrides
                  one numeric limit (MAX_BYTES 8192, PAYLOAD_MAX_BYTES 6144,
                  FRESHNESS_MS 15 min, CLOCK_SKEW_MS 2 min, TIMEOUT_MS 30 min,
                  KILL_GRACE_MS 10 s, MAX_RUNS_PER_HOUR 6, CLAIMED_MAX_AGE_MS
                  6 h, RESULT_MAX_BYTES 16384, TICK_INTERVAL_S 30,
                  CANCEL_POLL_MS 5 s); a non-integer value warns on stderr and
                  keeps the default.
  a1-tools intent validate <path>
                  (wave 1, any host) <path> must be a .md file whose realpath
                  lies under $A1_VAULT_ROOT/inbox/intents/ (else exit 2, file
                  not read). Prints {valid, reasons[], intent?: {id, action,
                  project, target, created_by}}; exit 0 valid, 1 invalid.
                  Checks: exactly the keys type, schema_version, id, action,
                  project, payload, target (optional), created_at, created_by,
                  nonce, status, signature, an empty body, type: intent,
                  schema_version: 1 (schema_invalid); id a lowercase v4 UUID
                  equal to the filename stem (id_mismatch); action one of
                  new-feature, continue-feature, plan, execute, fix, stage,
                  progress, approve, cancel (action_unknown); project a slug
                  whose realpath is a directory inside ~/claude-projects/
                  (project_invalid). Never renames, writes or spawns anything.
  a1-tools intent device add <device-id> [--qr] | device revoke <device-id>
                  (wave 3) provision or revoke a device secret in
                  ~/.a1-intents/devices.json (0600). add prints the secret once
                  and only to a TTY; never writes into the vault.
  a1-tools intent claim <path>
                  (wave 4, executor host only) <path> must lie in queued/.
                  Under ~/.a1-intents/ledger.lock: full validation, replay
                  check against ~/.a1-intents-ledger.json, atomic rename
                  queued/ -> claimed/, then status: claimed, claimed_by,
                  claimed_at appended (key order kept), ledger row. Exit 1
                  with the validate reasons, replay, already_claimed (lost a
                  concurrent claim, nothing written), ledger_unreadable
                  (corrupt ledger, fail closed), ledger_busy or
                  not_executor_host. Exit 2 when devices.json or
                  executor.json is corrupt (operator error, nothing moved).
  a1-tools intent reject <path> --reason <code>
                  (wave 4, executor host only) queued/ or claimed/ ->
                  rejected/<filename> with status: rejected, rejected_reason,
                  rejected_by, rejected_at; a file that does not parse gets
                  that header prepended. Only catalog codes (else exit 2,
                  nothing moved). validate, claim and reject each append one
                  line to ~/.a1-intents/log.jsonl (never the payload).
  a1-tools intent complete <path> --exit-code <n> --stdout <file> --stderr <file>
                  [--snapshot <file>] [--failure-reason <code>]
                  (wave 5, executor host only) --stdout and --stderr must be
                  private 0600 files directly in ~/.a1-intents/runs/<id>/ of
                  the intent's own id (else exit 2). <path> must lie in claimed/ and
                  match its open ledger row (claimed_sha256), else exit 1
                  tampered. Writes the result note
                  project/<slug>/intents/<id>.md (15 keys, last 40 stdout and
                  20 stderr lines, every secret pattern -> [REDACTED] before any
                  cut, <= 16384 bytes, truncated flag; artifacts = files changed
                  under project/<slug>/ since --snapshot), moves claimed/ ->
                  done/ with status done|failed, closes the ledger row.
                  --exit-code 0-255, or null with a --failure-reason (timeout,
                  expired, spawn_error, cancelled); exit != 0 without one is
                  nonzero_exit. approve/cancel intents: exit 2, no note.
  a1-tools intent run <path>
                  (wave 6, executor host only) re-validates a claimed/ intent
                  (ledger row, sha256, signature, freshness) and spawns its
                  action from the sealed plugin copy: claude -p with the
                  measured sandbox argv (argv guard before every spawn),
                  env built from nothing, payload on stdin only; stage runs
                  the sealed a1-tools product stage. Write actions run in
                  their own worktree ~/claude-projects/a1-worktrees/
                  <project>-intent-<id> on branch intent/<id>, kept for
                  review (at most 3 open per project: intent_worktree_limit).
                  Global and per-project lock; exit 0 spawned, 1 nothing
                  spawned, 2 usage. Wave 7 adds the hourly cap and the hard
                  timeout with process-group kill.
  a1-tools intent tick
                  (wave 8, executor host only) one executor pass: reject or
                  claim every queued/ intent oldest-first, apply approve and
                  cancel, run at most one claimed intent.
  a1-tools intent watch --interval <s>
                  (wave 8, executor host only) loops tick.
  a1-tools intent list [--state queued|claimed|done|rejected|ignored|all]
                  (wave 8, any host) JSON rows per intent file; Sync conflict
                  copies are listed as ignored, edited a1 files as tampered.
  a1-tools intent schema --json
                  (wave 9, any host) JSON Schema (draft 2020-12) of the intent
                  frontmatter ($defs.processed_intent for claimed/, done/,
                  rejected/; $defs.result for the result note), both reason
                  catalogs with render hints, the refusal codes, the canonical
                  signature fields and signing rules, the phone-visible action
                  table and the default limits, stamped x-contract-version.
                  Exactly one flag, --json (else exit 2); reads and writes
                  nothing. Explained for Lumen in _shared/intent-contract.md.
  a1-tools intent doctor
                  (wave 10, any host, read-only, no arguments) executor
                  config, non-revoked device ids, community plugins, the Sync
                  flag, the TCP listeners of the whole Obsidian process tree
                  (main process, helpers, their children; ps/lsof by absolute
                  path),
                  active A1_INTENT_* variables, and checks[]. Exit 1 when
                  ~/.a1-intents or ~/.a1-intents-seal is not a private 0700
                  dir, devices.json, executor.json, log.jsonl or the ledger is
                  not a private 0600 file (or a symlink), an Obsidian listener
                  is bound beyond loopback (e.g. *:58589), a provisioned secret
                  is in a vault file (hex, base64 or base64url) or a symlink
                  in the vault cannot be scanned, or an A1_INTENT_* override
                  is set. Never repairs, never prints a secret.
  a1-tools intent approve <path>
                  (wave 10, executor host only, interactive TTY only — --yes
                  exit 2, non-TTY stdin or stdout exit 1) shows action,
                  project, target, the unverified sender and the WHOLE
                  payload with its length on /dev/tty (everything outside
                  letters, marks, numbers, punctuation, symbols and the ASCII
                  space escaped as \\u{hex}), discards type-ahead, asks
                  "Approve? (yes/no)"; on "yes" re-signs a rejected/
                  device_unknown|signature_invalid or a queued/ intent with
                  the executor device (id kept, fresh nonce/created_at,
                  approval audit group, a1-only keys removed) and moves it
                  into queued/ (never over an existing file). Refused: other
                  targets (target_not_found), approve/cancel intents
                  (target_invalid), invisible, format or overlay characters
                  or more than two combining marks in a row in a shown value,
                  or a payload above the cap (display_unsafe).
  a1-tools intent seal
                  (wave 5b, executor host only, interactive TTY only — no
                  --yes) copies the installed a1-specforge plugin read-only
                  (files 0444, dirs 0555) to ~/.a1-intents-seal/<version>-
                  <12 hex>/ with a sha256 manifest and writes
                  ~/.a1-intents-seal/empty-mcp.json; run verifies it before every
                  spawn. B1 measured WIDENS (2026-09-28): every skill's
                  allowed-tools is rewritten to its row list. Re-run after
                  every plugin update.
  a1-tools git status|diff|add|commit|log [args]
                  (wave 6, intent child mode only; exit 2 outside it) git for
                  the child of a write intent, per action allowlist. Fixed
                  grammar: status [--porcelain[=v1]] [--short] · diff
                  [--cached|--staged] [--stat] [--name-only] [-- <path>…] ·
                  add <path>… · commit -m <message> · log [-n <N>] [--oneline]
                  [-- <path>…]; every path inside the project. Runs /usr/bin/git
                  with fsmonitor, hooks, external diff, pager, credential
                  helper, system and global config switched off; anything
                  else exits 77 subcommand_not_allowed, git never runs.
  a1-tools intent install-agent
                  (wave 11, executor host only) installs the launchd agent
                  ai.n3ural.a1-intent-tick that runs tick every 30 s.`;

module.exports = { INTENT_HELP };
