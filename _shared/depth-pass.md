# Depth Pass

Single source of truth for the Depth Pass: the prompt, the required plan section, and the rules.
Every other file references this document by path and never restates it. The deterministic gate
`node _shared/a1-tools.cjs plan depth-check --plan <path/to/PLAN.md>` enforces the section; the
plan auditor (`a1-adam-auditor`) judges its content.

## Prompt

Every planner answers this before it decomposes work (Robert's own words, verbatim):

> I want a deeper version of this task, not a bigger one. Before rewriting it:
> (1) say what a top professional in this field would do here that I'm not asking for;
> (2) name the rawest material they would start from instead of what has already been digested for me;
> (3) name the specific methods and tools they would use;
> (4) say what, other than you or me, would show the result is right.
> Then rewrite my prompt to ask for exactly that.

"Me" is the task giver (the user or the calling skill); "you" is the planner. Answer the four
questions about the planning task at hand, then rewrite the planning brief.

## Required section format

Every PLAN.md and wave plan carries one `## Depth Pass` section with exactly these five
sub-headings. The Pablo template places it directly after the frontmatter, before the Success
Criteria or coverage matrix. The gate accepts it anywhere in the document.

```markdown
## Depth Pass

### 1 What a top professional would do
### 2 Rawest material
### 3 Methods and tools
### 4 External evidence of correctness
### Rewritten brief
```

Sub-headings 1 to 4 answer the four questions in order. `### Rewritten brief` holds the rewritten
planning brief.

## Rules

- The rewritten brief is the goal statement the waves are derived from. Decompose after it, never before.
- Size-S plans may answer in one line each. An empty answer, `TBD` or a lone `<...>` template token still fails.
- A `phase_kind: no-code` phase still needs an external oracle in answer 4 (for example a content assertion against a published artifact).
- One Depth Pass per PLAN.md. When several phases are planned in one run, each PLAN.md gets its own.
- Revision mode keeps the section. If a BLOCKER concerns it, the planner updates it and notes the change in Revision Notes.
- Answer 2 must name material rawer than the inputs the planner was handed (real schema, real logs, actual source, upstream docs, primary data), or state explicitly why none exists.
- Answer 4 must name an oracle outside the planner and the user: a test suite, a measurement, a real system response, a spec AC executed against production data, a third-party standard.
- Exemption: `a1-quick` is exempt, because the XS lane has no planner.

## Self-reference rule

Answer 4 fails the gate when every token is in the denylist or the stopword list; any other token
makes it pass. Tokenisation: lowercase, split on every character that is not a letter or digit
(so "Robert's" gives `robert` and `s`), and ignore every token of length 1. Multi-word forms such
as "the planner" and "the agent" reduce to their content word.

`_shared/lib/depth-pass.cjs` mirrors both lists as `ORACLE_DENYLIST` and `ORACLE_STOPWORDS`; the
fixture `_test-fixtures/a1-depth-pass/run-tests.sh` proves the code equals this document. This
document owns the lists. Change them here first, then in the code.

Denylist: user, me, you, robert, claude, planner, agent, i, we

Stopwords: a, an, the, and, or, but, of, to, in, on, at, by, for, with, it, its, this, that, these, those, will, would, can, could, should, shall, may, might, must, be, is, are, was, were, been, being, do, does, did, have, has, had, not, no, then, also, just, only, check, checks, checked, checking, verify, verifies, verified, verifying, review, reviews, reviewed, reviewing, confirm, confirms, confirmed, look, looks, looked, see, sees, make, makes, sure, ok, fine, correct, right, plus, together, both, myself, ourselves, yourself, him, her, them, us, our, my, your, their, own, manually, hand, later, afterwards, again, carefully, result, results, works, work

The rule is deliberately small: a passing answer such as "Claude plus the test suite" is caught
by the plan auditor, not by this gate.
