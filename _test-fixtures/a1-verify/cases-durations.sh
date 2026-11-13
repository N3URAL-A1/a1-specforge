# Sourced by run-tests.sh (spec 027 FR-002, slice 1 wave 2). Uses the suite helpers: newproj, stub, cfg, seal, vrun, check, g.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# RED-proof (applied once on a scratch copy, see STATUS-verify.md):
#   verify-run.cjs runCommand(): duration_ms constant 0                : VD5 red
#   verify-run.cjs runHeadSide(): cache hit duration not nulled        : VD3 red

# VD1: two commands, head only
newproj vd1; stub a 'exit 0'; stub b 'exit 0'
cfg '{"commands":[{"id":"a","argv":["./bin/a"]},{"id":"b","argv":["./bin/b"]}]}'; seal
vrun "$P" --no-cache
check "VD1 head-only: command durations are integers >= 0, base null, total >= head" 0 \
  'const c=j.commands, d=j.duration_ms; c.every(x=>Number.isInteger(x.duration_ms)&&x.duration_ms>=0&&x.base_duration_ms===null&&x.retry_duration_ms===null)&&d.base===null&&Number.isInteger(d.head)&&d.total>=d.head' "true"

# VD2: --base main
newproj vd2; stub a 'exit 0'; cfg '{"commands":[{"id":"a","argv":["./bin/a"]}]}'; seal
printf 'module.exports = 2;\n' > "$P/src/app.js"; g "$P" commit -q -am "head change"
vrun "$P" --base main --no-cache
check "VD2 --base: base_duration_ms integers, duration_ms.base integer, total >= max(head, base)" 0 \
  'const d=j.duration_ms; j.commands.every(x=>Number.isInteger(x.base_duration_ms)&&x.base_duration_ms>=0)&&Number.isInteger(d.base)&&d.total>=Math.max(d.head,d.base)' "true"

# VD3: second run on a clean tree is a cache hit: null, never 0
newproj vd3; stub a 'exit 0'; cfg '{"commands":[{"id":"a","argv":["./bin/a"]}]}'; seal
vrun "$P"; vrun "$P"
check "VD3 cache hit: cache.head hit, every command duration_ms null (never 0)" 0 \
  'j.cache.head+"/"+j.commands.every(x=>x.duration_ms===null&&x.retry_duration_ms===null)' "hit/true"

# VD4: flaky command (fails first, passes on the retry): both durations present
newproj vd4; stub vitest "$FLAKY_STUB"; cfg '{"commands":[{"id":"unit","argv":["./bin/vitest","run"]}]}'; seal
export A1_FX_CTR="$WORK/ctr-vd4"; rm -f "$A1_FX_CTR"; export A1_FX_ARGS="$WORK/args-vd4" A1_FX_REPORT="$CORPUS/vitest-3-40-2.json"
vrun "$P" --no-cache
check "VD4 retry: retried, retry_duration_ms and duration_ms are integers >= 0" 1 \
  'const c=j.commands[0]; c.retried+"/"+Number.isInteger(c.retry_duration_ms)+"/"+Number.isInteger(c.duration_ms)' "true/true/true"

# VD5: a 300 ms command reports at least 250
newproj vd5; stub slow "node -e 'setTimeout(()=>{},300)'"; cfg '{"commands":[{"id":"slow","argv":["./bin/slow"]}]}'; seal
vrun "$P" --no-cache
check "VD5 300 ms command: duration_ms >= 250" 0 'j.commands[0].duration_ms>=250' "true"

# VD6: the new keys do not break verify check on a written VERIFICATION.md
newproj vd6; stub ok 'exit 0'; cfg '{"commands":[{"argv":["./bin/ok"]}]}'; seal
printf -- '---\nverdict: PASS\n---\n' > "$P/.a1/VERIFICATION.md"
vrun "$P" --out "$P/.a1/VERIFICATION.md"
vcheck "$P/.a1/VERIFICATION.md"
check "VD6 verify check after a run with duration fields: exit 0" 0 'j.ok' "true"
