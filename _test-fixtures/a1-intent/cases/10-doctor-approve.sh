#!/usr/bin/env bash
# cases/10-doctor-approve.sh — spec 011 Wave 10: the approval audit group in
# the validator and the canonical string, the interactive `intent approve`,
# and the read-only `intent doctor`. Sourced by run-tests.sh.
#
# RED proof (CONVENTIONS.md): the single production change that turns each
# case red, each measured on a `git archive HEAD` copy before commit.
#   A5  checking only that each present group key has a valid form (A5b–d:
#       partial groups pass); dropping the key-set admission (A5a: the
#       complete group is schema_invalid).
#   A5f value forms: accepting any `approved_via` (A5f1), not pairing
#       `approved_by_intent` with `approved_via` (A5f2/A5f3), no timestamp
#       rule for approved_at (A5f4), no device rule (A5f5).
#   A6  comparing `created_by` with "any provisioned device" (A6a); treating
#       a missing executor.json as "no rule" (A6b).
#   A7  leaving the group out of canonicalString (A7a–d); appending anything
#       when it is absent (A7a no-group vector, A7e: S1 changes).
#   A1  reusing the old nonce (A1 nonce), writing a new id (A1 id), leaving
#       rejected_reason in the file (A1 keys), signing with the phone's
#       secret (A1 verify), writing through io.writeMdAtomic (A1 lines:
#       the original lines move), not renaming out of rejected/ (A1 moved).
#   A1b treating any answer but "no" as yes.
#   A2  honouring `--yes`.
#   A3  dropping the TTY check (A3a: stdin not a TTY; A3b: stdout not a TTY).
#   A4  approving any rejected file (A4a: oversized), accepting done/ (A4b),
#       refusing queued/ targets (A4c).
#   A8  printing the untrusted payload raw on the terminal (ESC reaches it).
#   A9  skipping the host check before the target is shown (A9: the payload
#       reaches the terminal) or in reapproveIntent (A9b: it re-signs).
#   A10 approving without comparing the bytes shown with the bytes signed.
#   A11 reapproveIntent ignoring `via: intent` (by_intent stays null).
#   A12 dropping the validation of the re-signed bytes before the write.
#   D1  checking existence instead of mode bits (devices.json 0644 passes).
#   D2  matching 0.0.0.0 only and not `*` (D2a); calling lsof without
#       `-a -p <pid>` (D2c argv); treating an lsof failure as "no listener"
#       (D2d).
#   D3  scanning only inbox/intents/ (D3a); printing the secret (D3c).
#   D4  leaking secret_hex into `devices` (D4); listing revoked devices.
#   D5  checking only devices.json and executor.json (D5a–e).
#   D6  not reporting A1_INTENT_* overrides (D6a).
#   D7  repairing a mode, or creating ~/.a1-intents (D7a/D7b).
#   D8  reading the Sync flag from community-plugins.json (D8).

W10_HOST="$(node -e 'process.stdout.write(require("os").hostname())')"
W10_ZERO_SIG="hmac-sha256:0000000000000000000000000000000000000000000000000000000000000000"
W10_APPROVE_ID="9c4d2b7a-1e3f-4a5b-8c6d-7e8f9a0b1c2d"

w10_sandbox() {
  new_sandbox "$1"
  mk_project real-proj
  set_executor "$W10_HOST"
  W10_R="$VAULT/inbox/intents/rejected"
  W10_D="$VAULT/inbox/intents/done"
  W10_LOG="$FHOME/.a1-intents/log.jsonl"
}

# w10_node <js> [args...] — JS with a guarded require `req(<module>)` over
# _shared/lib, inside the sandbox HOME and vault. argv = the extra args.
w10_node() {
  local js="$1"
  shift
  HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node -e "
    const lib = process.argv[1];
    const fs = require('fs');
    const path = require('path');
    const req = (m) => require(lib + '/' + m);
    const shaOf = (f) => require('crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    const argv = process.argv.slice(2);
    $js" "$INTENT_LIB" "$@" 2>&1
}

# w10_fm <file> <key> — one frontmatter value as JSON (strict parser).
w10_fm() {
  w10_node 'const { parseIntentFrontmatter } = req("intent-parse.cjs");
    const p = parseIntentFrontmatter(fs.readFileSync(argv[0], "utf8"));
    process.stdout.write(p.ok ? JSON.stringify(p.fm[argv[1]] === undefined ? "<absent>" : p.fm[argv[1]]) : "<unparsable>");' "$1" "$2"
}

# w10_rejected <reason> [mk_intent args...] — a queued intent with a bad
# signature (or an unknown device), rejected by `intent reject`; prints the
# rejected/ path.
w10_rejected() {
  local reason="$1" f
  shift
  f="$(mk_intent signature="$W10_ZERO_SIG" "$@")"
  run_intent reject "$f" --reason "$reason"
  printf '%s' "$W10_R/$(basename "$f")"
}

# w10_approve_pty <answer> <path> [extra args] — `intent approve` on a
# pseudo-terminal, <answer> typed on it. Output (stdout + stderr, the pty
# merges them) in $SB/.pty, exit code in PTY_RC, the JSON line in PTY_JSON.
w10_approve_pty() {
  local answer="$1"
  shift
  local cmd=(env HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent approve "$@")
  : >"$SB/.pty"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    w10_feed "$answer" | script -q /dev/null "${cmd[@]}" >"$SB/.pty" 2>&1
  else
    w10_feed "$answer" | script -qec "$(printf '%q ' "${cmd[@]}")" /dev/null >"$SB/.pty" 2>&1
  fi
  PTY_RC=$?
  PTY_JSON="$(tr -d '\r' <"$SB/.pty" | grep -o '{"approved":.*}$' | tail -n 1)"
  W10_EARLY=""
  W10_EARLY_NONL=""
  W10_HOOK=""
}
W10_EARLY=""
W10_EARLY_NONL=""
W10_HOOK=""

# w10_feed <answer> — the pty's keyboard. Types $W10_EARLY at once (type-
# ahead, before anything is shown; $W10_EARLY_NONL the same without Enter), waits until the prompt is on the pty or
# the command has ended, runs $W10_HOOK (e.g. an edit of the target between
# display and answer), then types <answer>. Answers are typed only after the
# prompt, as a person would (the command discards anything typed before).
w10_feed() {
  local answer="$1" i=0
  [[ -n "$W10_EARLY" ]] && printf '%s\n' "$W10_EARLY" 2>/dev/null
  [[ -n "$W10_EARLY_NONL" ]] && printf '%s' "$W10_EARLY_NONL" 2>/dev/null
  while [[ $i -lt 150 ]]; do
    grep -qE 'Approve\? \(yes/no\)|"approved":|usage error|[Nn]othing (was written|changed)' "$SB/.pty" 2>/dev/null && break
    sleep 0.1
    i=$((i + 1))
  done
  [[ -n "$W10_HOOK" ]] && eval "$W10_HOOK"
  printf '%s\n' "$answer" 2>/dev/null
  sleep 1
}

# ---------- A5–A7: the approval audit group in the validator (FR-045) ----------

W10_GROUP_TTY=(approved_from_device=pixel-robert 'approved_at="2026-09-24T12:05:00.000Z"' approved_via=tty approved_by_intent=null)

w10_sandbox w10-a5
F="$(mk_intent created_by=mac-robert "${W10_GROUP_TTY[@]}")"
run_intent validate "$F"
expect_verdict "A5a complete tty group, executor-signed, in queued/ is valid [FR-045]" 0 ""
F="$(mk_intent created_by=mac-robert approved_from_device=pixel-robert 'approved_at="2026-09-24T12:05:00.000Z"' approved_via=intent approved_by_intent="$W10_APPROVE_ID")"
run_intent validate "$F"
expect_verdict "A5a2 complete intent group with a v4 UUID is valid [FR-045]" 0 ""
F="$(mk_intent created_by=mac-robert approved_from_device=pixel-robert)"
run_intent validate "$F"
expect_verdict "A5b one of four group keys -> schema_invalid [FR-045]" 1 "schema_invalid"
F="$(mk_intent created_by=mac-robert approved_from_device=pixel-robert approved_via=tty)"
run_intent validate "$F"
expect_verdict "A5c two of four group keys -> schema_invalid [FR-045]" 1 "schema_invalid"
F="$(mk_intent created_by=mac-robert approved_from_device=pixel-robert 'approved_at="2026-09-24T12:05:00.000Z"' approved_via=tty)"
run_intent validate "$F"
expect_verdict "A5d three of four group keys -> schema_invalid [FR-045]" 1 "schema_invalid"

# A5e — the group is allowed in every folder: a rejected/ file carrying it.
F="$(mk_intent created_by=mac-robert "${W10_GROUP_TTY[@]}" status=rejected rejected_reason=stale rejected_by=mac 'rejected_at="2026-09-24T12:06:00.000Z"')"
mv "$F" "$W10_R/"
run_intent validate "$W10_R/$(basename "$F")"
expect_verdict "A5e complete group in rejected/ is valid [FR-045]" 0 ""

w10_sandbox w10-a5f
F="$(mk_intent created_by=mac-robert approved_from_device=pixel-robert 'approved_at="2026-09-24T12:05:00.000Z"' approved_via=phone approved_by_intent=null)"
run_intent validate "$F"
expect_verdict "A5f1 approved_via phone -> schema_invalid [FR-045]" 1 "schema_invalid"
F="$(mk_intent created_by=mac-robert approved_from_device=pixel-robert 'approved_at="2026-09-24T12:05:00.000Z"' approved_via=tty approved_by_intent="$W10_APPROVE_ID")"
run_intent validate "$F"
expect_verdict "A5f2 approved_via tty with a UUID -> schema_invalid [FR-045]" 1 "schema_invalid"
F="$(mk_intent created_by=mac-robert approved_from_device=pixel-robert 'approved_at="2026-09-24T12:05:00.000Z"' approved_via=intent approved_by_intent=null)"
run_intent validate "$F"
expect_verdict "A5f3 approved_via intent with null -> schema_invalid [FR-045]" 1 "schema_invalid"
F="$(mk_intent created_by=mac-robert approved_from_device=pixel-robert 'approved_at="2026-09-24 12:05:00"' approved_via=tty approved_by_intent=null)"
run_intent validate "$F"
expect_verdict "A5f4 approved_at not ISO-8601 UTC -> schema_invalid [FR-045]" 1 "schema_invalid"
F="$(mk_intent created_by=mac-robert approved_from_device=Pixel_Robert 'approved_at="2026-09-24T12:05:00.000Z"' approved_via=tty approved_by_intent=null)"
run_intent validate "$F"
expect_verdict "A5f5 approved_from_device outside the device regex -> schema_invalid [FR-045]" 1 "schema_invalid"
F="$(mk_intent created_by=mac-robert approved_from_device=pixel-robert 'approved_at="2026-09-24T12:05:00.000Z"' approved_via=intent approved_by_intent=9C4D2B7A-1E3F-4A5B-8C6D-7E8F9A0B1C2D)"
run_intent validate "$F"
expect_verdict "A5f6 approved_by_intent uppercase UUID -> schema_invalid [FR-045]" 1 "schema_invalid"

w10_sandbox w10-a6
F="$(mk_intent created_by=pixel-robert "${W10_GROUP_TTY[@]}")"
run_intent validate "$F"
expect_verdict "A6a complete group under the phone device (validly signed) -> schema_invalid [FR-045]" 1 "schema_invalid"
F="$(mk_intent created_by=mac-robert "${W10_GROUP_TTY[@]}")"
rm -f "$FHOME/.a1-intents/executor.json"
run_intent validate "$F"
expect_verdict "A6b complete group on a host without executor.json -> schema_invalid [FR-045]" 1 "schema_invalid"
F="$(mk_intent created_by=mac-robert)"
run_intent validate "$F"
expect_verdict "A6c no group, executor-signed, no executor.json: still valid [FR-045]" 0 ""

# A7 — frozen vectors, computed with openssl (-mac HMAC -macopt hexkey:00…01)
# over the extended canonical string of vault/w10-vector.md; never with the
# code under test.
w10_sandbox w10-a7
cp "$SUITE_DIR/vault/w10-vector.md" "$SB/vec.md"
GOT="$(w10_node 'const { parseIntentFrontmatter } = req("intent-parse.cjs"); const { sign } = req("intent-sign.cjs");
  const fm = parseIntentFrontmatter(fs.readFileSync(argv[0], "utf8")).fm; const k = "0".repeat(63) + "1";
  const variant = Object.assign(Object.create(null), fm, { approved_via: "intent", approved_by_intent: argv[1] });
  const none = Object.create(null); for (const key of Object.keys(fm)) if (!key.startsWith("approved_")) none[key] = fm[key];
  process.stdout.write([sign(fm, k), sign(variant, k), sign(none, k)].join(" "));' "$SB/vec.md" "$W10_APPROVE_ID")"
WANT="hmac-sha256:110529b36afd4677b9531fd0d2978f722447064be01fba7508a4c90d0ea0d8d1 hmac-sha256:81fe196d1cf49f7991eba58d5a810e796fd0702354b9aacaa15cccc53ce4dfe3 hmac-sha256:4669e2102d35e90fabfde59f8d84938e9c5a3a44edac4e62afcead4efbc6bfce"
if [[ "$GOT" == "$WANT" ]]; then ok "A7a frozen vectors: tty group, intent group, no group [FR-045]"
else bad "A7a frozen vectors: tty group, intent group, no group [FR-045]" "got: $GOT"; fi

# A7e — S1 of 03-signature.sh, pinned again here: vault/valid.md (no group)
# signs to the same frozen hex after the group was added to canonicalString.
GOT="$(w10_node 'const { parseIntentFrontmatter } = req("intent-parse.cjs"); const { sign } = req("intent-sign.cjs");
  process.stdout.write(sign(parseIntentFrontmatter(fs.readFileSync(argv[0], "utf8")).fm, "0".repeat(63) + "1"));' "$SUITE_DIR/vault/valid.md")"
if [[ "$GOT" == "hmac-sha256:18aa9d63d9cd70dac2bc0c8177b2d32e2587327e951fef71ff9bae77696bafb0" ]]; then ok "A7e S1 unchanged: a file without the group signs as before [FR-045, FR-010]"
else bad "A7e S1 unchanged: a file without the group signs as before [FR-045, FR-010]" "got: $GOT"; fi

F="$(mk_intent created_by=mac-robert "${W10_GROUP_TTY[@]}")"
node -e 'const fs = require("fs"); const f = process.argv[1]; fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("approved_via: tty", "approved_via: intent").replace("approved_by_intent: null", "approved_by_intent: " + process.argv[2]))' "$F" "$W10_APPROVE_ID"
run_intent validate "$F"
expect_verdict "A7b approved_via flipped tty -> intent after signing -> signature_invalid [FR-045]" 1 "signature_invalid"
F="$(mk_intent created_by=mac-robert "${W10_GROUP_TTY[@]}")"
node -e 'const fs = require("fs"); const f = process.argv[1]; fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("12:05:00.000Z", "12:06:00.000Z"))' "$F"
run_intent validate "$F"
expect_verdict "A7c approved_at changed after signing -> signature_invalid [FR-045]" 1 "signature_invalid"
F="$(mk_intent created_by=mac-robert "${W10_GROUP_TTY[@]}")"
node -e 'const fs = require("fs"); const f = process.argv[1]; fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("approved_from_device: pixel-robert", "approved_from_device: ghost-phone"))' "$F"
run_intent validate "$F"
expect_verdict "A7d approved_from_device changed after signing -> signature_invalid [FR-045]" 1 "signature_invalid"

# ---------- A1–A4, A8–A11: `intent approve` (FR-015) ----------

w10_sandbox w10-a1
RJ="$(w10_rejected signature_invalid)"
ID="$(basename "$RJ" .md)"
cp "$RJ" "$SB/before.md"
OLD_NONCE="$(w10_fm "$RJ" nonce)"
w10_approve_pty yes "$RJ"
NEW="$Q/$ID.md"
if [[ "$PTY_RC" -eq 0 && -f "$NEW" && ! -e "$RJ" ]]; then ok "A1 moved: exit 0, same id in queued/, gone from rejected/ [FR-015]"
else bad "A1 moved: exit 0, same id in queued/, gone from rejected/ [FR-015]" "rc $PTY_RC, queued: $(ls "$Q")" "pty: $(tr -d '\r' <"$SB/.pty" | tail -n 5)"; fi
GOT="$(w10_node 'const { parseIntentFrontmatter } = req("intent-parse.cjs");
  const p = parseIntentFrontmatter(fs.readFileSync(argv[0], "utf8")); if (!p.ok) { process.stdout.write("<unparsable>"); process.exit(0); }
  process.stdout.write(Object.keys(p.fm).sort().join(","));' "$NEW")"
WANT="action,approved_at,approved_by_intent,approved_from_device,approved_via,created_at,created_by,id,nonce,payload,project,schema_version,signature,status,type"
if [[ "$GOT" == "$WANT" ]]; then ok "A1 keys: the eleven intent keys plus the group, no a1-only key [FR-015]"
else bad "A1 keys: the eleven intent keys plus the group, no a1-only key [FR-015]" "got: $GOT"; fi
GOT="$(w10_node 'const { parseIntentFrontmatter } = req("intent-parse.cjs");
  const fm = parseIntentFrontmatter(fs.readFileSync(argv[0], "utf8")).fm;
  const fresh = Math.abs(Date.now() - Date.parse(fm.created_at)) < 120000 && fm.approved_at === fm.created_at;
  process.stdout.write([fm.id === argv[1], fm.created_by, fm.approved_from_device, fm.approved_via, JSON.stringify(fm.approved_by_intent), fm.status, fresh, /^[0-9a-f]{32}$/.test(fm.nonce)].join(" "));' "$NEW" "$ID")"
if [[ "$GOT" == "true mac-robert pixel-robert tty null queued true true" ]]; then ok "A1 id: id kept, executor device, group values, fresh created_at [FR-015]"
else bad "A1 id: id kept, executor device, group values, fresh created_at [FR-015]" "got: $GOT"; fi
if [[ -f "$NEW" && "$(w10_fm "$NEW" nonce)" != "$OLD_NONCE" ]]; then ok "A1 nonce: a fresh nonce [FR-015]"
else bad "A1 nonce: a fresh nonce [FR-015]" "old $OLD_NONCE new $(w10_fm "$NEW" nonce)"; fi
GOT="$(w10_node 'const { parseIntentFrontmatter } = req("intent-parse.cjs"); const { verify } = req("intent-sign.cjs");
  const fm = parseIntentFrontmatter(fs.readFileSync(argv[0], "utf8")).fm;
  process.stdout.write([verify(fm, argv[1]), verify(fm, argv[2])].join(" "));' "$NEW" "$FIXTURE_EXECUTOR_SECRET" "$FIXTURE_SECRET")"
if [[ "$GOT" == "true false" ]]; then ok "A1 verify: signed with the executor secret, not the phone's [FR-015]"
else bad "A1 verify: signed with the executor secret, not the phone's [FR-015]" "got: $GOT"; fi
# Line-preserving rewrite: the original key lines up to the payload block stay
# byte for byte and in their order at the top.
if [[ -f "$NEW" && "$(sed -n 1,7p "$SB/before.md")" == "$(sed -n 1,7p "$NEW")" ]]; then ok "A1 lines: the original lines stay in place [FR-015]"
else bad "A1 lines: the original lines stay in place [FR-015]" "$(diff <(sed -n 1,7p "$SB/before.md") <(sed -n 1,7p "$NEW") | head -n 6)"; fi
run_intent validate "$NEW"
expect_verdict "A1 validate: the re-queued file validates [FR-015]" 0 ""
if node -e 'const l = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse).filter((e) => e.command === "approve");
  process.exit(l.length === 1 && l[0].outcome === "approved" && l[0].intent_id === process.argv[2] && !JSON.stringify(l).includes("Push-") ? 0 : 1)' "$W10_LOG" "$ID" 2>/dev/null; then
  ok "A1 log: one approve line, outcome approved, no payload [FR-015]"
else bad "A1 log: one approve line, outcome approved, no payload [FR-015]" "$(grep approve "$W10_LOG" 2>/dev/null | head -n 2)"; fi
if grep -q 'Push-Benachrichtigung' "$SB/.pty" && grep -q 'new-feature' "$SB/.pty" && grep -q 'real-proj' "$SB/.pty"; then ok "A1 shown: action, project and payload on the terminal [FR-015]"
else bad "A1 shown: action, project and payload on the terminal [FR-015]" "$(tr -d '\r' <"$SB/.pty" | head -n 8)"; fi

w10_sandbox w10-a1b
RJ="$(w10_rejected signature_invalid)"
cp "$RJ" "$SB/before.md"
w10_approve_pty no "$RJ"
if [[ "$PTY_RC" -eq 1 && -f "$RJ" ]] && cmp -s "$RJ" "$SB/before.md" && [[ -z "$(ls "$Q")" ]]; then ok "A1b answer no: exit 1, nothing changed [FR-015]"
else bad "A1b answer no: exit 1, nothing changed [FR-015]" "rc $PTY_RC, queued: $(ls "$Q")"; fi
RJ2="$(w10_rejected signature_invalid)"
cp "$RJ2" "$SB/before2.md"
w10_approve_pty y "$RJ2"
if [[ "$PTY_RC" -eq 1 ]] && cmp -s "$RJ2" "$SB/before2.md"; then ok "A1b answer y (not yes): exit 1, nothing changed [FR-015]"
else bad "A1b answer y (not yes): exit 1, nothing changed [FR-015]" "rc $PTY_RC"; fi

w10_sandbox w10-a1c
RJ="$(w10_rejected device_unknown created_by=ghost-phone)"
ID="$(basename "$RJ" .md)"
w10_approve_pty yes "$RJ"
if [[ "$PTY_RC" -eq 0 && -f "$Q/$ID.md" && "$(w10_fm "$Q/$ID.md" approved_from_device)" == '"ghost-phone"' ]]; then ok "A1c device_unknown target approved, approved_from_device = the unknown device [FR-015]"
else bad "A1c device_unknown target approved, approved_from_device = the unknown device [FR-015]" "rc $PTY_RC" "pty: $(tr -d '\r' <"$SB/.pty" | tail -n 4)"; fi

w10_sandbox w10-a2
RJ="$(w10_rejected signature_invalid)"
BEFORE="$(tree_listing "$VAULT")"
run_intent approve "$RJ" --yes </dev/null
expect_usage "A2a approve <path> --yes -> exit 2 [FR-015]"
run_intent approve --yes "$RJ" </dev/null
expect_usage "A2b approve --yes <path> -> exit 2 [FR-015]"
w10_approve_pty yes "$RJ" --yes
if [[ "$PTY_RC" -eq 2 && "$(tree_listing "$VAULT")" == "$BEFORE" ]]; then ok "A2c --yes on a TTY still exit 2, queued/ empty [FR-015]"
else bad "A2c --yes on a TTY still exit 2, queued/ empty [FR-015]" "rc $PTY_RC"; fi

w10_sandbox w10-a3
RJ="$(w10_rejected signature_invalid)"
BEFORE="$(tree_listing "$VAULT")"
run_intent approve "$RJ" </dev/null
if [[ "$RC" -eq 1 && "$(tree_listing "$VAULT")" == "$BEFORE" && "$ERR" == *TTY* ]]; then ok "A3a approve < /dev/null -> exit 1, nothing written [FR-015]"
else bad "A3a approve < /dev/null -> exit 1, nothing written [FR-015]" "rc $RC" "stderr: ${ERR:0:200}"; fi
# stdin on the pty, stdout into a file: still refused. The answer is typed
# only after a prompt would appear, so a command that skipped the stdout
# check would really be approved here.
: >"$SB/.pty"
if [[ "$(uname -s)" == "Darwin" ]]; then
  w10_feed yes | script -q /dev/null bash -c 'env HOME="$1" A1_VAULT_ROOT="$2" node "$3" "$1" - "$4" intent approve "$5" >"$6"; echo "rc=$?"' _ "$FHOME" "$VAULT" "$A1_AS" "$A1_TOOLS" "$RJ" "$SB/a3b.out" >"$SB/.pty" 2>&1
else
  w10_feed yes | script -qec "$(printf '%q ' bash -c 'env HOME="$1" A1_VAULT_ROOT="$2" node "$3" "$1" - "$4" intent approve "$5" >"$6"; echo "rc=$?"' _ "$FHOME" "$VAULT" "$A1_AS" "$A1_TOOLS" "$RJ" "$SB/a3b.out")" /dev/null >"$SB/.pty" 2>&1
fi
if grep -q 'rc=1' "$SB/.pty" && grep -q 'must be a TTY' "$SB/.pty" && [[ "$(tree_listing "$VAULT")" == "$BEFORE" ]]; then ok "A3b stdout not a TTY -> exit 1, nothing written [FR-015]"
else bad "A3b stdout not a TTY -> exit 1, nothing written [FR-015]" "$(tr -d '\r' <"$SB/.pty" | tail -n 3)"; fi

w10_sandbox w10-a4
F="$(mk_intent)"
cp "$SUITE_DIR/vault/oversized.md" "$Q/ov.md"
run_intent reject "$Q/ov.md" --reason oversized
w10_approve_pty yes "$W10_R/ov.md"
if [[ "$PTY_RC" -eq 1 && "$PTY_JSON" == *target_not_found* && -f "$W10_R/ov.md" ]]; then ok "A4a rejected oversized -> exit 1 target_not_found [FR-015]"
else bad "A4a rejected oversized -> exit 1 target_not_found [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi
RS="$(w10_rejected stale)"
w10_approve_pty yes "$RS"
if [[ "$PTY_RC" -eq 1 && "$PTY_JSON" == *target_not_found* && -f "$RS" ]]; then ok "A4a2 rejected stale -> exit 1 target_not_found [FR-015]"
else bad "A4a2 rejected stale -> exit 1 target_not_found [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi
DN="$(mk_intent signature="$W10_ZERO_SIG")"
mv "$DN" "$W10_D/"
DN="$W10_D/$(basename "$DN")"
w10_approve_pty yes "$DN"
if [[ "$PTY_RC" -eq 1 && "$PTY_JSON" == *target_not_found* && -f "$DN" ]]; then ok "A4b a done/ file -> exit 1 target_not_found [FR-015]"
else bad "A4b a done/ file -> exit 1 target_not_found [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi
w10_approve_pty yes "$W10_R/no-such-intent.md"
if [[ "$PTY_RC" -eq 1 && "$PTY_JSON" == *target_not_found* ]]; then ok "A4b2 a missing file -> exit 1 target_not_found [FR-015]"
else bad "A4b2 a missing file -> exit 1 target_not_found [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi
QF="$(mk_intent signature="$W10_ZERO_SIG")"
w10_approve_pty yes "$QF"
if [[ "$PTY_RC" -eq 0 && -f "$QF" && "$(w10_fm "$QF" created_by)" == '"mac-robert"' ]]; then ok "A4c a queued/ target is re-signed in place [FR-015]"
else bad "A4c a queued/ target is re-signed in place [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi
run_intent validate "$QF"
expect_verdict "A4c2 the re-signed queued/ file validates [FR-015]" 0 ""

# A8 — an ESC sequence in the payload never reaches the terminal raw.
w10_sandbox w10-a8
RJ="$(w10_rejected signature_invalid "payload=$(printf '|\n  Harmlos \033[2J\033]0;owned\007 ende')")"
w10_approve_pty no "$RJ"
if grep -q 'Harmlos' "$SB/.pty" && ! LC_ALL=C grep -q "$(printf '\033\\[2J')" "$SB/.pty" && ! LC_ALL=C grep -q "$(printf '\007')" "$SB/.pty"; then ok "A8 control characters of the payload are escaped on the terminal [FR-015]"
else bad "A8 control characters of the payload are escaped on the terminal [FR-015]" "$(tr -d '\r' <"$SB/.pty" | cat -v | head -n 6)"; fi

w10_sandbox w10-a9
RJ="$(w10_rejected signature_invalid)"
set_executor "some-other-host"
BEFORE="$(tree_listing "$VAULT")"
w10_approve_pty yes "$RJ"
if [[ "$PTY_RC" -eq 1 && "$PTY_JSON" == *not_executor_host* && "$(tree_listing "$VAULT")" == "$BEFORE" ]] && ! grep -q 'Push-Benachrichtigung' "$SB/.pty"; then ok "A9 not the executor host -> exit 1 not_executor_host, nothing shown, nothing written [FR-015]"
else bad "A9 not the executor host -> exit 1 not_executor_host, nothing shown, nothing written [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi
GOT="$(w10_node 'const r = req("intent-approve.cjs").reapproveIntent(argv[0], { via: "intent", approveId: argv[1], expectSha256: shaOf(argv[0]) });
  process.stdout.write([r.exitCode, (r.out && r.out.reasons || []).join(",")].join(" "));' "$RJ" "$W10_APPROVE_ID")"
if [[ "$GOT" == "1 not_executor_host" && "$(tree_listing "$VAULT")" == "$BEFORE" ]]; then ok "A9b reapproveIntent on a non-executor host -> exit 1 not_executor_host [FR-015]"
else bad "A9b reapproveIntent on a non-executor host -> exit 1 not_executor_host [FR-015]" "got: $GOT"; fi

# A10 — the bytes shown are the bytes signed: a file changed after it was
# shown is refused (library call, the change is injected between the two).
w10_sandbox w10-a10
RJ="$(w10_rejected signature_invalid)"
GOT="$(w10_node 'const A = req("intent-approve.cjs");
  const shown = A.readApprovalTarget(argv[0]);
  fs.writeFileSync(argv[0], fs.readFileSync(argv[0], "utf8").replace("Push-Benachrichtigung", "Etwas anderes"));
  const r = A.reapproveIntent(argv[0], { via: "tty", approveId: null, expectSha256: shown.sha256 });
  process.stdout.write([r.exitCode, (r.out && r.out.reasons || []).join(",")].join(" "));' "$RJ")"
if [[ "$GOT" == "1 already_moved" && -f "$RJ" && -z "$(ls "$Q")" ]]; then ok "A10 content changed after it was shown -> exit 1 already_moved [FR-015]"
else bad "A10 content changed after it was shown -> exit 1 already_moved [FR-015]" "got: $GOT"; fi

# A12 — an invalid rewrite moves nothing: the target authenticates only
# after re-signing, and then its project does not resolve (project_invalid).
w10_sandbox w10-a12
RJ="$(w10_rejected signature_invalid project=ghost-proj)"
cp "$RJ" "$SB/before.md"
w10_approve_pty yes "$RJ"
if [[ "$PTY_RC" -eq 1 && "$PTY_JSON" == *project_invalid* && -z "$(ls "$Q")" ]] && cmp -s "$RJ" "$SB/before.md"; then ok "A12 re-signed bytes invalid (project_invalid) -> exit 1, nothing written or moved [FR-015]"
else bad "A12 re-signed bytes invalid (project_invalid) -> exit 1, nothing written or moved [FR-015]" "rc $PTY_RC json $PTY_JSON queued: $(ls "$Q")" "pty: $(tr -d '\r' <"$SB/.pty" | tail -n 4)"; fi

# A11 — the shared routine for the approve intent of tick (Wave 8).
w10_sandbox w10-a11
RJ="$(w10_rejected signature_invalid)"
ID="$(basename "$RJ" .md)"
GOT="$(w10_node 'const A = req("intent-approve.cjs");
  const r = A.reapproveIntent(argv[0], { via: "intent", approveId: argv[1], expectSha256: shaOf(argv[0]) });
  process.stdout.write(String(r.exitCode));' "$RJ" "$W10_APPROVE_ID")"
if [[ "$GOT" == "0" && "$(w10_fm "$Q/$ID.md" approved_via)" == '"intent"' && "$(w10_fm "$Q/$ID.md" approved_by_intent)" == "\"$W10_APPROVE_ID\"" ]]; then ok "A11 via intent writes approved_by_intent = the approve id [FR-015]"
else bad "A11 via intent writes approved_by_intent = the approve id [FR-015]" "got: $GOT"; fi
run_intent validate "$Q/$ID.md"
expect_verdict "A11b the intent-approved file validates [FR-045]" 0 ""
GOT="$(w10_node 'const A = req("intent-approve.cjs");
  const r = A.reapproveIntent(argv[0], { via: "intent", approveId: "not-a-uuid" });
  process.stdout.write(String(r.exitCode));' "$Q/$ID.md" 2>&1)"
if [[ "$GOT" == "2" ]]; then ok "A11c via intent without a v4 approve id -> exit 2 [FR-015]"
else bad "A11c via intent without a v4 approve id -> exit 2 [FR-015]" "got: $GOT"; fi

# ---------- security review of waves 9–10: approve (B2, M1, M2, M7, minors) ----------

# w10_cp <hex...> — the code points as UTF-8 text (no escapes in this file).
w10_cp() { node -e 'process.stdout.write(process.argv.slice(1).map((h) => String.fromCodePoint(parseInt(h, 16))).join(""))' "$@"; }

# w10_raw_count <file> <hex...> — how many of these code points occur raw.
w10_raw_count() {
  node -e 'const t = require("fs").readFileSync(process.argv[1], "utf8"); const set = new Set(process.argv.slice(2).map((h) => parseInt(h, 16)));
    process.stdout.write(String([...t].filter((c) => set.has(c.codePointAt(0))).length));' "$@"
}

# B2a — one payload per class of invisible code point: refused before
# anything is shown (display_unsafe), nothing written, one log line; none of
# the characters reaches the terminal.
w10_sandbox w10-b2
for cls in "e0069:tag" "2060:word-joiner" "ad:soft-hyphen" "3164:hangul-filler" "115f:hangul-choseong-filler" "34f:grapheme-joiner" "200b:zero-width-space" "202e:bidi-override" "fe0f:variation-selector" "e000:private-use" "378:unassigned" "2028:line-separator"; do
  cp_hex="${cls%%:*}"
  RJ="$(w10_rejected signature_invalid "payload=|
  Harmlos$(w10_cp "$cp_hex")ende")"
  cp "$RJ" "$SB/before.md"
  w10_approve_pty yes "$RJ"
  if [[ "$PTY_RC" -eq 1 && "$PTY_JSON" == *display_unsafe* && "$(w10_raw_count "$SB/.pty" "$cp_hex")" == "0" && -z "$(ls "$Q")" ]] && cmp -s "$RJ" "$SB/before.md" && ! grep -q 'Approve?' "$SB/.pty"; then
    ok "B2a payload with U+$cp_hex (${cls##*:}) -> exit 1 display_unsafe, not shown, nothing written [FR-015]"
  else bad "B2a payload with U+$cp_hex (${cls##*:}) -> exit 1 display_unsafe, not shown, nothing written [FR-015]" "rc $PTY_RC json $PTY_JSON raw $(w10_raw_count "$SB/.pty" "$cp_hex")"; fi
done
if node -e 'const l = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse).filter((e) => e.command === "approve" && e.reason === "display_unsafe"); process.exit(l.length === 12 ? 0 : 1)' "$W10_LOG" 2>/dev/null; then ok "B2b each display_unsafe refusal is one log line [FR-015]"
else bad "B2b each display_unsafe refusal is one log line [FR-015]" "$(grep -c display_unsafe "$W10_LOG" 2>/dev/null)"; fi
# The same in a displayed field other than the payload (target of a queued/ file).
QF="$(mk_intent signature="$W10_ZERO_SIG" "target=x$(w10_cp e0041)")"
w10_approve_pty yes "$QF"
if [[ "$PTY_RC" -eq 1 && "$PTY_JSON" == *display_unsafe* ]]; then ok "B2c a tag character in target -> display_unsafe [FR-015]"
else bad "B2c a tag character in target -> display_unsafe [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi

# B2d — C1 controls, DEL, ESC and a backslash are shown escaped (the
# allowlist), never raw; the owner still gets the prompt (they are visible
# once escaped).
w10_sandbox w10-b2d
RJ="$(w10_rejected signature_invalid "payload=|
  A$(w10_cp 9b)2JB$(w10_cp 85)C$(w10_cp 7f)D$(w10_cp 1b)[2JE\\u{41}F")"
w10_approve_pty no "$RJ"
GOT="$(w10_raw_count "$SB/.pty" 9b 85 7f 1b)"
if [[ "$GOT" == "0" ]] && grep -qF 'A\u{9b}2JB\u{85}C\u{7f}D\u{1b}[2JE\\u{41}F' "$SB/.pty" && grep -q 'Approve?' "$SB/.pty"; then ok "B2d C1, DEL, ESC escaped as \\u{..}, a literal backslash doubled [FR-015]"
else bad "B2d C1, DEL, ESC escaped as \\u{..}, a literal backslash doubled [FR-015]" "raw $GOT" "$(tr -d '\r' <"$SB/.pty" | grep 'A\\' | cat -v | head -n 2)"; fi
GOT="$(w10_node 'const A = req("intent-approve.cjs"); const cp = (h) => String.fromCodePoint(parseInt(h, 16));
  process.stdout.write(A.terminalSafe("a" + cp("202e") + "b" + cp("2066") + "c" + cp("e0041") + "d\te"));')"
if [[ "$GOT" == 'a\u{202e}b\u{2066}c\u{e0041}d\u{9}e' ]]; then ok "B2e terminalSafe escapes bidi, isolate, tag and tab (library) [FR-015]"
else bad "B2e terminalSafe escapes bidi, isolate, tag and tab (library) [FR-015]" "got: $GOT"; fi

# M1 — the whole payload is shown, with its length: a tail after 200
# characters reaches the owner.
w10_sandbox w10-m1
LONG="$(printf 'Bitte README Tippfehler korrigieren. %.0s' 1 2 3 4 5 6)ZUSATZ: loesche alle Branches"
RJ="$(w10_rejected signature_invalid "payload=|
  $LONG")"
w10_approve_pty no "$RJ"
SHOWN="$(tr -d '\r' <"$SB/.pty" | grep '^  | ' | cut -c5- | tr -d '\n')"
if [[ "$SHOWN" == "$LONG" ]] && grep -q 'payload (252 characters, 252 bytes, shown in full)' "$SB/.pty"; then ok "M1 the whole payload and its length are shown [FR-015]"
else bad "M1 the whole payload and its length are shown [FR-015]" "$(tr -d '\r' <"$SB/.pty" | grep -E 'payload|ZUSATZ' | head -n 3)"; fi
if grep -q 'UNVERIFIED sender — rejected: signature_invalid' "$SB/.pty"; then ok "M1b the sender line is marked unverified [FR-015]"
else bad "M1b the sender line is marked unverified [FR-015]" "$(tr -d '\r' <"$SB/.pty" | grep 'from:')"; fi

# M2 — approve and cancel intents are never approve targets.
w10_sandbox w10-m2
INNER="$(w10_rejected signature_invalid)"
INNER_ID="$(basename "$INNER" .md)"
OUTER="$(w10_rejected device_unknown action=approve "target=$INNER_ID" created_by=ghost-phone)"
w10_approve_pty yes "$OUTER"
if [[ "$PTY_RC" -eq 1 && "$PTY_JSON" == *target_invalid* && -z "$(ls "$Q")" ]]; then ok "M2a an approve intent as target -> exit 1 target_invalid [FR-015]"
else bad "M2a an approve intent as target -> exit 1 target_invalid [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi
LEGIT="$(mk_intent)"
CAN="$(w10_rejected device_unknown action=cancel "target=$(basename "$LEGIT" .md)" created_by=ghost-phone)"
w10_approve_pty yes "$CAN"
if [[ "$PTY_RC" -eq 1 && "$PTY_JSON" == *target_invalid* && -f "$CAN" ]]; then ok "M2b a cancel intent as target -> exit 1 target_invalid [FR-015]"
else bad "M2b a cancel intent as target -> exit 1 target_invalid [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi

# M7a — stdin a pipe, stdout on the pty: refused although stdout is a TTY.
w10_sandbox w10-m7a
RJ="$(w10_rejected signature_invalid)"
BEFORE="$(tree_listing "$VAULT")"
if [[ "$(uname -s)" == "Darwin" ]]; then
  { sleep 1; } | script -q /dev/null bash -c 'echo yes | env HOME="$1" A1_VAULT_ROOT="$2" node "$3" "$1" - "$4" intent approve "$5"; echo "rc=$?"' _ "$FHOME" "$VAULT" "$A1_AS" "$A1_TOOLS" "$RJ" >"$SB/.pty" 2>&1
else
  { sleep 1; } | script -qec "$(printf '%q ' bash -c 'echo yes | env HOME="$1" A1_VAULT_ROOT="$2" node "$3" "$1" - "$4" intent approve "$5"; echo "rc=$?"' _ "$FHOME" "$VAULT" "$A1_AS" "$A1_TOOLS" "$RJ")" /dev/null >"$SB/.pty" 2>&1
fi
if grep -q 'rc=1' "$SB/.pty" && grep -q 'must be a TTY' "$SB/.pty" && [[ "$(tree_listing "$VAULT")" == "$BEFORE" ]]; then ok "M7a stdin a pipe, stdout a TTY -> exit 1, nothing written [FR-015]"
else bad "M7a stdin a pipe, stdout a TTY -> exit 1, nothing written [FR-015]" "$(tr -d '\r' <"$SB/.pty" | tail -n 3)"; fi

# M7b — the file changes between display and "yes" (CLI level).
w10_sandbox w10-m7b
RJ="$(w10_rejected signature_invalid)"
W10_HOOK="node -e 'const fs = require(\"fs\"); const f = process.argv[1]; fs.writeFileSync(f, fs.readFileSync(f, \"utf8\").replace(\"Push-Benachrichtigung\", \"Etwas anderes\"))' \"$RJ\""
w10_approve_pty yes "$RJ"
if [[ "$PTY_RC" -eq 1 && "$PTY_JSON" == *already_moved* && -z "$(ls "$Q")" ]] && grep -q 'Etwas anderes' "$RJ"; then ok "M7b changed between display and yes -> exit 1 already_moved, nothing written [FR-015]"
else bad "M7b changed between display and yes -> exit 1 already_moved, nothing written [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi

# M7c — queued/<name> already exists (a file, or a dangling symlink).
w10_sandbox w10-m7c
RJ="$(w10_rejected signature_invalid)"
N="$(basename "$RJ")"
printf 'already here\n' >"$Q/$N"
cp "$RJ" "$SB/before.md"
w10_approve_pty yes "$RJ"
if [[ "$PTY_RC" -eq 1 && "$PTY_JSON" == *already_moved* && "$(cat "$Q/$N")" == "already here" ]] && cmp -s "$RJ" "$SB/before.md" && [[ "$(ls -a "$Q" | wc -l | tr -d ' ')" == "3" ]]; then ok "M7c an existing queued/<name> -> exit 1 already_moved, both files unchanged, no tmp left [FR-015]"
else bad "M7c an existing queued/<name> -> exit 1 already_moved, both files unchanged, no tmp left [FR-015]" "rc $PTY_RC json $PTY_JSON queued: $(ls -a "$Q")"; fi
mv "$Q/$N" "$SB/occupied.md"
ln -s /nonexistent/target "$Q/$N"
w10_approve_pty yes "$RJ"
if [[ "$PTY_RC" -eq 1 && "$PTY_JSON" == *already_moved* && -L "$Q/$N" ]]; then ok "M7d a dangling symlink at queued/<name> is not replaced -> already_moved [FR-015]"
else bad "M7d a dangling symlink at queued/<name> is not replaced -> already_moved [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi

# m1a — the approve step runs under the ledger lock: held by another holder,
# it refuses ledger_busy and writes nothing.
w10_sandbox w10-m1a
RJ="$(w10_rejected signature_invalid)"
GOT="$(w10_node 'const A = req("intent-approve.cjs"); const G = req("intent-ledger.cjs");
  const r = G.withLedgerLock(() => A.reapproveIntent(argv[0], { via: "intent", approveId: argv[1], expectSha256: shaOf(argv[0]) }));
  process.stdout.write([r.exitCode, (r.out && r.out.reasons || []).join(",")].join(" "));' "$RJ" "$W10_APPROVE_ID")"
if [[ "$GOT" == "1 ledger_busy" && -f "$RJ" && -z "$(ls "$Q")" ]]; then ok "m1a approve while the ledger lock is held -> ledger_busy, nothing written [FR-015]"
else bad "m1a approve while the ledger lock is held -> ledger_busy, nothing written [FR-015]" "got: $GOT"; fi

# m3 — an error outside the catalog: exit 2, one stderr line, no stack.
w10_sandbox w10-m3
RJ="$(w10_rejected signature_invalid)"
GOT="$(w10_node 'const A = req("intent-approve.cjs");
  const r = A.reapproveIntent(argv[0], { via: "intent", approveId: argv[1], expectSha256: shaOf(argv[0]) }, { randomBytes: () => { throw new Error("entropy gone\n    at stack line"); } });
  process.stdout.write(JSON.stringify([r.exitCode, r.stderr]));' "$RJ" "$W10_APPROVE_ID")"
if [[ "$GOT" == '[2,"intent approve: internal error (entropy gone); nothing was written"]' && -f "$RJ" && -z "$(ls "$Q")" ]]; then ok "m3 an off-catalog error -> exit 2, one line, nothing written [FR-016]"
else bad "m3 an off-catalog error -> exit 2, one line, nothing written [FR-016]" "got: $GOT"; fi

# m4 — queued/ a symlink to a directory outside the vault: exit 2, the
# signed file never lands outside.
w10_sandbox w10-m4
RJ="$(w10_rejected signature_invalid)"
ID="$(basename "$RJ" .md)"
mv "$Q" "$SB/elsewhere"
ln -s "$SB/elsewhere" "$Q"
GOT="$(w10_node 'const r = req("intent-approve.cjs").reapproveIntent(argv[0], { via: "intent", approveId: argv[1], expectSha256: shaOf(argv[0]) }); process.stdout.write(String(r.exitCode));' "$RJ" "$W10_APPROVE_ID")"
if [[ "$GOT" == "2" && ! -e "$SB/elsewhere/$ID.md" && -f "$RJ" ]]; then ok "m4 a symlinked queued/ -> exit 2, nothing written outside the vault [FR-015]"
else bad "m4 a symlinked queued/ -> exit 2, nothing written outside the vault [FR-015]" "got: $GOT, outside: $(ls "$SB/elsewhere")"; fi

# m6 — a "yes" typed before the summary appeared is discarded; the answer
# after the prompt ("no") decides.
w10_sandbox w10-m6
RJ="$(w10_rejected signature_invalid)"
cp "$RJ" "$SB/before.md"
W10_EARLY="yes"
w10_approve_pty no "$RJ"
if [[ "$PTY_RC" -eq 1 && -z "$(ls "$Q")" ]] && cmp -s "$RJ" "$SB/before.md"; then ok "m6 type-ahead yes discarded, the answer after the prompt decides [FR-015]"
else bad "m6 type-ahead yes discarded, the answer after the prompt decides [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi

# m2 — the attacker-chosen sender of a hand-written rejected/ file is shown
# escaped and marked unverified.
w10_sandbox w10-m2s
F="$(mk_intent signature="$W10_ZERO_SIG" status=rejected rejected_reason=signature_invalid rejected_by=forged "created_by=pixel$(w10_cp 1b)[31m-robert")"
mv "$F" "$W10_R/"
w10_approve_pty no "$W10_R/$(basename "$F")"
if grep -qF 'pixel\u{1b}[31m-robert (UNVERIFIED sender' "$SB/.pty" && [[ "$(w10_raw_count "$SB/.pty" 1b)" == "0" ]]; then ok "m2 from: escaped and marked unverified [FR-015]"
else bad "m2 from: escaped and marked unverified [FR-015]" "$(tr -d '\r' <"$SB/.pty" | grep 'from:' | cat -v)"; fi

# ---------- spec round 6: target_sha256, a1-only value forms, path (a) ----------

W10_TSHA="9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"

# R6a — target_sha256: required for approve, forbidden otherwise, 64 lowercase hex.
w10_sandbox w10-r6a
TG="$(mk_intent)"
TGID="$(basename "$TG" .md)"
F="$(mk_intent action=approve "target=$TGID" "target_sha256=\"$(sha256_of "$TG")\"" created_by=mac-robert)"
run_intent validate "$F"
expect_verdict "R6a approve from the executor device with target_sha256 is valid [FR-001, FR-006]" 0 ""
F="$(mk_intent action=approve "target=$TGID" created_by=mac-robert)"
run_intent validate "$F"
expect_verdict "R6a2 approve without target_sha256 -> schema_invalid [FR-001, FR-006]" 1 "schema_invalid"
F="$(mk_intent "target_sha256=\"$W10_TSHA\"")"
run_intent validate "$F"
expect_verdict "R6a3 target_sha256 on new-feature -> schema_invalid [FR-001, FR-006]" 1 "schema_invalid"
F="$(mk_intent action=approve "target=$TGID" "target_sha256=\"$(printf '%s' "$W10_TSHA" | tr 'a-f' 'A-F')\"" created_by=mac-robert)"
run_intent validate "$F"
expect_verdict "R6a4 target_sha256 in upper case -> schema_invalid [FR-001, FR-006]" 1 "schema_invalid"
F="$(mk_intent action=approve "target=$TGID" "target_sha256=\"${W10_TSHA:0:63}\"" created_by=mac-robert)"
run_intent validate "$F"
expect_verdict "R6a5 target_sha256 of 63 characters -> schema_invalid [FR-001, FR-006]" 1 "schema_invalid"

# R6b — the tenth canonical field: frozen vector (openssl, hexkey 00…01, over
# the 10 fields of vault/w10-approve-vector.md), and a changed target_sha256
# after signing -> signature_invalid.
w10_sandbox w10-r6b
cp "$SUITE_DIR/vault/w10-approve-vector.md" "$SB/avec.md"
GOT="$(w10_node 'const { parseIntentFrontmatter } = req("intent-parse.cjs"); const { sign } = req("intent-sign.cjs");
  process.stdout.write(sign(parseIntentFrontmatter(fs.readFileSync(argv[0], "utf8")).fm, "0".repeat(63) + "1"));' "$SB/avec.md")"
if [[ "$GOT" == "hmac-sha256:8967784a322df31cd2e16fcf6d6d4c87c0d88200b115fc4d2fc7a61303f0c2d0" ]]; then ok "R6b frozen 10-field vector of an approve intent [FR-010]"
else bad "R6b frozen 10-field vector of an approve intent [FR-010]" "got: $GOT"; fi
TG="$(mk_intent)"
F="$(mk_intent action=approve "target=$(basename "$TG" .md)" "target_sha256=\"$W10_TSHA\"" created_by=mac-robert)"
node -e 'const fs = require("fs"); const f = process.argv[1]; fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(process.argv[2], "0".repeat(64)))' "$F" "$W10_TSHA"
run_intent validate "$F"
expect_verdict "R6b2 target_sha256 changed after signing -> signature_invalid [FR-010]" 1 "signature_invalid"

# R6c — path (a): an unsafe target -> target_invalid; bytes that differ from
# target_sha256 -> target_not_found (the TTY path keeps already_moved).
w10_sandbox w10-r6c
RJ="$(w10_rejected signature_invalid "payload=|
  Harmlos$(w10_cp e0069)ende")"
GOT="$(w10_node 'const r = req("intent-approve.cjs").reapproveIntent(argv[0], { via: "intent", approveId: argv[1], expectSha256: shaOf(argv[0]) });
  process.stdout.write([r.exitCode, (r.out && r.out.reasons || []).join(",")].join(" "));' "$RJ" "$W10_APPROVE_ID")"
if [[ "$GOT" == "1 target_invalid" && -z "$(ls "$Q")" ]]; then ok "R6c path (a): a display_unsafe target -> target_invalid [FR-015]"
else bad "R6c path (a): a display_unsafe target -> target_invalid [FR-015]" "got: $GOT"; fi
RJ="$(w10_rejected signature_invalid)"
GOT="$(w10_node 'const r = req("intent-approve.cjs").reapproveIntent(argv[0], { via: "intent", approveId: argv[1], expectSha256: "0".repeat(64) });
  process.stdout.write([r.exitCode, (r.out && r.out.reasons || []).join(",")].join(" "));' "$RJ" "$W10_APPROVE_ID")"
if [[ "$GOT" == "1 target_not_found" && -f "$RJ" && -z "$(ls "$Q")" ]]; then ok "R6c2 path (a): target bytes differ from target_sha256 -> target_not_found [FR-015]"
else bad "R6c2 path (a): target bytes differ from target_sha256 -> target_not_found [FR-015]" "got: $GOT"; fi
SHA="$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$RJ")"
GOT="$(w10_node 'const r = req("intent-approve.cjs").reapproveIntent(argv[0], { via: "intent", approveId: argv[1], expectSha256: argv[2] });
  process.stdout.write(String(r.exitCode));' "$RJ" "$W10_APPROVE_ID" "$SHA")"
if [[ "$GOT" == "0" && -n "$(ls "$Q")" ]]; then ok "R6c3 path (a): matching target_sha256 (sha256 of the raw bytes) -> approved [FR-015]"
else bad "R6c3 path (a): matching target_sha256 (sha256 of the raw bytes) -> approved [FR-015]" "got: $GOT"; fi

# R6d — a payload above the payload cap is never offered (display_unsafe).
w10_sandbox w10-r6d
BIG="$(node -e 'process.stdout.write("x".repeat(6200))')"
QF="$(mk_intent signature="$W10_ZERO_SIG" "payload=|
  $BIG")"
w10_approve_pty yes "$QF"
if [[ "$PTY_RC" -eq 1 && "$PTY_JSON" == *display_unsafe* ]]; then ok "R6d a payload above the cap -> display_unsafe [FR-015]"
else bad "R6d a payload above the cap -> display_unsafe [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi

# R6e — a1-only values outside queued/ have forms (FR-016).
w10_sandbox w10-r6e
w10_r6e() { # <case> <want-rc> <want-reasons> <folder> <mk_intent args...>
  local name="$1" rc="$2" want="$3" folder="$4" f
  shift 4
  f="$(mk_intent "$@")"
  mv "$f" "$VAULT/inbox/intents/$folder/"
  run_intent validate "$VAULT/inbox/intents/$folder/$(basename "$f")"
  expect_verdict "$name" "$rc" "$want"
}
w10_r6e "R6e rejected/ with catalog reason, hostname and timestamp is valid [FR-016]" 0 "" rejected status=rejected rejected_reason=signature_invalid rejected_by=mac-host.lan 'rejected_at="2026-09-24T12:06:00.000Z"'
w10_r6e "R6e2 rejected_reason outside the catalog -> schema_invalid [FR-016]" 1 "schema_invalid" rejected status=rejected 'rejected_reason="<img src=x onerror=alert(1)>"' rejected_by=mac 'rejected_at="2026-09-24T12:06:00.000Z"'
w10_r6e "R6e3 rejected_at not a UTC timestamp -> schema_invalid [FR-016]" 1 "schema_invalid" rejected status=rejected rejected_reason=stale rejected_by=mac rejected_at=not-a-date
w10_r6e "R6e4 claimed_by not a hostname -> schema_invalid [FR-016]" 1 "schema_invalid" claimed status=claimed 'claimed_by="../../etc"' 'claimed_at="2026-09-24T12:06:00.000Z"'
w10_r6e "R6e5 done/ with exit_code 0, failure_reason timeout, finished_at is valid [FR-016]" 0 "" done status=failed failure_reason=timeout exit_code=null 'started_at="2026-09-24T12:01:00.000Z"' 'finished_at="2026-09-24T12:31:00.000Z"'
w10_r6e "R6e6 failure_reason outside the catalog -> schema_invalid [FR-016]" 1 "schema_invalid" done status=failed failure_reason=crashed exit_code=3
w10_r6e "R6e7 exit_code not an integer -> schema_invalid [FR-016]" 1 "schema_invalid" done status=done exit_code=zero
w10_r6e "R6e8 cancelled_by_intent not a v4 UUID -> schema_invalid [FR-016]" 1 "schema_invalid" rejected status=rejected rejected_reason=cancelled_by_user rejected_by=mac cancelled_by_intent=not-a-uuid
w10_r6e "R6e9 cancelled_by_intent a v4 UUID is valid [FR-016]" 0 "" rejected status=rejected rejected_reason=cancelled_by_user rejected_by=mac "cancelled_by_intent=$W10_APPROVE_ID"
w10_r6e "R6e10 started_at on a claimed file not UTC -> schema_invalid [FR-016]" 1 "schema_invalid" claimed status=running claimed_by=mac 'claimed_at="2026-09-24T12:06:00.000Z"' 'started_at="2026-09-24 12:07"'

# ---------- D0–D12: `intent doctor` (FR-037, FR-046 report) ----------

# The doctor calls ps and lsof by absolute path; fixtures replace both through
# the library seam injectDoctorDeps (no PATH, no env variable). The fakes are
# derived from a MEASUREMENT, not from the code (testing.md class 3; security
# review of waves 9–10, BLOCKER-1): vault/w10-measured-ps.txt and
# vault/w10-measured-lsof.txt are the real output of
#   /bin/ps -axo pid=,ppid=,uid=,comm=          (15 of 742 lines kept)
#   /usr/sbin/lsof -nP -iTCP -sTCP:LISTEN -a -p 2776,2777,2778,2779,2781
# on the executor Mac, 2026-09-28, with Obsidian running; only the user name
# is anonymised. Measured behaviour the fake lsof reproduces: it prints only
# the lines of the pids asked for, and exits 1 with no output when none of
# them listens (`lsof … -a -p 2776`, the main process alone: rc 1, empty).
# The listeners belong to "Obsidian Helper (Renderer)" (2779), a child of
# the main process 2776; `pgrep -x Obsidian` measured "2776" alone, and the
# fake pgrep answers the same (the main pid of the ps file), so a doctor that
# still asked pgrep would meet the measured blind spot. Every call is recorded
# in $SB/doctor-calls.json.
W10_DOCTOR_AS="$WORK/w10-doctor-as.cjs"
cat >"$W10_DOCTOR_AS" <<'JS'
'use strict';
const fs = require('fs');
const path = require('path');
const [home, fakeFile, callsFile, tools, ...args] = process.argv.slice(2);
const lib = path.join(path.dirname(tools), 'lib');
require(path.join(lib, 'intent-child.cjs')).injectChildDeps({ passwdHome: () => home });
const fake = JSON.parse(fs.readFileSync(fakeFile, 'utf8'));
const calls = [];
// lsof as measured: header plus the lines whose PID column is in `-p`; rc 1
// and no output when none matches.
function lsof(argv) {
  if (fake.lsofFail) return fake.lsofFail;
  const i = argv.indexOf('-p');
  const pids = new Set(i === -1 ? [] : String(argv[i + 1]).split(','));
  const lines = String(fake.lsofText || '').split('\n').filter((l) => l.trim() !== '');
  const hits = lines.slice(1).filter((l) => pids.has(l.trim().split(/\s+/)[1]));
  return hits.length === 0 ? { status: 1, stdout: '', error: null } : { status: 0, stdout: `${[lines[0], ...hits].join('\n')}\n`, error: null };
}
const docFile = path.join(lib, 'intent-doctor.cjs');
if (fs.existsSync(docFile)) {
  require(docFile).injectDoctorDeps({
    exec: (tool, argv) => {
      calls.push([tool, ...argv]);
      fs.writeFileSync(callsFile, JSON.stringify(calls));
      if (tool === 'lsof') return lsof(argv);
      return fake[tool] || { status: null, stdout: '', error: 'ENOENT' };
    },
  });
}
process.argv = [process.argv[0], tools, ...args];
require(tools);
JS

W10_PS_MEASURED="$SUITE_DIR/vault/w10-measured-ps.txt"
W10_LSOF_MEASURED="$SUITE_DIR/vault/w10-measured-lsof.txt"

# w10_fake [ps-file] [lsof-file] — writes $SB/doctor-fake.json.
w10_fake() {
  node -e 'const fs = require("fs"); const [f, ps, lsof] = process.argv.slice(1);
    const psText = fs.readFileSync(ps, "utf8");
    const main = psText.split("\n").filter((l) => /\/Obsidian\.app\/Contents\/MacOS\/Obsidian$/.test(l)).map((l) => l.trim().split(/\s+/)[0]);
    fs.writeFileSync(f, JSON.stringify({ ps: { status: 0, stdout: psText, error: null }, pgrep: { status: main.length > 0 ? 0 : 1, stdout: main.map((p) => p + "\n").join(""), error: null }, lsofText: fs.readFileSync(lsof, "utf8") }));' \
    "$SB/doctor-fake.json" "${1:-$W10_PS_MEASURED}" "${2:-$W10_LSOF_MEASURED}"
}

# w10_fake_json <json> — the fake file verbatim (tool failures).
w10_fake_json() { printf '%s\n' "$1" >"$SB/doctor-fake.json"; }

# w10_lsof_variant <sed-expr> — the measured lsof output with one edit, in
# $SB/lsof.txt (a derived listener set on the measured process tree).
w10_lsof_variant() { sed "$1" "$W10_LSOF_MEASURED" >"$SB/lsof.txt"; }

# run_doctor [args] — `intent doctor` with the injected tools; RC, OUT, ERR.
run_doctor() {
  env -u A1_INTENT_FIXTURE_TRACE HOME="$FHOME" A1_VAULT_ROOT="$VAULT" "${W10_ENV[@]+"${W10_ENV[@]}"}" \
    node "$W10_DOCTOR_AS" "$FHOME" "$SB/doctor-fake.json" "$SB/doctor-calls.json" "$A1_TOOLS" intent doctor "$@" >"$SB/.out" 2>"$SB/.err"
  RC=$?
  OUT="$(cat "$SB/.out")"
  ERR="$(cat "$SB/.err")"
}
W10_ENV=()

# doctor_check <name> — the check's ok as text, or <absent>.
doctor_check() {
  node -e 'let o; try { o = JSON.parse(process.argv[1]); } catch (e) { process.stdout.write("<not json>"); process.exit(0); }
    const c = (o.checks || []).find((x) => x.name === process.argv[2]);
    process.stdout.write(c ? String(c.ok) : "<absent>");' "$OUT" "$1"
}

# doctor_detail <name> — the check's detail text.
doctor_detail() {
  node -e 'let o; try { o = JSON.parse(process.argv[1]); } catch (e) { process.stdout.write("<not json>"); process.exit(0); }
    const c = (o.checks || []).find((x) => x.name === process.argv[2]);
    process.stdout.write(c && c.detail ? c.detail : "");' "$OUT" "$1"
}

# expect_doctor <case> <rc> <check> <ok> — exit code and one check's verdict.
expect_doctor() {
  local got
  got="$(doctor_check "$3")"
  if [[ "$RC" -eq "$2" && "$got" == "$4" ]]; then ok "$1"
  else bad "$1" "expected exit $2 and $3 ok=$4, got exit $RC ok=$got" "stdout: ${OUT:0:300}" "stderr: ${ERR:0:200}"; fi
}

w10_doctor_sandbox() {
  w10_sandbox "$1"
  mkdir -p "$VAULT/.obsidian"
  printf '["obsidian-local-rest-api","dataview"]\n' >"$VAULT/.obsidian/community-plugins.json"
  printf '{"sync":true,"file-explorer":true}\n' >"$VAULT/.obsidian/core-plugins.json"
  : >"$W10_LOG"
  chmod 600 "$W10_LOG"
  printf '{"rows":[]}\n' >"$FHOME/.a1-intents-ledger.json"
  chmod 600 "$FHOME/.a1-intents-ledger.json"
  mkdir -p "$FHOME/.a1-intents-seal"
  chmod 700 "$FHOME/.a1-intents-seal"
  w10_lsof_variant 's/\*:58589/127.0.0.1:58589/'
  w10_fake "$W10_PS_MEASURED" "$SB/lsof.txt"
  W10_ENV=()
}

w10_doctor_sandbox w10-d0
run_doctor
if [[ "$RC" -eq 0 ]]; then ok "D0 clean host (measured tree, loopback only): exit 0 [FR-037]"
else bad "D0 clean host (measured tree, loopback only): exit 0 [FR-037]" "rc $RC" "stdout: ${OUT:0:400}" "stderr: ${ERR:0:200}"; fi
GOT="$(node -e 'let o; try { o = JSON.parse(process.argv[1]); } catch (e) { process.stdout.write("<not json>"); process.exit(0); }
  process.stdout.write([o.ok, o.executor && o.executor.executor_device, (o.devices || []).join("+"), (o.plugins || []).join("+"), o.sync_enabled,
    (o.listeners || []).map((l) => l.pid + "@" + l.address + ":" + l.port + ":" + l.loopback).join("+"), (o.overrides || []).length, (o.checks || []).map((c) => c.name).join("+")].join(" "));' "$OUT")"
WANT="true mac-robert mac-robert+pixel-robert obsidian-local-rest-api+dataview true 2779@127.0.0.1:58589:true+2779@127.0.0.1:22360:true+2779@127.0.0.1:27124:true 0 intents_dir+seal_dir+devices_mode+executor_mode+log_mode+ledger_mode+obsidian_listener+secret_in_vault+overrides"
if [[ "$GOT" == "$WANT" ]]; then ok "D4 report shape: executor, devices, plugins, sync, listeners, overrides, checks [FR-037]"
else bad "D4 report shape: executor, devices, plugins, sync, listeners, overrides, checks [FR-037]" "got:  $GOT" "want: $WANT"; fi
if [[ -n "$OUT" && "$OUT" != *"$FIXTURE_SECRET"* && "$OUT" != *"$FIXTURE_EXECUTOR_SECRET"* && "$ERR" != *"$FIXTURE_SECRET"* && "$OUT" != *secret_hex* ]]; then ok "D4b no secret and no secret_hex in the report [FR-037]"
else bad "D4b no secret and no secret_hex in the report [FR-037]" "stdout: ${OUT:0:300}"; fi
GOT="$(node -e 'try { process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).map((c) => c.join(" ")).join(" | ")); } catch (e) { process.stdout.write("<no calls>"); }' "$SB/doctor-calls.json")"
if [[ "$GOT" == "ps -axo pid=,ppid=,uid=,comm= | lsof -nP -iTCP -sTCP:LISTEN -a -p 2776,2777,2778,2779,2781" ]]; then ok "D2c ps once, then lsof -a -p over the whole Obsidian tree (main + 4 helpers) [FR-037]"
else bad "D2c ps once, then lsof -a -p over the whole Obsidian tree (main + 4 helpers) [FR-037]" "got: $GOT"; fi

w10_doctor_sandbox w10-d1
chmod 644 "$FHOME/.a1-intents/devices.json"
run_doctor
expect_doctor "D1a devices.json 0644 -> exit 1 devices_mode [FR-037]" 1 devices_mode false
chmod 600 "$FHOME/.a1-intents/devices.json"
run_doctor
expect_doctor "D1b devices.json 0600 -> devices_mode ok [FR-037]" 0 devices_mode true

# D2 — the measured ship-blocker: *:58589 on the renderer helper, the main
# process without a socket.
w10_doctor_sandbox w10-d2
w10_fake "$W10_PS_MEASURED" "$W10_LSOF_MEASURED"
run_doctor
expect_doctor "D2a measured: *:58589 on Obsidian Helper (Renderer) -> exit 1 obsidian_listener [FR-037]" 1 obsidian_listener false
if [[ "$(doctor_detail obsidian_listener)" == "non-loopback: *:58589" ]]; then ok "D2a2 the finding names *:58589 [FR-037]"
else bad "D2a2 the finding names *:58589 [FR-037]" "detail: $(doctor_detail obsidian_listener)"; fi
for addr in '0.0.0.0' '[::]' '192.168.1.20' '[::ffff:127.0.0.1]'; do
  w10_lsof_variant "s/\\*:58589/$addr:58589/"
  w10_fake "$W10_PS_MEASURED" "$SB/lsof.txt"
  run_doctor
  expect_doctor "D2b helper listener on $addr -> exit 1 obsidian_listener [FR-037]" 1 obsidian_listener false
done
# A helper whose parent died (reparented to launchd) still counts: it runs
# from inside Obsidian.app.
sed 's/^ 2779  2776 / 2779     1 /' "$W10_PS_MEASURED" >"$SB/ps.txt"
w10_fake "$SB/ps.txt" "$W10_LSOF_MEASURED"
run_doctor
expect_doctor "D2g a reparented helper inside Obsidian.app still counts [FR-037]" 1 obsidian_listener false
# A child of a helper (grandchild of the main process) counts too.
sed 's|^ 2782     1   501 .*$| 2782  2779   501 /usr/bin/python3|' "$W10_PS_MEASURED" >"$SB/ps.txt"
sed 's/ 2779 / 2782 /' "$W10_LSOF_MEASURED" >"$SB/lsof.txt"
w10_fake "$SB/ps.txt" "$SB/lsof.txt"
run_doctor
expect_doctor "D2h a grandchild of Obsidian (plugin subprocess) listening on * -> exit 1 [FR-037]" 1 obsidian_listener false
# Not running: no Obsidian in ps -> ok, and lsof is never called.
grep -v 'Obsidian' "$W10_PS_MEASURED" >"$SB/ps.txt"
w10_fake "$SB/ps.txt" "$W10_LSOF_MEASURED"
run_doctor
if [[ "$(doctor_check obsidian_listener)" == "true" && "$RC" -eq 0 && "$(cat "$SB/doctor-calls.json")" == '[["ps","-axo","pid=,ppid=,uid=,comm="]]' ]]; then ok "D2e Obsidian not running -> ok, lsof not called [FR-037]"
else bad "D2e Obsidian not running -> ok, lsof not called [FR-037]" "rc $RC calls $(cat "$SB/doctor-calls.json")"; fi
# Running, but no process of the tree listens: lsof exits 1 with no output
# (measured for the main pid alone) -> ok.
printf 'COMMAND    PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME\n' >"$SB/lsof.txt"
w10_fake "$W10_PS_MEASURED" "$SB/lsof.txt"
run_doctor
if [[ "$(doctor_check obsidian_listener)" == "true" && "$RC" -eq 0 && "$OUT" == *'"listeners": []'* ]]; then ok "D2j Obsidian running without listeners (lsof rc 1, empty) -> ok [FR-037]"
else bad "D2j Obsidian running without listeners (lsof rc 1, empty) -> ok [FR-037]" "rc $RC $(doctor_detail obsidian_listener)"; fi
w10_fake_json '{"ps":{"status":0,"stdout":" 2776     1   501 /Applications/Obsidian.app/Contents/MacOS/Obsidian\n","error":null},"lsofFail":{"status":null,"stdout":"","error":"ETIMEDOUT"}}'
run_doctor
expect_doctor "D2d Obsidian running, lsof fails -> exit 1 obsidian_listener (fail closed) [FR-037]" 1 obsidian_listener false
w10_fake_json '{"lsofText":""}'
run_doctor
expect_doctor "D2f ps unavailable -> exit 1 obsidian_listener (fail closed) [FR-037]" 1 obsidian_listener false
w10_fake_json '{"ps":{"status":0,"stdout":"garbage line\n","error":null},"lsofText":""}'
run_doctor
expect_doctor "D2i an unparsable ps line -> exit 1 obsidian_listener (fail closed) [FR-037]" 1 obsidian_listener false

# D2r — opt-in real system (A1_FIXTURE_REAL_OBSIDIAN=1, macOS): the real
# runDoctor with the real ps/lsof must find at least one listener of the
# Obsidian tree whenever the real lsof shows one for a process in
# Obsidian.app. Read-only; temp HOME and vault. Skipped when not opted in or
# when Obsidian is not running.
if [[ "${A1_FIXTURE_REAL_OBSIDIAN:-}" == "1" && "$(uname -s)" == "Darwin" ]] && /bin/ps -axo comm= | grep -q '/Obsidian.app/'; then
  w10_sandbox w10-d2r
  GOT="$(node -e '
    const lib = process.argv[1]; const { execFileSync } = require("child_process");
    const ps = execFileSync("/bin/ps", ["-axo", "pid=,comm="], { encoding: "utf8" }).split("\n")
      .filter((l) => l.includes("/Obsidian.app/")).map((l) => l.trim().split(/\s+/)[0]);
    let real = "";
    try { real = execFileSync("/usr/sbin/lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-p", ps.join(",")], { encoding: "utf8" }); } catch (e) { real = ""; }
    const want = real.split("\n").filter((l) => l.includes("(LISTEN)")).length;
    const r = require(lib + "/intent-doctor.cjs").runDoctor({ homedir: () => process.argv[2], vault: process.argv[3], env: {} });
    process.stdout.write([want, (r.listeners || []).length].join(" "));' "$INTENT_LIB" "$FHOME" "$VAULT" 2>&1)"
  if [[ "$GOT" =~ ^([0-9]+)\ ([0-9]+)$ && "${BASH_REMATCH[1]}" == "${BASH_REMATCH[2]}" && "${BASH_REMATCH[1]}" -gt 0 ]]; then ok "D2r real system: doctor sees all ${BASH_REMATCH[1]} listeners of the running Obsidian tree [FR-037]"
  elif [[ "$GOT" == "0 0" ]]; then echo "SKIP  D2r real system: Obsidian runs but has no TCP listener [FR-037]"
  else bad "D2r real system: doctor sees all listeners of the running Obsidian tree [FR-037]" "real lsof vs doctor: $GOT"; fi
else
  echo "SKIP  D2r real system (opt-in A1_FIXTURE_REAL_OBSIDIAN=1 on macOS with Obsidian running) [FR-037]"
fi

# D2t — absolute tool paths: a ps and an lsof first on PATH are never run.
w10_sandbox w10-d2t
mkdir -p "$SB/fakebin"
for t in ps lsof; do
  printf '#!/bin/sh\necho ran >>"%s/fakebin.log"\n' "$SB" >"$SB/fakebin/$t"
  chmod 755 "$SB/fakebin/$t"
done
PATH="$SB/fakebin:$PATH" w10_node 'const D = req("intent-doctor.cjs"); D.defaultExec("ps", ["-o", "pid=", "-p", String(process.pid)]); D.defaultExec("lsof", ["-v"]);' >/dev/null
if [[ ! -e "$SB/fakebin.log" ]]; then ok "D2t ps and lsof run by absolute path, never from PATH [FR-037]"
else bad "D2t ps and lsof run by absolute path, never from PATH [FR-037]" "PATH copies ran: $(cat "$SB/fakebin.log")"; fi

w10_doctor_sandbox w10-d3
mkdir -p "$VAULT/project/x"
printf 'notiz\nkey %s\n' "$FIXTURE_SECRET" >"$VAULT/project/x/leak.md"
run_doctor
expect_doctor "D3a a provisioned secret outside inbox/intents/ -> exit 1 secret_in_vault [FR-037]" 1 secret_in_vault false
if [[ "$OUT" != *"$FIXTURE_SECRET"* && "$ERR" != *"$FIXTURE_SECRET"* && "$OUT" == *leak.md* ]]; then ok "D3c the report names the file, never the secret [FR-037]"
else bad "D3c the report names the file, never the secret [FR-037]" "stdout: ${OUT:0:300}"; fi
mv "$VAULT/project/x/leak.md" "$SB/leak.md"
printf 'KEY %s\n' "$(printf '%s' "$FIXTURE_EXECUTOR_SECRET" | tr 'a-f' 'A-F')" >"$VAULT/inbox/x.md"
run_doctor
expect_doctor "D3b the uppercase spelling of a secret -> exit 1 secret_in_vault [FR-037]" 1 secret_in_vault false
mv "$VAULT/inbox/x.md" "$SB/x.md"
run_doctor
expect_doctor "D3d removed -> secret_in_vault ok [FR-037]" 0 secret_in_vault true
mkdir -p "$VAULT/.obsidian/plugins/lumen"
node -e 'process.stdout.write(JSON.stringify({ key: Buffer.from(process.argv[1], "hex").toString("base64") }))' "$FIXTURE_SECRET" >"$VAULT/.obsidian/plugins/lumen/data.json"
run_doctor
expect_doctor "D3e the secret as base64 of its raw bytes (plugin data.json) -> exit 1 secret_in_vault [FR-037]" 1 secret_in_vault false
# A device whose secret bytes 0xff give "/" in base64 and "_" in base64url,
# so only the base64url needle can find this spelling.
node -e 'const f = process.argv[1]; const d = JSON.parse(require("fs").readFileSync(f, "utf8")); d.devices["ff-phone"] = { secret_hex: "ff".repeat(32), created_at: "2026-09-01T00:00:00.000Z", revoked_at: null }; require("fs").writeFileSync(f, JSON.stringify(d))' "$FHOME/.a1-intents/devices.json"
node -e 'process.stdout.write("k " + Buffer.from("ff".repeat(32), "hex").toString("base64url"))' >"$VAULT/.obsidian/plugins/lumen/data.json"
run_doctor
expect_doctor "D3f the secret as base64url (differs from base64) -> exit 1 secret_in_vault [FR-037]" 1 secret_in_vault false
mv "$VAULT/.obsidian/plugins/lumen/data.json" "$SB/data.json"
node -e 'const f = process.argv[1]; const d = JSON.parse(require("fs").readFileSync(f, "utf8")); d.devices["old-phone"] = { secret_hex: "cd".repeat(32), created_at: "2026-09-01T00:00:00.000Z", revoked_at: "2026-09-02T00:00:00.000Z" }; require("fs").writeFileSync(f, JSON.stringify(d))' "$FHOME/.a1-intents/devices.json"
printf 'alt %s\n' "$(printf 'cd%.0s' $(seq 1 32))" >"$VAULT/revoked.md"
run_doctor
expect_doctor "D3g a revoked device's secret in the vault -> exit 1 secret_in_vault [FR-037]" 1 secret_in_vault false
mv "$VAULT/revoked.md" "$SB/revoked.md"

# D3h — symlinks are never followed; each one is an unscanned_symlink finding.
w10_doctor_sandbox w10-d3h
mkdir -p "$SB/outside"
printf 'k %s\n' "$FIXTURE_SECRET" >"$SB/outside/secret.txt"
ln -s "$SB/outside/secret.txt" "$VAULT/linked.md"
run_doctor
if [[ "$RC" -eq 1 && "$(doctor_check secret_in_vault)" == "false" && "$(doctor_detail secret_in_vault)" == "unscanned_symlink: linked.md" ]]; then ok "D3h a symlinked file -> exit 1 unscanned_symlink, not followed [FR-037]"
else bad "D3h a symlinked file -> exit 1 unscanned_symlink, not followed [FR-037]" "rc $RC detail: $(doctor_detail secret_in_vault)"; fi
mv "$VAULT/linked.md" "$SB/linked.md"
ln -s "$SB/outside" "$VAULT/linkeddir"
run_doctor
if [[ "$RC" -eq 1 && "$(doctor_detail secret_in_vault)" == "unscanned_symlink: linkeddir" ]]; then ok "D3i a symlinked directory -> exit 1 unscanned_symlink, not followed [FR-037]"
else bad "D3i a symlinked directory -> exit 1 unscanned_symlink, not followed [FR-037]" "rc $RC detail: $(doctor_detail secret_in_vault)"; fi

# D3j — a link whose realpath lies inside the vault is covered by the walk
# (round 6); a dangling link is named and fails.
w10_doctor_sandbox w10-d3j
mkdir -p "$VAULT/project/real"
printf 'notiz\n' >"$VAULT/project/real/a.md"
ln -s "$VAULT/project/real" "$VAULT/alias"
ln -s "$VAULT/project/real/a.md" "$VAULT/alias.md"
run_doctor
expect_doctor "D3j links resolving inside the vault are covered -> secret_in_vault ok [FR-037]" 0 secret_in_vault true
ln -s "$VAULT/nowhere.md" "$VAULT/dead.md"
run_doctor
if [[ "$RC" -eq 1 && "$(doctor_detail secret_in_vault)" == "unscanned_symlink: dead.md" ]]; then ok "D3k a dangling link -> exit 1 unscanned_symlink dead.md [FR-037]"
else bad "D3k a dangling link -> exit 1 unscanned_symlink dead.md [FR-037]" "rc $RC detail: $(doctor_detail secret_in_vault)"; fi

w10_doctor_sandbox w10-d4
node -e 'const f = process.argv[1]; const d = JSON.parse(require("fs").readFileSync(f, "utf8")); d.devices["old-phone"] = { secret_hex: "ab".repeat(32), created_at: "2026-09-01T00:00:00.000Z", revoked_at: "2026-09-02T00:00:00.000Z" }; require("fs").writeFileSync(f, JSON.stringify(d))' "$FHOME/.a1-intents/devices.json"
run_doctor
if [[ "$RC" -eq 0 && "$OUT" == *pixel-robert* && "$OUT" != *old-phone* ]]; then ok "D4c revoked devices are not listed [FR-037]"
else bad "D4c revoked devices are not listed [FR-037]" "rc $RC stdout: ${OUT:0:300}"; fi

w10_doctor_sandbox w10-d5
chmod 755 "$FHOME/.a1-intents"
printf 'k %s\n' "$FIXTURE_SECRET" >"$VAULT/leak.md"
run_doctor
expect_doctor "D5a ~/.a1-intents 0755 -> exit 1 intents_dir [FR-037]" 1 intents_dir false
if [[ "$(doctor_check secret_in_vault)" == "false" && "$(doctor_detail secret_in_vault)" == "not checked: devices.json is unsafe or unreadable" ]]; then ok "D5g devices unsafe -> secret_in_vault reported as not checked, not ok [FR-037]"
else bad "D5g devices unsafe -> secret_in_vault reported as not checked, not ok [FR-037]" "$(doctor_check secret_in_vault) $(doctor_detail secret_in_vault)"; fi
mv "$VAULT/leak.md" "$SB/leak.md"
chmod 700 "$FHOME/.a1-intents"
chmod 644 "$W10_LOG"
run_doctor
expect_doctor "D5b log.jsonl 0644 -> exit 1 log_mode [FR-037]" 1 log_mode false
chmod 600 "$W10_LOG"
chmod 644 "$FHOME/.a1-intents-ledger.json"
run_doctor
expect_doctor "D5c ledger 0644 -> exit 1 ledger_mode [FR-037]" 1 ledger_mode false
chmod 600 "$FHOME/.a1-intents-ledger.json"
mv "$FHOME/.a1-intents/executor.json" "$SB/executor.json"
ln -s "$SB/executor.json" "$FHOME/.a1-intents/executor.json"
run_doctor
expect_doctor "D5d executor.json a symlink -> exit 1 executor_mode [FR-037]" 1 executor_mode false
node -e 'require("fs").unlinkSync(process.argv[1])' "$FHOME/.a1-intents/executor.json"
mv "$SB/executor.json" "$FHOME/.a1-intents/executor.json"
chmod 755 "$FHOME/.a1-intents-seal"
run_doctor
expect_doctor "D5e ~/.a1-intents-seal 0755 -> exit 1 seal_dir [FR-037]" 1 seal_dir false
chmod 700 "$FHOME/.a1-intents-seal"
run_doctor
expect_doctor "D5f all private -> exit 0 [FR-037]" 0 ledger_mode true

w10_doctor_sandbox w10-d6
W10_ENV=(A1_INTENT_TIMEOUT_MS=1000)
run_doctor
GOT="$(node -e 'try { process.stdout.write((JSON.parse(process.argv[1]).overrides || []).join(",")); } catch (e) { process.stdout.write("<not json>"); }' "$OUT")"
if [[ "$RC" -eq 1 && "$(doctor_check overrides)" == "false" && "$GOT" == "A1_INTENT_TIMEOUT_MS" ]]; then ok "D6a an active A1_INTENT_* override -> exit 1, named in overrides [FR-046]"
else bad "D6a an active A1_INTENT_* override -> exit 1, named in overrides [FR-046]" "rc $RC overrides [$GOT]" "stdout: ${OUT:0:300}"; fi
W10_ENV=()
run_doctor
expect_doctor "D6b no override -> overrides ok [FR-046]" 0 overrides true

w10_doctor_sandbox w10-d7
chmod 644 "$FHOME/.a1-intents/devices.json"
BEFORE="$(tree_listing "$FHOME" "$VAULT")"
MODE_BEFORE="$(ls -l "$FHOME/.a1-intents/devices.json" | cut -c1-10)"
run_doctor
if [[ "$(tree_listing "$FHOME" "$VAULT")" == "$BEFORE" && "$(ls -l "$FHOME/.a1-intents/devices.json" | cut -c1-10)" == "$MODE_BEFORE" ]]; then ok "D7a read-only: nothing repaired, nothing written [FR-037]"
else bad "D7a read-only: nothing repaired, nothing written [FR-037]" "$(diff <(echo "$BEFORE") <(tree_listing "$FHOME" "$VAULT") | head -n 4)"; fi
mv "$FHOME/.a1-intents" "$SB/a1-intents.moved"
mv "$FHOME/.a1-intents-seal" "$SB/a1-intents-seal.moved"
mv "$FHOME/.a1-intents-ledger.json" "$SB/ledger.moved"
run_doctor
if [[ ! -e "$FHOME/.a1-intents" && ! -e "$FHOME/.a1-intents-seal" && "$(doctor_check intents_dir)" == "true" ]]; then ok "D7b no ~/.a1-intents: doctor creates nothing [FR-037]"
else bad "D7b no ~/.a1-intents: doctor creates nothing [FR-037]" "rc $RC" "stdout: ${OUT:0:300}"; fi

w10_doctor_sandbox w10-d8
printf '["sync","file-explorer"]\n' >"$VAULT/.obsidian/core-plugins.json"
run_doctor
GOT="$(node -e 'try { process.stdout.write(String(JSON.parse(process.argv[1]).sync_enabled)); } catch (e) { process.stdout.write("<not json>"); }' "$OUT")"
printf '{"sync":false}\n' >"$VAULT/.obsidian/core-plugins.json"
run_doctor
GOT="$GOT $(node -e 'try { process.stdout.write(String(JSON.parse(process.argv[1]).sync_enabled)); } catch (e) { process.stdout.write("<not json>"); }' "$OUT")"
if [[ "$GOT" == "true false" ]]; then ok "D8 Sync flag from core-plugins.json (array and object form) [FR-037]"
else bad "D8 Sync flag from core-plugins.json (array and object form) [FR-037]" "got: $GOT"; fi

w10_doctor_sandbox w10-d9
run_doctor --fix
expect_usage "D9 doctor takes no arguments -> exit 2 [FR-037]"

# ---------- D10: A1_INTENT_* overrides in the LaunchAgent plist (Wave 11 item 4, spec R-9) ----------
# The plist is rendered from the REAL template (_shared/templates), and the override is inserted in the
# shape measured on 2026-10-04 from `plutil -insert EnvironmentVariables.A1_INTENT_TIMEOUT_MS -string 1000`
# followed by `plutil -convert xml1`: two tabs, <key>NAME</key>, then <string>VALUE</string>.
w10_plist() { # [override-name] — renders the template into the sandbox's LaunchAgents
  local dst="$FHOME/Library/LaunchAgents/ai.n3ural.a1-intent-tick.plist"
  mkdir -p "$(dirname "$dst")"
  sed -e "s#{{NODE}}#/usr/local/bin/node#; s#{{A1_TOOLS}}#/opt/a1/_shared/a1-tools.cjs#; s#{{HOME}}#$FHOME#g; s#{{PATH}}#/usr/local/bin:/usr/bin:/bin#; s#{{A1_VAULT_ROOT}}#$VAULT#" \
    "$REPO_ROOT/_shared/templates/ai.n3ural.a1-intent-tick.plist" >"$dst"
  if [[ -n "${1:-}" ]]; then
    node -e 'const fs = require("fs"); const [f, k] = process.argv.slice(1); const t = fs.readFileSync(f, "utf8");
      const at = t.indexOf("<dict>", t.indexOf("<key>EnvironmentVariables</key>")) + "<dict>".length;
      fs.writeFileSync(f, t.slice(0, at) + `\n\t\t<key>${k}</key>\n\t\t<string>1000</string>` + t.slice(at));' "$dst" "$1"
  fi
  W10_PLIST="$dst"
}
w10_doctor_sandbox w10-d10
w10_plist A1_INTENT_TIMEOUT_MS
run_doctor
d10a="$RC $(doctor_check overrides) $(node -e 'try { const o = JSON.parse(process.argv[1]); process.stdout.write((o.plist_overrides || []).join(",") + " " + (o.overrides || []).length); } catch (e) { process.stdout.write("<not json>"); }' "$OUT")"
d10a_detail="$(doctor_detail overrides)"
if [[ "$d10a" == "1 false A1_INTENT_TIMEOUT_MS 0" && "$d10a_detail" == *"A1_INTENT_TIMEOUT_MS"* && "$d10a_detail" == *"ai.n3ural.a1-intent-tick.plist"* ]]; then
  ok "D10a the LaunchAgent plist (rendered from the template) carries A1_INTENT_TIMEOUT_MS, the environment none -> exit 1, overrides names the variable and the plist, plist_overrides lists it [FR-046, FR-037]"
else bad "D10a the LaunchAgent plist (rendered from the template) carries A1_INTENT_TIMEOUT_MS, the environment none -> exit 1, overrides names the variable and the plist, plist_overrides lists it [FR-046, FR-037]" "$d10a" "detail: $d10a_detail"; fi
w10_plist
run_doctor
expect_doctor "D10b the rendered template itself (PATH and A1_VAULT_ROOT only) -> overrides ok, exit 0 [FR-046, FR-037]" 0 overrides true
printf 'bplist00\x01\x02' >"$W10_PLIST"
run_doctor
d10c="$RC $(doctor_check overrides) $(doctor_detail overrides)"
mv "$W10_PLIST" "$SB/plist.real"; w10_plist; mv "$W10_PLIST" "$SB/plist.target"; ln -s "$SB/plist.target" "$W10_PLIST"
run_doctor
d10d="$RC $(doctor_check overrides) $(doctor_detail overrides)"
if [[ "$d10c" == "1 false "*"binary plist"* && "$d10d" == "1 false "*"unreadable"* ]]; then
  ok "D10c a binary plist and a plist that is a symbolic link -> overrides fails closed (binary plist / unreadable), exit 1 [FR-046, FR-037]"
else bad "D10c a binary plist and a plist that is a symbolic link -> overrides fails closed (binary plist / unreadable), exit 1 [FR-046, FR-037]" "binary: $d10c" "symlink: $d10d"; fi

# D10e (Samuel W11 SEC-1): three valid XML shapes that launchd reads but a regex reader could miss
# (CDATA, an entity in a key, a repeated EnvironmentVariables key) -> overrides fails closed, exit 1.
d10e_bad=""
for shape in 'cdata:<string><![CDATA[x]]></string>' 'entity:<key>A1&#95;INTENT_TIMEOUT_MS</key><string>1</string>' 'dupkey:<key>EnvironmentVariables</key><dict/>'; do
  w10_plist
  node -e 'const fs = require("fs"); const [f, snip] = process.argv.slice(1); const t = fs.readFileSync(f, "utf8");
    const at = t.indexOf("<dict>") + "<dict>".length; fs.writeFileSync(f, t.slice(0, at) + "\n\t" + snip + t.slice(at));' "$W10_PLIST" "${shape#*:}"
  run_doctor
  [[ "$RC $(doctor_check overrides)" == "1 false" ]] || d10e_bad="$d10e_bad ${shape%%:*}($RC $(doctor_check overrides))"
done
if [[ -z "$d10e_bad" ]]; then ok "D10e a plist with CDATA, an entity in a key or a repeated EnvironmentVariables key -> overrides fails closed, exit 1 [FR-046, FR-037]"
else bad "D10e a plist with CDATA, an entity in a key or a repeated EnvironmentVariables key -> overrides fails closed, exit 1 [FR-046, FR-037]" "not refused:$d10e_bad"; fi

# ---------- security re-review of waves 9–10: n1–n6 ----------

# n2 — path (a) requires the expected target hash: missing, empty or not 64
# lowercase hex -> exit 2, nothing written (even when the bytes were swapped).
w10_sandbox w10-n2
RJ="$(w10_rejected signature_invalid)"
node -e 'const fs = require("fs"); const f = process.argv[1]; fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("Push-Benachrichtigung", "UNTERGESCHOBEN"))' "$RJ"
GOT="$(w10_node 'const A = req("intent-approve.cjs"); const run = (o) => A.reapproveIntent(argv[0], Object.assign({ via: "intent", approveId: argv[1] }, o)).exitCode;
  process.stdout.write([run({}), run({ expectSha256: "" }), run({ expectSha256: "A".repeat(64) }), run({ expectSha256: "a".repeat(63) })].join(" "));' "$RJ" "$W10_APPROVE_ID")"
if [[ "$GOT" == "2 2 2 2" && -f "$RJ" && -z "$(ls "$Q")" ]]; then ok "n2 path (a) without a 64-hex expected hash (none, empty, upper case, 63) -> exit 2, nothing written [FR-015]"
else bad "n2 path (a) without a 64-hex expected hash (none, empty, upper case, 63) -> exit 2, nothing written [FR-015]" "got: $GOT queued: $(ls "$Q")"; fi

# n3 — validate compares target_sha256 with the bytes of the target it finds.
w10_sandbox w10-n3
TG="$(mk_intent)"
F="$(mk_intent action=approve "target=$(basename "$TG" .md)" "target_sha256=\"$(printf 'a%.0s' $(seq 1 64))\"" created_by=mac-robert)"
run_intent validate "$F"
expect_verdict "n3 approve whose target_sha256 differs from the target's bytes -> target_not_found [FR-006]" 1 "target_not_found"
F="$(mk_intent action=approve "target=$(basename "$TG" .md)" "target_sha256=\"$(sha256_of "$TG")\"" created_by=mac-robert)"
printf ' \n' >>"$TG"
run_intent validate "$F"
expect_verdict "n3b the target changed after the approve was written -> target_not_found [FR-006]" 1 "target_not_found"

# n1 — overlay marks refused, more than 2 combining marks in a row refused,
# non-ASCII spaces escaped, a mark never cut from its base by the wrap.
w10_sandbox w10-n1
RJ="$(w10_rejected signature_invalid "payload=|
  a =$(w10_cp 338) b")"
w10_approve_pty yes "$RJ"
if [[ "$PTY_RC" -eq 1 && "$PTY_JSON" == *display_unsafe* && "$(w10_raw_count "$SB/.pty" 338)" == "0" ]]; then ok "n1a '=' with U+0338 (renders as a not-equal sign) -> display_unsafe [FR-015]"
else bad "n1a '=' with U+0338 (renders as a not-equal sign) -> display_unsafe [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi
RJ="$(w10_rejected signature_invalid "payload=|
  x$(w10_cp 20d2)y")"
w10_approve_pty yes "$RJ"
if [[ "$PTY_RC" -eq 1 && "$PTY_JSON" == *display_unsafe* ]]; then ok "n1b another overlay mark (U+20D2) -> display_unsafe [FR-015]"
else bad "n1b another overlay mark (U+20D2) -> display_unsafe [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi
RJ="$(w10_rejected signature_invalid "payload=|
  loe$(w10_cp 301 323 304)sche")"
w10_approve_pty yes "$RJ"
if [[ "$PTY_RC" -eq 1 && "$PTY_JSON" == *display_unsafe* ]]; then ok "n1c three combining marks in a row -> display_unsafe [FR-015]"
else bad "n1c three combining marks in a row -> display_unsafe [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi
RJ="$(w10_rejected signature_invalid "payload=|
  Mu$(w10_cp 308)nchen e$(w10_cp 301 323) A$(w10_cp a0)B$(w10_cp 3000)C")"
w10_approve_pty no "$RJ"
if grep -q 'Approve?' "$SB/.pty" && grep -qF "Mu$(w10_cp 308)nchen e$(w10_cp 301 323) A\\u{a0}B\\u{3000}C" "$SB/.pty" && [[ "$(w10_raw_count "$SB/.pty" a0 3000)" == "0" ]]; then ok "n1d one or two marks shown as they are, NBSP and U+3000 escaped [FR-015]"
else bad "n1d one or two marks shown as they are, NBSP and U+3000 escaped [FR-015]" "$(tr -d '\r' <"$SB/.pty" | grep '^  | ' | head -n 2)"; fi
RJ="$(w10_rejected signature_invalid "payload=|
  $(printf 'a%.0s' $(seq 1 75))e$(w10_cp 301)z")"
w10_approve_pty no "$RJ"
GOT="$(tr -d '\r' <"$SB/.pty" | grep '^  | ' | sed -n 2p | cut -c5- | node -e 'const t = require("fs").readFileSync(0, "utf8"); process.stdout.write(String(t.codePointAt(0).toString(16)))')"
if [[ "$GOT" == "7a" ]]; then ok "n1e the wrap keeps a combining mark with its base (the mark stays on line 1, line 2 starts with z) [FR-015]"
else bad "n1e the wrap keeps a combining mark with its base (the mark stays on line 1, line 2 starts with z) [FR-015]" "second line starts with U+$GOT"; fi

# n4 — "yes" typed before the prompt WITHOUT a newline, then Enter after the
# prompt: not approved (the partial line is discarded); a bare Enter is "no".
w10_sandbox w10-n4
RJ="$(w10_rejected signature_invalid)"
cp "$RJ" "$SB/before.md"
W10_EARLY_NONL="yes"
w10_approve_pty "" "$RJ"
if [[ "$PTY_RC" -eq 1 && -z "$(ls "$Q")" ]] && cmp -s "$RJ" "$SB/before.md"; then ok "n4a type-ahead 'yes' without a newline, then Enter -> not approved [FR-015]"
else bad "n4a type-ahead 'yes' without a newline, then Enter -> not approved [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi
RJ="$(w10_rejected signature_invalid)"
w10_approve_pty "" "$RJ"
if [[ "$PTY_RC" -eq 1 && ! -e "$Q/$(basename "$RJ")" && -f "$RJ" ]]; then ok "n4b a bare Enter -> not approved [FR-015]"
else bad "n4b a bare Enter -> not approved [FR-015]" "rc $PTY_RC json $PTY_JSON"; fi

# n5 — guards for controls that were only double-guarded or unguarded.
# n5a link(2) no-clobber: a queued/<name> created between the check and the
# publish (injected link that races) is never replaced.
w10_sandbox w10-n5a
RJ="$(w10_rejected signature_invalid)"
N="$(basename "$RJ")"
cp "$RJ" "$SB/before.md"
GOT="$(w10_node 'const A = req("intent-approve.cjs");
  const link = (from, to) => { fs.writeFileSync(to, "racer\n"); fs.linkSync(from, to); };
  const r = A.reapproveIntent(argv[0], { via: "intent", approveId: argv[1], expectSha256: shaOf(argv[0]) }, { link });
  process.stdout.write([r.exitCode, (r.out && r.out.reasons || []).join(",")].join(" "));' "$RJ" "$W10_APPROVE_ID")"
if [[ "$GOT" == "1 already_moved" && "$(cat "$Q/$N")" == "racer" && "$(ls -a "$Q" | wc -l | tr -d ' ')" == "3" ]] && cmp -s "$RJ" "$SB/before.md"; then ok "n5a a queued/ file created in the race is not replaced -> already_moved, no tmp left [FR-015]"
else bad "n5a a queued/ file created in the race is not replaced -> already_moved, no tmp left [FR-015]" "got: $GOT queued: $(ls -a "$Q")"; fi

# n5b the tenth field comes before the group: frozen 14-field vector
# (openssl over vault/w10-approve-group-vector.md, hexkey 00…01).
w10_sandbox w10-n5b
cp "$SUITE_DIR/vault/w10-approve-group-vector.md" "$SB/agvec.md"
GOT="$(w10_node 'const { parseIntentFrontmatter } = req("intent-parse.cjs"); const { sign } = req("intent-sign.cjs");
  process.stdout.write(sign(parseIntentFrontmatter(fs.readFileSync(argv[0], "utf8")).fm, "0".repeat(63) + "1"));' "$SB/agvec.md")"
if [[ "$GOT" == "hmac-sha256:7c4b46992db2f0501db17abc6043bc4d38d3cb9aecf8767735ea375d03dc7469" ]]; then ok "n5b frozen 14-field vector: payload hash, target_sha256, then the group [FR-010]"
else bad "n5b frozen 14-field vector: payload hash, target_sha256, then the group [FR-010]" "got: $GOT"; fi

# n5c resolveTool returns only the absolute paths of its own table.
w10_sandbox w10-n5c
mkdir -p "$SB/fakebin"
printf '#!/bin/sh\nexit 0\n' >"$SB/fakebin/ps"
chmod 755 "$SB/fakebin/ps"
GOT="$(PATH="$SB/fakebin:$PATH" w10_node 'const D = req("intent-doctor.cjs");
  const ok = (v, list) => v === null || list.includes(v);
  process.stdout.write([ok(D.resolveTool("ps"), ["/bin/ps", "/usr/bin/ps"]), ok(D.resolveTool("lsof"), ["/usr/sbin/lsof", "/usr/bin/lsof"]), String(D.resolveTool("sh"))].join(" "));')"
if [[ "$GOT" == "true true null" ]]; then ok "n5c resolveTool: only /bin/ps, /usr/bin/ps, /usr/sbin/lsof, /usr/bin/lsof; unknown tool null [FR-037]"
else bad "n5c resolveTool: only /bin/ps, /usr/bin/ps, /usr/sbin/lsof, /usr/bin/lsof; unknown tool null [FR-037]" "got: $GOT"; fi

# n5d a secret across the 64 KiB read-chunk boundary is found.
w10_doctor_sandbox w10-n5d
node -e 'process.stdout.write("x".repeat(65536 - 20) + process.argv[1] + "\n")' "$FIXTURE_SECRET" >"$VAULT/big.md"
run_doctor
expect_doctor "n5d a secret across the 64 KiB chunk boundary -> exit 1 secret_in_vault [FR-037]" 1 secret_in_vault false

# n6 — lsof exits 1 but printed the lines of the pids still alive (a pid
# vanished between ps and lsof): the output counts.
w10_doctor_sandbox w10-n6
node -e 'const fs = require("fs"); const [f, ps, lsof] = process.argv.slice(1);
  fs.writeFileSync(f, JSON.stringify({ ps: { status: 0, stdout: fs.readFileSync(ps, "utf8"), error: null }, lsofFail: { status: 1, stdout: fs.readFileSync(lsof, "utf8"), error: null } }));' \
  "$SB/doctor-fake.json" "$W10_PS_MEASURED" "$W10_LSOF_MEASURED"
run_doctor
if [[ "$RC" -eq 1 && "$(doctor_detail obsidian_listener)" == "non-loopback: *:58589" ]]; then ok "n6a lsof rc 1 with output -> the output counts (non-loopback *:58589) [FR-037]"
else bad "n6a lsof rc 1 with output -> the output counts (non-loopback *:58589) [FR-037]" "rc $RC detail: $(doctor_detail obsidian_listener)"; fi
w10_lsof_variant 's/\*:58589/127.0.0.1:58589/'
node -e 'const fs = require("fs"); const [f, ps, lsof] = process.argv.slice(1);
  fs.writeFileSync(f, JSON.stringify({ ps: { status: 0, stdout: fs.readFileSync(ps, "utf8"), error: null }, lsofFail: { status: 1, stdout: fs.readFileSync(lsof, "utf8"), error: null } }));' \
  "$SB/doctor-fake.json" "$W10_PS_MEASURED" "$SB/lsof.txt"
run_doctor
expect_doctor "n6b lsof rc 1 with loopback-only output -> ok [FR-037]" 0 obsidian_listener true
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ ps: { status: 0, stdout: " 2776     1   501 /Applications/Obsidian.app/Contents/MacOS/Obsidian\n", error: null }, lsofFail: { status: 1, stdout: "lsof: no such process\n", error: null } }))' "$SB/doctor-fake.json"
run_doctor
expect_doctor "n6c lsof rc 1 with no usable output -> could not verify, exit 1 [FR-037]" 1 obsidian_listener false

