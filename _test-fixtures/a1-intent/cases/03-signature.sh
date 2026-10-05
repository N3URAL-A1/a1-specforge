#!/usr/bin/env bash
# cases/03-signature.sh — spec 011 Wave 3: canonical string, HMAC signature,
# device secrets, freshness. Sourced by run-tests.sh.
#
# RED proof (CONVENTIONS.md): the single production change that turns each
# case red, each measured on a cp -R copy of the tree before commit.
#   S1  any change to field order or separator in canonicalString (e.g. "\r\n"
#       or target before project), or keying the HMAC with the hex TEXT
#       instead of the 32 raw bytes.
#   S2  hashing `payload.length` instead of the payload bytes (S2a), omitting
#       `target` from the string (S2b), dropping any one field (S2c).
#   S3  FILE_MODE 0o600 -> 0o644 in intent-devices.cjs (S3b), DIR_MODE 0o700
#       -> 0o755 (S3c), printing the secret a second time, e.g. in the stderr
#       hint (S3d), dropping the "exists and not revoked" refusal (S3e),
#       dropping the requireTty() check (S3f/S3g), dropping --qr handling
#       (S3h).
#   S4  ignoring `revoked_at` in lookupDevice (S4b), revoke not writing
#       revoked_at (S4a).
#   S5  comparing with === / Buffer.equals instead of timingSafeEqual (S5c:
#       the injected spy is called 0 times), checking freshness before the
#       signature (S5d), dropping the `$` anchor of SIGNATURE_RE (S5e: a
#       signature with two extra hex chars passes), matching it case-blind
#       (S5f: the uppercase form passes).
#   S6  dropping the future-skew branch (S6c), `>=` instead of `>` at the
#       past bound (S6e).
#   S7  none — the SC-003 sensor, a Gegentest kept although no single
#       mutation is named.
#   S8  returning an empty map on a corrupt devices file (S8a/S8b), following
#       a symlinked devices.json (S8c).
#   S9  dropping DEVICE_ID_RE from addDevice (S9: "../x" is stored).
#   S11 dropping the assertOutsideVault() call (a HOME inside the vault then
#       gets devices.json written into the vault).
#   S12 see the S12 block (wiring into validateIntentFile).
#   S13 dropping `detail` or `payloadSha256` from the validate result.
#   S10 removing `device` from the intent-cli table (S10a: unknown subcommand
#       text), or an unknown verb falling through to add (S10b).
#
# The fixture computes signatures with the exported sign() — the ONE place it
# shares code with production, deliberately (Lumen must reproduce it byte for
# byte). S1 holds the frozen vector computed independently once:
#   printf '1\n<id>\nnew-feature\nreal-proj\n\n<created_at>\npixel-robert\n<nonce>\n<sha256(payload)>' \
#     | openssl dgst -sha256 -mac HMAC -macopt hexkey:00…01
# (-mac HMAC -macopt hexkey: because the key is the secret's raw bytes;
# `openssl dgst -hmac <key>` would key with the ASCII text.)

W3_SECRET_ONE="0000000000000000000000000000000000000000000000000000000000000001"
W3_VECTOR_HEX="18aa9d63d9cd70dac2bc0c8177b2d32e2587327e951fef71ff9bae77696bafb0"
W3_PAYLOAD_SHA="d44c6af75fba4ec2d394ccdea93c260a30d1136805313cfde73375cd75e74fd7"

# w3_device <verb> <args...> — `intent device …` on a pty inside the sandbox.
# Output in $SB/.pty, exit code in W3_RC.
# (Pseudo-terminal via lib.sh pty_run; `provision` there is the add-only form.)
w3_device() {
  pty_run "$SB/.pty" env HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent device "$@"
  W3_RC=$PTY_RC
}

# w3_secret <device-id> — the stored secret of a device (from devices.json).
w3_secret() {
  node -e 'const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(d.devices[process.argv[2]].secret_hex)' \
    "$FHOME/.a1-intents/devices.json" "$1"
}

# w3_mode <path> — octal permission bits, portable (no BSD-only stat flags).
w3_mode() { node -e 'process.stdout.write((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$1"; }

# w3_node <js> [args...] — runs JS with the intent modules as `S` (sign),
# `D` (devices), `V` (validate) and the valid.md frontmatter as `fm`.
w3_node() {
  local js="$1"
  shift
  HOME="$FHOME" node -e "
    const lib = process.argv[1];
    const S = require(lib + '/intent-sign.cjs');
    const D = require(lib + '/intent-devices.cjs');
    const V = require(lib + '/intent-validate.cjs');
    const fm = V.parseIntentFrontmatter(require('fs').readFileSync(process.argv[2], 'utf8')).fm;
    const argv = process.argv.slice(3);
    $js" "$INTENT_LIB" "$SUITE_DIR/vault/valid.md" "$@" 2>&1
}

# ---------- S1: frozen vector ----------
new_sandbox s1
s1_got="$(w3_node 'console.log(S.sign(fm, argv[0]) + " " + S.payloadSha256(fm))' "$W3_SECRET_ONE")"
if [[ "$s1_got" == "hmac-sha256:$W3_VECTOR_HEX $W3_PAYLOAD_SHA" ]]; then
  ok "S1 frozen vector: valid.md fields + secret 00..01 give the openssl-computed HMAC [FR-010]"
else bad "S1 frozen vector: valid.md fields + secret 00..01 give the openssl-computed HMAC [FR-010]" "got: $s1_got"; fi

s1b="$(w3_node 'console.log(JSON.stringify(S.canonicalString(fm)))')"
s1b_want="\"1\\n3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b\\nnew-feature\\nreal-proj\\n\\n2026-09-24T12:00:00.000Z\\npixel-robert\\n0f1e2d3c4b5a69788796a5b4c3d2e1f0\\n$W3_PAYLOAD_SHA\""
if [[ "$s1b" == "$s1b_want" ]]; then ok "S1b canonical string is the nine fields joined by \\n, no trailing newline [FR-010]"
else bad "S1b canonical string is the nine fields joined by \\n, no trailing newline [FR-010]" "got:  $s1b" "want: $s1b_want"; fi

# ---------- S2: every canonical field is bound ----------
s2a="$(w3_node '
  const base = S.sign(fm, argv[0]);
  const flip = S.sign({ ...fm, payload: fm.payload.replace("A", "B") }, argv[0]);
  const same = S.sign({ ...fm, payload: fm.payload.replace("A", "B").replace("u", "v") }, argv[0]);
  console.log(base !== flip && flip !== same && fm.payload.length === fm.payload.replace("A", "B").length ? "ok" : "same")' "$W3_SECRET_ONE")"
[[ "$s2a" == "ok" ]] && ok "S2a a one-byte payload change (same length) changes the signature [FR-010]" \
  || bad "S2a a one-byte payload change (same length) changes the signature [FR-010]" "$s2a"

s2b="$(w3_node '
  const a = S.sign(fm, argv[0]);
  const b = S.sign({ ...fm, target: "M2-P1-x" }, argv[0]);
  const c = S.sign({ ...fm, target: null }, argv[0]);
  console.log(a !== b && a === c ? "ok" : `a=${a} b=${b} c=${c}`)' "$W3_SECRET_ONE")"
[[ "$s2b" == "ok" ]] && ok "S2b adding target changes the signature; absent target signs as empty [FR-010]" \
  || bad "S2b adding target changes the signature; absent target signs as empty [FR-010]" "$s2b"

s2c="$(w3_node '
  const alt = { schema_version: 2, id: "4f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b", action: "fix", project: "other-proj",
    created_at: "2026-09-24T12:00:01.000Z", created_by: "pixel-other", nonce: "1f1e2d3c4b5a69788796a5b4c3d2e1f0" };
  const base = S.sign(fm, argv[0]);
  const same = Object.keys(alt).filter((k) => S.sign({ ...fm, [k]: alt[k] }, argv[0]) === base);
  console.log(Object.keys(alt).length === 7 && same.length === 0 ? "ok" : `unbound: ${same}`)' "$W3_SECRET_ONE")"
[[ "$s2c" == "ok" ]] && ok "S2c changing any other canonical field changes the signature (7 fields) [FR-010]" \
  || bad "S2c changing any other canonical field changes the signature (7 fields) [FR-010]" "$s2c"

# ---------- S3: provisioning on a TTY ----------
new_sandbox s3
rm -rf "$FHOME/.a1-intents"
w3_device add pixel
s3_rc=$W3_RC
if [[ $s3_rc -eq 0 && -f "$FHOME/.a1-intents/devices.json" ]]; then ok "S3a pty device add pixel -> exit 0, devices.json exists [FR-011]"
else bad "S3a pty device add pixel -> exit 0, devices.json exists [FR-011]" "rc=$s3_rc" "$(tr -d '\r' <"$SB/.pty" | head -5)"; fi
s3_mode="$(w3_mode "$FHOME/.a1-intents/devices.json" 2>/dev/null)"
[[ "$s3_mode" == "600" ]] && ok "S3b devices.json mode is 600 [FR-011]" || bad "S3b devices.json mode is 600 [FR-011]" "mode=$s3_mode"
s3_dmode="$(w3_mode "$FHOME/.a1-intents" 2>/dev/null)"
[[ "$s3_dmode" == "700" ]] && ok "S3c ~/.a1-intents mode is 700 [FR-011]" || bad "S3c ~/.a1-intents mode is 700 [FR-011]" "mode=$s3_dmode"
s3_secret="$(w3_secret pixel 2>/dev/null)"
s3_count="$(grep -oF "${s3_secret:-<none>}" "$SB/.pty" | wc -l | tr -d ' ')"
if [[ ${#s3_secret} -eq 64 && "$s3_count" == "1" ]]; then ok "S3d the 64-hex secret appears exactly once in the pty output [FR-011]"
else bad "S3d the 64-hex secret appears exactly once in the pty output [FR-011]" "len=${#s3_secret} count=$s3_count"; fi
s3_before="$(cat "$FHOME/.a1-intents/devices.json")"
w3_device add pixel
if [[ $W3_RC -eq 1 && "$(cat "$FHOME/.a1-intents/devices.json")" == "$s3_before" ]] && ! grep -qF "$s3_secret" "$SB/.pty"; then
  ok "S3e second add of a live device -> exit 1, file unchanged, secret not re-printed [FR-011]"
else bad "S3e second add of a live device -> exit 1, file unchanged, secret not re-printed [FR-011]" "rc=$W3_RC"; fi
HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent device add tablet >"$SB/.out" 2>"$SB/.err" </dev/null
s3f_rc=$?
if [[ $s3f_rc -eq 1 && "$(cat "$FHOME/.a1-intents/devices.json")" == "$s3_before" && ! -s "$SB/.out" ]]; then
  ok "S3f non-TTY add -> exit 1, nothing on stdout, file unchanged [FR-011]"
else bad "S3f non-TTY add -> exit 1, nothing on stdout, file unchanged [FR-011]" "rc=$s3f_rc stdout=$(head -c 200 "$SB/.out")"; fi
new_sandbox s3g
rm -rf "$FHOME/.a1-intents"
HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent device add pixel >"$SB/.out" 2>"$SB/.err" </dev/null
s3g_rc=$?
if [[ $s3g_rc -eq 1 && ! -e "$FHOME/.a1-intents" ]]; then ok "S3g non-TTY add on a fresh home -> exit 1, ~/.a1-intents not even created [FR-011]"
else bad "S3g non-TTY add on a fresh home -> exit 1, ~/.a1-intents not even created [FR-011]" "rc=$s3g_rc" "$(ls -la "$FHOME/.a1-intents" 2>&1)"; fi
w3_device add pixel --qr
s3h_secret="$(w3_secret pixel 2>/dev/null)"
s3h_qr="$(grep -oF "a1-intent://provision?device=pixel&secret=${s3h_secret:-<none>}" "$SB/.pty" | wc -l | tr -d ' ')"
s3h_count="$(grep -oF "${s3h_secret:-<none>}" "$SB/.pty" | wc -l | tr -d ' ')"
if [[ $W3_RC -eq 0 && "$s3h_qr" == "1" && "$s3h_count" == "1" ]]; then ok "S3h --qr prints the provisioning payload, secret still exactly once [FR-011]"
else bad "S3h --qr prints the provisioning payload, secret still exactly once [FR-011]" "rc=$W3_RC qr=$s3h_qr count=$s3h_count"; fi

# ---------- S4: revoke ----------
new_sandbox s4
w3_device add pixel
HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent device revoke pixel >"$SB/.out" 2>"$SB/.err" </dev/null
s4_rc=$?
s4_rev="$(node -e 'const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).devices.pixel; process.stdout.write(String(d.revoked_at !== null && Number.isFinite(Date.parse(d.revoked_at))))' "$FHOME/.a1-intents/devices.json")"
if [[ $s4_rc -eq 0 && "$s4_rev" == "true" ]]; then ok "S4a device revoke pixel -> exit 0, revoked_at is an ISO timestamp [FR-011]"
else bad "S4a device revoke pixel -> exit 0, revoked_at is an ISO timestamp [FR-011]" "rc=$s4_rc revoked=$s4_rev $(cat "$SB/.err")"; fi
s4b="$(w3_node 'const d = D.loadDevices(); console.log(`${D.lookupDevice(d, "pixel")} ${D.lookupDevice(d, "nobody")} ${D.lookupDevice(d, "__proto__")}`)')"
[[ "$s4b" == "null null null" ]] && ok "S4b lookup of a revoked, an unknown and a prototype-named device gives no secret [FR-012]" \
  || bad "S4b lookup of a revoked, an unknown and a prototype-named device gives no secret [FR-012]" "$s4b"
HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent device revoke nobody >"$SB/.out" 2>"$SB/.err" </dev/null
[[ $? -eq 1 ]] && ok "S4c revoke of an unknown device -> exit 1 [FR-011]" || bad "S4c revoke of an unknown device -> exit 1 [FR-011]" "$(cat "$SB/.out")"

# ---------- S5: forged, unknown device, ordering, constant-time compare ----------
new_sandbox s5
s5="$(w3_node '
  const good = argv[0];
  const wrong = "f".repeat(64);
  const lookup = (id) => (id === "pixel-robert" ? good : null);
  const limits = { freshnessMs: 900000, skewMs: 120000 };
  const now = Date.parse("2026-09-24T12:05:00.000Z");
  const signed = { ...fm, signature: S.sign(fm, good) };
  const forged = { ...fm, signature: S.sign(fm, wrong) };
  const r = (x, n = now) => S.checkAuthenticity(x, lookup, n, limits).reason;
  let calls = 0;
  const spy = (a, b) => { calls += 1; return require("crypto").timingSafeEqual(a, b); };
  const spyOk = S.verify(forged, good, { timingSafeEqual: spy }) === false && calls === 1;
  console.log([
    r(signed), r(forged), r({ ...signed, created_by: "pixel-other" }),
    r(forged, now + 3600000), r({ ...signed, signature: signed.signature.slice(0, -2) }),
    r({ ...signed, signature: signed.signature.toUpperCase() }), r({ ...signed, signature: `${signed.signature}00` }), spyOk,
  ].map(String).join(" "))' "$W3_SECRET_ONE")"
s5_want="null signature_invalid device_unknown signature_invalid signature_invalid signature_invalid signature_invalid true"
if [[ "$s5" == "$s5_want" ]]; then ok "S5 good -> ok; wrong secret -> signature_invalid; unknown device -> device_unknown; forged+stale -> signature_invalid; short, long or uppercase sig refused; timingSafeEqual called once [FR-012]"
else bad "S5 good -> ok; wrong secret -> signature_invalid; unknown device -> device_unknown; forged+stale -> signature_invalid; short, long or uppercase sig refused; timingSafeEqual called once [FR-012]" "got:  $s5" "want: $s5_want"; fi

# ---------- S6: freshness on both sides ----------
s6="$(w3_node '
  const limits = { freshnessMs: 900000, skewMs: 120000 };
  const now = Date.parse("2026-09-24T12:00:00.000Z");
  const at = (ms) => ({ created_at: new Date(now + ms).toISOString() });
  const f = (ms) => { const x = S.checkFreshness(at(ms), now, limits); return x.ok ? "ok" : `${x.reason}/${x.detail}`; };
  console.log([f(-20 * 60000), f(3 * 60000), f(-14 * 60000), f(60000), f(-15 * 60000), f(-15 * 60000 - 1), f(2 * 60000), f(2 * 60000 + 1)].join(" "))')"
s6_want="stale/stale_past stale/stale_future ok ok ok stale/stale_past ok stale/stale_future"
if [[ "$s6" == "$s6_want" ]]; then ok "S6 -20 min stale_past, +3 min stale_future, -14/+1 min ok, bounds inclusive [FR-013]"
else bad "S6 -20 min stale_past, +3 min stale_future, -14/+1 min ok, bounds inclusive [FR-013]" "got:  $s6" "want: $s6_want"; fi

# ---------- S7: secrets never in the vault or any output (SC-003 sensor) ----------
new_sandbox s7
mk_project real-proj
rm -f "$FHOME/.a1-intents/devices.json" # provision both devices from scratch
w3_device add pixel-robert
s7_ok1=$W3_RC
w3_device add tablet-robert
s7_ok2=$W3_RC
s7_s1="$(w3_secret pixel-robert)"
s7_s2="$(w3_secret tablet-robert)"
for dev in pixel-robert tablet-robert pixel-robert; do
  f="$(mk_intent "created_by=$dev")"
  if [[ "$dev" == "pixel-robert" ]]; then sign_intent "$f" "$s7_s1"; else sign_intent "$f" "$s7_s2"; fi
  run_intent validate "$f"
  printf '%s\n%s\n' "$OUT" "$ERR" >>"$SB/outputs.log"
done
s7_hits="$(grep -rlF -e "$s7_s1" -e "$s7_s2" "$VAULT" "$SB/outputs.log" "$TRACE" 2>/dev/null | wc -l | tr -d ' ')"
if [[ $s7_ok1 -eq 0 && $s7_ok2 -eq 0 && ${#s7_s1} -eq 64 && ${#s7_s2} -eq 64 && "$s7_hits" == "0" ]]; then
  ok "S7 two devices + three signed intents: 0 files in the vault or in any CLI output carry a secret [FR-011]"
else bad "S7 two devices + three signed intents: 0 files in the vault or in any CLI output carry a secret [FR-011]" "add rc=$s7_ok1/$s7_ok2 hits=$s7_hits"; fi

# ---------- S8: a corrupt devices file fails closed and loud ----------
new_sandbox s8
s8_load() { w3_node 'try { D.loadDevices(); console.log("loaded"); } catch (e) { console.log(e.code); }'; }
printf '{"devices": {' >"$FHOME/.a1-intents/devices.json"
s8a="$(s8_load)"
printf '{"devices": {"pixel": {"secret_hex": "abc", "created_at": "2026-09-24T12:00:00.000Z", "revoked_at": null}}}' >"$FHOME/.a1-intents/devices.json"
s8b="$(s8_load)"
rm "$FHOME/.a1-intents/devices.json"
printf '{"devices": {}}' >"$SB/elsewhere.json"
ln -s "$SB/elsewhere.json" "$FHOME/.a1-intents/devices.json"
s8c="$(s8_load)"
rm "$FHOME/.a1-intents/devices.json"
s8d="$(w3_node 'console.log(Object.keys(D.loadDevices()).length)')"
if [[ "$s8a $s8b $s8c $s8d" == "A1_DEVICES_UNREADABLE A1_DEVICES_UNREADABLE A1_DEVICES_UNREADABLE 0" ]]; then
  ok "S8 unparsable, wrong-shape and symlinked devices.json throw A1_DEVICES_UNREADABLE; a missing file is empty [FR-011]"
else bad "S8 unparsable, wrong-shape and symlinked devices.json throw A1_DEVICES_UNREADABLE; a missing file is empty [FR-011]" "got: $s8a $s8b $s8c $s8d"; fi

# ---------- S9: device ids are slugs ----------
new_sandbox s9
s9_before="$(cat "$FHOME/.a1-intents/devices.json")"
w3_device add ../x
s9_rc=$W3_RC
w3_device add Pixel
if [[ $s9_rc -ne 0 && $W3_RC -eq 1 && "$(cat "$FHOME/.a1-intents/devices.json")" == "$s9_before" ]]; then ok "S9 device ids ../x and Pixel are refused, devices.json unchanged [FR-011]"
else bad "S9 device ids ../x and Pixel are refused, devices.json unchanged [FR-011]" "rc=$s9_rc/$W3_RC" "$(cat "$FHOME/.a1-intents/devices.json" 2>/dev/null)"; fi

# ---------- S10: the device subcommand is dispatched ----------
new_sandbox s10
s10_before="$(cat "$FHOME/.a1-intents/devices.json")"
run_intent device
s10a=$([[ $RC -eq 2 && -z "$OUT" && "$ERR" == "usage error: intent device add"* ]] && echo ok || echo "rc=$RC err=${ERR:0:120}")
run_intent device list pixel
s10b=$([[ $RC -eq 2 && -z "$OUT" && "$(cat "$FHOME/.a1-intents/devices.json")" == "$s10_before" ]] && echo ok || echo "rc=$RC")
if [[ "$s10a $s10b" == "ok ok" ]]; then ok "S10 intent device without a verb or with an unknown verb -> usage exit 2, devices.json unchanged [FR-011]"
else bad "S10 intent device without a verb or with an unknown verb -> usage exit 2, devices.json unchanged [FR-011]" "$s10a / $s10b"; fi

# ---------- S11: secrets are never written into the vault ----------
new_sandbox s11
mkdir -p "$VAULT/home-in-vault"
pty_run "$SB/.pty" env HOME="$VAULT/home-in-vault" A1_VAULT_ROOT="$VAULT" node "$A1_AS" "$VAULT/home-in-vault" - "$A1_TOOLS" intent device add pixel
s11_files="$(find "$VAULT" -name 'devices.json*' | wc -l | tr -d ' ')"
if [[ $PTY_RC -ne 0 && "$s11_files" == "0" ]] && grep -q 'device secrets never go into the vault' "$SB/.pty"; then
  ok "S11 device add with HOME inside \$A1_VAULT_ROOT is refused, no devices.json in the vault [FR-011]"
else bad "S11 device add with HOME inside \$A1_VAULT_ROOT is refused, no devices.json in the vault [FR-011]" "rc=$PTY_RC files=$s11_files" "$(tr -d '\r' <"$SB/.pty" | head -3)"; fi

# ---------- S12: validate enforces device -> signature -> freshness (wiring) ----------
# RED: removing the authenticate() call from validateIntentFile (S12b..S12h
# red), running it before the shape rules (S12i: a shape error then also
# reports device_unknown), reading the clock at module load instead of per
# call (none here; S6 covers the bounds), mapping a corrupt devices file to an
# empty map (S12j).
new_sandbox s12
mk_project real-proj
# (minutes via env: node would read a bare "-20" argument as an option)
s12_ago() { S12_MIN="$1" node -e 'process.stdout.write(new Date(Date.now() + Number(process.env.S12_MIN) * 60000).toISOString())'; }
run_intent validate "$(mk_intent)"
expect_verdict "S12a control: a fresh intent signed by the provisioned fixture device is valid [FR-012]" 0 ""
f="$(mk_intent)"; sign_intent "$f" "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
run_intent validate "$f"
expect_verdict "S12b signed with the wrong secret -> signature_invalid [FR-012]" 1 "signature_invalid"
run_intent validate "$(mk_intent @nosign)"
expect_verdict "S12c placeholder signature -> signature_invalid [FR-012]" 1 "signature_invalid"
run_intent validate "$(mk_intent created_by=tablet-other)"
expect_verdict "S12d unknown created_by -> device_unknown [FR-012]" 1 "device_unknown"
run_intent validate "$(mk_intent "created_at=$(s12_ago -20)")"
expect_verdict "S12e signed, created 20 min ago -> stale [FR-013]" 1 "stale"
run_intent validate "$(mk_intent "created_at=$(s12_ago 3)")"
expect_verdict "S12f signed, created 3 min in the future -> stale [FR-013]" 1 "stale"
run_intent validate "$(mk_intent "created_at=$(s12_ago -14)")"
expect_verdict "S12g signed, created 14 min ago -> valid [FR-013]" 0 ""
f="$(mk_intent "created_at=$(s12_ago -20)")"; sign_intent "$f" "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
run_intent validate "$f"
expect_verdict "S12h forged AND stale -> signature_invalid only [FR-012]" 1 "signature_invalid"
run_intent validate "$(mk_intent foo=1 @nosign)"
expect_verdict "S12i unsigned AND a shape error -> schema_invalid only (authenticity checked after the shape) [FR-012]" 1 "schema_invalid"
cp "$FHOME/.a1-intents/devices.json" "$SB/devices.bak"
printf '{"devices": {' >"$FHOME/.a1-intents/devices.json"
run_intent validate "$(mk_intent)"
if [[ $RC -ne 0 && $RC -ne 1 && -z "$OUT" && "$ERR" == *"devices.json is unreadable"* ]]; then ok "S12j corrupt devices.json -> validate fails closed and loud (no verdict, operator message) [FR-012]"
else bad "S12j corrupt devices.json -> validate fails closed and loud (no verdict, operator message) [FR-012]" "rc=$RC out=${OUT:0:120} err=${ERR:0:200}"; fi
cp "$SB/devices.bak" "$FHOME/.a1-intents/devices.json"
f="$(mk_intent)"
HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent device revoke pixel-robert >/dev/null 2>&1 </dev/null
run_intent validate "$f"
expect_verdict "S12k after device revoke pixel-robert its signed intent -> device_unknown [FR-012]" 1 "device_unknown"
s12_hits="$(grep -rlF -e "$FIXTURE_SECRET" -e "$FIXTURE_EXECUTOR_SECRET" "$VAULT" "$SB/.out" "$SB/.err" "$TRACE" 2>/dev/null | wc -l | tr -d ' ')"
[[ "$s12_hits" == "0" ]] && ok "S12l no fixture secret in the vault, stdout, stderr or trace after S12 [FR-011]" \
  || bad "S12l no fixture secret in the vault, stdout, stderr or trace after S12 [FR-011]" "hits=$s12_hits"

# ---------- S13: the result carries detail and payloadSha256, never a secret ----------
new_sandbox s13
mk_project real-proj
# Through the module, so the clock is pinned (deps.now) instead of re-dating.
s13_f="$(mk_intent created_at=2026-09-24T12:03:00.001Z)"
s13="$(HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node -e '
  const V = require(process.argv[1] + "/intent-validate.cjs");
  const r = V.validateIntentFile(process.argv[2], { now: () => Date.parse("2026-09-24T12:01:00.000Z") });
  console.log([r.reasons.join(","), r.detail, r.payloadSha256].join(" "));' "$INTENT_LIB" "$s13_f" 2>&1)"
s13_want="stale stale_future $(printf 'Push-Benachrichtigung bei neuem Auftrag\n' | openssl dgst -sha256 -r | cut -d' ' -f1)"
if [[ "$s13" == "$s13_want" ]]; then ok "S13 validateIntentFile result: detail stale_future and the payload sha256 for the log line [FR-013]"
else bad "S13 validateIntentFile result: detail stale_future and the payload sha256 for the log line [FR-013]" "got:  $s13" "want: $s13_want"; fi
