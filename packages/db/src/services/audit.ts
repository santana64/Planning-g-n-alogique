import type { Database } from '../client';

/**
 * The audit trail.
 *
 * `updatedAt` answers "when", which is the least interesting question a
 * collaborator ever asks. This answers "who changed what, from what, to what"
 * — which is what someone needs when a date they spent a weekend researching
 * has quietly become a different date.
 *
 * Append-only. A revision is never edited and never deleted, because the
 * history of what a family believed about itself is itself research material.
 */

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'RESTORE'
  | 'MERGE'
  | 'IMPORT'
  | 'ACCEPT_CLAIM'
  | 'REJECT_CLAIM'
  | 'EXPORT';

export interface AuditEntry {
  readonly treeId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: AuditAction;
  readonly actorId: string | null;
  /** Only the fields that changed. */
  readonly before?: Record<string, unknown> | undefined;
  readonly after?: Record<string, unknown> | undefined;
  /** Rendered at write time, in the actor's locale. */
  readonly summary?: string | undefined;
  /** Shared by every revision from one request or job. */
  readonly batchId?: string | undefined;
}

type AuditClient = Pick<Database, 'revision'>;

export async function recordRevision(db: AuditClient, entry: AuditEntry): Promise<void> {
  await db.revision.create({
    data: {
      treeId: entry.treeId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      ...(entry.actorId ? { actorId: entry.actorId } : {}),
      ...(entry.before ? { before: entry.before as object } : {}),
      ...(entry.after ? { after: entry.after as object } : {}),
      ...(entry.summary ? { summary: entry.summary } : {}),
      ...(entry.batchId ? { batchId: entry.batchId } : {}),
    },
  });
}

/**
 * The fields that actually changed.
 *
 * Storing whole snapshots on every edit would dwarf the data they describe: a
 * person edited fifty times would carry fifty copies of every unchanged field.
 * Recording only the difference keeps the trail readable as well as small —
 * "birth date: 1877 → 1878" is the sentence a reviewer wants, and it is hard
 * to find inside two complete rows.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  let changed = false;

  for (const [key, value] of Object.entries(after)) {
    if (value === undefined) continue;
    const previous = before[key];
    // Dates and nested objects compare by value, not by reference.
    if (JSON.stringify(previous) === JSON.stringify(value)) continue;
    changedBefore[key] = previous ?? null;
    changedAfter[key] = value;
    changed = true;
  }

  return changed ? { before: changedBefore, after: changedAfter } : null;
}
