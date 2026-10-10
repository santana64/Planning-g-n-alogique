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
const WORKER_HEALTH_PORT = Number(process.env['E2E_WORKER_PORT'] ?? 3101);

export default defineConfig({
  testDir: fileURLToPath(new URL('./e2e', import.meta.url)),

  // Signs up the one account the editing suite shares, before any worker
  // starts. Done per-worker it is a file race; done per-test it exhausts the
  // sign-up rate limit.
  globalSetup: fileURLToPath(new URL('./e2e/global-setup.ts', import.meta.url)),
  outputDir: fileURLToPath(new URL('./test-results', import.meta.url)),

  // Retries in CI only. A test that needs a retry locally is a test that is
  // telling you something, and hiding it on a developer machine is how a
  // flake becomes permanent.
  retries: process.env['CI'] ? 2 : 0,

  /**
   * One worker locally, two in CI.
   *
   * Not a concession on what the tests assert — worker count changes nothing
   * about that. It is about what they are pointed at: a single `next start`
   * process serving one Postgres. Left at the CPU count, a developer machine
   * runs eight browsers writing concurrently through that one process, and
   * runs that normally finish in eighteen seconds take almost two minutes,
   * with requests crossing the thirty-second mark. What fails then is not the
   * product: read-only anonymous requests time out alongside the writes, the
   * database shows no lock waits and no saturation, and the browser console
   * is clean. It is the harness outrunning the server it started.
   *
   * CI keeps two, on a dedicated runner, with retries.
   */
  workers: process.env['CI'] ? 2 : 1,
  forbidOnly: Boolean(process.env['CI']),

  // On CI, `github` too: each failure becomes an annotation on the run,
  // readable without downloading the report.
  reporter: process.env['CI']
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']]
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

  webServer: [
    {
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
        // Experimental surfaces are off by default and on here: a flag that is
        // never switched on in a test is a feature nobody has run.
        FEATURE_STORY_DIRECTOR: 'true',
      },
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // The worker writes imports. Without it an import stays queued, which
      // is what production would do too — so it runs, as it would there.
      command: 'pnpm --filter @chronolignee/worker exec tsx src/index.ts',
      url: `http://localhost:${WORKER_HEALTH_PORT}/health`,
      env: { WORKER_HEALTH_PORT: String(WORKER_HEALTH_PORT) },
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
