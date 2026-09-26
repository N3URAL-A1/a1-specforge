#!/usr/bin/env bash
# Part 05 — Wave 5 agent A, sections L and H: multi-host locks (locks.cjs,
# FR-032/FR-033) and the single vault writer (vault-mirror.cjs
# writerHostGate(), FR-034/FR-035). Sourced by run-tests.sh. Cases L1–L5 and
# H1–H5 from the wave plan's Wave 5 fixture table (L5, H3b and H5 added: the
# own-host path with a hostname present, an empty declaration, and the status
# fields on a non-writer). Every case names the single production change that
# turns it red.
#
# Oracles are independent of the module under test: the host name comes from
# `os.hostname()` in a separate node process, the ten-minute age is the literal
# 600000 (not RESERVATIONS_LOCK_STALE_MS), the skip line is typed out here.
# A foreign host is simulated by planting a lock file whose `hostname` is
# "other-host" — no second machine is needed.
#
# Isolation: every repo and vault lives under `mktemp -d`; HOME, A1_VAULT_ROOT
# and A1_CODE_ROOTS point there for every call; A1_VAULT_WRITER_HOST is set
# per call only. The real vault is never read or written.
#
# RED record (2026-09-26, sections LK and H run against the pre-wave
# locks.cjs, vault-mirror.cjs and vault-sync.cjs): 21 of 37 assertions red —
# every hostname, gate and status-field assertion. Green before the code
# existed, by construction (16): LK2 live-pid half (a live pid was never
# reclaimed), LK3, LK4 and LK5 ×2 (today's same-host logic, which must stay),
# the exit-0 and "repo write kept" halves of H1, H2 ×4 and the first two H3
# assertions (undeclared = pre-wave behaviour), the H4 exit half and its two
# writer-sync halves. Each is the regression half of a red positive in the
# same case; the named mutations (Wave 5A report) each turn their case red.
#
# Security review round (2026-09-26, Samuel): LK6 (future-dated / oversized
# lock), S1–S4 (only regular files inside the real repo set folders are
# mirrored) and H6–H8 (lint --fix-type, link-hub, spec init hub link are
# writer-host writes). RED proof for this round is by mutation on throwaway
# copies — each case names its red-making change, and each was measured red
# (Wave 5A review-fix report). One guard has no arm by design: the
# O_NOFOLLOW read in writeAtomic closes the plan-to-write swap window, which
# no CLI call can open between planning and writing (defence in depth, same
# standing as C17 in part 03).
#
# Second review round (same day): V1–V4 — symlinks INSIDE the vault. Random
# tmp names opened with wx in all three atomic writers (V1), the nearest
# existing ancestor checked before every recursive mkdir (V2), linked project
# folders and hub notes refused by vault lint and vault link-hub (V3, V4).
# RED proof again by mutation (review-fix report, round 2).

H_WORK="$(mktemp -d)"
H_HOME="$H_WORK/home"; H_ERR="$H_WORK/stderr"
mkdir -p "$H_HOME"
H_OUT=""; H_RC=0
H_LOCKS="$REPO_ROOT/_shared/lib/locks.cjs"
H_HOST="$(node -e 'process.stdout.write(require("os").hostname())')"
H_SKIP_LINE="[a1-tools] vault mirror skipped: this host is not the vault writer ($H_HOST ≠ other-host)"

# ---------- L: lock payload and staleness ----------

# h_iso_ago <ms> — ISO timestamp <ms> milliseconds in the past (ms via env).
h_iso_ago() { AGO_MS="$1" node -e 'process.stdout.write(new Date(Date.now() - Number(process.env.AGO_MS)).toISOString())'; }

# h_plant <file> <pid> <createdAt> [hostname] — writes a lock payload by hand.
h_plant() {
  if [[ $# -ge 4 ]]; then printf '{"pid":%s,"createdAt":"%s","hostname":"%s"}' "$2" "$3" "$4" > "$1"
  else printf '{"pid":%s,"createdAt":"%s"}' "$2" "$3" > "$1"; fi
}

# h_stale <lockfile> — prints isLockStale(<lockfile>) (path via env, not argv).
h_stale() { LOCKS="$H_LOCKS" LOCK_FILE="$1" node -e 'process.stdout.write(String(require(process.env.LOCKS).isLockStale(process.env.LOCK_FILE)))' 2>&1; }

# LK1 — FR-032: acquireReservationsLock writes {pid, createdAt, hostname}.
# Red-making change: dropping `hostname` from the lock payload.
caseLK1() {
  local f="$H_WORK/l1/reservations.json" payload
  mkdir -p "$H_WORK/l1"
  LOCKS="$H_LOCKS" RES_FILE="$f" node -e 'require(process.env.LOCKS).acquireReservationsLock(process.env.RES_FILE)' 2>&1
  payload="$(cat "$f.lock" 2>/dev/null)"
  assert_json "LK1 lock hostname equals os.hostname()" "$payload" "j.hostname" "$H_HOST"
  assert_json "LK1 lock keys" "$payload" "Object.keys(j).sort().join(',')" "createdAt,hostname,pid"
  # the reclaim path writes the same payload: plant a dead same-host lock first
  h_plant "$f.lock" 999999 "$(h_iso_ago 0)"
  LOCKS="$H_LOCKS" RES_FILE="$f" node -e 'require(process.env.LOCKS).acquireReservationsLock(process.env.RES_FILE)' 2>&1
  assert_json "LK1 reclaimed lock hostname equals os.hostname()" "$(cat "$f.lock" 2>/dev/null)" "j.hostname" "$H_HOST"
}
caseLK1

# LK2 — FR-033: a fresh lock from another host is live even when its pid is
# dead HERE (the pid belongs to the other machine).
# Red-making change: ignoring `hostname` (the dead-pid test then reclaims it).
caseLK2() {
  local f="$H_WORK/l2.lock"
  h_plant "$f" 999999 "$(h_iso_ago 0)" other-host
  assert_eq "LK2 foreign host, dead pid, fresh → not stale" "$(h_stale "$f")" "false"
  h_plant "$f" $$ "$(h_iso_ago 0)" other-host
  assert_eq "LK2 foreign host, live pid, fresh → not stale (SC-009)" "$(h_stale "$f")" "false"
}
caseLK2

# LK3 — FR-033: a foreign lock older than the stale window is stale.
# Red-making change: treating foreign locks as always live.
caseLK3() {
  local f="$H_WORK/l3.lock"
  h_plant "$f" $$ "$(h_iso_ago 600000)" other-host
  assert_eq "LK3 foreign host, 10 min old → stale" "$(h_stale "$f")" "true"
}
caseLK3

# LK4 — FR-033: a pre-feature payload without hostname keeps today's logic.
# Red-making change: requiring `hostname` to be present (or treating its
# absence as foreign → a dead pid would no longer be reclaimed).
caseLK4() {
  local f="$H_WORK/l4.lock"
  h_plant "$f" 999999 "$(h_iso_ago 0)"
  assert_eq "LK4 legacy payload, dead pid → stale" "$(h_stale "$f")" "true"
}
caseLK4

# LK5 — own hostname present: the pid test still applies.
# Red-making change: treating every payload that carries a hostname as foreign.
caseLK5() {
  local f="$H_WORK/l5.lock"
  h_plant "$f" 999999 "$(h_iso_ago 0)" "$H_HOST"
  assert_eq "LK5 own host, dead pid → stale" "$(h_stale "$f")" "true"
  h_plant "$f" $$ "$(h_iso_ago 0)" "$H_HOST"
  assert_eq "LK5 own host, live pid, fresh → not stale" "$(h_stale "$f")" "false"
}
caseLK5

# LK6 — security review MINOR: a foreign lock dated in the future would be
# live forever (foreign locks are judged by age alone). More than 60 s ahead
# → invalid → stale; within the skew → still live. An oversized lock file is
# not one a1-tools wrote → stale.
# Red-making changes: dropping the future-date check (LK6a red); dropping the
# size bound (LK6c red — the padded payload parses and names a live pid).
caseLK6() {
  local f="$H_WORK/lk6.lock"
  h_plant "$f" 999999 "$(h_iso_ago -600000)" other-host
  assert_eq "LK6a foreign host, createdAt 10 min ahead → stale" "$(h_stale "$f")" "true"
  h_plant "$f" 999999 "$(h_iso_ago -30000)" other-host
  assert_eq "LK6b foreign host, createdAt 30 s ahead (skew) → not stale" "$(h_stale "$f")" "false"
  h_plant "$f" $$ "$(h_iso_ago 0)" "$H_HOST"
  head -c 5000 /dev/zero | tr '\0' ' ' >> "$f"
  assert_eq "LK6c own host, live pid, 5000-byte lock file → stale" "$(h_stale "$f")" "true"
}
caseLK6

# ---------- H: single vault writer ----------

# h_run <repo> <vault|""> <writer|-> <a1-tools args...> — "-" leaves
# A1_VAULT_WRITER_HOST unset; any other value (also "") is exported as-is.
h_run() {
  local repo="$1" vault="$2" writer="$3"; shift 3
  local envs=(HOME="$H_HOME" A1_CODE_ROOTS="$(dirname "$repo")")
  [[ -n "$vault" ]] && envs+=(A1_VAULT_ROOT="$vault")
  [[ "$writer" != "-" ]] && envs+=(A1_VAULT_WRITER_HOST="$writer")
  H_OUT="$(cd "$repo" && env -u A1_VAULT_ROOT -u A1_VAULT_WRITER_HOST "${envs[@]}" node "$TOOLS" "$@" 2>"$H_ERR")"; H_RC=$?
}

h_listing() { (cd "$1" 2>/dev/null && find . -type f | sed 's#^\./##' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//'); }
h_has_skip_line() { grep -Fxc "$H_SKIP_LINE" "$H_ERR" | tr -d ' '; }

# h_setup <name> — a git repo with a product roadmap (project demo, one
# feature) written vault-free, and a vault holding only the hub note.
h_setup() {
  H_REPO="$H_WORK/$1/repo"; H_VAULT="$H_WORK/$1/vault"
  mkdir -p "$H_REPO" "$H_VAULT/project"
  git -C "$H_REPO" init -q 2>/dev/null || git init -q "$H_REPO"
  printf -- '---\ntype: project\nstatus: build\n---\n# demo\n' > "$H_VAULT/project/demo.md"
  h_run "$H_REPO" "" - product init --project demo --title Demo
  h_run "$H_REPO" "" - product add-milestone --id m1 --title M1
  h_run "$H_REPO" "" - product add-feature --id 001-login --milestone m1 --title Login
}

# H1 — FR-034 non-writer transaction: repo write kept, exit 0, the exact skip
# line, nothing under the vault changes, vault_mirror.status skipped.
# Red-making change: skipping the gate in the hook (or comparing against
# something other than os.hostname(), e.g. the vault root).
caseH1() {
  h_setup h1
  local before; before="$(h_listing "$H_VAULT")"
  touch "$H_WORK/h1/marker"
  h_run "$H_REPO" "$H_VAULT" other-host product stage --by 001-login --set started
  assert_rc "H1 stage exit" 0 "$H_RC" "$(cat "$H_ERR")"
  assert_eq "H1 exact skip line on stderr" "$(h_has_skip_line)" "1"
  assert_json "H1 vault_mirror.status" "$H_OUT" "j.vault_mirror && j.vault_mirror.status" "skipped"
  assert_eq "H1 no vault file newer than the marker" "$(find "$H_VAULT" -newer "$H_WORK/h1/marker" | wc -l | tr -d ' ')" "0"
  assert_eq "H1 vault listing unchanged" "$(h_listing "$H_VAULT")" "$before"
  assert_eq "H1 repo write kept" "$(grep -c 'stage: started' "$H_REPO/docs/product/ROADMAP.md" | tr -d ' ')" "1"
}
caseH1

# H2 — FR-034 writer host: mirrored, status ok, no skip line.
# Red-making change: inverting the comparison (writer skips, others write).
caseH2() {
  h_setup h2
  h_run "$H_REPO" "$H_VAULT" "$H_HOST" product stage --by 001-login --set started
  assert_rc "H2 stage exit" 0 "$H_RC" "$(cat "$H_ERR")"
  assert_json "H2 vault_mirror.status" "$H_OUT" "j.vault_mirror && j.vault_mirror.status" "ok"
  assert_eq "H2 vault ROADMAP.md byte-identical" "$(cmp -s "$H_REPO/docs/product/ROADMAP.md" "$H_VAULT/project/demo/product/ROADMAP.md"; echo $?)" "0"
  assert_eq "H2 no skip line" "$(grep -c 'vault mirror skipped' "$H_ERR" | tr -d ' ')" "0"
}
caseH2

# H3 — FR-034/FR-035 undeclared: every host writes, status reports it.
# Red-making change: refusing when no writer is declared (mayWrite false).
caseH3() {
  h_setup h3
  h_run "$H_REPO" "$H_VAULT" - product stage --by 001-login --set started
  assert_rc "H3 stage exit" 0 "$H_RC" "$(cat "$H_ERR")"
  assert_json "H3 vault_mirror.status" "$H_OUT" "j.vault_mirror && j.vault_mirror.status" "ok"
  h_run "$H_REPO" "$H_VAULT" - vault status --json
  assert_json "H3 status host" "$H_OUT" "j.host" "$H_HOST"
  assert_json "H3 status writer_host" "$H_OUT" "j.writer_host" "undeclared"
  assert_json "H3 status may_write" "$H_OUT" "j.may_write" "true"
  # an empty declaration is no declaration
  # Red-making change: taking "" as a host name (may_write false for everyone).
  h_run "$H_REPO" "$H_VAULT" "" vault status --json
  assert_json "H3b empty declaration → undeclared" "$H_OUT" "j.writer_host" "undeclared"
  assert_json "H3b empty declaration → may_write" "$H_OUT" "j.may_write" "true"
  # human output names the three fields too
  h_run "$H_REPO" "$H_VAULT" - vault status
  assert_eq "H3c human status line" "$(grep -c "^\[a1-tools\] vault writer: host $H_HOST, writer_host undeclared, may_write true\$" "$H_ERR" | tr -d ' ')" "1"
}
caseH3

# H4 — FR-034 non-writer `vault sync`: exit 0, same line, nothing written.
# Red-making change: exiting 2 (the tightening Clarify deferred), or no gate
# in `vault sync` (files then land in the vault).
caseH4() {
  h_setup h4
  local before; before="$(h_listing "$H_VAULT")"
  touch "$H_WORK/h4/marker"
  h_run "$H_REPO" "$H_VAULT" other-host vault sync --json
  assert_rc "H4 sync exit" 0 "$H_RC" "$(cat "$H_ERR")"
  assert_eq "H4 exact skip line on stderr" "$(h_has_skip_line)" "1"
  assert_json "H4 sync status" "$H_OUT" "j.status" "skipped"
  assert_eq "H4 no vault file newer than the marker" "$(find "$H_VAULT" -newer "$H_WORK/h4/marker" | wc -l | tr -d ' ')" "0"
  assert_eq "H4 vault listing unchanged" "$(h_listing "$H_VAULT")" "$before"
  # the writer host syncs the same repo into the same vault
  h_run "$H_REPO" "$H_VAULT" "$H_HOST" vault sync --json
  assert_json "H4 writer sync status" "$H_OUT" "j.status" "ok"
  assert_eq "H4 writer sync wrote ROADMAP.md" "$(cmp -s "$H_REPO/docs/product/ROADMAP.md" "$H_VAULT/project/demo/product/ROADMAP.md"; echo $?)" "0"
}
caseH4

# H5 — FR-035 on a non-writer: status reads, reports may_write false.
# Red-making change: dropping the fields or hard-coding may_write true.
caseH5() {
  h_setup h5
  h_run "$H_REPO" "$H_VAULT" other-host vault status --json
  assert_json "H5 status writer_host" "$H_OUT" "j.writer_host" "other-host"
  assert_json "H5 status may_write" "$H_OUT" "j.may_write" "false"
  assert_json "H5 status host" "$H_OUT" "j.host" "$H_HOST"
}
caseH5

# ---------- S: only regular files inside the repo set folders are mirrored ----------
# (security review MAJOR 1). A symlinked source would otherwise carry the
# bytes of any file the user can read into the synced vault.

H_SECRET_TEXT="w5-secret-do-not-mirror"

# h_secret_hits <vault> — number of vault files containing the secret text.
h_secret_hits() { grep -rlF "$H_SECRET_TEXT" "$1" 2>/dev/null | wc -l | tr -d ' '; }

# h_link_repo <name> — repo + vault + a secret file outside the repo; the
# product roadmap is real (project demo), sync runs with no writer declared.
h_link_repo() {
  H_REPO="$H_WORK/$1/repo"; H_VAULT="$H_WORK/$1/vault"; H_SECRET="$H_WORK/$1/secret.txt"
  mkdir -p "$H_REPO/docs/product" "$H_REPO/.a1/phases/M1-P1" "$H_VAULT/project"
  git -C "$H_REPO" init -q 2>/dev/null || git init -q "$H_REPO"
  printf -- '---\ntype: project\nstatus: build\n---\n# demo\n' > "$H_VAULT/project/demo.md"
  printf -- '---\nproject: demo\nstatus: active\n---\n# Roadmap\n' > "$H_REPO/docs/product/ROADMAP.md"
  printf '# goal\n' > "$H_REPO/.a1/phases/M1-P1/GOAL.md"
  printf '%s\n' "$H_SECRET_TEXT" > "$H_SECRET"
}

# S1 — file symlinks: docs/product/VISION.md and .a1/phases/M1-P1/PLAN.md
# point at a secret outside the repo. Neither reaches the vault; stderr names
# both; the regular files still mirror.
# Red-making change: removing the lstat check in sourceProblem (the link is
# then followed — its realpath check alone is also removed by that mutation).
caseS1() {
  h_link_repo s1
  ln -s "$H_SECRET" "$H_REPO/docs/product/VISION.md"
  ln -s "$H_SECRET" "$H_REPO/.a1/phases/M1-P1/PLAN.md"
  h_run "$H_REPO" "$H_VAULT" - vault sync --json
  assert_rc "S1 sync exit" 0 "$H_RC" "$(cat "$H_ERR")"
  assert_eq "S1 secret not in the vault" "$(h_secret_hits "$H_VAULT")" "0"
  assert_eq "S1 stderr names product/VISION.md as a link" "$(grep -cF 'vault mirror: skipped product/VISION.md (source is a symbolic link)' "$H_ERR" | tr -d ' ')" "1"
  assert_eq "S1 stderr names phases/M1-P1/PLAN.md as a link" "$(grep -cF 'vault mirror: skipped phases/M1-P1/PLAN.md (source is a symbolic link)' "$H_ERR" | tr -d ' ')" "1"
  assert_eq "S1 regular files still mirrored" "$(h_listing "$H_VAULT/project/demo")" "phases/M1-P1/GOAL.md product/ROADMAP.md"
}
caseS1

# S2 — a regular file reached through a linked folder: .a1/phases/M1-P2 is a
# symlink to a folder outside the repo holding a PLAN.md with the secret.
# Red-making change: dropping the realpath containment in sourceProblem.
caseS2() {
  h_link_repo s2
  mkdir -p "$H_WORK/s2/outside"
  cp "$H_SECRET" "$H_WORK/s2/outside/PLAN.md"
  ln -s "$H_WORK/s2/outside" "$H_REPO/.a1/phases/M1-P2"
  h_run "$H_REPO" "$H_VAULT" - vault sync --json
  assert_rc "S2 sync exit" 0 "$H_RC" "$(cat "$H_ERR")"
  assert_eq "S2 secret not in the vault" "$(h_secret_hits "$H_VAULT")" "0"
  assert_eq "S2 stderr names phases/M1-P2/PLAN.md" "$(grep -cF 'vault mirror: skipped phases/M1-P2/PLAN.md (source resolves outside the repo set folder via a link' "$H_ERR" | tr -d ' ')" "1"
}
caseS2

# S3 — the set base itself is a link: docs/product → a folder outside the
# repo (its roadmap names project demo, its VISION.md holds the secret).
# The whole product set is refused with one line; --prune keeps the vault
# copy that an earlier, honest sync wrote.
# Red-making changes: dropping baseProblem (secret mirrored, S3 secret red);
# computing extras for a refused set (S3 prune keeps NEXT.md red).
caseS3() {
  h_link_repo s3
  local out="$H_WORK/s3/outside-product"
  mkdir -p "$out" "$H_VAULT/project/demo/product"
  mv "$H_REPO/docs/product/ROADMAP.md" "$out/ROADMAP.md"
  cp "$H_SECRET" "$out/VISION.md"
  rmdir "$H_REPO/docs/product"
  ln -s "$out" "$H_REPO/docs/product"
  printf 'earlier honest copy\n' > "$H_VAULT/project/demo/product/NEXT.md"
  h_run "$H_REPO" "$H_VAULT" - vault sync --prune --json
  assert_rc "S3 sync exit" 0 "$H_RC" "$(cat "$H_ERR")"
  assert_eq "S3 secret not in the vault" "$(h_secret_hits "$H_VAULT")" "0"
  assert_eq "S3 one line refuses the product set" "$(grep -cF 'vault mirror: skipped product/ (source folder resolves outside the repo via a link' "$H_ERR" | tr -d ' ')" "1"
  assert_eq "S3 prune keeps the earlier vault copy" "$(cat "$H_VAULT/project/demo/product/NEXT.md" 2>/dev/null)" "earlier honest copy"
  assert_eq "S3 phases set still mirrored" "$(h_listing "$H_VAULT/project/demo/phases")" "M1-P1/GOAL.md"
}
caseS3

# S4 — the product transaction hook uses the same guard: a stage with a
# linked VISION.md keeps the secret out and still mirrors the roadmap.
# Red-making change: same as S1 (the hook plans through planMirror).
caseS4() {
  h_setup s4
  ln -s "$H_WORK/s4/secret.txt" "$H_REPO/docs/product/VISION.md"
  printf '%s\n' "$H_SECRET_TEXT" > "$H_WORK/s4/secret.txt"
  h_run "$H_REPO" "$H_VAULT" - product stage --by 001-login --set started
  assert_rc "S4 stage exit" 0 "$H_RC" "$(cat "$H_ERR")"
  assert_json "S4 vault_mirror.status" "$H_OUT" "j.vault_mirror && j.vault_mirror.status" "ok"
  assert_eq "S4 secret not in the vault" "$(h_secret_hits "$H_VAULT")" "0"
  assert_eq "S4 roadmap mirrored" "$(cmp -s "$H_REPO/docs/product/ROADMAP.md" "$H_VAULT/project/demo/product/ROADMAP.md"; echo $?)" "0"
}
caseS4

# ---------- H6–H8: every hub / backfill write is a writer-host write ----------
# (security review MAJOR 2, team-lead decision 2026-09-26).

# h_hub_vault <name> — a vault with hub project/demo.md (## Relations) and one
# spec without type: (a lint type_missing candidate that --fix-type stamps).
h_hub_vault() {
  H_W="$H_WORK/$1"; H_VAULT="$H_W/vault"
  mkdir -p "$H_VAULT/project/demo/spec"
  printf -- '---\ntype: project\nstatus: build\n---\n# demo\n\n## Relations\n\n- uses [[y]]\n' > "$H_VAULT/project/demo.md"
  printf -- '---\nid: 003-x\nstatus: draft\n---\n# x\n' > "$H_VAULT/project/demo/spec/003-x.md"
  cp -R "$H_VAULT" "$H_W/vault.before"
}
h_vault_unchanged() { diff -r "$H_W/vault.before" "$H_VAULT" >/dev/null 2>&1 && echo same || echo changed; }

# H6 — vault lint --fix-type on a non-writer: nothing stamped, the skip line,
# the lint still reports (exit 1 = findings, unchanged by the gate).
# Red-making change: removing the gate from vault lint (the spec is stamped).
caseH6() {
  h_hub_vault h6
  h_run "$H_W" "$H_VAULT" other-host vault lint demo --json --fix-type
  assert_rc "H6 lint --fix-type exit (findings)" 1 "$H_RC" "$(cat "$H_ERR")"
  assert_eq "H6 exact skip line" "$(h_has_skip_line)" "1"
  assert_eq "H6 vault byte-identical (no type stamped)" "$(h_vault_unchanged)" "same"
  assert_json "H6 fix_type skipped-non-writer" "$H_OUT" "j.fix_type" "skipped-non-writer"
  assert_json "H6 type_missing still reported" "$H_OUT" "j.counts.type_missing" "1"
  # the writer stamps it (control: the gate is not a blanket refusal)
  h_run "$H_W" "$H_VAULT" "$H_HOST" vault lint demo --json --fix-type
  assert_eq "H6 writer stamps type: spec" "$(sed -n 2p "$H_VAULT/project/demo/spec/003-x.md")" "type: spec"
}
caseH6

# H7 — vault link-hub on a non-writer, single and --all-specs: no hub write,
# the skip line, exit 0 (same as vault sync).
# Red-making change: removing the gate from cmdVaultLinkHub.
caseH7() {
  h_hub_vault h7
  h_run "$H_W" "$H_VAULT" other-host vault link-hub demo --spec 003-x
  assert_rc "H7a link-hub --spec exit" 0 "$H_RC" "$(cat "$H_ERR")"
  assert_eq "H7a exact skip line" "$(h_has_skip_line)" "1"
  assert_json "H7a status skipped" "$H_OUT" "j.status" "skipped"
  h_run "$H_W" "$H_VAULT" other-host vault link-hub --all-specs
  assert_rc "H7b link-hub --all-specs exit" 0 "$H_RC" "$(cat "$H_ERR")"
  assert_eq "H7b exact skip line" "$(h_has_skip_line)" "1"
  assert_eq "H7 hub byte-identical" "$(h_vault_unchanged)" "same"
  h_run "$H_W" "$H_VAULT" "$H_HOST" vault link-hub demo --spec 003-x
  assert_eq "H7 writer links the spec" "$(grep -cxF -- '- references [[project/demo/spec/003-x]]' "$H_VAULT/project/demo.md" | tr -d ' ')" "1"
}
caseH7

# H8 — spec init on a non-writer: the spec FILE is written (authorship is
# host-agnostic), the hub is not linked (hub: skipped-non-writer).
# Red-making changes: removing the gate from spec init (hub linked, H8 hub
# red); gating the whole command (no spec file, H8 file red).
caseH8() {
  h_hub_vault h8
  h_run "$H_W" "$H_VAULT" other-host spec init demo w5-feat --title "W5 feature"
  assert_rc "H8 spec init exit" 0 "$H_RC" "$(cat "$H_ERR")"
  assert_json "H8 hub skipped-non-writer" "$H_OUT" "j.hub" "skipped-non-writer"
  assert_eq "H8 exact skip line" "$(h_has_skip_line)" "1"
  assert_eq "H8 spec file written" "$(ls "$H_VAULT/project/demo/spec" | grep -c 'w5-feat\.md$' | tr -d ' ')" "1"
  assert_eq "H8 hub byte-identical" "$(cmp -s "$H_W/vault.before/project/demo.md" "$H_VAULT/project/demo.md"; echo $?)" "0"
  h_run "$H_W" "$H_VAULT" - spec init demo w5-feat2 --title "W5 feature two"
  assert_json "H8 undeclared links the hub" "$H_OUT" "j.hub" "linked"
}
caseH8


# ---------- V: symlinks INSIDE the vault (security review MINOR 1) ----------

H_OUTSIDE_TEXT="w5-outside-content"
h_outside_hits() { find "$1" -type f -exec grep -lF "$H_OUTSIDE_TEXT" {} + 2>/dev/null | wc -l | tr -d ' '; }

# V1 — a symlink planted at the OLD tmp name (<target>.tmp.<pid>) of each of
# the three atomic writers does not catch the write: the target gets the new
# bytes, the link's target outside stays untouched. Runs in one node process
# so the pid is known.
# Red-making change: tmp name back to .tmp.<pid> without 'wx' (in io.cjs
# writeViaTmp or vault-mirror writeAtomic) — the bytes land outside.
caseV1() {
  local w="$H_WORK/v1" out
  mkdir -p "$w/vault/project/demo" "$w/repo/docs/product"
  git -C "$w/repo" init -q 2>/dev/null || git init -q "$w/repo"
  printf 'roadmap\n' > "$w/repo/docs/product/ROADMAP.md"
  out="$(cd "$w" && A1_VAULT_ROOT="$w/vault" W="$w" IO="$REPO_ROOT/_shared/lib/io.cjs" MIRROR="$REPO_ROOT/_shared/lib/vault-mirror.cjs" node -e '
    const fs = require("fs"), path = require("path");
    const io = require(process.env.IO), mirror = require(process.env.MIRROR), w = process.env.W;
    const res = {};
    const plant = (target, name) => { const o = path.join(w, name); fs.writeFileSync(o, "untouched\n"); fs.symlinkSync(o, target + ".tmp." + process.pid); return o; };
    const text = path.join(w, "vault/project/demo/text.md");
    const o1 = plant(text, "o1"); try { io.writeTextAtomic(text, "new text\n"); } catch (e) { res.textErr = e.message; }
    const md = path.join(w, "vault/project/demo/md.md");
    const o2 = plant(md, "o2"); try { io.writeMdAtomic(md, { type: "spec" }, "body\n"); } catch (e) { res.mdErr = e.message; }
    const dst = path.join(w, "vault/project/demo/product/ROADMAP.md");
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const o3 = plant(dst, "o3");
    try { mirror.applyMirror(mirror.planMirror({ repoRoot: path.join(w, "repo"), vaultRoot: path.join(w, "vault"), slug: "demo", warn: () => {} })); } catch (e) { res.mirrorErr = e.message; }
    res.outside = [o1, o2, o3].map((o) => fs.readFileSync(o, "utf8")).join("|");
    res.text = fs.readFileSync(text, "utf8"); res.textIsFile = fs.lstatSync(text).isFile();
    res.mdIsFile = fs.lstatSync(md).isFile(); res.dst = fs.readFileSync(dst, "utf8"); res.dstIsFile = fs.lstatSync(dst).isFile();
    process.stdout.write(JSON.stringify(res));
  ' 2>&1)"
  assert_json "V1 all three link targets outside untouched" "$out" "j.outside === 'untouched\n|untouched\n|untouched\n'" "true"
  assert_json "V1 writeTextAtomic target is a regular file with the new bytes" "$out" "j.textIsFile === true && j.text === 'new text\n'" "true"
  assert_json "V1 writeMdAtomic target is a regular file" "$out" "j.mdIsFile" "true"
  assert_json "V1 mirror target is a regular file with the repo bytes" "$out" "j.dstIsFile === true && j.dst === 'roadmap\n'" "true"
}
caseV1

# V2 — project/<slug> is a link out of the vault: neither a mirror nor an io
# writer creates a folder or file through it.
# Red-making changes: dropping assertAncestorInside before the set-root mkdir
# in applyMirror (V2 mirror arm: product/ appears outside); dropping
# assertVaultWriteContained in writeTextAtomic (V2 spec init arm: spec/
# appears outside).
caseV2() {
  local w="$H_WORK/v2"
  h_setup v2
  mkdir -p "$w/outside"
  ln -s "$w/outside" "$H_VAULT/project/demo"
  h_run "$H_REPO" "$H_VAULT" - vault sync --json
  assert_rc "V2 sync through a linked project folder is refused" 2 "$H_RC" "$(cat "$H_ERR")"
  h_run "$w" "$H_VAULT" - spec init demo w5-linked --title "W5 linked"
  if [[ "$H_RC" -ne 0 ]]; then ok "V2 spec init through a linked project folder fails (exit $H_RC)"
  else bad "V2 spec init through a linked project folder exited 0"; fi
  assert_eq "V2 nothing created outside the vault" "$(h_listing "$w/outside")" ""
}
caseV2

# V3 — vault lint --fix-type on a linked project/<slug>: refused with one
# stderr line (exit 2 for the named slug; skipped in the all-slugs walk);
# the file behind the link is never stamped.
# Red-making change: dropping the lstat refusal in resolveTargets/allSlugs
# (the refusal lines disappear; the io guard still keeps the bytes outside).
caseV3() {
  local w="$H_WORK/v3" out
  mkdir -p "$w/vault/project" "$w/outside/spec"
  printf -- '---\nid: 003-x\nstatus: draft\n---\n# x\n' > "$w/outside/spec/003-x.md"
  cp "$w/outside/spec/003-x.md" "$w/orig.md"
  ln -s "$w/outside" "$w/vault/project/demo"
  h_run "$w" "$w/vault" - vault lint demo --json --fix-type
  assert_rc "V3 lint --fix-type on a linked slug exits 2" 2 "$H_RC" "$(cat "$H_ERR")"
  assert_eq "V3 one refusal line (named slug)" "$(grep -cF 'project folder is a symbolic link (refused): project/demo/' "$H_ERR" | tr -d ' ')" "1"
  h_run "$w" "$w/vault" - vault lint --json --fix-type
  assert_eq "V3 one refusal line (all slugs)" "$(grep -cF 'vault lint: skipped project/demo/ (symbolic link, refused)' "$H_ERR" | tr -d ' ')" "1"
  assert_eq "V3 file behind the link unchanged" "$(cmp -s "$w/orig.md" "$w/outside/spec/003-x.md"; echo $?)" "0"
}
caseV3

# V4 — vault link-hub with the hub note project/<slug>.md as a link to an
# outside file: refused with one stderr line, no outside content in the vault,
# the link itself not replaced (single → exit 1; --all-specs → refused_link).
# Red-making change: dropping refuseLinked in linkHub/linkSpecsIntoHub (the
# outside bytes plus the new line are renamed over the link into the vault).
caseV4() {
  local w="$H_WORK/v4"
  mkdir -p "$w/vault/project/demo/spec"
  printf -- '---\ntype: spec\nid: 003-x\n---\n# x\n' > "$w/vault/project/demo/spec/003-x.md"
  printf '%s\n\n## Relations\n' "$H_OUTSIDE_TEXT" > "$w/outside-hub.md"
  cp "$w/outside-hub.md" "$w/orig-hub.md"
  ln -s "$w/outside-hub.md" "$w/vault/project/demo.md"
  h_run "$w" "$w/vault" - vault link-hub demo --spec 003-x
  assert_rc "V4 link-hub on a linked hub exits 1" 1 "$H_RC" "$(cat "$H_ERR")"
  assert_eq "V4 exactly one refusal line" "$(grep -c 'vault link-hub: refused (hub note is a symbolic link: project/demo.md)' "$H_ERR" | tr -d ' ')" "1"
  h_run "$w" "$w/vault" - vault link-hub --all-specs
  assert_rc "V4 --all-specs exit" 0 "$H_RC" "$(cat "$H_ERR")"
  assert_json "V4 --all-specs lists demo under refused_link" "$H_OUT" "(j.refused_link || []).join(',')" "demo"
  assert_eq "V4 no outside content in any vault file" "$(h_outside_hits "$w/vault")" "0"
  if [[ -L "$w/vault/project/demo.md" ]]; then ok "V4 hub link not replaced"; else bad "V4 hub link replaced by a file"; fi
  assert_eq "V4 outside file unchanged" "$(cmp -s "$w/orig-hub.md" "$w/outside-hub.md"; echo $?)" "0"
}
caseV4

rm -rf "$H_WORK"
