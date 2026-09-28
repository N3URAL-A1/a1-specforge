#!/usr/bin/env bash
# cases/02-fields.sh — spec 011 Wave 2: size before parse, payload cap, target
# rules, queue-control target lookup, timestamps/author/nonce/status, a1-only
# keys. Sourced by run-tests.sh after cases/01-validate.sh.
#
# RED proof (CONVENTIONS.md): the single production change that turns each
# case red, each measured on a cp -R copy of the tree before commit.
#   F1a moving the stat size gate in validateIntentFile behind the read (the
#       oversized file is then read: trace line and readFile counter 1).
#   F1b same mutation as F1a, seen through injected deps (read counter 1).
#   F1c dropping the byte check on the content that was read (the file grew
#       between stat and read: the parser is then called).
#   F1g the default reader being fs.readFileSync again (unbounded read:
#       full=1), or a cap above INTENT_MAX_BYTES + 1 (bounded=false).
#   F1d (control) the injected parser counter sees a normal file (1 call).
#   F1e comparing the file size with >= instead of > (8192 bytes refused).
#   F1f refused by the stat gate AND the content check; both must go.
#   F2a/F2c dropping the payload byte cap; F2c also: >= instead of >.
#   F2b measuring payload.length instead of Buffer.byteLength.
#   F2d dropping the typeof payload === "string" check (then Buffer.byteLength
#       throws: exit 2, not the verdict).
#   F3a dropping the "required target missing" branch of validateTarget.
#   F3b/F3c dropping the "target must be absent" branch.
#   F3d testing the target value (`fm.target != null`) instead of key
#       presence for the absent rule (`target:` with no value then passes).
#   F4  one shared regex for all actions (e.g. ACTION_TABLE.plan.targetRe).
#   F5  deleting the assertNoShellMetachar call in validateTarget.
#   F5b dropping the typeof target === "string" test (every action regex
#       refuses 123/true/null too, so only an accept-all row isolates it).
#   F6a accepting any ISO offset (Date.parse alone instead of the Z regex).
#   F6b dropping the calendar round trip (2026-02-30 then passes).
#   F6c a case-insensitive created_by regex; F6d/F6e length bounds of it.
#   F6f a nonce regex that accepts 31 characters; F6g one that accepts A-F.
#   F6h dropping the status === "queued" check for queued/ files.
#   F7a–g dropping the validateNoA1OnlyKeys call in validateIntentFile.
#   F7h removing one key from INTENT_A1_ONLY_KEYS (then an unknown key in
#       claimed/), or not passing the a1-only keys to validateShape.
#   F7i validateShape accepting every key outside queued/ (foo passes).
#   F7j dropping the INTENT_STATUSES check for files outside queued/.
#   F7k removing a value from INTENT_STATUSES.
#   F8a–F8e looking up only queued/ (F8b red), or one folder list shared by
#       approve and cancel (F8d red: rejected/ then cancellable).
#   F8f ignoring deps.runningId for cancel.
#   F8g failing open when no executor device is known (CLI has none yet).
#   F8h comparing created_by against "any device" instead of the executor
#       device (dropping the executorDeviceOnly check).
#   F8i approve looking in done/ as well.
#   F8j lstat replaced by stat in the lookup (a symlink then counts).
#   F9a–c (hostile) refused by the metachar guard AND the action regex; both
#       must go (validateTarget returning null after the presence checks).
#   F9d no production change turns it red: validate never evaluates a value
#       (inert by construction; the case guards a future regression).
#   SC2-w2 any child_process call on the validate path.

W2_VALID_ID="3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b"
W2_UUID_A="aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa"

# expect_includes <name> <rc> <reason> — exit code matches and <reason> is
# among the reasons (for inputs where a later wave may add a second reason).
expect_includes() {
  local name="$1" want_rc="$2" reason="$3"
  if [[ "$RC" -eq "$want_rc" ]] && node -e 'process.exit(JSON.parse(process.argv[1]).reasons.includes(process.argv[2]) ? 0 : 1)' "$OUT" "$reason" 2>/dev/null; then ok "$name"
  else bad "$name" "expected exit $want_rc with $reason, got exit $RC: ${OUT:0:300}" "stderr: ${ERR:0:300}"; fi
}

# w2_pad <file> <bytes> — appends spaces (a whitespace body is allowed) until
# the file is exactly <bytes> long.
w2_pad() {
  node -e 'const fs = require("fs"); const [p, n] = [process.argv[1], Number(process.argv[2])];
    const s = fs.statSync(p).size; if (s > n) { console.error(`already ${s}`); process.exit(1); }
    fs.appendFileSync(p, " ".repeat(n - s));' "$1" "$2"
}

# w2_node <script> [args...] — runs a node script with the sandbox HOME and
# vault; `V` is intent-validate.cjs. Prints what the script prints.
w2_node() {
  local script="$1"
  shift
  HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node -e "const V = require(process.argv[1] + '/intent-validate.cjs'); $script" "$INTENT_LIB" "$@" 2>&1
}

w2_check() { # <name> <want> <got>
  if [[ "$3" == "$2" ]]; then ok "$1"; else bad "$1" "want: $2" "got:  $3"; fi
}

# ---------- F1: size before parse ----------
new_sandbox f1
mk_project real-proj
cp "$SUITE_DIR/vault/oversized.md" "$Q/$W2_VALID_ID.md"
run_intent validate "$Q/$W2_VALID_ID.md"
f1_reads="$(grep '^read ' "$TRACE" | grep -F "$W2_VALID_ID.md")"
if [[ -z "$f1_reads" ]]; then expect_verdict "F1a 9 KB file -> oversized, the file is never read (trace) [FR-005]" 1 "oversized"
else bad "F1a 9 KB file -> oversized, the file is never read (trace) [FR-005]" "reads: ${f1_reads:0:300}"; fi
f1_counted='
  const fs = require("fs"); let parses = 0; let reads = 0;
  const deps = { parseFrontmatter: (c) => { parses += 1; return V.parseIntentFrontmatter(c); },
    readFile: (...a) => { reads += 1; return fs.readFileSync(...a); } };
  if (process.argv[3] === "race") {
    deps.fstat = (fd) => { const s = fs.fstatSync(fd); return { size: 100, isFile: () => s.isFile(), isDirectory: () => s.isDirectory() }; };
  }
  const r = V.validateIntentFile(process.argv[2], deps);
  console.log(`${r.reasons.join(",")} parses=${parses} reads=${reads}`);'
w2_check "F1b 9 KB file via deps: oversized, parser 0 calls, readFile 0 calls [FR-005]" \
  "oversized parses=0 reads=0" "$(w2_node "$f1_counted" "$Q/$W2_VALID_ID.md" plain)"
w2_check "F1c file grew after stat (stat says 100 B, content 9 KB): oversized, parser 0 calls [FR-005]" \
  "oversized parses=0 reads=1" "$(w2_node "$f1_counted" "$Q/$W2_VALID_ID.md" race)"
# F1g (Wave 3, bounded read): stat lies (100 B) about a 1 MiB file and NO
# reader is injected, so production's default reader runs; it must stop one
# byte past the cap and never call readFileSync on the intent.
f1_big="$Q/99999999-9999-4999-8999-999999999999.md"
{ cat "$(mk_intent)"; head -c 1048576 /dev/zero | tr '\0' ' '; } >"$f1_big"
f1_bounded='
  const fs = require("fs"); let bytes = 0; let full = 0;
  const origRead = fs.readSync; const origFull = fs.readFileSync;
  fs.readSync = (...a) => { const n = origRead(...a); bytes += n; return n; };
  fs.readFileSync = (p, ...r) => { if (String(p) === process.argv[2]) full += 1; return origFull(p, ...r); };
  const fstat = (fd) => { const s = fs.fstatSync(fd); return { size: 100, isFile: () => s.isFile(), isDirectory: () => s.isDirectory() }; };
  const r = V.validateIntentFile(process.argv[2], { fstat });
  console.log(`${r.reasons.join(",")} bounded=${bytes > 0 && bytes <= 8193} full=${full}`);'
w2_check "F1g file grew after stat to 1 MiB: default reader reads at most 8193 bytes, oversized [FR-005]" \
  "oversized bounded=true full=0" "$(w2_node "$f1_bounded" "$f1_big")"
rm -f "$f1_big"
f1_small="$(mk_intent)"
w2_check "F1d control: a normal file reaches the injected parser exactly once [FR-005]" \
  " parses=1 reads=1" "$(w2_node "$f1_counted" "$f1_small" plain)"
f1_exact="$(mk_intent)"
w2_pad "$f1_exact" 8192
run_intent validate "$f1_exact"
expect_verdict "F1e file of exactly 8192 bytes passes the size check [FR-005]" 0 ""
f1_over="$(mk_intent)"
w2_pad "$f1_over" 8193
run_intent validate "$f1_over"
expect_verdict "F1f file of 8193 bytes -> oversized [FR-005]" 1 "oversized"

# ---------- F2: payload byte cap ----------
new_sandbox f2
mk_project real-proj
run_intent validate "$(mk_intent "payload=|
  $(printf 'x%.0s' $(seq 6700))")"
f2_size="$(wc -c <"$(ls "$Q"/*.md | head -1)" | tr -d ' ')"
if [[ "$f2_size" -lt 8192 && "$f2_size" -gt 7000 ]]; then expect_verdict "F2a 7 KB file with a 6.5 KB payload -> oversized [FR-005]" 1 "oversized"
else bad "F2a 7 KB file with a 6.5 KB payload -> oversized [FR-005]" "fixture file is $f2_size bytes, expected 7000..8191"; fi
rm -f "$Q"/*.md
run_intent validate "$(mk_intent "payload=|-
  $(printf 'ä%.0s' $(seq 3100))")"
expect_verdict "F2b payload of 3100 x 'ä' (6200 bytes, 3100 chars) -> oversized [FR-005]" 1 "oversized"
run_intent validate "$(mk_intent "payload=|-
  $(printf 'x%.0s' $(seq 6144))")"
expect_verdict "F2c payload of exactly 6144 bytes passes [FR-005]" 0 ""
run_intent validate "$(mk_intent "payload=|-
  $(printf 'x%.0s' $(seq 6145))")"
expect_verdict "F2c2 payload of 6145 bytes -> oversized [FR-005]" 1 "oversized"
run_intent validate "$(mk_intent payload=42)"
expect_verdict "F2d payload: 42 (not a string) -> schema_invalid [FR-005]" 1 "schema_invalid"

# ---------- F3: target required / forbidden ----------
new_sandbox f3
mk_project real-proj
run_intent validate "$(mk_intent action=plan)"
expect_verdict "F3a plan without target -> target_invalid [FR-006]" 1 "target_invalid"
run_intent validate "$(mk_intent target=M2-P1-sidebar)"
expect_verdict "F3b new-feature with a target -> target_invalid [FR-006]" 1 "target_invalid"
run_intent validate "$(mk_intent action=progress target=M2-P1-sidebar)"
expect_verdict "F3c progress with a target -> target_invalid [FR-006]" 1 "target_invalid"
run_intent validate "$(mk_intent action=fix 'target=')"
expect_verdict "F3d fix with an empty 'target:' key -> target_invalid (absent means no key) [FR-006]" 1 "target_invalid"
run_intent validate "$(mk_intent action=plan target=M2-P1-sidebar)"
expect_verdict "F3e control: plan with M2-P1-sidebar -> valid [FR-006]" 0 ""

# ---------- F4: target regex per action ----------
new_sandbox f4
mk_project real-proj
# Spec round 6: an approve carries target_sha256 (required); every other
# action must not.
W2_TSHA="9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
f4_row() { # <name> <want-rc> <want-reasons> <action> <target>
  if [[ "$4" == "approve" ]]; then run_intent validate "$(mk_intent "action=$4" "target=$5" "target_sha256=\"$W2_TSHA\"")"
  else run_intent validate "$(mk_intent "action=$4" "target=$5")"; fi
  expect_verdict "$1" "$2" "$3"
}
f4_row "F4a execute + M2-P1-sidebar -> valid [FR-006]" 0 "" execute M2-P1-sidebar
f4_row "F4b execute + m2-p1 -> target_invalid [FR-006]" 1 "target_invalid" execute m2-p1
f4_row "F4c stage + 003-foo:review -> valid [FR-006]" 0 "" stage 003-foo:review
f4_row "F4d stage + 003-foo:shipped -> target_invalid [FR-006]" 1 "target_invalid" stage 003-foo:shipped
f4_row "F4e continue-feature + 012-abc -> valid [FR-006]" 0 "" continue-feature 012-abc
f4_row "F4f continue-feature + M2-P1-x (a phase name) -> target_invalid [FR-006]" 1 "target_invalid" continue-feature M2-P1-x
f4_row "F4g execute + 012-abc (a spec id) -> target_invalid [FR-006]" 1 "target_invalid" execute 012-abc
f4_row "F4h stage + 012-abc (no stage suffix) -> target_invalid [FR-006]" 1 "target_invalid" stage 012-abc
f4_row "F4i approve + M2-P1-x -> target_invalid (a shape reason: the executor-device rule runs only after authentication) [FR-006]" 1 "target_invalid" approve M2-P1-x
f4_row "F4j cancel + M2-P1-x -> target_invalid [FR-006]" 1 "target_invalid" cancel M2-P1-x
run_intent validate "$(mk_intent action=cancel)"
expect_verdict "F4k cancel without target -> target_invalid [FR-006]" 1 "target_invalid"
run_intent validate "$(mk_intent action=cancel "target=$W2_UUID_A")"
expect_no_reason "F4l cancel + a lowercase v4 uuid -> not target_invalid [FR-006]" target_invalid
run_intent validate "$(mk_intent action=cancel target=AAAAAAAA-1111-4AAA-8AAA-AAAAAAAAAAAA)"
expect_verdict "F4m cancel + an uppercase uuid -> target_invalid [FR-006]" 1 "target_invalid"

# ---------- F5: shell metacharacter guard, isolated from the regex ----------
new_sandbox f5
f5_out="$(w2_node '
  const row = Object.freeze({ kind: "claude", targetRequired: true, targetRe: /.*/ });
  const bad = ["M2-P1-x;id", "$(id)", "`id`", "a|b", "a&b", "a>b", "a<b", "a{b}", "a\nb"];
  const got = bad.map((t) => V.validateTarget({ target: t }, row));
  const ctl = V.validateTarget({ target: "M2-P1-x id*" }, row);
  console.log(`${got.every((r) => r === "target_invalid")} ${ctl}`);')"
w2_check "F5 with an accept-all regex, ; \$( \` | & > < { newline still -> target_invalid; a plain target passes [FR-006]" "true null" "$f5_out"
f5b_out="$(w2_node '
  const row = Object.freeze({ kind: "claude", targetRequired: true, targetRe: /.*/ });
  console.log([123, true, null].map((t) => V.validateTarget({ target: t }, row)).join(","));')"
w2_check "F5b with an accept-all regex, a non-string target (123, true, null) -> target_invalid [FR-006]" \
  "target_invalid,target_invalid,target_invalid" "$f5b_out"

# ---------- F6: timestamps, author, nonce, status ----------
new_sandbox f6
mk_project real-proj
f6_now_plus2="$(node -e 'const d = new Date(Date.now() + 2 * 3600e3); console.log(d.toISOString().slice(0, 19) + "+02:00")')"
f6_now_noz="$(node -e 'console.log(new Date().toISOString().slice(0, 19))')"
f6_now_s="$(node -e 'console.log(new Date().toISOString().slice(0, 19) + "Z")')"
run_intent validate "$(mk_intent "created_at=$f6_now_plus2")"
expect_verdict "F6a created_at with +02:00 offset (same instant, no Z) -> schema_invalid [FR-007]" 1 "schema_invalid"
run_intent validate "$(mk_intent "created_at=$f6_now_noz")"
expect_verdict "F6a2 created_at without any zone -> schema_invalid [FR-007]" 1 "schema_invalid"
run_intent validate "$(mk_intent created_at=2026-02-30T10:00:00Z)"
expect_includes "F6b created_at 2026-02-30T10:00:00Z (no such day) -> schema_invalid [FR-007]" 1 "schema_invalid"
run_intent validate "$(mk_intent "created_at=$f6_now_s")"
expect_verdict "F6b2 control: created_at without milliseconds, Z suffix -> valid [FR-007]" 0 ""
run_intent validate "$(mk_intent created_by=Pixel)"
expect_verdict "F6c created_by: Pixel (uppercase) -> schema_invalid [FR-007]" 1 "schema_invalid"
run_intent validate "$(mk_intent created_by=p)"
expect_verdict "F6d created_by of 1 char -> schema_invalid [FR-007]" 1 "schema_invalid"
run_intent validate "$(mk_intent "created_by=p$(printf 'x%.0s' $(seq 64))")"
expect_verdict "F6e created_by of 65 chars -> schema_invalid [FR-007]" 1 "schema_invalid"
run_intent validate "$(mk_intent "created_by=p$(printf 'x%.0s' $(seq 63))")"
# Wave 3: a 64-char author passes every shape rule and so reaches the device
# lookup; no such device is provisioned, hence device_unknown, not schema_invalid.
expect_verdict "F6e2 control: created_by of 64 chars passes the shape rules (reaches the device lookup) [FR-007]" 1 "device_unknown"
run_intent validate "$(mk_intent created_by=-pixel)"
expect_verdict "F6e3 created_by starting with '-' -> schema_invalid [FR-007]" 1 "schema_invalid"
run_intent validate "$(mk_intent nonce=0f1e2d3c4b5a69788796a5b4c3d2e1f)"
expect_verdict "F6f 31-hex nonce -> schema_invalid [FR-007]" 1 "schema_invalid"
run_intent validate "$(mk_intent nonce=0F1E2D3C4B5A69788796A5B4C3D2E1F0)"
expect_verdict "F6g 32 uppercase hex nonce -> schema_invalid [FR-007]" 1 "schema_invalid"
run_intent validate "$(mk_intent nonce=0f1e2d3c4b5a69788796a5b4c3d2e1fg)"
expect_verdict "F6g2 32-char nonce with a non-hex g -> schema_invalid [FR-007]" 1 "schema_invalid"
run_intent validate "$(mk_intent status=claimed)"
expect_verdict "F6h status: claimed in queued/ -> schema_invalid [FR-007]" 1 "schema_invalid"
run_intent validate "$(mk_intent status=done)"
expect_verdict "F6h2 status: done in queued/ -> schema_invalid [FR-007]" 1 "schema_invalid"

# ---------- F7: a1-only keys forbidden in queued/ ----------
new_sandbox f7
mk_project real-proj
for k in claimed_by claimed_at started_at finished_at exit_code rejected_reason rejected_by; do
  run_intent validate "$(mk_intent "@raw=$k: x")"
  expect_verdict "F7 $k in a queued/ file -> schema_invalid [FR-008]" 1 "schema_invalid"
done
C="$VAULT/inbox/intents/claimed"
f7_claimed="$(mk_intent status=claimed '@raw=claimed_by: mac-robert' "@raw=claimed_at: $f6_now_s" \
  "@raw=started_at: $f6_now_s" "@raw=finished_at: $f6_now_s" '@raw=exit_code: 0' '@raw=rejected_reason: stale' '@raw=rejected_by: mac-robert')"
mv "$f7_claimed" "$C/"
run_intent validate "$C/$(basename "$f7_claimed")"
expect_verdict "F7h claimed/ file with all 7 a1-only keys and status: claimed -> valid (FR-008 forbids them in queued/ only) [FR-008]" 0 ""
f7_foo="$(mk_intent status=claimed '@raw=foo: 1')"
mv "$f7_foo" "$C/"
run_intent validate "$C/$(basename "$f7_foo")"
expect_verdict "F7i claimed/ file with an unknown key foo -> schema_invalid [FR-008]" 1 "schema_invalid"
f7_bogus="$(mk_intent status=paused)"
mv "$f7_bogus" "$C/"
run_intent validate "$C/$(basename "$f7_bogus")"
expect_verdict "F7j claimed/ file with status: paused (not one of the six) -> schema_invalid [FR-008]" 1 "schema_invalid"
f7_sets="$(node -e '
  const s = require(process.argv[1] + "/status-constants.cjs").INTENT_STATUSES;
  const S = ["queued", "claimed", "running", "done", "failed", "rejected"];
  console.log(s instanceof Set && s.size === 6 && S.every((x) => s.has(x)));' "$INTENT_LIB" 2>&1)"
w2_check "F7k INTENT_STATUSES is exactly the six-value set (fixture's own list) [FR-008]" "true" "$f7_sets"

# ---------- F8: queue-control target lookup ----------
new_sandbox f8
mk_project real-proj
I="$VAULT/inbox/intents"
f8_place() { # <folder> <uuid> — a plain file named <uuid>.md in <folder>
  printf -- '---\ntype: intent\n---\n' >"$I/$1/$2.md"
}
T_CLAIMED="bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb"; f8_place claimed "$T_CLAIMED"
T_QUEUED="cccccccc-3333-4ccc-8ccc-cccccccccccc"; f8_place queued "$T_QUEUED"
T_REJECTED="dddddddd-4444-4ddd-8ddd-dddddddddddd"; f8_place rejected "$T_REJECTED"
T_DONE="eeeeeeee-5555-4eee-8eee-eeeeeeeeeeee"; f8_place done "$T_DONE"
T_LINK="ffffffff-6666-4fff-8fff-ffffffffffff"; ln -s "$I/claimed/$T_CLAIMED.md" "$I/claimed/$T_LINK.md"
T_CONFLICT="99999999-7777-4999-8999-999999999999"; printf 'x\n' >"$I/claimed/$T_CONFLICT (conflict 2026-09-24).md"
run_intent validate "$(mk_intent action=cancel "target=$W2_UUID_A")"
expect_verdict "F8a cancel of a uuid with no file -> target_not_found [FR-006]" 1 "target_not_found"
run_intent validate "$(mk_intent action=cancel "target=$T_CLAIMED")"
expect_verdict "F8b cancel of a uuid present in claimed/ -> valid [FR-006]" 0 ""
run_intent validate "$(mk_intent action=cancel "target=$T_QUEUED")"
expect_verdict "F8c cancel of a uuid present in queued/ -> valid [FR-006]" 0 ""
run_intent validate "$(mk_intent action=cancel "target=$T_REJECTED")"
expect_verdict "F8d cancel of a uuid only in rejected/ -> target_not_found [FR-006]" 1 "target_not_found"
run_intent validate "$(mk_intent action=cancel "target=$T_DONE")"
expect_verdict "F8e cancel of a uuid only in done/ -> target_not_found [FR-006]" 1 "target_not_found"
f8_js='
  const [file, extra] = [process.argv[2], JSON.parse(process.argv[3] || "{}")];
  const r = V.validateIntentFile(file, extra);
  console.log(`[${r.reasons.join(",")}]`);'
f8_run="$(mk_intent action=cancel "target=$W2_UUID_A")"
w2_check "F8f cancel of the running intent (deps.runningId, no file) -> valid [FR-006]" "[]" \
  "$(w2_node "$f8_js" "$f8_run" "{\"runningId\":\"$W2_UUID_A\"}")"
w2_check "F8f2 cancel while a different intent runs -> target_not_found [FR-006]" "[target_not_found]" \
  "$(w2_node "$f8_js" "$f8_run" '{"runningId":"12345678-1234-4234-8234-123456789012"}')"
# target_sha256 is the sha256 of the target's bytes (spec round 6, FR-006).
W2_SHA_REJ="$(sha256_of "$I/rejected/$T_REJECTED.md")"
W2_SHA_Q="$(sha256_of "$I/queued/$T_QUEUED.md")"
W2_SHA_C="$(sha256_of "$I/claimed/$T_CLAIMED.md")"
run_intent validate "$(mk_intent action=approve "target_sha256=\"$W2_SHA_REJ\"" "target=$T_REJECTED")"
expect_verdict "F8g approve via the CLI, no executor device known yet -> approve_from_non_executor_device (fail closed) [FR-006]" 1 "approve_from_non_executor_device"
f8_pixel="$(mk_intent action=approve "target_sha256=\"$W2_SHA_REJ\"" "target=$T_REJECTED" created_by=pixel-robert)"
w2_check "F8h approve signed by pixel-robert (executor device is mac-robert) -> approve_from_non_executor_device [FR-006]" \
  "[approve_from_non_executor_device]" "$(w2_node "$f8_js" "$f8_pixel" '{"executorDevice":"mac-robert"}')"
f8_mac_rej="$(mk_intent action=approve "target_sha256=\"$W2_SHA_REJ\"" "target=$T_REJECTED" created_by=mac-robert)"
w2_check "F8h2 approve signed by the executor device, target in rejected/ -> valid [FR-006]" \
  "[]" "$(w2_node "$f8_js" "$f8_mac_rej" '{"executorDevice":"mac-robert"}')"
f8_mac_q="$(mk_intent action=approve "target_sha256=\"$W2_SHA_Q\"" "target=$T_QUEUED" created_by=mac-robert)"
f8_mac_c="$(mk_intent action=approve "target_sha256=\"$W2_SHA_C\"" "target=$T_CLAIMED" created_by=mac-robert)"
w2_check "F8h3 approve by the executor device, target in queued/ and in claimed/ -> valid [FR-006]" \
  "[] []" "$(w2_node "$f8_js" "$f8_mac_q" '{"executorDevice":"mac-robert"}') $(w2_node "$f8_js" "$f8_mac_c" '{"executorDevice":"mac-robert"}')"
f8_mac_done="$(mk_intent action=approve "target_sha256=\"$W2_TSHA\"" "target=$T_DONE" created_by=mac-robert)"
w2_check "F8i approve of a uuid only in done/ -> target_not_found [FR-006]" \
  "[target_not_found]" "$(w2_node "$f8_js" "$f8_mac_done" '{"executorDevice":"mac-robert"}')"
run_intent validate "$(mk_intent action=cancel "target=$T_LINK")"
expect_verdict "F8j cancel of a uuid whose claimed/ entry is a symlink -> target_not_found [FR-006]" 1 "target_not_found"
run_intent validate "$(mk_intent action=cancel "target=$T_CONFLICT")"
expect_verdict "F8k cancel of a uuid present only as a conflict copy -> target_not_found [FR-006]" 1 "target_not_found"

# ---------- F9: hostile targets (CONVENTIONS mandatory case) ----------
new_sandbox f9
mk_project real-proj
f9_out="$(w2_node '
  const t0 = Date.now();
  const long = "M2-P1-" + "a".repeat(10000);
  const r = V.validateTarget({ target: long + ";" }, { kind: "claude", targetRequired: true, targetRe: /^M\d+-P\d+-[a-z0-9][a-z0-9-]*$/ });
  console.log(`${r} ${Date.now() - t0 < 1000}`);')"
w2_check "F9a 10000-char target with a ; -> target_invalid within 1 s [FR-006]" "target_invalid true" "$f9_out"
run_intent validate "$(mk_intent action=continue-feature "target=\"\$(touch $SB/pwned)\"")"
expect_verdict "F9b continue-feature target: \"\$(touch …)\" -> target_invalid [FR-006]" 1 "target_invalid"
run_intent validate "$(mk_intent action=execute "target=\"M2-P1-x; touch $SB/pwned\"")"
expect_verdict "F9c execute target: \"M2-P1-x; touch …\" -> target_invalid [FR-006]" 1 "target_invalid"
if [[ ! -e "$SB/pwned" ]]; then ok "F9d injection-shaped targets stay inert: nothing created [FR-006]"
else bad "F9d injection-shaped targets stay inert: nothing created [FR-006]"; fi

# ---------- SC-002: Wave 2 validate calls spawn nothing ----------
w2_spawns="$(cat "$WORK"/f[0-9]*/trace.log | grep -c '^spawn ')"
if [[ "$w2_spawns" -eq 0 ]]; then ok "SC2-w2 all Wave 2 validate calls: 0 child processes [SC-002]"
else bad "SC2-w2 all Wave 2 validate calls: 0 child processes [SC-002]" "spawns=$w2_spawns"; fi
