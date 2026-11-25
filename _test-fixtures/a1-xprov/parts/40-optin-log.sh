#!/usr/bin/env bash
# Part 40 — spec 027 slice 5 (FR-032, D9): PLAN-REVIEW-LOG.md is opt-in (A1_KEEP_REVIEW_LOGS=1), the reader check, and the
# always-on self-repair trail in the observation line. Sourced by run-tests.sh. The harness exports A1_KEEP_REVIEW_LOGS=1 (every
# log assert of the other parts keeps its meaning); the default-off cases here run with the variable removed from the child env.
#   OL1  default run: no PLAN-REVIEW-LOG.md, XREVIEW.md present      OL2  with =1: the log has one entry     OL3  =yes keeps it off
#   OL4  bin/check-optin-readers.cjs on the real tree: exit 0         OL5  a planted agent line naming the file: exit 1
#   OL6  .last-run.json has readers (04b, 01-load)                    OL7  self-repair with the log off: the observation holds `recovery`
#   OL8  line-exact allowlist (an extra line in help-xprov.cjs reads) OL9  buildObservation rejects an unknown recovery action
#   OL12-OL16 allowlist contract: duplicate line, widened scan, stale entry, optin-logs.cjs itself, contains < 20
#   OL20-OL29 canonical symlink walk, root containment, unreadable paths, dead entry, relative --root, broken links, bad --root (red-making changes at the OL20 block)
#   OL10 compactRecovery is total, bounded and leaks nothing          OL11 compactRecovery keeps `fallback`
# Helpers are copied from parts 06 and 29 (a part must run alone in its shard).

mk_workdir TMP40 "a1x40"
[[ -n "$TMP40" && -d "$TMP40" ]] || { echo "FAIL  part 40: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
SAVED_HOME_40="$HOME"
export HOME="$TMP40/home"; mkdir -p "$HOME/.codex"; printf '{"fixture":true}\n' > "$HOME/.codex/auth.json"; chmod 600 "$HOME/.codex/auth.json"
LIB40="$REPO_ROOT/_shared/lib"; CHECK40="$REPO_ROOT/bin/check-optin-readers.cjs"
ARGV40_DIR="$TMP40/argv"; mkdir -p "$ARGV40_DIR"; ARGV40_N=0
NET40='{"FAKE_RUNNER_CODEX_STDOUT":"net-disconnect"}'
OK40='{"FAKE_RUNNER_CASE":"approved"}'

pin40() {
  node -e '
    const fs = require("fs"); const file = process.argv[1]; const ids = ["plan-review-xprov"];
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").split("\n").map((l) => (ids.some((id) => l.startsWith("| `" + id + "` |")) ? l.replace(/\| (warning|blocking) \|/, "| warning |") : l)).join("\n"));
  ' "$TREE/_shared/gates-registry.md" || bad "pin40: could not pin the registry copy"
}
prep40() {
  make_tree; pin40; make_phase p40 "$CASES/approved.PLAN.md"
  rm -rf "$HOME/.a1-xprov"; write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md
  make_home; export A1_XPROV_CODEX_HOME="$XHOME"
  node "$TREE_TOOLS" xprov init-home >/dev/null 2>&1 </dev/null
  ln -s "$HOME/.codex/auth.json" "$XHOME/auth.json"
  printf '## Wave 1 — one\n' > "$PHASE_DIR/STATUS.md"
}
# gate40 <keep: unset|<value>> <seq-json> [flags…] — one gate run; the child env has A1_KEEP_REVIEW_LOGS removed or set to <keep>
gate40() {
  local keep="$1" seq="$2"; shift 2
  local envargs=(-u A1_KEEP_REVIEW_LOGS); [[ "$keep" != unset ]] && envargs=("A1_KEEP_REVIEW_LOGS=$keep")
  ARGV40_N=$((ARGV40_N + 1)); rm -f "$TMP40/count"
  FAKE_RUNNER_ARGV_FILE="$ARGV40_DIR/argv-$ARGV40_N.json" FAKE_RUNNER_COUNT_FILE="$TMP40/count" FAKE_RUNNER_SEQUENCE="$seq" FAKE_RUNNER_CASE=approved fake_runner_env
  G_OUT="$(cd "$PHASE_REPO" && env "${envargs[@]}" node "$TREE_TOOLS" xprov gate --phase p40 --timeout 7 "$@" 2>"$TMP40/err.txt" </dev/null)"; G_RC=$?; G_ERR="$(cat "$TMP40/err.txt")"
}
logs40() { ls "$PHASE_DIR" | grep -c '^PLAN-REVIEW-LOG.md$'; }

# OL1-OL3
prep40; gate40 unset "[$OK40]" --gate "$GATE_PLAN"
assert_rc "OL1 default run passes" 0 "$G_RC" "$G_ERR"
[[ "$(logs40)" == 0 && -f "$PHASE_DIR/XREVIEW.md" ]] && ok "OL1 no PLAN-REVIEW-LOG.md, XREVIEW.md present" || bad "OL1 log=$(logs40) XREVIEW=$([[ -f "$PHASE_DIR/XREVIEW.md" ]] && echo yes || echo no)"
prep40; gate40 1 "[$OK40]" --gate "$GATE_PLAN"
[[ "$(logs40)" == 1 && "$(grep -c '^## gate ' "$PHASE_DIR/PLAN-REVIEW-LOG.md")" == 1 ]] && ok "OL2 with A1_KEEP_REVIEW_LOGS=1 the log holds one entry" || bad "OL2 log=$(logs40)"
prep40; gate40 yes "[$OK40]" --gate "$GATE_PLAN"
[[ "$(logs40)" == 0 ]] && ok "OL3 A1_KEEP_REVIEW_LOGS=yes keeps the log off" || bad "OL3 the log was written for the value yes"

# OL4-OL6, OL8: the reader check
node "$CHECK40" --name PLAN-REVIEW-LOG.md > "$TMP40/rd.json" 2>"$TMP40/rd.err"; assert_rc "OL4 check-optin-readers: no reader of PLAN-REVIEW-LOG.md on the real tree" 0 "$?" "$(head -c 400 "$TMP40/rd.json")"
cp_tree40() { local d="$1"; mkdir -p "$d/skills" "$d/agents" "$d/_shared" "$d/bin" "$d/hooks"; cp -R "$REPO_ROOT/skills/." "$d/skills/"; cp -R "$REPO_ROOT/agents/." "$d/agents/"; cp -R "$REPO_ROOT/_shared/lib" "$d/_shared/lib"; cp "$REPO_ROOT/_shared/a1-tools.cjs" "$d/_shared/a1-tools.cjs"; cp -R "$REPO_ROOT/bin/." "$d/bin/"; cp -R "$REPO_ROOT/hooks/." "$d/hooks/"; }
cp_tree40 "$TMP40/plant1"; af40="$(ls "$TMP40/plant1/agents"/*.md | head -1)"; printf 'Read PLAN-REVIEW-LOG.md for the history.\n' >> "$af40"
node "$CHECK40" --name PLAN-REVIEW-LOG.md --root "$TMP40/plant1" > "$TMP40/rd5.json" 2>/dev/null; rc40=$?
assert_rc "OL5 a planted agent line naming the file" 1 "$rc40"
assert_json "OL5 readers[0].file is the planted agent" "$(cat "$TMP40/rd5.json")" "j.readers[0].file" "agents/$(basename "$af40")"
node "$CHECK40" --name .last-run.json > "$TMP40/rd6.json" 2>/dev/null; rc40=$?
assert_rc "OL6 .last-run.json has readers" 1 "$rc40"
assert_json "OL6 readers include 04b and 01-load" "$(cat "$TMP40/rd6.json")" "['skills/a1-plan/workflows/04b-xprov-review.md','skills/a1-execute/workflows/01-load.md'].every((f) => j.readers.some((r) => r.file === f))" "true"
cp_tree40 "$TMP40/plant2"; printf '// extra: PLAN-REVIEW-LOG.md is read here\n' >> "$TMP40/plant2/_shared/lib/help-xprov.cjs"
node "$CHECK40" --name PLAN-REVIEW-LOG.md --root "$TMP40/plant2" > "$TMP40/rd8.json" 2>/dev/null; rc40=$?
assert_rc "OL8 an extra mention line in help-xprov.cjs is a reader (line-exact allowlist)" 1 "$rc40"
assert_json "OL8 readers[0].file is _shared/lib/help-xprov.cjs" "$(cat "$TMP40/rd8.json")" "j.readers[0].file" "_shared/lib/help-xprov.cjs"
node "$CHECK40" >/dev/null 2>&1; assert_rc "OL4 usage: no --name is exit 2" 2 "$?"

# OL12-OL16: the allowlist contract (bug 2026-11-25-optin-allowlist-contract, audit F-002)
OLNAME40=PLAN-REVIEW-LOG.md
# run40 <root> <tag> — one check run on a planted copy; sets rc40 and $TMP40/<tag>.json
run40() { node "$CHECK40" --name "$OLNAME40" --root "$1" > "$TMP40/$2.json" 2>/dev/null; rc40=$?; }
# OL12: a second line holding an allowed `contains` is a reader (1:1 count)
cp_tree40 "$TMP40/plant12"; printf "const x = readFileSync(dir + 'PLAN-REVIEW-LOG.md'); // a1 writes PLAN-REVIEW-LOG.md itself\n" >> "$TMP40/plant12/_shared/lib/xprov-run.cjs"
run40 "$TMP40/plant12" rd12; assert_rc "OL12 a duplicate line holding an allowed contains is a reader" 1 "$rc40"
assert_json "OL12 exactly one reader, in xprov-run.cjs" "$(cat "$TMP40/rd12.json")" "j.readers.length + '|' + j.readers[0].file" "1|_shared/lib/xprov-run.cjs"
cp_tree40 "$TMP40/plant12b"; printf '// a1 writes PLAN-REVIEW-LOG.md itself\n' >> "$TMP40/plant12b/_shared/lib/xprov-run.cjs"
run40 "$TMP40/plant12b" rd12b; assert_rc "OL12b an exact duplicate of an allowed line is a reader" 1 "$rc40"
assert_json "OL12b the reader names the line that took the entry (duplicate_of)" "$(cat "$TMP40/rd12b.json")" "typeof j.readers[0].duplicate_of + '|' + (j.readers[0].duplicate_of < j.readers[0].line)" "number|true"
# OL13: a reader is found in every scanned root and extension (SCAN_ROOTS x SCAN_EXTS), through in-root symlinks, and in an executable without extension
# (bug 2026-11-25-optin-checker-symlinks-4: the followed-symlink targets are inside the root; an outside link is unscanned, see OL22)
cp_tree40 "$TMP40/plant13"; P13="$TMP40/plant13"
mkdir -p "$P13/skills/a1-plan/scripts" "$P13/_extras/x" "$P13/_extras/linktarget" "$P13/.github/workflows" "$P13/packs" "$TMP40/outside13" "$P13/_shared/vendor" "$P13/_shared/node_modules"
LINE13='cat PLAN-REVIEW-LOG.md'
PLANTED13="_shared/a1-tools.cjs bin/run-suites.sh hooks/xprov-consent-hook.cjs hooks/hooks.json skills/a1-plan/scripts/plant.sh _shared/lib/plant.js _shared/lib/plant.mjs packs/README.md _extras/x/plant.yml .github/workflows/plant.yaml bin/plant.toml bin/plant.html bin/plant.plist bin/plant-exec _extras/linktarget/plant.md packs/real13.md"
for f13 in _shared/a1-tools.cjs bin/run-suites.sh hooks/xprov-consent-hook.cjs hooks/hooks.json skills/a1-plan/scripts/plant.sh _shared/lib/plant.js _shared/lib/plant.mjs packs/README.md _extras/x/plant.yml .github/workflows/plant.yaml bin/plant.toml bin/plant.html bin/plant.plist bin/plant-exec _extras/linktarget/plant.md packs/real13.md; do printf '%s\n' "$LINE13" >> "$P13/$f13"; done
chmod +x "$P13/bin/plant-exec"
printf '%s\n' "$LINE13" > "$TMP40/outside13/plant.md"; ln -s ../_extras/linktarget "$P13/skills/linkdir"; ln -s ../packs/real13.md "$P13/agents/linkfile.md"; ln -s .. "$P13/skills/loop13"
ln -s "$TMP40/outside13" "$P13/skills/outlink13"; ln -s "$TMP40/outside13/plant.md" "$P13/agents/outfile13.md"
printf '%s\n' "$LINE13" > "$P13/_shared/vendor/skip.md"; printf '%s\n' "$LINE13" > "$P13/_shared/node_modules/skip.md"; printf '%s\n' "$LINE13" > "$P13/bin/plain.txt"
run40 "$P13" rd13; assert_rc "OL13 planted readers in every root and extension" 1 "$rc40"
for f13 in $PLANTED13; do assert_json "OL13 $f13 is reported" "$(cat "$TMP40/rd13.json")" "j.readers.some((r) => r.file === '$f13')" "true"; done
assert_json "OL13 exactly the 16 planted readers (every real file once, under its canonical path)" "$(cat "$TMP40/rd13.json")" "j.readers.length + '|' + j.readers.map((r) => r.file).sort().join(',') === '16|' + '$PLANTED13'.split(' ').sort().join(',')" "true"
assert_json "OL13 no reader path goes through the loop link, a followed link or an outside link" "$(cat "$TMP40/rd13.json")" "j.readers.some((r) => /loop13|linkdir|linkfile|outlink13|outfile13|outside13/.test(r.file))" "false"
assert_json "OL13 no reader under vendor/ or node_modules/ and none from the .txt file" "$(cat "$TMP40/rd13.json")" "j.readers.some((r) => /\/vendor\/|node_modules\/|plain\.txt/.test(r.file))" "false"
assert_json "OL13 the two outside links are unscanned ('outside root'), nothing else is" "$(cat "$TMP40/rd13.json")" "JSON.stringify(j.unscanned.map((u) => u.file + ':' + u.reason).sort())" '["agents/outfile13.md:outside root","skills/outlink13:outside root"]'
# OL14: an entry that matches no line is stale
cp_tree40 "$TMP40/plant14"; node -e '
  const fs = require("fs"); const f = process.argv[1];
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").split("\n").filter((l) => !l.includes("a1 writes PLAN-REVIEW-LOG.md itself") || l.includes("entry(")).join("\n"));
' "$TMP40/plant14/_shared/lib/xprov-run.cjs"
run40 "$TMP40/plant14" rd14; assert_rc "OL14 a stale allowlist entry fails the check" 1 "$rc40"
assert_json "OL14 stale lists the entry and readers is empty" "$(cat "$TMP40/rd14.json")" "j.stale.length + '|' + j.stale[0].file + '|' + j.readers.length" "1|_shared/lib/xprov-run.cjs|0"
# OL15: a reader line inside optin-logs.cjs is found (no whole-file skip); the definition lines stay allowed
cp_tree40 "$TMP40/plant15"; printf "// read PLAN-REVIEW-LOG.md here\n" >> "$TMP40/plant15/_shared/lib/optin-logs.cjs"
run40 "$TMP40/plant15" rd15; assert_rc "OL15 a reader line in optin-logs.cjs" 1 "$rc40"
assert_json "OL15 exactly one reader, in optin-logs.cjs" "$(cat "$TMP40/rd15.json")" "j.readers.length + '|' + j.readers[0].file" "1|_shared/lib/optin-logs.cjs"
# OL16: a contains shorter than 20 characters is a contract violation
cp_tree40 "$TMP40/plant16"; node -e '
  const fs = require("fs"); const f = process.argv[1];
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("a1 writes PLAN-REVIEW-LOG.md itself", "PLAN-REVIEW-LOG.md"));
' "$TMP40/plant16/_shared/lib/optin-logs.cjs"
run40 "$TMP40/plant16" rd16; assert_rc "OL16 a contains under 20 characters fails the check" 1 "$rc40"
assert_json "OL16 one contract violation" "$(cat "$TMP40/rd16.json")" "j.contract_violations.length" "1"
# OL15b-d: only the full canonical definition line is exempt; a reader behind an entry( or OPTIN_FILES prefix is found
cp_tree40 "$TMP40/plant15b"; printf "entry('x', 'y', 'z'); function loadLog() { return require('fs').readFileSync('PLAN-REVIEW-LOG.md'); }\n" >> "$TMP40/plant15b/_shared/lib/optin-logs.cjs"
run40 "$TMP40/plant15b" rd15b; assert_rc "OL15b a reader after an entry( prefix" 1 "$rc40"
assert_json "OL15b one reader in optin-logs.cjs" "$(cat "$TMP40/rd15b.json")" "j.readers.length + '|' + j.readers[0].file" "1|_shared/lib/optin-logs.cjs"
cp_tree40 "$TMP40/plant15c"; node -e '
  const fs = require("fs"); const f = process.argv[1];
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("Object.freeze([\x27PLAN-REVIEW-LOG.md\x27]);", "Object.freeze([\x27PLAN-REVIEW-LOG.md\x27]); function loadLog() { return require(\x27fs\x27).readFileSync(\x27PLAN-REVIEW-LOG.md\x27); }"));
' "$TMP40/plant15c/_shared/lib/optin-logs.cjs"
run40 "$TMP40/plant15c" rd15c; assert_rc "OL15c a reader after an OPTIN_FILES prefix" 1 "$rc40"
assert_json "OL15c one reader in optin-logs.cjs" "$(cat "$TMP40/rd15c.json")" "j.readers.length + '|' + j.readers[0].file" "1|_shared/lib/optin-logs.cjs"
cp_tree40 "$TMP40/plant15d"; node -e '
  const fs = require("fs"); const f = process.argv[1];
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("]);\n\nmodule.exports", "  entry(\x27skills/a1-plan/SKILL.md\x27, \x27PLAN-REVIEW-LOG.md reader\x27, require(\x27fs\x27).existsSync(\x27x\x27) ? \x27a\x27 : \x27b\x27),\n]);\n\nmodule.exports"));
' "$TMP40/plant15d/_shared/lib/optin-logs.cjs"
run40 "$TMP40/plant15d" rd15d; assert_rc "OL15d an entry( line that calls code" 1 "$rc40"
assert_json "OL15d one reader in optin-logs.cjs" "$(cat "$TMP40/rd15d.json")" "j.readers.length + '|' + j.readers[0].file" "1|_shared/lib/optin-logs.cjs"
cp_tree40 "$TMP40/plant15e"; printf "/*\n  entry('skills/a1-plan/SKILL.md', 'never loaded entry text', 'PLAN-REVIEW-LOG.md'),\n*/\n" >> "$TMP40/plant15e/_shared/lib/optin-logs.cjs"
run40 "$TMP40/plant15e" rd15e; assert_rc "OL15e a canonical-looking entry( line that is not a loaded entry" 1 "$rc40"
assert_json "OL15e one reader in optin-logs.cjs" "$(cat "$TMP40/rd15e.json")" "j.readers.length + '|' + j.readers[0].file" "1|_shared/lib/optin-logs.cjs"
ENTRYLINE40="  entry('_shared/lib/xprov-run.cjs', 'a1 writes PLAN-REVIEW-LOG.md itself', 'writer comment'),"
# swap40 <tag> <from> <to> — copy the tree, replace the first occurrence of <from> in its optin-logs.cjs
swap40() { cp_tree40 "$TMP40/$1"; node -e '
  const fs = require("fs"); const f = process.argv[1]; const s = fs.readFileSync(f, "utf8");
  if (!s.includes(process.argv[2])) { console.error("swap40: pattern missing"); process.exit(3); }
  fs.writeFileSync(f, s.replace(process.argv[2], () => process.argv[3]));
' "$TMP40/$1/_shared/lib/optin-logs.cjs" "$2" "$3" || bad "swap40 $1: pattern missing"; }
swap40 plant15f "$ENTRYLINE40" "$ENTRYLINE40 // reads PLAN-REVIEW-LOG.md here"
run40 "$TMP40/plant15f" rd15f; assert_rc "OL15f a reader after a full canonical entry( line" 1 "$rc40"
assert_json "OL15f one reader in optin-logs.cjs" "$(cat "$TMP40/rd15f.json")" "j.readers.length + '|' + j.readers[0].file" "1|_shared/lib/optin-logs.cjs"
swap40 plant15g "$ENTRYLINE40" "  /* PLAN-REVIEW-LOG.md */ ${ENTRYLINE40#  }"
run40 "$TMP40/plant15g" rd15g; assert_rc "OL15g a reader before a canonical entry( line" 1 "$rc40"
assert_json "OL15g one reader in optin-logs.cjs" "$(cat "$TMP40/rd15g.json")" "j.readers.length + '|' + j.readers[0].file" "1|_shared/lib/optin-logs.cjs"
cp_tree40 "$TMP40/plant15h"; printf "/*\nconst OPTIN_FILES = Object.freeze(['PLAN-REVIEW-LOG.md', 'ELSE.md']);\n*/\n" >> "$TMP40/plant15h/_shared/lib/optin-logs.cjs"
run40 "$TMP40/plant15h" rd15h; assert_rc "OL15h an OPTIN_FILES line whose value is not the loaded one" 1 "$rc40"
assert_json "OL15h one reader in optin-logs.cjs" "$(cat "$TMP40/rd15h.json")" "j.readers.length + '|' + j.readers[0].file" "1|_shared/lib/optin-logs.cjs"
# OL16b: the length boundary is exactly 20
cp_tree40 "$TMP40/plant16b"; node -e '
  const fs = require("fs"); const f = process.argv[1];
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("a1 writes PLAN-REVIEW-LOG.md itself", process.argv[2]));
' "$TMP40/plant16b/_shared/lib/optin-logs.cjs" "xPLAN-REVIEW-LOG.md"
run40 "$TMP40/plant16b" rd16b; assert_json "OL16b 19 characters: one contract violation" "$(cat "$TMP40/rd16b.json")" "j.contract_violations.length" "1"
cp_tree40 "$TMP40/plant16c"; node -e '
  const fs = require("fs"); const f = process.argv[1];
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("a1 writes PLAN-REVIEW-LOG.md itself", process.argv[2]));
' "$TMP40/plant16c/_shared/lib/optin-logs.cjs" "xxPLAN-REVIEW-LOG.md"
run40 "$TMP40/plant16c" rd16c; assert_json "OL16b 20 characters: no contract violation" "$(cat "$TMP40/rd16c.json")" "j.contract_violations.length" "0"
# OL17: a reader appended to an allowed line does not hide behind the entry (every occurrence of the name lies inside the contains span)
cp_tree40 "$TMP40/plant17"; node -e '
  const fs = require("fs"); const f = process.argv[1];
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").split("\n").map((l) => (l.includes("a1 writes PLAN-REVIEW-LOG.md itself") && !l.includes("entry(") ? l + " readFileSync(\"PLAN-REVIEW-LOG.md\");" : l)).join("\n"));
' "$TMP40/plant17/_shared/lib/xprov-run.cjs"
run40 "$TMP40/plant17" rd17; assert_rc "OL17 a reader appended to an allowed line" 1 "$rc40"
assert_json "OL17 that line is a reader" "$(cat "$TMP40/rd17.json")" "j.readers.length + '|' + j.readers[0].file" "1|_shared/lib/xprov-run.cjs"
# OL18: a second OPTIN_FILES name does not make the entries of the first stale (and the other way round)
cp_tree40 "$TMP40/plant18"; node -e '
  const fs = require("fs"); const f = process.argv[1];
  const src = fs.readFileSync(f, "utf8")
    .replace("Object.freeze([\x27PLAN-REVIEW-LOG.md\x27])", "Object.freeze([\x27PLAN-REVIEW-LOG.md\x27, \x27OTHER-LOG.md\x27])")
    .replace("]);\n\nmodule.exports", "  entry(\x27skills/a1-plan/SKILL.md\x27, \x27a note about OTHER-LOG.md here\x27, \x27second name\x27),\n]);\n\nmodule.exports");
  fs.writeFileSync(f, src);
' "$TMP40/plant18/_shared/lib/optin-logs.cjs"
printf 'a note about OTHER-LOG.md here\n' >> "$TMP40/plant18/skills/a1-plan/SKILL.md"
run40 "$TMP40/plant18" rd18; assert_json "OL18 first name: rc 0 and no stale entry" "$(cat "$TMP40/rd18.json")" "j.readers.length + '|' + j.stale.length" "0|0"; assert_rc "OL18 first name exits 0" 0 "$rc40"
node "$CHECK40" --name OTHER-LOG.md --root "$TMP40/plant18" > "$TMP40/rd18b.json" 2>/dev/null; rc40=$?
assert_rc "OL18 second name exits 0" 0 "$rc40"; assert_json "OL18 second name: no reader, no stale" "$(cat "$TMP40/rd18b.json")" "j.readers.length + '|' + j.stale.length" "0|0"
# OL19: the loaded allowlist is validated (exit 2) and the JSON names which one was used
for v19 in "a|OPTIN_FILES: ['PLAN-REVIEW-LOG.md'], MENTIONS_ALLOWED: {}" "b|OPTIN_FILES: 'PLAN-REVIEW-LOG.md', MENTIONS_ALLOWED: []" "c|OPTIN_FILES: [], MENTIONS_ALLOWED: [null]"; do
  cp_tree40 "$TMP40/plant19${v19%%|*}"; printf "module.exports = { %s };\n" "${v19#*|}" > "$TMP40/plant19${v19%%|*}/_shared/lib/optin-logs.cjs"
  run40 "$TMP40/plant19${v19%%|*}" rd19; assert_rc "OL19${v19%%|*} a malformed allowlist module is exit 2" 2 "$rc40"
done
cp_tree40 "$TMP40/plant19b"; rm -f "$TMP40/plant19b/_shared/lib/optin-logs.cjs"
run40 "$TMP40/plant19b" rd19b; assert_json "OL19 a root without optin-logs.cjs uses the fallback" "$(cat "$TMP40/rd19b.json")" "j.allowlist" "fallback"
assert_json "OL19 the real tree uses the root allowlist" "$(cat "$TMP40/rd.json")" "j.allowlist" "root"
# OL20-OL29: canonical symlink walk, root containment, unreadable paths, dead entries, broken links, bad --root (bug 2026-11-25-optin-checker-symlinks-4).
# Each case names the one production change that turns it red (CONVENTIONS RED proof); every one was run on a git archive copy.
#   OL20 (parent link): dropping the `SCAN_ROOTS.includes(canon.split('/')[0])` test in visit(): the link to the root walks docs/ (a reader
#        outside the scanned roots, under skills/up/). OL13 loop13 is the same link in the big plant.
#   OL21 (harmless alias): the global set of visited real paths (`ctx.visited`) replaced by an ancestor chain: the aliased lib is read
#        again under bin/libalias/ (22 false readers on the clean tree; OL13 also goes red: it counts every real file once).
#   OL22 (link out of the root): dropping the `isOutside(canon)` branch (the link is no longer listed; with the SCAN_ROOTS test also gone the
#        foreign tree is walked and its reader is reported); dropping `+ result.unscanned.length` from the exit-code sum in finish() gives rc 0
#        although the link was never scanned (decision D1).
#   OL23 (unreadable dir / file): removing the try/catch around readdirSync (23a) or readFileSync (23b): stack on stderr, rc 1, no JSON.
#   OL24 (dead entry): removing the `names no OPTIN_FILES entry` test in contractViolations: rc 0, no violation.
#   OL25 (relative --root): dropping path.resolve(--root): exit 2 (module not found).
#   OL26 (dangling links, nested and as a top-level scan root): classifying every realpath failure as 'unreadable' (the reason is no
#        longer 'broken symlink').
#   OL27 (--root is a file): dropping the `isDirectory()` check in listFiles(): rc 1 (every scan root listed unreadable) instead of exit 2.
#   OL28 (a file under a read-only dir): the old catch labelling every realpath failure 'broken symlink' (EACCES is 'unreadable').
#   OL29 (root without access): the per-scan-root lstat catch skipping every error (`continue` without the ENOENT test): rc 0, nothing scanned.
# OL20: a link to the parent directory: the tree is read once, under its own paths
cp_tree40 "$TMP40/plant20"; mkdir "$TMP40/plant20/docs"; printf 'cat PLAN-REVIEW-LOG.md\n' > "$TMP40/plant20/docs/notes.md"; printf 'Read PLAN-REVIEW-LOG.md for the history.\n' >> "$TMP40/plant20/agents/$(basename "$af40")"; ln -s .. "$TMP40/plant20/skills/up"
run40 "$TMP40/plant20" rd20; assert_rc "OL20 a parent link plus one real reader" 1 "$rc40"
assert_json "OL20 exactly one reader, in agents/ (docs/ is no scanned root), none under skills/up/" "$(cat "$TMP40/rd20.json")" "j.readers.length + '|' + j.readers.some((r) => r.file.startsWith('skills/up/'))" "1|false"
# OL21: a harmless alias of a scanned directory in a clean tree: no reader, rc 0
cp_tree40 "$TMP40/plant21"; ln -s ../_shared/lib "$TMP40/plant21/bin/libalias"
run40 "$TMP40/plant21" rd21; assert_rc "OL21 an alias of _shared/lib in a clean tree" 0 "$rc40"
assert_json "OL21 no reader, nothing unscanned" "$(cat "$TMP40/rd21.json")" "j.readers.length + '|' + j.unscanned.length" "0|0"
# OL22: a link out of the root: not walked, listed as unscanned, rc 1 (D1) although no reader exists
cp_tree40 "$TMP40/plant22"; mkdir -p "$TMP40/outside22/.hidden"; printf 'cat PLAN-REVIEW-LOG.md\n' > "$TMP40/outside22/plant.md"; printf 'cat PLAN-REVIEW-LOG.md\n' > "$TMP40/outside22/.hidden/h.md"; ln -s "$TMP40/outside22" "$TMP40/plant22/skills/home"
run40 "$TMP40/plant22" rd22; assert_rc "OL22 a link out of the root is unscanned and fails the check (D1)" 1 "$rc40"
assert_json "OL22 unscanned is the link with reason 'outside root'" "$(cat "$TMP40/rd22.json")" "JSON.stringify(j.unscanned)" '[{"file":"skills/home","reason":"outside root"}]'
assert_json "OL22 no reader under or through the link" "$(cat "$TMP40/rd22.json")" "j.readers.length" "0"
# OL23: an unreadable directory / file: JSON on stdout, unscanned 'unreadable', no stack (skipped as uid 0: root reads everything)
if [[ "$(id -u)" == 0 ]]; then echo "SKIP  OL23 unreadable paths (running as uid 0)"; else
  cp_tree40 "$TMP40/plant23a"; mkdir "$TMP40/plant23a/agents/locked"; printf 'cat PLAN-REVIEW-LOG.md\n' > "$TMP40/plant23a/agents/locked/x.md"; chmod 000 "$TMP40/plant23a/agents/locked"
  node "$CHECK40" --name "$OLNAME40" --root "$TMP40/plant23a" > "$TMP40/rd23a.json" 2>"$TMP40/rd23a.err"; rc40=$?; chmod 755 "$TMP40/plant23a/agents/locked"
  assert_rc "OL23a an unreadable directory fails the check with JSON, not a crash" 1 "$rc40"
  assert_json "OL23a unscanned names the directory as unreadable" "$(cat "$TMP40/rd23a.json")" "JSON.stringify(j.unscanned)" '[{"file":"agents/locked","reason":"unreadable"}]'
  assert_eq "OL23a no stack on stderr" "$(grep -c 'EACCES\|    at ' "$TMP40/rd23a.err")" "0"
  cp_tree40 "$TMP40/plant23b"; printf 'cat PLAN-REVIEW-LOG.md\n' > "$TMP40/plant23b/bin/locked.sh"; chmod 000 "$TMP40/plant23b/bin/locked.sh"
  node "$CHECK40" --name "$OLNAME40" --root "$TMP40/plant23b" > "$TMP40/rd23b.json" 2>"$TMP40/rd23b.err"; rc40=$?; chmod 644 "$TMP40/plant23b/bin/locked.sh"
  assert_rc "OL23b an unreadable file fails the check with JSON, not a crash" 1 "$rc40"
  assert_json "OL23b unscanned names the file as unreadable" "$(cat "$TMP40/rd23b.json")" "JSON.stringify(j.unscanned)" '[{"file":"bin/locked.sh","reason":"unreadable"}]'
  assert_eq "OL23b no stack on stderr" "$(grep -c 'EACCES\|    at ' "$TMP40/rd23b.err")" "0"
fi
# OL24: an entry whose contains names no OPTIN_FILES entry (a misspelling) is a contract violation, not a silently dead entry
cp_tree40 "$TMP40/plant24"; for f24 in _shared/lib/optin-logs.cjs _shared/lib/xprov-run.cjs; do node -e '
  const fs = require("fs"); const f = process.argv[1];
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").split("a1 writes PLAN-REVIEW-LOG.md itself").join("a1 writes PLAN-REVEIW-LOG.md itself"));
' "$TMP40/plant24/$f24"; done
run40 "$TMP40/plant24" rd24; assert_rc "OL24 a dead allowlist entry fails the check" 1 "$rc40"
assert_json "OL24 one contract violation naming the entry" "$(cat "$TMP40/rd24.json")" "j.contract_violations.length + '|' + j.contract_violations[0].reason" "1|contains names no OPTIN_FILES entry"
# OL25: a relative --root works (resolved against the cwd)
cp_tree40 "$TMP40/plant25"; ( cd "$TMP40" && node "$CHECK40" --name "$OLNAME40" --root plant25 > "$TMP40/rd25.json" 2>/dev/null ); rc40=$?
assert_rc "OL25 a relative --root" 0 "$rc40"
# OL26: a dangling link inside a scanned root and a dangling top-level scan root: both unscanned 'broken symlink'
cp_tree40 "$TMP40/plant26"; ln -s nowhere26.md "$TMP40/plant26/agents/dang.md"; rm -rf "$TMP40/plant26/hooks"; ln -s nowhere26 "$TMP40/plant26/hooks"
run40 "$TMP40/plant26" rd26; assert_rc "OL26 dangling links fail the check (D1)" 1 "$rc40"
assert_json "OL26 unscanned: exactly the two links, 'broken symlink'" "$(cat "$TMP40/rd26.json")" "JSON.stringify(j.unscanned.map((u) => u.file + ':' + u.reason).sort())" '["agents/dang.md:broken symlink","hooks:broken symlink"]'
# OL27: --root pointing to a file is a usage error (exit 2), never a clean scan of nothing
printf 'x\n' > "$TMP40/rootfile27"; node "$CHECK40" --name "$OLNAME40" --root "$TMP40/rootfile27" >/dev/null 2>&1; assert_rc "OL27 --root is a file" 2 "$?"
if [[ "$(id -u)" == 0 ]]; then echo "SKIP  OL28/OL29 access cases (running as uid 0)"; else
  # OL28: a path that cannot be resolved because the directory has no x bit is 'unreadable', not a broken link
  cp_tree40 "$TMP40/plant28"; mkdir "$TMP40/plant28/agents/ro"; printf 'cat PLAN-REVIEW-LOG.md\n' > "$TMP40/plant28/agents/ro/x.md"; chmod 444 "$TMP40/plant28/agents/ro"
  run40 "$TMP40/plant28" rd28; chmod 755 "$TMP40/plant28/agents/ro"
  assert_rc "OL28 a file under a read-only directory fails the check" 1 "$rc40"
  assert_json "OL28 unscanned: that file, 'unreadable'" "$(cat "$TMP40/rd28.json")" "JSON.stringify(j.unscanned)" '[{"file":"agents/ro/x.md","reason":"unreadable"}]'
  # OL29: a root without access (mode 000): every scan root is unscanned 'unreadable', rc 1
  cp_tree40 "$TMP40/plant29"; chmod 000 "$TMP40/plant29"
  run40 "$TMP40/plant29" rd29; chmod 755 "$TMP40/plant29"
  assert_rc "OL29 a root without access fails the check" 1 "$rc40"
  assert_json "OL29 every present scan root is unscanned 'unreadable'" "$(cat "$TMP40/rd29.json")" "j.unscanned.length > 0 && j.unscanned.every((u) => u.reason === 'unreadable') && j.readers.length === 0" "true"
fi
# OL4b: the real tree reports no stale entry and no violation
assert_json "OL4 real tree: stale and contract_violations are empty" "$(cat "$TMP40/rd.json")" "j.stale.length + '|' + j.contract_violations.length" "0|0"

# OL7: self-repair with the log off — the observation line carries `recovery`, no log file is written
prep40; gate40 unset "[$NET40,$OK40]" --gate "$GATE_PLAN"
[[ "$(logs40)" == 0 ]] && ok "OL7 no PLAN-REVIEW-LOG.md after a self-repair with the log off" || bad "OL7 the log exists after a repair"
last40="$(tail -n 1 "$PHASE_DIR/observations.jsonl" 2>/dev/null)"
assert_json "OL7 the last observation line: recovered true, recovery[0] = runner_retry ok attempts 2" "${last40:-null}" "[j.recovered, JSON.stringify(j.recovery && j.recovery[0])].join('|')" 'true|{"action":"runner_retry","ok":true,"attempts":2}'
assert_json "OL7 the line holds no cause and no error text" "${last40:-null}" "/cause|net-disconnect|error sending/i.test(JSON.stringify(j.recovery)) ? 'leak' : 'clean'" "clean"

# OL9-OL11: the observe side (static, real tree)
OBS40='const O = require(process.argv[1] + "/xprov-observe.cjs"); const base = { agent: "xprov-codex", skill: "a1-plan", phase: "p", wave: null, type: "gap", severity: "minor", msg: "m", provider: "codex" };'
out="$(node -e "$OBS40"' try { O.buildObservation({ ...base, recovered: true, recovery: [{ action: "x", ok: true }] }); console.log("no throw"); } catch (e) { console.log(e.code); }' "$LIB40" 2>&1)"
assert_eq "OL9 an unknown recovery action throws A1_INPUT" "$out" "A1_INPUT"
out="$(node -e "$OBS40"'
  const hostile = [{ action: "x" }, { action: "runner_retry", ok: "yes", attempts: new Array(50), cause: "secret" }, { action: "preflight_repair", ok: false, refused: "/etc", actions: [] }];
  for (let i = 0; i < 9; i++) hostile.push({ action: "base_recomputed", ok: true, from: "secret", to: "/etc" });
  const r = []; r.push(JSON.stringify(O.compactRecovery("nope"))); const c = O.compactRecovery(hostile); const j = JSON.stringify(c);
  r.push(c.length <= 8, c.every((i) => Object.keys(i).every((k) => ["action", "ok", "attempts", "fallback"].includes(k))), c.every((i) => i.attempts === undefined || i.attempts <= 9), !j.includes("secret") && !j.includes("/etc"));
  try { O.buildObservation({ ...base, recovered: true, recovery: c }); r.push("built"); } catch (e) { r.push("threw " + e.message); }
  console.log(r.join("|"));' "$LIB40" 2>&1)"
assert_eq "OL10 compactRecovery on hostile input: total, at most 8 items, only the four keys, attempts <= 9, no leak, accepted by buildObservation" "$out" "[]|true|true|true|true|built"
out="$(node -e "$OBS40"' const c = O.compactRecovery([{ action: "blocked_retry", ok: true, fallback: true }]); const o = O.buildObservation({ ...base, recovered: true, recovery: c }); console.log(JSON.stringify(c) + "|" + JSON.stringify(o.recovery));' "$LIB40" 2>&1)"
assert_eq "OL11 compactRecovery keeps fallback and buildObservation stores it unchanged" "$out" '[{"action":"blocked_retry","ok":true,"fallback":true}]|[{"action":"blocked_retry","ok":true,"fallback":true}]'

export HOME="$SAVED_HOME_40"
rm -rf "$TMP40"
