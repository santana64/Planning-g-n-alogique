import type { Database } from '../client';
import { recordRevision } from './audit';
import type { PersonWriteContext } from './person';

/**
 * A machine's reading of a document, and its research suggestions — as
 * proposals, with their state, and nothing more.
 *
 * Two rules from ADR 0004 shape every function here:
 *
 *  - a machine reading never becomes the document's transcription by itself.
 *    It is stored beside it (`machineTranscription`), and a person copies it
 *    across, or does not;
 *  - a suggestion never becomes a research task by itself. Adopting one is a
 *    person's act, recorded with their name; dismissing one keeps it, so the
 *    same idea is not presented again as new.
 */

export class MachineReadingNotFound extends Error {
  constructor() {
    super('document or suggestion not found in this tree');
  }
}

export type AnalysisStatus = 'NONE' | 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';

/**
 * Mark a document as waiting to be read.
 *
 * Returns false when a reading is already queued or running: a second click
 * joins the first rather than paying for the page twice.
 */
export async function requestDocumentReading(
  db: Database,
  treeId: string,
  documentId: string,
): Promise<boolean> {
  const document = await db.document.findFirst({
    where: { id: documentId, treeId, deletedAt: null },
    select: { analysisStatus: true },
  });
  if (!document) throw new MachineReadingNotFound();
  const updated = await db.document.updateMany({
    where: { id: documentId, treeId, analysisStatus: { notIn: ['QUEUED', 'RUNNING'] } },
    data: { analysisStatus: 'QUEUED', analysisError: null },
  });
  return updated.count === 1;
}

export async function setDocumentAnalysis(
  db: Database,
  documentId: string,
  status: AnalysisStatus,
  error: string | null = null,
): Promise<void> {
  await db.document.update({
    where: { id: documentId },
    data: { analysisStatus: status, analysisError: error },
  });
}

export interface MachineReading {
  readonly transcription: string;
  readonly legibility: string;
  readonly caveats: readonly string[];
  /** "Claude (claude-opus-5-5)", "Lecture par règles (sans IA)". */
  readonly reader: string;
}

export async function saveMachineReading(
  db: Database,
  documentId: string,
  reading: MachineReading,
): Promise<void> {
  await db.document.update({
    where: { id: documentId },
    data: {
      machineTranscription: reading.transcription || null,
      machineLegibility: reading.legibility,
      machineCaveats: [...reading.caveats],
      machineReader: reading.reader,
      machineReadAt: new Date(),
      analysisStatus: 'DONE',
      analysisError: null,
    },
  });
}

// --- Research suggestions ---------------------------------------------------

export interface SuggestionInput {
  readonly question: string;
  readonly rationale: string;
  readonly whereToLook: string | null;
  readonly basis: readonly string[];
}

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Keep a round of suggestions, minus the ones already offered.
 *
 * "Already offered" includes dismissed ones: a researcher who said no to an
 * idea should not see it come back every time they ask.
 */
export async function recordResearchSuggestions(
  db: Database,
  input: {
    readonly treeId: string;
    readonly personId: string;
    readonly suggestions: readonly SuggestionInput[];
    readonly provenance: { provider: string; model: string; version: string };
  },
): Promise<number> {
  const existing = await db.aiResearchSuggestion.findMany({
    where: { treeId: input.treeId, personId: input.personId },
    select: { question: true },
  });
  const seen = new Set(existing.map((row) => fold(row.question)));
  let created = 0;
  for (const suggestion of input.suggestions) {
    const key = fold(suggestion.question);
    if (seen.has(key)) continue;
    seen.add(key);
    await db.aiResearchSuggestion.create({
      data: {
        treeId: input.treeId,
        personId: input.personId,
        question: suggestion.question,
        rationale: suggestion.rationale,
        whereToLook: suggestion.whereToLook,
        basis: [...suggestion.basis],
        provider: input.provenance.provider,
        model: input.provenance.model,
        promptVersion: input.provenance.version,
      },
    });
    created += 1;
  }
  return created;
}

/** Turn a suggestion into a research task a person can edit. */
export async function adoptResearchSuggestion(
  db: Database,
  suggestionId: string,
  context: PersonWriteContext,
): Promise<{ taskId: string }> {
  return db.$transaction(async (tx) => {
    const suggestion = await tx.aiResearchSuggestion.findFirst({
      where: { id: suggestionId, treeId: context.treeId, status: 'PENDING' },
    });
    if (!suggestion) throw new MachineReadingNotFound();
    const task = await tx.researchTask.create({
      data: {
        treeId: context.treeId,
        personId: suggestion.personId,
        title: suggestion.question.slice(0, 200),
        hypothesis: suggestion.rationale || null,
        notes: suggestion.whereToLook
          ? `Où chercher : ${suggestion.whereToLook}\n(Piste proposée par ${suggestion.provider}, ${suggestion.model})`
          : `(Piste proposée par ${suggestion.provider}, ${suggestion.model})`,
        createdById: context.actorId,
      },
      select: { id: true },
    });
    await tx.aiResearchSuggestion.update({
      where: { id: suggestionId },
      data: { status: 'ADOPTED', decidedAt: new Date(), decidedById: context.actorId },
    });
    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'ResearchTask',
      entityId: task.id,
      action: 'CREATE',
      actorId: context.actorId,
      after: { title: suggestion.question.slice(0, 200), fromSuggestion: suggestionId },
      batchId: context.batchId,
    });
    return { taskId: task.id };
  });
}

export async function dismissResearchSuggestion(
  db: Database,
  suggestionId: string,
  context: PersonWriteContext,
): Promise<void> {
  const updated = await db.aiResearchSuggestion.updateMany({
    where: { id: suggestionId, treeId: context.treeId, status: 'PENDING' },
    data: { status: 'DISMISSED', decidedAt: new Date(), decidedById: context.actorId },
  });
  if (updated.count === 0) throw new MachineReadingNotFound();
}
