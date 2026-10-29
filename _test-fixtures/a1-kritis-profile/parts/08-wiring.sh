# Part 08 — wiring of the kritis profile into a1-new-feature (spec
# 006-specforge-kritis-profile, Wave 8). Pins what Wave 8 wired; the goldens
# of part 01 are not repeated here.
#
# Guards and the one change that turns each red (proven on a scratch copy,
# edit applied with node, never sed -i; see the wave report):
#   B  block lint over the six prompt files: balanced, zero nesting, guard
#      sentence directly after every open marker, block count per file by
#      number (1/2/2/1/1/1).      Red: delete the guard line of one block;
#                                 add one more well-formed block to a file.
#   W  wiring greps, exact counts (resolve 1, set 1, nfr-inject 1,
#      ears-check 2, threat-model-check 1, simulate-check 1, simulate-roles 1,
#      Samuel spawn 1).           Red: delete one command line.
#   C  blank-slate clause count == brief sites inside blocks (3 == 3), and
#      every clause sits inside a block.  Red: delete one clause.
#   N  not_implemented count 0 over the six files.  Red: add the word.
#   D  block discipline vs GOLDEN_COMMIT: stripped file differs by 0 lines,
#      SKILL.md by exactly the German alias line.  Red: change one line
#      outside a block; change the alias text.
#   G  both gate rows registered, `gates lint` exit 0, no call_without_phase,
#      both gates wired (2 and 1 calls).  Red: drop a registry row; remove
#      --phase from the 04.5 ears-check call.
#   I  intent allowlist: 28 entries for new-feature and continue-feature,
#      the seven profile commands in, `profile trigger-check` on none.
#      Red: remove `profile set`; add `profile trigger-check`.
#   E  scripted chain resolve -> set -> resolve -> nfr-inject -> ears-check
#      -> threat-model-check (deterministic half of SC-001).
#      Red: break the model / add an untagged FR (negative legs).
#   S  SC-003 repo half: alias SKILL.md <= 40 lines, trigger-check exit 0.
#      Red: grow the alias past 40 lines.
#   M  MIGRATION.md: every target exists, ranges disjoint, sections A-I.
#      Red: point a row at a missing file; overlap two ranges; drop a row.

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

WIRE_GOLDEN="cb3fd99a6be44891d52b96cc4223f4897823e7c9"
WIRE_GUARD='**KRITIS profile only** — skip this block unless the run profile is `kritis`.'
WIRE_ALIAS='  "a1-new-feature", "erstelle eine Spezifikation" (German alias for "spec for <project>"),'
WIRE_STRIP="$HERE/fixtures/strip-blocks.cjs"
WIRE_SIX=(
  "skills/a1-new-feature/SKILL.md:1"
  "skills/a1-new-feature/workflows/02-specify.md:2"
  "skills/a1-new-feature/workflows/03-clarify.md:2"
  "skills/a1-new-feature/workflows/04.5-consistency-gate.md:1"
  "agents/a1-rene-requirement-engineer.md:1"
  "agents/a1-samuel-security.md:1"
)
WIRE_SCOPE=("$REPO_ROOT/skills/a1-new-feature" "$REPO_ROOT/agents/a1-rene-requirement-engineer.md" "$REPO_ROOT/agents/a1-samuel-security.md")
WIRE_PROFILE_FX="$HERE/fixtures"

# ---------- B: block lint ----------
caseWireBlockLint() {
  local entry rel want out rc n
  for entry in "${WIRE_SIX[@]}"; do
    rel="${entry%%:*}"; want="${entry##*:}"
    out="$(WIRE_GUARD="$WIRE_GUARD" node -e '
      const L = require("fs").readFileSync(process.argv[1], "utf8").split("\n");
      const OPEN = "<!-- a1-profile:kritis -->", CLOSE = "<!-- /a1-profile:kritis -->";
      let depth = 0, opens = 0, closes = 0, first = false; const p = [];
      L.forEach((raw, i) => {
        const t = raw.trim();
        if (first) { if (raw !== process.env.WIRE_GUARD) p.push("guard_not_first@" + (i + 1)); first = false; }
        if (t === OPEN) { opens++; depth++; first = true; if (depth > 1) p.push("nested@" + (i + 1)); }
        else if (t === CLOSE) { closes++; depth--; if (depth < 0) p.push("close_without_open@" + (i + 1)); }
      });
      if (depth !== 0) p.push("unbalanced");
      if (opens !== closes) p.push("opens_" + opens + "_closes_" + closes);
      console.log(opens + " " + p.join(","));
      process.exit(p.length ? 1 : 0);
    ' "$REPO_ROOT/$rel" 2>&1)"; rc=$?
    n="${out%% *}"
    if [[ "$rc" -eq 0 && "$n" == "$want" ]]; then
      ok "B $rel: $n block(s), balanced, no nesting, guard sentence first in each"
    else
      bad "B $rel: rc=$rc blocks=[$n] expected $want; $out"
    fi
  done
}
caseWireBlockLint

# ---------- W: wiring greps, exact counts ----------
wire_count() { grep -rhoF -- "$1" "${WIRE_SCOPE[@]}" | wc -l | tr -d ' '; }

caseWireGreps() {
  local pair pat want got
  for pair in 'a1-tools.cjs profile resolve|1' 'a1-tools.cjs profile set|1' \
              'a1-tools.cjs profile nfr-inject|1' 'a1-tools.cjs profile ears-check|2' \
              'a1-tools.cjs profile threat-model-check|1' 'a1-tools.cjs profile simulate-check|1' \
              'a1-tools.cjs profile simulate-roles|1' 'subagent_type: "a1-samuel-security"|1'; do
    pat="${pair%|*}"; want="${pair##*|}"; got="$(wire_count "$pat")"
    if [[ "$got" == "$want" ]]; then ok "W '$pat' occurs exactly $want time(s)"; else bad "W '$pat': $got occurrence(s), expected $want"; fi
  done
}
caseWireGreps

# ---------- C: blank-slate clause == brief sites inside blocks ----------
caseWireBlankSlate() {
  local files=() entry out clauses sites inblock
  for entry in "${WIRE_SIX[@]}"; do files+=("$REPO_ROOT/${entry%%:*}"); done
  out="$(node -e '
    const fs = require("fs"); let clauses = 0, inblock = 0, sites = 0;
    for (const f of process.argv.slice(1)) {
      let inb = false;
      for (const raw of fs.readFileSync(f, "utf8").split("\n")) {
        const t = raw.trim();
        if (t === "<!-- a1-profile:kritis -->") inb = true;
        else if (t === "<!-- /a1-profile:kritis -->") inb = false;
        if (raw.includes("Blank slate for this run")) { clauses++; if (inb) inblock++; }
        // brief site = an agent spawn by subagent_type, or the verbatim add-to-brief instruction
        if (inb) sites += (raw.match(/subagent_type: "|add this to the brief/g) || []).length;
      }
    }
    console.log(clauses + " " + inblock + " " + sites);
  ' "${files[@]}")"
  clauses="${out%% *}"; sites="${out##* }"; inblock="$(echo "$out" | cut -d' ' -f2)"
  if [[ "$clauses" == "3" && "$sites" == "3" && "$inblock" == "3" ]]; then
    ok "C blank slate: 3 clauses (all inside blocks) == 3 brief sites inside blocks"
  else
    bad "C blank slate: clauses=$clauses inside_blocks=$inblock sites=$sites, expected 3/3/3"
  fi
}
caseWireBlankSlate

# ---------- N: no stub text ----------
caseWireNoStub() {
  local entry total=0 n
  for entry in "${WIRE_SIX[@]}"; do
    n="$(grep -c 'not_implemented' "$REPO_ROOT/${entry%%:*}")"; total=$((total + n))
  done
  if [[ "$total" -eq 0 ]]; then ok "N not_implemented: 0 occurrences across the six files"; else bad "N not_implemented: $total occurrence(s)"; fi
}
caseWireNoStub

# ---------- D: block discipline against the golden commit ----------
caseWireDiscipline() {
  local work entry rel d lt gt want_gt
  mk_workdir work "w8-disc"
  for entry in "${WIRE_SIX[@]}"; do
    rel="${entry%%:*}"
    if ! git -C "$REPO_ROOT" show "$WIRE_GOLDEN:$rel" >"$work/gold" 2>"$work/gerr"; then bad "D $rel: golden copy unreadable: $(cat "$work/gerr")"; continue; fi
    if ! node "$WIRE_STRIP" "$REPO_ROOT/$rel" >"$work/cur" 2>"$work/serr"; then bad "D $rel: strip-blocks refused: $(cat "$work/serr")"; continue; fi
    diff "$work/gold" "$work/cur" >"$work/d" || true
    lt="$(grep -c '^<' "$work/d")"; gt="$(grep -c '^>' "$work/d")"
    if [[ "$rel" == "skills/a1-new-feature/SKILL.md" ]]; then
      d="$(grep '^>' "$work/d")"
      if [[ "$lt" == "0" && "$gt" == "1" && "$d" == "> $WIRE_ALIAS" ]]; then
        ok "D $rel: stripped text differs from golden by exactly the German alias line"
      else
        bad "D $rel: removed=$lt added=$gt line=[$d] (expected 0 removed, 1 added = the alias)"
      fi
    else
      if [[ "$lt" == "0" && "$gt" == "0" ]]; then ok "D $rel: stripped text identical to golden (0 lines differ)"; else bad "D $rel: removed=$lt added=$gt vs golden"; fi
    fi
  done
  rm -rf "$work"
}
caseWireDiscipline

# ---------- G: gates registered and wired ----------
caseWireGates() {
  local work rc rows summary
  mk_workdir work "w8-gates"
  rows="$(grep -cE '^\| `(kritis-ears-check|kritis-threat-model)` \|' "$REPO_ROOT/_shared/gates-registry.md")"
  (cd "$REPO_ROOT" && node "$TOOLS" gates lint >"$work/out" 2>"$work/err"); rc=$?
  summary="$(node -e '
    let j; try { j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); } catch (e) { console.log("unparsable"); process.exit(0); }
    const w = (g, s) => j.wired.filter((x) => x.gate === g && x.skill === s).reduce((a, x) => a + x.calls, 0);
    const cwp = j.findings.filter((f) => f.rule === "call_without_phase").length;
    console.log([j.findings.length, cwp, w("kritis-ears-check", "a1-new-feature"), w("kritis-threat-model", "a1-new-feature")].join(" "));
  ' "$work/out")"
  if [[ "$rows" == "2" && "$rc" -eq 0 && "$summary" == "0 0 2 1" ]]; then
    ok "G gates: both rows registered, gates lint exit 0, 0 findings (0 call_without_phase), wired 2 + 1 calls"
  else
    bad "G gates: rows=$rows lint_rc=$rc findings/call_without_phase/ears/threat=[$summary] $(head -c 300 "$work/err")"
  fi
  rm -rf "$work"
}
caseWireGates

# ---------- I: intent allowlist ----------
caseWireIntent() {
  local out
  out="$(node -e '
    const a = require(process.argv[1]).INTENT_CHILD_ALLOWLIST;
    const seven = ["resolve", "set", "nfr-inject", "ears-check", "threat-model-check", "simulate-roles", "simulate-check"].map((x) => "profile " + x);
    const res = [];
    for (const k of ["new-feature", "continue-feature"]) {
      const l = a[k] || [];
      res.push(k + ":" + l.length + ":" + seven.filter((s) => !l.includes(s)).length);
    }
    const trig = Object.keys(a).filter((k) => a[k].includes("profile trigger-check"));
    res.push("trigger:" + trig.length);
    console.log(res.join(" "));
  ' "$REPO_ROOT/_shared/lib/intent-constants.cjs" 2>&1)"
  if [[ "$out" == "new-feature:28:0 continue-feature:28:0 trigger:0" ]]; then
    ok "I intent allowlist: new-feature and continue-feature hold 28 entries incl. all seven profile commands; trigger-check on no allowlist"
  else
    bad "I intent allowlist: [$out] (expected new-feature:28:0 continue-feature:28:0 trigger:0)"
  fi
}
caseWireIntent

# ---------- E: scripted end-to-end chain (SC-001, deterministic half) ----------
caseWireChain() {
  local work spec id="911-chain" rc out checked
  mk_workdir work "w8-chain"
  mkdir -p "$work/docs/product/features/$id"
  spec="$work/spec.md"; cp "$WIRE_PROFILE_FX/ears/spec-006-ears-tagged.md" "$spec"

  out="$(node "$TOOLS" profile resolve --profile kritis --repo-root "$work" 2>"$work/e1")"; rc=$?
  if [[ "$rc" -eq 0 && "$out" == *'"profile":"kritis"'* && "$out" == *'"source":"flag"'* ]]; then ok "E1 resolve --profile kritis: exit 0, source flag"; else bad "E1 resolve: rc=$rc out=$out"; fi

  node "$TOOLS" profile set --spec "$spec" kritis >"$work/o2" 2>"$work/e2"; rc=$?
  if [[ "$rc" -eq 0 ]] && [[ "$(grep -c '^profile: kritis$' "$spec")" == "1" ]]; then ok "E2 set: exit 0, spec frontmatter carries profile: kritis"; else bad "E2 set: rc=$rc $(cat "$work/e2")"; fi

  out="$(node "$TOOLS" profile resolve --spec "$spec" --repo-root "$work" 2>"$work/e3")"; rc=$?
  if [[ "$rc" -eq 0 && "$out" == *'"profile":"kritis"'* && "$out" == *'"source":"flag"'* ]]; then
    bad "E3 re-resolve without flag: source still flag (out=$out)"
  elif [[ "$rc" -eq 0 && "$out" == *'"profile":"kritis"'* ]]; then ok "E3 re-resolve from the spec alone (new session): kritis, not from a flag"; else bad "E3 re-resolve: rc=$rc out=$out $(cat "$work/e3")"; fi

  node "$TOOLS" profile nfr-inject --spec "$spec" >"$work/o4" 2>"$work/e4"; rc=$?
  if [[ "$rc" -eq 0 ]] && grep -q 'added 41, skipped 0' "$work/o4" && [[ "$(grep -c -E '^- \*\*FR-[0-9]+\*\*' "$spec")" == "49" ]]; then
    ok "E4 nfr-inject: exit 0, added 41, spec now holds 49 FR lines (8 EARS + 41 NFR)"
  else
    bad "E4 nfr-inject: rc=$rc out=$(cat "$work/o4") err=$(cat "$work/e4")"
  fi

  node "$TOOLS" profile ears-check --spec "$spec" --phase "$id" --json >"$work/o5" 2>"$work/e5"; rc=$?
  checked="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.checked+" "+j.findings.length)' "$work/o5" 2>/dev/null)"
  if [[ "$rc" -eq 0 && "$checked" == "49 0" ]]; then ok "E5 ears-check on EARS sample + injected NFRs: exit 0, checked 49, 0 findings"; else bad "E5 ears-check: rc=$rc checked/findings=[$checked] $(cat "$work/e5")"; fi

  node -e 'const fs=require("fs");const f=process.argv[1];const t=fs.readFileSync(f,"utf8");const h="## Functional Requirements\n";if(!t.includes(h))process.exit(3);fs.writeFileSync(f,t.replace(h,h+"\n- **FR-050**: The system lists orders.\n"))' "$spec"
  node "$TOOLS" profile ears-check --spec "$spec" --phase "$id" >"$work/o5n" 2>"$work/e5n"; rc=$?
  if [[ "$rc" -eq 1 ]]; then ok "E5n ears-check on the same spec plus one untagged FR: exit 1"; else bad "E5n ears-check negative leg: rc=$rc (expected 1)"; fi

  cp "$HERE/fixtures/stride/complete.md" "$work/docs/product/features/$id/threat-model.md"
  node "$TOOLS" profile threat-model-check --id "$id" --repo-root "$work" --phase "$id" >"$work/o6" 2>"$work/e6"; rc=$?
  if [[ "$rc" -eq 0 ]]; then ok "E6 threat-model-check on a filled model: exit 0"; else bad "E6 threat-model-check: rc=$rc $(cat "$work/o6" "$work/e6")"; fi

  cp "$HERE/fixtures/stride/category-missing-D.md" "$work/docs/product/features/$id/threat-model.md"
  node "$TOOLS" profile threat-model-check --id "$id" --repo-root "$work" --phase "$id" >"$work/o6n" 2>"$work/e6n"; rc=$?
  if [[ "$rc" -eq 1 ]]; then ok "E6n threat-model-check with category D missing: exit 1"; else bad "E6n negative leg: rc=$rc (expected 1)"; fi
  rm -rf "$work"
}
caseWireChain

# ---------- S: SC-003 repo half ----------
caseWireAlias() {
  local work lines rc
  mk_workdir work "w8-alias"
  lines="$(wc -l <"$REPO_ROOT/_extras/specforge-alias/SKILL.md" | tr -d ' ')"
  if [[ "$lines" -le 40 && "$lines" -gt 0 ]]; then ok "S alias SKILL.md: $lines lines (<= 40)"; else bad "S alias SKILL.md: $lines lines, expected 1..40"; fi
  node "$TOOLS" profile trigger-check --skills-dir "$REPO_ROOT/skills" --skills-dir "$REPO_ROOT/_extras" \
    --phrase "erstelle eine Spezifikation" --expect a1-new-feature >"$work/out" 2>"$work/err"; rc=$?
  if [[ "$rc" -eq 0 ]]; then ok "S trigger-check 'erstelle eine Spezifikation' -> a1-new-feature: exit 0"; else bad "S trigger-check: rc=$rc $(cat "$work/out" "$work/err")"; fi
  rm -rf "$work"
}
caseWireAlias

# ---------- M: MIGRATION.md completeness ----------
caseWireMigration() {
  local mig="$REPO_ROOT/_shared/profiles/kritis/MIGRATION.md" out rc
  # A missing MIGRATION.md is a finding, not a skip: Wave 1 writes it as the
  # ONLY provenance of the retired SpecForge SKILL.md (2933 lines, not under
  # git, replaced by the alias skill in Wave 7). A green "guard skipped" would
  # hide exactly the loss this guard exists to catch.
  if [[ ! -f "$mig" ]]; then bad "M MIGRATION.md is missing at _shared/profiles/kritis/MIGRATION.md (Wave 1 artefact, the only provenance of the retired SpecForge SKILL.md)"; return; fi
  out="$(node -e '
    const fs = require("fs"), path = require("path");
    const root = process.argv[2], dir = path.dirname(process.argv[1]);
    const rows = fs.readFileSync(process.argv[1], "utf8").split("\n").filter((l) => /^\| (Anhang|Modus|Session)/.test(l)).map((l) => l.split("|").map((c) => c.trim()));
    const p = []; const ranges = []; let targets = 0;
    for (const c of rows) {
      const m = c[2].match(/^(\d+)–(\d+)$/);
      if (!m) { p.push("bad_range:" + c[1]); continue; }
      ranges.push([+m[1], +m[2], c[1]]);
      for (const t of [...c[4].matchAll(/`([^`]+)`/g)].map((x) => x[1].replace(/\s+§.*$/, ""))) {
        if (!/\.(md|cjs|sh|json)$/.test(t)) continue;
        targets++;
        if (!fs.existsSync(path.join(dir, t)) && !fs.existsSync(path.join(root, t))) p.push("missing_target:" + t);
      }
    }
    // overlap is checked within the one source file the ranges refer to
    const s = ranges.slice().sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < s.length; i++) if (s[i][0] <= s[i - 1][1]) p.push("overlap:" + s[i - 1][2] + "/" + s[i][2]);
    for (const L of "ABCDEFGHI") if (!rows.some((c) => c[1].startsWith("Anhang " + L + " "))) p.push("section_missing:" + L);
    console.log(rows.length + " " + ranges.length + " " + targets + (p.length ? " " + p.join(",") : ""));
    process.exit(p.length ? 1 : 0);
  ' "$mig" "$REPO_ROOT" 2>&1)"; rc=$?
  if [[ "$rc" -eq 0 && "$out" == "12 12 12" ]]; then
    ok "M MIGRATION.md: 12 rows, 12 disjoint ranges, 12 file targets all exist, sections A-I present"
  else
    bad "M MIGRATION.md: rc=$rc [$out] (expected '12 12 12')"
  fi
}
caseWireMigration
