import { parseGenealogicalDate } from '@chronolignee/domain';
import { z } from 'zod';
import type { Database } from '../client';
import { recordRevision } from './audit';
import type { PersonWriteContext } from './person';

/**
 * Research tasks: the questions a family is still asking.
 *
 * A task is a hypothesis with a place to look ("was Jean baptised at
 * Azay-le-Rideau between 1698 and 1710? — AD 37, registres paroissiaux") and,
 * once worked, an outcome. "Nothing found" is an outcome and is kept: it is
 * what stops the next researcher from spending the same afternoon in the same
 * register.
 *
 * Tasks are never deleted. Giving up on a question is ABANDONED, with the
 * reason, for the same reason.
 */

export const RESEARCH_STATUSES = [
  'TODO',
  'IN_PROGRESS',
  'BLOCKED',
  'RESOLVED',
  'ABANDONED',
] as const;
export const RESEARCH_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .optional();

/** A period given as genealogists write it: "1698", "ABT 1700", "BEF 1710". */
const optionalPeriodEdge = z
  .string()
  .trim()
  .max(60)
  .optional()
  .transform((value, context) => {
    if (!value) return null;
    const parsed = parseGenealogicalDate(value);
    if (parsed.interval.earliest === null && parsed.interval.latest === null) {
      context.addIssue({ code: 'custom', message: 'UNREADABLE_DATE' });
      return z.NEVER;
    }
    return parsed.interval;
  });

export const createResearchTaskInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    hypothesis: optionalText(2000),
    personId: z.uuid().optional().nullable(),
    priority: z.enum(RESEARCH_PRIORITIES).default('NORMAL'),
    repository: optionalText(200),
    callNumber: optionalText(120),
    placeLabel: optionalText(200),
    url: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((value) => (value ? value : null))
      .refine((value) => value === null || /^https?:\/\//i.test(value), 'URL_SCHEME'),
    searchFrom: optionalPeriodEdge,
    searchTo: optionalPeriodEdge,
  })
  .refine(
    (input) =>
      !input.searchFrom ||
      !input.searchTo ||
      input.searchFrom.earliest === null ||
      input.searchTo.latest === null ||
      input.searchFrom.earliest <= input.searchTo.latest,
    { message: 'PERIOD_REVERSED', path: ['searchTo'] },
  );

export const updateResearchTaskInput = z.object({
  status: z.enum(RESEARCH_STATUSES),
  outcome: optionalText(4000),
});

export class ResearchTaskNotFound extends Error {
  constructor() {
    super('research task not found in this tree');
  }
}

/** Create a task. The person, when named, must belong to the same tree. */
export async function createResearchTask(
  db: Database,
  raw: unknown,
  context: PersonWriteContext,
): Promise<{ id: string }> {
  const input = createResearchTaskInput.parse(raw);

  return db.$transaction(async (tx) => {
    if (input.personId) {
      const person = await tx.person.findFirst({
        where: { id: input.personId, treeId: context.treeId, deletedAt: null },
        select: { id: true },
      });
      // A crafted id from another tree is refused, not attached.
      if (!person) throw new ResearchTaskNotFound();
    }

    const task = await tx.researchTask.create({
      data: {
        treeId: context.treeId,
        title: input.title,
        hypothesis: input.hypothesis ?? null,
        personId: input.personId ?? null,
        priority: input.priority,
        repository: input.repository ?? null,
        callNumber: input.callNumber ?? null,
        placeLabel: input.placeLabel ?? null,
        url: input.url,
        searchFromJdn: input.searchFrom?.earliest ?? null,
        searchToJdn: input.searchTo?.latest ?? null,
        createdById: context.actorId,
      },
      select: { id: true },
    });

    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'ResearchTask',
      entityId: task.id,
      action: 'CREATE',
      actorId: context.actorId,
      after: { title: input.title, priority: input.priority, personId: input.personId ?? null },
      batchId: context.batchId,
    });
    return task;
  });
}

/**
 * Move a task along, and say what was found.
 *
 * Closing a task (RESOLVED or ABANDONED) stamps `resolvedAt`; reopening one
 * clears it, so "resolved" always means "resolved now".
 */
export async function updateResearchTask(
  db: Database,
  taskId: string,
  raw: unknown,
  context: PersonWriteContext,
): Promise<void> {
  const input = updateResearchTaskInput.parse(raw);

  await db.$transaction(async (tx) => {
    const before = await tx.researchTask.findFirst({
      where: { id: taskId, treeId: context.treeId },
      select: { title: true, status: true, outcome: true },
    });
    if (!before) throw new ResearchTaskNotFound();

    const closed = input.status === 'RESOLVED' || input.status === 'ABANDONED';
    const outcome = input.outcome === undefined ? before.outcome : input.outcome;
    await tx.researchTask.update({
      where: { id: taskId },
      data: {
        status: input.status,
        outcome,
        resolvedAt: closed ? new Date() : null,
      },
    });

    if (before.status === input.status && before.outcome === outcome) return;
    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'ResearchTask',
      entityId: taskId,
      action: 'UPDATE',
      actorId: context.actorId,
      before: { title: before.title, status: before.status, outcome: before.outcome },
      after: { title: before.title, status: input.status, outcome },
      batchId: context.batchId,
    });
  });
}
