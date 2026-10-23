# parts/03-merge-guard.sh — spec 020 Wave 3: `pr merge-check` blocks changes to .a1/live-probes.yaml (FR-019).
# Sourced by run-tests.sh. Git-repo style of _test-fixtures/a1-pr-merge-check/run-tests.sh: a base commit on main, a head
# commit on a feature branch, gh as a bash stub through the A1_GH_BIN seam. No real PR, no network, no write outside $WORK.
# The probe files are hand-written inputs. mg_* names keep this part clear of the harness helpers.

MG_HOME="$WORK/mg-home"; mkdir -p "$MG_HOME" "$WORK/mg-bin"
cat > "$WORK/mg-bin/gh" <<'GHEOF'
#!/usr/bin/env bash
case "$1 $2" in
  "pr view")
    case "$*" in
      *headRefOid*) printf '{"headRefOid":"%s"}\n' "$(git rev-parse HEAD)"; exit 0 ;;
      *) printf '{"baseRefName":"main"}\n'; exit 0 ;;
    esac ;;
  "pr checks") printf '[{"name":"test","bucket":"pass","state":"SUCCESS"}]\n'; exit 0 ;;
  *) echo "unexpected gh args: $*" >&2; exit 9 ;;
esac
GHEOF
chmod +x "$WORK/mg-bin/gh"

mg_git() { local d="$1"; shift; git -C "$d" -c commit.gpgsign=false -c user.name=t -c user.email=t@t -c core.hooksPath=/dev/null "$@"; }
mg_js() { printf '%s' "$MG_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
mg_reasons() { mg_js "j.reasons.map(r=>r.reason).sort().join(',')"; }
mg_dis() { (cd "$MG_P" && HOME="$MG_HOME" node "$TOOLS" disposition "$@" >"$WORK/mg-dis.out" 2>"$WORK/mg-dis.err"); }
mg_check() {
  MG_OUT="$(cd "$MG_P" && HOME="$MG_HOME" A1_GH_BIN="$WORK/mg-bin/gh" node "$TOOLS" pr merge-check --pr 7 --base main --phase fx-w3 2>"$WORK/mg-err")"; MG_RC=$?
}
mg_yaml() { # <host-name> -> a valid probe file naming that host
  printf 'version: 1\nhosts:\n  - name: %s\n    class: staging\nprobes:\n  - id: root\n    kind: http\n    url: https://%s/ok\n    expect:\n      status: 200\n' "$1" "$1"
}
mg_base_yaml() { mg_yaml base.example.test > "$1/.a1/live-probes.yaml"; }
mg_base_fid() { printf '{"rules":{}}\n' > "$1/.a1/fidelity.json"; }
mg_base_both() { mg_base_yaml "$1"; mg_base_fid "$1"; }

# mg_pr <label> <base-hook> — main holds a tiny green suite (+ whatever the hook seeds); feat edits one source file.
mg_pr() {
  MG_P="$WORK/mg-$1"; : "${MG_P:?}"; rm -rf "$MG_P"; mkdir -p "$MG_P/src" "$MG_P/.a1"
  git -C "$MG_P" init -q -b main
  printf 'module.exports = 1;\n' > "$MG_P/src/app.js"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$MG_P/suite.sh"
  printf '{"commands":[{"id":"unit","argv":["bash","suite.sh"]}]}\n' > "$MG_P/.a1/verify.json"
  ${2:-:} "$MG_P"
  mg_git "$MG_P" add -A; mg_git "$MG_P" commit -q -m base; mg_git "$MG_P" checkout -q -b feat
  printf 'module.exports = 2;\n' > "$MG_P/src/app.js"
  mg_git "$MG_P" add -A; mg_git "$MG_P" commit -q -m head
}
mg_commit() { mg_git "$MG_P" add -A; mg_git "$MG_P" commit -q -m "$1"; }

# --- control: PR without any probe file -> no probes_config_changed (proves the harness is green) -------------------
mg_pr g0 :; mg_check
expect "G0 no probe file anywhere: exit 0" "0" "$MG_RC"
expect "G0 no reasons (count 0)" "0" "$(mg_js 'j.reasons.length')"

# --- FR-019: add / change / delete / unchanged ------------------------------------------------------------------------
mg_pr g1 :; mg_yaml evil.example.test > "$MG_P/.a1/live-probes.yaml"; mg_commit "add probes"; mg_check
expect "G1 probe file added (new host): exit 1" "1" "$MG_RC"
expect "G1 exactly probes_config_changed (count 1)" "probes_config_changed" "$(mg_reasons)"
expect "G1 change=added, file named" "added|.a1/live-probes.yaml" "$(mg_js 'j.reasons[0].change+"|"+j.reasons[0].file')"
MG_FP1="$(mg_js 'j.reasons[0].fingerprint')"
expect "G1 fingerprint is a non-empty token" "1" "$([[ -n "$MG_FP1" && "$MG_FP1" != undefined ]] && echo 1 || echo 0)"
expect_has "G1 hint names the clearing path" "$(mg_js 'j.reasons[0].hint')" "disposition add --kind config_change --fingerprint $MG_FP1"

mg_pr g2 mg_base_yaml; mg_yaml evil.example.test > "$MG_P/.a1/live-probes.yaml"; mg_commit "change probes"; mg_check
expect "G2 probe file changed: exit 1 probes_config_changed (changed)" "1|probes_config_changed|changed" "$MG_RC|$(mg_reasons)|$(mg_js 'j.reasons[0].change')"

mg_pr g3 mg_base_yaml; mg_git "$MG_P" rm -q .a1/live-probes.yaml; mg_git "$MG_P" commit -q -m "drop probes"; mg_check
expect "G3 probe file deleted: exit 1 probes_config_changed (removed)" "1|probes_config_changed|removed" "$MG_RC|$(mg_reasons)|$(mg_js 'j.reasons[0].change')"
expect "G3 deletion carries a fingerprint" "1" "$([[ -n "$(mg_js 'j.reasons[0].fingerprint')" ]] && echo 1 || echo 0)"

mg_pr g4 mg_base_yaml; mg_check
expect "G4 probe file unchanged base..head: exit 0, no reason (count 0)" "0|0" "$MG_RC|$(mg_js 'j.reasons.length')"

# --- clearing: upheld by a second reviewer; self-review and pending do not ------------------------------------------
mg_pr g5 :; mg_yaml evil.example.test > "$MG_P/.a1/live-probes.yaml"; mg_commit "add probes"; mg_check
MG_FP5="$(mg_js 'j.reasons[0].fingerprint')"
mg_dis add --kind config_change --fingerprint "$MG_FP5" --reason "fixture: probes reviewed" --by fx; mg_commit "probes-disp"
mg_check
expect "G5a pending (unreviewed) disposition clears nothing: exit 1 (+ disposition_unreviewed)" "1|disposition_unreviewed,probes_config_changed" "$MG_RC|$(mg_reasons)"
mg_dis review "$MG_FP5" --verdict upheld --reason "fixture: ok" --by reviewer; mg_commit "probes-review"; mg_check
expect "G5b upheld by a second reviewer on the exact content: exit 0" "0|0" "$MG_RC|$(mg_js 'j.reasons.length')"

mg_pr g6 :; mg_yaml evil.example.test > "$MG_P/.a1/live-probes.yaml"; mg_commit "add probes"; mg_check
MG_FP6="$(mg_js 'j.reasons[0].fingerprint')"
mg_dis add --kind config_change --fingerprint "$MG_FP6" --reason "fixture: self" --by fx
mg_dis review "$MG_FP6" --verdict upheld --reason "fixture: self" --by fx; mg_commit "probes-self"; mg_check
expect "G6 self-review (author = reviewer) does not clear: exit 1 (probes_config_changed + disposition_self_reviewed)" "1|disposition_self_reviewed,probes_config_changed" "$MG_RC|$(mg_reasons)"

# re-change after upheld: the fingerprint covers the exact head content
mg_pr g7 :; mg_yaml evil.example.test > "$MG_P/.a1/live-probes.yaml"; mg_commit "add probes"; mg_check
MG_FP7="$(mg_js 'j.reasons[0].fingerprint')"
mg_dis add --kind config_change --fingerprint "$MG_FP7" --reason "fixture: reviewed" --by fx
mg_dis review "$MG_FP7" --verdict upheld --reason "fixture: ok" --by reviewer; mg_commit "probes-upheld"
mg_yaml worse.example.test > "$MG_P/.a1/live-probes.yaml"; mg_commit "probes changed again"; mg_check
expect "G7 re-change after the review: old verdict no longer matches, exit 1 with a new fingerprint" "1|probes_config_changed|new" "$MG_RC|$(mg_reasons)|$([[ "$(mg_js 'j.reasons[0].fingerprint')" != "$MG_FP7" ]] && echo new || echo same)"

# deletion cleared the same way
mg_pr g8 mg_base_yaml; mg_git "$MG_P" rm -q .a1/live-probes.yaml; mg_git "$MG_P" commit -q -m "drop probes"; mg_check
expect "G8 precondition: the deletion blocks first" "1|probes_config_changed" "$MG_RC|$(mg_reasons)"
MG_FP8="$(mg_js 'j.reasons[0].fingerprint')"
mg_dis add --kind config_change --fingerprint "$MG_FP8" --reason "fixture: removal reviewed" --by fx
mg_dis review "$MG_FP8" --verdict upheld --reason "fixture: ok" --by reviewer; mg_commit "probes-removal-upheld"; mg_check
expect "G8 deleted file cleared by an upheld disposition from another reviewer: exit 0" "0|0" "$MG_RC|$(mg_js 'j.reasons.length')"

# a disposition for another file's fingerprint (fidelity rule) must not clear the probe file
mg_pr g9 mg_base_both; mg_yaml evil.example.test > "$MG_P/.a1/live-probes.yaml"; printf '{"rules":{"skipped-test":"off"}}\n' > "$MG_P/.a1/fidelity.json"; mg_commit "change both"; mg_check
expect "G9 both configs changed: both reasons, each with its own fingerprint (count 2, distinct)" "2|fidelity_config_changed,probes_config_changed|2" "$(mg_js 'j.reasons.length')|$(mg_reasons)|$(mg_js 'new Set(j.reasons.map(r=>r.fingerprint)).size')"
MG_FP9F="$(mg_js "j.reasons.find(r=>r.reason==='fidelity_config_changed').fingerprint")"
mg_dis add --kind config_change --fingerprint "$MG_FP9F" --reason "fixture: fidelity only" --by fx
mg_dis review "$MG_FP9F" --verdict upheld --reason "fixture: ok" --by reviewer; mg_commit "fidelity-upheld"; mg_check
expect "G9b clearing the fidelity change leaves the probe change blocking: exit 1 probes_config_changed only" "1|probes_config_changed" "$MG_RC|$(mg_reasons)"

# --- regression: fidelity_config_changed output byte-identical to the pre-change code ------------------------------------
# Golden captured from the unmodified guard (main before spec 020) on exactly this content.
mg_pr g10 :; printf '{"rules":{"skipped-test":"off"}}\n' > "$MG_P/.a1/fidelity.json"; mg_commit "add fidelity config"; mg_check
MG_GOLD='{"reason":"fidelity_config_changed","file":".a1/fidelity.json","change":"added","fingerprint":"@FP@","hint":"disposition add --kind config_change --fingerprint @FP@ --reason <why> --by <you>; a second reviewer runs disposition review @FP@ --verdict upheld --by <reviewer>; commit and push .a1/dispositions.json; run the merge check again"}'
MG_FPF="$(mg_js 'j.reasons[0].fingerprint')"
expect "G10 fidelity reason JSON is byte-identical to the pre-change output" "${MG_GOLD//@FP@/$MG_FPF}" "$(mg_js 'JSON.stringify(j.reasons[0])')"
expect "G10 only the fidelity reason (count 1)" "1|fidelity_config_changed" "$(mg_js 'j.reasons.length')|$(mg_reasons)"

# --- disposition store: rule probes-config belongs to kind config_change; unknown rules stay refused -------------------
mg_pr g11 :
mg_dis add --kind config_change --fingerprint "probes-config:.a1/live-probes.yaml:0123456789abcdef" --reason "fixture: rule accepted" --by fx
expect "G11 disposition add accepts rule probes-config for kind config_change (exit 0)" "0" "$?"
mg_dis add --kind config_change --fingerprint "bogus-config:.a1/live-probes.yaml:0123456789abcdef" --reason "fixture: unknown rule" --by fx
expect "G11 an unknown rule is still refused (exit 2)" "2" "$?"
expect_has "G11 refusal names the rule/kind mismatch" "$(cat "$WORK/mg-dis.err")" "does not belong to kind config_change"

# --- SEC-1/SEC-2 (review round): case variants and a symlinked .a1 must not slip past the exact-path guard ----------------
mg_pr g12 :; mg_yaml evil.example.test > "$MG_P/.a1/LIVE-PROBES.yaml"; mg_commit "add upper-case probes"; mg_check
expect "G12 case variant .a1/LIVE-PROBES.yaml added: exit 1 probes_config_changed" "1|probes_config_changed" "$MG_RC|$(mg_reasons)"
expect "G12 the reason names the variant path, change=added" ".a1/LIVE-PROBES.yaml|added" "$(mg_js 'j.reasons[0].file+"|"+j.reasons[0].change')"
MG_FP12="$(mg_js 'j.reasons[0].fingerprint')"
mg_dis add --kind config_change --fingerprint "$MG_FP12" --reason "fixture: variant reviewed" --by fx
mg_dis review "$MG_FP12" --verdict upheld --reason "fixture: ok" --by reviewer; mg_commit "variant-upheld"; mg_check
expect "G12b the variant is cleared by an upheld disposition on its exact content: exit 0" "0|0" "$MG_RC|$(mg_js 'j.reasons.length')"
git -C "$MG_P" mv .a1/LIVE-PROBES.yaml .a1/Live-Probes.yaml 2>/dev/null || mg_git "$MG_P" mv .a1/LIVE-PROBES.yaml .a1/Live-Probes.yaml; mg_commit "rename variant"; mg_check
expect "G12c renaming the variant changes the fingerprint (path is part of it): blocks again" "1|probes_config_changed|new" "$MG_RC|$(mg_reasons)|$([[ "$(mg_js 'j.reasons[0].fingerprint')" != "$MG_FP12" ]] && echo new || echo same)"

mg_pr g13 :; printf '{"rules":{"skipped-test":"off"}}\n' > "$MG_P/.a1/Fidelity.JSON"; mg_commit "add upper-case fidelity"; mg_check
expect "G13 case variant .a1/Fidelity.JSON added: exit 1 fidelity_config_changed" "1|fidelity_config_changed" "$MG_RC|$(mg_reasons)"

# directory-name variant, FS independent: the blob goes into the index and the commit by plumbing
mg_pr g14 :
MG_BL="$(mg_yaml evil.example.test | mg_git "$MG_P" hash-object -w --stdin)"
mg_git "$MG_P" update-index --add --cacheinfo "100644,$MG_BL,.A1/live-probes.yaml"; mg_git "$MG_P" commit -q -m "add .A1 dir variant"; mg_check
expect_has "G14 .A1/live-probes.yaml (directory-name variant) blocks as probes_config_changed" "$(mg_reasons)" "probes_config_changed"
MG_BL="$(printf '{"rules":{}}\n' | mg_git "$MG_P" hash-object -w --stdin)"
mg_git "$MG_P" update-index --add --cacheinfo "100644,$MG_BL,.A1/FIDELITY.json"; mg_git "$MG_P" commit -q -m "add .A1 fidelity variant"; mg_check
expect_has "G14b .A1/FIDELITY.json (directory-name variant) blocks as fidelity_config_changed" "$(mg_reasons)" "fidelity_config_changed"

# .a1 replaced by a symlink to a directory that holds the files (git show of the exact path returns nothing on both sides)
mg_pr g15 :
mv "$MG_P/.a1" "$MG_P/cfg"; ln -s cfg "$MG_P/.a1"; mg_yaml evil.example.test > "$MG_P/cfg/live-probes.yaml"; printf '{"rules":{"skipped-test":"off"}}\n' > "$MG_P/cfg/fidelity.json"; mg_commit "symlink .a1"; mg_check
expect_has "G15 .a1 became a symlink: probes guard blocks" "$(mg_reasons)" "probes_config_changed"
expect_has "G15 .a1 became a symlink: fidelity guard blocks" "$(mg_reasons)" "fidelity_config_changed"
expect "G15 exit 1" "1" "$MG_RC"
expect "G15 change=symlink on the probes reason" "symlink" "$(mg_js "j.reasons.find(r=>r.reason==='probes_config_changed').change")"

# symlinked .a1 on BOTH sides (nothing differs base..head) still blocks, and a real .a1 on head with a symlink on base blocks too
mg_sym_base() { mv "$1/.a1" "$1/cfg"; ln -s cfg "$1/.a1"; }
# (the full merge-check fails closed with exit 2 here because the trusted verify.json is unreachable through the link; the guard itself is called directly)
mg_pr g16 mg_sym_base; mg_check
expect "G16 .a1 symlink on both sides: the merge check fails closed (exit 2)" "2" "$MG_RC"
MG_G16="$(cd "$MG_P" && node -e 'const G=require(process.argv[1]);const b=require("child_process").execFileSync("git",["rev-parse","main"],{encoding:"utf8"}).trim();console.log(G.configChangeChecks(process.cwd(),b,[]).reasons.map(r=>r.reason).sort().join(","))' "$SHARED/lib/pr-merge-guards.cjs")"
expect "G16 guard alone: .a1 symlink on both sides, no config difference, still blocks both configs" "fidelity_config_changed,probes_config_changed" "$MG_G16"
mg_pr g17 mg_sym_base; rm "$MG_P/.a1"; mv "$MG_P/cfg" "$MG_P/.a1"; mg_commit "back to a real dir"; mg_check
expect_has "G17 symlink on the base side only: blocks" "$(mg_reasons)" "probes_config_changed"

mg_nonascii_base() { mkdir -p "$1/.a1"; printf 'x\n' > "$1/.a1/live-probe"$'\xc5\xbf'".yaml"; }
# --- SEC-8 / SEC-9 (review round 2) -------------------------------------------------------------------------------------------
# Unicode names are committed by plumbing so the cases do not depend on the filesystem. Rule: ANY non-ASCII name directly under a
# .a1 variant, or a non-ASCII top-level name that folds (NFKC + lower-case) to .a1, blocks both guarded entries (change=name_variant).
mg_plumb() { # <path> -> adds a blob at <path> to the index and commits (working tree untouched)
  local bl; bl="$(printf 'x\n' | mg_git "$MG_P" hash-object -w --stdin)"
  mg_git "$MG_P" update-index --add --cacheinfo "100644,$bl,$1"; mg_git "$MG_P" commit -q -m "plumb"
}
mg_pr g18 :; mg_plumb ".a1/live-probe"$'\xc5\xbf'".yaml"; mg_check
expect_has "G18 .a1/live-probe(U+017F).yaml blocks the probes entry" "$(mg_reasons)" "probes_config_changed"
expect_has "G18 ... and the fidelity entry" "$(mg_reasons)" "fidelity_config_changed"
expect "G18 change=name_variant" "name_variant" "$(mg_js "j.reasons.find(r=>r.reason==='probes_config_changed').change")"
mg_pr g19 :; mg_plumb ".a"$'\xef\xbc\x91'"/live-probes.yaml"; mg_check
expect_has "G19 top-level .a(fullwidth 1) folds to .a1 under NFKC: blocks" "$(mg_reasons)" "probes_config_changed"
mg_pr g20 :; mg_plumb ".a1/fidelit"$'\xc4\xb1'"-x.json"; mg_check
expect_has "G20 any non-ASCII name directly under .a1 blocks (dotless i)" "$(mg_reasons)" "fidelity_config_changed"
mg_pr g21 :; mg_plumb ".a1/phases/caf"$'\xc3\xa9'"/x.md"; mg_check
expect_lacks "G21 control: a non-ASCII name deeper than .a1's direct children does not block the configs" "$(mg_reasons)" "_config_changed"
# the same name present on the base side only blocks too
mg_pr g22 mg_nonascii_base; mg_check
expect_has "G22 name variant on the base side only: blocks" "$(mg_reasons)" "probes_config_changed"
