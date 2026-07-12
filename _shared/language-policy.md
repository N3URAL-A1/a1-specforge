# a1 Language Policy

Single source of truth for user-output language across all a1 skills and agents.
Two rules only:

1. **File artifacts** (specs, plans, frontmatter, IDs, reports, commit messages,
   and anything else written to disk) — always **English**.
2. **User-facing conversation output** (chat replies, prompts, questions, summaries
   spoken to the user) — **the user's language**. Never hardcode one language for
   this; detect and mirror what the user is using.

German trigger aliases (e.g. "Bug in X" / "Fehler in X") stay supported regardless
of which language conversation output is currently in — see the README
language-policy section.

Skills and agents should not restate these rules locally; link here instead:

> User-facing output language: see `_shared/language-policy.md` (artifacts English,
> conversation in the user's language).
