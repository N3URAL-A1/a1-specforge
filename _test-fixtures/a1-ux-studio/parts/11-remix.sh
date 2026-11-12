# Part 11 — remix plan: amplitude, anchors, family rule (spec 024-ux-studio, FR-028).
#
# Drives the real remix.cjs, run.cjs init and taste.cjs add with a temp vault and temp HOME.
# Every case header names the single production line whose change turns it red.

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

RM_CJS="$REPO_ROOT/skills/a1-ux-studio/scripts/remix/remix.cjs"
RM_RUN="$REPO_ROOT/skills/a1-ux-studio/scripts/run/run.cjs"
RM_TASTE="$REPO_ROOT/skills/a1-ux-studio/scripts/taste/taste.cjs"
RM_SHOT="$HERE/fixtures/handoff/screenshot.png"

# rmx <args...> — remix.cjs; sets RC, OUT, ERR.
rmx() {
  ( cd "$A1_FX_ROOT" && env -u A1_VAULT_ROOT HOME="$FX_HOME" node "$RM_CJS" "$@" >"$A1_FX_ROOT/rm.out" 2>"$A1_FX_ROOT/rm.err" )
  RC=$?; OUT="$(cat "$A1_FX_ROOT/rm.out")"; ERR="$(cat "$A1_FX_ROOT/rm.err")"
}
rjq() { node -e 'const d=JSON.parse(process.argv[1]);process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"; }
# radd <family> <id> <keywords> — one taste entry in $RM_VAULT.
radd() {
  ( cd "$A1_FX_ROOT" && env -u A1_VAULT_ROOT HOME="$FX_HOME" node "$RM_TASTE" add --vault-root "$RM_VAULT" --family "$1" --id "$2" \
      --screenshot shots/ref.png --source-url "https://example.com/work/$2" --keywords "$3" \
      --image-prompt "monochrome hero, coarse grid, no text" --copy-brief "Plain declarative sentences." >/dev/null 2>&1 )
}
# new_rrun — fresh vault with two entries and a run folder whose converge pick is dither-mono; sets RM_VAULT, RM_DIR.
new_rrun() {
  mk_workdir RM_VAULT ux-rm-vault
  mkdir -p "$RM_VAULT/shots" "$RM_VAULT/project/demo" && cp "$RM_SHOT" "$RM_VAULT/shots/ref.png"
  radd dither-mono raw-grid "dither,mono,raw grid"
  radd monumental-editorial big-type "huge serif,hairline,paper white"
  printf '%s\n' '{"aesthetic":"calm","reference":"","intent":{"text":"Pricing screen."},"guardrails":{"always":[],"never":[]}}' > "$RM_VAULT/brief.json"
  RM_DIR="$( cd "$A1_FX_ROOT" && env A1_VAULT_ROOT="$RM_VAULT" HOME="$FX_HOME" node "$RM_RUN" init --project demo --spec s1 --screen pricing --brief "$RM_VAULT/brief.json" --date 2026-11-12 2>/dev/null )"
  awk '{print} /^## Picks$/ {print ""; print "- converge: family=dither-mono variant=split-hero date=2026-11-12"}' "$RM_DIR/run.md" > "$RM_DIR/run.md.new" && mv "$RM_DIR/run.md.new" "$RM_DIR/run.md"
}

if ! node --check "$RM_CJS" 2>/dev/null || [[ ! -f "$RM_SHOT" ]]; then
  bad "RM0 [FR-028] remix.cjs parses, screenshot fixture present"
else
  ok "RM0 [FR-028] remix.cjs parses, screenshot fixture present"

  # RM1 RED: in remix.cjs plan() delete the `hasOwnProperty.call(AMPLITUDES, args.amplitude)` refusal (any amplitude passes).
  new_rrun
  rmx plan --run-dir "$RM_DIR" --amplitude extreme --vault-root "$RM_VAULT"; rc_bad=$RC
  rmx plan --run-dir "$RM_DIR" --amplitude constructor --vault-root "$RM_VAULT"; rc_proto=$RC
  rmx plan --run-dir "$RM_DIR" --amplitude "" --vault-root "$RM_VAULT"; rc_empty=$RC
  n_after_bad="$(grep -c '^## Remix' "$RM_DIR/run.md")"
  rc_ok=0; for a in low mid high; do rmx plan --run-dir "$RM_DIR" --amplitude "$a" --vault-root "$RM_VAULT"; [[ $RC -eq 0 ]] || rc_ok=$RC; done
  if [[ $rc_bad -eq 2 && $rc_proto -eq 2 && $rc_empty -eq 2 && $n_after_bad -eq 0 && $rc_ok -eq 0 ]]; then
    ok "RM1 [FR-028] unknown amplitude (also an Object.prototype name, or empty) exits 2 and writes nothing; low, mid, high exit 0"
  else bad "RM1 [FR-028] amplitude (bad=$rc_bad proto=$rc_proto empty=$rc_empty remix=$n_after_bad ok=$rc_ok)"; fi

  # RM2 RED: in remix.cjs resolveAnchor() replace `hits.length === 0` with `false` (unknown anchor falls through).
  new_rrun; sha_run="$(shasum "$RM_DIR/run.md" | cut -d' ' -f1)"
  rmx plan --run-dir "$RM_DIR" --amplitude mid --anchors no-such-entry --vault-root "$RM_VAULT"; rc_unk=$RC; err_unk="$ERR"
  rmx plan --run-dir "$RM_DIR" --amplitude mid --anchors raw-grid,no-such-entry --vault-root "$RM_VAULT"; rc_unk2=$RC
  if [[ $rc_unk -eq 1 && $rc_unk2 -eq 1 && "$err_unk" == *"no-such-entry"* && "$(shasum "$RM_DIR/run.md" | cut -d' ' -f1)" == "$sha_run" ]]; then
    ok "RM2 [FR-028] an unknown anchor id exits 1 (also next to a valid one) and run.md stays byte-identical"
  else bad "RM2 [FR-028] unknown anchor (rc=$rc_unk/$rc_unk2 err=$err_unk)"; fi

  # RM3 RED: in remix.cjs plan() set `family: anchors.length === 0 ? original : ...` to `family: FAMILY_IDS[0]`.
  new_rrun
  rmx plan --run-dir "$RM_DIR" --amplitude low --vault-root "$RM_VAULT"; rc_zero=$RC
  fam0="$(rjq "$OUT" 'd.family')"; orig0="$(rjq "$OUT" 'd.original_family')"; n_anc0="$(rjq "$OUT" 'd.anchors.length')"
  rmx plan --run-dir "$RM_DIR" --amplitude low --anchors "" --vault-root "$RM_VAULT"; fam_empty="$(rjq "$OUT" 'd.family')"
  if [[ $rc_zero -eq 0 && "$fam0" == dither-mono && "$orig0" == dither-mono && $n_anc0 -eq 0 && "$fam_empty" == dither-mono ]] \
     && grep -q 'family=dither-mono original_family=dither-mono anchors=none' "$RM_DIR/run.md"; then
    ok "RM3 [FR-028] zero anchors: planned family id equals the original's (dither-mono), recorded in run.md"
  else bad "RM3 [FR-028] zero anchors (rc=$rc_zero fam=$fam0 orig=$orig0 empty=$fam_empty)"; fi

  # RM4 RED: in remix.cjs plan() drop `keywords` from the anchor line in planLines() (or resolveAnchor() returns no keywords).
  new_rrun
  rmx plan --run-dir "$RM_DIR" --amplitude high --anchors big-type --vault-root "$RM_VAULT"; rc_one=$RC
  kw="$(rjq "$OUT" 'd.anchors[0].keywords.join("|")')"; fam1="$(rjq "$OUT" 'd.family')"
  if [[ $rc_one -eq 0 && "$kw" == "huge serif|hairline|paper white" && "$fam1" == monumental-editorial ]] \
     && grep -q '^- anchor big-type: family=monumental-editorial keywords=huge serif, hairline, paper white$' "$RM_DIR/run.md"; then
    ok "RM4 [FR-028] one anchor: the plan carries that entry's 3 keywords (JSON and run.md)"
  else bad "RM4 [FR-028] one anchor (rc=$rc_one kw=$kw fam=$fam1 err=$ERR)"; fi

  # RM5 RED: in remix.cjs writeRemixSection() delete the strip of an existing `## Remix` section (a second plan appends).
  rmx plan --run-dir "$RM_DIR" --amplitude low --vault-root "$RM_VAULT"; rc_re=$RC
  n_sec="$(grep -c '^## Remix$' "$RM_DIR/run.md")"; n_rem="$(grep -c '^- remix: ' "$RM_DIR/run.md")"; n_old="$(grep -c 'anchor big-type' "$RM_DIR/run.md")"
  ord_ok="$(awk '/^## Picks$/{p=NR} /^## Remix$/{r=NR} /^## Assets$/{a=NR} END{print (p<r && r<a) ? "y" : "n"}' "$RM_DIR/run.md")"
  rmx plan --run-dir "$RM_DIR" --amplitude low --vault-root "$RM_VAULT"; rc_pk=$RC
  if [[ $rc_re -eq 0 && $n_sec -eq 1 && $n_rem -eq 1 && $n_old -eq 0 && "$ord_ok" == y && $rc_pk -eq 0 ]] \
     && grep -q '^- converge: family=dither-mono variant=split-hero date=2026-11-12$' "$RM_DIR/run.md"; then
    ok "RM5 [FR-028] a second plan replaces the Remix section (1 section, 1 plan line, between Picks and Assets); the pick line is intact"
  else bad "RM5 [FR-028] replan (rc=$rc_re sections=$n_sec plans=$n_rem old=$n_old order=$ord_ok)"; fi

  # RM6 RED: in remix.cjs originalFamily() delete the `!pick` refusal (a run without a pick is planned).
  new_rrun; mk_workdir RM_EMPTY ux-rm-empty
  awk '!/^- converge: /' "$RM_DIR/run.md" > "$RM_EMPTY/run.md"
  rmx plan --run-dir "$RM_EMPTY" --amplitude low --vault-root "$RM_VAULT"; rc_nopick=$RC
  rmx plan --run-dir "$A1_FX_ROOT/missing" --amplitude low --vault-root "$RM_VAULT"; rc_nodir=$RC
  rmx plan --run-dir "$RM_DIR" --amplitude low; rc_novault=$RC
  if [[ $rc_nopick -eq 1 && $rc_nodir -eq 2 && $rc_novault -eq 0 ]]; then
    ok "RM6 [FR-028] no pick in run.md: exit 1; missing run dir: exit 2 (a plan without anchors needs no vault)"
  else bad "RM6 [FR-028] preconditions (nopick=$rc_nopick nodir=$rc_nodir novault=$rc_novault)"; fi
  rmx plan --run-dir "$RM_DIR" --amplitude low --anchors raw-grid; rc_novault_anchor=$RC

  # RM7 RED: in remix.cjs parseAnchors() delete the id regex test (path-shaped ids reach the file lookup).
  new_rrun; sha_h="$(shasum "$RM_DIR/run.md" | cut -d' ' -f1)"
  rc_h=0; for bad_anchor in '../raw-grid' 'raw-grid/../../x' 'RAW-GRID' 'raw-grid,,big-type' 'raw-grid,raw-grid' 'a,b,c,d,e,f' '/etc/passwd' 'raw grid'; do
    rmx plan --run-dir "$RM_DIR" --amplitude low --anchors "$bad_anchor" --vault-root "$RM_VAULT"; [[ $RC -eq 2 ]] || rc_h="$bad_anchor=$RC"
  done
  ln -s "$RM_VAULT/pattern/taste-vault/dither-mono/raw-grid.md" "$RM_VAULT/pattern/taste-vault/monumental-editorial/linked.md"
  rmx plan --run-dir "$RM_DIR" --amplitude low --anchors linked --vault-root "$RM_VAULT"; rc_link=$RC
  if [[ "$rc_h" == 0 && $rc_link -eq 1 && "$rc_novault_anchor" -eq 2 && "$(shasum "$RM_DIR/run.md" | cut -d' ' -f1)" == "$sha_h" ]]; then
    ok "RM7 [FR-028] hostile anchors (traversal, case, empty, duplicate, 6 ids, absolute, space) exit 2; a symlinked entry is unknown (1); anchors without a vault exit 2"
  else bad "RM7 [FR-028] hostile anchors (bad=$rc_h link=$rc_link novault=$rc_novault_anchor)"; fi
fi
