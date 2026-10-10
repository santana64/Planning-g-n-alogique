import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import pg from 'pg';

/**
 * Applies the schema migrations without the Prisma CLI.
 *
 * The desktop edition does not ship Prisma's command-line tools and their
 * engines for a job this small: each migration is a SQL file, applied once,
 * in order. Applied migrations are recorded in `_prisma_migrations` exactly as
 * `prisma migrate deploy` records them — same columns, same checksum — so a
 * database started by the desktop edition and one migrated by Prisma are the
 * same database, and either tool can take over from the other.
 *
 * Never a `db push`, never an edited migration: a file whose checksum no
 * longer matches what was applied stops the start-up instead of being
 * re-run.
 */

const require = createRequire(import.meta.url);

function migrationsDirectory(): string {
  const entry = require.resolve('@chronolignee/db');
  return join(dirname(entry), '..', 'prisma', 'migrations');
}

export async function migrate(databaseUrl: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);
    const { rows } = await client.query<{ migration_name: string; checksum: string }>(
      `SELECT migration_name, checksum FROM "_prisma_migrations"
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    const applied = new Map(rows.map((row) => [row.migration_name, row.checksum]));

    const directory = migrationsDirectory();
    const names = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    const done: string[] = [];
    for (const name of names) {
      const sql = await readFile(join(directory, name, 'migration.sql'), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = applied.get(name);
      if (previous) {
        if (previous !== checksum) {
          throw new Error(`migration ${name} was changed after it was applied`);
        }
        continue;
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at)
         VALUES ($1, $2, $3, now())`,
        [id, checksum, name],
      );
      await client.query(sql);
      await client.query(
        `UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1`,
        [id],
      );
      done.push(name);
    }
    return done;
  } finally {
    await client.end();
  }
}

// Run as a script: `tsx src/desktop/migrate.ts`, with DATABASE_URL set.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop() ?? '')) {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  const done = await migrate(url);
  process.stdout.write(`${done.length} migration(s) applied\n`);
}
