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

# --- G1 / G2: source guard --------------------------------------------------
out=$(node "$GUARD" "$ROOT" 2>&1); rc=$?
if [[ "$rc" -eq 0 ]]; then ok "G1 no process.exit() right after a stdout write in dispatcher tail / converted modules"
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

mutate_module() { # <label> <file> <regex-source> <replacement-source>
  local label="$1" rel="$2"
  cp "$ROOT/$rel" "$MUT/$rel"
  node -e '
const fs = require("fs"); const p = process.argv[1];
const src = fs.readFileSync(p, "utf8");
const m = new RegExp(process.argv[2]).exec(src);
if (!m) { console.error("marker not found"); process.exit(3); }
fs.writeFileSync(p, src.slice(0, m.index) + process.argv[3] + src.slice(m.index + m[0].length));
' "$MUT/$rel" "$3" "$4"; local mrc=$?
  if [[ "$mrc" -ne 0 ]]; then bad "G2 mutation applied ($label)" "rc=$mrc"; return; fi
  node "$GUARD" "$MUT" >/dev/null 2>&1; local grc=$?
  if [[ "$grc" -eq 1 ]]; then ok "G2 guard is red on the re-inserted defect ($label)"; else bad "G2 guard red on mutation ($label)" "guard rc=$grc"; fi
  cp "$ROOT/$rel" "$MUT/$rel"
}
mutate_module "quick.cjs" "_shared/lib/quick.cjs" "return emitExit\\(0, JSON.stringify\\(out, null, 2\\) \\+ .\\\\n., ..\\);" "process.stdout.write(JSON.stringify(out, null, 2) + String.fromCharCode(10));\\n  process.exit(0);"
mutate_module "locks-based code-scope.cjs" "_shared/lib/code-scope.cjs" "return emitExitWithLock\\(lockPath, 0, JSON.stringify\\(out, null, 2\\) \\+ .\\\\n., ..\\);" "process.stdout.write(JSON.stringify(out, null, 2) + String.fromCharCode(10));\\n  exitWithLock(lockPath, 0);"
# a file the old hand-kept target list never named
# cross-function shape: helper writes, the caller exits on the next line (profile-ears.cjs, round 3)
mutate_module "profile-ears.cjs cross-function print helper" "_shared/lib/profile-ears.cjs" "return emitExit\\(result.findings.length > 0 \\? 1 : 0, formatResult\\(result, flags.json\\), ..\\);" $'printResult(result, flags.json);\n  process.exit(result.findings.length > 0 ? 1 : 0);\n}\nfunction printResult(r, j) {\n  process.stdout.write(formatResult(r, j));'
mutate_module "gates-cli.cjs (not in the old target list)" "_shared/lib/gates-cli.cjs" "return emitExit\\(0, firedYaml\\(log.records\\), ..\\);" "process.stdout.write(firedYaml(log.records));\\n  process.exit(0);"

echo "a1-cli-output: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
