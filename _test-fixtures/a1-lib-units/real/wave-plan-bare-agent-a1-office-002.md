# Wave plan (stripped copy of vault project/a1-office/plans/002-crm-pipeline-normalization-wave-plan.md, real lines: wave 1 and 2 headings, bare agent line)

## Wave 1 — Seed Default-Pipeline pro Tenant

**Goal:** Für jeden Tenant in `api.tenants` genau eine `is_default=true`-Pipeline `'Default Pipeline'` anlegen — idempotent (Guard auf `(tenant_id, name)`), tenant-scoped, RLS-konform. Erste Hälfte von Migration `048`.

### Suggested agent(s):
backend-bernd (Migration-Autor)

## Wave 2 — Seed 6 Stages pro Pipeline (Enum-gespiegelt)

**Goal:** Für jede Default-Pipeline 6 `api.pipeline_stages` anlegen, die das Enum `api.deal_stage` 1:1 spiegeln — mit `position` 0–5 und `win_probability`. Zweite Hälfte von Migration `048`, in derselben Transaktion wie Wave 1.

### Suggested agent(s):
backend-bernd (Migration-Autor)

