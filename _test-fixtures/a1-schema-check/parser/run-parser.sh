#!/usr/bin/env bash
# Parser unit fixture for `a1-tools schema-check parse` (M6 Task 2.1a).
# Asserts the extracted tables/FKs/triggers/RLS against expected.json.
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

actual="$(node "$TOOLS" schema-check parse --migrations "$DIR/migrations" 2>&1)"
rc=$?
if [[ $rc -ne 0 ]]; then
  echo "FAIL: schema-check parse exited $rc — $actual"
  exit 1
fi

node -e '
const fs = require("fs");
const expected = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const actual = JSON.parse(process.argv[2]);
const assert = require("assert");
try {
  assert.deepStrictEqual(actual.tables, expected.tables, "tables mismatch");
  assert.deepStrictEqual(actual.triggers, expected.triggers, "triggers mismatch");
  assert.deepStrictEqual(actual.rls, expected.rls, "rls mismatch");
  assert.strictEqual(actual.skippedStatements, expected.skippedStatements, "skippedStatements mismatch");
} catch (e) {
  console.error("FAIL:", e.message);
  process.exit(1);
}
console.log("PASS: parser fixture (3 tables, 2 FKs, 3 triggers, RLS incl. FORCE)");
' "$DIR/expected.json" "$actual"
