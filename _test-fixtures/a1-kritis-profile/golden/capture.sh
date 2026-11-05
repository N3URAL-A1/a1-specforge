#!/usr/bin/env bash
# Captures the 12 golden scenarios from GOLDEN_COMMIT — the post-023
# merge-base with origin/main, NEVER from the working tree (testing.md
# class 4; spec 006-specforge-kritis-profile, FR-008 / SC-002).
#
#   bash _test-fixtures/a1-kritis-profile/golden/capture.sh
#
# Extracts the commit with `git archive`, runs golden/scenarios.sh with that
# tree's a1-tools.cjs (vault-free, temp HOME, fresh git repos per scenario)
# and writes <name>.{out,err,files} here, each with a one-line header naming
# the commit and this command. Re-running it must reproduce the committed
# goldens byte for byte; a diff means the capture itself is not deterministic.
set -euo pipefail
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

GOLDEN_COMMIT=cb3fd99a6be44891d52b96cc4223f4897823e7c9
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
# shellcheck source=scenarios.sh
source "$HERE/scenarios.sh"
PRE="$(g_mktemp w1k-pre)"; g_need_dir PRE "$PRE"
trap 'rm -rf "$PRE"' EXIT

git -C "$REPO_ROOT" archive "$GOLDEN_COMMIT" | tar -x -C "$PRE"

HEADER="# golden: commit $GOLDEN_COMMIT, captured by: bash _test-fixtures/a1-kritis-profile/golden/capture.sh"
for entry in "${G_SCENARIOS[@]}"; do
  name="${entry%%:*}"; fn="${entry#*:}"
  work="$(g_mktemp w1k-cap)"; g_need_dir work "$work"
  "$fn" "$PRE/_shared/a1-tools.cjs" "$work/$name"
  g_cleanup
  for ext in out err files; do
    { printf '%s\n' "$HEADER"; cat "$work/$name.$ext"; } >"$HERE/$name.$ext"
  done
  rm -rf "$work"
  printf 'captured %s\n' "$name"
done

# Committed inputs for the run-time cases that must work without .git (the
# pr merge-check runs every suite on a git-archive snapshot, no .git):
#   prompts/<basename>  the six prompt files, byte-identical to GOLDEN_COMMIT
#                       (caseP in part 01, caseWireDiscipline D in part 08)
#   spec.cjs.golden     GOLDEN_COMMIT's _shared/lib/spec.cjs (G-mut, part 01)
#   provenance.sha256   "<sha256>  <name>" per copy, for the drift guard
PROMPT_RELS=(
  skills/a1-new-feature/SKILL.md
  skills/a1-new-feature/workflows/02-specify.md
  skills/a1-new-feature/workflows/03-clarify.md
  skills/a1-new-feature/workflows/04.5-consistency-gate.md
  agents/a1-rene-requirement-engineer.md
  agents/a1-samuel-security.md
)
mkdir -p "$HERE/prompts"
for rel in "${PROMPT_RELS[@]}"; do
  cp "$PRE/$rel" "$HERE/prompts/$(basename "$rel")"
done
cp "$PRE/_shared/lib/spec.cjs" "$HERE/spec.cjs.golden"
node -e '
  const fs = require("fs"), crypto = require("crypto"), path = require("path");
  const here = process.argv[1];
  const names = fs.readdirSync(path.join(here, "prompts")).sort().map((n) => "prompts/" + n).concat(["spec.cjs.golden"]);
  const lines = names.map((n) => crypto.createHash("sha256").update(fs.readFileSync(path.join(here, n))).digest("hex") + "  " + n);
  fs.writeFileSync(path.join(here, "provenance.sha256"), lines.join("\n") + "\n");
' "$HERE"
printf 'captured prompts, spec.cjs.golden, provenance.sha256\n'
