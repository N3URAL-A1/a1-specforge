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
  a1-tools wave checks <slug> <wave> --diff-base <ref> [--project <dir>] [--migrations <dir>] [--phase <slug>]
                  Spec 027 FR-024. Runs the three per-wave gates as children of this CLI, always all three, in this order:
                  \`realpath-check run\` (gate-0.7-realpath), \`schema-check run\` (gate-0.6-schema, only with --migrations,
                  else reported as skipped: no_migrations), \`test-fidelity\`. Each child runs with the project dir as its
                  working directory and gets --phase <slug>, so each writes its own gate-log line into the project's log.
                  --phase, when given, must equal <slug>. stdout: {"ok","slug","wave","checks":[{"gate","argv","exit",...}]}.
                  Exit 2 when any child exited 2 or timed out (10 minutes each), else 1 when any exited non-zero, else 0.
  a1-tools feature plan-steps <spec-path>
                  Spec 027 FR-025. Prints the step list of a feature run for the spec's size (frontmatter S, M or L):
                  {"spec","size","steps":[{"id","kind","agent|gate","model","phase","when?","resume?"}],"spawns","gates"}.
                  steps[] holds every fixed and every conditional step; a step with "when" runs when its phase workflow
                  finds that condition true. "spawns" counts the unconditional spawns. No size in the spec: exit 1 no_size.
                  Exit 2 usage error.
  a1-tools feature close --by <spec-id> --pr <n> [--repo <dir>] [--spec <path>] [--worktree <id>] [--check-only]
                  Spec 027 FR-026. Closes a feature after its PR merged. Run it from the primary checkout (a linked worktree
                  exits 1 run_from_worktree). Steps in order, each skipped when already done: check the PR is MERGED and its
                  remote branch gone; record every gate-log scope of the worktree (run record), then \`worktree exit --mode
                  discard\`; advance the reservation stages and \`code-scope release --by <spec-id>\`; set the spec to done;
                  \`git fetch --prune\` and sweep local branches. A failed step exits 1 {"ok":false,"reason","step"} and runs
                  nothing after it. Branch sweep: a branch is deleted (compare-and-swap on its tip) when its tip is an ancestor of
                  origin/<base> (this also deletes non-PR branches the base already contains, no commit is lost) or when a merged
                  PR's head equals its tip; everything else is listed in kept[] (commit+revert and empty-commit branches too).
                  The default branch and the PR base are never deleted. --check-only runs only the refusals that change nothing
                  (spec file, PR MERGED, branch name, worktree match) and exits 0 without touching state. The command commits nothing: when
                  .a1/reservations.json is tracked and changed it prints \`reservations_commit_pending\` for the caller to commit.
                  gh is taken from the A1_GH_BIN seam (default gh; an override must be an absolute path, is named on stderr and as
                  gh_bin in the JSON, and its merged-PR verdicts only keep unless A1_FEATURE_CLOSE_TEST=1 is set by a fixture).
                  Exit 0 ok / 1 failed step / 2 usage error (--pr must be 1-7 digits, --by a safe scope name).
  a1-tools feature close --cleanup-only [--repo <dir>]
                  Spec 027 FR-026. Runs only the branch sweep and the fetch --prune of \`feature close\`.

  Input-hash reuse (spec 027 FR-020): \`checklist run <slug>/<feature> --only 9,10,11\`, \`lane-split check\` and
                  \`fix class-sweep --verify\` reuse the last pass when the input hash is unchanged. The key covers the
                  gate's inputs (spec and wave plan and roadmap; the plan; the bug file), the call arguments and the gate
                  code: the entry modules plus their local requires, depth 2 (deeper or computed requires are not in
                  the key). It needs --phase, a verified gate log of this checkout (logs are per checkout), and for the
                  two code-reading gates the same HEAD with a clean tracked tree. A reused call prints \`reused: <gate> @ <hash>\`
                  and logs \`reused: true\`.`;

module.exports = { LEAN_HELP };
