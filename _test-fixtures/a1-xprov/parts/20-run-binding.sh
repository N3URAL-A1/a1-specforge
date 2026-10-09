#!/usr/bin/env bash
# Part 20 — spec 014 Wave 6: the scan-bound `run`, the pre-spawn re-check and
# gitleaks as a requirement (FR-006, FR-008, FR-011). Sourced by run-tests.sh.
#
# Expectations are literals from the spec (reason codes, details, counts); the
# snapshot state is built with plain git, never with the module under test. Every
# arm runs under its OWN fresh HOME, so scan records and snapshots of other arms
# never leak in. The recording fake runner counts invocations: a fresh argv file
# per call, "invoked" means the file exists. Arm -> the single production change
# that turns it red:
#
#   RB1  hand-made clone snap-x + hand-built inputs -> exit 1 snapshot_not_scanned
#        / not_under_snapshots_dir, 0 invocations, artifacts listing unchanged, log
#        entry.                               Red if `run` takes any snap-* dir.
#   RB2  a copy of a real snapshot at <snapshots>/snap-copy -> no_scan_record.
#                                             Red if the record is not required.
#   RB3  a commit made inside a real snapshot -> record_mismatch.
#                                             Red if the commit is not compared.
#   RB4  snapshot of repo A, cwd in permitted repo B -> repo_mismatch.
#                                             Red if repo_key is not compared.
#   RB5  touch <snapshot>/planted.txt, review mode and inspect mode ->
#        snapshot_changed_after_scan / untracked_or_modified_file.
#                                             Red if there is no status re-check.
#   RB6  update-index --cacheinfo swap -> index_mismatch; edited tracked bytes ->
#        untracked_or_modified_file.          Red if ls-files -s is not compared.
#   RB7  unplanted snapshot -> the runner is reached exactly once (review+inspect).
#                                             Red if the binding refuses a good one.
#   RB8  a commit that tracks AGENTS.md (stripped by the snapshot) still runs.
#                                             Red if the status check is "empty".
#   GL1  gate, blocking row, no gitleaks on PATH -> exit 1, step preflight,
#        preflight_failed, detail gitleaks_missing + brew install gitleaks, no
#        snapshot, runner 0; with the stub on PATH the same call reaches the runner.
#   GL2  gate, warning row, no gitleaks -> stderr warning line, stdout gitleaks:false.
#   GL3  snapshot + run without gitleaks, blocking row -> preflight_failed /
#        gitleaks_missing, 0 invocations; warning row -> runner reached.
#   GL4  bin/ci-install-gitleaks.sh: checksum mismatch -> non-zero and nothing
#        extracted; match -> extracted and executable.
#   GL5  test.yml: the pinned install step precedes "Fixtures", with the Wave 0
#        version and sha256 literals and the GITHUB_PATH hand-off.
#
# Rule 7: the gitleaks-free PATH replaces every PATH dir that holds a `gitleaks`
# by a shadow dir of symlinks to its other entries; the helper proves
# `! command -v gitleaks` before use and the arm FAILS (never skips) otherwise.

TMP20="$(mktemp -d)"
SAVED_HOME_20="$HOME"
RB_N=0
RB_GITLEAKS_VERSION="8.30.1"
RB_GITLEAKS_SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
RB_PATH=""

# rb_nogl_path — prints a PATH without any gitleaks (see rule 7), or nothing when that cannot be reached.
rb_nogl_path() {
  local out="" d f name shadow np
  local IFS=':'
  for d in $PATH; do
    [[ -z "$d" ]] && continue
    if [[ -e "$d/gitleaks" ]]; then
      shadow="$(mktemp -d "$TMP20/shadow.XXXXXX")"
      for f in "$d"/* "$d"/.[!.]*; do
        [[ -e "$f" || -L "$f" ]] || continue
        name="$(basename "$f")"
        [[ "$name" == gitleaks ]] && continue
        ln -s "$f" "$shadow/$name"
      done
      d="$shadow"
    fi
    out="${out:+$out:}$d"
  done
  np="$out"
  if ( hash -r; PATH="$np"; ! command -v gitleaks >/dev/null 2>&1 ); then printf '%s' "$np"; fi
}

# rb_pin_row <warning|blocking> — sets the plan-review-xprov row of the TREE copy's registry.
rb_pin_row() {
  node -e '
    const fs = require("fs"); const [file, value] = process.argv.slice(1);
    const lines = fs.readFileSync(file, "utf8").split("\n").map((l) =>
      l.startsWith("| `plan-review-xprov` |") ? l.replace(/\| (warning|blocking) \|/, "| " + value + " |") : l);
    fs.writeFileSync(file, lines.join("\n"));
  ' "$TREE/_shared/gates-registry.md" "$1" || bad "rb_pin_row: could not set the registry copy to $1"
}

# rb_arm [enforcement] — fresh HOME, tree, phase repo p20, permit (file + store), compliant Codex home with the auth symlink.
rb_arm() {
  export HOME="$(mktemp -d "$TMP20/home.XXXXXX")"; mkdir -p "$HOME/.codex"
  printf '{"fixture":true}\n' > "$HOME/.codex/auth.json"; chmod 600 "$HOME/.codex/auth.json"
  make_tree; rb_pin_row "${1:-blocking}"; make_phase p20
  write_permit "$PHASE_REPO" fixture record/2026-10-09-fixture.md
  make_home; ln -s "$HOME/.codex/auth.json" "$XHOME/auth.json"; export A1_XPROV_CODEX_HOME="$XHOME"
  RB_PATH=""
}

# rb_snap [base] — snapshot of $PHASE_REPO HEAD with the PLAN.md copy. Sets RB_SOUT, RB_SERR, RB_SRC, RB_SNAP.
rb_snap() {
  local extra=(--plan "$PHASE_PLAN"); [[ -n "${1:-}" ]] && extra+=(--base "$1")
  RB_SOUT="$( [[ -n "$RB_PATH" ]] && export PATH="$RB_PATH"; cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov snapshot --repo "$PHASE_REPO" --commit HEAD "${extra[@]}" 2>"$TMP20/snap-err.txt")"; RB_SRC=$?
  RB_SERR="$(cat "$TMP20/snap-err.txt")"
  RB_SNAP="$(json_get "$RB_SOUT" "j.snapshot || ''")"; [[ "$RB_SNAP" == "UNPARSEABLE" ]] && RB_SNAP=""
}

# rb_run <mode> [flags] — `xprov run` on $RB_SNAP from $RB_CWD (default $PHASE_REPO). Sets RB_OUT, RB_ERR, RB_RC, RB_ARGV.
rb_run() {
  local mode="$1"; shift
  RB_N=$((RB_N + 1)); RB_ARGV="$TMP20/argv-$RB_N.json"
  FAKE_RUNNER_ARGV_FILE="$RB_ARGV" FAKE_RUNNER_CASE=approved fake_runner_env
  RB_OUT="$( [[ -n "$RB_PATH" ]] && export PATH="$RB_PATH"; cd "${RB_CWD:-$PHASE_REPO}" && node "$TREE_TOOLS" xprov run --mode "$mode" --snapshot "$RB_SNAP" --plan "$RB_SNAP.inputs/PLAN.md" --phase p20 --gate "$GATE_PLAN" --timeout 7 "$@" 2>"$TMP20/run-err.txt")"; RB_RC=$?
  RB_ERR="$(cat "$TMP20/run-err.txt")"
}

rb_invoked() { if [[ -f "$RB_ARGV" ]]; then echo 1; else echo 0; fi; }
rb_listing() { if [[ -d "$HOME/.a1-xprov/artifacts" ]]; then (cd "$HOME/.a1-xprov/artifacts" && find . | LC_ALL=C sort); else echo "(absent)"; fi; }

# rb_expect <name> <reason> <detail> — the last rb_run was refused with exactly this reason and detail, nothing spawned.
rb_expect() {
  assert_rc "$1 exits 1" 1 "$RB_RC" "$RB_ERR"
  assert_json "$1 reason/detail" "$RB_OUT" "[j.reason, j.reason_detail].join('/')" "$2/$3"
  assert_eq "$1 the fake runner was invoked 0 times" "$(rb_invoked)" "0"
}

# rb_commit <msg> — commit everything in $PHASE_REPO; updates PHASE_HEAD.
rb_commit() { ( cd "$PHASE_REPO" && git add -A && git commit -qm "$1" ); PHASE_HEAD="$(cd "$PHASE_REPO" && git rev-parse HEAD)"; }

# ---------- RB1: a hand-made clone is not a scanned snapshot ----------
{
  rb_arm
  RB_SNAP="$TMP20/snap-x"
  git clone -q "$PHASE_REPO" "$RB_SNAP"
  mkdir -p "$RB_SNAP.inputs"; cp "$PHASE_PLAN" "$RB_SNAP.inputs/PLAN.md"
  printf '{"plan":"%s"}\n' "$(sha256_of "$PHASE_PLAN")" > "$RB_SNAP.inputs/inputs.json"
  before="$(rb_listing)"
  rb_run review
  rb_expect "RB1 hand-made clone" snapshot_not_scanned not_under_snapshots_dir
  assert_eq "RB1 the artifacts listing is unchanged" "$(rb_listing)" "$before"
  grep -q "verdict: fail/snapshot_not_scanned" "$PHASE_DIR/PLAN-REVIEW-LOG.md" 2>/dev/null \
    && ok "RB1 the refusal is logged like the other pre-spawn refusals" || bad "RB1 no fail/snapshot_not_scanned entry in PLAN-REVIEW-LOG.md"
}

# ---------- RB2: a copied snapshot has no record ----------
{
  rb_arm; rb_snap
  assert_rc "RB2 setup: snapshot exits 0" 0 "$RB_SRC" "$RB_SERR"
  copy="$(dirname "$RB_SNAP")/snap-copy"
  cp -R "$RB_SNAP" "$copy"; cp -R "$RB_SNAP.inputs" "$copy.inputs"
  RB_SNAP="$copy"
  rb_run review
  rb_expect "RB2 copied snapshot" snapshot_not_scanned no_scan_record
}

# ---------- RB3: a commit inside the snapshot ----------
{
  rb_arm; rb_snap
  assert_rc "RB3 setup: snapshot exits 0" 0 "$RB_SRC" "$RB_SERR"
  git -C "$RB_SNAP" -c user.name=x -c user.email=x@example.invalid -c commit.gpgsign=false commit -q --allow-empty -m "planted commit"
  rb_run review
  rb_expect "RB3 commit inside the snapshot" snapshot_not_scanned record_mismatch
}

# ---------- RB4: snapshot of repo A, cwd in repo B ----------
{
  rb_arm; rb_snap
  assert_rc "RB4 setup: snapshot exits 0" 0 "$RB_SRC" "$RB_SERR"
  repo_a="$PHASE_REPO"
  make_phase p20; write_permit "$PHASE_REPO" fixture record/2026-10-09-fixture.md   # repo B: its own valid permit
  [[ "$PHASE_REPO" != "$repo_a" ]] || bad "RB4 setup: repo B is repo A"
  RB_CWD="$PHASE_REPO"; rb_run review; unset RB_CWD
  rb_expect "RB4 snapshot of repo A run from repo B" snapshot_not_scanned repo_mismatch
}

# ---------- RB5: a planted file, review and inspect mode ----------
{
  rb_arm; rb_snap
  assert_rc "RB5 setup: snapshot exits 0" 0 "$RB_SRC" "$RB_SERR"
  touch "$RB_SNAP/planted.txt"
  rb_run review
  rb_expect "RB5 planted file, review mode" snapshot_changed_after_scan untracked_or_modified_file

  rb_arm
  base="$PHASE_HEAD"; printf 'export const two = 2;\n' > "$PHASE_REPO/src/two.js"; rb_commit "fixture: wave commit"
  rb_snap "$base"
  assert_rc "RB5b setup: inspect snapshot exits 0" 0 "$RB_SRC" "$RB_SERR"
  touch "$RB_SNAP/planted.txt"
  rb_run inspect --base "$base"
  rb_expect "RB5b planted file, inspect mode" snapshot_changed_after_scan untracked_or_modified_file
}

# ---------- RB6: index swap and edited bytes ----------
{
  rb_arm; rb_snap
  assert_rc "RB6 setup: snapshot exits 0" 0 "$RB_SRC" "$RB_SERR"
  other="$(printf 'something else\n' | git -C "$RB_SNAP" hash-object -w --stdin)"
  git -C "$RB_SNAP" update-index --cacheinfo "100644,$other,src/add.js"
  rb_run review
  rb_expect "RB6 update-index swap" snapshot_changed_after_scan index_mismatch

  rb_arm; rb_snap
  assert_rc "RB6b setup: snapshot exits 0" 0 "$RB_SRC" "$RB_SERR"
  printf '// edited\n' >> "$RB_SNAP/src/add.js"
  rb_run review
  rb_expect "RB6b edited tracked bytes" snapshot_changed_after_scan untracked_or_modified_file
}

# ---------- RB7: nothing planted -> the runner is reached once ----------
{
  rb_arm; rb_snap
  assert_rc "RB7 setup: snapshot exits 0" 0 "$RB_SRC" "$RB_SERR"
  rb_run review
  assert_rc "RB7 review: an unplanted snapshot runs" 0 "$RB_RC" "$RB_ERR"
  assert_eq "RB7 review: the fake runner was invoked once" "$(rb_invoked)" "1"

  rb_arm
  base="$PHASE_HEAD"; printf 'export const two = 2;\n' > "$PHASE_REPO/src/two.js"; rb_commit "fixture: wave commit"
  rb_snap "$base"
  rb_run inspect --base "$base"
  assert_rc "RB7 inspect: an unplanted snapshot runs" 0 "$RB_RC" "$RB_ERR"
  assert_eq "RB7 inspect: the fake runner was invoked once" "$(rb_invoked)" "1"
}

# ---------- RB8: a tracked AGENTS.md is stripped by the snapshot and still passes ----------
{
  rb_arm
  printf 'repo-local agent notes\n' > "$PHASE_REPO/AGENTS.md"; rb_commit "fixture: tracked AGENTS.md"
  rb_snap
  assert_rc "RB8 setup: snapshot exits 0" 0 "$RB_SRC" "$RB_SERR"
  [[ ! -e "$RB_SNAP/AGENTS.md" ]] && ok "RB8 setup: AGENTS.md was stripped from the snapshot" || bad "RB8 setup: AGENTS.md still in the snapshot"
  rb_run review
  assert_rc "RB8 a snapshot with a stripped tracked file runs" 0 "$RB_RC" "$RB_ERR"
  assert_eq "RB8 the fake runner was invoked once" "$(rb_invoked)" "1"
}

# ---------- GL1: blocking gate without gitleaks ----------
# rb_gate [flags] — `xprov gate --phase p20 …` from $PHASE_REPO under $RB_PATH. Sets G20_OUT, G20_ERR, G20_RC, RB_ARGV.
rb_gate() {
  RB_N=$((RB_N + 1)); RB_ARGV="$TMP20/argv-$RB_N.json"
  FAKE_RUNNER_ARGV_FILE="$RB_ARGV" FAKE_RUNNER_CASE=approved fake_runner_env
  G20_OUT="$( [[ -n "$RB_PATH" ]] && export PATH="$RB_PATH"; cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --phase p20 --gate "$GATE_PLAN" --timeout 7 "$@" 2>"$TMP20/gate-err.txt")"; G20_RC=$?
  G20_ERR="$(cat "$TMP20/gate-err.txt")"
}
rb_snaps_left() { ls -d "$HOME/.a1-xprov/snapshots"/snap-* 2>/dev/null | wc -l | tr -d ' '; }

NOGL_PATH="$(rb_nogl_path)"
if [[ -z "$NOGL_PATH" ]]; then
  bad "GL setup: a PATH without gitleaks could not be built (rule 7); the GL arms cannot run"
else
  ok "GL setup: a PATH without gitleaks exists (! command -v gitleaks)"
  {
    rb_arm blocking; RB_PATH="$NOGL_PATH"
    rb_gate
    assert_rc "GL1 blocking gate without gitleaks exits 1" 1 "$G20_RC" "$G20_ERR"
    assert_json "GL1 step preflight, reason preflight_failed" "$G20_OUT" "[j.step, j.reason, j.verdict].join('/')" "preflight/preflight_failed/fail"
    assert_json "GL1 detail names gitleaks_missing and the install hint" "$G20_OUT" "String(j.reason_detail).includes('gitleaks_missing') && String(j.reason_detail).includes('brew install gitleaks')" "true"
    assert_eq "GL1 no snapshot was created" "$(rb_snaps_left)" "0"
    assert_eq "GL1 the fake runner was invoked 0 times" "$(rb_invoked)" "0"

    RB_PATH=""; rb_gate
    assert_rc "GL1 control: the same gate with the stub gitleaks on PATH exits 0" 0 "$G20_RC" "$G20_ERR"
    assert_eq "GL1 control: the fake runner was invoked once" "$(rb_invoked)" "1"
    assert_json "GL1 control: stdout carries gitleaks:true" "$G20_OUT" "j.gitleaks" "true"
  }

  # ---------- GL2: warning gate degrades with one stderr line ----------
  {
    rb_arm warning; RB_PATH="$NOGL_PATH"
    rb_gate
    assert_rc "GL2 warning gate without gitleaks passes" 0 "$G20_RC" "$G20_ERR"
    assert_json "GL2 stdout has gitleaks:false and the chain reached normalize" "$G20_OUT" "[j.gitleaks, j.step].join('/')" "false/normalize"
    assert_eq "GL2 stderr holds the warning line once" "$(grep -c '^xprov gate: warning gitleaks not on PATH — patterns-only secret scan$' <<<"$G20_ERR")" "1"
  }

  # ---------- GL3: direct snapshot + run ----------
  {
    rb_arm blocking; RB_PATH="$NOGL_PATH"; rb_snap
    assert_rc "GL3 setup: snapshot without gitleaks exits 0" 0 "$RB_SRC" "$RB_SERR"
    assert_json "GL3 setup: the snapshot result says gitleaks:false" "$RB_SOUT" "j.gitleaks" "false"
    rb_run review
    rb_expect "GL3 blocking run on a gitleaks-free snapshot" preflight_failed gitleaks_missing

    rb_arm warning; RB_PATH="$NOGL_PATH"; rb_snap
    rb_run review
    assert_rc "GL3 warning row: the same run is allowed" 0 "$RB_RC" "$RB_ERR"
    assert_eq "GL3 warning row: the fake runner was invoked once" "$(rb_invoked)" "1"
  }
fi
RB_PATH=""

# ---------- GL4: the CI install script ----------
{
  INSTALL_GL="$REPO_ROOT/bin/ci-install-gitleaks.sh"
  [[ -f "$INSTALL_GL" ]] && ok "GL4 bin/ci-install-gitleaks.sh exists" || bad "GL4 bin/ci-install-gitleaks.sh is missing"
  src="$TMP20/gl-src"; mkdir -p "$src"
  printf '#!/bin/sh\necho "fake gitleaks"\n' > "$src/gitleaks"; chmod 755 "$src/gitleaks"
  ( cd "$src" && tar -czf "$TMP20/gitleaks-fixture.tar.gz" gitleaks )
  good_sha="$(sha256_of "$TMP20/gitleaks-fixture.tar.gz")"
  bad_sha="$(printf '%s' "$good_sha" | tr '0-9a-f' '1-9a-f0' )"
  [[ "$bad_sha" != "$good_sha" ]] || bad_sha="0000000000000000000000000000000000000000000000000000000000000000"

  dest_bad="$TMP20/dest-bad"
  bash "$INSTALL_GL" "$RB_GITLEAKS_VERSION" "$bad_sha" "$dest_bad" --archive "$TMP20/gitleaks-fixture.tar.gz" >"$TMP20/gl4.out" 2>"$TMP20/gl4.err"; rc=$?
  assert_rc "GL4 a checksum mismatch exits 1" 1 "$rc" "$(cat "$TMP20/gl4.err")"
  grep -qi "mismatch" "$TMP20/gl4.err" && ok "GL4 the refusal names the checksum mismatch" || bad "GL4 the refusal does not say checksum mismatch: $(cat "$TMP20/gl4.err")"
  [[ ! -e "$dest_bad/gitleaks" ]] && ok "GL4 a checksum mismatch extracts nothing" || bad "GL4 the binary was extracted despite the mismatch"

  dest_ok="$TMP20/dest-ok"
  bash "$INSTALL_GL" "$RB_GITLEAKS_VERSION" "$good_sha" "$dest_ok" --archive "$TMP20/gitleaks-fixture.tar.gz" >"$TMP20/gl4.out" 2>"$TMP20/gl4.err"; rc=$?
  assert_rc "GL4 a matching checksum exits 0" 0 "$rc" "$(cat "$TMP20/gl4.err")"
  [[ -x "$dest_ok/gitleaks" ]] && ok "GL4 the binary is extracted and executable" || bad "GL4 no executable $dest_ok/gitleaks"

  bash "$INSTALL_GL" "$RB_GITLEAKS_VERSION" "not-a-sha" "$TMP20/dest-usage" --archive "$TMP20/gitleaks-fixture.tar.gz" >/dev/null 2>&1; rc=$?
  [[ $rc -ne 0 && ! -e "$TMP20/dest-usage/gitleaks" ]] && ok "GL4 a malformed sha256 argument is refused" || bad "GL4 a malformed sha256 argument was accepted (exit $rc)"
}

# ---------- GL5: the CI workflow step ----------
{
  step="$(node -e '
    const lines = require("fs").readFileSync(process.argv[1], "utf8").split("\n");
    const steps = []; let cur = null;
    for (const l of lines) {
      const m = l.match(/^\s*- (?:name|uses):\s*(.*)$/);
      if (m) { cur = { name: m[1].trim(), body: "" }; steps.push(cur); continue; }
      if (cur) cur.body += l + "\n";
    }
    const fx = steps.findIndex((s) => s.name === "Fixtures");
    const gl = steps.findIndex((s) => s.body.includes("bin/ci-install-gitleaks.sh"));
    const body = gl >= 0 ? steps[gl].body : "";
    process.stdout.write(JSON.stringify({ before: fx >= 0 && gl >= 0 && gl < fx, version: body.includes(process.argv[2]), sha: body.includes(process.argv[3]), path: body.includes("GITHUB_PATH") }));
  ' "$REPO_ROOT/.github/workflows/test.yml" "$RB_GITLEAKS_VERSION" "$RB_GITLEAKS_SHA256" 2>&1)"
  assert_json "GL5 the install step runs before Fixtures" "$step" "j.before" "true"
  assert_json "GL5 the step pins the Wave 0 version" "$step" "j.version" "true"
  assert_json "GL5 the step pins the Wave 0 sha256" "$step" "j.sha" "true"
  assert_json "GL5 the step appends the install dir to GITHUB_PATH" "$step" "j.path" "true"
}

export HOME="$SAVED_HOME_20"
rm -rf "$TMP20"
