#!/usr/bin/env bash
# Part 07 — Wave 7: the enforcement-flip guard (`check-enforcement.sh`, case R5
# from the wave plan's Wave 7 fixture table). Sourced by run-tests.sh.
#
# Each arm runs the check against a temp root holding a copy of the REAL
# registry and ADR, reset by root07 to a fixed baseline (both rows `warning`,
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
#   R5b  placeholder next to both commands → exit 1.    Red if the "pending Wave 7" test is dropped.
#   R5c  only the plan-review command → exit 1.         Red if only one gate's command is required.
#   R5d  complete evidence, both rows blocking → 0.     Red if the check fails whenever a row is blocking.
#   R5e  both rows warning, placeholder → exit 0.       Red if the placeholder fails the check without a blocking row.
#   R5f  wave-inspect row alone blocking → exit 1.      Red if only plan-review-xprov's cell is read.
#   R5g  a row missing from the registry → exit 1.      Red if a missing row is treated as `warning`.
#   R5h  the real tree → exit 0.                        Red if the real registry flips before the ADR holds the evidence.
#   R5i  root without registry/ADR → exit 2, no stdout. Red if a bad root is reported as a pass or a fail.
#   R5j  test.yml runs the check as its own step AFTER `Fixtures`.
#        Red if the step is removed, merged into Fixtures, or moved before it.
#   root07 baseline: on a tree whose real rows are `blocking` with complete
#        evidence, dropping the reset turns R5a, R5e, R5f and flip07 red.

TMP07="$(mktemp -d)"
[[ -n "$TMP07" && -d "$TMP07" ]] || { echo "FAIL  part 07: mktemp -d failed" >&2; exit 1; }
CHECK07="$SUITE/check-enforcement.sh"
ADR_REL07="docs/adr/2026-09-24-cross-provider-review-gate.md"
N07=0

# root07 — fresh temp root with copies of the real registry and ADR, reset to
# a fixed baseline: both xprov rows `warning`, the live-smoke section the
# placeholder. Without the reset every arm would inherit the real rollout
# state, and the legitimate flip commit would turn R5a/R5e/R5f and flip07 red
# (found by the Wave 7 live inspect, Codex R1, 2026-10-02; reproduced on a
# flipped copy: 15 FAIL). Sets R07.
root07() {
  N07=$((N07 + 1)); R07="$TMP07/root-$N07"
  mkdir -p "$R07/_shared" "$R07/docs/adr"
  cp "$REGISTRY" "$R07/_shared/gates-registry.md"
  cp "$ADR" "$R07/$ADR_REL07"
  cell07 plan-review-xprov warning; cell07 wave-inspect-xprov warning
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
printf '%s\n' 'Pending Wave 7. This section will carry the command and output of one live `review` run and one live `inspect` run.' '' > "$PLACEHOLDER07"
EVIDENCE07="$TMP07/evidence.md"
printf '%s\n' '' \
  '```' \
  'a1-tools xprov gate --phase M13-residuals --gate plan-review-xprov' \
  'a1-tools xprov gate --phase M13-residuals --gate wave-inspect-xprov --wave 2 --base 7f9d6cf' \
  '```' '' > "$EVIDENCE07"
PENDING_BOTH07="$TMP07/pending-both.md"
{ cat "$EVIDENCE07"; printf 'Pending Wave 7 for the inspect half.\n'; } > "$PENDING_BOTH07"
PLAN_ONLY07="$TMP07/plan-only.md"
printf '%s\n' '' 'a1-tools xprov gate --phase M13-residuals --gate plan-review-xprov' '' > "$PLAN_ONLY07"

# R5a
root07; flip07 plan-review-xprov; check07
assert_rc "R5a blocking row while the ADR says pending → exit 1" 1 "$C_RC"
assert_json "R5a stdout names the blocking row" "$C_OUT" 'j.rows["plan-review-xprov"]' "blocking"

# R5b
root07; flip07 plan-review-xprov; flip07 wave-inspect-xprov; smoke07 "$PENDING_BOTH07"; check07
assert_rc "R5b both commands present but still pending Wave 7 → exit 1" 1 "$C_RC"
assert_json "R5b the only problem is the placeholder" "$C_OUT" 'j.problems.length + ":" + /pending Wave 7/.test(j.problems[0])' "1:true"

# R5c
root07; flip07 plan-review-xprov; flip07 wave-inspect-xprov; smoke07 "$PLAN_ONLY07"; check07
assert_rc "R5c inspect command missing → exit 1" 1 "$C_RC"
assert_json "R5c the problem names wave-inspect-xprov" "$C_OUT" 'j.problems.length + ":" + j.problems[0].endsWith("wave-inspect-xprov")' "1:true"

# R5d
root07; flip07 plan-review-xprov; flip07 wave-inspect-xprov; smoke07 "$EVIDENCE07"; check07
assert_rc "R5d evidence complete, both rows blocking → exit 0" 0 "$C_RC"
assert_json "R5d ok true" "$C_OUT" 'String(j.ok)' "true"

# R5e
root07; check07
assert_rc "R5e both rows warning, ADR placeholder → exit 0" 0 "$C_RC"
assert_json "R5e rows read as warning" "$C_OUT" 'j.rows["plan-review-xprov"] + "," + j.rows["wave-inspect-xprov"]' "warning,warning"

# R5f
root07; flip07 wave-inspect-xprov; check07
assert_rc "R5f wave-inspect-xprov alone blocking → exit 1" 1 "$C_RC"

# R5g
root07; drop07 wave-inspect-xprov; check07
assert_rc "R5g row missing from the registry → exit 1" 1 "$C_RC"
assert_json "R5g missing row reads null" "$C_OUT" 'String(j.rows["wave-inspect-xprov"])' "null"

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

rm -rf "$TMP07"
