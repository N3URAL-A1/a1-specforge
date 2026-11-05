source: ~/.claude/skills/specforge/SKILL.md@sha256:32026458dc537a78c2ab29e74af887a17dbc33b8bddb347311160d85beb86d54 lines 1432-1596

# EARS — Easy Approach to Requirements Syntax

Spec `006-specforge-kritis-profile`, Wave 3 (FR-002). Migrated from SpecForge Anhang C onto the
canonical English keywords of the primary paper (Mavin, Wilkinson, Harwood, Novak, "Easy Approach
to Requirements Syntax (EARS)", RE'09), not the German paraphrase. SpecForge used a single German
keyword ("Wenn") for two different patterns; the canonical set keeps all five apart and is what
`profile ears-check` (`_shared/lib/profile-ears.cjs`) verifies mechanically.

Under the KRITIS profile, every functional requirement is written in exactly one of the five
patterns below and tagged `[EARS: <pattern>]` so the check can verify the tag against the text
without guessing intent.

## The five canonical patterns

### 1. Ubiquitous

Always true, no trigger, no condition.

```
The <system> shall <function>.
```

Tag: `[EARS: ubiquitous]`

Example: "The system shall return every API response as JSON. [EARS: ubiquitous]"

### 2. Event-driven

Triggered by a single, discrete event.

```
When <trigger>, the <system> shall <response>.
```

Tag: `[EARS: event-driven]`

Example: "When a user fails three login attempts within 5 minutes, the system shall lock the
account for 30 minutes. [EARS: event-driven]"

### 3. State-driven

Holds for the whole duration of a state. Also covers the compound form "While `<state>`, when
`<trigger>`, the `<system>` shall `<response>`" (a trigger that only matters inside a state).

```
While <state>, the <system> shall <behaviour>.
```

Tag: `[EARS: state-driven]`

Example: "While the database connection is down, the system shall queue incoming writes locally
and tell the user the system is offline. [EARS: state-driven]"

### 4. Optional (feature-based)

Describes behaviour that exists only when an optional feature is included in the build or
configuration — not a runtime condition.

```
Where <feature is included>, the <system> shall <function>.
```

Tag: `[EARS: optional]`

Example: "Where two-factor authentication is enabled for a user group, the system shall ask for a
TOTP code on every login. [EARS: optional]"

### 5. Unwanted behaviour

Describes the system's reaction to an undesired condition: an error, an attack, or a failure.

```
If <condition>, then the <system> shall <response>.
```

Tag: `[EARS: unwanted]`

Example: "If an API request carries an invalid JWT, then the system shall reject it with HTTP 401,
log the incident to the security audit log, and disclose no detail about the rejection reason.
[EARS: unwanted]"

## Why SpecForge's single "Wenn" is not checkable

SpecForge's Anhang C used the same German keyword, "Wenn …, soll das System …", for both the
Optional and the Unwanted patterns (Anhang C, §4 and §5), distinguishing them only by prose
guidance ("configuration-dependent" vs. "error/attack case") that a deterministic check cannot
read. The canonical English keywords keep every pattern lexically distinct — `When` (event-driven),
`While` (state-driven), `Where` (optional), `If … then` (unwanted) — so `profile ears-check` can
anchor on the opening keyword alone and never has to infer which of two meanings a single German
word carries. A requirement written as "Wenn X, soll das System Y" (or any other German EARS form)
is therefore flagged `unknown_pattern`, not silently accepted as one of the two patterns it could
mean.

## Tag syntax

Each functional requirement carries exactly one tag, placed anywhere in its text (normally at the
end): `[EARS: ubiquitous]`, `[EARS: event-driven]`, `[EARS: state-driven]`, `[EARS: optional]`, or
`[EARS: unwanted]`. Exactly one `shall` per requirement — the pattern's verb of obligation; a
requirement with zero or more than one `shall` fails the structure check regardless of its tag.

## Quality criteria

| Criterion | Description | Anti-pattern |
|---|---|---|
| Atomic | One requirement = one testable statement | "The system shall X and Y and Z" |
| Measurable | Quantified values, not vague terms | "fast", "many", "simple" |
| Unambiguous | No room for interpretation | "appropriate", "as needed", "etc." |
| Complete | Every aspect of the behaviour is stated | Missing error handling, missing bounds |
| Testable | An objective pass/fail criterion follows | "The system shall be user-friendly" |
| Consistent | No contradiction with another requirement | Two requirements with opposite behaviour |

## Vague-term list (warnings only)

These terms never change `profile ears-check`'s exit code — they are reported as warnings beside
any findings, never as findings themselves:

| Vague term | Why | Prefer |
|---|---|---|
| "should" | Implies optional, not a binding "shall" | "shall" |
| "as fast as possible" | Not measurable | "within <=200ms (p95)" |
| "as appropriate" / "as needed" | Who decides? When? | Name the concrete trigger |
| "adequate security" | Not testable | A concrete procedure plus a named standard |
| "etc.", "and similar" | Incomplete | A complete enumeration |
| "intuitive" | Subjective | A measurable usability metric (e.g. task completion rate >=90%) |
| "in real time" | Undefined | A concrete latency bound (e.g. <=100ms) |

## Gherkin pairing

Each EARS requirement is operationalised by at least two Gherkin scenarios (happy path, edge
case). Not checked mechanically by this wave; kept here as authoring guidance migrated from
Anhang C.

```
EARS (event-driven):
  When a user fails three login attempts within 5 minutes, the system shall lock the account
  for 30 minutes. [EARS: event-driven]

Scenario 1 (happy path):
  Given a user with an active account
  When the user enters 3 wrong passwords within 5 minutes
  Then the account is locked for 30 minutes
  And the user receives an email notification

Scenario 2 (edge case):
  Given a user with an active account
  When the user enters 2 wrong passwords, waits 6 minutes, then enters 1 more
  Then the account stays active
  And the failure counter is reset
```
