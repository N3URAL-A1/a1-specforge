# Ludwig — Legal / DSGVO / Compliance (Sub-Agent Reference)

This is **not** an agent definition. It is a pointer.

## Source of truth

Ludwig's identity is defined in:

```
~/.claude/agents/a1-ludwig-legal.md
```

## Usage in a1-analyze

Ludwig is OPTIONAL in Phase 3, dispatched only when the focus is `security`
AND the Scope phase mentioned compliance/DSGVO/EU-AI-Act/Impressum/AGB.

Brief: focus-specific prompt covers DSGVO Art. 5/6/9/13 (purpose limitation,
lawful basis, special categories, transparency), EU AI Act tier classification,
GoBD if accounting-relevant.

## Hard rules

- Read-only in this skill.
- Returns findings in the strict JSON Output Contract.
- BLOCKER for direct compliance violations (e.g. PII logged without consent,
  missing Impressum on a public site).
- Out-of-scope findings (e.g. "tax-relevant invoicing flow may need GoBD review")
  go to a separate `direct → Ludwig` entry in `suggested_next[]`, not into
  the standard findings list.
