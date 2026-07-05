id: rls-grant-matrix
class: rls_grant_matrix
trigger_signature: "new table + multi-tenant Postgres/Supabase stack"
target:
  kind: cli-check
  skill: a1-new-feature
  anchor: "Gate 0.6 — DB schema checklist"
diff: |
  For every new table on a multi-tenant stack: RLS must be ENABLED (prefer
  FORCE), and the GRANT matrix must cover all three roles (read / write / admin).
  A read path that bypasses the tenant-context wrapper silently returns other
  tenants' rows. Run `a1-tools schema-check run --migrations <dir>` — it flags
  tables missing ENABLE ROW LEVEL SECURITY and warns when FORCE is absent.
  Verify the GRANT matrix against `psql \dp <table>` before the wave is done.
evidence_schema: "a1-tools schema-check run output + psql \\dp <table>"
