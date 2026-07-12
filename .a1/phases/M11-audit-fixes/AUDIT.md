---
phase: M11-audit-fixes
generated: 2026-07-12
audited: .a1/phases/M11-audit-fixes/PLAN.md
based_on: RESEARCH.md + MAP.md (both dated 2026-07-12, verified against HEAD 7217d29)
verified_against: HEAD 7217d29 (working tree clean except 2 pre-existing unrelated
  fixture-drift diffs in _test-fixtures/a1-reconcile/, not touched by this plan)
---

# Audit: M11-audit-fixes

## Verdict: **PASS**

PLAN.md is executor-ready. Every figure independently spot-checked against the live
tree (install.sh AGENTS array, a1-check's line 29/100 contradiction, fixture runner
naming, CI workflow steps, README scope-note comment, files-to-create) matches
RESEARCH.md/MAP.md exactly, and both of those documents already independently
cross-verified the three source surveys against the tree a second and third time.
Wave 7 is genuinely STOP-gated with no auto-apply path. Wave 2's fixture explicitly
requires seeding real drift cases and asserting failure, not just clean-state PASS.
No BLOCKER found. Two MAJOR and three MINOR findings below should be fixed before
execution starts — none require replanning, all are surgical text edits to PLAN.md
itself (not to the target repo).

---

## Findings

### MAJOR-1 — Task 1.3 contradicts itself on file scope and content

**Location:** PLAN.md lines 185–204 (Task 1.3 — Document the deliberate exclusions).

The task tells the executor to create `bin/install-exclusions.txt` and gives
`hero-animation-builder: no a1 convention, not installed` as the worked example of
what goes in the file (lines 190–191 and again 194–195, both times without
qualification). Two sentences later the same task states: **"Scope: agents only in
this wave's file — `hero-animation-builder` is a skills-side exclusion and has no
file-based mechanism today... Task 2.1's checker handles the skills side by
comparing directories against the known-correct SKILLS array directly, not via this
file"** (lines 198–202).

These two statements are directly in tension: the task's own example entry is the
one name it then says does *not* belong in the file. An executor following the task
literally has to silently guess whether to (a) put `hero-animation-builder` in the
file despite the "agents only" scope statement, or (b) create the file empty (since
there are zero real agent-side exclusions today — all 21 agents are meant to
install), leaving the worked example orphaned as documentation-only prose.

The revision note (line 100–104) already resolved the analogous ambiguity for
Task 2.1 ("the checker's skills-side logic is 'compare directories minus this one
known name' even without a shared exclusion-file entry") — that resolution is
correct and should simply be echoed into Task 1.3's own body so the two tasks don't
give conflicting instructions about the same file.

**Fix:** In Task 1.3, replace the `hero-animation-builder` worked example with either
(a) a hypothetical/illustrative entry name that isn't the actual skills-side
exclusion (e.g. `some-future-agent: reason`), or (b) state explicitly "the file is
created but starts empty (0 real agent-side exclusions exist today); the format
example below is illustrative only, not a literal instruction to add
`hero-animation-builder`." Either fix makes "Done when: exclusion file exists in the
agreed format" (line 204) resolve to a deterministic, unambiguous state instead of
leaving content correctness to executor judgment.

---

### MAJOR-2 — README's HTML-comment count claim is corrected once but never wired into the automated drift check, despite both source documents flagging exactly this

**Location:** Task 1.2 (lines 176–184) updates README.md:12-21's hardcoded "17
skills + 18 agent names" comment to "17 skills + 21 agent names." Task 2.1 (lines
216–228), the sync checker that is supposed to prevent this class of drift from
recurring, only asserts three set-equalities (skills dirs ↔ install.sh SKILLS ↔
README table rows; agents dirs ↔ install.sh AGENTS ↔ README table rows) — it never
parses or validates the HTML-comment's own claimed counts.

Both RESEARCH.md and MAP.md explicitly call this out as a real risk, not a
nice-to-have:

- RESEARCH.md §9 risk #2: *"nothing currently parses or validates that comment...
  Task 2.1's sync checker should ideally also validate this comment's claimed
  counts against reality (or the comment becomes exactly the kind of stale claim
  this whole phase exists to close). Not in PLAN.md today — flag for plan
  refinement, low effort to add as a 4th assertion in `verify-install-sync.sh`."*
- MAP.md §11.3: *"consider whether Task 2.1's checker should also validate this
  comment's claimed counts (4th assertion), or the comment itself becomes the next
  stale artifact."*

Both documents recommend this be added as a 4th assertion in
`verify-install-sync.sh`. PLAN.md's revision note (lines 59–111) is a detailed,
itemized account of what changed between the draft and this pass, and it addresses
several smaller RESEARCH/MAP recommendations (Task 2.1 scope note, Task 6.2 scope
tightening, Task 2.5 new hardening task) — but this specific recommendation, named
independently in both documents, does not appear anywhere in the final PLAN.md: not
in Task 2.1's checks, not in SC-2 (which only names "repo dirs ↔ install.sh arrays
↔ README tables" — a prose HTML comment is a fourth, independent claim surface not
covered by "tables"), and not deferred explicitly to Wave 7. It is a silent drop.

Practical consequence: after this phase ships, the next agent added to the repo (a
22nd agent, say) will again make the comment's "17 skills + 21 agent names" claim
stale, and — unlike the SKILLS/AGENTS arrays and README tables — nothing in CI will
catch it, reproducing the exact failure mode (an unenforced claim of
being-the-single-source-of-truth) that motivated this whole phase's Wave 2.

**Fix:** Add a 4th assertion to Task 2.1: parse the two counts out of the
README.md:12-21 HTML comment (`grep -oP` for the two integers, or a slightly looser
pattern match since it's prose, not structured data) and assert they equal the
live skill/agent counts computed in checks 1–2. Extend Task 2.2's fixture with a
4th drift case (stale comment count) to match. Optionally reference this in SC-2's
wording ("...with a documented exclusion list, **including the README scope-note
comment's own claimed counts**...").

---

### MINOR-1 — Task 2.2's "Done when" doesn't restate the drift-assertion requirement

**Location:** PLAN.md lines 230–247 (Task 2.2 — Fixture suite
`_test-fixtures/install-sync/`).

The task body is explicit and correct: *"asserts PASS on clean state, then seeds
three drift cases (extra dir, missing install entry, stale README row) and asserts
exit 1 each"* (lines 237–239) — this genuinely requires seeding real drift and
checking failure, which is exactly what the task instructions asked this audit to
verify, and it passes. However the task's own **"Done when"** clause (line 247)
only says *"suite green locally and via the CI glob... this becomes the 23rd
fixture directory"* — it re-states file-count and suite-exit-code, not the
positive+negative assertion pattern. A suite that (incorrectly) only asserted PASS
on clean state and silently dropped the three drift cases would still satisfy the
literal "Done when" wording as long as its own internal `pass=0/fail=0` counters
summed to `fail=0`. Since the body text is unambiguous, this is a precision gap in
the completion gate rather than a content gap — worth tightening so a verifier
checking against "Done when" alone doesn't miss it.

**Fix:** Extend Task 2.2's "Done when" to: *"...suite green locally and via the CI
glob; suite contains and exercises all three seeded-drift cases (extra dir, missing
install entry, stale README row), each independently asserting exit 1, verifiable
by `grep -c "assert.*rc.*1\|drift" _test-fixtures/install-sync/run-tests.sh` or
equivalent; this becomes the 23rd fixture directory."*

---

### MINOR-2 — Task 4.3's "Done when" mixes a deterministic and a semantic check without separating them

**Location:** PLAN.md line 387: *"no inline-Python one-liners remain in Marco's
prompt; mapping steps reference detected dirs, not literal `src/`."*

The first clause is fully deterministic (`grep -c "python -c\|python3 -c"
agents/a1-marco-mapper.md` == 0 — confirmed live: Marco's file currently contains
exactly one `python3 -c` invocation plus five `src/`-hardcoded grep lines, verified
by direct read). The second clause ("mapping steps reference detected dirs, not
literal `src/`") is checkable by grep for the literal string `src/` returning zero
matches outside intentional context, but "reference detected dirs" as positive
proof requires a human/LLM judgment call that the replacement instruction actually
describes dir-detection logic, not just the absence of the old string. This is
lower-risk than MAJOR-1/2 (the task is narrowly scoped to one file, and a
`grep -c "src/" agents/a1-marco-mapper.md == 0` catches the regression case even if
it doesn't fully validate the positive replacement), but it's not purely mechanical
as claimed by the plan's Wave 1-6 framing ("Waves 1–6 are mechanical and
executor-safe," line 127).

**Fix:** Split into two independently checkable clauses: (1)
`grep -c "python3\? -c" agents/a1-marco-mapper.md` == 0 (2) `grep -c "src/"
agents/a1-marco-mapper.md` == 0 **and** the replacement text contains a
dir-detection step (spot-check by a1-erik-executor's own commit message describing
what replaced it, or add one sentence of required replacement phrasing, e.g. "must
contain the phrase 'detect top-level source dir' or equivalent"). Low priority —
does not block execution, but tightens self-verification.

---

### MINOR-3 — Task 6.1's "Done when" has no grep pattern, unlike every other Wave 1–6 task

**Location:** PLAN.md line 472: *"each of the five has an explicit Retro-writing
step referencing the shared schema and the correct learning-store resolution
(repo-local default, `A1_VAULT_ROOT` override)."*

Every other Wave 1–6 "Done when" clause in PLAN.md gives either an exact shell
command (`grep -rn ...`, `ls ... | wc -l`, `grep -c ...`) or an exact file/state
check. Task 6.1's clause is the one exception: "an explicit Retro-writing step
referencing the shared schema" is a qualitative judgment about content adequacy,
not a single command. This is scoped narrowly (5 named files, RESEARCH.md §8 /
MAP.md §8 already pin down exactly which files and what "explicit" means in
contrast to the current "mentions Retro only in passing" state), so the ambiguity
is low-risk, but it is the one Wave-1-6 criterion in the whole plan that doesn't
resolve to a deterministic command as the task instructions for this audit
specifically asked to check for.

**Fix:** Add a concrete check, e.g.: *"grep -rln '## Retro\|Retro:' skills/{a1-plan,
a1-roadmap,a1-reconcile,a1-modernize,a1-constitution}/workflows/*.md returns all 5;
each match also references `_shared/learning-schema.md` by name (`grep -l
learning-schema` on the same 5 files)."* This mirrors the exact detection method
MAP.md §8 already used to find the gap in the first place, so it costs nothing new
to specify.

---

## Verification of the four specifically-requested audit dimensions

**1. Deterministic "Done when" criteria, no vague "looks good."**
23 of 24 task-level "Done when" clauses resolve to an exact command or exit-code
check. One (Task 6.1, MINOR-3) and one half-clause (Task 4.3, MINOR-2) are
partially qualitative but narrowly scoped and low-risk — flagged as MINOR, not
BLOCKER, since both are single-digit-file-count, well-evidenced tasks where the
qualitative half is a secondary clause alongside a deterministic primary one. Wave
7's four "Done when" clauses are appropriately doc-existence/content-coverage
checks (correct for STOP-gated decision-doc tasks, not a defect).

**2. Wave 7 genuinely STOP-gated?**
**Yes, confirmed.** The wave header states "Never apply without Robert's explicit
choice" (line 493-494) and every one of the four tasks (7.1–7.4) produces only a
decision document (plus optional non-applied diff) under
`.a1/phases/M11-audit-fixes/decisions/`. No task's "Done when" checks for an actual
merge, deletion, or file move having happened. Cross-checked against
"Explicitly out of scope" (line 570): "Executing Wave-7 decisions — this phase only
produces the decision docs" is stated a second time as an explicit boundary. No
structural change (a1-check merge, agent deletion, hero-animation-builder move) is
silently folded into any Wave 7 task.

**3. Wave 2's drift-gate fixture — real drift seeded and asserted to fail?**
**Yes, confirmed** at the task-body level (Task 2.2, lines 237-239: "asserts PASS
on clean state, then seeds three drift cases... and asserts exit 1 each"). This is
a genuine positive+negative design, not a PASS-only smoke test. See MINOR-1 above
for a gap in how tightly the "Done when" clause (as opposed to the task body)
re-states this requirement — a precision issue, not a design defect.

**4. Do the 8 SCs fully cover every numbered finding from the three surveys, or is
something silently dropped?**
**Mostly yes, with one confirmed drop (MAJOR-2).** Cross-checked every explicit
"Recommend..." statement in RESEARCH.md (11 instances) and MAP.md (3 instances)
against PLAN.md's tasks: 13 of 14 are picked up (rename over CONVENTIONS.md-edit,
hostile-input N/A documentation, bracketed-array target format, sweep-grep as
completion gate, install-smoke-test hardening, exclusion-file format, one-commit-
per-sweep, Victor's resolution snippet, Ludwig-vs-plugin diff, skills-side
exclusion symmetry, etc. — all present, several called out explicitly in the
revision note). The one dropped recommendation — validating the README scope-note
HTML comment's own claimed counts as a CI-enforced 4th assertion — is named
independently by both RESEARCH.md (§9, risk #2) and MAP.md (§11, item 3), and does
not appear in any task or in SC-2's wording. This is MAJOR-2 above.

---

## Non-findings (checked, no issue)

- Wave ordering (1→2, then 3/4/5/6 independent, then 7 last) matches the
  Dependencies section and is logically sound — Wave 2 genuinely needs Wave 1's
  clean state to assert its own PASS case; Wave 7's Task 7.4 genuinely needs Task
  4.3's note.
- Executor ground rules' regression-gate command was verified runnable as written
  (`node --check`, fixture glob) against the live tree.
- SC-1 through SC-8 wording was checked against Waves 1-7 one-by-one; SC-2, SC-3,
  SC-4, SC-5, SC-6, SC-7, SC-8 each map cleanly to their wave's tasks with no other
  drops found beyond MAJOR-2.
- Cross-wave coupling (Task 1.3 ↔ Task 2.1 format; Task 4.3 → Task 7.4 dependency)
  is explicitly called out in the plan and consistent across both tasks — except
  for the Task 1.3 self-contradiction in MAJOR-1, which is internal to the task,
  not a cross-task mismatch.
- `code_scope` frontmatter list was spot-checked against actual file existence —
  all paths listed are real, no orphaned scope entries.
- No task instructs a change to `_shared/*.cjs`; the "no CLI behavior change"
  ground rule is honored throughout, confirmed by grep across all task bodies for
  `.cjs` edit instructions (none found outside the frozen regression-gate command
  itself, which only reads/checks, never edits).

## Recommendation

Fix MAJOR-1 and MAJOR-2 in PLAN.md before handing to a1-execute (both are text-only
edits to the plan document, no re-planning needed). MINOR-1 through MINOR-3 can be
fixed now or picked up by a1-erik-executor as an in-flight clarification during
Wave 2/4/6 execution without blocking the start of Wave 1.
