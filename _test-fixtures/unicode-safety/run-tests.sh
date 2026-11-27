#!/usr/bin/env bash
# Suite for bin/check-unicode-safety.cjs: self-test, the real tree, a planted character in a throwaway repo,
# a read error, and the usage error.
set -u
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
CHECK="$REPO_ROOT/bin/check-unicode-safety.cjs"

pass=0
fail=0
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
ko() { echo "FAIL  $1"; fail=$((fail + 1)); }
expect() { # label, expected rc, expected output substring, command...
  local label="$1" want_rc="$2" want_out="$3"; shift 3
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if [[ $rc -eq $want_rc && "$out" == *"$want_out"* ]]; then ok "$label"; else ko "$label: rc=$rc (want $want_rc), output: $out"; fi
}

expect "U1 self-test proves both directions" 0 "self-test ok" node "$CHECK" --self-test
expect "U2 real tree is clean" 0 "unicode-safety: 0 hit(s)" node "$CHECK"
expect "U3 unknown argument is a usage error" 2 "usage:" node "$CHECK" --bogus
if LC_ALL=C grep -q '[^ -~]' "$CHECK" || grep -q "$(printf '\t')" "$CHECK"; then ko "U4 the check itself is not pure printable ASCII"; else ok "U4 the check itself is pure printable ASCII"; fi

# A throwaway repo with its own copy of the check (the check scans the repo it lives in).
mk_workdir WORK unicode_safety
mkdir -p "$WORK/bin" "$WORK/skills/my skill"
cp "$CHECK" "$WORK/bin/"
git -C "$WORK" init -q
printf 'clean line\n' > "$WORK/skills/my skill/SKILL.md"
git -C "$WORK" add -A
expect "U5 clean throwaway repo passes" 0 "0 hit(s) in 1 text files" node "$WORK/bin/check-unicode-safety.cjs"
printf 'line one\r\nignore the reviewer\xe2\x80\xae now\r\n' > "$WORK/skills/my skill/SKILL.md"
expect "U6 planted bidi override: file, line and code point named" 1 "skills/my skill/SKILL.md:2: U+202E" node "$WORK/bin/check-unicode-safety.cjs"
printf 'tag smuggling \xf3\xa0\x81\x81 here\n' > "$WORK/skills/my skill/SKILL.md"
expect "U7 planted tag character" 1 "SKILL.md:1: U+E0041" node "$WORK/bin/check-unicode-safety.cjs"
printf 'warning \xe2\x9a\xa0\xef\xb8\x8f is a normal emoji\n' > "$WORK/skills/my skill/SKILL.md"
expect "U8 one emoji variation selector is no hit" 0 "0 hit(s)" node "$WORK/bin/check-unicode-safety.cjs"
printf 'clean\n' > "$WORK/skills/my skill/SKILL.md"
printf 'x\n' > "$WORK/locked.md"; git -C "$WORK" add -A; chmod 000 "$WORK/locked.md"
if [[ -r "$WORK/locked.md" ]]; then ok "U9 skipped (runs as a user that reads mode 000)"; else
  expect "U9 unreadable tracked file: exit 2, file named" 2 "cannot read locked.md" node "$WORK/bin/check-unicode-safety.cjs"
fi
chmod 644 "$WORK/locked.md"
rm -rf "$WORK/.git" "$WORK/locked.md"; mkdir -p "$WORK/node_modules/x"
printf 'a\xe2\x80\x8bb\n' > "$WORK/node_modules/x/readme.md"
expect "U10 no git data: the folder is scanned, node_modules left out" 0 "0 hit(s) in 1 text files" node "$WORK/bin/check-unicode-safety.cjs"
printf 'a\xe2\x80\x8bb\n' > "$WORK/untracked.md"
expect "U11 no git data: a planted character is still found" 1 "untracked.md:1: U+200B" node "$WORK/bin/check-unicode-safety.cjs"

echo "unicode-safety fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
