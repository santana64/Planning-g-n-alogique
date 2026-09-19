import { importGedcomPlan, type Database, type ImportResult } from '@chronolignee/db';
import { decodeGedcom, mapDocument, parseGedcom } from '@chronolignee/gedcom';
import type { GedcomImportPayload } from '@chronolignee/jobs';

/**
 * Writing an analysed GEDCOM file into its tree.
 *
 * The request that asked for it has already returned: it checked the rights,
 * moved the import job from "analysed" to "queued" and put this on the queue.
 * Everything the person watching needs from here on is on the job row —
 * where it is, how far it has got, what it wrote or why it stopped — and it
 * is written there as the work happens, never interpolated toward 100 %.
 *
 * The file is read again from storage and decoded by the same rules as the
 * analysis, so what is written is exactly what was reviewed.
 */

export interface GedcomImportDependencies {
  readonly db: Database;
  readonly read: (storageKey: string) => Promise<Uint8Array>;
  /** Least time between two progress writes. The last one is always written. */
  readonly progressEveryMs?: number;
}

/** What the job row keeps of a finished import. Counts, and the links refused. */
export interface StoredImportResult {
  readonly people: number;
  readonly relationships: number;
  readonly events: number;
  readonly places: number;
  readonly sources: number;
  readonly rejected: ReadonlyArray<{ readonly detail: string; readonly reason: string }>;
}

/** An import this worker declines to write, by code rather than by message. */
export class ImportRefused extends Error {
  constructor(readonly code: 'UNSUPPORTED_ENCODING') {
    super(code);
    this.name = 'ImportRefused';
  }
}

const DEFAULT_PROGRESS_EVERY_MS = 500;
const MAX_ERROR_LENGTH = 2000;

/**
 * Returns null when there was nothing to do: the job is not queued any more.
 * That is how a job that reached the queue late — after the request gave up
 * on it and put the import back to "analysed" — or a second copy of the same
 * job writes nothing: only one worker run can move a job from queued to
 * running, and only a queued job is written.
 */
export async function runGedcomImport(
  deps: GedcomImportDependencies,
  payload: GedcomImportPayload,
): Promise<ImportResult | null> {
  const { db } = deps;
  const where = { id: payload.importJobId };
  const claimed = await db.importJob.updateMany({
    where: { ...where, treeId: payload.treeId, status: 'QUEUED', isDryRun: true },
    data: { status: 'PROCESSING', startedAt: new Date(), processedRecords: 0, totalRecords: 0 },
  });
  if (claimed.count === 0) return null;

  try {
    const decoded = decodeGedcom(await deps.read(payload.storageKey));
    // The analysis refused a file it could not read; one that got this far
    // and still cannot be read stops here rather than write garbled names.
    if (!decoded.ok) throw new ImportRefused('UNSUPPORTED_ENCODING');
    const plan = mapDocument(parseGedcom(decoded.value.text));

    const every = deps.progressEveryMs ?? DEFAULT_PROGRESS_EVERY_MS;
    let lastWrite = 0;
    const result = await importGedcomPlan(db, plan, {
      treeId: payload.treeId,
      actorId: payload.actorId,
      // The revision carries the job's id, so the history entry and the job
      // that produced it can be matched.
      batchId: payload.importJobId,
      onProgress: async (written, total) => {
        const now = Date.now();
        if (written < total && now - lastWrite < every) return;
        lastWrite = now;
        await db.importJob.update({
          where,
          data: { processedRecords: written, totalRecords: total },
        });
      },
      // "Done" is written with the data, in the same transaction: there is no
      // moment at which the tree holds the import and the job says otherwise.
      finalise: async (tx, written) => {
        const stored: StoredImportResult = {
          people: written.people,
          relationships: written.relationships,
          events: written.events,
          places: written.places,
          sources: written.sources,
          rejected: written.rejected,
        };
        await tx.importJob.update({
          where,
          data: {
            status: 'COMPLETED',
            isDryRun: false,
            completedAt: new Date(),
            result: stored as unknown as object,
          },
        });
      },
    });
    return result;
  } catch (error) {
    // The write is one transaction, so the tree is untouched. The job says
    // why, where only the tree's members read it; logs get the class alone.
    await db.importJob.update({
      where,
      data: { status: 'FAILED', completedAt: new Date(), error: describe(error) },
    });
    throw error;
  }
}

function describe(error: unknown): string {
  if (error instanceof ImportRefused) return error.code;
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, MAX_ERROR_LENGTH);
  return 'Unknown error';
}
