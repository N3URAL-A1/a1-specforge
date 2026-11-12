# Part 10 — tweaks panel and token export (spec 024-ux-studio, FR-026, FR-027).
#
# Drives the real tweaks.cjs with a temp run folder and a copy of a spec fixture.
# Every case header names the single production line whose change turns it red.

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

TW_CJS="$REPO_ROOT/skills/a1-ux-studio/scripts/tweaks/tweaks.cjs"
TW_JS="$REPO_ROOT/skills/a1-ux-studio/templates/tweaks-panel.js"
TW_SPEC="$HERE/fixtures/tweaks/spec.md"
TW_PAGE="$HERE/fixtures/gate/high-contrast.html"

# twx <args...> — tweaks.cjs; sets RC, OUT, ERR.
twx() {
  ( cd "$A1_FX_ROOT" && env -u A1_VAULT_ROOT HOME="$FX_HOME" node "$TW_CJS" "$@" >"$A1_FX_ROOT/tw.out" 2>"$A1_FX_ROOT/tw.err" )
  RC=$?; OUT="$(cat "$A1_FX_ROOT/tw.out")"; ERR="$(cat "$A1_FX_ROOT/tw.err")"
}
TW_V1='{"font":"Inter","size":18,"accent":"#aa3355","motion":0.5}'
TW_V2='{"font":"Lora","size":20,"accent":"#112233","motion":1.5}'

if ! node --check "$TW_CJS" 2>/dev/null || [[ ! -f "$TW_SPEC" || ! -f "$TW_PAGE" || ! -f "$TW_JS" ]]; then
  bad "TW0 [FR-026] tweaks.cjs parses, panel template, spec and page fixtures present"
else
  ok "TW0 [FR-026] tweaks.cjs parses, panel template, spec and page fixtures present"

  mk_workdir TW_RUN ux-tw-run
  mkdir -p "$TW_RUN/result"; : > "$TW_RUN/run.md"; cp "$TW_PAGE" "$TW_RUN/result/result.html"
  before_sha="$(shasum "$TW_RUN/result/result.html" | cut -d' ' -f1)"

  # TW1 RED: in tweaks.cjs build() write `dev` to result.html instead of result.dev.html (panel leaks into the export).
  twx build --run-dir "$TW_RUN"; rc_build=$RC
  n_res="$(grep -c 'data-a1-tweaks' "$TW_RUN/result/result.html")"
  n_dev="$(grep -c 'data-a1-tweaks' "$TW_RUN/result/result.dev.html" 2>/dev/null)"
  after_sha="$(shasum "$TW_RUN/result/result.html" | cut -d' ' -f1)"
  n_ctl=0; for k in font size accent motion reset compare; do grep -q "'$k'" "$TW_RUN/result/result.dev.html" 2>/dev/null && n_ctl=$((n_ctl + 1)); done
  if [[ $rc_build -eq 0 && "$n_res" -eq 0 && "$n_dev" -ge 1 && "$before_sha" == "$after_sha" && $n_ctl -eq 6 ]]; then
    ok "TW1 [FR-026] build: dev copy holds the panel (6 controls), result.html has 0 data-a1-tweaks and is byte-identical"
  else bad "TW1 [FR-026] build (rc=$rc_build res=$n_res dev=$n_dev ctl=$n_ctl same=$([[ "$before_sha" == "$after_sha" ]] && echo y || echo n) err=$ERR)"; fi

  # TW1b RED: in tweaks.cjs build() delete the `html.includes(MARK)` refusal (a result with the panel is accepted).
  mk_workdir TW_RUN2 ux-tw-run2
  mkdir -p "$TW_RUN2/result"; : > "$TW_RUN2/run.md"; cp "$TW_RUN/result/result.dev.html" "$TW_RUN2/result/result.html"
  twx build --run-dir "$TW_RUN2"; rc_dirty=$RC
  twx build --run-dir "$A1_FX_ROOT/nope"; rc_nodir=$RC
  if [[ $rc_dirty -eq 1 && $rc_nodir -eq 2 ]]; then ok "TW1b [FR-026] build refuses a result that already holds the panel (1) and a missing run dir (2)"
  else bad "TW1b [FR-026] build refusals (dirty=$rc_dirty nodir=$rc_nodir)"; fi

  # TW2 RED: in tweaks.cjs exportTokens() splice the block at `decision + 2` instead of `decision + 1`.
  mk_workdir TW_D ux-tw-spec; TW_S="$TW_D/spec.md"; cp "$TW_SPEC" "$TW_S"
  twx export-tokens --spec "$TW_S" --screen login-screen --values "$TW_V1"; rc_e1=$RC
  ux_line="$(grep -n '^UX/login-screen:' "$TW_S" | cut -d: -f1)"
  next_line="$(sed -n "$((ux_line + 1))p" "$TW_S")"
  n_blk="$(grep -c 'a1-ux-tokens:start login-screen' "$TW_S")"
  if [[ $rc_e1 -eq 0 && "$next_line" == '<!-- a1-ux-tokens:start login-screen -->' && $n_blk -eq 1 ]] && grep -q 'accent: "#aa3355"' "$TW_S"; then
    ok "TW2 [FR-027] export-tokens: one token block directly under the UX/login-screen line"
  else bad "TW2 [FR-027] export (rc=$rc_e1 next=$next_line blocks=$n_blk err=$ERR)"; fi

  # TW3 RED: in tweaks.cjs exportTokens() replace `kept` by `rest` (append instead of replace).
  twx export-tokens --spec "$TW_S" --screen login-screen --values "$TW_V2"; rc_e2=$RC
  n_blk2="$(grep -c 'a1-ux-tokens:start login-screen' "$TW_S")"; n_yaml="$(grep -c '^design-tokens:' "$TW_S")"
  if [[ $rc_e2 -eq 0 && $n_blk2 -eq 1 && $n_yaml -eq 1 ]] && grep -q 'accent: "#112233"' "$TW_S" && ! grep -q '#aa3355' "$TW_S"; then
    ok "TW3 [FR-027] a second export replaces the block (1 block, new values, old values gone)"
  else bad "TW3 [FR-027] second export (rc=$rc_e2 blocks=$n_blk2 yaml=$n_yaml err=$ERR)"; fi

  # TW4 RED: in tweaks.cjs exportTokens() delete the `decision === -1` refusal; TW4b: drop bodyStart() (frontmatter searched).
  mk_workdir TW_D2 ux-tw-spec2; cp "$TW_SPEC" "$TW_D2/spec.md"; sha_spec="$(shasum "$TW_D2/spec.md" | cut -d' ' -f1)"
  twx export-tokens --spec "$TW_D2/spec.md" --screen other-screen --values "$TW_V1"; rc_none=$RC
  printf '%s\n' '---' 'UX/fm-screen: in frontmatter' '---' '' 'body' > "$TW_D2/fm.md"; sha_fm="$(shasum "$TW_D2/fm.md" | cut -d' ' -f1)"
  twx export-tokens --spec "$TW_D2/fm.md" --screen fm-screen --values "$TW_V1"; rc_fm=$RC
  if [[ $rc_none -eq 1 && $rc_fm -eq 1 && "$(shasum "$TW_D2/spec.md" | cut -d' ' -f1)" == "$sha_spec" && "$(shasum "$TW_D2/fm.md" | cut -d' ' -f1)" == "$sha_fm" ]]; then
    ok "TW4 [FR-027] no UX/<name> line (or only inside the frontmatter): exit 1, spec byte-identical"
  else bad "TW4 [FR-027] refusal (none=$rc_none fm=$rc_fm)"; fi

  # TW5 RED: in tweaks.cjs parseValues() drop the ACCENT_RE test; TW5b: drop the FONT_RE test.
  sha_b="$(shasum "$TW_S" | cut -d' ' -f1)"
  twx export-tokens --spec "$TW_S" --screen login-screen --values '{"font":"Inter","size":18,"accent":"red\n-->","motion":1}'; rc_h1=$RC
  twx export-tokens --spec "$TW_S" --screen login-screen --values '{"font":"Inter\n## x","size":18,"accent":"#aabbcc","motion":1}'; rc_h2=$RC
  twx export-tokens --spec "$TW_S" --screen login-screen --values '{"font":"Inter","size":18,"accent":"#aabbcc","motion":1,"x":1}'; rc_h3=$RC
  twx export-tokens --spec "$TW_S" --screen '../login' --values "$TW_V1"; rc_h4=$RC
  twx export-tokens --spec "$TW_S" --screen login-screen --values 'not json'; rc_h5=$RC
  if [[ $rc_h1 -eq 2 && $rc_h2 -eq 2 && $rc_h3 -eq 2 && $rc_h4 -eq 2 && $rc_h5 -eq 2 && "$(shasum "$TW_S" | cut -d' ' -f1)" == "$sha_b" ]]; then
    ok "TW5 [FR-027] hostile values (markup in accent/font, unknown key, bad screen, non-JSON) exit 2, spec untouched"
  else bad "TW5 [FR-027] hostile ($rc_h1 $rc_h2 $rc_h3 $rc_h4 $rc_h5)"; fi

  # TW6 RED: in tweaks.cjs build() delete the `/<\/script/i.test(js)` guard AND add the text `</script` to templates/tweaks-panel.js.
  n_close="$(grep -o '</script' "$TW_RUN/result/result.dev.html" | wc -l | tr -d ' ')"
  if [[ "$n_close" -eq 1 ]] && ! grep -qi '</script' "$TW_JS"; then ok "TW6 [FR-026] panel source holds no closing script tag; dev copy closes its script block once"; else bad "TW6 closing script tags (dev=$n_close)"; fi
fi
