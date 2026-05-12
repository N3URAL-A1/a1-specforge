# a1 Skill-Set Roadmap — v2.0

**Erstellt:** 2026-05-12  
**Owner:** Robert (N3URAL.AI)  
**Horizon:** 2026-05-26 bis 2026-07-21  
**Notion:** https://www.notion.so/35ef1cbe281e81e58eeac6e0dd825325

## Vision

Das n3ural.a1 Spec-Kit wird von einem guten Multi-Agent-Framework zu einem lückenlosen Entwicklungssystem: Jede Phase ist nachweislich abgeschlossen, jeder Artifact ist konsistent, kein Task bleibt unbemerkt leer.

## Hintergrund

Analyse von [GitHub spec-kit](https://github.com/github/spec-kit) ergab: Wir haben ein de-facto eigenes Spec-Kit gebaut, das in 4 Punkten besser ist (Vault-Integration, deutsche Sprache, Multi-Agent-Personas, code-review-graph MCP). In 3 Punkten sind wir schwächer:

1. Cross-Artifact-Consistency (kein Check: passt spec↔plan↔tasks zusammen?)
2. Constitution-Trennung (CLAUDE.md vermischt Regeln + Daten)
3. Phantom-Task-Detection (Task als [X] markiert aber kein Code dahinter?)

Diese Roadmap schließt die Lücken.

---

## M0 — Repo-Extract ✅ (2026-05-12)

Skill-Set aus `~/.claude/skills/` in dieses Repo extrahiert. Symlinks gesetzt. Deployment via `bin/install.sh`.

**Ergebnis:** Skills sind versioniert, reproduzierbar, öffentlich machbar.

---

## M1 — Integrity Gates (bis 2026-05-26)

**Vision:** Kein Feature-Build startet mehr ohne verifizierten Artifact-Stack.

### Features

- **`a1-analyze` Skill** (MUST)
  - Cross-Artifact Consistency Check: prüft Spec.md vs. PLAN.md vs. Task-Liste
  - Hard Gate zwischen Phase 4 (Plan) → Phase 5 (Build) in `a1-new-feature`
  - Output: Konsistenz-Score + Diff-Liste bei Abweichungen
  - Fail-Verhalten: Phase 5 startet nicht

- **`a1-constitution` Skill** (MUST)
  - Generiert `constitution.md` pro Projekt
  - Klare Trennung: `CLAUDE.md` = Daten + Kontext / `constitution.md` = Verhaltensregeln + Override-Reihenfolge
  - 4-Layer Override-Precedence: Global Rules < Project CLAUDE.md < Agent Frontmatter < Session Instruction

### Erfolgs-Kriterien

- [ ] `a1-analyze` blockiert nachweislich einen fehlerhaften Phase-4→5-Übergang im Testlauf
- [ ] Jedes aktive Projekt (n3ural-platform, niimo) hat eine `constitution.md`
- [ ] Override-Reihenfolge an einer einzigen Stelle dokumentiert

---

## M2 — Phantom-Proof Execution (bis 2026-06-23)

**Vision:** Kein Task bleibt unentdeckt leer.

### Features

- **Phantom-Task-Detection** (MUST)
  - Erweiterung gsd-verifier Phase 6: prüft ob jede `[X]`-Task einen Code-Change hat
  - CLI-Patch: `gsd:verify-work` mit Warning-Level
  - Docs-only Tasks via `# no-code`-Tag in PLAN.md ausgenommen

- **`a1-checklist` Skill** (SHOULD)
  - Spec-Quality-Check ("Unit Tests for English"), 8 Prüfpunkte
  - Pre-Phase-1, kein Hard-Gate aber Rene sieht es vor Freigabe

- **`a1-worktree` Skill** (SHOULD)
  - Git-Worktree-Isolation für Wave-Parallelism
  - Layout: `~/code/.worktrees/<project>/wave-<id>-<slug>/`
  - Automatisches Anlegen (Phase 4.5) + Aufräumen (Phase 7) in `a1-new-feature`
  - Vincente dispatcht Code-Agents mit `cwd=<worktree>`

- **`a1-pr-review` Skill + Reinhard PR-Mode** (SHOULD)
  - PR pro Wave, nicht pro Agent, nicht pro Feature
  - Reinhard reviewt via `gh pr diff` + schreibt `gh pr review --comment`
  - Trigger: skill-internal in Phase 5.5, oder manuell via `/a1-pr-review <pr-num>`

### Erfolgs-Kriterien

- [ ] Phantom-Detection schlägt in einem echten Feature-Build an (mind. 1 Fund)
- [ ] `a1-checklist` als optionaler Pre-Check in `a1-new-feature` integriert
- [ ] `a1-worktree` läuft erfolgreich in einem Feature-Build
- [ ] Reinhard reviewt einen Wave-PR und gibt APPROVE/REQUEST_CHANGES zurück

---

## M3 — Quality Surface Expansion (bis 2026-07-21)

**Vision:** Code-Review und Feature-Ideation sind nahtlos integriert.

### Features

- **Reinhard + Tobi Erweiterung** (SHOULD)
  - Reinhard: `constitution.md`-aware Reviews, RLS-Check als Pflicht für n3ural-platform PRs
  - Tobi: `constitution.md`-Compliance als Blocking-Gate in Launch-Readiness-Checklist

- **feature-idea / feature-spec Konsolidierung** (SHOULD)
  - Merge oder klare Entry-Conditions dokumentieren
  - Eine Dokumentation, kein Ratespiel mehr

- **`a1-reconcile` Skill** (COULD)
  - Spec-Drift-Detection: vergleicht Implementation mit Spec, findet Abweichungen
  - Trigger: manuell oder bei wöchentlichem Vault-Sync
  - Output: `projects/<name>/drift-YYYY-MM-DD.md` in Obsidian

### Erfolgs-Kriterien

- [ ] Reinhard schlägt bei einem n3ural-platform PR wegen fehlendem RLS-Check an
- [ ] `feature-idea` / `feature-spec` haben eindeutige, dokumentierte Einstiegs-Bedingungen
- [ ] `a1-reconcile` läuft ohne Fehler auf einem Testprojekt

---

## Backlog (Someday/Maybe)

- Cost-Tracker per Spec (Token-Kosten je Feature-Build)
- PR-Bridge / Auto-Changelog (PLAN.md → PR Description)
- GH-Actions-Integration (wenn Multi-Person-Setup kommt)

## Bewusst ausgeschlossen

- Vollständige spec-kit-Adoption (unser Stack ist besser angepasst)
- Jira/Confluence-Integration (kein Bedarf als Solo-Operator)
- V-Model-Extension (Overkill)

---

## Abhängigkeiten

```
M0: Repo-Extract (done)
  └── M1: a1-constitution → M2: a1-checklist, M3: Reinhard/Tobi
  └── M1: a1-analyze → M2: Phantom-Detection, M3: a1-reconcile
  └── M2: a1-worktree → M2: a1-pr-review → M3: Reinhard PR-Mode
```

## Scope-Hinweis

- Säule 2 (AI Consulting) + n3ural-platform: Worktrees + PRs sinnvoll
- Säule 1 (KMU-Web / website-pipeline): bleibt unverändert, kein Worktree-Overhead
- Bug-Fixes (a1-fix): Branch-only reicht, kein Worktree nötig
