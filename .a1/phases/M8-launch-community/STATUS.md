# STATUS — M8 Launch & Community

rollback_sha: fb0e5a30950c17789cf50fddf261e3810c3f2081

## Wave 1 — Plugin restructuring

- Task 1.1 — DONE — f3312c5 — move 17 skill dirs under skills/, install.sh + CONTRIBUTING + CONSTITUTION + learnings-index paths updated. History preserved (git log --follow = 9). Both sanity greps clean, evolve glob check clean.
- Task 1.2 — DONE (verification only, no fixes needed, no commit) — FIXTURES_EXIT=0 (15 runners + nested parser); SMOKE_OK on fresh HOME (symlinks → skills/a1-new-feature and root _shared); fresh-machine sim from local clone matched M7: install exit 0, spec next-number + analyze init exit 0, .a1/learnings/projects/fresh-demo EXISTS, tracked modifications 0. CI check deferred to orchestrator's post-1.3 push.
