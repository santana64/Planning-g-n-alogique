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
          include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
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
