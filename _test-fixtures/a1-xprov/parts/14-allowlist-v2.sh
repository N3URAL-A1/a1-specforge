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
    variant14 "D1 vi prefix '$p'" "$(doc14 "$(sc14 "$p" password_assignment 1)")" "allowlist_invalid" "prefix"
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

for c in ${XPROV14_CASES:-caseD1 caseD1b caseD1c caseD2u}; do "$c"; done
export HOME="$SAVED_HOME_14"
rm -rf "$TMP14"
