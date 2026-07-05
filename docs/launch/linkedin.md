> DRAFT — RAW MATERIAL for Sabine, not a finished post.
> Sabine adapts voice, format, hashtags, and CTA to the N3URAL.AI LinkedIn channel.
> German. Alle Zahlen am Tag der Veröffentlichung gegen das Repo prüfen.

# LinkedIn — Rohmaterial (N3URAL.AI)

**Winkel:** "Was wir beim Bau einer selbstlernenden Entwicklungs-Pipeline gelernt haben" — kein "Schaut, was ich gebaut habe", sondern eine Erkenntnis aus der Praxis, mit N3URAL.AI als Absender.

---

## Aufhänger (eine Variante, Sabine wählt/kürzt)

KI schreibt inzwischen zuverlässig Code. Was sie nicht kann: sich an ihre eigenen Fehler von letzter Woche erinnern. Genau da haben wir angesetzt.

## Kernbotschaft

Bei N3URAL.AI arbeiten wir täglich mit KI-gestützter Entwicklung. Ein Muster kehrte immer wieder: Jede Session begann bei null — unklare Spezifikationen, driftende Pläne, dieselbe Fehlerklasse in einer neuen Datei. Das Modell war nicht das Problem. Der Prozess drumherum hatte kein Gedächtnis.

Unsere Antwort ist eine spec-getriebene Pipeline mit einem Mechanismus, der uns selbst überrascht hat: Sie lernt aus ihren eigenen Postmortems. Jeder Lauf protokolliert strukturiert, wo etwas vom Plan abweicht. Diese Beobachtungen werden zu Mustern verdichtet — und sobald ein Muster oft genug auftritt, wird daraus eine feste Prüfregel ("Gate"), die den nächsten Lauf strenger macht.

## Belegbare Kennzahlen (für Faktenkasten / Karussell)

- 17 Skills, 18 Sub-Agents — jede Phase eines Feature-Builds automatisiert.
- 13 aus dem Erfahrungskorpus geclusterte Muster, mit datierter Herkunft zurück in die Pipeline eingespielt.
- Deterministische Gates, dreistufig: BLOCKER stoppt den Build, MAJOR/MINOR sind Warnungen.
- Abhängigkeitsfreies CLI, 14 Test-Suiten in der CI. Open Source unter MIT-Lizenz.

## Gate-Beispiele (konkret, gut für Storytelling)

- Eine Datenbank-Migration ohne Row-Level-Security → Gate schlägt an, bevor der Bug live geht.
- Ein Plan behauptet eine Aufgabe sei erledigt, aber im Code steht nichts davon → "Phantom-Task"-Erkennung.
- Ein Sub-Agent meldet "Tests grün", obwohl nur ein Mock grün ist → wird als Prüfregel abgefangen.

## Erkenntnis / Take-away (Sabine als Abschluss)

Ratschläge in einer Konfigurationsdatei werden unter Kontext-Druck ignoriert. Eine Prüfregel, die den Build stoppt, nicht. Der eigentliche Hebel bei KI-Entwicklung liegt weniger im besseren Prompt als im lernenden Prozess drumherum — mit nachvollziehbarer Herkunft für jede Regel.

## Mögliche CTA-Bausteine (Sabine wählt)

- Link zum Repo (Open Source, MIT).
- Einladung: eigene Prüfregeln als "Gate-Pack" beitragen.
- Gespräch anbieten: Wie N3URAL.AI KI-Entwicklung in Kundenprojekten absichert.

## Hinweise für Sabine

- Keine Superlative und keine Produktivitäts-Multiplikatoren — passt weder zur HN-Community noch zur Haltung des Projekts.
- Ehrliche Einordnung ist ein Feature: Ein-Personen-Maintainer, Korpus aus einem Produktionsprojekt (Multi-Tenant-SaaS + Postgres), also backend-lastige Muster. Diese Ehrlichkeit stärkt Glaubwürdigkeit statt sie zu schwächen.
- Format offen: Single-Post, Karussell (Kennzahlen + 3 Gate-Beispiele) oder Text mit einem Screenshot/GIF aus `docs/assets/demo.gif`.
