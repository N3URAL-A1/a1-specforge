---
type: postmortem
project: a1-office
bug_slug: invoice-pdf-snapshot-grant-revoked
date: 2026-09-10
severity: BLOCKER
status: fixing
permalink: vault/project/a1-office/postmortems/2026-09-10-invoice-pdf-snapshot-grant-revoked
---

# Rechnung „gesendet" war 21 Tage unmöglich — das Recht wurde absichtlich entzogen

## Symptom

In Produktion scheiterte jeder Übergang einer Rechnung von `draft` auf `sent`
mit `permission denied for table invoice_pdf_snapshots`. Die Transaktion rollte
zurück, die Rechnung blieb `draft`, und es entstand kein GoBD-PDF-Snapshot.
Dieselbe Ursache machte die sechs Bestands-Snapshots über die App nicht mehr
herunterladbar.

Gefunden nicht durch eine Beschwerde, sondern durch ein Plattform-Audit am
2026-09-09. Im Pod-Log stand genau **eine** Zeile, vom 2026-09-09 12:15Z —
Rechnungen werden selten versendet, deshalb fiel es 21 Tage nicht auf. Der
stillere Beleg war eindeutiger: der neueste Snapshot datierte vom 2026-08-02.

## Ursache

Nicht der Datenbank-Umzug hat das Recht verloren.
`scripts/setup-eu-db-roles.sql` entzog es absichtlich, bei jedem Lauf.

Die Kette über vier Monate:

| Wann | Was |
|---|---|
| April | Migration 009 entzieht `agent_user` alle Rechte auf der Tabelle, um `pdf_bytea` vor **PostgREST** zu schützen. Der Kommentar nennt die Annahme wörtlich: der Server lese die Bytes als `crm_admin`. |
| 2026-05-04 (`9d756ac`, Wave 5b) | Der Invoice-Pfad wandert auf `withTenantContext`, das `SET LOCAL ROLE agent_user` setzt. Der Kommentar von 009 stimmt ab hier nicht mehr; das Recht ist jetzt Voraussetzung, nicht Regression. |
| 2026-08-19 | `verify-db-parity.ts` vergleicht Ist gegen die Absicht von 009 und meldet das Schreibrecht als **Sicherheitsregression**. |
| 2026-08-20 | „Option A" entzieht es auf beiden Datenbanken. Ab hier ist der Schreibpfad kaputt. |
| seitdem | Das Rollen-Skript trägt denselben Entzug und wendet ihn bei jedem Cutover erneut an. |

Der Vergleich war technisch korrekt und inhaltlich falsch. Er kannte die
Migration, nicht den Code. Eine Abweichung zwischen Migration und Ist-Zustand
bedeutet nicht, dass der Ist-Zustand falsch ist — sie kann bedeuten, dass die
Migration veraltet ist.

## Warum es niemand bemerkte: drei Wächter, alle grün, keiner wirksam

Das ist der eigentliche Befund dieses Falls.

1. **Der Parity-Check** meldete die Voraussetzung als Fehler und löste die
   Behebung aus, die den Defekt erzeugte.
2. **Die Selbstprüfung des Rollen-Skripts** meldete „bereit" nur, solange das
   Recht fehlte. Eine reparierte Instanz hätte sie als nicht cutover-fähig
   eingestuft. Gefunden von backend-bernd während der Behebung.
3. **Das Runbook** hatte dieses `permission denied` vorhergesagt und vorab als
   erwartetes Rauschen abgetan. Damit war die Meldung unsichtbar gemacht,
   bevor sie auftrat.

Bei der Behebung kamen zwei weitere derselben Klasse hinzu:

4. **Der Regressionstest stand in keiner CI-Liste** und wäre nie gelaufen.
5. **`tests/ci/grants-seed.sql` vergibt pauschal vier Rechte** auf alle
   api-Tabellen. Wäre der Test gelaufen, hätten seine zwei „Recht fehlt"-Fälle
   gegen einen Zustand geprüft, den es in Produktion nicht gibt — und
   bestanden. Der Rot-Beweis war gegen Preprod geführt, wo dieser Seed nicht
   gilt.

Fünf Prüfmittel, fünfmal grün, fünfmal ohne Aussage. Migration 009 warnte
wörtlich vor dem Mechanismus („Diese pauschalen Grants ueberschreiben
Column-Level-Grants"), und er traf zweimal zu: einmal in Produktion, einmal im
CI-Seed.

## Behebung

`b0d7cb9` in `main` (PR #223), sieben Dateien:

- **Migration 128** vergibt `SELECT, INSERT` — ausdrücklich **kein**
  UPDATE/DELETE. Selbstprüfung auf der Wirkebene (`has_table_privilege`,
  `has_column_privilege` inklusive `pdf_bytea`), in **beiden** Richtungen: sie
  bricht auch ab, wenn UPDATE oder DELETE vorhanden ist.
- **`scripts/setup-eu-db-roles.sql`** entzieht auf dieser Tabelle nicht mehr.
  Ohne das hätte der nächste Cutover die Migration überholt — deshalb gehört
  die Quelle des Entzugs zum Fix.
- **Runbook-Korrektur** in `p4-db-migration.md` §2b, damit der Befund nicht
  erneut als Regression „behoben" wird.
- **Regressionstest** mit vier Fällen, in die CI eingetragen, plus die
  `REVOKE`-Ausnahme im Grants-Seed.

Der erste Entwurf vergab vier Rechte mit der Begründung, der DSGVO-Purge
brauche sie. Reinhard widerlegte das, die Messung bestätigte es:
`withSystemContext` setzt kein `SET LOCAL ROLE` (`lib/db/tenant-pool.ts:125`),
der Purge läuft als `crm_admin`. Repo-weit existiert kein Laufzeit-UPDATE oder
-DELETE auf die Tabelle. Auf dem GoBD-Einfrierpunkt ohne Löschschutz
(Audit-Befund F-032) wäre das eine echte Verschlechterung gewesen.

**Ergebnis: besser als vor dem Bug.** Vorher konnte die Rolle die Snapshots
nicht lesen; jetzt liest und ergänzt sie, kann sie aber weiterhin nicht ändern
oder löschen.

## Offen

- [ ] **Prod-Apply der Migration 128** — Robert-Entscheidung, bestätigungspflichtig.
      Bis dahin bleibt `draft→sent` in Produktion kaputt (am 2026-09-10 nach dem
      Merge erneut gemessen: `INSERT=f`, `pdf_bytea=f`).
- [ ] **Pauschal-GRANT im Rollen-Skript** (Zeile 282) vergibt bei einem frischen
      Cutover mehr, als 128 beabsichtigt. Die neue Gegenprüfung fängt es; der
      GRANT gehört verengt. Im Runbook als Folgeaufgabe notiert.
- [ ] **Pflicht-Check `integration-core` ist eine Attrappe** — sein Testschritt
      steht auf `if: false` (`ci.yml:219`), er meldet nach 45 s grün. Der Job,
      der die GoBD-Suiten wirklich ausführt, braucht 2 min und ist **nicht**
      erforderlich. Ein roter GoBD-Lauf kann derzeit keinen Merge verhindern.
      (Audit-Befund F-029, hier live bestätigt.)
- [ ] **Regel-Ergänzung** zu `dev-patterns.md` vorgeschlagen: ein Wächter muss
      rot gesehen werden in der Umgebung, **in der er läuft**; weicht sie ab,
      ist deren Aufbau auf einen Zustand zu prüfen, der die Behauptung umkehrt.
      Robert vorgelegt, nicht eigenmächtig eingetragen.

## one_line_learning

Ein Soll-Ist-Vergleich gegen eine veraltete Migration meldet die neue
Voraussetzung als Regression — vor jedem „auf Soll zurücksetzen" prüfen, unter
welcher Rolle der Code die Tabelle heute anfasst, und die Quelle des Entzugs
mitbeheben, nicht nur seinen Effekt.