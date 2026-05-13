# Feature Skills — Entry Conditions

**One source, no guessing.** Use this table when you want to start a feature.

## Decision tree

```
Do you have a new feature idea for a product backlog?
├── YES → feature-idea  (catalog entry)
│         └── Then → feature-spec  (user stories + AC)
│                     └── Then → a1-new-feature Phase 3+  (from "clarify")
└── NO  → a1-new-feature  (full pipeline: idea → code → verify)
```

## Skill overview

| Skill | Scope | Output | When to use |
|---|---|---|---|
| `feature-idea` | Product backlog | Catalog entry (Vault) | Capture a new idea in the backlog |
| `feature-spec` | Any project | Spec with user stories + AC | Expand a catalog entry into a testable spec |
| `a1-new-feature` | Any project | Full pipeline (Spec → Plan → Code → Verify) | Take a feature completely from idea to production |

## Distinctions

- **`feature-idea` ≠ `a1-new-feature`:** `feature-idea` only creates the backlog entry. `a1-new-feature` orchestrates the entire build process.
- **`feature-spec` ≠ Phase 2 of `a1-new-feature`:** `feature-spec` writes a standalone spec (Vault). `a1-new-feature` Phase 2 is part of an orchestrated flow with frontmatter state.
- **No overlap:** Product backlog features go through `feature-idea → feature-spec`, then optionally into `a1-new-feature` from Phase 3 (clarify). All other projects: directly `a1-new-feature`.

## Trigger phrases (unambiguous)

| Phrase | Skill |
|---|---|
| "new feature idea", "add to backlog", "create catalog entry" | `feature-idea` |
| "write the spec", "AC for feature X" | `feature-spec` |
| "new feature for \<project\>", "feature from idea to verify" | `a1-new-feature` |
| "bug in \<project\>", "X is not working" | `a1-fix` |
