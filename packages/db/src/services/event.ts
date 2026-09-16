import { dateToJdn, parseGenealogicalDate } from '@chronolignee/domain';
import type { Database } from '../client';
import { encodeDate } from '../date-codec';
import { diffFields, recordRevision } from './audit';
import { refreshLifespan, type PersonWriteContext } from './person';
import { resolvePlace } from './place';
import {
  createEventInput,
  updateEventInput,
  type CreateEventInput,
  type UpdateEventInput,
} from './schemas';

/**
 * Events other than birth and death.
 *
 * Birth and death are written through the person form, because a person form
 * that could not ask when someone was born would be absurd. Everything else —
 * a marriage, a census, a migration, a military record — is its own record
 * with its own date, its own place and its own set of participants, and is
 * written here.
 *
 * The participant list is the reason this is not just "a date on a person". A
 * marriage belongs to two people and a baptism has godparents; storing it on
 * one of them would make the same event appear twice with two dates that
 * drift apart.
 */

export interface EventWriteResult {
  readonly eventId: string;
}

/** Events that can move a lifespan, so a write to one must refresh the cache. */
const LIFESPAN_BEARING = new Set(['BIRTH', 'BAPTISM', 'DEATH', 'BURIAL', 'CREMATION']);

function labelFor(type: string, customType: string | null | undefined): string {
  return type === 'CUSTOM' ? (customType ?? 'Événement') : type;
}

export async function createEvent(
  db: Database,
  raw: CreateEventInput,
  context: PersonWriteContext,
): Promise<EventWriteResult> {
  const input = createEventInput.parse(raw);
  const todayJdn = dateToJdn(new Date());
  const date = input.date ? parseGenealogicalDate(input.date) : null;

  return db.$transaction(async (tx) => {
    // Every participant must belong to this tree. Without the check, a
    // participant id from another tree would link two archives together and
    // the event would surface in a tree its owner never put it in.
    const participantIds = input.participants.map((p) => p.personId);
    const known = await tx.person.findMany({
      where: { id: { in: participantIds }, treeId: context.treeId, deletedAt: null },
      select: { id: true, displayName: true },
    });
    if (known.length !== new Set(participantIds).size) {
      throw new Error('Une des personnes citées est introuvable dans cet arbre.');
    }

    const event = await tx.event.create({
      data: {
        treeId: context.treeId,
        type: input.type,
        ...(input.customType ? { customType: input.customType } : {}),
        ...(date ? encodeDate(date) : {}),
        ...(input.placeName
          ? { placeId: await resolvePlace(tx, context.treeId, input.placeName) }
          : {}),
        ...(input.placeName ? { placeOriginalText: input.placeName } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        // An unreadable date is weak evidence of when, not of whether. The
        // event still happened; only its position is in doubt.
        confidence: date?.unparsed ? 'LOW' : input.confidence,
        ...(context.actorId ? { createdById: context.actorId } : {}),
        participants: {
          create: input.participants.map((p) => ({ personId: p.personId, role: p.role })),
        },
      },
    });

    if (LIFESPAN_BEARING.has(input.type)) {
      for (const personId of participantIds) {
        await refreshLifespan(tx, personId, todayJdn);
      }
    }

    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'Event',
      entityId: event.id,
      action: 'CREATE',
      actorId: context.actorId,
      after: {
        type: input.type,
        date: input.date ?? null,
        place: input.placeName ?? null,
        participants: known.map((person) => person.displayName),
      },
      summary: `${labelFor(input.type, input.customType)} — ${known
        .map((person) => person.displayName)
        .join(', ')}`,
      ...(context.batchId ? { batchId: context.batchId } : {}),
    });

    await tx.tree.update({
      where: { id: context.treeId },
      data: { revision: { increment: 1 } },
    });

    return { eventId: event.id };
  });
}

/**
 * Correcting an event.
 *
 * Updated in place rather than archived-and-replaced, unlike a birth date
 * corrected through the person form. The difference is what the user is
 * holding: there, the form owns both the old value and the new one and the
 * old event would otherwise vanish silently; here they are editing one
 * specific record, and the revision carries what it said before.
 */
export async function updateEvent(
  db: Database,
  raw: UpdateEventInput,
  context: PersonWriteContext,
): Promise<EventWriteResult> {
  const input = updateEventInput.parse(raw);
  const todayJdn = dateToJdn(new Date());

  return db.$transaction(async (tx) => {
    const existing = await tx.event.findFirstOrThrow({
      where: { id: input.eventId, treeId: context.treeId, deletedAt: null },
      select: {
        id: true,
        type: true,
        dateOriginalText: true,
        description: true,
        notes: true,
        confidence: true,
        placeOriginalText: true,
        participants: { select: { personId: true } },
      },
    });

    const date = input.date !== undefined ? parseGenealogicalDate(input.date ?? '') : null;
    const dateChanged = input.date !== undefined;

    const changes = {
      ...(dateChanged ? encodeDate(input.date ? date : null) : {}),
      ...(input.placeName !== undefined
        ? {
            placeId: (await resolvePlace(tx, context.treeId, input.placeName)) ?? null,
            placeOriginalText: input.placeName ?? null,
          }
        : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
      ...(input.confidence ? { confidence: input.confidence } : {}),
      ...(context.actorId ? { updatedById: context.actorId } : {}),
    };

    await tx.event.update({ where: { id: existing.id }, data: changes });

    if (dateChanged && LIFESPAN_BEARING.has(existing.type)) {
      for (const participant of existing.participants) {
        await refreshLifespan(tx, participant.personId, todayJdn);
      }
    }

    const diff = diffFields(
      {
        dateOriginalText: existing.dateOriginalText,
        placeOriginalText: existing.placeOriginalText,
        description: existing.description,
        notes: existing.notes,
        confidence: existing.confidence,
      },
      {
        ...(dateChanged ? { dateOriginalText: input.date ?? '' } : {}),
        ...(input.placeName !== undefined ? { placeOriginalText: input.placeName ?? null } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
        ...(input.confidence ? { confidence: input.confidence } : {}),
      },
    );

    if (diff) {
      await recordRevision(tx, {
        treeId: context.treeId,
        entityType: 'Event',
        entityId: existing.id,
        action: 'UPDATE',
        actorId: context.actorId,
        before: diff.before,
        after: diff.after,
        summary: `${existing.type} corrigé`,
        ...(context.batchId ? { batchId: context.batchId } : {}),
      });

      await tx.tree.update({
        where: { id: context.treeId },
        data: { revision: { increment: 1 } },
      });
    }

    return { eventId: existing.id };
  });
}

export async function deleteEvent(
  db: Database,
  eventId: string,
  context: PersonWriteContext,
): Promise<void> {
  const todayJdn = dateToJdn(new Date());

  await db.$transaction(async (tx) => {
    const event = await tx.event.findFirstOrThrow({
      where: { id: eventId, treeId: context.treeId, deletedAt: null },
      select: {
        id: true,
        type: true,
        dateOriginalText: true,
        participants: { select: { personId: true } },
      },
    });

    await tx.event.update({ where: { id: event.id }, data: { deletedAt: new Date() } });

    // Removing a baptism can move someone's lifespan, because a baptism
    // stands in for an unrecorded birth. Skipping this would leave them on
    // the timeline at a date the tree no longer holds.
    if (LIFESPAN_BEARING.has(event.type)) {
      for (const participant of event.participants) {
        await refreshLifespan(tx, participant.personId, todayJdn);
      }
    }

    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'Event',
      entityId: event.id,
      action: 'DELETE',
      actorId: context.actorId,
      before: { type: event.type, date: event.dateOriginalText },
      summary: `${event.type} supprimé`,
      ...(context.batchId ? { batchId: context.batchId } : {}),
    });

    await tx.tree.update({
      where: { id: context.treeId },
      data: { revision: { increment: 1 } },
    });
  });
}
