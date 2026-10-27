# shellcheck shell=bash
# Part 01 — CLI scaffold, slug rule, exit contract, atomic owner-marked write (spec 021 Wave 1).
# FR-001, FR-007, FR-008, FR-010, FR-014 plus hostile-input rejections (CONVENTIONS).

mk_fixture_repo R1; mk_fixture_vault V1
T1="$V1/project/fixture-slug/dashboard.md"

# ---- FR-001: slug from ROADMAP, one file, path on stdout -------------------------------------------------
before="$(find "$V1" -type f | wc -l | tr -d ' ')"
vault_run "$R1" "$V1" dashboard build
after="$(find "$V1" -type f | wc -l | tr -d ' ')"
expect "01.1 build in a fixture repo exits 0" "0" "$RC"
expect "01.2 stdout is the path of the note" "$T1" "$OUT"
expect "01.3 exactly one new file in the vault (count before $before)" "$((before + 1))" "$after"
[[ -f "$T1" ]] && ok "01.4 project/fixture-slug/dashboard.md exists" || bad "01.4 note missing at $T1"
expect "01.5 no .tmp. sibling remains" "0" "$(find "$V1" -name '*.tmp.*' | wc -l | tr -d ' ')"

vault_run "$R1" "$V1" dashboard build --json
expect "01.6 --json exits 0" "0" "$RC"
expect "01.7 --json is one object with keys ok,path,status,degraded" "degraded,ok,path,status" \
  "$(json_get "$OUT" 'Object.keys(j).sort().join(",")')"
expect "01.8 --json status is written" "written" "$(json_get "$OUT" 'j.status')"
expect "01.9 --json path is the note" "$T1" "$(json_get "$OUT" 'j.path')"
expect "01.10 --json degraded is an array" "true" "$(json_get "$OUT" 'Array.isArray(j.degraded)')"
expect "01.11 --json is exactly one line" "1" "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')"

vault_run "$R1" "$V1" dashboard build fixture-slug
expect "01.12 explicit slug that agrees with ROADMAP exits 0" "0" "$RC"
mk_fixture_vault V1b
vault_run "$R1" "$V1b" dashboard build other-slug
expect "01.13 explicit slug that disagrees with ROADMAP exits 2" "2" "$RC"
expect_has "01.14 mismatch reason names the slug mismatch" "$ERR" "slug mismatch"
expect "01.15 mismatch writes nothing" "0" "$(find "$V1b" -name dashboard.md | wc -l | tr -d ' ')"

# ---- FR-008: frontmatter, banner, determinism ------------------------------------------------------------
mk_fixture_vault V2
harness_run "$R1" "$V2" --clock 2026-10-23T09:00:00.000Z
expect "01.16 harness build exits 0 (status written)" "written" "$(json_get "$OUT" 'j.status')"
N2="$V2/project/fixture-slug/dashboard.md"
h1="$(cksum <"$N2")"
harness_run "$R1" "$V2" --clock 2026-10-23T09:00:00.000Z
h2="$(cksum <"$N2")"
expect "01.17 two builds with the same clock are byte-identical" "$h1" "$h2"
note="$(cat "$N2")"
expect "01.18 frontmatter starts the file" "---" "$(sed -n 1p "$N2")"
expect_count "01.19 type: dashboard (count 1)" 1 "$note" "type: dashboard"
expect_count "01.20 project link (count 1)" 1 "$note" 'project: "[[project/fixture-slug]]"'
expect_count "01.21 generated_by (count 1)" 1 "$note" "generated_by: a1-tools dashboard"
expect_count "01.22 generated from the injected clock (count 1)" 1 "$note" "generated: 2026-10-23T09:00:00.000Z"
head7="$(git -C "$R1" rev-parse --short=7 HEAD)"
expect_count "01.23 source_head is the repo HEAD (count 1)" 1 "$note" "source_head: $head7"
expect_count "01.24 banner line (count 1)" 1 "$note" "> Generated, do not edit; overwritten on every build."
harness_run "$R1" "$V2" --clock 2026-10-24T10:00:00.000Z
expect_count "01.25 a different clock changes generated (count 1)" 1 "$(cat "$N2")" "generated: 2026-10-24T10:00:00.000Z"

# foreign note: hand-written dashboard.md is never overwritten
mk_fixture_vault V3
mkdir -p "$V3/project/fixture-slug"
printf -- '---\ntype: note\n---\n\nmine\n' > "$V3/project/fixture-slug/dashboard.md"
hand="$(cksum <"$V3/project/fixture-slug/dashboard.md")"
vault_run "$R1" "$V3" dashboard build
expect "01.26 hand-written dashboard.md: exit 2" "2" "$RC"
expect_has "01.27 reason is foreign_note" "$ERR" "foreign_note"
expect "01.28 hand-written note is byte-identical" "$hand" "$(cksum <"$V3/project/fixture-slug/dashboard.md")"
expect "01.29 no .tmp. sibling after the refusal" "0" "$(find "$V3" -name '*.tmp.*' | wc -l | tr -d ' ')"
: > "$V3/project/fixture-slug/dashboard.md"
vault_run "$R1" "$V3" dashboard build
expect "01.30 empty dashboard.md counts as foreign: exit 2" "2" "$RC"

# ---- FR-007: atomic write ---------------------------------------------------------------------------------
mk_fixture_vault V4
harness_run "$R1" "$V4" --clock 2026-10-23T09:00:00.000Z
N4="$V4/project/fixture-slug/dashboard.md"
old="$(cksum <"$N4")"
harness_run "$R1" "$V4" --clock 2026-10-25T09:00:00.000Z --fail-rename
expect "01.31 injected rename failure: status error" "error" "$(json_get "$OUT" 'j.status')"
expect "01.32 injected rename failure: exit 2" "2" "$(json_get "$OUT" 'j.exit')"
expect "01.33 old note byte-identical after the failure" "$old" "$(cksum <"$N4")"
expect "01.34 no .tmp. sibling remains after the failure" "0" "$(find "$V4" -name '*.tmp.*' | wc -l | tr -d ' ')"

# ---- FR-010: exit contract --------------------------------------------------------------------------------
mk_fixture_vault V5
OUT="$(cd "$R1" && node "$TOOLS" dashboard build 2>"$WORK/e")"; RC=$?; ERR="$(cat "$WORK/e")"
expect "01.35 A1_VAULT_ROOT unset: exit 2" "2" "$RC"
expect "01.36 A1_VAULT_ROOT unset: one stderr line" "1" "$(printf '%s\n' "$ERR" | wc -l | tr -d ' ')"
expect "01.37 A1_VAULT_ROOT unset: nothing on stdout" "" "$OUT"
vault_run "$R1" "$V5" dashboard build --frobnicate
expect "01.38 unknown flag exits 1" "1" "$RC"
expect_has "01.39 unknown flag prints usage error" "$ERR" "usage error"
vault_run "$R1" "$V5" dashboard build a b
expect "01.40 two positional slugs exit 1" "1" "$RC"
mkdir "$WORK/nogit"
vault_run "$WORK/nogit" "$V5" dashboard build fixture-slug
expect "01.41 cwd outside a git repo exits 2" "2" "$RC"
expect "01.42 cwd outside a git repo writes nothing" "0" "$(find "$V5" -name dashboard.md | wc -l | tr -d ' ')"
vault_run "$R1" "$WORK/no-such-vault" dashboard build
expect "01.43 vault root that does not exist exits 2" "2" "$RC"
expect_lacks "01.44 error output has no stack trace" "$ERR" "    at "

# symlinked target and project dir (exit 2, nothing written)
mk_fixture_vault V6
mkdir -p "$V6/project/fixture-slug" "$WORK/elsewhere"
ln -s "$WORK/elsewhere/x.md" "$V6/project/fixture-slug/dashboard.md"
vault_run "$R1" "$V6" dashboard build
expect "01.45 symlinked dashboard.md exits 2" "2" "$RC"
expect "01.46 nothing written through the symlink" "0" "$(find "$WORK/elsewhere" -type f | wc -l | tr -d ' ')"
mk_fixture_vault V7
ln -s "$WORK/elsewhere" "$V7/project/fixture-slug"
vault_run "$R1" "$V7" dashboard build
expect "01.47 symlinked project/<slug>/ exits 2" "2" "$RC"
expect "01.48 nothing written into the link target" "0" "$(find "$WORK/elsewhere" -type f | wc -l | tr -d ' ')"

# non-writer verdict: skip, exit 0, no file (the gate itself arrives in Wave 3; here the branch is wired)
mk_fixture_vault V8
harness_run "$R1" "$V8" --force-skip
expect "01.49 non-writer verdict: status skipped-non-writer" "skipped-non-writer" "$(json_get "$OUT" 'j.status')"
expect "01.50 non-writer verdict: exit 0" "0" "$(json_get "$OUT" 'j.exit')"
expect "01.51 non-writer verdict: no file" "0" "$(find "$V8" -name dashboard.md | wc -l | tr -d ' ')"
expect "01.52 non-writer verdict: the reason travels in the result" "this host is not the vault writer (fx-writer ≠ other-host)" "$(json_get "$OUT" 'j.message')"
vault_run "$R1" "$V1" dashboard build
expect "01.52b a normal build prints nothing on stderr (count 0 lines)" "" "$ERR"

# ---- FR-014: facade, help, usage list ---------------------------------------------------------------------
vault_run "$R1" "$V5" dashboard
expect "01.53 dashboard without subcommand exits 1" "1" "$RC"
vault_run "$R1" "$V5" dashboard frobnicate
expect "01.54 unknown dashboard subcommand exits 1" "1" "$RC"
help="$(node "$TOOLS" --help 2>&1)"
expect_has "01.55 help lists dashboard build" "$help" "a1-tools dashboard build"
expect_has "01.56 help names the exit codes of dashboard" "$help" "foreign_note"
expect_has "01.57 CLI header comment lists dashboard build" "$(sed -n 1,140p "$TOOLS")" "a1-tools dashboard build"
unk="$(node "$TOOLS" no-such-group 2>&1 >/dev/null | head -1)"
expect_has "01.58 unknown-group usage list names dashboard" "$unk" '"dashboard"'
gl="$(cd "$REPO_ROOT" && node "$TOOLS" gates lint >/dev/null 2>&1; echo $?)"
expect "01.59 gates lint exit code is unchanged (0 before the change)" "0" "$gl"

# ---- hostile input (CONVENTIONS: traversal, injection, oversized) -----------------------------------------
mk_fixture_vault V9
for bad_slug in '../../etc/passwd' '/etc/passwd' '$(touch /tmp/a1-dash-pwn)' '; rm -rf /' '`id`' '<script>'; do
  vault_run "$R1" "$V9" dashboard build "$bad_slug"
  expect "01.60 hostile slug '${bad_slug:0:20}' exits 2" "2" "$RC"
done
big="$(node -e 'process.stdout.write("a".repeat(10001))')"
vault_run "$R1" "$V9" dashboard build "$big"
expect "01.61 10001-char slug exits 2 without crashing" "2" "$RC"
expect "01.62 hostile slugs wrote nothing" "0" "$(find "$V9" -name dashboard.md | wc -l | tr -d ' ')"
[[ ! -e /tmp/a1-dash-pwn ]] && ok "01.63 injection-shaped slug was never executed" || bad "01.63 injection executed"

# ---- Wave 6: --slug alias, short usage errors, vault root from the env alone ------------------------------
# RED before the fix: `--slug` exited 1 with ~141 KB help on stderr; the hint named --slug for a command
# that did not take it; an empty A1_VAULT_ROOT went through peekVaultRoot (git child, other tiers).
mk_fixture_repo NR; mk_fixture_vault NV
rm -f "$NR/docs/product/ROADMAP.md"
vault_run "$NR" "$NV" dashboard build --slug fixture-slug
expect "01.64 roadmap-less repo: --slug <slug> exits 0 (${ERR:0:150})" "0" "$RC"
expect "01.65 --slug writes the note of that slug (count 1)" "1" "$(find "$NV/project/fixture-slug" -name dashboard.md | wc -l | tr -d ' ')"
rm -f "$NV/project/fixture-slug/dashboard.md"
vault_run "$NR" "$NV" dashboard build --slug=fixture-slug
expect "01.66 --slug=<slug> exits 0" "0" "$RC"
rm -f "$NV/project/fixture-slug/dashboard.md"
vault_run "$NR" "$NV" dashboard build fixture-slug
expect "01.67 the positional slug still works" "0" "$RC"
vault_run "$NR" "$NV" dashboard build fixture-slug --slug other-slug
expect "01.68 positional and --slug that disagree exit 1" "1" "$RC"
expect "01.69 the disagreement error is one short line (count 1)" "1" "$(printf '%s\n' "$ERR" | wc -l | tr -d ' ')"
vault_run "$NR" "$NV" dashboard build --slug
expect "01.70 --slug without a value exits 1" "1" "$RC"
vault_run "$NR" "$NV" dashboard build --slug '../../etc'
expect "01.71 hostile --slug exits 2" "2" "$RC"
vault_run "$NR" "$NV" dashboard build --bogus
expect "01.72 unknown flag exits 1" "1" "$RC"
expect "01.73 unknown flag: one stderr line (count 1)" "1" "$(printf '%s\n' "$ERR" | wc -l | tr -d ' ')"
expect "01.74 unknown flag: no help dump (stderr under 400 bytes)" "true" "$([[ "${#ERR}" -lt 400 ]] && echo true || echo false)"
expect_has "01.75 unknown flag: the line names the flag" "$ERR" "unknown flag --bogus"
vault_run "$NR" "$NV" dashboard build
expect "01.76 roadmap-less repo without a slug exits 2" "2" "$RC"
expect_has "01.77 the hint names both ways to pass the slug" "$ERR" "pass <slug> or --slug <slug>"
expect_lacks "01.78 the hint no longer says phases are mirrored" "$ERR" "mirrored"

# vault root: only A1_VAULT_ROOT of the request env; empty is a refusal; no git child process.
mkdir -p "$WORK/gitstub"
printf '#!/bin/sh\ntouch "%s/git-was-called"\nexec "%s" "$@"\n' "$WORK/gitstub" "$(command -v git)" > "$WORK/gitstub/git"
chmod +x "$WORK/gitstub/git"
rm -f "$WORK/gitstub/git-was-called"
OUT="$(cd "$NR" && PATH="$WORK/gitstub:$PATH" A1_VAULT_ROOT="" A1_HOST_ID=fx-writer node "$TOOLS" dashboard build fixture-slug 2>"$WORK/err.vr")"; RC=$?; ERR="$(cat "$WORK/err.vr")"
expect "01.79 empty A1_VAULT_ROOT exits 2" "2" "$RC"
expect_has "01.80 reason is no_vault_root" "$ERR" "no_vault_root"
expect "01.81 the refusal is one stderr line (count 1)" "1" "$(printf '%s\n' "$ERR" | wc -l | tr -d ' ')"
[[ ! -e "$WORK/gitstub/git-was-called" ]] && ok "01.82 no git child process was started" || bad "01.82 a git child process was started"
unset_out="$(cd "$NR" && env -u A1_VAULT_ROOT PATH="$WORK/gitstub:$PATH" A1_HOST_ID=fx-writer node "$TOOLS" dashboard build fixture-slug 2>&1 >/dev/null)"; unset_rc=$?
expect "01.83 unset A1_VAULT_ROOT exits 2 with no_vault_root" "2:true" "$unset_rc:$([[ "$unset_out" == *no_vault_root* ]] && echo true || echo false)"
[[ ! -e "$WORK/gitstub/git-was-called" ]] && ok "01.84 unset root: no git child process either" || bad "01.84 a git child process was started"
