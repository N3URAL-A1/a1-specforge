#!/usr/bin/env bash
# Fixture: `a1-tools gates lint` (spec 017-enforced-self-checks, Wave 1, FR-001..FR-005).
#
# Inputs are copies of real files (corpus/): seven verbatim rows of the real
# gates registry and the real workflow files of five skills (frozen at the wave 1
# commit). Planted defects are string edits of those copies, never parser output.
# Each case names the single production change that turns it red and records
# "Measured red <date>" (git-archive snapshot, line reverted, suite run).
#
# Measured red 2026-10-20 (each on its own snapshot, only the named case family fails):
#   gates-lint.cjs isCallLine(): `#`/echo exclusion removed      -> R6c, R6d
#   gates-lint.cjs callRegex(): lookahead boundary removed       -> R6e
#   gates-lint.cjs checkSkills(): `if (!ex.active)` -> always    -> G2, G3, R4a live exemption
#   gates-lint.cjs checkSkills(): unwired findings dropped       -> R1, R2, R4b, R5j, R6c-e, M1
#   gates-lint.cjs exemptionState(): expiry test removed         -> R4b expired
#   gates-lint.cjs gradeRow(): blocking_unwired branch removed   -> R3a
#   gates-lint.cjs gradeRow(): prompt_names_command removed      -> R3b
#   gates-lint.cjs duplicateFindings(): body removed             -> R3c
#   gates-lint.cjs skillDirExists(): name-pattern guard removed   -> R3d unknown skill
#   gates-lint.cjs lintGates(): no_invoke_column branch removed  -> R3f
#   gate-ids.cjs EXEMPTION_RE: reason made optional              -> R4e empty reason
#   gate-ids.cjs isRealDate(): returns true                      -> R4d impossible date
#   gate-ids.cjs splitRowCells(): `\|` handling removed          -> R4f escaped pipe in the invoke cell
#   gate-ids.cjs parseRegistryRows(): positional-tail logic      -> G2, G3, R1 (rows with a stray pipe)
#   gates-cli.cjs: leftover-argument check removed               -> R5a, R5b
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
CORPUS="$REPO_ROOT/_test-fixtures/a1-gates-lint/corpus"
REAL_ROWS="$CORPUS/registry-real-rows.md"
OLD_REGISTRY="$REPO_ROOT/_test-fixtures/a1-retro-validate/corpus/fixture-registry.md"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/a1-fx-gates-lint.XXXXXX")" || exit 1
[[ -n "$WORK" && -d "$WORK" ]] || exit 1
trap 'rm -rf "${WORK:?}"' EXIT

pass=0
fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }

# run_lint <args...> -> OUT (stdout JSON), ERR (stderr), RC
run_lint() {
  OUT="$(node "$TOOLS" gates lint "$@" 2>"$WORK/err")"; RC=$?
  ERR="$(cat "$WORK/err")"
}

# js <expr over j> -> prints expr result for the last OUT
js() { node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(String('"$1"'))' "$OUT" 2>&1; }

# check <label> <want-rc> <js expr> <want value>
check() {
  local label="$1" wrc="$2" expr="$3" want="$4" got
  got="$(js "$expr")"
  if [[ "$RC" -eq "$wrc" && "$got" == "$want" ]]; then ok "$label"
  else bad "$label (rc=$RC want=$wrc; got=$got want=$want; err=$ERR)"; fi
}

# check_rc <label> <want-rc> — exit code only, for exit-2 cases that print no JSON
check_rc() {
  if [[ "$RC" -eq "$2" ]]; then ok "$1"; else bad "$1 (rc=$RC want=$2; err=$ERR)"; fi
}

# tree <name> — a fresh copy of the real skill tree under $WORK/<name>, with a registry path var
tree() {
  rm -rf "${WORK:?}/$1"; mkdir -p "$WORK/$1"
  cp -R "$CORPUS/skills" "$WORK/$1/skills"
}

# plant <src> <dst> <js code mutating variable s> — string edit of a real copy
plant() {
  node -e '
    const fs=require("fs"); let s=fs.readFileSync(process.argv[1],"utf8");
    '"$3"'
    fs.writeFileSync(process.argv[2], s);' "$1" "$2"
}

STRIP_EX='s = s.replace(/; unwired_until=\d{4}-\d{2}-\d{2}; unwired_reason=[^|\n]*? \|$/gm, " |");'
# keep header, separator and the named rows only
keep_rows() { # keep_rows <dst> <id>...
  local dst="$1"; shift
  node -e '
    const fs=require("fs"); const ids=process.argv.slice(2);
    const lines=fs.readFileSync(process.argv[1],"utf8").split("\n");
    const keep=lines.filter(l=>l.startsWith("| id |")||l.startsWith("|---|")||ids.some(i=>l.startsWith("| `"+i+"` |")));
    fs.writeFileSync(process.argv[3], keep.join("\n")+"\n");' "$REAL_ROWS" x "$dst" "$@"
}

tree base

# ---------- G1: fully wired registry, no exemption -> exit 0 ----------
keep_rows "$WORK/wired.md" gate-c-ac-dryrun check-reservations no-imported-expectations
run_lint --root "$WORK/base" --registry "$WORK/wired.md"
check "G1 wired registry: exit 0, 0 findings, 3 rows, 1 wired call (count asserts)" 0 \
  'j.findings.length+"/"+j.rows+"/"+j.wired.length+"/"+j.wired[0].gate' "0/3/1/check-reservations"

# ---------- G2: real rows with live exemptions -> exit 0, all four listed ----------
run_lint --root "$WORK/base" --registry "$REAL_ROWS" --today 2026-10-20
check "G2 real rows: exit 0, exemptions listed incl. the row with \\| and the row with a stray | (count + names)" 0 \
  'j.findings.length+"/"+j.exemptions.map(e=>e.gate).sort().join(",")' \
  "0/gate-0.6-schema,gate-0.7-realpath,spec-roadmap-status-coherent,test-fidelity"

# G3: the real repo is clean today (exemptions may be listed; wave 13 empties them)
run_lint
check_rc "G3 real repo registry + skills tree: exit 0" 0

# ---------- R1: planted unwired gate (FR-005) -> exit 1, names gate/skill/files ----------
plant "$REAL_ROWS" "$WORK/r1.md" "$STRIP_EX"
run_lint --root "$WORK/base" --registry "$WORK/r1.md" --today 2026-10-20
check "R1 unexempted rows: exit 1, exactly 8 unwired findings (gate/skill pairs), realpath wired in a1-new-feature" 1 \
  'j.findings.filter(f=>f.rule==="unwired").map(f=>f.gate+":"+f.skill).sort().join(",")+"|"+j.findings.length' \
  "gate-0.6-schema:a1-execute,gate-0.6-schema:a1-new-feature,gate-0.7-realpath:a1-execute,gate-0.7-realpath:a1-fix,spec-roadmap-status-coherent:a1-pr-review,test-fidelity:a1-execute,test-fidelity:a1-fix,test-fidelity:a1-new-feature|8"
check "R1b finding names the files searched (SKILL.md + workflows/*.md of a1-execute)" 1 \
  'JSON.stringify(j.findings.find(f=>f.gate==="gate-0.7-realpath"&&f.skill==="a1-execute").searched.map(p=>p.split("/skills/")[1]))' \
  '["a1-execute/SKILL.md","a1-execute/workflows/02-execute.md"]'
case "$ERR" in *"gate-0.7-realpath"*"unwired"*"a1-execute"*) ok "R1c stderr line names gate id and skill";; *) bad "R1c stderr ($ERR)";; esac

# ---------- R2: prose mention vs fenced block (FR-003) ----------
# 05-implement.md holds `schema-check run` in prose only (Gate 0.6) and `realpath-check run` fenced.
keep_rows "$WORK/r2-one.md" gate-0.6-schema
plant "$WORK/r2-one.md" "$WORK/r2-one.md" "$STRIP_EX"' s = s.replace("`schema-check run` @ a1-execute,a1-new-feature","`schema-check run` @ a1-new-feature");'
run_lint --root "$WORK/base" --registry "$WORK/r2-one.md"
check "R2 prose-only mention: exit 1 unwired in a1-new-feature" 1 'j.findings.map(f=>f.rule+":"+f.skill).join(",")' "unwired:a1-new-feature"
tree r2fenced
printf '\n```bash\nnode <repo>/_shared/a1-tools.cjs schema-check run --migrations db/migrations\n```\n' >> "$WORK/r2fenced/skills/a1-new-feature/workflows/05-implement.md"
run_lint --root "$WORK/r2fenced" --registry "$WORK/r2-one.md"
check "R2b same call in a fenced bash block: exit 0, 1 wired call" 0 'j.findings.length+"/"+j.wired.length' "0/1"

# ---------- R3: invoke grammar rules (FR-002) ----------
keep_rows "$WORK/r3a-one.md" gate-0.7-realpath
plant "$WORK/r3a-one.md" "$WORK/r3a-one.md" "$STRIP_EX"' s = s.replace(/`realpath-check run` @ a1-execute,a1-new-feature,a1-fix \|$/m, "none |");'
run_lint --root "$WORK/base" --registry "$WORK/r3a-one.md"
check "R3a deterministic+blocking row with none: exit 1 blocking_unwired" 1 'j.findings.map(f=>f.rule).join(",")' "blocking_unwired"

keep_rows "$WORK/r3b.md" gate-c-ac-dryrun
plant "$WORK/r3b.md" "$WORK/r3b.md" 's = s.replace(/\| none \|$/m, "| `check reservations` @ a1-new-feature |");'
run_lint --root "$WORK/base" --registry "$WORK/r3b.md"
check "R3b prompt row naming a subcommand: exit 1 prompt_names_command" 1 'j.findings.map(f=>f.rule).join(",")' "prompt_names_command"

keep_rows "$WORK/r3c.md" check-reservations
plant "$WORK/r3c.md" "$WORK/r3c.md" 'const row=s.split("\n").find(l=>l.startsWith("| `check-reservations`")); s=s+row.replace("check-reservations","check-reservations-copy")+"\n";'
run_lint --root "$WORK/base" --registry "$WORK/r3c.md"
check "R3c same subcommand declared by two rows: exit 1 duplicate_subcommand (exactly one)" 1 \
  'j.findings.filter(f=>f.rule==="duplicate_subcommand").length+"/"+j.findings.length' "1/1"

keep_rows "$WORK/r3d.md" check-reservations
plant "$WORK/r3d.md" "$WORK/r3d.md" 's = s.replace("@ a1-new-feature","@ a1-no-such-skill");'
run_lint --root "$WORK/base" --registry "$WORK/r3d.md"
check "R3d unknown skill: exit 1 unknown_skill" 1 'j.findings.map(f=>f.rule+":"+f.skill).join(",")' "unknown_skill:a1-no-such-skill"

keep_rows "$WORK/r3e.md" check-reservations
plant "$WORK/r3e.md" "$WORK/r3e.md" 's = s.replace(/`check reservations` @ a1-new-feature \|$/m, " |");'
run_lint --root "$WORK/base" --registry "$WORK/r3e.md"
check "R3e empty invoke cell: exit 1 invoke_invalid" 1 'j.findings.map(f=>f.rule).join(",")' "invoke_invalid"

run_lint --root "$WORK/base" --registry "$OLD_REGISTRY"
check "R3f registry without invoke column (real old fixture registry): exit 1 no_invoke_column" 1 'j.findings.map(f=>f.rule).join(",")' "no_invoke_column"

# ---------- R4: exemption dates (FR-004) ----------
keep_rows "$WORK/r4.md" gate-0.7-realpath
run_lint --root "$WORK/base" --registry "$WORK/r4.md" --today 2026-11-30
check "R4a exemption on its last day: exit 0, listed" 0 'j.findings.length+"/"+j.exemptions.length' "0/1"
run_lint --root "$WORK/base" --registry "$WORK/r4.md" --today 2026-12-01
check "R4b the day after: exit 1 exemption_expired (and the row counts as unwired again)" 1 \
  'j.findings.map(f=>f.rule).sort().join(",")' "exemption_expired,unwired,unwired"
plant "$WORK/r4.md" "$WORK/r4c.md" 's = s.replace(/; unwired_reason=[^|\n]*? \|$/m, " |");'
run_lint --root "$WORK/base" --registry "$WORK/r4c.md"
check "R4c suffix without unwired_reason: exit 1 invoke_invalid" 1 'j.findings.map(f=>f.rule).join(",")' "invoke_invalid"
plant "$WORK/r4.md" "$WORK/r4d.md" 's = s.replace("unwired_until=2026-11-30","unwired_until=2026-02-30");'
run_lint --root "$WORK/base" --registry "$WORK/r4d.md"
check "R4d impossible date 2026-02-30: exit 1 invoke_invalid" 1 'j.findings.map(f=>f.rule).join(",")' "invoke_invalid"

plant "$WORK/r4.md" "$WORK/r4e.md" 's = s.replace(/; unwired_reason=[^|\n]*? \|$/m, "; unwired_reason= |");'
run_lint --root "$WORK/base" --registry "$WORK/r4e.md"
check "R4e exemption with an empty unwired_reason: exit 1 invoke_invalid" 1 'j.findings.map(f=>f.rule).join(",")' "invoke_invalid"
plant "$WORK/r4.md" "$WORK/r4f.md" 's = s.replace(/; unwired_reason=[^|\n]*? \|$/m, "; unwired_reason=wave 12 \\| then 13 |");'
run_lint --root "$WORK/base" --registry "$WORK/r4f.md" --today 2026-10-20
check "R4f escaped pipe inside the invoke cell stays one cell: exit 0, reason keeps the pipe" 0 \
  'j.findings.length+"/"+j.exemptions[0].reason' "0/wave 12 | then 13"

# ---------- R5: hostile input and exit 2 ----------
run_lint --bogus;                                          check_rc "R5a unknown flag: exit 2" 2
run_lint stray;                                            check_rc "R5b stray positional argument: exit 2" 2
run_lint --registry "$WORK/does-not-exist.md";             check_rc "R5c missing registry: exit 2" 2
run_lint --root "$WORK/wired.md";                          check_rc "R5d --root is a file: exit 2" 2
run_lint --today 20261201;                                 check_rc "R5e malformed --today: exit 2" 2
run_lint --registry "$(printf 'a%.0s' $(seq 1 5000))";     check_rc "R5f oversized --registry value: exit 2" 2
OUT="$(node "$TOOLS" gates bogus 2>/dev/null)"; RC=$?;      check_rc "R5g unknown subcommand: exit 2" 2
head -c 3000000 /dev/zero | tr '\0' 'x' > "$WORK/huge.md"
run_lint --registry "$WORK/huge.md";                       check_rc "R5h registry above the size cap: exit 2" 2
keep_rows "$WORK/r5i.md" check-reservations
plant "$WORK/r5i.md" "$WORK/r5i.md" 's = s.replace("@ a1-new-feature","@ ../../etc");'
run_lint --root "$WORK/base" --registry "$WORK/r5i.md"
check "R5i path-traversal skill name: exit 1 invoke_invalid, nothing read outside skills/" 1 'j.findings.map(f=>f.rule).join(",")' "invoke_invalid"
SENTINEL="$WORK/pwned"
plant "$WORK/wired.md" "$WORK/r5j.md" 's = s.replace("`check reservations` @ a1-new-feature","`check reservations $(touch '"$SENTINEL"'); touch '"$SENTINEL"'` @ a1-new-feature");'
run_lint --root "$WORK/base" --registry "$WORK/r5j.md"
check "R5j shell metacharacters in the subcommand are inert text: exit 1 unwired" 1 'j.findings.map(f=>f.rule).join(",")' "unwired"
[[ ! -e "$SENTINEL" ]] && ok "R5k no command substitution ran (sentinel file absent)" || bad "R5k sentinel exists: input was executed"

# ---------- R6: what counts as a call (FR-003) ----------
one() { # one <call-text> -> exit 0 only when a fenced call of `check reservations` is found
  rm -rf "${WORK:?}/t6"; mkdir -p "$WORK/t6/skills/a1-new-feature/workflows"
  printf '# SKILL\n' > "$WORK/t6/skills/a1-new-feature/SKILL.md"
  printf '```bash\n%s\n```\n' "$1" > "$WORK/t6/skills/a1-new-feature/workflows/x.md"
  run_lint --root "$WORK/t6" --registry "$WORK/wired.md"
}
one 'node <repo>/_shared/a1-tools.cjs check reservations --claim'; check_rc "R6a plain fenced call counts: exit 0" 0
one 'node <repo>/_shared/a1-tools.cjs check \
  reservations --claim';                                   check_rc "R6b call split by a line continuation counts: exit 0" 0
one '# node <repo>/_shared/a1-tools.cjs check reservations'; check_rc "R6c commented-out call does not count: exit 1" 1
one 'echo "node a1-tools.cjs check reservations"';          check_rc "R6d echoed text does not count: exit 1" 1
one 'node <repo>/_shared/a1-tools.cjs check reservationsX'; check_rc "R6e longer word does not count (boundary): exit 1" 1

# ---------- M1: mutation-proof — planted defect turns the same run red, revert turns it green ----------
tree m1
run_lint --root "$WORK/m1" --registry "$WORK/wired.md"; green_rc=$RC
rm "$WORK/m1/skills/a1-new-feature/workflows/04.5-consistency-gate.md"
run_lint --root "$WORK/m1" --registry "$WORK/wired.md"; red_rc=$RC
cp "$CORPUS/skills/a1-new-feature/workflows/04.5-consistency-gate.md" "$WORK/m1/skills/a1-new-feature/workflows/"
run_lint --root "$WORK/m1" --registry "$WORK/wired.md"; back_rc=$RC
if [[ $green_rc -eq 0 && $red_rc -eq 1 && $back_rc -eq 0 ]]; then ok "M1 removing the only fenced call turns the lint red, restoring it turns it green (0/1/0)"
else bad "M1 mutation proof ($green_rc/$red_rc/$back_rc)"; fi

# ===========================================================================
# Spec 017 Wave 2 — the gate log (FR-008) and `gates lint --log` (FR-010).
# Gates are run through the REAL facade hook in throwaway git repos: `realpath-check
# run` (verbatim the call a workflow makes) and `check reservations --list`.
# Measured red 2026-10-20 (git-archive snapshot, one line reverted each):
#   gate-log.cjs appendGateLine(): `prev` always ZERO_HASH               -> F3, F3b, F8, F8b, F9a-g
#   gate-log.cjs appendGateLine(): acquireLock() replaced by a no-op         -> F8 (parallel writers fork the chain)
#   gate-log.cjs appendGateLine(): ensureExcluded call removed           -> F2
#   gate-log.cjs ensureExcluded(): idempotence check removed             -> F2b
#   gate-log.cjs verdictForExit(): exit 1 -> pass                        -> F3
#   gate-log.cjs recordRun(): UNSCOPED notice removed                    -> F4
#   gate-log.cjs recordRun(): notice printed for scoped runs too         -> F4b
#   gate-log.cjs installGateLog(): returns argv, not the stripped argv   -> F8 (check reservations rejects the unknown --phase)
#   gate-log.cjs SCOPE_RE: `..`/`/` accepted                             -> F6
#   gate-log.cjs matchInvoke(): sub-token compare removed                -> F5
#   gate-log.cjs matchInvoke(): required `--flag` tokens ignored         -> F11
#   gate-log.cjs verifyChain(): prev comparison removed                  -> F9a, F9b, F9g, F8b (+ retro L7b, L9c)
#   gate-log.cjs verifyChain(): shapeProblem() removed                   -> F9d
#   gate-log.cjs recordRun(): git context check removed                  -> F7
#   gate-log.cjs verdictForExit(): exit 0 -> fail                        -> a1-schema-check gate-log case
# ===========================================================================

GLR="$WORK/glrepo"
mkdir -p "$GLR" && git -C "$GLR" init -q && git -C "$GLR" config user.email t@t.dev && git -C "$GLR" config user.name test || exit 1
echo seed > "$GLR/seed.txt"; git -C "$GLR" add -A; git -C "$GLR" commit -qm base
mkdir -p "$GLR/src"; echo 'export const add = (a, b) => a + b;' > "$GLR/src/util.js"; git -C "$GLR" add -A; git -C "$GLR" commit -qm feat
GL="$GLR/.a1/phases/w1/gate-log.jsonl"
inrepo() { local d="$1"; shift; (cd "$d" && node "$TOOLS" "$@"); } # run a1-tools with cwd = repo

# F1 FR-008 line shape
inrepo "$GLR" realpath-check run --phase w1 --diff-base HEAD~1 --project . >/dev/null 2>"$WORK/err"; RC=$?
HEAD_SHA="$(git -C "$GLR" rev-parse HEAD)"
SHAPE="$(node -e '
  const fs=require("fs"); const t=fs.readFileSync(process.argv[1],"utf8"); const lines=t.split("\n").filter(Boolean);
  const r=JSON.parse(lines[0]);
  process.stdout.write([lines.length, Object.keys(r).join(","), r.gate, r.verdict, r.exit, r.head_sha===process.argv[2], r.scope, r.prev==="0".repeat(64), !Number.isNaN(Date.parse(r.ts))&&r.ts.endsWith("Z")].join("|"));' "$GL" "$HEAD_SHA" 2>&1)"
[[ $RC -eq 0 && "$SHAPE" == "1|ts,gate,verdict,exit,head_sha,scope,prev|gate-0.7-realpath|pass|0|true|w1|true|true" ]] \
  && ok "F1 one line with ts, gate id, verdict, exit, head sha, scope, 64-zero prev" || bad "F1 (rc=$RC shape=$SHAPE err=$(cat "$WORK/err"))"

# F2 never committed: clean porcelain, exclude entry present exactly once even after a second call
PORC="$(git -C "$GLR" status --porcelain)"
inrepo "$GLR" realpath-check run --phase w1 --diff-base HEAD~1 --project . >/dev/null 2>&1
COUNT="$(grep -cxF '.a1/phases/*/gate-log.jsonl' "$(git -C "$GLR" rev-parse --git-common-dir | sed "s|^[^/]|$GLR/&|")/info/exclude")"
[[ -z "$PORC" && -z "$(git -C "$GLR" status --porcelain)" ]] && ok "F2 git status --porcelain is empty after gate calls (log + lock are not visible)" || bad "F2 porcelain: $PORC"
[[ "$COUNT" == "1" ]] && ok "F2b info/exclude holds the pattern exactly once after two writes (idempotent)" || bad "F2b exclude count=$COUNT"
[[ ! -e "$GLR/.git/a1-gate-log.lock.d" && -z "$(find "$GLR/.a1" -name '*lock*')" ]] && ok "F2c no lock left behind (not in the work tree, not in the git dir)" || bad "F2c lock remains"

# F3 chain over real lines; fail verdict from a real exit 1
mkdir -p "$GLR/src" && printf '%s\n' "export const q = () => db.query('UPDATE users SET x=1');" > "$GLR/src/db.js"
git -C "$GLR" add -A; git -C "$GLR" commit -qm sql
inrepo "$GLR" realpath-check run --phase w1 --diff-base HEAD~1 --project . >/dev/null 2>&1; RC=$?
CH="$(node -e '
  const fs=require("fs"),c=require("crypto"); const L=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);
  const last=JSON.parse(L[L.length-1]);
  process.stdout.write([L.length,last.verdict,last.exit,last.prev===c.createHash("sha256").update(L[L.length-2]).digest("hex")].join("|"));' "$GL")"
[[ $RC -eq 1 && "$CH" == "3|fail|1|true" ]] && ok "F3 exit 1 logs verdict fail, exit 1; prev is the sha256 of the previous line (3 lines)" || bad "F3 (rc=$RC ch=$CH)"
run_lint --log "$GL"
check "F3b gates lint --log on the real log: exit 0, 3 lines, 0 problems" 0 'j.lines+"/"+j.problems.length' "3/0"

# F4 no --phase: _unscoped and exactly one stderr notice; scoped runs print none
UERR="$(cd "$GLR" && node "$TOOLS" realpath-check run --diff-base HEAD~2 --project . 2>&1 >/dev/null)"
NOTICES="$(printf '%s\n' "$UERR" | grep -c '^gate-log: no --phase given')"
[[ "$NOTICES" == "1" && -f "$GLR/.a1/phases/_unscoped/gate-log.jsonl" ]] && ok "F4 no --phase: line in _unscoped, one stderr notice" || bad "F4 (notices=$NOTICES err=$UERR)"
SERR="$(cd "$GLR" && node "$TOOLS" realpath-check run --phase=w1 --diff-base HEAD~2 --project . 2>&1 >/dev/null)"
[[ "$(printf '%s\n' "$SERR" | grep -c '^gate-log:')" == "0" ]] && ok "F4b --phase=<scope> form: no notice" || bad "F4b (err=$SERR)"

# F5 only subcommands named in an invoke cell log
BEFORE="$(find "$GLR/.a1" -name 'gate-log.jsonl' -exec cat {} + | wc -l | tr -d ' ')"
inrepo "$GLR" schema-check parse --migrations "$WORK/none" --phase w1 >/dev/null 2>&1
inrepo "$GLR" gates lint --log "$GL" >/dev/null 2>&1
AFTER="$(find "$GLR/.a1" -name 'gate-log.jsonl' -exec cat {} + | wc -l | tr -d ' ')"
[[ "$BEFORE" == "$AFTER" && "$BEFORE" -ge 4 ]] && ok "F5 schema-check parse and gates lint (not in any invoke cell) append nothing ($BEFORE lines before and after)" || bad "F5 (before=$BEFORE after=$AFTER)"

# F6 hostile --phase values: exit 2, command not run, nothing written
for bad_scope in '../x' 'a/b' $'a\nb' '' '-x' 'a..b'; do
  rm -rf "$GLR/.a1/phases/x" "$WORK/res.json"
  (cd "$GLR" && node "$TOOLS" check reservations --claim m:1 --by s --file "$WORK/res.json" --phase "$bad_scope" >/dev/null 2>"$WORK/err"); RC=$?
  if [[ $RC -eq 2 && ! -e "$WORK/res.json" && ! -e "$GLR/.a1/phases/x" && ! -e "$GLR/x" ]]; then ok "F6 --phase $(printf %q "$bad_scope"): exit 2, command not run"
  else bad "F6 --phase $(printf %q "$bad_scope") (rc=$RC, res exists: $([[ -e $WORK/res.json ]] && echo yes || echo no))"; fi
done
(cd "$GLR" && node "$TOOLS" check reservations --list --file "$WORK/res.json" --phase >/dev/null 2>&1); RC=$?
[[ $RC -eq 2 ]] && ok "F6b --phase without a value: exit 2" || bad "F6b (rc=$RC)"

# F7 outside a git work tree: the gate keeps its exit code, the notice names the problem, no .a1 is created
NOGIT="$WORK/nogit"; mkdir -p "$NOGIT"
(cd "$NOGIT" && node "$TOOLS" check reservations --list --file "$NOGIT/r.json" --phase w1 >/dev/null 2>"$WORK/err"); RC=$?
[[ $RC -eq 0 && ! -e "$NOGIT/.a1/phases" && "$(cat "$WORK/err")" == *"not inside a git work tree"* ]] && ok "F7 no git repo: exit code kept (0), notice on stderr, nothing written" || bad "F7 (rc=$RC err=$(cat "$WORK/err"))"

# F8 two parallel writers, 50 lines each (pids from \$!)
PAR="$GLR/.a1/phases/par/gate-log.jsonl"
( for _i in $(seq 1 50); do (cd "$GLR" && node "$TOOLS" check reservations --list --file "$WORK/ra.json" --phase par >/dev/null 2>&1); done ) & PA=$!
( for _i in $(seq 1 50); do (cd "$GLR" && node "$TOOLS" check reservations --list --file "$WORK/rb.json" --phase par >/dev/null 2>&1); done ) & PB=$!
wait "$PA"; wait "$PB"
run_lint --log "$PAR"
check "F8 two parallel writers x 50: 100 lines, chain intact, exit 0" 0 'j.lines+"/"+j.problems.length' "100/0"
[[ "$(node -e 'const L=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);process.stdout.write(String(new Set(L.map(l=>JSON.parse(l).prev)).size))' "$PAR")" == "100" ]] \
  && ok "F8b all 100 prev hashes are distinct (no two writers chained to the same predecessor)" || bad "F8b duplicate prev hashes"

# F9 tamper cases on copies of the real log (N lines)
N="$(wc -l < "$GL" | tr -d ' ')"
cp "$GL" "$WORK/t.jsonl"
node -e 'const fs=require("fs"),f=process.argv[1];const l=fs.readFileSync(f,"utf8").split("\n");l[1]=l[1].replace("\"fail\"","\"pass\"").replace("\"pass\"","\"fail\"");const r=JSON.parse(l[1]);r.exit=7;l[1]=JSON.stringify(r);fs.writeFileSync(f,l.join("\n"))' "$WORK/t.jsonl"
run_lint --log "$WORK/t.jsonl"
check "F9a second line edited: exit 1, chain_broken reported on the NEXT line (3)" 1 'j.problems.map(p=>p.rule+"@"+p.line).join(",")' "chain_broken@3"
cp "$GL" "$WORK/t2.jsonl"
node -e 'const fs=require("fs"),f=process.argv[1];const l=fs.readFileSync(f,"utf8").split("\n");l.splice(1,1);fs.writeFileSync(f,l.join("\n"))' "$WORK/t2.jsonl"
run_lint --log "$WORK/t2.jsonl"
check "F9b middle line deleted: exit 1, chain_broken" 1 'j.problems.map(p=>p.rule).join(",")' "chain_broken"
cp "$GL" "$WORK/t3.jsonl"; echo 'this is not json' >> "$WORK/t3.jsonl"
run_lint --log "$WORK/t3.jsonl"
check "F9c garbage line appended: exit 1, malformed_line on the new last line" 1 'j.problems.map(p=>p.rule+"@"+p.line).join(",")' "malformed_line@$((N + 1))"
cp "$GL" "$WORK/t4.jsonl"; node -e 'const fs=require("fs"),c=require("crypto"),f=process.argv[1];const L=fs.readFileSync(f,"utf8").split("\n").filter(Boolean);const o=JSON.parse(L[L.length-1]);delete o.gate;o.prev=c.createHash("sha256").update(L[L.length-1]).digest("hex");fs.appendFileSync(f,JSON.stringify(o)+"\n")' "$WORK/t4.jsonl"
run_lint --log "$WORK/t4.jsonl"
check "F9d well-chained line without a gate id: exit 1, malformed_line on that line only" 1 'j.problems.map(p=>p.rule+"@"+p.line).join(",")' "malformed_line@$((N + 1))"
run_lint --log "$WORK/no-such.jsonl"
check_rc "F9e missing log file: exit 2" 2
: > "$WORK/empty.jsonl"; run_lint --log "$WORK/empty.jsonl"
check "F9f empty log: exit 0, 0 lines" 0 'j.lines+"/"+j.problems.length' "0/0"
run_lint --log "$WORK/t.jsonl" --root "$WORK/base"
check "F9g --log mode ignores registry flags and lints only the log (still exit 1)" 1 'j.problems.length' "1"

# F11 matchInvoke: a flagged key needs its flag, a plain key needs its subcommand
MATCH="$(node -e '
  const g=require(process.argv[1]); const m={"product validate --spec-status":"A","schema-check run":"B","test-fidelity":"C"};
  process.stdout.write([g.matchInvoke(["product","validate","--spec-status","x"],m), g.matchInvoke(["product","validate"],m), g.matchInvoke(["product","validate","--spec-status=x"],m),
    g.matchInvoke(["schema-check","parse"],m), g.matchInvoke(["schema-check","run"],m), g.matchInvoke(["test-fidelity","--diff-base","x"],m), g.matchInvoke(["test-fidelity-x"],m)].join(","))' "$REPO_ROOT/_shared/lib/gate-log.cjs")"
[[ "$MATCH" == "A,,A,,B,C," ]] && ok "F11 matchInvoke: flag token required, sub token exact, group-only key matches with flags" || bad "F11 ($MATCH)"

echo "a1-gates-lint: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
