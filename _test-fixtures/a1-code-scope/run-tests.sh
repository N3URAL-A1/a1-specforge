#!/usr/bin/env bash
# Scenario suite for `a1-tools code-scope` (path-list reservation claims,
# deterministic prefix/glob overlap gate). Mirrors the a1-reservations
# harness style (mktemp workdir, assert_rc, node invocations).
# Scenarios:
#   non-overlap claim                -> 0
#   prefix overlap (dir vs file)     -> 1, names holder feature
#   glob overlap                     -> 1, names holder feature
#   idempotent re-claim              -> 0
#   check (dry-run) does not write   -> 0/1, file untouched
#   works in a non-git tmp dir       -> 0 (no git assumptions anywhere)
set -u
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

pass=0
fail=0

# Use a tmp dir explicitly OUTSIDE any git repo to prove determinism (no git
# reads anywhere in the code-scope path).
mk_workdir WORK "a1-code-scope-test"
FILE="$WORK/reservations.json"
# spec 017: a gate call logs into the git work tree of its cwd; gate calls that need `--phase` run in this throwaway repo
GATE_CWD="$WORK/gate-cwd"; mkdir -p "$GATE_CWD" && git -C "$GATE_CWD" init -q || exit 1

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

# --- confirm non-git tmp dir (determinism precondition) ---
if [[ -d "$WORK/.git" ]]; then
  echo "FAIL  precondition: tmp workdir unexpectedly has .git"; fail=$((fail + 1))
else
  echo "PASS  precondition (non-git tmp dir)"; pass=$((pass + 1))
fi

# --- claim feature-a: src/billing/,docs/billing.md -> 0 (non-overlapping) ---
OUT="$(node "$TOOLS" code-scope claim --by feature-a --scope "src/billing/,docs/billing.md" --file "$FILE" 2>&1)"
assert_rc "claim-non-overlap" 0 $? "$OUT"

# --- claim feature-b: src/auth/ -> 0 (distinct from feature-a's scope) ---
OUT="$(node "$TOOLS" code-scope claim --by feature-b --scope "src/auth/" --file "$FILE" 2>&1)"
assert_rc "claim-second-feature" 0 $? "$OUT"

# --- prefix overlap: feature-c claims src/auth/login.ts, held by feature-b's src/auth/ -> 1 ---
OUT="$(node "$TOOLS" code-scope claim --by feature-c --scope "src/auth/login.ts" --file "$FILE" 2>&1)"
RC=$?
assert_rc "prefix-overlap" 1 "$RC" "$OUT"
if ! grep -q "feature-b" <<<"$OUT"; then
  echo "FAIL  prefix-overlap: holder feature-b not named"; fail=$((fail + 1))
else
  echo "PASS  prefix-overlap names holder feature-b"; pass=$((pass + 1))
fi

# --- glob overlap: feature-d claims src/billing/** overlapping feature-a's src/billing/ -> 1 ---
OUT="$(node "$TOOLS" code-scope claim --by feature-d --scope "src/billing/**" --file "$FILE" 2>&1)"
RC=$?
assert_rc "glob-overlap" 1 "$RC" "$OUT"
if ! grep -q "feature-a" <<<"$OUT"; then
  echo "FAIL  glob-overlap: holder feature-a not named"; fail=$((fail + 1))
else
  echo "PASS  glob-overlap names holder feature-a"; pass=$((pass + 1))
fi

# --- glob overlap (reverse direction): a fresh feature-e declares a glob that
#     a plain concrete path (feature-b's src/auth/) falls under -> 1 ---
OUT="$(node "$TOOLS" code-scope claim --by feature-e --scope "src/**" --file "$FILE" 2>&1)"
RC=$?
assert_rc "glob-overlap-reverse" 1 "$RC" "$OUT"

# --- glob-vs-ancestor-dir: a plain concrete dir (feature-anc: src/foo) must
#     CONFLICT with a later glob rooted above it (feature-glob-anc: src/**/util.js) ---
OUT="$(node "$TOOLS" code-scope claim --by feature-anc --scope "src/foo" --file "$FILE" 2>&1)"
assert_rc "glob-ancestor-setup" 0 $? "$OUT"
OUT="$(node "$TOOLS" code-scope claim --by feature-glob-anc --scope "src/**/util.js" --file "$FILE" 2>&1)"
RC=$?
assert_rc "glob-vs-ancestor-dir" 1 "$RC" "$OUT"
if ! grep -q "feature-anc" <<<"$OUT"; then
  echo "FAIL  glob-vs-ancestor-dir: holder feature-anc not named"; fail=$((fail + 1))
else
  echo "PASS  glob-vs-ancestor-dir names holder feature-anc"; pass=$((pass + 1))
fi

# --- single-star-vs-deep-file: feature-star declares src/* (single wildcard
#     segment); a deep file src/a/b.js under a different feature's scope must
#     still CONFLICT (glob's fixed prefix `src` contains the file) ---
OUT="$(node "$TOOLS" code-scope claim --by feature-deep --scope "src/a/b.js" --file "$FILE" 2>&1)"
assert_rc "star-vs-deep-file-setup" 0 $? "$OUT"
OUT="$(node "$TOOLS" code-scope claim --by feature-star --scope "src/*" --file "$FILE" 2>&1)"
RC=$?
assert_rc "star-vs-deep-file" 1 "$RC" "$OUT"
if ! grep -q "feature-deep" <<<"$OUT"; then
  echo "FAIL  star-vs-deep-file: holder feature-deep not named"; fail=$((fail + 1))
else
  echo "PASS  star-vs-deep-file names holder feature-deep"; pass=$((pass + 1))
fi

# --- leading-glob no-overmatch: a leading-glob pattern (**/util.js, *, */util.js)
#     must NOT conflict with a genuinely unrelated path (docs/readme.md), in
#     either claim direction. Regression for the empty-nonGlobPrefix bug where
#     isSegmentPrefix([], x) is trivially true and flips every non-match into
#     a spurious CONFLICT. ---
# Review round 3: feature-a holds the directory src/billing/, which may contain
# a util.js, so "**/util.js" overlaps it (directory capability belongs to the
# other side). It must still not conflict with the file docs/readme.md.
OUT="$(node "$TOOLS" code-scope claim --by feature-globdoubledstar --scope "**/util.js" --file "$FILE" 2>&1)"
RC=$?
assert_rc "leading-doublestar-vs-directory-scope" 1 "$RC" "$OUT"
if ! grep -q "feature-a" <<<"$OUT"; then
  echo "FAIL  leading-doublestar-vs-directory-scope: holder feature-a not named"; fail=$((fail + 1))
fi
OUT="$(node "$TOOLS" code-scope claim --by feature-globdoubledstar --scope "**/util.js" --file "$WORK/dstar-only.json" 2>&1)"
assert_rc "leading-doublestar-setup" 0 $? "$OUT"
OUT="$(node "$TOOLS" code-scope claim --by feature-docs-readme0 --scope "docs/readme.md" --file "$WORK/dstar-only.json" 2>&1)"
assert_rc "leading-doublestar-vs-file-unrelated" 0 $? "$OUT"
OUT="$(node "$TOOLS" code-scope claim --by feature-docs-readme --scope "docs/readme.md" --file "$FILE" 2>&1)"
assert_rc "unrelated-vs-leading-doublestar" 0 $? "$OUT"

# Review round 1: bare "*" truly shares top-level util.js with the recorded "**/util.js"
# (the old literal-segment matcher missed that overlap). Release it so this block keeps
# testing what it names: "*" vs unrelated deeper paths.
OUT="$(node "$TOOLS" code-scope release --by feature-globdoubledstar --file "$FILE" 2>&1)"
assert_rc "release-doublestar-before-star" 0 $? "$OUT"
OUT="$(node "$TOOLS" code-scope claim --by feature-globstar-only --scope "*" --file "$FILE" 2>&1)"
assert_rc "leading-star-vs-unrelated-setup" 0 $? "$OUT"
OUT="$(node "$TOOLS" code-scope claim --by feature-docs-readme2 --scope "docs/readme2.md" --file "$FILE" 2>&1)"
# NOTE: bare "*" matches any single top-level segment via segmentsMatchGlob,
# so "*" legitimately conflicts with any single-segment path — but docs/readme2.md
# has two segments, so it must NOT conflict.
assert_rc "leading-star-vs-unrelated" 0 $? "$OUT"

OUT="$(node "$TOOLS" code-scope claim --by feature-star-util --scope "*/utilw.js" --file "$FILE" 2>&1)"
assert_rc "leading-star-slash-util-vs-unrelated-setup" 0 $? "$OUT"
OUT="$(node "$TOOLS" code-scope claim --by feature-docs-readme3 --scope "docs/readme3.md" --file "$FILE" 2>&1)"
assert_rc "leading-star-slash-util-vs-unrelated" 0 $? "$OUT"

# --- guard: leading-glob patterns must still CONFLICT when they genuinely
#     match (do not regress true positives while fixing the false positive) ---
OUT="$(node "$TOOLS" code-scope claim --by feature-guard-anything --scope "**" --file "$FILE" 2>&1)"
RC=$?
assert_rc "guard-doublestar-bare-matches-everything" 1 "$RC" "$OUT"

GUARD_FILE="$WORK/guard-reservations.json"
OUT="$(node "$TOOLS" code-scope claim --by feature-guard-deep-util --scope "zzz/a/util.js" --file "$GUARD_FILE" 2>&1)"
assert_rc "guard-deep-util-setup" 0 $? "$OUT"
OUT="$(node "$TOOLS" code-scope claim --by feature-guard-globstar-util --scope "**/util.js" --file "$GUARD_FILE" 2>&1)"
RC=$?
assert_rc "guard-doublestar-util-matches-deep-file" 1 "$RC" "$OUT"

# --- idempotent re-claim: feature-a re-claims identical scope -> 0 ---
OUT="$(node "$TOOLS" code-scope claim --by feature-a --scope "src/billing/,docs/billing.md" --file "$FILE" 2>&1)"
assert_rc "idempotent-reclaim" 0 $? "$OUT"
if ! grep -q '"idempotent": true' <<<"$OUT"; then
  echo "FAIL  idempotent-reclaim: expected idempotent:true in output"; fail=$((fail + 1))
else
  echo "PASS  idempotent-reclaim flagged idempotent:true"; pass=$((pass + 1))
fi

# --- dry-run check: does not write, still reports conflict for overlapping scope ---
BEFORE_HASH="$(shasum "$FILE" | awk '{print $1}')"
OUT="$(node "$TOOLS" code-scope check --by feature-z --scope "src/auth/login.ts" --file "$FILE" 2>&1)"
RC=$?
assert_rc "check-dry-run-conflict" 1 "$RC" "$OUT"
AFTER_HASH="$(shasum "$FILE" | awk '{print $1}')"
if [[ "$BEFORE_HASH" != "$AFTER_HASH" ]]; then
  echo "FAIL  check-dry-run: file was modified by a dry-run check"; fail=$((fail + 1))
else
  echo "PASS  check-dry-run (file untouched)"; pass=$((pass + 1))
fi

# --- dry-run check: non-overlapping scope -> 0, still no write ---
OUT="$(node "$TOOLS" code-scope check --by feature-z --scope "packages/unrelated/" --file "$FILE" 2>&1)"
assert_rc "check-dry-run-ok" 0 $? "$OUT"
AFTER2_HASH="$(shasum "$FILE" | awk '{print $1}')"
if [[ "$BEFORE_HASH" != "$AFTER2_HASH" ]]; then
  echo "FAIL  check-dry-run-ok: file was modified by a dry-run check"; fail=$((fail + 1))
else
  echo "PASS  check-dry-run-ok (file untouched)"; pass=$((pass + 1))
fi

# --- Wave 2: stage lifecycle ---

# --- stage advance persists + visible in list ---
OUT="$(node "$TOOLS" code-scope stage --by feature-a --set review --file "$FILE" 2>&1)"
assert_rc "stage-advance" 0 $? "$OUT"
if ! grep -q '"stage": "review"' <<<"$OUT"; then
  echo "FAIL  stage-advance: expected stage:review in output"; fail=$((fail + 1))
else
  echo "PASS  stage-advance reflects new stage in output"; pass=$((pass + 1))
fi

LIST_OUT="$(node "$TOOLS" code-scope list --file "$FILE" 2>&1)"
if ! grep -q '"stage": "review"' <<<"$LIST_OUT"; then
  echo "FAIL  stage-advance: stage:review not visible in --list output"; fail=$((fail + 1))
else
  echo "PASS  stage-advance visible in list output"; pass=$((pass + 1))
fi

# --- invalid stage -> 1 ---
OUT="$(node "$TOOLS" code-scope stage --by feature-a --set bogus-stage --file "$FILE" 2>&1)"
assert_rc "stage-invalid" 1 $? "$OUT"

# --- unknown feature id -> 1 ---
OUT="$(node "$TOOLS" code-scope stage --by feature-does-not-exist --set review --file "$FILE" 2>&1)"
assert_rc "stage-unknown-feature" 1 $? "$OUT"

# --- monotonic stage ordering: backward transition -> 1 ---
# feature-a is currently at "review" (set earlier in this run). Going back to
# "started" must be rejected.
OUT="$(node "$TOOLS" code-scope stage --by feature-a --set started --file "$FILE" 2>&1)"
assert_rc "stage-backward-rejected" 1 $? "$OUT"

# --- monotonic stage ordering: forward skip is allowed, reports "skipped" ---
# feature-a is at "review"; jump straight to "done", skipping verify, merge,
# origin-cleanup.
OUT="$(node "$TOOLS" code-scope stage --by feature-a --set done --file "$FILE" 2>&1)"
assert_rc "stage-forward-skip" 0 $? "$OUT"
if echo "$OUT" | node -e '
  const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const expected = ["verify", "merge", "origin-cleanup"];
  const got = data.skipped || [];
  if (JSON.stringify(got) !== JSON.stringify(expected)) process.exit(1);
'; then
  echo "PASS  stage-forward-skip: skipped:[verify,merge,origin-cleanup] reported"; pass=$((pass + 1))
else
  echo "FAIL  stage-forward-skip: expected skipped list not present/correct"; echo "----- output -----"; echo "$OUT"; echo "------------------"; fail=$((fail + 1))
fi

# --- end-to-end auto-unblock: claim A -> claim B blocked -> release A -> claim B succeeds ---
E2E_FILE="$WORK/e2e-reservations.json"
OUT="$(node "$TOOLS" code-scope claim --by feature-x --scope "src/payments/" --file "$E2E_FILE" 2>&1)"
assert_rc "e2e-claim-a" 0 $? "$OUT"

OUT="$(node "$TOOLS" code-scope claim --by feature-y --scope "src/payments/checkout.ts" --file "$E2E_FILE" 2>&1)"
assert_rc "e2e-claim-b-blocked" 1 $? "$OUT"

OUT="$(node "$TOOLS" code-scope release --by feature-x --file "$E2E_FILE" 2>&1)"
assert_rc "e2e-release-a" 0 $? "$OUT"
if ! grep -q '"released": true' <<<"$OUT"; then
  echo "FAIL  e2e-release-a: expected released:true in output"; fail=$((fail + 1))
else
  echo "PASS  e2e-release-a flagged released:true"; pass=$((pass + 1))
fi

OUT="$(node "$TOOLS" code-scope claim --by feature-y --scope "src/payments/checkout.ts" --file "$E2E_FILE" 2>&1)"
assert_rc "e2e-claim-b-succeeds-after-release" 0 $? "$OUT"

# --- release idempotent: releasing a non-existent entry -> 0, released:false ---
OUT="$(node "$TOOLS" code-scope release --by feature-never-claimed --file "$E2E_FILE" 2>&1)"
assert_rc "release-idempotent" 0 $? "$OUT"
if ! grep -q '"released": false' <<<"$OUT"; then
  echo "FAIL  release-idempotent: expected released:false in output"; fail=$((fail + 1))
else
  echo "PASS  release-idempotent flagged released:false"; pass=$((pass + 1))
fi

# --- Wave 4: documented done-gate CLI sequence (started -> ... -> done -> release) ---
# Mirrors the lifecycle-completion-gate sequence documented in
# skills/a1-new-feature/SKILL.md: claim -> stage complete -> review -> verify ->
# merge -> origin-cleanup -> release (spec update-status to 'done' happens outside
# this CLI). Asserts each stage advance persists and is visible via --list, and
# that release at the end frees the scope (idempotent-release semantics already
# covered above; this proves the FULL documented stage progression, not just one hop).
GATE_FILE="$WORK/done-gate-reservations.json"

OUT="$(node "$TOOLS" code-scope claim --by feature-gate --scope "src/gate-demo/" --file "$GATE_FILE" 2>&1)"
assert_rc "done-gate-claim" 0 $? "$OUT"
if ! grep -q '"stage": "started"' <<<"$OUT"; then
  echo "FAIL  done-gate-claim: expected initial stage:started"; fail=$((fail + 1))
else
  echo "PASS  done-gate-claim starts at stage:started"; pass=$((pass + 1))
fi

for STAGE in complete review verify merge origin-cleanup done; do
  OUT="$(node "$TOOLS" code-scope stage --by feature-gate --set "$STAGE" --file "$GATE_FILE" 2>&1)"
  assert_rc "done-gate-stage-$STAGE" 0 $? "$OUT"
  if ! grep -q "\"stage\": \"$STAGE\"" <<<"$OUT"; then
    echo "FAIL  done-gate-stage-$STAGE: expected stage:$STAGE in output"; fail=$((fail + 1))
  else
    echo "PASS  done-gate-stage-$STAGE reflects new stage"; pass=$((pass + 1))
  fi
  LIST_OUT="$(node "$TOOLS" code-scope list --file "$GATE_FILE" 2>&1)"
  if ! grep -q "\"stage\": \"$STAGE\"" <<<"$LIST_OUT"; then
    echo "FAIL  done-gate-stage-$STAGE: not visible in --list output"; fail=$((fail + 1))
  else
    echo "PASS  done-gate-stage-$STAGE visible in list output (progression tracked)"; pass=$((pass + 1))
  fi
done

# --- final Done transition: release frees the scope entirely ---
OUT="$(node "$TOOLS" code-scope release --by feature-gate --file "$GATE_FILE" 2>&1)"
assert_rc "done-gate-release" 0 $? "$OUT"
if ! grep -q '"released": true' <<<"$OUT"; then
  echo "FAIL  done-gate-release: expected released:true in output"; fail=$((fail + 1))
else
  echo "PASS  done-gate-release flagged released:true (scope freed at Done)"; pass=$((pass + 1))
fi

LIST_AFTER="$(node "$TOOLS" code-scope list --file "$GATE_FILE" 2>&1)"
if grep -q "feature-gate" <<<"$LIST_AFTER"; then
  echo "FAIL  done-gate-release: feature-gate still present in --list after release"; fail=$((fail + 1))
else
  echo "PASS  done-gate-release: feature-gate absent from --list after release"; pass=$((pass + 1))
fi

# --- scope reclaimable by a different feature after Done+release ---
OUT="$(node "$TOOLS" code-scope claim --by feature-gate-2 --scope "src/gate-demo/" --file "$GATE_FILE" 2>&1)"
assert_rc "done-gate-scope-reclaimable-after-done" 0 $? "$OUT"

# --- Wave 5: list --stale-days flag ---
STALE_FILE="$WORK/stale-reservations.json"
cat > "$STALE_FILE" <<JSON
{
  "reservations": [
    {"type": "code_scope", "by": "feature-old", "paths": ["src/old/"], "stage": "started", "at": "2020-01-01T00:00:00.000Z"},
    {"type": "code_scope", "by": "feature-fresh", "paths": ["src/fresh/"], "stage": "started", "at": "$(node -e 'console.log(new Date().toISOString())')"}
  ]
}
JSON

OUT="$(node "$TOOLS" code-scope list --file "$STALE_FILE" --stale-days 7 2>&1)"
assert_rc "stale-days-list" 0 $? "$OUT"

# feature-old must be flagged stale:true with a release hint
if echo "$OUT" | node -e '
  const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const old = data.reservations.find((r) => r.by === "feature-old");
  const fresh = data.reservations.find((r) => r.by === "feature-fresh");
  if (!old || old.stale !== true) process.exit(1);
  if (!old.hint || !old.hint.includes("feature-old")) process.exit(1);
  if (!fresh || fresh.stale !== false) process.exit(1);
  if (fresh.hint !== undefined) process.exit(1);
'; then
  echo "PASS  stale-days: old entry stale:true with hint, fresh entry stale:false without hint"; pass=$((pass + 1))
else
  echo "FAIL  stale-days: stale/hint fields not as expected"; echo "----- output -----"; echo "$OUT"; echo "------------------"; fail=$((fail + 1))
fi

# --- list without --stale-days omits stale/hint entirely (backward compatible) ---
OUT="$(node "$TOOLS" code-scope list --file "$STALE_FILE" 2>&1)"
assert_rc "list-no-stale-days" 0 $? "$OUT"
if grep -q '"stale"' <<<"$OUT"; then
  echo "FAIL  list-no-stale-days: stale field present without --stale-days"; fail=$((fail + 1))
else
  echo "PASS  list-no-stale-days: no stale field without flag"; pass=$((pass + 1))
fi

# --- in-segment globs in scopePathsOverlap (bug 2026-10-14-quick-gate-env-sentences) ---
OVL_RC=0
OVL_OUT="$(node -e '
  const { scopePathsOverlap } = require(process.argv[1]);
  const T = [["src/*.ts","src/a.ts"], ["src/a.ts","src/*.ts"], ["**/*.md","docs/x.md"],
             ["docs/adr-*.md","docs/adr-1.md"], ["src/*.ts","src/**"], ["docs/ADR-*.md","docs/adr-1.md"],
             ["src/*.ts","src"], ["src/*","src/a/b.js"], ["docs/ADR.md","docs/adr.md"], ["dir/*.ts","dir/a-*.ts"],
             ["./","src/a.ts"], ["/","x"], ["src/a.ts","./"],
             ["**/fixtures","src/fixtures/a.json"], ["**/a","a/src"],
             ["*","src/**"], ["*/a","src/?/**"], ["src/**/**","*"], ["*","**/util.js"],
             ["src/billing/","**/util.js"], ["apps/web","**/*.tsx"], ["*.md/a","*.md/**/b"],
             ["**/*.md","docs"], ["docs/v1.2/","**/x.md"],
             ["src/.","src/x.ts"], ["./src/./","src/x.ts"], [".env/.",".env"], ["src//x.ts","src/./x.ts"]];
  const F = [["src/*.ts","lib/a.js"], ["**/*.md","docs/x.txt"], ["docs/adr-*.md","other/rfc-1.md"],
             ["src/*.ts","lib/a.ts"], ["src/*.ts","src/a.js"], ["src/*.ts","src/sub/a.ts"],
             ["dir/x-*.ts","dir/y-*.ts"], ["**/util.js","docs/readme.md"],
             ["**/*.md","docs.txt"], ["docs/v1.2","**/x.md"]]; // last row pins the remaining limit: a file-like last segment without a trailing slash is a file
  let bad = 0;
  for (const [a,b] of T) if (scopePathsOverlap(a,b) !== true) { console.log("expected overlap: " + a + " vs " + b); bad++; }
  for (const [a,b] of F) if (scopePathsOverlap(a,b) !== false) { console.log("expected NO overlap: " + a + " vs " + b); bad++; }
  process.exit(bad ? 1 : 0);
' "$REPO_ROOT/_shared/lib/code-scope.cjs" 2>&1)" || OVL_RC=$?
assert_rc "in-segment-glob-overlap-table" 0 "$OVL_RC" "$OVL_OUT"

# --- ReDoS bound + matchesGlob normalisation (review round 1) ---
RDS_RC=0
RDS_OUT="$(node -e '
  const g = require(process.argv[1]);
  const stars = "*a".repeat(30) + "*b";
  const text = "a".repeat(40);
  const t0 = Date.now();
  const m = g.matchesGlob("src/" + stars, "src/" + text);
  const o = g.scopePathsOverlap("src/" + stars, "src/" + "*a".repeat(30) + "*c");
  const ms = Date.now() - t0;
  let bad = 0;
  if (m !== false) { console.log("30-star glob must not match"); bad++; }
  if (typeof o !== "boolean") { console.log("overlap must return boolean"); bad++; }
  if (ms >= 1000) { console.log("too slow: " + ms + " ms"); bad++; }
  if (g.matchesGlob("./SRC//*.ts", "src/a.ts") !== true) { console.log("glob side must be normalised"); bad++; }
  if (g.matchesGlob("src\\\\*.ts", "src/a.ts") !== true) { console.log("backslash glob must be normalised"); bad++; }
  process.exit(bad ? 1 : 0);
' "$REPO_ROOT/_shared/lib/segment-glob.cjs" 2>&1)" || RDS_RC=$?
assert_rc "glob-linear-matcher-time-bound" 0 "$RDS_RC" "$RDS_OUT"

# --- input bounds (review round 2): clear error, no RangeError ---
LIM_RC=0
LIM_OUT="$(node -e '
  const g = require(process.argv[1]);
  let bad = 0;
  const long = "a".repeat(30000);
  const many = "**/".repeat(3000) + "x";
  for (const [label, p] of [["30k segment", "src/" + long], ["3000 segments", many]]) {
    if (!g.validateScopePath(p)) { console.log(label + ": validateScopePath must report an error"); bad++; }
    try { g.scopePathsOverlap(p, "src/a.ts"); console.log(label + ": scopePathsOverlap must throw ScopeLimitError"); bad++; }
    catch (e) { if (!(e instanceof g.ScopeLimitError)) { console.log(label + ": wrong error " + e.name); bad++; } }
  }
  if (g.validateScopePath("src/" + "a".repeat(1024) + "/x") !== null) { console.log("1024-char segment must pass"); bad++; }
  process.exit(bad ? 1 : 0);
' "$REPO_ROOT/_shared/lib/segment-glob.cjs" 2>&1)" || LIM_RC=$?
assert_rc "scope-input-bounds-lib" 0 "$LIM_RC" "$LIM_OUT"

LIM_FILE="$WORK/limit-reservations.json"
LONG_SEG="$(node -e 'process.stdout.write("a".repeat(30000))')"
OUT="$(node "$TOOLS" code-scope claim --by feature-long --scope "src/$LONG_SEG" --file "$LIM_FILE" 2>&1)"
assert_rc "claim-oversized-segment-fails-closed" 1 $? "$OUT"
if ! grep -q "exceeds the limit" <<<"$OUT" || grep -q "RangeError" <<<"$OUT"; then
  echo "FAIL  claim-oversized-segment: expected clear limit message"; fail=$((fail + 1))
else
  echo "PASS  claim-oversized-segment: clear limit message"; pass=$((pass + 1))
fi

# --- root scope overlaps everything (review round 2) ---
ROOT_FILE="$WORK/root-reservations.json"
OUT="$(node "$TOOLS" code-scope claim --by feature-a --scope "src/a.ts" --file "$ROOT_FILE" 2>&1)"
assert_rc "root-scope-setup-claim" 0 $? "$OUT"
OUT="$(node "$TOOLS" code-scope claim --by feature-root --scope "./" --file "$ROOT_FILE" 2>&1)"
assert_rc "root-scope-claim-conflicts" 1 $? "$OUT"
if ! grep -q '"status": "CONFLICT"' <<<"$OUT"; then
  echo "FAIL  root-scope-claim-conflicts: expected CONFLICT"; fail=$((fail + 1))
fi

# --- idempotent re-claim ignores the directory signal (review round 4) ---
IDEM_FILE="$WORK/idem.json"
OUT="$(node "$TOOLS" code-scope claim --by feature-idem --scope "src/" --file "$IDEM_FILE" 2>&1)"
assert_rc "idem-claim-with-trailing-slash" 0 $? "$OUT"
OUT="$(node "$TOOLS" code-scope stage --by feature-idem --set review --file "$IDEM_FILE" 2>&1)"
assert_rc "idem-stage-review" 0 $? "$OUT"
OUT="$(node "$TOOLS" code-scope claim --by feature-idem --scope "src" --file "$IDEM_FILE" 2>&1)"
assert_rc "idem-reclaim-without-slash" 0 $? "$OUT"
if ! grep -q '"idempotent": true' <<<"$OUT" || ! grep -q '"stage": "review"' <<<"$OUT"; then
  echo "FAIL  idem-reclaim-without-slash: expected idempotent:true and stage review kept"; fail=$((fail + 1))
else
  echo "PASS  idem-reclaim-without-slash keeps stage review"; pass=$((pass + 1))
fi

# --- check validates --scope like claim (review round 3) ---
OUT="$(node "$TOOLS" code-scope check --by feature-chk --scope "src/$LONG_SEG" --file "$LIM_FILE" 2>&1)"
assert_rc "check-oversized-segment-fails-closed" 1 $? "$OUT"
if ! grep -q "INVALID_SCOPE" <<<"$OUT" || grep -q "RangeError" <<<"$OUT"; then
  echo "FAIL  check-oversized-segment: expected INVALID_SCOPE, no RangeError"; fail=$((fail + 1))
else
  echo "PASS  check-oversized-segment: INVALID_SCOPE"; pass=$((pass + 1))
fi

# --- stored over-limit entry: conflict naming holder and reason, no crash, no lock left ---
BAD_FILE="$WORK/stored-overlimit.json"
node -e '
  const seg = "a".repeat(30000);
  require("fs").writeFileSync(process.argv[1], JSON.stringify({ reservations: [
    { type: "code_scope", paths: ["src/" + seg], by: "feature-stored-long", at: "2026-10-15T00:00:00Z", stage: "started" } ] }));
' "$BAD_FILE"
OUT="$(node "$TOOLS" code-scope claim --by feature-new --scope "src/x.ts" --file "$BAD_FILE" 2>&1)"
RC=$?
assert_rc "claim-vs-stored-overlimit-conflicts" 1 "$RC" "$OUT"
if ! grep -q "feature-stored-long" <<<"$OUT" || ! grep -q "stored scope unusable" <<<"$OUT" || grep -q "RangeError" <<<"$OUT"; then
  echo "FAIL  claim-vs-stored-overlimit: expected holder + reason, no RangeError"; fail=$((fail + 1))
else
  echo "PASS  claim-vs-stored-overlimit names holder and reason"; pass=$((pass + 1))
fi
if ls "$BAD_FILE".lock >/dev/null 2>&1; then
  echo "FAIL  claim-vs-stored-overlimit: lock file left behind"; fail=$((fail + 1))
else
  echo "PASS  claim-vs-stored-overlimit: no lock file left"; pass=$((pass + 1))
fi
OUT="$(node "$TOOLS" code-scope check --by feature-new --scope "src/x.ts" --file "$BAD_FILE" 2>&1)"
assert_rc "check-vs-stored-overlimit-conflicts" 1 $? "$OUT"

# --- re-claim directory signal (fix scope-reclaim-dir-signal) ---
rc_json() { node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(String(eval(process.argv[2])))' "$1" "$2" 2>&1; }
expect_eq() { # name expected actual
  if [[ "$2" == "$3" ]]; then echo "PASS  $1"; pass=$((pass + 1)); else echo "FAIL  $1: expected '$2', got '$3'"; fail=$((fail + 1)); fi
}
RF="$WORK/reclaim-1.json"
node "$TOOLS" code-scope claim --by fa --scope "docs/v1.2" --file "$RF" >/dev/null 2>&1
OUT="$(node "$TOOLS" code-scope claim --by fa --scope "docs/v1.2/" --file "$RF" 2>&1)"
assert_rc "reclaim-widen-ok" 0 $? "$OUT"
expect_eq "reclaim-widen-stores-dir-form" "docs/v1.2/" "$(rc_json "$(cat "$RF")" 'j.reservations[0].paths[0]')"
OUT="$(node "$TOOLS" code-scope check --by fb --scope '**/x' --file "$RF" 2>&1)"
assert_rc "reclaim-widen-then-glob-conflicts" 1 $? "$OUT"

RF="$WORK/reclaim-2.json"
node "$TOOLS" code-scope claim --by fa --scope "docs/v1.2/." --file "$RF" >/dev/null 2>&1
OUT="$(node "$TOOLS" code-scope check --by fb --scope '**/x' --file "$RF" 2>&1)"
assert_rc "trailing-slash-dot-is-directory" 1 $? "$OUT"
RF="$WORK/reclaim-3.json"
node "$TOOLS" code-scope claim --by fa --scope "docs/v1.2/./." --file "$RF" >/dev/null 2>&1
OUT="$(node "$TOOLS" code-scope check --by fb --scope '**/x' --file "$RF" 2>&1)"
assert_rc "trailing-slash-dot-dot-is-directory" 1 $? "$OUT"

# reverse order: stored dir form, plain re-claim -> idempotent, nothing written
RF="$WORK/reclaim-4.json"
node "$TOOLS" code-scope claim --by fa --scope "docs/v1.2/" --file "$RF" >/dev/null 2>&1
BEFORE="$(cat "$RF")"
OUT="$(cd "$GATE_CWD" && node "$TOOLS" code-scope claim --by fa --scope "docs/v1.2" --file "$RF" --phase fx-code-scope 2>&1)"
assert_rc "reclaim-narrower-idempotent" 0 $? "$OUT"
expect_eq "reclaim-narrower-no-write" "$BEFORE" "$(cat "$RF")"
expect_eq "reclaim-narrower-not-widened" "undefined" "$(rc_json "$OUT" 'j.widened')"

# widening re-claim that collides with another feature: CONFLICT, stored unchanged
RF="$WORK/reclaim-5.json"
node "$TOOLS" code-scope claim --by fa --scope "docs/v1.2" --file "$RF" >/dev/null 2>&1
node "$TOOLS" code-scope claim --by fb --scope '**/x' --file "$RF" >/dev/null 2>&1
BEFORE="$(cat "$RF")"
OUT="$(node "$TOOLS" code-scope claim --by fa --scope "docs/v1.2/" --file "$RF" 2>&1)"
assert_rc "reclaim-widen-conflict-rc1" 1 $? "$OUT"
expect_eq "reclaim-widen-conflict-stored-unchanged" "$BEFORE" "$(cat "$RF")"
if ls "$RF".lock >/dev/null 2>&1; then echo "FAIL  reclaim-widen-conflict: lock left"; fail=$((fail + 1)); else echo "PASS  reclaim-widen-conflict: no lock left"; pass=$((pass + 1)); fi

# successful widening keeps at/stage/by and reports widened
RF="$WORK/reclaim-6.json"
node "$TOOLS" code-scope claim --by fa --scope "docs/v1.2,src/a.ts" --file "$RF" >/dev/null 2>&1
node "$TOOLS" code-scope stage --by fa --set review --file "$RF" >/dev/null 2>&1
AT="$(rc_json "$(cat "$RF")" 'j.reservations[0].at')"
OUT="$(cd "$GATE_CWD" && node "$TOOLS" code-scope claim --by fa --scope "src/a.ts,docs/v1.2/" --file "$RF" --phase fx-code-scope 2>&1)"
assert_rc "reclaim-widen-multi-ok" 0 $? "$OUT"
expect_eq "reclaim-widen-keeps-meta" "true|review|$AT|docs/v1.2/,src/a.ts" \
  "$(rc_json "$OUT" 'j.widened+"|"+j.reservation.stage+"|"+j.reservation.at+"|"+j.reservation.paths.join(",")')"

# --- hasDirSignal edge table + pathological "/." input (Reinhard round 6) ---
EDGE="$(node -e '
  const { hasDirSignal } = require(process.argv[1] + "/_shared/lib/segment-glob.cjs");
  const want = { "/.": true, "a/./.": true, "a/./": true, "a/.": true, "a/..": false, ".": false,
                 "/": false, "./.": false, "a/.b": false, "a./.": true, "a/": true, "a": false };
  const bad = Object.keys(want).filter((k) => hasDirSignal(k) !== want[k]);
  process.stdout.write(bad.length ? "bad:" + JSON.stringify(bad) : "ok");
' "$REPO_ROOT" 2>&1)"
expect_eq "hasDirSignal-edge-table" "ok" "$EDGE"
RF="$WORK/pathological.json"
node "$TOOLS" code-scope claim --by fb --scope "src/" --file "$RF" >/dev/null 2>&1
T="$(node -e '
  const { spawnSync } = require("child_process");
  const scope = "a" + "/.".repeat(60000) + "/x";
  const t0 = Date.now();
  const r = spawnSync("node", [process.argv[1], "code-scope", "check", "--by", "fa", "--scope", scope, "--file", process.argv[2]], { encoding: "utf8" });
  const ms = Date.now() - t0;
  process.stdout.write((r.status === 1 && /INVALID_SCOPE/.test(r.stdout) && ms < 2000) ? "ok" : "bad rc=" + r.status + " ms=" + ms);
' "$TOOLS" "$RF" 2>&1)"
expect_eq "pathological-dot-segments-rejected-fast" "ok" "$T"
# direct call bypasses the length cap: the scan itself must stay linear
LIN="$(node -e '
  const { hasDirSignal } = require(process.argv[1] + "/_shared/lib/segment-glob.cjs");
  const s = "a" + "/.".repeat(200000) + "/x";
  const t0 = Date.now(); hasDirSignal(s); const ms = Date.now() - t0;
  process.stdout.write(ms < 200 ? "ok" : "slow ms=" + ms);
' "$REPO_ROOT" 2>&1)"
expect_eq "hasDirSignal-linear-on-long-dot-runs" "ok" "$LIN"

echo "code-scope fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
