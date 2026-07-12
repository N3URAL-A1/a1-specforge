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

### Test fixtures

Any change to `_shared/a1-tools.cjs` requires fixture coverage per
[`_test-fixtures/CONVENTIONS.md`](_test-fixtures/CONVENTIONS.md), including the mandatory
hostile-input rejection case for every new CLI subcommand. Run the full suite before
opening a PR: `for r in _test-fixtures/*/run*.sh; do bash "$r" || break; done`.

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
