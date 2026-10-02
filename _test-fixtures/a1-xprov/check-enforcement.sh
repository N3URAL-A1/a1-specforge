#!/usr/bin/env bash
# CI guard for the spec 009 enforcement flip (FR-005, fixture case R5).
#
# Usage: check-enforcement.sh [repo-root]   (default: this checkout)
#
# The two cross-provider rows in _shared/gates-registry.md may read `blocking`
# only while the ADR's live-smoke section holds the evidence. Exit 1 when any
# xprov row says `blocking` and the section (`## Live smoke` or `### 6. Live
# smoke`) is missing, still says "pending Wave 7", or lacks the `xprov gate`
# command of either gate. A row that is missing or holds neither `warning` nor
# `blocking` is also exit 1, because the flip state cannot be read. Exit 2 when
# repo-root does not hold the registry and the ADR. Exit 0 otherwise, including
# while both rows are still `warning`.
#
# "The suite is red" is guarded by step order, not here: this runs as its own
# CI step AFTER `Fixtures`, so a red a1-xprov suite stops the job first. R5 in
# parts/07-enforcement.sh asserts that order in .github/workflows/test.yml.
#
# The registry row is read with gate-ids.cjs' parseRegistryRow, the same
# parser `xprov gate` uses for its enforcement cell. The check and the gate
# cannot disagree about what a row says. The parser always comes from THIS
# checkout; only the registry and the ADR come from repo-root.
#
# Stdout: one JSON line {ok, rows, problems}. Human lines go to stderr.

set -u

SELF_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="${1:-$SELF_ROOT}"
REGISTRY="$ROOT/_shared/gates-registry.md"
ADR="$ROOT/docs/adr/2026-09-24-cross-provider-review-gate.md"

if [[ ! -f "$REGISTRY" || ! -f "$ADR" ]]; then
  echo "check-enforcement: usage — $ROOT lacks _shared/gates-registry.md or the spec 009 ADR" >&2
  exit 2
fi

GATE_IDS_LIB="$SELF_ROOT/_shared/lib/gate-ids.cjs" REGISTRY="$REGISTRY" ADR="$ADR" node -e '
const fs = require("fs");
const { parseRegistryRow } = require(process.env.GATE_IDS_LIB);
const GATES = ["plan-review-xprov", "wave-inspect-xprov"];
const ENFORCEMENTS = ["warning", "blocking"];
const SECTION_RE = /^#{2,3}\s+(?:\d+\.\s+)?Live smoke\b/i;
const NEXT_HEADING_RE = /^#{1,3}\s/;
const PLACEHOLDER_RE = /pending wave 7/i;

const registry = fs.readFileSync(process.env.REGISTRY, "utf8");
const problems = [];
const rows = {};
for (const id of GATES) {
  const row = parseRegistryRow(registry, id);
  const e = row ? row.enforcement : null;
  rows[id] = e;
  if (!ENFORCEMENTS.includes(e)) problems.push(`registry row ${id}: enforcement ${JSON.stringify(e)} is not warning|blocking`);
}

if (GATES.some((id) => rows[id] === "blocking")) {
  const lines = fs.readFileSync(process.env.ADR, "utf8").split("\n");
  const start = lines.findIndex((l) => SECTION_RE.test(l));
  if (start === -1) {
    problems.push("a row is blocking but the ADR has no Live smoke section");
  } else {
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => NEXT_HEADING_RE.test(l));
    const section = (end === -1 ? rest : rest.slice(0, end)).join("\n");
    if (PLACEHOLDER_RE.test(section)) problems.push("a row is blocking but the ADR Live smoke section still says pending Wave 7");
    for (const id of GATES) {
      const cmd = new RegExp(`xprov gate[^\\n]*--gate ${id}\\b`);
      if (!cmd.test(section)) problems.push(`a row is blocking but the ADR Live smoke section lacks the xprov gate command for ${id}`);
    }
  }
}

const ok = problems.length === 0;
for (const p of problems) process.stderr.write(`check-enforcement: ${p}\n`);
process.stderr.write(`check-enforcement: ${ok ? "ok" : "FAIL"} (${GATES.map((id) => `${id}=${rows[id]}`).join(", ")})\n`);
process.stdout.write(JSON.stringify({ ok, rows, problems }) + "\n");
process.exit(ok ? 0 : 1);
'
