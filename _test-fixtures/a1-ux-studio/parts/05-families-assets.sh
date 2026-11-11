# Part 05 — families and assets (spec 024-ux-studio, FR-008/016/017/025).
#
# Drives the real run.cjs (families, asset-slot, asset-missing) with a stub imagegen on a temp
# HOME. Every case header names the single production line whose change turns it red.
# Vault and HOME are temp dirs; nothing touches the network or the real ~/.claude.

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

F_CJS="$REPO_ROOT/skills/a1-ux-studio/scripts/run/run.cjs"
F_DATA="$REPO_ROOT/skills/a1-ux-studio/scripts/run/families.json"
F_STUB="$HERE/fixtures/imagegen/generate.py"
F_DATE="2026-11-11"

# fx <args...> — run.cjs in the current F_HOME; sets RC, OUT, ERR.
fx() {
  ( cd "$A1_FX_ROOT" && env -u A1_VAULT_ROOT HOME="$F_HOME" node "$F_CJS" "$@" >"$A1_FX_ROOT/f.out" 2>"$A1_FX_ROOT/f.err" )
  RC=$?
  OUT="$(cat "$A1_FX_ROOT/f.out")"
  ERR="$(cat "$A1_FX_ROOT/f.err")"
}

# jq_ <json> <js-expression over d> — prints the expression result.
jq_() { node -e 'const d=JSON.parse(process.argv[1]);const r=eval(process.argv[2]);process.stdout.write(String(r))' "$1" "$2"; }

# new_frun [stub|nostub] — temp HOME (with the imagegen stub), temp vault and a real run folder; sets F_HOME, F_VAULT, F_RUN.
new_frun() {
  mk_workdir F_HOME ux-f-home
  if [[ "${1:-stub}" == stub ]]; then
    mkdir -p "$F_HOME/.claude/skills/imagegen/scripts"
    cp "$F_STUB" "$F_HOME/.claude/skills/imagegen/scripts/generate.py"
  fi
  mk_workdir F_VAULT ux-f-vault
  mkdir -p "$F_VAULT/project/demo"
  printf '%s\n' '{"aesthetic":"calm","reference":"","intent":{"text":"Pricing screen for a B2B SaaS."},"guardrails":{"always":[],"never":[]}}' > "$F_VAULT/brief.json"
  F_RUN="$( cd "$A1_FX_ROOT" && env A1_VAULT_ROOT="$F_VAULT" node "$F_CJS" init --project demo --spec s1 --screen pricing --brief "$F_VAULT/brief.json" --date "$F_DATE" 2>/dev/null )"
}

assets_lines() { sed -n '/^## Assets/,/^## /p' "$F_RUN/run.md" | grep -c "$1"; }

if ! node --check "$F_CJS" 2>/dev/null || [[ ! -f "$F_STUB" ]] || ! command -v python3 >/dev/null 2>&1; then
  bad "F0 [FR-008] run.cjs parses, imagegen stub present, python3 available"
else
  ok "F0 [FR-008] run.cjs parses, imagegen stub present, python3 available"
  new_frun
  F_EMPTY="$A1_FX_ROOT/empty-claude.md"; printf '# Project\nNo design system here.\n' > "$F_EMPTY"

  # F7 RED: add a 9th family object to families.json (count assert fails); or put an unlisted skill on one.
  n_fam="$(node -e 'const d=require(process.argv[1]);process.stdout.write(String(d.families.length))' "$F_DATA")"
  n_badskill="$(node -e 'const d=require(process.argv[1]);const ok=new Set(["design-taste-frontend","minimalist-ui","industrial-brutalist-ui","ui-ux-pro-max","frontend-design","n3urala1-design","vf-brand","wada-farben"]);process.stdout.write(String(d.families.filter(f=>f.skills.length<1||f.skills.some(s=>!ok.has(s))).length))' "$F_DATA")"
  if [[ $n_fam -eq 8 && $n_badskill -eq 0 ]]; then ok "F7 [FR-025] built-in data file: 8 families, each mapped only to allowed style skills"; else bad "F7 [FR-025] families.json (families=$n_fam badskill=$n_badskill)"; fi

  # F1 RED: in families.cjs orderForContext() drop the `!loadsTaste(f)` filter (product then offers taste families).
  fx families --context product --project-claude-md "$F_EMPTY" --vault-root "$F_VAULT"
  n_cand="$(jq_ "$OUT" 'd.candidates.length')"
  n_taste="$(jq_ "$OUT" 'd.candidates.filter(c=>c.skills.includes("design-taste-frontend")).length')"
  rc_p=$RC
  fx families --context brand --project-claude-md "$F_EMPTY" --vault-root "$F_VAULT"
  n_taste_b="$(jq_ "$OUT" 'd.candidates.filter(c=>c.skills.includes("design-taste-frontend")).length')"
  n_cand_b="$(jq_ "$OUT" 'd.candidates.length')"
  if [[ $rc_p -eq 0 && $RC -eq 0 && $n_cand -eq 5 && $n_taste -eq 0 && $n_cand_b -eq 5 && $n_taste_b -ge 1 ]]; then
    ok "F1 [FR-017] product: 5 candidates, 0 load design-taste-frontend; brand: 5 candidates, $n_taste_b may"
  else
    bad "F1 [FR-017] context filter (product=$n_cand/$n_taste brand=$n_cand_b/$n_taste_b rc=$rc_p/$RC err='$ERR')"
  fi

  # F2 RED: in families.cjs detectDesignSystems() return [] (the CLAUDE.md match is then ignored).
  for ds in n3urala1-design vf-brand; do
    cm="$A1_FX_ROOT/claude-$ds.md"; printf '# Project\n\nDesign system: `%s`.\n' "$ds" > "$cm"
    fx families --context brand --project-claude-md "$cm" --vault-root "$F_VAULT"
    n_only="$(jq_ "$OUT" "d.candidates.filter(c=>c.skills.length===1&&c.skills[0]===\"$ds\"&&c.source===\"design-system\").length")"
    if [[ $RC -eq 0 && "$(jq_ "$OUT" 'd.source')" == design-system && "$(jq_ "$OUT" 'd.token_source')" == "skill:$ds" && $n_only -eq 5 ]]; then
      ok "F2 [FR-016] CLAUDE.md naming $ds: source design-system, 5 candidates restricted to it, token source skill:$ds"
    else
      bad "F2 [FR-016] design system $ds (rc=$RC restricted=$n_only out=${OUT:0:120} err='$ERR')"
    fi
  done

  # F2a RED: in detectDesignSystems() drop the `($|[^A-Za-z0-9_-])` boundary (n3urala1-designer then matches).
  cm="$A1_FX_ROOT/claude-near.md"; printf 'We use n3urala1-designer notes and my-vf-brand-x.\n' > "$cm"
  fx families --context brand --project-claude-md "$cm" --vault-root "$F_VAULT"
  if [[ $RC -eq 0 && "$(jq_ "$OUT" 'd.source')" != design-system ]]; then ok "F2a [FR-016] near-miss names (n3urala1-designer, my-vf-brand-x) are not design systems"; else bad "F2a [FR-016] near-miss (rc=$RC out=${OUT:0:100})"; fi

  # F3 RED: in families.cjs poolResult() drop the `fromVault.length === 0` fallback branch (an empty vault then returns nothing).
  EV="$A1_FX_ROOT/vault-empty"; mkdir -p "$EV/pattern/taste-vault"
  NV="$A1_FX_ROOT/vault-none"; mkdir -p "$NV"
  for v in "$EV" "$NV" "$A1_FX_ROOT/vault-does-not-exist"; do
    fx families --context brand --project-claude-md "$F_EMPTY" --vault-root "$v"
    if [[ $RC -eq 0 && "$(jq_ "$OUT" 'd.source')" == builtin && "$(jq_ "$OUT" 'd.pool.length')" -eq 8 && "$(jq_ "$OUT" 'd.candidates.length')" -eq 5 ]]; then
      ok "F3 [FR-016] vault $(basename "$v"): built-in list, pool of 8 families, 5 candidates"
    else
      bad "F3 [FR-016] vault $(basename "$v") (rc=$RC out=${OUT:0:120} err='$ERR')"
    fi
  done

  # F3a RED: in vaultFamilies() skip the entry parsing (return `counts` before the loop; vault then looks empty).
  VV="$A1_FX_ROOT/vault-full"; mkdir -p "$VV/pattern/taste-vault"
  for pair in print-tech-paper:1 print-tech-paper:2 dither-mono:1 classical-remix:1 not-a-family:1; do
    printf -- '---\nfamily: %s\nsource: https://example.test/x\n---\nbody\n' "${pair%%:*}" > "$VV/pattern/taste-vault/e-${pair%%:*}-${pair##*:}.md"
  done
  n_files="$(find "$VV/pattern/taste-vault" -name '*.md' | grep -c .)"
  fx families --context brand --project-claude-md "$F_EMPTY" --vault-root "$VV"
  n_vault="$(jq_ "$OUT" 'd.candidates.filter(c=>c.source==="vault").length')"
  n_top="$(jq_ "$OUT" 'd.candidates.filter(c=>c.source==="builtin").length')"
  n_pool="$(jq_ "$OUT" 'd.pool.length')"
  n_entries="$(jq_ "$OUT" 'd.candidates.filter(c=>c.id==="print-tech-paper")[0].entries')"
  if [[ $RC -eq 0 && $n_files -eq 5 && "$(jq_ "$OUT" 'd.source')" == vault && $n_vault -eq 3 && $n_top -eq 2 && $n_pool -eq 3 && $n_entries -eq 2 && "$(jq_ "$OUT" 'd.warnings.filter(w=>w.includes("\"not-a-family\" is not in the built-in catalog")).length')" -eq 1 ]]; then
    ok "F3a [FR-016] vault with 3 known families: source vault, 3 vault + 2 top-up candidates, unknown family warned"
  else
    bad "F3a [FR-016] vault pool (rc=$RC files=$n_files vault=$n_vault top=$n_top pool=$n_pool entries=$n_entries err='$ERR')"
  fi

  # F4 RED: in designSystemResult() delete the `warnings.push(... the design system wins)` line.
  printf '%s\n' '{"always":[],"never":["Never use Inter for headings"]}' > "$A1_FX_ROOT/guard.json"
  fx families --context brand --project-claude-md "$A1_FX_ROOT/claude-n3urala1-design.md" --vault-root "$F_VAULT" --guardrails "$A1_FX_ROOT/guard.json"
  n_w="$(jq_ "$OUT" 'd.warnings.length')"
  n_keep="$(jq_ "$OUT" 'd.candidates.filter(c=>c.fonts.length===1&&c.fonts[0]==="Inter").length')"
  if [[ $RC -eq 0 && $n_w -eq 1 && "$OUT" == *'conflicts with design system n3urala1-design font Inter; the design system wins'* && $n_keep -eq 5 ]]; then
    ok "F4 [FR-016] guardrail 'never Inter' vs design-system font: one warning, design-system font kept on 5 candidates"
  else
    bad "F4 [FR-016] guardrail conflict (rc=$RC warnings=$n_w kept=$n_keep err='$ERR')"
  fi

  # F5 RED: in assets.cjs generate() build argv with a shell string instead of an array — here: drop the `--out=` argument.
  new_frun
  fx asset-slot --run-dir "$F_RUN" --name hero --prompt '$(touch p) "quoted" --flag'
  n_png="$(find "$F_RUN/assets" -name 'hero.png' | grep -c .)"; n_json="$(find "$F_RUN/assets" -name 'hero.json' | grep -c .)"
  lit="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.prompt)' "$F_RUN/assets/hero.json")"
  if [[ $RC -eq 0 && $n_png -eq 1 && $n_json -eq 1 && "$lit" == '$(touch p) "quoted" --flag' && ! -e "$A1_FX_ROOT/p" && "$(assets_lines '^- slot 1: hero generated file=assets/hero.png$')" -eq 1 ]]; then
    ok "F5 [FR-008] asset-slot: image and sidecar in assets/, slot recorded, prompt passed as one literal argument"
  else
    bad "F5 [FR-008] asset-slot (rc=$RC png=$n_png json=$n_json prompt='$lit' err='$ERR')"
  fi

  # F5a RED: in assetSlot() drop the duplicate-name refusal (`slots.some(...)`).
  sig="$(cksum < "$F_RUN/run.md")"
  fx asset-slot --run-dir "$F_RUN" --name hero --prompt again
  if [[ $RC -eq 1 && "$ERR" == *"already has a slot"* && "$(cksum < "$F_RUN/run.md")" == "$sig" ]]; then ok "F5a [FR-008] same asset name twice: exit 1, run.md unchanged"; else bad "F5a [FR-008] duplicate name (rc=$RC err='$ERR')"; fi

  # F6 RED: in assets.cjs set MAX_SLOTS = 9 (the 9th call then needs no approval).
  new_frun
  rc_all=0
  for i in 1 2 3 4 5 6 7 8; do fx asset-slot --run-dir "$F_RUN" --name "img-$i" --prompt "image $i"; [[ $RC -eq 0 ]] || rc_all=$RC; done
  n8="$(assets_lines '^- slot [0-9]*: img-[0-9]* generated')"
  fx asset-slot --run-dir "$F_RUN" --name img-9 --prompt "image 9"
  rc9=$RC; err9="$ERR"; n_after="$(assets_lines '^- slot')"; png9="$(find "$F_RUN/assets" -name 'img-9.png' | grep -c .)"
  fx asset-slot --run-dir "$F_RUN" --name img-9 --prompt "image 9" --approved
  rc9a=$RC; n_final="$(assets_lines '^- slot')"; png9a="$(find "$F_RUN/assets" -name 'img-9.png' | grep -c .)"
  if [[ $rc_all -eq 0 && $n8 -eq 8 && $rc9 -eq 1 && "$err9" == *"question:"*"Ask Robert"* && $n_after -eq 8 && $png9 -eq 0 && $rc9a -eq 0 && $n_final -eq 9 && $png9a -eq 1 ]]; then
    ok "F6 [FR-008] 8 slots generate; the 9th exits 1 with a question and writes nothing; with --approved exits 0"
  else
    bad "F6 [FR-008] cap (first8=$rc_all/$n8 ninth=$rc9 slots=$n_after png=$png9 approved=$rc9a/$n_final/$png9a err='$err9')"
  fi

  # F8 RED: in assetSlot() drop the `applyPlaceholder(runDir, name)` call after a failed generation.
  new_frun
  mkdir -p "$F_RUN/result"
  printf '<!doctype html><html><body><img src="../assets/hero.png" alt="Hero" data-a1-asset="hero"><img src="../assets/side.png" alt="Side" data-a1-asset="side"></body></html>\n' > "$F_RUN/result/result.html"
  fx asset-slot --run-dir "$F_RUN" --name hero --prompt 'FAIL-IMAGEGEN please'
  n_ph="$(grep -o 'data-a1-asset-placeholder="hero"' "$F_RUN/result/result.html" | grep -c .)"
  n_img_hero="$(grep -o '<img[^>]*data-a1-asset="hero"' "$F_RUN/result/result.html" | grep -c .)"
  n_img_side="$(grep -o '<img[^>]*data-a1-asset="side"' "$F_RUN/result/result.html" | grep -c .)"
  n_label="$(grep -c 'Placeholder: image "hero" not generated' "$F_RUN/result/result.html")"
  n_miss="$(assets_lines '^- missing: hero reason=imagegen exited with status 1$')"
  n_png="$(find "$F_RUN/assets" -name 'hero.png' 2>/dev/null | grep -c .)"
  if [[ $RC -eq 1 && "$ERR" == *"missing: hero"* && $n_ph -eq 1 && $n_img_hero -eq 0 && $n_img_side -eq 1 && $n_label -eq 1 && $n_miss -eq 1 && $n_png -eq 0 ]]; then
    ok "F8 [FR-008] imagegen failure: exit 1, labeled placeholder in result.html, hero listed under run.md ## Assets, other images untouched"
  else
    bad "F8 [FR-008] imagegen failure (rc=$RC ph=$n_ph img=$n_img_hero/$n_img_side label=$n_label missing=$n_miss png=$n_png err='$ERR')"
  fi

  # F8a RED: in assets.cjs generate() delete the `if (!isRegularFile(script)) return 'imagegen is not installed'` line.
  new_frun nostub
  fx asset-slot --run-dir "$F_RUN" --name hero --prompt 'any'
  if [[ $RC -eq 1 && "$ERR" == *"imagegen is not installed"* && "$(assets_lines '^- missing: hero')" -eq 1 ]]; then ok "F8a [FR-008] imagegen not installed: exit 1, hero recorded as missing"; else bad "F8a [FR-008] no imagegen (rc=$RC err='$ERR')"; fi

  # F8b RED: in assets.cjs generate() drop ` || !isRegularFile(path.join(dir, `${name}.json`))` from the success test.
  new_frun
  fx asset-slot --run-dir "$F_RUN" --name hero --prompt 'NO-SIDECAR'
  if [[ $RC -eq 1 && "$ERR" == *"wrote no image and sidecar"* && "$(assets_lines '^- missing: hero')" -eq 1 && "$(assets_lines '^- slot 1: hero missing$')" -eq 1 ]]; then ok "F8b [FR-008] image without sidecar: exit 1, recorded as missing"; else bad "F8b [FR-008] no sidecar (rc=$RC err='$ERR')"; fi

  # F9 RED: in assetMissing() drop the `withoutMissing(...)` filter (a repeat call then adds a second line).
  new_frun
  mkdir -p "$F_RUN/result"
  printf '<img src="x.png" alt="" data-a1-asset="hero">\n' > "$F_RUN/result/result.html"
  fx asset-missing --run-dir "$F_RUN" --name hero --reason 'declined at the cap'
  rc1=$RC
  fx asset-missing --run-dir "$F_RUN" --name hero --reason 'declined at the cap'
  rc2=$RC
  fx asset-missing --run-dir "$F_RUN"
  if [[ $rc1 -eq 0 && $rc2 -eq 0 && "$(assets_lines '^- missing: hero')" -eq 1 && "$OUT" == hero && "$(grep -c 'data-a1-asset-placeholder="hero"' "$F_RUN/result/result.html")" -eq 1 && "$(assets_lines '^- slot')" -eq 0 ]]; then
    ok "F9 [FR-008] asset-missing: idempotent single line, placeholder applied, list mode prints the name, no slot used"
  else
    bad "F9 [FR-008] asset-missing (rc=$rc1/$rc2 lines=$(assets_lines '^- missing: hero') out='$OUT')"
  fi

  # F10 RED: in assets.cjs assetsDir() delete the `if (!inside(runDir, fs.realpathSync(dir))) throw ...` line (a symlinked assets/ is then followed).
  new_frun
  OUTSIDE="$A1_FX_ROOT/outside-assets"; mkdir -p "$OUTSIDE"; ln -s "$OUTSIDE" "$F_RUN/assets"
  fx asset-slot --run-dir "$F_RUN" --name hero --prompt 'any'
  n_out="$(find "$OUTSIDE" -type f | grep -c .)"
  if [[ $RC -eq 1 && $n_out -eq 0 && "$ERR" == *"outside the run folder"* ]]; then ok "F10 [FR-008] symlinked assets/: exit 1, nothing written outside the run folder"; else bad "F10 [FR-008] symlinked assets (rc=$RC outside=$n_out err='$ERR')"; fi

  # H hostile inputs: exit 2, nothing written, no command executed.
  # RED: in families.cjs drop the noDotDot() check on --vault-root, and in common.cjs requireSlug() the regex test.
  new_frun
  LONG="$(node -e 'process.stdout.write("a".repeat(10000))')"
  sig="$(cd "$F_RUN" && find . -type f | LC_ALL=C sort | while IFS= read -r f; do cksum "$f"; done)"
  fhostile() { # <label> <args...>
    local label="$1"; shift
    fx "$@"
    local now
    now="$(cd "$F_RUN" && find . -type f | LC_ALL=C sort | while IFS= read -r f; do cksum "$f"; done)"
    if [[ $RC -eq 2 && "$now" == "$sig" && ! -e "$A1_FX_ROOT/p" && ! -e "$F_VAULT/x" ]]; then ok "H [FR-008] $label: exit 2, nothing written"; else bad "H [FR-008] $label (rc=$RC err='$ERR')"; fi
  }
  fhostile "families claude-md traversal" families --project-claude-md "$F_RUN/../../x.md"
  fhostile "families claude-md missing" families --project-claude-md "$A1_FX_ROOT/nope.md"
  fhostile "families claude-md is a directory" families --project-claude-md "$A1_FX_ROOT"
  fhostile "families claude-md 10000 chars" families --project-claude-md "$LONG"
  fhostile "families claude-md command substitution" families --project-claude-md '$(touch p)'
  fhostile "families vault-root traversal" families --vault-root "$F_VAULT/../x"
  fhostile "families vault-root 10000 chars" families --vault-root "$LONG"
  fhostile "families vault-root newline" families --vault-root $'a\nb'
  fhostile "families context unknown" families --context ../x
  fhostile "families guardrails not json" families --guardrails "$F_RUN/run.md"
  fhostile "asset-slot name traversal" asset-slot --run-dir "$F_RUN" --name ../x --prompt p
  fhostile "asset-slot name command substitution" asset-slot --run-dir "$F_RUN" --name '$(touch p)' --prompt p
  fhostile "asset-slot name uppercase" asset-slot --run-dir "$F_RUN" --name Hero --prompt p
  fhostile "asset-slot name 10000 chars" asset-slot --run-dir "$F_RUN" --name "$LONG" --prompt p
  fhostile "asset-slot prompt 10000 chars" asset-slot --run-dir "$F_RUN" --name hero --prompt "$LONG"
  fhostile "asset-slot run-dir missing" asset-slot --run-dir "$F_RUN/../nope" --name hero --prompt p
  fhostile "asset-slot run-dir without run.md" asset-slot --run-dir "$A1_FX_ROOT" --name hero --prompt p
  fhostile "asset-missing name injection" asset-missing --run-dir "$F_RUN" --name $'hero\n## Assets' --reason r
  fhostile "asset-missing reason 10000 chars" asset-missing --run-dir "$F_RUN" --name hero --reason "$LONG"
  fhostile "asset-missing name without reason" asset-missing --run-dir "$F_RUN" --name hero
fi
