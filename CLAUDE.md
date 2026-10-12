---
project: a1-specforge
status: build        # research | build | live | archived  — Spiegel des Vault-Hubs
vault: "[[project/a1-specforge]]"
---

# CLAUDE.md — a1-specforge

> Unter 200 Zeilen halten. WHAT / WHY / HOW. Details in `_shared/`, `CONTRIBUTING.md` und `docs/adr/`.

## WHAT — Das Projekt

**a1-specforge** — Spec-driven Development Pipeline für Claude Code: 17 Skills + 21 Agents, von der Idee bis zum reviewten PR, mit deterministischen Gates und Self-Learning-Loop. Open Source, für Claude-Code-Nutzer.

**Tech Stack:** Node.js ≥ 18 (CLI `_shared/a1-tools.cjs` + `_shared/lib/`), Bash (Tests, Install), Markdown (Skills, Agents, Specs)
**Repository:** `~/claude-projects/a1-specforge/` (GitHub `N3URAL-A1/a1-specforge`)
**Vault-Hub:** `~/N3URAL-Vault/project/a1-specforge.md` (Status, Entscheidungen, Relationen)

## WHY — Die Kernentscheidungen

- Produktname ist `a1-specforge` (Festlegung 2026-07-04); Hardcodes werden auf den Namen angeglichen.
- `bin/install.sh` ist die Single Source of Truth für das installierte Set; README muss dazu passen (Wächter `bin/verify-install-sync.sh`).
- Gates sind deterministisch (Code, nicht Prompt). Jede Gate-ID muss in `_shared/gates-registry.md` stehen.
- xprov-Gate schickt Code nur mit Repo-Freigabe an Codex (Regel `xprov-codex.md`); Allowlist-PRs nur per `--rebase` mergen.

## HOW — Der praktische Betrieb

### Commands

```bash
./bin/install.sh                                              # Dev-Install (Symlinks nach ~/.claude)
for r in _test-fixtures/*/run*.sh; do bash "$r" || break; done  # alle Fixture-Suites (vor jedem PR)
bash bin/verify-install-sync.sh                               # Install-Set ↔ README
node _shared/a1-tools.cjs <subcommand>                        # CLI (Hooks/launchd rufen sie direkt)
claude plugin update a1-specforge                             # Plugin nach Push aktualisieren
```

### Conventions

- Datei-Artefakte (Code, Specs, Pläne, Commits) immer Englisch, Chat in der Nutzersprache (`_shared/language-policy.md`); Commits `type(scope): description`
- `skills/` (Skills), `agents/` (Agents), `_shared/` (CLI + Lib), `_test-fixtures/` (Suites), `docs/` (ADRs, Vision, Roadmap), `packs/` (Gate-Packs)
- Specs/Pläne/Learnings: Vault `project/a1-specforge/…`, Phasen in `.a1/phases/`
- Fixtures aus echten Dateien kopieren, nicht aus dem Parser ableiten; Regeln in `_test-fixtures/CONVENTIONS.md`

### Architecture Essentials

Pipeline Spec → Plan → Execute → Review. Skills orchestrieren Agents; `a1-tools.cjs` (Facade, Module in `_shared/lib/`) trägt Gates, Registry, Vault-Zugriff und Learning-Store.

## Key References

| Resource | Pfad / Link | Zweck |
|----------|-------------|-------|
| ADRs | `docs/adr/` | Architektur-Entscheidungen |
| Vision / Roadmap | `docs/VISION.md`, `docs/roadmap.md`, `docs/product/` | Ziel und Planung |
| Gates | `_shared/gates-registry.md` | Alle registrierten Gates |
| Contributing | `CONTRIBUTING.md` | Test- und PR-Ablauf |

## Agents & Skills

Die Agents (`a1-<vorname>-<rolle>`) und Skills liegen im Repo selbst unter `agents/` und `skills/`. Routing steht in `~/.claude/rules/common/a1-framework.md`.

## Common Gotchas

- CI läuft auf GNU/Linux: macOS-only-Befehle (`sed -i ''`, BSD-`date`) brechen dort. Temp-Variablen immer guarden.
- Parallele Agenten im selben Worktree: nie `amend`/`rebase`; Mutationsläufe auf `git archive`-Schnappschuss.
- Nur eigene PIDs killen (`$!`), nie `pkill`-Muster.
- Vault-Schreibpfad in Tests isolieren (`unset A1_VAULT_ROOT`), sonst Fixture-Leaks in den echten Vault.
- `.a1/learnings` ist gitignored.

## When to Read What

- Erste Session: WHAT, WHY, Commands, Conventions
- Bug: Conventions + Gotchas · Architektur: Essentials + ADRs · Feature: Agents & Skills
