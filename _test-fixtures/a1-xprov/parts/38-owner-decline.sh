#!/usr/bin/env bash
# Part 38 — spec 028 Wave 6 (FR-022, FR-023, FR-024): the owner decline of one unrun plan-review-xprov target
# (`xprov consent question|ensure --kind decline --phase <name>`, `xprov consent decline --phase <name>`). Sourced by run-tests.sh.
# FR-022 the question names repo, phase, target, PLAN.md sha and head, says nothing goes to Codex, carries the two labels; a row at the current sha
#        refuses `target_already_run`; design-review-xprov is not offered.
# FR-023 only a recorded canonical yes (claimDecision, marker bound to the question hash) writes marker `a1-declined.json` (kind owner_declined) and the
#        index row {accepted: owner_declined}; any other answer is `decline_not_confirmed`; the second call is `already_declined`; a moved head or an
#        edited PLAN.md changes the question; load-check then reads the plan as accepted without Codex.
# FR-024 `.a1/xprov.json`, the permit store and the waiver store stay byte-identical; the waiver kind still refuses `no_failed_targets`.
# No case sets `.a1/xprov.json` through an agent path: the fixture plants it as the human-written precondition, as the other parts do.
# Everything runs under the suite HOME (the real ~/.a1-xprov is compared by the harness). The mutant arms run on tree copies only.
#   OD3   Red if buildFor() in xprov-consent-decline.cjs stops refusing a target that has a row at the current sha        [M1]
#   OD4   Red if decline() writes without the recorded yes (the claim result is ignored)                                   [M2]

mk_workdir TMP38 "a1x38"
[[ -n "$TMP38" && -d "$TMP38" ]] || { echo "FAIL  part 38: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
export HOME="$TMP38/home"; mkdir -p "$HOME"
ORG38=https://github.com/N3URAL-A1/fixture.git
TPL38="$CASES/consent"
SIM38="$FAKE/consent-sim.cjs"
NO38="Nein, Codex-Prüfung wie vorgesehen"   # literals of the canonical labels (No label first)
YES38="Ja, für dieses Ziel nichts an Codex senden"
GATE38=plan-review-xprov

make_tree; T38="$TREE"; T38_TOOLS="$TREE_TOOLS"

prep38() { make_phase p38; rm -rf "$HOME/.a1-xprov"; git -C "$PHASE_REPO" remote add origin "$ORG38"; return 0; }
cli38() { G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov consent "$@" 2>"$TMP38/err.txt" </dev/null)"; G_RC=$?; G_ERR="$(cat "$TMP38/err.txt")"; }
sim38() { SIM_OUT="$(node "$SIM38" "$1" 2>"$TMP38/sim.err")"; SIM_RC=$?; }
ask38() { sim38 "{\"cmd\":\"ask\",\"tree\":\"$TREE\",\"root\":\"$PHASE_REPO\",\"kind\":\"decline\",\"phase\":\"p38\",\"tool_use\":\"${1:-toolu_d}\",\"session\":\"${2:-sess_1}\"}"; }
ans38() { sim38 "{\"cmd\":\"answer\",\"tree\":\"$TREE\",\"root\":\"$PHASE_REPO\",\"kind\":\"decline\",\"phase\":\"p38\",\"mode\":\"$1\",\"text\":\"vielleicht\",\"tool_use\":\"${2:-toolu_d}\",\"session\":\"${3:-sess_1}\",\"template\":\"$TPL38/post-tool-use.answers.template.json\"}"; }
yes38() { ask38; ans38 yes; }
dec38() { cli38 decline --phase p38; }
sha38() { node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"; }
# state38 — one hash over the index file and every file below the artifacts dir (names and bytes): "nothing written" is a byte comparison
state38() {
  node -e '
    const fs = require("fs"), path = require("path"), crypto = require("crypto"); const h = crypto.createHash("sha256");
    const walk = (d) => { if (!fs.existsSync(d)) return; for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); const st = fs.lstatSync(p);
      if (st.isDirectory()) { h.update("D" + p + "\n"); walk(p); } else h.update("F" + p + "\n" + fs.readFileSync(p)); } };
    walk(process.argv[1] + "/.a1-xprov/artifacts"); const ix = process.argv[2];
    h.update(fs.existsSync(ix) ? fs.readFileSync(ix) : "(no index)"); process.stdout.write(h.digest("hex"));
  ' "$HOME" "$PHASE_DIR/xreview/index.json"
}
declined_dirs38() { find "$HOME/.a1-xprov/artifacts" -maxdepth 2 -type d -name 'declined-*' 2>/dev/null | wc -l | tr -d ' '; }
# plant38 — a row of the gate at the CURRENT PLAN.md sha (the target "has run"): the row is a pointer, any row at gate and sha counts
plant38() {
  mkdir -p "$PHASE_DIR/xreview"
  node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify([{ gate: "plan-review-xprov", wave: null, lane: null, verdict: "pass", plan_sha256: process.argv[2], result_path: "/nowhere/result.json", ts: "2026-11-14T00:00:00.000Z" }], null, 2) + "\n")' "$PHASE_DIR/xreview/index.json" "$(sha38 "$PHASE_PLAN")"
}
# plant_stores38 — the three files FR-024 keeps byte-identical; .a1/xprov.json is the human-written precondition (planted by the fixture, never by a1)
plant_stores38() {
  mkdir -p "$HOME/.a1-xprov" "$PHASE_REPO/.a1"
  printf '{"external_review":"allowed","decided_by":"fixture"}\n' > "$PHASE_REPO/.a1/xprov.json"
  printf '{"version":1,"permits":{}}\n' > "$HOME/.a1-xprov/permits.json"
  printf '{"version":1,"waivers":[]}\n' > "$HOME/.a1-xprov/waivers.json"
}
stores_sum38() { local f; for f in "$PHASE_REPO/.a1/xprov.json" "$HOME/.a1-xprov/permits.json" "$HOME/.a1-xprov/waivers.json"; do sha38 "$f"; done | tr -d '\n'; }
reason38() { json_get "$G_OUT" "j.reason"; }

# ---------- OD1/OD2: the canonical decline question (FR-022) ----------
caseOD1() {
  prep38; cli38 question --kind decline --phase p38
  assert_rc "OD1 question --kind decline exits 0" 0 "$G_RC" "$G_ERR"
  assert_json "OD1 header, two labels (No first), one question, multiSelect false" "$G_OUT" "[j.kind, j.labels.length, j.labels[0], j.labels[1], j.multiSelect, j.options.length].join('|')" "decline|2|$NO38|$YES38|false|2"
  assert_json "OD1 the question names repo, phase, target and PLAN.md sha256, and makes no claim about the head (review round m4)" "$G_OUT" \
    "[j.question.includes('Repo: '), j.question.includes('Phase: p38'), j.question.includes('$GATE38'), j.question.includes('$(sha38 "$PHASE_PLAN")'), !j.question.includes('$PHASE_HEAD'), !/Head:/.test(j.question)].every(Boolean)" "true"
  assert_json "OD1 the question says nothing is sent to Codex" "$G_OUT" "/nichts an Codex gesendet/.test(j.question)" "true"
  local first="$G_OUT"; cli38 question --kind decline --phase p38
  assert_eq "OD1 deterministic: same state, same bytes" "$G_OUT" "$first"
  cli38 ensure --kind decline --phase p38
  assert_json "OD1 ensure with no answer: not ready, ask = true" "$G_OUT" "[j.ok, j.ask, j.kind].join('|')" "false|true|decline"
  cli38 question --kind decline; assert_rc "OD1 --phase is required (exit 2)" 2 "$G_RC"
  cli38 question --kind decline --phase p38 --scan snap-x; assert_rc "OD1 --scan does not belong to the decline kind (exit 2)" 2 "$G_RC"
  cli38 question --kind decline --phase p38 --gate design-review-xprov; assert_rc "OD2 the target is never an argument: design-review-xprov is not offered (exit 2)" 2 "$G_RC"
  cli38 record --kind decline; assert_rc "OD1 consent record does not take the decline kind (exit 2)" 2 "$G_RC"
}
caseOD1

# ---------- OD3: a target that already has a row at the current sha ----------
scen_od3() { prep38; plant38; cli38 question --kind decline --phase p38; echo "$G_RC|$(reason38)"; }
caseOD3() {
  prep38; plant38; local before; before="$(state38)"
  cli38 question --kind decline --phase p38
  assert_rc "OD3 question with a row at the current sha exits 1" 1 "$G_RC"
  assert_json "OD3 reason target_already_run" "$G_OUT" "j.reason" "target_already_run"
  cli38 ensure --kind decline --phase p38; assert_json "OD3 ensure refuses too" "$G_OUT" "j.reason" "target_already_run"
  dec38
  assert_rc "OD3 decline exits 1" 1 "$G_RC"
  assert_json "OD3 decline reason target_already_run" "$G_OUT" "j.reason" "target_already_run"
  [[ "$(state38)" == "$before" && "$(declined_dirs38)" == 0 ]] && ok "OD3 nothing written: no marker dir, no new row (artifacts and index byte-identical)" || bad "OD3 a marker or row appeared"
}
caseOD3
# redproof38 <name> <scenario fn> <expected on the real tree> <lib-file> <from> <to>: the mutant (a tree copy) must give another value
redproof38() {
  local name="$1" fn="$2" want="$3" file="$4" from="$5" to="$6" got mut
  got="$($fn)"
  [[ "$got" == "$want" ]] || { bad "$name: real tree gave '$got', wanted '$want'"; return 0; }
  make_tree
  node -e '
    const fs = require("fs"); const [tree, name, from, to] = process.argv.slice(1);
    const f = tree + "/_shared/lib/" + name; const s = fs.readFileSync(f, "utf8"); const n = s.split(from).length - 1;
    if (n !== 1) { console.error("mutation needle count " + n + " in " + name + ": " + from.slice(0, 60)); process.exit(3); }
    fs.writeFileSync(f, s.replace(from, () => to));
  ' "$TREE" "$file" "$from" "$to" || bad "OD harness: mutation failed in $file"
  mut="$($fn)"; TREE="$T38"; TREE_TOOLS="$T38_TOOLS"
  [[ "$mut" != "$want" ]] && ok "$name RED [mutant]: with the production change the outcome flips ('$want' -> '$mut')" || bad "$name RED [mutant]: the guard is dead, the mutant still gives '$mut'"
}
redproof38 "OD3" scen_od3 "1|target_already_run" xprov-consent-decline.cjs "if (ran) return" "if (false) return"

# ---------- OD4: yes -> marker, row, load-check; the second call (FR-023, FR-024) ----------
scen_od4() { prep38; cli38 decline --phase p38; echo "$G_RC|$(reason38)|$(declined_dirs38)"; }
caseOD4() {
  prep38; plant_stores38; local sum; sum="$(stores_sum38)"
  ask38; ans38 yes
  assert_json "OD4 the round trip answered yes" "$SIM_OUT" "j.decision" "yes"
  dec38
  assert_rc "OD4 decline exits 0" 0 "$G_RC" "$G_ERR"
  assert_json "OD4 accepted owner_declined, bound to the gate, the PLAN.md sha and the head" "$G_OUT" "[j.ok, j.accepted, j.gate, j.plan_sha256 === '$(sha38 "$PHASE_PLAN")', j.head === '$PHASE_HEAD'].join('|')" "true|owner_declined|$GATE38|true|true"
  local mfile; mfile="$(find "$HOME/.a1-xprov/artifacts" -path '*declined-*' -name a1-declined.json | head -1)"
  [[ -f "$mfile" ]] && ok "OD4 marker a1-declined.json in a declined- run dir" || bad "OD4 no marker file"
  assert_json "OD4 marker kind owner_declined, no verdict" "$(cat "$mfile")" "[j.kind, j.gate, j.wave, j.lane, j.plan_sha256 === '$(sha38 "$PHASE_PLAN")', j.head === '$PHASE_HEAD', 'verdict' in j].join('|')" "owner_declined|$GATE38|||true|true|false"
  local idx; idx="$(cat "$PHASE_DIR/xreview/index.json")"
  assert_json "OD4 one index row {accepted: owner_declined} without a verdict" "$idx" "[j.length, j[0].accepted, j[0].gate, j[0].plan_sha256 === '$(sha38 "$PHASE_PLAN")', 'verdict' in j[0], j[0].result_path === '$mfile'].join('|')" "1|owner_declined|$GATE38|true|false|true"
  local lc; lc="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov load-check --phase p38 2>"$TMP38/lc.err" </dev/null)"
  assert_json "OD4 load-check reads the target as accepted: owner_declined" "$lc" "[j.ok, j.accepted].join('|')" "true|owner_declined"
  [[ "$(cat "$TMP38/lc.err")" == *"owner declined"* ]] && ok "OD4 load-check notice names the owner decline" || bad "OD4 load-check notice: $(cat "$TMP38/lc.err")"
  # FR-024: the stores are byte-identical, no waiver exists, a waiver question still refuses
  [[ "$(stores_sum38)" == "$sum" ]] && ok "OD4 .a1/xprov.json, permit store and waiver store are byte-identical" || bad "OD4 a store changed"
  cli38 question --kind waiver --phase p38
  assert_json "OD4 the waiver kind still refuses no_failed_targets" "$G_OUT" "j.reason" "no_failed_targets"
  # the second call: already_declined, exit 0, nothing written (the marker is used; no new question is needed)
  local before; before="$(state38)"
  dec38
  assert_rc "OD4 second decline exits 0" 0 "$G_RC" "$G_ERR"
  assert_json "OD4 second decline reason already_declined" "$G_OUT" "[j.ok, j.reason].join('|')" "true|already_declined"
  [[ "$(state38)" == "$before" && "$(declined_dirs38)" == 1 ]] && ok "OD4 the second call wrote nothing" || bad "OD4 the second call wrote something"
}
caseOD4
redproof38 "OD4" scen_od4 "1|decline_not_confirmed|0" xprov-consent-decline.cjs "if (!claim.ok) return" "if (false) return"

# ---------- OD5: any other answer, a changed question ----------
caseOD5() {
  local mode before
  for mode in no free none; do
    prep38; before="$(state38)"; ask38; ans38 "$mode"; dec38
    assert_rc "OD5 answer '$mode': decline exits 1" 1 "$G_RC"
    assert_json "OD5 answer '$mode': decline_not_confirmed" "$G_OUT" "j.reason" "decline_not_confirmed"
    [[ "$(state38)" == "$before" && "$(declined_dirs38)" == 0 ]] && ok "OD5 answer '$mode': nothing written" || bad "OD5 answer '$mode': something was written"
  done
  prep38; dec38
  assert_json "OD5 no question asked at all: decline_not_confirmed" "$G_OUT" "j.reason" "decline_not_confirmed"
  # an edited PLAN.md after the yes: the question changes, nothing is written, a new question is needed
  prep38; yes38; printf '\nAn edit after the owner said yes.\n' >> "$PHASE_PLAN"; before="$(state38)"; dec38
  assert_json "OD5 PLAN.md edited after the yes: decline_not_confirmed" "$G_OUT" "j.reason" "decline_not_confirmed"
  [[ "$(state38)" == "$before" && "$(declined_dirs38)" == 0 ]] && ok "OD5 edited PLAN.md: nothing written" || bad "OD5 edited PLAN.md: something was written"
  # a moved head after the yes: the decline binds the PLAN.md content, not the head (review round m4)
  prep38; yes38; git -C "$PHASE_REPO" commit -q --allow-empty -m "moved head"; dec38
  assert_json "OD5 head moved after the yes: the yes still stands (bound to the PLAN.md sha, not the head)" "$G_OUT" "[j.ok, j.accepted].join('|')" "true|owner_declined"
  prep38; cli38 question --kind decline --phase p38; local q1="$G_OUT"; git -C "$PHASE_REPO" commit -q --allow-empty -m "moved head again"; cli38 question --kind decline --phase p38
  assert_eq "OD5 the question (text and hash) is byte-identical after the head moves" "$q1" "$G_OUT"
}
caseOD5

# ---------- OD6: no Codex, no store writer; the hook knows the kind (FR-024) ----------
caseOD6() {
  prep38; plant_stores38; yes38 >/dev/null
  # the two store writers of the other consent paths are made to throw inside the tree copy: a decline that reaches either of them fails
  local out; out="$(cd "$PHASE_REPO" && TREE="$TREE" node -e '
    const lib = (n) => require(process.env.TREE + "/_shared/lib/" + n);
    const AP = lib("xprov-approve.cjs"); const WV = lib("xprov-waivers.cjs"); let touched = 0;
    AP.writeGuardedStore = () => { touched++; throw new Error("writeGuardedStore reached"); };
    WV.appendWaivers = () => { touched++; throw new Error("appendWaivers reached"); };
    const r = lib("xprov-consent-decline.cjs").decline({ root: process.cwd(), phase: "p38" });
    process.stdout.write(JSON.stringify({ ok: r.ok, accepted: r.accepted, touched }));
  ' 2>&1 </dev/null)"
  assert_json "OD6 decline with both store writers poisoned still succeeds and never calls them" "$out" "[j.ok, j.accepted, j.touched].join('|')" "true|owner_declined|0"
  # the hook of wave 4 recomputes the canonical question from its text and compares byte for byte
  prep38
  cli38 question --kind decline --phase p38 >/dev/null
  local hook; hook="$(cd "$PHASE_REPO" && TREE="$TREE" QTEXT="$(json_get "$G_OUT" "j.question")" node -e '
    const H = require(process.env.TREE + "/_shared/lib/xprov-hook-rules.cjs"); const r = H.rebuild("decline", process.env.QTEXT);
    process.stdout.write(JSON.stringify({ kind: r.kind || null, action: r.action || null, same: r.q ? r.q.question === process.env.QTEXT : null }));
  ' 2>&1 </dev/null)"
  assert_json "OD6 the hook rules rebuild the decline question byte for byte" "$hook" "[j.kind, j.action, j.same].join('|')" "decline||true"
}
caseOD6

# ---------- OD7/OD8: review round m4 ----------
# OD7: a row for the target appears between the question build and the owner-store lock (the window the lock exists for): refuse, write nothing.
# The real exported decline() runs; only the lock wrapper plants the row, exactly once, right before the locked body.
caseOD7() {
  prep38; yes38 >/dev/null; local before out; before="$(state38)"
  out="$(cd "$PHASE_REPO" && TREE="$TREE" PLAN_SHA="$(sha38 "$PHASE_PLAN")" IDX="$PHASE_DIR/xreview/index.json" node -e '
    const fs = require("fs"), path = require("path"); const lib = (n) => require(process.env.TREE + "/_shared/lib/" + n);
    const R = lib("xprov-consent-record.cjs"); const orig = R.locked;
    R.locked = (fn) => orig(() => {
      fs.mkdirSync(path.dirname(process.env.IDX), { recursive: true });
      fs.writeFileSync(process.env.IDX, JSON.stringify([{ gate: "plan-review-xprov", wave: null, lane: null, verdict: "pass", plan_sha256: process.env.PLAN_SHA, result_path: "/nowhere/result.json", ts: "2026-11-14T00:00:00.000Z" }]) + "\n");
      return fn();
    });
    const r = lib("xprov-consent-decline.cjs").decline({ root: process.cwd(), phase: "p38" });
    process.stdout.write(JSON.stringify({ ok: r.ok, reason: r.reason || null }));
  ' 2>&1 </dev/null)"
  assert_json "OD7 a row appearing after the build and before the lock: refused target_already_run" "$out" "[j.ok, j.reason].join('|')" "false|target_already_run"
  [[ "$(declined_dirs38)" == 0 ]] && ok "OD7 no marker dir written" || bad "OD7 a marker dir was written"
  local idx; idx="$(cat "$PHASE_DIR/xreview/index.json")"
  assert_json "OD7 the index keeps only the planted row (no owner_declined row)" "$idx" "j.map(e=>e.accepted||e.verdict).join()" "pass"
}
caseOD7
# OD8: an owner_declined row never clears open findings (fail_with_findings at the same sha), like the outage path (SEC-3)
caseOD8() {
  prep38; plant_stores38; yes38 >/dev/null; dec38
  node -e '
    const fs = require("fs"); const ix = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    ix.push({ gate: "plan-review-xprov", wave: null, lane: null, verdict: "fail-with-findings", plan_sha256: ix[0].plan_sha256, result_path: "/nowhere/result.json", ts: "2026-11-14T00:00:01.000Z" });
    fs.writeFileSync(process.argv[1], JSON.stringify(ix, null, 2) + "\n");
  ' "$PHASE_DIR/xreview/index.json"
  local lc; lc="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov load-check --phase p38 2>/dev/null </dev/null)"
  assert_json "OD8 owner_declined row plus a fail_with_findings row at the same sha: load-check does not accept the plan" "$lc" "[j.ok, j.accepted === 'owner_declined'].join('|')" "false|false"
}
caseOD8

rm -rf "$TMP38"
