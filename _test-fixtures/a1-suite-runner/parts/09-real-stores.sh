# Part 09 (Wave 4, Task 4.1) — real owner stores stay untouched; A1_SUITE_REAL_VAULT. Sourced by run-tests.sh.
# FR-012: a listing with sha256 of <owner home>/.a1-xprov and of the runner's outer vault, taken before a
# run on planted suites, equals the one taken after (owner home from the passwd entry, never $HOME); an
# absent target prints one "skipped: <target> absent" PASS line and is no failure; the runner exports
# A1_SUITE_REAL_VAULT = its own start value of A1_VAULT_ROOT (unset when that was unset), seen by a probe.
# The fixture only READS the real ~/.a1-xprov; every write a suite attempts lands in a planted HOME.
#
# Red-making changes (one production-code change each, on a git archive snapshot):
#  V1: A1_SUITE_REAL_VAULT not exported · V2: exported empty when A1_VAULT_ROOT was unset (or a stale
#      inherited value survives) · V3: exported after the sentinel replaced it (value = the sentinel)
#  V4: worker keeps the runner's HOME (the planted write lands under the HOME the runner started with)
#  V5 (detector self-proof): a suite writing into the outer vault changes the digest

# rs_digest_of <dir> — "ABSENT", or "<count> <sha256 of the listing>"; listing = sha256 per file, path sorted.
rs_digest_of() {
  local t="$1" sum files n
  [[ -d "$t" ]] || { echo ABSENT; return 0; }
  if command -v sha256sum >/dev/null 2>&1; then sum="sha256sum"; else sum="shasum -a 256"; fi
  files="$(cd "$t" && find . -type f | LC_ALL=C sort)"
  n="$(printf '%s' "$files" | grep -c '')"
  {
    printf '%s\n' "$n"
    while IFS= read -r f; do
      [[ -n "$f" ]] || continue
      (cd "$t" && $sum "$f" 2>/dev/null) || echo "unreadable $f"
    done <<< "$files"
  } | $sum | cut -d' ' -f1 | { read -r h; echo "$n $h"; }
}
# rs_real_vault_digest — read-only digest of the outer env's REAL vault ($A1_SUITE_REAL_VAULT): "ABSENT" when
# the variable is unset/empty or the directory is missing, else "<entries> <sha256 of the sorted find listing>".
# Names only (no file reads): the real vault is large and this fixture must never touch its content.
rs_real_vault_digest() {
  local t="${A1_SUITE_REAL_VAULT:-${SR_OUTER_VAULT_ROOT:-}}" sum n
  [[ -n "$t" && -d "$t" ]] || { echo ABSENT; return 0; }
  if command -v sha256sum >/dev/null 2>&1; then sum="sha256sum"; else sum="shasum -a 256"; fi
  ( cd "$t" && find . 2>/dev/null | LC_ALL=C sort ) | { $sum | cut -d' ' -f1; } | { read -r h; n="$(cd "$t" && find . 2>/dev/null | grep -c '')"; echo "$n $h"; }
}
# rs_guard <label> <dir> <before> <after> — one PASS line: skipped when absent, equal listing otherwise.
rs_guard() {
  if [[ "$3" == ABSENT && "$4" == ABSENT ]]; then ok "$1 skipped: $2 absent"
  else assert_eq "$1 listing unchanged ($2)" "$4" "$3"; fi
}

RS_OWNER_HOME="$(node -e 'process.stdout.write(require("os").userInfo().homedir)')"
assert_eq "the owner home is a non-empty absolute path" "$([[ "$RS_OWNER_HOME" == /?* ]] && echo yes || echo no)" "yes"
RS_XPROV_DIR="$RS_OWNER_HOME/.a1-xprov"

mk_tree T_VR vr
mk_workdir W_VR vrw
mk_workdir W_VRH vrh          # the HOME the runner is started with
mk_workdir VR_VAULT vault     # the outer vault of the runner (planted stand-in for the real one)
mkdir -p "$VR_VAULT/project" && echo note > "$VR_VAULT/project/a.md" && echo two > "$VR_VAULT/b.md"
VR_PROBE_BODY="{
  echo \"real=\${A1_SUITE_REAL_VAULT-UNSET}\"; echo \"vault=\${A1_VAULT_ROOT-UNSET}\"; echo \"home=\$HOME\"
} > \"__F__\"
mkdir -p \"\$HOME/.a1-xprov\" && echo x > \"\$HOME/.a1-xprov/planted\"
echo 'p: 1 passed, 0 failed'"
# Only the runner's own identity gets A1_SUITE_REAL_VAULT (SEC-2); every other suite must not see it.
plant_suite "$T_VR" a1-suite-runner/run-tests.sh "${VR_PROBE_BODY//__F__/$W_VR/probe}"
plant_suite "$T_VR" p/run-tests.sh "${VR_PROBE_BODY//__F__/$W_VR/probe-p}"

VR_R_BEFORE="$(rs_real_vault_digest)"
VR_X_BEFORE="$(rs_digest_of "$RS_XPROV_DIR")"
VR_V_BEFORE="$(rs_digest_of "$VR_VAULT")"
assert_eq "the planted vault listing has 2 files" "${VR_V_BEFORE%% *}" "2"
RS_ENV_EXTRA="A1_VAULT_ROOT=$VR_VAULT HOME=$W_VRH" rs_run "$T_VR"
assert_eq "V1a run on planted suites exits 0" "$RS_RC" "0"
assert_eq "V1b the probe saw the runner's start value of A1_VAULT_ROOT" \
  "$(grep '^real=' "$W_VR/probe" 2>/dev/null)" "real=$VR_VAULT"
assert_eq "V1c another suite does not see A1_SUITE_REAL_VAULT (SEC-2)" \
  "$(grep '^real=' "$W_VR/probe-p" 2>/dev/null)" "real=UNSET"
assert_eq "V3a the worker's A1_VAULT_ROOT is a sentinel, not the outer vault" \
  "$([[ "$(grep '^vault=' "$W_VR/probe" | cut -d= -f2-)" != "$VR_VAULT" ]] && echo sentinel || echo outer)" "sentinel"
assert_eq "V4a the worker's HOME is not the runner's HOME" \
  "$([[ "$(grep '^home=' "$W_VR/probe" | cut -d= -f2-)" != "$W_VRH" ]] && echo isolated || echo shared)" "isolated"
assert_eq "V4b the planted write did not land under the runner's HOME" \
  "$(find "$W_VRH" -mindepth 1 | grep -c '')" "0"
rs_guard "FR-012 owner xprov store" "$RS_XPROV_DIR" "$VR_X_BEFORE" "$(rs_digest_of "$RS_XPROV_DIR")"
rs_guard "FR-012 outer vault" "$VR_VAULT" "$VR_V_BEFORE" "$(rs_digest_of "$VR_VAULT")"
rs_guard "FR-012 real vault (A1_SUITE_REAL_VAULT)" "${A1_SUITE_REAL_VAULT:-<unset>}" "$VR_R_BEFORE" "$(rs_real_vault_digest)"

# A1_VAULT_ROOT unset at start: unset in the worker's view, a stale inherited value does not survive
rm -f "$W_VR/probe"
RS_ENV_EXTRA="HOME=$W_VRH A1_SUITE_REAL_VAULT=stale" rs_run "$T_VR"
assert_eq "V2a start value unset: probe sees it unset" "$(grep '^real=' "$W_VR/probe" 2>/dev/null)" "real=UNSET"

# an absent target is a skipped line, not a failure
VR_ABSENT="$W_VR/does-not-exist"
rs_guard "FR-012 absent store" "$VR_ABSENT" "$(rs_digest_of "$VR_ABSENT")" "$(rs_digest_of "$VR_ABSENT")"

# V5: the detector sees a write into the outer vault
plant_suite "$T_VR" p/run-tests.sh "echo leak > \"$VR_VAULT/leak.md\"; echo 'p: 1 passed, 0 failed'"
RS_ENV_EXTRA="A1_VAULT_ROOT=$VR_VAULT HOME=$W_VRH" rs_run "$T_VR"
assert_eq "V5a a suite writing into the outer vault changes the digest" \
  "$([[ "$(rs_digest_of "$VR_VAULT")" != "$VR_V_BEFORE" ]] && echo changed || echo same)" "changed"

# the real-vault listing is unchanged after all planted runs (including the V5 writer, which only hits VR_VAULT)
rs_guard "FR-012 real vault after all runs (A1_SUITE_REAL_VAULT)" "${A1_SUITE_REAL_VAULT:-<unset>}" "$VR_R_BEFORE" "$(rs_real_vault_digest)"
# V6 (detector self-proof): a changed listing of a stand-in "real vault" is seen by the same digest function
VR_SELF="$(A1_SUITE_REAL_VAULT="$VR_VAULT" rs_real_vault_digest)"; echo z > "$VR_VAULT/new.md"
assert_eq "V6 the real-vault digest sees a new file" \
  "$([[ "$(A1_SUITE_REAL_VAULT="$VR_VAULT" rs_real_vault_digest)" != "$VR_SELF" ]] && echo changed || echo same)" "changed"

# V7 (SEC-7d): started without A1_SUITE_REAL_VAULT, the guard falls back to the outer A1_VAULT_ROOT that
# run-tests.sh captured before it cleared it, instead of silently skipping.
VR_FB="$(A1_SUITE_REAL_VAULT='' SR_OUTER_VAULT_ROOT="$VR_VAULT" rs_real_vault_digest)"
assert_eq "V7 without A1_SUITE_REAL_VAULT the outer A1_VAULT_ROOT is guarded" \
  "$([[ "$VR_FB" != ABSENT ]] && echo guarded || echo skipped)" "guarded"
