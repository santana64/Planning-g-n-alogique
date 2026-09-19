import 'server-only';
import { purgeDeletedTree } from '@chronolignee/db';
import { treePrefixes } from '@chronolignee/storage';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { objectStore } from '@/lib/storage';

/**
 * Finish erasing a tree already marked deleted: its stored files, then its
 * rows.
 *
 * Files first, so a failure leaves rows that still say what remains to be
 * removed; the worker's sweeper retries anything left marked. Never throws:
 * the person who asked has already lost access to the tree, which is the part
 * that had to happen at once.
 */
export async function purgeTreeNow(treeId: string): Promise<boolean> {
  try {
    let files = 0;
    for (const prefix of treePrefixes(treeId)) files += await objectStore.deletePrefix(prefix);
    const purged = await purgeDeletedTree(db, treeId);
    logger.info({ event: 'tree.purged', treeId, files }, 'tree purged');
    return purged;
  } catch (error) {
    logger.error(
      {
        event: 'tree.purge_failed',
        treeId,
        error: error instanceof Error ? error.name : typeof error,
      },
      'tree purge failed; the sweeper will finish it',
    );
    return false;
  }
}
