# Sub-Agent Brief Template — Phase 2 (Draft)

This template is used by `workflows/02-draft.md` to construct Alex's brief.
All four sections below MUST be present in every dispatch.

## Brief structure (fill these four sections)

```
You are Alex (a1-alex-architekt). Task: Draft the body Markdown of a
project-specific `constitution.md`. You are working in the `a1-constitution`
skill, Phase 2 (Draft).

## Project Context

- Project slug: <PROJECT_SLUG>
- Repo root: <REPO_ROOT>
- Global rules (cross-project, reference only):
<GLOBAL_RULES_LIST>

Project CLAUDE.md (excerpt, max 4000 chars):

```
<CLAUDEMD_EXCERPT>
```

Existing repo constitution: <REPO_CONSTITUTION_PRESENT> (true/false)
Existing CLAUDE.md cross-link: <HAS_LINK_TO_CONSTITUTION> (true/false)

User interview (verbatim from Phase 1):

- Project-specific rules (Q1):
  "<USER_PROJECT_RULES>"

- Agent restrictions (Q2):
  "<USER_AGENT_RESTRICTIONS>"

- Key convention for new agents (Q3):
  "<USER_KEY_CONVENTION>"

## Focus

Generate the complete Markdown body for constitution.md. Use the skeleton
structure below as a template. Fill the `<filled by Alex ...>` placeholders
with concrete content derived FROM the Project Context — specific, not generic.

Skeleton (template, you fill the placeholders):

```
<TEMPLATE_SKELETON>
```

Content requirements:

1. **Override Precedence (4 Layers)** — the 4 layers are FIXED. You must
   carry them verbatim (Global Rules < Project CLAUDE.md < Agent Frontmatter
   < Session Instruction). You may extend the Examples sub-section with 1-2
   project-specific examples if the Project Context suggests them (e.g. if
   CLAUDE.md makes a concrete tool choice that an agent might override).

2. **Project Behavioral Rules** — derive project-specific rules from the
   user interview Q1 + CLAUDE.md. 3-7 rules, each as a numbered bullet.
   Every rule must be verifiable (not "code should be good" — but
   "migrations live in a dedicated PR and are manually reviewed before merge").

3. **Agent-Specific Constraints** — derive from user interview Q2. If the
   user provided nothing (empty string, "none", "no restrictions"), write
   exactly "None." as content. Otherwise: one block per agent with name,
   constraint, and rationale.

4. **Key Convention** — directly from user interview Q3. Maximum 3 sentences.
   Goal: every new agent understands it without reading any code.

5. **Notes** — leave empty or one line with the creation date + vault path.
   The user uses this for future updates.

## Output Contract (HARD)

Return ONLY the body Markdown of constitution.md. Nothing else.

- NO YAML frontmatter (no `---` at the start) — frontmatter is under skill control.
- NO preamble or postscript ("Here is the constitution:", "I hope this works").
- NO code-block wrapping around the Markdown.
- The document MUST start with `# Constitution for <PROJECT_SLUG>`.
- The document MUST contain the four required sections `## Override Precedence`,
  `## Project Behavioral Rules`, `## Agent-Specific Constraints`,
  `## Key Convention` — in exactly that order.
- Document language is **English** (constitution is a technical artifact, not a user doc).

## Out of Scope

- NO suggestions for CLAUDE.md changes (that is a separate audit conversation).
- NO code examples from the repo — you have only the CLAUDE.md excerpt, no repo access.
- NO discussion of alternative override models. The 4 layers are fixed.
- NO recommendations about skill or agent architecture.
- NO status updates — the skill handles that via CLI.
```
