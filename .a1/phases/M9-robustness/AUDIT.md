---
plan: /Users/rob/code/a1-skills/.a1/phases/M9-robustness/PLAN.md
verdict: PASS
blockers: 0
majors: 3
minors: 5
generated: 2026-07-11
---

# Plan Audit — M9-robustness

## Verdict: PASS

Kein BLOCKER. Der Plan ist außergewöhnlich präzise, deckt alle 4 Cluster vollständig ab,
verankert das Regression-Gate nach jedem Task, sichert die Fassaden-Stabilität im Modul-Split
mehrfach ab, und ordnet die bereits gefixten RCE/Traversal-Lücken korrekt als reine
Dokumentations-/Regressions-Konvention ein (Task 1.2 Schritt 1, expliziter Verweis auf Commit
d639b8e). Die drei MAJOR-Findings sind gezielt nachbesserbar, ohne die Wave-Struktur zu ändern —
sie sollten vor Execution eingepflegt werden, damit ein schwächeres Modell nicht selbst
herleiten muss. Da keiner davon die Ausführung blockiert oder den Split gefährdet, reicht ein
leichtgewichtiger Fix; ein PASS ist gerechtfertigt.

## Findings

### MAJOR (hohes Fehlerrisiko — vor Execution beheben)

- **[M1]** Task 5.1 stellt `cmdPrFindingsSummary` auf `parseFlags(args, ...)` um, verlangt aber
  gleichzeitig den existierenden Positional-Pfad "byte-identical" zu lassen. Real (Zeile 5453-5459)
  liest die Funktion heute rein positional: `if (args.length < 1) usage(...); const [slugOrId] = args;`.
  Nach Umstellung auf `parseFlags` ist der positionale Wert **nicht mehr** `args[0]`, sondern
  `flags._[0]`. Der Plan sagt das nicht explizit — ein schwächeres Modell muss die Umschreibung
  selbst herleiten und kann `args[0]` stehen lassen, was den slug-Pfad bricht (die a1-pr-review
  Fixture würde das fangen, aber es kostet einen Fehlschlag-Zyklus).
  > Fix: In Task 5.1 Schritt 1 explizit angeben: `const [slugOrId] = flags._;` und
  > `if (!flags['worktree-path'] && flags._.length < 1) usage('pr findings-summary requires <id-or-slug> or --worktree-path')`.
  > Die exakte fail-Meldung des Missing-findings-Falls (`no findings.json in ${wtPath}/.a1-review/ — run Phase 2 first`)
  > als Copy-Paste angeben, da der Plan sie nur als "same missing-findings fail message as today" referenziert.

- **[M2]** Wave 6 (io.cjs) listet die zu verschiebenden Funktionen namentlich, überlässt dem Executor
  aber die Bestimmung der freien Identifier ("verify each moved function's free identifiers before
  finalizing") und "require only what's needed". `vaultRoot` (294-352) nutzt `os.homedir()` und den
  Modul-Flag `_vaultRootAnnounced` (277) — das ist im Plan erwähnt. Aber der Frontmatter-Block
  (`serializeScalar`, `parseFrontmatter` etc.) und `writeTextAtomic` können weitere modul-lokale
  Konstanten/Regexe referenzieren, die der Plan nicht auflistet. Für ein schwaches Modell ist
  "verify free identifiers" eine implizite Design-Aufgabe, kein Copy-Paste-Schritt.
  > Fix: Entweder (a) die vollständige Liste der mitzuziehenden modul-lokalen Konstanten/Regexe
  > pro Funktion vorab benennen, oder (b) einen mechanischen Verifikationsschritt als Copy-Paste-Befehl
  > vorgeben: nach dem Move `node --check _shared/lib/io.cjs` UND einen grep, der jede in io.cjs
  > verwendete, aber nicht deklarierte Bezeichner-Referenz auf `a1-tools.cjs` zurückverfolgt
  > (z.B. `node -e "require('./_shared/lib/io.cjs')"` als ReferenceError-Smoke). Das done-when
  > deckt nur `node --check` ab, das aber ungebundene Referenzen NICHT fängt (kein Runtime-Load).

- **[M3]** Die done-when-Checks der Split-Waves (6-9) validieren mit `node --check <lib>` +
  `node --check a1-tools.cjs` + grep-count 0. `node --check` prüft nur die Syntax, nicht ob ein
  Modul überhaupt lädt (ein `ReferenceError` durch eine vergessene, nicht-exportierte Abhängigkeit
  schlägt erst zur Laufzeit zu). Das full-regression-gate fängt es letztlich, aber die done-when-Zeile
  suggeriert fälschlich, `node --check` allein sei ein Ladebeweis. Für Wave 6/7 (io/locks werden von
  KEINER Fixture direkt geladen außer über a1-tools.cjs) ist das Gate zwar ausreichend, aber die
  Fehlerdiagnose ist für ein schwaches Modell schwerer.
  > Fix: In den Split-done-when zusätzlich einen echten Ladebeweis aufnehmen, z.B.
  > `node -e "require('./_shared/lib/io.cjs')" && node -e "require('./_shared/a1-tools.cjs')"` bzw.
  > eine echte Facade-Invocation wie im Verification-Block (`cd /tmp && node <abs>/a1-tools.cjs check reservations --list --file /tmp/x.json`).

### MINOR (Execution läuft, aber Notiz)

- **[m1]** Task 1.2 CONVENTIONS.md-Text behauptet: "most `run.sh`; `a1-worktree` uses `run-tests.sh`,
  `a1-pr-review` uses `run-test.sh`". Realität: **fünf** Suiten nutzen `run-tests.sh`
  (a1-analyze-cli, a1-check, a1-checklist, a1-reconcile, a1-worktree). Der Glob `run*.sh` fängt alle,
  die Doku-Aussage ist aber faktisch unvollständig. Nur Doku-Inhalt, kein Codefehler.
  > Fix: Formulierung neutral halten: "Runner heißen `run.sh`, `run-tests.sh` oder `run-test.sh`;
  > der Glob `run*.sh` fängt alle."

- **[m2]** SC-4 / mehrere Stellen sprechen von "19 fixture suites"; MAP.md nennt inkonsistent "20".
  Ground truth ist **19** (verifiziert: `ls -d _test-fixtures/*/ | wc -l` = 19). Der Plan ist
  korrekt bei 19 — nur die MAP-Diskrepanz als Hinweis, falls README ("13"/"20") angefasst wird
  (Task 1.2 Schritt 3 verifiziert selbst per `ls`, daher unkritisch).

- **[m3]** Task 5.1 Schritt 4: die a1-pr-review-Fixture soll ein `.a1-review/findings.json` anlegen.
  Verifiziert korrekt gegen `prReviewDir()` (Zeile 5328 → `.a1-review`, NICHT `.a1-pr-review` wie
  MAP.md fälschlich behauptet). Plan ist konsistent mit dem echten Code — nur als Bestätigung notiert,
  damit der Executor sich nicht von der MAP verwirren lässt.

- **[m4]** Task 9.1 done-when fordert `wc -l < a1-tools.cjs` < 6900 (≥ 2500 Zeilen Reduktion). Das
  ist ein hartes Ziel über 4 Waves hinweg; wenn Waves 6-8 weniger extrahieren als geschätzt, blockiert
  erst Wave 9 auf einer Metrik, die von früheren Waves abhängt. Kein Fehler, aber das Reduktions-Budget
  ist nirgends pro Wave aufgeschlüsselt — ein Unterschreiten fällt spät auf.
  > Fix (optional): grobe pro-Wave-Zeilenerwartung notieren (io ~350, locks ~200, registry ~250,
  > product ~1900) als Frühwarnung.

- **[m5]** Task 1.1 Schritt 3 ändert den Kommentar an product-docs/run.sh:850. Verifiziert: die
  Zeile existiert exakt wie zitiert (`# Case B: lock owned by a LIVE pid (this test script's own $$, guaranteed`).
  Die grep-Assertion im done-when (`! grep -q 'this test script.s own \$\$'`) ist korrekt konstruiert.
  Nur Bestätigung — kein Fix nötig.

## What's Good

- **Fassaden-Stabilität (Schwerpunkt 2) ist wasserdicht.** Die Ground Rule "CLI contract is frozen"
  gilt für JEDEN Task, jeder Split-Task hält Command-Funktionen im Facade und verschiebt nur Helfer,
  der `__dirname`-relative require adressiert das Symlink-Install-Szenario explizit (Task 6.1 Schritt 4+6),
  und `bin/install.sh` wird konditional geprüft. Das Regression-Gate (`ALL-SUITES-GREEN` nach jedem
  Task) ist konkret verankert und der Glob `run*.sh` fängt verifiziert alle 19 Suiten.

- **Shared-Helper-Split-Reihenfolge ist korrekt aufgelöst.** io → locks → worktree-registry → product,
  mit expliziter Regel "nie a1-tools.cjs aus lib requiren, lib darf Geschwister requiren". `writeAllOrNothing`
  und `assertSlug` als potentiell geteilte Helfer werden korrekt erkannt (Task 7.1/9.1 mit "move to
  io.cjs instead if used elsewhere"), sodass keine Gruppe von ihrem Helfer abgeschnitten wird — genau
  der von RESEARCH.md geforderte Anti-Duplikations-Schnitt.

- **RCE/Traversal korrekt eingeordnet.** Task 1.2 fixt NICHTS neu, sondern dokumentiert nur die
  Hostile-Input-Konvention mit explizitem Verweis "historical traversal findings were fixed in commit
  d639b8e — this section exists so regressions are caught, not to fix anything." Exakt wie im
  Audit-Auftrag gefordert.

- **Split zuletzt (W6-W9 nach W1-W5) ist die richtige Risiko-Sequenz:** alle neuen Features sind durch
  Fixtures abgedeckt, bevor die mechanische Extraktion beginnt, und Zeilenreferenzen in W1-W5 bleiben
  gültig. Jede Split-Wave committet einzeln (SC-4 "one commit per module, each CI-green" per git-History
  verifizierbar).
