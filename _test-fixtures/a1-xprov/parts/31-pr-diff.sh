#!/usr/bin/env bash
# Part 31 — spec 016 Wave 10: the PR diff gate `pr-diff-xprov` and the merge block (FR-017, FR-018, FR-021, FR-022, FR-023; Addition and preconditions 1-4).
# Sourced by run-tests.sh. Part-local helpers only (suffix 31). Mutants run on tree copies only (rule 4b); the real owner store stays untouched.
# The runner is the fake of make_tree with FAKE_RUNNER_BIND_PLAN=1 (the brief is written by the gate, so its sha is bound by the runner like the real one).
# The origin is a local bare repository (the permit binds it); `gh` is a stub on PATH (A1 fixture stub, answers from files).
#
# PD  the gate
#   PD1  a surface diff runs once; the same head sha again reuses the stored pass with ZERO runner calls                    [mutant R1]
#   PD2  a new head sha sends only the commits since the reviewed head (the runner's --base is the old head)               [mutant R2]
#   PD3  docs-only diff: scope_exempt, zero bytes (no .a1-review, no runner call)                                           [mutant E1]
#   PD4  size-S spec and no surface: scope_exempt; the same spec on a surface diff runs                                     [mutants E2, E3]
#   PD5  no --spec: a non-surface code diff runs, only docs-only exempts                                                    [mutant E4]
#   PD6  a secret-shaped file in the untracked .a1-review/ never reaches the snapshot                                       [mutant S1]
#   PD7  a locally moved origin/main does not change the reviewed diff (the anchor is the remote)                           [mutant A1]
#   PD8  no permit: not_applicable, nothing written
# MC  the merge block (--merge-check)
#   MC1  surface diff without a result: blocked; with a pass for exactly this head: ok; a new head: blocked again          [mutants M1, M2]
#   MC2  a local ref that differs from the remote blocks the merge                                                          [mutant M3]
#   MC3  codex_blocked_fallback never counts on a surface diff                                                              [mutant M4]
#   MC4  an owner chat waiver for the head counts                                                                           [mutant M5]
#   MC5  a decline counts only with an owner No on the allowlist marker                                                     [mutant M6]
#   MC6  no surface: ok without any result                                                                                  [mutant M7]
# HP  hostile: traversal in --work-path / --spec, injection-shaped --base, 10 000-char --spec exit 2 and write nothing
# FR-022  the fixture phase (plan review + one depended surface wave + the PR diff) shows at most 3 Codex runs

mk_workdir TMP31 "a1x31"
[[ -n "$TMP31" && -d "$TMP31" ]] || { echo "FAIL  part 31: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
SAVED_HOME_31="$HOME"
export HOME="$TMP31/home"; mkdir -p "$HOME/.codex"; printf '{"fixture":true}\n' > "$HOME/.codex/auth.json"; chmod 600 "$HOME/.codex/auth.json"
STORE31="$HOME/.a1-xprov"
N31=0
EXK31="AKIA""QQQQQQQQQQQQQQQQ"

fresh31() { make_tree; cp -R "$REPO_ROOT/hooks" "$TREE/hooks"; T31="$TREE"; T31_TOOLS="$TREE_TOOLS"; }
unmtree31() { TREE="$T31"; TREE_TOOLS="$T31_TOOLS"; TREE_VENDOR="$T31/_shared/vendor/claudex-loop"; }
mutate31() { # <lib-file> <from> <to> — one production change in the CURRENT tree copy (refuses unless <from> occurs exactly once)
  node -e '
    const fs = require("fs"); const [tree, name, from, to] = process.argv.slice(1);
    const f = tree + "/_shared/lib/" + name; const s = fs.readFileSync(f, "utf8"); const n = s.split(from).length - 1;
    if (n !== 1) { console.error("mutation needle count " + n + " in " + name + ": " + from.slice(0, 60)); process.exit(3); }
    fs.writeFileSync(f, s.replace(from, () => to));
  ' "$TREE" "$1" "$2" "$3" || bad "part 31 harness: mutation failed in $1"
}
mtree31() { make_tree; cp -R "$REPO_ROOT/hooks" "$TREE/hooks"; mutate31 "$1" "$2" "$3"; }
redproof31() { # <name> <scenario fn> <expected on the real tree> <lib-file> <from> <to> [<lib-file2> <from2> <to2>]
  local name="$1" fn="$2" want="$3" got mut
  got="$($fn)"
  [[ "$got" == "$want" ]] || { bad "$name: real tree gave '$got', wanted '$want'"; return 0; }
  mtree31 "$4" "$5" "$6"
  [[ -n "${7:-}" ]] && mutate31 "$7" "$8" "$9"
  mut="$($fn)"; unmtree31
  [[ "$mut" != "$want" ]] && ok "$name RED [mutant]: with the production change the outcome flips ('$want' -> '$mut')" || bad "$name RED [mutant]: the guard is dead, the mutant still gives '$mut'"
}

# prep31 — a permitted repo with a local bare origin on main, a feature branch, a compliant review home, a gh stub dir on PATH.
prep31() {
  make_phase p31
  ORIGIN31="$(mktemp -d "$TMP31/origin.XXXXXX")"; git init -q --bare "$ORIGIN31"; git -C "$ORIGIN31" symbolic-ref HEAD refs/heads/main
  git -C "$PHASE_REPO" remote add origin "$ORIGIN31"
  git -C "$PHASE_REPO" branch -M main
  rm -rf "$STORE31"; write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md
  git -C "$PHASE_REPO" add -A && git -C "$PHASE_REPO" commit -qm "fixture: permit file" && git -C "$PHASE_REPO" push -q origin main 2>/dev/null
  make_home; export A1_XPROV_CODEX_HOME="$XHOME"
  node "$TREE_TOOLS" xprov init-home >/dev/null 2>&1 </dev/null
  ln -s "$HOME/.codex/auth.json" "$XHOME/auth.json"
  git -C "$PHASE_REPO" checkout -q -b feat
  COUNT31="$(mktemp "$TMP31/count.XXXXXX")"; rm -f "$COUNT31"
}
commit31() { # <path> <content> — one commit on the feature branch
  mkdir -p "$(dirname "$PHASE_REPO/$1")"; printf '%s\n' "$2" > "$PHASE_REPO/$1"
  git -C "$PHASE_REPO" add -A && git -C "$PHASE_REPO" commit -qm "fixture: $1"
}
runs31() { [[ -f "$COUNT31" ]] && wc -l < "$COUNT31" | tr -d ' ' || echo 0; }
# pr31 [gate flags...] — the PR gate from the repo; G_OUT G_RC
pr31() {
  FAKE_RUNNER_BIND_PLAN=1 FAKE_RUNNER_CASE=approved FAKE_RUNNER_SEQUENCE='[{}]' FAKE_RUNNER_COUNT_FILE="$COUNT31" FAKE_RUNNER_ARGV_FILE="$TMP31/argv.json" fake_runner_env
  G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --gate pr-diff-xprov --work-path "$PHASE_REPO" --timeout 7 "$@" 2>"$TMP31/err.txt" </dev/null)"; G_RC=$?; G_ERR="$(cat "$TMP31/err.txt")"
}
mc31() { G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --gate pr-diff-xprov --work-path "$PHASE_REPO" --merge-check "$@" 2>"$TMP31/err.txt" </dev/null)"; G_RC=$?; G_ERR="$(cat "$TMP31/err.txt")"; }
field31() { json_get "$G_OUT" "$1"; }
runner_base31() { node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const i=a.indexOf("--base");process.stdout.write(i<0?"none":a[i+1]);' "$TMP31/argv.json" 2>/dev/null; }

scen_pd1() { # surface diff: first run reviews, second reuses
  prep31; commit31 src/auth/login.js 'export const login = 1;'
  pr31; local first="$G_RC/$(field31 "j.verdict")/$(runs31)"
  pr31; echo "$first|$G_RC/$(field31 "j.verdict")/$(field31 "j.reused === true")/$(runs31)"
}
scen_pd2() { # a new head: the runner's base is the old head
  prep31; commit31 src/auth/login.js 'export const login = 1;'
  pr31; local old; old="$(git -C "$PHASE_REPO" rev-parse HEAD)"
  commit31 src/auth/session.js 'export const session = 1;'
  pr31; local rb; rb="$(runner_base31)"
  echo "$G_RC/$(field31 "j.verdict")/runs$(runs31)/$([[ "$rb" == "$old" ]] && echo base-is-old-head || echo "base=$rb")"
}
scen_pd3() { # docs-only
  prep31; commit31 docs/readme.md '# hello'
  pr31; echo "$G_RC/$(field31 "j.verdict")/$(field31 "j.reason")/$(field31 "j.step")/runs$(runs31)/$([[ -e "$PHASE_REPO/.a1-review" ]] && echo wrote || echo clean)"
}
scen_pd4() { # size S spec: no surface exempt, surface runs
  prep31; mkdir -p "$PHASE_REPO/specs"; printf -- '---\nsize: S\n---\n# spec\n' > "$PHASE_REPO/specs/s.md"; git -C "$PHASE_REPO" add -A; git -C "$PHASE_REPO" commit -qm spec
  commit31 src/util.js 'export const u = 1;'
  pr31 --spec specs/s.md; local a="$G_RC/$(field31 "j.verdict")/$(field31 "j.reason")/runs$(runs31)"
  commit31 src/auth/login.js 'export const login = 1;'
  pr31 --spec specs/s.md; echo "$a|$G_RC/$(field31 "j.verdict")/runs$(runs31)"
}
scen_pd5() { # no spec: code without surface runs; docs-only exempt
  prep31; commit31 src/util.js 'export const u = 1;'
  pr31; echo "$G_RC/$(field31 "j.verdict")/runs$(runs31)"
}
scen_pd6() { # .a1-review/ is untracked state: a secret-shaped file there is not in the snapshot
  prep31; commit31 src/auth/login.js 'export const login = 1;'
  mkdir -p "$PHASE_REPO/.a1-review"; printf 'k = "%s"\n' "$EXK31" > "$PHASE_REPO/.a1-review/findings.json"
  pr31; echo "$G_RC/$(field31 "j.verdict")/$(field31 "j.reason")/$([[ "$G_OUT$G_ERR" == *"$EXK31"* ]] && echo LEAK || echo clean)"
}
scen_pd7() { # origin/main moved locally: the reviewed diff is still merge-base(remote base, head)..head
  prep31; commit31 src/auth/login.js 'export const login = 1;'
  git -C "$PHASE_REPO" update-ref refs/remotes/origin/main HEAD
  pr31; echo "$G_RC/$(field31 "j.verdict")/surface=$(field31 "j.pr.surface")/$(field31 "j.pr.merge_base === '$(git -C "$ORIGIN31" rev-parse main)'")"
}
scen_pd8() { # no permit
  prep31; rm -rf "$STORE31" "$PHASE_REPO/.a1/xprov.json"; commit31 src/auth/login.js 'export const login = 1;'
  pr31; echo "$G_RC/$(field31 "j.verdict")/runs$(runs31)/$([[ -e "$PHASE_REPO/.a1-review" ]] && echo wrote || echo clean)"
}

scen_pd9() { # FR-022: the PR diff adds ONE Codex run to the observations, a reuse adds none (plan review + depended wave + PR diff = at most 3)
  prep31; commit31 src/auth/login.js 'export const login = 1;'
  pr31; pr31
  node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(JSON.parse);process.stdout.write(t.filter((l)=>l.gate==="pr-diff-xprov"&&l.codex_runs>=1).length+"/"+t.filter((l)=>l.gate==="pr-diff-xprov").length)' "$PHASE_REPO/.a1-review/xreview/observations.jsonl" 2>&1
}
caseP31() {
  fresh31
  assert_eq "PD1 a surface diff runs once; the same head reuses the pass with zero runner calls" "$(scen_pd1)" "0/pass/1|0/pass/true/1"
  assert_eq "PD2 a new head sends only the commits since the reviewed head" "$(scen_pd2)" "0/pass/runs2/base-is-old-head"
  assert_eq "PD3 docs-only: scope_exempt at placement, nothing written, no runner call" "$(scen_pd3)" "1/not_applicable/scope_exempt/placement/runs0/clean"
  assert_eq "PD4 size-S spec: no surface exempt, a surface diff runs" "$(scen_pd4)" "1/not_applicable/scope_exempt/runs0|0/pass/runs1"
  assert_eq "PD5 no --spec: a non-surface code diff runs" "$(scen_pd5)" "0/pass/runs1"
  assert_eq "PD6 a secret-shaped file in .a1-review/ is not in the snapshot" "$(scen_pd6)" "0/pass/null/clean"
  assert_eq "PD7 a locally moved origin/main does not change the reviewed diff" "$(scen_pd7)" "0/pass/surface=true/true"
  assert_eq "PD8 no permit: not_applicable, nothing written, no runner call" "$(scen_pd8)" "1/not_applicable/runs0/clean"
  assert_eq "PD9 FR-022: the PR diff counts one Codex run in the observations, the reuse none" "$(scen_pd9)" "1/1"
  local PDN=xprov-pr-diff.cjs
  redproof31 "PD1a" scen_pd1 "0/pass/1|0/pass/true/1" xprov-gate.cjs "const hit = PD.reusedPass(ctx);" "const hit = null;"
  redproof31 "PD9a" scen_pd9 "1/1" xprov-gate.cjs "const hit = PD.reusedPass(ctx);" "const hit = null;"
  redproof31 "PD2a" scen_pd2 "0/pass/runs2/base-is-old-head" $PDN "return best === null ? t.mergeBase : best;" "return t.mergeBase;"
  redproof31 "PD3a" scen_pd3 "1/not_applicable/scope_exempt/placement/runs0/clean" $PDN "if (t.cls.docsOnly) return exempt('the PR diff is docs-only');" ""
  redproof31 "PD4a" scen_pd4 "1/not_applicable/scope_exempt/runs0|0/pass/runs1" $PDN "PL.sizeOfSpec(root, t.spec) === SIZE_S" "false"
  redproof31 "PD4b" scen_pd4 "1/not_applicable/scope_exempt/runs0|0/pass/runs1" $PDN "if (t.cls.surface) return runs('the PR diff touches security surface');" ""
  redproof31 "PD7a" scen_pd7 "0/pass/surface=true/true" $PDN "const mergeBase = gitLine(['-C', a.workPath, 'merge-base', anc.base, h.head]);" "const mergeBase = gitLine(['-C', a.workPath, 'merge-base', 'refs/remotes/origin/main', h.head]);"
}
caseP31

# ---------- MC: the merge block ----------
reasons31() { json_get "$G_OUT" "(j.blocked || []).map((b) => b.reason).join(',')"; }
scen_mc1() { # no result: blocked; a pass for exactly this head: ok; a new head: blocked again
  prep31; commit31 src/auth/login.js 'export const login = 1;'
  mc31; local a="$G_RC/$(reasons31)"
  pr31; mc31; local b="$G_RC/$(field31 "j.ok")/$(field31 "j.covered_by.join(',')")"
  commit31 src/auth/more.js 'export const more = 1;'
  mc31; echo "$a|$b|$G_RC/$(reasons31)"
}
scen_mc2() { # a local ref that differs from the remote
  prep31; commit31 src/auth/login.js 'export const login = 1;'; pr31
  git -C "$PHASE_REPO" update-ref refs/remotes/origin/main HEAD
  mc31; echo "$G_RC/$(reasons31)"
}
blocked31() { # the gate with the BLOCKED case (twice = codex_blocked_fallback)
  FAKE_RUNNER_BIND_PLAN=1 FAKE_RUNNER_CASE=blocked fake_runner_env
  G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --gate pr-diff-xprov --work-path "$PHASE_REPO" --timeout 7 2>/dev/null </dev/null)"; G_RC=$?
}
scen_mc3() { # twice BLOCKED: no result on a surface diff; the owner is asked
  prep31; commit31 src/auth/login.js 'export const login = 1;'
  blocked31; local g="$(field31 "j.verdict")/$(field31 "j.reason")"
  mc31; echo "$g|$G_RC/$(reasons31)/$(field31 "j.owner_question")"
}
scen_mc4() { # an owner waiver (a record of the guarded store, format of xprov-waivers.cjs) for exactly this head counts
  prep31; commit31 src/auth/login.js 'export const login = 1;'
  blocked31
  local head; head="$(git -C "$PHASE_REPO" rev-parse HEAD)"
  mc31; local before="$G_RC"
  node -e '
    const fs = require("fs"); const path = require("path"); const { execFileSync } = require("child_process");
    const [repo, head, base, plan] = process.argv.slice(1);
    const key = fs.realpathSync(path.resolve(repo, execFileSync("git", ["-C", repo, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim()));
    const file = path.join(process.env.HOME, ".a1-xprov", "waivers.json");
    const rec = { repo: key, phase: "pr-review", gate: "pr-diff-xprov", plan_sha256: plan, wave: 0, lane: "pr" + head.slice(0, 12), head, base, reason: "fixture waiver", by: "owner-chat", ts: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify({ version: 1, waivers: [rec] }, null, 2) + "\n", { mode: 0o600 });
  ' "$PHASE_REPO" "$head" "$(git -C "$ORIGIN31" rev-parse main)" "$(sha256_of "$PHASE_REPO/.a1-review/PLAN.md")"
  mc31; echo "$before->$G_RC/$(field31 "j.covered_by.join(',')")"
}
scen_mc5() { # a decline without an owner No on the allowlist marker does not count
  prep31; commit31 src/auth/login.js "k = \"$EXK31\""
  pr31; local scan lane base; scan="$(field31 "j.scan_record")"; lane="$(field31 "j.pr.lane")"; base="$(field31 "j.pr.runner_base")"
  local g="$G_RC/$(field31 "j.reason")"
  G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov dispose --phase pr-review --gate pr-diff-xprov --wave 0 --lane "$lane" --work-path "$PHASE_REPO" --base "$base" --secret-declined "$scan" 2>/dev/null </dev/null)"; local d="$?/$(field31 "j.accepted")"
  mc31; echo "$g|$d|$G_RC/$(reasons31)"
}
scen_mc7() { # a decline WITH an owner No (the consent hook recorded an answered No on the allowlist marker of this scan) counts
  prep31; commit31 src/auth/login.js "k = \"$EXK31\""
  pr31; local scan lane base; scan="$(field31 "j.scan_record")"; lane="$(field31 "j.pr.lane")"; base="$(field31 "j.pr.runner_base")"
  local sim="{\"tree\":\"$TREE\",\"root\":\"$PHASE_REPO\",\"kind\":\"allowlist\",\"phase\":\"p31\",\"scan\":\"$scan\",\"tool_use\":\"toolu_mc7\",\"session\":\"sess_mc7\""
  node "$FAKE/consent-sim.cjs" "$sim,\"cmd\":\"ask\"}" >/dev/null 2>&1
  node "$FAKE/consent-sim.cjs" "$sim,\"cmd\":\"answer\",\"mode\":\"no\",\"text\":\"x\",\"template\":\"$CASES/consent/post-tool-use.answers.template.json\"}" >/dev/null 2>&1
  G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov dispose --phase pr-review --gate pr-diff-xprov --wave 0 --lane "$lane" --work-path "$PHASE_REPO" --base "$base" --secret-declined "$scan" 2>/dev/null </dev/null)"; local d="$?/$(field31 "j.accepted")"
  mc31; echo "$d|$G_RC/$(field31 "j.covered_by.join(',')")"
}
scen_mc8() { # the owner waiver for head X does not cover head Y (a later commit)
  prep31; commit31 src/auth/login.js 'export const login = 1;'
  blocked31
  local head; head="$(git -C "$PHASE_REPO" rev-parse HEAD)"
  node -e '
    const fs = require("fs"); const path = require("path"); const { execFileSync } = require("child_process");
    const [repo, head, base, plan] = process.argv.slice(1);
    const key = fs.realpathSync(path.resolve(repo, execFileSync("git", ["-C", repo, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim()));
    const file = path.join(process.env.HOME, ".a1-xprov", "waivers.json");
    const rec = { repo: key, phase: "pr-review", gate: "pr-diff-xprov", plan_sha256: plan, wave: 0, lane: "pr" + head.slice(0, 12), head, base, reason: "fixture waiver", by: "owner-chat", ts: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify({ version: 1, waivers: [rec] }, null, 2) + "\n", { mode: 0o600 });
  ' "$PHASE_REPO" "$head" "$(git -C "$ORIGIN31" rev-parse main)" "$(sha256_of "$PHASE_REPO/.a1-review/PLAN.md")"
  mc31; local a="$G_RC/$(field31 "j.covered_by.join(',')")"
  commit31 src/auth/more.js 'export const more = 1;'
  mc31; echo "$a|$G_RC/$(reasons31)"
}
scen_mc9() { # a voided permit (the origin changed): a surface diff blocks and the owner is told; no surface is ok
  prep31; commit31 src/auth/login.js 'export const login = 1;'
  git -C "$PHASE_REPO" remote set-url --push origin "$ORIGIN31"
  local other; other="$(mktemp -d "$TMP31/other.XXXXXX")"; git init -q --bare "$other"
  git -C "$PHASE_REPO" remote set-url origin "$other"
  git -C "$other" symbolic-ref HEAD refs/heads/main; git -C "$PHASE_REPO" push -q "$other" main 2>/dev/null
  mc31; local a="$G_RC/$(reasons31)/$(field31 "j.owner_question")"
  git -C "$PHASE_REPO" reset -q --hard HEAD~1; git -C "$PHASE_REPO" -c user.name=t -c user.email=t@t commit -q --allow-empty -m none
  commit31 docs/readme.md '# x'
  mc31; echo "$a|$G_RC/$(field31 "j.placement")"
}
scen_mc10() { # a stale local main (behind the remote) is no stop; a moved one is (MC2)
  prep31; commit31 src/auth/login.js 'export const login = 1;'
  local clone; clone="$(mktemp -d "$TMP31/clone.XXXXXX")"; git clone -q "$ORIGIN31" "$clone" 2>/dev/null
  git -C "$clone" -c user.name=t -c user.email=t@t commit -q --allow-empty -m "remote moves"; git -C "$clone" push -q origin main 2>/dev/null
  pr31; local g="$G_RC/$(field31 "j.verdict")"
  mc31; echo "$g|$G_RC/$(field31 "j.covered_by.join(',')")/$(reasons31)"
}
scen_mc6() { # no surface: ok without any result
  prep31; commit31 src/util.js 'export const u = 1;'
  mc31; echo "$G_RC/$(field31 "j.ok")/$(field31 "j.placement")"
}
caseMC() {
  assert_eq "MC1 surface diff: blocked without a result, ok with a pass for this head, blocked again after a new commit" "$(scen_mc1)" "1/pr_merge_blocked|0/true/pass|1/pr_merge_blocked"
  assert_eq "MC2 a local ref that differs from the remote blocks the merge" "$(scen_mc2)" "1/local_ref_differs"
  assert_eq "MC3 codex_blocked_fallback is no result on a surface diff; the owner is asked" "$(scen_mc3)" "not_applicable/codex_blocked_fallback|1/blocked_fallback_not_accepted/true"
  assert_eq "MC4 an owner waiver for exactly this head counts" "$(scen_mc4)" "1->0/waiver"
  assert_eq "MC5 a decline without an owner No on the allowlist marker does not count" "$(scen_mc5)" "1/secret_in_snapshot|0/secret_declined|1/secret_declined_without_owner_no"
  assert_eq "MC7 a decline with an owner No recorded by the consent hook counts" "$(scen_mc7)" "0/secret_declined|0/secret_declined"
  assert_eq "MC8 a waiver for head X does not cover head Y" "$(scen_mc8)" "0/waiver|1/pr_merge_blocked"
  assert_eq "MC9 a voided permit blocks a surface diff and names it; a docs-only diff is ok" "$(scen_mc9)" "1/permit_voided/true|0/no_surface"
  assert_eq "MC10 a stale local main is no stop" "$(scen_mc10)" "0/pass|0/pass/"
  assert_eq "MC6 no surface: ok without any result" "$(scen_mc6)" "0/true/no_surface"
  local PMN=xprov-pr-merge.cjs PCN=xprov-pr-cover.cjs
  redproof31 "MC1a" scen_mc1 "1/pr_merge_blocked|0/true/pass|1/pr_merge_blocked" $PCN "if (l.head !== h || !accept(l)" "if (!accept(l)"
  redproof31 "MC1b" scen_mc1 "1/pr_merge_blocked|0/true/pass|1/pr_merge_blocked" $PMN "if (!t.cls.surface) return" "if (true) return"
  redproof31 "MC2a" scen_mc2 "1/local_ref_differs" $PMN "for (const p of t.localProblems) blocked.push" "for (const p of []) blocked.push"
  redproof31 "MC3a" scen_mc3 "not_applicable/codex_blocked_fallback|1/blocked_fallback_not_accepted/true" $PCN "const acceptMerge = (l) => l.kind === KINDS.PASS" "const acceptMerge = (l) => l.kind === KINDS.FALLBACK || l.kind === KINDS.PASS"
  redproof31 "MC5a" scen_mc5 "1/secret_in_snapshot|0/secret_declined|1/secret_declined_without_owner_no" $PCN "(l.kind === KINDS.DECLINED && l.ownerNo === true)" "(l.kind === KINDS.DECLINED)"
  redproof31 "MC7a" scen_mc7 "0/secret_declined|0/secret_declined" xprov-decline.cjs "if (p.state !== M.STATE.ANSWERED ||" "if (true ||"
  redproof31 "MC8a" scen_mc8 "0/waiver|1/pr_merge_blocked" $PCN "if (l.head !== h || !accept(l)" "if (!accept(l)"
  redproof31 "MC9a" scen_mc9 "1/permit_voided/true|0/no_surface" $PMN "const VOIDED_STATES = Object.freeze(['origin_changed', 'unbound_legacy']);" "const VOIDED_STATES = Object.freeze([]);"
  redproof31 "MC10a" scen_mc10 "0/pass|0/pass/" xprov-pr-diff.cjs "if (ownerGit(['-C', workPath, 'merge-base', '--is-ancestor', sha, base]).status === 0) continue;" ""
  redproof31 "MC6a" scen_mc6 "0/true/no_surface" $PMN "return Object.freeze({ ...report, ok: blocked.length === 0, blocked, placement: 'no_surface' });" "return Object.freeze({ ...report, ok: false, blocked, placement: 'no_surface' });"
}
caseMC

# ---------- HP: hostile arguments ----------
hp31() { # <gate args...> — exit code, whether .a1-review exists afterwards, runner calls
  prep31; commit31 src/auth/login.js 'export const login = 1;'
  G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --gate pr-diff-xprov "$@" 2>"$TMP31/err.txt" </dev/null)"; G_RC=$?
  echo "$G_RC/$([[ -e "$PHASE_REPO/.a1-review" ]] && echo wrote || echo clean)/runs$(runs31)"
}
caseHP() {
  prep31
  local W="$PHASE_REPO" LONG; LONG="$(printf 'a%.0s' $(seq 1 10000)).md"
  assert_eq "HP1 traversal in --work-path" "$(hp31 --work-path /tmp/../etc)" "2/clean/runs0"
  assert_eq "HP2 a relative --work-path" "$(hp31 --work-path .)" "2/clean/runs0"
  assert_eq "HP3 injection-shaped --base" "$(hp31 --work-path "$W" --base 'abc;rm -rf /')" "2/clean/runs0"
  assert_eq "HP4 traversal in --spec" "$(hp31 --work-path "$W" --spec ../../etc/passwd.md)" "2/clean/runs0"
  assert_eq "HP5 a 10 000-character --spec" "$(hp31 --work-path "$W" --spec "$LONG")" "2/clean/runs0"
  assert_eq "HP6 --size is refused as on the other gates" "$(hp31 --work-path "$W" --size S)" "2/clean/runs0"
  assert_eq "HP7 --phase is refused for the PR gate" "$(hp31 --work-path "$W" --phase p31)" "2/clean/runs0"
}
caseHP

# ---------- HK: the plugin Bash hook (W10-1): gh pr merge runs only after the merge check exits 0 ----------
# gh is a stub on PATH that answers `pr view` from a JSON file (GH_STUB_JSON); GH_STUB_RC=1 makes it fail.
ghstub31() { # <number> — writes the stub dir and the JSON of the PR for the current HEAD of the feature branch
  GHBIN31="$TMP31/ghbin"; mkdir -p "$GHBIN31"
  printf '#!/usr/bin/env bash\nif [[ "$1 $2" == "pr view" ]]; then [[ "${GH_STUB_RC:-0}" == 0 ]] || exit 1; cat "$GH_STUB_JSON"; exit 0; fi\nexit 1\n' > "$GHBIN31/gh"; chmod +x "$GHBIN31/gh"
  GH_STUB_JSON="$TMP31/gh.json"
  printf '{"number":%s,"headRefOid":"%s","headRefName":"feat","baseRefOid":"%s","baseRefName":"main"}\n' "$1" "$(git -C "$PHASE_REPO" rev-parse feat)" "$(git -C "$ORIGIN31" rev-parse main)" > "$GH_STUB_JSON"
}
# hk31 <command> [cwd] [tree] — one PreToolUse Bash payload through the plugin hook: prints allow | deny:<reason>
hk31() {
  local cmd="$1" cwd="${2:-$PHASE_REPO}" tree="${3:-$TREE}" payload
  payload="$(node -e 'process.stdout.write(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "toolu_hk", session_id: "sess_hk", cwd: process.argv[2], tool_input: { command: process.argv[1] } }))' "$cmd" "$cwd")"
  local out; out="$(printf '%s' "$payload" | env -u A1_VAULT_ROOT PATH="$GHBIN31:$PATH" GH_STUB_JSON="$GH_STUB_JSON" GH_STUB_RC="${GH_STUB_RC:-0}" bash "$tree/hooks/xprov-merge-hook.sh" 2>/dev/null)"; local rc=$?
  [[ $rc -eq 0 ]] || { echo "rc$rc"; return; }
  node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{if(!d.trim()){process.stdout.write("allow");return;}const o=JSON.parse(d).hookSpecificOutput;process.stdout.write(o.permissionDecision+":"+/\(([a-z_]+)\)/.exec(o.permissionDecisionReason)[1]);});' <<< "$out"
}
scen_hk1() { # no result: deny; a pass for this head: allow. The merge is run from the PRIMARY checkout (main), the review lives in the PR's worktree
  prep31; commit31 src/auth/login.js 'export const login = 1;'
  local wt="$TMP31/wt.$RANDOM"; git -C "$PHASE_REPO" checkout -q main; git -C "$PHASE_REPO" worktree add -q "$wt" feat
  ghstub31 7
  local a; a="$(hk31 'gh pr merge 7 --squash --delete-branch' "$PHASE_REPO")"
  FAKE_RUNNER_BIND_PLAN=1 FAKE_RUNNER_CASE=approved FAKE_RUNNER_SEQUENCE='[{}]' FAKE_RUNNER_COUNT_FILE="$COUNT31" FAKE_RUNNER_ARGV_FILE="$TMP31/argv.json" fake_runner_env
  (cd "$wt" && node "$TREE_TOOLS" xprov gate --gate pr-diff-xprov --work-path "$wt" --timeout 7 >/dev/null 2>&1 </dev/null)
  local b; b="$(hk31 'gh pr merge 7 --squash' "$PHASE_REPO")"
  local c; c="$(hk31 'gh pr merge 7' "$wt")"
  echo "$a|$b|$c"
}
scen_hk2() { # a repository that never joined xprov: allow, even when gh cannot answer (only the permit lookup decides)
  prep31; commit31 src/auth/login.js 'export const login = 1;'; rm -rf "$STORE31" "$PHASE_REPO/.a1/xprov.json"
  ghstub31 7; GH_STUB_RC=1 hk31 'gh pr merge 7 --squash'
}
scen_hk3() { # the check exits 2 or 77 (stub a1-tools in a tree copy): deny
  prep31; commit31 src/auth/login.js 'export const login = 1;'; ghstub31 7
  local out="" rc t
  for rc in 2 77 1; do
    t="$(mktemp -d "$TMP31/t3.XXXXXX")"; cp -R "$TREE/_shared" "$TREE/hooks" "$t/"; printf 'process.exit(%s);\n' "$rc" > "$t/_shared/a1-tools.cjs"
    out="$out$(hk31 'gh pr merge 7' "$PHASE_REPO" "$t")|"
  done
  echo "$out"
}
hkprobes31() { # Samuel's probe strings (MC-1..MC-5) and more: every merge intent that is not the canonical form
  local sha; sha="$(printf 'a%.0s' $(seq 1 40))"
  PROBES31=(
    'cd /tmp && gh pr merge 7'
    '(gh pr merge 7)'
    'echo $(gh pr merge 7)'
    'gh pr merge --body "text" 7'
    'gh pr merge 7 --body x'
    'GH_REPO=o/r gh pr merge 7'
    'gh pr merge 7 --repo o/r'
    'gh pr merge 7 -R o/r'
    'gh api -X PUT repos/o/r/pulls/7/merge'
    'gh api repos/o/r/pulls/7/merge -X PUT'
    'gh api graphql -f query="mutation{mergePullRequest(input:{pullRequestId:\"x\"}){clientMutationId}}"'
    'gh pr merge 7 --auto'
    'gh pr merge'
    'gh pr merge 7; ls'
    'bash -c "gh pr merge 7"'
    'eval "gh pr merge 7"'
    'xargs gh pr merge'
    "gh pr merge 7 --match-head-commit ${sha}x"
    'git log --oneline | gh pr merge 7'
    'grep -n merge x <(gh pr merge 7)'
  )
}
scen_hk4() { # every probe is denied as non-canonical; the canonical forms, read-only mentions and other commands pass
  prep31; commit31 src/auth/login.js 'export const login = 1;'; ghstub31 7
  hkprobes31
  local out="" p
  for p in "${PROBES31[@]}"; do out="$out$(hk31 "$p" | sed 's/^deny:merge_not_canonical$/D/;s/^allow$/A/;s/^deny:.*$/d/')"; done
  local sha; sha="$(printf 'a%.0s' $(seq 1 40))"
  echo "$out|$(hk31 'grep "gh pr merge" README.md')|$(hk31 'git log --grep merge')|$(hk31 'git status')|$(hk31 "rg 'gh pr merge' docs")|$(hk31 'git diff HEAD~1')"
}
scen_hk7() { # post-merge verify and other commands that only CONTAIN the letters merge
  prep31; commit31 src/auth/login.js 'export const login = 1;'; ghstub31 7
  echo "$(hk31 'gh pr view 12 --json state,mergedAt')|$(hk31 'gh pr view 12 --json mergeable,mergeStateStatus')|$(hk31 'gh pr list --state merged')|$(hk31 'git merge-base main HEAD && gh pr view 12')|$(hk31 'gh pr create --title t --body-file body.md')"
}
scen_hk8() { # N-1: the branch-merge API (repos/o/r/merges) is merge intent and no canonical form
  prep31; commit31 src/auth/login.js 'export const login = 1;'; ghstub31 7
  echo "$(hk31 'gh api -X POST repos/o/r/merges -f base=main -f head=feat' | sed 's/^deny:merge_not_canonical$/D/')|$(hk31 'gh api repos/o/r/merges --method POST' | sed 's/^deny:merge_not_canonical$/D/')|$(hk31 'gh pr view 12 --json mergedAt')"
}
scen_hk6() { # canonical forms with a passing check are allowed (flags in any order), the PR head sha must be a worktree head
  prep31; commit31 src/auth/login.js 'export const login = 1;'; ghstub31 7
  FAKE_RUNNER_BIND_PLAN=1 FAKE_RUNNER_CASE=approved FAKE_RUNNER_SEQUENCE='[{}]' FAKE_RUNNER_COUNT_FILE="$COUNT31" FAKE_RUNNER_ARGV_FILE="$TMP31/argv.json" fake_runner_env
  (cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --gate pr-diff-xprov --work-path "$PHASE_REPO" --timeout 7 >/dev/null 2>&1 </dev/null)
  local sha; sha="$(git -C "$PHASE_REPO" rev-parse HEAD)"
  echo "$(hk31 'gh pr merge 7')|$(hk31 'gh pr merge 7 --rebase -d')|$(hk31 "gh pr merge 7 --squash --delete-branch --match-head-commit $sha")"
}
scen_hk5() { # node unavailable (PATH without node): a non-merge Bash call is allowed by the shell early-out, a merge payload is denied (exit 2)
  local tree="${1:-$TREE}" nb="$TMP31/nonode"; mkdir -p "$nb"; ln -sf "$(command -v bash)" "$nb/bash"
  local ls_p='{"hook_event_name":"PreToolUse","tool_name":"Bash","cwd":"/tmp","tool_input":{"command":"ls -la && git status"}}'
  local mg_p='{"hook_event_name":"PreToolUse","tool_name":"Bash","cwd":"/tmp","tool_input":{"command":"gh pr merge 7 --squash"}}'
  local a b
  printf '%s' "$ls_p" | env -i PATH="$nb" "$nb/bash" "$tree/hooks/xprov-merge-hook.sh" >/dev/null 2>&1; a=$?
  printf '%s' "$mg_p" | env -i PATH="$nb" "$nb/bash" "$tree/hooks/xprov-merge-hook.sh" >/dev/null 2>&1; b=$?
  echo "$a|$b"
}
caseHK() {
  assert_eq "HK1 gh pr merge: denied without a result, allowed with a pass for the head (run from the primary checkout)" "$(scen_hk1)" "deny:merge_blocked|allow|allow"
  assert_eq "HK2 a repository without a permit: allow, whatever gh says" "$(scen_hk2)" "allow"
  assert_eq "HK3 the merge check exits 2 / 77 / 1: deny (fail closed)" "$(scen_hk3)" "deny:merge_blocked|deny:merge_blocked|deny:merge_blocked|"
  assert_eq "HK4 every probe string (cd, grouping, substitution, flag values, GH_REPO, --repo, gh api, GraphQL, wrappers) is denied as non-canonical; read-only mentions and other commands pass" "$(scen_hk4)" "DDDDDDDDDDDDDDDDDDDD|allow|allow|allow|allow|allow"
  assert_eq "HK7 whole-word intent: mergedAt, mergeable, merged, merge-base and --body-file are no merge intent (the a1-pr-review verify step passes)" "$(scen_hk7)" "allow|allow|allow|allow|allow"
  assert_eq "HK8 the branch-merge API path /merges is merge intent and denied" "$(scen_hk8)" "D|D|allow"
  assert_eq "HK6 the canonical forms are allowed when the merge check passes" "$(scen_hk6)" "allow|allow|allow"
  assert_eq "HK5 node unavailable: a non-merge Bash call is allowed (shell early-out), a merge payload is denied (exit 2)" "$(scen_hk5)" "0|2"
  local mut5; mtree31 xprov-hook-merge.cjs "const CHECK_TIMEOUT_MS = 90000;" "const CHECK_TIMEOUT_MS = 90000;"
  sed -i.bak 's/^  \*) exit 0 ;;$/  *) ;;/' "$TREE/hooks/xprov-merge-hook.sh"; mut5="$(scen_hk5 "$TREE")"; unmtree31
  [[ "$mut5" != "0|2" ]] && ok "HK5a RED [mutant]: with the early-out removed the outcome flips ('0|2' -> '$mut5')" || bad "HK5a RED [mutant]: the guard is dead, the mutant still gives '$mut5'"
  local HMN=xprov-hook-merge.cjs
  redproof31 "HK1a" scen_hk1 "deny:merge_blocked|allow|allow" $HMN "if (r.status === 0) return allow();" "return allow();"
  redproof31 "HK2a" scen_hk2 "allow" $HMN "return state === STATES.ABSENT || state === STATES.DENIED;" "return false;"
  redproof31 "HK3a" scen_hk3 "deny:merge_blocked|deny:merge_blocked|deny:merge_blocked|" $HMN "if (r.status === 0) return allow();" "if (r.status === 0 || r.status === 2 || r.status === 77) return allow();"
  redproof31 "HK4a" scen_hk4 "DDDDDDDDDDDDDDDDDDDD|allow|allow|allow|allow|allow" $HMN "return readOnlyMention(text) ? { kind: 'readonly' } : { kind: 'other' };" "return { kind: 'readonly' };"
  redproof31 "HK4b" scen_hk4 "DDDDDDDDDDDDDDDDDDDD|allow|allow|allow|allow|allow" $HMN "  return segments.length > 0 && segments.every(" "  return false && segments.every("
  redproof31 "HK7a" scen_hk7 "allow|allow|allow|allow|allow" $HMN "const MERGE_WORD_RE = /(?<![\\w-])merges?(?![\\w-])|mergePullRequest|enablePullRequestAutoMerge/;" "const MERGE_WORD_RE = /merge|mergePullRequest|enablePullRequestAutoMerge|Merge/;"
  redproof31 "HK8a" scen_hk8 "D|D|allow" $HMN "/(?<![\\w-])merges?(?![\\w-])|mergePullRequest" "/(?<![\\w-])merge(?![\\w-])|mergePullRequest"
  redproof31 "HK6a" scen_hk6 "allow|allow|allow" $HMN "const CANONICAL_RE = /^gh pr merge ([1-9][0-9]{0,8})((?: --squash| --merge| --rebase| --delete-branch| -d| --match-head-commit [0-9a-f]{40})*)\$/;" "const CANONICAL_RE = /^nothing\$/;"
}
caseHK
