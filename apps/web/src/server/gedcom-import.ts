import 'server-only';
import {
  decodeGedcom,
  mapDocument,
  parseGedcom,
  type GedcomEncoding,
  type ImportPlan,
} from '@chronolignee/gedcom';
import { buildObjectKey, checksum, safeDownloadName, validateGedcom } from '@chronolignee/storage';
import { db } from '@/lib/db';
import { isUuid } from '@/lib/ids';
import { env } from '@/lib/env';
import { enqueueGedcomImport } from '@/lib/queue';
import { objectStore } from '@/lib/storage';
import { can } from '@chronolignee/domain';
import { resolveTreeAccess } from './access';

/**
 * GEDCOM import, in two deliberate halves.
 *
 * `analyseUpload` reads the file and writes nothing to the tree. `commitImport`
 * queues the write for the worker, and only once a human has seen what the
 * first half found; `importProgress` reports on it while it runs.
 *
 * The separation is the point. An import is the single most destructive thing
 * a genealogy application can do — it can silently add eighteen thousand
 * people to somebody's life's work, and the damage is discovered months
 * later. So the counts, the warnings and the unreadable dates are all on
 * screen before anything is written.
 *
 * The original file is kept either way. When someone asks in two years why a
 * date looks wrong, the answer has to be checkable against what was actually
 * imported, not against what we think we imported.
 */

export type ImportAnalysisError =
  'NOT_FOUND' | 'FORBIDDEN' | 'TOO_LARGE' | 'NOT_GEDCOM' | 'EMPTY' | 'UNSUPPORTED_ENCODING';

export interface ImportAnalysis {
  readonly jobId: string;
  readonly filename: string;
  readonly byteSize: number;
  readonly detectedVersion: string | null;
  readonly generator: string | null;
  /** How the bytes were read, what the header claimed, and whether it was a guess. */
  readonly encoding: {
    readonly used: GedcomEncoding;
    readonly declared: string | null;
    readonly guessed: boolean;
  };
  /**
   * A few names as they will be written, accented ones first: the quickest
   * way for a person to see that the file was read in the right encoding.
   */
  readonly sampleNames: readonly string[];
  readonly counts: ImportPlan['counts'];
  readonly warnings: ImportPlan['warnings'];
  readonly unknownTags: readonly string[];
  /** Malformed lines the lexer recovered from, with line numbers. */
  readonly fileIssues: ReadonlyArray<{ code: string; lineNumber: number; text: string }>;
}

export type AnalysisResult =
  | { readonly ok: true; readonly analysis: ImportAnalysis }
  | { readonly ok: false; readonly error: ImportAnalysisError };

/** Warnings shown in the review. Beyond this the list stops being readable. */
const MAX_REVIEWED_WARNINGS = 200;

const SAMPLE_NAMES = 5;

function sampleNames(plan: ImportPlan): string[] {
  const names = plan.people
    .map((person) => person.names[0])
    .map((name) => [name?.given, name?.surname].filter(Boolean).join(' '))
    .filter((name) => name.length > 0);
  const accented = names.filter((name) => /[^\u0020-\u007e]/.test(name));
  return [...new Set([...accented, ...names])].slice(0, SAMPLE_NAMES);
}

export async function analyseUpload(
  treeSlug: string,
  file: { name: string; bytes: Uint8Array },
  actorId: string | null,
): Promise<AnalysisResult> {
  const access = await resolveTreeAccess(treeSlug);
  if (!access) return { ok: false, error: 'NOT_FOUND' };
  if (!can(access.role, 'import')) return { ok: false, error: 'FORBIDDEN' };

  const validation = validateGedcom(file.bytes, env.MAX_UPLOAD_BYTES);
  if (!validation.ok) {
    return {
      ok: false,
      error:
        validation.reason === 'TOO_LARGE'
          ? 'TOO_LARGE'
          : validation.reason === 'EMPTY'
            ? 'EMPTY'
            : 'NOT_GEDCOM',
    };
  }

  // The original is stored before it is parsed. If the parse crashes on
  // something we have never seen, the file is still there to look at.
  const storageKey = buildObjectKey(access.treeId, 'import', 'ged');
  await objectStore.put(storageKey, file.bytes, {
    contentType: 'text/vnd.familysearch.gedcom',
    downloadName: safeDownloadName(file.name, 'import.ged'),
    checksum: checksum(file.bytes),
  });

  const decoded = decodeGedcom(file.bytes);
  if (!decoded.ok) return { ok: false, error: 'UNSUPPORTED_ENCODING' };
  const document = parseGedcom(decoded.value.text);
  const plan = mapDocument(document);

  const job = await db.importJob.create({
    data: {
      treeId: access.treeId,
      kind: 'GEDCOM',
      // Analysed, not committed. The status says so until someone says yes.
      status: 'COMPLETED',
      isDryRun: true,
      originalFilename: file.name.slice(0, 255),
      byteSize: file.bytes.byteLength,
      storageKey,
      detectedEncoding: decoded.value.encoding,
      detectedVersion: document.version,
      peopleCount: plan.counts.people,
      familyCount: plan.counts.families,
      eventCount: plan.counts.events,
      sourceCount: plan.counts.sources,
      mediaCount: plan.counts.media,
      warningCount: plan.warnings.length,
      totalRecords: document.records.length,
      processedRecords: document.records.length,
      warnings: plan.warnings.slice(0, MAX_REVIEWED_WARNINGS) as unknown as object,
      unknownTags: plan.unknownTags as unknown as object,
      completedAt: new Date(),
      ...(actorId ? { createdById: actorId } : {}),
    },
  });

  return {
    ok: true,
    analysis: {
      jobId: job.id,
      filename: file.name,
      byteSize: file.bytes.byteLength,
      detectedVersion: document.version,
      generator: document.generator,
      encoding: {
        used: decoded.value.encoding,
        declared: decoded.value.declared,
        guessed: decoded.value.guessed,
      },
      sampleNames: sampleNames(plan),
      counts: plan.counts,
      warnings: plan.warnings.slice(0, MAX_REVIEWED_WARNINGS),
      unknownTags: plan.unknownTags,
      fileIssues: [
        ...document.lexIssues.map((issue) => ({
          code: issue.code,
          lineNumber: issue.lineNumber,
          text: issue.text,
        })),
        ...document.parseIssues.map((issue) => ({
          code: issue.code,
          lineNumber: issue.lineNumber,
          text: issue.text,
        })),
      ].slice(0, MAX_REVIEWED_WARNINGS),
    },
  };
}

export type CommitError =
  'NOT_FOUND' | 'FORBIDDEN' | 'ALREADY_COMMITTED' | 'IN_PROGRESS' | 'QUEUE_UNAVAILABLE';

export type CommitResult =
  { readonly ok: true } | { readonly ok: false; readonly error: CommitError };

/** How long the queue gets to take the job before the request gives up. */
const ENQUEUE_TIMEOUT_MS = 5_000;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Ask for a previously analysed file to be written into the tree.
 *
 * The write itself happens in the worker: twenty thousand people take half a
 * minute, which is no time to hold a request — or a proxy — open. This
 * checks the right to import, moves the job from "analysed" to "queued" in a
 * single statement, so two clicks or two tabs queue it once, and puts it on
 * the queue. The worker re-reads the stored file rather than receiving a plan
 * from here: a plan for twenty thousand people is megabytes, and one that has
 * travelled through a browser is not one to trust for a write.
 */
export async function commitImport(
  treeSlug: string,
  jobId: string,
  actorId: string | null,
): Promise<CommitResult> {
  const access = await resolveTreeAccess(treeSlug);
  if (!access) return { ok: false, error: 'NOT_FOUND' };
  if (!can(access.role, 'import')) return { ok: false, error: 'FORBIDDEN' };
  if (!isUuid(jobId)) return { ok: false, error: 'NOT_FOUND' };

  const job = await db.importJob.findFirst({
    where: { id: jobId, treeId: access.treeId },
    select: { id: true, storageKey: true, isDryRun: true },
  });
  if (!job) return { ok: false, error: 'NOT_FOUND' };
  // A committed job stays committed. Re-running it would duplicate the whole
  // file into the tree, which is exactly the accident this guard exists for.
  if (!job.isDryRun) return { ok: false, error: 'ALREADY_COMMITTED' };

  // Analysed, or failed without writing anything (the write is one
  // transaction): either may be queued. Queued or running may not.
  const claimed = await db.importJob.updateMany({
    where: { id: job.id, isDryRun: true, status: { in: ['COMPLETED', 'FAILED'] } },
    data: {
      status: 'QUEUED',
      error: null,
      startedAt: null,
      completedAt: null,
      processedRecords: 0,
      totalRecords: 0,
    },
  });
  if (claimed.count === 0) return { ok: false, error: 'IN_PROGRESS' };

  try {
    await within(
      enqueueGedcomImport({
        treeId: access.treeId,
        importJobId: job.id,
        storageKey: job.storageKey,
        actorId,
      }),
      ENQUEUE_TIMEOUT_MS,
    );
  } catch {
    // Back to "analysed", so the person can try again. Should the job reach
    // the queue after all, the worker finds nothing queued to claim and
    // writes nothing.
    await db.importJob.updateMany({
      where: { id: job.id, status: 'QUEUED' },
      data: { status: 'COMPLETED' },
    });
    return { ok: false, error: 'QUEUE_UNAVAILABLE' };
  }
  return { ok: true };
}

export type ImportState = 'ANALYSED' | 'QUEUED' | 'PROCESSING' | 'DONE' | 'FAILED';

export interface ImportProgress {
  readonly state: ImportState;
  /** Rows written so far, and rows to write: the worker's own count. */
  readonly written: number;
  readonly total: number;
  readonly result: {
    readonly people: number;
    readonly relationships: number;
    readonly events: number;
    readonly rejected: number;
  } | null;
  /** Why it stopped, as a code: the job's own message stays on the server. */
  readonly failure: 'UNSUPPORTED_ENCODING' | 'INTERRUPTED' | 'WRITE_FAILED' | null;
}

export type ProgressResult =
  | { readonly ok: true; readonly progress: ImportProgress }
  | { readonly ok: false; readonly error: 'NOT_FOUND' | 'FORBIDDEN' };

function stateOf(status: string, isDryRun: boolean): ImportState {
  if (status === 'QUEUED') return 'QUEUED';
  if (status === 'PROCESSING') return 'PROCESSING';
  if (status === 'FAILED') return 'FAILED';
  return isDryRun ? 'ANALYSED' : 'DONE';
}

/** Where an import stands, for the page waiting on it. */
export async function importProgress(treeSlug: string, jobId: string): Promise<ProgressResult> {
  const access = await resolveTreeAccess(treeSlug);
  if (!access) return { ok: false, error: 'NOT_FOUND' };
  if (!can(access.role, 'import')) return { ok: false, error: 'FORBIDDEN' };
  if (!isUuid(jobId)) return { ok: false, error: 'NOT_FOUND' };

  const job = await db.importJob.findFirst({
    where: { id: jobId, treeId: access.treeId },
    select: {
      status: true,
      isDryRun: true,
      processedRecords: true,
      totalRecords: true,
      result: true,
      error: true,
    },
  });
  if (!job) return { ok: false, error: 'NOT_FOUND' };

  const state = stateOf(job.status, job.isDryRun);
  const stored = (job.result ?? null) as {
    people?: number;
    relationships?: number;
    events?: number;
    rejected?: readonly unknown[];
  } | null;

  return {
    ok: true,
    progress: {
      state,
      written: job.processedRecords,
      total: job.totalRecords,
      result:
        state === 'DONE' && stored
          ? {
              people: stored.people ?? 0,
              relationships: stored.relationships ?? 0,
              events: stored.events ?? 0,
              rejected: stored.rejected?.length ?? 0,
            }
          : null,
      failure:
        state !== 'FAILED'
          ? null
          : job.error === 'UNSUPPORTED_ENCODING' || job.error === 'INTERRUPTED'
            ? job.error
            : 'WRITE_FAILED',
    },
  };
}
