#!/usr/bin/env bash
# Part 27 — spec 016 Wave 6: `xprov scope` (FR-015 security surface, FR-016 docs_only). Sourced by run-tests.sh.
# SC-007: 41 path sets, each the `git diff --name-only --no-renames <c>^ <c>` output of a real commit in an
# N3URAL repository (cases/scope/*.paths, origin in cases/scope/PROVENANCE.tsv; four are named subsets of
# one real diff, `empty` is the zero-byte diff). The expectations below were written down from reading the
# paths against the spec's category list BEFORE the module ran, never taken from the module's output as an
# oracle (a mismatch was a bug in either side, not a number to copy). Three runs per fixture are compared
# byte for byte. Each guard names the ONE production change that turns its arm red (RED proof); the arms
# marked [mutant] run that change on a tree copy and assert the guard's outcome flips.
#   SC1   Red if a glob file entry, quick.cjs include or category is dropped (a fixture changes class).
#   SC3   Red if resolveInclude() returns a literal list instead of reading quick.cjs [mutant R1].
#   SC4   Red if the per-segment `*` wildcard is dropped from compileGlob (all `*.sql` / `.env.*` miss).
#   SC5   Red if classifyOne() tests the docs globs before the security categories [mutant R3].
#   SC6   Red if segmentsOf() stops returning null for `..` [mutant R2], for NUL [mutant R7], or if
#         MAX_PATH_CHARS is raised [mutant R6]; red if toLowerCase() is dropped [mutant R4].
#   SC7   Red if matched.sort() is dropped [mutant R5].
#   SC8   Red if '--no-renames' is dropped from diffPaths [mutant R9]; red if '-z' is dropped.
#   SC9   Red if REV_RE accepts anything [mutant R8: `--base --output=<file>` makes git write that file].
#   SC10  Red if MAX_PATHS_FILE_BYTES / MAX_PATHS is raised [mutants R11, R12]; red if readPathsFile() reads through
#         fs.readFileSync (a symlink would be followed); red if resolveInclude() accepts a module outside INCLUDE_MODULES.
# The pure functions are exported for waves 7 and 10; SC2 pins their output shape.

SC_CASES="$CASES/scope"
SC_CWD="$(mktemp -d)"            # every run starts in an empty directory: a stray write shows up in `ls -A`
SC_ERRF="$(mktemp)"
SC_WORK="$(mktemp -d)"

# sc_run <tools> <args...> -> SC_OUT SC_ERR SC_RC (stdout and stderr kept apart; cwd = $SC_CWD)
sc_run() {
  local tools="$1"; shift
  SC_OUT="$(cd "$SC_CWD" && env -u A1_VAULT_ROOT node "$tools" xprov scope "$@" 2>"$SC_ERRF" </dev/null)"; SC_RC=$?
  SC_ERR="$(cat "$SC_ERRF")"
}

# sc_mutate <tree> <lib-file> <from> <to> — applies ONE production change to the tree copy; refuses unless <from> occurs exactly once.
sc_mutate() {
  node -e '
    const fs = require("fs"); const [tree, name, from, to] = process.argv.slice(1);
    const f = tree + "/_shared/lib/" + name; const s = fs.readFileSync(f, "utf8");
    const n = s.split(from).length - 1;
    if (n !== 1) { process.stderr.write("mutation target occurs " + n + " times: " + from + "\n"); process.exit(3); }
    fs.writeFileSync(f, s.split(from).join(to));
  ' "$@" || { echo "FAIL  harness: mutation failed ($2: $3)" >&2; exit 2; }
}

# sc_fields: the compact view of SC_OUT used by the table arms
SC_FIELDS="[j.security_surface,j.docs_only,j.total,j.matched.map(m=>m.path+'|'+m.category).join(';')].join('#')"

# ---------- SC1: 40 real path sets, expectations as literals, three runs byte-identical (SC-007) ----------
scFixtures=0
while IFS='#' read -r name sec docs total matched; do
  [[ -n "$name" ]] || continue
  scFixtures=$((scFixtures + 1))
  [[ -f "$SC_CASES/$name.paths" ]] || { bad "SC1 $name: fixture file missing"; continue; }
  sc_run "$TOOLS" --paths "$SC_CASES/$name.paths"; first="$SC_OUT"; rc1=$SC_RC
  sc_run "$TOOLS" --paths "$SC_CASES/$name.paths"; second="$SC_OUT"
  sc_run "$TOOLS" --paths "$SC_CASES/$name.paths"; third="$SC_OUT"
  assert_rc "SC1 $name" 0 "$rc1" "$SC_ERR"
  assert_json "SC1 $name classification" "$first" "$SC_FIELDS" "$sec#$docs#$total#$matched"
  [[ "$first" == "$second" && "$second" == "$third" ]] && ok "SC1 $name: 3 runs byte-identical" || bad "SC1 $name: runs differ"
done <<'TABLE'
auth-routes#true#false#4#app/api/agent/v1/auth/refresh/route.ts|forbidden_surface;app/api/agent/v1/auth/revoke/route.ts|forbidden_surface;app/api/agent/v1/auth/token/route.ts|forbidden_surface
auth-tests#true#false#3#tests/auth/resolve-ms-email.test.ts|forbidden_surface
ci-with-test#true#false#2#.github/workflows/ci.yml|ci;tests/integration/api/invoices-status-freeze.test.ts|route_api
ci-workflow#true#false#1#.github/workflows/build-image.yml|ci
deploy-script-vercel#true#false#1#scripts/vercel-install.sh|deploy_infra
dockerfile-docs#true#false#2#brain-deploy/Dockerfile|deploy_infra
docs-claude-md#false#true#2#
docs-images-subset#false#true#4#
docs-md-rules#false#true#3#
docs-only-product#false#true#4#
docs-plus-ci-deploy#true#false#4#.github/actions/setup-test-db/action.yml|ci;.github/workflows/ci.yml|ci;.github/workflows/deploy.yml|ci
docs-plus-ci#true#false#3#.github/workflows/ci.yml|ci;automation/db/migrations/MIGRATIONS-RESERVED.md|forbidden_surface
docs-plus-env#true#false#2#.env.local.example|forbidden_surface
docs-plus-lockfile#true#false#5#package-lock.json|manifest_lockfile
docs-readme#false#true#1#
docs-single#false#true#1#
empty#false#false#0#
env-compose#true#false#3#.env.local.example|forbidden_surface;automation/.env.example|forbidden_surface;automation/docker-compose.yml|deploy_infra
env-template-cors#true#false#4#.env.local.example|forbidden_surface
infra-k8s-docs#true#false#3#infra/app/deployment.yaml|deploy_infra
license-font-txt#false#false#4#
license-mix#false#false#8#
license-only#false#true#1#
manifest-lock#true#false#2#package.json|manifest_lockfile;pnpm-lock.yaml|manifest_lockfile
manifest-only#true#false#1#package.json|manifest_lockfile
middleware-test#false#false#1#
migration-md-only#true#false#2#automation/db/migrations/MIGRATIONS-RESERVED.md|forbidden_surface
migration-sql-plus-plan#true#false#2#automation/db/migrations/127_spec055_expense_recommendations.sql|forbidden_surface
migration-sql#true#false#1#automation/db/migrations/127_spec055_expense_recommendations.sql|forbidden_surface
payment-billing-file#true#false#2#lib/crm/billing-method.ts|payment
payment-test#true#false#6#tests/integration/billing-completion.test.ts|payment
route-internal#true#false#2#app/api/internal/expenses/mail-intake/route.ts|route_api
route-mixed#true#false#3#app/api/agent/v1/conversations/route.ts|route_api
session-test-plus-md#true#false#3#automation/db/migrations/146-APPLY-PROD.md|forbidden_surface;tests/integration/session-token-security.test.ts|auth_session_permission
size-s-plain-cjs#false#false#1#
size-s-plain-tsx#false#false#1#
sql-script#true#false#1#automation/db/scripts/2026-09-28_expense_audit_log_revoke_ops_admin.sql|migration
tenant-purge#true#false#3#lib/db/tenant-purge-runner.ts|tenant_rls
tenant-ui#true#false#5#automation/stash-archiv/2026-06_feature-035-bearer-auth.patch|auth_session_permission;components/tenant/MembersPageClient.tsx|forbidden_surface
terraform#true#false#2#infrastructure/terraform/main.tf|deploy_infra;infrastructure/terraform/nat.tf|deploy_infra
vercel-json#true#false#3#tests/unit/vercel-cron-paths.test.ts|deploy_infra;vercel.json|deploy_infra
TABLE
scFiles="$(ls "$SC_CASES"/*.paths | wc -l | tr -d ' ')"
[[ "$scFixtures" -ge 25 ]] && ok "SC1 at least 25 path sets (SC-007): $scFixtures" || bad "SC1 only $scFixtures path sets"
assert_eq "SC1 every fixture file has an expectation row and vice versa" "$scFiles" "$scFixtures"

# ---------- SC2: output shape, category probes, docs boundary, input forms ----------
sc_run "$TOOLS" --paths "$SC_CASES/auth-routes.paths"
assert_json "SC2 shape: version, keys and per-match fields" "$SC_OUT" "[j.version, Object.keys(j).join(','), Object.keys(j.matched[0]).join(',')].join('#')" "1#version,security_surface,docs_only,total,matched#path,category,glob"
assert_json "SC2 shape: the glob that matched is named" "$SC_OUT" "j.matched[0].glob" "**/auth/**"

# One probe path per category (names only; these probes are not part of the SC-007 sets). expected category after '#'.
printf '%s\n' \
  'src/auth/login.ts#forbidden_surface' 'lib/payments/charge.ts#forbidden_surface' 'db/tenants/rules.sql#forbidden_surface' \
  'app/login/page.tsx#auth_session_permission' 'lib/session.ts#auth_session_permission' 'lib/permissions/check.ts#auth_session_permission' \
  'lib/stripe-webhook.ts#payment' 'app/checkout/page.tsx#payment' \
  'lib/tenant-guard.ts#tenant_rls' 'db/policies/orders.sql#tenant_rls' \
  'db/migrate/001_init.rb#migration' 'prisma/schema.prisma#migration' 'scripts/backfill.sql#migration' \
  'app/api/users/route.ts#route_api' 'src/routes/index.js#route_api' \
  'package.json#manifest_lockfile' 'web/yarn.lock#manifest_lockfile' 'go.sum#manifest_lockfile' 'requirements-dev.txt#manifest_lockfile' \
  'config/secrets/prod.json#secrets_env' 'certs/server.pem#secrets_env' 'infra/prod.tfvars#secrets_env' \
  '.github/workflows/release.yml#ci' '.gitlab-ci.yml#ci' '.circleci/config.yml#ci' \
  'Dockerfile#deploy_infra' 'deploy/up.sh#deploy_infra' 'main.tf#deploy_infra' 'docker-compose.prod.yml#deploy_infra' \
  > "$SC_WORK/probes.txt"
while IFS='#' read -r probe cat; do
  printf '%s\n' "$probe" > "$SC_WORK/probe.paths"
  sc_run "$TOOLS" --paths "$SC_WORK/probe.paths"
  # first-match order puts quick's list first, so a probe that the shared list already covers reports forbidden_surface
  assert_json "SC2 probe $probe" "$SC_OUT" "[j.security_surface, j.docs_only, j.matched.map(m=>m.category).join(',')].join('#')" "true#false#$cat"
done < "$SC_WORK/probes.txt"

# docs boundary (FR-016): literal expectations from the spec text (`*.md`, `docs/**`, `LICENSE`)
printf '%s\n' 'LICENSE#true' 'license#true' 'README.md#true' 'a/b/CHANGELOG.MD#true' 'docs/img/logo.png#true' 'docs/x/y.json#true' \
  'LICENSE.txt#false' 'notes.mdx#false' 'src/docs/x.js#false' 'docs/auth/design.md#false' 'docs/deploy.sh#false' 'image.png#false' > "$SC_WORK/docs.txt"
while IFS='#' read -r probe want; do
  printf '%s\n' "$probe" > "$SC_WORK/probe.paths"
  sc_run "$TOOLS" --paths "$SC_WORK/probe.paths"
  assert_json "SC2 docs_only $probe -> $want" "$SC_OUT" "j.docs_only" "$want"
done < "$SC_WORK/docs.txt"

# duplicates collapse, CRLF lists work, order of the input does not matter
sc_run "$TOOLS" --paths "$SC_CASES/docs-only-product.paths"; base_docs="$SC_OUT"
{ cat "$SC_CASES/docs-only-product.paths"; cat "$SC_CASES/docs-only-product.paths"; } > "$SC_WORK/dup.paths"
sc_run "$TOOLS" --paths "$SC_WORK/dup.paths"; assert_eq "SC2 duplicate paths collapse (same bytes)" "$SC_OUT" "$base_docs"
sed 's/$/\r/' "$SC_CASES/docs-only-product.paths" > "$SC_WORK/crlf.paths"
sc_run "$TOOLS" --paths "$SC_WORK/crlf.paths"; assert_eq "SC2 CRLF list gives the same bytes" "$SC_OUT" "$base_docs"
sc_run "$TOOLS" --paths "$SC_CASES/empty.paths"
assert_json "SC2 empty diff: no surface, not docs-only, total 0" "$SC_OUT" "[j.security_surface,j.docs_only,j.total].join('#')" "false#false#0"

# SC3 helper tree: pure functions + consistency with quick eligibility
make_tree
all_paths="$SC_WORK/all.paths"; cat "$SC_CASES"/*.paths > "$all_paths"
cons="$(node -e '
  const fs = require("fs"); const S = require(process.argv[1] + "/_shared/lib/xprov-scope.cjs"); const Q = require(process.argv[1] + "/_shared/lib/quick.cjs");
  const paths = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
  const r = S.classify(paths); const hit = new Set(r.matched.map((m) => m.path));
  const missed = paths.filter((p) => Q.matchesForbiddenSurface(p) && !hit.has(p));
  process.stdout.write(JSON.stringify({ missed, again: JSON.stringify(S.classify(paths)) === JSON.stringify(r), total: paths.length }));
' "$TREE" "$all_paths")"
assert_json "SC2 quick eligibility and scope agree: nothing quick calls surface is missed" "$cons" "j.missed.length + '/' + (j.total > 100)" "0/true"
assert_json "SC2 classify() is pure: same input, same object" "$cons" "j.again" "true"

# ---------- SC3: the shared list is included, not copied (plan D-4) ----------
printf '%s\n' 'zzz-surface/readme.txt' > "$SC_WORK/zzz.paths"
sc_run "$TREE_TOOLS" --paths "$SC_WORK/zzz.paths"
assert_json "SC3 before the edit of quick.cjs: not surface" "$SC_OUT" "j.security_surface" "false"
sc_mutate "$TREE" quick.cjs "  '**/.env.*',
];" "  '**/.env.*',
  '**/zzz-surface/**',
];"
sc_run "$TREE_TOOLS" --paths "$SC_WORK/zzz.paths"
assert_json "SC3 after adding a glob to quick.cjs FORBIDDEN_SURFACE_GLOBS the classification changes (no copy)" "$SC_OUT" "j.security_surface + '#' + j.matched[0].category" "true#forbidden_surface"
grep -q 'zzz-surface' "$REPO_ROOT/_shared/lib/xprov-scope-globs.json" "$REPO_ROOT/_shared/lib/xprov-scope.cjs" && bad "SC3 the live scope files must not name the probe glob" || ok "SC3 live scope files hold no copy of the probe glob"
grep -q '"\*\*/migrations/\*\*"' "$REPO_ROOT/_shared/lib/xprov-scope-globs.json" && bad "SC3 xprov-scope-globs.json copies a glob from FORBIDDEN_SURFACE_GLOBS" || ok "SC3 xprov-scope-globs.json holds no entry copied from FORBIDDEN_SURFACE_GLOBS"
# [mutant R1] RED proof: a literal list inside resolveInclude() ignores the edit above
make_tree
sc_mutate "$TREE" xprov-scope.cjs "return checkGlobList(mod[m[2]], " "return checkGlobList(['**/auth/**'], "
sc_mutate "$TREE" quick.cjs "  '**/.env.*',
];" "  '**/.env.*',
  '**/zzz-surface/**',
];"
sc_run "$TREE_TOOLS" --paths "$SC_WORK/zzz.paths"
assert_json "SC3 [mutant R1: literal list in resolveInclude] the edit no longer changes the result (guard goes red)" "$SC_OUT" "j.security_surface" "false"

# ---------- SC5: docs_only never survives a security path (FR-016) ----------
for n in docs-plus-ci docs-plus-ci-deploy docs-plus-env docs-plus-lockfile migration-md-only; do
  sc_run "$TOOLS" --paths "$SC_CASES/$n.paths"
  assert_json "SC5 $n: docs files present, still docs_only false" "$SC_OUT" "j.docs_only + '#' + j.security_surface" "false#true"
done
# [mutant R3] RED proof: the docs globs checked before the security categories let a security path hide as documentation
printf '%s\n' 'docs/auth/design.md' > "$SC_WORK/docsauth.paths"
sc_run "$TOOLS" --paths "$SC_WORK/docsauth.paths"
assert_json "SC5 docs/auth/design.md is security surface, not docs" "$SC_OUT" "j.security_surface + '#' + j.docs_only" "true#false"
make_tree
sc_mutate "$TREE" xprov-scope.cjs "  for (const c of globs.categories) {
    const glob = firstMatch" "  if (firstMatch(globs.docs, segs) !== null) return { category: null, glob: null, docs: true };
  for (const c of globs.categories) {
    const glob = firstMatch"
sc_run "$TREE_TOOLS" --paths "$SC_WORK/docsauth.paths"
assert_json "SC5 [mutant R3: docs globs before the categories] the same path is docs_only (guard goes red)" "$SC_OUT" "j.security_surface + '#' + j.docs_only" "false#true"

# ---------- SC6: hostile path entries are classified fail-closed or inert, never executed ----------
LONG10K="$(head -c 10000 /dev/zero | tr '\0' a)"
sc_hostile() { # <label> <path-line> <expected 'sec#docs#category-or-none'>
  printf '%s\n' "$2" > "$SC_WORK/hostile.paths"
  sc_run "$TOOLS" --paths "$SC_WORK/hostile.paths"
  assert_rc "SC6 $1 exits 0" 0 "$SC_RC" "$SC_ERR"
  assert_json "SC6 $1" "$SC_OUT" "[j.security_surface, j.docs_only, j.matched.length ? j.matched[0].category : 'none'].join('#')" "$3"
}
sc_hostile "traversal ../../etc/passwd is unclassifiable" '../../etc/passwd' 'true#false#unclassifiable'
sc_hostile "traversal hidden inside docs/ is unclassifiable" 'docs/../.github/workflows/ci.yml' 'true#false#unclassifiable'
sc_hostile "backslash traversal" 'docs\..\auth\x.ts' 'true#false#unclassifiable'
sc_hostile "absolute path" '/etc/shadow' 'true#false#unclassifiable'
sc_hostile "windows drive path" 'C:\Windows\system32\x.md' 'true#false#unclassifiable'
sc_hostile "10 000-char docs path" "docs/$LONG10K.md" 'true#false#unclassifiable'
sc_hostile "injection ; rm -rf /" '; rm -rf /' 'false#false#none'
sc_hostile "injection \$(...) in a docs name" 'docs/$(touch PWNED).md' 'false#true#none'
sc_hostile "injection backticks in a docs name" 'docs/`touch PWNED`.md' 'false#true#none'
sc_hostile "injection <script> in a docs name" 'docs/<script>alert(1)</script>.md' 'false#true#none'
sc_hostile "injection name inside a CI directory" '.github/workflows/$(id).yml' 'true#false#ci'
printf 'docs/a\0b.md\n' > "$SC_WORK/nul.paths"
sc_run "$TOOLS" --paths "$SC_WORK/nul.paths"
assert_json "SC6 NUL byte in a path is unclassifiable" "$SC_OUT" "j.security_surface + '#' + j.matched[0].category" "true#unclassifiable"
printf '%s\n' "src/$LONG10K/auth/x.ts" > "$SC_WORK/long-surface.paths"
sc_run "$TOOLS" --paths "$SC_WORK/long-surface.paths"
assert_json "SC6 the echoed path is clipped (a 10 000-char name is not repeated whole)" "$SC_OUT" "j.matched[0].path.length <= 300 && j.matched[0].path.length > 100" "true"
assert_eq "SC6 no hostile name created a file (cwd stayed empty)" "$(ls -A "$SC_CWD" | wc -l | tr -d ' ')" "0"
assert_eq "SC6 no hostile name created PWNED in the work dir" "$(ls "$SC_WORK" | grep -c PWNED || true)" "0"
# [mutants] RED proofs
for m in R2 R4 R6 R7; do
  make_tree
  case "$m" in
    R2) sc_mutate "$TREE" xprov-scope.cjs "segs.includes('..')" "false"; line='../../etc/passwd'; want='false' ;;
    R4) sc_mutate "$TREE" xprov-scope.cjs "return segs.map((s) => s.toLowerCase());" "return segs;"; line='SRC/AUTH/Login.ts'; want='false' ;;
    R6) sc_mutate "$TREE" xprov-scope.cjs "raw.length > MAX_PATH_CHARS ||" ""; line="docs/$LONG10K.md"; want='false' ;;
    R7) sc_mutate "$TREE" xprov-scope.cjs " || raw.includes('\\0')" ""; line=''; want='false' ;;
  esac
  if [[ "$m" == R7 ]]; then printf 'docs/a\0b.md\n' > "$SC_WORK/mut.paths"; else printf '%s\n' "$line" > "$SC_WORK/mut.paths"; fi
  sc_run "$TREE_TOOLS" --paths "$SC_WORK/mut.paths"
  assert_json "SC6 [mutant $m] the guarded input now slips through as security_surface=$want (guard goes red)" "$SC_OUT" "j.security_surface" "$want"
done
printf '%s\n' 'SRC/AUTH/Login.ts' > "$SC_WORK/upper.paths"
sc_run "$TOOLS" --paths "$SC_WORK/upper.paths"
assert_json "SC6 upper-case path is matched (case-insensitive file systems)" "$SC_OUT" "j.security_surface" "true"

# ---------- SC7: input order does not change the bytes ----------
tac "$SC_CASES/auth-routes.paths" > "$SC_WORK/rev.paths" 2>/dev/null || awk '{a[NR]=$0} END{for(i=NR;i>0;i--)print a[i]}' "$SC_CASES/auth-routes.paths" > "$SC_WORK/rev.paths"
sc_run "$TOOLS" --paths "$SC_CASES/auth-routes.paths"; fwd="$SC_OUT"
sc_run "$TOOLS" --paths "$SC_WORK/rev.paths"
assert_eq "SC7 reversed input gives the same bytes" "$SC_OUT" "$fwd"
make_tree
sc_mutate "$TREE" xprov-scope.cjs "matched.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));" ""
sc_run "$TREE_TOOLS" --paths "$SC_WORK/rev.paths"
[[ "$SC_OUT" != "$fwd" ]] && ok "SC7 [mutant R5: sort dropped] reversed input changes the bytes (guard goes red)" || bad "SC7 [mutant R5] the sort removal did not change the output"

# ---------- SC8/SC9: --base / --head over a real git range ----------
SC_REPO="$(mktemp -d)"
(
  cd "$SC_REPO" && git init -q && git config user.name fixture && git config user.email fixture@example.invalid && git config commit.gpgsign false
  mkdir -p src docs auth lib
  echo one > src/a.js; echo one > docs/readme.md
  printf 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\nexport const e = 5;\n' > auth/old.ts
  git add -A && git commit -qm c1
  echo two >> src/a.js; echo two >> docs/readme.md
  mkdir -p .github/workflows && echo 'on: push' > .github/workflows/ci.yml
  git mv auth/old.ts lib/old.ts
  git add -A && git commit -qm c2
  echo three >> docs/readme.md; echo x > 'docs/space name.md'; printf 'x\n' > "$(printf 'docs/new\nline.md')"
  git add -A && git commit -qm c3
)
SC_C1="$(git -C "$SC_REPO" rev-parse HEAD~2)"; SC_C2="$(git -C "$SC_REPO" rev-parse HEAD~1)"
sc_run "$TOOLS" --repo "$SC_REPO" --base "$SC_C1" --head "$SC_C2"
assert_rc "SC8 range c1..c2" 0 "$SC_RC" "$SC_ERR"
assert_json "SC8 range: CI file and the file renamed OUT of auth/ are both seen" "$SC_OUT" "[j.security_surface, j.total, j.matched.map(m=>m.path+'|'+m.category).join(';')].join('#')" "true#5#.github/workflows/ci.yml|ci;auth/old.ts|forbidden_surface"
sc_run "$TOOLS" --repo "$SC_REPO" --base "$SC_C2" --head HEAD
assert_json "SC8 c2..HEAD: docs only, odd names (space, newline) counted once each" "$SC_OUT" "[j.security_surface, j.docs_only, j.total].join('#')" "false#true#3"
sc_run "$TOOLS" --repo "$SC_REPO" --base "$SC_C2"
assert_json "SC8 --head defaults to HEAD" "$SC_OUT" "j.total" "3"
sc_run "$TOOLS" --repo "$SC_REPO" --base "${SC_C2:0:7}" --head "${SC_C1:0:7}"
assert_rc "SC8 abbreviated shas, reversed range" 0 "$SC_RC" "$SC_ERR"
(cd "$SC_REPO" && env -u A1_VAULT_ROOT node "$TOOLS" xprov scope --base "$SC_C1" --head "$SC_C2" >"$SC_WORK/cwd-repo.json" 2>/dev/null); assert_eq "SC8 default repo is the current checkout" "$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).total' "$SC_WORK/cwd-repo.json")" "5"
make_tree
sc_mutate "$TREE" xprov-scope.cjs "'--no-renames', " ""
sc_run "$TREE_TOOLS" --repo "$SC_REPO" --base "$SC_C1" --head "$SC_C2"
assert_json "SC8 [mutant R9: --no-renames dropped] the rename out of auth/ is no longer seen (guard goes red)" "$SC_OUT" "j.matched.map(m=>m.path).join(';')" ".github/workflows/ci.yml"
make_tree
sc_mutate "$TREE" xprov-scope.cjs "'--name-only', '-z', " "'--name-only', "
sc_run "$TREE_TOOLS" --repo "$SC_REPO" --base "$SC_C2" --head HEAD
assert_json "SC8 [mutant: -z dropped] the odd names are no longer counted one by one (guard goes red)" "$SC_OUT" "j.total === 3" "false"

# SC9: revision values are data, never options or shell
for rev in 'HEAD; touch PWNED' '$(touch PWNED)' '`touch PWNED`' '--output=PWNED' '-p' 'HEAD~1' 'main' '' "$LONG10K" '../x'; do
  sc_run "$TOOLS" --repo "$SC_REPO" --base "$rev" --head HEAD
  assert_rc "SC9 --base $(printf '%s' "$rev" | cut -c1-30 | tr '\n' ' ') is refused" 2 "$SC_RC" "$SC_ERR"
  [[ -z "$SC_OUT" ]] && ok "SC9 refused revision prints nothing on stdout" || bad "SC9 stdout for a refused revision: $SC_OUT"
  [[ ${#SC_ERR} -lt 600 ]] && ok "SC9 stderr stays bounded (${#SC_ERR} chars)" || bad "SC9 stderr grew to ${#SC_ERR} chars"
done
sc_run "$TOOLS" --repo "$SC_REPO" --base "$SC_C1" --head '--output=PWNED'
assert_rc "SC9 --head option-shaped is refused" 2 "$SC_RC" "$SC_ERR"
sc_run "$TOOLS" --repo "$SC_REPO" --base deadbeef --head HEAD
assert_rc "SC9 a well-formed but unknown sha fails closed (exit 2, git error)" 2 "$SC_RC" "$SC_ERR"
sc_run "$TOOLS" --repo "$SC_REPO/.." --base "$SC_C1"
assert_rc "SC9 --repo that is not the toplevel (traversal) is refused" 2 "$SC_RC" "$SC_ERR"
sc_run "$TOOLS" --repo /etc --base "$SC_C1"
assert_rc "SC9 --repo outside any repository is refused" 2 "$SC_RC" "$SC_ERR"
assert_eq "SC9 no PWNED file in the repo, cwd or work dir" "$(ls -A "$SC_REPO" "$SC_CWD" "$SC_WORK" | grep -c PWNED || true)" "0"
make_tree
sc_mutate "$TREE" xprov-scope.cjs 'const REV_RE = /^(?:[0-9a-fA-F]{4,64}|HEAD)$/;' 'const REV_RE = /^.*$/;'
sc_run "$TREE_TOOLS" --repo "$SC_REPO" --base "--output=$SC_WORK/PWN-MUTANT" --head HEAD
[[ -e "$SC_WORK/PWN-MUTANT" ]] && ok "SC9 [mutant R8: REV_RE accepts anything] git writes the attacker-named file (guard goes red)" || bad "SC9 [mutant R8] the option reached git but wrote nothing"
rm -f "$SC_WORK/PWN-MUTANT"

# ---------- SC10: usage errors, input limits, a damaged glob file ----------
echo x > "$SC_WORK/real.paths"; ln -s "$SC_WORK/real.paths" "$SC_WORK/link.paths"; mkdir -p "$SC_WORK/adir"
sc_usage() { # <label> <args...>
  local label="$1"; shift
  sc_run "$TOOLS" "$@"
  assert_rc "SC10 $label" 2 "$SC_RC" "$SC_ERR"
  [[ -z "$SC_OUT" ]] && ok "SC10 $label: stdout empty" || bad "SC10 $label: stdout was $SC_OUT"
}
sc_usage "no arguments"
sc_usage "--paths and --base together" --paths "$SC_WORK/real.paths" --base "$SC_C1"
sc_usage "--head alone" --head HEAD
sc_usage "--paths without a value" --paths
sc_usage "--paths with an extra argument" --paths "$SC_WORK/real.paths" extra
sc_usage "--paths with --repo" --paths "$SC_WORK/real.paths" --repo "$SC_REPO"
sc_usage "--help is not an escape hatch" --help
sc_usage "--paths names a missing file" --paths "$SC_WORK/missing.paths"
sc_usage "--paths names a directory" --paths "$SC_WORK/adir"
sc_usage "--paths names a symlink (O_NOFOLLOW)" --paths "$SC_WORK/link.paths"
sc_usage "--paths empty value" --paths ''
sc_usage "--paths traversal to a missing file" --paths "$SC_WORK/adir/../../../../nonexistent-$$.paths"
sc_usage "--paths 10 000-char value" --paths "$LONG10K"
head -c 17000000 /dev/zero | tr '\0' a > "$SC_WORK/huge.paths"
sc_usage "--paths file over 16 MiB" --paths "$SC_WORK/huge.paths"
awk 'BEGIN{for(i=0;i<200001;i++)print "f" i ".txt"}' > "$SC_WORK/many.paths"
sc_usage "--paths with 200 001 entries" --paths "$SC_WORK/many.paths"
for m in R11 R12; do
  make_tree
  case "$m" in
    R11) sc_mutate "$TREE" xprov-scope.cjs "MAX_PATHS_FILE_BYTES = 16 * 1024 * 1024" "MAX_PATHS_FILE_BYTES = 1024 * 1024 * 1024"; f=huge ;;
    R12) sc_mutate "$TREE" xprov-scope.cjs "const MAX_PATHS = 200000;" "const MAX_PATHS = 2000000;"; f=many ;;
  esac
  sc_run "$TREE_TOOLS" --paths "$SC_WORK/$f.paths"
  assert_rc "SC10 [mutant $m: limit raised] the oversized input is accepted (guard goes red)" 0 "$SC_RC" "$SC_ERR"
done
# damaged or hostile glob file: exit 2, nothing on stdout, never "no surface"
globs_case() { # <label> <node-js editing the parsed glob object g, or RAW:text>
  make_tree
  node -e '
    const fs = require("fs"); const f = process.argv[1] + "/_shared/lib/xprov-scope-globs.json"; const how = process.argv[2];
    if (how.startsWith("RAW:")) { fs.writeFileSync(f, how.slice(4)); process.exit(0); }
    const g = JSON.parse(fs.readFileSync(f, "utf8")); (new Function("g", how))(g); fs.writeFileSync(f, JSON.stringify(g));
  ' "$TREE" "$2"
  sc_run "$TREE_TOOLS" --paths "$SC_CASES/auth-routes.paths"
  assert_rc "SC10 glob file: $1" 2 "$SC_RC" "$SC_ERR"
  [[ -z "$SC_OUT" ]] && ok "SC10 glob file: $1: stdout empty" || bad "SC10 glob file: $1: stdout was $SC_OUT"
}
globs_case "not JSON" 'RAW:{not json'
globs_case "wrong version" 'g.version = 2'
globs_case "include names a module outside the allow list" 'g.include = "child_process.cjs#FORBIDDEN_SURFACE_GLOBS"'
globs_case "include names a path" 'g.include = "../quick.cjs#FORBIDDEN_SURFACE_GLOBS"'
globs_case "include names a missing export" 'g.include = "quick.cjs#NO_SUCH_LIST"'
globs_case "a category holds an empty list" 'g.categories.payment = []'
globs_case "a glob escapes with .." 'g.categories.payment = ["../../etc/**"]'
globs_case "docs list missing" 'delete g.docs'

# ---------- SC11: facade and help ----------
help="$(node "$TOOLS" --help 2>&1)"
grep -q 'scope --paths <file>' <<<"$help" && ok "SC11 --help documents xprov scope" || bad "SC11 --help does not document xprov scope"
grep -q 'not implemented yet' <<<"$(sed -n '/scope --paths/,/dispose/p' <<<"$help")" && bad "SC11 the scope help still says not implemented" || ok "SC11 the scope help no longer carries the stub text"
assert_eq "SC11 module stays under 400 lines" "$([[ $(wc -l < "$REPO_ROOT/_shared/lib/xprov-scope.cjs") -lt 400 ]] && echo yes || echo no)" "yes"

rm -rf "$SC_CWD" "$SC_ERRF" "$SC_WORK" "$SC_REPO"
