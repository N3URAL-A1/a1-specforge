# STATUS — M8 Launch & Community

rollback_sha: fb0e5a30950c17789cf50fddf261e3810c3f2081

## Wave 1 — Plugin restructuring

- Task 1.1 — DONE — f3312c5 — move 17 skill dirs under skills/, install.sh + CONTRIBUTING + CONSTITUTION + learnings-index paths updated. History preserved (git log --follow = 9). Both sanity greps clean, evolve glob check clean.
- Task 1.2 — DONE (verification only, no fixes needed, no commit) — FIXTURES_EXIT=0 (15 runners + nested parser); SMOKE_OK on fresh HOME (symlinks → skills/a1-new-feature and root _shared); fresh-machine sim from local clone matched M7: install exit 0, spec next-number + analyze init exit 0, .a1/learnings/projects/fresh-demo EXISTS, tracked modifications 0. CI check deferred to orchestrator's post-1.3 push.
- Task 1.3 — DONE — dccb548 — .claude-plugin/plugin.json + marketplace.json created; JSON_OK; AGENTS_CLEAN; README contains "plugin install a1-specforge".
  - Plugin validation path taken: **5a (headless CLI)** — `claude plugin validate` + real `marketplace add` + `install --scope local` succeeded; `plugin details` showed Skills (17) + Agents (18) loaded; cleanly uninstalled + marketplace removed; user-scope symlinks intact. No fallback doc needed.
  - Deviation (schema fix, Rule 2): `claude plugin validate` is the authoritative schema, and it **rejected the MAP template**. Fixes vs. MAP: marketplace requires `owner{}` (object) and `plugins[].author` must be an **object** not a string; `displayName` is ignored (warning). plugin.json `skills`/`agents` **string** path fields are invalid — omitted them (convention defaults to `skills/` + `agents/`, confirmed by details showing all 17/18). Added a marketplace `description` to clear the last warning. Final `claude plugin validate <repo>` → "Validation passed".
  - NOT pushed / CI not watched (orchestrator handles push + CI, per dispatch deviation).

### Deviations (Wave 1)
- [Rule 2 / schema] Task 1.3: corrected plugin manifests to satisfy `claude plugin validate` (owner object, author object, omit skills/agents string fields, add marketplace description) — MAP template was invalid against the live validator.

## Wave 2 — M7-rest German→English sweep
Completed: 2026-07-05

| Task | Status | Commit | Notes |
|---|---|---|---|
| 2.1 Translate remaining German workflow lines | ✓ DONE | d36e63c | 20 workflow files translated in-place (all 19 MAP-inventory files + 1 safety-net find). Semantics preserved; Markdown/code-fence/placeholder structure untouched. FIXTURES_EXIT=0 (14 runners + nested parser). |

### Wave 2 verification proofs
- German-marker gate `grep -rnE '[äöüßÄÖÜ]|<function-words>' skills/*/workflows/*.md | grep -v _learning` → after whitelisting 3 intentional trigger-alias lines: **GERMAN_ZERO**.
- MAP-authoritative skim + broad umlaut-free German-word safety net (soll/welche/nach/pflicht/abgeschlossen/...) → all inventoried files clean; safety net additionally caught 5 grep false-negatives (audit m2 risk confirmed), all fixed.
- FIXTURES_EXIT=0.

### Whitelisted German (intentional trigger aliases — plan says STAY)
- `skills/a1-modernize/workflows/01-scope.md:28` — mode aliases `"aufräumen"/"fixen"/"modernisieren"/"verbessern"` (kept alongside English equivalents; these are user-input keywords the skill maps).
- `skills/a1-pr-review/workflows/01-detect.md:8-9` — user-utterance examples `"review für ..."` / `"was steht zur Review?"` / `"review nächsten"` (kept alongside English; illustrate what the user types).

### Deviations (Wave 2)
- [Rule 4-adjacent / vague_action] Safety-net grep found a German line NOT in the MAP inventory: `skills/a1-new-feature/workflows/05-implement.md:90` (Step 5 heading "Nach Agent-Meldung: ... (Pflicht)"). In scope for SC-3 (zero German over all `skills/*/workflows/*.md`), so translated it. Logged in observations.jsonl. Total files touched = 20, not the inventory's 19.
- Grep false-negatives (audit m2 risk) caught only by the umlaut-free safety net and fixed: a1-modernize/01-scope (project-slug prompt), 06-execute (2 wave prompts), a1-worktree/03-exit (implicit-name example), a1-new-feature/05-implement (heading). The MAP inventory alone would have missed the last one entirely.
- Incidental: running the reconcile fixture rewrote two dated `_test-fixtures/a1-reconcile/.../drift-2026-05-13.md` test artifacts (a test side effect, outside my `skills/*/workflows/*.md` ownership); reverted with `git checkout` — not included in the commit.

## Wave 3 — Community polish
Completed: 2026-07-05

| Task | Status | Commit | Notes |
|---|---|---|---|
| 3.1 CODE_OF_CONDUCT + CONTRIBUTING additions | ✓ DONE | 4ab23f7 | Contributor Covenant 2.1, contact = GitHub issues (no email hardcode); CONTRIBUTING: postgres-rls worked-example pointer, "Using vs. contributing" section, review-expectation sentence. Done-when: COC_OK, postgres-rls=1, plugin(ci)=1. |
| 3.2 Good-first-issue drafts + gh command list | ✓ DONE | c5e7417 | 4 drafts: (a) constitution CLI fixture (confirmed uncovered), (b) contribute a gate-pack from own learnings, (c) a1-worktree/03-exit.md edge-case section, (d) install.sh Node<18 guard (confirmed absent). "Publish (Robert)" block has gh auth switch --user mellow-rob + one gh issue create per draft. Pipeline did NOT run gh issue create. Done-when: 4 Issue headings, gh issue create + gh auth switch present. |
| 3.3 Simulated external-contributor dry-run | ✓ DONE | 4db4f3d | Fresh clone → install.sh on temp HOME (exit 0, symlinks OK) → gate-pack path → PR-ready branch add-pack-dryrun-demo with pack validate exit 0, git status clean. 2 findings, both fixed in CONTRIBUTING. Scratch clone deleted. |

### Dry-run findings (Task 3.3) — the interesting part
1. **CONTRIBUTING gate-pack path led with `pack export`, which requires a pre-existing Vault/learnings `patterns.md` corpus.** A stranger with a fresh clone and no corpus hits `error: Vault patterns.md not found ... exit 2` at the very first documented step, with zero guidance. FIX (committed): restructured the "Author the pack" step into (a) export-from-corpus with an explicit "exits 2 on a fresh clone" warning and (b) a recommended hand-author-from-`packs/postgres-rls/`-template path that needs no corpus.
2. **No branch-naming convention was documented**, yet the "Pull requests" section and the dry-run assume one. FIX (committed): added `<type>-<short-slug>` branch convention line to the Pull requests section.
- Positive: `pack validate` on both the shipped `packs/postgres-rls/` and the hand-authored dummy pack exited 0; the trust model (validate-before-PR) works cleanly for a newcomer once past finding #1.

### Deviations (Wave 3)
- [Rule 4-adjacent / scope] Wave 2 (German→English sweep) is NOT yet done — German prose survives in skills/a1-fix/workflows/*.md. Out of my Wave-3 scope; noted here so good-first-issue candidate selection deliberately EXCLUDED the translation task (per Task 3.2 guidance). No translation performed.
- 2 dry-run findings → CONTRIBUTING fixes (commit 4db4f3d), logged in observations.jsonl (pattern: vague_action ×2).

## Wave 4 — Launch assets
Completed: 2026-07-05

| Task | Status | Commit | Notes |
|---|---|---|---|
| 4.1 VHS demo tape + GIF | ✓ DONE | 292166d | vhs NOT installed — committed docs/demo.tape + docs/assets/.gitkeep + docs/launch/demo-recording-steps.md (fallback). No faked GIF. Tape scripts 3 real fixture commands (schema-check fail-no-rls → FAIL/exit 1, schema-check pass → PASS/exit 0, pack validate → VALID), all verified live before scripting. |
| 4.2 Launch drafts | ✓ DONE | 4902e96 | show-hn.md (factual title, first-person, honest-limitations para: single-maintainer / one-project corpus / German roots + prepared author comment), reddit.md (r/ClaudeAI practitioner tone, links GIF, invites good-first-issues), linkedin.md (German, Sabine raw material, N3URAL.AI framing). All marked DRAFT. |
| 4.3 README hero | ✓ DONE | d6ff8d2 | No GIF yet → TODO(Robert) placeholder + commented GIF ref under title. demo.gif ref count = 2. Bijective install.sh↔README diff exit 0. |

### Deviations (Wave 4)
- [Rule 1 / grounding] Grounded launch numbers in the **actual current repo counts**, not the dispatch brief's figures: 13 applied patterns (canonical `_shared/learnings-index.md` "Applied: 13", not 15) and 14 fixture suites (`ls -d _test-fixtures/*/` = 14, not 16). Plan Task 4.2 step 1 mandates "use the actual current count" — repo reality supersedes the brief. 17 skills + 18 agents + MIT confirmed as stated.
- [fallback] Task 4.1: vhs unavailable (`command -v vhs` empty). Committed .tape + render-steps doc per plan step 4; no fabricated GIF; README uses the no-GIF placeholder branch.

### Wave 4 verification proofs
- Forbidden-word grep (plan regex `revolutionary|game.chang|best|fastest|first ever|10x`): exit 1 (zero hits).
- Forbidden-word grep (brief regex `revolutionary|game-chang|10x|blazing`): exit 1 (zero hits).
- Bijective install.sh↔README diff: exit 0 (empty) after README edit.
- All three drafts contain `DRAFT`; demo commands verified live (schema-check FAIL exit 1 / PASS exit 0, pack VALID exit 0).
