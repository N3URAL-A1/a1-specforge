#!/usr/bin/env bash
# Part 28 — spec 016 Wave 7: placement rule for the plan and wave gates (FR-019, FR-020; plan decision D-1).
# Sourced by run-tests.sh. Part-local helpers only. Real files: cases/placement/{016,002,003}.PLAN.md are copies of real wave plans
# (vault plans of this repo and of a1-office-landing) and cases/placement/vault/ holds copies of their real specs (sizes L, M, S).
# Where a case needs another spec for the same plan, ONE frontmatter line (spec_path) is rewritten by the test and says so.
#
# PL  plan-review-xprov: runs only for spec size L or security surface in the files the plan names; else not_applicable / scope_exempt,
#     zero runner calls, nothing written, even without a permit (placement runs before the permit branch).
#   PL1  size M/S without surface is exempt      Red if the gate ignores placement                                     [mutant P1]
#   PL2  size L runs without surface             Red if size L stops counting                                          [mutant P2]
#   PL3  surface runs whatever the size          Red if the classifier result is ignored                               [mutant P3]
#   PL4  no flag sets the size                   `--size`, `--spec` exit 2 with the placement message                  [mutant P4]
#   PL5  hostile spec path / backtick spans      traversal is size unknown; spans with `$(…)` are inert; a 10 000-char path is surface [P5, P6]
# WV  wave-inspect-xprov: runs only for a wave a LATER wave depends on AND whose plan files or diff are surface.
#   WV1  not depended: exempt even with a surface diff                     [mutant P7]
#   WV2  depended + surface diff runs; depended + docs diff is exempt       [mutant P8]
#   WV3  a wave the plan does not list, a diff git cannot produce: runs     [mutants P9, P10]
# ST  load-check / wave-status accept scope_exempt; a wave with a gate row is judged on its rows; exempt waves do not break the chain
#   ST1  load-check accepts an exempt plan (placement scope_exempt)         [mutant P11]
#   ST2  wave-status accepts exempt waves, lacks a required one             [mutant P12]
#   ST3  a wave with a gate row is not exempt                               [mutant P13]
#   ST4  an exempt wave after a reviewed one does not make it lack          [mutant P14]
# Mutants run on tree copies only (rule 4b); the real owner store stays untouched.

TMP28="$(mktemp -d "${TMPDIR:-/tmp}/a1x28.XXXXXX")"
[[ -n "$TMP28" && -d "$TMP28" ]] || { echo "FAIL  part 28: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
SAVED_HOME_28="$HOME"
export HOME="$TMP28/home"; mkdir -p "$HOME/.codex"; printf '{"fixture":true}\n' > "$HOME/.codex/auth.json"; chmod 600 "$HOME/.codex/auth.json"
ORG28=https://github.com/N3URAL-A1/fixture.git
# the fixture vault: copies of the real specs the plans name (spec_path is vault-relative); the real A1_VAULT_ROOT is restored at the end
SAVED_VAULT_28="${A1_VAULT_ROOT-__unset__}"
export A1_VAULT_ROOT="$TMP28/vault"; cp -R "$CASES/placement/vault" "$A1_VAULT_ROOT"
SIM28="$FAKE/consent-sim.cjs"
TPL28="$CASES/consent"
ARGV28_DIR="$TMP28/argv"; mkdir -p "$ARGV28_DIR"; ARGV28_N=0
STORE28="$HOME/.a1-xprov"
ASKED28="$STORE28/consent-asked.json"
SNAPS28="$STORE28/snapshots"


# pin28 <value> — both xprov rows of the TREE copy's registry to `blocking` (the strictest enforcement: not_applicable must still continue)
pin28() {
  node -e '
    const fs = require("fs"); const file = process.argv[1]; const ids = ["plan-review-xprov", "wave-inspect-xprov"];
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").split("\n").map((l) => (ids.some((id) => l.startsWith("| `" + id + "` |")) ? l.replace(/\| (warning|blocking) \|/, "| blocking |") : l)).join("\n"));
  ' "$TREE/_shared/gates-registry.md" || bad "pin28: could not pin the registry copy"
}
# fresh28 — a new tree copy with the registry pinned to blocking; it is the tree every case and every RED proof starts from
fresh28() { make_tree; pin28; T28="$TREE"; T28_TOOLS="$TREE_TOOLS"; }
# prep28 <plan fixture> [spec_path] — phase repo p28 with the real plan copy (optionally ONE frontmatter line, spec_path, rewritten), STATUS, empty owner store
prep28() {
  make_phase p28 "$CASES/placement/$1"
  git -C "$PHASE_REPO" remote add origin "$ORG28"
  if [[ -n "${2:-}" ]]; then
    node -e 'const fs=require("fs"); const [f,v]=process.argv.slice(1); const t=fs.readFileSync(f,"utf8"); const n=t.split("\n").filter((l)=>l.startsWith("spec_path:")).length; if(n!==1){console.error("spec_path lines: "+n);process.exit(3);} fs.writeFileSync(f, t.replace(/^spec_path:.*$/m, () => "spec_path: "+v));' "$PHASE_PLAN" "$2" || bad "prep28: spec_path rewrite failed"
    git -C "$PHASE_REPO" commit -qam "fixture: spec_path" 
  fi
  PHASE_HEAD="$(cd "$PHASE_REPO" && git rev-parse HEAD)"
  printf '## Wave 1 — one\n' > "$PHASE_DIR/STATUS.md"
  rm -rf "$STORE28"
  make_home; ln -s "$HOME/.codex/auth.json" "$XHOME/auth.json"; export A1_XPROV_CODEX_HOME="$XHOME"
}
key28() { (cd "$PHASE_REPO" && cd "$(git rev-parse --git-common-dir)" && pwd -P); }
gate28() {
  ARGV28_N=$((ARGV28_N + 1)); ARGV28_FILE="$ARGV28_DIR/argv-$ARGV28_N.json"
  FAKE_RUNNER_ARGV_FILE="$ARGV28_FILE" FAKE_RUNNER_CASE="${FAKE_RUNNER_CASE:-approved}" fake_runner_env
  G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --phase p28 --timeout 7 "$@" 2>"$TMP28/err.txt" </dev/null)"; G_RC=$?; G_ERR="$(cat "$TMP28/err.txt")"
}
sub28() { G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov "$@" 2>"$TMP28/err.txt" </dev/null)"; G_RC=$?; G_ERR="$(cat "$TMP28/err.txt")"; }
cli28() { sub28 consent "$@"; }
sim28() { SIM_OUT="$(node "$SIM28" "$1" 2>"$TMP28/sim.err")"; SIM_RC=$?; }
ask28() { sim28 "{\"cmd\":\"ask\",\"tree\":\"$TREE\",\"root\":\"$PHASE_REPO\",\"kind\":\"${1:-consent}\",\"tool_use\":\"toolu_${1:-consent}\",\"session\":\"sess_28\",\"ludwig\":\"x\"}"; }
ans28() { sim28 "{\"cmd\":\"answer\",\"tree\":\"$TREE\",\"root\":\"$PHASE_REPO\",\"kind\":\"${1:-consent}\",\"mode\":\"$2\",\"text\":\"vielleicht\",\"tool_use\":\"toolu_${1:-consent}\",\"session\":\"sess_28\",\"ludwig\":\"x\",\"template\":\"$TPL28/post-tool-use.answers.template.json\"}"; }
age28() { sim28 "{\"cmd\":\"age\",\"tree\":\"$TREE\",\"root\":\"$PHASE_REPO\",\"kind\":\"${1:-consent}\",\"ms\":660000}"; }
runner_calls28() { [[ -f "$ARGV28_FILE" ]] && echo yes || echo no; }
snaps28() { ls -d "$SNAPS28"/snap-* 2>/dev/null | wc -l | tr -d ' '; }
# nothing28 — no a1 write into the phase and no byte in the owner store
nothing28() { [[ ! -e "$PHASE_DIR/PLAN-REVIEW-LOG.md" && ! -e "$PHASE_DIR/xreview" && ! -e "$PHASE_DIR/observations.jsonl" && ! -e "$PHASE_DIR/XREVIEW.md" && ! -e "$STORE28" ]]; }
sha28() { if [[ -e "$1" ]]; then (shasum -a 256 "$1" 2>/dev/null || sha256sum "$1") | cut -d' ' -f1; else echo absent; fi; }
mtree28() { # <lib-file> <from> <to> — TREE becomes a copy with ONE production change (refuses unless <from> occurs exactly once)
  make_tree; pin28
  node -e '
    const fs = require("fs"); const [tree, name, from, to] = process.argv.slice(1);
    const f = tree + "/_shared/lib/" + name; const s = fs.readFileSync(f, "utf8"); const n = s.split(from).length - 1;
    if (n !== 1) { console.error("mutation needle count " + n + " in " + name + ": " + from.slice(0, 60)); process.exit(3); }
    fs.writeFileSync(f, s.replace(from, () => to));
  ' "$TREE" "$1" "$2" "$3" || bad "NP harness: mutation failed in $1"
}
fresh28
unmtree28() { TREE="$T28"; TREE_TOOLS="$T28_TOOLS"; }
redproof28() { # <name> <scenario fn> <expected on the real tree> <lib-file> <from> <to>
  local name="$1" fn="$2" want="$3" file="$4" from="$5" to="$6" got mut
  got="$($fn)"
  [[ "$got" == "$want" ]] || { bad "$name: real tree gave '$got', wanted '$want'"; return 0; }
  mtree28 "$file" "$from" "$to"; mut="$($fn)"; unmtree28
  [[ "$mut" != "$want" ]] && ok "$name RED [mutant]: with the production change the outcome flips ('$want' -> '$mut')" || bad "$name RED [mutant]: the guard is dead, the mutant still gives '$mut'"
}


redproof28b() { # <name> <scenario fn> <expected> <lib-file> <from1> <to1> <from2> <to2> — two production changes in one lib file
  local name="$1" fn="$2" want="$3" file="$4" got mut
  got="$($fn)"
  [[ "$got" == "$want" ]] || { bad "$name: real tree gave '$got', wanted '$want'"; return 0; }
  mtree28 "$file" "$5" "$6"
  node -e '
    const fs = require("fs"); const [tree, name, from, to] = process.argv.slice(1);
    const f = tree + "/_shared/lib/" + name; const s = fs.readFileSync(f, "utf8"); const n = s.split(from).length - 1;
    if (n !== 1) { console.error("mutation needle count " + n + ": " + from.slice(0, 60)); process.exit(3); }
    fs.writeFileSync(f, s.replace(from, () => to));
  ' "$TREE" "$file" "$7" "$8" || bad "PL harness: second mutation failed in $file"
  mut="$($fn)"; unmtree28
  [[ "$mut" != "$want" ]] && ok "$name RED [mutant, both guards]: with both production changes the outcome flips ('$want' -> '$mut')" || bad "$name RED [mutant]: the guard is dead, the mutant still gives '$mut'"
}

# ---------- helpers for the cases ----------
EXEMPT28="1/not_applicable/scope_exempt/no"      # exit / verdict / reason / runner called
NOPERMIT28="1/not_applicable/external_review_not_permitted/no"   # placement says "run", the repo has no permit: the existing no-permit result
SPEC_M28=projects/a1-office-landing/spec/002-scroll-motion-redesign.md
SPEC_S28=projects/a1-office-landing/spec/003-eu-sovereignty-section.md
SPEC_L28=project/a1-specforge/spec/016-xprov-autonomy.md
out28() { echo "$G_RC/$(json_get "$G_OUT" "j.verdict + '/' + j.reason")/$(runner_calls28)"; }
nothing28() { [[ ! -e "$PHASE_DIR/PLAN-REVIEW-LOG.md" && ! -e "$PHASE_DIR/xreview" && ! -e "$PHASE_DIR/observations.jsonl" && ! -e "$PHASE_DIR/XREVIEW.md" && ! -e "$STORE28" ]]; }
# commit28 <relative file> — a commit with that file after the wave base
commit28() { mkdir -p "$PHASE_REPO/$(dirname "$1")"; printf 'x\n' >> "$PHASE_REPO/$1"; git -C "$PHASE_REPO" add -A && git -C "$PHASE_REPO" commit -qm "fixture: $1"; }
# waiver28 <wave> <head> <base> — one record in the guarded waiver store in the documented format (computed here, like part 06's waiver6)
waiver28() {
  mkdir -p "$HOME/.a1-xprov"; chmod 700 "$HOME/.a1-xprov"
  local repo sha; repo="$(key28)"; sha="$( (shasum -a 256 "$PHASE_PLAN" 2>/dev/null || sha256sum "$PHASE_PLAN") | cut -d' ' -f1)"
  node -e '
    const fs = require("fs"); const [file, repo, sha, wave, head, base] = process.argv.slice(1);
    let doc = { version: 1, waivers: [] };
    try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_e) { /* new store */ }
    doc.waivers.push({ repo, phase: "p28", gate: "wave-inspect-xprov", plan_sha256: sha, wave: Number(wave), lane: null, head, base, reason: "fixture", by: "fixture", ts: "2026-10-03T00:00:00.000Z" });
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
  ' "$HOME/.a1-xprov/waivers.json" "$repo" "$sha" "$1" "$2" "$3"
  chmod 600 "$HOME/.a1-xprov/waivers.json"
}
status28() { local w; : > "$PHASE_DIR/STATUS.md"; for w in "$@"; do printf '## Wave %s — w\n' "$w" >> "$PHASE_DIR/STATUS.md"; done; }

# ---------- PL: plan placement ----------
scen_pl1() { prep28 002.PLAN.md "$SPEC_M28"; gate28 --gate "$GATE_PLAN"; out28; }
scen_pl1s() { prep28 002.PLAN.md "$SPEC_S28"; gate28 --gate "$GATE_PLAN"; out28; }
scen_pl1u() { prep28 002.PLAN.md; gate28 --gate "$GATE_PLAN"; out28; }
scen_pl2() { prep28 002.PLAN.md "$SPEC_L28"; gate28 --gate "$GATE_PLAN"; out28; }
scen_pl3() { prep28 003.PLAN.md; gate28 --gate "$GATE_PLAN"; out28; }
casePL() {
  assert_eq "PL1 real plan 002 (no surface), spec size M: scope_exempt, exit 1, runner never called" "$(scen_pl1)" "$EXEMPT28"
  prep28 002.PLAN.md "$SPEC_M28"; gate28 --gate "$GATE_PLAN"   # (the scenario ran in a subshell: repeat it here to look at its output and its disk)
  assert_json "PL1 …step placement, placement scope_exempt, a detail naming the size" "$G_OUT" "[j.step, j.placement, /size M/.test(j.reason_detail)].join('/')" "placement/scope_exempt/true"
  nothing28 && ok "PL1 zero bytes: no log, no xreview/, no observation, no owner-store file" || bad "PL1 something was written: $(ls "$PHASE_DIR") / $(ls -A "$STORE28" 2>/dev/null)"
  [[ "$G_ERR" == *"scope_exempt"* ]] && ok "PL1 stderr carries the scope_exempt notice" || bad "PL1 notice: $G_ERR"
  assert_eq "PL1 size S without surface is exempt too" "$(scen_pl1s)" "$EXEMPT28"
  assert_eq "PL1 an absolute spec_path (real plan 002 as copied) is size unknown, decided by surface alone: exempt" "$(scen_pl1u)" "$EXEMPT28"
  assert_eq "PL2 size L (spec 016) runs although the plan names no surface: no permit, so the no-permit result" "$(scen_pl2)" "$NOPERMIT28"
  assert_eq "PL3 real plan 003 (size S, but it names surface) runs" "$(scen_pl3)" "$NOPERMIT28"
  # control: the exemption is not a side effect of a missing permit
  prep28 002.PLAN.md "$SPEC_M28"; write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md; gate28 --gate "$GATE_PLAN"
  assert_eq "PL1 control: with a permit an exempt plan still makes zero runner calls" "$(out28)" "$EXEMPT28"
  prep28 016.PLAN.md; write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md; gate28 --gate "$GATE_PLAN"
  assert_eq "PL2 control: with a permit the size-L plan reaches the runner" "$(runner_calls28)" "yes"
  redproof28 "PL1" scen_pl1 "$EXEMPT28" xprov-gate.cjs "if (!placed.run) return PL.result(base, placed);" "if (false) return PL.result(base, placed);"
  redproof28 "PL2" scen_pl2 "$NOPERMIT28" xprov-placement.cjs "if (size === SIZE_L) return runs('spec size L', { size, surface: null });" "if (false) return runs('spec size L', { size, surface: null });"
  redproof28 "PL3" scen_pl3 "$NOPERMIT28" xprov-placement.cjs "const surfaceOf = (paths) => SC.classifyPaths(paths, SC.loadGlobs()).security_surface;" "const surfaceOf = (paths) => SC.classifyPaths(paths, SC.loadGlobs()).security_surface && false;"
}

# PL4: no flag sets the size
scen_pl4() { prep28 002.PLAN.md "$SPEC_M28"; sub28 gate --phase p28 --gate "$GATE_PLAN" --size L; local a="$G_RC"; sub28 gate --phase p28 --gate "$GATE_PLAN" --spec "$SPEC_L28"; local b="$G_RC"; sub28 gate --phase p28 --gate "$GATE_PLAN" --size=S; [[ "$G_ERR" == *"no flag sets the size"* ]] && echo "$a/$b/$G_RC/named" || echo "$a/$b/$G_RC/unnamed"; }
casePL4() {
  assert_eq "PL4 --size L, --spec <file> and --size=S: exit 2 each, and the message says no flag sets the size" "$(scen_pl4)" "2/2/2/named"
  prep28 002.PLAN.md "$SPEC_M28"; sub28 gate --phase p28 --gate "$GATE_PLAN" --size L
  nothing28 && ok "PL4 the refused call wrote nothing" || bad "PL4 wrote: $(ls "$PHASE_DIR")"
  redproof28 "PL4" scen_pl4 "2/2/2/named" xprov-gate.cjs "if ((args || []).some((a) => /^--(size|spec|scope|placement)(=|\$)/.test(String(a)))) return usageExit(SIZE_FLAG_GONE);" ""
}

# PL5: hostile input
scen_pl5a() {   # a traversal in spec_path; the decoy spec it points at says size L
  prep28 002.PLAN.md 'docs/../../decoy-spec.md'; printf -- '---\nsize: L\n---\n# decoy\n' > "$PHASE_REPO/../decoy-spec.md"
  gate28 --gate "$GATE_PLAN"; out28
}
scen_pl5b() {   # injection-shaped and oversized backtick spans
  prep28 002.PLAN.md "$SPEC_M28"; printf '\n- `$(touch %s/pwned28)` and `a b; rm -rf /` and `x|y`\n' "$TMP28" >> "$PHASE_PLAN"
  gate28 --gate "$GATE_PLAN"; [[ -e "$TMP28/pwned28" ]] && echo "ran/$(out28)" || echo "inert/$(out28)"
}
scen_pl5c() {   # a 10 000-character path, and an absolute path: unclassifiable = surface = runs
  prep28 002.PLAN.md "$SPEC_M28"; printf '\n- `docs/%s.md`\n' "$(printf 'a%.0s' $(seq 1 10000))" >> "$PHASE_PLAN"
  gate28 --gate "$GATE_PLAN"; local a; a="$(out28)"
  prep28 002.PLAN.md "$SPEC_M28"; printf '\n- `/etc/passwd`\n' >> "$PHASE_PLAN"
  gate28 --gate "$GATE_PLAN"; echo "$a|$(out28)"
}
casePL5() {
  assert_eq "PL5 spec_path with a traversal: the decoy size L is never read (size unknown, exempt)" "$(scen_pl5a)" "$EXEMPT28"
  prep28 002.PLAN.md '../decoy-spec.md'; printf -- '---\nsize: L\n---\n' > "$PHASE_REPO/../decoy-spec.md"; gate28 --gate "$GATE_PLAN"
  assert_eq "PL5 a spec_path that starts with '..' is no spec reference at all: exempt" "$(out28)" "$EXEMPT28"
  redproof28b "PL5" scen_pl5a "$EXEMPT28" xprov-placement.cjs "|| ref[1].split('/').includes('..'))" ")" "if (!insideRealpath(base, file)) continue;" ""
  assert_eq "PL5 injection-shaped backtick spans are inert text: nothing runs, the plan stays exempt" "$(scen_pl5b)" "inert/$EXEMPT28"
  assert_eq "PL5 a 10 000-character path and an absolute path count as surface (unclassifiable): the plan runs" "$(scen_pl5c)" "$NOPERMIT28|$NOPERMIT28"
}

# ---------- WV: wave placement (plan 016: waves 1-6 are depended on and name no surface; wave 7 names surface and wave 8 depends on it; wave 12 nobody depends on) ----------
# wv28 <wave> <diff file | ""> [base override] — gate call for the wave, after one commit touching <diff file>
wv28() { prep28 016.PLAN.md; local base="$PHASE_HEAD"; [[ -n "${2:-}" ]] && commit28 "$2"; gate28 --gate "$GATE_WAVE" --wave "$1" --base "${3:-$base}"; out28; }
scen_wv1() { wv28 12 .github/workflows/ci.yml; }
scen_wv2a() { wv28 6 .github/workflows/ci.yml; }
scen_wv2b() { wv28 6 docs/guide.md; }
scen_wv3a() { wv28 99 docs/guide.md; }
scen_wv3b() { wv28 6 docs/guide.md deadbeefdeadbeef; }
scen_wv4() { wv28 7 docs/guide.md; }
caseWV() {
  assert_eq "WV1 wave 12 (no later wave depends on it) with a surface diff: scope_exempt, runner never called" "$(scen_wv1)" "$EXEMPT28"
  wv28 12 .github/workflows/ci.yml >/dev/null
  nothing28 && ok "WV1 zero bytes written" || bad "WV1 wrote: $(ls "$PHASE_DIR")"
  assert_eq "WV2 wave 6 is depended on (wave 7) and its diff touches CI: it runs" "$(scen_wv2a)" "$NOPERMIT28"
  assert_eq "WV2 wave 6 with a docs-only diff: scope_exempt" "$(scen_wv2b)" "$EXEMPT28"
  assert_eq "WV3 a wave number the plan does not list (99) cannot be placed: it runs" "$(scen_wv3a)" "$NOPERMIT28"
  assert_eq "WV3 a base git cannot diff against: guarded, it runs" "$(scen_wv3b)" "$NOPERMIT28"
  assert_eq "WV4 wave 7 names surface in the plan and wave 8 depends on it: runs even with a docs-only diff" "$(scen_wv4)" "$NOPERMIT28"
  prep28 016.PLAN.md; write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md; commit28 .github/workflows/ci.yml; gate28 --gate "$GATE_WAVE" --wave 6 --base "$PHASE_HEAD"
  assert_eq "WV2 control: with a permit the depended surface wave goes past placement and the permit check (it reaches normalize)" "$(json_get "$G_OUT" "j.step")" "normalize"
  redproof28 "WV1" scen_wv1 "$EXEMPT28" xprov-placement.cjs "if (!f.depended) return exempt(" "if (false) return exempt("
  redproof28 "WV2" scen_wv2a "$NOPERMIT28" xprov-placement.cjs "try { return surfaceOf(SC.diffPaths(workPath, base, 'HEAD')); }" "try { return false; }"
  redproof28 "WV3" scen_wv3a "$NOPERMIT28" xprov-placement.cjs "if (!f.listed) return runs(" "if (!f.listed) return exempt("
  redproof28 "WV3b" scen_wv3b "$NOPERMIT28" xprov-placement.cjs "catch (_e) { return true; } // git cannot say: guarded" "catch (_e) { return false; }"
}

# ---------- ST: load-check / wave-status ----------
scen_st1() { prep28 002.PLAN.md "$SPEC_M28"; sub28 load-check --phase p28; echo "$G_RC/$(json_get "$G_OUT" "j.accepted + '/' + j.placement")"; }
scen_st2a() { prep28 016.PLAN.md; status28 1 2 3 4 5 6 12; sub28 wave-status --phase p28; echo "$G_RC/$(json_get "$G_OUT" "j.ok + '/' + JSON.stringify(j.scope_exempt) + '/' + j.placement")"; }
scen_st2b() { prep28 016.PLAN.md; write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md; status28 6 7; sub28 wave-status --phase p28; echo "$G_RC/$(json_get "$G_OUT" "j.ok + '/' + JSON.stringify(j.lacking) + '/' + JSON.stringify(j.scope_exempt)")"; }
caseST() {
  assert_eq "ST1 load-check accepts an exempt plan: exit 0, accepted not_applicable, placement scope_exempt" "$(scen_st1)" "0/not_applicable/scope_exempt"
  prep28 002.PLAN.md "$SPEC_M28"; sub28 load-check --phase p28
  nothing28 && ok "ST1 load-check wrote nothing" || bad "ST1 wrote"
  sub28 load-check --phase p28 --expect-sha "$(printf '0%.0s' {1..64})"
  assert_eq "ST1 --expect-sha still guards the plan (a different sha: exit 1, plan_changed)" "$G_RC/$(json_get "$G_OUT" "j.reason")" "1/plan_changed"
  assert_eq "ST2 wave-status: waves 1-6 and 12 are all exempt: exit 0, scope_exempt listed, nothing lacking" "$(scen_st2a)" "0/true/[1,2,3,4,5,6,12]/scope_exempt"
  assert_eq "ST2 wave-status: wave 7 is required and has no pass: exit 1, lacking [7], wave 6 stays exempt" "$(scen_st2b)" "1/false/[7]/[6]"
  redproof28 "ST1" scen_st1 "0/not_applicable/scope_exempt" xprov-gate.cjs "if (!placed.run) {" "if (false) {"
  redproof28 "ST2" scen_st2a "0/true/[1,2,3,4,5,6,12]/scope_exempt" xprov-placement.cjs "return f.listed && (!f.depended || !f.surface);" "return false;"
}

# ST3: a wave with a gate row is judged on its rows, not exempted from the plan
scen_st3() {
  prep28 016.PLAN.md; write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md; mkdir -p "$PHASE_DIR/xreview"
  printf '[{"gate":"wave-inspect-xprov","wave":6,"lane":null,"round":1,"verdict":"fail-with-findings"}]\n' > "$PHASE_DIR/xreview/index.json"
  status28 6; sub28 wave-status --phase p28 --waves 6
  echo "$G_RC/$(json_get "$G_OUT" "JSON.stringify(j.lacking) + '/' + JSON.stringify(j.scope_exempt)")"
}
# ST4: a reviewed (waived) required wave followed by an exempt wave's commits still counts: the gap around the exempt wave is not checked
scen_st4() {
  prep28 016.PLAN.md; write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md
  local base="$PHASE_HEAD"; commit28 src/w7.js; local h7; h7="$(git -C "$PHASE_REPO" rev-parse HEAD)"
  waiver28 7 "$h7" "$base"; commit28 src/after-wave-7.js
  sub28 wave-status --phase p28 --waves 7,12
  echo "$G_RC/$(json_get "$G_OUT" "j.ok + '/' + JSON.stringify(j.lacking)")"
}
caseST34() {
  assert_eq "ST3 a wave with a gate row is lacking, not exempt (exit 1, lacking [6], nothing exempt)" "$(scen_st3)" "1/[6]/[]"
  redproof28 "ST3" scen_st3 "1/[6]/[]" xprov-gate.cjs "(p) => index.some((e) => e.gate === gate && waveNumber(e.wave) === p.wave)" "(p) => false"
  assert_eq "ST4 wave 7 waived, then a commit of exempt wave 12: wave-status ok" "$(scen_st4)" "0/true/[]"
  redproof28 "ST4" scen_st4 "0/true/[]" xprov-waivers.cjs "(isLast ? (gap || leadsTo(tip.workPath, c.head, tip.head, phase))" "(isLast ? (leadsTo(tip.workPath, c.head, tip.head, phase))"
}

casePL; casePL4; casePL5; caseWV; caseST; caseST34
export HOME="$SAVED_HOME_28"
if [[ "$SAVED_VAULT_28" == "__unset__" ]]; then unset A1_VAULT_ROOT; else export A1_VAULT_ROOT="$SAVED_VAULT_28"; fi
rm -rf "$TMP28"
