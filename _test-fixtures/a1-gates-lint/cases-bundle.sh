# Spec 027 slice 4 (FR-024), plan D12: `wave checks` is a bundle alias in `gates lint`.
# Sourced by run-tests.sh (uses ok, bad, check, run_lint, plant, WORK, REPO_ROOT, TOOLS).
# The tree is a copy of the REAL skills/ with the REAL registry (not the frozen corpus): the wiring under test is the
# real a1-execute 02-execute.md `wave checks` line. Planted defects are string edits of the copy.
#
# Measured red 2026-11-23 (each on its own edit, suite run, file restored):
#   gates-lint.cjs findCalls(): BUNDLES lookup removed                 -> BU1, W11f
#   gates-lint.cjs BUNDLES: `test-fidelity` dropped from the list      -> BU1, BU3, BU4 carry the proof (BU2 stays green: it removes the call lines, not the list)
# Re-pinned 2026-11-23 (Victor fix round): a1-execute 03-verify.md carries a second `wave checks` line (owner step), so BU2 removes the line
#   from both a1-execute files; with only 02-execute.md edited BU2 went red (rc=0 want=1), which is the RED run for the re-pin.

BU_REG="$REPO_ROOT/_shared/gates-registry.md"
BU_FILE="skills/a1-execute/workflows/02-execute.md"
bu_tree() { rm -rf "${WORK:?}/$1"; mkdir -p "$WORK/$1"; cp -R "$REPO_ROOT/skills" "$WORK/$1/skills"; }
BU_JS_WIRED='j.wired.filter(w=>w.skill==="a1-execute"&&["gate-0.7-realpath","gate-0.6-schema","test-fidelity"].includes(w.gate)).map(w=>w.gate).sort().join(",")'
BU_JS_UNWIRED='j.findings.filter(f=>f.rule==="unwired"&&f.skill==="a1-execute"&&["gate-0.7-realpath","gate-0.6-schema","test-fidelity"].includes(f.gate)).map(f=>f.gate).sort().join(",")'
BU_JS_NOPHASE='j.findings.filter(f=>f.rule==="call_without_phase"&&f.skill==="a1-execute"&&["gate-0.7-realpath","gate-0.6-schema","test-fidelity"].includes(f.gate)).map(f=>f.gate).sort().join(",")'

bu_tree bu1
run_lint --root "$WORK/bu1" --registry "$BU_REG"
check "BU1 the real tree: test-fidelity, gate-0.6-schema and gate-0.7-realpath are wired at a1-execute through the wave checks line, no unwired" 0 \
  "$BU_JS_WIRED+'/'+$BU_JS_UNWIRED" "gate-0.6-schema,gate-0.7-realpath,test-fidelity/"

bu_tree bu2
plant "$REPO_ROOT/$BU_FILE" "$WORK/bu2/$BU_FILE" 's = s.split("\n").filter(l=>!/a1-tools\.cjs wave checks/.test(l)).join("\n");'
plant "$REPO_ROOT/skills/a1-execute/workflows/03-verify.md" "$WORK/bu2/skills/a1-execute/workflows/03-verify.md" 's = s.split("\n").filter(l=>!/a1-tools\.cjs wave checks/.test(l)).join("\n");'
run_lint --root "$WORK/bu2" --registry "$BU_REG"
check "BU2 the wave checks line removed from both a1-execute files (02-execute.md and 03-verify.md): unwired for gate-0.6-schema, gate-0.7-realpath and test-fidelity at a1-execute" 1 \
  "$BU_JS_UNWIRED" "gate-0.6-schema,gate-0.7-realpath,test-fidelity"

bu_tree bu3
plant "$REPO_ROOT/$BU_FILE" "$WORK/bu3/$BU_FILE" 's = s.replace(/(a1-tools\.cjs wave checks [^\n]*?) --phase "\$PHASE"/, "$1");'
run_lint --root "$WORK/bu3" --registry "$BU_REG"
# Measured 2026-11-23: a1-execute wires `retro validate --gate-log` in 03-verify.md (fenced), so the rule fires per child gate.
check "BU3 --phase removed from the wave checks line (a1-execute wires retro validate --gate-log): call_without_phase for the three gates" 1 \
  "$BU_JS_NOPHASE" "gate-0.6-schema,gate-0.7-realpath,test-fidelity"

BU4="$(node -e '
  const a = require(process.argv[1] + "/_shared/lib/gates-lint.cjs").BUNDLES["wave checks"];
  const b = require(process.argv[1] + "/_shared/lib/wave-checks.cjs").CHILD_GATES;
  process.stdout.write(JSON.stringify(a) === JSON.stringify(b) && a.length === 3 ? "equal" : "differ:" + JSON.stringify(a) + "|" + JSON.stringify(b));' "$REPO_ROOT")"
[[ "$BU4" == "equal" ]] && ok "BU4 gates-lint BUNDLES['wave checks'] deep-equals wave-checks CHILD_GATES" || bad "BU4 ($BU4)"

# BU5 (Victor fix round, Gap 1): the deferral note "wave checks: deferred to owner" always has a consumer. A writer file that
# carries the note needs its paired owner file to hold a fenced `wave checks ... --diff-base "$PHASE_BASE"` call line.
# Measured red 2026-11-23: owner step line removed from the 03-verify.md copy -> BU5b (and BU5c for 06-verify.md).
BU5_JS='
  const fs = require("fs"), path = require("path"); const root = process.argv[1];
  const pairs = [["skills/a1-execute/workflows/02-execute.md", "skills/a1-execute/workflows/03-verify.md"],
                 ["skills/a1-new-feature/workflows/05-implement.md", "skills/a1-new-feature/workflows/06-verify.md"]];
  const bad = [];
  for (const [w, o] of pairs) {
    if (!/wave checks: deferred to owner/.test(fs.readFileSync(path.join(root, w), "utf8"))) continue;
    const hit = fs.readFileSync(path.join(root, o), "utf8").split("\n").some((l) => /a1-tools\.cjs wave checks .* --diff-base "\$PHASE_BASE" .*RC=\$\?/.test(l));
    if (!hit) bad.push(o);
  }
  process.stdout.write(bad.length ? "missing:" + bad.join(",") : "ok");'
bu_tree bu5a
[[ "$(node -e "$BU5_JS" "$WORK/bu5a" 2>&1)" == "ok" ]] && ok "BU5a real tree: every deferral note has an owner-side wave checks step" || bad "BU5a ($(node -e "$BU5_JS" "$WORK/bu5a" 2>&1))"
bu_tree bu5b
plant "$REPO_ROOT/skills/a1-execute/workflows/03-verify.md" "$WORK/bu5b/skills/a1-execute/workflows/03-verify.md" 's = s.split("\n").filter(l=>!/a1-tools\.cjs wave checks/.test(l)).join("\n");'
cp "$REPO_ROOT/skills/a1-execute/workflows/02-execute.md" "$WORK/bu5b/skills/a1-execute/workflows/02-execute.md"
[[ "$(node -e "$BU5_JS" "$WORK/bu5b" 2>&1)" == "missing:skills/a1-execute/workflows/03-verify.md" ]] && ok "BU5b owner step removed from a1-execute 03-verify.md while 02-execute.md keeps the note: flagged" || bad "BU5b ($(node -e "$BU5_JS" "$WORK/bu5b" 2>&1))"
bu_tree bu5c
plant "$REPO_ROOT/skills/a1-new-feature/workflows/06-verify.md" "$WORK/bu5c/skills/a1-new-feature/workflows/06-verify.md" 's = s.split("\n").filter(l=>!/a1-tools\.cjs wave checks/.test(l)).join("\n");'
[[ "$(node -e "$BU5_JS" "$WORK/bu5c" 2>&1)" == "missing:skills/a1-new-feature/workflows/06-verify.md" ]] && ok "BU5c owner step removed from a1-new-feature 06-verify.md while 05-implement.md keeps the note: flagged" || bad "BU5c ($(node -e "$BU5_JS" "$WORK/bu5c" 2>&1))"

# BU6 (PR B review fix round 1, SEC-2, SEC-3, R-m2): the two owner `wave checks` blocks are RUN against stubs (a1-tools.cjs and git
# on PATH, the real fenced block text from the real skills/ file). Measured red 2026-11-23 on the pre-fix files (git stash of skills/):
#   BU6a two-line value runs past the guard (rc=0)          BU6b red checks do not exit (rc=0)
#   BU6c an intent child runs the call                      (BU6d is the clean-value control: green before and after)
BU6_DIR="$WORK/bu6"; rm -rf "$BU6_DIR"; mkdir -p "$BU6_DIR/repo/_shared" "$BU6_DIR/bin"
cat > "$BU6_DIR/repo/_shared/a1-tools.cjs" <<'STUB'
require("fs").appendFileSync(process.env.BU6_LOG, process.argv.slice(2).join(" ") + "\n");
process.exit(Number(process.env.BU6_RC || 0));
STUB
printf '#!/bin/sh\necho abc123\n' > "$BU6_DIR/bin/git"; chmod +x "$BU6_DIR/bin/git"
# $1 = skills file, $2 = value for <phase_name>/<spec-id> (may hold a newline); extracts the fenced block with the owner wave checks line
bu6_block() {
  node -e '
    const fs = require("fs"); const [file, out, val, repo] = process.argv.slice(1);
    const blocks = [...fs.readFileSync(file, "utf8").matchAll(/```bash\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    const b = blocks.find((x) => /wave checks .* --diff-base "\$PHASE_BASE"/.test(x));
    if (!b) { console.error("no owner block"); process.exit(1); }
    fs.writeFileSync(out, b.split("<phase_name>").join(val).split("<spec-id>").join(val).split("<dir>").join("/work").split("<repo>").join(repo));' "$1" "$BU6_DIR/blk.sh" "$2" "$BU6_DIR/repo"
}
bu6_run() { # $1 file, $2 value, remaining env via the caller
  bu6_block "$1" "$2" || { echo "noblock"; return; }
  : > "$BU6_DIR/log"; rm -f "$BU6_DIR/PWNED"
  (cd "$BU6_DIR" && PATH="$BU6_DIR/bin:$PATH" BU6_LOG="$BU6_DIR/log" WORK_PATH=/work bash "$BU6_DIR/blk.sh" > "$BU6_DIR/out" 2>&1); echo $?
}
for BU6_F in skills/a1-execute/workflows/03-verify.md skills/a1-new-feature/workflows/06-verify.md; do
  BU6_N="$(basename "$(dirname "$(dirname "$BU6_F")")")"
  rc="$(bu6_run "$REPO_ROOT/$BU6_F" "$(printf 'ok\ntouch PWNED')")"
  [[ "$rc" == "2" && ! -s "$BU6_DIR/log" && ! -e "$BU6_DIR/PWNED" ]] && ok "BU6a $BU6_N: a value 'ok' + newline + 'touch PWNED' stops (exit 2), the stub never ran, no PWNED" || bad "BU6a $BU6_N rc=$rc log=$(cat "$BU6_DIR/log") out=$(cat "$BU6_DIR/out")"
  rc="$(bu6_run "$REPO_ROOT/$BU6_F" "$(printf 'ok\n\nA1_PHASE_EOF\nA1_SPEC_EOF\ntouch PWNED')")"
  [[ "$rc" == "2" && ! -s "$BU6_DIR/log" && ! -e "$BU6_DIR/PWNED" && -z "$(find "$BU6_DIR" -name PWNED)" ]] && ok "BU6a2 $BU6_N: an empty line then the terminators then 'touch PWNED' stops (exit 2), no PWNED" || bad "BU6a2 $BU6_N rc=$rc log=$(cat "$BU6_DIR/log") found=$(find "$BU6_DIR" -name PWNED)"
  rc="$(BU6_RC=1 bu6_run "$REPO_ROOT/$BU6_F" fx-ph)"
  [[ "$rc" == "1" ]] && grep -q 'STOP: wave checks red' "$BU6_DIR/out" && ok "BU6b $BU6_N: red wave checks (stub exit 1) ends the block with exit 1" || bad "BU6b $BU6_N rc=$rc out=$(cat "$BU6_DIR/out")"
  rc="$(A1_INTENT_CHILD=1 bu6_run "$REPO_ROOT/$BU6_F" fx-ph)"
  [[ "$rc" == "0" && ! -s "$BU6_DIR/log" ]] && grep -q 'wave checks: deferred to owner' "$BU6_DIR/out" && ok "BU6c $BU6_N: an intent child stops with the deferral note, the stub never ran" || bad "BU6c $BU6_N rc=$rc log=$(cat "$BU6_DIR/log") out=$(cat "$BU6_DIR/out")"
  rc="$(bu6_run "$REPO_ROOT/$BU6_F" fx-ph)"
  [[ "$rc" == "0" && "$(cat "$BU6_DIR/log")" == 'wave checks fx-ph 0 --diff-base abc123 --project /work --phase fx-ph' ]] && ok "BU6d $BU6_N: a clean value runs the call with the quoted variable as scope and --phase" || bad "BU6d $BU6_N rc=$rc log=$(cat "$BU6_DIR/log") out=$(cat "$BU6_DIR/out")"
done
# BU6e the backstop of the intent-child hand-off: 05-merge.md keeps its whole-diff test-fidelity scan with fail-closed exit handling.
if grep -qE 'a1-tools\.cjs test-fidelity --diff-base "\$\(git merge-base origin/<base> HEAD\)" --phase pr-<n>; RC=\$\?$' "$REPO_ROOT/skills/a1-pr-review/workflows/05-merge.md" && grep -qF 'STOP: test-fidelity exit=$RC, no merge' "$REPO_ROOT/skills/a1-pr-review/workflows/05-merge.md"; then ok "BU6e 05-merge.md keeps the whole-diff test-fidelity scan before the merge (backstop for the deferred owner step)"; else bad "BU6e 05-merge.md test-fidelity scan missing or not fail-closed"; fi
