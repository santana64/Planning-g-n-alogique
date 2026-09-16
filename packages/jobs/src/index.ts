import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { z } from 'zod';

/**
 * The queue contract.
 *
 * Shared by the web app, which enqueues, and the worker, which consumes. That
 * is the architectural reason this is its own package: a job payload written
 * by one process and read by another is exactly the kind of interface that
 * drifts when each side keeps its own copy of the shape.
 *
 * Every payload is validated on the way out and on the way in. A job sits in
 * Redis across deploys, so the process that reads it may be running different
 * code from the one that wrote it — a queue is a version boundary whether or
 * not anyone planned for it to be.
 */

export const QUEUE_NAMES = {
  gedcomImport: 'gedcom-import',
  documentAnalysis: 'document-analysis',
  mediaDerivatives: 'media-derivatives',
  duplicateScan: 'duplicate-scan',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// --- Payloads ---------------------------------------------------------------

export const gedcomImportPayload = z.object({
  treeId: z.uuid(),
  importJobId: z.uuid(),
  storageKey: z.string().min(1),
  actorId: z.uuid().nullable(),
});
export type GedcomImportPayload = z.infer<typeof gedcomImportPayload>;

export const documentAnalysisPayload = z.object({
  treeId: z.uuid(),
  documentId: z.uuid(),
  pageNumbers: z.array(z.number().int().positive()).optional(),
  promptVersion: z.string().min(1),
});
export type DocumentAnalysisPayload = z.infer<typeof documentAnalysisPayload>;

export const mediaDerivativesPayload = z.object({
  treeId: z.uuid(),
  mediaId: z.uuid(),
  storageKey: z.string().min(1),
});
export type MediaDerivativesPayload = z.infer<typeof mediaDerivativesPayload>;

export const duplicateScanPayload = z.object({
  treeId: z.uuid(),
  scorerVersion: z.string().min(1),
});
export type DuplicateScanPayload = z.infer<typeof duplicateScanPayload>;

export const PAYLOAD_SCHEMAS = {
  [QUEUE_NAMES.gedcomImport]: gedcomImportPayload,
  [QUEUE_NAMES.documentAnalysis]: documentAnalysisPayload,
  [QUEUE_NAMES.mediaDerivatives]: mediaDerivativesPayload,
  [QUEUE_NAMES.duplicateScan]: duplicateScanPayload,
} as const;

// --- Retry policy -----------------------------------------------------------

/**
 * Defaults for every job.
 *
 * Bounded attempts, always. An unbounded retry on a job that fails
 * deterministically — a corrupt file, a row the schema refuses — is an
 * infinite loop that burns the queue and hides the real error, and the brief
 * names it specifically.
 *
 * Completed jobs are kept for a day and failed ones for a week: a user asking
 * why yesterday's import looks wrong needs the record to still exist.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: { age: 604_800 },
};

/** An import is slow and must not be retried automatically. */
export const IMPORT_JOB_OPTIONS: JobsOptions = {
  ...DEFAULT_JOB_OPTIONS,
  // One attempt only. The write is transactional, so a failure leaves the tree
  // untouched — but a retry of a job that *partly* succeeded in some future
  // non-transactional path would duplicate a family. The human retries.
  attempts: 1,
};

/**
 * Retention, for the Worker constructor.
 *
 * Deliberately separate from DEFAULT_JOB_OPTIONS: those are the options for
 * *adding* a job and these are the options for *running* one. They overlap by
 * name and not by type, and spreading one into the other compiles as a wider
 * union while silently meaning something else.
 */
export const WORKER_RETENTION = {
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: { age: 604_800 },
} as const;

export function redisConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    ...(parsed.password ? { password: parsed.password } : {}),
    // BullMQ requires this; without it a blocking command can be retried
    // forever against a Redis that has gone away.
    maxRetriesPerRequest: null,
  };
}

export function createQueue(name: QueueName, redisUrl: string): Queue {
  return new Queue(name, {
    connection: redisConnection(redisUrl),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

/**
 * Validate before enqueueing.
 *
 * Catching a malformed payload here means the error surfaces in the request
 * that caused it, with a stack that points at the caller — rather than in a
 * worker log at three in the morning, detached from anything that explains it.
 */
export function assertPayload<T extends QueueName>(
  name: T,
  payload: unknown,
): z.infer<(typeof PAYLOAD_SCHEMAS)[T]> {
  return PAYLOAD_SCHEMAS[name].parse(payload) as z.infer<(typeof PAYLOAD_SCHEMAS)[T]>;
}
