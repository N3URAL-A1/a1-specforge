import { defineConfig, devices } from '@playwright/test'
import { BYPASS_STATE_PATH } from './tests/e2e/bypass-state'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

export default defineConfig({
  testDir: 'tests/e2e',
  // Optional: only used against protected Vercel previews (see global-setup.ts).
  globalSetup: bypass ? './tests/e2e/global-setup.ts' : undefined,
  use: {
    baseURL,
    storageState: bypass ? BYPASS_STATE_PATH : undefined,
  },
  projects: [
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 800 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        // CI already ran `npm run build` in a previous step; locally build first.
        command: process.env.CI ? 'npm run start' : 'npm run build && npm run start',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
})
