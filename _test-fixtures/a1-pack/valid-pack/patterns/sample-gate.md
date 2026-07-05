id: sample-gate
class: schema_flaw
trigger_signature: "new table + multi-tenant stack"
target:
  kind: gate-step
  skill: a1-new-feature
  anchor: "Gate 0.6"
diff: |
  For every new table: verify the GRANT matrix covers read/write/admin roles
  and that an audit trigger exists before the wave is marked done.
evidence_schema: "grep + psql \\dp output"
