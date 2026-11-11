# Part 04 — diverge and converge boards (spec 024-ux-studio, FR-004/005/006/007/022).
#
# Drives the real run.cjs (pick, require-pick, reroll, board-check) against the boards in
# fixtures/boards/, rendered once from templates/board.html (see fixtures/SOURCES.txt).
# Each case header names the production change that turns it red (contract item 4).
# Vault and HOME are temp dirs; nothing touches the network.

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

B_CJS="$REPO_ROOT/skills/a1-ux-studio/scripts/run/run.cjs"
B_SKILL="$REPO_ROOT/skills/a1-ux-studio"
B_FX="$HERE/fixtures/boards"
B_DATE="2026-11-09"

# bx <args...> — run.cjs with the given args; sets RC, OUT, ERR.
bx() {
  ( cd "$A1_FX_ROOT" && env -u A1_VAULT_ROOT node "$B_CJS" "$@" >"$A1_FX_ROOT/b.out" 2>"$A1_FX_ROOT/b.err" )
  RC=$?
  OUT="$(cat "$A1_FX_ROOT/b.out")"
  ERR="$(cat "$A1_FX_ROOT/b.err")"
}

# new_run — temp vault plus a real run folder made by `run.cjs init`; sets B_RUN.
new_run() {
  mk_workdir B_VAULT ux-board-vault
  mkdir -p "$B_VAULT/project/demo"
  printf '%s\n' '{"aesthetic":"calm","reference":"","intent":{"text":"Pricing screen for a B2B SaaS."},"guardrails":{"always":[],"never":[]}}' > "$B_VAULT/brief.json"
  B_RUN="$( cd "$A1_FX_ROOT" && env A1_VAULT_ROOT="$B_VAULT" node "$B_CJS" init --project demo --spec s1 --screen pricing --brief "$B_VAULT/brief.json" --date "$B_DATE" 2>/dev/null )"
  mkdir -p "$B_RUN/boards/fonts"
}

# put_board <kind> <source-html> <family-id...> — board file plus the shipped fonts it needs.
put_board() {
  local kind="$1" src="$2"; shift 2
  cp "$src" "$B_RUN/boards/$kind.html"
  local f
  for f in "$@"; do
    mkdir -p "$B_RUN/boards/fonts/$f"
    cp "$B_SKILL/templates/fonts/$f/"*.woff2 "$B_RUN/boards/fonts/$f/"
  done
}

DIV_FAMS=(inter lora space-grotesk ibm-plex-mono playfair-display)
picks_lines() { sed -n '/^## Picks/,/^## /p' "$B_RUN/run.md" | grep -c '^- '; }

if ! node --check "$B_CJS" 2>/dev/null || [[ ! -f "$B_FX/diverge.html" ]]; then
  bad "B0 run.cjs parses and fixtures/boards/diverge.html exists"
else
  ok "B0 run.cjs parses, board fixtures present"

  # B1 RED: set DIVERGE_TILES = 4 in boards.cjs (the real 5-tile board then fails).
  new_run; put_board diverge "$B_FX/diverge.html" "${DIV_FAMS[@]}"
  n_tiles="$(grep -c '<section data-a1-tile' "$B_RUN/boards/diverge.html")"
  n_remote="$(grep -Eci 'https?://' "$B_RUN/boards/diverge.html")"
  n_fontrefs="$(grep -o 'url("fonts/[^"]*")' "$B_RUN/boards/diverge.html" | grep -c .)"
  missing=0
  while IFS= read -r ref; do [[ -f "$B_RUN/boards/$ref" ]] || missing=$((missing + 1)); done < <(grep -o 'url("fonts/[^"]*")' "$B_RUN/boards/diverge.html" | sed 's/^url("//; s/")$//')
  bx board-check --run-dir "$B_RUN" --kind diverge
  if [[ $RC -eq 0 && "$OUT" == *"diverge: ok"* && $n_tiles -eq 5 && $n_remote -eq 0 && $n_fontrefs -eq 10 && $missing -eq 0 ]]; then
    ok "B1 real diverge board: exit 0, 5 tiles, 0 remote refs, 10 font refs all present"
  else
    bad "B1 diverge board (rc=$RC tiles=$n_tiles remote=$n_remote fontrefs=$n_fontrefs missing=$missing err='$ERR')"
  fi

  # B1a RED: return null early in fontFileProblem() (a missing font file then passes).
  rm "$B_RUN/boards/fonts/lora/lora-latin-700-normal.woff2"
  bx board-check --run-dir "$B_RUN" --kind diverge
  n_p="$(printf '%s\n' "$ERR" | grep -c '^- ')"
  if [[ $RC -eq 1 && "$ERR" == *"font file missing: fonts/lora/lora-latin-700-normal.woff2"* && $n_p -eq 1 ]]; then
    ok "B1a missing font file: exit 1, one problem naming the file"
  else
    bad "B1a missing font (rc=$RC problems=$n_p err='$ERR')"
  fi

  # B1b RED: make remoteProblems() return [] (remote references then pass).
  remote_case() { # <label> <sed-expression>
    new_run; put_board diverge "$B_FX/diverge.html" "${DIV_FAMS[@]}"
    sed "$2" "$B_FX/diverge.html" > "$B_RUN/boards/diverge.html"
    bx board-check --run-dir "$B_RUN" --kind diverge
    if [[ $RC -eq 1 && "$ERR" == *"remote resource reference"* ]]; then ok "B1b remote $1: exit 1"; else bad "B1b remote $1 (rc=$RC err='$ERR')"; fi
  }
  remote_case "https img" 's#<h3>Inter</h3>#<h3>Inter</h3><img src="https://cdn.example.com/x.png" alt="">#'
  remote_case "protocol-relative" 's#<h3>Inter</h3>#<h3>Inter</h3><img src="//cdn.example.com/x.png" alt="">#'
  remote_case "entity-encoded" 's#<h3>Inter</h3>#<h3>Inter</h3><img src="https\&\#58;//cdn.example.com/x.png" alt="">#'
  remote_case "css @import" 's#<style>#<style>@import url("//fonts.example.com/a.css");#'
  remote_case "inside a comment" 's#<h3>Inter</h3>#<h3>Inter</h3><!-- http://tracker.example.com -->#'

  # B1c RED: drop the `nested += 1` line in extractTiles() (a data-a1-tile inside a tile then dodges the count).
  new_run; put_board diverge "$B_FX/diverge.html" "${DIV_FAMS[@]}"
  sed 's#<h3>Inter</h3>#<h3>Inter</h3><div data-a1-tile data-option-id="extra" data-family="dm-sans"></div>#' "$B_FX/diverge.html" > "$B_RUN/boards/diverge.html"
  bx board-check --run-dir "$B_RUN" --kind diverge
  if [[ $RC -eq 1 && "$ERR" == *"nested inside another tile"* ]]; then ok "B1c data-a1-tile nested in a tile: exit 1"; else bad "B1c nested tile (rc=$RC err='$ERR')"; fi

  # B1c2 RED: drop the `stray += 1` branch in extractTiles() (a data-a1-tile <div> outside tiles then dodges the count).
  sed 's#</main>#<div data-a1-tile data-option-id="extra" data-family="dm-sans"></div></main>#' "$B_FX/diverge.html" > "$B_RUN/boards/diverge.html"
  bx board-check --run-dir "$B_RUN" --kind diverge
  if [[ $RC -eq 1 && "$ERR" == *"not <section>"* ]]; then ok "B1c2 data-a1-tile on a <div> outside tiles: exit 1"; else bad "B1c2 stray tile (rc=$RC err='$ERR')"; fi

  # B1d RED: remove a shipped family from font-allowlist.json check below (fixture guard on templates/fonts).
  n_ship=0; n_allowed=0; n_ofl=0
  for d in "$B_SKILL/templates/fonts"/*/; do
    id="$(basename "$d")"; n_ship=$((n_ship + 1))
    [[ -f "$d/OFL.txt" ]] && n_ofl=$((n_ofl + 1))
    if node -e 'const a=require(process.argv[1]);const id=process.argv[2];process.exit(a.families.some(f=>f.package==="@fontsource/"+id&&f.spdx==="OFL-1.1")?0:1)' "$B_SKILL/scripts/gate/font-allowlist.json" "$id"; then n_allowed=$((n_allowed + 1)); fi
  done
  if [[ $n_ship -ge 4 && $n_ship -le 6 && $n_allowed -eq $n_ship && $n_ofl -eq $n_ship ]]; then
    ok "B1d $n_ship shipped families: all OFL-1.1 in the allowlist, each with OFL.txt"
  else
    bad "B1d shipped fonts (families=$n_ship allowlisted=$n_allowed ofl=$n_ofl)"
  fi

  # B2 RED: compare data-layout values with `fams` instead of `layouts` in convergeProblems().
  new_run; put_board diverge "$B_FX/diverge.html" "${DIV_FAMS[@]}"
  bx pick --run-dir "$B_RUN" --board diverge --option lora --date "$B_DATE"
  put_board converge "$B_FX/converge.html" lora
  n_lay="$(grep -o 'data-layout="[a-z-]*"' "$B_RUN/boards/converge.html" | sort -u | grep -c .)"
  n_ct="$(grep -c '<section data-a1-tile' "$B_RUN/boards/converge.html")"
  bx board-check --run-dir "$B_RUN" --kind converge
  if [[ $RC -eq 0 && $n_ct -eq 3 && $n_lay -eq 3 ]]; then ok "B2 real converge board: exit 0, 3 tiles, 3 distinct layouts"; else bad "B2 converge (rc=$RC tiles=$n_ct layouts=$n_lay err='$ERR')"; fi

  # B2a RED: drop `|| dups(layouts).length` in convergeProblems() (two tiles with one layout then pass).
  sed 's#data-layout="split"#data-layout="stacked"#' "$B_FX/converge.html" > "$B_RUN/boards/converge.html"
  n_lay="$(grep -o 'data-layout="[a-z-]*"' "$B_RUN/boards/converge.html" | sort -u | grep -c .)"
  bx board-check --run-dir "$B_RUN" --kind converge
  n_p="$(printf '%s\n' "$ERR" | grep -c '^- ')"
  if [[ $RC -eq 1 && $n_lay -eq 2 && "$ERR" == *"3 distinct valid data-layout"* && $n_p -eq 1 ]]; then ok "B2a duplicate data-layout: exit 1, one layout problem"; else bad "B2a duplicate layout (rc=$RC layouts=$n_lay problems=$n_p err='$ERR')"; fi

  # B3 RED: drop the `dups(sigs)` line in convergeProblems() (colour-only variants then pass).
  put_board converge "$B_FX/converge-colour-only.html" lora
  bx board-check --run-dir "$B_RUN" --kind converge
  n_p="$(printf '%s\n' "$ERR" | grep -c '^- ')"
  if [[ $RC -eq 1 && "$ERR" == *"differ in element structure"* && $n_p -eq 1 ]]; then ok "B3 colour-only converge: exit 1, one structure problem"; else bad "B3 colour-only (rc=$RC problems=$n_p err='$ERR')"; fi

  # B3a RED: drop the pickedFamily line in convergeProblems() (another family then passes).
  bx pick --run-dir "$B_RUN" --board diverge --option inter --date "$B_DATE"
  put_board converge "$B_FX/converge.html" lora
  bx board-check --run-dir "$B_RUN" --kind converge
  if [[ $RC -eq 1 && "$ERR" == *'picked family "inter"'* ]]; then ok "B3a converge in a family other than the pick: exit 1"; else bad "B3a family mismatch (rc=$RC err='$ERR')"; fi

  # B4 RED: in withEntry() keep old board lines (drop the `!drop(...)` filter) — a repeat pick then adds a line.
  new_run; put_board diverge "$B_FX/diverge.html" "${DIV_FAMS[@]}"
  before_rest="$(sed '/^## Picks/,/^## Assets/d' "$B_RUN/run.md")"
  bx pick --run-dir "$B_RUN" --board diverge --option lora --date "$B_DATE"
  rc1=$RC
  bx pick --run-dir "$B_RUN" --board diverge --option lora --date "$B_DATE"
  n_line="$(grep -c '^- diverge: family=lora variant=lora date=2026-11-09$' "$B_RUN/run.md")"
  after_rest="$(sed '/^## Picks/,/^## Assets/d' "$B_RUN/run.md")"
  if [[ $rc1 -eq 0 && $RC -eq 0 && $n_line -eq 1 && "$(picks_lines)" -eq 1 && "$before_rest" == "$after_rest" ]]; then
    ok "B4 repeated pick: one line with family, variant and date; rest of run.md unchanged"
  else
    bad "B4 duplicate pick (rc=$rc1/$RC lines=$n_line all=$(picks_lines))"
  fi

  # B4a RED: skip the findTile() refusal in pick() (an unknown option is then recorded).
  sig="$(cksum < "$B_RUN/run.md")"
  bx pick --run-dir "$B_RUN" --board diverge --option nosuchtile --date "$B_DATE"
  if [[ $RC -eq 1 && "$(cksum < "$B_RUN/run.md")" == "$sig" ]]; then ok "B4a unknown option id: exit 1, run.md unchanged"; else bad "B4a unknown option (rc=$RC err='$ERR')"; fi

  # B5 RED: return 0 from requirePick() when no pick exists.
  new_run; put_board diverge "$B_FX/diverge.html" "${DIV_FAMS[@]}"
  bx require-pick --run-dir "$B_RUN" --board diverge
  rc_none=$RC; err_none="$ERR"
  bx pick --run-dir "$B_RUN" --board diverge --option inter --date "$B_DATE"
  bx require-pick --run-dir "$B_RUN" --board diverge
  if [[ $rc_none -eq 1 && "$err_none" == *"no pick recorded for diverge"* && $RC -eq 0 && "$OUT" == "diverge: family=inter variant=inter" ]]; then
    ok "B5 require-pick: exit 1 before a pick, exit 0 after"
  else
    bad "B5 require-pick (none=$rc_none after=$RC out='$OUT')"
  fi

  # B5a RED: delete the require-pick step from workflows/03-converge.md (converge could start without a pick).
  conv="$B_SKILL/workflows/03-converge.md"
  first_rp="$(grep -n 'require-pick --board diverge' "$conv" | head -n 1 | cut -d: -f1)"
  first_bc="$(grep -n 'board-check --kind converge\|board-check.*--kind converge' "$conv" | head -n 1 | cut -d: -f1)"
  if [[ -n "$first_rp" && -n "$first_bc" && "$first_rp" -lt "$first_bc" ]]; then ok "B5a converge workflow calls require-pick --board diverge before rendering"; else bad "B5a converge gate (require-pick line='$first_rp' board-check line='$first_bc')"; fi

  # B5b (FR-007) RED: drop the `Default adopted:` label in pick().
  new_run; put_board diverge "$B_FX/diverge.html" "${DIV_FAMS[@]}"
  bx pick --run-dir "$B_RUN" --board diverge --default-adopted space-grotesk --date "$B_DATE"
  n_def="$(grep -c '^- diverge: Default adopted: space-grotesk family=space-grotesk variant=space-grotesk date=2026-11-09$' "$B_RUN/run.md")"
  rc_pick=$RC
  bx require-pick --run-dir "$B_RUN" --board diverge
  if [[ $rc_pick -eq 0 && $n_def -eq 1 && "$(picks_lines)" -eq 1 && $RC -eq 0 ]]; then ok "B5b default adopted: recorded once, flow advances"; else bad "B5b default adopted (rc=$rc_pick lines=$n_def req=$RC)"; fi

  # B6 RED: add "Run \`/design\` to render the board." to workflows/02-diverge.md.
  n_mention=0; n_bad=0
  while IFS= read -r line; do
    n_mention=$((n_mention + 1))
    lc="$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')"
    [[ "$lc" == *optional* ]] || n_bad=$((n_bad + 1))
  done < <(grep -h '/design' "$B_SKILL"/workflows/*.md)
  n_own="$(grep -l 'templates/board.html' "$B_SKILL/workflows/02-diverge.md" "$B_SKILL/workflows/03-converge.md" | grep -c .)"
  if [[ $n_bad -eq 0 && $n_own -eq 2 ]]; then ok "B6 /design: $n_mention mention(s), all optional; both board workflows render templates/board.html"; else bad "B6 /design (mentions=$n_mention not-optional=$n_bad own-board=$n_own)"; fi

  # B7 RED: drop the `rerolls[board]` refusal in reroll().
  new_run
  bx reroll --run-dir "$B_RUN" --board diverge --date "$B_DATE"
  rc1=$RC
  bx reroll --run-dir "$B_RUN" --board diverge --date "$B_DATE"
  n_rr="$(grep -c '^- diverge: reroll used date=2026-11-09$' "$B_RUN/run.md")"
  if [[ $rc1 -eq 0 && $RC -eq 1 && "$ERR" == *"stop and ask"* && $n_rr -eq 1 ]]; then ok "B7 reroll: first exit 0, second exit 1 (stop and ask), one line"; else bad "B7 reroll (rc=$rc1/$RC lines=$n_rr err='$ERR')"; fi

  # B8 RED: count all tiles (ignore data-variant0) in divergeProblems().
  v0='<section data-a1-tile data-variant0 data-option-id="variant0" data-family="lora" data-layout="default"><h3>Yours</h3></section>'
  six='<section data-a1-tile data-option-id="dm" data-family="dm-sans" data-layout="default"><h3>DM</h3></section>'
  new_run; put_board diverge "$B_FX/diverge.html" "${DIV_FAMS[@]}"
  node -e 'const fs=require("fs");const [f,add]=process.argv.slice(1);fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("</main>",add+"\n</main>"))' "$B_RUN/boards/diverge.html" "$v0"
  n8="$(grep -c '<section data-a1-tile' "$B_RUN/boards/diverge.html")"
  bx board-check --run-dir "$B_RUN" --kind diverge; rc_v0=$RC
  bx pick --run-dir "$B_RUN" --board diverge --option variant0 --date "$B_DATE"; rc_pv0=$RC
  put_board diverge "$B_FX/diverge.html" "${DIV_FAMS[@]}"
  node -e 'const fs=require("fs");const [f,add]=process.argv.slice(1);fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("</main>",add+"\n</main>"))' "$B_RUN/boards/diverge.html" "$six"
  bx board-check --run-dir "$B_RUN" --kind diverge; rc_six=$RC; err_six="$ERR"
  put_board diverge "$B_FX/diverge.html" "${DIV_FAMS[@]}"
  node -e 'const fs=require("fs");const [f,add]=process.argv.slice(1);fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("</main>",add+add.replace(/variant0"/,"variant1\"")+"\n</main>"))' "$B_RUN/boards/diverge.html" "$v0"
  bx board-check --run-dir "$B_RUN" --kind diverge; rc_two=$RC
  if [[ $n8 -eq 6 && $rc_v0 -eq 0 && $rc_pv0 -eq 0 && $rc_six -eq 1 && "$err_six" == *"found 6"* && $rc_two -eq 1 ]]; then
    ok "B8 variant0: 5 + data-variant0 accepted and pickable; 6 without it and two variant0 tiles rejected"
  else
    bad "B8 variant0 (tiles=$n8 v0=$rc_v0 pick=$rc_pv0 six=$rc_six two=$rc_two err='$err_six')"
  fi

  # H hostile inputs: exit 2, run.md and boards unchanged, no command executed.
  # RED: replace requireId() with an identity function in rundir.cjs (unknown ids then reach findTile, exit 1).
  new_run; put_board diverge "$B_FX/diverge.html" "${DIV_FAMS[@]}"
  LONG="$(node -e 'process.stdout.write("a".repeat(10000))')"
  sig="$(cd "$B_RUN" && find . -type f | LC_ALL=C sort | while IFS= read -r f; do cksum "$f"; done)"
  bhostile() { # <label> <args...>
    local label="$1"; shift
    bx "$@"
    local now
    now="$(cd "$B_RUN" && find . -type f | LC_ALL=C sort | while IFS= read -r f; do cksum "$f"; done)"
    if [[ $RC -eq 2 && "$now" == "$sig" && ! -e "$A1_FX_ROOT/p" && ! -e "$B_VAULT/x" ]]; then ok "H $label: exit 2, nothing written"; else bad "H $label (rc=$RC err='$ERR')"; fi
  }
  bhostile "option ../../x" pick --run-dir "$B_RUN" --board diverge --option ../../x
  bhostile "option command substitution" pick --run-dir "$B_RUN" --board diverge --option '$(touch p)'
  bhostile "option 10000 chars" pick --run-dir "$B_RUN" --board diverge --option "$LONG"
  bhostile "option uppercase" pick --run-dir "$B_RUN" --board diverge --option Lora
  bhostile "option with newline" pick --run-dir "$B_RUN" --board diverge --option $'lora\n## Picks'
  bhostile "default-adopted traversal" pick --run-dir "$B_RUN" --board diverge --default-adopted ../x
  bhostile "option and default together" pick --run-dir "$B_RUN" --board diverge --option lora --default-adopted lora
  bhostile "board traversal" pick --run-dir "$B_RUN" --board ../diverge --option lora
  bhostile "kind unknown" board-check --run-dir "$B_RUN" --kind result
  bhostile "run-dir missing" board-check --run-dir "$B_RUN/../nope" --kind diverge
  bhostile "run-dir without run.md" board-check --run-dir "$B_RUN/boards" --kind diverge
  bhostile "run-dir 10000 chars" require-pick --run-dir "$LONG" --board diverge
  bhostile "date injection" reroll --run-dir "$B_RUN" --board diverge --date '$(touch p)'
fi
