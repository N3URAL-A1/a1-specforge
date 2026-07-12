# Retro Block — Canonical Mechanics

Every learning-enabled skill ends each run — pass or fail — with **one**
structured retro entry. The skill's own "Retro" section provides only its
skill name, a task wording, and its issue-tag vocabulary; the entry format
and write targets are defined here, once, so 15 skills don't each carry a
drifting copy.

## Entry format

Follows `_shared/learning-schema.md` (the `_learning.md` retro schema):

```markdown
---
date: <YYYY-MM-DD>
task: <one line — what this run did>
project: <project-slug>
result: <pass|fail|partial|error>
issues: [<skill-specific tags, or empty>]
what_worked: <one sentence>
one_line_learning: <what would have prevented the main issue, or "no issues">
```

## Write targets (in this order)

1. **Learning store — required, canonical source:**

   ```bash
   VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"
   # append the entry to: $VAULT/pattern/a1-learnings/<skill>.md
   ```

   The store resolves via the 3-tier chain (env `A1_VAULT_ROOT` > repo-local
   `.a1/learnings/` > legacy vault); the CLI prints the resolved root on
   every invocation.

2. **Dev cache — optional, best effort:** if `~/.claude/skills/<skill>/`
   exists as a writable checkout (contributor symlink install), append the
   same entry to `~/.claude/skills/<skill>/_learning.md`. Plugin installs
   skip this silently — the store entry alone is complete.

## Rules

- A run with no issues is still useful data — write the entry.
- Takes 2 minutes. Do not skip, and never report a rosier `result:` than the
  run had — `a1-evolve` cross-checks retro claims against verification
  verdicts (`retro_integrity`).
- Every 5th entry for a skill: offer `a1-evolve` to the user (pattern
  synthesis threshold).
