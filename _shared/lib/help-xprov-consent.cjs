'use strict';

// help-xprov-consent — the help text of `a1-tools xprov consent` (spec 016, wave 2), split out of help-xprov.cjs.
// Tier-0 wording only: a record the same OS user could write; the audit chain makes a naive forgery visible and prevents nothing.

const CONSENT_HELP = `    consent question|ensure|record|revoke  --kind consent|classification [--repo <git-toplevel>]
          [--ludwig-record <vault path>]
    consent question --kind consent|classification --phase <name>
                  (ask once per phase, spec 016 wave 5; xprov-consent-asked.cjs)
    consent question|ensure --kind waiver|allowlist, consent waive, consent allowlist
    consent question|ensure --kind decline --phase <name>, consent decline --phase <name>
                  (spec 028 FR-022..024: the owner declines Codex for one unrun plan-review-xprov target)
          (--phase <name> | --scan <snap-basename>) [--repo <git-toplevel>]
                  (spec 016 FR-002, FR-003, FR-005, FR-007, FR-008; xprov-consent*.cjs)
                  The owner's yes to "may this repo go to Codex" as a chat answer,
                  no terminal. question: prints the canonical AskUserQuestion input
                  (header xprov-Freigabe or xprov-Einstufung, German text, one
                  question, the No label first, hash). ensure: state of the open
                  marker (none|pending|answered|expired|used) and whether to ask;
                  a second asker polls it and does not ask again; exit 0 only when
                  an answer is ready. record: turns a matching, unexpired (10 min),
                  unused marker with a real owner answer into the stores:
                  yes -> permits.json entry + .a1/xprov.json + consent.json evidence;
                  No -> an owner-chat denial (a later yes is refused until \`consent
                  revoke\`); no answer -> nothing written, exit 1.
                  The answer is never an argument: the plugin hook reads it from the
                  real tool result and derives yes/no from the label itself. The
                  marker's repo, kind, question hash, nonce, tool_use_id and
                  session_id catch a stale, mixed-up or copied marker. They do not
                  prove who answered: the ids and the nonce sit in a file the same
                  OS user can read and write.
                  A customer repo (no origin, a list of origins, or an origin outside
                  N3URAL-A1) is refused until the owner answered the xprov-Einstufung
                  question, which names the a1-ludwig-legal record
                  (\`question|ensure|record --kind classification --ludwig-record
                  <record/... or project/....md>\`, a regular file under
                  $A1_VAULT_ROOT, shown in the question text), and the consent yes
                  passes the SAME --ludwig-record. Without $A1_VAULT_ROOT a customer
                  repo is refused.
                  Ask once per phase (FR-002), enforced in code: question --kind
                  consent|classification needs --phase <name>, the exact name of an
                  existing .a1/phases/<name> (a lookalike such as P25 for p25 on a
                  case-insensitive disk resolves to the listed name; the entry also
                  holds the directory's device + inode, so a renamed phase is still
                  the same phase). --run <absolute worktree> (instead of --phase) scopes
                  the one ask of a PR review run (a1-pr-review, wave 10). The first call for repo + kind + phase
                  records the ask in ~/.a1-xprov/consent-asked.json (audit line
                  consent-asked) and prints the question. Every later call for the
                  same repo + kind + phase is refused (exit 1, reason
                  already_asked_this_scope, no question text) after an owner No, after
                  an unanswered or expired question and after \`consent revoke\`:
                  revoke never touches this store, so an agent cannot revoke a No and
                  ask again in the phase. The one exception is the same question (same
                  hash) while its marker is still open (pending or answered): it is
                  shown again. An unusable store refuses (asked_store_unusable) and is
                  never overwritten. A new phase may ask once. A refusal means: no
                  question, Reinhard-only. Waiver and allowlist questions are not
                  covered (their targets change by design).
                  A classification question is put only after an owner yes to the
                  consent question of the same phase (reason
                  classification_needs_consent_yes otherwise, no question text).
                  The hook enforces the same ledger: the canonical consent or
                  classification AskUserQuestion is let through only after \`consent
                  question\` recorded it (else deny consent_not_asked); one entry opens
                  exactly one marker (a second ask after the marker was used or expired
                  is denied consent_already_asked). A customer repo burns its ask when
                  the question is only printed (fail-safe).
                  Tier 0: the same OS user could delete the file or create a new phase
                  directory; the audit chain shows every ask.
                  revoke: removes the repo's permit, denial, evidence and unused
                  markers whatever channel wrote them; the next send asks again. An
                  unusable consent or denial store is reported (exit 1,
                  revoke_partial) and left alone; the permit is removed anyway.
                  waive (wave 3, FR-013): question|ensure --kind waiver --phase <name>
                  puts ONE xprov-Waiver question per phase
                  listing every gate target that is failed now, read by the command
                  from xreview/index.json and the run records (never from arguments):
                  gate, repo, phase, PLAN.md sha256, wave, lane, head, base, the fail
                  reason and the open BLOCKER/MAJOR titles. \`consent waive\` with the
                  same flags writes one waiver record per listed target (by
                  owner-chat, the shape of the terminal waive) against a matching
                  owner yes. A target that changed (new PLAN.md sha, new head) or a
                  gate that failed after the question changes the question: nothing
                  is written, a new question is needed. The consent to send never
                  implies a waiver. A waiver is not a pass.
                  decline (spec 028 FR-022..024): question|ensure --kind decline --phase
                  <name> puts ONE xprov-Decline question for the plan-review-xprov
                  target of the phase when it has no index row at the current PLAN.md
                  sha (else target_already_run, exit 1). The text names repo, phase,
                  target and PLAN.md sha256 and says nothing goes to Codex; the yes binds the
                  PLAN.md content, not the head.
                  Labels: "Nein, Codex-Prüfung wie vorgesehen" / "Ja, für dieses Ziel
                  nichts an Codex senden". \`consent decline --phase <name>\` acts only
                  on a recorded yes bound to the question hash: it writes a1's marker
                  a1-declined.json (kind owner_declined) in a new declined- run dir and
                  the index row { accepted: owner_declined }; load-check then accepts
                  the plan without Codex (Reinhard-only review). Any other answer:
                  decline_not_confirmed (exit 1, nothing written); a second call for
                  the same sha: already_declined (exit 0, nothing written); a
                  new PLAN.md needs a new question. It never writes
                  .a1/xprov.json, the permit store or the waiver store, creates no
                  waiver and sends nothing to Codex. design-review-xprov is not offered.
                  allowlist (wave 3, FR-014): question|ensure --kind allowlist --scan
                  <snap-basename> lists the hits of one secret scan (path, line, rule,
                  blob sha256, a fixed mask instead of an excerpt; the matched text is
                  never read). \`consent allowlist --scan <snap-basename>\` writes one
                  hit approval per listed hit (repo, path, rule, blob sha256, scan, by
                  owner-chat, audit link) into its OWN store hit-approvals.json, against
                  a matching owner yes; a changed blob or a new hit needs a new
                  question. It never writes allowlist-approvals.json; a hit blob that
                  reads as an allowlist document is refused (the terminal allowlist
                  approve stays the only way to approve an allowlist file).
                  Tier 0: every owner write appends a hash-chained line to
                  ~/.a1-xprov/consent-audit.jsonl first. The stores are records the
                  same OS user could write; the chain makes a naive forgery
                  visible (permit-check: audit missing|broken, enforcement:
                  unenforced) and prevents nothing. Dev install: bin/install.sh
                  installs no plugin hook, so no marker is ever answered there and
                  record writes nothing (the Reinhard-only path applies).
                  Plugin hook (wave 4, FR-004/FR-005; hooks/hooks.json, active after
                  \`claude plugin update a1-specforge\`): a consent question (header
                  xprov-Freigabe, -Einstufung, -Waiver, -Allowlist, or any xprov-*) is
                  put only byte-equal to what \`consent question\` prints, alone, without
                  an answers field; the hook opens the marker on that call and records
                  the pending yes only from the PostToolUse tool_response of the same
                  tool_use_id. It denies Edit/Write/NotebookEdit/MultiEdit of
                  ~/.a1-xprov/ (path and device + inode), .a1/xprov.json, every file of
                  the installed a1-specforge plugin cache, and every file where a hook
                  can be defined or all hooks switched off: settings*.json (user, project,
                  local), managed-settings*.json, hooks/hooks.json (this checkout's own
                  excepted), plugin.json and marketplace.json (a hooks entry added or
                  changed), any .json under ~/.claude/plugins, SKILL.md, and
                  .md files below a directory named agents or commands (whole file).
                  The rule is monotone, with no old-vs-new comparison: an edit that
                  changes such a file is denied when the old or the new whole content
                  holds PreToolUse/PermissionRequest (any case), an escape sequence
                  (in an .md only inside its frontmatter),
                  disableAllHooks / allowManagedHooksOnly, an a1-specforge enabledPlugins
                  entry, or (manifests) a hooks key. A settings file that already holds a
                  hook is therefore owner territory: change it with Bash or by hand. A
                  \$CLAUDE_CONFIG_DIR counts as ~/.claude; paths match lexical and real.
                  Dev edits of this repo's own hooks/hooks.json from a worktree are
                  denied when the hook runs from the plugin cache: use Bash (the dev copy
                  is no live hook source). A NotebookEdit of such a file is
                  always denied. A crash or timeout of the hook blocks the call (exit 2,
                  onFailure block).
                  NOT closed (tier 0 residuals): a Bash write of any of these files, a
                  store or a settings file; the script of a hook that already exists;
                  MDM and server-managed settings; the --settings, --agents and
                  --plugin-dir launch flags; a hooks .json that a plugin.json names
                  outside ~/.claude/plugins and that is not called hooks.json; cloud
                  and self-hosted sessions; \`claude plugin disable\` and the /plugin UI.
                  Exit: 0 ok · 1 refused (stdout JSON \`reason\`) · 2 usage error.`;

// spec 027 slice 5 (FR-028, D5): the consent and waiver text of a1-plan 04b, moved here and printed by `a1-tools xprov --help <topic>`.
// Topic format: two-space indent, prose wrapped at 120, no prose line over 140; command lines are never wrapped.
const XPROV_TOPICS_CONSENT = Object.freeze({
  consent: `  3. **Ask once.** Only after the gate call returned \`reason: external_review_not_permitted\` and only if this session
     can ask the owner (the AskUserQuestion tool exists; this is not a headless run, a CI run or a subagent) and this
     phase has not asked yet, print the canonical question — never write it yourself:
       node <repo>/_shared/a1-tools.cjs xprov consent question --kind consent --phase <phase_name> > "$XREVIEW_DIR/consent-question.json"; RC=$?
       echo "xprov consent question exit=$RC"
     Exit 0: put exactly the printed \`header\`, \`question\` and \`labels\` (No label first, one question, no \`answers\`
     field) with AskUserQuestion. The plugin hook denies any other text. If the printed \`classification\` is \`customer\`,
     do not ask: a1-ludwig-legal decides (rule \`xprov-codex.md\` step 4), continue Reinhard-only. Exit 1
     (\`already_asked_this_scope\`, \`asked_store_unusable\`, \`asked_store_full\` …): do not ask, do not retry, do not run
     \`consent revoke\` to ask again — the code refuses a second question in this phase. Continue Reinhard-only.
  4. **Record the answer** right after AskUserQuestion returned:
       node <repo>/_shared/a1-tools.cjs xprov consent record --kind consent > "$XREVIEW_DIR/consent-record.last-run.json"; RC=$?
       echo "xprov consent record exit=$RC"
     Exit 0 with \`decision: yes\`: run Step 1 once more; the repository now has a permit. Exit 0 with \`decision: no\`: the
     owner denied it (an owner-chat denial); Reinhard-only. Exit 1 (no answer reached the hook, a free-text answer, an
     unanswered question): nothing is recorded and nothing goes to Codex; Reinhard-only. An unanswered question is not
     repeated in this phase.
  5. **Headless or no AskUserQuestion** (CI, subagent, \`claude -p\`): no question, no consent. Print one line — \`ℹ No
     Codex permit and no chat to ask: Reinhard-only review.\` — and continue with the \`not_applicable\` row of Step 2. An
     intent run (\`a1-tools intent\`, headless child) allows none of \`xprov permit-check\`, \`xprov consent\` or \`xprov
     gate\`: a refusal of such a call by the sandbox (exit 77, permission denied) is final. Do not retry it and do not
     look for another way; take this same branch (notice line, Reinhard-only, continue).
  6. Never run a terminal-only owner command (\`xprov permit\`, \`xprov waive\`, \`xprov allowlist approve\`) and never write
     \`.a1/xprov.json\` or \`~/.a1-xprov/\` yourself; the owner answers in chat, the commands above record it.`,
  waiver: `  A waiver is a decision, and it is the owner's: asked in chat, at most once per phase, only for a gate that failed. It
  is not a pass. Order: report first, then ask. Nothing here is executed on a guess; every command prints or checks what
  the owner sees.
  1. **Report the failure.** Print the Step 2 halt block (gate, \`reason\`, \`details\`) before any question.
  2. **Ask once.** Only if this session can ask the owner (AskUserQuestion exists; not headless, not CI, not a subagent)
     and this phase has not asked for a waiver yet:
       XREVIEW_DIR=".a1/phases/<phase_name>/xreview"
       mkdir -p "$XREVIEW_DIR"
       node <repo>/_shared/a1-tools.cjs xprov consent question --kind waiver --phase <phase_name> > "$XREVIEW_DIR/waiver-question.last-run.json"; RC=$?
       echo "xprov consent question (waiver) exit=$RC"
     Exit 0: put exactly the printed \`header\` (\`xprov-Waiver\`), \`question\` and \`labels\` with AskUserQuestion. The
     question lists every gate target that is failed right now, read by the command from the run records, not from you;
     the yes covers exactly those targets. Exit 1 (for example no failed target): do not ask. Do not change the text, do
     not add targets.
  3. **Record the answer** with the same flags, right after AskUserQuestion returned:
       node <repo>/_shared/a1-tools.cjs xprov consent ensure --kind waiver --phase <phase_name> > "$XREVIEW_DIR/waiver-ensure.last-run.json"; RC=$?
       echo "xprov consent ensure (waiver) exit=$RC"
     Exit 0 (an answer is ready): run \`xprov consent waive --phase <phase_name>\` with the same capture pattern. It
     writes one waiver record per listed target only against the owner's yes (\`by: owner-chat\`); load-check then accepts
     it while PLAN.md keeps its sha256. A No, free text, no answer, or a target that changed after the question (new
     PLAN.md sha) writes nothing: the gate stays failed, halt per Step 2, and the question is not repeated in this
     phase. \`xreview/index.json\` and a \`## Waiver\` section in XREVIEW.md carry a mirror without authority; never
     \`verdict: pass\`.
  4. **Allowlist question (changed-line secret hits).** When the scan stopped the gate because a secret-pattern hit sits
     in a changed line and the owner's scan record \`<snap-basename>\` exists, ask once per scan the same way with \`xprov
     consent question --kind allowlist --scan <snap-basename>\` (header \`xprov-Allowlist\`, masked excerpts, one approval
     per listed blob) and \`xprov consent allowlist --scan <snap-basename>\` after the answer. No, no answer or no chat:
     nothing is approved and nothing goes to Codex. Close the target with \`xprov dispose --phase <phase_name> --gate
     plan-review-xprov --secret-declined <snap-basename>\` a1 checks that the scan record for this repo and this exact
     HEAD exists and writes the marker; the target ends \`not_applicable\` / \`secret_declined\` and the Reinhard review is
     the only review.
  5. **Headless or no AskUserQuestion:** no question. The gate stays failed; halt per Step 2.
  6. The terminal commands (\`xprov waive\`, \`xprov permit\`, \`xprov allowlist approve\`) stay the owner's own; no agent
     runs them or writes \`~/.a1-xprov/\`. No \`bash\` block in any skill contains \`xprov waive\` — fixture R7 greps for
     exactly that. Record \`xprov_waived\` in the retro when a waiver exists (Step 4).`,
});

module.exports = { CONSENT_HELP, XPROV_TOPICS_CONSENT };
