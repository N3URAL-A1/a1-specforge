# Changelog Archive

Rotated entries beyond the 100-entry ROADMAP.md Changelog window (append-only, oldest first).

- **2026-07-10** — added 002-product-docs-layer (in-flight, next) — combined feature from brainstorm: docs/product layer + adopt mode + HTML import.
- **2026-07-10** — Migrated from `docs/roadmap.md` v3.0 (markdown) to `docs/product/ROADMAP.md` schema v1 — new machine-readable roadmap contract; source file left untouched.
- **2026-07-10** — Added **001-roadmap-gate-parallel-features** (shipped) — first feature under the schema-v1 feature index; roadmap gate + parallel feature lifecycle merged (56e0fa4/e55addf).
- **2026-09-12** — feature '007-retro-gate-id-validator' added — new feature via `product add-feature`
- **2026-09-12** — feature.md created for '007-retro-gate-id-validator' — formal spec/plan attached via `product feature-init`
- **2026-09-12** — 007-retro-gate-id-validator -> complete — stage transition via `product stage`
- **2026-09-12** — 007-retro-gate-id-validator -> verify — stage transition via `product stage`
- **2026-09-12** — 007-retro-gate-id-validator -> merge — stage transition via `product stage`
- **2026-09-12** — 007-retro-gate-id-validator -> origin-cleanup — stage transition via `product stage`
- **2026-09-12** — 007-retro-gate-id-validator -> done — stage transition via `product stage`
- **2026-09-13** — feature '008-false-green-test-guards' added — new feature via `product add-feature`
- **2026-09-13** — feature.md created for '008-false-green-test-guards' — formal spec/plan attached via `product feature-init`
- **2026-09-13** — feature '005-vault-first-artifacts' added — new feature via `product add-feature`
- **2026-09-13** — feature '006-specforge-kritis-profile' added — new feature via `product add-feature`
- **2026-09-13** — feature.md created for '005-vault-first-artifacts' — formal spec/plan attached via `product feature-init`
- **2026-09-13** — feature.md created for '006-specforge-kritis-profile' — formal spec/plan attached via `product feature-init`
- **2026-09-13** — feature '004-xs-quick-lane' added — new feature via `product add-feature`
- **2026-09-13** — feature.md created for '004-xs-quick-lane' — formal spec/plan attached via `product feature-init`
- **2026-09-13** — feature '003-product-schema-v11-vision-audits' added — new feature via `product add-feature`
- **2026-09-13** — feature.md created for '003-product-schema-v11-vision-audits' — formal spec/plan attached via `product feature-init`
- **2026-09-13** — 008-false-green-test-guards -> done — stage transition via `product stage`
- **2026-09-13** — 002-product-docs-layer -> done — stage transition via `product stage`
- **2026-09-24** — feature '009-cross-provider-review-gate' added — Codex (claudex-loop) becomes a registered a1 gate at PLAN.md and per wave with findings adapter, retro attribution, hardened CODEX_HOME and git tripwire — per Option D decision 2026-09-03
- **2026-09-24** — feature '010-vault-cockpit-contract' added — One-way mirror of docs/product and phase state into project/<slug>/, CLI-stamped type:, vault lint, hub spec links, host-aware locks; supersedes 005
- **2026-09-24** — feature '011-intent-queue-consumer' added — Signed, default-deny intent notes in inbox/intents/ consumed by a1-owned CLI on the Mac; closed action enum, single-flight, ledger outside the vault
- **2026-09-25** — spec 009 waves 1–6 merged (#10, 4ee46d9): xprov modules, Phase 4b / step 2b-x wiring, gates at warning — Codex becomes a registered read-only reviewer; Wave 7 (live smoke + blocking flip) awaits Robert's xprov permit
