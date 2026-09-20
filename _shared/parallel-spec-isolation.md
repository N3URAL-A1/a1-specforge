# Parallel-Spec-Isolation (Cross-Skill-Konvention)

> Zweck: Mehrere Specs/Features/Fixes eines Projekts laufen PARALLEL (auch in
> parallelen Claude-Sessions), ohne sich im Working Tree in die Quere zu kommen,
> und ihre PRs/Merges gehen sauber durch. Robert-Anordnung 2026-07-31.

## R1 — Ein Worktree pro Arbeitseinheit (HARD RULE)

Jede Spec (a1-new-feature), jede Phase (a1-execute) und jeder Bug-Fix (a1-fix)
arbeitet in einem EIGENEN git worktree auf einem eigenen Branch ab `origin/main`:

```bash
git -C <repo> fetch origin main
git -C <repo> worktree add ../a1-worktrees/<slug> -b feature/<slug> origin/main   # bzw. fix/<slug>
```

Der Haupt-Checkout bleibt auf `main` und clean. KEIN Feature-/Fix-/Wave-Code im
Haupt-Checkout — niemals, auch nicht "nur eine kleine Datei". Lifecycle
(Registry, Exit-Modi, Origin-Cleanup) über den `a1-worktree`-Skill.

### Benannte Ausnahmen von R1 (abschließend)

Ein Worktree isoliert **Code im Repo**. Wo eine Phase keinen schreibt, isoliert
er nichts und kostet nur Schritte. Zwei Fälle, beide am Plan-Zeitpunkt zu
deklarieren und beim Ausführen nicht nachträglich zu erweitern:

1. **Externe live-symlinkte Repos** als Schreibziel — eine Worktree-Kopie würde
   die Symlinks verfehlen (bestehende Ausnahme, siehe `gates-registry.md`
   `isolation-gate`).
2. **No-Code-Phasen**: alle Schreibziele der Phase liegen außerhalb des Repos
   (Vault-Notizen, `docs/`-Prosa, externe Kanäle) und die Phase deklariert
   `phase_kind: no-code` im PLAN-Frontmatter. Beleg 2026-09-16/17
   (n3ural-socialmedia M1-P1…P3, ai-server): drei Strategie-Phasen mussten
   durch ein Isolation-Gate, das nichts zu isolieren hatte, während
   `gate-1-build` mangels Code unerfüllbar blieb.

**Ersatz-Abnahme für Fall 2 statt „Build grün":** Die Phase benennt im Plan je
Wave die erwarteten Artefakt-Pfade; abgenommen wird über deren Existenz und
Inhalt (`test -f` plus eine inhaltliche Zusicherung pro Datei — eine reine
Existenzprüfung ist ein Gate, das nicht fehlschlagen kann, siehe Invariante 8).
Shared-State (R2) bleibt unberührt: `docs/product/**` und `.a1/reservations.json`
werden auch hier ausschließlich im Haupt-Checkout mutiert und sofort committet.

## R2 — Shared-State nur im Haupt-Checkout, sofort committen (HARD RULE)

Die projektweiten Koordinations-Dateien

- `docs/product/**` (ROADMAP.md, feature.md, index.json, NEXT.md)
- `.a1/reservations.json`
- `.a1/roadmap.md`

werden AUSSCHLIESSLICH im Haupt-Checkout mutiert (via `a1-tools.cjs product …` /
`code-scope …`) und die Mutation wird SOFORT committet und gepusht (bei
Branch-Protection als kleiner `chore(product):`-PR, der direkt gemergt wird).
Niemals dirty liegen lassen: parallele Sessions lesen sonst stale Reservierungen
und claimen kollidierende Scopes/Migrationsnummern.

> Incident-Beleg 2026-07-31: Eine 049-Session ließ Reservierungen (Migr. 119/120)
> uncommitted im Haupt-Checkout, während eine zweite Session dort arbeitete —
> genau die Kollisionsklasse, die diese Regel verhindert.

## R3 — Scope claimen VOR Worktree-Anlage

Vor dem Worktree: `a1-tools.cjs code-scope list` prüfen und eigenen Scope
claimen. Überlappt der geplante Scope mit einer aktiven (nicht-stale)
Reservierung einer anderen Spec → STOP, Robert entscheidet (nie still
"dazwischenarbeiten"). Migrationsnummern zusätzlich über
`automation/db/migrations/MIGRATIONS-RESERVED.md` bzw. `code-scope`-Reservierung.

## R4 — Merge-Disziplin

Merge nur bei grünem Build/Tests im Worktree; kein Cherry-Pick als
Merge-Workaround; niemals build-rotes `main` pushen. Nach Merge: Worktree
abbauen (`a1-worktree` Exit), Remote-Branch aufräumen (Step 4.5).

## R5 — Worktree-Gotchas (Pflicht-Check beim Betreten)

- `.env.local`/`PGDATABASE` fehlen im frischen Worktree → DB-Fallback kann still
  auf Production zeigen. ENV zuerst prüfen; DB-Tests nur mit explizitem Preprod-ENV.
- Monorepo-Package-Dists (`office-core`, `office-agent-runtime`, …) IMMER frisch
  bauen, bevor tsc/Tests laufen — auch im Haupt-Checkout nach Package-Merges.
- `.a1/learnings/` wird beim Anlegen mitkopiert (a1-worktree Fix 3392190).
