# VERIFICATION — M8 Launch & Community

**Date:** 2026-07-05 · **Verdict: PASS (all buildable enablers shipped; 2 outcome criteria time-deferred by design)**

## Per-criterion

| Criterion | Result | Evidence |
|---|---|---|
| Plugin installable via marketplace | ✅ | Live validation: `claude plugin validate` passed; `marketplace add` + `install a1-specforge@a1-specforge --scope local` exit 0; plugin details showed **Skills (17) + Agents (18)**; cleanly uninstalled. Manifests: `.claude-plugin/plugin.json` + `marketplace.json` (validator-corrected schema) |
| Gate-pack published | ✅ | `packs/postgres-rls/` (shipped in the build wave, A2-anonymized, `pack validate` exit 0); contributor dry-run authored a second pack from the example |
| Launch posts + stars | ⏳ deferred | Drafts in `docs/launch/{show-hn,reddit,linkedin}.md` (hype-free, real numbers, forbidden-word grep clean); `docs/demo.tape` + render instructions (vhs not installed locally — no faked GIF) |
| External PR merged | ⏳ deferred | Enablers: CODE_OF_CONDUCT.md, 4 good-first-issue drafts + publish commands (gh account gotcha honored), CONTRIBUTING dry-run fixed 2 real friction points (pack-export dead end for strangers → hand-author path; missing branch convention) |

## Structural verification (post skills/-move)

- Full fixture suite (14 runners + nested parser): exit 0 — after the move, after translations, after all doc waves
- CI green on GitHub Actions after both pushes (restructuring push + waves 2–4 push)
- Fresh-machine simulation re-run post-move: install exit 0, repo-local writes, **0 tracked modifications**
- Bijective README↔install.sh diff: exit 0 (held through hero edit)
- German-marker grep over `skills/*/workflows/`: clean (3 whitelisted intentional alias lines documented in STATUS.md); Wave-2 safety net caught 5 umlaut-free German lines the MAP inventory missed, incl. one uninventoried file
- History preserved: `git log --follow skills/a1-fix/SKILL.md` spans pre-move commits

## Notable

1. The plugin manifest template from research/MAP failed the live validator twice (owner object, author shape, invalid skills/agents path fields) — the executor corrected against the authoritative validator and logged the schema_flaw observation. Live-validate beats documentation.
2. Rollback checkpoint (fb0e5a3) was never needed.

Cost: 24710285 tokens (in 23430, out 137800, cache 24549055) (--since 2026-07-05T14:00:00Z, M8-Anteil der Session)
