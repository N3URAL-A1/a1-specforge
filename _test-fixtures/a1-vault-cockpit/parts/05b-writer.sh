#!/usr/bin/env bash
# Part 05b — Wave 10 agent A: the per-project writer host (spec 010 FR-034
# and FR-035 amended, FR-038..FR-040, FR-042; fixture map "per-project
# writer", rows W1–W13, W17, W19, W19b, W20, W25, W26 plus the plan's L1', X2
# and X3). Sourced by run-tests.sh after 05-hosts.sh, whose helpers (h_iso_ago,
# h_plant, H_LOCKS) it reuses. The `vault writer` command rows (W14–W16,
# W21–W24) live in 05c-writer-cmd.sh; W18 lands with spec 011 Wave 6 part B.
#
# "This host" is A1_HOST_ID=host-a, the other host host-b. Every call sets
# A1_VAULT_ROOT, A1_VAULT_WRITER_HOST and A1_HOST_ID explicitly after `env -u`
# of all three — nothing is inherited. Hubs are written HERE, by printf, in the
# shape measured on the real vault 2026-09-28 (LF, no BOM, `type/title/aliases/
# tags/status/permalink/cluster` frontmatter with column-0 list items, body with
# a `## Relations` block); the writer key is appended at the END of the
# frontmatter, where an Obsidian property edit puts it — never where
# `vault writer --set` would put it (testing.md class 3). Every expected value
# is a literal typed here (class 4); the lowercased host name comes from a
# separate `node -e` over os.hostname().
#
# RED record: see STATUS (Wave 10) — this part was run against a `git archive`
# of main 687f4b9 before the Wave 10 code, and every named mutation below was
# applied alone to a `git archive` copy of the finished tree.

W_WORK="$(mktemp -d)"
W_HOME="$W_WORK/home"; W_ERR="$W_WORK/stderr"
mkdir -p "$W_HOME"
W_OUT=""; W_RC=0
W_OS_HOST_LC="$(node -e 'process.stdout.write(require("os").hostname().toLowerCase())')"
W_OS_HOST="$(node -e 'process.stdout.write(require("os").hostname())')"
W_WRITER="$REPO_ROOT/_shared/lib/vault-writer.cjs"
W_COMMON="$REPO_ROOT/_shared/lib/vault-common.cjs"

# w_run <cwd> <vault> <writer|-> <host-id|-> <a1-tools args...> — "-" leaves
# the variable unset; any other value (also "") is exported as-is.
w_run() {
  local cwd="$1" vault="$2" writer="$3" hostid="$4"; shift 4
  local envs=(HOME="$W_HOME" A1_CODE_ROOTS="$W_CODE_ROOTS" A1_VAULT_ROOT="$vault")
  [[ "$writer" != "-" ]] && envs+=(A1_VAULT_WRITER_HOST="$writer")
  [[ "$hostid" != "-" ]] && envs+=(A1_HOST_ID="$hostid")
  W_OUT="$(cd "$cwd" && env -u A1_VAULT_ROOT -u A1_VAULT_WRITER_HOST -u A1_HOST_ID "${envs[@]}" node "$TOOLS" "$@" 2>"$W_ERR")"; W_RC=$?
}

# w_hub <vault> <slug> [frontmatter line...] — a hub in the measured shape;
# extra lines go at the end of the frontmatter block.
w_hub() {
  local vault="$1" slug="$2"; shift 2
  local extra="" l
  for l in "$@"; do extra+="$l"$'\n'; done
  mkdir -p "$vault/project"
  printf -- '---\ntype: project\ntitle: %s\naliases:\n- %s-alias\ntags:\n- n3ural\n- %s\nstatus: active\npermalink: vault/project/%s\ncluster: tooling\n%s---\n\n# %s\n\n> summary line\n\n## Relations\n\n- uses [[y]]\n' \
    "$slug" "$slug" "$slug" "$slug" "$extra" "$slug" > "$vault/project/$slug.md"
}

# w_repo <dir> <slug> — a git repo at <dir> whose product roadmap names project
# <slug> (one milestone, one feature), written vault-free.
w_repo() {
  local dir="$1" slug="$2"
  mkdir -p "$dir"
  git -C "$dir" init -q 2>/dev/null || git init -q "$dir"
  w_run "$dir" "" - - product init --project "$slug" --title "$slug"
  w_run "$dir" "" - - product add-milestone --id m1 --title M1
  w_run "$dir" "" - - product add-feature --id 001-login --milestone m1 --title Login
}

w_newer() { find "$1" -newer "$2" | wc -l | tr -d ' '; }
w_line_count() { grep -Fxc -- "$1" "$W_ERR" | tr -d ' '; }
w_esc_count() { LC_ALL=C grep -c $'\x1b' "$W_ERR" "$@" 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}'; }

# One code root holds every repo of this part; the vault differs per case.
W_CODE_ROOTS="$W_WORK/code"
W_REPO_A="$W_CODE_ROOTS/alpha"; W_REPO_B="$W_CODE_ROOTS/beta"; W_REPO_G="$W_CODE_ROOTS/gamma"
W_CODE_ROOTS_OTHER="$W_WORK/code-other"
w_repo "$W_REPO_A" alpha
w_repo "$W_REPO_B" beta
w_repo "$W_REPO_G" gamma

W_SKIP_A_B='[a1-tools] vault mirror skipped: this host is not the vault writer of alpha (host-a ≠ host-b)'

# W1 — hub beats the env in the refusing direction: hub alpha host-b, rollout
# aid host-a, this host host-a → skip with the exact FR-034 line, nothing in
# the vault newer than the marker.
# Red-making change: reading A1_VAULT_WRITER_HOST before the hub (env wins).
caseW1() {
  local v="$W_WORK/w1"; w_hub "$v" alpha 'a1_writer_host: host-b'; touch "$W_WORK/w1.marker"
  w_run "$W_REPO_A" "$v" host-a host-a product stage --by 001-login --set started
  assert_rc "W1 stage exit" 0 "$W_RC" "$(cat "$W_ERR")"
  assert_eq "W1 exact FR-034 skip line naming alpha" "$(w_line_count "$W_SKIP_A_B")" "1"
  assert_eq "W1 no vault file newer than the marker" "$(w_newer "$v" "$W_WORK/w1.marker")" "0"
  assert_json "W1 vault_mirror.status" "$W_OUT" "j.vault_mirror && j.vault_mirror.status" "skipped"
}
caseW1

# W2 — hub beats the env in the permitting direction: hub host-a, env host-b.
# Red-making change: env precedence (as W1, from the other side).
caseW2() {
  local v="$W_WORK/w2"; w_hub "$v" alpha 'a1_writer_host: host-a'
  w_run "$W_REPO_A" "$v" host-b host-a product stage --by 001-login --set started
  assert_json "W2 vault_mirror.status" "$W_OUT" "j.vault_mirror && j.vault_mirror.status" "ok"
  assert_eq "W2 roadmap mirrored byte-identical" "$(cmp -s "$W_REPO_A/docs/product/ROADMAP.md" "$v/project/alpha/product/ROADMAP.md"; echo $?)" "0"
}
caseW2

# W3 — per-slug resolution: ONE node process asks writerGateFor for alpha
# (host-a) and then beta (host-b); then `vault sync` per repo as CLI.
# Red-making change: a gate computed once per process and reused for the
# second slug (only the in-process half can see it).
caseW3() {
  local v="$W_WORK/w3" out
  w_hub "$v" alpha 'a1_writer_host: host-a'; w_hub "$v" beta 'a1_writer_host: host-b'
  out="$(env -u A1_VAULT_WRITER_HOST WRITER="$W_WRITER" ROOT="$v" A1_HOST_ID=host-a node -e '
    const w = require(process.env.WRITER);
    const a = w.writerGateFor("alpha", process.env.ROOT), b = w.writerGateFor("beta", process.env.ROOT);
    process.stdout.write(JSON.stringify({ a: a.mayWrite, b: b.mayWrite }));' 2>&1)"
  assert_json "W3 in-process: alpha mayWrite" "$out" "j.a" "true"
  assert_json "W3 in-process: beta mayWrite (same process, second slug)" "$out" "j.b" "false"
  w_run "$W_REPO_A" "$v" - host-a vault sync --json
  assert_json "W3 CLI: alpha synced" "$W_OUT" "j.status" "ok"
  [[ -f "$v/project/alpha/product/ROADMAP.md" ]] && ok "W3 CLI: alpha roadmap written" || bad "W3 CLI: alpha roadmap missing"
  w_run "$W_REPO_B" "$v" - host-a vault sync --json
  assert_json "W3 CLI: beta skipped" "$W_OUT" "j.status" "skipped"
  assert_eq "W3 CLI: skip line names beta" "$(w_line_count '[a1-tools] vault mirror skipped: this host is not the vault writer of beta (host-a ≠ host-b)')" "1"
  [[ ! -e "$v/project/beta" ]] && ok "W3 CLI: nothing written for beta" || bad "W3 CLI: project/beta/ created"
}
caseW3

# W4 — undeclared (no key, no rollout aid): writes; status says so.
# Red-making change: refusing when undeclared.
caseW4() {
  local v="$W_WORK/w4"; w_hub "$v" alpha
  w_run "$W_REPO_A" "$v" - host-a product stage --by 001-login --set started
  assert_json "W4 vault_mirror.status" "$W_OUT" "j.vault_mirror && j.vault_mirror.status" "ok"
  w_run "$W_REPO_A" "$v" - host-a vault status --json
  assert_json "W4 writer_host" "$W_OUT" "j.writer_host" "undeclared"
  assert_json "W4 writer_source" "$W_OUT" "j.writer_source" "none"
  assert_json "W4 may_write" "$W_OUT" "j.may_write" "true"
}
caseW4

# W5 — no key, rollout aid host-b: skip, reported as env.
# Red-making change: ignoring the env fallback.
caseW5() {
  local v="$W_WORK/w5"; w_hub "$v" alpha
  w_run "$W_REPO_A" "$v" host-b host-a product stage --by 001-login --set started
  assert_json "W5 vault_mirror.status" "$W_OUT" "j.vault_mirror && j.vault_mirror.status" "skipped"
  assert_eq "W5 skip line names the env writer" "$(w_line_count "$W_SKIP_A_B")" "1"
  w_run "$W_REPO_A" "$v" host-b host-a vault status --json
  assert_json "W5 writer_source" "$W_OUT" "j.writer_source" "env"
  assert_json "W5 writer_host" "$W_OUT" "j.writer_host" "host-b"
}
caseW5

# W6 — every unreadable declaration fails closed, even with the rollout aid
# naming this host: skip, writer_host unreadable, may_write false, the class
# on stderr, no ESC byte on stderr. One vault per sub-case.
# w6_check <label> <class> — runs sync + status on the prepared vault $v.
w6_check() {
  local label="$1" cls="$2"
  touch "$W_WORK/w6.marker"
  w_run "$W_REPO_A" "$v" host-a host-a vault sync --json
  assert_json "W6$label sync skipped" "$W_OUT" "j.status" "skipped"
  assert_eq "W6$label stderr names class $cls" "$(w_line_count "[a1-tools] vault mirror skipped: writer declaration of alpha unreadable ($cls) — create or repair project/alpha.md")" "1"
  assert_eq "W6$label stderr has no ESC byte" "$(w_esc_count)" "0"
  assert_eq "W6$label nothing mirrored" "$(find "$v/project" -path '*/product/*' -newer "$W_WORK/w6.marker" | wc -l | tr -d ' ')" "0"
  w_run "$W_REPO_A" "$v" host-a host-a vault status --json
  assert_json "W6$label writer_host unreadable" "$W_OUT" "j.writer_host" "unreadable"
  assert_json "W6$label may_write false" "$W_OUT" "j.may_write" "false"
  assert_eq "W6$label status JSON has no ESC byte" "$(printf '%s' "$W_OUT" | LC_ALL=C grep -c $'\x1b' | tr -d ' ')" "0"
}
# w6_raw <text> — the hub bytes exactly as given (printf %b escapes).
w6_raw() { mkdir -p "$v/project"; printf '%b' "$1" > "$v/project/alpha.md"; }
# Red-making changes: falling back to env on an unreadable hub (fail-open, all
# sub-cases red); for (e)-(h): returning `none` instead of `unreadable`.
caseW6() {
  local v
  v="$W_WORK/w6a"; w_hub "$v" alpha 'a1_writer_host: host-a' 'a1_writer_host: host-a'; w6_check a duplicate_key
  v="$W_WORK/w6b"; w_hub "$v" alpha $'a1_writer_host: host\x1b[2Ja'; w6_check b invalid_value
  v="$W_WORK/w6c"; w_hub "$v" alpha 'a1_writer_host: host-a' '  -b'; w6_check c folded
  v="$W_WORK/w6d"; w6_raw '---\ntype: project\na1_writer_host: host-a\n\n# alpha\n'; w6_check d unterminated_frontmatter
  v="$W_WORK/w6e1"; w_hub "$v" alpha 'a1_writer_host : host-a'; w6_check e1 invalid_key
  v="$W_WORK/w6e2"; w_hub "$v" alpha '"a1_writer_host": host-a'; w6_check e2 invalid_key
  v="$W_WORK/w6e3"; w_hub "$v" alpha 'A1_Writer_Host: host-a'; w6_check e3 invalid_key
  v="$W_WORK/w6f"; mkdir -p "$v/project"; : > "$v/project/alpha.md"; w6_check f empty
  v="$W_WORK/w6g"; mkdir -p "$v/project/alpha/spec"; w6_check g hub_missing
  v="$W_WORK/w6h"; w_hub "$W_WORK/w6h-target" alpha 'a1_writer_host: host-a'
  mkdir -p "$v/project"; ln -s "$W_WORK/w6h-target/project/alpha.md" "$v/project/alpha.md"; w6_check h link
  v="$W_WORK/w6i1"; w_hub "$v" alpha 'a1_writer_host: true'; w6_check i1 invalid_value
  v="$W_WORK/w6i2"; w_hub "$v" alpha 'a1_writer_host: 123'; w6_check i2 invalid_value
  v="$W_WORK/w6i3"; w_hub "$v" alpha 'a1_writer_host:'; w6_check i3 invalid_value
  v="$W_WORK/w6i4"; w_hub "$v" alpha 'a1_writer_host: host-a # c'; w6_check i4 invalid_value
}
caseW6

# W7 — a read error other than ENOENT is unreadable (read_error), not
# undeclared. Skipped as root (root reads a 000 file).
# Red-making change: treating every read error as ENOENT (undeclared).
caseW7() {
  if [[ "$(id -u)" -eq 0 ]]; then ok "W7 skipped: running as root (chmod 000 does not stop root)"; return; fi
  local v="$W_WORK/w7"; w_hub "$v" alpha 'a1_writer_host: host-a'; chmod 000 "$v/project/alpha.md"
  touch "$W_WORK/w7.marker"
  w_run "$W_REPO_A" "$v" host-a host-a vault sync --json
  assert_eq "W7 class read_error on stderr" "$(w_line_count '[a1-tools] vault mirror skipped: writer declaration of alpha unreadable (read_error) — create or repair project/alpha.md')" "1"
  assert_eq "W7 no vault file newer than the marker" "$(w_newer "$v" "$W_WORK/w7.marker")" "0"
  w_run "$W_REPO_A" "$v" host-a host-a vault status --json
  assert_json "W7 writer_host unreadable" "$W_OUT" "j.writer_host" "unreadable"
  chmod 644 "$v/project/alpha.md"
}
caseW7

# W8 — the id is trimmed and lowercased on both sides; unset → os.hostname().
# Red-making change: using os.hostname() while A1_HOST_ID is set.
caseW8() {
  local v="$W_WORK/w8"; w_hub "$v" alpha 'a1_writer_host: HOST-A'
  w_run "$W_REPO_A" "$v" - Host-A vault status --json
  assert_json "W8 A1_HOST_ID=Host-A: host" "$W_OUT" "j.host" "host-a"
  assert_json "W8 A1_HOST_ID=Host-A: host_source" "$W_OUT" "j.host_source" "env"
  assert_json "W8 hub HOST-A: may_write" "$W_OUT" "j.may_write" "true"
  w_run "$W_REPO_A" "$v" - - vault status --json
  assert_json "W8 unset: host_source" "$W_OUT" "j.host_source" "os"
  assert_json "W8 unset: host is the lowercased os.hostname()" "$W_OUT" "j.host" "$W_OS_HOST_LC"
}
caseW8

# W9 — an invalid A1_HOST_ID refuses declared projects, keeps undeclared ones.
# Red-making change: using the invalid id verbatim in the comparison.
caseW9() {
  local v="$W_WORK/w9"; w_hub "$v" alpha 'a1_writer_host: host-a'; w_hub "$v" gamma
  w_run "$W_REPO_A" "$v" - 'bad id' vault status --json
  assert_json "W9 alpha may_write" "$W_OUT" "j.may_write" "false"
  assert_json "W9 alpha host_source" "$W_OUT" "j.host_source" "invalid"
  w_run "$W_REPO_G" "$v" - 'bad id' vault status --json
  assert_json "W9 gamma (undeclared) may_write" "$W_OUT" "j.may_write" "true"
  # W6 i on the host side: these are no ids either (FR-039).
  local out
  out="$(COMMON="$W_COMMON" node -e '
    const { hostIdentity } = require(process.env.COMMON);
    process.stdout.write(["true", "123", "host-a # c", " "].map((v) => hostIdentity({ A1_HOST_ID: v }, "os-host").source).join(","));' 2>&1)"
  assert_eq "W9 ids true/123/'host-a # c' invalid, blank falls back to os" "$out" "invalid,invalid,invalid,os"
}
caseW9

# W10 / L1' — lock payload and staleness use one lockHostIdentity().
# Red-making changes: writing os.hostname() into the payload (W10); dropping
# the lowercase step in hostIdentity() (L1', stubbed osHost with capitals).
caseW10() {
  local f="$W_WORK/w10/reservations.json" out
  mkdir -p "$W_WORK/w10"
  env -u A1_HOST_ID A1_HOST_ID=host-a LOCKS="$H_LOCKS" RES_FILE="$f" node -e 'require(process.env.LOCKS).acquireReservationsLock(process.env.RES_FILE)' 2>&1
  assert_json "W10 lock hostname with A1_HOST_ID=host-a" "$(cat "$f.lock" 2>/dev/null)" "j.hostname" "host-a"
  out="$(env -u A1_HOST_ID COMMON="$W_COMMON" LOCKS="$H_LOCKS" node -e '
    const { hostIdentity } = require(process.env.COMMON), { lockHostIdentity } = require(process.env.LOCKS);
    process.stdout.write([hostIdentity({}, "Mixed-Host.LAN").host, lockHostIdentity({}, "Mixed-Host.LAN")].join(","));' 2>&1)"
  assert_eq "L1' A1_HOST_ID unset: identity and lock host are the lowercased os host" "$out" "mixed-host.lan,mixed-host.lan"
  rm -f "$f.lock"
  env -u A1_HOST_ID LOCKS="$H_LOCKS" RES_FILE="$f" node -e 'require(process.env.LOCKS).acquireReservationsLock(process.env.RES_FILE)' 2>&1
  assert_json "L1' real lock hostname equals the lowercased os.hostname()" "$(cat "$f.lock" 2>/dev/null)" "j.hostname" "$W_OS_HOST_LC"
}
caseW10

# w_spec <vault> <slug> <id> — a spec without `type:` (a --fix-type candidate).
w_spec() { mkdir -p "$1/project/$2/spec"; printf -- '---\nid: %s\nstatus: draft\n---\n# %s\n' "$3" "$3" > "$1/project/$2/spec/$3.md"; }

# W11 — lint --fix-type without slug gates per project: alpha (host-a) is
# stamped, beta (host-b) and gamma (two key lines) keep their bytes; both are
# listed in skipped_projects with their reason; findings of all three stay.
# Red-making changes: a global gate (stamping beta, or skipping alpha); for
# gamma: reporting unreadable as not-writer.
caseW11() {
  local v="$W_WORK/w11" s
  w_hub "$v" alpha 'a1_writer_host: host-a'; w_hub "$v" beta 'a1_writer_host: host-b'
  w_hub "$v" gamma 'a1_writer_host: host-a' 'a1_writer_host: host-a'
  for s in alpha beta gamma; do w_spec "$v" "$s" "001-$s"; done
  w_spec "$v" "Bad Name" 001-bad   # fails PRODUCT_SLUG_RE: counted, never gated, never stamped
  cp -R "$v" "$W_WORK/w11.before"
  w_run "$W_WORK" "$v" - host-a vault lint --fix-type --json
  assert_rc "W11 exit 1 (findings kept)" 1 "$W_RC" "$(cat "$W_ERR")"
  assert_eq "W11 alpha stamped" "$(sed -n 2p "$v/project/alpha/spec/001-alpha.md")" "type: spec"
  assert_eq "W11 beta bytes unchanged" "$(cmp -s "$W_WORK/w11.before/project/beta/spec/001-beta.md" "$v/project/beta/spec/001-beta.md"; echo $?)" "0"
  assert_eq "W11 gamma bytes unchanged" "$(cmp -s "$W_WORK/w11.before/project/gamma/spec/001-gamma.md" "$v/project/gamma/spec/001-gamma.md"; echo $?)" "0"
  assert_json "W11 skipped_projects" "$W_OUT" "j.skipped_projects.map((p) => p.slug + ':' + p.reason + ':' + p.writer_host).join(',')" "beta:not-writer:host-b,gamma:writer-unreadable:unreadable"
  assert_json "W11 type_missing still reported for beta and gamma" "$W_OUT" "j.findings.filter((f) => f.class === 'type_missing').map((f) => f.path).join(',')" "project/Bad Name/spec/001-bad.md,project/beta/spec/001-beta.md,project/gamma/spec/001-gamma.md"
  assert_eq "W11 Bad Name bytes unchanged" "$(cmp -s "$W_WORK/w11.before/project/Bad Name/spec/001-bad.md" "$v/project/Bad Name/spec/001-bad.md"; echo $?)" "0"
  assert_json "W11 ignored_names counts the bad name" "$W_OUT" "j.ignored_names" "1"
  assert_eq "W11 bad name never on stderr" "$(grep -c 'Bad Name' "$W_ERR" | tr -d ' ')" "0"
  assert_eq "W11 skip line for beta" "$(w_line_count '[a1-tools] vault lint --fix-type skipped for beta: this host is not the vault writer of beta (host-a ≠ host-b)')" "1"
  assert_eq "W11 skip line for gamma" "$(w_line_count '[a1-tools] vault lint --fix-type skipped for gamma: writer declaration of gamma unreadable (duplicate_key) — create or repair project/gamma.md')" "1"
}
caseW11

# W12 — link-hub --all-specs without slug gates per project.
# Red-making change: gate evaluated once for all projects.
caseW12() {
  local v="$W_WORK/w12"
  w_hub "$v" alpha 'a1_writer_host: host-a'; w_hub "$v" beta 'a1_writer_host: host-b'
  w_spec "$v" alpha 001-alpha; w_spec "$v" beta 001-beta
  w_hub "$v" "Bad Name"; w_spec "$v" "Bad Name" 001-bad
  cp "$v/project/beta.md" "$W_WORK/w12.beta.before"
  cp "$v/project/Bad Name.md" "$W_WORK/w12.bad.before"
  w_run "$W_WORK" "$v" - host-a vault link-hub --all-specs
  assert_rc "W12 exit" 0 "$W_RC" "$(cat "$W_ERR")"
  assert_eq "W12 alpha hub linked" "$(grep -cxF -- '- references [[project/alpha/spec/001-alpha]]' "$v/project/alpha.md" | tr -d ' ')" "1"
  assert_eq "W12 beta hub unchanged" "$(cmp -s "$W_WORK/w12.beta.before" "$v/project/beta.md"; echo $?)" "0"
  assert_json "W12 skipped_projects lists beta" "$W_OUT" "j.skipped_projects.map((p) => p.slug + ':' + p.reason).join(',')" "beta:not-writer"
  assert_eq "W12 skip line for beta" "$(w_line_count '[a1-tools] vault link-hub skipped for beta: this host is not the vault writer of beta (host-a ≠ host-b)')" "1"
  assert_json "W12 ignored_names counts the bad name (hub + folder = one name)" "$W_OUT" "j.ignored_names" "1"
  assert_eq "W12 bad-name hub unchanged" "$(cmp -s "$W_WORK/w12.bad.before" "$v/project/Bad Name.md"; echo $?)" "0"
  assert_eq "W12 bad name never on stderr" "$(grep -c 'Bad Name' "$W_ERR" | tr -d ' ')" "0"
}
caseW12

# W13 — spec init: the spec file is written on every host, the hub link is
# gated on the SPEC's project, not on the cwd repo (alpha, writable).
# Red-making changes: gating the spec file write itself; gating on the cwd
# repo's slug instead of the spec's project.
caseW13() {
  local v="$W_WORK/w13"
  w_hub "$v" alpha 'a1_writer_host: host-a'; w_hub "$v" beta 'a1_writer_host: host-b'
  cp "$v/project/beta.md" "$W_WORK/w13.beta.before"
  w_run "$W_REPO_A" "$v" - host-a spec init beta w10-feat --title "W10 feature"
  assert_rc "W13 spec init beta exit" 0 "$W_RC" "$(cat "$W_ERR")"
  assert_json "W13 beta hub skipped-non-writer" "$W_OUT" "j.hub" "skipped-non-writer"
  assert_eq "W13 beta spec file written with type: spec" "$(grep -lx 'type: spec' "$v"/project/beta/spec/*w10-feat.md 2>/dev/null | wc -l | tr -d ' ')" "1"
  assert_eq "W13 beta hub unchanged" "$(cmp -s "$W_WORK/w13.beta.before" "$v/project/beta.md"; echo $?)" "0"
  w_run "$W_REPO_A" "$v" - host-a spec init alpha w10-feat2 --title "W10 feature two"
  assert_json "W13 alpha hub linked" "$W_OUT" "j.hub" "linked"
}
caseW13

# W17 — the gate uses the roadmap `project:`, not the repo directory name.
# Red-making change: gating on the repo directory name.
caseW17() {
  local v="$W_WORK/w17" r="$W_CODE_ROOTS_OTHER/other-dir"
  w_hub "$v" alpha 'a1_writer_host: host-b'
  mkdir -p "$W_CODE_ROOTS_OTHER"; cp -R "$W_REPO_A" "$r"
  local roots="$W_CODE_ROOTS"; W_CODE_ROOTS="$W_CODE_ROOTS_OTHER"
  w_run "$r" "$v" - host-a product stage --by 001-login --set started
  W_CODE_ROOTS="$roots"
  assert_json "W17 vault_mirror.status" "$W_OUT" "j.vault_mirror && j.vault_mirror.status" "skipped"
  assert_eq "W17 skip line names slug alpha" "$(w_line_count "$W_SKIP_A_B")" "1"
}
caseW17

# N5 — FR-034 (review n5): the product hook's slug must pass PRODUCT_SLUG_RE
# before the gate runs; the refused value is never echoed.
# Red-making change: dropping the PRODUCT_SLUG_RE check in committedSlug()
# (the mirror then writes project/Alpha_Beta/).
caseN5() {
  local v="$W_WORK/n5" r="$W_WORK/n5-code/n5repo"
  mkdir -p "$v/project" "$W_WORK/n5-code"; cp -R "$W_REPO_A" "$r"
  sed -i.bak 's/^project: alpha$/project: Alpha_Beta/' "$r/docs/product/ROADMAP.md" && rm -f "$r/docs/product/ROADMAP.md.bak"
  local roots="$W_CODE_ROOTS"; W_CODE_ROOTS="$W_WORK/n5-code"
  w_run "$r" "$v" - host-a product stage --by 001-login --set started
  W_CODE_ROOTS="$roots"
  assert_json "N5 vault_mirror.status" "$W_OUT" "j.vault_mirror && j.vault_mirror.status" "skipped"
  assert_eq "N5 nothing under project/" "$(find "$v/project" -mindepth 1 | wc -l | tr -d ' ')" "0"
  assert_eq "N5 skip line without the value" "$(w_line_count '[a1-tools] vault mirror skipped: ROADMAP.md project: is not a valid project slug')" "1"
}
caseN5

# W19 — an invalid A1_HOST_ID: the lock carries os.hostname(), status shows
# `<invalid>` in JSON and in the text line, never the raw value.
# Red-making change: writing the invalid id into the lock, or echoing it.
caseW19() {
  local f="$W_WORK/w19/reservations.json" v="$W_WORK/w19v"
  mkdir -p "$W_WORK/w19"; w_hub "$v" alpha 'a1_writer_host: host-a'
  env -u A1_HOST_ID A1_HOST_ID='bad id' LOCKS="$H_LOCKS" RES_FILE="$f" node -e 'require(process.env.LOCKS).acquireReservationsLock(process.env.RES_FILE)' 2>&1
  assert_json "W19 lock hostname equals os.hostname()" "$(cat "$f.lock" 2>/dev/null)" "j.hostname" "$W_OS_HOST"
  w_run "$W_REPO_A" "$v" - 'bad id' vault status --json
  assert_json "W19 JSON host" "$W_OUT" "j.host" "<invalid>"
  w_run "$W_REPO_A" "$v" - 'bad id' vault status
  assert_eq "W19 text line shows <invalid>" "$(grep -c '^\[a1-tools\] vault writer: host <invalid> (invalid), writer_host host-a (hub), may_write false, hub_conflict false$' "$W_ERR" | tr -d ' ')" "1"
  assert_eq "W19 raw id never echoed" "$(grep -c 'bad id' "$W_ERR" | tr -d ' ')" "0"
}
caseW19

# W19b — under an invalid A1_HOST_ID a dead-pid lock carrying os.hostname() is
# same-host and reclaimed at once.
# Red-making change: FR-033 comparing against the invalid raw id (the lock
# then looks foreign and stays live).
caseW19b() {
  local f="$W_WORK/w19b/reservations.json" out
  mkdir -p "$W_WORK/w19b"
  h_plant "$f.lock" 999999 "$(h_iso_ago 0)" "$W_OS_HOST"
  out="$(env -u A1_HOST_ID A1_HOST_ID='bad id' LOCKS="$H_LOCKS" RES_FILE="$f" node -e '
    const t0 = Date.now(); require(process.env.LOCKS).acquireReservationsLock(process.env.RES_FILE);
    const j = JSON.parse(require("fs").readFileSync(process.env.RES_FILE + ".lock", "utf8"));
    process.stdout.write(JSON.stringify({ mine: j.pid === process.pid, ms: Date.now() - t0 }));' 2>&1)"
  assert_json "W19b dead same-host lock reclaimed" "$out" "j.mine" "true"
  assert_json "W19b reclaimed at once (< 1 s)" "$out" "j.ms < 1000" "true"
}
caseW19b

# W20 — spec authoring is never gated: update-status on a spec of a project
# whose writer is host-b, as host-a.
# Red-making change: gating spec authoring.
caseW20() {
  local v="$W_WORK/w20" spec
  w_hub "$v" beta
  w_run "$W_REPO_A" "$v" - host-a spec init beta w20-feat --title "W20 feature"
  spec="$(ls "$v"/project/beta/spec/*w20-feat.md 2>/dev/null | head -1)"
  w_hub "$v" beta 'a1_writer_host: host-b'
  w_run "$W_REPO_A" "$v" - host-a spec update-status "$spec" draft
  assert_rc "W20 update-status exit" 0 "$W_RC" "$(cat "$W_ERR")"
  assert_eq "W20 spec file rewritten" "$(grep -cx 'status: draft' "$spec" | tr -d ' ')" "1"
  assert_eq "W20 no skip line" "$(grep -c 'skipped' "$W_ERR" | tr -d ' ')" "0"
}
caseW20

# W25 — a hub with a UTF-8 BOM and CRLF line ends still declares.
# Red-making change: parsing without stripping BOM/CR.
caseW25() {
  local v="$W_WORK/w25"; mkdir -p "$v/project"
  printf '\xef\xbb\xbf---\r\ntype: project\r\ntitle: alpha\r\nstatus: active\r\na1_writer_host: host-a\r\n---\r\n\r\n# alpha\r\n' > "$v/project/alpha.md"
  w_run "$W_REPO_A" "$v" - host-a vault status --json
  assert_json "W25 writer_source" "$W_OUT" "j.writer_source" "hub"
  assert_json "W25 may_write for host-a" "$W_OUT" "j.may_write" "true"
}
caseW25

# W26 — no hub and no folder: undeclared, the mirror is written.
# Red-making change: every ENOENT treated as hub_missing.
caseW26() {
  local v="$W_WORK/w26"; mkdir -p "$v"
  w_run "$W_REPO_A" "$v" - host-a vault sync --json
  assert_json "W26 sync ok" "$W_OUT" "j.status" "ok"
  [[ -f "$v/project/alpha/product/ROADMAP.md" ]] && ok "W26 mirror written" || bad "W26 mirror missing"
  mkdir -p "$W_WORK/w26-status"
  w_run "$W_REPO_A" "$W_WORK/w26-status" - host-a vault status --json
  assert_json "W26 writer_host undeclared" "$W_OUT" "j.writer_host" "undeclared"
}
caseW26

# ---------- review round 2026-09-28 (Samuel + Reinhard) ----------

# W27–W30 restore the Wave 5 rows H6–H8 (deleted with H1–H4 in 977c6c0, which
# the plan did not retire) with a hub declaration instead of the env writer.

# W27 (was H6) — single-slug lint --fix-type on a non-writer: nothing stamped,
# fix_type skipped-non-writer, the exact skip line, findings exit code kept.
# Red-making change: `const notWriter = null;` in fixTypeTargets' slug branch.
caseW27() {
  local v="$W_WORK/w27"; w_hub "$v" alpha 'a1_writer_host: host-b'; w_spec "$v" alpha 001-alpha
  cp "$v/project/alpha/spec/001-alpha.md" "$W_WORK/w27.before"
  w_run "$W_WORK" "$v" - host-a vault lint alpha --json --fix-type
  assert_rc "W27 exit 1 (findings)" 1 "$W_RC" "$(cat "$W_ERR")"
  assert_json "W27 fix_type" "$W_OUT" "j.fix_type" "skipped-non-writer"
  assert_eq "W27 exact skip line" "$(w_line_count '[a1-tools] vault lint --fix-type skipped: this host is not the vault writer of alpha (host-a ≠ host-b)')" "1"
  assert_eq "W27 spec bytes unchanged" "$(cmp -s "$W_WORK/w27.before" "$v/project/alpha/spec/001-alpha.md"; echo $?)" "0"
}
caseW27

# W28 (was H7a) — single link-hub --spec on a non-writer: status skipped,
# exit 0, the exact skip line, hub byte-identical.
# Red-making change: cmdVaultLinkHub calling linkHub instead of linkHubGated.
caseW28() {
  local v="$W_WORK/w28"; w_hub "$v" alpha 'a1_writer_host: host-b'; w_spec "$v" alpha 001-alpha
  cp "$v/project/alpha.md" "$W_WORK/w28.before"
  w_run "$W_WORK" "$v" - host-a vault link-hub alpha --spec 001-alpha
  assert_rc "W28 exit" 0 "$W_RC" "$(cat "$W_ERR")"
  assert_json "W28 status" "$W_OUT" "j.status" "skipped"
  assert_eq "W28 exact skip line" "$(w_line_count '[a1-tools] vault link-hub skipped: this host is not the vault writer of alpha (host-a ≠ host-b)')" "1"
  assert_eq "W28 hub byte-identical" "$(cmp -s "$W_WORK/w28.before" "$v/project/alpha.md"; echo $?)" "0"
}
caseW28

# W29 (was H7c) — a bare link-hub is a usage error (exit 1) on a non-writer
# too, with no skip line: the argument checks run before the gate.
# Red-making change: gating before the argument checks (exit 0 + skip line).
caseW29() {
  local v="$W_WORK/w29"; w_hub "$v" alpha 'a1_writer_host: host-b'
  w_run "$W_WORK" "$v" - host-a vault link-hub
  assert_rc "W29 bare link-hub" 1 "$W_RC" "$(head -c 200 "$W_ERR")"
  assert_eq "W29 no skip line" "$(grep -c '^\[a1-tools\] .*skipped' "$W_ERR" | tr -d ' ')" "0"
}
caseW29

# W30 (was H8) — spec init on a non-writer: the hub-link skip line verbatim.
# Red-making change: the generic 'vault mirror' label in linkHubGated's caller.
caseW30() {
  local v="$W_WORK/w30"; w_hub "$v" alpha 'a1_writer_host: host-b'
  w_run "$W_WORK" "$v" - host-a spec init alpha w30-feat --title "W30 feature"
  assert_json "W30 hub" "$W_OUT" "j.hub" "skipped-non-writer"
  assert_eq "W30 exact skip line" "$(w_line_count '[a1-tools] spec init hub link skipped: this host is not the vault writer of alpha (host-a ≠ host-b)')" "1"
}
caseW30

# W31 (Samuel M1) — the gate's sentinel values are no ids: a hub declaring
# `undeclared` or `unreadable` is unreadable (invalid_value) and closed on
# BOTH hosts; the class is named, never "undefined".
# Red-making changes: dropping the reserved-value check in normalizeHostId;
# deciding mayWrite on the value (=== 'undeclared') instead of the source.
caseW31() {
  local v val h
  for val in undeclared unreadable; do
    v="$W_WORK/w31-$val"; w_hub "$v" alpha "a1_writer_host: $val"; touch "$W_WORK/w31.marker"
    for h in host-a host-b; do
      w_run "$W_REPO_A" "$v" - "$h" vault status --json
      assert_json "W31 hub '$val' as $h: may_write" "$W_OUT" "j.may_write" "false"
      assert_json "W31 hub '$val' as $h: writer_host/class" "$W_OUT" "j.writer_host + '/' + j.writer_class" "unreadable/invalid_value"
      w_run "$W_REPO_A" "$v" - "$h" vault sync --json
      assert_eq "W31 hub '$val' as $h: no '(undefined)' on stderr" "$(grep -c '(undefined)' "$W_ERR" | tr -d ' ')" "0"
    done
    w_run "$W_REPO_A" "$v" - host-a vault sync --json
    assert_eq "W31 hub '$val': sync skip line names invalid_value" "$(w_line_count '[a1-tools] vault mirror skipped: writer declaration of alpha unreadable (invalid_value) — create or repair project/alpha.md')" "1"
    assert_eq "W31 hub '$val': nothing mirrored" "$(find "$v/project" -path '*/product/*' | wc -l | tr -d ' ')" "0"
  done
}
caseW31

# W31b (Samuel M1, second fix) — mayWrite is decided on the writer SOURCE: even
# a declaration whose value is the sentinel `undeclared` (reachable only if a
# future reader path skipped normalizeHostId) stays closed. In-process, because
# with the reserved-value check in place no hub or env can produce it (the CLI
# rows W31/W33 cannot see this mutation — defence in depth).
# Red-making change: mayWrite on the value (`writerHost === 'undeclared'`).
caseW31b() {
  local out
  out="$(env -u A1_HOST_ID WRITER="$W_WRITER" node -e '
    const w = require(process.env.WRITER);
    const g = w.gateFromDeclaration("alpha", { state: "declared", value: "undeclared" }, { A1_HOST_ID: "host-a" }, "os-host");
    process.stdout.write(JSON.stringify({ may: g.mayWrite, src: g.writerSource }));' 2>&1)"
  assert_json "W31b declared 'undeclared' value: may_write false (source hub)" "$out" "j.may + ',' + j.src" "false,hub"
}
caseW31b

# W33 (Samuel M1 env side, Reinhard MINOR 1) — A1_VAULT_WRITER_HOST=undeclared
# for a hub without the key: no open write, and the reason names the variable.
# Red-making changes: dropping the reserved-value check (the env value then
# declares "undeclared"); mayWrite on the value (every host writes).
caseW33() {
  local v="$W_WORK/w33"; w_hub "$v" alpha
  w_run "$W_REPO_A" "$v" undeclared host-a product stage --by 001-login --set started
  assert_json "W33 vault_mirror.status" "$W_OUT" "j.vault_mirror && j.vault_mirror.status" "skipped"
  assert_eq "W33 reason names the variable" "$(w_line_count '[a1-tools] vault mirror skipped: fallback writer of alpha unreadable: A1_VAULT_WRITER_HOST is not a valid host id')" "1"
  [[ ! -e "$v/project/alpha/product" ]] && ok "W33 nothing mirrored" || bad "W33 mirror written"
  w_run "$W_REPO_A" "$v" undeclared host-a vault status --json
  assert_json "W33 status" "$W_OUT" "[j.writer_source, j.writer_host, j.may_write].join(',')" "env,unreadable,false"
}
caseW33

# W34 (Samuel m2) — YAML folds across blank lines: key, blank line, `  -b`.
# Red-making change: testing only the line right after the key.
caseW34() {
  local v="$W_WORK/w34"; w_hub "$v" alpha 'a1_writer_host: host-a' '' '  -b'
  w_run "$W_REPO_A" "$v" - host-a vault status --json
  assert_json "W34 unreadable/folded" "$W_OUT" "j.writer_host + '/' + j.writer_class" "unreadable/folded"
  assert_json "W34 may_write" "$W_OUT" "j.may_write" "false"
}
caseW34

# X2 — the export contract is unchanged by Wave 10 (no version bump).
# Red-making change: adding writer fields to the export without a bump.
caseX2() {
  w_run "$W_WORK" "$W_WORK/w26" - - schema export --json
  printf '%s\n' "$W_OUT" > "$W_WORK/x2.json"
  assert_eq "X2 schema export equals the v1 golden" "$(cmp -s "$W_WORK/x2.json" "$GOLDEN"; echo $?)" "0"
}
caseX2

# X3 — regression guard (already true before Wave 10): no `vault status --all`.
# Red-making change: accepting --all silently.
caseX3() {
  w_run "$W_REPO_A" "$W_WORK/w26" - host-a vault status --all
  assert_rc "X3 vault status --all" 2 "$W_RC" "$(head -c 200 "$W_ERR")"
}
caseX3

rm -rf "$W_WORK"
