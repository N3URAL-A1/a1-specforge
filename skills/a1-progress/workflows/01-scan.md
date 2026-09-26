# Phase 1: Scan & Report

Read project state and present a clear status overview.

## Scan steps

### 1. Detect project root
```bash
# Look for .a1/, CLAUDE.md, .git
ls -la .a1/ 2>/dev/null
ls -la .git/ 2>/dev/null
cat CLAUDE.md 2>/dev/null | head -10
```

### 2. Read roadmap
```bash
cat .a1/roadmap.md 2>/dev/null
ls .a1/phases/ 2>/dev/null
```

### 3. For each phase directory
```bash
# Check plan existence and status
cat .a1/phases/*/PLAN.md 2>/dev/null | grep -E "^(phase:|goal:|status:|waves:)"
# Check execution status
cat .a1/phases/*/STATUS.md 2>/dev/null
# Check verification
cat .a1/phases/*/VERIFICATION.md 2>/dev/null | grep -E "^(verdict:|passed:|gaps:)"
```

### 4. Git state
```bash
git branch --show-current
git log --oneline -10
git status --short
```

### 5. Health checks
```bash
# Quick type-check
npx tsc --noEmit 2>&1 | tail -3
# Test count
npm test -- --passWithNoTests 2>&1 | tail -5
```

### 6. In-flight features (parallel feature lifecycle)
```bash
# Reads .a1/reservations.json; deterministic, no writes, no auto-release.
node _shared/a1-tools.cjs code-scope list --stale-days 7
```
For each `code_scope` entry in the JSON, render: `by` (feature id), `stage`,
`paths` (scope), and — when `stale: true` — the entry's `hint` field verbatim.
If there are zero entries or the file is missing, show "No in-flight
features" and skip the section.

### 7. Vault cockpit (spec 010, FR-022)

Read-only: `vault status` and `vault lint` never write. The vault is active
only when `A1_VAULT_ROOT` names an external vault; `vault status` then
compares the repo's `docs/product/` and `.a1/phases/` with their vault
mirror, and `vault lint` checks the frontmatter of the project's vault
folder. Each exit code is read from the command itself — output goes to a
file first, never through a pipe (`vault status` exits 1 on drift, 2 when
it cannot run; `vault lint` exits 1 on findings, 2 when it cannot run).

```bash
A1_TOOLS="${A1_TOOLS:-_shared/a1-tools.cjs}"
VC_DIR="$(mktemp -d)"
node "$A1_TOOLS" vault status --json >"$VC_DIR/status.json" 2>"$VC_DIR/status.err"; VS_RC=$?
if [ "$VS_RC" -eq 2 ] && [ -z "${A1_VAULT_ROOT:-}" ]; then
  echo 'vault: not configured'
elif [ "$VS_RC" -eq 2 ] && grep -q 'no external vault root' "$VC_DIR/status.err"; then
  echo 'vault: not configured'
elif [ "$VS_RC" -eq 2 ]; then
  echo "vault status: cannot run ($(head -n 1 "$VC_DIR/status.err"))"
else
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const c=r.counts;console.log(`vault status: ${c.missing} missing, ${c.stale} stale, ${c.extra} extra, ${c.conflict} conflict`)' "$VC_DIR/status.json"
  VC_SLUG="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).slug)' "$VC_DIR/status.json")"
  node "$A1_TOOLS" vault lint "$VC_SLUG" --json >"$VC_DIR/lint.json" 2>"$VC_DIR/lint.err"; VL_RC=$?
  if [ "$VL_RC" -eq 2 ]; then
    echo "vault lint: cannot run ($(head -n 1 "$VC_DIR/lint.err"))"
  else
    node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).counts;const k=Object.keys(c).sort();console.log(k.length?`vault lint: ${k.map((x)=>`${c[x]} ${x}`).join(", ")}`:"vault lint: 0 findings")' "$VC_DIR/lint.json"
  fi
fi
rm -rf "$VC_DIR"
```

Print the resulting line(s) verbatim in the report. `vault: not configured`
is a normal state (vault-free installs), not a warning. Drift counts above 0
route to `a1-tools vault sync`; lint `type_missing` routes to
`a1-tools vault lint <slug> --fix-type`; a `conflict` count means Obsidian
conflict copies that a human resolves in the vault.

## Output format

```
━━━ Project Status ━━━━━━━━━━━━━━━━━━━━━━━━━

Project: <name>  Branch: <branch>

<if roadmap exists>
Milestone: <current milestone>
</if>

Phases:
  ✓ M1-P1-<name>        DONE        (verified)
  ✓ M1-P2-<name>        DONE        (verified)
  → M1-P3-<name>        EXECUTING   Wave 2/4 in progress
    M2-P1-<name>        PLANNED     ready for a1-execute
    M2-P2-<name>        NOT PLANNED —

Recent commits:
  <last 5 git log lines>

Build/Tests: <ok / N errors>

In-flight features:
  <feature-id>        stage: <stage>    scope: <paths>
  <feature-id>        stage: <stage>    scope: <paths>   ⚠ stale
                        → <hint from JSON>

Vault:
  vault status: <n> missing, <n> stale, <n> extra, <n> conflict
  vault lint: <n> <class>, …            (or: vault: not configured)

━━━ Next Action ━━━━━━━━━━━━━━━━━━━━━━━━━━━

→ <recommended next action with skill name>
```

## Routing decisions

| Condition | Recommendation |
|---|---|
| No `.a1/` | Start with `a1-roadmap` to plan the project |
| Phase has PLAN.md, no STATUS.md | `a1-execute` — ready to start |
| STATUS.md has incomplete waves | `a1-execute` — resume from Wave <N> |
| All waves done, no VERIFICATION.md | `a1-execute` — runs verification automatically |
| VERIFICATION.md PARTIAL/FAIL | `a1-execute` — targeted re-run for gaps |
| VERIFICATION.md PASS, next phase not planned | `a1-plan` — plan next phase |
| All phases DONE | 🎉 Done — suggest deploy or next milestone |
