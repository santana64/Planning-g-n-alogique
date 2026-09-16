import { defineConfig } from 'vitest/config';

/**
 * Two projects with different contracts:
 *
 *   unit        — pure, fast, no I/O. Runs on every save and in every CI job.
 *   integration — talks to PostgreSQL, Redis and MinIO from docker-compose.
 *                 Serialised, because these tests share one database.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          // Both locations, deliberately. The convention is a test beside its
          // source, but a unit test dropped into `tests/` used to match
          // neither project and was silently never run — a whole file of
          // green-looking assertions that never executed. Widening the glob
          // removes the trap instead of relying on everyone remembering it.
          include: [
            'packages/*/src/**/*.test.ts',
            'apps/*/src/**/*.test.ts',
            'packages/*/tests/**/*.test.ts',
            'apps/*/tests/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
          environment: 'node',
          globals: false,
        },
      },
      {
        test: {
          name: 'integration',
          include: [
            'packages/*/tests/**/*.integration.test.ts',
            'apps/*/tests/**/*.integration.test.ts',
          ],
          environment: 'node',
          globals: false,
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', '**/*.d.ts'],
    },
  },
});
