# Phase 1: Bootstrap

Create the project's ground structure and a local git repo. **Never overwrite.**
Add only what is missing. If the directory is already a repo or already has a
`CLAUDE.md`, detect it and skip that sub-step — do not abort.

## 1a. Establish the target directory

Ask the user where the project lives (default: `~/code/<project-slug>/`).
Confirm the slug (kebab-case). All paths below are relative to that root.

```bash
PROOT="$HOME/code/<project-slug>"   # confirmed with user
mkdir -p "$PROOT"
```

## 1b. Git init (local only)

```bash
if [ -d "$PROOT/.git" ]; then
  echo "→ Already a git repo, skipping git init."
else
  git -C "$PROOT" init
  echo "→ Local git repo initialized."
fi
```

**Do NOT** run `gh repo create` or push. A GitHub remote is created ONLY later,
on explicit user request (see 1f).

## 1c. CLAUDE.md from template

```bash
if [ -f "$PROOT/CLAUDE.md" ]; then
  echo "→ CLAUDE.md exists, skipping (never overwrite)."
else
  cp ~/.claude/templates/CLAUDE.md.template "$PROOT/CLAUDE.md"
  echo "→ CLAUDE.md created from template."
fi
```

Then fill the obvious `{{PLACEHOLDERS}}` you already know (project name, repo
path). Leave stack/status placeholders for after the Scope-Interview if unknown
— or come back and fill them in Phase 3 once the stack is decided. Keep it
under 200 lines.

## 1d. .claudeignore (stack-matched)

Pick the stack block from `~/.claude/templates/CLAUDEIGNORE.md`. If the stack is
not yet decided, write the universal block now and append the stack-specific
patterns after Phase 2. Never overwrite an existing `.claudeignore`.

```bash
[ -f "$PROOT/.claudeignore" ] && echo "→ .claudeignore exists, skipping." \
  || echo "→ writing .claudeignore (universal block + chosen stack)"
```

## 1e. .claude/ scaffold + memory

```bash
mkdir -p "$PROOT/.claude/agent-memory"
[ -f "$PROOT/.claude/agent-memory/MEMORY.md" ] \
  || printf '# Memory\n' > "$PROOT/.claude/agent-memory/MEMORY.md"
mkdir -p "$PROOT/.a1"
echo "→ .claude/ + .a1/ ready."
```

This follows the project-scaffold rule: minimum structure is `CLAUDE.md`,
`.claudeignore`, `.claude/`, `.claude/agent-memory/MEMORY.md`, plus our `.a1/`.

## 1f. GitHub remote — ONLY on explicit confirmation

Do NOT do this by default. If — and only if — the user explicitly asks for a
remote, confirm once more (this is an outward-facing action), then:

```bash
# After explicit "yes, create the GitHub repo":
gh repo create <owner>/<project-slug> --private --source "$PROOT" --remote origin
git -C "$PROOT" add -A && git -C "$PROOT" commit -m "chore: initial scaffold"
git -C "$PROOT" push -u origin main
```

If the user did not ask: stop at the local repo. Mention that a remote can be
added later.

## 1g. Optional: constitution

Offer — do not force — the `a1-constitution` skill to define per-project
behavioral rules:

```
Möchtest du jetzt eine constitution (feste Verhaltensregeln für dieses Projekt)
anlegen? Ist optional — können wir auch später machen. [ja / später]
```

If yes: invoke `a1-constitution` for this project slug, then return here.
If later: continue.

## Output

A bootstrapped project root with git initialized locally and the minimum
scaffold in place. Nothing committed unless the user asked for a remote.

Report what was created vs. skipped, then proceed to **Phase 2 (Scope-Interview)**.
Do not write any scope/roadmap/backlog files yet.
