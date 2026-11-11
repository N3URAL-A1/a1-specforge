# Part 08 — taste vault: add, lint, families pool, board rule (spec 024-ux-studio, FR-024).
#
# Drives the real taste.cjs and run.cjs (families, board-check) with a temp vault and temp HOME.
# Every case header names the single production line whose change turns it red.

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

T_CJS="$REPO_ROOT/skills/a1-ux-studio/scripts/taste/taste.cjs"
T_RUN="$REPO_ROOT/skills/a1-ux-studio/scripts/run/run.cjs"
T_SKILL="$REPO_ROOT/skills/a1-ux-studio"
T_SHOT="$HERE/fixtures/handoff/screenshot.png"
T_BOARD="$HERE/fixtures/boards/diverge.html"
T_DATE="2026-11-11"

# tx <args...> — taste.cjs (no vault from the environment); sets RC, OUT, ERR.
tx() {
  ( cd "$A1_FX_ROOT" && env -u A1_VAULT_ROOT HOME="$FX_HOME" node "$T_CJS" "$@" >"$A1_FX_ROOT/t.out" 2>"$A1_FX_ROOT/t.err" )
  RC=$?; OUT="$(cat "$A1_FX_ROOT/t.out")"; ERR="$(cat "$A1_FX_ROOT/t.err")"
}
# trun <args...> — run.cjs, same outputs.
trun() {
  ( cd "$A1_FX_ROOT" && env -u A1_VAULT_ROOT HOME="$FX_HOME" node "$T_RUN" "$@" >"$A1_FX_ROOT/t.out" 2>"$A1_FX_ROOT/t.err" )
  RC=$?; OUT="$(cat "$A1_FX_ROOT/t.out")"; ERR="$(cat "$A1_FX_ROOT/t.err")"
}
tjq() { node -e 'const d=JSON.parse(process.argv[1]);process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"; }

# new_tvault — temp vault holding one screenshot at shots/ref.png; sets T_VAULT.
new_tvault() {
  mk_workdir T_VAULT ux-t-vault
  mkdir -p "$T_VAULT/shots" && cp "$T_SHOT" "$T_VAULT/shots/ref.png"
}
# tadd <extra args...> — add with valid defaults that later flags override (last flag wins in parseArgs).
tadd() {
  tx add --vault-root "$T_VAULT" --family dither-mono --id raw-grid --screenshot shots/ref.png \
    --source-url "https://example.com/work/raw-grid" --keywords "dither,mono,raw grid" \
    --image-prompt "monochrome dithered hero, coarse grid, no text" --copy-brief "Plain declarative sentences, no adjectives." "$@"
}
tree_files() { find "$T_VAULT/pattern" -type f 2>/dev/null | grep -c .; }

if ! node --check "$T_CJS" 2>/dev/null || [[ ! -f "$T_SHOT" || ! -f "$T_BOARD" ]]; then
  bad "T0 [FR-024] taste.cjs parses, screenshot and board fixtures present"
else
  ok "T0 [FR-024] taste.cjs parses, screenshot and board fixtures present"

  # T1 RED: in entry.cjs formatEntry() drop the `copy_brief:` line (one of the five fields is lost).
  new_tvault; tadd
  T_E="$T_VAULT/pattern/taste-vault/dither-mono/raw-grid.md"
  n_files="$(tree_files)"
  n_fields=0; for k in source_url keywords image_prompt copy_brief screenshot; do grep -q "^$k: ." "$T_E" 2>/dev/null && n_fields=$((n_fields + 1)); done
  n_type="$(grep -c '^type: reference$' "$T_E" 2>/dev/null)"
  if [[ $RC -eq 0 && $n_files -eq 1 && $n_fields -eq 5 && $n_type -eq 1 && "$OUT" == "pattern/taste-vault/dither-mono/raw-grid.md" ]]; then
    ok "T1 [FR-024] add: exit 0, exactly 1 file under pattern/taste-vault/<family>/, all 5 fields present"
  else bad "T1 [FR-024] add (rc=$RC files=$n_files fields=$n_fields type=$n_type out=$OUT err=$ERR)"; fi

  # T2 RED: in entry.cjs piiKind() delete the EMAIL_RE test (email passes); T2b: delete the PHONE_RE match line.
  new_tvault
  tadd --copy-brief "Write to jane.doe@example.org for the story"; rc_mail=$RC; err_mail="$ERR"; n_mail="$(tree_files)"
  tadd --image-prompt "call +49 170 1234567 for the portrait"; rc_tel=$RC; n_tel="$(tree_files)"
  tadd --keywords "support 0049-170-1234567"; rc_tel2=$RC
  tadd --source-url "https://example.com/a?mail=bob@example.org"; rc_url=$RC; n_all="$(tree_files)"
  if [[ $rc_mail -eq 1 && $rc_tel -eq 1 && $rc_tel2 -eq 1 && $rc_url -eq 1 && $n_mail -eq 0 && $n_tel -eq 0 && $n_all -eq 0 && "$err_mail" != *"jane.doe"* ]]; then
    ok "T2 [FR-024] email / phone in any field exit 1, 0 files written, the value is not echoed"
  else bad "T2 [FR-024] PII (mail=$rc_mail tel=$rc_tel tel2=$rc_tel2 url=$rc_url files=$n_all err=$err_mail)"; fi

  # T2c RED: in entry.cjs DATE_ONLY_RE remove the date exemption AND lower nothing else: a plain date in a prompt must pass (guard against over-blocking).
  new_tvault; tadd --image-prompt "poster series from 2026-11-11, 1920x1080"; rc_date=$RC
  if [[ $rc_date -eq 0 && "$(tree_files)" -eq 1 ]]; then ok "T2c [FR-024] a plain date and 1920x1080 are not mistaken for a phone number"; else bad "T2c [FR-024] date prompt rejected (rc=$rc_date $ERR)"; fi

  # T3 RED: in families.cjs vaultFamilies() delete the `for (const sub of subs)` loop (folder layout unread).
  new_tvault; tadd --id raw-grid; tadd --id coarse-dots --family dither-mono; tadd --family monumental-editorial --id big-type
  trun families --context brand --vault-root "$T_VAULT"
  has_new="$(tjq "$OUT" 'JSON.stringify(d.vault_entries["dither-mono"])')"
  n_cand_ids="$(tjq "$OUT" 'd.candidates.find(c=>c.id==="dither-mono").entry_ids.length')"
  src="$(tjq "$OUT" 'd.source')"
  tadd --id late-find; trun families --context brand --vault-root "$T_VAULT"
  n_after="$(tjq "$OUT" 'd.vault_entries["dither-mono"].length')"; has_late="$(tjq "$OUT" 'd.vault_entries["dither-mono"].includes("late-find")')"
  if [[ "$src" == vault && "$has_new" == '["coarse-dots","raw-grid"]' && $n_cand_ids -eq 2 && $n_after -eq 3 && "$has_late" == true ]]; then
    ok "T3 [FR-024] a new entry id shows up in the next families output (vault_entries + candidate entry_ids), 2 -> 3 entries"
  else bad "T3 [FR-024] families (src=$src ids=$has_new cand=$n_cand_ids after=$n_after late=$has_late)"; fi

  # T3b RED: in families.cjs vaultFamilies() drop the `!st.isFile()` lstat guard in entryFiles() (a symlinked entry is read).
  new_tvault; tadd; ln -s "$T_VAULT/pattern/taste-vault/dither-mono/raw-grid.md" "$T_VAULT/pattern/taste-vault/dither-mono/linked.md"
  trun families --context brand --vault-root "$T_VAULT"
  n_link="$(tjq "$OUT" 'd.vault_entries["dither-mono"].length')"
  if [[ $RC -eq 0 && $n_link -eq 1 ]]; then ok "T3b [FR-024] a symlinked entry file is not counted (1 entry, not 2)"; else bad "T3b [FR-024] symlink entry counted ($n_link)"; fi

  # T4 RED: in run.cjs COMMANDS replace `withTasteVaultRule(boardCheck.boardCheck)` with `boardCheck.boardCheck`.
  mk_workdir T_RV ux-t-run
  mkdir -p "$T_RV/project/demo"
  printf '%s\n' '{"aesthetic":"calm","reference":"","intent":{"text":"Pricing screen."},"guardrails":{"always":[],"never":[]}}' > "$T_RV/brief.json"
  T_RUNDIR="$( cd "$A1_FX_ROOT" && env A1_VAULT_ROOT="$T_RV" node "$T_RUN" init --project demo --spec s1 --screen pricing --brief "$T_RV/brief.json" --date "$T_DATE" 2>/dev/null )"
  mkdir -p "$T_RUNDIR/boards/fonts"
  for f in inter lora space-grotesk ibm-plex-mono playfair-display; do mkdir -p "$T_RUNDIR/boards/fonts/$f"; cp "$T_SKILL/templates/fonts/$f/"*.woff2 "$T_RUNDIR/boards/fonts/$f/"; done
  cp "$T_BOARD" "$T_RUNDIR/boards/diverge.html"
  trun board-check --run-dir "$T_RUNDIR" --kind diverge; rc_clean=$RC
  sed 's#</body>#<img src="../../../pattern/taste-vault/dither-mono/raw-grid.png"></body>#' "$T_BOARD" > "$T_RUNDIR/boards/diverge.html"
  n_ref="$(grep -c 'pattern/taste-vault' "$T_RUNDIR/boards/diverge.html")"
  trun board-check --run-dir "$T_RUNDIR" --kind diverge; rc_ref=$RC; err_ref="$ERR"
  sed 's#</body>#<img src="..%2F..%2Fpattern%2Ftaste-vault%2Fx.png"><i style="background:url(pattern\\2f taste-vault/x.png)"></i></body>#' "$T_BOARD" > "$T_RUNDIR/boards/diverge.html"
  trun board-check --run-dir "$T_RUNDIR" --kind diverge; rc_enc=$RC
  if [[ $rc_clean -eq 0 && $n_ref -eq 1 && $rc_ref -eq 1 && "$err_ref" == *"taste-vault"* && $rc_enc -eq 1 ]]; then
    ok "T4 [FR-024] board-check: clean board exit 0; plain and percent/CSS-escaped pattern/taste-vault reference exit 1"
  else bad "T4 [FR-024] board-check (clean=$rc_clean refs=$n_ref ref=$rc_ref enc=$rc_enc err=$err_ref)"; fi

  # T5 RED: in taste.cjs lint() change `fams.size !== wantFamilies` to `fams.size < wantFamilies` (or drop the minEntries line).
  new_tvault; tadd; tadd --id second --family monumental-editorial
  LROOT="$T_VAULT/pattern/taste-vault"
  tx lint --root "$LROOT"; rc_ok=$RC
  tx lint --root "$LROOT" --min-entries 2 --families 2; rc_thr=$RC
  tx lint --root "$LROOT" --min-entries 3; rc_few=$RC
  tx lint --root "$LROOT" --families 1; rc_fam=$RC
  printf '%s\n' '---' 'type: reference' 'id: broken' 'family: dither-mono' 'source_url: "https://example.com"' '---' > "$LROOT/dither-mono/broken.md"
  tx lint --root "$LROOT"; rc_bad=$RC; err_bad="$ERR"
  rm "$LROOT/dither-mono/broken.md"
  sed -i.bak 's/^copy_brief: .*/copy_brief: "ask anna@example.com"/' "$LROOT/dither-mono/raw-grid.md" && rm -f "$LROOT/dither-mono/raw-grid.md.bak"
  tx lint --root "$LROOT"; rc_pii=$RC
  if [[ $rc_ok -eq 0 && $rc_thr -eq 0 && $rc_few -eq 1 && $rc_fam -eq 1 && $rc_bad -eq 1 && "$err_bad" == *"missing field keywords"* && $rc_pii -eq 1 ]]; then
    ok "T5 [FR-024] lint: valid vault exit 0, thresholds 2/2 ok, 3 entries or 1 family exit 1, missing field and PII exit 1"
  else bad "T5 [FR-024] lint (ok=$rc_ok thr=$rc_thr few=$rc_few fam=$rc_fam bad=$rc_bad pii=$rc_pii err=$err_bad)"; fi

  # T6 RED: in entry.cjs slug() or the family check in validateEntry() replace the regex/includes test by `return value` (traversal accepted).
  new_tvault
  tadd --family "../../escape"; r1=$RC
  tadd --family "dither-mono/../.."; r2=$RC
  tadd --id "../../../evil"; r3=$RC
  tadd --id "a/b"; r4=$RC
  tadd --family "no-such-family"; r5=$RC
  tadd --screenshot "../outside.png"; r6=$RC
  tadd --screenshot "/etc/passwd.png"; r7=$RC
  tadd --screenshot "shots/missing.png"; r8=$RC
  tadd --keywords $'ok\n---\ntype: evil'; r9=$RC
  tadd --keywords 'a, {{inject}}, <script>'; r10=$RC
  tadd --keywords '$(rm -rf x)'; r11=$RC
  tadd --source-url "javascript:alert(1)"; r12=$RC
  tadd --source-url "https://user:pw@example.com/"; r13=$RC
  tadd --copy-brief "$(head -c 10000 /dev/zero | tr '\0' 'a')"; r14=$RC; err14="$ERR"
  tadd --image-prompt $'line one\nfamily: evil'; r15=$RC
  n_hostile="$(tree_files)"
  bad_codes=0; for r in $r1 $r2 $r3 $r4 $r5 $r6 $r7 $r8 $r9 $r10 $r11 $r12 $r13 $r14 $r15; do [[ $r -eq 2 ]] || bad_codes=$((bad_codes + 1)); done
  if [[ $bad_codes -eq 0 && $n_hostile -eq 0 && ! -e "$T_VAULT/../escape" && ! -e "$T_VAULT/evil.md" && "$err14" == *"longer than"* ]]; then
    ok "T6 [FR-024] 15 hostile inputs (traversal, injection-shaped, 10 000-char brief, bad URL) exit 2, 0 files written"
  else bad "T6 [FR-024] hostile (non-2 codes=$bad_codes files=$n_hostile codes=$r1,$r2,$r3,$r4,$r5,$r6,$r7,$r8,$r9,$r10,$r11,$r12,$r13,$r14,$r15)"; fi

  # T6b RED: in taste.cjs ensureFamilyDir() delete the `inside(rootReal, fs.realpathSync(cur))` check (and the symlink test).
  new_tvault; mk_workdir T_OUT ux-t-out
  mkdir -p "$T_VAULT/pattern/taste-vault"; ln -s "$T_OUT" "$T_VAULT/pattern/taste-vault/dither-mono"
  tadd; rc_link=$RC; n_out="$(find "$T_OUT" -type f | grep -c .)"
  # duplicate id: exit 1, original kept
  new_tvault; tadd; before="$(cat "$T_VAULT/pattern/taste-vault/dither-mono/raw-grid.md")"; tadd --copy-brief "Different brief"; rc_dup=$RC
  after="$(cat "$T_VAULT/pattern/taste-vault/dither-mono/raw-grid.md")"
  # unset vault root: exit 2 naming the variable, nothing written
  tx add --family dither-mono --id x --screenshot shots/ref.png --source-url "https://example.com" --keywords a --image-prompt p --copy-brief c; rc_unset=$RC
  if [[ $rc_link -eq 2 && $n_out -eq 0 && $rc_dup -eq 1 && "$before" == "$after" && $rc_unset -eq 2 && "$ERR" == *A1_VAULT_ROOT* ]]; then
    ok "T6b [FR-024] symlinked family dir out of the vault: exit 2, 0 files outside; duplicate id exit 1, original intact; no vault root exit 2"
  else bad "T6b [FR-024] write guard (link=$rc_link out=$n_out dup=$rc_dup unset=$rc_unset err=$ERR)"; fi
fi
