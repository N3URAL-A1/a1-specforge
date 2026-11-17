# Sourced by run-tests.sh (spec 027 FR-009 last sentence, wave 8). Uses the suite helpers: expect, g, WORK, REPO_ROOT.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# One planted diff per entry of the REAL .a1/verify.json ci_evidence.unchanged: decide() must answer
# used:false, why:protected_path_changed. CU9..CU15 ask pathsChanged() directly. CU8 is the control.
#
# RED-proof (wave report): (a) the `unchanged` line removed from decide() in a scratch copy -> CU1..CU7 red (why becomes check_missing);
# (b) pathsChanged returns false for prefix entries -> the `.github/` cases of CU1..CU7 and CU9..CU15 red.

CU_LIB="${A1_CU_LIB:-$REPO_ROOT/_shared/lib/pr-ci-evidence.cjs}" # A1_CU_LIB: RED-proof seam (scratch copy)
CU_ENTRIES="$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).ci_evidence;process.stdout.write(c.unchanged.join("\n"))' "$REPO_ROOT/.a1/verify.json")"
expect "CU0 the real .a1/verify.json ci_evidence.unchanged has 7 entries" "7" "$(printf '%s\n' "$CU_ENTRIES" | grep -c .)"

# cu_repo <dir> <entry|-> : main holds the real verify.json plus the entry's file; feat changes only that file (or docs/x.md for "-").
cu_repo() {
  local d="$1" e="$2" f
  mkdir -p "$d/.a1" "$d/docs"
  cp "$REPO_ROOT/.a1/verify.json" "$d/.a1/verify.json"
  echo base > "$d/docs/keep.md"
  if [[ "$e" == "-" ]]; then f="docs/x.md"; elif [[ "$e" == */ ]]; then f="${e}x.yml"; else f="$e"; fi
  mkdir -p "$d/$(dirname "$f")"
  echo one > "$d/$f"
  g "$d" init -q -b main
  g "$d" add -A; g "$d" commit -q -m base
  CU_BASE="$(g "$d" rev-parse HEAD)"
  g "$d" checkout -q -b feat
  echo two >> "$d/$f"
  g "$d" add -A; g "$d" commit -q -m change
}
cu_decide() { # dir -> "used|why"
  node -e '
    const fs = require("fs"); const ev = require(process.argv[1]); const P = process.argv[2];
    const cfg = JSON.parse(fs.readFileSync(P + "/.a1/verify.json", "utf8"));
    const r = ev.decide({ project: P, baseSha: process.argv[3], evidence: ev.parseCiEvidence(cfg),
      rawEvidence: cfg.ci_evidence, baseEvidence: cfg.ci_evidence, baseUnreadable: false,
      disabled: false, override: false, hasCountingReporter: () => false, listChecks: () => [] });
    process.stdout.write(r.used + "|" + r.why);
  ' "$CU_LIB" "$1" "$CU_BASE"
}

cu_i=0
while IFS= read -r cu_e; do
  cu_i=$((cu_i + 1))
  cu_d="$WORK/cu$cu_i"; mkdir -p "$cu_d"
  cu_repo "$cu_d" "$cu_e"
  expect "CU$cu_i decide(): a change in '$cu_e' alone -> used:false protected_path_changed" "false|protected_path_changed" "$(cu_decide "$cu_d")"
  cu_pc="$(node -e 'process.stdout.write(String(require(process.argv[1]).pathsChanged(process.argv[2], process.argv[3], [process.argv[4]])))' "$CU_LIB" "$cu_d" "$CU_BASE" "$cu_e")"
  expect "CU$((cu_i + 8)) pathsChanged(): '$cu_e' -> true" "true" "$cu_pc"
done <<< "$CU_ENTRIES"

cu_d="$WORK/cu-control"; mkdir -p "$cu_d"
cu_repo "$cu_d" "-"
expect "CU8 control: a change outside every entry -> decide() passes the unchanged check (check_missing)" "false|check_missing" "$(cu_decide "$cu_d")"
