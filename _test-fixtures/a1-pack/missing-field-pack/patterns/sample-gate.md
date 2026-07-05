id: sample-gate
class: schema_flaw
trigger_signature: "new table + multi-tenant stack"
target:
  kind: gate-step
  skill: a1-new-feature
  anchor: "Gate 0.6"
diff: |
  Verify the GRANT matrix covers read/write/admin roles.
evidence_schema: "grep + psql output"
