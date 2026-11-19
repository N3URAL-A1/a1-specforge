# Sourced by run-tests.sh (spec 027 slice 3, FR-011 lazy base under merge-check). Uses the suite helpers: newproj, stub, cfg, seal, check, g.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# runVerify({base, noCache, lazyBase}) is the merge-check order: head first, base only for commands red on head or with a counting reporter.
# The spawn seam A1_VERIFY_SPAWN_LOG gets one `<label>\t<id>` line per spawned command (h<i> head, b<i> base, r<i> retry).
#
# RED-proof (scratch copy, see STATUS-verify.md):
#   (a) verify-run.cjs runVerify(): `lazy` forced false                                  : LZ1 red
#   (b) verify-run.cjs lazyHeadSide(): `need` = every base command                       : LZ1 red
#   (c) verify-run.cjs lazyHeadSide(): `need` without the `kind !== 'none'` term         : LZ4, LZ5 red
#   (e) verify-run.cjs lazyHeadSide(): retry before the base run                         : LZ2 order red
. "$REPO_ROOT/_test-fixtures/a1-verify/leak-assert.sh"; lk_leak_start

# lz_run <project> <case>: runVerify the merge-check way; sets OUT, RC, ERR; spawn log in $LZ_LOG.
lz_run() {
  LZ_LOG="$WORK/lz-$2.log"; : > "$LZ_LOG"
  mkdir -p "$WORK/vl-$2"
  lk_token_reset
  OUT="$(cd "$1" && A1_VERIFY_LOCK_DIR="$WORK/vl-$2/lock" A1_VERIFY_SPAWN_LOG="$LZ_LOG" node -e 'const r=require(process.argv[1]); process.stdout.write(JSON.stringify(r.runVerify({project: process.argv[2], base: "main", noCache: true, lazyBase: true})))' "$REPO_ROOT/_shared/lib/verify-run.cjs" "$1" 2>"$WORK/err")"; RC=$?
  ERR="$(cat "$WORK/err")"
}
lz_count() { grep -c "^$1" "$LZ_LOG" | tr -d ' '; }
lz_labels() { cut -f1 "$LZ_LOG" | tr '\n' ' ' | sed 's/ $//'; }

# LZ1: both green on head, reporter none: no base command
newproj lz1; stub c1 'exit 0'; stub c2 'exit 0'
cfg '{"commands":[{"id":"c1","argv":["./bin/c1"]},{"id":"c2","argv":["./bin/c2"]}]}'; seal
printf 'module.exports = 2;\n' > "$P/src/app.js"; g "$P" commit -q -am head
lz_run "$P" lz1
check "LZ1 green head, reporter none: pass, base_run ran [], duration_ms.base null, cache off/off" 0 \
  'j.verdict+"|"+JSON.stringify(j.base_run.ran)+"|"+j.base_run.mode+"|"+j.base_run.of+"|"+j.duration_ms.base+"|"+j.cache.head+"/"+j.cache.base' "pass|[]|lazy|2|null|off/off"
[[ "$(lz_count b)" == "0" && "$(lz_count h)" == "2" ]] && ok "LZ1b spawn log: 2 head lines, 0 base lines" || bad "LZ1b log: $(lz_labels)"

# LZ2: c2 red on head only
newproj lz2; stub c0 'exit 0'; stub c1 'exit 0'; stub c2 'exit 0'
cfg '{"commands":[{"id":"c0","argv":["./bin/c0"]},{"id":"c1","argv":["./bin/c1"]},{"id":"c2","argv":["./bin/c2"]}]}'; seal
printf 'module.exports = 2;\n' > "$P/src/app.js"; stub c2 'exit 1'; g "$P" add -A; g "$P" commit -q -m head
lz_run "$P" lz2
check "LZ2 one red head command: fail command_failed, nothing pre-existing" 0 'j.verdict+"|"+j.reason+"|"+j.pre_existing_red.length' "fail|command_failed|0"
[[ "$(lz_count b)" == "1" && "$(grep '^b' "$LZ_LOG" | cut -f2)" == "c2" ]] && ok "LZ2b exactly one base run, for c2" || bad "LZ2b log: $(cat "$LZ_LOG")"
[[ "$(lz_labels)" =~ ^h0\ h1\ h2\ b[0-9]+\ r2$ ]] && ok "LZ2c order: all head runs, then base, then the retry" || bad "LZ2c order: $(lz_labels)"

# LZ3: c1 red on head and base
newproj lz3; stub c1 'exit 1'; stub c2 'exit 0'
cfg '{"commands":[{"id":"c1","argv":["./bin/c1"]},{"id":"c2","argv":["./bin/c2"]}]}'; seal
printf 'module.exports = 2;\n' > "$P/src/app.js"; g "$P" commit -q -am head
lz_run "$P" lz3
check "LZ3 red on head and base: pass, pre_existing_red names c1" 0 'j.verdict+"|"+j.pre_existing_red.map(x=>x.command).join(",")' "pass|c1"
[[ "$(lz_count b)" == "1" ]] && ok "LZ3b one base run" || bad "LZ3b log: $(lz_labels)"

# LZ4: a counting reporter (node-test) still runs on base when green
newproj lz4; stub plain 'exit 0'
cat > "$P/t.test.js" <<'JS'
const { test } = require('node:test');
test('ok', () => {});
JS
cfg '{"commands":[{"id":"plain","argv":["./bin/plain"]},{"id":"tap","argv":["node","--test","t.test.js"]}]}'; seal
printf 'module.exports = 2;\n' > "$P/src/app.js"; g "$P" commit -q -am head
lz_run "$P" lz4
check "LZ4 counting reporter, all green: pass" 0 'j.verdict' "pass"
[[ "$(lz_count b)" == "1" && "$(grep '^b' "$LZ_LOG" | cut -f2)" == "tap" ]] && ok "LZ4b exactly one base run, the counting command" || bad "LZ4b log: $(cat "$LZ_LOG")"

# LZ5: skip increase on a counting reporter is still caught
newproj lz5; stub vitest "$SKIP_STUB"; cfg '{"commands":[{"id":"unit","argv":["./bin/vitest","run"]}]}'; printf 'module.exports = "ok";\n' > "$P/src/app.js"; seal
printf 'module.exports = "MORE";\n' > "$P/src/app.js"
export A1_FX_ARGS="$WORK/args-lz5" A1_FX_REPORT="$WORK/green.json" A1_FX_MORE="$WORK/more.json" A1_FX_RC=0
g "$P" add -A; g "$P" commit -q -m head
lz_run "$P" lz5
check "LZ5 skipped 2 on base, 4 on head, lazy path: skip_increase" 0 'const c=j.commands[0]; [j.verdict,c.reason,c.skip_increase.base,c.skip_increase.head].join(",")' "fail,skip_increase,2,4"

# LZ6: a hang on head is timeout, never pre-existing, even with a red base
newproj lz6; stub c1 'exit 1'
cfg '{"commands":[{"id":"c1","argv":["./bin/c1"],"timeout_ms":700}]}'; seal
printf 'module.exports = 2;\n' > "$P/src/app.js"; stub c1 'exec sleep 30'; g "$P" add -A; g "$P" commit -q -m head
lz_run "$P" lz6
check "LZ6 hang on head with red base: reason timeout, pre_existing_red empty" 0 'j.commands[0].reason+"|"+j.pre_existing_red.length' "timeout|0"

# LZ7 control: the verify run --base CLI stays eager (VD2 and PT0 pin a base run on a green head)
newproj lz7; stub c1 'exit 0'; stub c2 'exit 0'
cfg '{"commands":[{"id":"c1","argv":["./bin/c1"]},{"id":"c2","argv":["./bin/c2"]}]}'; seal
printf 'module.exports = 2;\n' > "$P/src/app.js"; g "$P" commit -q -am head
LZ_LOG="$WORK/lz-lz7.log"; : > "$LZ_LOG"
A1_VERIFY_SPAWN_LOG="$LZ_LOG" vrun "$P" --base main --no-cache
check "LZ7 CLI --base --no-cache: pass, no base_run record (eager)" 0 'j.verdict+"|"+(j.base_run===undefined)' "pass|true"
[[ "$(lz_count b)" == "2" ]] && ok "LZ7b CLI stays eager: 2 base runs on a green head" || bad "LZ7b log: $(lz_labels)"

# LZ8 (review fix, SEC-7): the suite never sees A1_VERIFY_SPAWN_LOG (it is the outer call's own seam), the outer call still logs
newproj lz8; stub c1 "printf '%s' \"\${A1_VERIFY_SPAWN_LOG-UNSET}\" > \"$WORK/lz8-env\"; exit 0"
cfg '{"commands":[{"id":"c1","argv":["./bin/c1"]}]}'; seal
LZ_LOG="$WORK/lz-lz8.log"; : > "$LZ_LOG"
A1_VERIFY_SPAWN_LOG="$LZ_LOG" vrun "$P" --no-cache
[[ "$(cat "$WORK/lz8-env" 2>/dev/null)" == "UNSET" ]] && ok "LZ8 the suite env has no A1_VERIFY_SPAWN_LOG" || bad "LZ8 suite saw '$(cat "$WORK/lz8-env" 2>/dev/null)'"
[[ "$(lz_count h)" == "1" ]] && ok "LZ8b the outer call still wrote its spawn log line" || bad "LZ8b log: $(lz_labels)"

lk_leak_end LZ
