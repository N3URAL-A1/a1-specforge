#!/usr/bin/env bash
# Part 42 — audit F-001 (bug 2026-11-25-plan-review-egress-audit): every Codex runner spawn of `xprov run` appends one
# always-on, hash-chained line to <owner home>/.a1-xprov/egress-audit.jsonl, whatever --no-log and A1_KEEP_REVIEW_LOGS say.
# Sourced by run-tests.sh. The default-off cases run with A1_KEEP_REVIEW_LOGS removed from the child env.
# One case, one red-making production mutation (each run for real before commit; see CONVENTIONS.md "RED proof"):
#   EA1 pass, log unset: one line with the sha of the PLAN sent, scan tree + content, mode 0600, no plan text.
#       Mutation: recordEgress returns early on `ctx.noLog || !keepReviewLogs()` (the old opt-in gate) -> 0 lines.
#   EA2 runner_failed after the spawn: one line.   Mutation: same opt-in early return.
#   EA3 outage x3: three lines, chain verifies.     Mutation: writer sets `prev: null` always -> chain breaks (also EA6).
#   EA4 secret / preflight / round cap / reuse: no line. Mutation: append one line at the top of `gate()` in xprov-gate.cjs.
#   EA5 direct `xprov run --no-log`: one line.      Mutation: opt-in early return. EA5b: a PLAN copy changed after the
#       snapshot is refused with 0 lines. Mutation: drop the inputProblem checks (cmdXprovRun, runWithBaseline and
#       recordEgress); the case checks the outcome, not which of the three guards fired.
#   EA6 an edited line breaks the chain.            Mutation: verifyEgress skips the `prev` comparison.
#   EA10 a gate run on the EA6-edited chain is refused (preflight_failed, detail egress_audit_broken + the way out), runner never
#       spawned, file byte-identical.  Mutation: the append skips the full verify (prev from the last line only, as tipOf did).
#   EA10b an off-format middle line (valid JSON, an extra key, every prev still chains) also refuses.  Mutation: the shared verifier skips validLine().
#   EA10d a partial last line (final newline replaced by a space) refuses.  Mutation: verifyEgressText drops the endsWith('\n') check.
#   EA10e a file over the 256 MiB bound refuses before the read.  Mutation: verifiedTip drops the MAX_BYTES check.
#   EA10c after the owner moves the file aside, the next run passes with one line, prev null.  Mutation: verifiedTip returns a
#       constant sha instead of null for an empty file, or the append refuses on a missing/empty file.
#   EA7 symlink / directory / FIFO / hard link / unwritable target: nonzero, runner never spawned. Mutations: ignore the
#       append failure in recordEgress (all); drop O_NOFOLLOW (symlink); drop the `isFile` test (the FIFO appender case; the gate runs are refused by the open or fsync error anyway); drop
#       the `nlink !== 1` test (hard link).
#   EA8 design-review-xprov: one line, input_sha256 = sha of the doc copy the runner read.  Mutation: set input_sha256 to a
#       constant, or the opt-in early return.
#   EA9 round 2 (--feedback sent): feedback_sha256 = sha of the feedback copy the runner read.  Mutation: set
#       feedback_sha256 to null.
#   EV1-EV3 `xprov egress-verify`: exit 0 on a good chain and on an absent file, exit 1 naming the line on an edited one.
#       Mutation: make cmdXprovEgressVerify always exit 0.
# Helpers are copied from part 40 (a part must run alone in its shard).

mk_workdir TMP42 "a1x42"
[[ -n "$TMP42" && -d "$TMP42" ]] || { echo "FAIL  part 42: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
SAVED_HOME_42="$HOME"
export HOME="$TMP42/home"; mkdir -p "$HOME/.codex"; printf '{"fixture":true}\n' > "$HOME/.codex/auth.json"; chmod 600 "$HOME/.codex/auth.json"
NET42='{"FAKE_RUNNER_CODEX_STDOUT":"net-disconnect"}'
GATE_DESIGN42="design-review-xprov"
OK42='{"FAKE_RUNNER_CASE":"approved"}'
RF42='{"FAKE_RUNNER_FAIL_ERROR":"runner broke without a cause the gate recognises"}'
EGRESS42() { printf '%s' "$HOME/.a1-xprov/egress-audit.jsonl"; }

pin42() {
  node -e '
    const fs = require("fs"); const file = process.argv[1]; const ids = ["plan-review-xprov", "design-review-xprov"];
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").split("\n").map((l) => (ids.some((id) => l.startsWith("| `" + id + "` |")) ? l.replace(/\| (warning|blocking) \|/, "| warning |") : l)).join("\n"));
  ' "$TREE/_shared/gates-registry.md" || bad "pin42: could not pin the registry copy"
}
prep42() {
  make_tree; pin42; make_phase p42 "$CASES/approved.PLAN.md"
  mkdir -p "$PHASE_REPO/docs/adr"; cp "$CASES/design/adr.md" "$PHASE_REPO/docs/adr/x.md"
  ( cd "$PHASE_REPO" && git add -A && git commit -qm "fixture: adr" )
  rm -rf "$HOME/.a1-xprov"; write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md
  make_home; export A1_XPROV_CODEX_HOME="$XHOME"
  node "$TREE_TOOLS" xprov init-home >/dev/null 2>&1 </dev/null
  ln -s "$HOME/.codex/auth.json" "$XHOME/auth.json"
  printf '## Wave 1 — one\n' > "$PHASE_DIR/STATUS.md"
  rm -f "$TMP42/count"
}
# gate42 <seq-json> [flags…] — one gate run, A1_KEEP_REVIEW_LOGS removed from the child env
gate42() {
  local seq="$1"; shift
  FAKE_RUNNER_BIND_PLAN=1 FAKE_RUNNER_COUNT_FILE="$TMP42/count" FAKE_RUNNER_SEQUENCE="$seq" FAKE_RUNNER_CASE="${CASE42:-approved}" FAKE_RUNNER_PROMPT_FILE="${PROMPT42:-}" fake_runner_env
  G_OUT="$(cd "$PHASE_REPO" && env -u A1_KEEP_REVIEW_LOGS node "$TREE_TOOLS" xprov gate --phase p42 --timeout 7 "$@" 2>"$TMP42/err.txt" </dev/null)"; G_RC=$?; G_ERR="$(cat "$TMP42/err.txt")"
}
lines42() { if [[ -f "$(EGRESS42)" ]]; then wc -l < "$(EGRESS42)" | tr -d ' '; else echo 0; fi; }
spawns42() { if [[ -f "$TMP42/count" ]]; then wc -l < "$TMP42/count" | tr -d ' '; else echo 0; fi; }
line42() { sed -n "${1}p" "$(EGRESS42)"; }
verify42() { node -e 'const E = require(process.argv[1] + "/_shared/lib/xprov-egress-audit.cjs"); const v = E.verifyEgress(process.argv[2]); process.stdout.write(v.ok + "/" + v.lines.length);' "$TREE" "$(EGRESS42)"; }
sha42() { node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"; }

# sent42 <prompt-file> plan|feedback — sha256 of the bytes of that copy as the runner read them (the fake writes the prompt it would hand Codex)
sent42() { node -e '
  const t = require("fs").readFileSync(process.argv[1], "utf8"); const k = process.argv[2];
  const body = k === "plan" ? t.slice(t.indexOf("<plan>\n") + 7, t.indexOf("\n</plan>\n")) : (() => { const m = "\nHOST DISPOSITIONS / FIX REQUEST:\n"; return t.slice(t.indexOf(m) + m.length); })();
  process.stdout.write(require("crypto").createHash("sha256").update(body, "utf8").digest("hex"));' "$1" "$2"; }

# EA1: pass with the log unset
prep42; PROMPT42="$TMP42/ea1-prompt.txt"; gate42 "[$OK42]" --gate "$GATE_PLAN"; PROMPT42=""
assert_rc "EA1 default run passes" 0 "$G_RC" "$G_ERR"
assert_eq "EA1 no PLAN-REVIEW-LOG.md (opt-in stays off)" "$(ls "$PHASE_DIR" | grep -c '^PLAN-REVIEW-LOG.md$')" "0"
assert_eq "EA1 exactly one egress line" "$(lines42)" "1"
PSHA42="$(sha42 "$PHASE_PLAN")"
assert_json "EA1 gate/mode/phase/round/input_sha256 (independent sha of PLAN.md)" "$(line42 1)" "[j.gate, j.mode, j.phase, j.round, j.input_sha256, j.model_pinned, j.prev].join('/')" "$GATE_PLAN/review/p42/1/$PSHA42/gpt-6-astra/"
assert_eq "EA1 input_sha256 also equals the sha of the PLAN the runner read" "$(sent42 "$TMP42/ea1-prompt.txt" plan)" "$PSHA42"
assert_json "EA1 scan identity: commit, tree (independent git) and content_sha256" "$(line42 1)" "[j.commit === '$(git -C "$PHASE_REPO" rev-parse HEAD)', j.tree === '$(git -C "$PHASE_REPO" rev-parse 'HEAD^{tree}')', /^[0-9a-f]{64}\$/.test(j.content_sha256), j.feedback_sha256 === null].join('/')" "true/true/true/true"
assert_json "EA1 repo and commit are named" "$(line42 1)" "[j.repo === '$(cd "$PHASE_REPO" && pwd -P)' || j.repo === '$PHASE_REPO', /^[0-9a-f]{40}\$/.test(j.commit)].join('/')" "true/true"
assert_eq "EA1 file mode is 0600" "$(node -e 'process.stdout.write((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$(EGRESS42)")" "600"
assert_eq "EA1 control: the token 'subtract' is in the sent PLAN" "$([[ "$(grep -c subtract "$PHASE_PLAN")" -gt 0 ]] && echo yes)" "yes"
assert_eq "EA1 the line holds no plan text (token 'subtract')" "$(grep -c subtract "$(EGRESS42)")" "0"

# EA2: runner_failed after the spawn (no recognised outage cause)
prep42; gate42 "[$RF42]" --gate "$GATE_PLAN"
assert_json "EA2 the gate reports runner_failed" "$G_OUT" "j.reason" "runner_failed"
assert_eq "EA2 the runner spawned once" "$(spawns42)" "1"
assert_eq "EA2 exactly one egress line" "$(lines42)" "1"

# EA3: outage x3 -> three spawns, three lines, chain verifies
prep42; gate42 "[$NET42,$NET42,$NET42]" --gate "$GATE_PLAN"
assert_json "EA3 outage reports codex_unavailable" "$G_OUT" "j.reason" "codex_unavailable"
assert_eq "EA3 three spawns" "$(spawns42)" "3"
assert_eq "EA3 three egress lines (one per spawn)" "$(lines42)" "3"
assert_eq "EA3 the chain verifies" "$(verify42)" "true/3"

# EA6: an edited line breaks the chain (uses the EA3 file)
node -e 'const fs = require("fs"); const f = process.argv[1]; const l = fs.readFileSync(f, "utf8").split("\n"); const o = JSON.parse(l[1]); o.round = 9; l[1] = JSON.stringify(o); fs.writeFileSync(f, l.join("\n"));' "$(EGRESS42)"
assert_eq "EA6 an edited middle line breaks the chain" "$(verify42)" "false/2"

# EA10: a gate run on the broken chain (EA6 left an edited middle line) is refused before the spawn; the file stays as it was
SHA10_BEFORE="$(sha42 "$(EGRESS42)")"; SP10_BEFORE="$(spawns42)"
gate42 "[$OK42]" --gate "$GATE_PLAN"
assert_eq "EA10 broken chain: nonzero, preflight_failed" "$([[ $G_RC -ne 0 ]] && echo nonzero)/$(json_get "$G_OUT" "j.reason")" "nonzero/preflight_failed"
assert_json "EA10 the detail names egress_audit_broken, the check and the way out" "$G_OUT" "[/egress_audit_broken/.test(j.reason_detail), /egress-verify/.test(j.reason_detail), /move the file aside yourself/.test(j.reason_detail), /next spawn starts a new chain/.test(j.reason_detail)].join('/')" "true/true/true/true"
assert_eq "EA10 the runner never spawned" "$(spawns42)" "$SP10_BEFORE"
assert_eq "EA10 the egress file is byte-identical" "$(sha42 "$(EGRESS42)")" "$SHA10_BEFORE"

# EA10b: an off-format middle line (valid JSON, an extra key, every prev still chains) refuses too
prep42; gate42 "[$NET42,$NET42,$NET42]" --gate "$GATE_PLAN"
node -e 'const fs = require("fs"); const c = require("crypto"); const f = process.argv[1]; const l = fs.readFileSync(f, "utf8").split("\n"); l[1] = JSON.stringify({ ...JSON.parse(l[1]), extra_key: 1 }); const o = JSON.parse(l[2]); o.prev = c.createHash("sha256").update(l[1]).digest("hex"); l[2] = JSON.stringify(o); fs.writeFileSync(f, l.join("\n"));' "$(EGRESS42)"
assert_eq "EA10b control: only the format rule is violated (every prev still chains)" "$(node -e 'const fs = require("fs"); const c = require("crypto"); const l = fs.readFileSync(process.argv[1], "utf8").split("\n"); process.stdout.write(String(JSON.parse(l[2]).prev === c.createHash("sha256").update(l[1]).digest("hex") && JSON.parse(l[1]).prev === c.createHash("sha256").update(l[0]).digest("hex")))' "$(EGRESS42)")" "true"
SHA10B="$(sha42 "$(EGRESS42)")"; SP10B="$(spawns42)"
gate42 "[$OK42]" --gate "$GATE_PLAN"
assert_eq "EA10b off-format middle line: nonzero, preflight_failed, runner not spawned, file byte-identical" "$([[ $G_RC -ne 0 ]] && echo nonzero)/$(json_get "$G_OUT" "j.reason")/$(( $(spawns42) - SP10B ))/$([[ "$(sha42 "$(EGRESS42)")" == "$SHA10B" ]] && echo same)" "nonzero/preflight_failed/0/same"
assert_json "EA10b the detail names the off-format line" "$G_OUT" "/egress_audit_broken/.test(j.reason_detail) && /line 2 is off-format/.test(j.reason_detail)" "true"

# EA10c: the owner moves the file aside; the next run passes and starts a new chain
mv "$(EGRESS42)" "$TMP42/egress-aside.jsonl"
gate42 "[$OK42]" --gate "$GATE_PLAN"
assert_rc "EA10c after moving the file aside the run passes" 0 "$G_RC" "$G_ERR"
assert_eq "EA10c exactly one line, prev null, chain verifies" "$(lines42)/$(json_get "$(line42 1)" "j.prev")/$(verify42)" "1/null/true/1"

# EA10d: a partial last line (the final newline replaced by a space) refuses; the append must not glue onto it.
# Fresh phase (no earlier pass to reuse); three outage spawns write three good lines first.
prep42; gate42 "[$NET42,$NET42,$NET42]" --gate "$GATE_PLAN"
node -e 'const fs = require("fs"); const f = process.argv[1]; fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/\n$/, " "));' "$(EGRESS42)"
SHA10D="$(sha42 "$(EGRESS42)")"; SP10D="$(spawns42)"
gate42 "[$OK42]" --gate "$GATE_PLAN"
assert_eq "EA10d partial last line: nonzero, preflight_failed, runner not spawned, file byte-identical" "$([[ $G_RC -ne 0 ]] && echo nonzero)/$(json_get "$G_OUT" "j.reason")/$(( $(spawns42) - SP10D ))/$([[ "$(sha42 "$(EGRESS42)")" == "$SHA10D" ]] && echo same)" "nonzero/preflight_failed/0/same"
assert_json "EA10d the detail names the incomplete last line" "$G_OUT" "/egress_audit_broken/.test(j.reason_detail) && /last line is incomplete/.test(j.reason_detail)" "true"

# EA10e: a file over the size bound refuses before it is read (sparse, so the case stays cheap)
prep42; node -e 'const fs = require("fs"); fs.writeFileSync(process.argv[1], ""); fs.truncateSync(process.argv[1], 256 * 1024 * 1024 + 1);' "$(EGRESS42)"
chmod 600 "$(EGRESS42)"; SP10E="$(spawns42)"
gate42 "[$OK42]" --gate "$GATE_PLAN"
assert_eq "EA10e over the bound: nonzero, preflight_failed, runner not spawned, size unchanged" "$([[ $G_RC -ne 0 ]] && echo nonzero)/$(json_get "$G_OUT" "j.reason")/$(( $(spawns42) - SP10E ))/$(wc -c < "$(EGRESS42)" | tr -d ' ')" "nonzero/preflight_failed/0/268435457"
assert_json "EA10e the detail names the bound and the way out" "$G_OUT" "/egress_audit_broken/.test(j.reason_detail) && /too large/.test(j.reason_detail) && /move the file aside yourself/.test(j.reason_detail)" "true"
rm -f "$(EGRESS42)"

# EA4: no spawn, no line
prep42; ( cd "$PHASE_REPO" && printf 'const k = "%s";\n' "AKIA$(head -c 16 /dev/zero | tr '\0' 'Q')" > src/leak.js && git add -A && git commit -qm "fixture: secret" ); gate42 "[$OK42]" --gate "$GATE_PLAN"
assert_json "EA4 secret in the snapshot is refused" "$G_OUT" "j.reason" "secret_in_snapshot"
assert_eq "EA4 secret: no spawn, no line" "$(spawns42)/$(lines42)" "0/0"
prep42; rm -f "$PHASE_REPO/.a1/xprov.json"; gate42 "[$OK42]" --gate "$GATE_PLAN"
assert_eq "EA4 preflight (no permit file): refused, no spawn, no line" "$([[ $G_RC -ne 0 ]] && echo refused)/$(spawns42)/$(lines42)" "refused/0/0"
prep42; gate42 "[$OK42]" --gate "$GATE_PLAN" --round 3
assert_json "EA4 --round over the cap" "$G_OUT" "j.reason" "round_cap"
assert_eq "EA4 round cap: no spawn, no line" "$(spawns42)/$(lines42)" "0/0"
prep42; gate42 "[$OK42]" --gate "$GATE_PLAN"; gate42 "[$OK42]" --gate "$GATE_PLAN"
assert_json "EA4 second run is a reuse" "$G_OUT" "j.reason_detail" "unchanged_plan_pass_reused"
assert_eq "EA4 reuse adds no spawn and no line (1 and 1 after two runs)" "$(spawns42)/$(lines42)" "1/1"

# EA5: a direct `xprov run --no-log` with the log unset
prep42
SOUT42="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov snapshot --repo "$PHASE_REPO" --commit HEAD --plan "$PHASE_PLAN" 2>/dev/null)"; SNAP42="$(json_get "$SOUT42" "j.snapshot || ''")"
FAKE_RUNNER_COUNT_FILE="$TMP42/count" FAKE_RUNNER_CASE=approved fake_runner_env
(cd "$PHASE_REPO" && env -u A1_KEEP_REVIEW_LOGS node "$TREE_TOOLS" xprov run --mode review --snapshot "$SNAP42" --plan "$SNAP42.inputs/PLAN.md" --phase p42 --gate "$GATE_PLAN" --timeout 7 --no-log >"$TMP42/run.out" 2>"$TMP42/run.err" </dev/null); rc42=$?
assert_rc "EA5 direct run passes" 0 "$rc42" "$(cat "$TMP42/run.err")"
assert_eq "EA5 exactly one egress line, none from a log" "$(lines42)/$(ls "$PHASE_DIR" | grep -c '^PLAN-REVIEW-LOG.md$')" "1/0"
assert_json "EA5 the line names the gate, phase and the sha of the sent copy" "$(line42 1)" "[j.gate, j.phase, j.input_sha256].join('/')" "$GATE_PLAN/p42/$(sha42 "$SNAP42.inputs/PLAN.md")"

# EA5b: the PLAN copy changes after the snapshot scanned it: refused, no line, no spawn
prep42
SOUT42="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov snapshot --repo "$PHASE_REPO" --commit HEAD --plan "$PHASE_PLAN" 2>/dev/null)"; SNAP42="$(json_get "$SOUT42" "j.snapshot || ''")"
printf '\nTAMPERED after the scan\n' >> "$SNAP42.inputs/PLAN.md"
FAKE_RUNNER_COUNT_FILE="$TMP42/count" FAKE_RUNNER_CASE=approved fake_runner_env
RUN42="$(cd "$PHASE_REPO" && env -u A1_KEEP_REVIEW_LOGS node "$TREE_TOOLS" xprov run --mode review --snapshot "$SNAP42" --plan "$SNAP42.inputs/PLAN.md" --phase p42 --gate "$GATE_PLAN" --timeout 7 --no-log 2>/dev/null </dev/null)"; rc42=$?
assert_eq "EA5b changed input copy: refused (snapshot_failed), no spawn, no line" "$rc42/$(json_get "$RUN42" "j.reason")/$(spawns42)/$(lines42)" "1/snapshot_failed/0/0"

# EA7: a symlinked or unwritable target refuses the spawn
prep42; mkdir -p "$HOME/.a1-xprov"; : > "$TMP42/elsewhere.jsonl"; ln -s "$TMP42/elsewhere.jsonl" "$(EGRESS42)"; gate42 "[$OK42]" --gate "$GATE_PLAN"
assert_eq "EA7 symlinked target: nonzero, runner never spawned, nothing written through the link" "$([[ $G_RC -ne 0 ]] && echo nonzero)/$(spawns42)/$(wc -c < "$TMP42/elsewhere.jsonl" | tr -d ' ')" "nonzero/0/0"
prep42; mkdir -p "$HOME/.a1-xprov/egress-audit.jsonl"; gate42 "[$OK42]" --gate "$GATE_PLAN"
assert_eq "EA7 non-regular target (directory): nonzero, runner never spawned" "$([[ $G_RC -ne 0 ]] && echo nonzero)/$(spawns42)" "nonzero/0"
if [[ "$(id -u)" != 0 ]]; then
  prep42; : > "$(EGRESS42)"; chmod 400 "$(EGRESS42)"; gate42 "[$OK42]" --gate "$GATE_PLAN"
  assert_eq "EA7 unwritable file: nonzero, runner never spawned" "$([[ $G_RC -ne 0 ]] && echo nonzero)/$(spawns42)" "nonzero/0"
fi

prep42; mkdir -p "$HOME/.a1-xprov"; mkfifo "$(EGRESS42)"; gate42 "[$OK42]" --gate "$GATE_PLAN"
assert_eq "EA7 FIFO target: nonzero, runner never spawned" "$([[ $G_RC -ne 0 ]] && echo nonzero)/$(spawns42)" "nonzero/0"
# the isFile guard itself: on a FIFO the write succeeds and only fsync fails (EINVAL), so the gate run above is refused either way;
# the exported appender must name the guard's own reason (egress_audit_open), and write nothing into the pipe
out42="$(HOME="$HOME" node -e '
  const E = require(process.argv[1] + "/_shared/lib/xprov-egress-audit.cjs");
  try { E.appendEgress({ repo: "r", gate: "g", mode: "review", phase: "p", round: 1, input_sha256: "0".repeat(64), model_pinned: "m" }); console.log("appended"); } catch (e) { console.log(e.reason + "/" + /one link/.test(e.message)); }' "$TREE" 2>&1)"
assert_eq "EA7 FIFO: the appender refuses with the isFile guard's own reason" "$out42" "egress_audit_open/true"
prep42; mkdir -p "$HOME/.a1-xprov"; : > "$(EGRESS42)"; ln "$(EGRESS42)" "$TMP42/second-link.jsonl"; gate42 "[$OK42]" --gate "$GATE_PLAN"
assert_eq "EA7 hard-linked target (nlink 2): nonzero, runner never spawned, link untouched" "$([[ $G_RC -ne 0 ]] && echo nonzero)/$(spawns42)/$(wc -c < "$TMP42/second-link.jsonl" | tr -d ' ')" "nonzero/0/0"
rm -f "$TMP42/second-link.jsonl"

# EA8: design-review-xprov
prep42; PROMPT42="$TMP42/ea8-prompt.txt"; gate42 "[$OK42]" --gate "$GATE_DESIGN42" --doc docs/adr/x.md; PROMPT42=""
assert_rc "EA8 design review passes" 0 "$G_RC" "$G_ERR"
assert_eq "EA8 exactly one egress line" "$(lines42)" "1"
assert_eq "EA8 input_sha256 equals the sha of the doc copy the runner read" "$(json_get "$(line42 1)" "j.input_sha256")" "$(sent42 "$TMP42/ea8-prompt.txt" plan)"
assert_json "EA8 gate and phase" "$(line42 1)" "[j.gate, j.mode, j.phase].join('/')" "$GATE_DESIGN42/review/p42"

# EA9: round 2 sends --feedback; the line carries the hash of that copy (REVISE at round 1 first)
prep42
printf '%s\n' "$(cat "$CASES/revise.PLAN.md")" > "$PHASE_PLAN"; ( cd "$PHASE_REPO" && git add -A && git commit -qm "fixture: revise plan" )
node -e 'const fs=require("fs");const [a,b]=process.argv.slice(1);const j=JSON.parse(fs.readFileSync(a,"utf8"));j.response.findings[0].path="src/add.js:1";fs.writeFileSync(b,JSON.stringify(j,null,2)+"\n");' "$CASES/revise.result.json" "$TMP42/revise-src.result.json"
CASE42="$TMP42/revise-src.result.json" gate42 "[{}]" --gate "$GATE_PLAN"
assert_json "EA9 round 1 is a REVISE" "$G_OUT" "j.verdict + '/' + j.round" "fail-with-findings/1"
DISP42="$(json_get "$G_OUT" "j.next.dispositions_path")"; printf 'R1: accepted - will fix in wave 2\n' > "$DISP42"
CASE42=approved PROMPT42="$TMP42/ea9-prompt.txt" gate42 "[{}]" --gate "$GATE_PLAN" --round 2
assert_eq "EA9 round 2 ran, two lines in all" "$G_RC/$(lines42)" "0/2"
assert_json "EA9 round 1 line has no feedback hash" "$(line42 1)" "j.round + '/' + j.feedback_sha256" "1/null"
assert_json "EA9 round 2 feedback_sha256 = sha of the feedback copy the runner read" "$(line42 2)" "j.round + '/' + j.feedback_sha256" "2/$(sent42 "$TMP42/ea9-prompt.txt" feedback)"
assert_json "EA9 round 2 input_sha256 = sha of the PLAN the runner read" "$(line42 2)" "j.input_sha256" "$(sent42 "$TMP42/ea9-prompt.txt" plan)"

# EV1-EV3: xprov egress-verify (read-only)
ev42() { EV_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov egress-verify 2>"$TMP42/ev.err" </dev/null)"; EV_RC=$?; }
ev42; assert_eq "EV1 two good lines: exit 0, lines 2" "$EV_RC/$(json_get "$EV_OUT" "j.ok + '/' + j.lines")" "0/true/2"
node -e 'const fs = require("fs"); const f = process.argv[1]; const l = fs.readFileSync(f, "utf8").split("\n"); const o = JSON.parse(l[0]); o.round = 9; l[0] = JSON.stringify(o); fs.writeFileSync(f, l.join("\n"));' "$(EGRESS42)"
ev42; assert_eq "EV2 an edited first line: exit 1, reason names line 2" "$EV_RC/$(json_get "$EV_OUT" "j.ok + '/' + /line 2/.test(j.reason)")" "1/false/true"
rm -f "$(EGRESS42)"; ev42; assert_eq "EV3 absent file: exit 0, lines 0" "$EV_RC/$(json_get "$EV_OUT" "j.ok + '/' + j.lines")" "0/true/0"

# EA10: commit and tree are git object ids (40 or 64 hex) or null (follow-up F-004). Mutation: validLine checks them as nullable text.
ea10() { HOME="$HOME" node -e '
  const E = require(process.argv[1] + "/_shared/lib/xprov-egress-audit.cjs");
  const r = { repo: "r", gate: "g", mode: "review", phase: "p", round: 1, input_sha256: "0".repeat(64), model_pinned: "m", commit: process.argv[2], tree: process.argv[3] };
  try { E.appendEgress(r); console.log("appended"); } catch (e) { console.log(e.reason); }' "$TREE" "$1" "$2" 2>&1; }
rm -f "$(EGRESS42)"
assert_eq "EA10 an off-format tree is refused" "$(ea10 "$(printf 'a%.0s' {1..40})" not-a-git-id)" "egress_audit_input"
assert_eq "EA10 an off-format commit is refused" "$(ea10 "$(printf 'A%.0s' {1..40})" "$(printf 'b%.0s' {1..40})")" "egress_audit_input"
assert_eq "EA10 a 41-hex tree is refused (anchors, sha1 length)" "$(ea10 "$(printf 'a%.0s' {1..40})" "$(printf 'b%.0s' {1..41})")" "egress_audit_input"
assert_eq "EA10 a 65-hex commit is refused (sha256 length is exact)" "$(ea10 "$(printf 'a%.0s' {1..65})" "$(printf 'b%.0s' {1..40})")" "egress_audit_input"
assert_eq "EA10 sha1 commit and sha256 tree are accepted" "$(ea10 "$(printf 'a%.0s' {1..40})" "$(printf 'b%.0s' {1..64})")" "appended"
assert_eq "EA10 only the accepted line was written" "$(lines42)" "1"

export HOME="$SAVED_HOME_42"
rm -rf "$TMP42"
