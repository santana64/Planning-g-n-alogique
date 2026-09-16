import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// The monorepo keeps one .env at the root; Playwright starts the app itself
// and needs the same variables the app would read.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

/**
 * The same port the app's APP_URL declares.
 *
 * Better Auth checks the request origin against the trusted list, and running
 * the tests on a different port makes every sign-in fail with "invalid
 * origin" — the check doing exactly its job. Overriding APP_URL for the test
 * server instead keeps that protection exercised rather than disabled.
 */
const PORT = Number(process.env['E2E_PORT'] ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: fileURLToPath(new URL('./e2e', import.meta.url)),
  outputDir: fileURLToPath(new URL('./test-results', import.meta.url)),

  // Retries in CI only. A test that needs a retry locally is a test that is
  // telling you something, and hiding it on a developer machine is how a
  // flake becomes permanent.
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 2 : undefined,
  forbidOnly: Boolean(process.env['CI']),

  reporter: process.env['CI']
    ? [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']]
    : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // French first, matching the product's default locale, so any date or
    // number formatting bug shows up in the locale most users will see.
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // The responsive suite asserts phone behaviour; running it here would
      // check a mobile promise at desktop width.
      testIgnore: /responsive\.spec\.ts/,
    },
    {
      // The Gantt is a desktop instrument and a phone gets a different
      // treatment, so the mobile path is exercised rather than assumed.
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /responsive\.spec\.ts/,
    },
  ],

  webServer: {
    // Against the production build, not the dev server: the things E2E is
    // meant to catch — a broken static generation, a missing environment
    // variable at build time, a client bundle that fails to hydrate — only
    // happen in the built app.
    command: `pnpm --filter @chronolignee/web exec next start --port ${PORT}`,
    url: BASE_URL,
    env: {
      APP_URL: BASE_URL,
      BETTER_AUTH_URL: BASE_URL,
      TRUSTED_ORIGINS: BASE_URL,
    },
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
