#!/usr/bin/env bash
# Part 25 — spec 016 Wave 4: the plugin consent hook (hooks/hooks.json, hooks/xprov-consent-hook.sh|.cjs, _shared/lib/xprov-hook-rules.cjs,
# xprov-hook-paths.cjs) and the read-only adjustment of the repo hook (.claude/hooks/xprov-deny-allowlist-approve.sh + xprov-bash-class.cjs).
# FR-004 canonical questions only, no answers field, store and settings-forgery deny, fail closed · FR-005 marker bound to tool_use_id and
# session_id, pending yes only from the real answer · FR-032 read-only commands that name xprov permit|waive or allowlist approve pass.
#
# Fixtures: the payloads are DERIVED from the real owner-session capture (cases/hook-capture/pre.jsonl, post.jsonl, PROVENANCE.meta) by
# fake/hook-payload.cjs: envelope as measured, only question text, header, options, ids and cwd rewritten per case. The canonical question
# text comes from the real `xprov consent question`. The hook runs from a tree COPY (owner-home resolver swapped, plan D-2; rule 4b).
#
# RED proofs: every deny case names the ONE production change that turns it red; the [mutant] arms run that change on a tree copy only.
#   Hook rules (xprov-hook-rules.cjs)     H4a question text [M1] · H4b option label/description [M2] · H4c multiSelect [M3] · H4d extra key [M4]
#                                          H5 two questions [M5] · H6 answers field [M6] · H6b annotations [M7] · H7 header lookalike [M8]
#                                          H8 second asker while pending [M9] · H10 No / free text never a yes [M10] · H11 dismissed answer [M11]
#                                          H12 a Post whose Pre carried answers makes no pending yes [M6]
#   Store guard (xprov-hook-paths.cjs)     S1 store path [M12] · S2 symlink [M13] · S3 upper case [M14] · S4 tilde [M15] · S6 .a1/xprov.json [M16]
#                                          S7 NotebookEdit [M17] · S8 MultiEdit [M18] · S9 sibling directory (allow) [M19]
#   Settings forgery                       F1 added Pre hook [M20] · F2 matcher not AskUserQuestion (allow) [M21] · F3 Post hook (allow) [M22]
#                                          F4 settings.local.json [M23] · F5 disableAllHooks [M24] · F6 unchanged hook (allow) [M25] · F7 fragment [M26]
#   Wave 4 review (Samuel)                 S13 firmlink/inode [M28] · F9 skill/agent frontmatter hook [M29] · F10 foreign hooks.json, own plugin (allow) [M30, M31]
#                                          F11 plugin cache [M32] · F12 a1-specforge disabled [M33] · F13 NotebookEdit [M34]
#   Fail closed                            X1 module missing / X2 no node [M27: the wrapper without `|| exit 2`]
#   Repo hook                              R-deny cases name M0..M13 below; the R-allow cases are red under MOLD (the old behaviour).
# Run on tree copies only (the real owner store is never touched; rule 4b of the plan).

TMP25="$(mktemp -d "${TMPDIR:-/tmp}/a1x25.XXXXXX")"
[[ -n "$TMP25" && -d "$TMP25" ]] || { echo "FAIL  part 25: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
SAVED_HOME_25="$HOME"
export HOME="$TMP25/home"; mkdir -p "$HOME"
ORG25=https://github.com/N3URAL-A1/fixture.git
CAP25="$CASES/hook-capture"
PAY25="$FAKE/hook-payload.cjs"
YES25="Ja, dieses Repo an Codex senden"
NO25="Nein, nichts an Codex senden"

make_tree; T25="$TREE"; T25_TOOLS="$TREE_TOOLS"; cp -R "$REPO_ROOT/hooks" "$T25/hooks"
HT25="$T25"     # the tree (plugin root) the hook runs from; mutant arms point it elsewhere

# ---------- helpers ----------
REPO25="$TMP25/repo"
# prep25 — one fixture repository (fixed path, so scenario subshells and the main shell agree) and an empty owner store
prep25() {
  if [[ ! -d "$REPO25/.git" ]]; then
    mkdir -p "$REPO25"; ( cd "$REPO25" && git init -q && git config user.name f && git config user.email f@example.invalid && git config commit.gpgsign false && printf 'x\n' > a.txt && git add -A && git commit -qm f && git remote add origin "$ORG25" )
  fi
  rm -rf "$HOME/.a1-xprov"
}
prep25 >/dev/null; REPO25="$(cd "$TMP25/repo" && pwd -P)"
cli25() { ( cd "$REPO25" && env -u A1_VAULT_ROOT node "$T25_TOOLS" xprov consent "$@" 2>/dev/null </dev/null ); }
canon25() { cli25 question --kind "${1:-consent}" > "$TMP25/q.json"; }
hookrun25() { H_OUT="$(env -u A1_VAULT_ROOT bash "$1/hooks/xprov-consent-hook.sh" < "$2" 2>"$TMP25/herr.txt")"; H_RC=$?; H_ERR="$(cat "$TMP25/herr.txt")"; }
# ask25 <pre|post> [mutate] [mode] [tool_use] [session] — the capture-derived payload for the canonical question in $TMP25/q.json, run through the hook
ask25() {
  local ev="$1" mu="${2:-none}" mo="${3:-yes}" tu="${4:-toolu_a}" se="${5:-sess_a}"
  node "$PAY25" "$(node -e 'process.stdout.write(JSON.stringify({capture:process.argv[1],event:process.argv[2],qfile:process.argv[3],mutate:process.argv[4],mode:process.argv[5],tool_use:process.argv[6],session:process.argv[7],cwd:process.argv[8]}))' "$CAP25" "$ev" "$TMP25/q.json" "$mu" "$mo" "$tu" "$se" "$REPO25")" > "$TMP25/p.json"
  hookrun25 "$HT25" "$TMP25/p.json"
}
# raw25 <pre|post> — the capture payload itself, byte for byte
raw25() { cp "$CAP25/$([[ "$1" == post ]] && echo post || echo pre).jsonl" "$TMP25/p.json"; hookrun25 "$HT25" "$TMP25/p.json"; }
# inp25 k v [k v ...] — a tool_input object
inp25() { node -e 'const o={}; for (let i=1;i<process.argv.length;i+=2) o[process.argv[i]]=process.argv[i+1]; process.stdout.write(JSON.stringify(o))' "$@"; }
# edit25 <tool> <input json> [cwd] — an Edit/Write/... payload derived from the Pre capture
edit25() {
  node "$PAY25" "$(node -e 'process.stdout.write(JSON.stringify({capture:process.argv[1],event:"pre",tool:process.argv[2],input:JSON.parse(process.argv[3]),tool_use:"toolu_e",session:"sess_e",cwd:process.argv[4]}))' "$CAP25" "$1" "$2" "${3:-$TMP25}")" > "$TMP25/p.json"
  hookrun25 "$HT25" "$TMP25/p.json"
}
dec25() {
  if [[ "$H_RC" -ne 0 ]]; then echo "exit$H_RC"; elif [[ -z "$H_OUT" ]]; then echo allow
  else node -e 'const j=JSON.parse(process.argv[1]).hookSpecificOutput; const m=/\(([a-z_]+)\)/.exec(j.permissionDecisionReason); process.stdout.write(j.permissionDecision+":"+(m?m[1]:"?"))' "$H_OUT"; fi
}
st25() { local o; o="$(cli25 ensure --kind "${1:-consent}")"; json_get "$o" "j.state + '/' + (j.decision || '-')"; }
mutate25() {   # mutate25 <tree> <rel file> <from> <to> — one exact-once replacement
  node -e '
    const fs = require("fs"); const [tree, rel, from, to] = process.argv.slice(1);
    const f = tree + "/" + rel; const s = fs.readFileSync(f, "utf8"); const n = s.split(from).length - 1;
    if (n !== 1) { console.error("mutation needle count " + n + " in " + rel + ": " + from.slice(0, 70)); process.exit(3); }
    fs.writeFileSync(f, s.replace(from, () => to));
  ' "$@" || bad "H harness: mutation failed in $2: $3"
}
# mtree25 <lib file> <from> <to> [<lib file2> <from2> <to2>] — a fresh tree copy (with the hooks) carrying the change(s); sets HT25 and TREE
mtree25() {
  make_tree; cp -R "$REPO_ROOT/hooks" "$TREE/hooks"; mutate25 "$TREE" "_shared/lib/$1" "$2" "$3"
  [[ -n "${4:-}" ]] && mutate25 "$TREE" "_shared/lib/$4" "$5" "$6"
  HT25="$TREE"; T25_TOOLS="$TREE/_shared/a1-tools.cjs"
}
unmtree25() { HT25="$T25"; T25_TOOLS="$T25/_shared/a1-tools.cjs"; }
# red25 <name> <scenario fn> <want> <lib file> <from> <to> [<lib2> <from2> <to2>]
red25() {
  local name="$1" fn="$2" want="$3" got mut
  got="$($fn)"
  [[ "$got" == "$want" ]] || { bad "$name: real tree gave '$got', wanted '$want'"; return 0; }
  mtree25 "${@:4}"; mut="$($fn)"; unmtree25
  [[ "$mut" != "$want" ]] && ok "$name RED [mutant]: with the production change the outcome flips ('$want' -> '$mut')" || bad "$name RED [mutant]: the guard is dead, the mutant still gives '$mut'"
}
RULES25=xprov-hook-rules.cjs
PATHS25=xprov-hook-paths.cjs

# ---------- H: AskUserQuestion (FR-004, FR-005) ----------
sc_h1() { prep25; canon25; ask25 pre; echo "$(dec25)|$(st25)"; }
sc_h4a() { prep25; canon25; ask25 pre byte; echo "$(dec25)|$(st25)"; }
sc_h4b() { prep25; canon25; ask25 pre desc; local a; a="$(dec25)"; ask25 pre label; echo "$a|$(dec25)"; }
sc_h4c() { prep25; canon25; ask25 pre multi; echo "$(dec25)|$(st25)"; }
sc_h4d() { prep25; canon25; ask25 pre extrakey; echo "$(dec25)|$(st25)"; }
sc_h5() { prep25; canon25; ask25 pre two; echo "$(dec25)|$(st25)"; }
sc_h6() { prep25; canon25; ask25 pre answers; echo "$(dec25)|$(st25)"; }
sc_h6b() { prep25; canon25; ask25 pre annotations; echo "$(dec25)|$(st25)"; }
sc_h7() { prep25; canon25; ask25 pre 'header:xprov-Freigabe2'; local a; a="$(dec25)"; ask25 pre 'header:XPROV-freigabe'; echo "$a|$(dec25)|$(st25)"; }
sc_h8() { prep25; canon25; ask25 pre none yes toolu_a >/dev/null; ask25 pre none yes toolu_b sess_b; echo "$(dec25)"; }
# the pending yes: Pre, then Post with the real answer shape, for a given label mode
sc_post() { prep25; canon25; ask25 pre; ask25 post none "$1"; echo "$(dec25)|$(st25)"; }
sc_h10no() { sc_post no; }
sc_h10free() { sc_post "free:vielleicht"; }
sc_h11() { sc_post dismissed; }
sc_h11b() { sc_post "other:x"; }
# H12: the Pre call carried answers (denied, no marker); the Post that follows (its tool_input carries answers by itself) records nothing
sc_h12() { prep25; canon25; ask25 pre answers >/dev/null; ask25 post none yes; echo "$(dec25)|$(st25)"; }

caseH() {
  prep25; canon25
  assert_json "H0 the canonical question comes from the real CLI (header xprov-Freigabe)" "$(cat "$TMP25/q.json")" "j.header + '|' + j.labels[1]" "xprov-Freigabe|$YES25"
  # the capture itself: a non-consent question is not touched
  prep25; raw25 pre; assert_eq "H8a the real captured Pre payload (header Test) passes untouched" "$(dec25)" "allow"
  raw25 post; assert_eq "H8b the real captured Post payload is ignored: exit 0, no output" "$(dec25)|$H_ERR" "allow|"
  assert_eq "H8c the capture left no marker" "$(st25)" "none/-"
  [[ ! -e "$HOME/.a1-xprov/consent-audit.jsonl" ]] && ok "H8c ... and no audit line" || bad "H8c the capture wrote an audit line"
  assert_eq "H1 canonical consent question: allowed, marker pending" "$(sc_h1)" "allow|pending/-"
  ask25 post none yes
  assert_eq "H2 Post with the real answer shape records the pending yes (state answered, decision yes)" "$(dec25)|$(st25)" "allow|answered/yes"
  local rec; rec="$(cli25 record --kind consent)"
  assert_json "H3 consent record turns the hook-written marker into a permit (end to end)" "$rec" "j.ok + '|' + j.state + '|' + j.decision" "true|permitted|yes"
  assert_eq "H4a one byte more in the question text: denied, no marker" "$(sc_h4a)" "deny:consent_non_canonical|none/-"
  assert_eq "H4b option description or label changed: denied" "$(sc_h4b)" "deny:consent_non_canonical|deny:consent_non_canonical"
  assert_eq "H4c multiSelect true: denied" "$(sc_h4c)" "deny:consent_non_canonical|none/-"
  assert_eq "H4d an extra key in the question object: denied" "$(sc_h4d)" "deny:consent_non_canonical|none/-"
  assert_eq "H5 two questions in one call: denied" "$(sc_h5)" "deny:consent_multiple_questions|none/-"
  assert_eq "H6 a model-supplied answers field: denied before the call, no marker" "$(sc_h6)" "deny:consent_answers|none/-"
  assert_eq "H6b an annotations field: denied" "$(sc_h6b)" "deny:consent_answers|none/-"
  assert_eq "H7 header lookalikes (xprov-Freigabe2, XPROV-freigabe): denied, no marker" "$(sc_h7)" "deny:consent_non_canonical|deny:consent_non_canonical|none/-"
  assert_eq "H8 a second asker while the question is open: denied (poll consent ensure)" "$(sc_h8)" "deny:marker_pending"
  assert_eq "H10a Post with the No label: recorded as no, never a yes" "$(sc_h10no)" "allow|answered/no"
  assert_eq "H10b Post with free text: recorded as no" "$(sc_h10free)" "allow|answered/no"
  assert_eq "H11 Post without an answer (dismissed): nothing recorded, the marker stays pending" "$(sc_h11)" "allow|pending/-"
  assert_eq "H11b Post whose answer belongs to another question: nothing recorded" "$(sc_h11b)" "allow|pending/-"
  assert_eq "H12 a Post for a call whose Pre carried answers: no pending yes (its own tool_input carries answers, capture fact 3)" "$(sc_h12)" "allow|none/-"
  prep25; canon25; ask25 pre; ask25 post none yes toolu_other
  assert_eq "H13 Post of another tool_use_id: ignored, the marker stays pending" "$(dec25)|$(st25)" "allow|pending/-"
  ask25 post none yes toolu_a sess_other
  assert_eq "H13b Post of another session_id: ignored" "$(dec25)|$(st25)" "allow|pending/-"
  ask25 post byte yes
  assert_eq "H14 Post whose answered question text differs from the Pre question: refused (exit 2), marker still pending" "$H_RC|$(st25)" "2|pending/-"
  # hostile
  prep25; canon25
  ask25 pre "text:Soll ich; rm -rf / \$(touch $TMP25/pwned) das senden?"; local r="$(dec25)"
  [[ "$r" == "deny:consent_unresolvable" && ! -e "$TMP25/pwned" ]] && ok "H15 an injection-shaped question text: denied, nothing executed" || bad "H15 injection-shaped question gave '$r' (pwned: $([[ -e "$TMP25/pwned" ]] && echo yes || echo no))"
  ask25 pre "header:$(printf 'xprov-%.0s' $(seq 1 2000))"; r="$(dec25)"
  [[ "$r" == "deny:consent_non_canonical" ]] && ok "H16 a 10 000 character xprov-header: denied" || bad "H16 oversize header gave '$r'"
  ask25 pre "text:$(printf 'Z%.0s' $(seq 1 10000))"; r="$(dec25)"
  [[ "$r" == "deny:consent_unresolvable" ]] && ok "H17 a 10 000 character question text: denied (no Pfad line)" || bad "H17 oversize question text gave '$r'"
  printf '{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","tool_use_id":"t","session_id":"s","tool_input":{"questions":[{"header":"xprov-Freigabe","question":"Pfad: /etc","options":[],"multiSelect":false}]}}' > "$TMP25/p.json"; hookrun25 "$HT25" "$TMP25/p.json"
  assert_eq "H18 a question whose Pfad line is not a git repository: denied" "$(dec25)" "deny:consent_unresolvable"
  # classification without a record named in the text cannot be canonical
  node -e 'const q=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); q.header="xprov-Einstufung"; q.question=q.question.replace(/^/, "Einstufung\nLegal-Entscheidung (Vault-Pfad): keine angegeben\n"); require("fs").writeFileSync(process.argv[1], JSON.stringify(q));' "$TMP25/q.json"
  ask25 pre; assert_eq "H19 a classification question without a named a1-ludwig-legal record: denied" "$(dec25)" "deny:consent_unresolvable"
}
caseH

caseH_red() {
  red25 "H4a" sc_h4a "deny:consent_non_canonical|none/-" $RULES25 "|| q.question !== canon.question" ""
  red25 "H4b" sc_h4b "deny:consent_non_canonical|deny:consent_non_canonical" $RULES25 "o.label === want[i].label && o.description === want[i].description" "true"
  red25 "H4c" sc_h4c "deny:consent_non_canonical|none/-" $RULES25 "|| q.multiSelect !== false" ""
  red25 "H4d" sc_h4d "deny:consent_non_canonical|none/-" $RULES25 "!sameKeys(q, QUESTION_KEYS) ||" ""
  red25 "H5" sc_h5 "deny:consent_multiple_questions|none/-" $RULES25 "if (qs.length !== 1)" "if (qs.length < 1)"
  red25 "H6" sc_h6 "deny:consent_answers|none/-" $RULES25 "if ('answers' in input ||" "if ("
  red25 "H6b" sc_h6b "deny:consent_answers|none/-" $RULES25 "|| 'annotations' in input" ""
  red25 "H7" sc_h7 "deny:consent_non_canonical|deny:consent_non_canonical|none/-" $RULES25 "|| inNamespace(q.header))" ")" $RULES25 "if (kind === null || q.header !== Q.kindDef(kind).header)" "if (false)"
  red25 "H8" sc_h8 "deny:marker_pending" $RULES25 "if (!r.ok) return deny(r.reason, r.hint);" ""
  red25 "H10a" sc_h10no "allow|answered/no" $RULES25 "label: found.label, question," "label: 'Ja, dieses Repo an Codex senden', question,"
  red25 "H10b" sc_h10free "allow|answered/no" $RULES25 "label: found.label, question," "label: 'Ja, dieses Repo an Codex senden', question,"
  red25 "H11" sc_h11 "allow|pending/-" $RULES25 "if (!found.found) return Object.freeze({ action: 'ignored'" "if (false) return Object.freeze({ action: 'ignored'"
  red25 "H12" sc_h12 "allow|none/-" $RULES25 "if ('answers' in input ||" "if ("
}
caseH_red

# ---------- S: the store path guard (FR-004) ----------
SDIR25="$HOME/.a1-xprov"
sc_edit() { # <tool> <path> [cwd] — Edit of that path
  prep25; mkdir -p "$SDIR25/consent-markers" "$SDIR25/scan-records" "$SDIR25/artifacts/r1"; printf '{}' > "$SDIR25/permits.json"
  edit25 "${1:-Edit}" "$(inp25 file_path "$2" old_string a new_string b)" "${3:-$TMP25}"; dec25
}
sc_s1() { sc_edit Edit "$SDIR25/permits.json"; }
sc_s2() { prep25; mkdir -p "$SDIR25"; printf '{}' > "$SDIR25/permits.json"; rm -rf "$TMP25/ln"; mkdir -p "$TMP25/ln"; ln -s "$SDIR25/permits.json" "$TMP25/ln/innocent.txt"; ln -s "$SDIR25" "$TMP25/ln/dir"
  edit25 Write "$(inp25 file_path "$TMP25/ln/innocent.txt" content x)"; local a; a="$(dec25)"; edit25 Write "$(inp25 file_path "$TMP25/ln/dir/waivers.json" content x)"; echo "$a|$(dec25)"; }
sc_s3() { sc_edit Edit "$HOME/.A1-XPROV/PERMITS.JSON"; }
sc_s4() { sc_edit Edit "~/.a1-xprov/permits.json"; }
sc_s5() { local p n=0 total=0; for p in consent.json consent-markers/0123.json .consent.json.1.ab12.tmp consent-audit.jsonl .consent-audit.lock .consent-audit.lock.deadbeef .consent-audit.lock.takeover/x .consent-audit.lock.stale.7 .owner-store.lock .owner-store.lock.takeover permit-denials.json waivers.json allowlist-approvals.json hit-approvals.json .hit-approvals.json.1.ab.tmp scan-records/snap-1.hits.json scan-records/.snap-1.4.ab.tmp artifacts/r1/result.json artifacts/r1/a1-findings.json artifacts/r1/a1-pass.json artifacts/r1/a1-reviewed.json; do total=$((total + 1)); [[ "$(sc_edit Write "$SDIR25/$p")" == "deny:store_path" ]] && n=$((n + 1)); done; echo "$n/$total"; }
sc_s6() { prep25; mkdir -p "$REPO25/.a1"; edit25 Write "$(inp25 file_path "$REPO25/.a1/xprov.json" content '{}')" "$REPO25"; local a; a="$(dec25)"; edit25 Write "$(inp25 file_path ".a1/xprov.json" content '{}')" "$REPO25"; echo "$a|$(dec25)"; }
sc_s7() { prep25; mkdir -p "$SDIR25"; edit25 NotebookEdit "$(inp25 notebook_path "$SDIR25/permits.json" new_source x)"; dec25; }
sc_s8() { prep25; mkdir -p "$SDIR25"; edit25 MultiEdit "$(inp25 file_path "$SDIR25/permits.json")"; dec25; }
sc_s9() { prep25; mkdir -p "$HOME/.a1-xprov-notes"; edit25 Write "$(inp25 file_path "$HOME/.a1-xprov-notes/x.md" content x)"; local a; a="$(dec25)"; edit25 Edit "$(inp25 file_path "$REPO25/a.txt" old_string x new_string y)" "$REPO25"; echo "$a|$(dec25)"; }
sc_s13() {
  prep25; mkdir -p "$SDIR25" "$HOME/xdir"; printf '{}' > "$SDIR25/permits.json"
  local real; real="$(cd "$HOME" && pwd -P)"; local a b c
  edit25 Write "$(inp25 file_path "/System/Volumes/Data$real/.a1-xprov/permits.json" content x)"; a="$(dec25)"
  edit25 Write "$(inp25 file_path "/System/Volumes/Data$real/missing/../.a1-xprov/permits.json" content x)"; b="$(dec25)"
  edit25 Write "$(inp25 file_path "/System/Volumes/Data$real/xdir/../.a1-xprov/consent-markers/new.json" content x)"; c="$(dec25)"
  echo "$a|$b|$c"
}
sc_s10() { prep25; mkdir -p "$SDIR25"; edit25 Write "$(inp25 file_path "$HOME/nothing/../.a1-xprov/permits.json" content x)"; local a; a="$(dec25)"; edit25 Write "$(inp25 file_path "$HOME/.a1-xprov//permits.json" content x)"; echo "$a|$(dec25)"; }
caseS() {
  assert_eq "S1 Edit of permits.json: denied" "$(sc_s1)" "deny:store_path"
  assert_eq "S2 Write through a symlink to permits.json, and through a symlinked directory: denied" "$(sc_s2)" "deny:store_path|deny:store_path"
  assert_eq "S3 upper-case path (APFS is case-insensitive): denied" "$(sc_s3)" "deny:store_path"
  assert_eq "S4 tilde form: denied" "$(sc_s4)" "deny:store_path"
  assert_eq "S5 every store file, lock, tmp and run-dir form: denied (21 of 21)" "$(sc_s5)" "21/21"
  assert_eq "S6 .a1/xprov.json absolute and relative to the payload cwd: denied" "$(sc_s6)" "deny:store_path|deny:store_path"
  assert_eq "S7 NotebookEdit of a store file: denied" "$(sc_s7)" "deny:store_path"
  assert_eq "S8 MultiEdit of a store file: denied" "$(sc_s8)" "deny:store_path"
  assert_eq "S9 a sibling directory .a1-xprov-notes and an ordinary repo file: allowed" "$(sc_s9)" "allow|allow"
  assert_eq "S10 a .. detour and a double slash into the store: denied" "$(sc_s10)" "deny:store_path|deny:store_path"
  edit25 Write "$(inp25 file_path '/tmp/$(touch pwned2); x' content x)"
  [[ "$(dec25)" == "allow" && ! -e "$TMP25/pwned2" && ! -e "pwned2" ]] && ok "S11 an injection-shaped file path is data: allowed as a path, nothing executed" || bad "S11 injection-shaped path gave '$(dec25)'"
  edit25 Write "$(inp25 file_path "$SDIR25/$(printf 'a%.0s' $(seq 1 10000))" content x)"
  assert_eq "S12 a 10 000 character file name inside the store: denied" "$(dec25)" "deny:store_path"
  if [[ -d "/System/Volumes/Data" && "$(uname)" == Darwin ]]; then
    assert_eq "S13 firmlink forms of the store (/System/Volumes/Data/<path>, with a missing and an existing .. detour): denied" "$(sc_s13)" "deny:store_path|deny:store_path|deny:store_path"
    red25 "S13" sc_s13 "deny:store_path|deny:store_path|deny:store_path" $PATHS25 "if (sameInodeUnder(raw, ids))" "if (false)"
  else
    ok "S13 skipped: no firmlink on this platform (macOS-only case; the inode layer is the same code path)"
  fi
  # the string layer and the inode layer each catch a plain store path: S1 turns red only with BOTH off
  red25 "S1" sc_s1 "deny:store_path" $PATHS25 "if (roots.some((r) => isUnder(f, r)))" "if (false)" $PATHS25 "if (sameInodeUnder(raw, ids))" "if (false)"
  red25 "S2" sc_s2 "deny:store_path|deny:store_path" $PATHS25 "try { return path.join(fs.realpathSync(head), ...tail); }" "try { throw new Error('x'); }"
  # on a case-insensitive file system the inode layer also catches the upper-case path; S3 turns red with both layers off
  red25 "S3" sc_s3 "deny:store_path" $PATHS25 "const fold = (p) => String(p).normalize('NFC').toLowerCase();" "const fold = (p) => String(p).normalize('NFC');" $PATHS25 "if (sameInodeUnder(raw, ids))" "if (false)"
  red25 "S4" sc_s4 "deny:store_path" $PATHS25 "return m ? \`\${home}\${m[1]}\` : p;" "return p;"
  red25 "S6" sc_s6 "deny:store_path|deny:store_path" $PATHS25 "if (path.basename(f) === 'xprov.json' && path.basename(path.dirname(f)) === '.a1') return" "if (false) return"
  red25 "S7" sc_s7 "deny:store_path" $RULES25 "tool === 'NotebookEdit' ? input.notebook_path : input.file_path" "input.file_path"
  red25 "S8" sc_s8 "deny:store_path" $RULES25 "['Edit', 'Write', 'NotebookEdit', 'MultiEdit']" "['Edit', 'Write', 'NotebookEdit']"
  red25 "S9" sc_s9 "allow|allow" $PATHS25 "const isUnder = (p, root) => p === root || p.startsWith(\`\${root}/\`);" "const isUnder = (p, root) => p.startsWith(root);"
}
caseS

# ---------- F: the settings forgery path (R-1) ----------
PROJ25="$TMP25/proj"
settings25() { # <json text> — a settings file on disk
  rm -rf "$PROJ25"; mkdir -p "$PROJ25/.claude"; printf '%s' "$1" > "$PROJ25/.claude/settings.json"
}
HOOK_ASK25='{"hooks":{"PreToolUse":[{"matcher":"AskUserQuestion","hooks":[{"type":"command","command":"x"}]}]}}'
sc_wr() { # <file name under .claude> <content> — Write of a settings file
  prep25; mkdir -p "$PROJ25/.claude"; edit25 Write "$(inp25 file_path "$PROJ25/.claude/$1" content "$2")" "$PROJ25"; dec25
}
sc_f1() { local a b c d; a="$(sc_wr settings.json "$HOOK_ASK25")"; b="$(sc_wr settings.json '{"hooks":{"PreToolUse":[{"matcher":"","hooks":[{"type":"command","command":"x"}]}]}}')"
  c="$(sc_wr settings.json '{"hooks":{"PreToolUse":[{"matcher":".*","hooks":[{"type":"command","command":"x"}]}]}}')"; d="$(sc_wr settings.json '{"hooks":{"PermissionRequest":[{"matcher":"Ask.*","hooks":[{"type":"command","command":"x"}]}]}}')"; echo "$a|$b|$c|$d"; }
sc_f1b() { settings25 '{"permissions":{"allow":[]}}'; edit25 Edit "$(inp25 file_path "$PROJ25/.claude/settings.json" old_string '"allow":[]' new_string '"allow":[]},"hooks":{"PreToolUse":[{"matcher":"AskUserQuestion","hooks":[{"type":"command","command":"x"}]}]')" "$PROJ25"; dec25; }
sc_f2() { sc_wr settings.json '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"x"}]}]},"permissions":{"allow":["Read"]}}'; }
sc_f3() { sc_wr settings.json '{"hooks":{"PostToolUse":[{"matcher":"AskUserQuestion","hooks":[{"type":"command","command":"log"}]}]}}'; }
sc_f4() { local a b; a="$(sc_wr settings.local.json "$HOOK_ASK25")"; b="$(sc_wr SETTINGS.JSON "$HOOK_ASK25")"; echo "$a|$b"; }
sc_f4b() { prep25; mkdir -p "$HOME/.claude"; edit25 Write "$(inp25 file_path "~/.claude/settings.json" content "$HOOK_ASK25")" "$TMP25"; dec25; }
sc_f5() { sc_wr settings.json '{"disableAllHooks":true}'; }
sc_f6() { settings25 "$HOOK_ASK25"; edit25 Write "$(inp25 file_path "$PROJ25/.claude/settings.json" content '{"hooks":{"PreToolUse":[{"matcher":"AskUserQuestion","hooks":[{"type":"command","command":"x"}]}]},"model":"opus"}')" "$PROJ25"; dec25; }
sc_f7() { settings25 '{ broken'; edit25 Edit "$(inp25 file_path "$PROJ25/.claude/settings.json" old_string 'broken' new_string '"hooks": { "PreToolUse": [ { "matcher": "Ask" }')" "$PROJ25"; dec25; }
sc_f8() { prep25; edit25 Write "$(inp25 file_path "$PROJ25/not-settings.json" content "$HOOK_ASK25")" "$PROJ25"; dec25; }
caseF() {
  assert_eq "F1 Write of a settings file that adds a PreToolUse/PermissionRequest hook matching AskUserQuestion (name, empty, .*, Ask.*): denied" "$(sc_f1)" "deny:settings_forgery|deny:settings_forgery|deny:settings_forgery|deny:settings_forgery"
  assert_eq "F1b the same through an Edit that adds the hook to an existing file: denied" "$(sc_f1b)" "deny:settings_forgery"
  assert_eq "F2 a settings write whose hook matches Bash only: allowed" "$(sc_f2)" "allow"
  assert_eq "F3 a PostToolUse AskUserQuestion logger: allowed (it cannot answer)" "$(sc_f3)" "allow"
  assert_eq "F4 settings.local.json and SETTINGS.JSON: denied" "$(sc_f4)" "deny:settings_forgery|deny:settings_forgery"
  assert_eq "F4b ~/.claude/settings.json (tilde): denied" "$(sc_f4b)" "deny:settings_forgery"
  assert_eq "F5 disableAllHooks true (would switch the consent hook off): denied" "$(sc_f5)" "deny:settings_forgery"
  assert_eq "F6 a file that already holds the hook, edited elsewhere: allowed (nothing is added)" "$(sc_f6)" "allow"
  assert_eq "F7 an Edit that leaves unreadable JSON and names a hook matcher: denied" "$(sc_f7)" "deny:settings_forgery"
  assert_eq "F8 a json file that is not a settings file: allowed" "$(sc_f8)" "allow"
  red25 "F1" sc_f1 "deny:settings_forgery|deny:settings_forgery|deny:settings_forgery|deny:settings_forgery" $PATHS25 "askHooksOf(newDoc).some((h) => !seen.has(h))" "false"
  red25 "F1b" sc_f1b "deny:settings_forgery" $PATHS25 "const next = newContent(tool, input && typeof input === 'object' ? input : {}, old);
  const newDoc = parseJson(next.text);" "const next = { text: null, fragment: '' };
  const newDoc = parseJson(next.text);"
  red25 "F2" sc_f2 "allow" $PATHS25 "function matcherHitsAsk(matcher) {" "function matcherHitsAsk(matcher) { return true;"
  red25 "F3" sc_f3 "allow" $PATHS25 "const PRE_EVENTS = Object.freeze(['pretooluse', 'permissionrequest']);" "const PRE_EVENTS = Object.freeze(['pretooluse', 'permissionrequest', 'posttooluse']);"
  red25 "F4" sc_f4 "deny:settings_forgery|deny:settings_forgery" $PATHS25 "const SETTINGS_FILE_RE = /^settings[^/]*\\.json\$/;" "const SETTINGS_FILE_RE = /^settings\\.json\$/;"
  red25 "F5" sc_f5 "deny:settings_forgery" $PATHS25 "if (newDoc.disableAllHooks === true && oldDoc.disableAllHooks !== true)" "if (false)"
  red25 "F6" sc_f6 "allow" $PATHS25 "askHooksOf(newDoc).some((h) => !seen.has(h))" "askHooksOf(newDoc).some((h) => true)"
  red25 "F7" sc_f7 "deny:settings_forgery" $PATHS25 "const hit = TEXT_ASK_RE.test(next.fragment) || TEXT_DISABLE_RE.test(next.fragment) || /\"matcher\"/i.test(next.fragment) || TEXT_PLUGIN_OFF_RE.test(next.fragment);" "const hit = false;"
}
caseF

# Samuel W4 SEC-3/SEC-5: other places a hook can come from
FM25='---
name: x
hooks:
  PreToolUse:
    - matcher: "AskUserQuestion"
      hooks:
        - type: command
          command: x
---
body'
sc_fm() { # <relative path> <content> — Write below the project dir
  prep25; mkdir -p "$PROJ25/$(dirname "$1")"; edit25 Write "$(inp25 file_path "$PROJ25/$1" content "$2")" "$PROJ25"; dec25
}
sc_f9() { local a b; a="$(sc_fm .claude/skills/x/SKILL.md "$FM25")"; b="$(sc_fm .claude/agents/y.md "$FM25")"; echo "$a|$b"; }
sc_f9b() { local a b; a="$(sc_fm .claude/skills/x/SKILL.md $'---\nname: x\n---\nbody')"; b="$(sc_fm skills/z/SKILL.md $'---\nname: z\nhooks:\n  PostToolUse:\n    - matcher: Bash\n---\nb')"; echo "$a|$b"; }
sc_f10() { rm -rf "$PROJ25"; mkdir -p "$PROJ25/foreign/hooks" "$PROJ25/own/hooks" "$PROJ25/own/.claude-plugin"; printf '{"name":"a1-specforge"}' > "$PROJ25/own/.claude-plugin/plugin.json"
  prep25; edit25 Write "$(inp25 file_path "$PROJ25/foreign/hooks/hooks.json" content '{}')" "$PROJ25"; local a; a="$(dec25)"
  edit25 Write "$(inp25 file_path "$PROJ25/own/hooks/hooks.json" content '{}')" "$PROJ25"; echo "$a|$(dec25)"; }
sc_f11() { prep25; mkdir -p "$HOME/.claude/plugins/cache/n3ural/a1-specforge/1.0"; edit25 Write "$(inp25 file_path "$HOME/.claude/plugins/cache/n3ural/a1-specforge/1.0/_shared/x.cjs" content x)"; dec25; }
sc_f12() { local a b; a="$(sc_wr settings.json '{"enabledPlugins":{"a1-specforge@a1-specforge":false}}')"; b="$(sc_wr settings.json '{"enabledPlugins":{"a1-specforge@a1-specforge":true}}')"; echo "$a|$b"; }
sc_f13() { settings25 '{}'; prep25; mkdir -p "$PROJ25/.claude"; printf '{}' > "$PROJ25/.claude/settings.json"; edit25 NotebookEdit "$(inp25 notebook_path "$PROJ25/.claude/settings.json" new_source x)" "$PROJ25"; dec25; }
caseF2() {
  assert_eq "F9 a skill and an agent file whose frontmatter adds a PreToolUse hook matching AskUserQuestion: denied" "$(sc_f9)" "deny:settings_forgery|deny:settings_forgery"
  assert_eq "F9b a skill without hooks, and a PostToolUse-only Bash frontmatter hook: allowed" "$(sc_f9b)" "allow|allow"
  assert_eq "F10 a hooks.json outside this plugin: denied; the hooks.json of a checkout of this plugin: allowed" "$(sc_f10)" "deny:settings_forgery|allow"
  assert_eq "F11 any file under ~/.claude/plugins/cache/**/a1-specforge/: denied" "$(sc_f11)" "deny:settings_forgery"
  assert_eq "F12 settings that disable the a1-specforge plugin: denied; enabling it: allowed" "$(sc_f12)" "deny:settings_forgery|allow"
  assert_eq "F13 NotebookEdit on a settings file: denied" "$(sc_f13)" "deny:settings_forgery"
  red25 "F9" sc_f9 "deny:settings_forgery|deny:settings_forgery" $PATHS25 "return fmSignature(next.text).some((l) => !seen.has(l))" "return false"
  red25 "F9b" sc_f9b "allow|allow" $PATHS25 "return fmSignature(next.text).some((l) => !seen.has(l))" "return true"
  red25 "F10" sc_f10 "deny:settings_forgery|allow" $PATHS25 "&& !ownPluginHooks(fs_[0])) return 'hooksjson';" "&& false) return 'hooksjson';"
  red25 "F10b" sc_f10 "deny:settings_forgery|allow" $PATHS25 "&& !ownPluginHooks(fs_[0])) return 'hooksjson';" "&& true) return 'hooksjson';"
  red25 "F11" sc_f11 "deny:settings_forgery" $PATHS25 "if (low.some((f) => PLUGIN_CACHE_RE.test(f))) return 'cache';" "if (false) return 'cache';"
  red25 "F12" sc_f12 "deny:settings_forgery|allow" $PATHS25 "if (pluginOff(newDoc) && !pluginOff(oldDoc))" "if (false)"
  red25 "F13" sc_f13 "deny:settings_forgery" $PATHS25 "if (tool === 'NotebookEdit') return { forged: true" "if (false) return { forged: true"
}
caseF2

# ---------- X: fail closed, wire form, packaging ----------
sc_x1() { prep25; canon25; ask25 pre >/dev/null; rm -f "$HT25/_shared/lib/xprov-hook-rules.cjs"; ask25 pre none yes toolu_x; echo "$H_RC"; }
sc_x2() { prep25; canon25; ask25 pre none yes toolu_n >/dev/null; env -i PATH=/nonexistent /bin/bash "$HT25/hooks/xprov-consent-hook.sh" < "$TMP25/p.json" >/dev/null 2>&1; echo "$?"; }
sc_x3() { printf 'not json at all' > "$TMP25/p.json"; hookrun25 "$HT25" "$TMP25/p.json"; echo "$H_RC"; }
sc_x4() { printf '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}' > "$TMP25/p.json"; hookrun25 "$HT25" "$TMP25/p.json"; dec25; }
caseX() {
  # X1 runs on its own tree copy: the module is removed there
  make_tree; cp -R "$REPO_ROOT/hooks" "$TREE/hooks"; local keep="$HT25"; HT25="$TREE"
  assert_eq "X1 the rules module missing in the tree copy: the guarded call is blocked (exit 2)" "$(sc_x1)" "2"
  HT25="$keep"
  assert_eq "X2 no node on PATH: blocked (exit 2), not 127" "$(sc_x2)" "2"
  assert_eq "X3 unparseable hook input: blocked (exit 2)" "$(sc_x3)" "2"
  assert_eq "X4 a call the hook does not handle (Bash) cannot be classified: denied" "$(sc_x4)" "deny:unguarded_event"
  assert_json "X5 hooks/hooks.json: PreToolUse on AskUserQuestion and on Edit|Write|NotebookEdit(|MultiEdit), PostToolUse on AskUserQuestion, every command ends in || exit 2" "$(cat "$REPO_ROOT/hooks/hooks.json")" \
    "[j.hooks.PreToolUse.map((m) => m.matcher).join(','), j.hooks.PostToolUse.map((m) => m.matcher).join(','), Object.values(j.hooks).flat().every((m) => m.hooks.every((h) => /xprov-consent-hook\\.sh\"? \\|\\| exit 2\$/.test(h.command)))].join('|')" "AskUserQuestion,Edit|Write|NotebookEdit|MultiEdit|AskUserQuestion|true"
  assert_json "X5b every hooks.json entry sets onFailure block (a timeout must not fail open; Claude Code 2.1.295+, code.claude.com/docs/en/hooks)" "$(cat "$REPO_ROOT/hooks/hooks.json")" "Object.values(j.hooks).flat().every((m) => m.hooks.every((h) => h.onFailure === 'block'))" "true"
  [[ "$(node -p 'JSON.stringify(require(process.argv[1]).CONSENT_HELP.includes("Dev install: bin/install.sh") && require(process.argv[1]).CONSENT_HELP.includes("Plugin hook (wave 4"))' "$REPO_ROOT/_shared/lib/help-xprov-consent.cjs")" == "true" ]] && ok "X6 the consent help names the plugin hook and that a dev install has none (R-3)" || bad "X6 help text lacks the plugin hook note"
  local sh="$REPO_ROOT/hooks/xprov-consent-hook.sh"
  [[ "$(grep -c 'CLAUDE_PLUGIN_ROOT\|A1_' "$sh")" == "0" ]] && ok "X7 the wrapper reads no environment variable to find the script (no redirect)" || bad "X7 the wrapper reads an environment variable"
  # X1/X2 RED: the wrapper without `|| exit 2` lets a crash through as a non-blocking exit
  make_tree; cp -R "$REPO_ROOT/hooks" "$TREE/hooks"; mutate25 "$TREE" hooks/xprov-consent-hook.sh '.cjs" || exit 2' '.cjs"'; local k2="$HT25"; HT25="$TREE"
  prep25; canon25; ask25 pre none yes toolu_m >/dev/null; rm -f "$HT25/_shared/lib/xprov-hook-rules.cjs"; ask25 pre none yes toolu_m2; local m1="$H_RC"
  env -i PATH=/nonexistent /bin/bash "$HT25/hooks/xprov-consent-hook.sh" < "$TMP25/p.json" >/dev/null 2>&1; local m2="$?"
  HT25="$k2"
  [[ "$m1" != "2" ]] && ok "X1 RED [mutant]: without '|| exit 2' a missing module is exit $m1 (not blocking)" || bad "X1 RED [mutant]: the wrapper guard is dead"
  [[ "$m2" != "2" ]] && ok "X2 RED [mutant]: without '|| exit 2' a missing node is exit $m2 (not blocking)" || bad "X2 RED [mutant]: the wrapper guard is dead"
}
caseX

# ---------- R: the repo hook, read-only commands (FR-032, SC-008) ----------
RH25="$REPO_ROOT/.claude/hooks"
rh_run() { # <hook dir> <command text> — prints allow | deny
  local out; out="$(node -e 'process.stdout.write(JSON.stringify({tool_name:"Bash",tool_input:{command:process.argv[1]}}))' "$2" | bash "$1/xprov-deny-allowlist-approve.sh" 2>/dev/null)"
  [[ "$out" == *'"permissionDecision":"deny"'* ]] && echo deny || { [[ -z "$out" ]] && echo allow || echo "odd:$out"; }
}
rh_mut() { # <out dir> <file> <from> <to> — a copy of the repo hook directory with one change
  rm -rf "$1"; mkdir -p "$1"; cp "$RH25/xprov-deny-allowlist-approve.sh" "$RH25/xprov-bash-class.cjs" "$1/"; mutate25 "$1" "$2" "$3" "$4"
}
declare -a RALLOW25=(
  'grep a1-xprov "$S/summary.txt"'
  'for f in ~/.a1-xprov/*.json; do echo "a1-xprov $f"; ls -l "$f"; done'
  'ls -la ~/.a1-xprov | head -20'
  'grep -n "allowlist approve" ~/N3URAL-Vault/project/a1-specforge/spec ~/N3URAL-Vault/project/a1-specforge/plans'
  "rg -n 'xprov permit' docs | head -5"
  'grep -rn "xprov waive" _shared | wc -l'
  "sed -n '1,20p' skills/a1-fix/SKILL.md"
  'git log --oneline | grep waive'
  'git diff --stat | tail -3'
  "git log --no-ext-diff --no-textconv -S 'xprov permit' | head -3"
  'cat README.md | head -20'
  'grep -i "xprov permit" docs'
  'tail -n 5 notes.md && head -3 notes.md'
  'xprov consent record --kind consent'
  'node _shared/a1-tools.cjs xprov permit-check --repo .'
  "cat >> notes.md <<'EOF'
the owner runs xprov permit and allowlist approve in a terminal
EOF"
  "cat > notes.md <<'EOF'
never type xprov \$v or xprov waive here
EOF"
)
declare -a RDENY25=(   # command ::: mutant ids under which it must flip to allow
  'xprov permit --by robert --record record/x.md:::M0'
  'xprov waive --phase p --gate plan-review-xprov:::M0'
  'node _shared/a1-tools.cjs xprov allowlist approve --repo .:::M0'
  'grep x; xprov permit:::M0 M1'
  'xprov $v:::M0'
  "$(printf 'xprov\tpermit --by x'):::M0"
  'cat f | xprov waive:::M0 M1'
  'xprov permit-check && xprov permit --by x:::M0'
  'grep x $(xprov permit):::M2'
  'grep x `xprov permit`:::M3'
  'echo xprov permit > notes.txt:::M4'
  "sed -i 's/x/xprov permit/' notes.txt:::M5"
  "sed -n 'e xprov permit' f:::M5"
  'for f in a; do xprov permit; done:::M6'
  "rg --pre 'xprov permit' x:::M7"
  "git log --no-ext-diff --no-textconv --output=o -S 'xprov permit':::M8"
  "git log -S 'xprov permit':::M15"
  "git log --no-ext-diff --no-textconv -c core.x=y -S 'xprov permit':::M16"
  "cat > f <<'E'OF
EOF
xprov permit
E:::M14"
  'cat ~/.a1-xprov/waivers.json:::M9'
  'grep a1-xprov/permit-denials f:::M9'
  "cat >> ~/.a1-xprov/waivers.json <<'EOF'
x
EOF:::M10"
  "cat <<'EOF' | bash
xprov permit
EOF:::M11"
  "cat >> run.sh <<'EOF'
xprov permit
EOF
bash run.sh:::M12"
  "cat >> n.md <<EOF
xprov permit \$(date)
EOF:::M13"
)
caseR() {
  local c
  for c in "${RALLOW25[@]}"; do
    [[ "$(rh_run "$RH25" "$c")" == "allow" ]] && ok "R-allow lets through: $(printf '%s' "$c" | head -1 | cut -c1-70)" || bad "R-allow denied: $c"
  done
  [[ "${#RALLOW25[@]}" -ge 10 ]] && ok "R-allow count ${#RALLOW25[@]} >= 10 (SC-008)" || bad "R-allow count below 10"
  local want="${#RDENY25[@]}"; [[ "$want" -ge 8 ]] && ok "R-deny count $want >= 8 (SC-008)" || bad "R-deny count below 8"
  # mutants (hook directory copies)
  rh_mut "$TMP25/rm0" xprov-bash-class.cjs "mode: isReadonly(text) ? 'readonly' : 'plain'" "mode: 'readonly'"    # M0: every command counts as read-only
  rh_mut "$TMP25/rmold" xprov-bash-class.cjs "mode: isReadonly(text) ? 'readonly' : 'plain'" "mode: 'plain'"; mutate25 "$TMP25/rmold" xprov-bash-class.cjs "const h = text.includes('<<') ? heredocHeader(text) : null;" "const h = null;"   # MOLD: the old behaviour
  rh_mut "$TMP25/rm1" xprov-bash-class.cjs "return segs.every((w) => {" "return segs.some((w) => {"
  rh_mut "$TMP25/rm2" xprov-bash-class.cjs "if (/\\\$\\(|\`|\\\$['\"]/.test(text)) return false;" "" ; mutate25 "$TMP25/rm2" xprov-bash-class.cjs "c === '(' || c === ')' || " ""
  rh_mut "$TMP25/rm3" xprov-bash-class.cjs "if (/\\\$\\(|\`|\\\$['\"]/.test(text)) return false;" ""
  rh_mut "$TMP25/rm4" xprov-bash-class.cjs "c === '>' || c === '<' ||" "c === '<' ||"
  rh_mut "$TMP25/rm5" xprov-bash-class.cjs "if (prog === 'sed') return sub === '-n' && SED_SCRIPT_RE.test(w[2] || '') && w.slice(3).every((t) => !t.startsWith('-'));" "if (prog === 'sed') return true;"
  rh_mut "$TMP25/rm6" xprov-bash-class.cjs "const body = w[0] === 'do' ? w.slice(1) : w;" "const body = w[0] === 'do' ? [] : w;"
  rh_mut "$TMP25/rm7" xprov-bash-class.cjs "if (prog === 'rg') return !w.some((t) => t === '--pre' || t.startsWith('--pre=') || t.startsWith('--hostname-bin'));" "if (prog === 'rg') return true;"
  rh_mut "$TMP25/rm8" xprov-bash-class.cjs " && !w.some((t) => t.startsWith('--output') || t === '--ext-diff');" ";"
  rh_mut "$TMP25/rm14" xprov-bash-class.cjs "if (after !== '' && after !== ' ' && after !== '\\t' && after !== '>') return null;" ""
  rh_mut "$TMP25/rm15" xprov-bash-class.cjs "w.includes('--no-ext-diff') && w.includes('--no-textconv') && " ""
  rh_mut "$TMP25/rm16" xprov-bash-class.cjs "!w.includes('-c') && " ""
  rh_mut "$TMP25/rm9" xprov-deny-allowlist-approve.sh '*"a1-xprov/waivers"*) deny "$MSG_WAIVE" ;;' '*"a1-xprov/waivers-never"*) deny "$MSG_WAIVE" ;;'; mutate25 "$TMP25/rm9" xprov-deny-allowlist-approve.sh 'case "$permit_text" in *"a1-xprov/permit-den"*) deny "$MSG_PERMIT" ;; esac' 'case "$permit_text" in *"a1-xprov/permit-never"*) deny "$MSG_PERMIT" ;; esac'
  rh_mut "$TMP25/rm10" xprov-bash-class.cjs "return { mode: 'heredoc', judge: h }" "return { mode: 'heredoc', judge: 'cat' }"
  rh_mut "$TMP25/rm11" xprov-bash-class.cjs "segs.length !== 1 ||" ""
  rh_mut "$TMP25/rm12" xprov-bash-class.cjs "lines.slice(end + 1).some((l) => l.trim() !== '')" "false"
  rh_mut "$TMP25/rm13" xprov-bash-class.cjs "const HEREDOC_RE = /<<(-?)(['\"])([A-Za-z_][A-Za-z0-9_]*)\\2/;" "const HEREDOC_RE = /<<(-?)(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\\2/;"
  local row cmd ids id res
  for row in "${RDENY25[@]}"; do
    cmd="${row%%:::*}"; ids="${row##*:::}"
    [[ "$(rh_run "$RH25" "$cmd")" == "deny" ]] && ok "R-deny denies: $(printf '%s' "$cmd" | head -1 | cut -c1-70)" || { bad "R-deny let through: $cmd"; continue; }
    for id in $ids; do
      res="$(rh_run "$TMP25/r$(printf '%s' "$id" | tr 'A-Z' 'a-z')" "$cmd")"
      [[ "$res" == "allow" ]] && ok "R-deny RED [$id]: $(printf '%s' "$cmd" | head -1 | cut -c1-60) flips to allow" || bad "R-deny RED [$id]: the guard is dead for: $cmd (mutant gives $res)"
    done
  done
  # the allow cases are red under M0 (the old behaviour): each one that the old hook denied. The old hook let some of them through already.
  local flipped=0
  for c in "${RALLOW25[@]}"; do [[ "$(rh_run "$TMP25/rmold" "$c")" == "deny" ]] && flipped=$((flipped + 1)); done
  [[ "$flipped" -ge 8 ]] && ok "R-allow RED [MOLD]: the old behaviour denies $flipped of ${#RALLOW25[@]} allow cases (the change is what lets them through)" || bad "R-allow RED [MOLD]: the old behaviour denies only $flipped"
  [[ "$(rh_run "$TMP25/rmold" 'grep a1-xprov "$S/summary.txt"')" == "deny" ]] && ok "R-allow RED [MOLD]: the real false deny of 2026-10-15 (xprov \$S) is a deny without the change" || bad "R-allow RED [MOLD]: the false deny does not reproduce"
  # no node: the classifier cannot run, the old behaviour applies (a read-only command is denied again, nothing else changes)
  local nonode="$TMP25/nonode25"; mkdir -p "$nonode"; local t
  for t in cat sed tr printf dirname; do [[ -x "/usr/bin/$t" ]] && ln -sf "/usr/bin/$t" "$nonode/$t"; [[ -x "/bin/$t" ]] && ln -sf "/bin/$t" "$nonode/$t"; done
  local out; out="$(printf '{"tool_name":"Bash","tool_input":{"command":"xprov permit --by x"}}' | PATH="$nonode" /bin/bash "$RH25/xprov-deny-allowlist-approve.sh" 2>/dev/null)"
  [[ "$out" == *'"deny"'* ]] && ok "R-nonode without node the hook still denies xprov permit" || bad "R-nonode without node the hook let xprov permit through"
  # hostile: a 10 000 character command and a command that is only separators
  [[ "$(rh_run "$RH25" "grep x $(printf 'a%.0s' $(seq 1 10000)) ; xprov permit")" == "deny" ]] && ok "R-big a 10 000 character command with xprov permit in the last segment: denied" || bad "R-big oversize command let through"
  [[ "$(rh_run "$RH25" ';;;&&||')" == "allow" ]] && ok "R-sep a command of separators only: allowed (nothing to judge)" || bad "R-sep separators only were denied"
}
caseR

export HOME="$SAVED_HOME_25"
rm -rf "$TMP25"
