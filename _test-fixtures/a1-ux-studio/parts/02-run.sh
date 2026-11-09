# Part 02 — brief and run folder (spec 024-ux-studio, FR-002/003/018/031).
#
# Drives the real skills/a1-ux-studio/scripts/run/run.cjs. Each case header names the
# production change that turns it red (contract item 4). Vault, target repo and HOME are
# temp dirs; the URL case uses a closed loopback port (no network).

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

RUN_CJS="$REPO_ROOT/skills/a1-ux-studio/scripts/run/run.cjs"
RUN_FX="$HERE/fixtures/run"
RUN_DATE="2026-11-09"

# tree_sig <dir> — names plus checksums of everything below <dir>.
tree_sig() {
  ( cd "$1" && export LC_ALL=C && find . | sort && find . -type f | sort | while IFS= read -r f; do cksum "$f"; done )
}

# run_init <vault-or-empty> <args...> — sets RC, OUT (stdout), ERR (stderr). Runs inside $R_TARGET.
run_init() {
  local vault="$1"; shift
  if [[ -n "$vault" ]]; then
    ( cd "$R_TARGET" && env A1_VAULT_ROOT="$vault" node "$RUN_CJS" init "$@" >"$A1_FX_ROOT/run.out" 2>"$A1_FX_ROOT/run.err" )
  else
    ( cd "$R_TARGET" && env -u A1_VAULT_ROOT node "$RUN_CJS" init "$@" >"$A1_FX_ROOT/run.out" 2>"$A1_FX_ROOT/run.err" )
  fi
  RC=$?
  OUT="$(cat "$A1_FX_ROOT/run.out")"
  ERR="$(cat "$A1_FX_ROOT/run.err")"
}

# fresh_env — new vault with project "demo", a fake target repo, a brief copy with the reference path filled in.
fresh_env() {
  mk_workdir R_VAULT ux-run-vault
  mk_workdir R_TARGET ux-run-target
  mkdir -p "$R_VAULT/project/demo"
  printf 'sentinel\n' > "$R_TARGET/sentinel.txt"
  cp "$RUN_FX/reference-1x1.png" "$R_TARGET/ref.png"
  sed "s#REFPATH#$R_TARGET/ref.png#" "$RUN_FX/brief-complete.json" > "$R_TARGET/brief.json"
}

if ! node --check "$RUN_CJS" 2>/dev/null; then
  bad "R0 run.cjs exists and parses ($RUN_CJS)"
else
  ok "R0 run.cjs exists and parses"

  # R1 RED: drop the `if (!root) throw` A1_VAULT_ROOT check in vaultProject() (the script then writes under "undefined/").
  fresh_env
  sig_t="$(tree_sig "$R_TARGET")"; sig_h="$(tree_sig "$HOME")"
  run_init "" --project demo --spec s1 --screen pricing --brief "$R_TARGET/brief.json" --date "$RUN_DATE"
  if [[ $RC -eq 1 && "$ERR" == *"A1_VAULT_ROOT is not set"* && "$(tree_sig "$R_TARGET")" == "$sig_t" && "$(tree_sig "$HOME")" == "$sig_h" && ! -e "$R_TARGET/undefined" && -z "$OUT" ]]; then
    ok "R1 A1_VAULT_ROOT unset: exit 1, names the variable, target repo and HOME unchanged, no stdout"
  else
    bad "R1 A1_VAULT_ROOT unset (rc=$RC err='$ERR' out='$OUT')"
  fi

  # R2 RED: drop the vault project folder existence check in vaultProject() (mkdir -p would invent the project).
  fresh_env
  rm -rf "$R_VAULT/project/demo"
  sig_v="$(tree_sig "$R_VAULT")"; sig_t="$(tree_sig "$R_TARGET")"
  run_init "$R_VAULT" --project demo --spec s1 --screen pricing --brief "$R_TARGET/brief.json" --date "$RUN_DATE"
  if [[ $RC -eq 1 && "$ERR" == *"project/demo"* && "$ERR" == *A1_VAULT_ROOT* && "$(tree_sig "$R_VAULT")" == "$sig_v" && "$(tree_sig "$R_TARGET")" == "$sig_t" ]]; then
    ok "R2 vault project folder missing: exit 1, names it, vault and target unchanged"
  else
    bad "R2 vault project missing (rc=$RC err='$ERR')"
  fi

  # R3 RED: remove the empty-Intent test (`brief.intent.text === ''`) in init().
  fresh_env
  sig_v="$(tree_sig "$R_VAULT")"
  run_init "$R_VAULT" --project demo --spec s1 --screen pricing --brief "$RUN_FX/brief-empty-intent.json" --date "$RUN_DATE"
  n_ux="$(find "$R_VAULT" -name ux | grep -c .)"; n_boards="$(find "$R_VAULT" -name 'boards*' | grep -c .)"
  if [[ $RC -eq 1 && "$ERR" == *Intent* && "$n_ux" -eq 0 && "$n_boards" -eq 0 && "$(tree_sig "$R_VAULT")" == "$sig_v" ]]; then
    ok "R3 empty Intent: exit 1, asks for Intent, no run folder, no boards (ux dirs $n_ux, boards $n_boards)"
  else
    bad "R3 empty Intent (rc=$RC err='$ERR' ux=$n_ux boards=$n_boards)"
  fi

  # R4 RED: render the brief from defaults instead of the input (e.g. hard-code intent_text) in templateVars().
  fresh_env
  run_init "$R_VAULT" --project demo --spec s1 --screen pricing --brief "$R_TARGET/brief.json" --date "$RUN_DATE"
  RDIR="$R_VAULT/project/demo/ux/s1/$RUN_DATE-pricing"
  RMD="$RDIR/run.md"
  if [[ $RC -eq 0 && "$OUT" == "$RDIR" && -f "$RMD" ]]; then
    ok "R4a init exit 0, prints the run folder, run.md exists at the contract path"
    miss=0; checked=0
    for needle in \
      "Quiet editorial minimalism, warm paper tones, generous whitespace" \
      "$R_TARGET/ref.png" \
      "Pricing screen for a B2B SaaS; the visitor compares three plans and starts a trial. Marker \$& and {{status}} stay literal." \
      "Context: brand" "Viewport: mobile parity" \
      "- Keep contrast at WCAG AA" "- One primary action per section" \
      "- Stock photos of handshakes" "- Gradients on buttons" \
      "spec_id: s1" "project: demo" "screen: pricing" "created: $RUN_DATE" "status: brief"; do
      checked=$((checked + 1))
      grep -qFx -- "$needle" "$RMD" || grep -qF -- "$needle" "$RMD" || { miss=$((miss + 1)); echo "  missing in run.md: $needle" >&2; }
    done
    if [[ $miss -eq 0 && $checked -eq 14 ]]; then ok "R4b run.md holds the brief verbatim ($checked fragments)"; else bad "R4b run.md brief fragments missing $miss of $checked"; fi
    n_markers="$(grep -c -e '<!-- gate-record:start -->' -e '<!-- gate-record:end -->' "$RMD")"
    n_sections="$(grep -c -E '^## (Brief|Picks|Assets|Screenshots)$' "$RMD")"
    first="$(head -n 1 "$RMD")"
    if [[ "$n_markers" -eq 2 && "$n_sections" -eq 4 && "$first" == "---" ]]; then ok "R4c run.md has 4 sections, 2 gate markers, frontmatter at line 1"; else bad "R4c run.md structure (markers $n_markers, sections $n_sections, first '$first')"; fi
    n_files="$(find "$RDIR" -type f | grep -c .)"
    if [[ ! -e "$RDIR/boards" && "$n_files" -eq 1 ]]; then ok "R4d no boards/ yet, run folder holds exactly run.md (files $n_files)"; else bad "R4d unexpected files in run folder (count $n_files)"; fi
    if [[ -z "$ERR" ]]; then ok "R4e usable reference: no warning on stderr"; else bad "R4e usable reference warned: $ERR"; fi
  else
    bad "R4a init (rc=$RC err='$ERR' out='$OUT')"
  fi

  # R5 RED: reuse an existing folder instead of suffixing (return `dir` unchanged in createRunDir()).
  before="$(tree_sig "$RDIR")"
  run_init "$R_VAULT" --project demo --spec s1 --screen pricing --brief "$R_TARGET/brief.json" --date "$RUN_DATE"
  n_runs="$(find "$R_VAULT/project/demo/ux/s1" -mindepth 1 -maxdepth 1 -type d | grep -c .)"
  if [[ $RC -eq 0 && "$OUT" == "$RDIR-2" && -f "$RDIR-2/run.md" && "$n_runs" -eq 2 && "$(tree_sig "$RDIR")" == "$before" ]]; then
    ok "R5 second init for the same screen and day: -2 folder, first folder byte-identical (runs $n_runs)"
  else
    bad "R5 re-run (rc=$RC out='$OUT' runs=$n_runs err='$ERR')"
  fi

  # R6 RED: make checkReference() return null always (no warning).
  fresh_env
  warn_case() { # <label> <expected-fragment> <brief-file>
    local sig; run_init "$R_VAULT" --project demo --spec "$1" --screen scr --brief "$3" --date "$RUN_DATE"
    n_w="$(printf '%s\n' "$ERR" | grep -c '^warning: reference unusable: ')"
    if [[ $RC -eq 0 && "$n_w" -eq 1 && "$ERR" == *"$2"* && -f "$R_VAULT/project/demo/ux/$1/$RUN_DATE-scr/run.md" ]]; then
      ok "R$1 reference warning names the reference and the run folder is still created (warnings $n_w)"
    else
      bad "R$1 reference warning (rc=$RC warnings=$n_w err='$ERR')"
    fi
  }
  mkbrief() { # <file> <reference>
    node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));b.reference=process.argv[3];require("fs").writeFileSync(process.argv[2],JSON.stringify(b))' "$RUN_FX/brief-no-reference.json" "$1" "$2"
  }
  mkbrief "$R_TARGET/b-empty.json" ""
  warn_case 6a "(empty)" "$R_TARGET/b-empty.json"
  mkbrief "$R_TARGET/b-missing.json" "$R_TARGET/nope.png"
  warn_case 6b "$R_TARGET/nope.png" "$R_TARGET/b-missing.json"
  # closed loopback port: bind, read the port, close
  PORT="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
  mkbrief "$R_TARGET/b-url.json" "http://127.0.0.1:$PORT/ref.png"
  warn_case 6c "http://127.0.0.1:$PORT/ref.png" "$R_TARGET/b-url.json"
  # oversize: 20 MB + 1 byte sparse file
  node -e 'const fd=require("fs").openSync(process.argv[1],"w");require("fs").ftruncateSync(fd,20*1024*1024+1)' "$R_TARGET/big.png"
  mkbrief "$R_TARGET/b-big.json" "$R_TARGET/big.png"
  warn_case 6d "$R_TARGET/big.png" "$R_TARGET/b-big.json"
  mkbrief "$R_TARGET/b-file.json" "file:///etc/passwd"
  warn_case 6e "file:///etc/passwd" "$R_TARGET/b-file.json"

  # R7 RED: delete the enum checks for context/viewport in normalizeBrief().
  fresh_env
  sig_v="$(tree_sig "$R_VAULT")"
  for f in brief-bad-context brief-bad-viewport brief-malformed; do
    run_init "$R_VAULT" --project demo --spec s1 --screen pricing --brief "$RUN_FX/$f.json" --date "$RUN_DATE"
    if [[ $RC -eq 2 && "$(tree_sig "$R_VAULT")" == "$sig_v" ]]; then ok "R7 $f: exit 2, nothing written"; else bad "R7 $f (rc=$RC err='$ERR')"; fi
  done

  # R8 RED: delete the `templates/run.md` Brief section or add a clone mode word to a skill file (FR-018).
  BRIEF_TPL="$REPO_ROOT/skills/a1-ux-studio/templates/brief.md"
  if [[ -f "$BRIEF_TPL" ]] && grep -qi 'match the feeling, do not copy' "$BRIEF_TPL"; then
    ok "R8a templates/brief.md has 'match the feeling, do not copy'"
  else
    bad "R8a templates/brief.md missing or lacks 'match the feeling, do not copy'"
  fi
  n_files="$(find "$REPO_ROOT/skills/a1-ux-studio" -type f | grep -c .)"
  n_hits="$( (grep -rniE 'clone|pixel-exact|replicate site' "$REPO_ROOT/skills/a1-ux-studio" || true) | grep -viE 'clone or pixel-copy mode' | grep -c . )"
  if [[ "$n_hits" -eq 0 && "$n_files" -ge 12 ]]; then ok "R8b no clone/pixel-exact/replicate-site wording outside the hard-rule sentence (hits $n_hits in $n_files files)"; else bad "R8b clone wording hits $n_hits (files $n_files)"; fi

  # R9 spec-less ids: adhoc-<date>-<topic>. RED: drop the `adhoc-` prefix in init().
  fresh_env
  run_init "$R_VAULT" --project demo --topic pricing-page --screen hero --brief "$R_TARGET/brief.json" --date "$RUN_DATE"
  if [[ $RC -eq 0 && -f "$R_VAULT/project/demo/ux/adhoc-$RUN_DATE-pricing-page/$RUN_DATE-hero/run.md" ]]; then ok "R9 no spec: id is adhoc-<date>-<topic>"; else bad "R9 adhoc id (rc=$RC err='$ERR' out='$OUT')"; fi

  # H hostile inputs: exit 2, nothing written anywhere, no command executed.
  fresh_env
  LONG="$(node -e 'process.stdout.write("a".repeat(10000))')"
  sig_v="$(tree_sig "$R_VAULT")"; sig_t="$(tree_sig "$R_TARGET")"
  hostile() { # <label> <args...>
    local label="$1"; shift
    run_init "$R_VAULT" --project demo --brief "$R_TARGET/brief.json" --date "$RUN_DATE" "$@"
    if [[ $RC -eq 2 && "$(tree_sig "$R_VAULT")" == "$sig_v" && "$(tree_sig "$R_TARGET")" == "$sig_t" && ! -e "$R_TARGET/p" && ! -e "$R_VAULT/x" && ! -e "$R_VAULT/project/x" ]]; then
      ok "H $label: exit 2, nothing written"
    else
      bad "H $label (rc=$RC err='$ERR')"
    fi
  }
  hostile "screen ../../x" --spec s1 --screen ../../x
  hostile "screen command substitution" --spec s1 --screen '$(touch p)'
  hostile "spec traversal" --spec ../../x --screen pricing
  hostile "topic 10000 chars" --topic "$LONG" --screen pricing
  hostile "screen 10000 chars" --spec s1 --screen "$LONG"
  hostile "uppercase slug" --spec s1 --screen Pricing
  hostile "spec and topic together" --spec s1 --topic t --screen pricing
  hostile "bad date" --spec s1 --screen pricing --date '$(touch p)'
  run_init "$R_VAULT" --project '../demo' --spec s1 --screen pricing --brief "$R_TARGET/brief.json" --date "$RUN_DATE"
  if [[ $RC -eq 2 && "$(tree_sig "$R_VAULT")" == "$sig_v" ]]; then ok "H project ../demo: exit 2, nothing written"; else bad "H project traversal (rc=$RC)"; fi
fi
