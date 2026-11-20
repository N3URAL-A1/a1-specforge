'use strict';

// Help text of spec 027 slice 4 PR A (FR-019..FR-021). Kept out of help.cjs (size).
// Every usage block starts with two spaces and `a1-tools` and lists its flags: the call-site sweep treats a
// two-word block as strict. The reuse paragraph below has no `a1-tools` prefix and follows an empty line,
// so the sweep reads none of its flags as accepted by `wave next-check`.
const LEAN_HELP = `  a1-tools pr review-record --head <sha> --verdict <pass|fail> --phase <scope>
                  Spec 027 FR-019. Writes one \`pr-reinhard\` gate-log line for the head sha Reinhard reviewed.
                  --head must be 40 hex digits and equal \`git rev-parse HEAD\` of the working directory, else exit 2
                  head_mismatch (no pass is ever recorded for a head the reviewer did not see). --phase is required
                  (stripped by the gate-log hook); without it the call exits 2 phase_required, and the hook writes only
                  an error line into the _unscoped log. stdout: {"ok","gate","head_sha","verdict","scope"}.
                  Exit 0 pass / 1 fail / 2 usage error. Flags other than the three named exit 2.
  a1-tools pr review-evidence --head <sha> --phase <scope>
                  Spec 027 FR-019. Writes nothing. Reads <repo>/.a1/phases/<scope>/gate-log.jsonl and exits 0 only when
                  the LAST \`pr-reinhard\` record for that head sha is a pass, so a second review of the same head can be
                  skipped. Exit 1 no log, untrusted (broken chain) log, or no pass for this head / 2 usage error.
  a1-tools wave next-check <slug> <wave> --since <iso> [--project <dir>] [--plan <file>] [--checkpoint-each-wave]
                  Spec 027 FR-021. Names the reason a run must stop before the next wave, else prints \`continue\`.
                  stdout \`continue\` (exit 0) or \`stop:<reason>\` (exit 1), one stderr line with the detail, exit 2 usage.
                  --since is the ISO-8601 UTC time the wave was dispatched. Missing source = stop. Checks, first stop wins:
                  owner_requested (--checkpoint-each-wave); wave 0 (before Wave 1) runs only the agent check;
                  gate_red (gate log missing, untrusted, no record since --since, or the last verdict of a gate since then
                  is fail/error); deviation (observations.jsonl missing or malformed, or a deviation/blocker line of this wave);
                  scope_change (GOAL.md missing, no "## Decisions" heading, or a row at or after --since; a date-only row
                  stops for the whole day, rewrite it with an ISO timestamp to clear it); agent_unnamed (the next wave has
                  no named agent: a plan with \`lanes:\` needs an agent per lane, a plan without \`lanes:\` and without --plan
                  is read as \`lanes: none\` (Erik), a wave-plan given with --plan needs "### Suggested agent(s)" per wave).

  Input-hash reuse (spec 027 FR-020): \`checklist run <slug>/<feature> --only 9,10,11\`, \`lane-split check\` and
                  \`fix class-sweep --verify\` reuse the last pass when the input hash is unchanged. The key covers the
                  gate's inputs (spec and wave plan and roadmap; the plan; the bug file), the call arguments and the gate
                  code: the entry modules plus their local requires, depth 2 (deeper or computed requires are not in
                  the key). It needs --phase, a verified gate log of this checkout (logs are per checkout), and for the
                  two code-reading gates the same HEAD with a clean tracked tree. A reused call prints \`reused: <gate> @ <hash>\`
                  and logs \`reused: true\`.`;

module.exports = { LEAN_HELP };
