#!/usr/bin/env bash
# Scenario suite for `a1-tools product import` / `product validate` (Wave 6,
# FR-021/FR-022/SC-006). Mirrors the product-docs harness style (mktemp
# workdir, assert_rc/assert_true, node invocations, hash checks).
#
# Fixture shapes embedded inline (self-contained — no dependency on external
# repos or the Obsidian Vault at test-run time):
#   fixture-a.html  — hand-written HTML (Niimo-style): Frappe-Gantt page with
#                      a `const tasks = [...]` JS array literal. Representative
#                      trim of the real docs/roadmap.html this shape is based
#                      on (see niimo git history, commit ebec8f9), including a
#                      dependency chain, a done task, a gate/blocker task, and
#                      legend/footer prose with no schema-v1 home.
#   fixture-b.json   — data.json + generator (A1/office-style): representative
#                      trim of the real Vault projects/n3ural-platform/roadmap/
#                      data.json shape, including S4_phases (phases -> epics ->
#                      stories with story points + status) and several
#                      no-schema-home sections (S1_vision, S8_dispatch) that
#                      must survive only in the Appendix.
#
# Scenarios:
#   HTML shape:  import succeeds, exit 0                      -> 0
#   HTML shape:  product validate on the result                -> 0, valid:true
#   HTML shape:  dependency chain resolved to generated ids
#   HTML shape:  done task mapped to status: done
#   HTML shape:  gate/legend/footer text preserved in Appendix (SC-006)
#   data.json shape: import succeeds, exit 0                   -> 0
#   data.json shape: product validate on the result             -> 0, valid:true
#   data.json shape: phase -> milestone, story -> feature mapping
#   data.json shape: story points + no-schema sections preserved in
#                     Appendix, nothing silently dropped (SC-006)
#   ONE code path: both shapes handled by the same `product import`
#     subcommand (no --shape flag, no per-consumer command)      -> FR-021
#   index.json / NEXT.md regenerated through the Wave 2 write path
#   refuses to overwrite an existing ROADMAP.md                  -> 1
#   unrecognized shape rejected cleanly                          -> 1
#   product validate rejects a hand-broken ROADMAP.md             -> 1
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

pass=0
fail=0

assert_rc() {
  local name="$1" expected="$2" actual="$3" out="$4"
  if [[ "$actual" -ne "$expected" ]]; then
    echo "FAIL  $name: expected exit $expected, got $actual"
    echo "----- output -----"; echo "$out"; echo "------------------"
    fail=$((fail + 1))
  else
    echo "PASS  $name (exit $actual)"
    pass=$((pass + 1))
  fi
}

assert_true() {
  local name="$1" cond="$2"
  if [[ "$cond" == "true" ]]; then
    echo "PASS  $name"; pass=$((pass + 1))
  else
    echo "FAIL  $name"; fail=$((fail + 1))
  fi
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-import-test.XXXXXX")"

# ===========================================================================
# Fixture A — hand-written HTML (Niimo-style, Frappe-Gantt)
# ===========================================================================
cat > "$WORK/fixture-a.html" <<'EOF'
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <title>niimo — Projekt-Roadmap</title>
</head>
<body>
  <header>
    <h1>niimo — Projekt-Roadmap</h1>
  </header>
  <div class="legend">
    <span class="l-done">Erledigt</span>
    <span class="l-active">Redesign Spec 004 (geplant)</span>
    <span class="l-gate">Gate / Entscheidung / Blocker</span>
  </div>
  <div class="chart-wrap"><svg id="gantt"></svg></div>
  <footer>
    Redesign-Termine sind Planungsannahmen. Details: Vault
    <code>projects/niimo/spec/004-ui-ux-redesign.md</code>.
  </footer>
  <script>
    const tasks = [
      { id: "mvp",   name: "MVP Waves 1-13: Auth, Chat, Wochenplan, Paywall", start: "2026-01-06", end: "2026-04-18", progress: 100, custom_class: "done" },
      { id: "w1",    name: "W1 Token-Foundation: NiimoGlass, NiimoMotion", start: "2026-07-08", end: "2026-07-11", progress: 0, custom_class: "active" },
      { id: "w2",    name: "W2 Primitives: NiimoCard-Varianten, EmptyState", start: "2026-07-11", end: "2026-07-16", progress: 0, dependencies: "w1", custom_class: "active" },
      { id: "gate_dec", name: "GATE: Robert - 5 Open Decisions freigeben", start: "2026-07-07", end: "2026-07-08", progress: 0, custom_class: "gate" },
    ];
  </script>
</body>
</html>
EOF

# ===========================================================================
# Fixture B — data.json + generator (A1/office-style)
# ===========================================================================
cat > "$WORK/fixture-b.json" <<'EOF'
{
  "meta": {
    "title": "A1//office — Produkt-Roadmap",
    "version": "v1.3",
    "totalSP": 42
  },
  "S1_vision": {
    "id": "S1",
    "title": "Produktvision",
    "lead": "A1//office ist ein AI Operating System fuer KMU.",
    "pillars": [
      { "label": "Zielbild", "text": "AI Operating System fuer KMU." }
    ]
  },
  "S4_phases": {
    "id": "S4",
    "title": "Phasen-Detail",
    "phases": [
      {
        "key": "P0",
        "name": "Aufraeumen",
        "window": "KW 28",
        "sp": 5,
        "epics": [
          {
            "name": "E0.1 Landing-Extraktion",
            "agent": "Bernd",
            "stories": [
              { "text": "Repo + Vendoring Setup", "sp": 2, "status": "done" },
              { "text": "Vercel-Projekt umhaengen", "sp": 3, "status": "planned" }
            ]
          }
        ]
      },
      {
        "key": "P1",
        "name": "Pilot-Readiness",
        "window": "Juli 2026",
        "sp": 8,
        "epics": [
          {
            "name": "E1.1 Billing-Selfservice",
            "agent": "Bernd",
            "stories": [
              { "text": "Stripe Checkout Integration", "sp": 8, "status": "doing" }
            ]
          }
        ]
      }
    ]
  },
  "S8_dispatch": {
    "id": "S8",
    "title": "Dispatch",
    "columns": ["Schritt", "Agent"],
    "rows": [["0.a", "backend-bernd"]]
  }
}
EOF

# ===========================================================================
# Scenario group 1 — HTML shape (fixture-a)
# ===========================================================================
PDIR_A="$WORK/a/docs/product"
mkdir -p "$PDIR_A"

OUT="$(node "$TOOLS" product import --file "$WORK/fixture-a.html" --project niimo-test --dir "$PDIR_A" 2>&1)"
RC=$?
assert_rc "html-import-exit-0" 0 "$RC" "$OUT"

if echo "$OUT" | node -e '
  const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
  if (data.shape_detected !== "html-tasks") process.exit(1);
  if (data.features !== 4) process.exit(1);
'; then
  assert_true "html-shape-detected-and-feature-count" "true"
else
  assert_true "html-shape-detected-and-feature-count" "false"
fi

OUT="$(node "$TOOLS" product validate --dir "$PDIR_A" 2>&1)"
RC=$?
assert_rc "html-validate-exit-0" 0 "$RC" "$OUT"
if echo "$OUT" | node -e '
  const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
  if (data.valid !== true) process.exit(1);
  if (data.errors.length !== 0) process.exit(1);
'; then
  assert_true "html-validate-valid-true" "true"
else
  assert_true "html-validate-valid-true" "false"
fi

# w2 depends on w1 in the source (raw string id "w1") -> must resolve to the
# generated feature id for w1 (002-w2 depends_on: [001-... or whichever w1
# got], never the literal string "w1").
if grep -A6 'id: 002-w1\|title: "W1 Token' "$PDIR_A/ROADMAP.md" >/dev/null 2>&1; then
  W1_ID="$(node -e '
    const fs = require("fs");
    const { fm } = (() => {
      const content = fs.readFileSync(process.argv[1], "utf8");
      const raw = content.slice(4, content.indexOf("\n---", 4));
      const idMatch = raw.match(/id: (\S+-w1)\n\s+milestone:/);
      return { fm: { id: idMatch ? idMatch[1] : null } };
    })();
    console.log(fm.id);
  ' "$PDIR_A/ROADMAP.md")"
fi
if node -e '
  const fs = require("fs");
  const content = fs.readFileSync(process.argv[1], "utf8");
  const raw = content.slice(4, content.indexOf("\n---", 4));
  // crude but sufficient: find the w2 feature block and check it has a
  // depends_on referencing a generated id (###-...-w1), not the bare "w1".
  const w2Block = raw.split(/  - id: /).find((b) => /title: "W2 Primitives/.test(b));
  if (!w2Block) process.exit(1);
  const depMatch = w2Block.match(/depends_on:\n\s+- (\S+)/);
  if (!depMatch) process.exit(1);
  if (!/^[0-9]{3}-/.test(depMatch[1])) process.exit(1);
' "$PDIR_A/ROADMAP.md"; then
  assert_true "html-dependency-resolved-to-generated-id" "true"
else
  assert_true "html-dependency-resolved-to-generated-id" "false"
fi

# mvp task has progress:100 -> must map to status: done
if node -e '
  const fs = require("fs");
  const content = fs.readFileSync(process.argv[1], "utf8");
  const raw = content.slice(4, content.indexOf("\n---", 4));
  const mvpBlock = raw.split(/  - id: /).find((b) => /MVP Waves/.test(b));
  if (!mvpBlock) process.exit(1);
  if (!/status: done/.test(mvpBlock)) process.exit(1);
' "$PDIR_A/ROADMAP.md"; then
  assert_true "html-done-task-status-mapped" "true"
else
  assert_true "html-done-task-status-mapped" "false"
fi

# SC-006 content preservation: legend text, footer text, and the gate task's
# custom_class must all appear verbatim somewhere under the Appendix (none of
# them have a schema-v1 field).
APPENDIX_A="$(awk '/## Appendix/,0' "$PDIR_A/ROADMAP.md")"
if [[ "$APPENDIX_A" == *"Erledigt"* && "$APPENDIX_A" == *"Planungsannahmen"* && "$APPENDIX_A" == *"class=gate"* ]]; then
  assert_true "html-unmappable-content-in-appendix" "true"
else
  echo "  appendix content: $APPENDIX_A"
  assert_true "html-unmappable-content-in-appendix" "false"
fi

# ===========================================================================
# Scenario group 2 — data.json shape (fixture-b)
# ===========================================================================
PDIR_B="$WORK/b/docs/product"
mkdir -p "$PDIR_B"

OUT="$(node "$TOOLS" product import --file "$WORK/fixture-b.json" --project a1office-test --dir "$PDIR_B" 2>&1)"
RC=$?
assert_rc "datajson-import-exit-0" 0 "$RC" "$OUT"

if echo "$OUT" | node -e '
  const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
  if (data.shape_detected !== "data-json") process.exit(1);
  if (data.milestones !== 2) process.exit(1);   // P0, P1
  if (data.features !== 3) process.exit(1);     // 2 stories in P0 + 1 in P1
'; then
  assert_true "datajson-shape-detected-and-counts" "true"
else
  assert_true "datajson-shape-detected-and-counts" "false"
fi

OUT="$(node "$TOOLS" product validate --dir "$PDIR_B" 2>&1)"
RC=$?
assert_rc "datajson-validate-exit-0" 0 "$RC" "$OUT"
if echo "$OUT" | node -e '
  const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
  if (data.valid !== true) process.exit(1);
'; then
  assert_true "datajson-validate-valid-true" "true"
else
  assert_true "datajson-validate-valid-true" "false"
fi

# phase P0 -> milestone "p0", story "Stripe Checkout Integration" -> a feature
# under milestone "p1" with status in-flight (source status "doing").
if node -e '
  const fs = require("fs");
  const content = fs.readFileSync(process.argv[1], "utf8");
  const raw = content.slice(4, content.indexOf("\n---", 4));
  const block = raw.split(/  - id: /).find((b) => /Stripe Checkout Integration/.test(b));
  if (!block) process.exit(1);
  if (!/status: in-flight/.test(block)) process.exit(1);
  if (!/milestone: p1/.test(block)) process.exit(1);
' "$PDIR_B/ROADMAP.md"; then
  assert_true "datajson-phase-to-milestone-story-to-feature" "true"
else
  assert_true "datajson-phase-to-milestone-story-to-feature" "false"
fi

# SC-006 content preservation: story points, agent names, and whole
# no-schema-home sections (S1_vision, S8_dispatch) must survive in the
# Appendix verbatim (nothing silently dropped).
APPENDIX_B="$(awk '/## Appendix/,0' "$PDIR_B/ROADMAP.md")"
if [[ "$APPENDIX_B" == *"8 SP"* && "$APPENDIX_B" == *"agent: Bernd"* && \
      "$APPENDIX_B" == *"AI Operating System fuer KMU"* && \
      "$APPENDIX_B" == *"S8_dispatch"* && "$APPENDIX_B" == *"backend-bernd"* ]]; then
  assert_true "datajson-unmappable-content-in-appendix" "true"
else
  echo "  appendix content: $APPENDIX_B"
  assert_true "datajson-unmappable-content-in-appendix" "false"
fi

# ===========================================================================
# Scenario group 3 — ONE code path (FR-021), write path, guard rails
# ===========================================================================

# Both shapes were handled by the SAME subcommand invocation shape (no
# --shape flag was ever passed above) — the dispatcher only has one `import`
# entry point in the product group. Assert that directly against the source.
if grep -q "sub === 'import'" "$TOOLS" && \
   [[ "$(grep -c "cmdProductImport(rest)" "$TOOLS")" -eq 1 ]]; then
  assert_true "one-code-path-single-dispatch-entry" "true"
else
  assert_true "one-code-path-single-dispatch-entry" "false"
fi

# index.json / NEXT.md regenerated through the Wave 2 write path.
if [[ -f "$PDIR_A/index.json" && -s "$PDIR_A/NEXT.md" && -f "$PDIR_B/index.json" && -s "$PDIR_B/NEXT.md" ]]; then
  assert_true "derived-files-regenerated-both-fixtures" "true"
else
  assert_true "derived-files-regenerated-both-fixtures" "false"
fi

if node -e '
  const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const required = ["schema_version", "generated", "project", "milestones", "features", "next", "cursor"];
  for (const k of required) if (!(k in data)) process.exit(1);
' "$PDIR_A/index.json" && node -e '
  const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const required = ["schema_version", "generated", "project", "milestones", "features", "next", "cursor"];
  for (const k of required) if (!(k in data)) process.exit(1);
' "$PDIR_B/index.json"; then
  assert_true "index-json-required-keys-both-fixtures" "true"
else
  assert_true "index-json-required-keys-both-fixtures" "false"
fi

# refuses to overwrite an existing ROADMAP.md
OUT="$(node "$TOOLS" product import --file "$WORK/fixture-a.html" --project niimo-test --dir "$PDIR_A" 2>&1)"
RC=$?
assert_rc "refuses-overwrite-existing-roadmap" 1 "$RC" "$OUT"

# unrecognized shape (plain text, neither HTML tasks array nor data.json)
echo "not a roadmap in any known shape" > "$WORK/garbage.txt"
PDIR_C="$WORK/c/docs/product"
mkdir -p "$PDIR_C"
OUT="$(node "$TOOLS" product import --file "$WORK/garbage.txt" --project garbage --dir "$PDIR_C" 2>&1)"
RC=$?
assert_rc "unrecognized-shape-rejected" 1 "$RC" "$OUT"
if [[ ! -f "$PDIR_C/ROADMAP.md" ]]; then
  assert_true "unrecognized-shape-nothing-written" "true"
else
  assert_true "unrecognized-shape-nothing-written" "false"
fi

# product validate rejects a hand-broken ROADMAP.md (missing required field,
# bad enum value) -- exercises the validator independent of import.
PDIR_D="$WORK/d/docs/product"
mkdir -p "$PDIR_D"
cat > "$PDIR_D/ROADMAP.md" <<'EOF'
---
schema_version: 1
type: roadmap
project: broken-fixture
title: Broken Fixture
status: not-a-real-status
updated: 2026-01-01
source: "test"
milestones:
  - id: m1
    title: M1
    status: planned
    target: null
features: []
next: null
---

# Broken Fixture
EOF
OUT="$(node "$TOOLS" product validate --dir "$PDIR_D" 2>&1)"
RC=$?
assert_rc "validate-rejects-bad-enum" 1 "$RC" "$OUT"
if echo "$OUT" | grep -q "status:"; then
  assert_true "validate-reports-status-error" "true"
else
  assert_true "validate-reports-status-error" "false"
fi

echo "product-import fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
