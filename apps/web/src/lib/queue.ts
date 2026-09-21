import 'server-only';
import {
  DEFAULT_JOB_OPTIONS,
  IMPORT_JOB_OPTIONS,
  QUEUE_NAMES,
  assertPayload,
  createQueue,
  duplicateScanJobId,
  reportConnectionErrors,
  type GedcomImportPayload,
  type QueueName,
} from '@chronolignee/jobs';
import { env } from './env';
import { logger } from './logger';

/**
 * The web app's side of the work queue: it only ever adds jobs.
 *
 * Created on first use rather than at import, so a page that never queues
 * anything never opens a Redis connection — and a build, which imports every
 * module, never tries to.
 */
const queues = new Map<QueueName, ReturnType<typeof createQueue>>();

function queueFor(name: QueueName): ReturnType<typeof createQueue> {
  const existing = queues.get(name);
  if (existing) return existing;
  const queue = createQueue(name, env.REDIS_URL);
  reportConnectionErrors(queue, (error, suppressed) =>
    logger.error(
      { event: 'queue.unavailable', queue: name, error: error.name, suppressed },
      'queue unavailable',
    ),
  );
  queues.set(name, queue);
  return queue;
}

export async function enqueueGedcomImport(payload: GedcomImportPayload): Promise<void> {
  // Checked here, where a malformed payload points at the code that built it.
  const data = assertPayload(QUEUE_NAMES.gedcomImport, payload);
  await queueFor(QUEUE_NAMES.gedcomImport).add('import', data, IMPORT_JOB_OPTIONS);
}

export type ScanState = 'idle' | 'queued' | 'running' | 'failed';

/**
 * Ask for a duplicate scan.
 *
 * Returns false when one is already queued or running — a second click while
 * the first is working is not a second scan. A finished job is cleared first,
 * so asking again a week later starts a new one.
 */
export async function enqueueDuplicateScan(
  treeId: string,
  scorerVersion: string,
): Promise<boolean> {
  const queue = queueFor(QUEUE_NAMES.duplicateScan);
  // One scan per tree at a time: the job carries the tree's id as its own.
  const jobId = duplicateScanJobId(treeId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'waiting' || state === 'active' || state === 'delayed') return false;
    await existing.remove();
  }
  const data = assertPayload(QUEUE_NAMES.duplicateScan, { treeId, scorerVersion });
  await queue.add('scan', data, { ...DEFAULT_JOB_OPTIONS, attempts: 1, jobId });
  return true;
}

/** Where a tree's scan stands, read from the queue itself. */
export async function duplicateScanState(treeId: string): Promise<ScanState> {
  const job = await queueFor(QUEUE_NAMES.duplicateScan).getJob(duplicateScanJobId(treeId));
  if (!job) return 'idle';
  const state = await job.getState();
  if (state === 'waiting' || state === 'delayed') return 'queued';
  if (state === 'active') return 'running';
  if (state === 'failed') return 'failed';
  return 'idle';
}
