#!/usr/bin/env bash
# cases/09-schema.sh — spec 011 Wave 9: the contract for Lumen,
# `a1-tools intent schema --json` (FR-035) and _shared/intent-contract.md
# (FR-036). Sourced by run-tests.sh.
#
# Every expectation below is a literal typed into this file (testing.md
# class 4): the key lists, the catalogs, the per-fixture accept/reject verdict
# and the golden's sha256. Nothing is imported from _shared/lib/.
#
# The independent validator is cases/mini-schema-validate.cjs (SC-009): its
# own frontmatter reader and its own draft-2020-12 subset; it shares no code
# with production. Limits it states in its header, repeated here: the
# executor-device condition of the approval group (FR-045), the realpath half
# of project_invalid, target_not_found and all authenticity rules are not
# expressible in JSON Schema, so K3 compares SCHEMA decisions only — a
# validator verdict counts as "reject" when its reasons contain one of
# schema_invalid, id_mismatch, action_unknown, project_invalid,
# target_invalid, oversized (the codes the schema and its x-file-rules
# express). The fixtures carry a placeholder signature, so the validator stops
# at signature_invalid / device_unknown after a passing shape stage and never
# reaches the environment stage (no realpath project_invalid can leak in).
#
# Golden: cases/09-schema.golden.v<N>.json is the frozen `intent schema --json`
# at x-contract-version N; G2 compares with the newest (v3, spec round 8),
# G3 keeps every released golden byte-frozen (v1 included). Regenerate it ONLY together with a bump of
# INTENT_CONTRACT_VERSION in _shared/lib/intent-schema.cjs, into a NEW file
# 09-schema.golden.v<N>.json, and add its sha256 pin to G3_PINS below in the
# same commit (pattern of spec 010 S12). A golden mismatch with an unchanged
# version is a test failure, by design.
#
# RED proof (CONVENTIONS.md) — the single production change that turns each
# case red, each measured on a `git archive HEAD` copy before commit:
#   G0  honouring any argument other than exactly `--json` (G0a–c).
#   G1  printing a hint on stdout, requiring executor.json, or writing any file.
#   G2  any change to the exported document without a new golden (e.g. a new
#       reject reason in status-constants.cjs).
#   G3  regenerating the v1 golden in place (G3a), or adding a golden without
#       a pin line (G3b).
#   K1  adding a key to the validator's key set only (the validator then
#       accepts a key the schema refuses: K3 red too), dropping a key from
#       INTENT_REQUIRED_KEYS, emitting the approval group without
#       dependentRequired, or listing a refusal code in a reason enum.
#   K2  a tenth action in the schema enum only; dropping cancelled_by_user
#       from INTENT_REJECT_REASONS; a render hint missing for one code.
#   K3  dropping additionalProperties: false (unknown-key diverges), a
#       pattern taken from anywhere but the validator's regex, the per-action
#       target rule missing (w9-13/14/16 diverge), or the validator widening a
#       rule the schema keeps.
#   K4  omitting `artifacts` from the result schema (RESULT_KEYS).
#   K5  editing a catalog without regenerating the contract's json blocks.
#   K6  a contract example that the code no longer reproduces (the canonical
#       string, the S1 vector, the target / CRLF / quoting rules).
#   K7  the action table leaking argv, a prompt, an allowlist or a mode.
#
# RED record (2026-09-28, before intent-schema.cjs existed: `intent schema`
# exited 2 "not implemented yet (wave 9)"): 36 of 41 cases red. Green by
# construction: G1b (0 spawns), K3c (control of the mini validator itself),
# K6d/K6f (the signing rules on the Wave 1–3 code the contract documents) and
# K7c (then vacuous; it now also requires the 9 action rows). Added after the
# first mutation run, each red under its mutation: K1h/K1i (limits: M34),
# rows w9-31..33 (nonce / created_by / id patterns: M22–M24), w9-34
# (approved_by_intent pattern: M33), w9-35 (payload byte cap: M35), K6g.
# w9-23 and w9-26 (complete approval group) stay red until Wave 10 admits
# the group in the validator (FR-045).

W9_ID="3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b"
W9_OTHER_ID="9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a"
W9_MINI="$SUITE_DIR/cases/mini-schema-validate.cjs"
W9_GOLDEN_DIR="$SUITE_DIR/cases"
W9_CONTRACT="$REPO_ROOT/_shared/intent-contract.md"

w9_sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

# w9_q <schema-file> <js-expression over `s`> — prints the expression's value
# (strings raw, everything else as JSON).
w9_q() {
  node -e '
    const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const v = (0, eval)("(s) => " + process.argv[2])(s);
    process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));' "$1" "$2" 2>&1
}

w9_expect_eq() { # name got want
  if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1" "want: ${3:0:400}" "got:  ${2:0:400}"; fi
}

# ---------- G0: usage ----------
new_sandbox w9g0
g0_bad=""
for args in "" "--yaml" "--json --pretty" "--json --json"; do
  # shellcheck disable=SC2086
  run_intent schema $args
  [[ $RC -eq 2 && -z "$OUT" && "$ERR" == "usage error: "* ]] || g0_bad="$g0_bad [${args:-<none>} -> $RC]"
done
if [[ -z "$g0_bad" ]]; then ok "G0 intent schema accepts exactly --json; anything else exit 2, no stdout [FR-035]"
else bad "G0 intent schema accepts exactly --json; anything else exit 2, no stdout [FR-035]" "$g0_bad" "stderr: ${ERR:0:200}"; fi

# ---------- G1: one JSON document, any host, writes nothing ----------
new_sandbox w9g1
g1_before="$(tree_listing "$VAULT" "$FHOME")"
run_intent schema --json
g1_after="$(tree_listing "$VAULT" "$FHOME")"
W9_SCHEMA="$WORK/w9-schema.json"
printf '%s\n' "$OUT" >"$W9_SCHEMA"
g1_json="$(node -e 'try { const o = JSON.parse(process.argv[1]); process.stdout.write(o && typeof o === "object" && !Array.isArray(o) ? "object" : "other"); } catch (e) { process.stdout.write("not-json"); }' "$OUT")"
if [[ $RC -eq 0 && "$g1_json" == "object" && -z "$ERR" && ! -e "$FHOME/.a1-intents/executor.json" && "$g1_before" == "$g1_after" ]]; then
  ok "G1 intent schema --json: exit 0 without executor.json, one JSON object on stdout, empty stderr, nothing written [FR-035, FR-017]"
else bad "G1 intent schema --json: exit 0 without executor.json, one JSON object on stdout, empty stderr, nothing written [FR-035, FR-017]" \
  "exit $RC, stdout $g1_json, stderr: ${ERR:0:200}" "$(diff <(printf '%s\n' "$g1_before") <(printf '%s\n' "$g1_after") | head -5)"; fi
g1_tr="$(grep -c '^spawn ' "$TRACE")"
w9_expect_eq "G1b intent schema spawns no child process [FR-035]" "$g1_tr" "0"

# ---------- G2/G3: golden, pinned by sha256 ----------
G3_PINS=(
  "09-schema.golden.v1.json d37415d302af143573c98e78f88c0bba98db33578191167de672173214c00b09"
  "09-schema.golden.v2.json 9b38059ab0f51700de73a42894196a57e3a33c123ef10aba511916014a547440"
  "09-schema.golden.v3.json 3ff97e41f80276ecd3d22e6da715b761af601f678bfafb1bfe480634ffb4df76"
)
if cmp -s "$SB/.out" "$W9_GOLDEN_DIR/09-schema.golden.v3.json" 2>/dev/null; then
  ok "G2 intent schema --json equals cases/09-schema.golden.v3.json byte for byte [FR-035]"
else bad "G2 intent schema --json equals cases/09-schema.golden.v3.json byte for byte [FR-035]" \
  "$(diff "$W9_GOLDEN_DIR/09-schema.golden.v3.json" "$SB/.out" 2>&1 | head -8)"; fi
for pin in "${G3_PINS[@]}"; do
  w9_expect_eq "G3a released golden ${pin%% *} is byte-frozen (sha256) [FR-035]" "$(w9_sha256 "$W9_GOLDEN_DIR/${pin%% *}" 2>/dev/null)" "${pin#* }"
done
g3_unpinned=""
for f in "$W9_GOLDEN_DIR"/09-schema.golden.v*.json; do
  [[ -f "$f" ]] || { g3_unpinned="(no golden file)"; continue; }
  g3_hit=""
  for pin in "${G3_PINS[@]}"; do [[ "${pin%% *}" == "$(basename "$f")" ]] && g3_hit=yes; done
  [[ -n "$g3_hit" ]] || g3_unpinned="$g3_unpinned $(basename "$f")"
done
w9_expect_eq "G3b every intent-schema golden has a sha256 pin in cases/09-schema.sh [FR-035]" "${g3_unpinned:-none}" "none"
w9_expect_eq "G3c x-contract-version is 3 (spec round 8) and x-vault-contract-version is spec 010's 1 [FR-035]" \
  "$(w9_q "$W9_SCHEMA" '[s["x-contract-version"], s["x-vault-contract-version"], s["$schema"]]')" \
  '[3,1,"https://json-schema.org/draft/2020-12/schema"]'

# ---------- K1: key parity ----------
K1_KEYS='["action","approved_at","approved_by_intent","approved_from_device","approved_via","created_at","created_by","id","nonce","payload","project","schema_version","signature","status","target","target_sha256","type"]'
K1_REQUIRED='["action","created_at","created_by","id","nonce","payload","project","schema_version","signature","status","type"]'
K1_REFUSAL='["already_claimed","already_moved","display_unsafe","executor_busy","ledger_busy","project_busy","rate_limited","result_path_unsafe"]'
w9_expect_eq "K1a schema.properties = the 17 note keys (12 + target_sha256 + the 4 approval keys) [FR-035, FR-001]" \
  "$(w9_q "$W9_SCHEMA" 'Object.keys(s.properties).sort()')" "$K1_KEYS"
w9_expect_eq "K1b schema.required = the 11 required keys, additionalProperties false [FR-035, FR-001]" \
  "$(w9_q "$W9_SCHEMA" '[[...s.required].sort(), s.additionalProperties]')" "[$K1_REQUIRED,false]"
w9_expect_eq "K1c dependentRequired ties each approval key to the other three [FR-035, FR-045]" \
  "$(w9_q "$W9_SCHEMA" 'Object.keys(s.dependentRequired).sort().map((k) => k + ":" + [...s.dependentRequired[k]].sort().join(","))')" \
  '["approved_at:approved_by_intent,approved_from_device,approved_via","approved_by_intent:approved_at,approved_from_device,approved_via","approved_from_device:approved_at,approved_by_intent,approved_via","approved_via:approved_at,approved_by_intent,approved_from_device"]'
w9_expect_eq "K1d x-refusal-codes = the 8 refusal codes, in no reason enum and no property enum [FR-035, FR-016]" \
  "$(w9_q "$W9_SCHEMA" '(() => { const r = s["x-refusal-codes"]; const enums = JSON.stringify([s.properties, s.$defs]); const inEnum = r.filter((c) => enums.includes(JSON.stringify(c))); return [[...r].sort(), inEnum]; })()')" \
  "[$K1_REFUSAL,[]]"
w9_expect_eq "K1e x-approval-keys = the 4 audit keys in signing order [FR-035, FR-045]" \
  "$(w9_q "$W9_SCHEMA" '[s["x-approval-keys"], s["x-canonical-signature-approval"]]')" \
  '[["approved_from_device","approved_at","approved_via","approved_by_intent"],["approved_from_device","approved_at","approved_via","approved_by_intent"]]'
w9_expect_eq "K1f x-canonical-signature = the 9 fields in order; approve adds target_sha256 [FR-035, FR-010]" \
  "$(w9_q "$W9_SCHEMA" '[s["x-canonical-signature"], s["x-canonical-signature-approve"]]')" \
  '[["schema_version","id","action","project","target","created_at","created_by","nonce","payload"],["target_sha256"]]'
K1_A1_ONLY='["cancelled_by_intent","claimed_at","claimed_by","exit_code","failure_reason","finished_at","rejected_at","rejected_by","rejected_reason","started_at"]'
w9_expect_eq "K1g \$defs.processed_intent adds exactly the 10 a1-only keys; status any of the 6 [FR-035, FR-008]" \
  "$(w9_q "$W9_SCHEMA" '(() => { const p = s.$defs.processed_intent; const extra = Object.keys(p.properties).filter((k) => !(k in s.properties)).sort(); return [extra, [...p.properties.status.enum].sort(), s.properties.status.const]; })()')" \
  "[$K1_A1_ONLY,[\"claimed\",\"done\",\"failed\",\"queued\",\"rejected\",\"running\"],\"queued\"]"

w9_expect_eq "K1h x-limits = the 12 default limits (never this process's overrides); x-file-rules caps and body [FR-035, FR-005]" \
  "$(w9_q "$W9_SCHEMA" '[s["x-limits"], s["x-file-rules"].max_bytes, s["x-file-rules"].payload_max_bytes, s["x-file-rules"].body, s["x-file-rules"].filename]')" \
  '[{"INTENT_MAX_BYTES":8192,"INTENT_PAYLOAD_MAX_BYTES":6144,"INTENT_FRESHNESS_MS":900000,"INTENT_CLOCK_SKEW_MS":120000,"INTENT_TIMEOUT_MS":1800000,"INTENT_KILL_GRACE_MS":10000,"INTENT_MAX_RUNS_PER_HOUR":6,"INTENT_CLAIMED_MAX_AGE_MS":21600000,"INTENT_RESULT_MAX_BYTES":16384,"INTENT_TICK_INTERVAL_S":30,"INTENT_CANCEL_POLL_MS":5000,"INTENT_MAX_OPEN_WORKTREES":3},8192,6144,"empty","<id>.md"]'
k1i_out="$(HOME="$FHOME" A1_INTENT_MAX_BYTES=4096 node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent schema --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s)["x-limits"].INTENT_MAX_BYTES));}catch(e){process.stdout.write("no-json");}})')"
w9_expect_eq "K1i with A1_INTENT_MAX_BYTES=4096 set, the export still publishes the default 8192 (pure function of the source) [FR-035, FR-046]" "$k1i_out" "8192"

# ---------- K2: enum parity + render hints ----------
K2_ACTIONS='["approve","cancel","continue-feature","execute","fix","new-feature","plan","progress","stage"]'
K2_REJECT='["action_unknown","approve_from_non_executor_device","cancelled_by_user","device_unknown","id_mismatch","intent_worktree_limit","ledger_unreadable","not_executor_host","oversized","project_invalid","replay","schema_invalid","signature_invalid","stale","tampered","target_invalid","target_not_found","workspace_not_isolated"]'
K2_FAILURE='["cancelled","expired","nonzero_exit","parent_step_failed","sandbox_invalid","spawn_error","timeout"]'
w9_expect_eq "K2a action enum = the 9 actions incl. approve, cancel; x-action-table names the same 9 [FR-035, FR-003]" \
  "$(w9_q "$W9_SCHEMA" '[[...s.properties.action.enum].sort(), Object.keys(s["x-action-table"]).sort()]')" "[$K2_ACTIONS,$K2_ACTIONS]"
w9_expect_eq "K2b rejected_reason enum = the 18 reject reasons [FR-035, FR-016]" \
  "$(w9_q "$W9_SCHEMA" '[[...s.$defs.rejected_reason.enum].sort(), s.$defs.rejected_reason.enum.length]')" "[$K2_REJECT,18]"
w9_expect_eq "K2c failure_reason enum = the 7 failure reasons [FR-035, FR-016]" \
  "$(w9_q "$W9_SCHEMA" '[[...s.$defs.failure_reason.enum].sort(), s.$defs.failure_reason.enum.length]')" "[$K2_FAILURE,7]"
w9_expect_eq "K2d every reject and failure code has a non-empty render hint, and no other code has one [FR-035, FR-036]" \
  "$(w9_q "$W9_SCHEMA" '["rejected_reason", "failure_reason"].map((d) => { const x = s.$defs[d]; const h = x["x-render-hints"]; return [Object.keys(h).sort().join(",") === [...x.enum].sort().join(","), x.enum.every((c) => typeof h[c] === "string" && h[c].trim() !== "")]; })')" \
  '[[true,true],[true,true]]'
w9_expect_eq "K2e the spec's render hints: device_unknown, signature_invalid, stale, workspace_not_isolated, intent_worktree_limit, sandbox_invalid, parent_step_failed [FR-036]" \
  "$(w9_q "$W9_SCHEMA" '[s.$defs.rejected_reason["x-render-hints"].device_unknown, s.$defs.rejected_reason["x-render-hints"].signature_invalid, s.$defs.rejected_reason["x-render-hints"].stale, s.$defs.rejected_reason["x-render-hints"].workspace_not_isolated, s.$defs.rejected_reason["x-render-hints"].intent_worktree_limit, s.$defs.failure_reason["x-render-hints"].sandbox_invalid, s.$defs.failure_reason["x-render-hints"].parent_step_failed].join(" | ")')" \
  'wartet auf Freigabe | wartet auf Freigabe | erneut senden | Intent-Worktree am Mac konnte nicht angelegt werden; Protokoll am Mac ansehen, dann erneut senden | zu viele offene Intent-Worktrees; am Mac prüfen und mit a1-worktree exit aufräumen, dann erneut senden | Sandbox-Prüfung am Mac fehlgeschlagen, `intent seal` prüfen | Prüfschritt am Mac fehlgeschlagen: Integritätsprüfung, xprov-Gate oder Postmortem; Protokoll am Mac ansehen'
w9_expect_eq "K2f processed_intent and result reference the same two catalogs [FR-035]" \
  "$(w9_q "$W9_SCHEMA" '[s.$defs.processed_intent.properties.rejected_reason, s.$defs.processed_intent.properties.failure_reason, s.$defs.result.properties.failure_reason]')" \
  '[{"$ref":"#/$defs/rejected_reason"},{"$ref":"#/$defs/failure_reason"},{"anyOf":[{"$ref":"#/$defs/failure_reason"},{"type":"null"}]}]'

# ---------- K3: SC-009 — the independent validator agrees with intent validate ----------
# <fixture>|<folder>|<file name: "id" = <W9_ID>.md>|<literal verdict>
K3_ROWS=(
  "valid.md|queued|id|accept"
  "oversized.md|queued|id|reject"
  "traversal-slug.md|queued|id|reject"
  "unknown-key.md|queued|id|reject"
  "w4-big-body.md|queued|id|reject"
  "w9-01-body.md|queued|id|reject"
  "w9-02-missing-nonce.md|queued|id|reject"
  "w9-03-action-unknown.md|queued|id|reject"
  "w9-04-id-mismatch.md|queued|$W9_OTHER_ID.md|reject"
  "w9-05-nonce-digits.md|queued|id|reject"
  "w9-06-nonce-digits-quoted.md|queued|id|accept"
  "w9-07-created-by-digits.md|queued|id|reject"
  "w9-08-created-by-digits-quoted.md|queued|id|accept"
  "w9-09-date-not-a-day.md|queued|id|reject"
  "w9-10-date-offset.md|queued|id|reject"
  "w9-11-status-claimed.md|queued|id|reject"
  "w9-12-a1-only-key.md|queued|id|reject"
  "w9-13-target-on-new-feature.md|queued|id|reject"
  "w9-14-continue-no-target.md|queued|id|reject"
  "w9-15-continue-target.md|queued|id|accept"
  "w9-16-target-null-new-feature.md|queued|id|reject"
  "w9-17-crlf.md|queued|id|accept"
  "w9-18-schema-version-string.md|queued|id|reject"
  "w9-19-type-wrong.md|queued|id|reject"
  "w9-20-payload-number.md|queued|id|reject"
  "w9-21-stage-target.md|queued|id|accept"
  "w9-22-approve-target.md|queued|id|reject"
  "w9-23-approval-tty.md|queued|id|accept"
  "w9-24-approval-partial.md|queued|id|reject"
  "w9-25-approval-tty-with-uuid.md|queued|id|reject"
  "w9-26-approval-intent.md|queued|id|accept"
  "w9-27-approval-via-phone.md|queued|id|reject"
  "w9-28-claimed.md|claimed|id|accept"
  "w9-29-rejected.md|rejected|id|accept"
  "w9-30-rejected-status-bogus.md|rejected|id|reject"
  "w9-31-nonce-short.md|queued|id|reject"
  "w9-32-created-by-form.md|queued|id|reject"
  "w9-33-id-not-v4.md|queued|3f2b8c1e-5d4a-1e6f-9a7b-1c2d3e4f5a6b.md|reject"
  "w9-34-approval-intent-not-uuid.md|queued|id|reject"
  "w9-35-payload-over-cap.md|queued|id|reject"
  "w9-36-approve-bound.md|queued|id|accept"
  "w9-37-sha-on-new-feature.md|queued|id|reject"
  "w9-38-sha-bad-form.md|queued|id|reject"
  "w9-39-claimed-by-bad.md|claimed|id|reject"
  "w9-40-rejected-reason-bogus.md|rejected|id|reject"
)
K3_SCHEMA_REASONS=",schema_invalid,id_mismatch,action_unknown,project_invalid,target_invalid,oversized,"
k3_verdict_of() { # stdout of intent validate -> accept|reject|<error>
  node -e '
    let o; try { o = JSON.parse(process.argv[1]); } catch (e) { process.stdout.write("no-json"); process.exit(0); }
    const set = process.argv[2];
    process.stdout.write(o.reasons.some((r) => set.includes("," + r + ",")) ? "reject" : "accept");' "$1" "$K3_SCHEMA_REASONS"
}
new_sandbox w9k3
k3_bad=""
k3_n=0
for row in "${K3_ROWS[@]}"; do
  IFS='|' read -r k3_file k3_folder k3_name k3_want <<<"$row"
  [[ "$k3_name" == "id" ]] && k3_name="$W9_ID.md"
  rm -f "$VAULT"/inbox/intents/*/*.md
  k3_path="$VAULT/inbox/intents/$k3_folder/$k3_name"
  cp "$SUITE_DIR/vault/$k3_file" "$k3_path"
  run_intent validate "$k3_path"
  k3_v="$(k3_verdict_of "$OUT")"
  k3_m="$(node "$W9_MINI" "$W9_SCHEMA" "$k3_folder" "$k3_path" 2>&1)"
  k3_n=$((k3_n + 1))
  if [[ "$k3_v" != "$k3_want" || "${k3_m%% *}" != "$k3_want" ]]; then
    k3_bad="$k3_bad [$k3_file: want $k3_want, validate $k3_v ($(printf '%s' "$OUT" | tr -d '\n ' | cut -c1-80)), mini $k3_m]"
  fi
done
if [[ -z "$k3_bad" && $k3_n -eq 45 ]]; then ok "K3 SC-009: on all 45 fixture intents the independent validator and intent validate give the literal schema verdict [FR-035, SC-009]"
else bad "K3 SC-009: on all 45 fixture intents the independent validator and intent validate give the literal schema verdict [FR-035, SC-009]" "rows: $k3_n" "$k3_bad"; fi
k3_ctrl="$(node -e '
  const m = require(process.argv[1]);
  const s = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
  const loose = JSON.parse(JSON.stringify(s)); delete loose.additionalProperties;
  const t = require("fs").readFileSync(process.argv[3], "utf8");
  process.stdout.write([m.checkIntentFile(s, process.argv[4], t, "queued").accept, m.checkIntentFile(loose, process.argv[4], t, "queued").accept].join(","));' \
  "$W9_MINI" "$W9_SCHEMA" "$SUITE_DIR/vault/unknown-key.md" "$W9_ID.md" 2>&1)"
w9_expect_eq "K3b control: the mini validator refuses unknown-key.md only because of additionalProperties false [FR-035, SC-009]" "$k3_ctrl" "false,true"
k3_unsup="$(node -e '
  const m = require(process.argv[1]);
  try { m.validate({ minLength: 1 }, "x"); process.stdout.write("accepted"); } catch (e) { process.stdout.write("refused"); }' "$W9_MINI" 2>&1)"
w9_expect_eq "K3c control: a keyword the mini validator does not implement fails loudly, never passes unchecked [FR-035, SC-009]" "$k3_unsup" "refused"

# ---------- K4: result-note schema ----------
K4_KEYS='["action","artifacts","branch","duration_s","executor_host","exit_code","failure_reason","finished_at","intent_id","project","schema_version","started_at","status","target","truncated","type","worktree_path"]'
w9_expect_eq "K4a \$defs.result.properties = the 17 result-note keys, all required, additionalProperties false [FR-035, FR-030]" \
  "$(w9_q "$W9_SCHEMA" '[Object.keys(s.$defs.result.properties).sort(), [...s.$defs.result.required].sort(), s.$defs.result.additionalProperties]')" \
  "[$K4_KEYS,$K4_KEYS,false]"
new_sandbox w9k4
k4_note="$SB/result.md"
printf '%s\n' '---' 'type: intent-result' 'schema_version: 1' "intent_id: $W9_ID" 'action: new-feature' 'project: real-proj' \
  'target: null' 'status: failed' 'failure_reason: timeout' 'started_at: 2026-09-24T12:01:00.000Z' 'finished_at: 2026-09-24T12:31:00.000Z' \
  'duration_s: 1800' 'exit_code: null' 'executor_host: mac-host' 'branch: intent/0e4f7f0a-0000-4000-8000-000000000000' \
  'worktree_path: "~/claude-projects/a1-worktrees/real-proj-intent-0e4f7f0a-0000-4000-8000-000000000000"' 'artifacts: []' 'truncated: false' '---' >"$k4_note"
k4_got="$(node -e '
  const m = require(process.argv[1]);
  const s = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
  const text = require("fs").readFileSync(process.argv[3], "utf8").replace("artifacts: []\n", "");
  const fm = { ...m.readFrontmatter(text).fm, artifacts: ["project/real-proj/spec/012-push.md"] };
  const r = { ...s.$defs.result, $defs: s.$defs };
  const bad = { ...fm, failure_reason: "already_claimed" };
  const noArt = { ...fm }; delete noArt.artifacts;
  process.stdout.write([m.validate(r, fm).length, m.validate(r, bad).length > 0, m.validate(r, noArt).length > 0].join(","));' \
  "$W9_MINI" "$W9_SCHEMA" "$k4_note" 2>&1)"
w9_expect_eq "K4b a result note in FR-030 form validates; a refusal code as failure_reason or a missing artifacts does not [FR-035, FR-030]" "$k4_got" "0,true,true"

# ---------- K5: the contract document matches the schema ----------
# w9_block <marker> — the fenced block right after "<!-- contract:<marker> -->".
w9_block() {
  node -e '
    const t = require("fs").readFileSync(process.argv[1], "utf8");
    const i = t.indexOf("<!-- contract:" + process.argv[2] + " -->");
    if (i < 0) { process.stdout.write("<no marker " + process.argv[2] + ">"); process.exit(0); }
    const m = /```[a-z]*\n([\s\S]*?)```/.exec(t.slice(i));
    process.stdout.write(m ? m[1] : "<no block>");' "$W9_CONTRACT" "$1" 2>&1
}
w9_json_norm() { node -e 'try { process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]))); } catch (e) { process.stdout.write("<not json: " + e.message + ">"); }' "$1"; }
w9_expect_eq "K5a contract json block 'actions' = schema action enum [FR-036]" \
  "$(w9_json_norm "$(w9_block actions)")" "$(w9_q "$W9_SCHEMA" 's.properties.action.enum')"
w9_expect_eq "K5b contract json block 'rejected-reasons' = schema rejected_reason codes + hints [FR-036]" \
  "$(w9_json_norm "$(w9_block rejected-reasons)")" "$(w9_q "$W9_SCHEMA" 's.$defs.rejected_reason["x-render-hints"]')"
w9_expect_eq "K5c contract json block 'failure-reasons' = schema failure_reason codes + hints [FR-036]" \
  "$(w9_json_norm "$(w9_block failure-reasons)")" "$(w9_q "$W9_SCHEMA" 's.$defs.failure_reason["x-render-hints"]')"
w9_expect_eq "K5d contract json block 'refusal-codes' = schema x-refusal-codes [FR-036]" \
  "$(w9_json_norm "$(w9_block refusal-codes)")" "$(w9_q "$W9_SCHEMA" 's["x-refusal-codes"]')"
w9_expect_eq "K5e contract json block 'never-written' names the 10 a1-only keys and the 4 approval keys [FR-036]" \
  "$(w9_json_norm "$(w9_block never-written)")" \
  '["claimed_by","claimed_at","started_at","finished_at","exit_code","rejected_reason","rejected_by","rejected_at","failure_reason","cancelled_by_intent","approved_from_device","approved_at","approved_via","approved_by_intent"]'
w9_expect_eq "K5f contract folder block lists exactly queued claimed done rejected [FR-036]" \
  "$(w9_block folders | tr -s ' \n' ' ' | sed 's/ $//')" "inbox/intents/queued/ inbox/intents/claimed/ inbox/intents/done/ inbox/intents/rejected/"
k5_text="$(cat "$W9_CONTRACT" 2>/dev/null)"
k5_bad=""
for needle in "an intent is a request, never a status" 'project/<slug>/intents/<id>.md' '$A1_VAULT_ROOT/project/a1-specforge/spec/' \
  'docs/product/index.json' '.a1/phases/*/STATUS.md' 'innerHTML' '## Deltas D1–D4'; do
  [[ "$k5_text" == *"$needle"* ]] || k5_bad="$k5_bad [$needle]"
done
w9_expect_eq "K5g contract states the request-not-status rule with its sources, the result path, the Lumen CLAUDE.md path, the untrusted-JSON rule and D1–D4 [FR-036]" "${k5_bad:-none}" "none"

# Spec round 6 (FR-036): the secret-storage rule, the untrusted-input rule
# over every folder Lumen reads, escaped rendering, no approval chains.
k5h_untrusted="$(node -e '
  const t = require("fs").readFileSync(process.argv[1], "utf8");
  const i = t.indexOf("## Treat everything you read as untrusted input"); const j = t.indexOf("\n## ", i + 5);
  process.stdout.write(i < 0 ? "" : t.slice(i, j));' "$W9_CONTRACT" 2>&1)"
k5h_bad=""
for needle in '`queued/`' '`claimed/`' '`done/`' '`rejected/`' 'project/<slug>/intents/' 'project/<slug>/product/' 'project/<slug>/phases/' 'innerHTML' 'code execution on' 'never raw' 'Markdown renderer'; do
  [[ "$k5h_untrusted" == *"$needle"* ]] || k5h_bad="$k5h_bad [untrusted: $needle]"
done
for needle in '## Where device secrets may live' 'data.json' 'saveData' 'localStorage' 'secure storage' 'base64url' 'secret_in_vault' 'target_sha256' 'display_unsafe' 'are never approval targets'; do
  [[ "$k5_text" == *"$needle"* ]] || k5h_bad="$k5h_bad [$needle]"
done
w9_expect_eq "K5h contract round 6: secrets never under the vault (data.json, localStorage), doctor scan forms, untrusted rule over all folders, escaped rendering, target_sha256, no approval chains [FR-036, FR-011]" "${k5h_bad:-none}" "none"

# Re-review n6a: the display rule the contract publishes is a1's rule. Every
# code point range the contract lists as display-unsafe (both ends), one
# sample per named category, a run of three marks and an over-cap payload
# make readApprovalTarget refuse display_unsafe on a queued/ target; the
# controls (plain text, umlauts, two marks) pass; terminalSafe escapes the
# spaces and controls the contract names and keeps printable text raw.
new_sandbox w9k5i
k5i_out="$(A1_VAULT_ROOT="$VAULT" HOME="$FHOME" node -e '
  const fs = require("fs"); const path = require("path");
  const [lib, doc, vault] = process.argv.slice(1);
  const { readApprovalTarget, terminalSafe } = require(lib + "/intent-approve.cjs");
  const text = fs.readFileSync(doc, "utf8");
  const i = text.indexOf("A target is\n  display-unsafe when"); const j = text.indexOf("whole.", i);
  const cps = [];
  for (const m of text.slice(i, j).matchAll(/U\+([0-9A-F]{4,5})(?:–U\+([0-9A-F]{4,5}))?/g)) {
    cps.push(parseInt(m[1], 16)); if (m[2]) cps.push(parseInt(m[2], 16));
  }
  const q = path.join(vault, "inbox/intents/queued");
  const id = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
  const verdict = (payload) => {
    const f = path.join(q, id + ".md");
    const body = payload.split("\n").map((l) => "  " + l).join("\n");
    fs.writeFileSync(f, "---\ntype: intent\nschema_version: 1\nid: " + id + "\naction: new-feature\nproject: real-proj\npayload: |\n" + body + "\ncreated_at: 2026-09-24T12:00:00.000Z\ncreated_by: pixel-robert\nnonce: 0f1e2d3c4b5a69788796a5b4c3d2e1f0\nstatus: queued\nsignature: hmac-sha256:" + "0".repeat(64) + "\n---\n");
    const r = readApprovalTarget(f, { vault });
    return r.ok ? "ok" : r.reason;
  };
  const listed = cps.filter((cp) => verdict("a" + String.fromCodePoint(cp) + "b") !== "display_unsafe").map((cp) => cp.toString(16));
  const samples = [0x200b, 0xe000, 0x0378, 0x2028, 0x2029, 0x202e].filter((cp) => verdict("a" + String.fromCodePoint(cp) + "b") !== "display_unsafe").map((cp) => cp.toString(16));
  const marks = [verdict("á́́"), verdict("á́")].join("/");
  const cap = verdict("x".repeat(6145));
  const controls = [verdict("ok"), verdict("Äpfel für 3 € — gut!")].join("/");
  const esc = [" ", "　", "‮", "\t", "Ä€!", "\\"].map((s) => terminalSafe(s)).join(" ");
  process.stdout.write([cps.length, "[" + listed.join(",") + "]", "[" + samples.join(",") + "]", marks, cap, controls, esc].join("|"));' \
  "$INTENT_LIB" "$W9_CONTRACT" "$VAULT" 2>&1)"
w9_expect_eq "K5i the contract's display-unsafe list is a1's: every listed range end, Cf/Co/Cn/Zl/Zp/bidi samples, 3 marks, over-cap -> display_unsafe; escapes as documented [FR-036, FR-015]" \
  "$k5i_out" '39|[]|[]|display_unsafe/ok|display_unsafe|ok/ok|\u{a0} \u{3000} \u{202e} \u{9} Ä€! \\'

# ---------- K6: every worked example of the contract runs against the code ----------
# The canonical string of vault/valid.md, the S1 vector (independently with
# openssl, key as raw bytes), the target / CRLF / quoting rules.
new_sandbox w9k6
k6_canon_doc="$(w9_block example-canonical)"
k6_canon_code="$(node -e '
  const { parseIntentFrontmatter } = require(process.argv[1] + "/intent-validate.cjs");
  const { canonicalString } = require(process.argv[1] + "/intent-sign.cjs");
  process.stdout.write(canonicalString(parseIntentFrontmatter(require("fs").readFileSync(process.argv[2], "utf8")).fm) + "\n");' \
  "$INTENT_LIB" "$SUITE_DIR/vault/valid.md" 2>&1)"
w9_expect_eq "K6a the contract's canonical-string example is what canonicalString builds for vault/valid.md [FR-036, FR-010]" "$k6_canon_doc" "$k6_canon_code"
k6_s1_doc="$(w9_block example-s1 | tr -d '\n')"
k6_s1_openssl="$(printf '%s' "${k6_canon_code%$'\n'}" | openssl dgst -sha256 -mac HMAC -macopt hexkey:0000000000000000000000000000000000000000000000000000000000000001 2>&1 | awk '{print $NF}')"
w9_expect_eq "K6b the contract's S1 vector: openssl with the key as 32 raw bytes gives the frozen 18aa9d63…6bafb0 [FR-036, FR-010]" \
  "$k6_s1_doc|$k6_s1_openssl" "18aa9d63d9cd70dac2bc0c8177b2d32e2587327e951fef71ff9bae77696bafb0|18aa9d63d9cd70dac2bc0c8177b2d32e2587327e951fef71ff9bae77696bafb0"
k6_hextext="$(printf '%s' "${k6_canon_code%$'\n'}" | openssl dgst -sha256 -hmac 0000000000000000000000000000000000000000000000000000000000000001 2>&1 | awk '{print $NF}')"
[[ "$k6_hextext" != "18aa9d63d9cd70dac2bc0c8177b2d32e2587327e951fef71ff9bae77696bafb0" && ${#k6_hextext} -eq 64 && "$(w9_block example-s1-wrong | tr -d '\n')" == "$k6_hextext" ]] \
  && ok "K6c the contract's wrong-key example (hex text as key, openssl -hmac) differs from S1 and is reproduced [FR-036]" \
  || bad "K6c the contract's wrong-key example (hex text as key, openssl -hmac) differs from S1 and is reproduced [FR-036]" "openssl -hmac: $k6_hextext" "doc: $(w9_block example-s1-wrong)"
k6_rules="$(node -e '
  const { canonicalString } = require(process.argv[1] + "/intent-sign.cjs");
  const { parseIntentFrontmatter } = require(process.argv[1] + "/intent-validate.cjs");
  const base = { schema_version: 1, id: "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b", action: "new-feature", project: "real-proj", created_at: "2026-09-24T12:00:00.000Z", created_by: "pixel-robert", nonce: "0f1e2d3c4b5a69788796a5b4c3d2e1f0", payload: "a\nb\n" };
  const absent = canonicalString(base);
  const same = [canonicalString({ ...base, target: null }), canonicalString({ ...base, target: "" })].every((c) => c === absent);
  const lf = parseIntentFrontmatter("---\npayload: |\n  a\n  b\n---\n").fm;
  const crlf = parseIntentFrontmatter("---\r\npayload: |\r\n  a\r\n  b\r\n---\r\n").fm;
  const crlfSame = canonicalString({ ...base, payload: crlf.payload }) === absent && lf.payload === crlf.payload;
  const num = parseIntentFrontmatter("---\nnonce: 12345678901234567890123456789012\n---\n").fm.nonce;
  const str = parseIntentFrontmatter("---\nnonce: \"12345678901234567890123456789012\"\n---\n").fm.nonce;
  process.stdout.write([same, crlfSame, typeof num, typeof str, absent.split("\n").pop()].join(","));' "$INTENT_LIB" 2>&1)"
k6_payload_hash="$(printf 'a\nb\n' | openssl dgst -sha256 | awk '{print $NF}')"
w9_expect_eq "K6d rules: target absent/null/\"\" one string; CRLF payload hashes as LF; an unquoted all-digit nonce is a number, a quoted one a string [FR-036, FR-010]" \
  "$k6_rules" "true,true,number,string,$k6_payload_hash"
w9_expect_eq "K6e the contract's payload-hash example is sha256 of the LF-decoded block scalar [FR-036]" "$(w9_block example-payload-hash | tr -d '\n')" "$k6_payload_hash"
# The quoting rule end to end: the two nonce fixtures, validated in a sandbox.
k6_q=""
for f in w9-05-nonce-digits.md w9-06-nonce-digits-quoted.md; do
  rm -f "$Q"/*.md; cp "$SUITE_DIR/vault/$f" "$Q/$W9_ID.md"; run_intent validate "$Q/$W9_ID.md"
  k6_q="$k6_q$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).reasons.join("+"))' "$OUT" 2>&1);"
done
w9_expect_eq "K6f unquoted digits nonce -> schema_invalid; quoted -> passes the shape stage (signature_invalid, placeholder) [FR-036, FR-007]" "$k6_q" "schema_invalid;signature_invalid;"

# The example intent of the contract, signed with 00…01 as pixel-robert:
# every rule passes but freshness (created_at is in the past) -> exactly
# `stale`; the mini validator accepts it; its nonce and created_by are quoted.
k6_ex="$(w9_block example-intent)"
rm -f "$Q"/*.md
printf '%s' "$k6_ex" >"$Q/$W9_ID.md"
printf '{"devices":{"pixel-robert":{"secret_hex":"0000000000000000000000000000000000000000000000000000000000000001","created_at":"2026-09-24T12:00:00.000Z","revoked_at":null}}}\n' >"$FHOME/.a1-intents/devices.json"
chmod 600 "$FHOME/.a1-intents/devices.json"
mk_project real-proj
run_intent validate "$Q/$W9_ID.md"
k6_ex_v="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).reasons.join("+"))' "$OUT" 2>&1)"
k6_ex_m="$(node "$W9_MINI" "$W9_SCHEMA" queued "$Q/$W9_ID.md" 2>&1)"
k6_ex_q="$(grep -c '^nonce: "\|^created_by: "' "$Q/$W9_ID.md")"
w9_expect_eq "K6g the contract's example intent: intent validate says exactly stale (signature verifies), the schema accepts it, nonce and created_by quoted [FR-036, FR-010]" \
  "$k6_ex_v|$k6_ex_m|$k6_ex_q" "stale|accept|2"

# The approve example (ten fields): the doc's canonical string is what
# canonicalString builds for vault/w10-approve-vector.md, its HMAC is what
# openssl computes with the key as raw bytes, and its target_sha256 is the
# sha256 of the illustrated target bytes "test".
k6h_code="$(node -e '
  const { parseIntentFrontmatter } = require(process.argv[1] + "/intent-validate.cjs");
  const { canonicalString } = require(process.argv[1] + "/intent-sign.cjs");
  process.stdout.write(canonicalString(parseIntentFrontmatter(require("fs").readFileSync(process.argv[2], "utf8")).fm) + "\n");' \
  "$INTENT_LIB" "$SUITE_DIR/vault/w10-approve-vector.md" 2>&1)"
k6h_hmac="$(printf '%s' "${k6h_code%$'\n'}" | openssl dgst -sha256 -mac HMAC -macopt hexkey:0000000000000000000000000000000000000000000000000000000000000001 2>&1 | awk '{print $NF}')"
k6h_target="$(printf 'test' | openssl dgst -sha256 | awk '{print $NF}')"
w9_expect_eq "K6h the contract's approve example: ten-field string = canonicalString, HMAC = openssl hexkey, target_sha256 = sha256(test) [FR-036, FR-010]" \
  "$(w9_block example-approve-canonical)|$(w9_block example-approve-hmac | tr -d '\n')|$(w9_block example-approve-canonical | sed -n 10p)" \
  "$k6h_code|$k6h_hmac|$k6h_target"
w9_expect_eq "K6i the approve example's HMAC is the frozen literal 8967784a…f0c2d0 [FR-036]" "$k6h_hmac" "8967784a322df31cd2e16fcf6d6d4c87c0d88200b115fc4d2fc7a61303f0c2d0"

# ---------- K7: the phone-visible action table only ----------
w9_expect_eq "K7a x-action-table rows carry exactly kind, target_required, target_pattern, executor_device_only, target_sha256_required [FR-035, FR-003]" \
  "$(w9_q "$W9_SCHEMA" '[...new Set(Object.values(s["x-action-table"]).map((r) => Object.keys(r).sort().join(",")))]')" \
  '["executor_device_only,kind,target_pattern,target_required,target_sha256_required"]'
w9_expect_eq "K7b x-action-table: kinds, target rules and the executor-only approve [FR-035, FR-006]" \
  "$(w9_q "$W9_SCHEMA" 'Object.entries(s["x-action-table"]).sort().map(([a, r]) => a + ":" + r.kind + ":" + r.target_required + ":" + r.executor_device_only + ":" + r.target_sha256_required + ":" + (r.target_pattern || "-")).join(" ")')" \
  'approve:queue-control:true:true:true:^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ cancel:queue-control:true:false:false:^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ continue-feature:claude:true:false:false:^\d{3}-[a-z0-9][a-z0-9-]*$ execute:claude:true:false:false:^M\d+-P\d+-[a-z0-9][a-z0-9-]*$ fix:claude:false:false:false:- new-feature:claude:false:false:false:- plan:claude:true:false:false:^M\d+-P\d+-[a-z0-9][a-z0-9-]*$ progress:claude:false:false:false:- stage:cli:true:false:false:^\d{3}-[a-z0-9][a-z0-9-]*:(started|complete|review|verify|merge|origin-cleanup|done)$'
k7_leak=""
for needle in allowedTools allowed_tools argv prompt dontAsk permission a1Tools /a1-specforge: Bash Write stdin; do
  grep -qF -- "$needle" "$W9_SCHEMA" && k7_leak="$k7_leak [$needle]"
done
k7_rows="$(w9_q "$W9_SCHEMA" 'Object.keys(s["x-action-table"]).length')"
w9_expect_eq "K7c the export (9 action rows) names no argv, prompt, tool allowlist, permission mode, skill or payload channel [FR-035]" "${k7_leak:-none} $k7_rows" "none 9"
