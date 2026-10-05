#!/usr/bin/env bash
# cases/99-suite-meta.sh — spec 011 Wave 11, FR-038 and SC-001: the suite
# checks itself. Runs LAST (name order 99) over $WORK/.results, the copy of
# every PASS/FAIL line that lib.sh's ok/bad write (also from subshells).
#
#   SM1 every result line names its requirement: a bracket tag with FR-nnn
#   SM2 at least 51 result lines
#   SM3 every id of the frozen list (FR-001..037, FR-039..051; FR-038 is this
#      suite itself) appears in at least one PASS line — the list is typed
#      here, never read from the spec or the code (testing.md class 4)
#   SM4 each class FR-038 names is covered by a PASS line of a named case
#      (the frozen map below: class | the case's own words)
#   SM5 a grep over everything a1 wrote into the fixture vaults (inbox/intents/
#      and the result notes under project/*/intents/) for the two provisioned
#      fixture secrets finds nothing, while the same grep over the fixture
#      homes finds them in devices.json (the grep is alive). Files the doctor
#      cases plant on purpose elsewhere in a vault are not a1's writes.

M_RES="$WORK/.results"
m_lines() { grep -E '^(PASS|FAIL)  ' "$M_RES" 2>/dev/null; }

m1_untagged="$(m_lines | grep -vE '\[[^]]*FR-[0-9]{3}' | cut -c1-90)"
if [[ -z "$m1_untagged" && -s "$M_RES" ]]; then ok "SM1 every PASS/FAIL line of the suite carries a [FR-nnn] tag ($(m_lines | wc -l | tr -d ' ') lines checked) [FR-038, SC-001]"
else bad "SM1 every PASS/FAIL line of the suite carries a [FR-nnn] tag ($(m_lines | wc -l | tr -d ' ') lines checked) [FR-038, SC-001]" "untagged: ${m1_untagged:-<no results file>}"; fi

m2_n="$(m_lines | wc -l | tr -d ' ')"
if [[ "$m2_n" -ge 51 ]]; then ok "SM2 the suite reports $m2_n result lines (>= 51) [FR-038, SC-001]"
else bad "SM2 the suite reports $m2_n result lines (>= 51) [FR-038, SC-001]"; fi

M3_IDS="001 002 003 004 005 006 007 008 009 010 011 012 013 014 015 016 017 018 019 020 021 022 023 024 025 026 027 028 029 030 031 032 033 034 035 036 037
039 040 041 042 043 044 045 046 047 048 049 050 051"
m3_missing=""
m3_pass="$(m_lines | grep '^PASS  ')"
for id in $M3_IDS; do grep -qE "\[[^]]*FR-$id" <<<"$m3_pass" || m3_missing="$m3_missing FR-$id"; done
if [[ -z "$m3_missing" ]]; then ok "SM3 every requirement FR-001..037 and FR-039..051 (frozen list, 50 ids) has at least one passing case [FR-038]"
else bad "SM3 every requirement FR-001..037 and FR-039..051 (frozen list, 50 ids) has at least one passing case [FR-038]" "missing:$m3_missing"; fi

# class | the passing case's own words (case id + start of its name)
M4_MAP='forged signature|S12b signed with the wrong secret
replayed nonce|C2a a new id with an already used (device, nonce)
project ../.ssh|V5a project: ../.ssh
symlink slug|V5b symlink evil
9 KB before parsing|F1a 9 KB file -> oversized
conflict copy untouched and ignored|T1 '"'"'<id> (conflict 2026-09-24).md'"'"'
unknown key|F7i claimed/ file with an unknown key
two concurrent claims|C5a two concurrent claim processes
SIGTERM-trapping forking child|B4 a child that traps SIGTERM and forks a grandchild
sk-ant redaction|R6b sk-ant- key
PEM redaction|R6i PEM private-key block
hostname mismatch|C4a wrong hostname
edited claimed file|R10b a claimed/ file whose sha256 differs
argv shape|X7 progress argv = the frozen row-R array
stdin equals payload|X5 stdin equals the payload
approve from the phone|T9 approve signed by pixel
cancel of the running intent|T10 a valid cancel for the running intent
unknown target|T11/T12 a cancel of an unknown uuid
argv guard flags|X8 argv guard before the spawn
sealed copy one byte|X14 one byte flipped in the seal
hooks canary|X12a no hook ran
dirty main in an intent worktree|X32a write intent on a dirty main
open intent worktree limit|X33 three non-cleaned intent entries
claimed file without a ledger row|X15 a claimed file without a ledger row
complete on approve or cancel|R2c complete on an approve or cancel intent
override above the default|H6a each of the 11 guarded limits
child mode under the lock|X18c A1_INTENT_CHILD=0 under the lock
fsmonitor canary|X12b a core.fsmonitor planted by the child
seal_dir <root>/..|X26b seal_dir <root>/..
integrity pre-step|B13 a failing integrity check on a fix intent'
m4_missing=""
while IFS='|' read -r m4_class m4_case; do
  [[ -n "$m4_class" ]] || continue
  grep -qF -- "PASS  $m4_case" <<<"$m3_pass" || m4_missing="$m4_missing | $m4_class ($m4_case)"
done <<<"$M4_MAP"
if [[ -z "$m4_missing" ]]; then ok "SM4 every class FR-038 names (30 in the frozen map) is covered by a passing case [FR-038]"
else bad "SM4 every class FR-038 names (30 in the frozen map) is covered by a passing case [FR-038]" "${m4_missing:0:600}"; fi

m5_a1_writes() { find "$WORK"/*/vault/inbox/intents "$WORK"/*/vault/project/*/intents -type f -name '*.md' 2>/dev/null; }
m5_files="$(m5_a1_writes | wc -l | tr -d ' ')"
m5_vault_hits="$(m5_a1_writes | tr '\n' '\0' | xargs -0 grep -lF -e "$FIXTURE_SECRET" -e "$FIXTURE_EXECUTOR_SECRET" 2>/dev/null | wc -l | tr -d ' ')"
m5_home_hits="$(grep -rlF -e "$FIXTURE_SECRET" "$WORK"/*/home/.a1-intents/devices.json 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$m5_vault_hits" == 0 && "$m5_files" -gt 100 && "$m5_home_hits" -gt 0 ]]; then ok "SM5 secret grep over the $m5_files intent files and result notes a1 wrote into the fixture vaults: none holds a provisioned fixture secret (the same grep finds it in $m5_home_hits devices.json files) [FR-038, FR-031]"
else bad "SM5 secret grep over the $m5_files intent files and result notes a1 wrote into the fixture vaults: none holds a provisioned fixture secret (the same grep finds it in $m5_home_hits devices.json files) [FR-038, FR-031]" "files with a secret: $m5_vault_hits" "$(m5_a1_writes | tr '\n' '\0' | xargs -0 grep -lF -e "$FIXTURE_SECRET" -e "$FIXTURE_EXECUTOR_SECRET" 2>/dev/null | head -3)"; fi
