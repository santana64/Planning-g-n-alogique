import 'server-only';
import { getDatabase } from '@chronolignee/db';
import { env } from './env';

/**
 * The application's database handle.
 *
 * Memoised inside @chronolignee/db so Next's hot reload cannot open a new
 * connection pool on every edit.
 */
export const db = getDatabase({
  url: env.DATABASE_URL,
  logQueries: env.NODE_ENV === 'development' && env.LOG_LEVEL === 'trace',
});
