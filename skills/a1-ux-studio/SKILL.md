---
name: a1-ux-studio
description: >
  UX/UI design studio: turns a four-part brief (aesthetic, reference, intent,
  guardrails) into rendered, offline HTML boards — 5 style families side by
  side, then 3 layout variants of the picked family — generates assets for the
  chosen variant, gates the result with the pinned Impeccable detector plus a
  font-license check, and blocks handoff while any finding is open or any
  1280/390 px screenshot is missing. All artifacts land in a dated vault run
  folder; nothing is written into the target repo. Invoke with "UX/UI design",
  "look and feel", "design variants", "design options", "render design
  variants", "a1-ux-studio", or in German "UX/UI-Design", "Look & Feel",
  "Design-Varianten", "Designoptionen", "UI-Entwurf rendern".
  Invoked automatically from a1-new-feature Clarify Step 2b for UI-touching
  features of size M or L. Do NOT activate for pure backend work, copy-only
  edits, or copying an existing site one to one.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Skill
---

# a1-ux-studio — rendered UX/UI design options

Language: files English; chat with the user in German (`_shared/language-policy.md`).

## Purpose

Replace ASCII wireframes with rendered choices. The user sees real pages
side by side, picks twice (direction, then layout), and gets a gated result
plus a written decision that the spec and the wave plan can cite. The studio
is a **tool skill**, not a phase pipeline: it runs in the current session and
spawns no sub-agents.

## No sub-agents, no `_learning.md`

`Agent` is deliberately absent from `allowed-tools` above (spec 024 wave plan,
decision 3; a fixture case in `_test-fixtures/a1-ux-studio/parts/01-skeleton.sh`
turns red if it is added). Constitution invariant 2 (own learning store) binds
skills that orchestrate agents, so this skill has **no `_learning.md`**.
Learning flows through the a1-new-feature Phase 6 retro, which attributes the
gate as `{id: ux-studio-gate, verdict, caught}` with the run's
`gate-record.json` as evidence. Standalone runs leave a gate record but no retro.
Uwe (UX agent) is spawned by the a1-new-feature orchestrator, never by this skill.

## When it runs

- **Automatic:** a1-new-feature Clarify Step 2b, for every UI-touching feature
  of size M or L (the orchestrating main session invokes this skill).
- **Size S:** ASCII wireframes stay, unless the user asks for rendered variants.
- **Standalone:** any trigger phrase from the description. Spec id becomes
  `adhoc-<YYYY-MM-DD>-<topic-slug>`.

## Paths used below

- `<skill-dir>` — the directory of this SKILL.md (scripts live under
  `<skill-dir>/scripts/`).
- `<run-dir>` — the run folder from the contract below, created by
  `run.cjs init` in step 1.

## Flow (stage 1, P1)

Run the steps in order. Each step reads its workflow file and does not start
before the previous step has its recorded output.

| Step | Workflow | Output |
|------|----------|--------|
| 1 | [workflows/01-brief.md](workflows/01-brief.md) | Four-part brief, run folder created, `run.md` written |
| 2 | [workflows/02-diverge.md](workflows/02-diverge.md) | `boards/diverge.html` with 5 family tiles, pick recorded |
| 3 | [workflows/03-converge.md](workflows/03-converge.md) | `boards/converge.html` with 3 layout tiles, pick recorded |
| 4 | [workflows/04-assets.md](workflows/04-assets.md) | Images + `.json` sidecars in `assets/`, `result/result.html` |
| 5 | [workflows/05-gate.md](workflows/05-gate.md) | Screenshots 1280/390 px, `gate-record.json` |
| 6 | [workflows/06-handoff.md](workflows/06-handoff.md) | `handoff-check` exit 0, decision line for the spec |

No pick, no advance: step 3 does not start without a diverge pick, step 4
not without a converge pick. If the user says "just do it", the default is
adopted and recorded as `Default adopted:` in `run.md`.

## Stage 2/3 entries (P2/P3)

Entered on request, never as part of the default flow.

| Entry | Workflow | Purpose |
|-------|----------|---------|
| Taste vault | [workflows/07-taste-vault.md](workflows/07-taste-vault.md) | Save a good find as a five-field entry under `pattern/taste-vault/<family>/` |
| Tweaks | [workflows/08-tweaks.md](workflows/08-tweaks.md) | Dev copy with a tweak panel; export values as tokens into the spec |
| Remix | [workflows/09-remix.md](workflows/09-remix.md) | Controlled variations with an amplitude and optional vault anchors |
| Motion | [workflows/10-motion.md](workflows/10-motion.md) | Motion templates with reduced-motion shutdown and a mobile still |

## Contracts (short form)

Full text: spec 024 wave plan, section "Contracts". Waves read these, never renegotiate them.

**Run folder** — created only by `node <skill-dir>/scripts/run/run.cjs init`:

```
$A1_VAULT_ROOT/project/<project-slug>/ux/<spec-id>/<YYYY-MM-DD>-<screen-slug>[-<n>]/
  run.md            frontmatter: spec_id, project, screen, created, status
                    sections: ## Brief, ## Picks, ## Assets, ## Screenshots,
                    <!-- gate-record:start --> … <!-- gate-record:end -->
  boards/diverge.html  boards/converge.html  boards/fonts/<family>/…
  result/result.html   result/result.dev.html (P3 tweaks only)
  assets/<name>.png + <name>.json
  screenshots/<board|result>-1280.png, -390.png
  gate-record.json
```

- Slugs match `^[a-z0-9][a-z0-9-]{0,63}$`; anything else exits 2.
- A re-run for the same screen creates a new folder with suffix `-<n>`; older runs stay untouched.
- `A1_VAULT_ROOT` unset or the project folder missing: stop, name the
  variable, write nothing anywhere. No fallback to a repo folder.
- Project slug comes from the spec frontmatter `project:` or the repo folder name.

**Gate record** — `gate-record.json`, written only by `ux-gate.cjs`:
`gate_id: "ux-studio-gate"`, `impeccable_version`, `scan_mode`, `target`,
`exit_code`, `status: pass|findings|error`, `cause`, `findings[]`
(`id, rule, severity: primary|advisory, location, state: open|fixed|accepted, reason`),
`font_check` (`status: pass|fail`, `failures[]` with `font, reason: remote_url|not_allowlisted, state, reason_text`),
`created`. Only `ux-gate.cjs` writes between the gate-record markers in `run.md`.

**Gate CLI** — `node <skill-dir>/scripts/gate/ux-gate.cjs`:

| Command | Exit codes |
|---------|------------|
| `run --run-dir <d> --target <html>` | 0 pass · 1 blocking findings · 2 usage or hostile input · 3 gate error (detector exit 1, npx missing, download blocked) |
| `accept --run-dir <d> --finding <id> --reason <text>` | 0 accepted · 2 empty reason or usage error |
| `handoff-check --run-dir <d>` | 0 allowed · 1 blocked, one reason per line |

Advisory findings never block. A gate `error` always blocks; it is never a pass.

**Tile markup** — every board tile:

```html
<section data-a1-tile data-option-id="<id>" data-family="<family-id>" data-layout="<layout-slug>">
```

A user reference adds `data-variant0`. No `http(s)://` resource of any kind
in a board or result: fonts are self-hosted under `boards/fonts/`, images
under `assets/`.

## Hard rules

1. **Nothing into the target repo.** Every artifact goes to the vault run
   folder. Approved assets reach the repo only later, through the wave plan.
2. **Never `/impeccable init`** and never a project-scope Impeccable install.
   The detector runs only as `npx impeccable@4.8.1 …` (version pinned; the
   gate script owns the argv).
3. **`/design` is optional.** No workflow requires Claude Code `/design`; the
   self-rendered HTML board is the default path.
4. **Max 8 imagegen images per run.** The 9th image needs the user's explicit
   approval. If `imagegen` fails, the result shows labeled placeholders and
   `run.md ## Assets` lists the missing assets.
5. **Match the feeling, do not copy.** References inform mood; there is no
   clone or pixel-copy mode.
6. **Only license-free fonts** (SIL OFL or similar), self-hosted. Remote font
   URLs and non-allowlisted families fail the font check.
7. **No handoff while blocked.** Open primary findings, open font failures, a
   gate `error`, or a missing 1280/390 px screenshot block step 6. An item
   is cleared only by a fix or by `accept` with a non-empty reason.
8. **Auto for UI features of size M/L** from a1-new-feature Clarify Step 2b;
   size S only on request.
9. **Unusable reference = warning, not stop.** An empty, missing,
   unreachable or oversized reference prints a warning naming it; the run
   continues on the family alone.

## Handoff

Step 6 ends the studio. The calling session writes under the spec's
`## Clarifications`:

```
UX/<screen-name>: Variant <X> chosen. Reason: <1 sentence>.
```

followed by a link to the run folder's `run.md`. Standalone runs end with the
link and the gate status in chat.
