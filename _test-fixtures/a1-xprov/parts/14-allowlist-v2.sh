#!/usr/bin/env bash
# Part 14 — spec 012 Wave D: allowlist v2 scopes (FR-019..FR-025, plan wave D, D.5).
# Sourced by run-tests.sh. Every arm names the single production change that turns it red.
#
# Technique (as part 08): every arm builds its own primary checkout with a local BARE
# `origin`, its own HOME (the approval store lives there), and runs the dispatch-free
# `xprov snapshot --repo R --commit C [--base B]` — scan + allowlist evaluation, no
# provider call. The allowlist is always committed ALONE on main (FR-030 d), pushed,
# and its blob approved by writing the documented store format directly (the owner
# approval command is TTY-only; part 08 covers it). Plan arms use no --base
# (gateKind plan, anchor = merge-base with origin/main); wave arms pass --base.
#
# Every fake is ASSEMBLED AT RUNTIME from pieces that match no pattern, so this file adds
# no match to the repository's own scan (SC-009 clause): the keyword `pass`+`word` is
# split, key shapes are built from prefix variables.
#
# Mutations (one per loosening; each makes exactly the named arms red):
#   M1 changed-line check removed (every match counts as unchanged)  → D2 (ii), D2b
#   M2 HIGH_CONFIDENCE guard removed from the scope schema           → D1 (iv)
#   M3 prefix tree check at the anchor removed                       → D1 (v)
#   M4 root/glob/escape check on the prefix removed                  → D1 (vi)
#   M5 max_count count check removed                                 → D3 (vii)
#   M6 hard bound 2000 removed                                       → D1 (vii-bound)
#   M7 non-'M' diff status (A/D/T…) treated as unchanged             → D2 (iii)
#   M8 base side judged against the head diff                        → D2 (ix)
#   M9 binary diff treated as "no changed lines"                     → D2 binary arm
#   M10 match without a line treated as unchanged                    → D2 utf-16 arm
#   M11 scopes also applied to the input side                        → D3 input arm

TMP14="$(mktemp -d "${TMPDIR:-/tmp}/a1x14.XXXXXX")"
[[ -n "$TMP14" && -d "$TMP14" ]] || { echo "FAIL  part 14: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
SAVED_HOME_14="$HOME"
AL14=".a1/xprov-secret-allowlist.json"
STORE14="allowlist-approvals.json"
N14=0
make_tree

# ---------- runtime-assembled fakes ----------
PWK="pass""word"                                   # keyword of password_assignment
pwline14() { printf '%s: %s' "$PWK" "$1"; }        # a line the pattern matches (value >= 8 chars)
AKP="AKI""A"
FAKE_AK14="${AKP}ZZZZZZZZZZZZZZZZ"                 # aws_access_key_id shape (high confidence)
D14="-----"
PEM14="${D14}BEGIN"                                # pem_begin shape (not high confidence)

# ---------- repo, origin, HOME ----------
c14() { git -C "$R14" add -A && git -C "$R14" commit -qm "$1"; }
push14() { git -C "$R14" push -q origin HEAD:refs/heads/main && git -C "$R14" fetch -q origin; }
head14() { git -C "$R14" rev-parse "${1:-HEAD}"; }

# new14 — fresh HOME, bare origin O14, primary checkout R14 on main with the permit record
# (decided_by robert, committed: the owner check reads it at the anchor), src/add.js, tests/
# and lib/ trees; pushed and fetched.
new14() {
  N14=$((N14 + 1)); A14="$TMP14/a$N14"; mkdir -p "$A14"
  export HOME="$A14/home"; mkdir -p "$HOME"
  O14="$A14/origin.git"; R14="$A14/repo"
  git init -q --bare "$O14" && git -C "$O14" symbolic-ref HEAD refs/heads/main
  git init -q "$R14" && git -C "$R14" symbolic-ref HEAD refs/heads/main
  git -C "$R14" config user.name fixture; git -C "$R14" config user.email fixture@example.invalid; git -C "$R14" config commit.gpgsign false
  mkdir -p "$R14/src" "$R14/tests" "$R14/lib"
  printf 'export function add(a, b) { return a + b; }\n' > "$R14/src/add.js"
  printf 'plain\n' > "$R14/tests/plain.txt"; printf 'plain\n' > "$R14/lib/plain.txt"
  write_permit "$R14" robert record/2026-10-06-fixture.md
  c14 "base"
  git -C "$R14" remote add origin "$O14"; push14
}

# store14 — approves the allowlist blob at origin/main (store written directly, documented format).
store14() {
  git -C "$R14" show "origin/main:$AL14" > "$A14/blob"
  local sha key; sha="$(sha256_of "$A14/blob")"; key="$(cd "$R14" && cd "$(git rev-parse --git-common-dir)" && pwd -P)"
  mkdir -p "$HOME/.a1-xprov"; chmod 700 "$HOME/.a1-xprov"
  node -e 'const [f, k, ...s] = process.argv.slice(1); require("fs").writeFileSync(f, JSON.stringify({ version: 1, repos: { [k]: s } }, null, 2) + "\n");' "$HOME/.a1-xprov/$STORE14" "$key" "$sha"
  chmod 600 "$HOME/.a1-xprov/$STORE14"
  BLOB14="$sha"
}

# sc14 <prefix> <pattern> <max_count> — one scope, literal JSON.
sc14() {
  printf '{"prefix":"%s","pattern":"%s","class":"fixture_fake","max_count":%s,"reason":"fixture","reviewed_by":"%s","added_on":"2026-10-06"}' "$1" "$2" "$3" "${REV14:-robert}"
}
# doc14 <scopes-json> [entries-json] [owner] [version]
doc14() { printf '{"version":%s,"owner":"%s","entries":[%s],"scopes":[%s]}\n' "${4:-2}" "${3:-robert}" "${2:-}" "$1"; }

# al14 <doc> [approve=1] — the allowlist alone in its own commit on main, pushed; approved unless $2 = 0.
al14() {
  printf '%s' "$1" > "$R14/$AL14"; git -C "$R14" add "$AL14"; git -C "$R14" commit -qm "allowlist"; push14
  if [[ "${2:-1}" == 1 ]]; then store14; fi
}

# feat14 — branch feat from main; leaves the caller to change files, then commit with c14.
feat14() { git -C "$R14" checkout -q -B feat main; }

# snap14 <commit> [flags…] — `xprov snapshot` from inside R14. Sets S_OUT S_ERR S_RC; removes an ok snapshot.
snap14() {
  local c="$1"; shift
  S_OUT="$(cd "$R14" && node "$TREE_TOOLS" xprov snapshot --repo "$R14" --commit "$c" "$@" 2>"$TMP14/err.txt")"; S_RC=$?
  S_ERR="$(cat "$TMP14/err.txt")"
  local d; d="$(json_get "$S_OUT" "j.snapshot")"
  if [[ "$d" == */snap-* ]]; then node "$TREE_TOOLS" xprov snapshot --remove "$d" >/dev/null 2>&1; fi
}
# expect14 <name> <reason[/detail]> — exit 1 with that reason (and reason_detail when given as reason/detail).
expect14() {
  local got
  if [[ "$2" == */* ]]; then got="$(json_get "$S_OUT" "j.reason + '/' + j.reason_detail")"; else got="$(json_get "$S_OUT" "j.reason")"; fi
  [[ "$S_RC" -eq 1 && "$got" == "$2" ]] && ok "$1 → $2" || bad "$1: want $2 (exit 1), got $got (exit $S_RC) — $(printf '%s' "$S_ERR" | head -n 2 | tr '\n' ' ')"
}
pass14() {
  [[ "$S_RC" -eq 0 && "$(json_get "$S_OUT" "j.ok")" == "true" ]] && ok "$1 → pass" || bad "$1: want pass, got $(json_get "$S_OUT" "j.reason + '/' + j.reason_detail") (exit $S_RC) — $(printf '%s' "$S_ERR" | head -n 2 | tr '\n' ' ')"
}

# variant14 <name> <doc> <expected> [detail-substring] — on the current repo: the doc becomes main's allowlist (alone, approved),
# feat gets one harmless commit, snapshot of feat must end as <expected> ("pass" or a reason[/detail]).
VARIANT14_N=0
variant14() {
  VARIANT14_N=$((VARIANT14_N + 1))
  git -C "$R14" checkout -q main; al14 "$2"
  feat14; printf '// v%s\n' "$VARIANT14_N" >> "$R14/src/add.js"; c14 "feature $VARIANT14_N"
  snap14 feat
  if [[ "$3" == pass ]]; then pass14 "$1"; else expect14 "$1" "$3"; fi
  # the substring pins the RULE that fired (without it a v2 document that the old parser refuses wholesale would pass every negative arm)
  if [[ -n "${4:-}" ]]; then
    local det; det="$(json_get "$S_OUT" "j.detail")"
    [[ "$det" == *"$4"* ]] && ok "$1: detail names the rule ($4)" || bad "$1: detail lacks '$4' (got: ${det:0:120})"
  fi
  git -C "$R14" checkout -q main
}

# ---------- D1: schema of allowlist v2 (FR-019) ----------
# Mutations: M2 (iv), M3 (v), M4 (vi), M6 (vii-bound).
caseD1() {
  new14
  mkdir -p "$R14/d" ; printf 'x\n' > "$R14/d/f.txt"; c14 "dir d"; push14
  local ok2="$(sc14 tests/ password_assignment 5)"
  variant14 "D1 a valid v2 document (one scope, no entries)" "$(doc14 "$ok2")" pass
  variant14 "D1 viii v1-shaped keys with version 2 (no scopes key)" '{"version":2,"owner":"robert","entries":[]}' "allowlist_invalid"
  variant14 "D1 v1 document carrying a scopes key" "$(doc14 "$ok2" '' robert 1)" "allowlist_invalid"
  variant14 "D1 version 3" "$(doc14 "$ok2" '' robert 3)" "allowlist_invalid"
  # (iv) high-confidence patterns are never scoped
  variant14 "D1 iv scope on aws_access_key_id" "$(doc14 "$(sc14 tests/ aws_access_key_id 1)")" "allowlist_invalid" "high-confidence"
  variant14 "D1 iv scope on sk_prefixed_key_ext" "$(doc14 "$(sc14 tests/ sk_prefixed_key_ext 1)")" "allowlist_invalid" "high-confidence"
  variant14 "D1 iv scope on private_key_header" "$(doc14 "$(sc14 tests/ private_key_header 1)")" "allowlist_invalid" "high-confidence"
  variant14 "D1 iv scope on slack_token_family" "$(doc14 "$(sc14 tests/ slack_token_family 1)")" "allowlist_invalid" "high-confidence"
  variant14 "D1 non-high-confidence pem_begin scope is valid" "$(doc14 "$(sc14 tests/ pem_begin 1)")" pass
  # (v) prefix must be a tree at the anchor
  variant14 "D1 v prefix that does not exist" "$(doc14 "$(sc14 nodir/ password_assignment 1)")" "allowlist_invalid" "not a directory at the anchor"
  variant14 "D1 v prefix that is a file" "$(doc14 "$(sc14 src/add.js/ password_assignment 1)")" "allowlist_invalid" "not a directory at the anchor"
  variant14 "D1 v prefix that is a tree (second level)" "$(doc14 "$(sc14 d/ password_assignment 1)")" pass
  # (v) the tree is read at the ANCHOR, not at the reviewed commit: a directory the feature adds does not count
  git -C "$R14" checkout -q main; al14 "$(doc14 "$(sc14 later/ password_assignment 1)")"
  feat14; mkdir -p "$R14/later"; printf 'x\n' > "$R14/later/f.txt"; c14 "feature adds later/"
  snap14 feat; expect14 "D1 v prefix that is a tree only at the reviewed commit" "allowlist_invalid"
  [[ "$(json_get "$S_OUT" "j.detail")" == *"not a directory at the anchor"* ]] && ok "D1 v …names the anchor rule" || bad "D1 v …lacks the anchor rule"
  git -C "$R14" checkout -q main
  # (vi) prefix shape: root, glob, escape, relative segments, missing slash
  local p
  for p in '/' './' '' 'tests' '*/' 'te*/' 't?sts/' 'tests//' '../' '/tests/' 'tests/./' 'tests/../' 'tests\\/' '{tests}/' '[t]ests/'; do
    variant14 "D1 vi prefix '$p'" "$(doc14 "$(sc14 "$p" password_assignment 1)")" "allowlist_invalid" ".prefix:"
  done
  # (vii-bound) max_count bounds
  variant14 "D1 max_count 2000 is valid" "$(doc14 "$(sc14 tests/ password_assignment 2000)")" pass
  variant14 "D1 vii-bound max_count 2001" "$(doc14 "$(sc14 tests/ password_assignment 2001)")" "allowlist_invalid" "max_count"
  variant14 "D1 max_count 0" "$(doc14 "$(sc14 tests/ password_assignment 0)")" "allowlist_invalid"
  variant14 "D1 max_count a string" "$(doc14 "$(sc14 tests/ password_assignment '"5"')")" "allowlist_invalid"
  variant14 "D1 max_count 1.5" "$(doc14 "$(sc14 tests/ password_assignment 1.5)")" "allowlist_invalid"
  # uniqueness, unknown names and keys
  variant14 "D1 duplicate (prefix, pattern)" "$(doc14 "$ok2,$ok2")" "allowlist_invalid" "duplicate"
  variant14 "D1 same prefix, two patterns is valid" "$(doc14 "$ok2,$(sc14 tests/ secret_assignment 5)")" pass
  variant14 "D1 unknown pattern name" "$(doc14 "$(sc14 tests/ no_such_pattern 5)")" "allowlist_invalid"
  variant14 "D1 unknown key in a scope" "$(doc14 "${ok2%\}},\"extra\":1}")" "allowlist_invalid"
  variant14 "D1 empty reason" "$(doc14 "${ok2/\"reason\":\"fixture\"/\"reason\":\"\"}")" "allowlist_invalid"
  REV14=mallory; local sbad; sbad="$(sc14 tests/ password_assignment 5)"; unset REV14
  variant14 "D1 scope reviewed_by differs from owner" "$(doc14 "$sbad")" "allowlist_invalid/allowlist_owner_mismatch"
  variant14 "D1 owner differs from the permit record" "$(doc14 "$ok2" '' mallory)" "allowlist_invalid/allowlist_owner_mismatch"
}

# ---------- D1b: cap of 32 scopes, separate constant ----------
# Mutation: raise or drop the scope cap (33 arm); reuse ALLOWLIST_MAX_ENTRIES (the literal arm below).
caseD1b() {
  new14
  local i s32="" s33
  for i in $(seq -w 1 33); do mkdir -p "$R14/q$i"; printf 'x\n' > "$R14/q$i/f.txt"; done
  c14 "33 dirs"; push14
  for i in $(seq -w 1 32); do s32="${s32}$(sc14 "q$i/" password_assignment 1),"; done
  s33="${s32}$(sc14 q33/ password_assignment 1)"; s32="${s32%,}"
  variant14 "D1b 32 scopes are valid" "$(doc14 "$s32")" pass
  variant14 "D1b 33 scopes → invalid" "$(doc14 "$s33")" "allowlist_invalid" "more than 32 scopes"
  local lit; lit="$(node -e 'const X = require(process.argv[1] + "/_shared/lib/xprov.cjs"); process.stdout.write([X.ALLOWLIST_MAX_SCOPES, X.ALLOWLIST_SCOPE_MAX_COUNT, X.ALLOWLIST_MAX_ENTRIES].join("/"))' "$TREE")"
  assert_eq "D1b constants: scope cap 32, scope max_count bound 2000, entry cap 32 (literals, never computed)" "$lit" "32/2000/32"
  local ref; ref="$(grep -c 'ALLOWLIST_MAX_ENTRIES' "$REPO_ROOT/_shared/lib/xprov-allowlist.cjs")"
  assert_eq "D1b the scope cap does not reuse ALLOWLIST_MAX_ENTRIES by reference (one use, the entries cap)" "$ref" "1"
}

# ---------- D1c (x): a v2 blob needs its own approval (FR-022) ----------
# Mutation: skip the approval lookup (already part 08 R30j); here: approve by anything but the blob sha.
caseD1c() {
  new14
  local v1; v1="$(printf '{"version":1,"owner":"robert","entries":[]}\n')"
  al14 "$v1"
  local v1sha="$BLOB14"
  git -C "$R14" checkout -q main; al14 "$(doc14 "$(sc14 tests/ password_assignment 5)")" 0
  # the store still holds only the v1 blob's sha
  mkdir -p "$HOME/.a1-xprov"; chmod 700 "$HOME/.a1-xprov"
  node -e 'const [f, k, s] = process.argv.slice(1); require("fs").writeFileSync(f, JSON.stringify({ version: 1, repos: { [k]: [s] } }) + "\n");' "$HOME/.a1-xprov/$STORE14" "$(cd "$R14" && cd "$(git rev-parse --git-common-dir)" && pwd -P)" "$v1sha"
  chmod 600 "$HOME/.a1-xprov/$STORE14"
  feat14; printf '// f\n' >> "$R14/src/add.js"; c14 "feature"
  snap14 feat
  expect14 "D1c x a v2 blob whose sha is not approved (the v1 blob is)" "allowlist_invalid/allowlist_unapproved"
  git -C "$R14" checkout -q main; store14
  feat14; printf '// g\n' >> "$R14/src/add.js"; c14 "feature 2"
  snap14 feat
  pass14 "D1c x after approving the v2 blob's own sha"
}

# ---------- D3: scopes applied to unchanged lines only (FR-020, FR-021, FR-023) ----------
# scen14 <scopes-json> [entries-json] — main holds tests/fix.txt (five lines, the 2nd and 4th match
# password_assignment) and the allowlist; branch feat is checked out, ready for the feature commit.
scen14() {
  new14
  printf 'alpha\n%s\nbeta\n%s\ngamma\n' "$(pwline14 fixtureval01)" "$(pwline14 fixtureval02)" > "$R14/tests/fix.txt"
  c14 "fixture file"; push14
  al14 "$(doc14 "$1" "${2:-}")"
  feat14
}
J14() { json_get "$S_OUT" "$1"; }
# hits14 — "<prefix>|<pattern>|<count>[|<side>]" of every scoped hit, joined by ','
hits14() { J14 "j.scoped_hits.map((h) => [h.prefix, h.pattern, h.count].concat(h.side ? [h.side] : []).join('|')).join(',')"; }
unc14() { J14 "j.scoped_uncovered.map((h) => [h.prefix, h.pattern, h.count, h.reason].concat(h.side ? [h.side] : []).join('|')).join(',')"; }
noval14() { [[ "$S_OUT$S_ERR" != *fixtureval* ]] && ok "$1: no matched value in the result or on stderr" || bad "$1: a matched value leaked into the output"; }
fp14() { printf '%s' "$1" > "$A14/fp.txt"; sha256_of "$A14/fp.txt"; }

caseD3() {
  local sc; sc="$(sc14 tests/ password_assignment 5)"
  # (i) a scope covers a pre-existing fixture hit
  scen14 "$sc"; printf '// f\n' >> "$R14/src/add.js"; c14 "feature"; snap14 feat
  pass14 "D3 i scope covers two pre-existing hits"
  assert_eq "D3 i scoped_hits lists (prefix, pattern, count)" "$(hits14)" "tests/|password_assignment|2"
  assert_eq "D3 i nothing scope-eligible is left uncovered" "$(unc14)" ""
  assert_eq "D3 i allowlisted_hits counts the scoped matches" "$(J14 j.allowlisted_hits)" "2"
  noval14 "D3 i"
  # a nearby edit, an insertion above (line numbers shift), a deletion above: still unchanged lines
  scen14 "$sc"; sed -i.bak 's/^alpha$/alpha2/' "$R14/tests/fix.txt"; rm -f "$R14/tests/fix.txt.bak"; c14 "edit line 1"; snap14 feat
  pass14 "D3 i-b an edit on an unrelated line of the same file"
  scen14 "$sc"; { printf 'zero\n'; cat "$R14/tests/fix.txt"; } > "$A14/t"; cp "$A14/t" "$R14/tests/fix.txt"; c14 "insert on top"; snap14 feat
  pass14 "D3 i-c a line inserted above shifts the hits down, they stay unchanged"
  scen14 "$sc"; sed -i.bak '3d' "$R14/tests/fix.txt"; rm -f "$R14/tests/fix.txt.bak"; c14 "delete line 3"; snap14 feat
  pass14 "D3 i-d a deleted line above (deleted-only hunk)"
  # (ii) the same hit on a line the reviewed range adds or rewrites
  scen14 "$sc"; pwline14 fixtureval03 >> "$R14/tests/fix.txt"; printf '\n' >> "$R14/tests/fix.txt"; c14 "add a hit"; snap14 feat
  expect14 "D3 ii the same pattern on an ADDED line" "secret_in_snapshot"
  assert_eq "D3 ii the two old hits stay scope-covered" "$(hits14)" "tests/|password_assignment|2"
  assert_eq "D3 ii the added one is reported as changed_line, count only" "$(unc14)" "tests/|password_assignment|1|changed_line"
  assert_eq "D3 ii the uncovered pair names path and pattern" "$(J14 "j.uncovered.map((u) => u.path + '|' + u.pattern).join(',')")" "tests/fix.txt|password_assignment"
  noval14 "D3 ii"
  scen14 "$sc"; sed -i.bak 's/fixtureval01/fixtureval99/' "$R14/tests/fix.txt"; rm -f "$R14/tests/fix.txt.bak"; c14 "rewrite a hit"; snap14 feat
  expect14 "D3 ii-b a covered line REWRITTEN (value changed)" "secret_in_snapshot"
  assert_eq "D3 ii-b one scope hit left, one changed" "$(hits14) $(unc14)" "tests/|password_assignment|1 tests/|password_assignment|1|changed_line"
  scen14 "$sc"; printf '%s\n' "$(pwline14 fixtureval05)" > "$R14/tests/new.txt"; c14 "new file"; snap14 feat
  expect14 "D3 ii-c a NEW file under the prefix" "secret_in_snapshot"
  scen14 "$sc"; sed -n '2p' "$R14/tests/fix.txt" >> "$R14/tests/fix.txt"; c14 "duplicate a covered line"; snap14 feat
  expect14 "D3 ii-d a covered line DUPLICATED" "secret_in_snapshot"
  # (iii) a renamed or copied file: every line strict
  scen14 "$sc"; git -C "$R14" mv tests/fix.txt tests/moved.txt; c14 "rename"; snap14 feat
  expect14 "D3 iii renamed file, content identical" "secret_in_snapshot"
  assert_eq "D3 iii both hits count as changed_line" "$(unc14)" "tests/|password_assignment|2|changed_line"
  scen14 "$sc"; cp "$R14/tests/fix.txt" "$R14/tests/copy.txt"; c14 "copy"; snap14 feat
  expect14 "D3 iii-b copied file (the copy is new, the original stays covered)" "secret_in_snapshot"
  assert_eq "D3 iii-b original covered, copy strict" "$(hits14) $(unc14)" "tests/|password_assignment|2 tests/|password_assignment|2|changed_line"
  # a changed line with a matching v1 entry takes the v1 path and passes
  local line3; line3="$(pwline14 fixtureval03)"
  scen14 "$sc" "$(printf '{"path":"tests/fix.txt","pattern":"password_assignment","max_count":1,"fingerprints":["%s"],"class":"fixture_fake","reason":"fixture","reviewed_by":"robert","added_on":"2026-10-06"}' "$(fp14 "$line3")")"
  printf '%s\n' "$line3" >> "$R14/tests/fix.txt"; c14 "add the entry-covered line"; snap14 feat
  pass14 "D3 a changed line covered by an exact v1 entry (fingerprint) passes"
  assert_eq "D3 …the two old hits are scoped, the new one allowlisted by the entry" "$(hits14) $(J14 j.allowlisted_hits)" "tests/|password_assignment|2 3"
  # (vii) the count per (prefix, pattern)
  scen14 "$(sc14 tests/ password_assignment 1)"; printf '// f\n' >> "$R14/src/add.js"; c14 "feature"; snap14 feat
  expect14 "D3 vii two scoped hits, max_count 1" "secret_in_snapshot"
  assert_eq "D3 vii the scope is reported with reason max_count and its count" "$(unc14)" "tests/|password_assignment|2|max_count"
  scen14 "$(sc14 tests/ password_assignment 2)"; printf '// f\n' >> "$R14/src/add.js"; c14 "feature"; snap14 feat
  pass14 "D3 vii exactly max_count hits are fine"
  scen14 "$(sc14 tests/ password_assignment 2)"
  git -C "$R14" checkout -q main; mkdir -p "$R14/tests/unit"; printf '%s\n' "$(pwline14 fixtureval07)" > "$R14/tests/unit/y.txt"; c14 "second file"; push14
  al14 "$(doc14 "$(sc14 tests/ password_assignment 2)")"; feat14; printf '// f\n' >> "$R14/src/add.js"; c14 "feature"; snap14 feat
  expect14 "D3 vii the count is per (prefix, pattern) across files (2 + 1 > 2)" "secret_in_snapshot"
  # the most specific scope takes the match: tests/unit/ counts its own, tests/ keeps room
  git -C "$R14" checkout -q main
  al14 "$(doc14 "$(sc14 tests/ password_assignment 2),$(sc14 tests/unit/ password_assignment 1)")"; feat14; printf '// g\n' >> "$R14/src/add.js"; c14 "feature"; snap14 feat
  pass14 "D3 nested scopes: the longest matching prefix counts the match"
  assert_eq "D3 nested scopes: one hit each" "$(hits14)" "tests/|password_assignment|2,tests/unit/|password_assignment|1"
}

# D3b — what a scope never covers or cannot judge: the base side, binary and UTF-16 files, the input side, path names.
caseD3b() {
  local sc; sc="$(sc14 tests/ password_assignment 2)"
  # (ix) base side: the base blob's line changed between the anchor and --base stays strict
  scen14 "$(sc14 tests/ password_assignment 5)"; local w1 w2
  pwline14 fixtureval03 >> "$R14/tests/fix.txt"; printf '\n' >> "$R14/tests/fix.txt"; c14 "wave 1 adds a hit"; w1="$(head14)"
  sed -i.bak '$d' "$R14/tests/fix.txt"; rm -f "$R14/tests/fix.txt.bak"; c14 "wave 2 removes it again"
  # the file now equals the anchor's: the head side is clean; only the base blob carries the changed line
  [[ "$(git -C "$R14" diff --name-only main HEAD -- tests/fix.txt)" == "" ]] && ok "D3 ix fixture: head equals the anchor for tests/fix.txt" || bad "D3 ix fixture: head differs from the anchor"
  snap14 feat --base "$w1"
  expect14 "D3 ix base blob with a hit on a line changed in the base" "secret_in_snapshot"
  assert_eq "D3 ix the failing side is base" "$(J14 j.secret_side)" "base"
  scen14 "$sc"; printf 'delta\n' >> "$R14/tests/fix.txt"; c14 "wave 1 adds a harmless line"; w1="$(head14)"
  sed -i.bak 's/^gamma$/gamma2/' "$R14/tests/fix.txt"; rm -f "$R14/tests/fix.txt.bak"; c14 "wave 2 edits gamma"
  snap14 feat --base "$w1"
  pass14 "D3 ix-b base blob whose hits are on unchanged lines (head and base 2 each, max_count 2 per side)"
  assert_eq "D3 ix-b scoped hits carry their side" "$(hits14)" "tests/|password_assignment|2,tests/|password_assignment|2|base"
  # binary diff: every line changed; the unchanged binary file is covered (control)
  new14
  { printf '%s\n' "$(pwline14 fixtureval08)"; printf '\0\0\0\0'; } > "$R14/tests/bin.dat"; c14 "binary file"; push14
  al14 "$(doc14 "$(sc14 tests/ password_assignment 3)")"; feat14; printf '// f\n' >> "$R14/src/add.js"; c14 "feature"; snap14 feat
  pass14 "D3 binary control: the unchanged binary file's hit is covered (3 hits)"
  printf '\0' >> "$R14/tests/bin.dat"; c14 "touch the binary file"; snap14 feat
  expect14 "D3 binary diff: every line counts as changed" "secret_in_snapshot"
  assert_eq "D3 binary diff: reported as diff_unreadable" "$(unc14)" "tests/|password_assignment|1|diff_unreadable"
  # UTF-16: a match without a determinable line is never scoped
  new14
  node -e 'const fs = require("fs"); fs.writeFileSync(process.argv[1], Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(process.argv[2] + "\n", "utf16le")]));' "$R14/tests/u16.txt" "$(pwline14 fixtureval09)"
  c14 "utf-16 file"; push14; al14 "$(doc14 "$(sc14 tests/ password_assignment 3)")"; feat14; printf '// f\n' >> "$R14/src/add.js"; c14 "feature"; snap14 feat
  expect14 "D3 utf-16 file: an unchanged hit without a line number stays strict" "secret_in_snapshot"
  assert_eq "D3 utf-16 file: reported as no_line" "$(unc14)" "tests/|password_assignment|1|no_line"
  # the input side: a PLAN copy under a scoped prefix is never covered
  new14; al14 "$(doc14 "$(sc14 .a1/ password_assignment 5)")"; feat14; mkdir -p "$R14/.a1/phases/p14"; printf '%s\n' "$(pwline14 fixtureval10)" > "$R14/.a1/phases/p14/PLAN.md"
  printf '// f\n' >> "$R14/src/add.js"; git -C "$R14" add src/add.js; git -C "$R14" commit -qm "feature"
  snap14 feat; pass14 "D3 input control: without --plan nothing matches"
  # the label is the path relative to the primary checkout's REAL path (macOS: /var is a symlink to /private/var)
  snap14 feat --plan "$(cd "$R14" && pwd -P)/.a1/phases/p14/PLAN.md"
  expect14 "D3 input side: the PLAN copy under a scoped prefix is not covered" "secret_in_snapshot"
  assert_eq "D3 input side: the failing side is input" "$(J14 j.secret_side)" "input"
  # a real private-key header also matches the scopable pem_begin: the high-confidence match keeps failing
  new14; printf '%s\n' "${D14}BEGIN RSA PRIVATE KEY${D14}" > "$R14/tests/key.txt"; c14 "key header"; push14
  al14 "$(doc14 "$(sc14 tests/ pem_begin 5)")"; feat14; printf '// f\n' >> "$R14/src/add.js"; c14 "feature"; snap14 feat
  expect14 "D3 a PRIVATE KEY header under a pem_begin scope: private_key_header is never scoped" "secret_in_snapshot"
  assert_eq "D3 …the failing pattern is private_key_header, pem_begin is scope-covered" "$(J14 j.secret_pattern) $(hits14)" "private_key_header tests/|pem_begin|1"
  # path names are never allowlisted
  scen14 "$sc"; : > "$R14/tests/${PWK}=abcdefgh1.txt"; c14 "path name"; snap14 feat
  expect14 "D3 path name that matches a pattern, under a scoped prefix" "secret_in_snapshot"
  assert_eq "D3 path name: side path" "$(J14 j.secret_side)" "path"
}

# D3g — the gate path: result JSON and XREVIEW.md list scoped_hits with counts, never values (FR-023).
caseD3g() {
  scen14 "$(sc14 tests/ password_assignment 5)"
  export HOME="$A14/home"; mkdir -p "$HOME/.codex"; printf '{"fixture":true}\n' > "$HOME/.codex/auth.json"; chmod 600 "$HOME/.codex/auth.json"
  make_home; ln -s "$HOME/.codex/auth.json" "$XHOME/auth.json"; export A1_XPROV_CODEX_HOME="$XHOME"
  git -C "$R14" checkout -q main
  mkdir -p "$R14/.a1/phases/p14"; cp "$CASES/approved.PLAN.md" "$R14/.a1/phases/p14/PLAN.md"
  printf '.a1/phases/p14/XREVIEW.md\n.a1/phases/p14/PLAN-REVIEW-LOG.md\n.a1/phases/p14/xreview/\n.a1/phases/p14/observations.jsonl\n' > "$R14/.gitignore"
  c14 "phase p14"; push14
  feat14; printf '// f\n' >> "$R14/src/add.js"; c14 "feature"
  FAKE_RUNNER_ARGV_FILE="$A14/argv.json" FAKE_RUNNER_CASE=approved fake_runner_env
  G_OUT="$(cd "$R14" && node "$TREE_TOOLS" xprov gate --phase p14 --gate "$GATE_PLAN" --timeout 7 2>"$TMP14/gate-err.txt")"; G_RC=$?
  assert_rc "D3g gate with scoped hits passes" 0 "$G_RC" "$(tail -n 2 "$TMP14/gate-err.txt")"
  assert_json "D3g the gate result lists scoped_hits per (prefix, pattern) with the count" "$G_OUT" "j.scoped_hits.map((h) => h.prefix + '|' + h.pattern + '|' + h.count).join(',') + ' ' + j.allowlisted_hits" "tests/|password_assignment|2 2"
  local xr; xr="$(cat "$R14/.a1/phases/p14/XREVIEW.md" 2>/dev/null)"
  [[ "$xr" == *"tests/ · password_assignment · count 2"* ]] && ok "D3g XREVIEW.md lists the scoped pair with its count" || bad "D3g XREVIEW.md lacks the scoped pair"
  [[ "$xr$G_OUT" != *fixtureval* ]] && ok "D3g no matched value in XREVIEW.md or the result" || bad "D3g a matched value leaked"
  assert_json "D3g the index entry carries allowlisted_hits 2" "$(cat "$R14/.a1/phases/p14/xreview/index.json")" "j[0].allowlisted_hits" "2"
  unset A1_XPROV_CODEX_HOME
}

# ---------- D2u: unit arm for the diff parser (FR-020, plan D.2) ----------
# `git diff --unified=0` text → changed new-side line ranges. Inputs are literal diff texts
# (hunk headers `@@ -a,b +c,d @@` with d = 0, d omitted, deleted-only hunks, CRLF, no trailing
# newline). Mutation: M12 hunk-count verification removed → the count-mismatch arm.
# Red before D.2: the parser is not exported.
caseD2u() {
  local out; out="$(node -e '
    const AL = require(process.argv[1] + "/_shared/lib/xprov-allowlist.cjs");
    const P = AL.parseChangedRanges;
    const H = "diff --git a/f b/f\nindex 1111111..2222222 100644\n--- a/f\n+++ b/f\n";
    const r = (t) => { const x = P(t); return x.ok ? JSON.stringify(x.ranges) : "bad:" + (x.binary ? "binary" : "parse"); };
    const res = {
      basic: r(H + "@@ -2,0 +3,2 @@\n+a\n+b\n@@ -7 +9 @@\n-x\n+y\n"),
      deletedOnly: r(H + "@@ -3,2 +2,0 @@\n-a\n-b\n"),
      dOmitted: r(H + "@@ -4 +5 @@\n-a\n+b\n"),
      newFile: r("diff --git a/f b/f\nnew file mode 100644\nindex 0000000..2222222\n--- /dev/null\n+++ b/f\n@@ -0,0 +1,3 @@\n+a\n+b\n+c\n"),
      crlf: r((H + "@@ -2,0 +3,2 @@ ctx\n+a\n+b\n@@ -7 +9 @@\n-x\n+y\n").replace(/\n/g, "\r\n")),
      noTrailingNewline: r(H + "@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file"),
      empty: r(""),
      modeOnly: r("diff --git a/f b/f\nold mode 100644\nnew mode 100755\n"),
      binary: r("diff --git a/f b/f\nindex 1111111..2222222 100644\nBinary files a/f and b/f differ\n"),
      gitBinary: r("diff --git a/f b/f\nindex 1111111..2222222 100644\nGIT binary patch\nliteral 3\nKcmZQz00001\n\n"),
      badHeader: r(H + "@@ -1 +x @@\n-a\n+b\n"),
      countMismatch: r(H + "@@ -1 +1,2 @@\n-a\n+b\n"),
      longer: r(H + "@@ -1 +1 @@\n-a\n+b\n+c\n"),
      oldLonger: r(H + "@@ -1 +1 @@\n-a\n-c\n+b\n"),
      oldCountMismatch: r(H + "@@ -1,2 +1 @@\n-a\n+b\n"),
      unknownLine: r(H + "@@ -1 +1 @@\n-a\n+b\nwhat\n"),
      twoFiles: r(H + "@@ -1 +1 @@\n-a\n+b\n" + H + "@@ -1 +1 @@\n-a\n+b\n"),
      notIncreasing: r(H + "@@ -5 +5 @@\n-a\n+b\n@@ -2 +2 @@\n-a\n+b\n"),
      contentLooksLikeHeader: r(H + "@@ -1 +1 @@\n---- x\n+@@ -9 +9 @@\n"),
      middleBlank: r(H + "@@ -1 +1 @@\n-a\n\n+b\n"),
      hugeStart: r(H + "@@ -1 +99999999999999999999 @@\n-a\n+b\n"),
    };
    const I = AL.rangesIntersect;
    res.i = [I([[3, 4], [9, 9]], 1, 2), I([[3, 4], [9, 9]], 2, 3), I([[3, 4], [9, 9]], 4, 4), I([[3, 4], [9, 9]], 5, 8), I([[3, 4], [9, 9]], 5, 9), I([[3, 4], [9, 9]], 10, 12), I([], 1, 5), I([[3, 4]], 1, 100)].join(",");
    process.stdout.write(JSON.stringify(res));
  ' "$TREE" 2>&1)"
  assert_json "D2u basic hunks: +3,2 and +9 (d omitted = 1 line)" "$out" "j.basic" "[[3,4],[9,9]]"
  assert_json "D2u deleted-only hunk (+2,0) changes no new-side line" "$out" "j.deletedOnly" "[]"
  assert_json "D2u d omitted means one line" "$out" "j.dOmitted" "[[5,5]]"
  assert_json "D2u a new file: every line" "$out" "j.newFile" "[[1,3]]"
  assert_json "D2u CRLF line endings, function-context suffix" "$out" "j.crlf" "[[3,4],[9,9]]"
  assert_json "D2u no trailing newline, '\\ No newline' markers" "$out" "j.noTrailingNewline" "[[1,1]]"
  assert_json "D2u empty diff text → ok, no ranges" "$out" "j.empty" "[]"
  assert_json "D2u mode-only diff → ok, no ranges" "$out" "j.modeOnly" "[]"
  assert_json "D2u 'Binary files … differ' → binary" "$out" "j.binary" "bad:binary"
  assert_json "D2u 'GIT binary patch' → binary" "$out" "j.gitBinary" "bad:binary"
  assert_json "D2u malformed hunk header → unparseable" "$out" "j.badHeader" "bad:parse"
  assert_json "D2u new-side count differs from the lines → unparseable" "$out" "j.countMismatch" "bad:parse"
  assert_json "D2u more '+' lines than the header says → unparseable" "$out" "j.longer" "bad:parse"
  assert_json "D2u more '-' lines than the header says → unparseable" "$out" "j.oldLonger" "bad:parse"
  assert_json "D2u old-side count differs from the lines → unparseable" "$out" "j.oldCountMismatch" "bad:parse"
  assert_json "D2u unknown line inside a hunk → unparseable" "$out" "j.unknownLine" "bad:parse"
  assert_json "D2u two files in one output → unparseable" "$out" "j.twoFiles" "bad:parse"
  assert_json "D2u hunks out of order → unparseable" "$out" "j.notIncreasing" "bad:parse"
  assert_json "D2u content that looks like a header stays content" "$out" "j.contentLooksLikeHeader" "[[1,1]]"
  assert_json "D2u an empty line in the middle → unparseable" "$out" "j.middleBlank" "bad:parse"
  assert_json "D2u a start beyond the safe integer range → unparseable" "$out" "j.hugeStart" "bad:parse"
  assert_json "D2u range intersection edges" "$out" "j.i" "false,true,true,false,true,false,false,true"
  out="$(node -e '
    const AL = require(process.argv[1] + "/_shared/lib/xprov-allowlist.cjs");
    const R = (t) => { const m = AL.parseRawDiff(t); return m === null ? "null" : [...m.entries()].map(([p, e]) => p + "=" + e.status).join("|"); };
    const a = "1".repeat(40), b = "2".repeat(40);
    const rec = (st, p) => ":100644 100644 " + a + " " + b + " " + st + "\0" + p + "\0";
    process.stdout.write(JSON.stringify({
      ok: R(rec("M", "a b.txt") + rec("A", "ü/ö\"q.txt")),
      empty: R(""),
      garbage: R("not a raw record\0x\0"),
      noPath: R(":100644 100644 " + a + " " + b + " M\0"),
      replacement: R(rec("M", "a�b")),
      dup: R(rec("M", "x") + rec("D", "x")),
      emptyMiddle: R(rec("M", "x") + "\0" + rec("M", "y")),
    }));
  ' "$TREE" 2>&1)"
  assert_json "D2u raw diff: records with spaces, quotes, unicode" "$out" "j.ok" "a b.txt=M|ü/ö\"q.txt=A"
  assert_json "D2u raw diff: empty output = no changed path" "$out" "j.empty" ""
  assert_json "D2u raw diff: garbage → null (every line counts as changed)" "$out" "j.garbage" "null"
  assert_json "D2u raw diff: a record without a path → null" "$out" "j.noPath" "null"
  assert_json "D2u raw diff: a replacement character in a path → null" "$out" "j.replacement" "null"
  assert_json "D2u raw diff: a path listed twice → null" "$out" "j.dup" "null"
  assert_json "D2u raw diff: an empty token in the middle → null" "$out" "j.emptyMiddle" "null"
}

# ---------- D4: propose --scopes and the v2 approve listing (FR-024, FR-022) ----------
# Mutations: M13 print the matched text in the unclassified list (masking arm); M14 one prefix per
# first path segment instead of the longest common directory (lib/auto/ arm). Red before D.4:
# --scopes is an unknown flag and approveListing does not exist.
claude_ancestor14() {
  [[ -n "${CLAUDECODE:-}" || -n "${CLAUDE_PID:-}" ]] && return 0
  local p=$$ c
  while [[ -n "$p" && "$p" -gt 1 ]]; do
    c="$(ps -o comm= -p "$p" 2>/dev/null)"
    [[ "$(basename -- "${c:-x}")" == claude ]] && return 0
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
  done
  return 1
}
NOCLAUDE14=(env)
for v14 in $(env | cut -d= -f1 | grep -E '^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*)$'); do NOCLAUDE14+=(-u "$v14"); done

# prop14 [flags…] — `xprov allowlist propose --commit HEAD …` in R14. Sets P_OUT P_ERR P_RC.
prop14() {
  P_OUT="$(cd "$R14" && node "$TREE_TOOLS" xprov allowlist propose --commit HEAD "$@" 2>"$TMP14/perr.txt")"; P_RC=$?
  P_ERR="$(cat "$TMP14/perr.txt")"
}
casePropose() {
  new14
  mkdir -p "$R14/docs" "$R14/lib/auto" "$R14/tests/unit"
  printf '%s\n' "$(pwline14 '${DB_PASS_VALUE}')" > "$R14/tests/a.txt"
  printf '%s\n' "$(pwline14 changeme123)" > "$R14/tests/b.txt"
  printf '%s\n' "$PWK = z.string().min(8)" > "$R14/tests/c.txt"
  printf '%s\n' "$(pwline14 fixtureval01)" > "$R14/tests/d.txt"
  printf '%s\n' "$(pwline14 fixtureval02)" > "$R14/tests/unit/e.txt"
  printf '%s\n' "id: $FAKE_AK14 // process.env.KEY" > "$R14/tests/k.txt"
  printf '%s\n' "$(pwline14 fixtureval03)" > "$R14/docs/guide.md"
  printf '%s\n' "$(pwline14 fixtureval04)" > "$R14/lib/auto/x.js"; printf '%s\n' "$(pwline14 fixtureval05)" > "$R14/lib/auto/y.js"
  printf '%s\n' "$(pwline14 fixtureval06)" > "$R14/rootfile.txt"
  c14 "matches"
  prop14 --scopes
  assert_rc "D4 propose --scopes → exit 0" 0 "$P_RC" "$P_ERR"
  assert_json "D4 per (prefix, pattern): count and proposed class, sorted by prefix" "$P_OUT" "j.scopes.map((s) => [s.prefix, s.pattern, s.count, s.class].join('|')).join(',')" \
    "docs/|password_assignment|1|doc_example,lib/auto/|password_assignment|2|code_pattern,tests/|password_assignment|5|fixture_fake"
  assert_json "D4 tests/ kinds: env reference, placeholder, code expression, unclassified" "$P_OUT" "JSON.stringify(j.scopes.find((s) => s.prefix === 'tests/').kinds)" '{"env_reference":1,"placeholder":1,"code_expression":1,"unclassified":2}'
  assert_json "D4 the unclassified list is path:line, sorted, with the high-confidence and root-file matches" "$P_OUT" "j.unclassified.map((u) => u.location).join(',')" \
    "docs/guide.md:1,lib/auto/x.js:1,lib/auto/y.js:1,rootfile.txt:1,tests/d.txt:1,tests/k.txt:1,tests/unit/e.txt:1"
  assert_json "D4 every unclassified excerpt is masked (4 characters + length)" "$P_OUT" "j.unclassified.every((u) => /^.{0,4}… \\(\\d+ chars\\)\$/.test(u.excerpt))" "true"
  assert_json "D4 high-confidence matches are not scopable: listed with their count, flagged in the list" "$P_OUT" "j.not_scopable.map((n) => n.pattern + '|' + n.count).join(',') + '/' + j.unclassified.filter((u) => u.high_confidence).length + '/' + j.root_files" "aws_access_key_id|1/1/1"
  [[ "$P_OUT$P_ERR" != *fixtureval* && "$P_OUT$P_ERR" != *"$FAKE_AK14"* ]] && ok "D4 no matched value in stdout or stderr" || bad "D4 a matched value leaked"
  [[ "$P_ERR" == *"tests/d.txt:1"* && "$P_ERR" == *"tests/ "* ]] && ok "D4 stderr carries the human listing" || bad "D4 stderr lacks the listing"
  [[ -z "$(git -C "$R14" status --porcelain)" && ! -e "$R14/$AL14" ]] && ok "D4 nothing written" || bad "D4 propose wrote a file"
  prop14
  assert_json "D4 without --scopes the output is the per-match listing (unchanged)" "$P_OUT" "[Array.isArray(j.matches), j.scopes === undefined].join('/')" "true/true"
  prop14 --scopes --json
  assert_json "D4 --scopes --json is a DRAFT v2 document: no entries, one scope per pair, empty reasons, max_count = count" "$P_OUT" \
    "[j.version, j.owner, j.entries.length, j.scopes.length, j.scopes.every((s) => s.reason === ''), j.scopes.map((s) => s.max_count).join('/')].join(',')" "2,robert,0,3,true,1/2/5"
  local v; v="$(node -e '
    const AL = require(process.argv[1] + "/_shared/lib/xprov-allowlist.cjs");
    const doc = JSON.parse(process.argv[2]);
    const empty = AL.parseAllowlist(JSON.stringify(doc)).ok;
    const filled = AL.parseAllowlist(JSON.stringify({ ...doc, scopes: doc.scopes.map((s) => ({ ...s, reason: "fixture" })) })).ok;
    process.stdout.write(empty + "/" + filled);
  ' "$TREE" "$P_OUT")"
  assert_eq "D4 the draft is refused by the schema until the reasons are filled in, then valid" "$v" "false/true"
}

# The pure listing of the owner approval for a v2 document (the TTY command itself is covered below).
caseApproveListing() {
  local out; out="$(node -e '
    const AP = require(process.argv[1] + "/_shared/lib/xprov-approve.cjs");
    const sc = (prefix, pattern, max) => ({ prefix, pattern, class: "fixture_fake", max_count: max, reason: "r", reviewed_by: "robert", added_on: "2026-10-06" });
    const doc = { version: 2, owner: "robert", entries: [], scopes: [sc("tests/", "password_assignment", 2), sc("lib/", "secret_assignment", 9)] };
    const row = (n) => ({ path: "tests/" + n, pattern: "password_assignment", location: "tests/" + n + ":1:1", excerpt: "pass… (20 chars)", high_confidence: false });
    const l = AP.approveListing(doc, [row("a"), row("b"), row("c")]);
    const v1 = AP.approveListing({ version: 1, owner: "robert", entries: [] }, []);
    process.stdout.write(JSON.stringify({ count: l.count, text: l.lines.join("\n"), prompt: l.prompt, v1count: v1.count, v1prompt: v1.prompt }));
  ' "$TREE" 2>&1)"
  assert_json "D4 approve listing: typed count = entries + scopes (v1: entries)" "$out" "j.count + '/' + j.v1count" "2/0"
  assert_json "D4 approve listing: a v2 prompt names entries and scopes, the v1 prompt is unchanged" "$out" "j.prompt + '/' + j.v1prompt" "Type the number of entries and scopes (2) to approve this blob: /Type the number of entries (0) to approve this blob: "
  assert_json "D4 approve listing: a scope over its max_count at this commit is flagged" "$out" "/scope tests\\/ · password_assignment · max_count 2/.test(j.text) && /observed 3 match\\(es\\) at this commit — exceeds max_count/.test(j.text)" "true"
  assert_json "D4 approve listing: a scope with no match at this commit is stale" "$out" "/scope lib\\/ · secret_assignment · max_count 9/.test(j.text) && /observed 0 match\\(es\\)/.test(j.text)" "true"
}

# The owner approval under a pseudo-TTY: a v2 blob, typed count = entries + scopes (skipped under Claude Code, as part 08).
pty14() {
  local cmd; cmd="$(printf '%q ' "$@")"
  if [[ "$(uname)" == Darwin ]]; then ( sleep 1; [[ -n "${PTY_TYPED:-}" ]] && printf '%s\n' "$PTY_TYPED"; sleep 2 ) | script -q /dev/null "$@" > "$TMP14/pty-out.txt" 2>&1
  else ( sleep 1; [[ -n "${PTY_TYPED:-}" ]] && printf '%s\n' "$PTY_TYPED"; sleep 2 ) | script -qec "$cmd" /dev/null > "$TMP14/pty-out.txt" 2>&1; fi
}
caseApproveTty() {
  if claude_ancestor14; then
    if [[ "${CI:-}" == "true" ]]; then bad "D4 owner approval of a v2 blob under a TTY: SKIP (claude-code ancestor) is not allowed when CI=true"
    else results+=("SKIP (claude-code ancestor)  D4 owner approval of a v2 blob under a TTY (typed count = entries + scopes)"); fi
    return 0
  fi
  new14; al14 "$(doc14 "$(sc14 tests/ password_assignment 5),$(sc14 lib/ secret_assignment 5)")" 0
  local rc
  PTY_TYPED=1 pty14 "${NOCLAUDE14[@]}" node "$TREE_TOOLS" xprov allowlist approve --repo "$R14"; rc=$?
  assert_rc "D4 a v2 blob with 2 scopes: typing 1 (entries only) → exit 2" 2 "$rc"
  [[ ! -e "$HOME/.a1-xprov/$STORE14" ]] && ok "D4 …no store written" || bad "D4 …a store was written"
  PTY_TYPED=2 pty14 "${NOCLAUDE14[@]}" node "$TREE_TOOLS" xprov allowlist approve --repo "$R14"; rc=$?
  assert_rc "D4 typing 2 (entries + scopes) → exit 0" 0 "$rc" "$(tail -n 3 "$TMP14/pty-out.txt")"
  git -C "$R14" show "origin/main:$AL14" > "$A14/blob"
  assert_json "D4 the store holds the v2 blob's sha" "$(cat "$HOME/.a1-xprov/$STORE14")" "Object.values(j.repos)[0].join(',')" "$(sha256_of "$A14/blob")"
}

# ---------- S2 (Samuel SEC-2): git replace objects must not hide a change from the changed-line index ----------
# Mutation: M20 drop --no-replace-objects / the cleaned env from the allowlist's git reads → the arm passes the snapshot.
caseS2() {
  scen14 "$(sc14 tests/ password_assignment 5)"
  printf '%s\n' "$(pwline14 fixtureval20)" >> "$R14/tests/fix.txt"; c14 "add a hit"
  git -C "$R14" replace "$(git -C "$R14" rev-parse 'feat^{tree}')" "$(git -C "$R14" rev-parse 'main^{tree}')"
  snap14 feat
  expect14 "S2 a replace ref makes anchor..commit look empty: the added line is still changed" "secret_in_snapshot"
  assert_eq "S2 …reported as changed_line, the two old hits stay covered" "$(hits14) $(unc14)" "tests/|password_assignment|2 tests/|password_assignment|1|changed_line"
  git -C "$R14" replace -d "$(git -C "$R14" rev-parse 'main^{tree}' | head -n1)" >/dev/null 2>&1
}

# ---------- S8 (Samuel SEC-8): a git read that hangs is bounded and refuses coverage ----------
# Mutation: M21 drop the timeout option from the allowlist's git wrapper → the fake git sleeps the full 5 s and the scope covers.
caseS8() {
  scen14 "$(sc14 tests/ password_assignment 5)"; printf '// f\n' >> "$R14/src/add.js"; c14 "feature"
  local real fb="$TMP14/fakebin"; real="$(command -v git)"; mkdir -p "$fb"
  printf '#!/bin/sh\ncase " $* " in *" --no-abbrev "*) exec sleep 5;; esac\nexec %s "$@"\n' "$real" > "$fb/git"; chmod +x "$fb/git"
  local t0 t1; t0=$SECONDS
  PATH="$fb:$PATH" XPROV_GIT_TIMEOUT_MS=1000 snap14 feat
  t1=$SECONDS
  expect14 "S8 a hanging git diff --raw: no scope covers" "secret_in_snapshot"
  assert_eq "S8 …refused with its own reason" "$(hits14)|$(unc14)" "|tests/|password_assignment|2|git_timeout"
  [[ $((t1 - t0)) -lt 5 ]] && ok "S8 …the run ended before the fake git woke up" || bad "S8: took $((t1 - t0)) s"
  assert_eq "S8 an out-of-range timeout override falls back to the bound" "$(XPROV_GIT_TIMEOUT_MS=99999999 node -e 'process.stdout.write(String(require(process.argv[1] + "/_shared/lib/xprov-allowlist.cjs").gitTimeoutMs()))' "$TREE")" "30000"
}

# ---------- R11 (Reinhard): a repo-configured inter-hunk context must not widen the changed ranges ----------
# Mutation: M22 drop --inter-hunk-context=0 from the diff arguments → the two edits merge and the hits between them look changed.
caseR11() {
  scen14 "$(sc14 tests/ password_assignment 5)"
  git -C "$R14" config diff.interHunkContext 10
  sed -i.bak -e 's/^alpha$/alpha2/' -e 's/^gamma$/gamma2/' "$R14/tests/fix.txt"; rm -f "$R14/tests/fix.txt.bak"; c14 "edit the first and last line"
  snap14 feat
  pass14 "R11 a configured diff.interHunkContext: the two hits between two edits stay covered"
  assert_eq "R11 …both hits scoped" "$(hits14)" "tests/|password_assignment|2"
}

# ---------- S1 (Samuel SEC-1): scanned bytes that differ from the committed blob never get a scope ----------
# Fixture: a UTF-16LE working-tree-encoding attribute re-encodes the file on checkout (the blob stays UTF-8); padding characters whose
# bytes are two newlines each shift the scan's line numbers away from the blob's, and CJK characters whose
# little-endian bytes spell the keyword hide an ADDED line behind an unchanged line number.
# Mutation: M23 never mark a path untrusted → the PoC is covered again.
mk_enc14() { # <variant: base|hit> — 12 lines; line 3 is the hit in variant hit
  node -e '
    const hit = process.argv[2] === "hit";
    const ascii = Buffer.from(process.argv[3] + (process.argv[3].length % 2 ? " " : ""), "latin1");
    let cjk = ""; for (let i = 0; i < ascii.length; i += 2) cjk += String.fromCharCode(ascii[i] | (ascii[i + 1] << 8));
    const lines = ["x", "ਊ".repeat(3), hit ? cjk : "plain"];
    for (let i = 4; i <= 12; i++) lines.push("pad" + i);
    require("fs").writeFileSync(process.argv[1], Buffer.from(lines.join("\n") + "\n", "utf16le")); // the working tree is UTF-16LE; git stores UTF-8
  ' "$R14/tests/enc.txt" "$1" "$(pwline14 fixtureval31)"
}
caseS1() {
  new14
  mk_enc14 base; printf 'tests/enc.txt working-tree-encoding=UTF-16LE\n' > "$R14/.gitattributes"; c14 "encoded fixture"; push14
  al14 "$(doc14 "$(sc14 tests/ password_assignment 5)")"; feat14
  mk_enc14 hit; c14 "add a hit behind shifted line numbers"
  snap14 feat
  expect14 "S1 an added hit hidden by a re-encoded working tree" "secret_in_snapshot"
  assert_eq "S1 …refused as blob_mismatch" "$(hits14)|$(unc14)" "|tests/|password_assignment|1|blob_mismatch"
  # hash only: no attribute of the rewriting kind, but the checkout (eol=crlf) changes the bytes → fail closed
  new14
  printf 'alpha\n%s\nbeta\n' "$(pwline14 fixtureval32)" > "$R14/tests/crlf.txt"; printf 'tests/crlf.txt text eol=crlf\n' > "$R14/.gitattributes"; c14 "crlf fixture"; push14
  al14 "$(doc14 "$(sc14 tests/ password_assignment 5)")"; feat14; printf '// f\n' >> "$R14/src/add.js"; c14 "feature"
  snap14 feat
  expect14 "S1 hash: an unchanged hit in a file the checkout rewrote (eol=crlf)" "secret_in_snapshot"
  assert_eq "S1 hash: …blob_mismatch, not covered" "$(hits14)|$(unc14)" "|tests/|password_assignment|1|blob_mismatch"
  # attribute only: a filter attribute with no driver leaves the bytes equal to the blob → still not covered
  new14
  printf 'alpha\n%s\nbeta\n' "$(pwline14 fixtureval33)" > "$R14/tests/flt.txt"; printf 'tests/flt.txt filter=nodriver\n' > "$R14/.gitattributes"; c14 "filter fixture"; push14
  al14 "$(doc14 "$(sc14 tests/ password_assignment 5)")"; feat14; printf '// f\n' >> "$R14/src/add.js"; c14 "feature"
  snap14 feat
  expect14 "S1 attr: an unchanged hit under a filter attribute" "secret_in_snapshot"
  assert_eq "S1 attr: …blob_mismatch, not covered" "$(hits14)|$(unc14)" "|tests/|password_assignment|1|blob_mismatch"
  # control: a plain file is covered
  scen14 "$(sc14 tests/ password_assignment 5)"; printf '// f\n' >> "$R14/src/add.js"; c14 "feature"; snap14 feat
  pass14 "S1 control: a plain tracked file stays covered"
}
# S1u — the cross-check against the primary checkout's own diff (SEC-2): the id of the scanned blob must be the anchor's / the diff's new id.
caseS1u() {
  scen14 "$(sc14 tests/ password_assignment 5)"; printf '// f\n' >> "$R14/tests/fix.txt"; c14 "edit"
  local anchor; anchor="$(git -C "$R14" rev-parse origin/main)"
  local out; out="$(node -e '
    const AL = require(process.argv[1] + "/_shared/lib/xprov-allowlist.cjs");
    const [root, anchor, feat, fixNew, addSame, wrong] = process.argv.slice(2);
    const idx = AL.changedLines(root, anchor, feat);
    const bad = (m) => [...idx.mismatched(new Map(m))].sort().join(",");
    console.log(JSON.stringify({
      right: bad([["tests/fix.txt", fixNew], ["src/add.js", addSame]]),
      wrongInDiff: bad([["tests/fix.txt", wrong]]),
      wrongOutside: bad([["src/add.js", wrong]]),
      missing: bad([["nope.txt", wrong]]),
    }));
  ' "$TREE" "$R14" "$anchor" "$(head14 feat)" "$(git -C "$R14" rev-parse feat:tests/fix.txt)" "$(git -C "$R14" rev-parse feat:src/add.js)" "$(printf '%040d' 7)")"
  assert_json "S1u right ids: nothing mismatched" "$out" "j.right" ""
  assert_json "S1u a wrong id for a path in the diff" "$out" "j.wrongInDiff" "tests/fix.txt"
  assert_json "S1u a wrong id for a path outside the diff (anchor blob differs)" "$out" "j.wrongOutside" "src/add.js"
  assert_json "S1u a path missing at the anchor" "$out" "j.missing" "nope.txt"
  # the call site: a path the primary checkout's index disputes, one the clone marks untrusted, one unknown, one fine, no trust at all
  out="$(node -e '
    const AL = require(process.argv[1] + "/_shared/lib/xprov-allowlist.cjs");
    const sc = [{ prefix: "tests/", pattern: "password_assignment", max_count: 5 }];
    const m = (path) => ({ path, pattern: "password_assignment" });
    const matches = ["tests/a", "tests/b", "tests/c", "tests/d"].map(m);
    const changed = { mismatched: (map) => new Set([...map.keys()].filter((p) => p === "tests/a")) };
    const trust = { sha: new Map([["tests/a", "1"], ["tests/b", "2"], ["tests/d", "4"]]), untrusted: new Set(["tests/b"]) };
    const ids = (r) => [...r].sort().join(",");
    console.log(JSON.stringify({ mixed: ids(AL.untrustedPaths(sc, matches, changed, trust)), none: ids(AL.untrustedPaths(sc, matches, changed, undefined)), noIndex: ids(AL.untrustedPaths(sc, matches, null, trust)) }));
  ' "$TREE")"
  assert_json "S1u call site: disputed, untrusted and unknown paths are bad, the fine one is not" "$out" "j.mixed" "tests/a,tests/b,tests/c"
  assert_json "S1u call site: without trust every eligible path is bad" "$out" "j.none" "tests/a,tests/b,tests/c,tests/d"
  assert_json "S1u call site: without an index every eligible path is bad" "$out" "j.noIndex" "tests/a,tests/b,tests/c,tests/d"
}

# ---------- S4 (Samuel SEC-4): a tracked blob whose disk bytes differ is scanned as its blob too ----------
# Mutation: M24 skip the blob scan for mismatching paths → both arms pass the snapshot.
caseS4() {
  # UTF-32LE working-tree encoding: the disk bytes interleave NULs, no pattern matches them; the blob (UTF-8) is what leaves
  new14
  node -e 'const t = process.argv[2] + "\n"; const b = Buffer.alloc(t.length * 4); for (let i = 0; i < t.length; i++) b.writeUInt32LE(t.charCodeAt(i), i * 4); require("fs").writeFileSync(process.argv[1], b);' "$R14/tests/u32.txt" "$(pwline14 fixtureval41)"
  printf 'tests/u32.txt working-tree-encoding=UTF-32LE\n' > "$R14/.gitattributes"; c14 "utf-32 fixture"; push14
  snap14 main
  expect14 "S4 a hit that only the blob shows (UTF-32LE on disk)" "secret_in_snapshot"
  assert_eq "S4 …found as password_assignment" "$(J14 j.secret_pattern)" "password_assignment"
  # two paths that fold to one file on a case-insensitive disk: the blob that lost the race is still scanned
  local order
  for order in "Case.txt:case.txt" "case.txt:Case.txt"; do
    new14
    local hit plain; hit="$(printf '%s\n' "$(pwline14 fixtureval42)" | git -C "$R14" hash-object -w --stdin)"; plain="$(printf 'plain\n' | git -C "$R14" hash-object -w --stdin)"
    git -C "$R14" update-index --add --cacheinfo "100644,$hit,tests/${order%%:*}" --cacheinfo "100644,$plain,tests/${order##*:}"
    git -C "$R14" commit -qm "case-colliding paths"; push14
    snap14 main
    expect14 "S4 hit at tests/${order%%:*}, plain at tests/${order##*:}" "secret_in_snapshot"
  done
}

# ---------- S6 (Samuel SEC-6): a PGP private key block is a private key header ----------
# Mutation: M25 revert the regex to `PRIVATE KEY-----` → the PGP arm turns red.
caseS6() {
  local out; out="$(node -e '
    const X = require(process.argv[1] + "/_shared/lib/xprov.cjs"); const d = process.argv[2];
    const hit = (t) => X.SECRET_PATTERNS.filter((p) => new RegExp(p.re.source, p.re.flags.replace("g", "")).test(t)).map((p) => p.name).sort().join(",");
    console.log(JSON.stringify({
      pgp: hit(d + "BEGIN PGP PRIVATE KEY BLOCK" + d), rsa: hit(d + "BEGIN RSA PRIVATE KEY" + d), plain: hit(d + "BEGIN PRIVATE KEY" + d),
      pub: hit(d + "BEGIN PGP PUBLIC KEY BLOCK" + d), cert: hit(d + "BEGIN CERTIFICATE" + d),
    }));
  ' "$TREE" "$D14")"
  assert_json "S6 a PGP private key block is private_key_header" "$out" "j.pgp.includes('private_key_header')" "true"
  assert_json "S6 an RSA private key header still is" "$out" "j.rsa.includes('private_key_header')" "true"
  assert_json "S6 a bare PRIVATE KEY header still is" "$out" "j.plain.includes('private_key_header')" "true"
  assert_json "S6 counter-test: a PGP PUBLIC KEY BLOCK is not" "$out" "j.pub.includes('private_key_header')" "false"
  assert_json "S6 counter-test: a certificate is not" "$out" "j.cert.includes('private_key_header')" "false"
  # review point 13: no source file of this wave carries a literal that the content scan itself reports
  out="$(node -e '
    const fs = require("fs"); const X = require(process.argv[1] + "/_shared/lib/xprov.cjs");
    const hits = [];
    for (const f of ["xprov-approve.cjs", "xprov-allowlist.cjs", "xprov-snapshot.cjs"]) {
      const t = fs.readFileSync(process.argv[1] + "/_shared/lib/" + f, "utf8");
      for (const p of X.SECRET_PATTERNS) if (new RegExp(p.re.source, p.re.flags.replace("g", "")).test(t)) hits.push(f + ":" + p.name);
    }
    console.log(JSON.stringify({ hits: hits.join(",") }));
  ' "$TREE")"
  assert_json "S6 the wave's lib sources contain no secret-shaped literal (pem_begin included)" "$out" "j.hits" ""
}

# ---------- S7 (Samuel SEC-7): terminal output of paths, prefixes and reasons is escaped ----------
# Mutation: M26 make safeText the identity → every arm turns red.
caseS7() {
  new14
  local esc; esc="$(printf '\033')"
  mkdir -p "$R14/lib/${esc}[2Jdir"
  printf '%s\n' "$(pwline14 fixtureval51)" > "$R14/lib/${esc}[2Jdir/f.js"; c14 "a path with an escape sequence"
  prop14 --scopes
  [[ "$P_ERR" != *"$esc"* ]] && ok "S7 propose --scopes: no ESC byte reaches the terminal" || bad "S7 propose --scopes printed an ESC byte"
  [[ "$P_ERR" == *'\u001b[2Jdir'* ]] && ok "S7 propose --scopes: shown as \\u001b" || bad "S7 propose --scopes: escaped form missing: ${P_ERR:0:200}"
  prop14
  [[ "$P_ERR" != *"$esc"* && "$P_ERR" == *'\u001b[2Jdir'* ]] && ok "S7 propose (entries): escaped too" || bad "S7 propose printed an ESC byte or lost the path"
  local out; out="$(node -e '
    const AP = require(process.argv[1] + "/_shared/lib/xprov-approve.cjs");
    const e = String.fromCharCode(27), rlo = String.fromCharCode(0x202e), c1 = String.fromCharCode(0x9b);
    const doc = { version: 2, owner: "robert", entries: [{ path: "a" + e + "[31m.js", pattern: "p", max_count: 1, class: "c", reason: "r" + rlo + "evil" }], scopes: [{ prefix: "tests/" + c1 + "x/", pattern: "p", max_count: 1, class: "c", reason: "line1\nline2" }] };
    console.log(JSON.stringify({ text: AP.approveListing(doc, []).lines.join("|") }));
  ' "$TREE")"
  assert_json "S7 approve listing: no control, C1 or bidi character" "$out" "/[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f\\u202a-\\u202e]/.test(j.text)" "false"
  assert_json "S7 approve listing: escapes are visible, the layout is kept" "$out" "j.text.includes('\\\\u001b[31m.js') && j.text.includes('\\\\u202eevil') && j.text.includes('\\\\u009bx/') && j.text.includes('line1\\\\u000aline2')" "true"
}

for c in ${XPROV14_CASES:-caseD1 caseD1b caseD1c caseD2u caseD3 caseD3b caseD3g casePropose caseApproveListing caseApproveTty caseS2 caseS8 caseR11 caseS1 caseS1u caseS4 caseS6 caseS7}; do "$c"; done
export HOME="$SAVED_HOME_14"
rm -rf "$TMP14"
