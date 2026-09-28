#!/usr/bin/env bash
# cases/03b-hardening.sh — spec 011, fixes from the security review of waves
# 1–3 (samuel-011-w3): MAJOR-1, MINOR-1 to MINOR-5. Sourced by run-tests.sh.
#
# RED proof (CONVENTIONS.md): the single production change that turns each
# case red, each measured on a cp -R copy of the tree before commit.
#   H1a/H1b file mode check dropped from the devices.json fstat check.
#   H1c/H1d directory mode check dropped from the ~/.a1-intents check.
#   H1e uid check dropped from the file check; H1f from the directory check.
#   H1g O_NOFOLLOW dropped from the devices.json open (the link target is a
#       0600 file of the user, so only the flag refuses it).
#   H1h O_NOFOLLOW dropped from the directory open.
#   H1i (control) a check that refuses 0600/0700 too (e.g. mask 0o777).
#   H1j reading devices.json by path again instead of from the fd.
#   H1k loadDevices returning a map instead of throwing (CLI then says VALID).
#   H2a O_NOFOLLOW dropped from the intent open.
#   H2b O_NONBLOCK dropped from the intent open (the call hangs on the FIFO).
#   H2c the fstat isFile() check dropped (the read of a directory throws).
#   H2d a second open or a stat by path around the fd read.
#   H2e (control) the fd reader returning nothing (valid file then refused).
#   H3a/H3c project realpath lookup moved back before authentication.
#   H3b queue-control target lookup / executor-device rule moved back before
#       authentication.
#   H3d/H3e environment checks dropped after authentication.
#   H3f the slug syntax check moved after authentication.
#   H3g any realpath or lstat call for an unauthenticated intent.
#   H4a the secret written to stdout (e.g. secret_hex back in the JSON).
#   H4b the provisioning payload written to stdout.
#   H4c devices.json written before /dev/tty is opened.
#   H5a the CRLF -> LF normalization in the parser dropped (M9).
#   H5b normalizing a lone CR as well (the CR-joined line then splits into
#       two valid key lines and the signed intent passes).
#   H6a–c a security limit missing from the tighten-only set (its loosening
#       override is then taken), or the `n > default` test turned into `>=`
#       (H6e red: an override equal to the default warns).
#   H6d the tighten-only rule also refusing a lower value.
#   H6f/H6g TICK_INTERVAL_S in the tighten-only set (H6g red).
#   H6h KILL_GRACE_MS or CANCEL_POLL_MS missing from the tighten-only set.

HB_LIB_JS='const fs = require("fs"); const lib = process.argv[1];
  const D = require(lib + "/intent-devices.cjs"); const V = require(lib + "/intent-validate.cjs");
  const argv = process.argv.slice(2);'

# hb_node <js> [args...] — JS with fs, D (devices), V (validate) and argv, run
# with the sandbox HOME and vault.
hb_node() {
  local js="$1"
  shift
  HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node -e "$HB_LIB_JS $js" "$INTENT_LIB" "$@" 2>&1
}

hb_check() { # <name> <want> <got>
  if [[ "$3" == "$2" ]]; then ok "$1"; else bad "$1" "want: $2" "got:  $3"; fi
}

# hb_load [fstat-js] — loadDevices() -> "loaded <n>" or the error code.
hb_load() {
  hb_node "
    const fstat = ${1:-null};
    try { const d = D.loadDevices(fstat ? { fstat } : {}); console.log('loaded ' + Object.keys(d).length); }
    catch (e) { console.log(e.code || e.message); }"
}

# A fstat that reports another owner for the file (isFile) or the directory.
HB_FOREIGN_FILE='(fd) => { const s = fs.fstatSync(fd); return s.isFile() ? Object.assign(Object.create(Object.getPrototypeOf(s)), s, { uid: s.uid + 1 }) : s; }'
HB_FOREIGN_DIR='(fd) => { const s = fs.fstatSync(fd); return s.isDirectory() ? Object.assign(Object.create(Object.getPrototypeOf(s)), s, { uid: s.uid + 1 }) : s; }'

# ---------- H1: devices.json and ~/.a1-intents: mode, owner, links (MAJOR-1) ----------
new_sandbox h1
H1_DIR="$FHOME/.a1-intents"
H1_FILE="$H1_DIR/devices.json"
chmod 644 "$H1_FILE"
hb_check "H1a devices.json mode 0644 -> A1_DEVICES_UNREADABLE [FR-011]" "A1_DEVICES_UNREADABLE" "$(hb_load)"
chmod 660 "$H1_FILE"
hb_check "H1b devices.json mode 0660 -> A1_DEVICES_UNREADABLE [FR-011]" "A1_DEVICES_UNREADABLE" "$(hb_load)"
chmod 600 "$H1_FILE"
chmod 755 "$H1_DIR"
hb_check "H1c ~/.a1-intents mode 0755 -> A1_DEVICES_UNREADABLE [FR-011]" "A1_DEVICES_UNREADABLE" "$(hb_load)"
chmod 777 "$H1_DIR"
hb_check "H1d ~/.a1-intents mode 0777 -> A1_DEVICES_UNREADABLE [FR-011]" "A1_DEVICES_UNREADABLE" "$(hb_load)"
chmod 700 "$H1_DIR"
hb_check "H1e devices.json owned by another uid (injected fstat) -> A1_DEVICES_UNREADABLE [FR-011]" "A1_DEVICES_UNREADABLE" "$(hb_load "$HB_FOREIGN_FILE")"
hb_check "H1f ~/.a1-intents owned by another uid (injected fstat) -> A1_DEVICES_UNREADABLE [FR-011]" "A1_DEVICES_UNREADABLE" "$(hb_load "$HB_FOREIGN_DIR")"
cp -p "$H1_FILE" "$SB/devices-elsewhere.json"
mv "$H1_FILE" "$SB/devices.bak"
ln -s "$SB/devices-elsewhere.json" "$H1_FILE"
hb_check "H1g devices.json a symlink to a 0600 file of the user -> A1_DEVICES_UNREADABLE [FR-011]" "A1_DEVICES_UNREADABLE" "$(hb_load)"
rm "$H1_FILE"
mv "$SB/devices.bak" "$H1_FILE"
mv "$H1_DIR" "$SB/real-a1-intents"
ln -s "$SB/real-a1-intents" "$H1_DIR"
hb_check "H1h ~/.a1-intents a symlink to a 0700 directory of the user -> A1_DEVICES_UNREADABLE [FR-011]" "A1_DEVICES_UNREADABLE" "$(hb_load)"
rm "$H1_DIR"
mv "$SB/real-a1-intents" "$H1_DIR"
hb_check "H1i control: 0600 file in a 0700 directory of the user loads both fixture devices [FR-011]" "loaded 2" "$(hb_load)"
h1j="$(hb_node '
  const file = require("path").join(process.env.HOME, ".a1-intents", "devices.json");
  let byPath = 0; const orig = fs.readFileSync;
  fs.readFileSync = (p, ...r) => { if (String(p) === file) byPath += 1; return orig(p, ...r); };
  const n = Object.keys(D.loadDevices()).length;
  console.log(`${n} byPath=${byPath}`);')"
hb_check "H1j devices.json is read from the checked descriptor, never again by path (no TOCTOU) [FR-011]" "2 byPath=0" "$h1j"
mk_project real-proj
h1k_f="$(mk_intent)"
chmod 666 "$H1_FILE"
run_intent validate "$h1k_f"
if [[ $RC -eq 2 && -z "$OUT" && "$ERR" == *"devices.json is unreadable"* ]]; then
  ok "H1k signed intent with devices.json at 0666 -> validate fails closed (exit 2, no verdict) [FR-012]"
else bad "H1k signed intent with devices.json at 0666 -> validate fails closed (exit 2, no verdict) [FR-012]" "rc=$RC out=${OUT:0:120}" "err=${ERR:0:200}"; fi
chmod 600 "$H1_FILE"

# ---------- H2: validateIntentFile reads through one fd (MINOR-1) ----------
new_sandbox h2
mk_project real-proj
# hb_validate <file> — library call in a child with a 5 s timeout, so a
# blocking open is a red result instead of a hung suite.
hb_validate() {
  HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node -e '
    const cp = require("child_process");
    const js = "const V = require(process.argv[1] + \"/intent-validate.cjs\");"
      + "const r = V.validateIntentFile(process.argv[2]);"
      + "console.log(`${r.valid} ${r.reasons.join(\",\")} ${r.detail}`);";
    const r = cp.spawnSync(process.execPath, ["-e", js, process.argv[1], process.argv[2]], { encoding: "utf8", timeout: 5000 });
    if (r.error && r.error.code === "ETIMEDOUT") console.log("HUNG");
    else if (r.status !== 0) console.log(`THREW ${(r.stderr || "").split("\n").find((l) => /Error/.test(l)) || r.status}`);
    else process.stdout.write(r.stdout);' "$INTENT_LIB" "$1" 2>&1
}
h2_outside="$SB/outside.md"
h2_f="$(mk_intent)"
h2_name="$(basename "$h2_f")"
mv "$h2_f" "$h2_outside"
ln -s "$h2_outside" "$Q/$h2_name"
hb_check "H2a library: a symlink in queued/ to a valid signed intent outside -> schema_invalid, not_regular_file [FR-016]" \
  "false schema_invalid not_regular_file" "$(hb_validate "$Q/$h2_name")"
rm "$Q/$h2_name"
h2_fifo="$Q/bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb.md"
mkfifo "$h2_fifo"
hb_check "H2b library: a FIFO named <id>.md in queued/ -> schema_invalid within 5 s, no hang [FR-016]" \
  "false schema_invalid not_regular_file" "$(hb_validate "$h2_fifo")"
rm -f "$h2_fifo"
h2_dir="$Q/cccccccc-3333-4ccc-8ccc-cccccccccccc.md"
mkdir "$h2_dir"
hb_check "H2c library: a directory named <id>.md in queued/ -> schema_invalid, no exception [FR-016]" \
  "false schema_invalid not_regular_file" "$(hb_validate "$h2_dir")"
rmdir "$h2_dir"
h2_ok="$(mk_intent)"
h2d="$(hb_node '
  const file = argv[0]; const c = { open: 0, stat: 0, full: 0 };
  const o = { open: fs.openSync, stat: fs.statSync, lstat: fs.lstatSync, full: fs.readFileSync };
  fs.openSync = (p, ...r) => { if (String(p) === file) c.open += 1; return o.open(p, ...r); };
  fs.statSync = (p, ...r) => { if (String(p) === file) c.stat += 1; return o.stat(p, ...r); };
  fs.lstatSync = (p, ...r) => { if (String(p) === file) c.stat += 1; return o.lstat(p, ...r); };
  fs.readFileSync = (p, ...r) => { if (String(p) === file) c.full += 1; return o.full(p, ...r); };
  const r = V.validateIntentFile(file);
  console.log(`${r.valid} open=${c.open} stat=${c.stat} readByPath=${c.full}`);' "$h2_ok")"
hb_check "H2d library: one open of the intent path, no stat and no read by path (fstat + fd read only) [FR-016]" \
  "true open=1 stat=0 readByPath=0" "$h2d"
hb_check "H2e library control: a regular signed intent file is valid [FR-016]" "true  null" "$(hb_validate "$h2_ok")"

# ---------- H3: environment lookups only after authentication (MINOR-2) ----------
new_sandbox h3
mk_project real-proj
H3_MISSING_ID="dddddddd-4444-4ddd-8ddd-dddddddddddd"
run_intent validate "$(mk_intent project=nope @nosign)"
expect_verdict "H3a unsigned intent for a project that does not exist -> signature_invalid only (no project oracle) [FR-012]" 1 "signature_invalid"
H3_TSHA="9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" # spec round 6: an approve carries target_sha256
run_intent validate "$(mk_intent action=approve "target_sha256=\"$H3_TSHA\"" "target=$H3_MISSING_ID" @nosign)"
expect_verdict "H3b unsigned approve of an id that does not exist -> signature_invalid only (no id oracle) [FR-012]" 1 "signature_invalid"
run_intent validate "$(mk_intent created_by=tablet-other project=nope)"
expect_verdict "H3c unknown device and a project that does not exist -> device_unknown only [FR-012]" 1 "device_unknown"
run_intent validate "$(mk_intent project=nope)"
expect_verdict "H3d signed intent for a project that does not exist -> project_invalid (checked after authentication) [FR-004]" 1 "project_invalid"
h3e_f="$(mk_intent action=approve "target_sha256=\"$H3_TSHA\"" "target=$H3_MISSING_ID")"
h3e="$(hb_node 'const r = V.validateIntentFile(argv[0], { executorDevice: "mac-robert" }); console.log(r.reasons.join(","));' "$h3e_f")"
hb_check "H3e signed approve from a phone of an id that does not exist -> target_not_found,approve_from_non_executor_device [FR-006]" \
  "target_not_found,approve_from_non_executor_device" "$h3e"
run_intent validate "$(mk_intent project=../x @nosign)"
expect_verdict "H3f unsigned intent with a malformed slug -> project_invalid (syntax stays a shape rule) [FR-004]" 1 "project_invalid"
h3g_f="$(mk_intent project=nope action=approve "target_sha256=\"$H3_TSHA\"" "target=$H3_MISSING_ID" @nosign)"
h3g="$(hb_node '
  let rp = 0; let ls = 0;
  const r = V.validateIntentFile(argv[0], {
    realpath: (p) => { rp += 1; return fs.realpathSync(p); },
    lstat: (p) => { ls += 1; return fs.lstatSync(p); } });
  console.log(`${r.reasons.join(",")} realpath=${rp} lstat=${ls}`);' "$h3g_f")"
hb_check "H3g unauthenticated intent: 0 realpath and 0 lstat calls (no filesystem lookup before authentication) [FR-012]" \
  "signature_invalid realpath=0 lstat=0" "$h3g"

# ---------- H4: device add writes the secret to /dev/tty only (MINOR-4) ----------
new_sandbox h4
rm -f "$FHOME/.a1-intents/devices.json"
# hb_add <tty-file|FAIL> <args...> — cmdIntentDevice with stdout faked as a
# TTY and captured; the tty writer is injected (a file, or an open error).
hb_add() {
  local tty="$1"
  shift
  hb_node '
    const [tty, ...args] = argv; let out = "";
    const openTty = tty === "FAIL" ? () => { const e = new Error("no tty"); e.code = "ENXIO"; throw e; } : () => fs.openSync(tty, "w");
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.isTTY = true;
    process.stdout.write = (s) => { out += s; return true; };
    try { D.cmdIntentDevice(args, { openTty }); } finally { process.stdout.write = write; }
    const file = require("path").join(process.env.HOME, ".a1-intents", "devices.json");
    const secret = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")).devices[args[1]] || {}).secret_hex : "";
    const ttyText = tty === "FAIL" ? "" : fs.readFileSync(tty, "utf8");
    const count = (s) => (secret ? s.split(secret).length - 1 : -1);
    console.log(`rc=${process.exitCode} stdout=${count(out)} tty=${count(ttyText)} qr=${ttyText.includes("a1-intent://provision?device=")}`);' "$tty" "$@" \
    | grep '^rc=' # the stderr hint is not part of the result
}
hb_check "H4a device add: the secret is on /dev/tty exactly once and never on stdout [FR-011]" \
  "rc=0 stdout=0 tty=1 qr=false" "$(hb_add "$SB/tty1" add pixel)"
hb_check "H4b device add --qr: the provisioning payload is on /dev/tty, never on stdout [FR-011]" \
  "rc=0 stdout=0 tty=1 qr=true" "$(hb_add "$SB/tty2" add tablet --qr)"
h4c="$(hb_add FAIL add laptop)"
if [[ "$h4c" == "rc=1 stdout=-1 tty=-1 qr=false" ]]; then ok "H4c device add without a usable /dev/tty -> exit 1, device not stored [FR-011]"
else bad "H4c device add without a usable /dev/tty -> exit 1, device not stored [FR-011]" "got: $h4c"; fi

# ---------- H5: CRLF behaviour is pinned (MINOR-5, surviving mutation M9) ----------
new_sandbox h5
mk_project real-proj
h5_f="$(mk_intent)"
node -e 'const fs = require("fs"); const f = process.argv[1]; fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/\n/g, "\r\n"))' "$h5_f"
run_intent validate "$h5_f"
expect_verdict "H5a an intent saved with CRLF line endings validates like its LF twin (signature over LF values) [FR-010]" 0 ""
h5b_f="$(mk_intent)"
node -e 'const fs = require("fs"); const f = process.argv[1]; fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("\nstatus: queued\n", "\rstatus: queued\n"))' "$h5b_f"
run_intent validate "$h5b_f"
expect_verdict "H5b a lone CR is not a line break: a signed intent whose status line follows a CR -> schema_invalid [FR-001]" 1 "schema_invalid"

# ---------- H6: A1_INTENT_* overrides only tighten security limits (MINOR-3) ----------
# The defaults are typed here as literals (testing.md class 4: never imported
# from intent-constants.cjs).
# hb_limit <NAME> <env-assignment...> — prints "<value>|<stderr warning lines>".
hb_limit() {
  local name="$1"
  shift
  env "$@" node -e 'const C = require(process.argv[1] + "/intent-constants.cjs"); process.stdout.write(String(C[process.argv[2]]))' \
    "$INTENT_LIB" "$name" 2>"$WORK/.h6-err"
  printf '|%s' "$(grep -c '^warning: ' "$WORK/.h6-err")"
}
h6_bad=""
for pair in INTENT_FRESHNESS_MS:900000 INTENT_CLOCK_SKEW_MS:120000 INTENT_MAX_BYTES:8192 INTENT_PAYLOAD_MAX_BYTES:6144 \
  INTENT_MAX_RUNS_PER_HOUR:6 INTENT_TIMEOUT_MS:1800000 INTENT_CLAIMED_MAX_AGE_MS:21600000 INTENT_RESULT_MAX_BYTES:16384; do
  n="${pair%%:*}"
  dflt="${pair##*:}"
  got="$(hb_limit "$n" "A1_$n=$((dflt + 1))")"
  [[ "$got" == "$dflt|1" ]] || h6_bad="$h6_bad $n:$got"
done
if [[ -z "$h6_bad" ]]; then ok "H6a each of the 8 security limits set to default+1 -> default kept, one stderr warning [FR-016]"
else bad "H6a each of the 8 security limits set to default+1 -> default kept, one stderr warning [FR-016]" "$h6_bad"; fi
hb_check "H6b A1_INTENT_FRESHNESS_MS=999999999999 (the review probe) -> 900000, one warning [FR-013]" \
  "900000|1" "$(hb_limit INTENT_FRESHNESS_MS A1_INTENT_FRESHNESS_MS=999999999999)"
hb_check "H6c A1_INTENT_MAX_BYTES=99999999 (the review probe) -> 8192, one warning [FR-005]" \
  "8192|1" "$(hb_limit INTENT_MAX_BYTES A1_INTENT_MAX_BYTES=99999999)"
hb_check "H6d tightening A1_INTENT_FRESHNESS_MS=1000 -> 1000, no warning [FR-013]" \
  "1000|0" "$(hb_limit INTENT_FRESHNESS_MS A1_INTENT_FRESHNESS_MS=1000)"
hb_check "H6e override equal to the default A1_INTENT_MAX_BYTES=8192 -> 8192, no warning [FR-005]" \
  "8192|0" "$(hb_limit INTENT_MAX_BYTES A1_INTENT_MAX_BYTES=8192)"
h6f="$(hb_limit INTENT_TICK_INTERVAL_S A1_INTENT_TICK_INTERVAL_S=1) $(hb_limit INTENT_CANCEL_POLL_MS A1_INTENT_CANCEL_POLL_MS=10) $(hb_limit INTENT_KILL_GRACE_MS A1_INTENT_KILL_GRACE_MS=10)"
hb_check "H6f timing knobs TICK_INTERVAL_S=1, CANCEL_POLL_MS=10, KILL_GRACE_MS=10 are taken, no warning [FR-016]" \
  "1|0 10|0 10|0" "$h6f"
hb_check "H6g A1_INTENT_TICK_INTERVAL_S=3600 is taken: how often the queue is looked at widens nothing [FR-016]" \
  "3600|0" "$(hb_limit INTENT_TICK_INTERVAL_S A1_INTENT_TICK_INTERVAL_S=3600)"
h6h="$(hb_limit INTENT_KILL_GRACE_MS A1_INTENT_KILL_GRACE_MS=10001) $(hb_limit INTENT_CANCEL_POLL_MS A1_INTENT_CANCEL_POLL_MS=5001)"
hb_check "H6h KILL_GRACE_MS and CANCEL_POLL_MS above the default -> default kept, one warning each (they bound how long a child outlives a cancel) [FR-027]" \
  "10000|1 5000|1" "$h6h"
