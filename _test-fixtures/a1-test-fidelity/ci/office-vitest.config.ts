import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // Integration-Suite lokal serialisieren — verhindert Parallel-Interferenz
    // zwischen DB-Tests (geteilter Fixture-/Tenant-State auf der Preprod-DB).
    // Bewusstes Nicht-Ziel: CI führt die Integration-Suite nicht aus (SC-1).
    pool: "forks",
    // Vitest 4: `poolOptions.forks.singleFork` wurde entfernt. Der type-sichere
    // Ersatz ist top-level `fileParallelism: false` — Test-Dateien laufen
    // sequenziell in EINEM Worker (kein Parallel-Interferenz zwischen DB-Suiten).
    // Bewusstes Nicht-Ziel: CI führt die Integration-Suite nicht aus (SC-1).
    fileParallelism: false,
    // E2E-Tests (Playwright .spec.ts) von Vitest ausschließen.
    // tests/e2e-agent/ (048-agent-e2e-pipeline, ADR D1) läuft ausschließlich
    // über `npm run test:e2e-agent` (vitest.config.e2e-agent.ts) — dieser
    // Lauf kostet echtes Geld (LLM-Calls gegen Prod) und darf NIE
    // versehentlich lokal oder in unit-tests/integration-core mitlaufen.
    exclude: [
      "**/node_modules/**",
      "**/tests/e2e/**",
      "**/tests/e2e-agent/**",
      "**/*.spec.ts",
      "**/.claude/**",
    ],
  },
  resolve: {
    alias: {
      // office-core auf die TS-Quelle statt dist: macht Route-Files, die das
      // Paket importieren, in JEDEM Test-Job auflösbar — auch im ci.yml-Job
      // `integration-core` (pnpm install, KEIN Paket-Build, also kein dist/;
      // seit PR #315 der einzige Integrations-Job).
      // 058-workflow-core (F-9): Tiefenimporte aus dem gebauten Paket
      // (`@/packages/office-core/dist/...`, u. a. lib/crm/stage-kind.ts und
      // lib/crm/stage-flow.ts, die client-sicher bleiben muessen) auf die
      // TS-Quelle umbiegen; ohne diese Zeile scheitert dort jede Route, die so
      // importiert, schon beim Laden. MUSS vor "@" stehen.
      // ⚠️ Gilt NUR fuer `@/packages/office-core/dist`. Relative Importe wie
      // `../dist/…` (packages/office-core/test/*) lesen das echte dist — nach
      // dem Loeschen eines Moduls `rm -rf packages/*/dist` und neu bauen, sonst
      // misst man gegen veraltete Ausgaben (058, CI-Lauf 36980777367).
      "@/packages/office-core/dist": path.resolve(__dirname, "packages/office-core/src"),
      "@n3ural/office-core": path.resolve(
        __dirname,
        "packages/office-core/src/index.ts"
      ),
      "@": path.resolve(__dirname, "."),
    },
  },
});
