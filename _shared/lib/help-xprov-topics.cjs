'use strict';

// help-xprov-topics — the routing and edge-cases text of a1-plan 04b (spec 027 slice 5, FR-028, D5), moved out of the
// workflow and printed by `a1-tools xprov --help <topic>`. A data module: no exit path, requires nothing.
// Topic format: two-space indent, prose wrapped at 120, no prose line over 140; command lines are never wrapped.

/**
 * @type {{ routing: string, 'edge-cases': string }} the two topics: `routing` (notice lines, warning/halt block, round cap and
 *   dispositions, the per-reason `not_applicable` detail) and `edge-cases` (the 04b Edge-cases section).
 */
const XPROV_TOPICS_MAIN = Object.freeze({
  routing: `  Notice lines, one per case (print exactly one, then continue):
  - \`not_applicable\` / \`external_review_denied\`: \`ℹ Cross-provider plan review not applicable — the owner denied
    external review for this repository (gate plan-review-xprov); continuing.\`
  - \`codex_blocked_fallback\`: \`ℹ Cross-provider plan review not applicable — Codex answered BLOCKED twice (gate
    plan-review-xprov); the Reinhard review is the only review for this plan, continuing.\`
  - \`codex_unavailable\`: \`ℹ Cross-provider plan review not applicable — the Codex run failed (usage limit or runner
    error; gate plan-review-xprov); the Claude-only review is the review for this plan, continuing.\`
  - \`external_review_not_permitted\`: \`ℹ Cross-provider plan review not applicable — no Codex permit for this repository
    (gate plan-review-xprov); Reinhard-only, continuing.\`
  - \`permit_state\` \`origin_changed\` or \`unbound_legacy\`: \`ℹ Codex review skipped: permit void (<permit_state>) — the
    owner should re-consent; Reinhard-only, continuing.\`
  Detail of each \`not_applicable\` reason (exit 1, any enforcement). Continue in every case, never halt:
  - \`external_review_denied\`: the owner recorded that no external review applies to this repository (a chat No or \`xprov
    permit --deny\`, confirmed by the owner's store). Print the notice and treat the plan as ready; no Codex call
    happened. The retro records \`verdict: not_applicable\` and the issue tag \`xprov_not_applicable\`. A record the owner's
    store does not confirm (\`external_review_denial_mismatch\`, \`external_review_permit_mismatch\`) is a \`fail\`, not this
    row.
  - \`external_review_not_permitted\`: the repository has no permit and the owner gave none (never asked, No, unanswered,
    or no chat: \`xprov --help consent\`). Print the no-permit notice and treat the plan as ready with the Reinhard review
    only; no Codex call happened. The retro records \`verdict: not_applicable\` and the issue tag \`xprov_not_applicable\`.
  - \`codex_blocked_fallback\`: Codex answered BLOCKED twice (the gate repeated the run once by itself, spec 016 FR-026).
    Print the blocked notice: the Reinhard review is the only review for this plan. No consent question is asked. \`xprov
    load-check\` accepts it (\`accepted: "codex_blocked_fallback"\`) for this PLAN.md sha. The retro records \`verdict:
    not_applicable\` with the reason \`codex_blocked_fallback\` and the issue tag \`xprov_not_applicable\`.
  - \`codex_unavailable\`: the Codex run itself failed — usage limit, transport error or timeout, after the gate's bounded
    retries (spec 025 FR-019). No waiver, no owner question. Print the unavailable notice: the Claude-only review
    (Reinhard; Samuel when the security surface is touched) is the review for this plan. \`xprov load-check\` accepts it
    (\`accepted: "codex_unavailable"\`) for this PLAN.md sha. The retro records \`{id: plan-review-xprov, verdict:
    not_applicable, caught: false}\` with the reason \`codex_unavailable\` and the issue tag \`xprov_not_applicable\`. A
    model pin conflict or an effort value the Codex CLI rejects is not this row: it stays \`fail\` / \`preflight_failed\`
    (the isolated config pins only \`model\`; remove a foreign \`model_reasoning_effort\` from it); so do \`tripwire\`,
    \`secret_in_snapshot\` and every other preflight failure.
  - \`secret_declined\`: a secret hit sat in a changed line and the owner declined the allowlist question (or gave no
    answer, or there is no chat; \`xprov --help waiver\`, item 4). Reinhard is the only review; nothing was sent. \`xprov
    load-check\` accepts it (\`accepted: "secret_declined"\`). The retro records \`verdict: not_applicable\` with the reason
    \`secret_declined\` and the issue tag \`xprov_not_applicable\`.
  Warning / halt block for a \`fail\` (any \`reason\`) — same text, only the first line differs:
       ⚠ Cross-provider plan review did not pass (gate plan-review-xprov, enforcement: warning)
          reason:   <reason>
          details:  <xreview_path> (section for this round)
          The pipeline continues because the registry row is still \`warning\`;
          a1-execute will print the same warning at Load until a pass entry exists.
  For \`blocking\` the first line reads \`❌ … enforcement: blocking — execution is not permitted until this passes or a
  human waives it.\` With \`warning\`, treat the plan as ready with the warning attached to the summary; the retro records
  \`verdict: fail\`. With \`blocking\`, HALT: print the block as an error, do not suggest \`a1-execute\`, and surface the
  \`reason\` and the two ways out: fix the cause (for example \`preflight_failed\`, \`not_logged_in\`,
  \`external_review_permit_mismatch\`) and re-run Step 1, or an owner waiver by chat (\`xprov --help waiver\`).
  \`round_cap\` is a \`fail\` like any other: it means two review rounds completed without APPROVED — never start a third
  round. Dispositions (spec 016 FR-025). When round 2 holds NO blocker (only major, minor or quarantined findings),
  write the host dispositions file \`xreview/plan-review-xprov-plan-r2.dispositions.md\` (the path is
  \`next.dispositions_path\` of round 1 with \`r2\`), one line per finding id of round 2: \`<id>: fixed: <what changed>\` or
  \`<id>: accepted: <reason>\` (non-empty, one line, no secret, no instruction). Then run
       XREVIEW_DIR=".a1/phases/<phase_name>/xreview"
       node <repo>/_shared/a1-tools.cjs xprov dispose --phase <phase_name> --gate plan-review-xprov > "$XREVIEW_DIR/dispose.last-run.json"; RC=$?
       echo "xprov dispose exit=$RC"
  Exit 0: the plan is ready (\`xprov load-check\` accepts \`accepted: "dispositions"\` for the current PLAN.md sha); the
  retro records \`verdict: fail\` with the issue tag \`xprov_disposed\`. Exit 1 with \`refused: blocker_open\` keeps the hard
  stop (only an owner waiver leads on); \`refused: undisposed\` names the ids without a usable line: fix the file once, or
  the target goes to the per-phase waiver question (\`xprov --help waiver\`). Any other refusal: surface it, do not retry
  blindly. Without the file or with a BLOCKER, surface \`round_cap\` to the user as a stop.`,
  'edge-cases': `  - **Exit 2 (usage / module not shipped).** No stdout JSON. Do not route; fix the call or install the plugin version
    that ships \`xprov-gate.cjs\`.
  - **\`tripwire\`, \`secret_in_snapshot\`, \`secret_in_output\`, \`quarantined\`.** The result was discarded by design;
    XREVIEW.md carries a BLOCKER note. Treat as \`fail\` per the routing table — and read the note before re-running, the
    cause is in the checkout, not in the plan.
  - **PLAN.md edited after a pass** (e.g. a manual touch-up). The pass entry's \`plan_sha256\` no longer matches;
    a1-execute's Load check reports \`plan_review_missing\`. Re-run Step 1 — do not hand-edit \`index.json\`.
  - **Delta review and exclusion (spec 016 FR-029, FR-030).** After a PASSED plan review a changed PLAN.md goes out as a
    delta: frontmatter, Goal, Success Criteria and the changed sections (a1 keeps the approved text as \`a1-plan.md\` in
    the pass run dir; without it the review is full). A whitespace- or heading-only edit sends nothing: the gate returns
    \`pass\` with \`delta.kind: cosmetic\` and \`load-check\` reports \`carried_from\`.
  - **Multi-lane plans.** One review of the whole PLAN.md.
  - **Self-recovery (spec 016 FR-024..028, FR-031).** The gate repairs four failures by itself and says so in \`recovery\`
    (stdout) and in the run's line of \`.a1/phases/<phase>/observations.jsonl\` (\`recovered\` plus \`recovery\`: action, ok,
    attempt count; always written), and, with \`A1_KEEP_REVIEW_LOGS=1\`, in the log entry of \`PLAN-REVIEW-LOG.md\`: a
    \`runner_failed\` caused by network, timeout or an HTTP 5xx answer is retried twice (30 s, then 120 s; every attempt
    is listed); a \`blocked\` answer is repeated once, and a second one ends as \`not_applicable\` /
    \`codex_blocked_fallback\`; a snapshot whose base does not resolve is retried once on the merge-base with the default
    branch (inspect only); a \`preflight_failed\` that only the three additive review-home actions fix (\`rm -rf
    $CODEX_HOME/plugins\`, \`xprov init-home --pin-features\`, \`--prune-marketplaces\`) is repaired once in the dedicated
    review home, never in \`~/.codex\`, and only in a home the owner made (the marker \`xprov init-home\` writes, or the
    default \`~/.codex-a1-review\`; an \`A1_XPROV_CODEX_HOME\` override without the marker is not repaired). Nothing else is
    recovered: \`secret_in_snapshot\`, \`secret_in_output\`, \`tripwire\`, \`quarantined\`, \`run_home_unsafe\`,
    \`snapshot_changed_after_scan\`, \`allowlist_invalid\`, \`allowlist_modified\`, every permit or store mismatch and
    \`round_cap\` stay a stop with their reason. Do not re-run the gate yourself to "retry" one of them. A call that
    recovers waits 30 s and 120 s and may call the runner up to three times: give the Bash call the 10-minute maximum or
    start it in the background and read its output.
  - **Preflight FAIL \`plugins_cache_empty\`.** Codex has installed plugins into \`$CODEX_HOME/plugins/cache/\` on its own
    (measured 2026-09-24: the \`openai-curated-remote\` set); \`init-home\` never deletes anything, so the home stays
    non-compliant until a human acts. Remedy: \`rm -rf ~/.codex-a1-review/plugins\` — ONLY the dedicated review home,
    never \`~/.codex\` — then check \`codex features disable plugins\` and the \`remote_plugin\` feature flag so it does not
    come back. Alternative: pass \`--allow-plugins <name>\` on the gate call to allowlist a plugin you have read; the
    driver hands the flag through to \`preflight\`. Then re-run Step 1 — a failed attempt consumed no round.`,
});

module.exports = { XPROV_TOPICS_MAIN };
