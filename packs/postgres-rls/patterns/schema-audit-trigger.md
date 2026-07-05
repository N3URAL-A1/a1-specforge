id: schema-audit-trigger
class: schema_flaw
trigger_signature: "new or altered table without an audit/log trigger"
target:
  kind: cli-check
  skill: a1-new-feature
  anchor: "Gate 0.6 — DB schema checklist"
diff: |
  schema_flaw is the most frequent bug class in the corpus (8x). The dominant
  instance: a new table ships without its audit trigger, so writes are not
  recorded. Every new/altered table must carry an audit (or log) trigger before
  the wave is marked done. Run `a1-tools schema-check run --migrations <dir>
  --trigger-pattern 'audit|log'` — it fails per-table when no matching trigger
  exists. Mocked tests hide this: assert the trigger against the real schema,
  not a mock.
evidence_schema: "a1-tools schema-check run --trigger-pattern 'audit|log' output"
