import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import { assertDeployable, getServerEnv, scrubErrorReport } from '@chronolignee/config/server';
import { createDatabase, purgeDeletedTree, treesAwaitingPurge } from '@chronolignee/db';
import { getObjectStore, treePrefixes } from '@chronolignee/storage';
import {
  QUEUE_NAMES,
  WORKER_RETENTION,
  assertPayload,
  redisConnection,
  reportConnectionErrors,
} from '@chronolignee/jobs';
import { runGedcomImport } from './gedcom-import';

/**
 * The background worker.
 *
 * Long work does not belong in a request handler. A GEDCOM import of twenty
 * thousand people, a page of a scanned register going through a vision model,
 * a thumbnail of a 200 MB TIFF — each is measured in minutes, and a user
 * staring at a spinner that cannot be closed is not a design.
 *
 * Runs as its own process so it can be scaled, restarted and deployed apart
 * from the web app, and so a crash here never takes the site down with it.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // Injected directly in production.
}

const env = getServerEnv();

// The same deployment-safety checks the web server runs at start-up. A worker
// holds the same credentials and talks to the same database, so an unsafe
// configuration is no safer here for running without an HTTP port.
assertDeployable(env);

/**
 * Readable lines in development, when the pretty-printer is there at all. It
 * is a development dependency, absent from the production image: an image
 * started with the development .env must log JSON, not crash on start.
 */
function prettyTransport(): { transport?: { target: string } } {
  if (env.NODE_ENV !== 'development') return {};
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return { transport: { target: 'pino-pretty' } };
  } catch {
    return {};
  }
}

const logger = pino({
  level: env.LOG_LEVEL,
  // Never log a payload wholesale: job data carries object keys and person
  // ids, and a document's contents must never reach a log line.
  redact: ['*.password', '*.token', '*.secret', 'data.bytes'],
  ...prettyTransport(),
});

/**
 * Error reports, only when SENTRY_DSN is set, scrubbed exactly as the web
 * app's are: the error's type and stack, never its message, which can quote a
 * value from the database.
 */
const sentry = env.SENTRY_DSN ? await import('@sentry/node') : null;
sentry?.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  sendDefaultPii: false,
  skipOpenTelemetrySetup: true,
  tracesSampleRate: 0,
  beforeSend: (event) => scrubErrorReport(event),
});

const db = createDatabase({ url: env.DATABASE_URL });
const objectStore = getObjectStore({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  presignTtlSeconds: env.S3_PRESIGN_TTL_SECONDS,
});

const connection = redisConnection(env.REDIS_URL);

/**
 * GEDCOM import.
 *
 * The web app analyses a file, shows the person what it holds, and on their
 * say-so queues it here: twenty thousand people take half a minute to write,
 * which is no time to hold a request open. Progress, outcome and failure are
 * written on the import job as they happen (see gedcom-import.ts).
 */
const gedcomWorker = new Worker(
  QUEUE_NAMES.gedcomImport,
  async (job: Job) => {
    const payload = assertPayload(QUEUE_NAMES.gedcomImport, job.data);
    const log = logger.child({ jobId: job.id, treeId: payload.treeId });

    log.info('import started');
    const result = await runGedcomImport(
      { db, read: (storageKey) => objectStore.get(storageKey) },
      payload,
    );
    if (!result) {
      log.warn('import skipped: the job is no longer queued');
      return null;
    }
    log.info({ people: result.people, rejected: result.rejected.length }, 'import finished');
    // Counts only: BullMQ keeps a job's return value in Redis, and the links
    // the database refused are described with the people they concern.
    return { people: result.people, relationships: result.relationships, events: result.events };
  },
  {
    connection,
    // One import at a time. They hold a long transaction on a tree, and two
    // running together would block each other into the timeout.
    concurrency: 1,
    ...WORKER_RETENTION,
  },
);

reportConnectionErrors(gedcomWorker, (error, suppressed) =>
  logger.error({ error: error.name, suppressed }, 'queue unavailable, retrying'),
);

gedcomWorker.on('failed', (job, error) => {
  // The error's class only: its message can quote a name or a date from the
  // file. The job row already holds the full message, where only the tree's
  // members read it.
  logger.error({ jobId: job?.id, error: error.name }, 'import failed');
  sentry?.captureException(error, { tags: { queue: QUEUE_NAMES.gedcomImport } });

  // A job that failed before it could say so — the process died mid-import,
  // BullMQ gave up on a stalled job — would otherwise read "in progress"
  // forever. Only a job still marked as running is touched.
  const importJobId = (job?.data as { importJobId?: string } | undefined)?.importJobId;
  if (!importJobId) return;
  void db.importJob
    .updateMany({
      where: { id: importJobId, status: { in: ['QUEUED', 'PROCESSING'] } },
      data: { status: 'FAILED', completedAt: new Date(), error: 'INTERRUPTED' },
    })
    .catch((updateError: unknown) => {
      logger.error(
        { error: updateError instanceof Error ? updateError.name : typeof updateError },
        'could not record the failure',
      );
    });
});

const workers = [gedcomWorker];

/**
 * Finish erasing deleted trees.
 *
 * A deletion takes the tree out of use at once and purges it in the same
 * request; this catches whatever that purge could not finish — storage down,
 * a deploy mid-request. Idempotent: prefixes already emptied list nothing,
 * and a tree already purged is simply not found.
 */
const SWEEP_EVERY_MS = 15 * 60 * 1000;
let sweeping = false;
async function sweepDeletedTrees(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    for (const treeId of await treesAwaitingPurge(db)) {
      try {
        let files = 0;
        for (const prefix of treePrefixes(treeId)) files += await objectStore.deletePrefix(prefix);
        await purgeDeletedTree(db, treeId);
        logger.info({ treeId, files }, 'deleted tree purged');
      } catch (error) {
        logger.error(
          { treeId, error: error instanceof Error ? error.name : typeof error },
          'deleted tree purge failed, will retry',
        );
      }
    }
  } finally {
    sweeping = false;
  }
}
const sweeper = setInterval(() => void sweepDeletedTrees(), SWEEP_EVERY_MS);
void sweepDeletedTrees();

/**
 * Liveness, over HTTP, only when a port is configured: 200 while the queue
 * consumer runs, 503 once it has stopped. Nothing else is served.
 */
const health =
  env.WORKER_HEALTH_PORT === undefined
    ? null
    : createServer((request, response) => {
        if (request.method !== 'GET' || request.url !== '/health') {
          response.writeHead(404).end();
          return;
        }
        const running = workers.every((worker) => worker.isRunning());
        response
          .writeHead(running ? 200 : 503, {
            'content-type': 'application/json',
            'cache-control': 'no-store',
          })
          .end(JSON.stringify({ status: running ? 'ok' : 'unavailable' }));
      }).listen(env.WORKER_HEALTH_PORT);

logger.info(
  { queues: workers.map((w) => w.name), env: env.NODE_ENV, healthPort: env.WORKER_HEALTH_PORT },
  'Chronolignée worker listening',
);

/**
 * Graceful shutdown.
 *
 * `close()` waits for the job in flight to finish rather than killing it. A
 * deploy that interrupts an import mid-transaction is survivable — the
 * transaction rolls back — but the user sees an import that vanished, and
 * waiting a few seconds avoids that entirely.
 */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'shutting down, finishing the job in flight');
  clearInterval(sweeper);
  health?.close();
  await Promise.all(workers.map((worker) => worker.close()));
  await db.$disconnect();
  logger.info('stopped');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// An unhandled rejection has already escaped every catch; carrying on would
// mean running in a state nobody reasoned about.
process.on('unhandledRejection', (reason) => {
  logger.fatal(
    { error: reason instanceof Error ? reason.name : typeof reason },
    'unhandled rejection',
  );
  sentry?.captureException(reason);
  void shutdown('unhandledRejection');
});
