id: fk-type-match
class: schema_flaw
trigger_signature: "foreign key column referencing a PK of a different type"
target:
  kind: cli-check
  skill: a1-new-feature
  anchor: "Gate 0.6 — DB schema checklist"
diff: |
  A foreign-key column whose type differs from the referenced primary key
  (uuid vs bigint, uuid vs text) causes join failures and blocked constraint
  creation — observed repeatedly in the corpus. Every FK column type must match
  its referenced PK type. Run `a1-tools schema-check run --migrations <dir>` —
  it reports "FK type mismatch" with the offending column and referenced PK.
evidence_schema: "a1-tools schema-check run output (FK type mismatch findings)"
