# Origin of the CI fixtures (spec 017, wave 7)

Byte copies unless noted. Plants in the suite are string edits of these copies.

| File | Source |
|---|---|
| specforge-test.yml | `.github/workflows/test.yml` of this repo (the "Fixtures" step holds `for r in _test-fixtures/*/run*.sh`) |
| specforge-fidelity.json | `.a1/fidelity.json` of this repo (`test_globs`, `ci_globs`) |
| office-ci.yml | `~/claude-projects/a1-office/.github/workflows/ci.yml` (unit job: `pnpm exec vitest run tests/unit ... $(grep ...)`) |
| office-vitest.config.ts | `~/claude-projects/a1-office/vitest.config.ts` (`exclude` holds `**/tests/e2e/**`, `**/*.spec.ts`) |
| office-package.json | `~/claude-projects/a1-office/package.json` (`"test": "vitest run"`) |
| smart-home-pyproject.toml | `~/claude-projects/my-smart-home/pyproject.toml` (`[tool.pytest.ini_options] testpaths = ["tests"]`) |

No local repository has a pytest workflow, a jest config or a monorepo with two runner
configs: those workflow files and configs are written inline in `run-tests.sh` (synthetic,
the real runner configs above are used wherever one exists).
