#!/usr/bin/env bash
# Shared helpers for the product-modules fixture suites (spec 023). Source it.
# Requires TOOLS (path to a1-tools.cjs) to be set by the caller.

hash_file() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

_sha_stdin() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 | awk '{print $1}'
  else sha256sum | awk '{print $1}'; fi
}

# mask_index <file>: print index.json with the generator-owned `generated`
# value replaced by a fixed token (spec 023 Clarifications, byte-identity baseline).
mask_index() { sed -E 's/("generated"[[:space:]]*:[[:space:]]*")[^"]*(")/\1MASKED\2/' "$1"; }

# mask_next <file>: print NEXT.md without the `updated:` date line.
mask_next() { grep -v -E '^updated:' "$1"; }

# hash_masked index|next <file>: sha256 of the masked content.
hash_masked() {
  local kind="$1" file="$2"
  if [[ "$kind" == "index" ]]; then mask_index "$file" | _sha_stdin; else mask_next "$file" | _sha_stdin; fi
}

# tree_hash <dir>: sha256 over every file's path + content (sorted).
tree_hash() {
  ( cd "$1" && find . -type f | LC_ALL=C sort | while read -r f; do echo "$f $(hash_file "$f")"; done ) | _sha_stdin
}

# --- deterministic input projects (fixed dates so output does not drift) ----

# write_roadmap <dir> <project> <modules-line|""> <m1-module|""> <m2-module|"">
write_roadmap() {
  local pdir="$1" project="$2" modules_line="$3" m1_module="$4" m2_module="$5"
  mkdir -p "$pdir"
  {
    printf '%s\n' '---' 'schema_version: 1' 'type: roadmap' "project: ${project}" \
      "title: ${project} — Roadmap" 'status: active' 'updated: 2026-07-13' 'source: "test fixture"'
    if [[ -n "$modules_line" ]]; then printf '%s\n' "$modules_line"; fi
    printf '%s\n' 'milestones:' '  - id: m1-first' '    title: First Milestone' \
      '    status: in-progress' '    target: 2026-08'
    if [[ -n "$m1_module" ]]; then printf '%s\n' "    module: ${m1_module}"; fi
    printf '%s\n' '  - id: m2-second' '    title: Second Milestone' '    status: planned' '    target: 2026-09'
    if [[ -n "$m2_module" ]]; then printf '%s\n' "    module: ${m2_module}"; fi
    printf '%s\n' 'features:' \
      '  - id: 001-first-feature' '    milestone: m1-first' '    title: First Feature' '    status: planned' \
      '    stage: null' '    depends_on: []' '    started: null' '    finished: null' '    spec_path: null' '    plan_path: null' \
      '  - id: 002-second-feature' '    milestone: m1-first' '    title: Second Feature' '    status: planned' \
      '    stage: null' '    depends_on: [001-first-feature]' '    started: null' '    finished: null' '    spec_path: null' '    plan_path: null' \
      '  - id: 003-third-feature' '    milestone: m2-second' '    title: Third Feature' '    status: planned' \
      '    stage: null' '    depends_on: []' '    started: null' '    finished: null' '    spec_path: null' '    plan_path: null' \
      'next: 001-first-feature' '---' '' "# ${project} — Roadmap" '' '## Milestones' '' \
      '### First Milestone <!-- entry: m1-first -->' 'Status: in-progress · Target: 2026-08' '' \
      '## In-flight features' '' 'None.' '' '## Changelog' '' '- **2026-07-13** — Created fixture.'
  } > "$pdir/ROADMAP.md"
}

write_vision_and_audit() {
  local pdir="$1" project="$2"
  printf '%s\n' '---' 'schema_version: 1' 'type: vision' "project: ${project}" "title: ${project} — Vision" \
    'updated: 2026-07-13' 'pillars:' '  - id: reliability' '    title: Reliability' \
    '    summary: The product never loses user data.' '---' '' "# ${project} — Vision" > "$pdir/VISION.md"
  mkdir -p "$pdir/audits"
  printf '%s\n' '---' 'schema_version: 1' 'type: audit' "project: ${project}" 'focus: general' 'date: 2026-07-13' \
    'source: "test analysis fixture"' 'verdict: "beta-ready, 1 open finding"' \
    'counts: { blocker: 0, major: 1, minor: 0 }' 'findings:' '  - id: F-001' '    title: Example finding' \
    '    severity: major' '    status: open' '    fixed_commit: null' '    feature: null' '---' '' '# Audit' \
    > "$pdir/audits/2026-07-13-general.md"
}

# build_case <a|b|c> <productDir>: create the input project, then run the same
# state-changing commands (stage + changelog) the golden files were taken from.
#   a: minimal project, no modules
#   b: v1.1 project with VISION.md and one audit, no modules
#   c: `modules: [a, b]` present but no tagged milestone
build_case() {
  local c="$1" pdir="$2"
  local pin="--require $(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pin-date.cjs"
  case "$c" in
    a) write_roadmap "$pdir" golden-a "" "" "" ;;
    b) write_roadmap "$pdir" golden-b "" "" ""; write_vision_and_audit "$pdir" golden-b ;;
    c) write_roadmap "$pdir" golden-c "modules: [a, b]" "" "" ;;
  esac
  NODE_OPTIONS="$pin" node "$TOOLS" product stage --by 001-first-feature --set started --dir "$pdir" >/dev/null 2>&1 || return 1
  NODE_OPTIONS="$pin" node "$TOOLS" product changelog --entry "golden regen" --why "byte-identity baseline" --dir "$pdir" >/dev/null 2>&1 || return 1
}

# check_index_against_schema <index.json> <schema.json>
# Copied from _test-fixtures/product-schema-v11/run.sh (check_index_against_schema,
# ~line 575). NOTE: it only checks top-level required/unknown keys and the
# vision/audits required keys; nested `additionalProperties` is NOT enforced.
check_index_against_schema() {
  local index_file="$1" schema_file="$2"
  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const schema = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    for (const k of schema.required) {
      if (!(k in data)) { console.error("missing required key: " + k); process.exit(1); }
    }
    const allowedTop = new Set(Object.keys(schema.properties));
    for (const k of Object.keys(data)) {
      if (!allowedTop.has(k)) { console.error("unexpected top-level key: " + k); process.exit(1); }
    }
    if ("vision" in data && data.vision !== null) {
      const visionDef = schema.$defs.vision;
      for (const k of visionDef.required) {
        if (!(k in data.vision)) { console.error("vision missing required key: " + k); process.exit(1); }
      }
    }
    if ("audits" in data) {
      if (!Array.isArray(data.audits)) { console.error("audits must be an array"); process.exit(1); }
      const auditDef = schema.$defs.audit;
      for (const entry of data.audits) {
        for (const k of auditDef.required) {
          if (!(k in entry)) { console.error("audits[] entry missing required key: " + k); process.exit(1); }
        }
      }
    }
    process.exit(0);
  ' "$index_file" "$schema_file"
}

# check_index_deep <index.json> <schema.json>: recursive validator for the JSON
# Schema subset index.schema.json uses (type, const, enum, pattern, minLength,
# required, properties, additionalProperties:false, items, $ref). Unlike the
# helper above it enforces nested additionalProperties and nested types, so a
# stray key inside `modules[]` or a milestone fails. Prints the first violation.
check_index_deep() {
  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const root = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
    const fail = (p, m) => { console.error((p || "$") + ": " + m); process.exit(1); };
    function check(s, v, p) {
      if (s.$ref) s = { ...root.$defs[s.$ref.split("/").pop()], ...s, $ref: undefined };
      if (s.type) {
        const types = [].concat(s.type); const t = typeOf(v);
        if (!types.includes(t) && !(t === "integer" && types.includes("number"))) fail(p, "type " + t + " not in " + types);
      }
      if (s.const !== undefined && v !== s.const) fail(p, "const");
      if (s.enum && !s.enum.includes(v)) fail(p, "enum");
      if (typeof v === "string") {
        if (s.pattern && !new RegExp(s.pattern).test(v)) fail(p, "pattern " + s.pattern + " vs " + v);
        if (s.minLength && v.length < s.minLength) fail(p, "minLength");
      }
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const k of s.required || []) if (!(k in v)) fail(p, "missing required key " + k);
        const props = s.properties || {};
        for (const k of Object.keys(v)) {
          if (props[k]) check(props[k], v[k], p + "." + k);
          else if (s.additionalProperties === false) fail(p, "unexpected key " + k);
        }
      }
      if (Array.isArray(v) && s.items) v.forEach((x, i) => check(s.items, x, p + "[" + i + "]"));
    }
    check(root, data, "$");
  ' "$1" "$2"
}
