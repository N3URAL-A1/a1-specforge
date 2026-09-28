#!/usr/bin/env bash
# Part 05c — Wave 10 agent B: `a1-tools vault writer` (spec 010 FR-041,
# FR-043; fixture map rows W14–W16, W21–W24) plus the text checks of the
# new-project workflow (FR-038, rows WF) and the ADR amendment (FR-036, AD),
# and the command's exit codes (WX). Sourced by run-tests.sh after 05b.
#
# Same rules as 05b: "this host" is A1_HOST_ID=host-a, every call sets all
# three variables after `env -u`, hubs are written HERE by printf in the
# measured real-hub shape with the key at the END of the frontmatter; only
# W14 and W16 let `vault writer` write a hub (class 3). The key line the
# command must produce is typed here as a literal, never read from the module.

X_WORK="$(mktemp -d)"
X_HOME="$X_WORK/home"; X_ERR="$X_WORK/stderr"
mkdir -p "$X_HOME"
X_OUT=""; X_RC=0
X_WRITER="$REPO_ROOT/_shared/lib/vault-writer.cjs"
X_CODE="$X_WORK/code"

# x_run <cwd> <vault|""> <writer|-> <host-id|-> <a1-tools args...>
x_run() {
  local cwd="$1" vault="$2" writer="$3" hostid="$4"; shift 4
  local envs=(HOME="$X_HOME" A1_CODE_ROOTS="$X_CODE")
  [[ -n "$vault" ]] && envs+=(A1_VAULT_ROOT="$vault")
  [[ "$writer" != "-" ]] && envs+=(A1_VAULT_WRITER_HOST="$writer")
  [[ "$hostid" != "-" ]] && envs+=(A1_HOST_ID="$hostid")
  X_OUT="$(cd "$cwd" && env -u A1_VAULT_ROOT -u A1_VAULT_WRITER_HOST -u A1_HOST_ID "${envs[@]}" node "$TOOLS" "$@" 2>"$X_ERR")"; X_RC=$?
}

# x_hub <vault> <slug> [frontmatter line...] — as w_hub in 05b.
x_hub() {
  local vault="$1" slug="$2"; shift 2
  local extra="" l
  for l in "$@"; do extra+="$l"$'\n'; done
  mkdir -p "$vault/project"
  printf -- '---\ntype: project\ntitle: %s\naliases:\n- %s-alias\ntags:\n- n3ural\nstatus: active\npermalink: vault/project/%s\ncluster: tooling\n%s---\n\n# %s\n\n## Relations\n\n- uses [[y]]\n' \
    "$slug" "$slug" "$slug" "$extra" "$slug" > "$vault/project/$slug.md"
}

# x_diff_lines <before> <after> — the changed lines of a unified diff (no headers).
x_diff_lines() { diff -u "$1" "$2" | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) ' ; }
x_mtime() { node -e 'process.stdout.write(String(require("fs").statSync(process.argv[1]).mtimeMs))' "$1"; }
x_manual_named() { grep -c 'nothing written; edit a1_writer_host: in the hub note in Obsidian' "$X_ERR" | tr -d ' '; }

mkdir -p "$X_CODE"
X_REPO_A="$X_CODE/alpha"
mkdir -p "$X_REPO_A"; git -C "$X_REPO_A" init -q 2>/dev/null || git init -q "$X_REPO_A"
x_run "$X_REPO_A" "" - - product init --project alpha --title alpha
x_run "$X_REPO_A" "" - - product add-milestone --id m1 --title M1
x_run "$X_REPO_A" "" - - product add-feature --id 001-login --milestone m1 --title Login

# W14 — the hand-over on the writer host changes exactly the key line; a
# repeat is a no-op (checked first, even though host-a is no longer the
# writer); setting it back from host-a is refused. Insert and --clear touch
# exactly one line too. Refusals exit 1, write nothing, name the manual path.
# Red-making change: allowing --set from a host that may not write (step 3).
caseW14() {
  local v="$X_WORK/w14" m
  x_hub "$v" alpha 'a1_writer_host: host-a'; cp "$v/project/alpha.md" "$X_WORK/w14.0"
  x_run "$X_WORK" "$v" - host-a vault writer alpha --set host-b --json
  assert_rc "W14 (1) --set host-b exit" 0 "$X_RC" "$(cat "$X_ERR")"
  assert_eq "W14 (1) unified diff is exactly the key line" "$(x_diff_lines "$X_WORK/w14.0" "$v/project/alpha.md" | tr '\n' '|')" "-a1_writer_host: host-a|+a1_writer_host: host-b|"
  cp "$v/project/alpha.md" "$X_WORK/w14.1"; m="$(x_mtime "$v/project/alpha.md")"; sleep 0.05
  x_run "$X_WORK" "$v" - host-a vault writer alpha --set host-b --json
  assert_rc "W14 (2) repeat exit" 0 "$X_RC" "$(cat "$X_ERR")"
  assert_eq "W14 (2) repeat writes nothing (mtime)" "$(x_mtime "$v/project/alpha.md")" "$m"
  x_run "$X_WORK" "$v" - host-a vault writer alpha --set host-a
  assert_rc "W14 (3) --set host-a from host-a" 1 "$X_RC" "$(cat "$X_ERR")"
  assert_eq "W14 (3) hub unchanged" "$(cmp -s "$X_WORK/w14.1" "$v/project/alpha.md"; echo $?)" "0"
  assert_eq "W14 (3) names the manual path" "$(x_manual_named)" "1"
  # insert (no key yet) and --clear
  x_hub "$v" beta; cp "$v/project/beta.md" "$X_WORK/w14.b0"
  x_run "$X_WORK" "$v" - host-a vault writer beta --set host-a
  assert_eq "W14 insert adds exactly the key line after the opening ---" "$(x_diff_lines "$X_WORK/w14.b0" "$v/project/beta.md" | tr '\n' '|')|$(sed -n 2p "$v/project/beta.md")" "+a1_writer_host: host-a||a1_writer_host: host-a"
  x_run "$X_WORK" "$v" - host-a vault writer beta --clear
  assert_eq "W14 --clear restores the original bytes" "$(cmp -s "$X_WORK/w14.b0" "$v/project/beta.md"; echo $?)" "0"
  # refusals: unreadable (duplicate key), symlinked hub, missing hub, no frontmatter, invalid id
  local u="$X_WORK/w14u"
  x_hub "$u" dup 'a1_writer_host: host-a' 'a1_writer_host: host-a'
  x_hub "$X_WORK/w14t" lnk 'a1_writer_host: host-a'; ln -s "$X_WORK/w14t/project/lnk.md" "$u/project/lnk.md"
  mkdir -p "$u/project/gone"
  printf '# no frontmatter\n' > "$u/project/plain.md"
  cp -R "$u" "$X_WORK/w14u.before"
  local s
  for s in dup lnk gone plain; do
    x_run "$X_WORK" "$u" - host-a vault writer "$s" --set host-b
    assert_rc "W14 refusal $s" 1 "$X_RC" "$(cat "$X_ERR")"
    assert_eq "W14 refusal $s names the manual path" "$(x_manual_named)" "1"
  done
  assert_eq "W14 refusals wrote nothing" "$(diff -r "$X_WORK/w14u.before" "$u" >/dev/null 2>&1; echo $?)" "0"
  x_run "$X_WORK" "$u" - host-a vault writer dup --set 'Bad Id'
  assert_rc "W14 invalid id" 2 "$X_RC" "$(cat "$X_ERR")"
  assert_eq "W14 invalid id not echoed" "$(grep -c 'Bad Id' "$X_ERR" | tr -d ' ')" "0"
}
caseW14

# W15 — the overview lists every hub and every hubless folder, sorted, and
# writes nothing.
# Red-making change: omitting undeclared projects or hubless folders.
caseW15() {
  local v="$X_WORK/w15"
  x_hub "$v" alpha 'a1_writer_host: host-a'; x_hub "$v" beta 'a1_writer_host: host-b'; x_hub "$v" gamma
  mkdir -p "$v/project/delta/spec"
  touch "$X_WORK/w15.marker"; sleep 0.05
  x_run "$X_WORK" "$v" - host-a vault writer --json
  assert_rc "W15 exit" 0 "$X_RC" "$(cat "$X_ERR")"
  assert_json "W15 rows sorted with writer_source" "$X_OUT" "j.projects.map((p) => p.slug + ':' + p.writer_host + ':' + p.writer_source + ':' + p.may_write).join(',')" \
    "alpha:host-a:hub:true,beta:host-b:hub:false,delta:unreadable:hub:false,gamma:undeclared:none:true"
  assert_json "W15 delta writer_class hub_missing" "$X_OUT" "j.projects.find((p) => p.slug === 'delta').writer_class" "hub_missing"
  assert_json "W15 host and host_source once" "$X_OUT" "[j.host, j.host_source, j.ignored_names].join(',')" "host-a,env,0"
  assert_eq "W15 nothing under the vault changed" "$(find "$v" -newer "$X_WORK/w15.marker" | wc -l | tr -d ' ')" "0"
}
caseW15

# W16 — hand-over end to end: host-a hands alpha to host-b, then its own
# product stage skips and host-b's vault sync writes.
# Red-making change: writing the key under another name (host-b never sees it).
caseW16() {
  local v="$X_WORK/w16"
  x_hub "$v" alpha 'a1_writer_host: host-a'
  x_run "$X_WORK" "$v" - host-a vault writer alpha --set host-b
  assert_rc "W16 --set host-b" 0 "$X_RC" "$(cat "$X_ERR")"
  assert_eq "W16 literal key line in the hub" "$(grep -cx 'a1_writer_host: host-b' "$v/project/alpha.md" | tr -d ' ')" "1"
  x_run "$X_REPO_A" "$v" - host-a product stage --by 001-login --set started
  assert_json "W16 host-a stage skips" "$X_OUT" "j.vault_mirror && j.vault_mirror.status" "skipped"
  [[ ! -e "$v/project/alpha/product" ]] && ok "W16 host-a wrote no mirror" || bad "W16 host-a wrote a mirror"
  x_run "$X_REPO_A" "$v" - host-b vault sync --json
  assert_json "W16 host-b sync writes" "$X_OUT" "j.status" "ok"
  [[ -f "$v/project/alpha/product/ROADMAP.md" ]] && ok "W16 host-b mirror written" || bad "W16 host-b mirror missing"
}
caseW16

# W21 — a conflict copy of the hub: status reports hub_conflict, the overview
# does not list the copy as a project and counts it.
# Red-making changes: listing conflict copies as projects; omitting hub_conflict.
caseW21() {
  local v="$X_WORK/w21"
  x_hub "$v" alpha 'a1_writer_host: host-a'; cp "$v/project/alpha.md" "$v/project/alpha (conflict 1).md"
  x_run "$X_REPO_A" "$v" - host-a vault status --json
  assert_json "W21 status hub_conflict" "$X_OUT" "j.hub_conflict" "true"
  x_run "$X_WORK" "$v" - host-a vault writer --json
  assert_json "W21 overview lists alpha only" "$X_OUT" "j.projects.map((p) => p.slug + ':' + p.hub_conflict).join(',')" "alpha:true"
  assert_json "W21 ignored_names" "$X_OUT" "j.ignored_names" "1"
}
caseW21

# W22 — hostile names: a folder with an ESC byte and a hub with a space are
# neither listed nor printed, in JSON or text.
# Red-making change: skipping the name filter.
caseW22() {
  local v="$X_WORK/w22"
  x_hub "$v" alpha; mkdir -p "$v/project/x"$'\x1b'"[2J"; x_hub "$v" "Bad Name"
  x_run "$X_WORK" "$v" - host-a vault writer --json
  assert_json "W22 only alpha listed" "$X_OUT" "j.projects.map((p) => p.slug).join(',')" "alpha"
  assert_json "W22 ignored_names" "$X_OUT" "j.ignored_names" "2"
  assert_eq "W22 JSON stdout has no ESC byte" "$(printf '%s' "$X_OUT" | LC_ALL=C grep -c $'\x1b' | tr -d ' ')" "0"
  x_run "$X_WORK" "$v" - host-a vault writer
  assert_eq "W22 text stdout has no ESC byte and no Bad Name" "$(printf '%s' "$X_OUT" | LC_ALL=C grep -c -e $'\x1b' -e 'Bad Name' | tr -d ' ')" "0"
  assert_eq "W22 stderr has no ESC byte" "$(LC_ALL=C grep -c $'\x1b' "$X_ERR" | tr -d ' ')" "0"
}
caseW22

# W23 — the hub changes between the gate read and the rename (injected fs
# adapter): exit 1, the hub keeps the adapter's bytes, no tmp file left.
# Red-making change: writing without the re-read.
caseW23() {
  local v="$X_WORK/w23" out
  x_hub "$v" alpha 'a1_writer_host: host-a'
  out="$(env -u A1_VAULT_ROOT -u A1_VAULT_WRITER_HOST -u A1_HOST_ID WRITER="$X_WRITER" ROOT="$v" HOME="$X_HOME" node -e '
    const fs = require("fs"), path = require("path");
    const w = require(process.env.WRITER), root = process.env.ROOT, hub = path.join(root, "project", "alpha.md");
    const theirs = "---\ntype: project\na1_writer_host: host-c\n---\n# changed by sync\n";
    const ops = { ...fs, writeFileSync: (p, d, o) => { fs.writeFileSync(p, d, o); fs.writeFileSync(hub, theirs); } };
    const r = w.setWriterHost({ root, slug: "alpha", target: "host-b", dryRun: false, env: { A1_HOST_ID: "host-a" }, osHost: "os-host", ops });
    const left = fs.readdirSync(path.join(root, "project")).filter((n) => n.includes(".tmp."));
    process.stdout.write(JSON.stringify({ code: r.code, same: fs.readFileSync(hub, "utf8") === theirs, left: left.length }));' 2>"$X_ERR")"
  assert_json "W23 exit 1" "$out" "j.code" "1"
  assert_json "W23 hub keeps the adapter bytes" "$out" "j.same" "true"
  assert_json "W23 no tmp file left" "$out" "j.left" "0"
}
caseW23

# W24 — typo guard: an id known nowhere warns and still writes; a known id
# (declared by another hub) does not warn.
# Red-making change: missing typo guard.
caseW24() {
  local v="$X_WORK/w24"
  x_hub "$v" alpha 'a1_writer_host: host-a'; x_hub "$v" beta 'a1_writer_host: host-b'
  x_run "$X_WORK" "$v" - host-a vault writer alpha --set hots-b
  assert_rc "W24 typo id still exit 0" 0 "$X_RC" "$(cat "$X_ERR")"
  assert_eq "W24 warning line" "$(grep -Fxc 'warning: hots-b is not a known writer id' "$X_ERR" | tr -d ' ')" "1"
  assert_eq "W24 written" "$(grep -cx 'a1_writer_host: hots-b' "$v/project/alpha.md" | tr -d ' ')" "1"
  x_hub "$v" alpha 'a1_writer_host: host-a'
  x_run "$X_WORK" "$v" - host-a vault writer alpha --set host-b
  assert_eq "W24 known id: no warning" "$(grep -c 'not a known writer id' "$X_ERR" | tr -d ' ')" "0"
}
caseW24

# W32 (Samuel M1) — the sentinel `undeclared` is no host id: --set exits 2
# and the hub stays byte-identical.
# Red-making change: dropping the reserved-value check in normalizeHostId.
caseW32() {
  local v="$X_WORK/w32"; x_hub "$v" alpha 'a1_writer_host: host-a'; cp "$v/project/alpha.md" "$X_WORK/w32.before"
  x_run "$X_WORK" "$v" - host-a vault writer alpha --set undeclared
  assert_rc "W32 --set undeclared" 2 "$X_RC" "$(cat "$X_ERR")"
  assert_eq "W32 hub byte-identical" "$(cmp -s "$X_WORK/w32.before" "$v/project/alpha.md"; echo $?)" "0"
}
caseW32

# W35 (Samuel m3, Reinhard MINOR 2) — the hand-over write: a failing rename is
# a clean refusal (exit code 1, message, no stack) and leaves no tmp file; the
# hub keeps its file mode.
# Red-making changes: no finally-unlink (tmp left); no try/catch in
# setWriterHost (the error escapes); no chmod of the tmp file (mode 0644).
caseW35() {
  local v="$X_WORK/w35" out
  x_hub "$v" alpha 'a1_writer_host: host-a'
  out="$(env -u A1_VAULT_ROOT -u A1_VAULT_WRITER_HOST -u A1_HOST_ID WRITER="$X_WRITER" ROOT="$v" HOME="$X_HOME" node -e '
    const fs = require("fs"), path = require("path");
    const w = require(process.env.WRITER), root = process.env.ROOT;
    const ops = { ...fs, renameSync: () => { const e = new Error("boom"); e.code = "EIO"; throw e; } };
    let r; try { r = w.setWriterHost({ root, slug: "alpha", target: "host-b", dryRun: false, env: { A1_HOST_ID: "host-a", A1_VAULT_WRITER_HOST: "host-b" }, osHost: "os-host", ops }); } catch (e) { r = { threw: e.message }; }
    const left = fs.readdirSync(path.join(root, "project")).filter((n) => n.includes(".tmp.")).length;
    process.stdout.write(JSON.stringify({ code: r.code, msg: r.message, threw: r.threw || null, left }));' 2>"$X_ERR")"
  assert_json "W35 refusal, not an exception" "$out" "[j.threw, j.code, j.msg].join('|')" "|1|could not write project/alpha.md (EIO) — nothing written"
  assert_json "W35 no tmp file left" "$out" "j.left" "0"
  chmod 600 "$v/project/alpha.md"
  x_run "$X_WORK" "$v" host-b host-a vault writer alpha --set host-b
  assert_rc "W35 --set on a 0600 hub" 0 "$X_RC" "$(cat "$X_ERR")"
  assert_eq "W35 hub mode kept" "$(node -e 'process.stdout.write((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$v/project/alpha.md")" "600"
}
caseW35

# WB (Reinhard NIT) — writer_host_before is the EFFECTIVE writer: a hub
# without the key resolved through the rollout aid reports that id.
# Red-making change: reporting the hub value only ("undeclared").
caseWB() {
  local v="$X_WORK/wb"; x_hub "$v" alpha
  x_run "$X_WORK" "$v" host-a host-a vault writer alpha --set host-a --json
  assert_json "WB writer_host_before from the env" "$X_OUT" "[j.writer_host_before, j.writer_host_after, j.action].join(',')" "host-a,host-a,set"
}
caseWB

# WX — exit codes: no external root → 2; a configured root that is missing →
# one warning, exit 0 (FR-043, FR-010); usage errors → 2.
# Red-making change: exiting 0 without a root, or 2 on a missing one.
caseWX() {
  x_run "$X_REPO_A" "" - host-a vault writer --json
  assert_rc "WX no external root" 2 "$X_RC" "$(cat "$X_ERR")"
  x_run "$X_WORK" "$X_WORK/does-not-exist" - host-a vault writer --json
  assert_rc "WX missing root" 0 "$X_RC" "$(cat "$X_ERR")"
  assert_eq "WX missing root: one skip line" "$(grep -c '^\[a1-tools\] vault writer skipped: vault root does not exist' "$X_ERR" | tr -d ' ')" "1"
  x_run "$X_WORK" "$X_WORK/w15" - host-a vault writer alpha
  assert_rc "WX <slug> without --set/--clear" 2 "$X_RC"
  x_run "$X_WORK" "$X_WORK/w15" - host-a vault writer --set host-a
  assert_rc "WX --set without <slug>" 2 "$X_RC"
}
caseWX

# WF — FR-038: the new-project workflow writes the hub at project/<slug>.md
# with a1_writer_host from `vault writer --json` .host, stamps only when
# host_source is env, and writes the hub before it creates project/<slug>/.
# Red-making changes: the old path project/<slug>/<slug>.md; the mkdir moved
# back above the hub write; the host_source check removed.
caseWF() {
  local f="$REPO_ROOT/skills/a1-new-project/workflows/04-feature-split.md" hub_at mkdir_at
  assert_eq "WF old hub path project/<slug>/<slug>.md gone" "$(grep -c 'project/<slug>/<slug>\.md' "$f" | tr -d ' ')" "0"
  assert_eq "WF hub written at project/<slug>.md with a1_writer_host" "$(grep -ci 'write `project/<slug>.md` with' "$f" | tr -d ' ')/$(grep -c 'a1_writer_host: <WRITER_ID>' "$f" | tr -d ' ')" "1/1"
  assert_eq "WF id taken from vault writer --json .host" "$(grep -c 'vault writer --json' "$f" | tr -d ' ')/$(grep -c 'JSON.parse(s).host)' "$f" | tr -d ' ')" "1/1"
  assert_eq "WF an existing hub is never rewritten; a keyless one gets vault writer --set" \
    "$(grep -c 'already$' "$f" | tr -d ' ')/$(grep -c 'never rewrite it' "$f" | tr -d ' ')/$(grep -c 'vault writer <slug> --set "\$WRITER_ID"' "$f" | tr -d ' ')" "1/1/1"
  assert_eq "WF stamps only with host_source env" "$(grep -c '\[ "\$HOST_SOURCE" = "env" \] ||' "$f" | tr -d ' ')" "1"
  hub_at="$(grep -ni 'write `project/<slug>.md` with' "$f" | head -1 | cut -d: -f1)"
  mkdir_at="$(grep -n 'mkdir -p "\$VROOT/project/<slug>/' "$f" | head -1 | cut -d: -f1)"
  if [[ -n "$hub_at" && -n "$mkdir_at" && "$hub_at" -lt "$mkdir_at" ]]; then ok "WF hub write ($hub_at) precedes the project folder mkdir ($mkdir_at)"
  else bad "WF hub write ($hub_at) does not precede the mkdir ($mkdir_at)"; fi
}
caseWF

# AD — FR-036: the ADR carries the dated amendment with the two required
# sentences, the ADR body stays ≤ 60 lines and the amendment ≤ 20.
# Red-making change: dropping either sentence, or growing past the limits.
caseAD() {
  local f="$REPO_ROOT/docs/adr/2026-09-24-vault-mirror-single-writer.md" at total
  at="$(grep -n '^## Amendment 2026-09-28 — per-project writer$' "$f" | cut -d: -f1)"
  total="$(wc -l < "$f" | tr -d ' ')"
  assert_eq "AD amendment heading present" "$([[ -n "$at" ]] && echo yes)" "yes"
  assert_eq "AD sentence: host-local ids" "$(grep -cF '`A1_HOST_ID` is set in a host-local file, never in a shared/synced dotfile; ids are permanent (renaming one stops every project declared to it)' "$f" | tr -d ' ')" "1"
  assert_eq "AD sentence: coordination, not authorisation" "$(grep -cF 'the hub key is a coordination declaration against mirror conflicts, not an authorisation control; any vault writer can change it' "$f" | tr -d ' ')" "1"
  assert_eq "AD names a1_writer_host, precedence and the hand-over command" \
    "$(grep -c 'a1_writer_host' "$f" | awk '{print ($1>0)}')$(grep -c 'Hub key → `A1_VAULT_WRITER_HOST`' "$f" | tr -d ' ')$(grep -c 'vault writer <slug> --set <new id>' "$f" | tr -d ' ')" "111"
  if [[ -n "$at" && $((at - 1)) -le 60 && $((total - at + 1)) -le 20 ]]; then ok "AD body $((at - 1)) ≤ 60 lines, amendment $((total - at + 1)) ≤ 20"
  else bad "AD size: body $((at - 1)), amendment $((total - at + 1))"; fi
}
caseAD

rm -rf "$X_WORK"
