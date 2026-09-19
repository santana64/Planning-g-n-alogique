import 'server-only';
import {
  IMPORT_JOB_OPTIONS,
  QUEUE_NAMES,
  assertPayload,
  createQueue,
  reportConnectionErrors,
  type GedcomImportPayload,
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
let importQueue: ReturnType<typeof createQueue> | null = null;

export async function enqueueGedcomImport(payload: GedcomImportPayload): Promise<void> {
  if (!importQueue) {
    importQueue = createQueue(QUEUE_NAMES.gedcomImport, env.REDIS_URL);
    reportConnectionErrors(importQueue, (error, suppressed) =>
      logger.error(
        { event: 'queue.unavailable', error: error.name, suppressed },
        'queue unavailable',
      ),
    );
  }
  // Checked here, where a malformed payload points at the code that built it.
  const data = assertPayload(QUEUE_NAMES.gedcomImport, payload);
  await importQueue.add('import', data, IMPORT_JOB_OPTIONS);
}
