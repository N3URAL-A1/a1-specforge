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

## Quick-run micro-retro (`kind: quick-run` entries only)

`a1-quick` (spec `004-xs-quick-lane`, FR-020) does NOT write a separate
`_learning.md`/store entry in the format above. Its run-record file
(`projects/<slug>/quick/<YYYY-MM-DD>-<slug>.md`, FR-015) already carries a
one-line `retro:` frontmatter field, written as part of the same run that
produces the rest of the record. For `kind: quick-run` entries, that single
field **is** the complete retro contract — not a summary of a fuller entry
kept elsewhere, and not required to expand into the multi-section format
above.

```yaml
retro: <one line — what worked or what friction occurred, or "no issues">
```

`a1-evolve`'s collect phase reads this field directly off the run-record
frontmatter (see `skills/a1-evolve/workflows/01-collect.md`) instead of
looking for a per-skill `_learning.md`/store file — there isn't one for
quick runs. This is deliberately distinct from every other learning-enabled
skill's contract in this file: a quick run's low structural cost (one
session, no sub-agent spawns) extends to its retro, so the lane's own
telemetry loop stays as lean as the lane itself.
