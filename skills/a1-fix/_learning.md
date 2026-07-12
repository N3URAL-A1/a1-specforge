# a1-fix — Learning Log

Fast-access cache. Canonical source: `wiki/postmortems/` in Obsidian Vault.
Entries appended automatically by Phase 4 (Verify) after every terminal verdict.

Tags: missing_wiring | schema_flaw | regression | race_condition | env_config | third_party_change | ui_state_bug | auth_tenant | spec_omission | off_by_one

---

---
date: 2026-05-08
bug_id: upload-beleg-404
project: n3ural-platform
verdict: fixed
root_cause_class: [missing_wiring]
fix_wave_count: 1
one_line_learning: Wave 6 placeholder comments + URL Link targets in code are no substitute for Phase 6 Verify checklist; use FR ID references to confirm shipment
postmortem: wiki/postmortems/n3ural-platform/2026-05-08-upload-beleg-404.md
---

# BUG-01: Upload route 404 — page never created (May 8)

## Issue
Clicking "Neuen Beleg hochladen" navigates to `/dashboard/ausgaben/upload/` which 404s. Components FileUploadZone, ExpenseReviewScreen, DuplicateWarningBanner exist in codebase; API endpoint live; but page file itself missing.

## Root Cause
Wave 6 merged incompletely: components + endpoint present, but `app/[locale]/dashboard/ausgaben/upload/page.tsx` was never created. Code comment `// Wave 6 placeholder` in page.tsx:138 and tooltip `Upload-Seite kommt in Wave 6` proved Wave 6 was expected but verification never happened.

## Fix
Walter created upload/page.tsx with Server wrapper + Client state machine (FileUploadZone → ExpenseReviewScreen flow). Fix commit 325c7f7.

## Learning
Code comments like "Wave 6 placeholder" and links to non-existent routes are red flags that Phase 6 Verify was skipped. Verify should walk FR IDs and confirm each one has shipped code that matches spec. Tool: diff spec FR list against git log FR-### references in commits.


---
date: 2026-05-08
bug_id: upload-save-error-schema-rls-mismatch
project: n3ural-platform
verdict: fixed
root_cause_class: [schema_flaw]
fix_wave_count: 2
one_line_learning: Two-phase upload flow (upload with NULL expense_id, then save to link) requires nullable FK + RLS policies that respect NULL state; migration cannot be skew between schema + code
postmortem: wiki/postmortems/n3ural-platform/2026-05-08-upload-save-error-schema-rls-mismatch.md
---

# BUG-02: Save fails 500 — schema NOT NULL + RLS mismatch (May 8)

## Issue
After PDF upload + OCR, clicking Speichern fails with generic 500 error. No expense row created. File remains in expense_files with expense_id = NULL.

## Root Cause
Two coupled schema defects:
1. **expense_files.expense_id is NOT NULL** but upload intentionally inserts NULL (two-phase design: upload first, attach at save time). Schema enforces NOT NULL; code tries NULL → PostgreSQL violation.
2. **RLS policy doesn't permit NULL expense_id rows**: Policy `expense_files_select` filters `expense_id IN (SELECT ... FROM expenses)` which evaluates NULL → not visible to user. Combined with NOT NULL, neither upload nor save works.

## Fix
Backend-Bernd: Migration 023 made expense_id nullable, added tenant_id directly to expense_files, rewrote RLS to check tenant_id (same pattern as expenses table). Fixes both upload and save paths. Commit aeb5ac8.

## Learning
Two-phase workflows (transient state + later linkage) require explicit schema design. When code has intentional NULL phases, enforce it in DDL and test RLS policies against NULL state. Integration test: insert NULL row, verify both upload path SELECT and save path can see it.


---
date: 2026-05-09
bug_id: save-persists-nothing-rls-grants
project: n3ural-platform
verdict: fixed
root_cause_class: [schema_flaw]
fix_wave_count: 1
one_line_learning: Save endpoints touching 4+ RLS-protected tables must pre-verify all GRANTs + RLS policies for multi-table transaction; one missing grant = silent rollback
postmortem: wiki/postmortems/n3ural-platform/2026-05-09-save-persists-nothing-rls-grants.md
---

# BUG-03: Save persists nothing — RLS grants incomplete (May 9)

## Issue
After upload + OCR work, save POST returns 500. No data persisted. List stays at 0. Error banner shows generic "could not save" message.

## Root Cause
Save transaction (`app/api/expenses/save`) touches 5 tables under RLS: expense_files SELECT (fileCheck), expenses INSERT, expense_audit_log INSERT, expense_files UPDATE, eur_categories SELECT. One or more of these operations failed due to missing GRANT or RLS INSERT policy for agent_user role. Transaction rolled back; generic catch-all 500 swallows actual error.

## Fix
Backend-Bernd: Verified GRANTs + RLS policies on all 5 tables. Added missing policies to expense_audit_log for agent_user INSERT. Commit 2fc409b. Also added structured error logging to catch-block so next incident is diagnosable.

## Learning
Multi-table mutations under RLS require a pre-fix audit of GRANT + RLS matrix for the executing role on EVERY table touched. Silent rollback (no app-level exception) is common when RLS policies are incomplete. Add logging to catch-blocks that includes error code (42501 = permission denied, 42P17 = RLS violation) so next incident is 30-second fix not hours of debugging.


---
date: 2026-05-09
bug_id: duplicate-confirm-loop-no-flag
project: n3ural-platform
verdict: fixed
root_cause_class: [spec_omission]
fix_wave_count: 1
one_line_learning: Duplicate warning flows with "Trotzdem speichern" require explicit confirm_duplicate flag in request schema; frontend assumption "backend accepts on retry" without flag = infinite loop + phantom rows
postmortem: wiki/postmortems/n3ural-platform/2026-05-09-duplicate-confirm-loop-no-flag.md
---

# BUG-04: Duplicate confirm loop — "Trotzdem speichern" saves nothing (May 9)

## Issue
Duplicate warning appears correctly. User clicks "Trotzdem speichern" → banner dismisses, no redirect, phantom row created in DB.

## Root Cause
SaveExpenseSchema has no confirm_duplicate field. Backend runs checkForDuplicate unconditionally on every POST. Frontend retries with identical body → backend returns duplicate_warning again → infinite UI loop. Additionally, first POST INSERTs before checking duplicate → phantom row.

## Fix
Walter: Added confirm_duplicate: boolean optional field to schema (default false). Moved duplicate check BEFORE INSERT. If duplicate found AND confirm_duplicate=false → early return. If true → skip check, proceed to INSERT. Frontend handleDuplicateDismiss sends {…request, confirm_duplicate: true}. Commit bed36ab.

## Learning
Confirmation flows (retry-after-warning) must use explicit request state fields, not implicit "second POST = confirmed" assumptions. Move validation BEFORE mutations, not after. Test: POST 1 (warning) should not mutate; POST 2 (confirm_duplicate=true) should mutate.


---
date: 2026-05-11
bug_id: reports-ausgaben-filter-deleted-inconsistent
project: n3ural-platform
verdict: fixed
root_cause_class: [wrong_behavior_vs_spec]
fix_wave_count: 1
one_line_learning: Soft-delete pattern (deleted_at IS NULL) must be enforced in ALL queries on a table, not per-endpoint; one inconsistent filter = wrong aggregates + trust loss
postmortem: wiki/postmortems/n3ural-platform/2026-05-11-reports-ausgaben-filter-deleted-inconsistent.md
---

# BUG-05: Reports Ausgaben show 0 — wrong filter + hardcoded label (May 11)

## Issue
Reports dashboard Ausgaben MTD card shows 0 EUR even though expenses exist on /dashboard/ausgaben for the same period. Regression since Spec 003 deploy which added period filtering.

## Root Cause
Two bugs: (1) Summary route filters `status != 'deleted'` but soft-delete handler only sets `deleted_at IS NULL` (status unchanged). Filter never fires → dead code → inconsistent with list/export queries. (2) Label hardcoded "(laufender Monat)" even when user navigated to different month via stepper; silent fetch failure masked by fallback to 0.

## Fix
Walter: Changed filter from `status != 'deleted'` to `deleted_at IS NULL` to match all other queries. Refactored page.tsx to use direct DB call (withTenantContext) instead of HTTP self-call, eliminating silent-failure fallback. Fixed label to use period.label. Commit a896575.

## Learning
Soft-delete pattern requires consistent WHERE clause across ALL endpoints. Create a shared query fragment or constants file with the canonical filter (deleted_at IS NULL). Audit at schema review time. Also: HTTP self-calls in server components hide failures — prefer direct DB when available.


---
date: 2026-05-24
bug_id: dtg-tenant-404-sidebar-filter
project: n3ural-platform
verdict: fixed
root_cause_class: [auth_tenant]
fix_wave_count: 3
one_line_learning: HTTP self-calls in middleware = cold-start cascade; use direct DB with explicit tenant context; always run \\d tablename before any new DB query
postmortem: wiki/postmortems/n3ural-platform/2026-05-24-dtg-tenant-404-sidebar-filter.md
---
---
date: 2026-07-12
bug_id: cmd-injection-git-helper
project: a1-specforge
verdict: fixed
root_cause_class: [schema_flaw]
fix_wave_count: 1
one_line_learning: JSON.stringify is not a shell-escaping function — any exec call that builds a shell command string from JSON.stringify-quoted args is command-injection-vulnerable; only execFileSync's argv-array form is safe
postmortem: wiki/postmortems/a1-specforge/2026-07-12-cmd-injection-git-helper.md
