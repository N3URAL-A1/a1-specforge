#!/usr/bin/env bash
# Fixture: spec 027 slice 1 Wave 4 - the Samuel trigger is the registered, logged gate
# `pr-security-surface` (FR-033). Wave 6 appends the quality-invariant cases (FR-034, W14f-W14n).
#
# Inputs are the REAL registry, skills/ tree and xprov-scope-globs.json (copied for mutations).
#
# Measured red 2026-11-13 (scratch copy, one change, suite run):
#   02-review.md: the `xprov scope` call line removed          -> W14b (gates lint exit 1, unwired)
#   02-review.md: `cd "<worktree_path>" && ` removed from call -> W14c-red proves the log lands in the primary checkout
#
# Measured red 2026-11-13 for the FR-034 cases (scratch copy, one change, suite run):
#   quality-invariants.cjs: JSON / test.yml resolved from __dirname instead of root -> W14l (absent case) and W14k red
#   quality-invariants.cjs: invariant_unwired check removed                        -> W14h red for the deterministic ids
#   quality-invariants.cjs: job-scope check removed (whole file searched)          -> W14k2 red
#   quality-invariants.cjs: step name compared via an unescaped new RegExp(name)   -> W14f red on the real tree
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
SWEEP="$REPO_ROOT/_test-fixtures/a1-gates-lint/check-callsite-flags.cjs"
REVIEW="$REPO_ROOT/skills/a1-pr-review/workflows/02-review.md"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2
mk_workdir WORK wave14

pass=0
fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }

copy_tree() { rm -rf "${WORK:?}/$1"; mkdir -p "$WORK/$1"; cp -R "$REPO_ROOT/skills" "$REPO_ROOT/agents" "$WORK/$1/"; }
edit() {
  node -e '
    const fs=require("fs"); const f=process.argv[1]; let s=fs.readFileSync(f,"utf8"); const before=s;
    '"$3"'
    if (s===before) { console.error("plant did not change "+f); process.exit(3); }
    fs.writeFileSync(f, s);' "$WORK/$1/$2"
}
g() { git -C "$1" -c user.name=t -c user.email=t@t -c commit.gpgsign=false "${@:2}"; }

# W14a: the real tree settles and pr-security-surface is wired once in a1-pr-review
OUT="$(node "$TOOLS" gates lint 2>"$WORK/err")"; RC=$?
HIT="$(node -e 'const j=JSON.parse(process.argv[1]);const w=j.wired.filter(x=>x.gate==="pr-security-surface"&&x.skill==="a1-pr-review"&&x.calls===1);process.stdout.write(String(w.length))' "$OUT")"
[[ $RC -eq 0 && "$HIT" == "1" ]] && ok "W14a real gates lint exit 0, pr-security-surface wired in a1-pr-review (calls=1)" || bad "W14a (rc=$RC hit=$HIT)"

# W14b: drop the call line -> unwired
copy_tree w14b
edit w14b skills/a1-pr-review/workflows/02-review.md 's = s.replace(/^SURF=[^\n]*xprov scope[^\n]*$/m, "");'
OUT="$(node "$TOOLS" gates lint --root "$WORK/w14b" --registry "$REPO_ROOT/_shared/gates-registry.md" 2>"$WORK/err")"; RC=$?
FIND="$(node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(j.findings.filter(f=>f.gate==="pr-security-surface"&&/unwired/.test(JSON.stringify(f))).length+"")' "$OUT" 2>/dev/null)"
[[ $RC -eq 1 && "$FIND" -ge 1 ]] && ok "W14b call line removed: gates lint exit 1, finding unwired for pr-security-surface" || bad "W14b (rc=$RC find=${FIND:-?})"

# W14c: run the real call line against a temp primary repo + worktree
T="$WORK/c"; PRIMARY="$T/primary"; WT="$T/wt"; mkdir -p "$PRIMARY"
git -C "$PRIMARY" init -q
echo a > "$PRIMARY/a.txt"; g "$PRIMARY" add -A; g "$PRIMARY" commit -qm one
echo b > "$PRIMARY/b.txt"; g "$PRIMARY" add -A; g "$PRIMARY" commit -qm two
BASE_SHA="$(git -C "$PRIMARY" rev-parse HEAD)"
git -C "$PRIMARY" worktree add -q -b feat "$WT"
echo c > "$WT/c.txt"; g "$WT" add -A; g "$WT" commit -qm three
LINE="$(grep -m1 'a1-tools.cjs xprov scope' "$REVIEW")"
run_line() { # <line> <basedir>
  L="${1//<repo>/$REPO_ROOT}"; L="${L//<worktree_path>/$WT}"; L="${L//<n>/9}"
  (cd "$2" && BASE_SHA="$BASE_SHA" bash -c "$L"'
printf "%s" "$SURF" > "'"$WORK"'/surf.json"; exit $RC') >/dev/null 2>&1
}
run_line "$LINE" "$PRIMARY"; RC=$?
LOG="$WT/.a1/phases/pr-9/gate-log.jsonl"
SURFOK="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(typeof j.security_surface)' "$WORK/surf.json" 2>/dev/null)"
N="$(wc -l < "$LOG" 2>/dev/null | tr -d ' ')"
REC="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").trim());process.stdout.write([r.gate,r.verdict,r.scope].join(","))' "$LOG" 2>/dev/null)"
[[ $RC -eq 0 && "$SURFOK" == "boolean" && "$N" == "1" && "$REC" == "pr-security-surface,pass,pr-9" && ! -e "$PRIMARY/.a1/phases" ]] \
  && ok "W14c call line in the worktree: SURF JSON boolean, 1 log line in the worktree (pass, pr-9), primary has no .a1/phases" \
  || bad "W14c (rc=$RC surf=$SURFOK n=$N rec=$REC primary=$(ls "$PRIMARY/.a1" 2>&1))"

# W14c-red: without the cd the log lands in the primary checkout (proves W14c discriminates)
rm -rf "$WT/.a1" "$PRIMARY/.a1"
LINE_NOCD="${LINE//cd \"<worktree_path>\" && /}"
[[ "$LINE_NOCD" != "$LINE" ]] || bad "W14c-red plant did not change the line"
run_line "$LINE_NOCD" "$PRIMARY"
[[ -e "$PRIMARY/.a1/phases/pr-9/gate-log.jsonl" ]] && ok "W14c-red cd removed: the log lands in the primary checkout" || bad "W14c-red (no log in primary)"

# W14d: a security-surface path still exits 0 with security_surface:true; unknown base exits 2 with verdict error
rm -rf "$WT/.a1" "$PRIMARY/.a1"
SECPATH="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const p=j.categories.payment.find(x=>x==="**/checkout/**");process.stdout.write(p?"checkout/x.txt":"")' "$REPO_ROOT/_shared/lib/xprov-scope-globs.json")"
if [[ -z "$SECPATH" ]]; then bad "W14d no checkout glob in xprov-scope-globs.json"; else
  mkdir -p "$WT/checkout"; echo s > "$WT/$SECPATH"; g "$WT" add -A; g "$WT" commit -qm sec
  run_line "$LINE" "$PRIMARY"; RC=$?
  SV="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).security_surface))' "$WORK/surf.json" 2>/dev/null)"
  VERD="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").pop());process.stdout.write(r.verdict)' "$WT/.a1/phases/pr-9/gate-log.jsonl" 2>/dev/null)"
  [[ $RC -eq 0 && "$SV" == "true" && "$VERD" == "pass" ]] && ok "W14d security-surface path: exit 0, security_surface:true, log verdict pass" || bad "W14d (rc=$RC sv=$SV verdict=$VERD)"
fi
rm -rf "$WT/.a1"
BASE_SHA="deadbeefdeadbeef"; run_line "$LINE" "$PRIMARY"; RC=$?
VERD="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").pop());process.stdout.write(r.verdict)' "$WT/.a1/phases/pr-9/gate-log.jsonl" 2>/dev/null)"
[[ $RC -eq 2 && "$VERD" == "error" ]] && ok "W14d2 unknown base sha: exit 2, log verdict error" || bad "W14d2 (rc=$RC verdict=$VERD)"

# W14e: --phase accepted on xprov scope by the call-site sweep
node "$SWEEP" "$REPO_ROOT" >"$WORK/sweep.out" 2>&1; RC=$?
[[ $RC -eq 0 ]] && ok "W14e call-site flag sweep exit 0 (--phase accepted on xprov scope)" || bad "W14e (rc=$RC $(head -3 "$WORK/sweep.out"))"


# ---------------------------------------------------------------------------
# FR-034 quality-invariant lint (Wave 6). Step names are read from the JSON at runtime;
# they are never typed on a command line.
# ---------------------------------------------------------------------------
# Test oracle: the 12 keep-list ids of spec 027 FR-034 (the JSON is the only production copy).
IDS="design-review-xprov fix-class-sweep fix-integrity gate-c-ac-dryrun phase-6-verify plan-audit plan-review-xprov pr-merge-check pr-reinhard pr-security-surface scope-claim test-fidelity"
PLANT="$WORK/plant.cjs"
cat > "$PLANT" <<'JS'
const fs = require('fs'); const path = require('path');
const [root, repo, op, arg] = process.argv.slice(2);
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const write = (f, t) => fs.writeFileSync(path.join(root, f), t);
const spec = JSON.parse(read('_shared/quality-invariants.json'));
const REG = '_shared/gates-registry.md';
const YML = '.github/workflows/test.yml';
const stepLine = (lines, st) => lines.findIndex((l) => /^\s*-\s+name:\s*/.test(l) && l.replace(/^\s*-\s+name:\s*/, '').trim() === st.name);
function walk(d, out) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.md')) out.push(p); } return out; }
if (op === 'rmrow') {
  write(REG, read(REG).split('\n').filter((l) => !l.startsWith('| `' + arg + '` |')).join('\n'));
} else if (op === 'unwire') {
  const { rowInvokes } = require(path.join(repo, '_shared/lib/gate-ids.cjs'));
  const { callRegex } = require(path.join(repo, '_shared/lib/gates-lint.cjs'));
  const inv = rowInvokes(read(REG)).find((r) => r.id === arg);
  const re = callRegex(inv.subcommand);
  for (const f of walk(path.join(root, 'skills'), [])) {
    const t = fs.readFileSync(f, 'utf8'); const n = t.split('\n').filter((l) => !re.test(l)).join('\n');
    if (n !== t) fs.writeFileSync(f, n);
  }
} else if (op === 'ownerlost') {
  const g = spec.gates.find((x) => x.id === arg);
  write(g.owner_ref, read(g.owner_ref).split(g.must_contain).join('REMOVED'));
} else if (op === 'rmstep' || op === 'movestep' || op === 'quote') {
  const lines = read(YML).split('\n');
  const st = op === 'movestep' ? spec.ci_steps.find((x) => x.job === 'enforcement') : spec.ci_steps[Number(arg)] || spec.ci_steps.find((x) => x.job === 'checks');
  const i = stepLine(lines, st);
  if (i < 0) { console.error('step not found'); process.exit(3); }
  if (op === 'rmstep') lines.splice(i, 1);
  if (op === 'quote') lines[i] = lines[i].replace(st.name, '"' + st.name + '"');
  if (op === 'movestep') { const [l] = lines.splice(i, 1); lines.splice(lines.findIndex((x) => x.trimEnd() === '  checks:') + 1, 0, l); }
  write(YML, lines.join('\n'));
} else if (op === 'exempt') {
  write(REG, read(REG).split('\n').map((l) => (l.startsWith('| `pr-merge-check` |') ? l.replace(/\s*\|\s*$/, '; unwired_until=2099-01-01; unwired_reason=fixture |') : l)).join('\n'));
} else if (op === 'classprompt') {
  write(REG, read(REG).split('\n').map((l) => (l.startsWith('| `pr-merge-check` |') ? l.replace('| deterministic |', '| prompt |') : l)).join('\n'));
} else if (op === 'badref') {
  spec.gates.find((x) => x.kind === 'prompt').owner_ref = '../../etc/passwd';
  write('_shared/quality-invariants.json', JSON.stringify(spec));
} else if (op === 'dropjson') {
  fs.unlinkSync(path.join(root, '_shared/quality-invariants.json'));
} else { console.error('unknown op'); process.exit(2); }
JS
copy_inv() { # <name>
  rm -rf "${WORK:?}/$1"; mkdir -p "$WORK/$1/_shared" "$WORK/$1/.github/workflows"
  cp -R "$REPO_ROOT/skills" "$REPO_ROOT/agents" "$WORK/$1/"
  cp "$REPO_ROOT/_shared/gates-registry.md" "$REPO_ROOT/_shared/quality-invariants.json" "$WORK/$1/_shared/"
  cp "$REPO_ROOT/.github/workflows/test.yml" "$WORK/$1/.github/workflows/"
}
plant() { node "$PLANT" "$WORK/$1" "$REPO_ROOT" "${@:2}"; } # <name> <op> [arg]
lint_inv() { # <name> -> sets RC, OUT
  OUT="$(node "$TOOLS" gates lint --root "$WORK/$1" --registry "$WORK/$1/_shared/gates-registry.md" 2>"$WORK/err")"; RC=$?
}
has_find() { # <rule> <gate|-> ; reads OUT
  node -e 'const j=JSON.parse(process.argv[1]);const [r,g]=[process.argv[2],process.argv[3]];process.stdout.write(String(j.findings.filter(f=>f.rule===r&&(g==="-"||f.gate===g)).length))' "$OUT" "$1" "$2" 2>/dev/null
}

# W14f: the real tree is green and carries 12 ids + 2 CI steps; ids equal the oracle
OUT="$(node "$TOOLS" gates lint 2>"$WORK/err")"; RC=$?
INFO="$(node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write([j.invariants.status,j.invariants.ids,j.invariants.ci_steps].join(","))' "$OUT" 2>/dev/null)"
GOT="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.gates.map(g=>g.id).sort().join(" "))' "$REPO_ROOT/_shared/quality-invariants.json")"
[[ $RC -eq 0 && "$INFO" == "checked,12,2" && "$GOT" == "$IDS" ]] && ok "W14f real tree: exit 0, invariants checked (12 ids, 2 ci steps), ids equal the spec oracle" || bad "W14f (rc=$RC info=$INFO)"

# W14n: the unmodified planted copy is green (so the reds below come from the single removal)
copy_inv n; lint_inv n
[[ $RC -eq 0 ]] && ok "W14n planted copy without removal: exit 0" || bad "W14n (rc=$RC $(head -3 "$WORK/err"))"

# W14g: delete the registry row of each id -> invariant_missing
for id in $IDS; do
  copy_inv g; plant g rmrow "$id"; lint_inv g
  [[ $RC -eq 1 && "$(has_find invariant_missing "$id")" -ge 1 ]] && ok "W14g $id row removed: exit 1, invariant_missing" || bad "W14g $id (rc=$RC)"
done

# W14h: remove the invocation (deterministic) or the owner anchor (prompt) of each id
for id in $IDS; do
  KIND="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.gates.find(g=>g.id===process.argv[2]).kind)' "$REPO_ROOT/_shared/quality-invariants.json" "$id")"
  copy_inv h
  if [[ "$KIND" == "deterministic" ]]; then plant h unwire "$id"; RULE=invariant_unwired; else plant h ownerlost "$id"; RULE=invariant_owner_lost; fi
  lint_inv h
  [[ $RC -eq 1 && "$(has_find "$RULE" "$id")" -ge 1 ]] && ok "W14h $id ($KIND): exit 1, $RULE" || bad "W14h $id (rc=$RC rule=$RULE)"
done

# W14i: exemption on a keep-list gate
copy_inv i; plant i exempt; lint_inv i
[[ $RC -eq 1 && "$(has_find invariant_unwired_until pr-merge-check)" -ge 1 ]] && ok "W14i unwired_until on pr-merge-check: exit 1, invariant_unwired_until" || bad "W14i (rc=$RC)"

# W14j: class changed
copy_inv j; plant j classprompt; lint_inv j
[[ $RC -eq 1 && "$(has_find invariant_class_changed pr-merge-check)" -ge 1 ]] && ok "W14j class deterministic->prompt: exit 1, invariant_class_changed" || bad "W14j (rc=$RC)"

# W14k: each CI step removed -> invariant_ci_step_missing naming the job
for idx in 0 1; do
  copy_inv k; plant k rmstep "$idx"; lint_inv k
  JOB="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.ci_steps[Number(process.argv[2])].job)' "$REPO_ROOT/_shared/quality-invariants.json" "$idx")"
  NAMED="$(node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(String(j.findings.filter(f=>f.rule==="invariant_ci_step_missing"&&f.step.startsWith(process.argv[2]+":")).length))' "$OUT" "$JOB" 2>/dev/null)"
  [[ $RC -eq 1 && "$NAMED" -ge 1 ]] && ok "W14k ci step $idx (job $JOB) removed: exit 1, invariant_ci_step_missing" || bad "W14k step $idx (rc=$RC named=$NAMED)"
done

# W14k2: the enforcement step moved under job checks does not count for enforcement
copy_inv k2; plant k2 movestep; lint_inv k2
[[ $RC -eq 1 && "$(has_find invariant_ci_step_missing -)" -ge 1 ]] && ok "W14k2 step moved to another job: exit 1, invariant_ci_step_missing (job scope enforced)" || bad "W14k2 (rc=$RC)"

# W14k3: a quoted step name still matches (string comparison, parentheses do not matter)
copy_inv k3; plant k3 quote 0; lint_inv k3
[[ $RC -eq 0 ]] && ok "W14k3 quoted checks step name: exit 0" || bad "W14k3 (rc=$RC $(head -3 "$WORK/err"))"

# W14l: JSON absent. Explicit --root: status absent, exit 0. Default root (a git repo): invariant_file_missing, exit 1.
copy_inv l; plant l dropjson; lint_inv l
ST="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).invariants.status)' "$OUT" 2>/dev/null)"
[[ $RC -eq 0 && "$ST" == "absent" ]] && ok "W14l explicit --root without JSON: exit 0, status absent" || bad "W14l-a (rc=$RC st=$ST)"
LR="$WORK/lrepo"; rm -rf "$LR"; mkdir -p "$LR"; cp -R "$WORK/l/." "$LR/"
git -C "$LR" init -q; g "$LR" add -A; g "$LR" commit -qm snap
OUT="$(cd "$LR" && node "$TOOLS" gates lint 2>"$WORK/err")"; RC=$?
[[ $RC -eq 1 && "$(has_find invariant_file_missing -)" -ge 1 ]] && ok "W14l default root (git repo) without JSON: exit 1, invariant_file_missing" || bad "W14l-b (rc=$RC)"

# W14m: hostile owner_ref
copy_inv m; plant m badref; lint_inv m
[[ $RC -eq 1 && "$(has_find invariant_file_invalid -)" -ge 1 ]] && ok "W14m owner_ref ../../etc/passwd: exit 1, invariant_file_invalid" || bad "W14m (rc=$RC)"

echo "a1-gates-lint wave 14: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
