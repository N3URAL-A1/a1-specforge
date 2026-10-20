# Origin of the real files (spec 017, wave 4)

All files are byte-for-byte copies from the a1-office repository (`~/claude-projects/a1-office`),
named in the vault postmortems `project/a1-office/postmortems/2026-09-26-claudia-caps-audit-insert-500.md`
and `2026-10-03-quote-deal-id-not-persisted.md`. Extract: `git show <rev>:<path>`.

| Fixture file | a1-office revision and path |
|---|---|
| claudia-before.mail-rules-rejected-audit.test.ts | `ec7b275a^:tests/unit/mail-rules-rejected-audit.test.ts` (mocks `withTenantContext`; bug claudia-caps-audit-insert-500, fix PR #305) |
| claudia-after.http-caps-audit.test.ts | `ec7b275a:tests/integration/claudia/http-caps-audit.test.ts` (the corrected real-DB test; it still wraps `withTenantContext` with a pass-through mock) |
| quote-before.pipeline-flow-quote-billing.test.ts | `05d386c5^:tests/integration/pipeline-flow-quote-billing.test.ts` (mocks `createInvoice` through the `@/lib/crm/api` barrel; bug quote-deal-id-not-persisted, fix PR #320) |
| quote-after.quote-deal-link.test.ts | `05d386c5:tests/integration/crm/quote-deal-link.test.ts` (corrected real-DB test) |
| tsconfig.json | `05d386c5^:tsconfig.json` (`paths: {"@/*": ["./*"]}`) |
| api.ts | `05d386c5^:lib/crm/api.ts` (re-export barrel: `export * from "@/lib/crm/invoices"`) |

`lib/crm/invoices.ts` (the module PR #320 changed) is NOT copied; the suite writes a one-line stub
so the resolver has a file to find.
