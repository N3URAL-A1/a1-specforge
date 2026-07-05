# Aik — Senior AI Engineer (Sub-Agent Reference)

This is **not** an agent definition. It is a pointer.

## Source of truth

```
~/.claude/agents/a1-aik-ai-engineer.md
```

## Usage in a1-analyze

Aik is the stack-specialist for `onboarding` focus when the tech stack contains
AI/ML signals (langchain, vector DBs, embeddings, prompt-files, repo name
matches `n3ural*`).

Brief covers: model selection rationale, prompt engineering patterns, RAG
pipeline correctness, evaluation harness presence, agent orchestration story.

## Hard rules

- Read-only in this skill.
- Returns findings in the strict JSON Output Contract.
- BLOCKER reserved for AI-safety issues (e.g. prompt-injection vectors, PII in
  training data, agent loops without termination guards).
