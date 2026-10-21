# Origin of the files in real/

Byte copies from the a1-office repository (`~/claude-projects/a1-office`, HEAD 1a9048c4, 2026-10-21), the four
write sites of the defect class of the postmortem `foreign-customer-id-invoices-tasks` (2026-10-03, single-column FK
customer_id/project_id written without a tenant check). After the fix each site calls `assertRefsInTenant`; the
fixture suite removes that guard idea by rewriting the INSERT lines, it does not edit these copies.

- `lib/crm/invoice-write-service.ts` (INSERT INTO api.invoices, line 224; the root site)
- `lib/workspace-tasks/task-write-service.ts` (INSERT INTO api.workspace_tasks, line 123)
- `packages/office-core/src/adapters/task-sql.ts` (INSERT INTO api.workspace_tasks, line 48)
- `app/api/crm/invoices/[id]/convert/route.ts` (INSERT INTO api.invoices, line 135)
- `bug-frontmatter.txt`: lines 1-25 of the bug report `project/a1-office/fixes/2026-10-03-foreign-customer-id-invoices-tasks.md`
  (frontmatter only, the `permalink` line dropped). The suite appends the `class_query` list and `root_site` that
  the report did not have.

`packages/office-core/src/adapters/direct-pg-write-adapter.ts` (a fifth INSERT site, 1758 lines) is not copied.
