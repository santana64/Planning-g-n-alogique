import 'server-only';
import { importGedcomPlan } from '@chronolignee/db';
import { mapDocument, parseGedcom, type ImportPlan } from '@chronolignee/gedcom';
import { buildObjectKey, checksum, safeDownloadName, validateGedcom } from '@chronolignee/storage';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { objectStore } from '@/lib/storage';
import { can } from '@chronolignee/domain';
import { resolveTreeAccess } from './access';

/**
 * GEDCOM import, in two deliberate halves.
 *
 * `analyseUpload` reads the file and writes nothing to the tree. `commitImport`
 * writes, and only runs once a human has seen what the first half found.
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

export type ImportAnalysisError = 'NOT_FOUND' | 'FORBIDDEN' | 'TOO_LARGE' | 'NOT_GEDCOM' | 'EMPTY';

export interface ImportAnalysis {
  readonly jobId: string;
  readonly filename: string;
  readonly byteSize: number;
  readonly detectedVersion: string | null;
  readonly generator: string | null;
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

  const text = new TextDecoder('utf-8', { fatal: false }).decode(file.bytes);
  const document = parseGedcom(text);
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
      detectedEncoding: document.declaredEncoding ?? 'UTF-8',
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

export type CommitError = 'NOT_FOUND' | 'FORBIDDEN' | 'ALREADY_COMMITTED' | 'FILE_MISSING';

export interface CommitSummary {
  readonly people: number;
  readonly relationships: number;
  readonly events: number;
  readonly rejected: ReadonlyArray<{ detail: string; reason: string }>;
}

export type CommitResult =
  | { readonly ok: true; readonly summary: CommitSummary }
  | { readonly ok: false; readonly error: CommitError };

/**
 * Write a previously analysed file into the tree.
 *
 * The file is re-read from storage and re-parsed rather than the plan being
 * carried across the request. A plan for twenty thousand people is megabytes
 * of JSON, and round-tripping it through a browser to come back as the
 * authority for a write is both wasteful and a place where a modified payload
 * would be trusted.
 */
export async function commitImport(
  treeSlug: string,
  jobId: string,
  actorId: string | null,
): Promise<CommitResult> {
  const access = await resolveTreeAccess(treeSlug);
  if (!access) return { ok: false, error: 'NOT_FOUND' };
  if (!can(access.role, 'import')) return { ok: false, error: 'FORBIDDEN' };

  const job = await db.importJob.findFirst({
    where: { id: jobId, treeId: access.treeId },
    select: { id: true, storageKey: true, isDryRun: true },
  });
  if (!job) return { ok: false, error: 'NOT_FOUND' };
  // A committed job stays committed. Re-running it would duplicate the whole
  // file into the tree, which is exactly the accident this guard exists for.
  if (!job.isDryRun) return { ok: false, error: 'ALREADY_COMMITTED' };

  let bytes: Uint8Array;
  try {
    bytes = await objectStore.get(job.storageKey);
  } catch {
    return { ok: false, error: 'FILE_MISSING' };
  }

  const plan = mapDocument(parseGedcom(new TextDecoder('utf-8', { fatal: false }).decode(bytes)));

  await db.importJob.update({
    where: { id: job.id },
    data: { status: 'PROCESSING', startedAt: new Date() },
  });

  try {
    const result = await importGedcomPlan(db, plan, { treeId: access.treeId, actorId });

    await db.importJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        isDryRun: false,
        completedAt: new Date(),
        duplicateCandidateCount: result.rejected.length,
      },
    });

    return {
      ok: true,
      summary: {
        people: result.people,
        relationships: result.relationships,
        events: result.events,
        rejected: result.rejected,
      },
    };
  } catch (error) {
    // The import transaction rolled back, so the tree is untouched. The job
    // records why, because "it failed" with no reason is not something a user
    // can act on.
    await db.importJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        error: error instanceof Error ? error.message.slice(0, 2000) : 'Erreur inconnue',
      },
    });
    throw error;
  }
}
