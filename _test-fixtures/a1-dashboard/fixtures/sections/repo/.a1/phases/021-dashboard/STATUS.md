# STATUS — 021-dashboard

## Wave 1 — CLI scaffold, slug rule, exit contract, atomic owner-marked write
Completed: 2026-10-24

| Task | Status | Commit | Notes |
|---|---|---|---|
| CLI, slug rule, exit contract, atomic write, stubs, help, suite part 01 | DONE | 3f09541 | suite a1-dashboard 69/69 |

### Wave 2-4 contract (stub seam)
- Section: `{ name, state: 'ok'|'none'|'not_available', reason?, items: string[] }`.
- `dashboard-sources.cjs` `collectSections(ctx)` -> six sections (Now, Next, Specs, Phases, Learnings, Open points). W2 owns.
- `dashboard-cost.cjs` `costSection(ctx)` -> Cost section. W4 owns.
- `dashboard-render.cjs` `render(sections, meta)`; meta `{ slug, generated, sourceHead }`; frontmatter + banner format is tested by part 01. W2 owns.
- `dashboard-read.cjs` `readSource(path, ctx)`, `cleanText(v)`, `writerCheck(slug, root, env)` -> `{allow:true}` | `{allow:false, reason}` where reason is `this host is not the vault writer (<host> ≠ <writer>)` (dashboard.cjs prints `[a1-tools] dashboard skipped: <reason>`). W3 owns.
- ctx passed to readers: `{ cwd, env, clock, ops, trace, args, repoRoot, slug, root }`.
- Stub reason `not_implemented` is removed by the owning wave.
- Suite: parts/*.sh sourced in sorted order; helpers `expect`, `expect_has`, `expect_lacks`, `expect_count`, `tree_hash`, `mk_fixture_repo`, `mk_fixture_vault`, `vault_run`, `harness_run`, `json_get`.

### Deviations
- vault root via `peekVaultRoot()` (same tier rule as `externalVaultRoot()`), because the latter announces the learnings root on stderr.
- README runner count 49 -> 50 in this wave (gates-lint suite checks it). Wave 5 must not bump it again.
- Skip branch for non-writer implemented in dashboard.cjs now.
