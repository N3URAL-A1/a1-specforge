# Sub-Agent Brief Template — Phase 2 (Draft)

This template is used by `workflows/02-draft.md` to construct Finn's brief.
All four sections below MUST be present in every dispatch.

## Brief structure (fill these four sections)

```
Du bist Finn (finn-cc-architect). Aufgabe: Entwirf das Body-Markdown einer
projekt-spezifischen `constitution.md`. Du arbeitest im Skill `a1-constitution`,
Phase 2 (Draft).

## Project Context

- Projekt-Slug: <PROJECT_SLUG>
- Repo-Root: <REPO_ROOT>
- Globale Rules (gelten projektübergreifend, hier nur Referenz):
<GLOBAL_RULES_LIST>

CLAUDE.md des Projekts (Auszug, max. 4000 Zeichen):

```
<CLAUDEMD_EXCERPT>
```

Existing repo constitution: <REPO_CONSTITUTION_PRESENT> (true/false)
Existing CLAUDE.md cross-link: <HAS_LINK_TO_CONSTITUTION> (true/false)

User-Interview (verbatim aus Phase 1):

- Projekt-spezifische Regeln (Q1):
  "<USER_PROJECT_RULES>"

- Agent-Einschränkungen (Q2):
  "<USER_AGENT_RESTRICTIONS>"

- Wichtigste Konvention für neue Agents (Q3):
  "<USER_KEY_CONVENTION>"

## Focus

Generiere das vollständige Markdown-Body der constitution.md. Nutze die
folgende Skelett-Struktur als Vorlage. Fülle die <filled by Finn ...>-
Platzhalter mit konkretem Inhalt, der sich AUS dem Project Context ableitet —
nicht generisch, sondern projektbezogen.

Skelett (Vorlage, du füllst die Platzhalter):

```
<TEMPLATE_SKELETON>
```

Inhaltliche Anforderungen:

1. **Override Precedence (4 Layers)** — die 4 Layer sind FIX. Du musst sie
   verbatim übernehmen (Global Rules < Project CLAUDE.md < Agent Frontmatter
   < Session Instruction). Das Beispiele-Sub-Section kannst du um 1-2
   projekt-spezifische Beispiele ergänzen, wenn das Project Context welche
   nahelegt (z.B. wenn CLAUDE.md eine konkrete Tool-Wahl trifft, die ein
   Agent overrided).

2. **Project Behavioral Rules** — leite aus dem User-Interview Q1 + CLAUDE.md
   die projekt-spezifischen Regeln ab. 3-7 Regeln, jede als eigener
   nummerierter Bullet. Jede Regel muss überprüfbar sein (kein "Code soll
   gut sein" — sondern "Migrations leben in eigener PR und werden vor Merge
   manuell geprüft").

3. **Agent-Specific Constraints** — leite aus User-Interview Q2 ab. Wenn
   the user nichts angegeben hat (leerer String, "keine", "none"), schreibe
   genau "None." als Inhalt. Sonst: pro Agent ein eigener Block mit Name,
   Constraint, Begründung.

4. **Key Convention** — direkt aus User-Interview Q3. Maximal 3 Sätze.
   Anspruch: jeder neue Agent versteht es ohne Code zu lesen.

5. **Notes** — leer lassen oder eine einzige Zeile mit dem Erstellungs-
   Datum + Vault-Pfad. the user nutzt das später für Updates.

## Output Contract (HARD)

Liefere AUSSCHLIESSLICH das Body-Markdown der constitution.md.

- KEIN YAML-Frontmatter (kein `---` am Anfang) — Frontmatter ist unter
  Skill-Kontrolle.
- KEIN Vor- oder Nachsatz ("Hier ist die Constitution:", "Ich hoffe das passt").
- KEIN Code-Block-Wrapping um das Markdown.
- Das Dokument MUSS mit `# Constitution for <PROJECT_SLUG>` beginnen.
- Das Dokument MUSS die vier Pflicht-Abschnitte `## Override Precedence`,
  `## Project Behavioral Rules`, `## Agent-Specific Constraints`,
  `## Key Convention` enthalten — exakt in dieser Reihenfolge.
- Die Sprache des Bodys ist **Englisch** (Constitution ist technisches
  Artifact, kein User-Doc).

## Out of Scope

- KEINE Vorschläge zu CLAUDE.md-Änderungen (das ist eine separate Audit-
  Konversation, nicht hier).
- KEINE Code-Beispiele aus dem Repo — du hast nur den CLAUDE.md-Auszug,
  keinen Repo-Zugriff.
- KEINE Diskussion alternativer Override-Modelle. Die 4 Layer sind fix.
- KEINE Empfehlungen zu Skill- oder Agent-Architektur.
- KEIN Status-Update — das macht der Skill via CLI.
```
