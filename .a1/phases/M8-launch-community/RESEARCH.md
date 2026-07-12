---
goal: M8 Launch & Community — plugin packaging, launch content drafts, demo, docs, contributor-flow validation, German→English workflow-body cleanup
generated: 2026-07-05
---

# Research: M8 — Launch & Community

## Tech Stack

- Repo: `a1-specforge` (public, `N3URAL-A1/a1-specforge` on GitHub). No app runtime — pure Markdown skill/agent definitions + a Node.js CLI (`_shared/a1-tools.cjs`, ~6.8k LOC, no external deps beyond Node ≥18 built-ins).
- Current distribution: `bin/install.sh` — symlinks 17 skill dirs + `_shared/` into `~/.claude/skills/`, and 18 agent `.md` files into `~/.claude/agents/`.
- CI: GitHub Actions runs fixture suites (`_test-fixtures/*/run*.sh`), `node --check`, and an `install.sh` smoke test on a clean `$HOME` (confirmed green per M7 VERIFICATION.md).
- Existing scaffolding already present (found during this research, not yet in roadmap text): `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/PULL_REQUEST_TEMPLATE.md` — CONTRIBUTING gap is smaller than the roadmap scope implies.

## (a) Claude Code plugin marketplace — current mechanics (mid-2026)

Sources: [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces), [Discover and install plugins](https://code.claude.com/docs/en/discover-plugins), [Plugins reference](https://code.claude.com/docs/en/plugins-reference).

**Two-file model, cleanly separable from the repo's current layout:**

1. **`plugin.json`** at `.claude-plugin/plugin.json` — the plugin manifest. Component directories (`skills/`, `agents/`, `commands/`, `hooks/`, `.mcp.json`, `.lsp.json`) live at the **plugin root**, siblings of `.claude-plugin/`, never inside it.
   - Required-ish fields (manifest itself is optional if you accept auto-discovery defaults): `name`, `version`, `description`, `author: {name}`.
   - Optional: `displayName`, `homepage`, `repository`, `license`, `keywords`, `skills`, `commands`, `agents` (path overrides), inline `hooks`, `mcpServers`, `lspServers`.
   - If no manifest: Claude Code auto-discovers `skills/`, `agents/`, etc. and derives the plugin name from the install directory — **but that directory name is a version string for marketplace-installed plugins**, so a manifest with an explicit `name` is effectively mandatory for a public plugin (avoids the invocation-name drifting on every update).

2. **`marketplace.json`** at `.claude-plugin/marketplace.json` in the repo root — the catalog. Lists plugin entries with a `name` (immutable slug — renaming breaks existing installs; use `displayName` for cosmetic changes) and a `source` (can point to the same repo, a different repo, git ref, local path, or npm).
   - **A single repo CAN be both a plugin and its own marketplace** — self-hosting is the standard pattern (e.g. `anthropics/claude-code` ships `.claude-plugin/marketplace.json` referencing plugins in the same tree under `plugins/`).

**Directory layout implication for a1-specforge — this is the crux risk (a):**
The current repo has 17 skill directories **at repo root** (`a1-new-feature/`, `a1-fix/`, …) plus `agents/*.md` plus `_shared/`. A Claude Code plugin expects **one** `skills/` directory and **one** `agents/` directory at the plugin root containing all the individual skill/agent dirs — i.e. `<plugin-root>/skills/a1-new-feature/SKILL.md`, not `<repo-root>/a1-new-feature/SKILL.md`. **This means either:**
   - (Option A — least disruptive) Add a thin plugin wrapper directory, e.g. `plugin/` or root-level `.claude-plugin/` + symlinks/copies: `skills/` and `agents/` directories that reference (or are generated from) the existing top-level skill dirs, keeping the current dev-friendly flat layout as the source of truth and the plugin structure as a build artifact.
   - (Option B — restructuring) Physically move all 17 skill dirs under `skills/` and all agent files under `agents/` (already true for agents) at repo root, then add `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` at root. This breaks the current `install.sh` symlink paths and CONTRIBUTING.md's documented skill-authoring layout unless updated together.
   - **Recommendation for the plan:** prefer Option A conceptually inverted — actually move to `skills/<name>/` (agents/ already matches), keep install.sh symlink logic but point at `skills/<name>` instead of `<name>`, update CONTRIBUTING.md path references, and add the two `.claude-plugin/*.json` files. This keeps one source of truth (no generated/duplicated files) and matches Anthropic's own `claude-code` repo convention (self-hosted marketplace + `skills/` root dir).
   - `_shared/` is not a skill or agent — it should NOT be discovered as a skill dir; needs either a `commands`/path exclusion or living outside `skills/`/`agents/` (it already does, as a root-level helper dir — fine to leave as-is next to `.claude-plugin/`).

**Agent frontmatter differs slightly for plugin-shipped agents:** supports `name`, `description`, `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, `skills`, `memory`, `background`, `isolation` (only valid value `"worktree"`). **`hooks`, `mcpServers`, `permissionMode` are NOT supported for plugin-shipped agents** for security reasons — audit the 18 agent files for any of these three fields before packaging (none currently expected to use them, but must verify — this is a hard plugin-loader rejection risk, not a style nit).

**Install flow (user-facing):**
```
/plugin marketplace add N3URAL-A1/a1-specforge     # or: claude plugin marketplace add ...
/plugin install a1-specforge@a1-specforge            # or: claude plugin install a1-specforge@a1-specforge --scope user
/reload-plugins
```
CLI equivalent for one-command, non-interactive install: `claude plugin install <plugin-name>@<marketplace-name>` (installs to user scope by default; `--scope project|local` available). This satisfies the M8 "one-command install" goal directly — no custom install script needed once packaged, **replacing** (or supplementing) `install.sh`'s symlink approach for marketplace users, while `install.sh` remains useful for contributor/dev workflows (live-edit symlinks).

**Skill naming after install:** plugin skills are namespaced (`<plugin-name>:<skill-name>` in @-mention typeahead) but auto-activation by description still works the same way as symlinked skills — no behavior change expected for the auto-activation UX that's central to this framework's pitch ("just describe what you want").

**Validation tooling:** Anthropic ships a `plugin-dev` toolkit plugin in the official marketplace for authoring/validating plugins — worth installing during M8 build to lint the manifest before publishing.

**Risk (explicitly the big one, as flagged in the prompt):** the plugin loader's rigid `skills/`/`agents/` root-directory expectation vs. the repo's current flat top-level-skill-directory layout is a real structural migration, not a config tweak. It touches `install.sh`, `CONTRIBUTING.md` (skill structure section), and any doc/CI path that assumes `<repo-root>/a1-<name>/`. This should be its own wave with its own rollback checkpoint.

## (b) Launch-channel norms

- **Show HN:** title convention is literal and modest — `Show HN: <Project> – <one-line, no superlatives>`. HN guidelines explicitly discourage "fastest/best/first" language; a builder/engineer tone reads better than marketing copy. Author should be visibly present in the thread. For a1-specforge: title should name the concrete mechanism (self-learning gates, spec-driven pipeline) rather than "revolutionary AI framework" framing — matches the project's own anti-hype instinct (VISION.md explicitly rejects the commercial/hype angle).
- **Comparable tool reception:** `claude-task-master` (Taskmaster) went 0→15,500 GitHub stars in 9 weeks off community reception, described as resonating strongly with the "AI-native development" crowd — suggests genuine utility + clear before/after framing (task-master's pitch: "reduces X% errors", concrete workflow) outperforms abstract framework claims. No specific Show HN post text was recoverable via search for spec-kit/Taskmaster/claude-flow — the plan should not assume a specific proven post exists to copy; draft from HN's general guidelines + the project's own real numbers (15 applied patterns, 17+ runs, dated provenance) as the credibility anchor, matching what actually worked for Taskmaster.
- **r/ClaudeAI / r/LocalLLaMA norms (general subreddit convention, not confirmed via fresh search this session but standard and stable):** show-don't-tell — a GIF/demo in the post outperforms prose; disclose non-anonymously that you're the author; avoid cross-posting identical copy to HN and Reddit same-day (readers notice and penalize obvious multi-channel blasts); a top-level comment from the author with technical depth (architecture, gate mechanism) is expected and rewarded.
- **LinkedIn (Sabine's channel, not pipeline-authored):** different register — company/brand framing, N3URAL.AI attribution, less "look what I built" and more "here's what we learned building this at scale" — the pipeline should draft raw material (metrics, learnings count, gate examples) for Sabine to adapt, not a finished LinkedIn post.

## (c) Demo formats — practical without a live SaaS

- **[VHS](https://github.com/charmbracelet/vhs)** (Charmbracelet) is the standard tool for this: scriptable `.tape` files describe terminal actions (Type, Enter, Sleep, Set FontSize/Width/Height) and render to `.gif`, `.mp4`, `.webm`, or raw frames. Requires `ttyd` + `ffmpeg` on the machine that renders (not a runtime dependency for viewers — output is a static GIF/video file committed to the repo or linked).
- Fits this project well: a1-specforge's entire pitch is CLI-driven (`"new feature for my-project: ..."` → skill auto-activates), so a VHS tape scripting a real `a1-new-feature` or `a1-fix` run against a toy repo is a faithful, reproducible demo — no mocked SaaS UI needed, no editing/faking required beyond picking a clean toy fixture repo and possibly speeding up/cutting long agent-thinking pauses.
- Recommended artifact: one `.tape` source file committed under `docs/demo.tape` (reproducible, diffable, re-recordable when the CLI changes) + the rendered `docs/demo.gif` referenced from README. A demo **video script** (for a longer walkthrough, e.g. for LinkedIn/YouTube) is a separate markdown script, not something the pipeline can execute — write it as prose but flag "not a build-able artifact; needs a human/Sabine to record voiceover."

## (d) German workflow-body inventory (M7-deferred)

Grep for actual German prose (not just umlaut false-positives — verified by reading matched lines) across all `*/workflows/*.md`:

| File | German lines (approx) | Total lines | Content |
|---|---|---|---|
| `a1-fix/workflows/00-preflight.md` | 8 | 91 | Integrity-error message + one output-format example line |
| `a1-new-feature/workflows/06-verify.md` | 9 | 306 | Verification checklist phrasing, user-facing prompt strings |
| `a1-new-project/workflows/02-scope.md` | 6 | 113 | User-facing interview questions ("Später" = "Later" MVP split) |
| `a1-modernize/workflows/03-gap-analysis.md` | 4 | 108 | (umlaut hits only, low-content) |
| `a1-modernize/workflows/02-reverse-spec.md`, `01-scope.md`, `06-execute.md`, `05-plan.md` | 3 each | 75–185 | Scattered German comment/prompt lines |
| `a1-modernize/workflows/07-publish.md` | 5 | 171 | |
| `a1-modernize/workflows/04-tech-proposals.md` | 2 | 97 | |
| `a1-analyze/workflows/05-report.md`, `a1-execute/workflows/03-verify.md`, `a1-new-feature/workflows/04-plan.md`, `a1-new-project/workflows/04-feature-split.md`, `a1-pr-review/workflows/01-detect.md`, `a1-worktree/workflows/03-exit.md` | 1–2 each | — | Isolated stray lines |
| `a1-new-project/workflows/05-feature-loop.md` | 1 | 141 | |

**Total: ~55-60 individual German lines across 18 files**, none of which is a fully German file — these are scattered German user-facing prompt strings, example dialogue, and a couple of code-comment-style asides left over from the original German-first authoring, exactly matching the roadmap's framing ("Some workflow bodies are still mixed-language"). This is a **small, mechanical translation task** (translate-in-place, preserve Markdown structure, no restructuring needed) — realistically a half-day pass, not a research risk. Recommend one pass per file with a grep-verify-zero gate at the end (same pattern used for the M7 hardcode sweeps).

## (e) Contributor-flow gaps (external-stranger read of CONTRIBUTING.md)

What exists already (better than the roadmap scope implies):
- `CONTRIBUTING.md` is clear and complete for the "modify an existing skill" and "add a new skill" paths, including commit format and gate-pack export/validate/PR steps.
- `.github/ISSUE_TEMPLATE/bug_report.md` and `feature_request.md` already exist with sensible fields.
- `.github/PULL_REQUEST_TEMPLATE.md` already exists with a useful checklist (skill affected, type of change, testing).

Gaps found reading as a first-time stranger:
1. **No "good first issue" labeling or curated entry-point list.** CONTRIBUTING.md assumes the contributor already has a concrete skill/bugfix in mind. Nothing routes a curious stranger to a small, well-scoped starter task. → Needs 3-5 labeled `good-first-issue` GitHub issues seeded before launch (e.g. "add a missing workflow numbered file", "translate remaining German lines in X", "add a fixture test for Y").
2. **No explicit "PR review SLA / who reviews" statement.** A stranger doesn't know if this is a maintained-daily project or a side project that might ghost their PR for weeks — affects willingness to invest effort. One sentence in CONTRIBUTING.md or README would close this.
3. **Gate-pack contribution path is well-documented but has zero worked example a stranger can copy-paste end-to-end without already having local learnings** — the `postgres-rls` pack exists in `packs/` as a reference, but CONTRIBUTING.md doesn't point to it as "here's a complete real example, read this first." One added sentence/link closes this.
4. **No CODE_OF_CONDUCT.md** — common expectation for public OSS repos aiming for external contributors; its absence is a soft trust signal gap, low effort to add (standard Contributor Covenant template).
5. **CONTRIBUTING.md doesn't mention the plugin/marketplace install path at all** (it only documents the clone+symlink dev setup) — once M8 ships the plugin, contributor docs need a note distinguishing "I want to use this" (plugin install) from "I want to contribute" (clone + symlink, unchanged).
6. **No architecture/overview doc** beyond README's skill table — a stranger wanting to modify `a1-evolve` or the shared CLI has no map of `_shared/a1-tools.cjs`'s ~6.8k LOC beyond "deterministic helpers." Not blocking a first PR to a skill's Markdown, but blocking a first PR touching the CLI. Low priority for M8; could be a stretch item.

None of these are structural rewrites — CONTRIBUTING.md itself needs no rework, only additive small documents/issues/labels. This significantly de-risks the "external-contributor flow validation" scope item; it's mostly seeding + a few sentences, not a new document architecture.

## External Dependencies

| Dependency | Current | Required | Notes |
|---|---|---|---|
| Claude Code plugin system | n/a (symlink install only) | plugin.json + marketplace.json schema per [plugins-reference](https://code.claude.com/docs/en/plugins-reference) | New; self-hosted marketplace is the standard pattern, confirmed viable for this repo |
| VHS (charmbracelet) | none | for demo GIF rendering only, dev/CI-time tool, not a runtime dep | Requires `ttyd` + `ffmpeg` on the rendering machine |
| GitHub issue/PR templates | already present | — | No new work needed, contrary to roadmap's implicit assumption |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Plugin `skills/`/`agents/` root-dir convention conflicts with repo's current flat top-level-skill-dir layout | HIGH | Dedicated wave: physically move skill dirs under `skills/`, update `install.sh` + CONTRIBUTING.md paths together, verify with fresh-machine install test (same pattern as M7's fresh-machine test) |
| Plugin-shipped agents silently reject if any agent frontmatter uses `hooks`/`mcpServers`/`permissionMode` | MED | Grep all 18 `agents/*.md` frontmatter for these three keys before packaging; fix or drop before publish |
| Renaming the plugin's marketplace `name` after first users install breaks their installs (immutable slug) | MED | Pick and freeze `name: a1-specforge` before first public plugin release; use `displayName` for any later cosmetic rename |
| Two install paths (symlink `install.sh` for devs vs. plugin marketplace for users) diverge over time | MED | Document explicitly in README/CONTRIBUTING which path is for whom; keep install.sh as source-of-truth symlink target consistent with the new `skills/` layout so both paths point at the same files |
| ≥100 stars / ≥1 external PR merged are stated as M8 success criteria but are **outcome** goals outside the plan's control | LOW (scope clarity, not execution risk) | Plan should build enablers only (packaging, docs, seeded good-first-issues, launch draft content) and explicitly not claim to guarantee the outcome metrics; VERIFICATION.md should distinguish "enabler shipped" from "outcome achieved" |
| German-line translation touches user-facing prompt strings inside active workflow logic (not just comments) | LOW | Translate in-place preserving exact Markdown/variable syntax; re-run existing fixture tests after each file to catch accidental logic breakage |
| Show HN / Reddit posts read as "marketing speak" if drafted from VISION.md's pitch language directly | MED | Draft launch copy from concrete artifacts (15 applied patterns, dated provenance, gate examples) rather than vision-doc superlatives; explicitly avoid "revolutionary/first/best" language per HN norms |

## Recommendations

1. **Split M8 into two waves with a hard checkpoint between them:** Wave 1 = plugin packaging (the structural risk), Wave 2 = everything else (docs, launch drafts, demo, contributor seeding, German translation) — because Wave 1 is the only piece with real technical uncertainty and a rollback risk; the rest is additive and low-risk.
2. **Move skill directories under a `skills/` root** (matching Anthropic's own self-hosted `claude-code` repo convention) rather than inventing a separate plugin-only copy — one source of truth, update `install.sh` and CONTRIBUTING.md paths in the same commit, and re-verify the fresh-machine smoke test from M7 still passes post-move.
3. **Audit agent frontmatter for `hooks`/`mcpServers`/`permissionMode` before writing `plugin.json`** — this is a hard plugin-loader compatibility gate, cheap to check now (grep), expensive to discover after publishing.
4. **Use VHS with a committed `.tape` source** for the demo GIF, scripted against a toy fixture repo (leverage existing `_test-fixtures/` infrastructure) — reproducible, no live SaaS needed, matches the project's existing testing culture.
5. **Treat launch content as drafts only** (explicit per the prompt) — write Show-HN/Reddit/LinkedIn copy grounded in real numbers (15 patterns, dated provenance, gate examples from the corpus) rather than VISION.md's aspirational framing; flag clearly in the PLAN that publication is Robert/Sabine's manual action, not a pipeline deliverable.
6. **Contributor-flow work is smaller than the roadmap scope suggests** — CONTRIBUTING.md, issue templates, and PR template already exist and are solid; the real remaining gaps are seeding 3-5 `good-first-issue` labeled issues, adding a CODE_OF_CONDUCT.md, and one sentence pointing to the `postgres-rls` pack as a worked example.

## Key File References

- `/Users/rob/code/a1-skills/docs/roadmap.md` — M8 scope and success criteria (lines 65-81)
- `/Users/rob/code/a1-skills/docs/VISION.md` — plugin distribution listed as creative direction #6; gate-packs/learning-exchange as the actual moat (avoid over-indexing launch copy on the plugin alone)
- `/Users/rob/code/a1-skills/docs/adr/2026-07-05-gate-pack-format.md` — pack format already ADR'd; `postgres-rls` first pack exists in `packs/`
- `/Users/rob/code/a1-skills/README.md` — current install instructions (symlink-based), skill/agent tables to keep in sync with any plugin manifest's declared components
- `/Users/rob/code/a1-skills/CONTRIBUTING.md` — skill structure section (lines 21-35) needs a path update if skills move under `skills/`
- `/Users/rob/code/a1-skills/bin/install.sh` — symlink logic to update if skill dirs relocate under `skills/`
- `/Users/rob/code/a1-skills/agents/*.md` (18 files) — audit for disallowed plugin-agent frontmatter fields
- `/Users/rob/code/a1-skills/.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md` — already present, contrary to roadmap assumption
- `/Users/rob/code/a1-skills/packs/postgres-rls/` — reference gate-pack, worth linking from CONTRIBUTING.md
- German-prose files (18, see table in section d): `a1-fix/workflows/00-preflight.md`, `a1-new-feature/workflows/06-verify.md`, `a1-new-project/workflows/02-scope.md`, `a1-modernize/workflows/{01-scope,02-reverse-spec,03-gap-analysis,04-tech-proposals,05-plan,06-execute,07-publish}.md`, `a1-analyze/workflows/05-report.md`, `a1-execute/workflows/03-verify.md`, `a1-new-feature/workflows/04-plan.md`, `a1-new-project/workflows/{04-feature-split,05-feature-loop}.md`, `a1-pr-review/workflows/01-detect.md`, `a1-worktree/workflows/03-exit.md`
