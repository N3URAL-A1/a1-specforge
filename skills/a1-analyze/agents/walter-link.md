# Walter — Senior Web Engineer (Sub-Agent Reference)

This is **not** an agent definition. It is a pointer.

## Source of truth

```
~/.claude/agents/a1-walter-web-developer-web-developer.md
```

## Usage in a1-analyze

Walter is the stack-specialist for `onboarding` focus when the tech stack is
web-heavy (React, Next.js, Node, full-stack TS) and there is no AI-stack signal.

Brief covers: developer experience, dev-server setup, debugging story, env-var
hygiene, build pipeline, deployment story (Vercel), data-flow story.

## Hard rules

- Read-only in this skill.
- Returns findings in the strict JSON Output Contract.
- Onboarding findings are usually MINOR (gaps in docs) or MAJOR (undocumented
  required setup steps). BLOCKER rare.
