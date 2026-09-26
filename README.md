# a1-specforge

**Spec-driven development pipeline for Claude Code — from idea to reviewed PR, with a built-in self-learning loop.**

<!-- TODO(Robert): embed docs/assets/demo.gif once rendered — see docs/launch/demo-recording-steps.md -->
<!-- ![a1-specforge demo](docs/assets/demo.gif) -->
<!-- Demo: the schema gate fails a migration missing Row-Level Security, the corrected migration passes, and a shareable gate-pack validates. -->


Claude Code is powerful, but without structure every session restarts from scratch: unclear specs, inconsistent plans, no trace of what was decided. a1-specforge gives Claude Code a backbone — auto-activating skills that guide every phase of a feature build, enforce consistency at deterministic gates, hand off between sub-agents automatically, and feed observations back into a self-optimizing learning loop.

<!--
  README scope note (keeps the bijective install/README check honest):
  bin/install.sh is the single source of truth for the installed set. Its
  grepped set = 17 skills + 21 agent names + the project slug. This README names
  exactly that set (skills AND agents both with the shared prefix) and no other
  matching token. The shared CLI is referenced only as the _shared/
  path, never by its filename, to avoid introducing a non-installed token. The
  personal checkpoint skill is NOT part of the public set (see
  docs/checkpoint-migration.md).
-->

## Quickstart

No environment variables required. From a clean machine:

```bash
git clone https://github.com/N3URAL-A1/a1-specforge.git
cd a1-specforge
./bin/install.sh
```

`install.sh` symlinks all skills and agents into `~/.claude/skills/` and `~/.claude/agents/`. Edits in the repo are live immediately — no reinstall. This is the **contributor / dev path** (live-edit symlinks).

### Install via plugin marketplace (users)

If you just want to use a1-specforge (no local edits), install it as a Claude Code plugin from the self-hosted marketplace — three commands:

```bash
claude plugin marketplace add N3URAL-A1/a1-specforge
claude plugin install a1-specforge@a1-specforge
claude plugin list        # confirm a1-specforge@a1-specforge is installed
```

All 17 skills and 21 agents load from the plugin. To remove: `claude plugin uninstall a1-specforge` then `claude plugin marketplace remove a1-specforge`. Contributors who want to edit skills in place should use `./bin/install.sh` above instead.

Then just describe what you want in Claude Code; the matching skill activates:

```
"new feature for my-project: edit user profile"
→ a1-new-feature activates → spec written → wave-plan built
→ consistency gate checks spec ↔ plan → code agents implement → PR reviewed
```

**Requirements:** Claude Code CLI, Node.js ≥ 18, git.

## Skills (17)

All 17 skills below match the `SKILLS` array in `bin/install.sh` exactly.

| Skill | Phase | Purpose |
|---|---|---|
| `a1-new-feature` | Build | End-to-end feature pipeline: Discover → Specify → Clarify → Plan → Consistency Gate → Implement → Verify. Size-triaged (S/M/L): small features run every phase and gate in compact form. |
| `a1-new-project` | Build | Bootstrap a brand-new project from zero to a working feature backlog: Bootstrap → Scope-Interview → Roadmap → Backlog → first feature. |
| `a1-fix` | Build | End-to-end bug pipeline with a project-scoped learning loop: Pre-Flight → Report → Diagnose → Fix → Verify → Postmortem. |
| `a1-plan` | Plan | Full phase-planning pipeline: Research → Map → Plan → Audit, producing an executor-ready `PLAN.md` with waves and verifiable success criteria. |
| `a1-execute` | Execute | Wave-by-wave execution of a `PLAN.md` with a user checkpoint between waves and final goal-backward verification. |
| `a1-roadmap` | Plan | Create and manage roadmaps — break a product vision into milestones and phases and scaffold the `.a1/` directory for `a1-plan`. |
| `a1-analyze` | Insight | Read-only codebase analysis in five phases (parallel sub-agents): general, security, architecture, quality, onboarding. |
| `a1-modernize` | Insight | Understand, fix, or modernize an undocumented codebase. Two modes: `spec-only` (derive spec, read-only) and `full` (spec + gaps + wave-based fix plan). |
| `a1-progress` | Insight | Read-only project snapshot — scans `.a1/` state plus git/test/build state and recommends the next skill to run. |
| `a1-checklist` | Gate | Pre-flight readiness gate — 11 deterministic checks on a wave-plan (BLOCKER / MAJOR / MINOR), incl. the spec↔plan consistency gate (checks #9/#10: bijective FR coverage + frontmatter link) and the spec↔roadmap status check (#11) that `a1-new-feature`'s Phase 4.5 runs via `--only 9,10,11`. |
| `a1-quick` | Build | XS quick lane for tiny, low-risk features/fixes — single session, zero mandatory sub-agent spawns, branch-based isolation, one run-record artifact, one checkpoint. Reachable via a deterministic eligibility gate from `a1-new-feature` Discover and `a1-fix` Phase 0. |
| `a1-constitution` | Setup | Generate/update a project's `constitution.md` — behavioral rules separated from CLAUDE.md's project facts, with 4-layer override precedence. |
| `a1-phantom` | Verify | Phantom-task detection — flags `[X]` tasks in `PLAN.md` with no matching git change. Warning-level, never blocks (always exits 0). |
| `a1-reconcile` | Verify | Spec-vs-implementation drift detection — classifies findings as MISSING / EXTRA / DIVERGED / STALE. |
| `a1-pr-review` | Review | Turns a finished branch into a reviewed PR: Detect → Review (reviewer sub-agent) → Draft → Submit. BLOCKER findings halt. |
| `a1-worktree` | Isolation | Isolated Git worktree lifecycle: Prepare → Enter → Exit (keep / discard / handoff), so agents work in a parallel checkout. |
| `a1-evolve` | Learn | Self-optimization engine — reads accumulated observations and `_learning.md` files, clusters recurring patterns, scores by impact, proposes concrete skill diffs. |

## Agents (21)

`install.sh` also symlinks 21 shared framework agents (counted from `agents/*.md`). Each installed file is the agent name below plus `.md`. Deliberate exclusions from install are tracked in `bin/install-exclusions.txt` (empty today — all agents install).

| Agent | Role |
|---|---|
| `a1-rico-researcher` | Research context, domain, prior art |
| `a1-marco-mapper` | Map codebase structure and architecture |
| `a1-pablo-planner` | Turn spec + research into an executable wave-plan |
| `a1-adam-auditor` | Audit plan quality and coverage gaps |
| `a1-erik-executor` | Execute one wave of a plan with commits |
| `a1-victor-verifier` | Goal-backward verification of a phase |
| `a1-falk-fault-finder` | Bug triage and root-cause analysis |
| `a1-reinhard-reviewer` | Code / PR review (line-level, security) |
| `a1-rafael-reverse-spec` | Derive a spec from existing code |
| `a1-theo-test-engineer` | Test design and coverage |
| `a1-tobi-tester` | Product / launch-readiness audit |
| `a1-rene-requirement-engineer` | Idea → requirements and backlog |
| `a1-alex-architekt` | System design and ADRs |
| `a1-walter-web-developer` | Web / full-stack implementation |
| `a1-aik-ai-engineer` | AI/ML, RAG, agent logic |
| `a1-uwe-ux-expert` | UX research and UI design |
| `a1-vincente-vibe-optimizer` | Build/code-task orchestration |
| `a1-ludwig-legal` | Legal / compliance (GDPR, EU AI Act) |
| `a1-samuel-security` | Security specialist — threat modeling, auth/authz, supply-chain, secrets, injection-surface review |
| `a1-diana-docs` | Documentation specialist — README, API docs, guides, docs-vs-code drift |
| `a1-dario-devops` | DevOps/deploy specialist — deployments, CI workflows, env/secrets, rollback runbooks |

## Shared CLI

Deterministic helpers for all pipelines live under `_shared/` (`~6.8k` LOC): atomic frontmatter writes, number/suffix reservations, spec/fix/analyze scaffolding, phantom and schema checks, cost tracking, and the learning-store resolver. Skills call it; you rarely invoke it directly.

### Vault mirror and cockpit (spec 010)

When an external vault is configured (`A1_VAULT_ROOT`), the CLI keeps a read-only copy of each project's product and phase state there, so a notes app such as Obsidian can show it next to the specs. The direction is **one-way: repo → vault, verbatim, never back.** The repo stays canonical. Nothing reads the mirror back, an edit made in the vault is overwritten by the next mirror, and hub notes and sync-conflict copies are never written or deleted. The decision is recorded in [`docs/adr/2026-09-24-vault-mirror-single-writer.md`](docs/adr/2026-09-24-vault-mirror-single-writer.md). The mirrored paths are listed in [`docs/product/SCHEMA.md`](docs/product/SCHEMA.md) §8.

Every product-mutating command (`product init`, `add-milestone`, `add-feature`, `stage`, …) mirrors `docs/product/` after its repo write and reports the outcome as `vault_mirror: {status: "ok"|"skipped", files}`. A failed mirror never fails the command. It prints one `[a1-tools] vault mirror skipped: <reason>` line and the exit code is unchanged. The phase skills (`a1-plan` audit, `a1-execute` execute and verify) call `vault sync <slug> --phases` after they write `.a1/phases/`.

| Command | What it does | Exit |
|---|---|---|
| `a1-tools vault sync [<slug>] [--product] [--phases] [--dry-run] [--prune] [--json]` | Rebuilds the mirror. The slug comes from the `docs/product/ROADMAP.md` frontmatter `project:`; a different `<slug>` is refused. `--prune` deletes vault files without a repo source, only inside `product/` and `phases/`. | 0 ok or skipped, 1 usage/slug mismatch, 2 no external vault root |
| `a1-tools vault status [<slug>] [--json]` | Read-only drift report: `missing`, `stale`, `extra` and `conflict` findings, plus `host`, `writer_host` and `may_write`. | 0 in sync or skipped, 1 drift, 2 cannot run |
| `a1-tools vault lint [<slug>] [--json] [--fix-type [--dry-run]]` | Frontmatter check of `project/<slug>/{spec,plans,fixes,postmortems,analyses,quick}/`: missing, unknown or misplaced `type:`, invalid status, folded scalars, conflict copies. `--fix-type` stamps `type:` on every file with a `type_missing` finding whose frontmatter parses and is not folded (other findings, such as status outliers, stay reported). It edits one line: an empty `type:` is replaced, otherwise the key is inserted first. A second run writes 0 files. Unparseable and folded files are left untouched and listed under `skipped` for manual repair. | 0 clean or skipped, 1 findings, 2 cannot run |
| `a1-tools vault link-hub <slug> (<artifact-path> \| --spec <id>)` · `--all-specs` | Appends `- references [[project/<slug>/<subfolder>/<name>]]` under `## Relations` in `project/<slug>.md`. Idempotent, keeps CRLF line endings, never links a conflict copy and never creates a missing hub. | 0 ok or skipped, 1 usage or missing hub, 2 no external vault root |
| `a1-tools schema export --json` | Prints the versioned read contract for vault readers: artifact types, every status vocabulary, the mirror sets and the hub relation line. Output is byte-stable; `contract_version` is bumped on any change. | 0 |
| `a1-tools spec init <slug> <feature-slug> --title <t> [--size S\|M\|L]` | Writes a new spec at the next number with `type: spec` as the first key and `status: discovering`, then links it from the hub (`hub: linked\|unchanged\|missing\|refused-link\|skipped-non-writer`). | 0 ok, 1 refused |
| `a1-tools product validate --spec-status` | Also compares each roadmap feature with its spec. A terminal disagreement (one side `done`/`cancelled`) is a violation that names the reconciling command and exits 1; other differences are warnings. | 0 valid, 1 invalid or violation |

`a1-checklist` check **#11** (`spec_roadmap_status_coherent`) runs the same spec↔roadmap comparison per feature. It raises a BLOCKER on a terminal disagreement and passes when the project has no roadmap or the feature is not on it. A roadmap of this project that exists but cannot be read or parsed fails the check, naming the file and the parse error. With `--only` and no 11, check #11 is not evaluated at all (no roadmap lookup, no code-roots scan). `a1-new-feature`'s consistency gate (Phase 4.5) runs `a1-tools checklist run <slug>/<id> --only 9,10,11`.

**Two hosts, one vault.** When two machines share one synced vault, set `A1_VAULT_WRITER_HOST` on both to the name of the one machine that may write the mirror (see [Configuration](#configuration)). On every other host, `vault sync`, the product mirror hook, `vault lint --fix-type`, `vault link-hub` and the hub link of `spec init` each print one `[a1-tools] <what> skipped: this host is not the vault writer (<host> ≠ <writer>)` line, where `<what>` names the skipped write (`vault mirror`, `vault lint --fix-type`, `vault link-hub` or `spec init hub link`). They write nothing to the vault and keep their exit code. Repo writes and spec files are written on every host. When the variable is unset, every host may write.

**No vault configured.** With `A1_VAULT_ROOT` unset, nothing is mirrored and, apart from the FR-037 exceptions below, nothing extra is printed. Product commands emit no `vault_mirror` key. The stdout, stderr and written files of `product stage` and `analyze init` are byte-identical to the release before spec 010 (commit `475382a`). `spec update-status` to a terminal status, on a spec whose feature the roadmap lists, differs in two lines only, both spec-lifecycle changes: the updated body status header and one `hint:` line. The fixture `a1-vault-fallback` (cases G1–G3, with `golden/spec-update-status.allowed-diff`) pins this. The `vault` commands need an external vault and exit 2 with `no external vault root (tier repo-local); set A1_VAULT_ROOT`; that refusal creates nothing (no `.a1/learnings/`). A configured root that is missing or read-only is not an error (FR-010). `vault sync` then prints one `[a1-tools] vault mirror skipped: <reason>` line, and `vault status`, `vault lint` and `vault link-hub` print one `[a1-tools] vault <command> skipped: <reason>` line. The reason names the root; nothing is written and the exit code is 0. The complete list of FR-037 exceptions, i.e. outputs that change even without a vault because spec 010 requires them: `spec update-status` (the body status header and the `hint:` line, above), `workflow lint` (the new key `vault_sync_checked`, FR-008), and `checklist run` (the new check #11 when it is selected, FR-029).

## Configuration

**No configuration is required.** The learning store resolves automatically via a 3-tier fallback chain (precedence: env > repo-local > legacy):

| Tier | Source | When used |
|---|---|---|
| 1 | `A1_VAULT_ROOT` (env) | Set explicitly → used as-is; directory created on first write. |
| 2 | repo-local `.a1/learnings/` | Default inside any git repo — auto-created on first write. |
| 3 | legacy `~/N3URAL-Vault` | Only if it already exists **and** you are not inside a git repo; emits a deprecation warning. |

If none resolve (not in a git repo, no env, no legacy vault), the CLI hard-fails with exit 2 and tells you to set `A1_VAULT_ROOT` or run inside a git repo — **no silent degradation**. The resolved root and its source are printed once per process to stderr.

| Variable | Default | Description |
|---|---|---|
| `A1_VAULT_ROOT` | *(unset)* → repo-local `.a1/learnings/` | Optional. Point the learning store at an external vault (e.g. an Obsidian notes directory). |
| `A1_VAULT_WRITER_HOST` | *(unset)* → every host may write the vault mirror | Optional, for two machines sharing one synced vault. Only the host whose `os.hostname()` equals this value (exact match) writes `project/<slug>/product/` and `phases/`; any other host skips with one stderr line and an unchanged exit code. `a1-tools vault status --json` reports `host`, `writer_host` (`undeclared` when unset) and `may_write`. Print a machine's name with `node -e 'console.log(require("os").hostname())'`. |

```bash
# Optional — only if you want an external vault instead of repo-local .a1/learnings/
export A1_VAULT_ROOT="/path/to/your/notes"
# Optional — two hosts, one synced vault: name the single host that writes the mirror
export A1_VAULT_WRITER_HOST="my-laptop.local"
```

## Language policy

English-first; German trigger phrases remain supported as aliases. Some workflow bodies are still mixed-language — full unification is deferred to M8.

## Testing

22 fixture test suites live under `_test-fixtures/*/run*.sh` (including the vault-fallback and phantom runners) plus a nested schema-check parser runner. Run them all:

```bash
for r in _test-fixtures/*/run*.sh; do bash "$r" || break; done
```

CI runs the same suites, a `node --check` on the CLI, and an `install.sh` smoke test on a clean `$HOME`.

## vs. GSD / spec-kit

| | GSD | spec-kit | a1-specforge |
|---|---|---|---|
| Execution loop | ✅ | ❌ | ✅ |
| Spec writing | ❌ | ✅ | ✅ |
| Multi-agent orchestration | ❌ | ❌ | ✅ |
| Auto-activating skills | ❌ | ❌ | ✅ |
| Deterministic consistency gates | ❌ | ❌ | ✅ |
| Drift + phantom detection | ❌ | ❌ | ✅ |
| Self-learning loop (observations → evolve) | ❌ | ❌ | ✅ |
| Cost tracker | ❌ | ❌ | ✅ |
| Reusable gate-packs (`packs/`) + `docs/CONSTITUTION.md` | ❌ | ❌ | ✅ |

## Structure

```
a1-specforge/
├── <skill>/            # 16 skill directories (see table above)
├── agents/             # 21 shared framework agents (one .md each)
├── _shared/            # deterministic CLI helpers (frontmatter, reservations, checks)
├── _extras/            # non-pipeline skills (hero-animation-builder) — not installed by install.sh
├── packs/              # reusable gate-packs (e.g. postgres-rls)
├── bin/install.sh      # symlink setup
├── docs/               # roadmap.md, CONSTITUTION.md, feature-entry-conditions.md, …
└── _test-fixtures/     # fixture test suites
```

## Roadmap

→ [`docs/roadmap.md`](docs/roadmap.md)

---

Built by [N3URAL.AI](https://n3ural.ai) · Runs on [Claude Code](https://claude.ai/code)
