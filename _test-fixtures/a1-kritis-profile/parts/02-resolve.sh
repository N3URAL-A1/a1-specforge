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
  sed -i '/^status: active$/a profile: kritis' "$repo/docs/product/ROADMAP.md"
  out="$(env -u A1_VAULT_ROOT node "$TOOLS" product validate --dir "$repo/docs/product" 2>"$repo/err")"
  local rc_ok=$?
  sed -i 's/^profile: kritis$/profile: kritiss/' "$repo/docs/product/ROADMAP.md"
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

# ---------- hostile: --spec path traversal is refused, not followed outside the vault ----------
caseHostileSpecTraversal() {
  local repo
  r_repo repo "w2-hspec"
  node "$TOOLS" profile resolve --spec "../../../../etc/passwd" --repo-root "$repo" >"$repo/out" 2>"$repo/err"
  local rc=$?
  if [[ "$rc" -eq 2 ]]; then
    ok "02 hostile: --spec path traversal (../../../../etc/passwd) refused, exit 2"
  else
    bad "02 hostile: --spec path traversal was not refused as expected (rc=$rc)"
  fi
  rm -rf "$repo"
}
caseHostileSpecTraversal

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
  local long out
  long="/tmp/$(head -c 10000 /dev/zero | tr '\0' 'x')"
  out="$(timeout 10 node "$TOOLS" profile resolve --repo-root "$long" 2>&1)"
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
