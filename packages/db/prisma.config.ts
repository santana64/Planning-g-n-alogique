import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// The monorepo keeps a single .env at the root so web, worker and CLI cannot
// drift onto different databases. Node 22 can load it without a dependency.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
try {
  process.loadEnvFile(rootEnv);
} catch {
  // Absent in CI, where the variables are injected directly.
}

/**
 * Prisma 7 configuration.
 *
 * The connection URL lives here rather than in the schema because Prisma 7
 * removed `url` from the datasource block: migrations read it from this file,
 * and the runtime client reaches the database through a driver adapter
 * (see src/client.ts). One consequence worth knowing — the schema file no
 * longer contains anything environment-specific, so it is safe to publish.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx src/seed/index.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ?? '',
    // Only for comparing the migrations with the schema (CI's drift check),
    // which replays every migration into this scratch database. Never the
    // main database: Prisma empties a shadow database before using it.
    ...(process.env['SHADOW_DATABASE_URL']
      ? { shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'] }
      : {}),
  },
});
