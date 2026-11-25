#!/usr/bin/env bash
# Part 42 — audit F-001 (bug 2026-11-25-plan-review-egress-audit): every Codex runner spawn of `xprov run` appends one
# always-on, hash-chained line to <owner home>/.a1-xprov/egress-audit.jsonl, whatever --no-log and A1_KEEP_REVIEW_LOGS say.
# Sourced by run-tests.sh. The default-off cases run with A1_KEEP_REVIEW_LOGS removed from the child env.
#   EA1 pass, log unset: one line, input_sha256 = sha of the PLAN.md sent, gate/phase/round, mode 0600, no contents
#   EA2 runner_failed after the spawn: one line      EA3 outage x3: three lines, chain verifies
#   EA4 no spawn (secret, preflight, round cap, reuse): no line        EA5 direct `xprov run --no-log`: one line
#   EA6 chain: an edited line breaks it              EA7 symlinked or unwritable target: nonzero, runner never spawned
#   EA8 design-review-xprov: one line, input_sha256 = sha of the doc sent
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
  FAKE_RUNNER_BIND_PLAN=1 FAKE_RUNNER_COUNT_FILE="$TMP42/count" FAKE_RUNNER_SEQUENCE="$seq" FAKE_RUNNER_CASE=approved fake_runner_env
  G_OUT="$(cd "$PHASE_REPO" && env -u A1_KEEP_REVIEW_LOGS node "$TREE_TOOLS" xprov gate --phase p42 --timeout 7 "$@" 2>"$TMP42/err.txt" </dev/null)"; G_RC=$?; G_ERR="$(cat "$TMP42/err.txt")"
}
lines42() { if [[ -f "$(EGRESS42)" ]]; then wc -l < "$(EGRESS42)" | tr -d ' '; else echo 0; fi; }
spawns42() { if [[ -f "$TMP42/count" ]]; then wc -l < "$TMP42/count" | tr -d ' '; else echo 0; fi; }
line42() { sed -n "${1}p" "$(EGRESS42)"; }
verify42() { node -e 'const E = require(process.argv[1] + "/_shared/lib/xprov-egress-audit.cjs"); const v = E.verifyEgress(process.argv[2]); process.stdout.write(v.ok + "/" + v.lines.length);' "$TREE" "$(EGRESS42)"; }
sha42() { node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"; }

# EA1: pass with the log unset
prep42; gate42 "[$OK42]" --gate "$GATE_PLAN"
assert_rc "EA1 default run passes" 0 "$G_RC" "$G_ERR"
assert_eq "EA1 no PLAN-REVIEW-LOG.md (opt-in stays off)" "$(ls "$PHASE_DIR" | grep -c '^PLAN-REVIEW-LOG.md$')" "0"
assert_eq "EA1 exactly one egress line" "$(lines42)" "1"
PSHA42="$(sha42 "$PHASE_PLAN")"
assert_json "EA1 gate/mode/phase/round/input_sha256 (independent sha of PLAN.md)" "$(line42 1)" "[j.gate, j.mode, j.phase, j.round, j.input_sha256, j.model_pinned, j.prev].join('/')" "$GATE_PLAN/review/p42/1/$PSHA42/gpt-6-astra/"
assert_json "EA1 repo and commit are named" "$(line42 1)" "[j.repo === '$(cd "$PHASE_REPO" && pwd -P)' || j.repo === '$PHASE_REPO', /^[0-9a-f]{40}\$/.test(j.commit)].join('/')" "true/true"
assert_eq "EA1 file mode is 0600" "$(node -e 'process.stdout.write((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$(EGRESS42)")" "600"
assert_eq "EA1 the line holds no plan text" "$(grep -c 'Wave' "$(EGRESS42)")" "0"

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

# EA7: a symlinked or unwritable target refuses the spawn
prep42; mkdir -p "$HOME/.a1-xprov"; : > "$TMP42/elsewhere.jsonl"; ln -s "$TMP42/elsewhere.jsonl" "$(EGRESS42)"; gate42 "[$OK42]" --gate "$GATE_PLAN"
assert_eq "EA7 symlinked target: nonzero, runner never spawned, nothing written through the link" "$([[ $G_RC -ne 0 ]] && echo nonzero)/$(spawns42)/$(wc -c < "$TMP42/elsewhere.jsonl" | tr -d ' ')" "nonzero/0/0"
prep42; mkdir -p "$HOME/.a1-xprov/egress-audit.jsonl"; gate42 "[$OK42]" --gate "$GATE_PLAN"
assert_eq "EA7 non-regular target (directory): nonzero, runner never spawned" "$([[ $G_RC -ne 0 ]] && echo nonzero)/$(spawns42)" "nonzero/0"
if [[ "$(id -u)" != 0 ]]; then
  prep42; : > "$(EGRESS42)"; chmod 400 "$(EGRESS42)"; gate42 "[$OK42]" --gate "$GATE_PLAN"
  assert_eq "EA7 unwritable file: nonzero, runner never spawned" "$([[ $G_RC -ne 0 ]] && echo nonzero)/$(spawns42)" "nonzero/0"
fi

# EA8: design-review-xprov
prep42; gate42 "[$OK42]" --gate "$GATE_DESIGN42" --doc docs/adr/x.md
assert_rc "EA8 design review passes" 0 "$G_RC" "$G_ERR"
assert_eq "EA8 exactly one egress line" "$(lines42)" "1"
assert_json "EA8 gate and phase" "$(line42 1)" "[j.gate, j.mode, j.phase].join('/')" "$GATE_DESIGN42/review/p42"

export HOME="$SAVED_HOME_42"
rm -rf "$TMP42"
