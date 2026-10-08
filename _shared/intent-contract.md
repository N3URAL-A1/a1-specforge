# Intent contract for obsidian-lumen

The contract between a1 (the executor on the Mac, spec `011-intent-queue-consumer`) and
obsidian-lumen (the writer and renderer on every device, spec `002-control-panel`). a1 owns the
lifecycle. When this document and Lumen's spec disagree, this document wins, and the difference
goes through Lumen's Clarify (see [Deltas D1–D4](#deltas-d1d4)).

Two sources, one truth:

- **`a1-tools intent schema --json`** is the machine-readable contract: a JSON Schema (draft
  2020-12) of the intent frontmatter, the result note, the catalogs with render hints, the
  canonical signature fields and the limits. It is generated from the same constants the
  validator uses. It runs on any host, reads nothing and writes nothing.
- **This document** explains the contract. Every fenced block marked `<!-- contract:… -->` is
  checked against the code by `_test-fixtures/a1-intent/cases/09-schema.sh` (K5, K6), so a
  catalog change that does not update this file fails the suite.

Versions: the schema carries `x-contract-version` (this contract, currently `3`) and
`x-vault-contract-version` (spec 010's `VAULT_CONTRACT_VERSION`, currently `1`). a1 bumps
`x-contract-version` whenever the exported shape or a value changes. A Lumen build should
compare the number with the one it was built against and show "Schema-Version weicht ab" on a
mismatch instead of guessing. Version 2 (spec 011 round 6) added `target_sha256` for `approve`
intents, the value forms of a1's lifecycle keys, and the eighth refusal code `display_unsafe`.
Version 3 (spec 011 round 8) added the reject reason `intent_worktree_limit`, the result
keys `branch` and `worktree_path`, and the limit `INTENT_MAX_OPEN_WORKTREES` (3) in `x-limits`.

## Folders

All paths are relative to the vault root (`$A1_VAULT_ROOT`). There are exactly four lifecycle
folders:

<!-- contract:folders -->
```text
inbox/intents/queued/
inbox/intents/claimed/
inbox/intents/done/
inbox/intents/rejected/
```

- `running` is a **status inside `claimed/`**, not a folder. `failed` is a **status inside
  `done/`**, not a folder.
- The result note of a processed intent is `project/<slug>/intents/<id>.md`.
- a1 moves intents between the folders by atomic rename. Only a1 moves anything.
- Files whose name matches `/\(conflict[^)]*\)\.md$/` or contains `.sync-conflict-` are
  conflict copies. a1 never validates, claims, rejects, renames, edits or deletes them. Lumen
  lists them under "Konflikt-Kopien" and counts them in no state.

## What Lumen writes

Lumen writes exactly two kinds of file, both new, both into `inbox/intents/queued/`:

1. a **request intent** (`new-feature`, `continue-feature`, `plan`, `execute`, `fix`, `stage`,
   `progress`), created with `vault.create`;
2. a **queue-control intent** (`approve` or `cancel`), created the same way, with `target` set
   to the id of the intent it acts on.

The file name is `<id>.md`, where `<id>` is the intent's own `id`. The body is empty. The whole
file is at most `INTENT_MAX_BYTES` (8192) bytes and `payload` at most `INTENT_PAYLOAD_MAX_BYTES`
(6144) UTF-8 bytes. Lumen checks both on the raw string before it writes.

After the write, Lumen never touches the file again. It does not edit, rename, move or delete
it, not even to retry.

## What Lumen never writes

- anything in `inbox/intents/claimed/`, `inbox/intents/done/` or `inbox/intents/rejected/`;
- anything under `project/` (result notes are a1's);
- an existing file, in any folder, including its own earlier intents;
- any of these frontmatter keys, which only a1 writes:

<!-- contract:never-written -->
```json
[
  "claimed_by", "claimed_at", "started_at", "finished_at", "exit_code",
  "rejected_reason", "rejected_by", "rejected_at", "failure_reason", "cancelled_by_intent",
  "approved_from_device", "approved_at", "approved_via", "approved_by_intent"
]
```

The first ten are a1's lifecycle keys (`x-a1-only-keys`). A file in `queued/` that carries one
is rejected `schema_invalid`. The last four are the approval audit group (`x-approval-keys`). a1
writes them only when it approves an intent (see [Approval and cancel](#approval-and-cancel)).

## Where device secrets may live

Each paired device holds its own 32-byte secret (FR-011). With it, anyone can sign intents in
that device's name. The Mac's secret is the executor device's secret, the one that signs
`approve` intents. So a leaked Mac secret is a forged approval of anything.

- **Never under the vault.** A device secret is never stored in any file under the vault root:
  not in a note, not in a frontmatter key, not in a file Lumen creates, and not in
  `.obsidian/plugins/<id>/data.json`. That last file is what the plugin API's `saveData`
  writes, and Obsidian Sync replicates it like every other vault file. It reaches every device
  of the account and every other vault writer (plugins, the local REST API, agents on the Mac).
- **Not in plain browser storage either.** `localStorage` and `app.saveLocalStorage` keep the
  secret as plain text, readable by every other plugin in the same app. This tightens Lumen
  002's Clarify Q3 ("`app.saveLocalStorage`, never `data.json`"), and Lumen adopts it through
  its own Clarify.
- **Where it goes:** into the operating system's secure storage, through the platform: the
  macOS Keychain on the desktop (for example Electron `safeStorage`), the Android Keystore on
  the phone. If a platform offers no secure storage to the plugin, Lumen does not store the
  secret at all. It asks for it once per session and keeps it only in memory.
- **One secret per device.** Each device stores only its own secret. The phone never holds the
  Mac's secret; that is why the phone can never approve.
- The secret never appears in a log line, an error message, an intent file or a result note.
  Only the HMAC computed with it leaves the device.

The Mac checks the first rule: `a1-tools intent doctor` searches every file under the vault,
dot folders such as `.obsidian/` included, for every secret in `devices.json` (revoked ones
too: a leak is a leak), in exactly these spellings: the 64-character hex text in either case,
and base64 and base64url of the 32 raw bytes (compared without padding, so the padded form is
found too). It does **not** find other encodings: base64 of the hex text, hex with separators,
or a byte array. So the rule above is the protection, and the scan is only a check. If the scan
finds a secret, it fails the `secret_in_vault` check and exits 1. A symbolic link whose target
lies inside the vault is covered by the walk. A link that points out of the vault, is dead or
cannot be resolved is never followed; it is named as `unscanned_symlink: <path>` and fails the
check, so a link cannot hide a secret. Treat a hit as a leaked key: revoke the device
(`a1-tools intent device revoke <id>`) and pair it again.

## Intent frontmatter

Exactly these keys. Any other key, a missing required key or a non-empty body gives
`schema_invalid`. (The schema also lists the four approval audit keys as optional properties,
because a1 writes them into `queued/` when it approves. Lumen never writes them.)

| Key | Required | Form | Reason on violation |
|---|---|---|---|
| `type` | yes | `intent` | `schema_invalid` |
| `schema_version` | yes | integer `1` (unquoted) | `schema_invalid` |
| `id` | yes | lowercase RFC 4122 v4 UUID, equal to the file name without `.md` | `id_mismatch` |
| `action` | yes | one of the nine actions below | `action_unknown` |
| `project` | yes | `/^[a-z0-9][a-z0-9-]*$/`, an existing project on the Mac | `project_invalid` |
| `payload` | yes | string, written as a YAML block scalar `payload: \|` | `schema_invalid`, `oversized` |
| `target` | per action | see the action table | `target_invalid`, `target_not_found` |
| `target_sha256` | `approve` only | 64 lowercase hex, **quoted**; forbidden for every other action | `schema_invalid`, `target_not_found` |
| `created_at` | yes | ISO-8601 UTC with `Z`, a real calendar instant | `schema_invalid`, `stale` |
| `created_by` | yes | device id `/^[a-z0-9][a-z0-9-]{1,63}$/`, **quoted** | `schema_invalid`, `device_unknown` |
| `nonce` | yes | 32 lowercase hex characters (128 bit), **quoted** | `schema_invalid` |
| `status` | yes | `queued` (the only status Lumen ever writes) | `schema_invalid` |
| `signature` | yes | `hmac-sha256:<64 lowercase hex>` | `signature_invalid` |

The nine actions:

<!-- contract:actions -->
```json
["new-feature", "continue-feature", "plan", "execute", "fix", "stage", "progress", "approve", "cancel"]
```

`target` per action (the schema's `x-action-table`, which also names each action's `kind`):

| Action | `target` |
|---|---|
| `new-feature`, `fix`, `progress` | **absent**: the key must not appear at all, not even as `null` or `""` |
| `continue-feature` | spec id, `/^\d{3}-[a-z0-9][a-z0-9-]*$/` |
| `plan`, `execute` | phase name, `/^M\d+-P\d+-[a-z0-9][a-z0-9-]*$/` |
| `stage` | `<spec id>:<stage>`, stage ∈ `started complete review verify merge origin-cleanup done` |
| `approve`, `cancel` | the lowercase v4 UUID of another intent, never the intent's own `id` |

A complete intent as Lumen writes it. Its fields are those of the S1 vector below, so its
signature is the S1 signature:

<!-- contract:example-intent -->
```markdown
---
type: intent
schema_version: 1
id: 3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b
action: new-feature
project: real-proj
payload: |
  Push-Benachrichtigung bei neuem Auftrag
created_at: 2026-09-24T12:00:00.000Z
created_by: "pixel-robert"
nonce: "0f1e2d3c4b5a69788796a5b4c3d2e1f0"
status: queued
signature: hmac-sha256:18aa9d63d9cd70dac2bc0c8177b2d32e2587327e951fef71ff9bae77696bafb0
---
```

Signed with the secret `00…01` (63 zeros, then `1`), this file passes every rule except
freshness: `intent validate` reports exactly `stale`, because `created_at` lies in the past. A
fresh `created_at` needs a fresh signature.

## Canonical signature string

The signature is HMAC-SHA256 over the canonical string, keyed with the device secret, written
as `hmac-sha256:` plus 64 lowercase hex characters. The canonical string is these nine fields,
joined by `\n`, with **no** trailing newline:

```text
schema_version
id
action
project
target-or-empty
created_at
created_by
nonce
sha256hex(payload)
```

When the approval audit group is present (only in files a1 re-signed on approval), four more
fields follow the payload hash, in this order: `approved_from_device`, `approved_at`,
`approved_via`, `approved_by_intent`-or-empty. Lumen never writes the group.

For `action: approve` only, one more field sits between the payload hash and any group field:
`target_sha256`, as its 64-character hex text (`x-canonical-signature-approve`). So the order is
the nine fields, then `target_sha256` for an approve, then the group when present. Every other
action adds nothing, so for every non-approve intent Lumen signs, the string is exactly the nine
fields and the S1 vector below is unchanged.

`schema_version` is written in decimal (`1`). The canonicalisation function is `canonicalString`
in `_shared/lib/intent-sign.cjs`, exported through `_shared/lib/intent.cjs`.

**Worked example (the S1 vector).** For the example intent above, the canonical string is (one
field per line, no newline after the last):

<!-- contract:example-canonical -->
```text
1
3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b
new-feature
real-proj

2026-09-24T12:00:00.000Z
pixel-robert
0f1e2d3c4b5a69788796a5b4c3d2e1f0
d44c6af75fba4ec2d394ccdea93c260a30d1136805313cfde73375cd75e74fd7
```

The empty fifth line is the absent `target`. With the secret
`0000000000000000000000000000000000000000000000000000000000000001` the HMAC is:

<!-- contract:example-s1 -->
```text
18aa9d63d9cd70dac2bc0c8177b2d32e2587327e951fef71ff9bae77696bafb0
```

Reproduce it with openssl. Mind the key form: `-macopt hexkey:` passes the secret as raw bytes,
while plain `-hmac` would pass the 64 hex characters as ASCII text:

```sh
printf '%s' "$CANONICAL" | openssl dgst -sha256 -mac HMAC -macopt hexkey:0000000000000000000000000000000000000000000000000000000000000001
```

Lumen should carry this vector as a unit test of its signer.

**Worked example (an `approve` intent, ten fields).** Lumen desktop on the Mac approves the
intent `3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b`. It reads that target file's raw bytes once,
displays the target from exactly those bytes, and hashes the same bytes. `target_sha256` is
the sha256 of those bytes; it never re-reads the file for the hash. For illustration, the target
bytes here are the four ASCII bytes `test`, whose sha256 is `9f86d081…b0f00a08`. The payload is
`ok` plus a newline. The canonical string (from the fixture `vault/w10-approve-vector.md`) is:

<!-- contract:example-approve-canonical -->
```text
1
5b8e2f1a-3c4d-4e5f-8a9b-0c1d2e3f4a5b
approve
real-proj
3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b
2026-09-24T12:00:00.000Z
mac-robert
1f1e2d3c4b5a69788796a5b4c3d2e1f0
dc51b8c96c2d745df3bd5590d990230a482fd247123599548e0632fdbf97fc22
9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
```

The ninth line is the sha256 of the decoded payload `ok\n`, the tenth is `target_sha256`. With
the secret `00…01` (as raw bytes) the HMAC is:

<!-- contract:example-approve-hmac -->
```text
8967784a322df31cd2e16fcf6d6d4c87c0d88200b115fc4d2fc7a61303f0c2d0
```

If the target file's bytes change between Lumen's read and a1's apply step, a1 rejects the
approve with `target_not_found` and approves nothing.

## Signing rules

Four rules, each measured against the executor in waves 1–3 and published in the schema as
`x-signing-rules`.

**1. The HMAC key is the secret's 32 raw bytes, not its hex text.** The device secret is shown
once as 64 hex characters. Hex-decode it to 32 bytes and key the HMAC with those bytes. Keying
with the 64-character text gives a different signature, which a1 rejects as
`signature_invalid`. For the S1 string, the wrong key form (`openssl dgst -sha256 -hmac 00…01`)
gives:

<!-- contract:example-s1-wrong -->
```text
a8896dc5bd71795587e94a747bfa71f25fccd6a412a8fc2da730607abe41a966
```

**2. `target` absent, `target: null` and `target: ""` give the same canonical string.** All
three produce an empty fifth field. This rule is only about the canonical string. For
`new-feature`, `fix` and `progress` the key must still be **absent** from the file, because a
present `target` (even `null`) is `target_invalid`.

**3. `payload` is hashed after YAML decoding, with CRLF normalised to LF.** Hash the UTF-8 bytes
of the decoded string, never the raw file bytes. The block scalar

```yaml
payload: |
  a
  b
```

decodes to `a\nb\n` (with `|` the block keeps one final newline; `|-` would drop it). It decodes
the same when the file was saved with CRLF line endings, and its hash is:

<!-- contract:example-payload-hash -->
```text
911169ddaaf146aff539f58c26c489af3b892dff0fe283c1c264c65ae5aa59a2
```

**4. `nonce` and `created_by` are written as quoted YAML strings.** A value made only of decimal
digits parses as a number when unquoted, and a number fails `schema_invalid`. A random 128-bit
nonce is all digits about 3 times in 10 million. Quoting removes that case for every nonce:

```yaml
nonce: 12345678901234567890123456789012     # a number: schema_invalid
nonce: "12345678901234567890123456789012"   # a string: valid
```

## Reason codes

A processed intent carries its reason in the frontmatter: `rejected_reason` in `rejected/`,
`failure_reason` in `done/` with `status: failed`. Both catalogs are closed. Lumen renders a
code with the hint below. A code outside the catalog renders as "unbekannt" and is never
hidden. The hints are also in the schema as `x-render-hints`.

`rejected_reason`, 18 codes:

<!-- contract:rejected-reasons -->
```json
{
  "schema_invalid": "Notiz passt nicht zum Vertrag (Felder oder Format)",
  "id_mismatch": "Dateiname passt nicht zur id",
  "action_unknown": "unbekannte Aktion",
  "project_invalid": "Projekt nicht gefunden",
  "oversized": "zu groß: Text kürzen, dann erneut senden",
  "target_invalid": "Ziel fehlt oder hat die falsche Form",
  "target_not_found": "Ziel nicht gefunden",
  "approve_from_non_executor_device": "Freigabe nur am Mac möglich",
  "device_unknown": "wartet auf Freigabe",
  "signature_invalid": "wartet auf Freigabe",
  "stale": "erneut senden",
  "replay": "bereits verarbeitet (doppelt gesendet)",
  "not_executor_host": "nur der Mac führt Aufträge aus",
  "ledger_unreadable": "Auftragsbuch am Mac nicht lesbar; am Mac prüfen",
  "tampered": "nach dem Übernehmen verändert; am Mac prüfen",
  "cancelled_by_user": "abgebrochen",
  "workspace_not_isolated": "Intent-Worktree am Mac konnte nicht angelegt werden; Protokoll am Mac ansehen, dann erneut senden",
  "intent_worktree_limit": "zu viele offene Intent-Worktrees; am Mac prüfen und mit a1-worktree exit aufräumen, dann erneut senden"
}
```

`device_unknown` and `signature_invalid` are the codes an approval can fix on the Mac, so both
read "wartet auf Freigabe". Lumen's longer "wartet auf Freigabe am Mac" is the same state. A
`stale` intent is never approvable: it reads "erneut senden" (Lumen: "Abgelaufen — erneut
senden") and gets a fresh enqueue, never a "Freigeben" button.

`failure_reason`, 7 codes, for `status: failed`:

<!-- contract:failure-reasons -->
```json
{
  "timeout": "Zeitlimit überschritten",
  "expired": "nicht rechtzeitig gestartet; erneut senden",
  "spawn_error": "Start am Mac fehlgeschlagen",
  "nonzero_exit": "mit Fehler beendet; Ergebnisnotiz ansehen",
  "cancelled": "abgebrochen",
  "sandbox_invalid": "Sandbox-Prüfung am Mac fehlgeschlagen, `intent seal` prüfen",
  "parent_step_failed": "Prüfschritt am Mac fehlgeschlagen: Integritätsprüfung, xprov-Gate oder Postmortem; Protokoll am Mac ansehen"
}
```

**Refusal codes never appear in a file.** These eight codes exist only in a1's command output
and in its private log (`~/.a1-intents/log.jsonl`). Lumen never finds them in an intent or a
result note, so they have no render hint (schema: `x-refusal-codes`, disjoint from both
catalogs):

<!-- contract:refusal-codes -->
```json
["already_claimed", "already_moved", "ledger_busy", "project_busy", "executor_busy", "rate_limited", "result_path_unsafe", "display_unsafe"]
```

So Lumen renders exactly 18 `rejected_reason` and 7 `failure_reason` values.

## Result note

`project/<slug>/intents/<id>.md`, written by a1 when a request intent completes. Queue-control
intents (`approve`, `cancel`) never get one. The frontmatter keys, all always present
(`$defs.result` in the schema):

| Key | Form |
|---|---|
| `type` | `intent-result` |
| `schema_version` | `1` |
| `intent_id` | the intent's `id` |
| `action`, `project` | copied from the intent |
| `target` | copied, or `null` |
| `status` | `done` or `failed` |
| `failure_reason` | one of the 7 failure codes, or `null` |
| `started_at`, `finished_at` | ISO-8601 UTC (`started_at` may be `null`) |
| `duration_s`, `exit_code` | integer or `null` |
| `executor_host` | the Mac's host name |
| `branch` | for a write action (`new-feature`, `continue-feature`, `plan`, `execute`, `fix`) the intent worktree's branch `intent/<id>`; `null` for `progress` and `stage` and when no worktree was created |
| `worktree_path` | that worktree's folder, home-relative: `~/claude-projects/a1-worktrees/<project>-intent-<id>`; `null` where `branch` is |
| `artifacts` | list of vault-relative paths the run created or changed under `project/<slug>/` |
| `truncated` | `true` when output or artifacts were cut to fit the 16384-byte cap |

A write intent never runs in the owner's checkout: a1 creates a worktree of its own for it and
the child works there. The result note of a write intent names `branch` and `worktree_path`; the
work waits there for the owner's review. a1 never merges, pushes or removes that worktree or its
branch on its own; the owner cleans it up on the Mac with `a1-worktree exit`. While three
intent worktrees of a project are still open, the next write intent is rejected with
`intent_worktree_limit`.

The body has a `## Summary` (the child's final answer: for a Claude Code action the `result` text
of its JSON output, else the last lines of the filtered stdout) and a `## Stderr` section, each
in a fenced block. a1 filters known secret formats before writing, but the text is still the
child's output. Render it as text, never as HTML (see below).

## An intent is a request, never a status

**an intent is a request, never a status.** Project status is read from a1 artifacts, never
from intent files:

- the spec frontmatter `status:` (`project/<slug>/spec/*.md`);
- `docs/product/index.json`, or its spec-010 mirror `project/<slug>/product/index.json`;
- the `.a1/phases/*/STATUS.md` mirror under `project/<slug>/phases/`.

The intent file only tells whether the request was processed. Lumen derives the intent's UI
state from folder plus `status`: `queued/` + `queued` means eingereiht; `claimed/` + `claimed`
means übernommen; `claimed/` + `running` means läuft; `done/` + `done` means erledigt; `done/` +
`failed` means fehlgeschlagen, with `failure_reason`; `rejected/` + `rejected` means abgelehnt,
with `rejected_reason`. Any other combination renders as "unbekannt". For the reason and the
result, US-011-5 holds: `status`, `claimed_by`, `rejected_reason` and the result note's
`status`, `failure_reason` and `artifacts` are enough, without parsing a body.

## Approval and cancel

- **Approval** is expressed only by an `approve` intent **signed with the Mac's own device id**
  (the `executor_device` in the Mac's `~/.a1-intents/executor.json`), or by the TTY command
  `a1-tools intent approve <path>` on the Mac. From any other device, an `approve` intent is
  rejected `approve_from_non_executor_device`. The phone can never approve.
- **The owner commands refuse a Claude Code session.** `intent approve`, `intent seal` and
  `intent device add` need the owner at a terminal, and a terminal alone does not prove it (an
  agent gets one from `script`). Each also refuses, with the CLI reason `claude_code_context`
  (exit 1, nothing written, no secret printed), when a `CLAUDECODE`, `CLAUDE_PID` or
  `CLAUDE_CODE_*` variable is set or a Claude Code process is an ancestor. This is a CLI
  refusal, not one of the intent refusal codes below.
- An approvable target is in `rejected/` with `device_unknown` or `signature_invalid`, or still
  in `queued/`. a1 rewrites the **same** file (the `id` stays): `created_by` becomes the Mac's
  device, with a fresh `nonce`, `created_at` and signature, plus the approval audit group
  (`approved_from_device` = the original device, `approved_at`, `approved_via` = `intent` or
  `tty`, `approved_by_intent` = the approve intent's id, or `null` for `tty`). Then a1 moves the
  file to `queued/`. The group is all four keys or none, and it counts only under the Mac's
  device.
- **`approve` and `cancel` intents are never approval targets.** Both the TTY command and an
  `approve` intent refuse a target whose `action` is `approve` or `cancel`, with
  `target_invalid`. Otherwise one approval could turn a foreign approve or cancel into a valid
  one signed by the Mac, which would then act on a second intent whose content was never shown,
  or cancel a legitimate intent. Lumen offers no "Freigeben" button on `approve` or `cancel`
  intents.
- **A target that cannot be shown safely cannot be approved.** Lumen offers "Freigeben" only
  for targets whose displayed values pass a1's `display_unsafe` test (below); otherwise a1
  rejects the approve with `target_invalid`. On the TTY the same test answers with the refusal
  code `display_unsafe` (stdout and log only). The test covers the file name and the values of
  `action`, `project`, `target`, `created_by`, `rejected_reason` and `payload`. A target is
  display-unsafe when one of them contains:
  - a code point of category `Cf`, `Co`, `Cn`, `Zl` or `Zp`;
  - a tag character U+E0000–U+E007F, or one of the code points that render as nothing or as a
    blank although their category is printable: U+00AD, U+034F, U+115F–U+1160,
    U+17B4–U+17B5, U+180B–U+180F, U+2060–U+2064, U+2800, U+3164, U+FE00–U+FE0F, U+FFA0,
    U+E0100–U+E01EF;
  - an overlay mark (canonical combining class 1, it draws through its base: `=` plus U+0338
    reads as `≠`): U+0334–U+0338, U+1CD4, U+1CE2–U+1CE8, U+20D2–U+20D3, U+20D8–U+20DA,
    U+20E5–U+20E6, U+20EA–U+20EB, U+10A39, U+16AF0–U+16AF4, U+1BC9E, U+1D167–U+1D169;
  - more than 2 combining marks (`\p{M}`) in a row;
  - or when the payload is above `INTENT_PAYLOAD_MAX_BYTES`, because it could not be shown
    whole.
- The approval audit group records the path of an approval. It is not proof that the path was
  taken: every holder of the executor device secret, including Lumen desktop on the Mac, can
  write a validly signed group. That is one more reason the executor secret never leaves the
  Mac's secure storage (see [Where device secrets may live](#where-device-secrets-may-live)).
- **An `approve` intent is bound to the bytes the user saw.** It carries `target_sha256`, the
  sha256 of the target file's raw bytes exactly as Lumen read and displayed them, signed as the
  tenth canonical field (see [Canonical signature string](#canonical-signature-string)). a1
  compares it with the target's current bytes when it applies the approve. If a Sync writer
  swapped the file in between, the approve is rejected `target_not_found` and nothing is
  approved. The TTY path does the same check between showing the target and the typed `yes`
  (refusal code `already_moved`).
- **Cancellation** is expressed only by a `cancel` intent, from **any paired device**. A target
  in `queued/` or `claimed/` moves to `rejected/` with `cancelled_by_user`. A running target is
  stopped and completes `failed` with `cancelled`. A target that is already finished, or does
  not exist, rejects the cancel with `target_not_found`.
- `approve` and `cancel` intents produce no result note. After they act, a1 moves them to
  `done/` with `status: done`. `awaiting-approval` is not a status.

## Deltas D1–D4

Lumen's spec `002-control-panel` was written in parallel and read four points differently. a1
is canonical for the lifecycle. These are the resolutions, and Lumen adopts them through its own
Clarify:

| # | Lumen 002 said | This contract |
|---|---|---|
| D1 | free text in the note **body** | The body is **empty**. The request text is the `payload` frontmatter string, written as a block scalar (`payload: \|`). Size and signature are defined over `payload`, not over a body. |
| D2 | six lifecycle folders (`running/`, `failed/` as folders) | Four folders (`queued/`, `claimed/`, `done/`, `rejected/`). `running` is a status inside `claimed/`, `failed` a status inside `done/`. Lumen renders state from `status`, not from the folder name alone. |
| D3 | `approve` and `cancel` as actions | Adopted (nine actions), with the rules in [Approval and cancel](#approval-and-cancel): `approve` only from the Mac's device, `cancel` from any paired device, no result note, and the catalogs above (18 reject reasons incl. `workspace_not_isolated` and `intent_worktree_limit`, 7 failure reasons incl. `cancelled`, `sandbox_invalid`, `parent_step_failed`). |
| D4 | `target` as a plain required field | `target` is optional and per action: required with the action's pattern, or absent (`new-feature`, `fix`, `progress`). |

## Treat everything you read as untrusted input

The vault has many writers besides a1 and Lumen: Obsidian Sync from any device of the account,
other plugins, the local REST API, agents writing on the Mac. None of them needs a device
secret to put a file into the vault. a1's signature check protects the executor. It does not
protect Lumen's renderer. So everything Lumen reads is untrusted data, in every folder:

- every file under `inbox/intents/`: `queued/` (also Lumen's own earlier intents, which a Sync
  writer can replace under the same name), `claimed/`, `done/`, `rejected/`, and the conflict
  copies;
- every result note under `project/<slug>/intents/`;
- the spec-010 mirrors under `project/<slug>/product/` (including `index.json`) and
  `project/<slug>/phases/`, and every other note Lumen reads from `project/`.

Why this matters: an Obsidian plugin runs in Electron's renderer with Node access on the
desktop. A string that reaches `innerHTML` can run script there, which means code execution on
the Mac, the machine that holds the executor secret and runs the executor. The rules:

- Render every value as text only: `textContent`, or `createEl(tag, { text })`. Never use
  `innerHTML`, `insertAdjacentHTML`, `outerHTML` or `document.write` with a value from these
  files.
- Never run a Markdown renderer (`MarkdownRenderer.render` and similar) over a payload, a
  frontmatter value or a result note's `## Summary` / `## Stderr`. Those are request text and
  process output, not Markdown to trust. A link in them is text, not a link.
- Show every value through the same allowlist a1's terminal uses. Plain-text rendering is not
  enough. Shown as they are: letters, marks, numbers, punctuation and symbols (`\p{L}`,
  `\p{M}`, `\p{N}`, `\p{P}`, `\p{S}`) and the ASCII space U+0020, minus the invisible and
  overlay code points listed under [Approval and cancel](#approval-and-cancel). Every other
  code point is shown escaped as `\u{hex}`, never raw. That includes the bidi controls, the
  zero-width characters, tabs, a line break in any value but the payload (whose lines are
  shown as lines), the no-break space U+00A0, U+3000 and every other `Zs` space. a1 writes a
  backslash itself as two backslashes, so an escape is never ambiguous. Show the payload's
  length, and show the whole payload, never silently cut. This matters most on the Mac, where
  an approval is decided on what the screen shows.
- Validate before rendering: a code outside the catalog renders as "unbekannt". A value that
  does not match its form in the schema is shown as "unbekannt", not as-is. A list is capped
  before rendering. Since contract version 2, a1's `validate` also checks the forms of its own
  lifecycle keys in `claimed/`, `done/` and `rejected/` (`$defs.processed_intent`). A file in
  those folders can still have been replaced by another writer after a1 wrote it, so Lumen
  keeps its own check.
- Treat paths from `artifacts` only as links inside the vault (reject `..`, absolute paths and
  URLs), never as something to open outside Obsidian.
- The size check on read runs on the raw string before YAML parsing, as on write.

## Validating on the client

The root of `intent schema --json` validates the frontmatter of a `queued/` file.
`$defs.processed_intent` validates `claimed/`, `done/` and `rejected/` files.
`$defs.result` validates result notes. The schema uses `format: "date-time"` as an assertion
(with ajv: `ajv-formats`) together with a `pattern` that requires the `Z` suffix. What the
schema cannot express is listed in `x-not-expressible`, and the file-level rules are in
`x-file-rules`: byte cap before parsing, empty body, file name `<id>.md`, payload byte cap.
The limits in `x-limits` are a1's defaults. The Mac may tighten the security limits among
them (size caps, freshness, clock skew), never loosen them, so a note within the defaults is
refused at worst, never trusted more.

The fixture suite checks this schema against the executor. An independent validator
(`_test-fixtures/a1-intent/cases/mini-schema-validate.cjs`) gives the same accept/reject
decision as `intent validate` on every fixture intent (SC-009).

## Consumer hand-off

- Lumen's `CLAUDE.md` line 97 ("a1 vault-first spec") points to a repo-local learning path.
  The correct location of a1's specs is `$A1_VAULT_ROOT/project/a1-specforge/spec/`.
- Lumen spec `002-control-panel` `## Write contract` references this document for the key set,
  the folders and the catalogs instead of restating them.
