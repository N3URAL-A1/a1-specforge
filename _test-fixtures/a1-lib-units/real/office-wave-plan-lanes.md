---
type: wave-plan
id: 067-claudia-invoice-intake
spec_path: project/a1-office/spec/067-claudia-invoice-intake.md
spec_id: 067-claudia-invoice-intake
project: a1-office
created: 2026-10-09
waves: 9
lanes:
  - id: review
    waves: [1, 7, 8]
    owns:
      - "automation/db/migrations/149_spec067_*"
      - "automation/db/migrations/MIGRATIONS-RESERVED.md"
      - ".a1/reservations.json"
      - "automation/db/scripts/2026-10-09_spec067_mail_intake_settings.sql"
      - "tests/ci/schema-seed.sql"
      - "tests/ci/grants-seed.sql"
      - "lib/db/purge-order.ts"
      - "lib/expenses/types.ts"
      - "lib/expenses/mail-drafts/**"
      - "app/api/expenses/save/**"
      - "app/api/expenses/mail-drafts/**"
      - "app/[locale]/dashboard/ausgaben/page.tsx"
      - "app/[locale]/dashboard/ausgaben/mail-drafts/**"
      - "components/dashboard/ausgaben/AusgabenPageClient.tsx"
      - "components/dashboard/ausgaben/mail-drafts/**"
      - "components/expenses/ExpenseReviewScreen.tsx"
      - "tests/integration/expense-mail-intake/schema/**"
      - "tests/integration/expense-mail-drafts/**"
      - "tests/unit/expenses/mail-drafts/**"
      - "tests/components/mail-drafts/**"
    agent: a1-erik-executor
  - id: intake
    waves: [2, 3]
---
