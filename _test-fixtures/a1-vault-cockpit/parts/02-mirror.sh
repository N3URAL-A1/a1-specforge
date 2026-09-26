#!/usr/bin/env bash
# Part 02 — Wave 2, section M: mirror engine (_shared/lib/vault-mirror.cjs),
# driven through harness/mirror.cjs (test scaffolding, not a CLI). Sourced by
# run-tests.sh. Cases M1–M8 from the wave plan's Wave 2 fixture table plus M9
# (vaultRootInfo). Every case names the single production change that turns
# it red. Expected listings are literals typed here from FR-002/FR-003.

M_HARNESS="$SUITE/harness/mirror.cjs"
M_IO="$REPO_ROOT/_shared/lib/io.cjs"

# make_mirror_repo <dir> — a repo with the whitelist files, foreign files and
# every exclude class; NEXT.md has no trailing newline, VISION.md is CRLF.
make_mirror_repo() {
  local r="$1"
  mkdir -p "$r/docs/product/features/001-login" "$r/docs/product/audits" \
           "$r/.a1/phases/M1-P1" "$r/.a1/phases/M1-P2"
  printf -- '---\nproject: demo\nstatus: active\n---\n# Roadmap\n' > "$r/docs/product/ROADMAP.md"
  printf 'line one\r\nline two\r\n' > "$r/docs/product/VISION.md"
  printf 'no trailing newline' > "$r/docs/product/NEXT.md"
  printf '{"features":[]}\n' > "$r/docs/product/index.json"
  printf '# feature 001\n' > "$r/docs/product/features/001-login/feature.md"
  printf '# audit\n' > "$r/docs/product/audits/2026-01-01-general.md"
  printf 'not mirrored\n' > "$r/docs/product/notes.md"
  printf '{}\n' > "$r/docs/product/reservations.json"
  printf '{"pid":1}\n' > "$r/docs/product/.product-stage.lock.json"
  printf 'x\n' > "$r/docs/product/features/001-login/feature.lock.json"
  # excluded names INSIDE the features/** whitelist glob: here the exclude list
  # alone keeps them out (at the product root the whitelist already does)
  printf '{}\n' > "$r/docs/product/features/001-login/reservations.json"
  printf '{"pid":1}\n' > "$r/docs/product/features/001-login/.product-stage.lock.json"
  printf '{"a":1}\n' > "$r/docs/product/features/001-login/observations.jsonl"
  for f in GOAL PLAN STATUS VERIFICATION MAP AUDIT; do printf '# %s P1\n' "$f" > "$r/.a1/phases/M1-P1/$f.md"; done
  printf '{"a":1}\n' > "$r/.a1/phases/M1-P1/observations.jsonl"
  printf 'half\n' > "$r/.a1/phases/M1-P1/STATUS.md.tmp.4242"
  for f in GOAL PLAN STATUS; do printf '# %s P2\n' "$f" > "$r/.a1/phases/M1-P2/$f.md"; done
  printf '# research\n' > "$r/.a1/RESEARCH.md"
}

# make_mirror_vault <dir> <slug> — a vault with a hub note only.
make_mirror_vault() {
  mkdir -p "$1/project"
  printf -- '---\ntype: project\nstatus: build\n---\n# %s\n\n## Relations\n\n- references [[x]]\n' "$2" > "$1/project/$2.md"
}

# rel_files <dir> — sorted relative file list, space-joined.
rel_files() { (cd "$1" 2>/dev/null && find . -type f | sed 's#^\./##' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//'); }

mtime_ns() { python3 -c "import os, sys; print(os.stat(sys.argv[1]).st_mtime_ns)" "$1"; }

M_WORK="$(mktemp -d)"
M_REPO="$M_WORK/repo"; M_VAULT="$M_WORK/vault"; M_SLUG="demo"
make_mirror_repo "$M_REPO"; make_mirror_vault "$M_VAULT" "$M_SLUG"
cp "$M_VAULT/project/$M_SLUG.md" "$M_WORK/hub.before"
M_HUB_MTIME_BEFORE="$(mtime_ns "$M_VAULT/project/$M_SLUG.md")"
touch "$M_WORK/marker"; sleep 1
M_OUT="$(node "$M_HARNESS" --repo "$M_REPO" --vault "$M_VAULT" --slug "$M_SLUG" --record 2>"$M_WORK/stderr")"
M_RC=$?
M_PRODUCT="$M_VAULT/project/$M_SLUG/product"; M_PHASES="$M_VAULT/project/$M_SLUG/phases"

# ---------- M1 product whitelist + M1b excludes ----------
# Red-making change: adding `**` to PRODUCT_MIRROR_SET (notes.md appears);
# M1b: removing reservations.json (or .product-stage.lock.json, or
# observations.jsonl) from MIRROR_EXCLUDES — the copies planted INSIDE
# features/** then land in the mirror. At the product root the whitelist alone
# keeps them out, so the exclude list is defence in depth there; inside a
# `**` glob it is the only guard. Measured: removing `.product-stage.lock.json`
# alone flips nothing here because `*.lock*` still matches it — that entry is
# shadowed by design (a reader-facing name next to the glob), pinned by the
# golden only.
caseM1() {
  assert_rc "M1 harness apply exits 0" 0 "$M_RC" "$(head -c 300 "$M_WORK/stderr")"
  assert_eq "M1 vault product/ holds exactly the FR-002 whitelist" "$(rel_files "$M_PRODUCT")" \
    "NEXT.md ROADMAP.md VISION.md audits/2026-01-01-general.md features/001-login/feature.md index.json"
  [[ ! -e "$M_PRODUCT/reservations.json" && ! -e "$M_PRODUCT/.product-stage.lock.json" ]] \
    && ok "M1b reservations.json and .product-stage.lock.json absent in the mirror" \
    || bad "M1b an excluded lock/reservation file was mirrored"
  [[ ! -e "$M_PRODUCT/features/001-login/feature.lock.json" ]] \
    && ok "M1b *.lock* absent inside features/**" || bad "M1b feature.lock.json was mirrored"
  [[ ! -e "$M_PRODUCT/features/001-login/reservations.json" ]] \
    && ok "M1b reservations.json absent inside features/** (exclude alone guards it)" || bad "M1b features/001-login/reservations.json was mirrored"
  [[ ! -e "$M_PRODUCT/features/001-login/.product-stage.lock.json" ]] \
    && ok "M1b .product-stage.lock.json absent inside features/** (exclude alone guards it)" || bad "M1b features/001-login/.product-stage.lock.json was mirrored"
  [[ ! -e "$M_PRODUCT/features/001-login/observations.jsonl" ]] \
    && ok "M1b observations.jsonl absent inside features/** (exclude alone guards it)" || bad "M1b features/001-login/observations.jsonl was mirrored"
}

# ---------- M2 phases set ----------
# Red-making change: adding MAP.md to PHASES_MIRROR_SET. M2b: PHASES_MIRROR_SET
# holds literal file names only (no `**`), so the whitelist already keeps
# observations.jsonl and *.tmp* out — M2b documents that the exclude list is
# defence in depth here; the exclude-alone arm lives in M1b (features/**).
caseM2() {
  assert_eq "M2 vault phases/ holds four files per phase + RESEARCH.md, P2 without VERIFICATION" "$(rel_files "$M_PHASES")" \
    "M1-P1/GOAL.md M1-P1/PLAN.md M1-P1/STATUS.md M1-P1/VERIFICATION.md M1-P2/GOAL.md M1-P2/PLAN.md M1-P2/STATUS.md RESEARCH.md"
  [[ ! -e "$M_PHASES/M1-P1/observations.jsonl" && ! -e "$M_PHASES/M1-P1/STATUS.md.tmp.4242" ]] \
    && ok "M2b observations.jsonl and *.tmp* absent under phases/" || bad "M2b an excluded phase file was mirrored"
}

# ---------- M3 missing source is not an error ----------
# Red-making change: throwing on ENOENT for a whitelisted-but-absent file
# instead of skipping it silently (skipped stays empty, exit stays 0).
caseM3() {
  assert_json "M3 skipped is empty for a phase without VERIFICATION.md" "$M_OUT" "JSON.stringify(j.plan.skipped)" "[]"
  assert_json "M3 result counts 14 added" "$M_OUT" "j.result.added" "14"
}

# ---------- M4 byte identity (CRLF and no-trailing-newline included) ----------
# Red-making change: normalising content (trim() + '\n') before the write.
caseM4() {
  local rel bad_n=0 n=0
  for rel in $(rel_files "$M_PRODUCT"); do n=$((n + 1)); cmp -s "$M_REPO/docs/product/$rel" "$M_PRODUCT/$rel" || bad_n=$((bad_n + 1)); done
  for rel in $(rel_files "$M_PHASES"); do
    n=$((n + 1))
    if [[ "$rel" == "RESEARCH.md" ]]; then cmp -s "$M_REPO/.a1/RESEARCH.md" "$M_PHASES/$rel" || bad_n=$((bad_n + 1))
    else cmp -s "$M_REPO/.a1/phases/$rel" "$M_PHASES/$rel" || bad_n=$((bad_n + 1)); fi
  done
  [[ $n -eq 14 && $bad_n -eq 0 ]] && ok "M4 all 14 mirrored files are byte-identical to their sources" \
    || bad "M4 expected 14 identical files, found $n with $bad_n differing"
  cmp -s "$M_REPO/docs/product/VISION.md" "$M_PRODUCT/VISION.md" && ok "M4 CRLF file survives verbatim" || bad "M4 CRLF file altered"
  cmp -s "$M_REPO/docs/product/NEXT.md" "$M_PRODUCT/NEXT.md" && ok "M4 file without trailing newline survives verbatim" || bad "M4 NEXT.md altered"
}

# ---------- M5 tmp then rename (process assertion on the recorded events) ----------
# Red-making change: calling writeFileSync(dst) directly (or renaming from a
# path that was never written).
caseM5() {
  assert_json "M5 recorded 14 writes" "$M_OUT" "j.events.filter(e => e.op === 'write').length" "14"
  assert_json "M5 every write path ends in .tmp.<pid> and lies in its target dir" "$M_OUT" \
    "(() => { const re = new RegExp('\\\\.tmp\\\\.' + j.pid + '\$'); const finals = new Set(j.plan.entries.map(e => e.dst)); const dirs = new Set(j.plan.entries.map(e => require('path').dirname(e.dst))); return j.events.filter(e => e.op === 'write').every(e => re.test(e.path) && dirs.has(require('path').dirname(e.path)) && !finals.has(e.path)); })()" "true"
  assert_json "M5 every rename maps a recorded tmp write onto a planned final dst" "$M_OUT" \
    "(() => { const writes = new Set(j.events.filter(e => e.op === 'write').map(e => e.path)); const finals = new Set(j.plan.entries.filter(e => e.action !== 'extra').map(e => e.dst)); const rs = j.events.filter(e => e.op === 'rename'); return rs.length === 14 && rs.every(r => writes.has(r.from) && finals.has(r.to) && r.from === r.to + '.tmp.' + j.pid); })()" "true"
  assert_json "M5 no write targets a final path" "$M_OUT" \
    "(() => { const finals = new Set(j.plan.entries.map(e => e.dst)); return j.events.filter(e => e.op === 'write').some(e => finals.has(e.path)); })()" "false"
}

# ---------- M6 unsafe phase segment is skipped with one stderr line ----------
# Red-making change: dropping assertSafeSegment on the phase segment (the
# backslash name is then mirrored and no stderr line appears). A backslash is a
# legal POSIX filename byte that assertSafeSegment rejects — the only rejected
# shape a real directory can carry.
caseM6() {
  local w r v out rc lines
  w="$(mktemp -d)"; r="$w/repo"; v="$w/vault"
  make_mirror_repo "$r"; make_mirror_vault "$v" demo
  mkdir -p "$r/.a1/phases/bad\\phase"; printf '# evil\n' > "$r/.a1/phases/bad\\phase/GOAL.md"
  out="$(node "$M_HARNESS" --repo "$r" --vault "$v" --slug demo 2>"$w/stderr")"; rc=$?
  assert_rc "M6 apply with an unsafe phase dir exits 0" 0 "$rc"
  lines="$(grep -c 'vault mirror: skipped' "$w/stderr")"
  assert_eq "M6 exactly one stderr skip line names the unsafe segment" "$lines" "1"
  grep -q 'skipped phases/bad\\phase/GOAL.md' "$w/stderr" && ok "M6 stderr line carries the rel path" || bad "M6 stderr: $(cat "$w/stderr")"
  assert_json "M6 plan.skipped has one entry: set phases, vault-relative rel" "$out" "j.plan.skipped.length === 1 && j.plan.skipped[0].set === 'phases' && j.plan.skipped[0].rel === 'bad\\\\phase/GOAL.md'" "true"
  [[ ! -e "$v/project/demo/phases/bad\\phase" ]] && ok "M6 unsafe phase dir not created in the vault" || bad "M6 unsafe phase dir was mirrored"
  assert_eq "M6 the other phases are still mirrored" "$(rel_files "$v/project/demo/phases")" \
    "M1-P1/GOAL.md M1-P1/PLAN.md M1-P1/STATUS.md M1-P1/VERIFICATION.md M1-P2/GOAL.md M1-P2/PLAN.md M1-P2/STATUS.md RESEARCH.md"
  rm -rf "$w"
}

# ---------- M7 footprint: only product/ and phases/ change; hub untouched ----------
# Red-making change: building dst as projectsPath(slug, rel) without the set
# segment — files land next to the hub note.
caseM7() {
  local newer
  newer="$(cd "$M_VAULT" && find project -newer "$M_WORK/marker" -type f | grep -v -E "^project/$M_SLUG/(product|phases)/" | tr '\n' ' ')"
  assert_eq "M7 no file outside product/ and phases/ is newer than the marker" "$newer" ""
  cmp -s "$M_WORK/hub.before" "$M_VAULT/project/$M_SLUG.md" && ok "M7 hub note bytes unchanged" || bad "M7 hub note bytes changed"
  assert_eq "M7 hub note mtime unchanged" "$(mtime_ns "$M_VAULT/project/$M_SLUG.md")" "$M_HUB_MTIME_BEFORE"
  assert_eq "M7 mirrored files exist (14 newer than marker)" \
    "$(cd "$M_VAULT" && find project -newer "$M_WORK/marker" -type f | grep -c -E "^project/$M_SLUG/(product|phases)/")" "14"
}

# ---------- M8 extra: foreign vault file is reported, kept without prune ----------
# Red-making change: classifying unknown vault files as `unchanged` (or
# deleting them without --prune).
caseM8() {
  printf 'foreign\n' > "$M_PRODUCT/foreign.md"
  local out rc
  out="$(node "$M_HARNESS" --repo "$M_REPO" --vault "$M_VAULT" --slug "$M_SLUG" 2>/dev/null)"; rc=$?
  assert_rc "M8 second apply exits 0" 0 "$rc"
  assert_json "M8 foreign.md is planned as extra" "$out" "j.plan.entries.filter(e => e.action === 'extra').map(e => e.rel).join(',')" "foreign.md"
  assert_json "M8 second run: 14 unchanged, 0 added, 1 extra, 0 pruned" "$out" \
    "[j.result.unchanged, j.result.added, j.result.extra, j.result.pruned].join(',')" "14,0,1,0"
  [[ -f "$M_PRODUCT/foreign.md" ]] && ok "M8 foreign.md kept without prune" || bad "M8 foreign.md deleted without prune"
  # same-length edit (active → paused, 6 bytes each): size and mtime-based
  # comparisons stay blind, only a byte comparison sees it
  sed -i.bak 's/^status: active$/status: paused/' "$M_REPO/docs/product/ROADMAP.md" && rm -f "$M_REPO/docs/product/ROADMAP.md.bak"
  out="$(node "$M_HARNESS" --repo "$M_REPO" --vault "$M_VAULT" --slug "$M_SLUG" 2>/dev/null)"
  assert_json "M8b a same-length source change is planned as update (byte comparison, not size)" "$out" "j.plan.entries.filter(e => e.action === 'update').map(e => e.rel).join(',')" "ROADMAP.md"
  # conflict copies are `extra` but never pruned; a plain extra is pruned with --prune
  printf 'c\n' > "$M_PRODUCT/ROADMAP (conflicted copy 2026-09-25).md"
  out="$(node "$M_HARNESS" --repo "$M_REPO" --vault "$M_VAULT" --slug "$M_SLUG" --prune 2>/dev/null)"
  assert_json "M8c --prune removes the plain extra only (pruned=1, extra=2)" "$out" "[j.result.pruned, j.result.extra].join(',')" "1,2"
  [[ ! -e "$M_PRODUCT/foreign.md" && -f "$M_PRODUCT/ROADMAP (conflicted copy 2026-09-25).md" ]] \
    && ok "M8c foreign.md pruned, conflict copy kept" || bad "M8c prune touched the wrong file"
}

# ---------- M9 vaultRootInfo(): {root, source}, tier announced exactly once ----------
# Red-making change: announcing the tier in both vaultRoot() and
# vaultRootInfo() (two stderr lines), or handing out one module-level cached
# object (a caller's mutation would then leak into the next call).
caseM9() {
  local w out err
  w="$(mktemp -d)"
  out="$(A1_VAULT_ROOT="$w/v" IO_LIB="$M_IO" node -e "
    const io = require(process.env.IO_LIB);
    const info = io.vaultRootInfo(); const root = io.vaultRoot();
    const snapshot = { ...info }; info.root = '/tampered'; info.source = 'tampered';
    const again = io.vaultRootInfo();
    process.stdout.write(JSON.stringify({ info: snapshot, same: root === snapshot.root, isolated: again.root === snapshot.root && again.source === 'env' }));
  " 2>"$w/stderr")"
  assert_json "M9 vaultRootInfo returns the env root with source env" "$out" "[j.info.root, j.info.source].join('|')" "$w/v|env"
  assert_json "M9 vaultRoot() agrees; mutating a returned object does not leak into the next call" "$out" "j.same && j.isolated" "true"
  assert_eq "M9 the tier is announced exactly once per process" "$(grep -c 'learnings root:' "$w/stderr")" "1"
  rm -rf "$w"
}

caseM1; caseM2; caseM3; caseM4; caseM5; caseM6; caseM7; caseM8; caseM9
rm -rf "$M_WORK"
