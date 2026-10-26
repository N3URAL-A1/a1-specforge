# shellcheck shell=bash
# Part 03 — input boundary: secret denylist, redaction, read-only, writer gate, no network (spec 021 Wave 3).
# FR-004, FR-005, FR-006, FR-011, FR-015 plus hostile-input cases (links, traversal, FIFO, size, UTF-8, races).
# Secret-shaped strings are assembled at run time from fragments (no scanner-visible literal in this file) and
# none of them is a credential. Markers are plain LEAKMARK_* words.
# Red-making changes (mutation proofs, git-archive snapshot) are listed in the header of each group.

PROBE="$SUITE_DIR/fixtures/leak/probe.cjs"
# pj <json> <js expression over j> — one value of a probe result (json_get, tolerant of an empty reply).
pj() { [[ -n "$1" ]] || { printf "no-output"; return; }; json_get "$1" "$2"; }
# probe <args...> — runs the probe against the code under test; own-PID watchdog (a FIFO bug must not hang the suite).
probe() {
  local out="$WORK/probe.out.$$" wd
  A1_FX_SHARED="$SHARED" node "$PROBE" "$@" >"$out" 2>"$WORK/probe.err.$$" &
  local pid=$!
  ( sleep 20; kill "$pid" 2>/dev/null ) & wd=$!
  wait "$pid" 2>/dev/null; PRC=$?
  kill "$wd" 2>/dev/null; wait "$wd" 2>/dev/null
  POUT="$(cat "$out")"; PERR="$(cat "$WORK/probe.err.$$")"; rm -f "$out" "$WORK/probe.err.$$"
}
# fake_token <prefix> <len> — prefix + len alnum chars; assembled at run time, not a credential.
fake_token() { printf '%s' "$1"; printf 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0' | cut -c1-"$2"; }

# ---- the leak tree ---------------------------------------------------------------------------------------
mk_fixture_repo R3; mk_fixture_vault V4
mkdir -p "$R3/.a1/phases/p1" "$V4/project/fixture-slug/spec"
M() { printf 'LEAKMARK_%s' "$1"; }
printf '{"marker":"%s"}\n' "$(M reservations)"  > "$R3/.a1/reservations.json"
printf '{"marker":"%s"}\n' "$(M xprov)"         > "$R3/.a1/xprov.json"
printf '{"marker":"%s"}\n' "$(M allowlist)"     > "$R3/.a1/xprov-secret-allowlist.json"
printf '{"marker":"%s"}\n' "$(M dispositions)"  > "$R3/.a1/dispositions.json"
printf '{"marker":"%s"}\n' "$(M anya1json)"     > "$R3/.a1/fidelity.json"
printf '%s\n' "$(M lockfile)"                   > "$R3/package.lock"
printf 'TOKEN=%s\n' "$(M env)"                  > "$R3/.env"
printf 'TOKEN=%s\n' "$(M envlocal)"             > "$R3/.env.local"
printf 'TOKEN=%s\n' "$(M envupper)"             > "$R3/.ENV"
printf '%s\n' "$(M observations)"               > "$R3/.a1/phases/p1/observations.jsonl"
printf '%s\n' "$(M productlock)"                > "$R3/.a1/phases/p1/.product-stage.lock.json"
printf '%s\n' "$(M nestedres)"                  > "$R3/.a1/phases/p1/reservations.json"
printf '%s\n' "$(M tmpfile)"                    > "$R3/.a1/phases/p1/STATUS.md.tmp.abc"
printf '%s\n' "$(M pem)"                        > "$R3/deploy.pem"
printf '%s\n' "$(M vaultlock)"                  > "$V4/project/fixture-slug/spec/x.lock"
printf '%s\n' "$(M vaultenv)"                   > "$V4/project/fixture-slug/.env"
printf -- '---\ntitle: ok\n---\nhonest body\n'   > "$R3/.a1/phases/p1/STATUS.md"
printf -- '---\ntitle: ok\n---\nhonest spec\n'   > "$V4/project/fixture-slug/spec/001-ok.md"
MARKERS="reservations xprov allowlist dispositions anya1json lockfile env envlocal envupper observations productlock nestedres tmpfile pem vaultlock vaultenv"

# ---- FR-005: denylist, checked before open; nothing denied is traced -------------------------------------
# Mutation D1: drop 'dispositions.json' from DENY_GLOBS and neuter the generic .a1/*.json rule -> 03.1 dispositions + fidelity red (the generic rule alone also covers dispositions; D1b drops only it -> fidelity red).
# Mutation D2: test the denylist after the trace push / after open -> 03.1 trace asserts red.
# Mutation D3: drop the '.env.*' entry -> envlocal red. D4: drop the 'i' flag of globRe -> envupper red.
for rel in .a1/reservations.json .a1/xprov.json .a1/xprov-secret-allowlist.json .a1/dispositions.json \
           .a1/fidelity.json package.lock .env .env.local .ENV .a1/phases/p1/observations.jsonl \
           .a1/phases/p1/.product-stage.lock.json .a1/phases/p1/reservations.json .a1/phases/p1/STATUS.md.tmp.abc deploy.pem; do
  probe read "$R3/$rel" "$R3"
  tag="03.1 denied: ${rel##*/}"
  expect "$tag refused as EXCLUDED" "EXCLUDED" "$(pj "$POUT" 'j.code')"
  expect "$tag never traced" "0" "$(pj "$POUT" 'j.trace.length')"
done
for rel in spec/x.lock .env; do
  probe read "$V4/project/fixture-slug/$rel" "$R3" "$V4" fixture-slug
  expect "03.1 vault denied: $rel refused as EXCLUDED, not traced" "EXCLUDED:0" "$(pj "$POUT" 'j.code+":"+j.trace.length')"
done

probe read "$R3/.a1/phases/p1/STATUS.md" "$R3"
expect "03.1 control: an honest source is read" "true" "$(pj "$POUT" 'j.ok')"
expect "03.1 control: it is traced exactly once, by its path" "$R3/.a1/phases/p1/STATUS.md" "$(pj "$POUT" 'j.trace.join("|")')"
probe read "$V4/project/fixture-slug/spec/001-ok.md" "$R3" "$V4" fixture-slug
expect "03.1 control: an honest vault source is read" "true" "$(pj "$POUT" 'j.ok')"

# walk every file of repo and vault through the seam; no marker may come back (count asserts beside).
probe walk "$R3" "$V4" fixture-slug
WALK="$POUT"
expect "03.2 walk finished" "0" "$PRC"
expect "03.2 walk read honest files (count > 0)" "true" "$(pj "$WALK" 'j.read.length>0')"
NMARK=$(wc -w <<<"$MARKERS" | tr -d ' ')
expect "03.2 walk refused exactly the planted files (count = $NMARK)" "$NMARK" "$(pj "$WALK" 'j.refused')"
for m in $MARKERS; do
  expect "03.2 marker $m: 0 occurrences in all text the seam returned" "0" "$(grep -o "LEAKMARK_$m" <<<"$WALK" | wc -l | tr -d ' ')"
done
expect "03.2 trace holds no excluded path (count 0)" "0" "$(pj "$WALK" 'j.trace.filter(p=>/reservations|xprov|dispositions|fidelity|\.lock|\.env|\.ENV|observations|\.tmp\.|\.pem/i.test(p)).length')"

# ---- FR-005 end to end: planted markers never reach note, stdout, stderr, --json, nor the trace ----------
mk_fixture_vault V5; mkdir -p "$V5/project/fixture-slug"; cp "$V4/project/fixture-slug/.env" "$V5/project/fixture-slug/.env"
harness_run "$R3" "$V5" --trace "$WORK/trace.e2e"
E2E="$OUT"$'\n'"$ERR"$'\n'"$(cat "$V5/project/fixture-slug/dashboard.md" 2>/dev/null)"$'\n'"$(cat "$WORK/trace.e2e" 2>/dev/null)"
expect "03.3 build on the leak tree exits (status written)" "written" "$(pj "$OUT" 'j.status')"
for m in $MARKERS; do
  expect "03.3 marker $m: 0 in note, stdout, stderr, json, trace" "0" "$(grep -o "LEAKMARK_$m" <<<"$E2E" | wc -l | tr -d ' ')"
done
vault_run "$R3" "$V5" dashboard build --json
expect "03.3 CLI --json on the leak tree: 0 markers" "0" "$(grep -o 'LEAKMARK_' <<<"$OUT"$'\n'"$ERR" | wc -l | tr -d ' ')"

# ---- links, traversal, special files, size, encoding -----------------------------------------------------
# Mutation L1: drop the per-component lstat loop -> 03.4 link/dirlink red. L2: drop the realpath-inside check -> 03.4 dirlink
# via a link at the root's parent... (covered by 03.4 'linked root child'). L3: slug regex gone -> 03.5 '..' red.
OUTSIDE="$WORK/outside$FX_N"; mkdir -p "$OUTSIDE"; printf 'LEAKMARK_outside\n' > "$OUTSIDE/secret.md"
ln -s "$OUTSIDE/secret.md" "$R3/docs/linked.md"
ln -s "$OUTSIDE" "$R3/docs/linkdir"
ln -s "$R3/.env" "$R3/docs/to-env.md"
mkdir -p "$R3/docs/real" && printf 'real\n' > "$R3/docs/real/in.md"
ln -s "$R3/docs/real" "$R3/docs/reallink"
for rel in docs/linked.md docs/linkdir/secret.md docs/to-env.md docs/reallink/in.md; do
  probe read "$R3/$rel" "$R3"
  expect "03.4 link refused: $rel" "false" "$(pj "$POUT" 'j.ok')"
  expect "03.4 link: no marker returned for $rel" "0" "$(grep -c 'LEAKMARK_' <<<"$POUT")"
  expect "03.4 link: never traced $rel" "0" "$(pj "$POUT" 'j.trace.length')"
done
probe read "$R3/docs/../../outside$FX_N/secret.md" "$R3"
expect "03.4 .. traversal out of the repo refused" "UNSAFE_PATH" "$(pj "$POUT" 'j.code')"
probe read "$OUTSIDE/secret.md" "$R3"
expect "03.4 absolute path outside every root refused" "UNSAFE_PATH:0" "$(pj "$POUT" 'j.code+":"+j.trace.length')"
probe read "/etc/hosts" "$R3"
expect "03.4 /etc/hosts refused" "false" "$(pj "$POUT" 'j.ok')"
probe read "$R3/docs/nul$(printf '\001')x" "$R3"
expect "03.4 missing file passes ENOENT through" "ENOENT" "$(pj "$POUT" 'j.code')"
probe read "$R3/docs/no-such.md" "$R3"
expect "03.4 ENOENT stays ENOENT (callers degrade on it)" "ENOENT:0" "$(pj "$POUT" 'j.code+":"+j.trace.length')"

# slug traversal: the project root is project/<slug>/ only
printf 'LEAKMARK_otherproject\n' > "$V4/project/other.md"; mkdir -p "$V4/project/other"; printf 'LEAKMARK_otherspec\n' > "$V4/project/other/spec.md"
probe read "$V4/project/other/spec.md" "$R3" "$V4" fixture-slug
expect "03.5 another project's folder is outside the project root" "UNSAFE_PATH" "$(pj "$POUT" 'j.code')"
probe read "$V4/project/other.md" "$R3" "$V4" fixture-slug
expect "03.5 a hub note is not a source" "UNSAFE_PATH" "$(pj "$POUT" 'j.code')"
for bad in '..' '../other' 'a/../..' '' '.'; do
  probe read "$V4/project/other/spec.md" "$R3" "$V4" "$bad"
  expect "03.5 slug '$bad' widens nothing" "false" "$(pj "$POUT" 'j.ok')"
done
probe read "$V4/project/fixture-slug/dashboard.md" "$R3" "$V4" fixture-slug
expect "03.5 control: the note's own folder is a root (missing note is ENOENT)" "ENOENT" "$(pj "$POUT" 'j.code')"

# FIFO and device: refused, never blocks
mkfifo "$R3/docs/fifo.md"
probe read "$R3/docs/fifo.md" "$R3"
expect "03.6 FIFO: probe finished (no hang)" "0" "$PRC"
expect "03.6 FIFO refused as NOT_FILE" "NOT_FILE" "$(pj "$POUT" 'j.code')"

# size cap: exactly 256 KiB is read, one byte more is refused
head -c 262144 /dev/zero | tr '\0' 'a' > "$R3/docs/max.md"
head -c 262145 /dev/zero | tr '\0' 'a' > "$R3/docs/over.md"
probe read "$R3/docs/max.md" "$R3"
expect "03.7 exactly 256 KiB is read (len 262144)" "true:262144" "$(pj "$POUT" 'j.ok+":"+j.len')"
probe read "$R3/docs/over.md" "$R3"
expect "03.7 256 KiB + 1 refused TOO_LARGE" "TOO_LARGE" "$(pj "$POUT" 'j.code')"

printf 'ok \xff\xfe broken\n' > "$R3/docs/bad-utf8.md"
probe read "$R3/docs/bad-utf8.md" "$R3"
expect "03.8 non-UTF-8 refused NOT_UTF8" "NOT_UTF8" "$(pj "$POUT" 'j.code')"
printf '\xef\xbb\xbfbom ok\n' > "$R3/docs/bom.md"
probe read "$R3/docs/bom.md" "$R3"
expect "03.8 control: valid UTF-8 with a BOM is read" "true" "$(pj "$POUT" 'j.ok')"

# TOCTOU stress: a file flips between a regular file and a link to a secret while the seam reads it.
# Probabilistic by nature; the deterministic guards are the lstat walk, O_NOFOLLOW and the dev/ino check.
mkdir -p "$R3/race"; printf 'honest\n' > "$R3/race/f.md"
node -e '
const fs=require("fs");const [d,sec]=process.argv.slice(1);const f=d+"/f.md",t=d+"/t.md";
for(let i=0;i<4e5;i++){try{fs.unlinkSync(t)}catch(_e){}try{fs.symlinkSync(sec,t);fs.renameSync(t,f)}catch(_e){}
try{fs.unlinkSync(t)}catch(_e){}try{fs.writeFileSync(t,"honest\n");fs.renameSync(t,f)}catch(_e){}}' "$R3/race" "$OUTSIDE/secret.md" &
FLIP=$!
leaks=0; n=0
for _ in 1 2 3; do
  probe walk "$R3" "$V4" fixture-slug
  n=$((n + 1)); [[ "$POUT" == *LEAKMARK_outside* ]] && leaks=$((leaks + 1))
done
kill "$FLIP" 2>/dev/null; wait "$FLIP" 2>/dev/null
expect "03.9 race: 0 of $n walks returned the outside secret" "0" "$leaks"
rm -rf "$R3/race"

# ---- FR-006: cleanText -----------------------------------------------------------------------------------
# Mutation C1: cleanText returns String(v) -> every 03.10 redaction red. C2: no second redact -> split token red.
# C3: no control-char strip -> newline/bidi cases red.
GH="$(fake_token ghp_ 36)"; SK="$(fake_token sk- 40)"; AWS="AKIA$(printf 'ABCDEFGHIJKLMNOP')"
probe clean "Title $GH end"
expect "03.10 GitHub-shaped token redacted" "Title [REDACTED] end" "$POUT"
expect "03.10 raw token count 0" "0" "$(grep -cF "$GH" <<<"$POUT")"
probe clean "a $SK b $AWS c"
expect "03.10 sk- and AWS-shaped redacted, 2 markers" "2" "$(grep -o '\[REDACTED\]' <<<"$POUT" | wc -l | tr -d ' ')"
expect "03.10 raw sk- token count 0" "0" "$(grep -cF "$SK" <<<"$POUT")"
probe clean "$(printf 'line1\nline2\r\nline3\ttab\001ctl')"
expect "03.11 newlines, tabs and controls become single spaces" "line1 line2 line3 tab ctl" "$POUT"
probe clean "$(printf 'x\xe2\x80\xaeevil\xe2\x80\xac y')"
expect "03.11 bidi override stripped" "x evil y" "$POUT"
probe clean "ghp_$(printf '\xe2\x80\x8b')$(printf 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4')"
expect "03.12 zero-width char inside a token cannot hide it" "[REDACTED]" "$POUT"
probe clean "tok $(fake_token ghp_ 10)
$(printf 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4')"
expect "03.12 token split by a line break is redacted after the join" "tok [REDACTED]" "$POUT"
probe clean "key: $(printf -- '-----BEGIN PRIVATE KEY-----\nQUJD\n-----END PRIVATE KEY-----')"
expect "03.12 PEM block redacted" "key: [REDACTED]" "$POUT"
probe clean "plain heading"
expect "03.12 control: plain text unchanged" "plain heading" "$POUT"
probe clean 'password: hunter2 rest'
expect "03.12 key: value secret redacted" "[REDACTED] rest" "$POUT"

# ---- FR-011: writer gate ---------------------------------------------------------------------------------
# Mutation W1: writerCheck always allows -> 03.13 red. W2: the reason loses the host pair -> stderr assert red.
# W3: unreadable declaration allowed -> 03.14 red.
mk_fixture_repo R6; mk_fixture_vault V6
sed 's/^a1_writer_host: fx-writer$/a1_writer_host: other-host/' "$V6/project/fixture-slug.md" > "$V6/hub.tmp" && mv "$V6/hub.tmp" "$V6/project/fixture-slug.md"
expect "03.13 fixture hub declares other-host (count 1)" "1" "$(grep -c '^a1_writer_host: other-host$' "$V6/project/fixture-slug.md")"
before_v="$(tree_hash "$V6")"; before_r="$(tree_hash "$R6")"
vault_run "$R6" "$V6" dashboard build
expect "03.13 foreign writer: exit 0" "0" "$RC"
expect "03.13 foreign writer: stderr is exactly the skip line" "[a1-tools] dashboard skipped: this host is not the vault writer (fx-writer ≠ other-host)" "$ERR"
expect "03.13 foreign writer: stderr is one line" "1" "$(printf '%s\n' "$ERR" | wc -l | tr -d ' ')"
expect "03.13 foreign writer: stdout empty" "" "$OUT"
expect "03.13 foreign writer: no dashboard.md" "0" "$(find "$V6" -name 'dashboard.md*' | wc -l | tr -d ' ')"
expect "03.13 foreign writer: vault tree unchanged" "$before_v" "$(tree_hash "$V6")"
expect "03.13 foreign writer: repo tree unchanged" "$before_r" "$(tree_hash "$R6")"
vault_run "$R6" "$V6" dashboard build --json
expect "03.13 foreign writer --json: status skipped-non-writer, exit 0" "skipped-non-writer:0" "$(pj "$OUT" 'j.status')":"$RC"
expect "03.13 foreign writer --json: same single stderr line" "[a1-tools] dashboard skipped: this host is not the vault writer (fx-writer ≠ other-host)" "$ERR"
probe writer fixture-slug "$V6"
expect "03.13 writerCheck unit: deny" "false" "$(pj "$POUT" 'j.allow')"
expect "03.13 writerCheck unit: reason" "this host is not the vault writer (fx-writer ≠ other-host)" "$(A1_HOST_ID=fx-writer A1_FX_SHARED="$SHARED" node "$PROBE" writer fixture-slug "$V6" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).reason||"")')"

# the matching writer writes
mk_fixture_vault V7; mk_fixture_repo R7
vault_run "$R7" "$V7" dashboard build
expect "03.14 own host is the writer: note written, exit 0" "0:1" "$RC:$(find "$V7" -name dashboard.md | wc -l | tr -d ' ')"
# unreadable declaration fails closed
printf -- '---\na1_writer_host: a\na1_writer_host: b\ntype: project\n---\n' > "$V7/project/fixture-slug.md"
rm -f "$V7/project/fixture-slug/dashboard.md"
vault_run "$R7" "$V7" dashboard build
expect "03.14 duplicate writer key: skipped (fail closed), exit 0, no note" "0:0" "$RC:$(find "$V7" -name dashboard.md | wc -l | tr -d ' ')"
expect_has "03.14 skip line for an unreadable declaration" "$ERR" "[a1-tools] dashboard skipped: "
# hub missing entirely and no folder: open to every host (undeclared)
mk_fixture_vault V8; rm -f "$V8/project/fixture-slug.md"; mk_fixture_repo R8
vault_run "$R8" "$V8" dashboard build
expect "03.14 no hub, no folder (undeclared writer): written" "0:1" "$RC:$(find "$V8" -name dashboard.md | wc -l | tr -d ' ')"

# ---- FR-004: read-only — the build writes nothing but the note ----------------------------------------------
# Mutation R1: writeAtomic leaves its tmp file, or the build writes a second file -> 03.15 red.
mk_fixture_repo R9; mk_fixture_vault V9
b_r="$(tree_hash "$R9")"; b_v="$(tree_hash "$V9" dashboard.md)"
vault_run "$R9" "$V9" dashboard build
expect "03.15 build exits 0" "0" "$RC"
expect "03.15 repo tree hash unchanged (files > 0)" "$b_r" "$(tree_hash "$R9")"
expect "03.15 vault tree hash minus dashboard.md unchanged" "$b_v" "$(tree_hash "$V9" dashboard.md)"
expect "03.15 hash covered files (count > 0)" "true" "$([[ "$(printf '%s\n' "$b_r" | wc -l | tr -d ' ')" -gt 0 ]] && echo true || echo false)"
expect "03.15 no .tmp. sibling remains" "0" "$(find "$V9" "$R9" -name '*.tmp.*' | wc -l | tr -d ' ')"
expect "03.15 git status of the repo is clean" "" "$(git -C "$R9" status --porcelain)"
# symlinked ROADMAP: refused through the seam, one stderr line, exit 2, nothing written
mk_fixture_repo R10; mk_fixture_vault V10
mv "$R10/docs/product/ROADMAP.md" "$WORK/roadmap.real" && ln -s "$WORK/roadmap.real" "$R10/docs/product/ROADMAP.md"
vault_run "$R10" "$V10" dashboard build
expect "03.16 linked ROADMAP: exit 2" "2" "$RC"
expect "03.16 linked ROADMAP: one stderr line" "1" "$(printf '%s\n' "$ERR" | wc -l | tr -d ' ')"
expect "03.16 linked ROADMAP: no note" "0" "$(find "$V10" -name dashboard.md | wc -l | tr -d ' ')"

# ---- FR-015: no network, no process, no dynamic code in dashboard*.cjs -------------------------------------
# Mutation N1: add `require('http')` (or any listed module) to dashboard-read.cjs -> 03.17 red.
NET_RE="require\\(['\"](node:)?(http|https|http2|net|tls|dgram|dns|child_process|worker_threads|vm)['\"]\\)|\\beval\\(|new Function\\(|\\bfetch\\(|process\\.binding|import\\("
net_count() { cat "$@" 2>/dev/null | grep -Ec "$NET_RE"; }
DASH_FILES=("$SHARED"/lib/dashboard*.cjs)
expect "03.17 dashboard*.cjs files found (count >= 5)" "true" "$([[ "${#DASH_FILES[@]}" -ge 5 ]] && echo true || echo false)"
expect "03.17 no network, process or dynamic-code use (count 0)" "0" "$(net_count "${DASH_FILES[@]}" "$SHARED/lib/help-dashboard.cjs")"
printf "const h = require('http');\n" > "$WORK/plant1.cjs"; printf 'x = eval("1");\n' > "$WORK/plant2.cjs"
expect "03.17 control: the check sees require('http') (count 1)" "1" "$(net_count "$WORK/plant1.cjs")"
expect "03.17 control: the check sees eval( (count 1)" "1" "$(net_count "$WORK/plant2.cjs")"

# ---- Wave 6 (review fixes): link walk from the vault root, denylist breadth, note read, writer order -----
# RED before the fix: the link walk began at the sub-root (a link at or above project/ or pattern/ went
# unseen); `.A1/` and `.envrc` were readable; the foreign-note check read a FIFO with readFileSync (hang);
# the vault contract allowed any file type under the widened roots; hard links passed.
mk_sections_repo W6R; mk_sections_vault W6V
mkdir -p "$WORK/ext6"

# SEC-1: a link at or above a vault root is refused
EXT="$WORK/ext6/pattern-real"; mkdir -p "$EXT" && cp -R "$W6V/pattern/." "$EXT/" && mv "$W6V/pattern" "$W6V/pattern.moved" && ln -s "$EXT" "$W6V/pattern"
probe read "$W6V/pattern/a1-learnings/patterns.md" "$W6R" "$W6V" fixture-slug
expect "03.14 read through a linked <vault>/pattern is refused" "UNSAFE_PATH:0" "$(pj "$POUT" 'j.code+":"+j.trace.length')"
rm "$W6V/pattern"; mv "$W6V/pattern.moved" "$W6V/pattern"
LEXT="$WORK/ext6/learn-real"; mkdir -p "$LEXT" && cp -R "$W6V/pattern/a1-learnings/." "$LEXT/" && mv "$W6V/pattern/a1-learnings" "$W6V/pattern/a1-learnings.moved" && ln -s "$LEXT" "$W6V/pattern/a1-learnings"
probe read "$W6V/pattern/a1-learnings/patterns.md" "$W6R" "$W6V" fixture-slug
expect "03.15 read through a linked <vault>/pattern/a1-learnings is refused" "UNSAFE_PATH:0" "$(pj "$POUT" 'j.code+":"+j.trace.length')"
rm "$W6V/pattern/a1-learnings"; mv "$W6V/pattern/a1-learnings.moved" "$W6V/pattern/a1-learnings"
probe read "$W6V/pattern/a1-learnings/patterns.md" "$W6R" "$W6V" fixture-slug
expect "03.15b control: the unlinked learning store reads" "true" "$(pj "$POUT" 'j.ok')"
PEXT="$WORK/ext6/evil-real"; mkdir -p "$PEXT/postmortems" && printf -- '---\ndate: 2099-01-01\n---\nLEAKMARK_evilpm\n' > "$PEXT/postmortems/x.md"
ln -s "$PEXT" "$W6V/project/evil"
probe read "$W6V/project/evil/postmortems/x.md" "$W6R" "$W6V" fixture-slug
expect "03.16 read through a linked <vault>/project/<x> (postmortems) is refused" "UNSAFE_PATH:0" "$(pj "$POUT" 'j.code+":"+j.trace.length')"
rm "$W6V/project/evil"
# a linked <vault>/project: the read and the build both refuse
mk_sections_repo W6R2; mk_sections_vault W6V2
PRJ="$WORK/ext6/project-real"; mkdir -p "$PRJ" && cp -R "$W6V2/project/." "$PRJ/" && rm -rf "$W6V2/project" && ln -s "$PRJ" "$W6V2/project"
probe read "$W6V2/project/fixture-slug/spec/021-dashboard.md" "$W6R2" "$W6V2" fixture-slug
expect "03.17b read through a linked <vault>/project is refused" "UNSAFE_PATH:0" "$(pj "$POUT" 'j.code+":"+j.trace.length')"
before_p="$(tree_hash "$PRJ")"
vault_run "$W6R2" "$W6V2" dashboard build
expect "03.18 build through a linked <vault>/project exits 2" "2" "$RC"
expect "03.18 nothing written through the link" "$before_p" "$(tree_hash "$PRJ")"

# SEC-2 / SEC-3: denylist case and breadth (the name alone decides, before any fs access)
for rel in .A1/verify.json .a1/Verify.JSON .A1/phases/x/reservations.json .envrc .env.production.local .ENVRC .env.d; do
  probe read "$W6R/$rel" "$W6R"
  expect "03.19 denied by name: $rel" "EXCLUDED:0" "$(pj "$POUT" 'j.code+":"+j.trace.length')"
done

# SEC-4: a FIFO, an oversized or a hard-linked dashboard.md; own-PID watchdog (a hang must not stall the suite)
# run_cli <host id> <repo> <vault> — real CLI, 8 s watchdog on its own PID (a hang must not stall the suite); sets RC, ERR
run_cli() {
  local errf="$WORK/err.rc" pid wd
  pushd "$2" >/dev/null || return
  A1_VAULT_ROOT="$3" A1_HOST_ID="$1" node "$TOOLS" dashboard build >/dev/null 2>"$errf" &
  pid=$!
  popd >/dev/null || return
  ( sleep 8; kill "$pid" 2>/dev/null ) & wd=$!
  wait "$pid" 2>/dev/null; RC=$?
  kill "$wd" 2>/dev/null; wait "$wd" 2>/dev/null
  ERR="$(cat "$errf")"
}
nonwriter_build() { run_cli other-host "$1" "$2"; }
bounded_build() { run_cli fx-writer "$1" "$2"; }
mk_sections_repo FR6; mk_sections_vault FV6
mkfifo "$FV6/project/fixture-slug/dashboard.md"
bounded_build "$FR6" "$FV6"
expect "03.20 a FIFO at dashboard.md: exit 2, no hang" "2" "$RC"
expect_has "03.21 a FIFO at dashboard.md: refused as foreign_note" "$ERR" "foreign_note"
[[ -p "$FV6/project/fixture-slug/dashboard.md" ]] && ok "03.22 the FIFO is untouched" || bad "03.22 the FIFO was replaced"
rm -f "$FV6/project/fixture-slug/dashboard.md"
head -c 262145 /dev/zero | tr '\0' 'a' > "$FV6/project/fixture-slug/dashboard.md"
bounded_build "$FR6" "$FV6"
expect "03.23 an oversized dashboard.md: exit 2" "2" "$RC"
expect_has "03.24 an oversized dashboard.md: unreadable_note (size limit, not a full read)" "$ERR" "unreadable_note"
rm -f "$FV6/project/fixture-slug/dashboard.md"
printf 'hand written\n' > "$FV6/project/fixture-slug/hand.md"; ln "$FV6/project/fixture-slug/hand.md" "$FV6/project/fixture-slug/dashboard.md"
bounded_build "$FR6" "$FV6"
expect "03.25 a hard-linked dashboard.md: exit 2" "2" "$RC"
expect "03.26 the hard-linked file is untouched" "hand written" "$(cat "$FV6/project/fixture-slug/hand.md")"
rm -f "$FV6/project/fixture-slug/dashboard.md" "$FV6/project/fixture-slug/hand.md"

# SEC-6 / SEC-7: hard links and non-markdown files under the widened roots
printf 'LEAKMARK_hard\n' > "$WORK/ext6/hard-src.md"; ln "$WORK/ext6/hard-src.md" "$W6R/docs-hard.md"
probe read "$W6R/docs-hard.md" "$W6R"
expect "03.27 a regular file with two hard links is refused" "UNSAFE_PATH:0" "$(pj "$POUT" 'j.code+":"+j.trace.length')"
printf 'plain\n' > "$W6R/docs-single.md"
probe read "$W6R/docs-single.md" "$W6R"
expect "03.28 control: a single-link file reads" "true" "$(pj "$POUT" 'j.ok')"
printf 'LEAKMARK_txt\n' > "$W6V/pattern/a1-learnings/notes.txt"; printf '{"k":"LEAKMARK_json"}\n' > "$W6V/pattern/a1-learnings/state.json"
mkdir -p "$W6V/project/other/postmortems"; printf 'LEAKMARK_pmtxt\n' > "$W6V/project/other/postmortems/p.txt"; printf -- '---\ndate: 2026-01-01\n---\nok\n' > "$W6V/project/other/postmortems/p.md"
for f in "$W6V/pattern/a1-learnings/notes.txt" "$W6V/pattern/a1-learnings/state.json" "$W6V/project/other/postmortems/p.txt"; do
  probe read "$f" "$W6R" "$W6V" fixture-slug
  expect "03.29 widened root, not markdown: ${f##*/} refused" "UNSAFE_PATH:0" "$(pj "$POUT" 'j.code+":"+j.trace.length')"
done
probe read "$W6V/project/other/postmortems/p.md" "$W6R" "$W6V" fixture-slug
expect "03.30 widened root, markdown file: reads" "true" "$(pj "$POUT" 'j.ok')"

# SEC-9: the unreadable-fallback reason comes from vault-writer's own wording (right remedy for the env source)
mkdir -p "$WORK/wv/project/fixture-slug"; printf -- '---\ntype: project\ntitle: fixture-slug\n---\n' > "$WORK/wv/project/fixture-slug.md"
A1_HOST_ID=fx-writer A1_VAULT_WRITER_HOST='Bad Host!' probe writer fixture-slug "$WORK/wv"
expect "03.31 invalid fallback env: not allowed" "false" "$(pj "$POUT" 'j.allow')"
expect_has "03.32 the reason names the fallback env, not the hub" "$(pj "$POUT" 'j.reason')" "fallback writer of fixture-slug unreadable: A1_VAULT_WRITER_HOST is not a valid host id"
expect_lacks "03.33 the reason does not send the owner to repair the hub" "$(pj "$POUT" 'j.reason')" "create or repair"
printf -- '---\na1_writer_host: "bad host!"\ntype: project\n---\n' > "$WORK/wv/project/fixture-slug.md"
A1_HOST_ID=fx-writer probe writer fixture-slug "$WORK/wv"
expect_has "03.34 an unreadable hub declaration still says create or repair the hub" "$(pj "$POUT" 'j.reason')" "create or repair project/fixture-slug.md"

# item 10: the writer gate runs before the target check and the writable-root check
mk_sections_repo GR; mk_sections_vault GV
printf 'hand written\n' > "$GV/project/fixture-slug/dashboard.md"
nonwriter_build "$GR" "$GV"
expect "03.35 non-writer host + foreign note: skip, exit 0 (not foreign_note)" "0" "$RC"
expect_has "03.36 non-writer host + foreign note: the skip line" "$ERR" "dashboard skipped: this host is not the vault writer"
rm -f "$GV/project/fixture-slug/dashboard.md"; mkfifo "$GV/project/fixture-slug/dashboard.md"
nonwriter_build "$GR" "$GV"
expect "03.37 non-writer host + FIFO at the note: skip, exit 0 without opening it" "0" "$RC"
rm -f "$GV/project/fixture-slug/dashboard.md"
if [[ "$(id -u)" != "0" ]]; then
  chmod 555 "$GV"
  nonwriter_build "$GR" "$GV"
  expect "03.38 non-writer host + unwritable vault root: skip, exit 0" "0" "$RC"
  bounded_build "$GR" "$GV"
  expect "03.39 control: writer host + unwritable vault root: exit 2" "2" "$RC"
  expect_has "03.40 control: reason vault_not_writable" "$ERR" "vault_not_writable"
  chmod 755 "$GV"
else
  ok "03.38 skipped as root (chmod has no effect)"; ok "03.39 skipped as root"; ok "03.40 skipped as root"
fi
