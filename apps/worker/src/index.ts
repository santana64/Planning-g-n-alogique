import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import { assertDeployable, getServerEnv, scrubErrorReport } from '@chronolignee/config/server';
import {
  createDatabase,
  importGedcomPlan,
  purgeDeletedTree,
  treesAwaitingPurge,
} from '@chronolignee/db';
import { decodeGedcom, mapDocument, parseGedcom } from '@chronolignee/gedcom';
import { getObjectStore, treePrefixes } from '@chronolignee/storage';
import { QUEUE_NAMES, WORKER_RETENTION, assertPayload, redisConnection } from '@chronolignee/jobs';

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
 * Progress is reported from work that actually happened. The brief is blunt
 * about this and it is right: a progress bar driven by a timer teaches the
 * user that the numbers are decoration, and then the honest ones are ignored
 * too.
 */
const gedcomWorker = new Worker(
  QUEUE_NAMES.gedcomImport,
  async (job: Job) => {
    const payload = assertPayload(QUEUE_NAMES.gedcomImport, job.data);
    const log = logger.child({ jobId: job.id, treeId: payload.treeId });

    log.info('import started');
    await db.importJob.update({
      where: { id: payload.importJobId },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });

    const bytes = await objectStore.get(payload.storageKey);
    await job.updateProgress(20);

    // The analysis already refused a file it could not read; one that got
    // this far and still cannot be read fails the job rather than import
    // garbled names.
    const decoded = decodeGedcom(bytes);
    if (!decoded.ok) throw new Error('UNSUPPORTED_ENCODING');
    const document = parseGedcom(decoded.value.text);
    await job.updateProgress(45);

    const plan = mapDocument(document);
    await job.updateProgress(60);

    const result = await importGedcomPlan(db, plan, {
      treeId: payload.treeId,
      actorId: payload.actorId,
    });
    await job.updateProgress(100);

    await db.importJob.update({
      where: { id: payload.importJobId },
      data: {
        status: 'COMPLETED',
        isDryRun: false,
        completedAt: new Date(),
        processedRecords: document.records.length,
        totalRecords: document.records.length,
      },
    });

    log.info({ people: result.people, rejected: result.rejected.length }, 'import finished');
    return result;
  },
  {
    connection,
    // One import at a time. They hold a long transaction on a tree, and two
    // running together would block each other into the timeout.
    concurrency: 1,
    ...WORKER_RETENTION,
  },
);

gedcomWorker.on('failed', (job, error) => {
  // The error's class only: its message can quote a name or a date from the
  // file. The full message goes to the import job, where only the tree's
  // members read it.
  logger.error({ jobId: job?.id, error: error.name }, 'import failed');
  sentry?.captureException(error, { tags: { queue: QUEUE_NAMES.gedcomImport } });

  const importJobId = (job?.data as { importJobId?: string } | undefined)?.importJobId;
  if (!importJobId) return;

  // The import transaction rolled back, so the tree is untouched. Recording
  // why matters because "it failed" with no reason is not actionable.
  void db.importJob
    .update({
      where: { id: importJobId },
      data: { status: 'FAILED', completedAt: new Date(), error: error.message.slice(0, 2000) },
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

logger.info(
  { queues: workers.map((w) => w.name), env: env.NODE_ENV },
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
