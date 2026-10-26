# shellcheck shell=bash
# Part 05 — Wiring, intent children, vault contract, suite audit (spec 021 Wave 5).
# FR-016, FR-017, FR-018, FR-019, FR-020 plus SC-001 and the requirement inventory over all parts.
# Mutation proofs (git-archive snapshot): drop the dashboard warn line in 03-verify -> 05.24 red;
# remove the INTENT_CHILD_EXCLUSIONS entries -> a1-intent H7a red (unclassified call).

SKILLS="$REPO_ROOT/skills"
mk_fixture_repo R5; mk_fixture_vault V5
T5="$V5/project/fixture-slug/dashboard.md"

# ---- FR-016: intent children are refused, nothing written ------------------------------------------------
child_out="$(cd "$R5" && A1_INTENT_CHILD=1 A1_VAULT_ROOT="$V5" A1_HOST_ID=fx-writer node "$TOOLS" dashboard build 2>&1)"; child_rc=$?
expect "05.1 A1_INTENT_CHILD=1 dashboard build exits 77" "77" "$child_rc"
expect_has "05.2 the refusal names intent_child_refused" "$child_out" "intent_child_refused"
expect "05.3 no dashboard note written (count 0)" "0" "$(find "$V5" -name dashboard.md | wc -l | tr -d ' ')"
expect "05.4 the vault tree is unchanged by the refused call (file count 1)" "1" "$(find "$V5" -type f | wc -l | tr -d ' ')"
cls="$(node -e '
  const S = require(process.argv[1] + "/lib/intent-sandbox.cjs");
  const inAllow = Object.values(S.INTENT_CHILD_ALLOWLIST).flat().includes("dashboard build");
  const ex = S.INTENT_CHILD_EXCLUSIONS;
  console.log([inAllow, typeof ex.plan["dashboard build"], typeof ex.execute["dashboard build"], ex.plan["dashboard build"] === ex.execute["dashboard build"]].join(","));' "$SHARED")"
expect "05.5 on no allowlist; classified with one reason in plan and execute exclusions" "false,string,string,true" "$cls"

# ---- FR-017: vault contract ---------------------------------------------------------------------------------
# vault sync scans the repo's parent directory for repos that claim the same project; the contract cases run
# in an isolated parent so the suite's other fixture repos are not seen.
mkdir -p "$WORK/iso" && cp -R "$R5" "$WORK/iso/repo" && R5="$WORK/iso/repo"
vault_run "$R5" "$V5" dashboard build
expect "05.6 build for the contract cases exits 0 (${ERR:0:200})" "0" "$RC"
[[ -f "$T5" ]] && ok "05.7 the note sits at the root of project/<slug>/" || bad "05.7 note missing"
# lint without the note (the project folder exists because the build created it; the note is held aside)
mv "$T5" "$T5.hold"; printf 'x\n' > "$V5/project/fixture-slug/.keep-folder"
vault_run "$R5" "$V5" vault lint fixture-slug --json; lint_without="$OUT"; lint_rc_without="$RC"; lint_err_without="$ERR"
rm -f "$V5/project/fixture-slug/.keep-folder"; mv "$T5.hold" "$T5"
vault_run "$R5" "$V5" vault sync fixture-slug --prune --dry-run --json
expect "05.8 sync --prune --dry-run exits 0 (stderr: ${ERR:0:300})" "0" "$RC"
sync_json="$(sed -n '/^{/,$p' <<<"$OUT")"
expect "05.9 at least one planned entry (count)" "true" "$(json_get "$sync_json" 'j.planned.length >= 1')"
expect "05.10 no planned entry names dashboard.md (count 0)" "0" "$(json_get "$sync_json" 'j.planned.filter((p) => /dashboard\.md/.test(p.path)).length')"
expect "05.11 --prune would prune nothing (pruned 0, extra 0)" "0,0" "$(json_get "$sync_json" 'j.pruned + "," + j.extra')"
vault_run "$R5" "$V5" vault lint fixture-slug --json
expect "05.12 vault lint exit code is identical with and without the note" "$lint_rc_without" "$RC"
expect "05.13 vault lint findings count is identical with and without the note" \
  "$(json_get "$(sed -n '/^{/,$p' <<<"$lint_without")" 'j.findings.length')" "$(json_get "$(sed -n '/^{/,$p' <<<"$OUT")" 'j.findings.length')"
expect "05.14 lint reports 0 findings (count beside the equality)" "0" "$(json_get "$(sed -n '/^{/,$p' <<<"$OUT")" 'j.findings.length')"
schema="$(node "$TOOLS" schema export --json 2>/dev/null)"
expect "05.15 schema export holds no dashboard type (count 0)" "0" "$(grep -ci 'dashboard' <<<"$schema")"
expect "05.16 schema export is non-empty (count assert)" "true" "$([[ "$(printf '%s' "$schema" | wc -c | tr -d ' ')" -gt 200 ]] && echo true || echo false)"

# ---- FR-019: a1-progress line ------------------------------------------------------------------------------
# The documented scan block is extracted from the workflow and run as written, against the temp vault.
SCAN_BLOCK="$WORK/scan-block.sh"
node -e '
  const t = require("fs").readFileSync(process.argv[1], "utf8");
  const blocks = [...t.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => b.includes("VC_DIR="));
  if (blocks.length !== 1) { console.error("blocks " + blocks.length); process.exit(1); }
  process.stdout.write(blocks[0]);' "$SKILLS/a1-progress/workflows/01-scan.md" > "$SCAN_BLOCK"
expect "05.17 exactly one documented vault block in the scan workflow (size > 0)" "true" "$([[ -s "$SCAN_BLOCK" ]] && echo true || echo false)"
progress_run() { (cd "$R5" && A1_TOOLS="$TOOLS" A1_VAULT_ROOT="$V5" A1_HOST_ID=fx-writer bash "$SCAN_BLOCK" 2>&1); }
with_note="$(progress_run)"
gen="$(grep -m1 '^generated:' "$T5" | sed 's/^generated:[[:space:]]*//')"
expect "05.18 with the note: one dashboard line (count 1)" "1" "$(grep -c '^dashboard: ' <<<"$with_note")"
expect "05.19 the line is dashboard: <path> (generated <timestamp>)" "dashboard: $T5 (generated $gen)" "$(grep '^dashboard: ' <<<"$with_note")"
expect "05.20 the generated stamp is non-empty (count assert)" "true" "$([[ -n "$gen" ]] && echo true || echo false)"
mv "$T5" "$T5.hold"
without_note="$(progress_run)"
mv "$T5.hold" "$T5"
expect "05.21 without the note: no dashboard line (count 0)" "0" "$(grep -c '^dashboard: ' <<<"$without_note")"
expect "05.22 the vault lines still print without the note (count 2)" "2" "$(grep -c '^vault ' <<<"$without_note")"
prog_calls="$(grep -rnE 'a1-tools(\.cjs)?["'"'"']?[[:space:]]+dashboard[[:space:]]+build|A1_TOOLS"[[:space:]]+dashboard[[:space:]]+build' "$SKILLS/a1-progress" | wc -l | tr -d ' ')"
expect "05.23 the a1-progress skill holds no dashboard build call (count 0)" "0" "$prog_calls"

# ---- FR-020: workflow call sites ---------------------------------------------------------------------------
# callsite_check <file> — prints "ok" when the file has exactly one 'dashboard build <project-slug>' line, placed
# directly after its 'vault sync <project-slug> --phases' warn line, inside the same A1_VAULT_ROOT guard (no fi
# between), and followed by a one-line warn-and-continue.
callsite_check() {
  node -e '
    const L = require("fs").readFileSync(process.argv[1], "utf8").split("\n");
    const idx = L.map((l, i) => (l.includes("dashboard build <project-slug>") ? i : -1)).filter((i) => i >= 0);
    if (idx.length !== 1) { console.log("calls=" + idx.length); process.exit(0); }
    const i = idx[0];
    const sync = L.findIndex((l) => l.includes("vault sync <project-slug> --phases"));
    const warnSync = /if \[ \$RC -ne 0 \]; then echo "⚠ vault sync --phases exit=/.test(L[i - 1] || "");
    const warnDash = /if \[ \$RC -ne 0 \]; then echo "⚠ dashboard build exit=\$RC — dashboard not refreshed, continuing"; fi/.test(L[i + 1] || "");
    const guardOpen = L.slice(0, i).map((l, k) => [l, k]).reverse().find(([l]) => /^\s*if \[ -n "\$\{A1_VAULT_ROOT:-\}" \]; then/.test(l));
    const fiAfter = L.slice(i + 2).findIndex((l) => /^\s*fi\s*$/.test(l));
    const noFiBetween = guardOpen && !L.slice(guardOpen[1] + 1, i).some((l) => /^\s*fi\s*$/.test(l));
    const redir = /dashboard build <project-slug>\)? >\/dev\/null; RC=\$\?/.test(L[i]);
    console.log(sync >= 0 && sync < i && i - sync === 2 && warnSync && warnDash && noFiBetween && fiAfter === 0 && redir ? "ok" : "bad sync=" + (i - sync) + " ws=" + warnSync + " wd=" + warnDash + " guard=" + !!noFiBetween + " fi=" + fiAfter + " redir=" + redir);' "$1"
}
WF_PLAN="$SKILLS/a1-plan/workflows/04-audit.md"
WF_EXEC="$SKILLS/a1-execute/workflows/02-execute.md"
WF_VERIFY="$SKILLS/a1-execute/workflows/03-verify.md"
sites="$(grep -rn 'dashboard build <project-slug>' "$SKILLS" | sed 's/:.*//' | sort | tr '\n' ' ')"
expect "05.24 exactly three call sites, in 04-audit, 02-execute, 03-verify" \
  "$WF_EXEC $WF_VERIFY $WF_PLAN " "$sites"
expect "05.25 call-site count over skills/ (count 3)" "3" "$(grep -rn 'dashboard build <project-slug>' "$SKILLS" | wc -l | tr -d ' ')"
expect "05.26 04-audit: directly after its vault sync warn, same guard, warn-and-continue" "ok" "$(callsite_check "$WF_PLAN")"
expect "05.27 02-execute: same" "ok" "$(callsite_check "$WF_EXEC")"
expect "05.28 03-verify: same" "ok" "$(callsite_check "$WF_VERIFY")"
expect_has "05.29 02-execute runs the build from \$WORK_PATH" "$(grep 'dashboard build <project-slug>' "$WF_EXEC")" '(cd "$WORK_PATH" &&'
expect "05.30 no call site passes --phase (not a gate; count 0)" "0" "$(grep -rn 'dashboard build <project-slug>' "$SKILLS" | grep -c -- '--phase')"
# mutation control: the checker turns red when the warn line is dropped (RED proof for the order case)
grep -v 'dashboard build exit=' "$WF_VERIFY" > "$WORK/verify-mut.md"
expect "05.31 control: dropping the dashboard warn line makes the checker red" "true" "$([[ "$(callsite_check "$WORK/verify-mut.md")" != ok ]] && echo true || echo false)"
sed 's/vault sync <project-slug> --phases/vault sync <project-slug>/' "$WF_PLAN" > "$WORK/audit-mut.md"
expect "05.32 control: a call not placed after its vault sync line is red" "true" "$([[ "$(callsite_check "$WORK/audit-mut.md")" != ok ]] && echo true || echo false)"

# ---- FR-015 completion: no readFileSync in the section and cost modules (all reads go through the seam) -------
rfs="$(grep -c 'readFileSync' "$SHARED/lib/dashboard-sources.cjs" "$SHARED/lib/dashboard-cost.cjs" | awk -F: '{s+=$2} END {print s+0}')"
expect "05.33 readFileSync in dashboard-sources.cjs + dashboard-cost.cjs (count 0)" "0" "$rfs"

# ---- FR-006 end to end: a secret-shaped Specs title is redacted in the note -----------------------------------
mk_sections_repo R5b; mk_sections_vault V5b
SECRET_TOK="sk-$(printf 'A1b2C3d4E5%.0s' 1 2 3 4)"
spec_f="$V5b/project/fixture-slug/spec/006-specforge-kritis-profile.md"
node -e '
  const fs = require("fs"); const f = process.argv[1]; const t = fs.readFileSync(f, "utf8");
  const i = t.indexOf("\ntitle: "); const j = t.indexOf("\n", i + 1);
  fs.writeFileSync(f, t.slice(0, i) + "\ntitle: \"Rotate " + process.argv[2] + " now\"" + t.slice(j));' "$spec_f" "$SECRET_TOK"
vault_run "$R5b" "$V5b" dashboard build --json
n5b="$V5b/project/fixture-slug/dashboard.md"
expect "05.34 build with a secret-shaped spec title exits 0" "0" "$RC"
SPECS="$(section_of "$(cat "$n5b")" Specs)"
expect "05.35 raw token in the Specs section, stdout and stderr (count 0)" "0" "$(printf '%s\n%s\n%s\n' "$SPECS" "$OUT" "$ERR" | grep -cF "$SECRET_TOK")"
expect_has "05.36 the Specs section carries the redaction marker" "$SPECS" "[REDACTED]"
expect_has "05.37 the title text around the token survives" "$SPECS" "Rotate"

# ---- SC-001: timing on a copy of the fixture vault ----------------------------------------------------------
mk_sections_repo R5c; mk_sections_vault V5c
t0="$(node -e 'process.stdout.write(String(Date.now()))')"
vault_run "$R5c" "$V5c" dashboard build
t1="$(node -e 'process.stdout.write(String(Date.now()))')"
expect "05.38 timed build exits 0" "0" "$RC"
[[ $((t1 - t0)) -lt 5000 ]] && ok "05.39 SC-001 build under 5 s ($((t1 - t0)) ms)" || bad "05.39 SC-001 build took $((t1 - t0)) ms"
expect "05.40 the note answers in-flight, next and open-points (3 headings present)" "3" \
  "$(grep -cE '^## (Now|Next|Open points)$' "$V5c/project/fixture-slug/dashboard.md")"

# ---- FR-018: suite audit -------------------------------------------------------------------------------------
# Inventory: every FR-001..FR-021 is named in a section header or a case line of some part.
inv_missing=""; inv_n=0
for n in $(seq 1 21); do
  id="$(printf 'FR-%03d' "$n")"
  if grep -hE '^#|PASS|ok |expect' "$SUITE_DIR"/parts/*.sh | grep -q "$id"; then inv_n=$((inv_n + 1)); else inv_missing="$inv_missing $id"; fi
done
expect "05.41 every requirement FR-001..FR-021 has a named section or case (missing:${inv_missing:- none})" "21" "$inv_n"
case_total="$(grep -hcE '^(expect|expect_has|expect_lacks|expect_count)[ _]|^\[\[.*(ok|bad) ' "$SUITE_DIR"/parts/*.sh | awk '{s+=$1} END {print s+0}')"
[[ "$case_total" -ge 21 ]] && ok "05.42 case inventory over all parts >= 21 ($case_total)" || bad "05.42 only $case_total cases"
expect "05.43 suite parts present (count 5)" "5" "$(ls "$SUITE_DIR"/parts/*.sh | wc -l | tr -d ' ')"
# real-vault check: no dashboard.md newer than the suite start stamp. HOME is a temp dir here; the real home
# comes from the account database.
REAL_HOME="$(node -e 'process.stdout.write(require("os").userInfo().homedir)')"
START_EPOCH=$(( $(date +%s) - SECONDS ))
STAMP="$WORK/start.stamp"
node -e 'const d = new Date(Number(process.argv[1]) * 1000); const p = (n) => String(n).padStart(2, "0");
  process.stdout.write(`${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}.${p(d.getSeconds())}`);' "$START_EPOCH" > "$WORK/start.ts"
: > "$STAMP" && touch -t "$(cat "$WORK/start.ts")" "$STAMP"
if [[ -d "$REAL_HOME/N3URAL-Vault" ]]; then
  expect "05.44 no dashboard.md under the real vault is newer than the suite start (count 0)" "0" \
    "$(find "$REAL_HOME/N3URAL-Vault" -name dashboard.md -newer "$STAMP" 2>/dev/null | wc -l | tr -d ' ')"
else
  echo "SKIP  05.44 real vault absent ($REAL_HOME/N3URAL-Vault) — check skipped"
fi
