import { fileURLToPath } from 'node:url';
import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import { getServerEnv } from '@chronolignee/config/server';
import { createDatabase, importGedcomPlan } from '@chronolignee/db';
import { mapDocument, parseGedcom } from '@chronolignee/gedcom';
import { getObjectStore } from '@chronolignee/storage';
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

const logger = pino({
  level: env.LOG_LEVEL,
  // Never log a payload wholesale: job data carries object keys and person
  // ids, and a document's contents must never reach a log line.
  redact: ['*.password', '*.token', '*.secret', 'data.bytes'],
  ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
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

    const document = parseGedcom(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
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
  logger.error({ jobId: job?.id, err: error.message }, 'import failed');

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
      logger.error({ err: updateError }, 'could not record the failure');
    });
});

const workers = [gedcomWorker];

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
  logger.fatal({ err: reason }, 'unhandled rejection');
  void shutdown('unhandledRejection');
});
