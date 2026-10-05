#!/usr/bin/env bash
# cases/05b-child-seal.sh — spec 011 Wave 5b: a1-tools child mode (FR-041),
# `intent seal` + verifySeal (FR-040), the conditional allowed-tools rewrite
# (FR-044) and the catalog growth to 17/6. Sourced by run-tests.sh.
#
# Isolation: every call runs with HOME = a sandbox home. The fake plugin tree
# and its installed_plugins.json live under that home (shape copied from the
# real file: {version, plugins: {"a1-specforge@a1-specforge": [{installPath,
# version, ...}]}}), the SKILL.md files are copies of this repo's real ones.
# The real ~/.a1-intents and the real plugin cache are never touched.
# The B1 constant ships `true` since Wave 6 part B (RESEARCH.md rounds 4–5,
# B1: WIDENS); the seal cases run against copies of _shared/ under $WORK whose
# one constant line is set to null, false or true (w5b_tools), so no runtime
# switch for the gate exists.
#
# RED proof (CONVENTIONS.md): the single production change that turns each
# case red, each measured on a `git archive HEAD` copy before commit.
#   H1  treating a missing allowlist entry as allowed (H1a, H1b, H1e);
#       refusing before the allowlist lookup succeeds (H1c: allowlisted runs).
#       H1d is a pin: `--help` has no sub AND no allowlist entry (both must go).
#       Removing the dispatcher's guard line turns H1a, H2a, H5a red.
#   H2  comparing the raw string instead of the realpath (H2c: symlink out);
#       checking only the separate-value flag form (H2b: --dir=…); checking
#       only flag values, not positionals (H2g, H2h: find-duplicates keywords
#       reach no resolver); no ~ expansion (H2h); resolving lexically before
#       the realpath (H2f: lnk/../ follows the link); refusing on any
#       resolution error (H2e). H2f2 is a pin (lexically outside as well).
#   H3  guarding only CLI flags, not the io.cjs resolvers (H3a: resolveVaultPath
#       — the spec under project/other/ changes; H3b/H3b2: projectsPath —
#       next-suffix of another slug exits 0; H3b3 pins the refused path);
#       dropping the child check in spec init's hub branch (H3b2: the spec is
#       written, then the hub beside project/<slug>/ is refused mid-command).
#   H4  deciding child mode from the variable alone (H4a, H4b); treating any
#       live lock pid as an ancestor (H4c); ignoring the lock hostname (H4d).
#       H4e (dead pid) is a pin: a dead pid is never in the ancestor chain.
#   H5  defaulting the project to the cwd basename (H5a); accepting any
#       project string (H5b) or action (H5c, H5d); dropping the
#       inside-~/claude-projects check of the project realpath (H5e: an
#       escaping project symlink); dropping the cwd-inside-project check (H5f;
#       H5e2, a missing project, is a pin behind it); checking the
#       context only for allowlisted commands (H5g).
#   H6  calling the guard unconditionally (every H6 line: exit 77 instead of
#       the unguarded dispatcher's output).
#   H7  adding an invocation to a skill without classifying it (H7a; H7c is
#       the scanner's own control); an `intent …` entry in any allowlist, a
#       non-empty progress list or a second stage entry (H7b); falling back to
#       allow when not listed, e.g. a guard that consults the exclusions (H7d).
#   P   (one line per allowlisted subcommand of every action row) dropping a
#       resolver guard (the out-of-scope variant writes under project/other/
#       or ../other); dropping spec init's child check (P new-feature/spec
#       init: refused after the spec was written); accepting `..` behind a
#       missing segment (every link variant writes through lnk); an in-variant
#       that stops before its write (exit or "nothing written"); an
#       allowlist entry without a probe; Pn counts pairs and reaching
#       in-variants (41 each).
#   L   accepting `.`/`..` in the missing tail (L per path flag, L0 the
#       measured end-to-end bypass, L1 the `.` form); Ln counts the flags.
#   F   pattern 9's label unbounded again (F1: > 2 s); the hex spelling
#       without the gap class (F2c/d/e), without the i flag (F2b); base64
#       without the optional padding (F2a) or without the whitespace gap
#       (F2f). F2g/F2h are controls (covered form; no over-redaction).
#   P2  dropping the child scope check on the product mirror target (P2b:
#       the mirror writes project/other/product/ from a forged ROADMAP
#       project:); refusing instead of skipping (P2b: exit 77 after the repo
#       write); dropping the slug == A1_INTENT_PROJECT compare (P2c: a vault
#       alias of the own project passes the realpath check); checking the
#       slug against the wrong root (P2a: skipped).
#   G1  skipping the chmod (G1a: mode 0644/0755); a manifest over only some
#       files or with another line format (G1a: root hash differs); refusing
#       nothing on --yes (G1b), on a non-TTY (G1c), on a foreign host (G1d), on
#       an answer other than "yes" (G1e).
#   G2  hashing only the files the manifest lists (G2b: the extra file stays
#       invisible); dropping the sha compare (G2a); dropping the write-bit
#       walk (G2c, G2d); dropping the version compare (G2e); dropping the
#       empty-mcp compare (G2f); treating a missing dir as ok (G2g); following
#       symlinks during the walk (G2h: the twin has the same bytes and no
#       write bit). G2a is guarded twice (per-file sha and root hash): both
#       compares must go.
#   G3  following symlinks during the copy (G3: a seal dir appears).
#   G4  adding a code to one catalog only; a refusal code in a catalog.
#   G5  treating null like false (G5a); rewriting the whole frontmatter
#       instead of the one list (G5c: other bytes change); the wrong row for
#       a skill (G5c); copying without the rewrite when true (G5c).

W5B_HOST="$(node -e 'process.stdout.write(require("os").hostname())')"
W5B_FALSE_TOOLS="$WORK/w5b-tools-false/_shared/a1-tools.cjs"
W5B_TRUE_TOOLS="$WORK/w5b-tools-true/_shared/a1-tools.cjs"
W5B_NOGUARD_TOOLS="$WORK/w5b-tools-noguard/_shared/a1-tools.cjs"
W5B_NULL_TOOLS="$WORK/w5b-tools-null/_shared/a1-tools.cjs" # the pre-measurement constant (G5a)

# w5b_tools <name> <null|false|true|noguard> — a copy of _shared/ under $WORK with
# the B1 constant set, or with intent-child.cjs replaced by a pass-through
# (the dispatcher "without the guard" of SC-011). Prints "ok" when the
# patch applied exactly once.
w5b_tools() {
  local dest="$WORK/w5b-tools-$1"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -R "$REPO_ROOT/_shared" "$dest/_shared"
  node - "$dest/_shared/lib" "$2" <<'JS'
const fs = require('fs');
const [lib, mode] = process.argv.slice(2);
if (mode === 'noguard') {
  fs.writeFileSync(`${lib}/intent-child.cjs`, "'use strict';\nmodule.exports = { guardDispatch() {}, guardChildPath: (p) => p };\n");
  process.stdout.write('ok');
  process.exit(0);
}
const file = `${lib}/intent-sandbox.cjs`; // the B1 constant lives there since the Wave 6A split
const text = fs.readFileSync(file, 'utf8');
const line = 'const INTENT_SEAL_SKILL_REWRITE = true;'; // shipped value since Wave 6 part B (B1: WIDENS)
if (text.split(line).length !== 2) { process.stdout.write('constant line not found exactly once'); process.exit(0); }
fs.writeFileSync(file, text.replace(line, `const INTENT_SEAL_SKILL_REWRITE = ${mode};`));
process.stdout.write('ok');
JS
}

# w5b_run <cwd> <a1-tools> [VAR=value ...] -- <args...> — one a1-tools call in
# <cwd> with HOME and A1_VAULT_ROOT in the sandbox and every child variable
# unset unless given. a1-tools runs through stub/a1-tools-as.cjs, which
# injects $FHOME as the passwd home through intent-child's library seam
# (FR-047: never through env) and, when W5B_SPEC names a lock, writes the
# child-context lock with writeChildContextLock (pid = the calling shell, an
# ancestor) and removes it on exit. W5B_RAW="<js patch>" instead writes a
# hand-made lock (w5b_rawlock_self) with the subshell's own pid, a live ancestor
# of a1-tools. The subshell never execs node (`; exit $?`), so the lock pid
# is never 1, even when the runner itself is pid 1 (a container).
# W5B_VIA_SH=1 puts /bin/sh between that subshell and node, so the ancestry
# walk must call ps once to reach the lock pid (the PATH cases). W5B_NODE
# is the node binary by absolute path (the PATH cases). Sets RC, OUT, ERR.
W5B_SPEC=-
W5B_RAW=
W5B_VIA_SH=
W5B_NODE="$(command -v node)"
w5b_run() {
  local cwd="$1" tools="$2"
  shift 2
  local envs=() e has_child= has_id=
  while [[ $# -gt 0 && "$1" != "--" ]]; do envs+=("$1"); shift; done
  [[ $# -gt 0 ]] && shift
  for e in ${envs[@]+"${envs[@]}"}; do
    [[ "$e" == A1_INTENT_CHILD=1 ]] && has_child=1
    [[ "$e" == A1_INTENT_ID=* ]] && has_id=1
  done
  # `run` sets A1_INTENT_ID with A1_INTENT_CHILD=1 (re-review MINOR-6); so
  # does every call here unless it names its own or W5B_NO_ID=1 is set.
  [[ -n "$has_child" && -z "$has_id" && -z "${W5B_NO_ID:-}" ]] && envs+=("A1_INTENT_ID=3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b")
  (cd "$cwd" && { [[ -z "$W5B_RAW" ]] || w5b_rawlock_self; } \
    && env -u A1_INTENT_CHILD -u A1_INTENT_ACTION -u A1_INTENT_PROJECT -u NODE_OPTIONS \
    HOME="$FHOME" A1_VAULT_ROOT="$VAULT" ${envs[@]+"${envs[@]}"} ${W5B_VIA_SH:+/bin/sh -c '"$@"; exit $?' sh} \
    "$W5B_NODE" "$STUB_DIR/a1-tools-as.cjs" "$FHOME" "$W5B_SPEC" "$tools" "$@"; exit $?) >"$SB/.out" 2>"$SB/.err" </dev/null
  RC=$?
  OUT="$(cat "$SB/.out")"
  ERR="$(cat "$SB/.err")"
}

# w5b_rawlock_self — the W5B_RAW lock with the pid of the calling (sub)shell:
# `sh` is a direct child of it, so its $PPID is that pid (bash 3.2 has no
# BASHPID); read with the builtin, no further fork.
w5b_rawlock_self() {
  local self
  sh -c 'echo "$PPID"' >"$SB/.selfpid"
  read -r self <"$SB/.selfpid"
  w5b_rawlock "$self" "$W5B_HOST" "$W5B_RAW"
}

# w5b_lockspec <action> <project> — the wrapper spec for a child-context lock
# of this sandbox (vault root = $VAULT; anchor = the project realpath). With
# W5B_SPY set, internal git runs the spy (see w5b_spy) instead of /usr/bin/git.
w5b_lockspec() {
  if [[ -n "${W5B_SPY:-}" ]]; then printf '{"lock":{"action":"%s","project":"%s","vault_root":"%s"},"gitBin":"%s"}' "$1" "$2" "$VAULT" "$W5B_SPY"
  else printf '{"lock":{"action":"%s","project":"%s","vault_root":"%s"}}' "$1" "$2" "$VAULT"; fi
}

# The hardened leading options every child git call carries (literal).
W5B_GIT_LEADING="--no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.external= -c core.pager=cat -c credential.helper= -c commit.gpgSign=false -c log.showSignature=false -c gc.auto=0 -c maintenance.auto=false -c core.attributesFile=/dev/null -c submodule.recurse=false"

# w5b_spy <log> — a git spy: one "ARGS: …" line per call and "ENV-LEAK" when a
# caller variable reached it, then the real git (behaviour unchanged). Prints
# its path. The log path is baked in: the hardened env carries no fixture var.
w5b_spy() {
  local spy="$WORK/w5b-gitspy-$RANDOM"
  printf '#!/bin/sh\n{ printf "ARGS:"; for a in "$@"; do printf " %%s" "$a"; done; printf "\\n"; } >>"%s"\n[ -n "$A1_FIXTURE_CANARY$GIT_CONFIG_PARAMETERS" ] && echo ENV-LEAK >>"%s"\nexec /usr/bin/git "$@"\n' "$1" "$1" >"$spy"
  chmod 755 "$spy"
  printf '%s' "$spy"
}

# child <action> <project> <args...> — a1-tools in child mode from $CWD, as
# `run` sets it up: the lock of <action>/<project>, and A1_INTENT_CHILD=1,
# A1_INTENT_ACTION, A1_INTENT_PROJECT equal to it.
child() {
  local action="$1" project="$2" dir="$CWD"
  shift 2
  case "$action" in new-feature | continue-feature | plan | execute | fix) ;; *) dir="$W5B_PRIMARY" ;; esac # the others' anchor is the project itself
  W5B_ANCHOR="$dir" # the scope root of w5b_scope_diff for this call
  W5B_SPEC="$(w5b_lockspec "$action" "$project")"
  w5b_run "$dir" "$A1_TOOLS" A1_INTENT_CHILD=1 "A1_INTENT_ACTION=$action" "A1_INTENT_PROJECT=$project" \
    A1_INTENT_ID=3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b A1_FIXTURE_CANARY=leak "GIT_CONFIG_PARAMETERS='core.x=y'" -- "$@"
  W5B_SPEC=-
}

# w5b_rawlock <pid> <hostname> [<js object of overrides; null deletes>] — a
# hand-written 0600 lock for the shapes writeChildContextLock refuses to
# write (foreign host, missing keys, a bad project or action).
w5b_rawlock() {
  local patch="${3:-}"
  [[ -n "$patch" ]] || patch='{}'
  node -e '
    const fs = require("fs"); const [file, pid, host, patch, home, vault] = process.argv.slice(1);
    const real = (p) => { try { return fs.realpathSync(p); } catch (e) { return p; } };
    const doc = { pid: Number(pid), hostname: host, createdAt: new Date().toISOString(), intent_id: "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b",
      action: "fix", project: "real-proj", vault_root: real(vault),
      anchor: real(home + "/claude-projects/a1-worktrees/real-proj-intent-3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b") }; // fix: its intent worktree
    for (const [k, v] of Object.entries(eval(`(${patch})`))) { if (v === null) delete doc[k]; else doc[k] = v; }
    fs.rmSync(file, { force: true }); fs.writeFileSync(file, JSON.stringify(doc), { mode: 0o600 });' \
    "$FHOME/.a1-intents/executor.lock" "$1" "$2" "$patch" "$FHOME" "$VAULT"
}

# expect_refused <name> <reason> [any-stderr] — exit 77, stdout exactly
# {ok:false, error:"intent_child_refused", reason, detail}, one stderr line
# (the resolver cases also carry the vault-tier line: pass any-stderr).
expect_refused() {
  local name="$1" want="$2" lines got
  got="$(node -e '
    let o; try { o = JSON.parse(process.argv[1]); } catch (e) { console.log("<stdout is not JSON>"); process.exit(0); }
    const keys = Object.keys(o).sort().join(",");
    const shape = o.ok === false && o.error === "intent_child_refused" && keys === "detail,error,ok,reason" && typeof o.detail === "string";
    console.log(shape ? o.reason : `<shape ${keys}>`);' "$OUT")"
  lines="$(printf '%s\n' "$ERR" | grep -c .)"
  if [[ "$RC" -eq 77 && "$got" == "$want" && ( "$lines" -eq 1 || "${3:-}" == "any-stderr" ) ]]; then ok "$name"
  else bad "$name" "expected exit 77 reason $want, got exit $RC reason $got ($lines stderr lines)" "stderr: ${ERR:0:300}"; fi
}

# expect_not_refused <name> — the command ran (not exit 77, no refusal JSON).
expect_not_refused() {
  if [[ "$RC" -ne 77 && "$OUT" != *intent_child_refused* ]]; then ok "$1"
  else bad "$1" "expected the command to run, got exit $RC" "stdout: ${OUT:0:200}" "stderr: ${ERR:0:200}"; fi
}

# Since Wave 6 part B: CWD is the fixture intent worktree (anchor of every
# write action), W5B_PRIMARY the project itself (anchor of progress/stage).
w5b_project_sandbox() {
  new_sandbox "$1"
  mk_project real-proj
  W5B_PRIMARY="$FHOME/claude-projects/real-proj"
  CWD="$(mk_intent_worktree real-proj)"
}

# ---------- H1: subcommand allowlist ----------
w5b_project_sandbox w5b-h1
child fix real-proj worktree list
expect_refused "5b-H1a child mode: worktree list -> 77 subcommand_not_allowed [FR-041]" subcommand_not_allowed
cp "$FHOME/.a1-intents/devices.json" "$SB/devices.before"
child fix real-proj intent device add x
if cmp -s "$SB/devices.before" "$FHOME/.a1-intents/devices.json"; then
  expect_refused "5b-H1b child mode: intent device add x -> 77, devices.json unchanged [FR-041]" subcommand_not_allowed
else bad "5b-H1b child mode: intent device add x -> 77, devices.json unchanged [FR-041]" "devices.json changed (exit $RC)"; fi
child fix real-proj fix next-suffix real-proj 2026-09-27
if [[ "$RC" -eq 0 && "$OUT" == *'"suffix"'* ]]; then ok "5b-H1c child mode: allowlisted fix next-suffix runs (exit 0) [FR-041]"
else bad "5b-H1c child mode: allowlisted fix next-suffix runs (exit 0) [FR-041]" "exit $RC" "stdout: ${OUT:0:200}" "stderr: ${ERR:0:200}"; fi
child fix real-proj --help
expect_refused "5b-H1d child mode: --help is no allowlisted subcommand -> 77 [FR-041]" subcommand_not_allowed
child progress real-proj code-scope list
expect_refused "5b-H1e child mode: progress allows nothing (code-scope list -> 77) [FR-041]" subcommand_not_allowed

# ---------- H2: path scope ----------
w5b_project_sandbox w5b-h2
mkdir -p "$FHOME/claude-projects/other/docs/product"
ln -s ../other "$W5B_PRIMARY/lnk" # the stage calls below run in the project (their anchor)
h2_before="$(tree_listing "$FHOME/claude-projects" "$VAULT")"
child stage real-proj product stage --by 011-x --set started --dir ../other/docs/product
if [[ "$(tree_listing "$FHOME/claude-projects" "$VAULT")" == "$h2_before" ]]; then
  expect_refused "5b-H2a --dir ../other/docs/product -> 77 path_outside_scope, no file changed [FR-041]" path_outside_scope
else bad "5b-H2a --dir ../other/docs/product -> 77 path_outside_scope, no file changed [FR-041]" "tree changed (exit $RC)"; fi
child stage real-proj product stage --by 011-x --set started --dir=../other/docs/product
expect_refused "5b-H2b --dir=../other/docs/product (inline form) -> 77 path_outside_scope [FR-041]" path_outside_scope
child stage real-proj product stage --by 011-x --set started --dir lnk/docs/product
expect_refused "5b-H2c symlink inside the cwd pointing out -> 77 path_outside_scope [FR-041]" path_outside_scope
child stage real-proj product stage --by 011-x --set started --dir docs/product
expect_not_refused "5b-H2d --dir docs/product inside the project runs [FR-041]"
child stage real-proj product stage --by 011-x --set started --dir newdir/sub
expect_not_refused "5b-H2e a path that does not exist yet is checked through its nearest existing ancestor [FR-041]"
child stage real-proj product stage --by 011-x --set started --dir lnk/../docs/product
expect_refused "5b-H2f lnk/../docs/product (lexically inside, physically outside) -> 77 path_outside_scope [FR-041]" path_outside_scope
child stage real-proj product stage --by 011-x --set started --dir newdir/../../other/docs/product
expect_refused "5b-H2f2 .. behind a missing segment that leaves the project -> 77 path_outside_scope [FR-041]" path_outside_scope
child fix real-proj fix find-duplicates real-proj /etc/hosts
expect_refused "5b-H2g absolute positional path outside -> 77 path_outside_scope [FR-041]" path_outside_scope
child fix real-proj fix find-duplicates real-proj '~/.zshenv'
expect_refused "5b-H2h positional ~/ path -> 77 path_outside_scope [FR-041]" path_outside_scope

# ---------- H3: the io.cjs resolvers are guarded ----------
w5b_project_sandbox w5b-h3
mkdir -p "$VAULT/project/other/spec" "$VAULT/project/real-proj/spec"
printf -- '---\nid: 001-x\ntitle: "X"\nstatus: draft\n---\n# X\n' >"$VAULT/project/other/spec/001-x.md"
cp "$VAULT/project/other/spec/001-x.md" "$VAULT/project/real-proj/spec/001-x.md"
cp "$VAULT/project/other/spec/001-x.md" "$SB/spec.before"
child new-feature real-proj spec update-status project/other/spec/001-x.md clarified
if cmp -s "$SB/spec.before" "$VAULT/project/other/spec/001-x.md"; then
  expect_refused "5b-H3a spec update-status on another slug -> refused at resolveVaultPath, file unchanged [FR-041]" path_outside_scope any-stderr
else bad "5b-H3a spec update-status on another slug -> refused at resolveVaultPath, file unchanged [FR-041]" "project/other spec changed (exit $RC)"; fi
child new-feature real-proj spec update-status project/real-proj/spec/001-x.md clarified
expect_not_refused "5b-H3a2 control: the same command on the own slug runs [FR-041]"
child fix real-proj fix next-suffix other 2026-09-27
expect_refused "5b-H3b fix next-suffix <other slug> -> refused at projectsPath [FR-041]" path_outside_scope any-stderr
if [[ "$OUT" == *'/project/other/fixes"'* ]]; then ok "5b-H3b3 the refused path is project/other/fixes, the resolver's own result [FR-041]"
else bad "5b-H3b3 the refused path is project/other/fixes, the resolver's own result [FR-041]" "stdout: ${OUT:0:300}"; fi
printf -- '---\ntype: project\nstatus: build\n---\n# real-proj\n' >"$VAULT/project/real-proj.md"
cp "$VAULT/project/real-proj.md" "$SB/hub.before"
child new-feature real-proj spec init real-proj feat-x --title "Feat X"
h3c_spec="$(find "$VAULT/project/real-proj/spec" -name '*-feat-x.md' | wc -l | tr -d ' ')"
h3c_hub="$(node -e 'try { console.log(JSON.parse(process.argv[1]).hub); } catch (e) { console.log("<not json>"); }' "$OUT")"
if [[ "$RC" -eq 0 && "$h3c_spec" == "1" && "$h3c_hub" == "skipped-child" && "$ERR" == *"spec init hub link skipped: intent child mode"* ]] && cmp -s "$SB/hub.before" "$VAULT/project/real-proj.md"; then
  ok "5b-H3b2 child spec init writes the spec, skips the hub link (hub: skipped-child), project/real-proj.md byte-identical [FR-041]"
else bad "5b-H3b2 child spec init writes the spec, skips the hub link (hub: skipped-child), project/real-proj.md byte-identical [FR-041]" \
  "exit $RC spec files $h3c_spec hub $h3c_hub" "stdout: ${OUT:0:300}" "stderr: ${ERR:0:300}"; fi

# ---------- H4: no opt-out ----------
w5b_project_sandbox w5b-h4
W5B_RAW='{}'
w5b_run "$CWD" "$A1_TOOLS" A1_INTENT_CHILD=0 -- worktree list
expect_refused "5b-H4a A1_INTENT_CHILD=0 under a live executor-lock ancestor is still child mode [FR-041]" subcommand_not_allowed
w5b_run "$CWD" "$A1_TOOLS" -- worktree list
expect_refused "5b-H4b variable unset under a live executor-lock ancestor is still child mode [FR-041]" subcommand_not_allowed
W5B_RAW=
node -e 'setTimeout(() => {}, 30000)' &
h4_bg=$!
w5b_rawlock "$h4_bg" "$W5B_HOST"
w5b_run "$CWD" "$A1_TOOLS" A1_INTENT_CHILD=0 -- worktree list
expect_not_refused "5b-H4c a live lock pid that is no ancestor -> normal mode [FR-041]"
kill "$h4_bg" 2>/dev/null
wait "$h4_bg" 2>/dev/null
w5b_rawlock "$$" "other-host.invalid"
w5b_run "$CWD" "$A1_TOOLS" -- worktree list
expect_not_refused "5b-H4d a lock of another host -> normal mode [FR-041]"
w5b_rawlock "$h4_bg" "$W5B_HOST"
w5b_run "$CWD" "$A1_TOOLS" -- worktree list
expect_not_refused "5b-H4e a lock whose pid is dead -> normal mode [FR-041]"
rm -f "$FHOME/.a1-intents/executor.lock"

# ---------- H5: child context invalid ----------
w5b_project_sandbox w5b-h5
W5B_RAW='{ project: null }'
w5b_run "$CWD" "$A1_TOOLS" A1_INTENT_CHILD=1 -- fix next-suffix real-proj 2026-09-27
expect_refused "5b-H5a the lock carries no project -> 77 child_context_invalid [FR-041]" child_context_invalid
W5B_RAW='{ project: "../x" }'
w5b_run "$CWD" "$A1_TOOLS" A1_INTENT_CHILD=1 -- fix next-suffix real-proj 2026-09-27
expect_refused "5b-H5b the lock names project ../x -> 77 child_context_invalid [FR-041]" child_context_invalid
W5B_RAW='{ action: null }'
w5b_run "$CWD" "$A1_TOOLS" A1_INTENT_CHILD=1 -- fix next-suffix real-proj 2026-09-27
expect_refused "5b-H5c the lock carries no action -> 77 child_context_invalid [FR-041]" child_context_invalid
W5B_RAW='{ action: "shell" }'
w5b_run "$CWD" "$A1_TOOLS" A1_INTENT_CHILD=1 -- fix next-suffix real-proj 2026-09-27
expect_refused "5b-H5d the lock names action shell -> 77 child_context_invalid [FR-041]" child_context_invalid
W5B_RAW=
rm -f "$FHOME/.a1-intents/executor.lock"
mkdir -p "$SB/outside"
ln -s "$SB/outside" "$FHOME/claude-projects/esc"
W5B_SPEC="$(w5b_lockspec fix esc)"
w5b_run "$SB/outside" "$A1_TOOLS" A1_INTENT_CHILD=1 -- fix next-suffix esc 2026-09-27
expect_refused "5b-H5e a project symlink that resolves outside ~/claude-projects (cwd inside its target) -> 77 child_context_invalid [FR-041]" child_context_invalid
W5B_SPEC="$(w5b_lockspec fix ghost)"
w5b_run "$CWD" "$A1_TOOLS" A1_INTENT_CHILD=1 -- fix next-suffix real-proj 2026-09-27
expect_refused "5b-H5e2 a project without a directory under ~/claude-projects -> 77 child_context_invalid [FR-041]" child_context_invalid
W5B_SPEC="$(w5b_lockspec fix real-proj)"
w5b_run "$SB" "$A1_TOOLS" A1_INTENT_CHILD=1 -- fix next-suffix real-proj 2026-09-27
expect_refused "5b-H5f a cwd outside the project -> 77 child_context_invalid [FR-041]" child_context_invalid
W5B_SPEC=-
W5B_RAW='{ project: null }'
w5b_run "$CWD" "$A1_TOOLS" A1_INTENT_CHILD=1 -- worktree list
expect_refused "5b-H5g the context is checked before the allowlist, for every subcommand [FR-041]" child_context_invalid
W5B_RAW=
rm -f "$FHOME/.a1-intents/executor.lock"

# ---------- H6: unchanged outside child mode ----------
w5b_project_sandbox w5b-h6
h6_patch="$(w5b_tools noguard noguard)"
mkdir -p "$VAULT/project/real-proj/spec"
printf -- '---\nid: 001-x\ntitle: "X"\nstatus: draft\n---\n# X\n' >"$VAULT/project/real-proj/spec/001-x.md"
h6_compare() { # h6_compare <name> <args...>
  local name="$1"
  shift
  w5b_run "$CWD" "$W5B_NOGUARD_TOOLS" -- "$@"
  local want_rc="$RC" want_out="$OUT" want_err="$ERR"
  w5b_run "$CWD" "$A1_TOOLS" -- "$@"
  if [[ "$h6_patch" == "ok" && "$RC" -eq "$want_rc" && "$OUT" == "$want_out" && "$ERR" == "$want_err" && "$OUT" != *intent_child_refused* ]]; then ok "$name"
  else bad "$name" "patch: $h6_patch; guarded exit $RC vs unguarded $want_rc" "guarded stdout: ${OUT:0:200}" "unguarded stdout: ${want_out:0:200}"; fi
}
h6_compare "5b-H6a spec list: stdout, stderr and exit equal the unguarded dispatcher [FR-041]" spec list real-proj
h6_compare "5b-H6b product status: stdout, stderr and exit equal the unguarded dispatcher [FR-041]" product status --dir docs/product
h6_compare "5b-H6c code-scope list: stdout, stderr and exit equal the unguarded dispatcher [FR-041]" code-scope list
w5b_rawlock 999999 "$W5B_HOST"
h6_compare "5b-H6d a stale executor.lock (dead pid) changes nothing either [FR-041]" spec list real-proj
h6_compare "5b-H6e worktree list (refused in child mode) equals the unguarded dispatcher [FR-041]" worktree list
rm -f "$FHOME/.a1-intents/executor.lock"

# ---------- H7: the allowlist is honest ----------
# w5b_scan <skills-root> — every `a1-tools[.cjs] <group> <sub>` and
# `"$A1_TOOLS" <group> <sub>` in skills/<skill>/** of each action's skill,
# classified: on the action's allowlist, or recorded with a reason in its
# INTENT_CHILD_EXCLUSIONS (absent from the allowlist on purpose). The action -> skill
# map is a fixture literal (FR-022 prompt strings).
w5b_scan() {
  node - "$INTENT_LIB" "$1" <<'JS'
const fs = require('fs');
const path = require('path');
const [lib, root] = process.argv.slice(2);
const C = require(`${lib}/intent-constants.cjs`);
const SKILL = { 'new-feature': 'a1-new-feature', 'continue-feature': 'a1-new-feature', plan: 'a1-plan', execute: 'a1-execute', fix: 'a1-fix', progress: 'a1-progress' };
const RE = /(?:a1-tools(?:\.cjs)?["']?|"\$\{?A1_TOOLS\}?")[ \t]+([a-z][a-z-]*)[ \t]+([a-z][a-z-]*)/g;
const files = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : [path.join(d, e.name)]));
const unclassified = [];
const counts = [];
for (const [action, skill] of Object.entries(SKILL)) {
  const found = new Set();
  for (const f of files(path.join(root, skill))) for (const m of fs.readFileSync(f, 'utf8').matchAll(RE)) found.add(`${m[1]} ${m[2]}`);
  const allow = C.INTENT_CHILD_ALLOWLIST[action] || [];
  const excluded = (C.INTENT_CHILD_EXCLUSIONS || {})[action] || {};
  for (const key of found) {
    const recorded = Object.prototype.hasOwnProperty.call(excluded, key) && typeof excluded[key] === 'string' && excluded[key].length > 0;
    if (!allow.includes(key) && !recorded) unclassified.push(`${action}: ${key}`);
  }
  counts.push(`${action}=${found.size}`);
}
console.log(`${counts.join(' ')} | ${unclassified.join('; ') || 'none'}`);
JS
}
h7_got="$(w5b_scan "$REPO_ROOT/skills" 2>&1)"
h7_counts="${h7_got%% |*}"
h7_uncl="${h7_got##*| }"
h7_floor="$(node -e '
  const floor = { "new-feature": 16, "continue-feature": 16, plan: 5, execute: 10, fix: 12, progress: 7 };
  const got = Object.fromEntries(process.argv[1].split(" ").map((p) => p.split("=")).map(([k, v]) => [k, Number(v)]));
  console.log(Object.entries(floor).every(([k, v]) => got[k] >= v) ? "ok" : "below");' "$h7_counts" 2>&1)"
if [[ "$h7_uncl" == "none" && "$h7_floor" == "ok" ]]; then ok "5b-H7a every a1-tools invocation in each action's skill is allowlisted or recorded as excluded ($h7_counts) [FR-041]"
else bad "5b-H7a every a1-tools invocation in each action's skill is allowlisted or recorded as excluded [FR-041]" "counts: $h7_counts ($h7_floor)" "unclassified: ${h7_uncl:0:400}"; fi
h7_b="$(node -e '
  const C = require(process.argv[1] + "/intent-constants.cjs");
  const A = C.INTENT_CHILD_ALLOWLIST;
  const actions = ["new-feature", "continue-feature", "plan", "execute", "fix", "stage", "progress", "approve", "cancel"];
  const entries = Object.values(A).flat();
  const checks = [
    Object.keys(A).sort().join(",") === [...actions].sort().join(","),
    Object.isFrozen(A) && Object.values(A).every((l) => Object.isFrozen(l)),
    !entries.some((e) => e.startsWith("intent")),
    entries.every((e) => /^[a-z][a-z-]* [a-z][a-z-]*$/.test(e)),
    A.progress.length === 0, A.approve.length === 0, A.cancel.length === 0,
    A.stage.length === 1 && A.stage[0] === "product stage",
    C.INTENT_CHILD_EXIT_CODE === 77,
    ["--file", "--dir", "--repo-root"].every((f) => C.INTENT_CHILD_PATH_FLAGS.includes(f)),
    C.INTENT_SEAL_SKILL_REWRITE === true, // shipped since Wave 6 part B (06-run.sh X31)
    C.INTENT_CHILD_REFUSAL_REASONS.join(",") === "child_context_invalid,subcommand_not_allowed,path_outside_scope"
      && C.INTENT_CHILD_REFUSAL_REASONS.every((r) => !require(process.argv[1] + "/status-constants.cjs").INTENT_REFUSAL_CODES.has(r)),
  ];
  console.log(checks.map((c) => (c ? 1 : 0)).join(""));' "$INTENT_LIB" 2>&1)"
if [[ "$h7_b" == "111111111111" ]]; then ok "5b-H7b no allowlist entry starts with intent; progress/approve/cancel empty; stage = product stage; exit 77; B1 constant true; 3 child refusal reasons outside INTENT_REFUSAL_CODES [FR-041]"
else bad "5b-H7b no allowlist entry starts with intent; progress/approve/cancel empty; stage = product stage; exit 77; B1 constant true; 3 child refusal reasons outside INTENT_REFUSAL_CODES [FR-041]" "checks: $h7_b"; fi
w5b_project_sandbox w5b-h7d
h7d_bad=""
for h7d_action in new-feature continue-feature plan execute fix stage progress approve cancel; do
  for h7d_cmd in "zzz-new run" "spec zzz-new" "fix zzz-new"; do
    # shellcheck disable=SC2086
    child "$h7d_action" real-proj $h7d_cmd
    [[ "$RC" -eq 77 && "$OUT" == *'"reason":"subcommand_not_allowed"'* ]] || h7d_bad="$h7d_bad $h7d_action:[$h7d_cmd]=$RC"
  done
done
if [[ -z "$h7d_bad" ]]; then ok "5b-H7d default-deny: an unknown or newly added subcommand (zzz-new) is refused with 77 for every action [FR-041]"
else bad "5b-H7d default-deny: an unknown or newly added subcommand (zzz-new) is refused with 77 for every action [FR-041]" "${h7d_bad:0:400}"; fi
h7_copy="$WORK/w5b-skills-copy"
rm -rf "$h7_copy"
mkdir -p "$h7_copy"
cp -R "$REPO_ROOT/skills/." "$h7_copy/"
printf '\nnode <repo>/_shared/a1-tools.cjs worktree gc\n' >>"$h7_copy/a1-fix/SKILL.md"
h7_c="$(w5b_scan "$h7_copy" 2>&1)"
if [[ "${h7_c##*| }" == "fix: worktree gc" ]]; then ok "5b-H7c control: an unclassified invocation added to a skill copy is reported [FR-041]"
else bad "5b-H7c control: an unclassified invocation added to a skill copy is reported [FR-041]" "${h7_c:0:300}"; fi

# H7e (FR-048): every raw `git <status|diff|add|commit|log>` call in an
# action's skill (and, for execute, in the executor agent it starts, which
# commits per wave) is classified as `git <sub>` on that action's allowlist
# or in its exclusions. stage and progress list no git subcommand.
h7e_got="$(node - "$INTENT_LIB" "$REPO_ROOT" <<'JS' 2>&1
const fs = require('fs');
const path = require('path');
const [lib, repo] = process.argv.slice(2);
const C = require(`${lib}/intent-constants.cjs`);
const SRC = { 'new-feature': ['skills/a1-new-feature'], 'continue-feature': ['skills/a1-new-feature'], plan: ['skills/a1-plan'],
  execute: ['skills/a1-execute', 'agents/a1-erik-executor.md'], fix: ['skills/a1-fix'], progress: ['skills/a1-progress'] };
const files = (p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).flatMap((n) => files(path.join(p, n))) : [p]);
const out = [];
for (const [action, srcs] of Object.entries(SRC)) {
  const found = new Set();
  for (const f of srcs.flatMap((s) => files(path.join(repo, s)))) for (const m of fs.readFileSync(f, 'utf8').matchAll(/\bgit (status|diff|add|commit|log)\b/g)) found.add(`git ${m[1]}`);
  const excluded = (C.INTENT_CHILD_EXCLUSIONS[action] || {});
  const loose = [...found].filter((k) => !C.INTENT_CHILD_ALLOWLIST[action].includes(k) && !(typeof excluded[k] === 'string' && excluded[k].length > 0));
  out.push(`${action}=${found.size}${loose.length ? `!${loose.join('+')}` : ''}`);
}
const noGit = ['stage', 'progress', 'approve', 'cancel'].every((a) => !C.INTENT_CHILD_ALLOWLIST[a].some((e) => e.startsWith('git ')));
console.log(`${out.join(' ')} ${noGit ? 'nogit-ok' : 'nogit-bad'}`);
JS
)"
if [[ "$h7e_got" == "new-feature=2 continue-feature=2 plan=0 execute=4 fix=1 progress=2 nogit-ok" ]]; then ok "5b-H7e every raw git call of an action's skill (and its executor agent) is classified as a git subcommand; stage/progress list none [FR-048]"
else bad "5b-H7e every raw git call of an action's skill (and its executor agent) is classified as a git subcommand; stage/progress list none [FR-048]" "$h7e_got"; fi

# ---------- P: a refusal writes nothing, for every allowlisted subcommand ----------
# Each allowlisted <group> <sub> of every action row runs three times in child
# mode, each from a fresh listing of the whole sandbox home and vault:
#   in    in-project arguments whose preconditions are seeded in normal mode
#         (w5b_psetup), so the command reaches its write path: the exit code
#         must equal the literal in w5b_pexpect, and a writer must have
#         written inside the scope (a listing change), a reader nothing;
#   out   arguments aiming outside (the other slug, ../other, an absolute path);
#   link  the MAJOR-1 form nonexist/../lnk/… through the in-project symlink
#         lnk -> $SB/outside.
# A 77 must have changed nothing; any other exit may have changed only the
# project repo and $VAULT/project/real-proj/.

W5B_ANALYSIS="$REPO_ROOT/_test-fixtures/product-audit-mirror/fixtures/niimo-2026-07-05-general.md"

# The project is built and committed first, then the fixture intent
# worktree is branched from it (Wave 6 part B): both hold the same tree, so
# a write action probes in CWD (the worktree) and stage in W5B_PRIMARY.
w5b_probe_sandbox() {
  new_sandbox "w5b-p-$1"
  mk_project real-proj
  W5B_PRIMARY="$FHOME/claude-projects/real-proj"
  local p="$W5B_PRIMARY"
  mkdir -p "$p/src" "$p/db/migrations" "$p/docs" "$FHOME/claude-projects/other/docs/product" "$SB/outside"
  ln -s "$SB/outside" "$p/lnk"
  printf 'x\n' >"$p/src/a.js"
  printf '# Plan\n' >"$p/docs/PLAN.md"
  printf 'create table t (id int);\n' >"$p/db/migrations/001.sql"
  w5b_run "$p" "$A1_TOOLS" -- product init --project real-proj --title "Real" --dir docs/product
  w5b_run "$p" "$A1_TOOLS" -- product add-milestone --id m1 --title M1 --dir docs/product
  w5b_run "$p" "$A1_TOOLS" -- product add-feature --id 011-x --milestone m1 --title X --dir docs/product
  w5b_run "$p" "$A1_TOOLS" -- product add-feature --id 012-f --milestone m1 --title F --dir docs/product
  w5b_run "$p" "$A1_TOOLS" -- product audit-publish --analysis "$W5B_ANALYSIS" --dir docs/product
  git -C "$p" add -A >/dev/null 2>&1
  git -C "$p" -c user.name=fixture -c user.email=fixture@invalid commit -q -m init >/dev/null 2>&1
  CWD="$(mk_intent_worktree real-proj)"
  local slug
  for slug in real-proj other; do
    mkdir -p "$VAULT/project/$slug/spec" "$VAULT/project/$slug/fixes"
    printf -- '---\nid: 001-x\ntitle: "X"\nstatus: draft\n---\n# X\n' >"$VAULT/project/$slug/spec/001-x.md"
    printf -- '---\ntitle: "Bug"\nstatus: reported\nseverity: minor\nsymptom: crash on start\n---\n# Bug\n' >"$VAULT/project/$slug/fixes/2026-09-27-bug.md"
    printf -- '---\ntype: project\n---\n# %s\n' "$slug" >"$VAULT/project/$slug.md"
  done
}

# w5b_psetup <group sub> — seeds, in normal mode, what the in-variant needs.
w5b_psetup() {
  case "$1" in
    "code-scope release") w5b_run "$CWD" "$A1_TOOLS" -- code-scope claim --by 011-r --scope rel/ ;;
    "code-scope stage") w5b_run "$CWD" "$A1_TOOLS" -- code-scope claim --by 011-s --scope stg/ ;;
    "git add") printf 'add probe\n' >>"$CWD/src/a.js" ;;
    "git commit")
      printf 'commit probe\n' >>"$CWD/src/a.js"
      git -C "$CWD" -c core.hooksPath=/dev/null add src/a.js >/dev/null 2>&1
      git -C "$CWD" config user.name fixture && git -C "$CWD" config user.email fixture@invalid ;;
    *) : ;;
  esac
}

# w5b_pexpect <group sub> — "<exit> <write|read>" of the in-variant (literals,
# measured 2026-09-28). Exit 1 is a completed verdict for three of them:
# checklist run (findings, report saved), schema-check run (findings) and
# quick eligibility (not eligible). quick eligibility is a reader: its
# earlier "write" was the unhardened `git status` refreshing .git/index;
# with the child's --no-optional-locks nothing is written (review MAJOR-B).
w5b_pexpect() {
  case "$1" in
    "checklist run") PEXPECT="1 write" ;;
    "schema-check run"|"quick eligibility") PEXPECT="1 read" ;;
    "code-scope check"|"realpath-check run"|"lane-split check"|"fix find-duplicates"|"fix next-suffix") PEXPECT="0 read" ;;
    "git status"|"git diff"|"git log") PEXPECT="0 read" ;; # --no-optional-locks: no index refresh
    *) PEXPECT="0 write" ;;
  esac
}

# w5b_pargs <group sub> <in|out|link> — the probe arguments into PARGS.
w5b_pargs() {
  local q='--intent x --files 1 --diff-lines 5 --scope src/a.js --no-migration --no-new-route --no-new-dep --by 011-x'
  local L='nonexist/../lnk'
  case "$1|$2" in
    "check reservations|in") PARGS=(check reservations --claim file:src/a.js --by 011-x) ;;
    "check reservations|out") PARGS=(check reservations --claim file:src/a.js --by 011-x --file ../other/r.json) ;;
    "check reservations|link") PARGS=(check reservations --claim file:src/a.js --by 011-x --file "$L/r.json") ;;
    "checklist run|in") PARGS=(checklist run real-proj/001-x --save) ;;
    "checklist run|out") PARGS=(checklist run other/001-x --save) ;;
    "checklist run|link") PARGS=(checklist run real-proj/001-x --save --vault "$L") ;;
    "code-scope check|in") PARGS=(code-scope check --by 011-x --scope src/) ;;
    "code-scope check|out") PARGS=(code-scope check --by 011-x --scope src/ --file /tmp/w5b-r.json) ;;
    "code-scope check|link") PARGS=(code-scope check --by 011-x --scope src/ --file "$L/r.json") ;;
    "code-scope claim|in") PARGS=(code-scope claim --by 011-x --scope src/) ;;
    "code-scope claim|out") PARGS=(code-scope claim --by 011-y --scope src/ --file ../other/r.json) ;;
    "code-scope claim|link") PARGS=(code-scope claim --by 011-y --scope src/ --file "$L/r.json") ;;
    "code-scope stage|in") PARGS=(code-scope stage --by 011-s --set complete) ;;
    "code-scope stage|out") PARGS=(code-scope stage --by 011-s --set complete --file=../other/r.json) ;;
    "code-scope stage|link") PARGS=(code-scope stage --by 011-s --set complete "--file=$L/r.json") ;;
    "code-scope release|in") PARGS=(code-scope release --by 011-r) ;;
    "code-scope release|out") PARGS=(code-scope release --by 011-r --file ../other/r.json) ;;
    "code-scope release|link") PARGS=(code-scope release --by 011-r --file "$L/r.json") ;;
    "product feature-init|in") PARGS=(product feature-init --id 012-f --dir docs/product) ;;
    "product feature-init|out") PARGS=(product feature-init --id 012-f --dir ../other/docs/product) ;;
    "product feature-init|link") PARGS=(product feature-init --id 012-f --dir "$L/docs/product") ;;
    "product stage|in") PARGS=(product stage --by 011-x --set started --dir docs/product) ;;
    "product stage|out") PARGS=(product stage --by 011-x --set started --dir ../other/docs/product) ;;
    "product stage|link") PARGS=(product stage --by 011-x --set started --dir "$L/docs/product") ;;
    "product audit-set|in") PARGS=(product audit-set --audit docs/product/audits/2026-07-05-general.md --finding F-001 --status fixed --dir docs/product) ;;
    "product audit-set|out") PARGS=(product audit-set --audit ../other/audit.md --finding F-001 --status fixed --dir docs/product) ;;
    "product audit-set|link") PARGS=(product audit-set --audit "$L/audit.md" --finding F-001 --status fixed --dir docs/product) ;;
    "quick eligibility|in") read -r -a PARGS <<<"quick eligibility $q" ;;
    "quick eligibility|out") read -r -a PARGS <<<"quick eligibility $q --repo-root /" ;;
    "quick eligibility|link") read -r -a PARGS <<<"quick eligibility $q --file $L/r.json" ;;
    "realpath-check run|in") PARGS=(realpath-check run --diff-base HEAD) ;;
    "realpath-check run|out") PARGS=(realpath-check run --diff-base HEAD --project ../other) ;;
    "realpath-check run|link") PARGS=(realpath-check run --diff-base HEAD --project "$L") ;;
    "schema-check run|in") PARGS=(schema-check run --migrations db/migrations) ;;
    "schema-check run|out") PARGS=(schema-check run --migrations /etc) ;;
    "schema-check run|link") PARGS=(schema-check run --migrations "$L") ;;
    "spec init|in") PARGS=(spec init real-proj feat-p --title "Feat P") ;;
    "spec init|out") PARGS=(spec init other feat-p --title "Feat P") ;;
    "spec init|link") PARGS=(spec init real-proj feat-q --title "$L/q") ;;
    "spec set-size|in") PARGS=(spec set-size project/real-proj/spec/001-x.md M) ;;
    "spec set-size|out") PARGS=(spec set-size project/other/spec/001-x.md M) ;;
    "spec set-size|link") PARGS=(spec set-size "$L/001-x.md" M) ;;
    "spec update-status|in") PARGS=(spec update-status project/real-proj/spec/001-x.md clarified) ;;
    "spec update-status|out") PARGS=(spec update-status project/other/spec/001-x.md clarified) ;;
    "spec update-status|link") PARGS=(spec update-status "$L/001-x.md" clarified) ;;
    "lane-split check|in") PARGS=(lane-split check --plan docs/PLAN.md) ;;
    "lane-split check|out") PARGS=(lane-split check --plan /etc/hosts) ;;
    "lane-split check|link") PARGS=(lane-split check --plan "$L/PLAN.md") ;;
    "fix find-duplicates|in") PARGS=(fix find-duplicates real-proj crash) ;;
    "fix find-duplicates|out") PARGS=(fix find-duplicates other crash) ;;
    "fix find-duplicates|link") PARGS=(fix find-duplicates real-proj "$L/x") ;;
    "fix next-suffix|in") PARGS=(fix next-suffix real-proj 2026-09-27) ;;
    "fix next-suffix|out") PARGS=(fix next-suffix other 2026-09-27) ;;
    "fix next-suffix|link") PARGS=(fix next-suffix real-proj 2026-09-27 "$L/x") ;;
    "fix update-status|in") PARGS=(fix update-status project/real-proj/fixes/2026-09-27-bug.md diagnosed) ;;
    "fix update-status|out") PARGS=(fix update-status project/other/fixes/2026-09-27-bug.md diagnosed) ;;
    "fix update-status|link") PARGS=(fix update-status "$L/2026-09-27-bug.md" diagnosed) ;;
    "git status|in") PARGS=(git status --porcelain) ;;
    "git status|out") PARGS=(git status --porcelain=v2) ;;
    "git status|link") PARGS=(git status -- "$L/x") ;;
    "git diff|in") PARGS=(git diff -- src/a.js) ;;
    "git diff|out") PARGS=(git diff -- ../other/x) ;;
    "git diff|link") PARGS=(git diff -- "$L/x") ;;
    "git log|in") PARGS=(git log -n 1 --oneline) ;;
    "git log|out") PARGS=(git log -- /etc/hosts) ;;
    "git log|link") PARGS=(git log -- "$L/x") ;;
    "git add|in") PARGS=(git add src/a.js) ;;
    "git add|out") PARGS=(git add ../other/f) ;;
    "git add|link") PARGS=(git add "$L/f") ;;
    "git commit|in") PARGS=(git commit -m "probe commit") ;;
    "git commit|out") PARGS=(git commit --amend -m x) ;;
    "git commit|link") PARGS=(git commit -m "$L/x") ;;
    *) PARGS=() ;;
  esac
}

# w5b_scope_diff <before> <after> — "ok <n changed>", or what changed where it
# must not.
# The line of ~/.a1-intents itself is left out: the child-context lock that
# `run` (here: stub/a1-tools-as.cjs) writes before and removes after the call
# changes that directory's mtime; a file the command left inside it still shows.
# Scope root: the anchor of the last child() call (W5B_ANCHOR). A write
# action's git add/commit also writes the parts of <primary>/.git its
# intent worktree owns (FR-043): objects/, worktrees/<slug>/, the ref and
# reflog of intent/<id>, and the mtimes of the dirs on the way; the
# primary's HEAD, index and config are NOT among them.
w5b_scope_diff() {
  node - "$1" "$2" "$RC" "$FHOME/.a1-intents" "$W5B_PRIMARY" "${W5B_ANCHOR:-$CWD}" "$VAULT/project/real-proj" <<'JS'
const fs = require('fs');
const path = require('path');
const [before, after, rc, intents, primaryRaw, ...raw] = process.argv.slice(2);
const slug = 'real-proj-intent-3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const g = path.join(path.normalize(primaryRaw), '.git');
const gitOwned = (p) => [path.join(g, 'objects'), path.join(g, 'worktrees', slug), path.join(g, 'refs', 'heads', 'intent'), path.join(g, 'logs', 'refs', 'heads', 'intent')]
  .some((r) => p === r || p.startsWith(`${r}/`)) || [g, path.join(g, 'refs'), path.join(g, 'refs', 'heads'), path.join(g, 'logs'), path.join(g, 'logs', 'refs'), path.join(g, 'logs', 'refs', 'heads'), path.join(g, 'worktrees')].includes(p);
const roots = raw.map((r) => path.normalize(r)); // $TMPDIR ends in "/": $WORK holds a "//"; tree_listing prints joined paths
const lockDir = `${path.normalize(intents)} d `;
const set = (f) => new Set(fs.readFileSync(f, 'utf8').split('\n').filter((l) => l && !l.startsWith(lockDir)));
const a = set(before);
const b = set(after);
const changed = [...new Set([...a].filter((l) => !b.has(l)).concat([...b].filter((l) => !a.has(l))).map((l) => l.replace(/ [dfl] \d+ [\d.]+$/, '')))];
const inside = (p) => roots.some((r) => p === r || p.startsWith(`${r}/`)) || gitOwned(p);
if (Number(rc) === 77 && changed.length) console.log(`refused after writing: ${changed.slice(0, 3).join(', ')}`);
else if (changed.some((p) => !inside(p))) console.log(`outside the scope: ${changed.filter((p) => !inside(p)).slice(0, 3).join(', ')}`);
else console.log(`ok ${changed.length}`);
JS
}

# p_variant <action> <sub> <in|out|link> — one probe; appends to p_bad.
p_variant() {
  local action="$1" sub="$2" var="$3" got
  w5b_pargs "$sub" "$var"
  if [[ ${#PARGS[@]} -eq 0 ]]; then p_bad="$p_bad $var: no probe arguments"; return; fi
  [[ "$var" == "in" ]] && w5b_psetup "$sub"
  tree_listing "$FHOME" "$VAULT" >"$SB/p.before"
  : >"$SB/.spylog"
  W5B_SPY="$P_SPY" child "$action" real-proj "${PARGS[@]}"
  tree_listing "$FHOME" "$VAULT" >"$SB/p.after"
  if [[ -s "$SB/.spylog" ]]; then
    p_git_users="$p_git_users $action/${sub// /_}"
    grep -q '^ENV-LEAK' "$SB/.spylog" && p_bad="$p_bad $var: a caller variable reached internal git"
    grep -v '^ENV-LEAK' "$SB/.spylog" | grep -vqF "ARGS: $W5B_GIT_LEADING " && p_bad="$p_bad $var: an unhardened internal git call ($(grep -vF "ARGS: $W5B_GIT_LEADING " "$SB/.spylog" | head -1 | cut -c1-80))"
  fi
  got="$(w5b_scope_diff "$SB/p.before" "$SB/p.after" 2>&1)"
  if [[ "$got" != ok* ]]; then p_bad="$p_bad $var (exit $RC): $got"; return; fi
  [[ "$var" == "link" && "$RC" -ne 77 ]] && p_bad="$p_bad link: exit $RC, not refused"
  [[ "$var" == "link" && -n "$(ls -A "$SB/outside")" ]] && p_bad="$p_bad link: wrote into the link target"
  if [[ "$var" == "in" ]]; then
    w5b_pexpect "$sub"
    local want_rc="${PEXPECT% *}" kind="${PEXPECT#* }" n="${got#ok }"
    if [[ "$RC" -ne "$want_rc" ]]; then p_bad="$p_bad in: exit $RC, want $want_rc (${ERR:0:160})"
    elif [[ "$kind" == "write" && "$n" -eq 0 ]]; then p_bad="$p_bad in: nothing written"
    elif [[ "$kind" == "read" && "$n" -ne 0 ]]; then p_bad="$p_bad in: a reader wrote $n entries"
    else p_reached=$((p_reached + 1)); fi
  fi
}

p_counts=""
p_reached=0
p_git_users=""
# Review MAJOR-B: the internal git of every allowlisted subcommand runs the
# spy, hardened (literal leading options below) and with no caller variable.
for p_action in new-feature continue-feature plan execute fix stage; do
  w5b_probe_sandbox "$p_action"
  P_SPY="$(w5b_spy "$SB/.spylog")"
  p_n=0
  while IFS= read -r p_sub; do
    [[ -n "$p_sub" ]] || continue
    p_n=$((p_n + 1))
    p_bad=""
    for p_var in in out link; do p_variant "$p_action" "$p_sub" "$p_var"; done
    if [[ -z "$p_bad" ]]; then ok "5b-P $p_action/$p_sub: in reaches its write, out and link write nothing outside, a 77 writes nothing [FR-041]"
    else bad "5b-P $p_action/$p_sub: in reaches its write, out and link write nothing outside, a 77 writes nothing [FR-041]" "${p_bad:0:500}"; fi
  done < <(node -e 'console.log(require(process.argv[1] + "/intent-constants.cjs").INTENT_CHILD_ALLOWLIST[process.argv[2]].join("\n"))' "$INTENT_LIB" "$p_action")
  p_counts="$p_counts $p_action=$p_n"
done
if [[ "$p_counts" == " new-feature=16 continue-feature=16 plan=4 execute=12 fix=9 stage=1" && "$p_reached" -eq 58 ]]; then ok "5b-Pn every allowlisted subcommand was probed and every in-variant reached its path ($p_counts, reached $p_reached) [FR-041, FR-048]"
else bad "5b-Pn every allowlisted subcommand was probed and every in-variant reached its path [FR-041, FR-048]" "counts:$p_counts reached $p_reached of 58"; fi
p_git_set="$(printf '%s\n' $p_git_users | LC_ALL=C sort -u | tr '\n' ' ')"
if [[ "$p_git_set" == "continue-feature/git_diff continue-feature/git_log continue-feature/git_status continue-feature/quick_eligibility continue-feature/realpath-check_run execute/git_add execute/git_commit execute/git_diff execute/git_log execute/git_status fix/git_diff fix/git_log fix/git_status fix/quick_eligibility new-feature/git_diff new-feature/git_log new-feature/git_status new-feature/quick_eligibility new-feature/realpath-check_run plan/git_diff plan/git_log plan/git_status " ]]; then ok "5b-Pg the allowlisted subcommands that run git internally all ran it hardened, with no caller variable ($p_git_set) [FR-048]"
else bad "5b-Pg the allowlisted subcommands that run git internally all ran it hardened, with no caller variable [FR-048]" "got: $p_git_set"; fi

# ---------- L: `..` or `.` behind a missing segment, per path flag (MAJOR-1) ----------
# nonexist/../lnk/x names the link target once Node normalizes it; the check
# must refuse it (and the plain lnk/x) for every flag in INTENT_CHILD_PATH_FLAGS.
w5b_project_sandbox w5b-l
mkdir -p "$SB/outside"
ln -s "$SB/outside" "$CWD/lnk"
l_n=0
while IFS= read -r l_flag; do
  [[ -n "$l_flag" ]] || continue
  l_n=$((l_n + 1))
  l_bad=""
  for l_val in nonexist/../lnk/x nonexist/./../lnk/x lnk/x "$CWD/nx/../lnk/y"; do
    child fix real-proj fix next-suffix real-proj 2026-09-27 "$l_flag" "$l_val"
    [[ "$RC" -eq 77 && "$OUT" == *'"reason":"path_outside_scope"'* ]] || l_bad="$l_bad [$l_val]=$RC"
    child fix real-proj fix next-suffix real-proj 2026-09-27 "$l_flag=$l_val"
    [[ "$RC" -eq 77 && "$OUT" == *'"reason":"path_outside_scope"'* ]] || l_bad="$l_bad [=$l_val]=$RC"
  done
  if [[ -z "$l_bad" ]]; then ok "5b-L $l_flag nonexist/../lnk/x, nonexist/./../lnk/x, lnk/x, <cwd>/nx/../lnk/y (both forms) -> 77 path_outside_scope [FR-041]"
  else bad "5b-L $l_flag nonexist/../lnk/x, nonexist/./../lnk/x, lnk/x, <cwd>/nx/../lnk/y (both forms) -> 77 path_outside_scope [FR-041]" "${l_bad:0:300}"; fi
done < <(node -e 'console.log(require(process.argv[1] + "/intent-constants.cjs").INTENT_CHILD_PATH_FLAGS.join("\n"))' "$INTENT_LIB")
child new-feature real-proj check reservations --claim route:/x --by 001 --file nonexist/../lnk/res.json
if [[ "$RC" -eq 77 && -z "$(ls -A "$SB/outside")" ]]; then ok "5b-L0 the measured bypass: check reservations --file nonexist/../lnk/res.json -> 77, nothing in the link target [FR-041]"
else bad "5b-L0 the measured bypass: check reservations --file nonexist/../lnk/res.json -> 77, nothing in the link target [FR-041]" "exit $RC, target: $(ls -A "$SB/outside" | head -3)"; fi
child stage real-proj product stage --by 011-x --set started --dir newdir/./sub
expect_refused "5b-L1 a . segment behind a missing one -> 77 path_outside_scope (fail closed) [FR-041]" path_outside_scope
if [[ "$l_n" -eq 40 ]]; then ok "5b-Ln all 40 path flags probed [FR-041]"; else bad "5b-Ln all 40 path flags probed [FR-041]" "probed $l_n"; fi

# ---------- F: result-note filter residuals of the re-review (MINOR-1, MINOR-2) ----------
# Library cases on intent-redact.cjs. F1: a 4 MiB stream of BEGIN markers
# with a label longer than 40 characters and no END is redacted in < 2 s
# (pattern 9's label was unbounded: 6.9 s / 11.4 s measured). F2: the device
# secret in every spelling a child can print without an encoder.
f1_ms="$(node - "$INTENT_LIB" <<'JS' 2>&1
const { redact } = require(`${process.argv[2]}/intent-redact.cjs`);
const worst = Math.max(...[`-----BEGIN ${'A'.repeat(41)}PRIVATE KEY-----\n`, `-----BEGIN ${'AB '.repeat(14)}PRIVATE KEY-----\n`].map((unit) => {
  const text = unit.repeat(Math.ceil((4 * 1024 * 1024) / unit.length));
  const t0 = Date.now();
  redact(text, []);
  return Date.now() - t0;
}));
console.log(worst);
JS
)"
if [[ "$f1_ms" =~ ^[0-9]+$ && "$f1_ms" -lt 2000 ]]; then ok "5b-F1 4 MiB of open BEGIN markers with a 41-char label (with and without spaces) is redacted in < 2 s ($f1_ms ms) [FR-031]"
else bad "5b-F1 4 MiB of open BEGIN markers with a 41-char label (with and without spaces) is redacted in < 2 s [FR-031]" "got: ${f1_ms:0:200}"; fi

# f2_case <name> <js expression building the leak from hex h and bytes b>
f2_case() {
  local got
  got="$(node - "$INTENT_LIB" "$FIXTURE_SECRET" "$2" <<'JS' 2>&1
const [lib, h, expr] = process.argv.slice(2);
const { knownSecrets, redact } = require(`${lib}/intent-redact.cjs`);
const b = Buffer.from(h, 'hex');
const leak = new Function('h', 'b', `return ${expr};`)(h, b);
const out = redact(`before ${leak} after`, knownSecrets({ d: { secret_hex: h } }));
const squashed = out.replace(/[\s:._-]/g, '');
const keeps = out.startsWith('before ') && out.endsWith(' after') && out.includes('[REDACTED]');
const leaked = squashed.toLowerCase().includes(h) || squashed.includes(b.toString('base64').replace(/=+$/, ''))
  || squashed.includes(b.toString('base64url'));
console.log(keeps && !leaked ? 'ok' : `leaked: ${out.slice(0, 160)}`);
JS
)"
  if [[ "$got" == "ok" ]]; then ok "$1"; else bad "$1" "${got:0:300}"; fi
}
f2_case "5b-F2a base64 without = padding is redacted [FR-031]" "b.toString('base64').replace(/=+\$/, '')"
f2_case "5b-F2b mixed-case hex is redacted [FR-031]" "h.split('').map((c, i) => (i % 2 ? c.toUpperCase() : c)).join('')"
f2_case "5b-F2c hex with a space between byte pairs is redacted [FR-031]" "h.match(/../g).join(' ')"
f2_case "5b-F2d hex with : between byte pairs is redacted [FR-031]" "h.match(/../g).join(':')"
f2_case "5b-F2e hex broken by a line break is redacted [FR-031]" "h.slice(0, 30) + '\\n' + h.slice(30)"
f2_case "5b-F2f base64 broken by a line break is redacted [FR-031]" "(() => { const s = b.toString('base64'); return s.slice(0, 20) + '\\n' + s.slice(20); })()"
f2_case "5b-F2g base64url (control, already covered) is redacted [FR-031]" "b.toString('base64url')"
f2_ctl="$(node -e '
  const { knownSecrets, redact } = require(process.argv[1] + "/intent-redact.cjs");
  const other = "0123456789abcdef".repeat(4);
  console.log(redact(`x ${other} y`, knownSecrets({ d: { secret_hex: process.argv[2] } })));' "$INTENT_LIB" "$FIXTURE_SECRET" 2>&1)"
if [[ "$f2_ctl" == "x 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef y" ]]; then ok "5b-F2h control: another 64-hex value that is no device secret stays [FR-031]"
else bad "5b-F2h control: another 64-hex value that is no device secret stays [FR-031]" "${f2_ctl:0:200}"; fi

# ---------- P2: the spec-010 product mirror stays inside the scope ----------
# product stage mirrors docs/product to $VAULT/project/<slug>/product/, <slug>
# read from ROADMAP.md `project:`, a file the child may edit. Honest slug:
# the mirror lands in project/real-proj/product/ (in scope; 4 files: ROADMAP, NEXT, index.json + the fixture's audit — 3 before spec 010 mirrored audits/**). Forged slug: the
# mirror is skipped (one stderr line), the repo write and the exit code stay.
w5b_probe_sandbox p2
tree_listing "$FHOME" "$VAULT" >"$SB/p.before"
child stage real-proj product stage --by 011-x --set started --dir docs/product
tree_listing "$FHOME" "$VAULT" >"$SB/p.after"
p2a_scope="$(w5b_scope_diff "$SB/p.before" "$SB/p.after" 2>&1)"
p2a_mirror="$(node -e 'try { const o = JSON.parse(process.argv[1]); console.log(`${o.vault_mirror.status} ${o.vault_mirror.files}`); } catch (e) { console.log("<no vault_mirror>"); }' "$OUT")"
if [[ "$RC" -eq 0 && "$p2a_scope" == ok* && "$p2a_mirror" == "ok 4" && -f "$VAULT/project/real-proj/product/ROADMAP.md" ]]; then
  ok "5b-P2a child product stage mirrors into project/real-proj/product/ only (in scope) [FR-041]"
else bad "5b-P2a child product stage mirrors into project/real-proj/product/ only (in scope) [FR-041]" "exit $RC scope: $p2a_scope mirror: $p2a_mirror" "stderr: ${ERR:0:300}"; fi
node -e 'const fs = require("fs"); const f = process.argv[1]; fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^project: real-proj$/m, "project: other"))' "$W5B_PRIMARY/docs/product/ROADMAP.md"
tree_listing "$FHOME" "$VAULT" >"$SB/p.before"
child stage real-proj product stage --by 011-x --set complete --dir docs/product
tree_listing "$FHOME" "$VAULT" >"$SB/p.after"
p2b_scope="$(w5b_scope_diff "$SB/p.before" "$SB/p.after" 2>&1)"
p2b_mirror="$(node -e 'try { console.log(JSON.parse(process.argv[1]).vault_mirror.status); } catch (e) { console.log("<no vault_mirror>"); }' "$OUT")"
if [[ "$RC" -eq 0 && "$p2b_scope" == ok* && "$p2b_mirror" == "skipped" && ! -e "$VAULT/project/other/product" && "$ERR" == *"vault mirror skipped"* ]]; then
  ok "5b-P2b ROADMAP project: other in the child -> mirror skipped, nothing under project/other/, exit unchanged [FR-041]"
else bad "5b-P2b ROADMAP project: other in the child -> mirror skipped, nothing under project/other/, exit unchanged [FR-041]" "exit $RC scope: $p2b_scope mirror: $p2b_mirror" "stderr: ${ERR:0:300}"; fi
ln -s real-proj "$VAULT/project/alias"
node -e 'const fs = require("fs"); const f = process.argv[1]; fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^project: other$/m, "project: alias"))' "$W5B_PRIMARY/docs/product/ROADMAP.md"
tree_listing "$FHOME" "$VAULT" >"$SB/p.before"
child stage real-proj product stage --by 011-x --set review --dir docs/product
tree_listing "$FHOME" "$VAULT" >"$SB/p.after"
p2c_mirror="$(node -e 'try { console.log(JSON.parse(process.argv[1]).vault_mirror.status); } catch (e) { console.log("<no vault_mirror>"); }' "$OUT")"
p2c_vault="$(diff <(grep "^$(node -e 'process.stdout.write(require("path").normalize(process.argv[1]))' "$VAULT")/" "$SB/p.before") <(grep "^$(node -e 'process.stdout.write(require("path").normalize(process.argv[1]))' "$VAULT")/" "$SB/p.after") | grep -c '^[<>]')"
if [[ "$RC" -eq 0 && "$p2c_mirror" == "skipped" && "$p2c_vault" == "0" ]]; then
  ok "5b-P2c ROADMAP project: alias (a vault symlink to the own project) -> mirror skipped, 0 vault files written [FR-041]"
else bad "5b-P2c ROADMAP project: alias (a vault symlink to the own project) -> mirror skipped, 0 vault files written [FR-041]" "exit $RC mirror: $p2c_mirror vault lines changed: $p2c_vault" "stderr: ${ERR:0:300}"; fi

# ---------- seal helpers ----------
W5B_PLUGIN_REL=".claude/plugins/cache/a1-specforge/a1-specforge"

# w5b_installed <version> <install-path> — the fake installed_plugins.json.
w5b_installed() {
  mkdir -p "$FHOME/.claude/plugins"
  printf '{"version":2,"plugins":{"a1-specforge@a1-specforge":[{"scope":"user","installPath":"%s","version":"%s","installedAt":"2026-09-07T11:40:58.997Z","lastUpdated":"2026-09-20T08:05:15.384Z","gitCommitSha":"d7a1bd5d64730bb9723b93179a3fca02662a2852"}]}}\n' \
    "$2" "$1" >"$FHOME/.claude/plugins/installed_plugins.json"
}

# w5b_seal_sandbox <name> — sandbox, executor = this host, fake plugin 9.9.0
# with copies of four real SKILL.md files (two rows, one unrowed skill).
w5b_seal_sandbox() {
  new_sandbox "$1"
  set_executor "$W5B_HOST"
  PLUGIN_SRC="$FHOME/$W5B_PLUGIN_REL/9.9.0"
  local s
  for s in a1-progress a1-fix a1-plan a1-quick; do
    mkdir -p "$PLUGIN_SRC/skills/$s"
    cp "$REPO_ROOT/skills/$s/SKILL.md" "$PLUGIN_SRC/skills/$s/SKILL.md"
  done
  mkdir -p "$PLUGIN_SRC/skills/a1-fix/workflows" "$PLUGIN_SRC/_shared" "$PLUGIN_SRC/deep/a/b"
  cp "$REPO_ROOT/skills/a1-fix/workflows/00-preflight.md" "$PLUGIN_SRC/skills/a1-fix/workflows/00-preflight.md"
  printf '#!/usr/bin/env node\n// fixture a1-tools\n' >"$PLUGIN_SRC/_shared/a1-tools.cjs"
  printf 'fixture plugin\n' >"$PLUGIN_SRC/README.md"
  printf 'deep\n' >"$PLUGIN_SRC/deep/a/b/c.txt"
  w5b_installed 9.9.0 "$PLUGIN_SRC"
}

# seal_pty <a1-tools> <answer> [args...] — `intent seal` on a pty; the answer
# is typed after a delay (macOS `script` sends EOF first when stdin is
# already at its end). Sets PTY_RC, PTY_OUT and SEAL_JSON (last JSON line).
seal_pty() {
  local tools="$1" answer="$2"
  shift 2
  # EPIPE when seal refused before its prompt and `script` already exited:
  # the reader is gone, so the feeder simply ends.
  local feed='process.stdout.on("error", () => process.exit(0)); setTimeout(() => { process.stdout.write(process.argv[1] + "\n"); setTimeout(() => {}, 1500); }, 700)'
  if [[ "$(uname -s)" == "Darwin" ]]; then
    node -e "$feed" "$answer" | script -q /dev/null env HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node "$A1_AS" "$FHOME" - "$tools" intent seal "$@" >"$SB/.pty" 2>&1
  else
    node -e "$feed" "$answer" | script -qec "$(printf '%q ' env HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node "$A1_AS" "$FHOME" - "$tools" intent seal "$@")" /dev/null >"$SB/.pty" 2>&1
  fi
  PTY_RC=$?
  PTY_OUT="$(tr -d '\r' <"$SB/.pty")"
  SEAL_JSON="$(printf '%s\n' "$PTY_OUT" | grep '^{' | tail -n 1)"
}

# w5b_verify — verifySeal() in the sandbox home; VERIFY = its JSON.
w5b_verify() {
  VERIFY="$(HOME="$FHOME" node -e 'const s = require(process.argv[1] + "/intent-seal.cjs"); const r = s.verifySeal(); console.log(JSON.stringify(r.ok ? { ok: true } : { ok: r.ok, reason: r.reason, detail: r.detail }))' "$INTENT_LIB" 2>&1)"
}

# w5b_nothing_sealed — no seal dir, manifest or empty-mcp.json, neither in
# ~/.a1-intents-seal/ (FR-040, Wave 6A) nor at the old place in ~/.a1-intents/.
w5b_nothing_sealed() {
  [[ ! -e "$FHOME/.a1-intents/sealed" && ! -e "$FHOME/.a1-intents/empty-mcp.json" \
    && -z "$(ls -A "$FHOME/.a1-intents-seal" 2>/dev/null)" ]]
}

w5b_seal_dir() {
  node -e 'try { process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).seal_dir); } catch (e) {}' "$FHOME/.a1-intents-seal/manifest.json"
}

# w5b_check_seal <source> <expect-rewrite: none|row-lists> — independent
# recomputation: modes, file set, sha256 per file, root hash over sorted
# "<path>\t<sha>\n" lines, dir name <version>-<12 hex of the SOURCE root>,
# empty-mcp.json bytes and mode, manifest mode, the seal dir 0700, nothing
# else in ~/.a1-intents-seal/, nothing of the seal in ~/.a1-intents/ (FR-049).
w5b_check_seal() {
  node - "$FHOME/.a1-intents-seal" "$1" "$2" "$FHOME/.a1-intents" <<'JS'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const [dir, source, rewrite, intents] = process.argv.slice(2);
const problems = [];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const walk = (root, rel = '') => fs.readdirSync(path.join(root, rel), { withFileTypes: true })
  .flatMap((e) => { const r = rel ? `${rel}/${e.name}` : e.name; return e.isDirectory() ? [{ r, dir: true }, ...walk(root, r)] : [{ r, dir: false }]; });
const rootOf = (entries) => sha(entries.map(([p, h]) => `${p}\t${h}\n`).join(''));
const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const mode = (p) => fs.statSync(p).mode & 0o777;
if (mode(path.join(dir, 'manifest.json')) !== 0o600) problems.push('manifest mode');
if (mode(dir) !== 0o700) problems.push(`seal dir mode ${mode(dir).toString(8)}`);
const left = walk(intents).filter((e) => /manifest\.json$|empty-mcp\.json$/.test(e.r) || (e.dir && /^(sealed|\d[^/]*-[0-9a-f]{12})$/.test(e.r)));
if (left.length) problems.push(`seal leftovers in ~/.a1-intents: ${left.map((e) => e.r).join(',')}`);
const seal = m.seal_dir;
const entries = walk(seal);
for (const e of entries) {
  const want = e.dir ? 0o555 : 0o444;
  if (mode(path.join(seal, e.r)) !== want) problems.push(`mode ${e.r} ${mode(path.join(seal, e.r)).toString(8)}`);
}
if (mode(seal) !== 0o555) problems.push('mode of the seal dir');
const own = entries.filter((e) => !e.dir).map((e) => [e.r, sha(fs.readFileSync(path.join(seal, e.r)))]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
if (JSON.stringify(Object.keys(m.files).sort()) !== JSON.stringify(own.map((x) => x[0]))) problems.push('file set');
for (const [p, h] of own) if (m.files[p] !== h) problems.push(`sha ${p}`);
if (m.root_sha256 !== rootOf(own)) problems.push('root hash');
const src = walk(source).filter((e) => !e.dir).map((e) => [e.r, sha(fs.readFileSync(path.join(source, e.r)))]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
if (path.basename(seal) !== `9.9.0-${rootOf(src).slice(0, 12)}`) problems.push(`dir name ${path.basename(seal)}`);
if (path.dirname(seal) !== fs.realpathSync(dir)) problems.push('seal parent');
if (m.version !== '9.9.0' || m.skill_rewrite !== rewrite || m.source_install_path !== source || typeof m.sealed_at !== 'string') problems.push('manifest fields');
const extra = fs.readdirSync(dir).filter((n) => !['manifest.json', 'empty-mcp.json', path.basename(seal)].includes(n));
if (extra.length) problems.push(`leftovers ${extra.join(',')}`);
const mcp = path.join(dir, 'empty-mcp.json');
if (fs.readFileSync(mcp, 'utf8') !== '{"mcpServers":{}}' || mode(mcp) !== 0o444) problems.push('empty-mcp.json');
console.log(problems.join('; ') || 'ok');
JS
}

# ---------- G1: seal happy path and refusals ----------
g1_patch="$(w5b_tools false false)"
w5b_seal_sandbox w5b-g1
seal_pty "$W5B_FALSE_TOOLS" yes
g1_check="$(w5b_check_seal "$PLUGIN_SRC" none 2>&1)"
w5b_verify
g1_json_ok="$(node -e 'const o = JSON.parse(process.argv[1]); console.log(o.ok === true && o.skill_rewrite === "none" && o.files === 8 ? "ok" : "bad")' "$SEAL_JSON" 2>&1)"
if [[ "$g1_patch" == "ok" && "$PTY_RC" -eq 0 && "$g1_check" == "ok" && "$VERIFY" == '{"ok":true}' && "$g1_json_ok" == "ok" ]]; then
  ok "5b-G1a pty seal: files 0444, dirs 0555, manifest root hash recomputed, empty-mcp.json exact, verifySeal ok [FR-040]"
else bad "5b-G1a pty seal: files 0444, dirs 0555, manifest root hash recomputed, empty-mcp.json exact, verifySeal ok [FR-040]" \
  "patch $g1_patch exit $PTY_RC check: $g1_check verify: $VERIFY json: $g1_json_ok" "pty: ${PTY_OUT:0:400}"; fi
g1_same="$(node -e '
  const fs = require("fs"); const path = require("path"); const [src, seal] = process.argv.slice(1);
  const walk = (d, r = "") => fs.readdirSync(path.join(d, r), { withFileTypes: true }).flatMap((e) => { const p = r ? `${r}/${e.name}` : e.name; return e.isDirectory() ? walk(d, p) : [p]; });
  console.log(walk(src).every((p) => fs.readFileSync(path.join(src, p)).equals(fs.readFileSync(path.join(seal, p)))) ? "ok" : "differs");' "$PLUGIN_SRC" "$(w5b_seal_dir)" 2>&1)"
if [[ "$g1_same" == "ok" ]]; then ok "5b-G5b rewrite constant false: every file byte-identical, manifest skill_rewrite none [FR-044]"
else bad "5b-G5b rewrite constant false: every file byte-identical, manifest skill_rewrite none [FR-044]" "$g1_same"; fi

w5b_seal_sandbox w5b-g1b
w5b_run "$SB" "$W5B_FALSE_TOOLS" -- intent seal --yes
if w5b_nothing_sealed; then expect_usage "5b-G1b seal --yes -> exit 2, nothing written [FR-040]"
else bad "5b-G1b seal --yes -> exit 2, nothing written [FR-040]" "something was sealed"; fi
w5b_run "$SB" "$W5B_FALSE_TOOLS" -- intent seal
if [[ "$RC" -eq 1 ]] && w5b_nothing_sealed; then ok "5b-G1c non-TTY seal -> exit 1, nothing written [FR-040]"
else bad "5b-G1c non-TTY seal -> exit 1, nothing written [FR-040]" "exit $RC" "stdout: ${OUT:0:200}" "stderr: ${ERR:0:200}"; fi
set_executor "other-host.invalid"
seal_pty "$W5B_FALSE_TOOLS" yes
if [[ "$PTY_RC" -eq 1 && "$SEAL_JSON" == *'"not_executor_host"'* ]] && w5b_nothing_sealed; then ok "5b-G1d seal on a foreign host -> exit 1 not_executor_host, nothing written [FR-040]"
else bad "5b-G1d seal on a foreign host -> exit 1 not_executor_host, nothing written [FR-040]" "exit $PTY_RC json: $SEAL_JSON" "pty: ${PTY_OUT:0:300}"; fi
set_executor "$W5B_HOST"
seal_pty "$W5B_FALSE_TOOLS" no
if [[ "$PTY_RC" -eq 1 && "$SEAL_JSON" == *'"not_confirmed"'* ]] && w5b_nothing_sealed; then ok "5b-G1e an answer other than yes -> exit 1 not_confirmed, nothing written [FR-040]"
else bad "5b-G1e an answer other than yes -> exit 1 not_confirmed, nothing written [FR-040]" "exit $PTY_RC json: $SEAL_JSON" "pty: ${PTY_OUT:0:300}"; fi

# ---------- G2: tamper classes ----------
# g2_case <name> <want-detail> <tamper-shell> — fresh seal, verify ok, tamper,
# verify -> sandbox_invalid with the named detail.
g2_case() {
  local name="$1" want="$2" tamper="$3"
  w5b_seal_sandbox "w5b-g2-$want-$RANDOM"
  seal_pty "$W5B_FALSE_TOOLS" yes
  w5b_verify
  local before="$VERIFY"
  SEAL_DIR="$(w5b_seal_dir)"
  eval "$tamper"
  w5b_verify
  if [[ "$PTY_RC" -eq 0 && "$before" == '{"ok":true}' && "$VERIFY" == "{\"ok\":false,\"reason\":\"sandbox_invalid\",\"detail\":\"$want\"}" ]]; then ok "$name"
  else bad "$name" "seal exit $PTY_RC, before: $before" "after: $VERIFY"; fi
}
g2_case "5b-G2a one flipped byte -> sandbox_invalid seal_mismatch [FR-040]" seal_mismatch \
  'chmod 644 "$SEAL_DIR/README.md"; printf "Fixture plugin\n" >"$SEAL_DIR/README.md"; chmod 444 "$SEAL_DIR/README.md"'
g2_case "5b-G2b one extra file -> sandbox_invalid seal_mismatch [FR-040]" seal_mismatch \
  'chmod 755 "$SEAL_DIR/deep"; printf "x\n" >"$SEAL_DIR/deep/extra.txt"; chmod 444 "$SEAL_DIR/deep/extra.txt"; chmod 555 "$SEAL_DIR/deep"'
g2_case "5b-G2c one write bit on a file -> sandbox_invalid seal_writable [FR-040]" seal_writable \
  'chmod u+w "$SEAL_DIR/deep/a/b/c.txt"'
g2_case "5b-G2d one write bit on a directory -> sandbox_invalid seal_writable [FR-040]" seal_writable \
  'chmod u+w "$SEAL_DIR/deep/a"'
g2_case "5b-G2e a bumped version in installed_plugins.json -> sandbox_invalid seal_stale [FR-040]" seal_stale \
  'w5b_installed 9.9.1 "$PLUGIN_SRC"'
g2_case "5b-G2f an edited empty-mcp.json -> sandbox_invalid mcp_config_mismatch [FR-040]" mcp_config_mismatch \
  'chmod 644 "$FHOME/.a1-intents-seal/empty-mcp.json"; printf "{\"mcpServers\":{\"x\":{}}}" >"$FHOME/.a1-intents-seal/empty-mcp.json"; chmod 444 "$FHOME/.a1-intents-seal/empty-mcp.json"'
g2_case "5b-G2g a removed seal dir -> sandbox_invalid seal_missing [FR-040]" seal_missing \
  'chmod -R u+w "$SEAL_DIR"; rm -rf "$SEAL_DIR"'
g2_case "5b-G2h a file replaced by a symlink to a byte-identical 0444 twin -> sandbox_invalid seal_mismatch [FR-040]" seal_mismatch \
  'printf "fixture plugin\n" >"$SB/readme-twin"; chmod 444 "$SB/readme-twin"; chmod 755 "$SEAL_DIR"; rm -f "$SEAL_DIR/README.md"; ln -s "$SB/readme-twin" "$SEAL_DIR/README.md"; chmod 555 "$SEAL_DIR"'

# ---------- G3: symlink in the source ----------
w5b_seal_sandbox w5b-g3
ln -s ../README.md "$PLUGIN_SRC/skills/lnk"
seal_pty "$W5B_FALSE_TOOLS" yes
if [[ "$PTY_RC" -eq 1 && "$SEAL_JSON" == *'"symlink_in_source"'* ]] && w5b_nothing_sealed; then ok "5b-G3 a symlink in the source -> seal exit 1, no seal dir, no manifest [FR-040]"
else bad "5b-G3 a symlink in the source -> seal exit 1, no seal dir, no manifest [FR-040]" "exit $PTY_RC json: $SEAL_JSON" "pty: ${PTY_OUT:0:300}"; fi

# ---------- G4: catalogs ----------
g4="$(node -e '
  const s = require(process.argv[1] + "/status-constants.cjs");
  const c = require(process.argv[1] + "/intent-constants.cjs");
  const f = require(process.argv[1] + "/intent.cjs");
  const eq = (set, list) => set instanceof Set && set.size === list.length && list.every((x) => set.has(x));
  const R = ["schema_invalid", "id_mismatch", "action_unknown", "project_invalid", "oversized", "target_invalid",
    "target_not_found", "approve_from_non_executor_device", "device_unknown", "signature_invalid", "stale", "replay",
    "not_executor_host", "ledger_unreadable", "tampered", "cancelled_by_user", "workspace_not_isolated",
    "intent_worktree_limit"]; // spec round 8 (Wave 6 part B)
  const F = ["timeout", "expired", "spawn_error", "nonzero_exit", "cancelled", "sandbox_invalid", "parent_step_failed"];
  const X = ["already_claimed", "already_moved", "ledger_busy", "project_busy", "executor_busy", "rate_limited", "result_path_unsafe", "display_unsafe"];
  const K = ["approved_from_device", "approved_at", "approved_via", "approved_by_intent"];
  const disjoint = X.every((x) => !s.INTENT_REJECT_REASONS.has(x) && !s.INTENT_FAILURE_REASONS.has(x));
  console.log([R.length === 18 && eq(s.INTENT_REJECT_REASONS, R), F.length === 7 && eq(s.INTENT_FAILURE_REASONS, F),
    X.length === 8 && eq(s.INTENT_REFUSAL_CODES, X), disjoint,
    Array.isArray(c.INTENT_APPROVAL_KEYS) && Object.isFrozen(c.INTENT_APPROVAL_KEYS) && c.INTENT_APPROVAL_KEYS.join(",") === K.join(","),
    f.INTENT_REFUSAL_CODES === s.INTENT_REFUSAL_CODES && f.INTENT_APPROVAL_KEYS === c.INTENT_APPROVAL_KEYS].join(" "));' "$INTENT_LIB" 2>&1)"
if [[ "$g4" == "true true true true true true" ]]; then ok "5b-G4 catalogs: 18 reject reasons incl. workspace_not_isolated and intent_worktree_limit, 7 failure reasons incl. sandbox_invalid and parent_step_failed, 8 refusal codes incl. result_path_unsafe and display_unsafe outside both, 4 approval keys [FR-040]"
else bad "5b-G4 catalogs: 18 reject reasons incl. workspace_not_isolated and intent_worktree_limit, 7 failure reasons incl. sandbox_invalid and parent_step_failed, 8 refusal codes incl. result_path_unsafe and display_unsafe outside both, 4 approval keys [FR-040]" "reject failure refusal disjoint approval facade: $g4"; fi

# ---------- G5: the B1 rewrite gate ----------
g5a_patch="$(w5b_tools null null)"
w5b_seal_sandbox w5b-g5a
seal_pty "$W5B_NULL_TOOLS" yes
if [[ "$g5a_patch" == ok && "$PTY_RC" -eq 1 && "$SEAL_JSON" == *'"b1_unmeasured"'* ]] && w5b_nothing_sealed; then ok "5b-G5a B1 constant null -> seal exit 1 b1_unmeasured, nothing written [FR-044]"
else bad "5b-G5a B1 constant null -> seal exit 1 b1_unmeasured, nothing written [FR-044]" "exit $PTY_RC json: $SEAL_JSON" "pty: ${PTY_OUT:0:300}"; fi

g5_patch="$(w5b_tools true true)"
w5b_seal_sandbox w5b-g5c
seal_pty "$W5B_TRUE_TOOLS" yes
g5_check="$(w5b_check_seal "$PLUGIN_SRC" row-lists 2>&1)"
w5b_verify
g5_rows="$(node - "$PLUGIN_SRC" "$(w5b_seal_dir)" <<'JS' 2>&1
const fs = require('fs');
const path = require('path');
const [src, seal] = process.argv.slice(2);
const R = ['Read', 'Grep', 'Glob'];
const W = ['Task', 'Read', 'Edit', 'Write', 'Grep', 'Glob', `Bash(node ${seal}/_shared/a1-tools.cjs *)`]; // FR-048: no raw git rule
const ROW = { 'a1-progress': R, 'a1-fix': W, 'a1-plan': W, 'a1-quick': R };
// the allowed-tools block: the key line and its "  - " items, frontmatter only
const split = (text) => {
  const lines = text.split('\n');
  const end = lines.indexOf('---', 1);
  const at = lines.findIndex((l, i) => i > 0 && i < end && l === 'allowed-tools:');
  if (at < 0) return null;
  let j = at + 1;
  while (lines[j].startsWith('  - ')) j += 1;
  return { items: lines.slice(at + 1, j).map((l) => l.slice(4)), rest: [...lines.slice(0, at), ...lines.slice(j)].join('\n') };
};
const problems = [];
for (const [skill, want] of Object.entries(ROW)) {
  const a = split(fs.readFileSync(path.join(src, 'skills', skill, 'SKILL.md'), 'utf8'));
  const b = split(fs.readFileSync(path.join(seal, 'skills', skill, 'SKILL.md'), 'utf8'));
  if (!a || !b) { problems.push(`${skill}: no allowed-tools block`); continue; }
  if (b.items.join('|') !== want.join('|')) problems.push(`${skill}: ${b.items.join(',')}`);
  if (b.items.includes('Bash')) problems.push(`${skill}: bare Bash`);
  if (a.rest !== b.rest) problems.push(`${skill}: other bytes changed`);
}
for (const p of ['skills/a1-fix/workflows/00-preflight.md', 'README.md', '_shared/a1-tools.cjs']) {
  if (!fs.readFileSync(path.join(src, p)).equals(fs.readFileSync(path.join(seal, p)))) problems.push(`${p} changed`);
}
console.log(problems.join('; ') || 'ok');
JS
)"
if [[ "$g5_patch" == "ok" && "$PTY_RC" -eq 0 && "$g5_check" == "ok" && "$g5_rows" == "ok" && "$VERIFY" == '{"ok":true}' ]]; then
  ok "5b-G5c rewrite constant true: each SKILL.md declares exactly its row list, no bare Bash, all other bytes unchanged, manifest row-lists [FR-044]"
else bad "5b-G5c rewrite constant true: each SKILL.md declares exactly its row list, no bare Bash, all other bytes unchanged, manifest row-lists [FR-044]" \
  "patch $g5_patch exit $PTY_RC check: $g5_check verify: $VERIFY" "rows: ${g5_rows:0:400}" "pty: ${PTY_OUT:0:300}"; fi

# The seal dirs are 0555 by design; without write bits the runner's EXIT trap
# (rm -rf "$WORK") cannot remove them and every run leaves a dir in $TMPDIR.
chmod -R u+w "$WORK"
