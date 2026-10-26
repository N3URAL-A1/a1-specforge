# shellcheck shell=bash
# Part 02 — section readers, phone-readable renderer, degradation, size cap (spec 021 Wave 2).
# FR-002, FR-003, FR-009, FR-013, FR-021. Fixtures: fixtures/sections (real-file copies, see SOURCES.txt).

SEC="$SUITE_DIR/fixtures/sections"
# mk_sections_repo <var> — the W1 fixture repo plus the real index.json and phase files, committed.
mk_sections_repo() {
  FX_N=$((FX_N + 1)); local dir="$WORK/srepo$FX_N"
  mkdir -p "$dir" && cp -R "$SUITE_DIR/fixtures/repo/." "$dir/" && cp -R "$SEC/repo/." "$dir/"
  git init -q "$dir" && git -C "$dir" add -A && git -C "$dir" -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -q -m fx
  printf -v "$1" '%s' "$dir"
}
# mk_sections_vault <var> — the W1 fixture vault plus specs, postmortems and the learning store.
mk_sections_vault() {
  FX_N=$((FX_N + 1)); local dir="$WORK/svault$FX_N"
  mkdir -p "$dir" && cp -R "$SUITE_DIR/fixtures/vault/." "$dir/" && cp -R "$SEC/vault/." "$dir/"
  printf -v "$1" '%s' "$dir"
}
# section_of <note> <heading> — body lines of one section.
section_of() { awk -v h="## $2" '$0==h{on=1;next} /^## /{on=0} on' <<<"$1"; }

mk_sections_repo SR; mk_sections_vault SV
vault_run "$SR" "$SV" dashboard build --json
expect "02.1 build on the real-file fixture exits 0" "0" "$RC"
NOTE="$(cat "$SV/project/fixture-slug/dashboard.md")"
HEADS="$(grep '^## ' <<<"$NOTE" | tr '\n' '|')"
expect "02.2 exactly seven headings in order" "## Now|## Next|## Specs|## Phases|## Learnings|## Open points|## Cost|" "$HEADS"
expect "02.3 seven headings (count)" "7" "$(grep -c '^## ' <<<"$NOTE")"

NOW="$(section_of "$NOTE" Now)"
expect "02.4 Now lists both in-flight features (count 2 bullets)" "2" "$(grep -c '^- ' <<<"$NOW")"
expect_has "02.5 Now names the cockpit feature" "$NOW" "Vault cockpit contract"
expect_has "02.6 Now names the queue feature" "$NOW" "Intent queue consumer"
expect_count "02.7 both features show their stage word (count 2)" 2 "$NOW" ", started"
NEXT="$(section_of "$NOTE" Next)"
expect "02.8 Next is one bullet" "1" "$(grep -c '^- ' <<<"$NEXT")"
expect_has "02.9 Next is the cursor feature in words" "$NEXT" "Recommended next: SpecForge into a1 as an optional"
expect "02.10 Now+Next: no path, no flag, no gate token (count 0)" "0" \
  "$(printf '%s\n%s\n' "$NOW" "$NEXT" | grep -cE '/|(^|[[:space:]])--[a-z]|gate-' )"
expect "02.11 Now and Next each at most 3 lines" "true" \
  "$([[ "$(grep -c . <<<"$NOW")" -le 3 && "$(grep -c . <<<"$NEXT")" -le 3 ]] && echo true || echo false)"

SPECS="$(section_of "$NOTE" Specs)"
expect "02.12 Specs lists all 3 spec files (count 3)" "3" "$(grep -c '^- ' <<<"$SPECS")"
expect_has "02.13 Specs line holds id, title and status" "$SPECS" "018-pipeline-metrics — Measure the pipeline: escaped-defect attribution and cost per feature — done"
expect_has "02.14 Specs shows 021 status" "$SPECS" "021-dashboard"
expect "02.15 Specs newest first (021 before 006)" "true" \
  "$([[ "$(grep -n '021-dashboard' <<<"$SPECS" | cut -d: -f1)" -lt "$(grep -n '006-specforge' <<<"$SPECS" | cut -d: -f1)" ]] && echo true || echo false)"

PH="$(section_of "$NOTE" Phases)"
expect "02.16 Phases lists the 2 phases (count 2)" "2" "$(grep -c '^- ' <<<"$PH")"
expect_has "02.17 M13 shows latest wave and verdict" "$PH" "M13-residuals — wave 4 done — verification: PASS"
expect_has "02.18 021 shows its wave and pending verification" "$PH" "021-dashboard — wave 1 done — verification: pending"

OPEN="$(section_of "$NOTE" "Open points")"
expect "02.19 Open points: only the spec with markers (count 1)" "1" "$(grep -c '^- ' <<<"$OPEN")"
expect_has "02.20 Open points counts the 2 planted markers" "$OPEN" "006-specforge-kritis-profile: 2 open clarification markers"

# Learnings: the number must equal the CLI's own count on the same vault.
cli_count="$(cd "$SR" && A1_VAULT_ROOT="$SV" node "$TOOLS" learnings count-since-watermark 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).count)))')"
LEARN="$(section_of "$NOTE" Learnings)"
expect_has "02.21 Learnings count equals learnings count-since-watermark ($cli_count)" "$LEARN" "- $cli_count new learnings since the last evolve run (2026-10-18)"
[[ "$cli_count" -ge 3 ]] && ok "02.22 cross-check count is non-trivial (>=3)" || bad "02.22 cross-check count too small: $cli_count"

# ---- FR-021: format ----------------------------------------------------------------------------------------
body="$(sed '1,/^> Generated/d' <<<"$NOTE")"
expect "02.23 no body line starts with | (count 0)" "0" "$(grep -c '^|' <<<"$body")"
expect "02.24 no < followed by a letter (count 0)" "0" "$(grep -cE '<[A-Za-z]' <<<"$body")"
expect "02.25 no image embed (count 0)" "0" "$(grep -c '!\[' <<<"$body")"

mk_sections_repo HR; mk_sections_vault HV
printf -- '---\ntype: spec\nid: 030-hostile\ntitle: "<b>bold</b> | col ![x](http://a/b.png) |"\nstatus: draft\n---\n\nbody\n' > "$HV/project/fixture-slug/spec/030-hostile.md"
vault_run "$HR" "$HV" dashboard build
HNOTE="$(cat "$HV/project/fixture-slug/dashboard.md")"
expect_has "02.26 hostile spec is listed" "$HNOTE" "030-hostile"
expect "02.27 hostile title: no body line starts with | (count 0)" "0" "$(sed '1,/^> Generated/d' <<<"$HNOTE" | grep -c '^|')"
expect "02.28 hostile title: no <letter (count 0)" "0" "$(sed '1,/^> Generated/d' <<<"$HNOTE" | grep -cE '<[A-Za-z]')"
expect "02.29 hostile title: no image embed (count 0)" "0" "$(grep -c '!\[' <<<"$HNOTE")"
expect "02.30 hostile title: still seven headings" "7" "$(grep -c '^## ' <<<"$HNOTE")"

# ---- FR-009: degradation ---------------------------------------------------------------------------------
mk_fixture_repo DR; mk_sections_vault DV
rm -rf "$DR/docs/product/index.json"
vault_run "$DR" "$DV" dashboard build --json
expect "02.31 missing index.json exits 0" "0" "$RC"
expect "02.32 degraded lists Now and Next" "true" "$(json_get "$OUT" 'j.degraded.includes("Now")&&j.degraded.includes("Next")')"
DN="$(cat "$DV/project/fixture-slug/dashboard.md")"
expect_has "02.33 Now says not available (no_product_docs)" "$(section_of "$DN" Now)" "- not available (no_product_docs)"
expect_has "02.34 Phases says not available (no_phases)" "$(section_of "$DN" Phases)" "- not available (no_phases)"

mk_fixture_repo ER; mk_fixture_vault EV
vault_run "$ER" "$EV" dashboard build
EN="$(cat "$EV/project/fixture-slug/dashboard.md")"
expect_has "02.35 zero spec files: Specs shows none" "$(section_of "$EN" Specs)" "- none"
expect_has "02.36 no learning store: Learnings not available (no_watermark)" "$(section_of "$EN" Learnings)" "- not available (no_watermark)"
expect_has "02.37 zero markers: Open points shows none" "$(section_of "$EN" "Open points")" "- none"
mkdir -p "$ER/.a1/phases"
vault_run "$ER" "$EV" dashboard build
expect_has "02.38 existing empty phases dir: none" "$(section_of "$(cat "$EV/project/fixture-slug/dashboard.md")" Phases)" "- none"

mk_fixture_repo LR; mk_fixture_vault LV
mkdir -p "$WORK/elsewhere" && ln -s "$WORK/elsewhere" "$LV/project/fixture-slug"
vault_run "$LR" "$LV" dashboard build
expect "02.39 project/<slug> as symlink exits 2" "2" "$RC"
expect "02.40 symlink case writes nothing" "0" "$(find "$WORK/elsewhere" -type f | wc -l | tr -d ' ')"

# ---- FR-013: size cap ------------------------------------------------------------------------------------
mk_sections_repo BR; mk_sections_vault BV
n=0
while [[ $n -lt 100 ]]; do
  n=$((n + 1)); id="$(printf '1%02d-bulk-spec-%03d' "$((n % 90))" "$n")"
  sed -e "s/^id: .*/id: $id/" -e "s/^title: .*/title: \"Bulk spec $n\"/" "$SEC/vault/project/fixture-slug/spec/018-pipeline-metrics.md" > "$BV/project/fixture-slug/spec/$id.md"
done
vault_run "$BR" "$BV" dashboard build
BN="$(cat "$BV/project/fixture-slug/dashboard.md")"
expect "02.41 103 spec files: at most 400 lines" "true" "$([[ "$(wc -l <"$BV/project/fixture-slug/dashboard.md" | tr -d ' ')" -le 400 ]] && echo true || echo false)"
BS="$(section_of "$BN" Specs | grep .)"
last="$(tail -1 <<<"$BS")"
kept="$(grep -c '^- ' <<<"$BS")"
expect_has "02.42 Specs ends with and N more" "$last" "- and "
hidden="${last#- and }"; hidden="${hidden% more}"
expect "02.43 kept + hidden = 103 (kept $((kept - 1)), hidden $hidden)" "103" "$((kept - 1 + hidden))"
expect_has "02.44 newest entry kept first (id sort descending)" "$(head -1 <<<"$BS")" "- 189-bulk-spec-089"
expect "02.45 still seven headings" "7" "$(grep -c '^## ' <<<"$BN")"

# ---- Wave 6: plain() scope, wave marker, phase order, link syntax, degraded text -------------------------
# RED before the fix: Specs/Phases ran plain() and showed "007-retro-" for 007-retro-gate-id-validator; the
# wave state came from keywords anywhere in the block; phases sorted by name; "[[x]]" survived into the note.
REV="$SUITE_DIR/fixtures/review"
mk_sections_repo WR; mk_sections_vault WV
cp -R "$REV/repo/." "$WR/" && cp -R "$REV/vault/." "$WV/"
vault_run "$WR" "$WV" dashboard build
expect "02.46 build with the real 001 and 007 specs exits 0" "0" "$RC"
WN="$(cat "$WV/project/fixture-slug/dashboard.md")"
WSPECS="$(section_of "$WN" Specs)"
expect "02.47 Specs lists 5 files now (count 5)" "5" "$(grep -c '^- ' <<<"$WSPECS")"
expect_has "02.48 the 007 id and title are whole (gate- kept)" "$WSPECS" "- 007-retro-gate-id-validator — Three machine guards for false-green evidence — gate-id validator, imported-expectation — done"
expect_has "02.49 the 001 id is whole" "$WSPECS" "- 001-roadmap-gate-parallel-features — Roadmap Gate + Parallel Feature Lifecycle — done"
expect "02.50 both gate- ids and the 007 title keep their token (count 2 lines)" "2" "$(grep -c 'gate-' <<<"$WSPECS")"
WPH="$(section_of "$WN" Phases)"
expect_has "02.51 the 007 phase name is whole (gate- kept)" "$WPH" "007-retro-gate-id-validator — "
expect_has "02.52 007 wave 4: heading marker 'done' wins over 'Round 1 PARTIAL' in the body" "$WPH" "007-retro-gate-id-validator — wave 4 done — verification: pending"
expect_lacks "02.53 no 'partly done' for 007" "$WPH" "wave 4 partly done"
# Now/Next keep the filter (FR-003).
expect "02.54 Now and Next still hold no gate- token (count 0)" "0" "$(printf '%s\n%s\n' "$(section_of "$WN" Now)" "$(section_of "$WN" Next)" | grep -c 'gate-')"

# keyword fallback: whole words only, negation ignored. Synthetic STATUS files (no heading marker).
mk_sections_repo KR; mk_sections_vault KV
mkdir -p "$KR/.a1/phases/k-incomplete" "$KR/.a1/phases/k-notblocked" "$KR/.a1/phases/k-blocked" "$KR/.a1/phases/k-marker-blocked"
printf '## Wave 2 — x\n\nINCOMPLETE: two tasks left\n' > "$KR/.a1/phases/k-incomplete/STATUS.md"
printf '## Wave 3 — y\n\nThe task was not BLOCKED, work goes on\n' > "$KR/.a1/phases/k-notblocked/STATUS.md"
printf '## Wave 4 — z\n\nTask b BLOCKED on review\n' > "$KR/.a1/phases/k-blocked/STATUS.md"
printf '## Wave 5 — w ⟶ blocked\n\nCompleted: yes\n' > "$KR/.a1/phases/k-marker-blocked/STATUS.md"
vault_run "$KR" "$KV" dashboard build
KPH="$(section_of "$(cat "$KV/project/fixture-slug/dashboard.md")" Phases)"
expect_has "02.55 INCOMPLETE is not done" "$KPH" "k-incomplete — wave 2 in progress"
expect_has "02.56 'not BLOCKED' is not blocked" "$KPH" "k-notblocked — wave 3 in progress"
expect_has "02.57 a bare BLOCKED word blocks" "$KPH" "k-blocked — wave 4 blocked"
expect_has "02.58 the heading marker wins over a keyword in the body" "$KPH" "k-marker-blocked — wave 5 blocked"

# phases: newest first by file mtime, so the 40-line cap keeps the newest.
mk_sections_repo PR; mk_sections_vault PV
n=0
while [[ $n -lt 45 ]]; do
  n=$((n + 1)); d="$PR/.a1/phases/zz-old-$(printf '%02d' "$n")"; mkdir -p "$d"
  printf '## Wave 1 — x ⟶ done\n' > "$d/STATUS.md"; touch -t 202001010000 "$d/STATUS.md"
done
mkdir -p "$PR/.a1/phases/000-newest"; printf '## Wave 1 — x ⟶ done\n' > "$PR/.a1/phases/000-newest/STATUS.md"
touch -t 203001010000 "$PR/.a1/phases/000-newest/STATUS.md"
vault_run "$PR" "$PV" dashboard build
PPH="$(section_of "$(cat "$PV/project/fixture-slug/dashboard.md")" Phases | grep .)"
expect "02.59 Phases is capped at 40 lines (count)" "40" "$(grep -c '^- ' <<<"$PPH")"
expect_has "02.60 the newest phase comes first" "$(head -1 <<<"$PPH")" "- 000-newest"
expect_has "02.61 the last line is and N more" "$(tail -1 <<<"$PPH")" "- and "
hidden="$(tail -1 <<<"$PPH")"; hidden="${hidden#- and }"; hidden="${hidden% more}"
expect "02.62 kept + hidden = 48 phases (45 filler, 000-newest, 2 fixture phases)" "48" "$((39 + hidden))"

# link and template syntax in source values is inert; the redaction marker survives.
mk_sections_repo SXR; mk_sections_vault SXV
printf -- '---\ntype: spec\nid: 031-syntax\ntitle: "[[secret/hub]] and [x](http://a.example/p) with `code` and <%%= it %%> ![i](u)"\nstatus: draft\n---\n\nbody\n' > "$SXV/project/fixture-slug/spec/031-syntax.md"
vault_run "$SXR" "$SXV" dashboard build
SXN="$(cat "$SXV/project/fixture-slug/dashboard.md")"
SXB="$(sed '1,/^> Generated/d' <<<"$SXN")"
expect_has "02.63 the syntax spec is listed" "$SXB" "031-syntax"
expect "02.64 no [ or ] left in body lines (count 0)" "0" "$(sed 's/\[REDACTED\]//g' <<<"$SXB" | grep -c '[][]')"
expect "02.65 no backtick in body lines (count 0)" "0" "$(grep -c '`' <<<"$SXB")"
expect "02.66 no <% in body lines (count 0)" "0" "$(grep -c '<%' <<<"$SXB")"
expect "02.67 the words stay readable" "1" "$(grep -c 'secret/hub' <<<"$SXB")"
expect "02.68 frontmatter project link is untouched" "1" "$(grep -c '^project: "\[\[project/fixture-slug\]\]"$' <<<"$SXN")"

# degraded lists only not-available sections; "none" sections are not listed.
mk_fixture_repo DNR; mk_fixture_vault DNV
vault_run "$DNR" "$DNV" dashboard build --json
expect "02.69 an empty Specs section (none) is not in degraded" "false" "$(json_get "$OUT" 'j.degraded.includes("Specs")')"
expect "02.70 degraded still lists the missing sources (Now, Learnings)" "true" "$(json_get "$OUT" 'j.degraded.includes("Now") && j.degraded.includes("Learnings")')"
help="$(node "$TOOLS" --help 2>&1)"
expect_has "02.71 help: a none section is stated as not listed" "$help" "is not listed"
expect_lacks "02.72 help: no longer claims degraded lists none sections" "$help" 'or "none" (empty)'
