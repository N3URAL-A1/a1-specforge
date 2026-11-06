#!/usr/bin/env bash
# Fixture suite: a1-tools must not truncate large stdout/stderr on a pipe.
# Fix 2026-11-05-stdout-pipe-truncation: process.exit() right after a stdout
# write cut piped output at one pipe buffer (65536 bytes) on macOS.
#
# Cases:
#   P1  worktree list, >64 KiB, slow pipe == file output (bytes + JSON.parse)
#   P2  emitExit helper: stdout + stderr >64 KiB through slow pipes, exit code kept
#   P3  emitExit helper: exit code 0/1/2 preserved
#   G1  source guard: no process.exit() directly after a stdout write in the
#       dispatcher tail and the converted modules (platform neutral: Linux
#       pipes are synchronous and never reproduce the truncation)
#   G2  mutation: the guard goes red when the defect is re-inserted
set -u
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOLS="$ROOT/_shared/a1-tools.cjs"
GUARD="$ROOT/_test-fixtures/a1-cli-output/exit-after-write-guard.cjs"
pass=0
fail=0

unset A1_VAULT_ROOT
mk_workdir WORK cli-output
[[ -n "${WORK:-}" && -d "$WORK" ]] || exit 2
export HOME="$WORK/home"
mkdir -p "$HOME"
export A1_WORKTREE_REGISTRY="$WORK/registry.json"

ok() { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; [[ -n "${2:-}" ]] && echo "      $2"; fail=$((fail + 1)); }

# Registry with ~700 entries -> `worktree list` output well above 64 KiB.
node -e '
const fs = require("fs");
const worktrees = [];
for (let i = 0; i < 700; i++) {
  worktrees.push({ id: "id-" + String(i).padStart(4, "0"), slug: "slug-" + i, repo_root: "/fixture/repo-" + (i % 7),
    worktree_path: "/fixture/a1-worktrees/slug-" + i, branch: "feat/slug-" + i, status: "prepared",
    created_at: new Date(1700000000000 + i * 1000).toISOString() });
}
fs.writeFileSync(process.argv[1], JSON.stringify({ version: 1, worktrees }));
' "$A1_WORKTREE_REGISTRY" || exit 2

# --- P1 -------------------------------------------------------------------
node "$TOOLS" worktree list > "$WORK/file.json"; file_rc=$?
node "$TOOLS" worktree list | (sleep 1; cat) > "$WORK/pipe.json"
file_bytes=$(wc -c < "$WORK/file.json" | tr -d ' ')
pipe_bytes=$(wc -c < "$WORK/pipe.json" | tr -d ' ')
if [[ "$file_rc" -eq 0 && "$file_bytes" -gt 70000 ]]; then ok "P1 fixture output exceeds 64 KiB ($file_bytes bytes)"
else bad "P1 fixture output exceeds 64 KiB" "rc=$file_rc bytes=$file_bytes"; fi
if [[ "$file_bytes" == "$pipe_bytes" ]] && cmp -s "$WORK/file.json" "$WORK/pipe.json"; then ok "P1 slow pipe output identical to file output ($pipe_bytes bytes)"
else bad "P1 slow pipe output identical to file output" "file=$file_bytes pipe=$pipe_bytes"; fi
if node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$WORK/pipe.json" 2>/dev/null; then ok "P1 piped output parses as JSON"
else bad "P1 piped output parses as JSON"; fi

# --- P1b: cost run --json (Reinhard's measurement: 356038 bytes to a file vs 65536 through a pipe) ---
mkdir -p "$WORK/costlogs" || exit 2
node -e '
const fs = require("fs"); const dir = process.argv[1];
for (let i = 0; i < 700; i++) {
  const line = JSON.stringify({ type: "assistant", timestamp: "2026-01-01T00:00:00Z", message: { id: "m" + i, model: "fixture-model", usage: { input_tokens: 10 + i, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 1 } } });
  fs.writeFileSync(dir + "/session-" + String(i).padStart(4, "0") + ".jsonl", line + "\n");
}
' "$WORK/costlogs" || exit 2
node "$TOOLS" cost run --project "$WORK/costlogs" --json > "$WORK/cost-file.json"; crc=$?
node "$TOOLS" cost run --project "$WORK/costlogs" --json | (sleep 1; cat) > "$WORK/cost-pipe.json"
cb_file=$(wc -c < "$WORK/cost-file.json" | tr -d ' ')
cb_pipe=$(wc -c < "$WORK/cost-pipe.json" | tr -d ' ')
if [[ "$crc" -eq 0 && "$cb_file" -gt 70000 ]]; then ok "P1b cost run --json fixture exceeds 64 KiB ($cb_file bytes)"; else bad "P1b cost fixture exceeds 64 KiB" "rc=$crc bytes=$cb_file"; fi
if cmp -s "$WORK/cost-file.json" "$WORK/cost-pipe.json" && node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$WORK/cost-pipe.json" 2>/dev/null; then ok "P1b cost run --json slow pipe identical to file output and parses ($cb_pipe bytes)"; else bad "P1b cost run --json slow pipe" "file=$cb_file pipe=$cb_pipe"; fi

# --- P2 / P3: the helper itself -------------------------------------------
HELPER="$ROOT/_shared/lib/emit-exit.cjs"
big_prog='const { emitExit } = require(process.argv[1]); const n = 200000;
emitExit(Number(process.argv[2]), "o".repeat(n - 1) + "\n", "e".repeat(n - 1) + "\n");'
node -e "$big_prog" "$HELPER" 1 2> >(sleep 1; cat > "$WORK/p2.err") | (sleep 1; cat > "$WORK/p2.out")
rc=${PIPESTATUS[0]}
sleep 3   # let the process-substitution reader finish
out_bytes=$(wc -c < "$WORK/p2.out" | tr -d ' ')
err_bytes=$(wc -c < "$WORK/p2.err" | tr -d ' ')
if [[ "$out_bytes" == 200000 ]]; then ok "P2 helper delivers full stdout through a slow pipe"; else bad "P2 helper delivers full stdout" "bytes=$out_bytes"; fi
if [[ "$err_bytes" == 200000 ]]; then ok "P2 helper delivers full stderr through a slow pipe"; else bad "P2 helper delivers full stderr" "bytes=$err_bytes"; fi
if [[ "$rc" -eq 1 ]]; then ok "P2 helper keeps exit code 1"; else bad "P2 helper keeps exit code 1" "rc=$rc"; fi
for code in 0 2; do
  node -e "$big_prog" "$HELPER" "$code" >/dev/null 2>&1; rc=$?
  if [[ "$rc" -eq "$code" ]]; then ok "P3 helper keeps exit code $code"; else bad "P3 helper keeps exit code $code" "rc=$rc"; fi
done
node -e 'const { emitExit } = require(process.argv[1]); emitExit(0, "", "");' "$HELPER" >/dev/null 2>&1; rc=$?
if [[ "$rc" -eq 0 ]]; then ok "P3 helper with empty payload exits 0"; else bad "P3 helper with empty payload exits 0" "rc=$rc"; fi

# P4: a reader that goes away early (EPIPE) must not change the exit code
node -e "$big_prog" "$HELPER" 3 2>/dev/null | head -c 10 >/dev/null
rc=${PIPESTATUS[0]}
if [[ "$rc" -eq 3 ]]; then ok "P4 helper keeps exit code 3 when the reader closes early (EPIPE)"; else bad "P4 helper EPIPE keeps exit code" "rc=$rc"; fi
# P5: stdout is written before stderr when both go to one pipe (the order of the replaced sites)
node -e 'const { emitExit } = require(process.argv[1]); emitExit(0, "OUT\n", "ERR\n");' "$HELPER" 2>&1 | tr -d '\n' > "$WORK/order.txt"
if [[ "$(cat "$WORK/order.txt")" == "OUTERR" ]]; then ok "P5 stdout before stderr"; else bad "P5 stdout before stderr" "$(cat "$WORK/order.txt")"; fi
node -e 'const { emitExit } = require(process.argv[1]); emitExit(0, "OUT\n", "ERR\n", { stderrFirst: true });' "$HELPER" 2>&1 | tr -d '\n' > "$WORK/order.txt"
if [[ "$(cat "$WORK/order.txt")" == "ERROUT" ]]; then ok "P5 stderrFirst option writes stderr before stdout"; else bad "P5 stderrFirst" "$(cat "$WORK/order.txt")"; fi

# --- D1: stderr must not land inside a merged (2>&1) stdout payload on a slow pipe -----
d1_prog='const { emitExit } = require(process.argv[1]); const o = "A".repeat(200000) + "\n";
emitExit(0, o, "STDERR-LINE\n", process.argv[2] === "first" ? { stderrFirst: true } : undefined);'
node -e "$d1_prog" "$HELPER" last 2>&1 | (sleep 1; cat) > "$WORK/d1-last.txt"
node -e "$d1_prog" "$HELPER" first 2>&1 | (sleep 1; cat) > "$WORK/d1-first.txt"
d1_last=$(grep -bo STDERR-LINE "$WORK/d1-last.txt" | head -1 | cut -d: -f1)
d1_first=$(grep -bo STDERR-LINE "$WORK/d1-first.txt" | head -1 | cut -d: -f1)
d1_first_tail=$(tail -c +13 "$WORK/d1-first.txt" | wc -c | tr -d ' ')
if [[ "$d1_last" == 200001 ]]; then ok "D1 merged pipe: stderr block starts right after the 200001-byte stdout payload"; else bad "D1 merged pipe stderr offset (default order)" "offset=${d1_last:-none} want=200001"; fi
if [[ "$d1_first" == 0 && "$d1_first_tail" == 200001 ]]; then ok "D1 merged pipe with stderrFirst: stderr at offset 0, stdout intact after it"; else bad "D1 merged pipe stderrFirst" "offset=${d1_first:-none} tail=$d1_first_tail"; fi

# --- D2: a non-EPIPE stream error exits 2 AND names its cause --------------------------
cat > "$WORK/enospc-stub.cjs" <<'STUB'
process.stdout.write = (t, cb) => { process.nextTick(cb, Object.assign(new Error('no space left'), { code: 'ENOSPC' })); return true; };
STUB
node -r "$WORK/enospc-stub.cjs" -e 'const { emitExit } = require(process.argv[1]); emitExit(0, "OUT\n", "ERR\n");' "$HELPER" >/dev/null 2> "$WORK/d2.err"; rc=$?
if [[ "$rc" -eq 2 ]]; then ok "D2 ENOSPC on stdout exits 2"; else bad "D2 ENOSPC exit code" "rc=$rc"; fi
if grep -q 'ENOSPC' "$WORK/d2.err"; then ok "D2 ENOSPC cause is printed on stderr"; else bad "D2 ENOSPC cause on stderr" "stderr=$(cat "$WORK/d2.err")"; fi
if grep -q 'ERR' "$WORK/d2.err"; then ok "D2 second stream is still attempted after the first failed"; else bad "D2 second stream attempted" "stderr=$(cat "$WORK/d2.err")"; fi

# --- G1 / G2: source guard --------------------------------------------------
out=$(node "$GUARD" "$ROOT" 2>&1); rc=$?
if [[ "$rc" -eq 0 ]]; then ok "G1 no function in _shared/**/*.cjs exits after writing output (function-scoped guard, EXCEPTIONS explicit)"
else bad "G1 source guard" "$out"; fi

mk_workdir MUT cli-output-mutation
[[ -n "${MUT:-}" && -d "$MUT" ]] || exit 2
mkdir -p "$MUT/_shared/lib"
cp "$ROOT/_shared/a1-tools.cjs" "$MUT/_shared/a1-tools.cjs"
cp "$ROOT"/_shared/lib/*.cjs "$MUT/_shared/lib/"
# Put the defect back into the dispatcher tail (replace the emitExit call).
node -e '
const fs = require("fs"); const p = process.argv[1];
const src = fs.readFileSync(p, "utf8");
const marker = "emitExit(0, JSON.stringify(result, null, 2) + \x27\\n\x27);";
const i = src.lastIndexOf(marker);
if (i < 0) { console.error("marker not found"); process.exit(3); }
fs.writeFileSync(p, src.slice(0, i) + "process.stdout.write(JSON.stringify(result, null, 2) + \"\\n\");\n  process.exit(0);" + src.slice(i + marker.length));
' "$MUT/_shared/a1-tools.cjs"; mrc=$?
if [[ "$mrc" -ne 0 ]]; then bad "G2 mutation applied" "rc=$mrc"; else
  node "$GUARD" "$MUT" >/dev/null 2>&1; grc=$?
  if [[ "$grc" -eq 1 ]]; then ok "G2 guard is red on the re-inserted defect (dispatcher tail)"; else bad "G2 guard red on mutation" "guard rc=$grc"; fi
fi
# Further mutations in modules converted in the class sweep (quick.cjs, realpath-check.cjs, locks-based code-scope.cjs).
node -e '
const fs = require("fs"); const p = process.argv[1];
const src = fs.readFileSync(p, "utf8");
const m = /return emitExit\(report\.exit_code, [^\n]*\n/.exec(src) || /emitExit\(report\.exit_code[^\n]*\n/.exec(src);
if (!m) { console.error("marker not found"); process.exit(3); }
fs.writeFileSync(p, src.slice(0, m.index) + "process.stdout.write(JSON.stringify(report, null, 2) + \"\\n\");\n  process.exit(report.exit_code);\n" + src.slice(m.index + m[0].length));
' "$MUT/_shared/lib/checklist.cjs"; mrc=$?
if [[ "$mrc" -ne 0 ]]; then bad "G2 module mutation applied" "rc=$mrc"; else
  node "$GUARD" "$MUT" >/dev/null 2>&1; grc=$?
  if [[ "$grc" -eq 1 ]]; then ok "G2 guard is red on the re-inserted defect (checklist module)"; else bad "G2 guard red on module mutation" "guard rc=$grc"; fi
fi

# Undo the two inline mutations above, so every mutate_module case below is judged on its own.
cp "$ROOT/_shared/a1-tools.cjs" "$MUT/_shared/a1-tools.cjs"
cp "$ROOT/_shared/lib/checklist.cjs" "$MUT/_shared/lib/checklist.cjs"

mutate_module() { # <label> <file> <regex-source> <replacement-source> [needle that must appear in the guard output]
  local label="$1" rel="$2" needle="${5:-}"
  cp "$ROOT/$rel" "$MUT/$rel"
  node -e '
const fs = require("fs"); const p = process.argv[1];
const src = fs.readFileSync(p, "utf8");
const m = new RegExp(process.argv[2]).exec(src);
if (!m) { console.error("marker not found"); process.exit(3); }
fs.writeFileSync(p, src.slice(0, m.index) + process.argv[3] + src.slice(m.index + m[0].length));
' "$MUT/$rel" "$3" "$4"; local mrc=$?
  if [[ "$mrc" -ne 0 ]]; then bad "G2 mutation applied ($label)" "rc=$mrc"; return; fi
  local gout; gout=$(node "$GUARD" "$MUT" 2>&1); local grc=$?
  if [[ "$grc" -eq 1 && ( -z "$needle" || "$gout" == *"$needle"* ) ]]; then ok "G2 guard is red on the re-inserted defect ($label)"; else bad "G2 guard red on mutation ($label)" "guard rc=$grc"; fi
  cp "$ROOT/$rel" "$MUT/$rel"
}
mutate_module "quick.cjs" "_shared/lib/quick.cjs" "return emitExit\\(0, JSON.stringify\\(out, null, 2\\) \\+ .\\\\n., ..\\);" $'process.stdout.write(JSON.stringify(out, null, 2) + String.fromCharCode(10));\n  process.exit(0);'
mutate_module "locks-based code-scope.cjs" "_shared/lib/code-scope.cjs" "return emitExitWithLock\\(lockPath, 0, JSON.stringify\\(out, null, 2\\) \\+ .\\\\n., ..\\);" $'process.stdout.write(JSON.stringify(out, null, 2) + String.fromCharCode(10));\n  exitWithLock(lockPath, 0);'
# a file the old hand-kept target list never named
# (cross-function shape - helper writes, caller exits - is a documented limit of the guard; its former case here was only green through leftover mutations)
# cost shape: stdout write, then a stderr loop, then the exit (the shape the next-line guard missed)
mutate_module "cost.cjs write -> stderr loop -> exit" "_shared/lib/cost.cjs" "return emitExit\\(0, text, ..\\);" $'process.stdout.write(text);\n  for (const s of sessions) process.stderr.write(`${s.session}\\n`);\n  process.exit(0);'
# if/else writes with one shared exit after the branches
mutate_module "schema-check.cjs if/else writes -> shared exit" "_shared/lib/schema-check.cjs" "return emitExit\\(findings.length === 0 \\? 0 : 1, outText, ..\\);" $'if (flags.json) {\n    process.stdout.write(outText);\n  } else {\n    process.stdout.write(outText);\n  }\n  process.exit(findings.length === 0 ? 0 : 1);'
# exiting helper called after a write (fail2-style helper, discovered not hand-listed)
mutate_module "pr-merge-check.cjs write -> exiting helper" "_shared/lib/pr-merge-check.cjs" "return emitExit\\(result.exit, .*\\n" $'process.stdout.write(JSON.stringify(result.report));\n  process.exit(result.exit);\n'
mutate_module "gates-cli.cjs (not in the old target list)" "_shared/lib/gates-cli.cjs" "return emitExit\\(0, firedYaml\\(log.records\\), ..\\);" $'process.stdout.write(firedYaml(log.records));\n  process.exit(0);'

# D3: write-then-exit inside a top-level arrow function / function expression (the guard once saw only declarations)
mutate_module "D3 control: function declaration" "_shared/lib/cost.cjs" "module\\.exports" $'function probeDecl(t) {\n  process.stdout.write(t);\n  process.exit(0);\n}\nmodule.exports' "probeDecl("
mutate_module "D3 top-level arrow function" "_shared/lib/cost.cjs" "module\\.exports" $'const probeArrow = (t) => {\n  process.stdout.write(t);\n  process.exit(0);\n};\nmodule.exports' "probeArrow("
mutate_module "D3 top-level async function expression" "_shared/lib/cost.cjs" "module\\.exports" $'const probeExpr = async function (t) {\n  process.stdout.write(t);\n  process.exit(0);\n};\nmodule.exports' "probeExpr("
mutate_module "D3 top-level single-parameter arrow" "_shared/lib/cost.cjs" "module\\.exports" $'let probeOne = t => {\n  process.stdout.write(t);\n  process.exit(0);\n};\nmodule.exports' "probeOne("
node "$GUARD" "$ROOT" >/dev/null 2>&1; grc=$?
if [[ "$grc" -eq 0 ]]; then ok "D3 guard stays clean on the unmodified tree (no false positive, e.g. xprov-gate finish)"; else bad "D3 unmodified tree clean" "guard rc=$grc"; fi

echo "a1-cli-output: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
