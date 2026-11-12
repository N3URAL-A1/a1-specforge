#!/usr/bin/env bash
# Part 07 — Wave 7: the enforcement-flip guard (`check-enforcement.sh`, case R5
# from the wave plan's Wave 7 fixture table). Sourced by run-tests.sh.
#
# Each arm runs the check against a temp root holding a copy of the REAL
# registry and ADR, reset by root07 to a fixed baseline (the plan row `warning`,
# the live-smoke placeholder), then one edit: a row flipped to `blocking`, or
# the ADR's live-smoke section replaced. The arms therefore hold before AND
# after the real flip; only R5h reads the real rollout state. The expectations
# below are literals. Nothing is imported from the check (testing.md class 4).
#
# RED phase (2026-09-28, before check-enforcement.sh and the CI step existed):
# every arm failed. R5a–R5i got exit 127 (the script was missing), and R5j
# found no enforcement step in test.yml.
#
# Arm → the single production change that turns it red:
#   R5a  blocking row + ADR placeholder → exit 1.       Red if the check never reads the ADR when a row is blocking.
#   R5b  placeholder next to the plan command → exit 1. Red if the "pending Wave 7" test is dropped.
#   R5c  the plan-review command missing → exit 1.      Red if the command is not required.
#   R5d  complete evidence, plan row blocking → 0.      Red if the check fails whenever a row is blocking.
#   R5e  plan row warning, placeholder → exit 0.        Red if the placeholder fails the check without a blocking row.
#   (R5f, the wave-inspect row alone blocking, went with the wave gate in spec 025 W4.)
#   R5g  a row missing from the registry → exit 1.      Red if a missing row is treated as `warning`.
#   R5h  the real tree → exit 0.                        Red if the real registry flips before the ADR holds the evidence.
#   R5i  root without registry/ADR → exit 2, no stdout. Red if a bad root is reported as a pass or a fail.
#   R5l-o spec 025 W5: design row warning next to a blocking plan row → 0; design blocking without its command → 1;
#        both blocking with both commands → 0; design row missing → 1.
#        Red if GATES lacks the design id, or the live-smoke loop checks warning rows.
#   R5k  a placeholder spelled "Pending: Wave 7" next to the plan command → exit 1.
#        Red if PLACEHOLDER_RE only matches the literal "pending wave 7".
#   R5j  test.yml runs the check as its own step AFTER `Fixtures`.
#        Red if the step is removed, merged into Fixtures, or moved before it.
#   root07 baseline: on a tree whose real rows are `blocking` with complete
#        evidence, dropping the reset turns R5a, R5e, R5f and flip07 red.

mk_workdir TMP07 tmp07
[[ -n "$TMP07" && -d "$TMP07" ]] || { echo "FAIL  part 07: mktemp -d failed" >&2; exit 1; }
CHECK07="$SUITE/check-enforcement.sh"
ADR_REL07="docs/adr/2026-09-24-cross-provider-review-gate.md"
N07=0

# root07 — fresh temp root with copies of the real registry and ADR, reset to
# a fixed baseline: the xprov plan row `warning`, the live-smoke section the
# placeholder. Without the reset every arm would inherit the real rollout
# state, and the legitimate flip commit would turn R5a/R5e/R5f and flip07 red
# (found by the Wave 7 live inspect, Codex R1, 2026-10-02; reproduced on a
# flipped copy: 15 FAIL). Sets R07.
root07() {
  N07=$((N07 + 1)); R07="$TMP07/root-$N07"
  mkdir -p "$R07/_shared" "$R07/docs/adr"
  cp "$REGISTRY" "$R07/_shared/gates-registry.md"
  cp "$ADR" "$R07/$ADR_REL07"
  cell07 plan-review-xprov warning
  smoke07 "$PLACEHOLDER07"
}

# cell07 <gate-id> <warning|blocking> — sets that row's enforcement cell,
# whatever it held before.
cell07() {
  node -e '
    const fs = require("fs"); const [file, id, value] = process.argv.slice(1);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const i = lines.findIndex((l) => l.startsWith("| `" + id + "` |"));
    if (i === -1 || !/\| (warning|blocking) \|/.test(lines[i])) { console.error("cell07: no row " + id); process.exit(1); }
    lines[i] = lines[i].replace(/\| (warning|blocking) \|/, "| " + value + " |");
    fs.writeFileSync(file, lines.join("\n"));
  ' "$R07/_shared/gates-registry.md" "$1" "$2" || bad "cell07 $1 $2: setup failed"
}

# flip07 <gate-id> — rewrites that row's `| warning |` cell to `| blocking |`.
flip07() {
  node -e '
    const fs = require("fs"); const [file, id] = process.argv.slice(1);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const i = lines.findIndex((l) => l.startsWith("| `" + id + "` |"));
    if (i === -1 || !lines[i].includes("| warning |")) { console.error("flip07: no warning row " + id); process.exit(1); }
    lines[i] = lines[i].replace("| warning |", "| blocking |");
    fs.writeFileSync(file, lines.join("\n"));
  ' "$R07/_shared/gates-registry.md" "$1" || bad "flip07 $1: setup failed"
}

# drop07 <gate-id> — deletes that row from the registry copy.
drop07() {
  node -e '
    const fs = require("fs"); const [file, id] = process.argv.slice(1);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    fs.writeFileSync(file, lines.filter((l) => !l.startsWith("| `" + id + "` |")).join("\n"));
  ' "$R07/_shared/gates-registry.md" "$1"
}

# smoke07 <body-file> — replaces the body of the ADR's `### 6. Live smoke`
# section (up to the next heading) with the file's text.
smoke07() {
  node -e '
    const fs = require("fs"); const [file, bodyFile] = process.argv.slice(1);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const s = lines.findIndex((l) => /^### 6\. Live smoke/.test(l));
    if (s === -1) { console.error("smoke07: no section"); process.exit(1); }
    const rel = lines.slice(s + 1).findIndex((l) => /^#{1,3}\s/.test(l));
    const e = rel === -1 ? lines.length : s + 1 + rel;
    const body = fs.readFileSync(bodyFile, "utf8").split("\n");
    fs.writeFileSync(file, [...lines.slice(0, s + 1), ...body, ...lines.slice(e)].join("\n"));
  ' "$R07/$ADR_REL07" "$1" || bad "smoke07: setup failed"
}

# check07 [root] — runs the check. Sets C_OUT, C_RC.
check07() {
  C_OUT="$(bash "$CHECK07" "${1:-$R07}" 2>"$TMP07/check-err.txt")"; C_RC=$?
}

PLACEHOLDER07="$TMP07/placeholder.md"
printf '%s\n' 'Pending Wave 7. This section will carry the command and output of one live `review` run.' '' > "$PLACEHOLDER07"
EVIDENCE07="$TMP07/evidence.md"
printf '%s\n' '' \
  '```' \
  'a1-tools xprov gate --phase M13-residuals --gate plan-review-xprov' \
  '```' '' > "$EVIDENCE07"
PENDING_BOTH07="$TMP07/pending-both.md"
{ cat "$EVIDENCE07"; printf 'Pending Wave 7 for the live run.\n'; } > "$PENDING_BOTH07"
NO_COMMAND07="$TMP07/no-command.md"
printf '%s\n' '' 'The live run is described in prose only.' '' > "$NO_COMMAND07"

# R5a
root07; flip07 plan-review-xprov; check07
assert_rc "R5a blocking row while the ADR says pending → exit 1" 1 "$C_RC"
assert_json "R5a stdout names the blocking row" "$C_OUT" 'j.rows["plan-review-xprov"]' "blocking"

# R5b
root07; flip07 plan-review-xprov; smoke07 "$PENDING_BOTH07"; check07
assert_rc "R5b plan command present but still pending Wave 7 → exit 1" 1 "$C_RC"
assert_json "R5b the only problem is the placeholder" "$C_OUT" 'j.problems.length + ":" + /pending Wave 7/.test(j.problems[0])' "1:true"

# R5k — the placeholder in another spelling
PENDING_ALT07="$TMP07/pending-alt.md"
{ cat "$EVIDENCE07"; printf 'Pending: Wave 7 (live run).\n'; } > "$PENDING_ALT07"
root07; flip07 plan-review-xprov; smoke07 "$PENDING_ALT07"; check07
assert_rc "R5k \"Pending: Wave 7\" next to the plan command → exit 1" 1 "$C_RC"

# R5c
root07; flip07 plan-review-xprov; smoke07 "$NO_COMMAND07"; check07
assert_rc "R5c plan-review command missing → exit 1" 1 "$C_RC"
assert_json "R5c the problem names plan-review-xprov" "$C_OUT" 'j.problems.length + ":" + j.problems[0].endsWith("plan-review-xprov")' "1:true"

# R5d
root07; flip07 plan-review-xprov; smoke07 "$EVIDENCE07"; check07
assert_rc "R5d evidence complete, plan row blocking → exit 0" 0 "$C_RC"
assert_json "R5d ok true" "$C_OUT" 'String(j.ok)' "true"

# R5e
root07; check07
assert_rc "R5e plan row warning, ADR placeholder → exit 0" 0 "$C_RC"
assert_json "R5e rows read as warning" "$C_OUT" 'j.rows["plan-review-xprov"]' "warning"

# R5g
root07; drop07 plan-review-xprov; check07
assert_rc "R5g row missing from the registry → exit 1" 1 "$C_RC"
assert_json "R5g missing row reads null" "$C_OUT" 'String(j.rows["plan-review-xprov"])' "null"

# R5l — spec 025 W5: plan blocking with its evidence, design warning without any design command → exit 0 (the live-smoke loop checks blocking rows only)
root07; flip07 plan-review-xprov; smoke07 "$EVIDENCE07"; check07
assert_rc "R5l plan blocking + design warning, only the plan command in the live smoke → exit 0" 0 "$C_RC"
assert_json "R5l rows read blocking/warning" "$C_OUT" 'j.rows["plan-review-xprov"] + "/" + j.rows["design-review-xprov"]' "blocking/warning"

# R5m — the design row flipped to blocking without its command in the ADR → exit 1
root07; flip07 plan-review-xprov; flip07 design-review-xprov; smoke07 "$EVIDENCE07"; check07
assert_rc "R5m design row blocking without its live-smoke command → exit 1" 1 "$C_RC"
assert_json "R5m the only problem names design-review-xprov" "$C_OUT" 'j.problems.length + ":" + j.problems[0].endsWith("design-review-xprov")' "1:true"

# R5n — both rows blocking, both commands present → exit 0
BOTH07="$TMP07/both.md"
printf '%s\n' '' '```' 'a1-tools xprov gate --phase M13-residuals --gate plan-review-xprov' 'a1-tools xprov gate --phase M13-residuals --gate design-review-xprov --doc docs/adr/x.md' '```' '' > "$BOTH07"
root07; flip07 plan-review-xprov; flip07 design-review-xprov; smoke07 "$BOTH07"; check07
assert_rc "R5n both rows blocking, both commands in the live smoke → exit 0" 0 "$C_RC"

# R5o — the design row missing from the registry → exit 1
root07; drop07 design-review-xprov; check07
assert_rc "R5o design row missing from the registry → exit 1" 1 "$C_RC"
assert_json "R5o missing design row reads null" "$C_OUT" 'String(j.rows["design-review-xprov"])' "null"

# R5h — the real tree (today: warning; after the flip: blocking with evidence)
check07 "$REPO_ROOT"
assert_rc "R5h real tree passes the guard" 0 "$C_RC"

# R5i
mkdir -p "$TMP07/empty-root"
check07 "$TMP07/empty-root"
assert_rc "R5i root without registry/ADR → exit 2" 2 "$C_RC"
assert_eq "R5i usage error prints no stdout JSON" "$C_OUT" ""

# R5j — step order in the CI workflow
STEPS07="$(node -e '
  const lines = require("fs").readFileSync(process.argv[1], "utf8").split("\n");
  const steps = []; let cur = null;
  for (const l of lines) {
    const m = l.match(/^\s*- (?:name|uses):\s*(.*)$/);
    if (m) { cur = { name: m[1].trim(), body: "" }; steps.push(cur); continue; }
    if (cur) cur.body += l + "\n";
  }
  const fx = steps.findIndex((s) => s.name === "Fixtures");
  const ce = steps.findIndex((s) => s.body.includes("_test-fixtures/a1-xprov/check-enforcement.sh"));
  process.stdout.write(`${fx}:${ce}:${fx >= 0 && ce > fx}`);
' "$REPO_ROOT/.github/workflows/test.yml")"
assert_eq "R5j CI runs check-enforcement.sh as its own step after Fixtures" "${STEPS07##*:}" "true"

# R5j2 (PR review fix round) — the job that runs check-enforcement.sh lists, under `needs:`, every job that has a
# `run-suites.sh --job` call (a new fixture job cannot be left out of the ordering).
needs07() { # <workflow> — prints "ok" or "missing: <jobs>" (or "no enforcement job")
  node -e '
    const lines = require("fs").readFileSync(process.argv[1], "utf8").split("\n");
    const jobs = []; let cur = null; let inJobs = false;
    for (const l of lines) {
      if (/^jobs:\s*$/.test(l)) { inJobs = true; continue; }
      if (inJobs && /^\S/.test(l)) inJobs = false;
      const m = inJobs && l.match(/^  ([A-Za-z0-9_-]+):\s*$/);
      if (m) { cur = { name: m[1], body: [] }; jobs.push(cur); continue; }
      if (cur && inJobs) cur.body.push(l);
    }
    const code = (j) => j.body.filter((l) => !/^\s*#/.test(l));
    const callers = jobs.filter((j) => code(j).some((l) => /run-suites\.sh.*--job/.test(l))).map((j) => j.name);
    const enf = jobs.find((j) => code(j).some((l) => l.includes("_test-fixtures/a1-xprov/check-enforcement.sh")));
    if (!enf) { process.stdout.write("no enforcement job"); process.exit(0); }
    const body = code(enf).join("\n");
    const inline = body.match(/^\s*needs:\s*(.*)$/m);
    let needs = [];
    if (inline && inline[1].trim() !== "") needs = inline[1].replace(/[\[\]"]/g, "").split(",").map((x) => x.trim());
    else if (inline) needs = [...body.matchAll(/^\s*-\s+([A-Za-z0-9_-]+)\s*$/gm)].map((x) => x[1]);
    const missing = callers.filter((c) => !needs.includes(c));
    process.stdout.write(callers.length === 0 ? "no fixture job calls" : missing.length ? "missing: " + missing.join(" ") : "ok");
  ' "$1"
}
assert_eq "R5j2 the enforcement job needs every job with a run-suites.sh --job call" "$(needs07 "$REPO_ROOT/.github/workflows/test.yml")" "ok"
mkdir -p "$TMP07/wf"
grep -v '^    needs:' "$REPO_ROOT/.github/workflows/test.yml" > "$TMP07/wf/no-needs.yml"
assert_eq "R5j3 without the needs line the guard names the fixture jobs" "$(needs07 "$TMP07/wf/no-needs.yml")" "missing: fixtures-xprov fixtures-rest"
sed 's/^    needs: .*/    needs: [fixtures-xprov]/' "$REPO_ROOT/.github/workflows/test.yml" > "$TMP07/wf/one-needs.yml"
assert_eq "R5j4 a needs list without one fixture job names it" "$(needs07 "$TMP07/wf/one-needs.yml")" "missing: fixtures-rest"

rm -rf "$TMP07"
