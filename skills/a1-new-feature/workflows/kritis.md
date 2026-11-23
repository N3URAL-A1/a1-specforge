<!-- load: conditional trigger=profile resolve -->
<!-- a1-profile:kritis -->
**KRITIS profile only** — skip this block unless the run profile is `kritis`.

## Profile Gate (optional `kritis` profile, spec 006-specforge-kritis-profile)

**Arguments.** `--profile <name>` selects a profile for this run (the only known value is
`kritis`). `--simulate <csv>` lists stakeholder role ids (1-5, from
`_shared/profiles/kritis/stakeholder-roles.md`) for the optional simulation in Phase 3 Step 2c.
Both are ignored when the run profile is not `kritis`.

**Resolve (after the Roadmap Gate, before Phase 1).** The resolve step is the unguarded
"Profile resolve" line above this block: it runs on every run, with or without `--profile`, so a
profile declared in `docs/product/index.json` or the constitution is found (FR-001). The
precedence is fail-closed: flag, then spec frontmatter, then `docs/product/index.json`, then the
constitution marker.

Exit 0 prints `{profile, source, isolation, ...}`; `profile: null` means no profile and this
whole section is skipped. Exit 1 or 2 stops the run and shows the message. Phases 2 to 6 started
in a new session pass `--spec <path>` and re-resolve from the spec frontmatter.

**Under `kritis`:**

1. Announce it in one line: "KRITIS profile active (source: <source>): EARS requirements, NFR
   injection, STRIDE threat model at Gate C, blank-slate run."
2. Right after `spec init` (Phase 1 Step 2), persist the decision so later sessions re-resolve:

   ```bash
   node <repo>/_shared/a1-tools.cjs profile set --spec <spec-path> kritis
   ```

3. **Blank slate.** During the run do not read `.claude/agent-memory/`, the learning store
   (`pattern/a1-learnings/`, `.a1/learnings/`) or any `_learning.md` file, and append the
   blank-slate clause to every brief you give a sub-agent.
4. **Honest limit.** A skill cannot unload context the harness injected before it ran: the
   project `CLAUDE.md` and the auto-memory index are already in the session. This skill does
   not enforce a clean session and does not claim to. Tell the user to start KRITIS runs in a
   fresh session with auto-memory switched off, and say so in the announcement if the session
   is not fresh.
<!-- /a1-profile:kritis -->
