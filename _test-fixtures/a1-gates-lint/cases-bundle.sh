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
check "BU2 the wave checks line removed from 02-execute.md: unwired for gate-0.6-schema, gate-0.7-realpath and test-fidelity at a1-execute" 1 \
  "$BU_JS_UNWIRED" "gate-0.6-schema,gate-0.7-realpath,test-fidelity"

bu_tree bu3
plant "$REPO_ROOT/$BU_FILE" "$WORK/bu3/$BU_FILE" 's = s.replace(/(a1-tools\.cjs wave checks [^\n]*?) --phase <phase_name>/, "$1");'
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
