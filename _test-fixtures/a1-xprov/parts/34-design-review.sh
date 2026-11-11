#!/usr/bin/env bash
# Part 34 — spec 025 Wave 5: the `design-review-xprov` gate (`xprov gate --gate design-review-xprov --phase <p> --doc <path>`).
# Sourced by run-tests.sh. Every expectation is a literal; nothing is imported from the module under test. The body hash of
# cases/design/adr.md was computed with an independent rule (strip frontmatter, trim every line, drop blank lines, sha256 of the
# lines joined by \n; the case files hold no fenced code) before any gate code existed.
#
# Arm -> the single production change that turns it red:
#   D1  first run passes, index entry carries doc + doc_body_sha256          Red if the entry lacks the doc fields or the hash differs from the independent rule.
#   D2  unchanged re-run: 0 runner calls                                     Red if the pass lookup is dropped.
#   D3  frontmatter-only edit: 0 calls                                       Red if the hash covers the frontmatter.
#   D4  whitespace-only edit: 0 calls                                        Red if the hash is not whitespace normalized.
#   D5  body edit: exactly 1 new call, new hash                              Red if the hash ignores the body.
#   D6  pass reused from ANOTHER phase's index                               Red if the lookup reads the current phase only.
#   D7  plan gate re-run on an unchanged PLAN.md: 0 calls                    Red if the plan reuse is lost.
#   D8  unchanged fail-with-findings is reused (0 calls, findings path), body edit re-sends, malformed retries   Red if findRecorded reuses passes only, or reuses a non-verdict.
#   D9  planted secret -> secret_in_snapshot, 0 calls; tripwire -> tripwire  Red if the doc skips the snapshot scan or the tripwire path.
#   D10 snapshot holds only the named file                                   Red if the whole tree goes into the snapshot.
#   D11 no permit: design and plan gate side by side                         Red if the design gate skips the permit branch.
#   D12 --doc validation: missing, absolute, `..`, outside globs, missing file, directory, symlink out of repo / out of globs -> exit 2, nothing written.
#   D13 static: gate id list, registry row (warning, permitted-repos), plan row blocking.
#   D14 forged index rows: plan pass as design pass, design pass of x.md for another doc, design run dir for the plan gate   Red if findPass/planPassValid stop checking marker gate + doc + hash (mutation-proved on a snapshot).
#   D15 frontmatter: non-YAML dashes block and oversize block are body                                              Red if FRONTMATTER_RE alone decides.
#   D16 snapshot + input copy come from the bytes already read                                                      Red if cloneOnly/copyInputs re-read the disk file.
#   D18 only `key: scalar` lines (<= 200 chars) are frontmatter; lists, comments, continuations, block scalars are body   Red if the shape check is dropped (mutant in the case).
#   D19 readPinned: dev/ino of the opened descriptor must equal the checked lstat                                      Red if the comparison is dropped.
#   D20 design gate without gitleaks: preflight_failed, 0 calls                                                        Red if the blocking-only gitleaks check returns.
#   D21 reused REVISE: findings path = intact xreview copy, else the run-dir record; round must be an integer >= 1   Red if either check is dropped (mutants in the case).
#   D17 hardlinked doc, ./ and // and whitespace spellings are usage errors                                         Red if resolveDoc skips nlink or the spelling check.

mk_workdir TMP34 tmp34
SAVED_HOME_34="$HOME"
export HOME="$TMP34/home"; mkdir -p "$HOME/.codex"; printf '{"fixture":true}\n' > "$HOME/.codex/auth.json"; chmod 600 "$HOME/.codex/auth.json"
SNAPS34="$HOME/.a1-xprov/snapshots"
GATE_DESIGN="design-review-xprov"
DESIGN_CASES="$CASES/design"
COUNT34="$TMP34/count.txt"
# independent expected hash of the body of cases/design/adr.md (and of its frontmatter-only and whitespace variants)
ADR_BODY_SHA="3f2b9d053a83c8ae365912e85648c829dc4c6729201a513ed147fbad66431129"
ADR_CHANGED_SHA="f3fcd4584e52e25c056728647df2f067a95156a4fc29212cfd67fc5df44775aa"

# prep34 — fresh tree, phase repo p34 with PLAN.md, src/add.js and docs/adr/x.md (cases/design/adr.md), permit, compliant home.
prep34() {
  make_tree; make_phase p34
  mkdir -p "$PHASE_REPO/docs/adr"; cp "$DESIGN_CASES/adr.md" "$PHASE_REPO/docs/adr/x.md"
  ( cd "$PHASE_REPO" && git add -A && git commit -qm "fixture: adr" )
  write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md
  make_home; ln -s "$HOME/.codex/auth.json" "$XHOME/auth.json"; export A1_XPROV_CODEX_HOME="$XHOME"
  rm -f "$HOME/.a1-xprov/waivers.json" "$COUNT34"
}

# gate34 <phase> <gate> [flags…] — `xprov gate` from inside $PHASE_REPO; counts every runner call in $COUNT34.
# Sets G_OUT, G_ERR, G_RC. Extra FAKE_RUNNER_* knobs travel as env prefixes of the call.
gate34() {
  local phase="$1" gate="$2"; shift 2
  FAKE_RUNNER_CASE="${FAKE_RUNNER_CASE:-approved}" FAKE_RUNNER_BIND_PLAN="${FAKE_RUNNER_BIND_PLAN:-1}" FAKE_RUNNER_COUNT_FILE="$COUNT34" FAKE_RUNNER_SEQUENCE='[{}]' fake_runner_env
  G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --phase "$phase" --gate "$gate" --timeout 7 "$@" 2>"$TMP34/err.txt")"; G_RC=$?
  G_ERR="$(cat "$TMP34/err.txt")"
}
design34() { local doc="$1"; shift; gate34 p34 "$GATE_DESIGN" --doc "$doc" "$@"; }
calls34() { if [[ -f "$COUNT34" ]]; then wc -l < "$COUNT34" | tr -d ' '; else echo 0; fi; }
snaps34() { ls -d "$SNAPS34"/snap-* 2>/dev/null | wc -l | tr -d ' '; }
index34() { cat "$PHASE_REPO/.a1/phases/${1:-p34}/xreview/index.json" 2>/dev/null || echo '[]'; }
# nothing34 <phase> — the phase dir holds no log and no xreview/ (a refusal or no-permit result writes nothing)
nothing34() { [[ ! -e "$PHASE_REPO/.a1/phases/$1/PLAN-REVIEW-LOG.md" && ! -e "$PHASE_REPO/.a1/phases/$1/xreview" ]]; }

# ---------- D1-D8: one phase repo, the life of one ADR ----------
caseD1() {
  prep34
  design34 docs/adr/x.md
  assert_rc "D1 first design review exits 0" 0 "$G_RC" "$G_ERR"
  assert_json "D1 verdict pass, step normalize, enforcement warning (registry row), gate id echoed" "$G_OUT" "[j.verdict, j.step, j.enforcement, j.gate].join('/')" "pass/normalize/warning/$GATE_DESIGN"
  assert_eq "D1 exactly one runner call" "$(calls34)" "1"
  assert_json "D1 index entry: gate, doc, doc_body_sha256 (independent rule), verdict pass" "$(index34)" "j.length + '/' + [j[0].gate, j[0].doc, j[0].doc_body_sha256, j[0].verdict].join('/')" "1/$GATE_DESIGN/docs/adr/x.md/$ADR_BODY_SHA/pass"
  assert_eq "D1 the snapshot was removed" "$(snaps34)" "0"
  [[ -f "$PHASE_REPO/.a1/phases/p34/PLAN-REVIEW-LOG.md" ]] && ok "D1 the run is logged in the phase dir" || bad "D1 no PLAN-REVIEW-LOG.md entry"

  # D2: the same body again
  design34 docs/adr/x.md
  assert_rc "D2 unchanged re-run exits 0" 0 "$G_RC" "$G_ERR"
  assert_eq "D2 unchanged re-run makes no runner call (count stays 1)" "$(calls34)" "1"
  assert_json "D2 …and returns the recorded verdict pass" "$G_OUT" "j.verdict" "pass"
  assert_json "D2 …and writes no second index entry" "$(index34)" "j.length" "1"

  # D3: frontmatter only
  cp "$DESIGN_CASES/adr-frontmatter-only.md" "$PHASE_REPO/docs/adr/x.md"
  design34 docs/adr/x.md
  assert_eq "D3 a frontmatter-only edit makes no runner call (count stays 1)" "$(calls34)" "1"
  assert_json "D3 …verdict pass" "$G_OUT" "j.verdict" "pass"

  # D4: whitespace and indentation only
  cp "$DESIGN_CASES/adr-whitespace.md" "$PHASE_REPO/docs/adr/x.md"
  design34 docs/adr/x.md
  assert_eq "D4 a whitespace-only edit makes no runner call (count stays 1)" "$(calls34)" "1"
  assert_json "D4 …verdict pass" "$G_OUT" "j.verdict" "pass"

  # D5: the body changes
  cp "$DESIGN_CASES/adr-body-change.md" "$PHASE_REPO/docs/adr/x.md"
  design34 docs/adr/x.md
  assert_rc "D5 a body edit is reviewed again (exit 0)" 0 "$G_RC" "$G_ERR"
  assert_eq "D5 a body edit makes exactly one new runner call (count 2)" "$(calls34)" "2"
  assert_json "D5 the new entry carries the new body hash" "$(index34)" "j.length + '/' + j[1].doc_body_sha256" "2/$ADR_CHANGED_SHA"

  # D6: the same body, looked up from ANOTHER phase
  mkdir -p "$PHASE_REPO/.a1/phases/p34b"
  gate34 p34b "$GATE_DESIGN" --doc docs/adr/x.md
  assert_rc "D6 the same body in another phase exits 0" 0 "$G_RC" "$G_ERR"
  assert_eq "D6 …and is answered from the earlier phase's pass (count stays 2)" "$(calls34)" "2"
  assert_json "D6 …verdict pass, step reuse" "$G_OUT" "j.verdict + '/' + j.step" "pass/reuse"
  assert_json "D6 …and the other phase's index gets no new entry" "$(index34 p34b)" "j.length" "0"

  # D7: the plan gate on an unchanged PLAN.md
  FAKE_RUNNER_BIND_PLAN=0 gate34 p34 plan-review-xprov
  assert_rc "D7 plan gate first run exits 0" 0 "$G_RC" "$G_ERR"
  assert_eq "D7 plan gate first run: one more runner call (count 3)" "$(calls34)" "3"
  FAKE_RUNNER_BIND_PLAN=0 gate34 p34 plan-review-xprov
  assert_eq "D7 plan gate on the unchanged PLAN.md makes no runner call (count stays 3)" "$(calls34)" "3"
}

caseD8() {
  prep34
  cp "$DESIGN_CASES/adr-body-change.md" "$PHASE_REPO/docs/adr/y.md"
  FAKE_RUNNER_CASE=revise design34 docs/adr/y.md
  assert_rc "D8 a REVISE is a fail exit (1)" 1 "$G_RC"
  assert_json "D8 verdict fail-with-findings, no next round offered" "$G_OUT" "j.verdict + '/' + String(j.next)" "fail-with-findings/null"
  assert_eq "D8 first review: one runner call" "$(calls34)" "1"
  local first_findings; first_findings="$(json_get "$G_OUT" "j.findings_path")"
  [[ -f "$first_findings" ]] && ok "D8 the first run wrote a findings file" || bad "D8 no findings file at '$first_findings'"
  # FR-014: an unchanged doc with a recorded REVISE is answered from it (0 runner calls), findings included
  FAKE_RUNNER_CASE=revise design34 docs/adr/y.md
  assert_rc "D8 the unchanged failed doc is still a fail exit (1)" 1 "$G_RC"
  assert_eq "D8 an unchanged failed doc is not re-sent: still one runner call" "$(calls34)" "1"
  assert_json "D8 …verdict fail-with-findings, step reuse, no next round" "$G_OUT" "[j.verdict, j.step, j.reason_detail, String(j.next)].join('/')" "fail-with-findings/reuse/unchanged_design_result_reused/null"
  assert_json "D8 …the reused result carries the findings path of the first run" "$G_OUT" "j.findings_path" "$first_findings"
  FAKE_RUNNER_CASE=revise design34 docs/adr/y.md
  assert_eq "D8 a third call is still answered from the record (no round_cap, one call)" "$(calls34)" "1"
  assert_json "D8 …and the index holds exactly the one real run" "$(index34)" "j.length" "1"
  # a body edit is a new state: exactly one new call
  printf '\nA new decision sentence.\n' >> "$PHASE_REPO/docs/adr/y.md"
  FAKE_RUNNER_CASE=revise design34 docs/adr/y.md
  assert_eq "D8 a body edit of the failed doc is reviewed again (count 2)" "$(calls34)" "2"
  # an outcome that is not a Codex verdict is never reused: it retries
  cp "$DESIGN_CASES/adr-body-change.md" "$PHASE_REPO/docs/adr/z.md"; printf 'zz\n' >> "$PHASE_REPO/docs/adr/z.md"
  FAKE_RUNNER_CASE=malformed design34 docs/adr/z.md
  FAKE_RUNNER_CASE=malformed design34 docs/adr/z.md
  assert_eq "D8 a malformed outcome is no verdict: both calls reach the runner (count 4)" "$(calls34)" "4"
}

# ---------- D9: secrets and the tripwire ----------
caseD9() {
  prep34
  local secret; secret="ghp_$(printf 'A%.0s' $(seq 1 36))"
  sed "s/@@SECRET@@/$secret/" "$DESIGN_CASES/adr-secret.md" > "$PHASE_REPO/docs/adr/s.md"
  design34 docs/adr/s.md
  assert_rc "D9 a planted secret fails (exit 1)" 1 "$G_RC"
  assert_json "D9 verdict fail, reason secret_in_snapshot, step snapshot" "$G_OUT" "[j.verdict, j.reason, j.step].join('/')" "fail/secret_in_snapshot/snapshot"
  assert_eq "D9 the runner was never called" "$(calls34)" "0"
  assert_eq "D9 no snapshot is left behind" "$(snaps34)" "0"
  case "$G_OUT$G_ERR" in *"$secret"*) bad "D9 the secret value appears in the gate output";; *) ok "D9 the secret value is not echoed";; esac

  prep34
  FAKE_RUNNER_SIDE_EFFECT=write-into-repo design34 docs/adr/x.md
  assert_rc "D9 a tripwire run fails (exit 1)" 1 "$G_RC"
  assert_json "D9 reason tripwire" "$G_OUT" "j.reason" "tripwire"
  assert_eq "D9 the tripwire run still reached the runner exactly once" "$(calls34)" "1"
  assert_eq "D9 no snapshot is left behind after the tripwire" "$(snaps34)" "0"
}

# ---------- D10: the snapshot holds only the named file ----------
caseD10() {
  prep34
  local list="$TMP34/repo-list.json"; rm -f "$list"
  FAKE_RUNNER_REPO_LIST_FILE="$list" design34 docs/adr/x.md
  assert_rc "D10 review exits 0" 0 "$G_RC" "$G_ERR"
  [[ -f "$list" ]] || { bad "D10 the fake runner wrote no snapshot listing"; return 0; }
  assert_json "D10 the snapshot directory lists only docs/adr/x.md (no src/, no PLAN.md, no other ADR)" "$(cat "$list")" "JSON.stringify(j.files)" '["docs/adr/x.md"]'
  assert_json "D10 git tracks only that file in the snapshot" "$(cat "$list")" "JSON.stringify(j.tracked)" '["docs/adr/x.md"]'
}

# ---------- D11: no permit, design and plan gate side by side ----------
caseD11() {
  prep34; rm -f "$PHASE_REPO/.a1/xprov.json" "$HOME/.a1-xprov/permits.json"
  gate34 p34 "$GATE_PLAN"
  local plan_rc="$G_RC" plan_out="$G_OUT"
  design34 docs/adr/x.md
  assert_json "D11 plan gate without permit: not_applicable / external_review_not_permitted" "$plan_out" "j.verdict + '/' + j.reason" "not_applicable/external_review_not_permitted"
  assert_json "D11 design gate without permit: not_applicable / external_review_not_permitted" "$G_OUT" "j.verdict + '/' + j.reason + '/' + j.step" "not_applicable/external_review_not_permitted/permit-check"
  assert_eq "D11 design exit code equals the plan gate's no-permit exit" "$G_RC" "$plan_rc"
  assert_eq "D11 no runner call from either gate" "$(calls34)" "0"
  nothing34 p34 && ok "D11 nothing was written (no log, no xreview/)" || bad "D11 a no-permit run wrote into the phase dir: $(ls "$PHASE_REPO/.a1/phases/p34")"
  assert_eq "D11 no snapshot" "$(snaps34)" "0"
}

# ---------- D12: --doc validation (exit 2, nothing written) ----------
usage34() { # <name> <doc-or-empty-for-missing>
  local name="$1"; shift
  gate34 p34 "$GATE_DESIGN" "$@"
  assert_rc "D12 $name is a usage error" 2 "$G_RC"
  [[ -z "$G_OUT" ]] && nothing34 p34 && [[ "$(calls34)" == "0" && "$(snaps34)" == "0" ]] && ok "D12 $name: no stdout, no write, no runner call, no snapshot" || bad "D12 $name left effects (out='$G_OUT' calls=$(calls34) snaps=$(snaps34))"
}
caseD12() {
  prep34
  mkdir -p "$PHASE_REPO/docs/adr/sub"
  printf 'outside the repo\n' > "$TMP34/outside.md"
  ln -s "$TMP34/outside.md" "$PHASE_REPO/docs/adr/escape.md"
  ln -s "$PHASE_REPO/src/add.js" "$PHASE_REPO/docs/adr/to-src.md"
  usage34 "missing --doc"
  usage34 "absolute --doc" --doc "$PHASE_REPO/docs/adr/x.md"
  usage34 "--doc with .." --doc docs/adr/../../src/add.js
  usage34 "--doc with .. that still resolves to a valid ADR" --doc docs/adr/../adr/x.md
  usage34 "--doc outside the design globs" --doc src/add.js
  usage34 "--doc that does not exist" --doc docs/adr/nope.md
  usage34 "--doc that is a directory" --doc docs/adr/sub
  usage34 "--doc symlink escaping the repo" --doc docs/adr/escape.md
  usage34 "--doc symlink into the repo but outside the globs" --doc docs/adr/to-src.md
  gate34 p34 "$GATE_PLAN" --doc docs/adr/x.md
  assert_rc "D12 the plan gate takes no --doc" 2 "$G_RC"
  # control: the valid call on the same tree still works
  design34 docs/adr/x.md
  assert_rc "D12 control: a valid --doc on the same tree passes" 0 "$G_RC" "$G_ERR"
}

# ---------- D13: static facts of the real tree ----------
caseD13() {
  assert_eq "D13 GATE_ID_LIST is plan-review-xprov,design-review-xprov" "$(node -p "require(process.argv[1]).GATE_ID_LIST.join(',')" "$XPROV_LIB")" "plan-review-xprov,design-review-xprov"
  local row; row="$(node -e '
    const { parseRegistryRow } = require(process.argv[1]); const t = require("fs").readFileSync(process.argv[2], "utf8");
    const d = parseRegistryRow(t, "design-review-xprov"), p = parseRegistryRow(t, "plan-review-xprov");
    process.stdout.write([d && d.enforcement, d && d.applies_to, p && p.enforcement].join("/"));
  ' "$REPO_ROOT/_shared/lib/gate-ids.cjs" "$REGISTRY")"
  assert_eq "D13 registry: design row warning + permitted-repos, plan row blocking" "$row" "warning/permitted-repos/blocking"
}

# ---------- D14: a pass is bound to the doc it reviewed (security review W5, SEC-1) ----------
# forge34 <phase> <doc> <hash> <result_path> <plan_sha> — a forged index row (the attack: an index row is only a pointer).
forge34() {
  mkdir -p "$PHASE_REPO/.a1/phases/$1/xreview"
  node -e '
    const [f, doc, h, rp, ps] = process.argv.slice(1); const fs = require("fs"); let a = [];
    try { a = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { a = []; }
    a.push({ gate: "design-review-xprov", doc, doc_body_sha256: h, verdict: "pass", result_path: rp, plan_sha256: ps, round: 1, ts: "2099-01-01T00:00:00.000Z" });
    fs.writeFileSync(f, JSON.stringify(a, null, 2) + "\n");
  ' "$PHASE_REPO/.a1/phases/$1/xreview/index.json" "$2" "$3" "$4" "$5"
}
bodyhash34() { node -e 'process.stdout.write(require(process.argv[1]).bodyHash(require("fs").readFileSync(process.argv[2], "utf8")))' "$TREE/_shared/lib/xprov-design.cjs" "$1"; }
entry34() { index34 "${1:-p34}" | node -e 'const a = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write(String(a[0][process.argv[1]]))' "$2"; }
caseD14() {
  prep34   # P1: a real PLAN-review pass replayed as the design pass of a doc nobody reviewed
  FAKE_RUNNER_BIND_PLAN=0 gate34 p34 "$GATE_PLAN"
  assert_eq "D14 P1 setup: the plan gate ran once" "$(calls34)" "1"
  local rp ps h; rp="$(entry34 p34 result_path)"; ps="$(entry34 p34 plan_sha256)"
  printf '# Evil\n\nNever reviewed. Body text that Codex never saw.\n' > "$PHASE_REPO/docs/adr/evil.md"
  h="$(bodyhash34 "$PHASE_REPO/docs/adr/evil.md")"
  forge34 forge docs/adr/evil.md "$h" "$rp" "$ps"
  design34 docs/adr/evil.md
  assert_eq "D14 P1 a plan-gate pass is not a design pass: the runner is called (count 2)" "$(calls34)" "2"
  assert_json "D14 P1 …and the answer is not a reuse" "$G_OUT" "j.step === 'reuse' ? 'reuse' : 'fresh'" "fresh"

  prep34   # P2: a real design pass of x.md replayed for another doc
  design34 docs/adr/x.md
  rp="$(entry34 p34 result_path)"; ps="$(entry34 p34 plan_sha256)"
  mkdir -p "$PHASE_REPO/docs/architecture"; printf '# Other\n\nA different design, never reviewed.\n' > "$PHASE_REPO/docs/architecture/other.md"
  h="$(bodyhash34 "$PHASE_REPO/docs/architecture/other.md")"
  forge34 p34 docs/architecture/other.md "$h" "$rp" "$ps"
  design34 docs/architecture/other.md
  assert_eq "D14 P2 a design pass of x.md is not a pass of other.md: the runner is called (count 2)" "$(calls34)" "2"
  assert_json "D14 P2 …and the answer is not a reuse" "$G_OUT" "j.step === 'reuse' ? 'reuse' : 'fresh'" "fresh"

  prep34   # P3: a design run dir offered to the PLAN gate
  design34 docs/adr/x.md
  node -e '
    const fs = require("fs"); const f = process.argv[1]; const a = JSON.parse(fs.readFileSync(f, "utf8"));
    const sha = require("crypto").createHash("sha256").update(fs.readFileSync(process.argv[2])).digest("hex");
    a.push({ gate: "plan-review-xprov", verdict: "pass", result_path: a[0].result_path, plan_sha256: sha, round: 1, ts: "2099-01-01T00:00:00.000Z" });
    fs.writeFileSync(f, JSON.stringify(a, null, 2) + "\n");
  ' "$PHASE_REPO/.a1/phases/p34/xreview/index.json" "$PHASE_REPO/.a1/phases/p34/PLAN.md"
  FAKE_RUNNER_BIND_PLAN=0 gate34 p34 "$GATE_PLAN"
  assert_eq "D14 P3 a design run dir does not satisfy the plan gate: the runner is called (count 2)" "$(calls34)" "2"
}

# ---------- D15: only a YAML-shaped, short leading block is frontmatter (SEC-4) ----------
caseD15() {
  prep34
  printf -- '---\nthe real design decision lives in this line\n---\n\n# Title\n\nbody text\n' > "$PHASE_REPO/docs/adr/fm.md"
  design34 docs/adr/fm.md
  assert_eq "D15 first review of the prose-between-dashes doc (count 1)" "$(calls34)" "1"
  printf -- '---\nthe real design decision was reversed in this line\n---\n\n# Title\n\nbody text\n' > "$PHASE_REPO/docs/adr/fm.md"
  design34 docs/adr/fm.md
  assert_eq "D15 a change between non-YAML dashes is a body change: reviewed again (count 2)" "$(calls34)" "2"
  printf -- '---\nstatus: accepted\ndeciders: alex\n\n---\n\n# Title\n\nbody text\n' > "$PHASE_REPO/docs/adr/yaml.md"
  design34 docs/adr/yaml.md
  printf -- '---\nstatus: superseded\ndeciders: robert\n\n---\n\n# Title\n\nbody text\n' > "$PHASE_REPO/docs/adr/yaml.md"
  design34 docs/adr/yaml.md
  assert_eq "D15 a metadata-only (key: scalar) frontmatter edit stays free (count 3: one review for yaml.md)" "$(calls34)" "3"
  { printf -- '---\n'; for i in $(seq 1 400); do printf 'key%s: value-that-makes-the-block-long-enough\n' "$i"; done; printf -- '---\n\n# Big\n\nbody\n'; } > "$PHASE_REPO/docs/adr/big.md"
  design34 docs/adr/big.md
  local before; before="$(calls34)"
  sed 's/^key7: .*/key7: changed/' "$PHASE_REPO/docs/adr/big.md" > "$TMP34/big2.md"; cp "$TMP34/big2.md" "$PHASE_REPO/docs/adr/big.md"
  design34 docs/adr/big.md
  assert_eq "D15 an oversize leading block is not frontmatter: its edit is reviewed again" "$(calls34)" "$((before + 1))"
}

# ---------- D18: only `key: scalar` metadata is frontmatter (SEC-3) ----------
m34_mutate() { # <tree> <lib-file> <from> <to> — refuses unless <from> occurs exactly once
  node -e '
    const fs = require("fs"); const [tree, name, from, to] = process.argv.slice(1);
    const f = tree + "/_shared/lib/" + name; const s = fs.readFileSync(f, "utf8");
    const n = s.split(from).length - 1;
    if (n !== 1) { process.stderr.write("mutation target occurs " + n + " times: " + from + "\n"); process.exit(3); }
    fs.writeFileSync(f, s.split(from).join(to));
  ' "$@" || { echo "FAIL  harness: mutation failed ($2: $3)" >&2; exit 2; }
}
# hashpair34 <tools-tree> <text-a> <text-b> — same | differ (bodyHash of the two texts)
hashpair34() {
  node -e 'const D = require(process.argv[1] + "/_shared/lib/xprov-design.cjs"); process.stdout.write(D.bodyHash(process.argv[2]) === D.bodyHash(process.argv[3]) ? "same" : "differ")' "$1" "$2" "$3"
}
fm34() { printf -- '---\n%b\n---\n\n# T\n\nbody\n' "$1"; }
LONG200="$(printf 'a%.0s' $(seq 1 200))"; LONG201="$(printf 'a%.0s' $(seq 1 201))"
caseD18() {
  make_tree
  local t="$TREE"
  assert_eq "D18 metadata line edit (key: short scalar): same body hash" "$(hashpair34 "$t" "$(fm34 'status: a\ndate: 1')" "$(fm34 'status: b\ndate: 2')")" "same"
  assert_eq "D18 a value of exactly 200 characters is still metadata" "$(hashpair34 "$t" "$(fm34 "k: $LONG200")" "$(fm34 "k: ${LONG200%a}b")")" "same"
  assert_eq "D18 a value of 201 characters is body: an edit changes the hash" "$(hashpair34 "$t" "$(fm34 "k: $LONG201")" "$(fm34 "k: ${LONG201%a}b")")" "differ"
  assert_eq "D18 list items are body" "$(hashpair34 "$t" "$(fm34 'tags:\n  - a')" "$(fm34 'tags:\n  - b')")" "differ"
  assert_eq "D18 an unindented list item is body" "$(hashpair34 "$t" "$(fm34 'status: a\n- one')" "$(fm34 'status: a\n- two')")" "differ"
  assert_eq "D18 comment lines are body" "$(hashpair34 "$t" "$(fm34 'status: a\n# prose one')" "$(fm34 'status: a\n# prose two')")" "differ"
  assert_eq "D18 an indented continuation line is body" "$(hashpair34 "$t" "$(fm34 'summary: x\n  prose one')" "$(fm34 'summary: x\n  prose two')")" "differ"
  assert_eq "D18 a block scalar is body" "$(hashpair34 "$t" "$(fm34 'note: |\n  prose one')" "$(fm34 'note: |\n  prose two')")" "differ"
  assert_eq "D18 a folded-scalar indicator alone is body" "$(hashpair34 "$t" "$(fm34 'note: >')" "$(fm34 'note: |')")" "differ"
  # RED proof: with every leading block stripped (the shape check removed) the same list edit keeps the hash
  mk_workdir M34 mtree34; cp -R "$TREE/_shared" "$M34/_shared"
  m34_mutate "$M34" xprov-design.cjs "inner.every(isMetadataLine) ?" "true ?"
  assert_eq "D18 RED: without the shape check a list edit is invisible (same)" "$(hashpair34 "$M34" "$(fm34 'tags:\n  - a')" "$(fm34 'tags:\n  - b')")" "same"
}

# ---------- D19: the doc is read through one descriptor that matches the checked file (SEC-4) ----------
pinned34() { # <tree> <mode: real|swap> — prints readPinned's result for a file whose descriptor is, or is not, the lstat'd one
  node -e '
    const fs = require("fs"), path = require("path"), os = require("os");
    const D = require(process.argv[1] + "/_shared/lib/xprov-design.cjs");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d19-"));
    const a = path.join(dir, "a.md"), b = path.join(dir, "b.md");
    fs.writeFileSync(a, "checked\n"); fs.writeFileSync(b, "swapped in\n");
    const before = fs.lstatSync(a);
    const io = process.argv[2] === "swap" ? { ...fs, openSync: (_p, flags) => fs.openSync(b, flags), fstatSync: fs.fstatSync, readFileSync: fs.readFileSync, closeSync: fs.closeSync } : fs;
    const got = D.readPinned(a, before, 1024, io);
    process.stdout.write(got === null ? "null" : got.toString().trim());
    fs.rmSync(dir, { recursive: true, force: true });
  ' "$1" "$2"
}
caseD19() {
  make_tree
  assert_eq "D19 the lstat'd file itself is read" "$(pinned34 "$TREE" real)" "checked"
  assert_eq "D19 a file swapped in between the checks and the open (other dev/ino) is refused: null" "$(pinned34 "$TREE" swap)" "null"
  mk_workdir M34 mtree34; cp -R "$TREE/_shared" "$M34/_shared"
  m34_mutate "$M34" xprov-design.cjs "|| st.dev !== before.dev || st.ino !== before.ino" ""
  assert_eq "D19 RED: without the dev/ino comparison the swapped file is read" "$(pinned34 "$M34" swap)" "swapped in"
  prep34
  assert_eq "D19 resolveDoc still reads a regular doc" "$(node -e 'const D=require(process.argv[1]+"/_shared/lib/xprov-design.cjs");const r=D.resolveDoc(process.argv[2],"docs/adr/x.md");process.stdout.write(r.rel+":"+(r.bytes.length>0))' "$TREE" "$PHASE_REPO")" "docs/adr/x.md:true"
}

# ---------- D20: the design gate needs gitleaks like every gate that sends to Codex (SEC-2) ----------
gate_nogl34() { # <tools> — design gate with gitleaks off PATH; prints rc/step/reason/calls
  local before; before="$(calls34)"
  local out; out="$( export PATH="$NOGL34"; cd "$PHASE_REPO" && FAKE_RUNNER_CASE=approved FAKE_RUNNER_BIND_PLAN=1 FAKE_RUNNER_COUNT_FILE="$COUNT34" node "$1" xprov gate --phase p34 --gate "$GATE_DESIGN" --doc docs/adr/x.md --timeout 7 2>/dev/null )"; local rc=$?
  echo "$rc/$(json_get "$out" "[j.step, j.reason].join('/')")/$(( $(calls34) - before ))"
}
caseD20() {
  prep34   # make_tree has put the fake bin (with its stub gitleaks) on PATH; rb_nogl_path (part 20) shadows every PATH entry holding a gitleaks
  NOGL34="$(rb_nogl_path "$TMP34")"
  if [[ -z "$NOGL34" ]]; then bad "D20 setup: a PATH without gitleaks could not be built"; return; fi
  FAKE_RUNNER_CASE=approved FAKE_RUNNER_BIND_PLAN=1 FAKE_RUNNER_COUNT_FILE="$COUNT34" FAKE_RUNNER_SEQUENCE='[{}]' fake_runner_env
  assert_eq "D20 design gate (warning row) without gitleaks: preflight_failed, runner not called" "$(gate_nogl34 "$TREE_TOOLS")" "1/preflight/preflight_failed/0"
  mk_workdir M34 mtree34; cp -R "$TREE/_shared" "$M34/_shared"
  m34_mutate "$M34" xprov-gate.cjs "if (resolveTool('gitleaks') === null) return" "if (ctx.enforcement === 'blocking' && resolveTool('gitleaks') === null) return"
  m34_mutate "$M34" xprov-run.cjs "if (rec.gitleaks === false) return refuse(" "if (false) return refuse("   # the run step re-checks the snapshot record: both checks must go for a warning gate to send
  assert_eq "D20 RED: restoring the blocking-only checks lets the warning gate send with a patterns-only scan" "$(gate_nogl34 "$M34/_shared/a1-tools.cjs" | sed 's#^[0-9]*/[^/]*/[^/]*/#X/#')" "X/1"
}

# ---------- D21: where a reused REVISE's findings live (round must be a real round; the xreview copy must match the run-dir record) ----------
fpbase34() { # <tools> — the basename of the findings_path the design gate answers y.md with, from the cwd repo
  local out; out="$(cd "$PHASE_REPO" && FAKE_RUNNER_CASE=revise FAKE_RUNNER_BIND_PLAN=1 FAKE_RUNNER_COUNT_FILE="$COUNT34" node "$1" xprov gate --phase p34 --gate "$GATE_DESIGN" --doc docs/adr/y.md --timeout 7 2>/dev/null)"
  json_get "$out" "require('path').basename(String(j.findings_path))"
}
caseD21() {
  prep34
  cp "$DESIGN_CASES/adr-body-change.md" "$PHASE_REPO/docs/adr/y.md"
  FAKE_RUNNER_CASE=revise design34 docs/adr/y.md
  local first idx rundir; first="$(json_get "$G_OUT" "j.findings_path")"; idx="$PHASE_REPO/.a1/phases/p34/xreview/index.json"
  rundir="$(dirname "$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[0].result_path' "$idx")")"
  assert_eq "D21 setup: the first run's findings are the xreview copy of round 1" "$([[ "$first" == */xreview/*-r1.findings.json && -f "$first" ]] && echo yes || echo no)" "yes"
  assert_eq "D21 the reuse points at the intact xreview copy" "$(fpbase34 "$TREE_TOOLS")" "$(basename "$first")"
  # an xreview copy that no longer says what the run-dir record says (a finding added, summary kept) is not returned
  node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));j.major.push({id:"X9",file:"x",line:1,title:"t",detail:"d",severity:"high"});fs.writeFileSync(process.argv[1],JSON.stringify(j,null,2)+"\n")' "$first"
  assert_eq "D21 a tampered xreview copy is replaced by the run-dir record" "$(fpbase34 "$TREE_TOOLS")" "a1-findings.json"
  mk_workdir M34 mtree34; cp -R "$TREE/_shared" "$M34/_shared"
  m34_mutate "$M34" xprov-design.cjs "FINDING_BUCKETS.every((k) => same(copy[k], record[k]))" "true"
  assert_eq "D21 RED: without the finding comparison the tampered copy is returned" "$(fpbase34 "$M34/_shared/a1-tools.cjs")" "$(basename "$first")"
  # a row whose round is not an integer >= 1 never names an xreview file: even a matching file at that name is ignored
  node -e 'const fs=require("fs");const [idx,rec,out]=process.argv.slice(1);const rows=JSON.parse(fs.readFileSync(idx,"utf8"));rows[0].round=0;fs.writeFileSync(idx,JSON.stringify(rows,null,2)+"\n");fs.copyFileSync(rec,out)' "$idx" "$rundir/a1-findings.json" "${first%-r1.findings.json}-r0.findings.json"
  assert_eq "D21 round 0 in the row: the findings are the run-dir record" "$(fpbase34 "$TREE_TOOLS")" "a1-findings.json"
  mk_workdir M34 mtree34; cp -R "$TREE/_shared" "$M34/_shared"
  m34_mutate "$M34" xprov-design.cjs "if (Number.isInteger(e.round) && e.round >= 1) {" "if (true) {"
  assert_eq "D21 RED: without the round check the r0 file is returned" "$(fpbase34 "$M34/_shared/a1-tools.cjs")" "$(basename "${first%-r1.findings.json}-r0.findings.json")"
}

# ---------- D16: the snapshot is built from the bytes already read (SEC-2) ----------
caseD16() {
  prep34
  local out; out="$(cd "$PHASE_REPO" && node -e '
    const fs = require("fs"); const S = require(process.argv[1] + "/_shared/lib/xprov-snapshot.cjs");
    const bytes = Buffer.from("# Read once\n\nthe bytes the gate hashed\n"); const head = require("child_process").execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
    const src = process.cwd() + "/docs/adr/x.md";
    const r = S.snapshot({ sourceRepo: process.cwd(), commit: head, base: null, primaryRoot: process.cwd(), gateKind: "design",
      only: { rel: "docs/adr/x.md", source: src, bytes }, inputs: [{ key: "plan", source: src, bytes, label: "docs/adr/x.md" }] });
    if (!r.ok) { process.stdout.write("snapshot failed: " + (r.reason || "") + " " + (r.detail || "")); process.exit(0); }
    const inSnap = fs.readFileSync(r.snapshot + "/docs/adr/x.md").equals(bytes), inInput = fs.readFileSync(r.inputs.plan).equals(bytes);
    S.cleanupSnapshot(r.snapshot); process.stdout.write(inSnap + "/" + inInput);
  ' "$TREE" 2>&1)"
  assert_eq "D16 snapshot file and input copy hold the bytes passed in, not a re-read of the disk file" "$out" "true/true"
}

# ---------- D17: hardlinks and non-canonical --doc spellings (SEC-3, SEC-5) ----------
caseD17() {
  prep34
  printf 'private note outside the repo\n' > "$TMP34/private.txt"
  ln "$TMP34/private.txt" "$PHASE_REPO/docs/adr/hl.md"
  usage34 "--doc hardlinked to a file outside the repo" --doc docs/adr/hl.md
  usage34 "--doc with ./ prefix" --doc ./docs/adr/x.md
  usage34 "--doc with inner ./" --doc docs/adr/./x.md
  usage34 "--doc with //" --doc docs//adr/x.md
  usage34 "--doc with a trailing space" --doc "docs/adr/x.md "
  usage34 "--doc with a leading space" --doc " docs/adr/x.md"
  design34 docs/adr/x.md
  assert_json "D17 control: canonical --doc passes and the entry doc is the canonical path" "$(index34)" "j[0].doc" "docs/adr/x.md"
}

caseD1; caseD8; caseD9; caseD10; caseD11; caseD12; caseD13; caseD14; caseD15; caseD16; caseD17; caseD18; caseD19; caseD20; caseD21
export HOME="$SAVED_HOME_34"; unset A1_XPROV_CODEX_HOME
