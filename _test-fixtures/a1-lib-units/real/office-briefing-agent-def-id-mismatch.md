---
type: bug-report
project: a1-office
bug_slug: briefing-agent-def-id-mismatch
title: Proaktive Agent-Läufe (Briefing) schlagen seit 5 Tagen silent fehl — agentId
  UUID statt Slug
status: fixed
severity: blocker
reported_at: 2026-07-22T20:00
reporter: Robert (via a1-fix)
affected_repos:
- n3ural-platform
related_deploy: unknown
duplicate_of: null
phase_history:
- phase=report completed=2026-07-22T20:35
- phase=diagnose completed=2026-07-22T20:35
- phase=fix-start completed=2026-07-22T21:21:22.895Z
- phase=verify completed=2026-07-22T21:33:00.063Z
recommended_code_agent: a1-walter-web-developer
fix_commit: d81c1e9
verify_result: 'PR #100 gemergt (7b24e70), alle 10 CI-Checks grün (lint, tsc, unit
  3773/3983, integration, cross-tenant-isolation, build, e2e-smoke, vercel). DB-Cleanup
  verifiziert: 7 hängende Runs auf failed. Offen: Roberts Live-Check dass der nächste
  Cron-Tick ein neues Briefing erfolgreich abschließt.'
tags:
- bug
- project/a1-office
permalink: vault/project/a1-office/fixes/2026-07-22-briefing-agent-def-id-mismatch
---
