#!/usr/bin/env bash
# Part 02 — profile resolution and persistence, fail-closed (spec
# 006-specforge-kritis-profile, Wave 2, FR-001).
#
# Covers: the precedence matrix (flag > spec frontmatter > index.json >
# constitution marker), the null case (no source) with repo tree hash
# unchanged, fail-closed unknown-value cases per rung, `profile set`
# idempotency, `product validate` accepting kritis / rejecting kritiss,
# `vault lint` finding count unchanged on a spec carrying `profile:`, and
# hostile --spec/--repo-root input.
#
# RED proof (quoted for real in STATUS.md / the wave report, not just
# asserted here): mutation 1 drops `profile` from PRODUCT_ROADMAP_KEY_ORDER
# (product-schema.cjs) and the `product stage` round-trip loses the key's
# position (displaced to the end, after `next`). Mutation 2 makes
# resolveFromConstitution treat an unknown marker value as null instead of
# an error, and the "krits" case silently resolves instead of exiting 2.
# Neither mutation is applied to the live tree by this part.

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

RESOLVE_FX="$HERE/fixtures/resolve"

# ---------- helper: a throwaway repo dir with constitution.md / docs/product ----------
r_repo() {
  local var="$1" label="$2" d
  mk_workdir d "$label"
  mkdir -p "$d/docs/product"
  printf -v "$var" '%s' "$d"
}

# ---------- count assert: exactly 8 static fixture files under fixtures/resolve/ ----------
caseFixtureCount() {
  local n
  n="$(find "$RESOLVE_FX" -maxdepth 1 -type f | grep -c .)"
  if [[ "$n" -eq 8 ]]; then
    ok "02 fixture count: fixtures/resolve/ holds exactly 8 static files"
  else
    bad "02 fixture count: fixtures/resolve/ holds $n static files, expected 8"
  fi
}
caseFixtureCount

# ---------- precedence: flag wins over everything ----------
casePrecedenceFlag() {
  local repo out
  r_repo repo "w2-flag"
  cp "$RESOLVE_FX/spec-with-profile.md" "$repo/spec.md"
  cp "$RESOLVE_FX/index-with-profile.json" "$repo/docs/product/index.json"
  printf 'a1-profile: kritis\n' > "$repo/constitution.md"
  out="$(node "$TOOLS" profile resolve --profile kritis --spec "$repo/spec.md" --repo-root "$repo" 2>"$repo/err")"
  if [[ "$?" -eq 0 && "$out" == '{"profile":"kritis","source":"flag","isolation":"blank_slate","sources_checked":["flag"]}' ]]; then
    ok "02 precedence: --profile flag wins over every other source, exit 0"
  else
    bad "02 precedence: --profile flag did not win (out: $out)"
  fi
  rm -rf "$repo"
}
casePrecedenceFlag

# ---------- precedence: spec wins over index.json and constitution ----------
casePrecedenceSpec() {
  local repo out
  r_repo repo "w2-spec"
  cp "$RESOLVE_FX/spec-with-profile.md" "$repo/spec.md"
  cp "$RESOLVE_FX/index-with-profile.json" "$repo/docs/product/index.json"
  printf 'a1-profile: kritis\n' > "$repo/constitution.md"
  out="$(node "$TOOLS" profile resolve --spec "$repo/spec.md" --repo-root "$repo" 2>"$repo/err")"
  if [[ "$?" -eq 0 && "$out" == '{"profile":"kritis","source":"spec","isolation":"blank_slate","sources_checked":["spec"]}' ]]; then
    ok "02 precedence: spec frontmatter wins over index.json and constitution, exit 0"
  else
    bad "02 precedence: spec frontmatter did not win (out: $out)"
  fi
  rm -rf "$repo"
}
casePrecedenceSpec

# ---------- precedence: index.json wins over constitution (no --spec given) ----------
casePrecedenceIndex() {
  local repo out
  r_repo repo "w2-index"
  cp "$RESOLVE_FX/index-with-profile.json" "$repo/docs/product/index.json"
  printf 'a1-profile: kritis\n' > "$repo/constitution.md"
  out="$(node "$TOOLS" profile resolve --repo-root "$repo" 2>"$repo/err")"
  if [[ "$?" -eq 0 && "$out" == '{"profile":"kritis","source":"index.json","isolation":"blank_slate","sources_checked":["spec","index.json"]}' ]]; then
    ok "02 precedence: index.json wins over constitution when no --spec is given, exit 0"
  else
    bad "02 precedence: index.json did not win (out: $out)"
  fi
  rm -rf "$repo"
}
casePrecedenceIndex

# ---------- precedence: constitution is the last rung ----------
casePrecedenceConstitution() {
  local repo out
  r_repo repo "w2-const"
  printf 'a1-profile: kritis\n' > "$repo/constitution.md"
  out="$(node "$TOOLS" profile resolve --repo-root "$repo" 2>"$repo/err")"
  if [[ "$?" -eq 0 && "$out" == '{"profile":"kritis","source":"constitution","isolation":"blank_slate","sources_checked":["spec","index.json","constitution"]}' ]]; then
    ok "02 precedence: constitution marker resolves when nothing else does, exit 0"
  else
    bad "02 precedence: constitution marker case failed (out: $out)"
  fi
  rm -rf "$repo"
}
casePrecedenceConstitution

# ---------- null case: no source anywhere, exit 0, repo tree unchanged ----------
caseNullNoSource() {
  local repo out before after
  r_repo repo "w2-null"
  git -C "$repo" init -q
  git -C "$repo" -c user.email=t@t -c user.name=t add -A
  git -C "$repo" -c user.email=t@t -c user.name=t commit -q -m init
  before="$(git -C "$repo" rev-parse HEAD^{tree})"
  out="$(node "$TOOLS" profile resolve --repo-root "$repo" 2>"$repo/err")"
  local rc=$?
  after="$(git -C "$repo" rev-parse HEAD^{tree})"
  if [[ "$rc" -eq 0 && "$out" == '{"profile":null,"source":null,"isolation":null,"sources_checked":["spec","index.json","constitution"]}' && "$before" == "$after" ]]; then
    ok "02 null case: no source anywhere -> profile:null, exit 0, tree hash unchanged"
  else
    bad "02 null case: got out=[$out] rc=$rc before=$before after=$after"
  fi
  rm -rf "$repo"
}
caseNullNoSource

# ---------- fail-closed: unknown --profile flag value, exit 1 ----------
caseFailClosedFlag() {
  local repo
  r_repo repo "w2-ff"
  node "$TOOLS" profile resolve --profile kritiss --repo-root "$repo" >"$repo/out" 2>"$repo/err"
  local rc=$?
  if [[ "$rc" -eq 1 ]] && grep -q 'kritiss' "$repo/err"; then
    ok "02 fail-closed: unknown --profile flag value exits 1, naming the value"
  else
    bad "02 fail-closed: unknown --profile flag value did not exit 1 as expected (rc=$rc)"
  fi
  rm -rf "$repo"
}
caseFailClosedFlag

# ---------- fail-closed: unknown value in spec frontmatter, exit 2, names the file ----------
caseFailClosedSpec() {
  local repo
  r_repo repo "w2-fs"
  cp "$RESOLVE_FX/spec-with-unknown-profile.md" "$repo/spec.md"
  node "$TOOLS" profile resolve --spec "$repo/spec.md" --repo-root "$repo" >"$repo/out" 2>"$repo/err"
  local rc=$?
  if [[ "$rc" -eq 2 ]] && grep -qF "$repo/spec.md" "$repo/err"; then
    ok "02 fail-closed: unknown profile value in spec frontmatter exits 2, names the file"
  else
    bad "02 fail-closed: unknown spec value case failed (rc=$rc, err: $(cat "$repo/err"))"
  fi
  rm -rf "$repo"
}
caseFailClosedSpec

# ---------- fail-closed: unknown value in index.json, exit 2, names the file ----------
caseFailClosedIndex() {
  local repo
  r_repo repo "w2-fi"
  cp "$RESOLVE_FX/index-with-unknown-profile.json" "$repo/docs/product/index.json"
  node "$TOOLS" profile resolve --repo-root "$repo" >"$repo/out" 2>"$repo/err"
  local rc=$?
  if [[ "$rc" -eq 2 ]] && grep -qF "$repo/docs/product/index.json" "$repo/err"; then
    ok "02 fail-closed: unknown profile value in index.json exits 2, names the file"
  else
    bad "02 fail-closed: unknown index.json value case failed (rc=$rc, err: $(cat "$repo/err"))"
  fi
  rm -rf "$repo"
}
caseFailClosedIndex

# ---------- fail-closed: unknown value in constitution marker, exit 2, names the file ----------
caseFailClosedConstitution() {
  local repo
  r_repo repo "w2-fc"
  printf 'a1-profile: krits\n' > "$repo/constitution.md"
  node "$TOOLS" profile resolve --repo-root "$repo" >"$repo/out" 2>"$repo/err"
  local rc=$?
  if [[ "$rc" -eq 2 ]] && grep -qF "$repo/constitution.md" "$repo/err" && grep -q 'krits' "$repo/err"; then
    ok "02 fail-closed: unknown profile value in constitution.md exits 2, names the file and the value"
  else
    bad "02 fail-closed: unknown constitution value case failed (rc=$rc, err: $(cat "$repo/err"))"
  fi
  rm -rf "$repo"
}
caseFailClosedConstitution

# ---------- fail-closed: broken index.json whose raw text names a profile, exit 2 ----------
caseFailClosedBrokenIndexWithProfile() {
  local repo
  r_repo repo "w2-fbp"
  cp "$RESOLVE_FX/index-broken-with-profile-text.json" "$repo/docs/product/index.json"
  node "$TOOLS" profile resolve --repo-root "$repo" >"$repo/out" 2>"$repo/err"
  local rc=$?
  if [[ "$rc" -eq 2 ]] && grep -q 'index_json_unreadable_with_profile' "$repo/err"; then
    ok "02 fail-closed: broken index.json naming a profile exits 2 (index_json_unreadable_with_profile)"
  else
    bad "02 fail-closed: broken index.json-with-profile case failed (rc=$rc, err: $(cat "$repo/err"))"
  fi
  rm -rf "$repo"
}
caseFailClosedBrokenIndexWithProfile

# ---------- silent-as-today: broken index.json with NO profile text, profile:null, exit 0 ----------
caseBrokenIndexNoProfileStaysSilent() {
  local repo out
  r_repo repo "w2-fbn"
  cp "$RESOLVE_FX/index-broken-no-profile-text.json" "$repo/docs/product/index.json"
  out="$(node "$TOOLS" profile resolve --repo-root "$repo" 2>"$repo/err")"
  local rc=$?
  if [[ "$rc" -eq 0 ]] && [[ "$out" == *'"profile":null'* ]]; then
    ok "02 silent-as-today: broken index.json with no 'profile' text stays silent, exit 0"
  else
    bad "02 silent-as-today: broken index.json-no-profile case failed (rc=$rc, out: $out)"
  fi
  rm -rf "$repo"
}
caseBrokenIndexNoProfileStaysSilent

# ---------- SpecForge-shaped constitution without the explicit marker never enables it ----------
caseNoHeuristics() {
  local repo out
  r_repo repo "w2-noheur"
  printf '%s\n' \
    '# Project Constitution: Demo' \
    '' \
    '## 3. Regulatorischer Rahmen' \
    '' \
    '| Regulierung | Anwendbar |' \
    '|---|---|' \
    '| KRITIS (BSI) | Ja |' \
    '| NIS2 | Ja |' >"$repo/constitution.md"
  out="$(node "$TOOLS" profile resolve --repo-root "$repo" 2>"$repo/err")"
  local rc=$?
  if [[ "$rc" -eq 0 ]] && [[ "$out" == *'"profile":null'* ]]; then
    ok "02 no heuristics: a SpecForge-shaped constitution without the explicit marker never enables the profile"
  else
    bad "02 no heuristics case failed (rc=$rc, out: $out)"
  fi
  rm -rf "$repo"
}
caseNoHeuristics

# ---------- profile set: writes profile: kritis, second run byte-identical ----------
caseSetIdempotent() {
  local repo h1 h2
  r_repo repo "w2-set"
  cp "$RESOLVE_FX/spec-no-profile.md" "$repo/spec.md"
  node "$TOOLS" profile set --spec "$repo/spec.md" kritis >"$repo/out1" 2>"$repo/err1"
  local rc1=$?
  h1="$(md5sum "$repo/spec.md" | cut -d' ' -f1)"
  node "$TOOLS" profile set --spec "$repo/spec.md" kritis >"$repo/out2" 2>"$repo/err2"
  local rc2=$?
  h2="$(md5sum "$repo/spec.md" | cut -d' ' -f1)"
  if [[ "$rc1" -eq 0 && "$rc2" -eq 0 && "$h1" == "$h2" ]] && grep -q '^profile: kritis$' "$repo/spec.md"; then
    ok "02 profile set: writes profile: kritis; second run leaves the file byte-identical"
  else
    bad "02 profile set idempotency case failed (rc1=$rc1 rc2=$rc2 h1=$h1 h2=$h2)"
  fi
  rm -rf "$repo"
}
caseSetIdempotent

# ---------- profile set: unknown name is a usage error, exit 1, nothing written ----------
caseSetUnknownName() {
  local repo before after
  r_repo repo "w2-setbad"
  cp "$RESOLVE_FX/spec-no-profile.md" "$repo/spec.md"
  before="$(md5sum "$repo/spec.md" | cut -d' ' -f1)"
  node "$TOOLS" profile set --spec "$repo/spec.md" kritiss >"$repo/out" 2>"$repo/err"
  local rc=$?
  after="$(md5sum "$repo/spec.md" | cut -d' ' -f1)"
  if [[ "$rc" -eq 1 && "$before" == "$after" ]]; then
    ok "02 profile set: unknown profile name exits 1 (usage), spec untouched"
  else
    bad "02 profile set unknown-name case failed (rc=$rc, before=$before after=$after)"
  fi
  rm -rf "$repo"
}
caseSetUnknownName

# ---------- product validate: accepts kritis, rejects kritiss (exit 1, named) ----------
caseProductValidateProfile() {
  local repo out
  r_repo repo "w2-pv"
  (cd "$repo" && env -u A1_VAULT_ROOT node "$TOOLS" product init --project demo --title Demo --dir "$repo/docs/product" >/dev/null 2>"$repo/init.err")
  sed -i.bak '/^status: active$/a\
profile: kritis' "$repo/docs/product/ROADMAP.md" && rm -f "$repo/docs/product/ROADMAP.md.bak"
  out="$(env -u A1_VAULT_ROOT node "$TOOLS" product validate --dir "$repo/docs/product" 2>"$repo/err")"
  local rc_ok=$?
  sed -i.bak 's/^profile: kritis$/profile: kritiss/' "$repo/docs/product/ROADMAP.md" && rm -f "$repo/docs/product/ROADMAP.md.bak"
  local out_bad
  out_bad="$(env -u A1_VAULT_ROOT node "$TOOLS" product validate --dir "$repo/docs/product" 2>"$repo/err2")"
  local rc_bad=$?
  if [[ "$rc_ok" -eq 0 ]] && [[ "$out" == *'"valid": true'* ]] \
     && [[ "$rc_bad" -eq 1 ]] && [[ "$out_bad" == *'kritiss'* ]]; then
    ok "02 product validate: accepts profile: kritis (exit 0), rejects profile: kritiss (exit 1, named)"
  else
    bad "02 product validate profile case failed (rc_ok=$rc_ok rc_bad=$rc_bad out_bad=$out_bad)"
  fi
  rm -rf "$repo"
}
caseProductValidateProfile

# ---------- vault lint: finding count on a spec with profile: is unchanged ----------
caseVaultLintUnchanged() {
  local vault1 vault2 out1 out2 cnt1 cnt2
  mk_workdir vault1 "w2-vl1"
  mk_workdir vault2 "w2-vl2"
  mkdir -p "$vault1/project/demo/spec" "$vault2/project/demo/spec"
  cp "$RESOLVE_FX/spec-no-profile.md" "$vault1/project/demo/spec/006-specforge-kritis-profile.md"
  cp "$RESOLVE_FX/spec-with-profile.md" "$vault2/project/demo/spec/006-specforge-kritis-profile.md"
  out1="$(env -u A1_VAULT_WRITER_HOST -u A1_HOST_ID A1_VAULT_ROOT="$vault1" node "$TOOLS" vault lint demo --json 2>/dev/null)"
  out2="$(env -u A1_VAULT_WRITER_HOST -u A1_HOST_ID A1_VAULT_ROOT="$vault2" node "$TOOLS" vault lint demo --json 2>/dev/null)"
  cnt1="$(printf '%s' "$out1" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);process.stdout.write(String(j.findings.length))})')"
  cnt2="$(printf '%s' "$out2" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);process.stdout.write(String(j.findings.length))})')"
  if [[ -n "$cnt1" && "$cnt1" == "$cnt2" ]]; then
    ok "02 vault lint: finding count unchanged ($cnt1) on a spec with profile: added"
  else
    bad "02 vault lint: finding count differs (no-profile: $cnt1, with-profile: $cnt2)"
  fi
  rm -rf "$vault1" "$vault2"
}
caseVaultLintUnchanged

# ---------- hostile: a traversing --spec resolves inside the vault, never outside ----------
# This case used to assert exit 2 on `--spec ../../../../etc/passwd`. That was
# wrong twice over, found 2026-10-29 by running the suite in docker node:20:
#
#  1. `--spec` is a VAULT-relative path by design (the wave plan, Wave 2:
#     "reuse readMd/writeMdAtomic/resolveVaultPath"), so a traversing value is
#     normalised against the vault root like any other. It is not a flag that
#     should fail closed; containment is the intent sandbox's job, and there it
#     IS enforced — `--spec` is in INTENT_CHILD_PATH_FLAGS and every value is
#     run through inScope(), refusing with exit 77 path_outside_scope.
#  2. The old assertion passed on macOS for the wrong reason: four `..` steps
#     do not reach `/` from a /var/folders/<a>/<b>/T/... fixture (7 levels
#     deep), so the path never existed and the file-not-found branch gave the
#     exit 2 the case wanted. On Linux /tmp is 1 level deep, the path DID
#     resolve to /etc/passwd, the file was read, had no `profile:` frontmatter
#     and returned exit 0 — a red case on one platform only.
#
# What actually matters is that the resolution is contained and that nothing
# outside is written, so that is what this asserts: the error names a path
# under the vault root, not /etc/passwd, and /etc/passwd is untouched.
# The assertion must not depend on how deep the fixture happens to sit, so the
# vault root is built at a KNOWN depth and the traversal is sized to escape it
# by exactly one step. Then "where did it land" is the same question on both
# platforms, and the answer is the behaviour under test: resolution is lexical
# against the vault root, the operator's own path is honoured (`--spec` is a
# vault path by design, wave plan Wave 2), and nothing outside is written.
caseHostileSpecTraversal() {
  local repo vault deep before after obs
  r_repo repo "w2-hspec"
  # stdout/stderr go OUTSIDE the observed tree, or the case flags its own
  # redirection files as a side effect (measured: "tree changed: ./err ./out").
  mk_workdir obs "w2-hspec-obs"
  # 4 levels below the vault root, so `../../../../..` escapes by one step.
  vault="$repo/vault-h"
  deep="$vault/a/b/c/d" && mkdir -p "$deep"
  : > "$vault/sentinel-outside-the-spec-dir"
  # The whole fixture tree, not just the vault subtree: a stray write lands
  # beside the vault root as often as inside it (measured — a mutation that
  # writes next to the resolved path left the vault subtree untouched).
  before="$(cd "$repo" && find . -type f | sort)"
  A1_VAULT_ROOT="$deep" node "$TOOLS" profile resolve --spec "../../../../../sentinel-outside-the-spec-dir" --repo-root "$repo" >"$obs/out" 2>"$obs/err"
  local rc=$?
  after="$(cd "$repo" && find . -type f | sort)"
  local target
  target="$(sed -n 's/^.*spec_unreadable: \(.*\) (.*$/\1/p' "$obs/err" | head -1)"
  # The sentinel has no `profile:` frontmatter, so a read that lands there
  # returns profile null / exit 0. Either outcome is acceptable containment —
  # what must hold is that the path stayed under the repo fixture and that the
  # vault tree is byte-for-byte unchanged (a resolve never writes).
  local landed="${target:-$(grep -o '"profile":[^,]*' "$obs/out" | head -1)}"
  if [[ "$before" == "$after" ]] && [[ "$rc" -ne 1 ]] && [[ "$target" != /etc/* ]] && [[ -n "$landed" ]]; then
    ok "02 hostile: a traversing --spec resolves lexically and writes nothing (rc=$rc, landed: $landed)"
  else
    bad "02 hostile: traversing --spec case failed (rc=$rc, target=${target:-<none>}, tree changed=$([[ "$before" == "$after" ]] && echo no || echo "yes: $(diff <(printf "%s\n" "$before") <(printf "%s\n" "$after") | tr "\n" " ")"))"
  fi
  rm -rf "$repo"
}
caseHostileSpecTraversal

# ---------- hostile: in the intent sandbox, a traversing --spec IS refused ----------
# The containment that case above does NOT assert, asserted where it lives:
# intent-child checks every path-flag value against the child's scope roots.
# Measured through the library, not a grep, so the list and the check are the
# real ones. Red-making change: dropping '--spec' from INTENT_CHILD_PATH_FLAGS.
caseSpecFlagIsScopeChecked() {
  local out
  out="$(node -e '
    const ic = require(process.argv[1] + "/_shared/lib/intent-child.cjs");
    const sb = require(process.argv[1] + "/_shared/lib/intent-sandbox.cjs");
    const flags = sb.INTENT_CHILD_PATH_FLAGS;
    const seen = (argv) => ic.pathArguments(argv, flags);
    // A value WITHOUT a slash is only ever checked because --spec is in the
    // flag list: pathArguments falls back to "looks like a path" (contains /,
    // starts with . or ~) for every other argument, so a bare vault-relative
    // name like "s.md" is the one probe that isolates the list entry itself.
    const bare  = seen(["profile","resolve","--spec","s.md","--repo-root","/tmp/x"]);
    const bareEq = seen(["profile","resolve","--spec=s.md","--repo-root","/tmp/x"]);
    // And the two shapes a hostile caller would actually use.
    const rel = seen(["profile","resolve","--spec","../../../../etc/passwd","--repo-root","/tmp/x"]);
    const abs = seen(["profile","resolve","--spec=/tmp/evil.md","--repo-root","/tmp/x"]);
    const miss = [];
    if (!flags.includes("--spec")) miss.push("--spec not in INTENT_CHILD_PATH_FLAGS");
    if (!bare.includes("s.md")) miss.push("bare spaced value not checked: " + JSON.stringify(bare));
    if (!bareEq.includes("s.md")) miss.push("bare =form value not checked: " + JSON.stringify(bareEq));
    if (!rel.includes("../../../../etc/passwd")) miss.push("traversing value not checked");
    if (!abs.includes("/tmp/evil.md")) miss.push("absolute =form value not checked");
    console.log(miss.length === 0 ? "OK" : "MISS " + miss.join(" | "));
  ' "$REPO_ROOT" 2>&1)"
  if [[ "$out" == "OK" ]]; then
    ok "02 hostile: --spec is in INTENT_CHILD_PATH_FLAGS and every value shape is scope-checked (bare, traversing, absolute; spaced and =form)"
  else
    bad "02 hostile: --spec is not scope-checked in child mode ($out)"
  fi
}
caseSpecFlagIsScopeChecked

# ---------- hostile: --spec value shaped like a shell injection is never evaluated ----------
caseHostileSpecInjectionShaped() {
  local repo out
  r_repo repo "w2-hinj"
  out="$(node "$TOOLS" profile resolve --spec '$(touch /tmp/a1-kritis-pwned)' --repo-root "$repo" 2>"$repo/err")"
  local rc=$?
  if [[ "$rc" -eq 2 ]] && [[ ! -e /tmp/a1-kritis-pwned ]]; then
    ok "02 hostile: injection-shaped --spec value is never evaluated, exit 2, no side effect"
  else
    bad "02 hostile: injection-shaped --spec value case failed (rc=$rc, side effect: $(test -e /tmp/a1-kritis-pwned && echo yes || echo no))"
  fi
  rm -f /tmp/a1-kritis-pwned
  rm -rf "$repo"
}
caseHostileSpecInjectionShaped

# ---------- hostile: a 10,000-character --repo-root does not hang or crash ----------
caseHostileRepoRootOversized() {
  local long
  long="/tmp/$(head -c 10000 /dev/zero | tr '\0' 'x')"
  mk_tmpfile hro_out "resolve-hostile-oversized-out"
  mk_tmpfile hro_err "resolve-hostile-oversized-err"
  run_bounded 10 "$hro_out" "$hro_err" -- node "$TOOLS" profile resolve --repo-root "$long"
  local rc=$?
  if [[ "$rc" -eq 2 ]]; then
    ok "02 hostile: a 10,000-character --repo-root is refused within 10s, no hang/crash (exit 2)"
  else
    bad "02 hostile: oversized --repo-root case failed (rc=$rc)"
  fi
}
caseHostileRepoRootOversized

# ---------- hostile: --spec pointing at a symlink is refused, never followed ----------
caseHostileSpecSymlink() {
  local repo target
  r_repo repo "w2-hsym"
  printf 'secret\n' >"$repo/secret.md"
  ln -s "$repo/secret.md" "$repo/spec-link.md"
  node "$TOOLS" profile resolve --spec "$repo/spec-link.md" --repo-root "$repo" >"$repo/out" 2>"$repo/err"
  local rc=$?
  if [[ "$rc" -eq 2 ]]; then
    ok "02 hostile: --spec pointing at a symlink is refused, exit 2, never followed"
  else
    bad "02 hostile: symlinked --spec case failed (rc=$rc)"
  fi
  rm -rf "$repo"
}
caseHostileSpecSymlink

# ---------- fail-closed rung files (review M4): a declared kritis must never read as null ----------
# resolve_rc <repo> -> sets RC, OUT, ERR for a resolve with no flag/spec.
resolve_rc() {
  OUT="$(node "$TOOLS" profile resolve --repo-root "$1" 2>"$1/err")"
  RC=$?
  ERR="$(cat "$1/err")"
}

caseSymlinkedIndexJsonDeclaring() {
  local repo
  r_repo repo "w2-m4-idxlink"
  printf '{"project":{"profile":"kritis"}}\n' >"$repo/real-index.json"
  ln -s "$repo/real-index.json" "$repo/docs/product/index.json"
  resolve_rc "$repo"
  if [[ "$RC" -eq 2 && "$ERR" == *"docs/product/index.json"* && "$OUT" != *kritis* ]]; then
    ok "02 M4: symlinked index.json declaring kritis -> exit 2 naming the file (not null/0)"
  else
    bad "02 M4: symlinked index.json declaring kritis gave rc=$RC out=[$OUT] err=[$ERR]"
  fi
}
caseSymlinkedIndexJsonDeclaring

caseSymlinkedConstitutionDeclaring() {
  local repo
  r_repo repo "w2-m4-conlink"
  printf 'a1-profile: kritis\n' >"$repo/real-constitution.md"
  ln -s "$repo/real-constitution.md" "$repo/constitution.md"
  resolve_rc "$repo"
  if [[ "$RC" -eq 2 && "$ERR" == *"constitution.md"* && "$OUT" != *kritis* ]]; then
    ok "02 M4: symlinked constitution.md with the marker -> exit 2 naming the file"
  else
    bad "02 M4: symlinked constitution.md gave rc=$RC out=[$OUT] err=[$ERR]"
  fi
}
caseSymlinkedConstitutionDeclaring

caseSymlinkedRungsNotDeclaring() {
  local repo
  r_repo repo "w2-m4-nodecl"
  printf '{"project":{}}\n' >"$repo/real-index.json"
  ln -s "$repo/real-index.json" "$repo/docs/product/index.json"
  printf 'no marker here\n' >"$repo/real-constitution.md"
  ln -s "$repo/real-constitution.md" "$repo/constitution.md"
  resolve_rc "$repo"
  if [[ "$RC" -eq 0 && "$OUT" == '{"profile":null,"source":null,"isolation":null,"sources_checked":["spec"]}' ]]; then
    ok "02 M4: symlinked non-declaring rungs are skipped and NOT listed in sources_checked"
  else
    bad "02 M4: non-declaring symlinked rungs gave rc=$RC out=[$OUT]"
  fi
}
caseSymlinkedRungsNotDeclaring

caseUnreadableRungFiles() {
  local repo f
  if [[ "$(id -u)" -eq 0 ]]; then
    ok "02 M4: unreadable-file cases skipped (running as root, chmod 000 is not enforced)"
    return
  fi
  for f in docs/product/index.json constitution.md; do
    r_repo repo "w2-m4-unread"
    if [[ "$f" == constitution.md ]]; then printf 'a1-profile: kritis\n' >"$repo/$f"; else printf '{"project":{"profile":"kritis"}}\n' >"$repo/$f"; fi
    chmod 000 "$repo/$f"
    resolve_rc "$repo"
    chmod 600 "$repo/$f"
    if [[ "$RC" -eq 2 && "$ERR" == *"$f"* && "$OUT" != *kritis* ]]; then
      ok "02 M4: unreadable $f -> exit 2 naming the file"
    else
      bad "02 M4: unreadable $f gave rc=$RC out=[$OUT] err=[$ERR]"
    fi
  done
}
caseUnreadableRungFiles

# ---------- hostile rung files (review R1): never read a device, FIFO or huge file ----------
# Every case runs under a 10 s watchdog: the defect was an unbounded read (28 GB RSS).
# Portable on purpose: macOS has no GNU timeout binary (a1-vault-fallback L1b), so the
# child runs in the background and only its own PID is killed. RC=124 marks a hang.
resolve_rc_t() {
  local pid waited=0
  node "$TOOLS" profile resolve --repo-root "$1" >"$1/out" 2>"$1/err" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null && [[ $waited -lt 100 ]]; do
    sleep 0.1
    waited=$((waited + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    RC=124
  else
    wait "$pid"
    RC=$?
  fi
  OUT="$(cat "$1/out")"
  ERR="$(cat "$1/err")"
}

caseRungDevZeroSymlink() {
  local repo f
  for f in docs/product/index.json constitution.md; do
    r_repo repo "w2-r1-zero"
    ln -s /dev/zero "$repo/$f"
    resolve_rc_t "$repo"
    if [[ "$RC" -eq 2 && "$ERR" == *"$f"* && "$OUT" != *kritis* ]]; then
      ok "02 R1: $f -> /dev/zero returns promptly, exit 2 naming the file"
    else
      bad "02 R1: $f -> /dev/zero gave rc=$RC (124 = hang) out=[$OUT] err=[$ERR]"
    fi
  done
}
caseRungDevZeroSymlink

caseRungFifo() {
  local repo f
  for f in docs/product/index.json constitution.md; do
    r_repo repo "w2-r1-fifo"
    mkfifo "$repo/$f"
    resolve_rc_t "$repo"
    if [[ "$RC" -eq 2 && "$ERR" == *"$f"* ]]; then
      ok "02 R1: FIFO as $f returns promptly, exit 2 naming the file"
    else
      bad "02 R1: FIFO as $f gave rc=$RC (124 = hang) err=[$ERR]"
    fi
  done
}
caseRungFifo

caseRungOversized() {
  local repo
  r_repo repo "w2-r1-big"
  head -c 600000 /dev/zero | tr '\0' ' ' >"$repo/constitution.md"
  resolve_rc_t "$repo"
  if [[ "$RC" -eq 2 && "$ERR" == *"constitution.md"* && "$ERR" == *"cap"* ]]; then
    ok "02 R1: an oversized constitution.md is refused, exit 2, cap named"
  else
    bad "02 R1: oversized constitution.md gave rc=$RC err=[$ERR]"
  fi
}
caseRungOversized

caseSymlinkedIndexJsonEscapedKey() {
  local repo
  r_repo repo "w2-r1-esc"
  # "profile" is the key "profile" once parsed; the raw text has no "profile" substring.
  printf '{"project":{"pro\\u0066ile":"kritis"}}\n' >"$repo/real-index.json"
  ln -s "$repo/real-index.json" "$repo/docs/product/index.json"
  resolve_rc_t "$repo"
  if [[ "$RC" -eq 2 && "$ERR" == *"docs/product/index.json"* ]]; then
    ok "02 R1: symlinked index.json declaring profile via a JSON escape -> exit 2 (parsed, not substring)"
  else
    bad "02 R1: JSON-escaped profile key behind a symlink gave rc=$RC out=[$OUT] err=[$ERR]"
  fi
}
caseSymlinkedIndexJsonEscapedKey
