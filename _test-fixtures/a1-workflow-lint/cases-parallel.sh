# Cases PG1-PG7: parallel-group and background-start rules (spec 027 slice 4, FR-023/FR-024, plan D14).
# Sourced by run-tests.sh (uses ok, bad, REPO_ROOT, copySkills, mk_workdir).
# Real files: each case edits a copy of the real skills/ tree (the research-map group in 01-research.md / 02-map.md and
# the vault-mirror fence in 04-audit.md). The rules run at module level (workflow-lint-parallel.cjs), PG1 also through the CLI.
#
# Measured red 2026-11-23 (each on its own edit of workflow-lint-parallel.cjs, suite run, file restored):
#   the `files.size < 2` single-member check removed            -> PG2
#   the dependent-input check (`m.inputs.includes(other.output)`) removed -> PG3
#   the BACKGROUND_LINE_RE test removed (any bash block passes)  -> PG4
#   the join=yes check removed                                   -> PG5
#   the orphan-join check removed                                -> PG6

PG_LIB="$REPO_ROOT/_shared/lib/workflow-lint-parallel.cjs"
PG_RES="skills/a1-plan/workflows/01-research.md"
PG_MAP="skills/a1-plan/workflows/02-map.md"
PG_AUDIT="skills/a1-plan/workflows/04-audit.md"

# pgRun <root>: prints "<parallel_checked> <background_checked> <rule@file-basename,...>".
pgRun() {
  node -e '
    const p=require(process.argv[1]); const t=()=>true;
    const a=p.checkParallelGroups(process.argv[2],t), b=p.checkBackgroundMarkers(process.argv[2],t);
    const f=[].concat(a.findings,b.findings).map(x=>x.rule+"@"+require("path").basename(x.file)+(x.reason.includes("not independent")?":dependent":""));
    process.stdout.write(a.checked+" "+b.checked+" "+f.join(","));
  ' "$PG_LIB" "$1" 2>&1
}

# pgEdit <rel> <js edit on s> -> sets PG_W (a skills copy with the edit); the edit must change the file.
pgEdit() {
  PG_W="$(copySkills)"
  node -e '
    const fs=require("fs"); const f=process.argv[1]; let s=fs.readFileSync(f,"utf8"); const before=s;
    '"$2"'
    if (s===before) { process.stderr.write("pgEdit: edit did not change "+f+"\n"); process.exit(3); }
    fs.writeFileSync(f,s);' "$PG_W/$1"
}

casePG1() {
  local s out rc
  s="$(pgRun "$REPO_ROOT")"
  out="$(node "$TOOLS" workflow lint 2>/dev/null)"; rc=$?
  local keys; keys="$(node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write((j.parallel_checked>=2&&j.background_checked>=1&&j.findings.length===0)+":"+j.parallel_checked+"/"+j.background_checked)' "$out" 2>&1)"
  if [[ "$s" == "2 1 " && $rc -eq 0 && "$keys" == true:* ]]; then ok "PG1 real tree: 0 findings, parallel_checked 2, background_checked 1 (CLI keys $keys)"
  else bad "PG1 real tree (sum='$s' rc=$rc keys=$keys)"; fi
}
casePG2() { pgEdit "$PG_MAP" 's = s.replace("<!-- a1:parallel group=research-map -->\n", "");' || return
  local s; s="$(pgRun "$PG_W")"
  if [[ "$s" == "1 1 parallel-group@01-research.md" ]]; then ok "PG2 marker removed from 02-map.md: single member flagged"; else bad "PG2 (sum='$s')"; fi; }
casePG3() { pgEdit "$PG_MAP" 's = s.replace("- ./CLAUDE.md (if exists)\n", "- ./CLAUDE.md (if exists)\n- .a1/phases/<phase_name>/RESEARCH.md\n");' || return
  local s; s="$(pgRun "$PG_W")"
  if [[ "$s" == "2 1 parallel-group@02-map.md:dependent" ]]; then ok "PG3 RESEARCH.md re-added to files_to_read of 02-map.md: dependent member flagged"; else bad "PG3 (sum='$s')"; fi; }
casePG4() { pgEdit "$PG_AUDIT" 's = s.replace("2>&1 &\n", "2>&1\n");' || return
  local s; s="$(pgRun "$PG_W")"
  if [[ "$s" == "2 1 background-start@04-audit.md" ]]; then ok "PG4 trailing & removed from the 04-audit fence: background-start flagged"; else bad "PG4 (sum='$s')"; fi; }
casePG5() { pgEdit "$PG_MAP" 's += "\n<!-- a1:background id=planted-bg join=yes -->\n```bash\n( sleep 1 ) &\n```\n";' || return
  local s; s="$(pgRun "$PG_W")"
  if [[ "$s" == "2 2 background-start@02-map.md" ]]; then ok "PG5 planted join=yes marker with no join: background-start flagged"; else bad "PG5 (sum='$s')"; fi; }
casePG6() { pgEdit "$PG_MAP" 's += "\n<!-- a1:join id=planted-bg -->\n";' || return
  local s; s="$(pgRun "$PG_W")"
  if [[ "$s" == "2 1 background-start@02-map.md" ]]; then ok "PG6 planted join marker without a background marker: background-start flagged"; else bad "PG6 (sum='$s')"; fi; }
casePG7() { PG_W="$(copySkills)"
  printf '%s\n' '# Extra' '' '<!-- a1:parallel group=research-map -->' '' '```' '<files_to_read>' '- ./CLAUDE.md (if exists)' '</files_to_read>' '**Output path:** .a1/phases/<phase_name>/EXTRA.md' '```' > "$PG_W/skills/a1-plan/workflows/99-extra.md"
  local s; s="$(pgRun "$PG_W")"
  if [[ "$s" == "3 1 " ]]; then ok "PG7 third member with an independent input: 0 findings"; else bad "PG7 (sum='$s')"; fi; }
