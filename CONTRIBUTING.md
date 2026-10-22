# Contributing to a1-specforge

Thanks for your interest. a1-specforge is a Claude Code skill suite — contributions are welcome in the form of new skills, bug fixes, improved agent briefs, and documentation.

## What you need

- [Claude Code CLI](https://claude.ai/code)
- Node.js ≥ 18
- git

## Local setup

```bash
git clone https://github.com/N3URAL-A1/a1-specforge.git ~/code/a1-specforge
cd ~/code/a1-specforge
./bin/install.sh
```

`install.sh` creates symlinks from `~/.claude/skills/` and `~/.claude/agents/` to this repo. Changes to skill files are live immediately — no reinstall needed.

## Skill structure

Every skill follows the same layout:

```
skills/a1-<name>/
├── SKILL.md              # Frontmatter + orchestrator instructions
├── workflows/            # Phase-by-phase workflow files (01-*.md, 02-*.md, ...)
├── templates/            # Brief templates and artifact skeletons
└── agents/               # Pointer files to ~/.claude/agents/ (not definitions)
```

`SKILL.md` frontmatter is the activation contract — the `description:` field determines when Claude Code auto-activates the skill. Keep it precise and unambiguous.

Agent pointer files in `agents/` reference the canonical agent definition at `~/.claude/agents/<name>.md`. They document how the skill uses the agent, not what the agent is.

User-facing output language across all skills and agents follows one shared policy —
see [`_shared/language-policy.md`](_shared/language-policy.md). Don't restate local
language rules in a skill's SKILL.md; link to that file instead.

## Adding a skill

1. Create `skills/a1-<name>/SKILL.md` with valid frontmatter (`name`, `description`, `allowed-tools`).
2. Add workflows in `skills/a1-<name>/workflows/` — numbered, sequential.
3. Add the skill name to the `SKILLS` array in `bin/install.sh`.
4. Test manually: invoke the skill in Claude Code on a sample project.
5. Open a PR with a description of what the skill does and a sample invocation.

## Modifying an existing skill

- Workflow files are the most common change target — they contain the phase logic.
- If you change an agent's Output Contract in a brief template, verify that the downstream validation step handles the new shape.
- If you rename a template or agent pointer, update all references in SKILL.md and workflows.

### `## Versions` sections are opt-in (deliberate, not an inconsistency)

Only skills that have shipped a documented **major behavioral revision** carry
a `## Versions` section (today: a1-analyze, a1-constitution, a1-modernize,
a1-reconcile). Do not add empty `## Versions` sections to the other skills to
"standardize" — a stable single-shot gate has nothing to version. Add the
section the first time a skill's behavior changes in a way a returning user
must know about (M12 decision, doc 7.4 MAP c).

### Test fixtures

Any change to `_shared/a1-tools.cjs` requires fixture coverage per
[`_test-fixtures/CONVENTIONS.md`](_test-fixtures/CONVENTIONS.md), including the mandatory
hostile-input rejection case for every new CLI subcommand. Run the full suite before
opening a PR: `for r in _test-fixtures/*/run*.sh; do bash "$r" || break; done`.

Runs started from inside an agent session (a `claude` process is an ancestor, or `CLAUDECODE` is set) skip the owner-terminal cases of `a1-xprov` (parts 08, 11, 12, 13, 14; part 15 swaps in a library driver); CI never skips them. Before a PR, run the suite once outside the agent as a non-root user, for example in Docker with gitleaks 8.30.1 on `PATH`: copy a `git archive` snapshot (with `git init` and a commit) to `/work`, `chown -R node:node /work`, then `docker run --rm -v <snapshot>:/src:ro node:20 su node -s /bin/bash -c 'cd /work && bash _test-fixtures/a1-xprov/run-tests.sh'`. The container must not see the real owner home.

### Metrics suite (spec 018)

`_test-fixtures/a1-metrics/run-tests.sh` covers `metrics escaped`, `metrics cost` and the postmortem `found_by` / `should_have_caught` fields. Its fixtures are byte copies of real vault files (the byte check runs only where `~/N3URAL-Vault` exists). Usage errors of both commands exit 1 (`help.cjs` `usage()`), a missing vault or I/O error exits 2. Before a PR, run it in `docker run --rm -u 1000:1000 -e HOME=/tmp -v <git-archive snapshot>:/w -w /w node:20 bash _test-fixtures/a1-metrics/run-tests.sh`.

## Self-checks: `verify run`, `test-fidelity`, dispositions (spec 017)

Run these before a PR; CI and the a1 skills run the same commands. Replace `<phase>` with a scope name
(`--phase` names the gate-log scope; omit it and the line goes to `_unscoped` with one stderr notice).

```bash
# all fixture suites as one verify run; writes verify_run into the file (exit 0 pass / 1 fail / 2 usage or bad config)
node _shared/a1-tools.cjs verify run --project . --out .a1/phases/<phase>/VERIFICATION.md --phase <phase>
# a VERIFICATION.md that claims PASS needs a green verify_run and no source change since head_sha
node _shared/a1-tools.cjs verify check .a1/phases/<phase>/VERIFICATION.md
# tests added or changed since main: mock-of-subject, skipped-test, early-return-guard, test-not-in-ci (exit 1 = findings)
node _shared/a1-tools.cjs test-fidelity --diff-base main --phase <phase>
# registry wiring and the CI workflow rules
node _shared/a1-tools.cjs gates lint && node _shared/a1-tools.cjs workflow lint
```

`.a1/verify.json` declares the commands (one per `_test-fixtures/*/run*.sh`, so a new suite is picked up without an edit).
`.a1/fidelity.json` holds `db_wrappers`, `test_globs` and `ci_globs`.

A finding is never switched off by a flag. Record a reason instead; the entry starts as `review: pending` and the
a1-pr-review step (Reinhard) upholds or overturns it before `pr merge-check` passes:

```bash
node _shared/a1-tools.cjs disposition add --kind fidelity --rule skipped-test --file tests/a.test.js --line 1 \
  --reason "skip tracks upstream bug 42, re-enabled when fixed" --by <who>
node _shared/a1-tools.cjs disposition review <fingerprint> --verdict upheld --reason "bug 42 is real" --by <reviewer>
```

`--by` is required on `review`: a verdict without a named reviewer, or by the entry's own author, fails the merge check.
The fingerprint is printed by `disposition add` and in every `test-fidelity` finding. Intent children never call
`disposition add` or `disposition review` (an autonomous child must not clear its own findings).

## Commit format

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `refactor`, `docs`, `chore`

Examples:
```
feat(a1-reconcile): add semantic DIVERGED probe via Alex
fix(a1-constitution): replace Finn with Alex as Phase 2 agent
docs(readme): add A1_VAULT_ROOT configuration section
```

## Using vs. contributing

- **Using a1-specforge (most people):** install it as a Claude Code plugin from the marketplace — no clone required. See the "Install via plugin marketplace" section in the [README](README.md).
- **Contributing (you, here):** clone this repo and run `./bin/install.sh` to symlink the skills and agents into `~/.claude/`. Symlinks mean your edits are live immediately — no reinstall between changes.

## Contributing a Gate-Pack

A Gate-Pack (see `docs/adr/2026-07-05-gate-pack-format.md`) is a versioned bundle of battle-tested gate patterns so others import proven gates instead of re-collecting the same bugs. The contribution path is one CLI call plus one PR.

See `packs/postgres-rls/` for a complete worked example (pack.yaml + 3 patterns) — read it before authoring your first pack.

1. **Author the pack.** Two ways:

   **a. Export from an existing learnings corpus** (only if you already run a1 with a Vault — `pack export` reads pattern entries from your Vault's `pattern/a1-learnings/patterns.md` and exits `2` on a fresh clone that has no corpus):
   ```bash
   node _shared/a1-tools.cjs pack export \
     --patterns rls-grant-matrix,schema-audit-trigger \
     --anonymize A2 --out packs/<name>/ --source "<your-corpus> (anonymized)"
   ```
   Export **refuses to write** if the anonymization deny-regex (`/Users/`, vault paths, e-mails, tenant names) hits the generated output — it lists the leak and exits non-zero. Use `--anonymize A3` for mechanism-only packs (code blocks stripped from diffs). Fill in `provenance` (occurrences, severity, date_range, source) in the generated `pack.yaml`.

   **b. Hand-author from the worked example** (recommended for a first pack, and the path if you have no Vault corpus): copy `packs/postgres-rls/` as a template — write `packs/<name>/pack.yaml` and one `packs/<name>/patterns/<id>.md` per pattern by hand, following the field structure there. No corpus required.

2. **Validate** before opening the PR:
   ```bash
   node _shared/a1-tools.cjs pack validate packs/<name>/
   ```
   Must exit 0. `checks/` may contain **only** `.json`/`.args.json` parameter files for already-shipped CLI subcommands — never executable payloads (that is the whole trust model: the PR review is the signature).

3. **Open a PR** with the pack directory. Maintainer review checks (ADR §6): anonymization holds (no paths/slugs/names/e-mails), every pattern has a valid `target{kind, skill, anchor}` and an `evidence_schema` describing what proof a run must show, and `checks/` carries no executable code.

Imported packs never self-apply: `pack import` stages them under `.a1/packs/<name>/`; application happens only through a1-evolve, where community provenance is capped so local evidence is still required.

## Pull requests

- Branch from `main` with a descriptive name: `<type>-<short-slug>` (e.g. `feat-mypack-gate-pack`, `fix-install-node-guard`), matching the commit `type`.
- One skill or concern per PR. Avoid mixing skill changes with unrelated refactors.
- Include a short description of the change and the motivation.
- If the change affects an agent brief (Output Contract), describe what changed and why.
- PRs are typically reviewed within a few days — if a week passes without a response, ping the linked issue.

## Questions

Open an issue or start a Discussion on GitHub.
