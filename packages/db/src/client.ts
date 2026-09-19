import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../generated/client/client';

/**
 * Database client.
 *
 * Prisma 7 talks to PostgreSQL through a driver adapter rather than its own
 * query engine binary, so the connection pool is an ordinary `pg` pool that we
 * configure and can reason about.
 *
 * The instance is memoised on `globalThis` in development because Next.js
 * hot-reload re-evaluates modules on every edit; without this, an afternoon of
 * work opens a few hundred pools and exhausts `max_connections`.
 */

export interface DatabaseOptions {
  readonly url: string;
  readonly maxConnections?: number;
  readonly logQueries?: boolean;
}

function createClient(options: DatabaseOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.url,
    max: options.maxConnections ?? 10,
    // A genealogy query that has not answered in thirty seconds is a bug, not
    // a slow query. Failing fast surfaces it instead of stacking connections.
    statement_timeout: 30_000,
  });

  return new PrismaClient({
    adapter,
    log: options.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

const globalForPrisma = globalThis as unknown as {
  chronoligneePrisma?: PrismaClient;
};

export function getDatabase(options: DatabaseOptions): PrismaClient {
  if (globalForPrisma.chronoligneePrisma) return globalForPrisma.chronoligneePrisma;

  const client = createClient(options);
  if (process.env['NODE_ENV'] !== 'production') {
    globalForPrisma.chronoligneePrisma = client;
  }
  return client;
}

/** Fresh, unmemoised client. Used by tests and one-shot scripts. */
export function createDatabase(options: DatabaseOptions): PrismaClient {
  return createClient(options);
}

export { PrismaClient };
export type Database = PrismaClient;

/**
 * Transaction client: the subset of the API available inside `$transaction`.
 * Repositories accept this so they compose into a single atomic unit of work.
 * Prisma's own definition, so the two can never disagree about what a
 * transaction may call.
 */
export type TransactionClient = Prisma.TransactionClient;
