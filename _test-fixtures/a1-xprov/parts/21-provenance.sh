#!/usr/bin/env bash
# Part 21 — spec 014 Wave 8: the runner pinned in a second, independent place
# and absolute tool paths (FR-015, FR-016). Sourced by run-tests.sh.
#
# Expectations are literals (the audited sha from run-tests.sh, paths computed
# with `pwd -P` / `cd`, never taken from the module under test). Arm -> the
# single production change that turns it red:
#
#   PV1  `node -p` on RUNNER_SHA256 = the audited sha.   Red if the constant is absent.
#   PV2  tree copy: runner.py changed + SHA256SUMS rewritten, constant untouched ->
#        preflight exit 1 `runner_pin: FAIL (constant_mismatch)`; the copied
#        check-enforcement.sh exits non-zero.            Red if checkRunnerPin / the CI compare lack the constant.
#   PV3  tree copy: only the constant changed -> check-enforcement.sh exits non-zero;
#        the untouched copy exits 0 (control).           Red if the CI compare is missing.
#   PV4  fake python3 (a symlink) first on PATH -> `python_version` measured holds
#        the realpath of the target.                     Red if preflight spawns the bare name.
#   PV5  `run` stdout argv[0] absolute, argv holds `--cli <abs codex>`; the runner
#        received the same.                              Red if buildArgv keeps the literal `python3`.
#   PV6  no `codex` on PATH -> preflight exit 1 with `codex_cli: FAIL`; `run` refuses
#        with preflight_failed and spawns nothing.       Red (run arm) if run does not resolve codex.

TMP21="$(mktemp -d)"
SAVED_HOME_21="$HOME"
PV_AUDITED_SHA="962dfdfe5d67b75eb73ec7c38b9186e6e6e0ca96a68d4ec82595305d8f737c8c"
PV_N=0

# pv_arm — fresh HOME with an auth file, fresh tree and Codex home.
pv_arm() {
  export HOME="$(mktemp -d "$TMP21/home.XXXXXX")"; mkdir -p "$HOME/.codex"
  printf '{"fixture":true}\n' > "$HOME/.codex/auth.json"; chmod 600 "$HOME/.codex/auth.json"
  make_tree; make_fake_global_home; make_home
  ln -s "$FAKE_HOME/.codex/auth.json" "$XHOME/auth.json"
}

# pv_copy_enforcement <tree> — puts check-enforcement.sh into <tree>/_test-fixtures/a1-xprov so its SELF_ROOT is <tree>.
pv_copy_enforcement() {
  mkdir -p "$1/_test-fixtures/a1-xprov"; cp "$SUITE/check-enforcement.sh" "$1/_test-fixtures/a1-xprov/check-enforcement.sh"
}

# pv_path_without <tool> — prints a PATH without any dir holding <tool> (shadow dirs of symlinks), or nothing.
pv_path_without() {
  local tool="$1" out="" d f name shadow np
  local IFS=':'
  for d in $PATH; do
    [[ -z "$d" ]] && continue
    if [[ -e "$d/$tool" ]]; then
      shadow="$(mktemp -d "$TMP21/shadow.XXXXXX")"
      for f in "$d"/* "$d"/.[!.]*; do
        [[ -e "$f" || -L "$f" ]] || continue
        name="$(basename "$f")"
        [[ "$name" == "$tool" ]] && continue
        ln -s "$f" "$shadow/$name"
      done
      d="$shadow"
    fi
    out="${out:+$out:}$d"
  done
  np="$out"
  if ( hash -r; PATH="$np"; ! command -v "$tool" >/dev/null 2>&1 ); then printf '%s' "$np"; fi
}

# pv_snap_run <path-or-empty> — snapshot (normal PATH) + `xprov run --mode review` under <path>. Sets PV_OUT, PV_RC, PV_ARGV.
pv_snap_run() {
  PV_N=$((PV_N + 1)); PV_ARGV="$TMP21/argv-$PV_N.json"
  make_phase p21; write_permit "$PHASE_REPO" fixture record/2026-10-09-fixture.md
  export A1_XPROV_CODEX_HOME="$XHOME"
  local sout snap
  sout="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov snapshot --repo "$PHASE_REPO" --commit HEAD --plan "$PHASE_PLAN" 2>"$TMP21/snap-err.txt")"
  snap="$(json_get "$sout" "j.snapshot || ''")"
  FAKE_RUNNER_ARGV_FILE="$PV_ARGV" FAKE_RUNNER_CASE=approved fake_runner_env
  PV_OUT="$( [[ -n "$1" ]] && export PATH="$1"; cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov run --mode review --snapshot "$snap" --plan "$snap.inputs/PLAN.md" --phase p21 --gate "$GATE_PLAN" --timeout 7 2>"$TMP21/run-err.txt")"; PV_RC=$?
}

# ---------- PV1: the constant exists and holds the audited sha ----------
{
  got="$(node -p "require(process.argv[1]).RUNNER_SHA256" "$XPROV_LIB" 2>&1)"
  assert_eq "PV1 RUNNER_SHA256 prints the audited runner sha" "$got" "$PV_AUDITED_SHA"
}

# ---------- PV2: runner + SHA256SUMS changed together, constant not ----------
{
  pv_arm
  printf '\n# tampered\n' >> "$TREE_VENDOR/runner.py"
  ( cd "$TREE_VENDOR" && printf '%s  runner.py\n' "$(sha256_of runner.py)" > SHA256SUMS )
  sums_check "$TREE_VENDOR" && ok "PV2 precondition: the copy's SUMS match its changed runner" || bad "PV2 precondition: SUMS do not match"
  xprov_w4 preflight
  assert_rc "PV2 preflight exits 1" 1 "$W4_RC" "$W4_ERR"
  assert_eq "PV2 runner_pin FAILs with constant_mismatch" "$(check_result "$W4_OUT" runner_pin)" "FAIL|constant_mismatch"
  pv_copy_enforcement "$TREE"
  bash "$TREE/_test-fixtures/a1-xprov/check-enforcement.sh" "$REPO_ROOT" >/dev/null 2>"$TMP21/ce.err"; rc=$?
  [[ $rc -ne 0 ]] && ok "PV2 check-enforcement.sh exits non-zero on the tampered copy (exit $rc)" || bad "PV2 check-enforcement.sh exits 0 on a runner changed with its SUMS"
}

# ---------- PV3: only the constant differs ----------
{
  pv_arm
  pv_copy_enforcement "$TREE"
  bash "$TREE/_test-fixtures/a1-xprov/check-enforcement.sh" "$REPO_ROOT" >/dev/null 2>"$TMP21/ce.err"; rc=$?
  assert_rc "PV3 control: an untouched copy (real runner, matching constant) exits 0" 0 "$rc" "$(cat "$TMP21/ce.err")"
  cp "$REPO_ROOT/_shared/vendor/claudex-loop/runner.py" "$TREE_VENDOR/runner.py"
  ( cd "$TREE_VENDOR" && printf '%s  runner.py\n' "$(sha256_of runner.py)" > SHA256SUMS )
  sed -i.bak -E "s/^(const RUNNER_SHA256 = ')[0-9a-f]{64}(';)/\1$(head -c 64 /dev/zero | tr '\0' 'a')\2/" "$TREE/_shared/lib/xprov.cjs"
  bash "$TREE/_test-fixtures/a1-xprov/check-enforcement.sh" "$REPO_ROOT" >/dev/null 2>"$TMP21/ce.err"; rc=$?
  [[ $rc -ne 0 ]] && ok "PV3 check-enforcement.sh exits non-zero when only the constant differs (exit $rc)" || bad "PV3 check-enforcement.sh exits 0 with a different constant"
}

# ---------- PV4: preflight prints the realpath of the python3 it ran ----------
{
  pv_arm
  mkdir -p "$TMP21/pyreal" "$TMP21/pybin"
  printf '#!/bin/sh\necho "Python 3.99.1"\n' > "$TMP21/pyreal/py-real"; chmod +x "$TMP21/pyreal/py-real"
  ln -s "$TMP21/pyreal/py-real" "$TMP21/pybin/python3"
  want="$(cd "$TMP21/pyreal" && pwd -P)/py-real"
  PATH="$TMP21/pybin:$PATH" xprov_w4 preflight
  res="$(check_result "$W4_OUT" python_version)"
  [[ "$res" == PASS\|*"$want"* ]] && ok "PV4 python_version measured holds the target's absolute realpath" || bad "PV4 python_version measured lacks $want (got $res)"
}

# ---------- PV5: run hands the runner absolute python3 and --cli <codex> ----------
{
  pv_arm
  pv_snap_run ""
  assert_rc "PV5 run exits 0" 0 "$PV_RC" "$(cat "$TMP21/run-err.txt")"
  want_cli="$(cd "$FAKE_BIN" && pwd -P)/codex"
  assert_json "PV5 stdout argv[0] is an absolute path to a python" "$PV_OUT" "String(j.argv[0]).startsWith('/') && require('path').basename(j.argv[0]).startsWith('python')" "true"
  assert_json "PV5 stdout argv holds --cli <the absolute codex>" "$PV_OUT" "j.argv[j.argv.indexOf('--cli') + 1] || 'ABSENT'" "$want_cli"
  assert_json "PV5 the runner received --cli <the absolute codex>" "$(cat "$PV_ARGV" 2>/dev/null || echo null)" "j.indexOf('--cli') > 0 ? j[j.indexOf('--cli') + 1] : 'ABSENT'" "$want_cli"
}

# ---------- PV6: no codex -> preflight FAIL, run refuses ----------
{
  pv_arm
  nocodex="$(pv_path_without codex)"
  if [[ -z "$nocodex" ]]; then bad "PV6 could not build a PATH without codex"; else
    PATH="$nocodex" xprov_w4 preflight
    assert_rc "PV6 preflight exits 1 without codex" 1 "$W4_RC" "$W4_ERR"
    assert_eq "PV6 codex_cli FAILs" "$(check_result "$W4_OUT" codex_cli | cut -d'|' -f1)" "FAIL"
    pv_snap_run "$nocodex"
    assert_rc "PV6 run exits 1 without codex" 1 "$PV_RC" "$(cat "$TMP21/run-err.txt")"
    assert_json "PV6 run refuses with preflight_failed" "$PV_OUT" "j.reason" "preflight_failed"
    [[ ! -f "$PV_ARGV" ]] && ok "PV6 the runner was invoked 0 times" || bad "PV6 the runner was spawned without codex"
  fi
}

export HOME="$SAVED_HOME_21"
rm -rf "$TMP21"
