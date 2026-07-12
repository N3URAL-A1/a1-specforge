---
topic: Reinhard ↔ Samuel security boundary
task: 7.2
status: decided
decision: (a) Phase 5 → security triage with 4 named escalation classes — executed M12 Wave 3
decided: 2026-07-12 (Robert delegated via "setze die angesprochenen Punkte um")
executed: draft checklist applied to a1-reinhard-reviewer.md Phase 5; Phase 7 trust-boundary duplicate removed
created: 2026-07-12
---

# Decision: operationalize the Reinhard → Samuel security escalation

## Problem

`agents/a1-reinhard-reviewer.md` runs two full security-shaped phases before
Samuel is ever considered:

- **Phase 5 — Security Audit** (prompt injection, secret handling, security
  rules, tool safety, output sanitization, rate limiting, auth,
  project-specific constitution requirements, generic AppSec: SQLi/XSS/
  CSRF/IDOR/auth-bypass)
- **Phase 7 — AI-Generated Code Audit** (behavioral regressions, trust
  boundaries / LLM-output-to-shell-or-eval-or-HTML sanitization — itself
  substantially security-shaped, overlapping Phase 5's "Output Sanitization"
  bullet almost verbatim)

Samuel's own frontmatter description says he "escalates" from Reinhard
("NOT general line-level code review — a1-reinhard-reviewer covers security
basics inline and escalates here"), but nowhere in Reinhard's prompt is there
a named trigger, a checklist item, or a decision rule that actually produces
an escalation. The boundary is asserted in prose on Samuel's side only, and
not operationalized on Reinhard's side at all — a reader of Reinhard's prompt
alone would not know Samuel exists.

**Net effect today:** every review Reinhard performs re-derives full security
judgment from scratch (7 line items in Phase 5 + a security-adjacent Phase 7),
and Samuel is only reachable if the *spawning skill* (e.g. a1-analyze) hardcodes
a separate always-on security lane — not because Reinhard's own logic ever
hands off.

## Options

**(a) Convert Reinhard's Phase 5 into a short triage checklist with named
escalation triggers.** Reinhard keeps doing fast, cheap pattern-matching
(the kind of check that doesn't need adversarial reasoning: is there an
obvious secret in source, is `.env` gitignored, are DB rules default-deny,
are destructive tools confirmation-gated) and explicitly hands off to Samuel
when a finding matches one of a small number of named classes that need
deeper adversarial modeling:

- Auth/authz logic (not just "is there an auth check" but "is the auth check
  actually correct under adversarial input")
- Injection surfaces with unclear data/instruction boundaries (prompt
  injection, SQL/shell/eval bridges where sanitization isn't a one-line
  answer)
- Anything touching `constitution.md`'s project-specific security
  requirements (RLS, tenant isolation) — these are already Hard-Rule/BLOCKER
  per Reinhard's own text and are exactly the class of finding worth a
  second, deeper pass
- Supply-chain / dependency findings (Samuel's frontmatter names this
  explicitly as his domain; Reinhard's Phase 5 doesn't mention dependencies
  at all today)

Phase 7 ("AI-Generated Code Audit") keeps its non-security-shaped checks
(behavioral regressions in edge cases) but its "trust boundaries" bullet
merges into the same triage-and-escalate logic as Phase 5, removing the
near-duplicate.

- **Effort:** low-medium. Prompt-only edit to `a1-reinhard-reviewer.md`
  (Phases 5 and 7); no code change, no tool-permission change.
- **Risk:** low. Escalation criteria need to be named precisely enough that
  Reinhard doesn't either (i) escalate everything (defeats the purpose of
  having a cheap first pass) or (ii) escalate nothing (silently reverts to
  today's behavior with extra prose). The proposed checklist below is
  intentionally narrow (4 named classes) to avoid both failure modes.
- **Benefit:** removes duplicated adversarial-depth work on every review;
  makes the "Reinhard covers basics, Samuel goes deep" framing in Samuel's
  own description actually true instead of aspirational.

**(b) Leave as-is; only sharpen the prose on both sides.** No triage logic
change — just make sure Reinhard's Phase 5/7 text references Samuel by name
with a "for deeper analysis of X, see a1-samuel-security" pointer, without
committing to specific escalation triggers.

- **Effort:** trivial.
- **Risk:** none.
- **Benefit:** minimal — doesn't change Reinhard's actual behavior, so the
  duplication (two full security-shaped passes on every review before Samuel
  is ever reachable via Reinhard's own logic) persists.

## Recommendation

**(a).** The duplication is concrete and named (Phase 5 + Phase 7's trust-
boundary bullet), and Samuel's frontmatter already promises an escalation
path that doesn't exist mechanically. A named 4-class triage list is small
enough to add without turning Reinhard's prompt into a second security
specialist.

## Proposed replacement checklist text (draft, for Task 7.2)

Replacing the current Phase 5 body in `a1-reinhard-reviewer.md` with:

```markdown
### Phase 5 — Security Triage

Fast pattern-matching pass — flag, don't deep-reason. Escalate to
a1-samuel-security (do not resolve yourself) for any finding in these
classes:

- **Auth/authz correctness** (not "is there a check" but "is the check
  correct under adversarial input") → escalate
- **Injection / trust-boundary surfaces** where sanitization isn't a
  one-line answer (prompt injection, shell/SQL/eval/template bridges,
  LLM-output-to-shell-or-HTML) → escalate
- **`constitution.md` security requirements** (RLS, tenant isolation, or any
  project-specific rule marked BLOCKER-if-violated) → escalate, always
  BLOCKER regardless of Samuel's later verdict
- **Supply-chain / dependency findings** (outdated packages with known CVEs,
  suspicious transitive deps) → escalate; not previously in Reinhard's scope

Everything else stays inline and cheap:
- Secrets in source / `.env` not gitignored → flag directly, no escalation needed
- DB rules not default-deny → flag directly
- Destructive tools without confirmation gating → flag directly
- Rate limiting / cost caps absent → flag directly
- Generic AppSec pattern matches (obvious SQLi/XSS/CSRF shape, no adversarial
  reasoning needed to see it) → flag directly
```

Phase 7's "Trust boundaries: LLM output forwarded to shell/eval/HTML
sanitized?" bullet is removed as a duplicate — it's now covered by Phase 5's
injection/trust-boundary escalation class. Phase 7 keeps only "Behavioral
regressions in edge cases," which is not security-shaped.

## Not done by this task

`a1-reinhard-reviewer.md` was not edited. The checklist above is a draft for
Robert's review; applying it is a separate, explicit step after this
document is accepted.
