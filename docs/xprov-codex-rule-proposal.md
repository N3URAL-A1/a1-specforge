# Vorschlag: neuer Text für `~/.claude/rules/common/xprov-codex.md`

> Status: **Vorschlag, nicht aktiv.** Spec 016 (xprov-Autonomie), Wave 12, FR-034.
> Die Eigentümer-Datei `~/.claude/rules/common/xprov-codex.md` ist Roberts Datei. Kein Agent schreibt sie.
> Der Austausch läuft nach dem Merge von 016 auf `main` und nach der Verifikation: Der Orchestrator fragt Robert im Chat, dann ersetzt Robert (oder der Assistent auf seine ausdrückliche Anweisung) den Inhalt unten zwischen den Linien.
> Grundlage: Record `2026-10-14-a1-autonomy-chat-consent` (Vault `record/`), Spec 016, ADR `docs/adr/2026-09-24-cross-provider-review-gate.md`.
> Der Text beschreibt, was der Code nach 016 tut. Er behauptet keinen Schutz gegen einen feindlichen Agenten: das ist Tier 0 (siehe unten).

---

# Codex-Prüfung (xprov): Freigabe und Waiver per Chat

> Festgelegt 2026-10-06 von Robert, neu gefasst nach Spec 016 (Entscheidung `2026-10-14-a1-autonomy-chat-consent`: Autonomie zuerst, Chat statt Terminal).
> Ergänzt [a1-framework.md](./a1-framework.md); ändert keine Gate-Registry und umgeht keine CI-Sperre.

## Regel in einem Satz

Ein a1-Gate schickt Code oder Diffs nur an Codex (Fremdanbieter), wenn Robert das **für dieses Repo im Chat bejaht hat**. Ohne Ja läuft der Reinhard-Weg weiter. Kein Terminal-Schritt für Robert im Normalfall.

## 1. Freigabe (Consent) per Chat

- Fehlt die Freigabe (`xprov permit-check` zeigt `absent`, `origin_changed` oder `unbound_legacy`), frage ich **im Chat** (`AskUserQuestion`), höchstens **einmal je Phase bzw. je PR-Review-Lauf** (`consent question --kind consent --phase <phase>` oder `--run <Worktree>`). Die Frage ist kanonisch: ich stelle sie byte-genau, wie der Befehl sie ausgibt. Sie nennt Repo, ob es privat ist, dass Plan, Wave-Diffs bzw. PR-Diff an Codex gehen, und was das Gate liefert.
- Der Plugin-Hook (`PreToolUse`/`PostToolUse` auf `AskUserQuestion`) nimmt die Antwort aus der echten Tool-Antwort auf. Ein Ja gilt **für dieses Repo** (`consent record` schreibt das Permit samt Audit-Zeile, gebunden an die Origin-URL). Danach laufen alle Gates dieses Repos **automatisch und ohne weitere Rückfrage**. Ausgabe an Robert nur bei Befund, Fehler oder Blocker.
- Ein Nein ist ein Eigentümer-Nein (`external_review_denied`) und gilt, bis Robert es ändert. `consent revoke` führe ich nur auf Roberts ausdrückliche Anweisung aus, nie um nach einem Nein erneut zu fragen (das ist eine Regel für mich, kein Code).
- Neues Repo, anderer Origin oder ein Permit ohne Beleg (`unbound_legacy`) zählt als **kein Permit**: neue Frage.
- **Kundenrepos** (nicht N3URAL-eigen): diese Regel gilt nicht allein. Die Klassifikationsfrage braucht eine `a1-ludwig-legal`-Entscheidung als Beleg (`consent question --kind classification`, Vault-Pfad der Entscheidung). Ohne sie frage ich nicht weiter und sende nichts.

## 2. Kein Permit, Nein, keine Antwort, headless: der Reinhard-Weg

Fehlt das Ja (nie gefragt, Nein, keine Antwort, kein Chat), enden Plan-, Wave- und PR-Diff-Gate mit `not_applicable` (`external_review_not_permitted`, nach einem Nein `external_review_denied`). Es gehen **null Bytes** an Codex, es entsteht kein Snapshot, kein Blocker. Reinhard-Review vor Merge bleibt der Weg. Ich setze nie selbst ein Permit und bearbeite nie `.a1/xprov.json` oder `~/.a1-xprov/` von Hand.

## 3. Was geprüft wird (Platzierung)

Die Platzierung spart Kosten. Die Grenze ist das PR-Diff-Gate.

- **Plan-Review:** nur bei Spec-Größe L oder wenn der Plan Sicherheitsfläche nennt. Sonst `scope_exempt`.
- **Wave-Review:** nur für Waves, die eine spätere Wave in `Depends on` nennt und die Sicherheitsfläche haben. Sonst `scope_exempt`; die Wave steht dann in `deferred_to_pr` und geht in den PR-Text.
- **PR-Diff-Gate `pr-diff-xprov`** (a1-pr-review Schritt 2.2b, neben Reinhard): prüft das echte Diff `merge-base(Remote-Basis, Head)..Head` einmal je Head-Sha. Die Basis kommt vom Remote (`gh pr view`, sonst `git ls-remote`), nie aus lokalen Refs. Gleicher Head: gespeichertes Ergebnis, kein neuer Lauf. Neuer Head: nur die neuen Commits. Reiner Doku-Diff oder (mit Größe-S-Spec) ein Diff ohne Sicherheitsfläche ist `scope_exempt`.
- **Merge-Block als Code:** `xprov gate --gate pr-diff-xprov --merge-check` prüft bei Sicherheitsfläche, ob für genau diesen Head ein Pass, Dispositions, ein Chat-Waiver oder ein Nein mit Eigentümer-Beleg vorliegt. `codex_blocked_fallback` zählt auf einer Sicherheitsfläche **nicht**.
- **Merge-Hook:** Der Plugin-Hook auf `Bash` erlaubt bei Merge-Absicht nur **einen** Befehl, allein im Aufruf: `gh pr merge <n> [--squash|--merge|--rebase] [--delete-branch|-d] [--match-head-commit <sha>]`, und nur wenn der Merge-Check Exit 0 liefert. Alles andere mit Merge-Absicht wird abgelehnt (kein `cd`, kein Env-Präfix, kein Wrapper, kein `--repo`, kein `gh api`). PR-Texte gehen über `--body-file`.
- **Branch Protection:** „Require pull request“ auf `main` ist eine **Eigentümer-Aktion** (Roberts Entscheidung im GitHub-Konto). Der Assistent setzt sie nicht. Ohne sie bleibt ein direkter Push auf `main` ein Restrisiko außerhalb des Hooks.

## 4. Runden, Dispositions, Selbstheilung

- Findings aus Runde 2 mit MAJOR/MINOR, aber ohne BLOCKER, schließe ich **automatisch** ab (`xprov dispose`, Dispositions je Finding). Es braucht keinen Waiver. **Das heißt ausdrücklich:** Beim Rundenlimit setze ich jedes offene MAJOR selbst auf `fixed` oder `accepted: <Grund>` (FR-025), ohne dass du gefragt wirst. Wer diese Regel übernimmt, übernimmt das bewusst. BLOCKER kann ich so nicht abschließen.
- Selbstheilung ohne Rückfrage: Runner-Fehler werden begrenzt wiederholt, die Review-Home-Konfiguration und die Basis werden repariert. Antwortet Codex zweimal mit BLOCKED, endet das Gate Reinhard-only (`codex_blocked_fallback`); das ist auf einer Sicherheitsfläche **kein** Ergebnis für den Merge. Jeder Lauf schreibt eine Beobachtungszeile (`owner_handoffs`, `codex_runs`, `abort_reason`, `recovered`).
- Bleibt ein Ziel nach den Runden rot (BLOCKER, Rundenlimit), frage ich **einmal je Phase** im Chat nach einem Waiver (`consent question --kind waiver`). Ein Ja gilt nur für genau die gelisteten Ziele und nur für diese PLAN.md-Version bzw. diesen Head. Ein Waiver ist kein Bestanden. **Ehrlich gesagt:** „einmal je Phase“ ist beim Waiver eine **Skill-Regel**, im Code nicht erzwungen (Tier 0): nur die Frage nach der Freigabe (Consent) zählt der Code (`consent-asked`). Ein Waiver-Ledger baue ich jetzt nicht.

## 5. Harte Stopps

Diese Befunde umgehe ich nicht. Befund melden, Ursache beheben, neu laufen lassen:

- Geheimnis-Treffer in **geänderten** Zeilen (`secret_in_snapshot`): ich stelle die Allowlist-Frage im Chat (`consent question --kind allowlist --scan <snap>`). Nein oder keine Antwort beendet das Gate Reinhard-only (`secret_declined`); auf einer Sicherheitsfläche zählt das nur mit einem Eigentümer-Nein, das der Hook am Marker festgehalten hat. Ein Ja schickt genau die gelisteten Blobs an Codex (je Pfad, Regel und Blob-Hash, mit der Zahl der gelisteten Fundstellen); ändert sich ein Blob oder kommt eine Fundstelle dazu, braucht es eine neue Frage. Treffer werden nur ausgeschlossen, wenn **alle** Treffer in unveränderten Dateien liegen, es höchstens 50 sind und eine Basis existiert; sie stehen dann im Review-Input mit Pfad (nie mit Wert). Liegt auch nur ein Treffer in einer geänderten Zeile, gibt es keinen Ausschluss und ich frage.
- `secret_in_output`, `tripwire`, `quarantined`, `run_home_unsafe`, `external_review_permit_mismatch`, `snapshot_changed_after_scan`, `allowlist_invalid`, `allowlist_modified`.
- Eine Sperre des Berechtigungssystems (z. B. „CI Bypass“) umgehe ich nicht. Ich melde sie und lasse Robert entscheiden.

## 6. Terminal nur als Fallback

Die Terminal-Befehle bleiben für den Fall, dass der Chat-Weg nicht möglich ist (kein Hook, Chat-Ausfall). Sie sind **Roberts** Schritt in seinem eigenen Terminal, nicht meiner; die Befehle verweigern Agenten technisch:

`node ~/claude-projects/a1-specforge/_shared/a1-tools.cjs xprov permit --by robert --record <Vault-Notiz> --repo <Pfad>`

Entsprechend `xprov waive` und `xprov allowlist approve`. Ich gebe sie nur aus, wenn der Chat-Weg nachweislich nicht geht, und täusche kein Terminal vor. Die Vault-Notiz (`record/<YYYY-MM-DD>-xprov-freigabe-<slug>.md`: Entscheidung, Datum, Repo) lege ich vorher an.

## 7. Grenzen und Tier-0-Wortlaut

- Alle Nachweise (Marker, Audit-Kette, Hook-Aufzeichnung, Permit-Store) sind **Tier 0**: Ein Prozess desselben OS-Nutzers kann sie fälschen. Das ist ein bewusst akzeptiertes Restrisiko (Fälschung durch denselben User). Sie schützen vor Versehen, falsch gezeigten Fragen und einem fehlgeleiteten Agenten, nicht vor einem feindlichen Prozess mit Roberts Rechten.
- Der Merge-Hook erkennt nur den eigenen Bash-Aufruf. Ein Merge über die Web-Oberfläche, ein MCP-Werkzeug oder einen anderen Rechner liegt außerhalb; dafür ist Branch Protection die Kontrolle (Eigentümer-Aktion, siehe 3).
- Die Freigabe gilt für das eine Repo. Neues Repo = neue Frage.
- Die Regel ändert keine Gate-Registry. Plan- und Wave-Gate stehen auf `blocking`, das PR-Diff-Gate auf `warning`; das Umstellen des PR-Diff-Gates auf `blocking` braucht einen belegten Live-Lauf (ADR, „Live smoke“) und ist eine eigene Entscheidung.

---
