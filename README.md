# a1-skills

N3URAL.AI's Spec-Driven Development (SDD) Skill-Set für Claude Code.

Ein eigenes SDD-Toolkit — ähnlich wie [spec-kit](https://github.com/github/spec-kit), aber mit Obsidian-Vault-Integration, deutschen Personas und Multi-Agent-Orchestrierung.

## Skills

| Skill | Beschreibung |
|---|---|
| `a1-new-feature` | 6-Phasen Feature-Pipeline: Discover → Specify → Clarify → Plan → Implement → Verify |
| `a1-fix` | 4-Phasen Bug-Pipeline: Report → Diagnose → Fix → Verify |
| `a1-analyze` | 5-Phasen Projekt-Analyse: Scope → Discover → Analyze → Synthesize → Report |
| `_shared/a1-tools.cjs` | CLI-Helper für alle Pipelines (Frontmatter-State, Phase-Transitions) |

## Installation

```bash
git clone https://github.com/vf-robert/a1-skills.git ~/code/a1-skills
cd ~/code/a1-skills
./bin/install.sh
```

Das Script setzt Symlinks von `~/.claude/skills/` auf dieses Repo. Änderungen am Code sind sofort live.

## Roadmap

→ [`docs/roadmap.md`](docs/roadmap.md)

## Verwendung

Skills werden via Claude Code als Slash-Commands aufgerufen:

```
/a1-new-feature   # Neues Feature starten
/a1-fix           # Bug-Report anlegen
```

## Struktur

```
a1-skills/
├── a1-new-feature/     # Feature-Pipeline Skill
│   ├── SKILL.md
│   ├── agents/
│   ├── templates/
│   └── workflows/
├── a1-fix/             # Bug-Pipeline Skill
│   ├── SKILL.md
│   ├── agents/
│   ├── templates/
│   └── workflows/
├── _shared/
│   └── a1-tools.cjs    # CLI-Helper
├── bin/
│   └── install.sh      # Symlink-Setup
└── docs/
    └── roadmap.md      # Entwicklungs-Roadmap
```
