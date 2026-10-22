---
type: spec
id: 008-false-green-test-guards
project: a1-specforge
feature_slug: false-green-test-guards
title: "Machine guards against false-green tests in the project repos — imported-expectation"
status: done
created: 2026-09-11
phase_history:
  - "phase=discover completed=2026-09-11 (split out of spec 007 during its Gate-4.5 run; the"
  - "phase=specify completed=2026-09-13T07:04:45.821Z"
  - "phase=clarify completed=2026-09-13T07:04:45.822Z"
  - "phase=implement completed=2026-09-13T19:07:37.383Z"
  - "phase=verify completed=2026-09-13T19:07:37.383Z"
wave_plan_path: null
verify_failures: []
fixtures: []
permalink: vault/project/a1-specforge/spec/008-false-green-test-guards
proposal_source: "spec 007-retro-gate-id-validator (FR-005/FR-006, OQ-002/OQ-003)"
roadmap_entry: continuous
size: M
---

# Machine guards against false-green tests (project repos)

> Spec ID: `008-false-green-test-guards` · Project: `a1-specforge` · Status: `draft`
>
> **Kurzfassung (DE):** Zwei maschinelle Wächter gegen Tests, die grün melden ohne zu prüfen.
> (1) Eine Lint-Regel gegen Erwartungswerte, die aus demselben Modul importiert werden wie
> die geprüfte Funktion. (2) Zweig-Coverage als Gate über eine benannte Liste kritischer
> Module. **Beide laufen NICHT in a1-specforge** — dieses Repo hat keine `package.json`,
> kein ESLint, kein Vitest und testet über bash-Fixtures. Sie gehören in die Projekt-Repos
> (n3ural-contentbot, n3ural-platform, …), wo die Tests laufen. Ausgegliedert aus Spec 007
> am 2026-09-11, weil eine Spec nur Anforderungen führen soll, die in ihrem Ziel-Repo
> baubar sind — Gate 4.5 verlangt zu Recht, dass jede FR einer Wave zugeordnet ist.

---

## Discovery — Problem

2026-09-10/11, n3ural-contentbot `M4-P1-heartbeat-operator-alarm`: **elf grüne Tests in einer
Phase belegten nichts** — fünf beim Ausführen gefunden, fünf im Code-Review, einer im
Security-Review. Alle elf prüften echtes Verhalten mit echten Assertions, weshalb kein
Kriterienkatalog sie sah. Vier Klassen (Vorfallsprotokoll:
`_shared/agent-lessons.md#theo-mutation-question`):

1. Der Test betritt den Zweig nicht, den er benennt.
2. Die Zusage ist ein Vorgang, geprüft wird das Ergebnis.
3. Der Fake teilt den Irrtum des Codes.
4. Die Erwartung stammt aus derselben Quelle wie der Prüfgegenstand.

**Der Beleg, dass Disziplin hier nicht trägt:** In der Folgerunde traf dieselbe Klasse drei
Rollen in einer Runde — die bestehenden Tests, den Autor beim Beheben, den Gegenprüfer beim
Nachmessen. Und am 2026-09-11 reproduzierte dieselbe Sitzung, die die vier Klassen
dokumentiert hatte, **sechs** neue Instanzen davon innerhalb einer Stunde im Fix für das
eigene Werkzeug (Review-Befund `a1-reinhard-reviewer`, 18 Mutationen). Die Klassen zu kennen
verhindert sie nicht.

Klasse 4 ist vollständig maschinell prüfbar, Klasse 1 teilweise. Genau dafür existiert diese
Spec. Klassen 2 und 3 bleiben Disziplin — das steht so in
`~/.claude/rules/common/testing.md` (Eigentümer der Regel) und wird hier nicht neu behauptet.

## Decisions (Clarify, 2026-09-13, Robert)

Measured in the target repo before deciding — the spec's assumptions did not
fully hold:

- **Target repo: `n3ural-contentbot`** (it produced the M4-P1 incident and holds
  the most critical modules). Vitest IS present (`vitest.config.ts`, 39 test
  files); **ESLint is NOT**, and `@vitest/coverage-v8` is **not installed**.
- **FR-001 ships as a `check:*.mjs` script, not an ESLint rule.** The repo has
  an established pattern of three standalone Node checks
  (`check:no-hardcoded-paths`, `check:no-raw-side-effects`,
  `check:no-live-secrets`), each an `.mjs` program run from `package.json`.
  A new guard belongs there rather than in a toolchain the repo deliberately
  does without. Trade-off accepted: no editor feedback while typing, which an
  ESLint plugin would give. Renamed accordingly:
  `npm run check:no-imported-expectations`.
- **FR-003 installs `@vitest/coverage-v8`** and gates branch coverage over a
  NAMED list of critical modules only — never a global threshold, which the
  spec already required and which would be worthless here (39 test files over a
  large surface would produce a number nobody acts on).
- **OQ-002 answered:** the critical-module list lives in the project's own
  config (`vitest.config.ts` / the check script), not in the a1 plan — it is a
  property of the codebase, not of one phase.
- **OQ-001 still open:** whether the imported-expectation check extends to
  Vitest-less stacks (niimo/Flutter). Out of scope for this run; this spec
  targets `n3ural-contentbot` only and says so.

## Baseline measurement (2026-09-13, before building anything)

`@vitest/coverage-v8@3.2.7` installed (npm first resolved 5.0.0, which demands
vitest 5 — the repo has 3.2.7, so the version is pinned rather than forced).
Full suite: 102 files, 1861 passed, 2 skipped.

Branch coverage over the four modules the M4-P1 retro named as
highest-blast-radius:

| module | branch | stmts | funcs |
|---|---|---|---|
| `src/config/resolve-secrets.ts` | 100.0% | 100.0% | 100.0% |
| `src/server/health.mjs` | 94.4% | 96.4% | 83.3% |
| `src/server/operator-alert.mjs` | 94.3% | 98.4% | 100.0% |
| **`src/heartbeat/state.core.mjs`** | **75.7%** | 97.9% | 100.0% |

The lowest value is the state machine — the module the retro called the most
critical. **Threshold decision (Robert, 2026-09-13): 75% as a ratchet**, just
under today's floor, so the gate is green on its first run and blocks any
regression from here. Per SC-004 and the spec's own rule that a gate which is
red on its first run gets switched off, the number is DERIVED from this
measurement, not chosen as an aspiration. Raising it is a later, separate
decision with its own tests.

## Functional requirements

- **FR-001** `npm run check:no-imported-expectations` meldet jede Zusicherung, deren
  Erwartungswert aus demselben Modul importiert wird wie die geprüfte Funktion
  (`toBe`, `toEqual`, `toBeLessThanOrEqual` und Äquivalente). Reiner AST-Test über die
  Testdateien, keine Ausführung. Als `scripts/check-no-imported-expectations.mjs` nach
  dem Muster der drei bestehenden Checks; Exit 0 sauber / 1 Fund / 2 Nutzungsfehler.
- **FR-002** Die Regel führt eine Ausnahmeliste für Vollständigkeits-Tests, die bewusst über
  eine Konstante iterieren — die sind wertvoll und dürfen nicht kaputtgehen. Jede Ausnahme
  braucht einen benannten Grund; die Liste wächst nicht per Default.
- **FR-003** Zweig-Coverage läuft als Gate über eine **benannte Liste kritischer Module**,
  deklariert in der Projekt-Konfiguration — kein globaler Schwellwert über die ganze
  Codebasis. Erfordert `@vitest/coverage-v8` als devDependency (nicht vorhanden, wird
  installiert). Der Schwellwert wird aus einer Erstmessung abgeleitet, nicht geraten:
  ein Gate, das beim ersten Lauf rot ist, wird abgeschaltet.
- **FR-004** Jeder Wächter liefert einen RED-Beleg mit: eine Fixture, die der Wächter
  tatsächlich ablehnt, mitcommittet. Ein Gate, dessen erster Lauf grün ist, ist nicht als
  wirksam belegt.
- **FR-005** Beide Wächter sind als Gates registriert (Invariante 7): Registry-Eintrag,
  deterministische Exit-Semantik, Retro-Attributions-ID.

## Success criteria

- **SC-001** Die vier M4-P1-Testklassen werden erneut geprüft: Klasse 4 wird von FR-001
  gefangen, Klasse 1 von FR-003. Klassen 2 und 3 bleiben ausdrücklich ungedeckt und werden
  als Disziplin dokumentiert — die Spec behauptet keine Abdeckung, die sie nicht hat.
- **SC-002** Der historische Fall wird nachgestellt: `toBeLessThanOrEqual(MAX_REASON_LENGTH)`
  mit importiertem `MAX` wird gemeldet; dieselbe Zusicherung mit literalem Erwartungswert
  nicht.
- **SC-003** Die Konstante von 200 auf 100000 zu ändern lässt den historischen Test grün
  (Beleg, dass er nichts prüfte) UND die Lint-Regel meldet ihn (Beleg, dass der Wächter
  greift).
- **SC-004** Kein Wächter trägt eine Ausnahmeliste, die per Default wächst.

## Open questions

- **OQ-001** ANSWERED (see Decisions): the critical-module list lives in the project's
  own config, not in an a1 plan — it is a property of the codebase.
- **OQ-002** (war OQ-003 in Spec 007) FR-001 als ESLint-Regel deckt nur die JS/TS-Projekte.
  Stacks ohne Vitest (niimo/Flutter) brauchen eine eigene Antwort oder eine ausdrückliche
  Out-of-Scope-Notiz.
- **OQ-003** In welchem Repo beginnt die Umsetzung? n3ural-contentbot hat den Vorfall
  geliefert und die meisten kritischen Module; n3ural-platform hat die größere Testbasis.

## Out of scope

- a1-specforge selbst: kein JS-Toolchain, Tests laufen über bash-Fixtures. Die dort
  baubaren Wächter (Gate-ID-Validator, Glob-Liveness, Pipeline-Exit-Propagation) sind
  Spec 007.
- `~/.claude/rules/common/testing.md` ändern — Robert besitzt die Datei; diese Wächter
  erzwingen die Regel, die dort schon steht (Invariante 1).
- Ein allgemeines Mutations-Test-Framework. Echte Mutationsproben bleiben gezielt auf
  Module mit großer Sprengweite vor dem Merge, wie in M4-P1 entschieden.

## Evidence

| Behauptung | Quelle |
|---|---|
| 11 grüne Tests ohne Beweiskraft in einer Phase | `pattern/a1-learnings/a1-execute.md`, Eintrag 2026-09-10 |
| dieselbe Klasse traf 3 Rollen in einer Runde | `pattern/a1-learnings/a1-execute.md`, Eintrag 2026-09-11 |
| 6 weitere Instanzen binnen einer Stunde im eigenen Fix | `pattern/a1-learnings/patterns.md`, Notes 2026-09-11 |
| beide Wächter empfohlen, bewusst nicht gebaut | a1-execute-Retro 2026-09-10, 💡-Block |
| Klasse 4 vollständig maschinell, Klasse 1 teilweise | `~/.claude/rules/common/testing.md`, Wächter-Tabelle |
