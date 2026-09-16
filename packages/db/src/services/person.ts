import { dateToJdn, parseGenealogicalDate, type GenealogicalDate } from '@chronolignee/domain';
import type { Database } from '../client';
import { encodeDate } from '../date-codec';
import { buildDisplayForm, buildSearchName, normaliseGiven, normaliseSurname } from '../normalise';
import { lifespanColumns, projectPersonLifespan } from '../projections/person-lifespan';
import { diffFields, recordRevision } from './audit';
import { resolvePlace } from './place';
import {
  createPersonInput,
  updatePersonInput,
  type CreatePersonInput,
  type PersonNameValue,
  type UpdatePersonInput,
} from './schemas';

/**
 * Creating and editing a person.
 *
 * One write path, and everything a write must do happens on it: validate the
 * input, parse the dates through the domain, create the vital events, refresh
 * the derived lifespan, record the revision and bump the tree. A second path
 * that skipped any of those would produce rows that look right and behave
 * wrong — a person who never appears on the timeline because their cache was
 * never filled, or an edit nobody can attribute.
 *
 * Birth and death arrive here as free text and leave as Events. The model has
 * no `birthDate` column and this is where that decision is honoured rather
 * than quietly worked around.
 */

export interface PersonWriteContext {
  readonly treeId: string;
  readonly actorId: string | null;
  readonly batchId?: string;
}

export interface PersonWriteResult {
  readonly personId: string;
  readonly displayName: string;
}

function nameFields(name: PersonNameValue) {
  return {
    given: name.given ?? null,
    surname: name.surname ?? null,
    surnamePrefix: name.surnamePrefix ?? null,
    prefix: name.prefix ?? null,
    suffix: name.suffix ?? null,
    nickname: name.nickname ?? null,
  };
}

/** The name shown in lists, from whichever record is marked preferred. */
function preferredOf(names: readonly PersonNameValue[]): PersonNameValue | undefined {
  return names.find((name) => name.isPreferred) ?? names[0];
}

export async function createPerson(
  db: Database,
  raw: CreatePersonInput,
  context: PersonWriteContext,
): Promise<PersonWriteResult> {
  const input = createPersonInput.parse(raw);
  const todayJdn = dateToJdn(new Date());

  const preferred = preferredOf(input.names);
  const displayName = buildDisplayForm(preferred ? nameFields(preferred) : {});

  return db.$transaction(async (tx) => {
    const person = await tx.person.create({
      data: {
        treeId: context.treeId,
        recordedSex: input.recordedSex,
        livingStatus: input.livingStatus,
        // Living people are redacted from shared views by default. Setting it
        // here rather than in a later pass means a person is never briefly
        // public between being created and being protected.
        privacy: input.livingStatus === 'LIVING' ? 'REDACTED' : 'INHERIT',
        displayName,
        searchName: buildSearchName(preferred ? nameFields(preferred) : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        ...(context.actorId ? { createdById: context.actorId } : {}),
      },
    });

    for (const [index, name] of input.names.entries()) {
      await tx.personName.create({
        data: {
          treeId: context.treeId,
          personId: person.id,
          type: name.type,
          ...nameFields(name),
          normalisedSurname: normaliseSurname(name.surname),
          normalisedGiven: normaliseGiven(name.given),
          displayForm: buildDisplayForm(nameFields(name)),
          // Exactly one preferred name, whatever the form sent.
          isPreferred: preferred ? name === preferred : index === 0,
          confidence: name.confidence,
        },
      });
    }

    await writeVitalEvent(
      tx,
      context.treeId,
      person.id,
      'BIRTH',
      input.birthDate,
      input.birthPlace,
    );
    await writeVitalEvent(
      tx,
      context.treeId,
      person.id,
      'DEATH',
      input.deathDate,
      input.deathPlace,
    );

    await refreshLifespan(tx, person.id, todayJdn);

    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'Person',
      entityId: person.id,
      action: 'CREATE',
      actorId: context.actorId,
      after: { displayName, birthDate: input.birthDate, deathDate: input.deathDate },
      summary: `${displayName} ajouté`,
      ...(context.batchId ? { batchId: context.batchId } : {}),
    });

    await tx.tree.update({
      where: { id: context.treeId },
      data: { revision: { increment: 1 } },
    });

    return { personId: person.id, displayName };
  });
}

export async function updatePerson(
  db: Database,
  raw: UpdatePersonInput,
  context: PersonWriteContext,
): Promise<PersonWriteResult> {
  const input = updatePersonInput.parse(raw);
  const todayJdn = dateToJdn(new Date());

  return db.$transaction(async (tx) => {
    const existing = await tx.person.findFirstOrThrow({
      where: { id: input.personId, treeId: context.treeId, deletedAt: null },
      // Every field the diff compares has to be selected, or an unselected
      // one reads as undefined and counts as a change on every edit.
      select: {
        id: true,
        displayName: true,
        searchName: true,
        recordedSex: true,
        livingStatus: true,
        privacy: true,
        notes: true,
      },
    });

    const preferred = input.names ? preferredOf(input.names) : undefined;
    const displayName = preferred ? buildDisplayForm(nameFields(preferred)) : existing.displayName;

    const changes = {
      ...(input.recordedSex ? { recordedSex: input.recordedSex } : {}),
      ...(input.livingStatus ? { livingStatus: input.livingStatus } : {}),
      ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
      ...(preferred ? { displayName, searchName: buildSearchName(nameFields(preferred)) } : {}),
      ...(input.livingStatus
        ? {
            privacy: input.livingStatus === 'LIVING' ? ('REDACTED' as const) : ('INHERIT' as const),
          }
        : {}),
      ...(context.actorId ? { updatedById: context.actorId } : {}),
    };

    await tx.person.update({ where: { id: existing.id }, data: changes });

    if (input.names) {
      // Names are replaced wholesale rather than reconciled field by field. A
      // name is a small record and the form owns the whole set; merging would
      // need stable ids the UI does not have, and would silently keep a name
      // the user meant to remove.
      await tx.personName.deleteMany({ where: { personId: existing.id } });
      for (const [index, name] of input.names.entries()) {
        await tx.personName.create({
          data: {
            treeId: context.treeId,
            personId: existing.id,
            type: name.type,
            ...nameFields(name),
            normalisedSurname: normaliseSurname(name.surname),
            normalisedGiven: normaliseGiven(name.given),
            displayForm: buildDisplayForm(nameFields(name)),
            isPreferred: preferred ? name === preferred : index === 0,
            confidence: name.confidence,
          },
        });
      }
    }

    if (input.birthDate !== undefined || input.birthPlace !== undefined) {
      await replaceVitalEvent(
        tx,
        context.treeId,
        existing.id,
        'BIRTH',
        input.birthDate,
        input.birthPlace,
      );
    }
    if (input.deathDate !== undefined || input.deathPlace !== undefined) {
      await replaceVitalEvent(
        tx,
        context.treeId,
        existing.id,
        'DEATH',
        input.deathDate,
        input.deathPlace,
      );
    }

    await refreshLifespan(tx, existing.id, todayJdn);

    const diff = diffFields(existing as Record<string, unknown>, changes);
    if (diff) {
      await recordRevision(tx, {
        treeId: context.treeId,
        entityType: 'Person',
        entityId: existing.id,
        action: 'UPDATE',
        actorId: context.actorId,
        before: diff.before,
        after: diff.after,
        summary: `${displayName} modifié`,
        ...(context.batchId ? { batchId: context.batchId } : {}),
      });
    }

    await tx.tree.update({
      where: { id: context.treeId },
      data: { revision: { increment: 1 } },
    });

    return { personId: existing.id, displayName };
  });
}

/**
 * Soft delete.
 *
 * The row stays. A genealogy is a research record and deletions are routinely
 * mistakes discovered weeks later — by which time a hard delete has taken the
 * person's events, citations and relationships with it. Marking instead keeps
 * every one of those recoverable.
 */
export async function deletePerson(
  db: Database,
  personId: string,
  context: PersonWriteContext,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const person = await tx.person.findFirstOrThrow({
      where: { id: personId, treeId: context.treeId, deletedAt: null },
      select: { id: true, displayName: true },
    });

    const now = new Date();
    await tx.person.update({ where: { id: person.id }, data: { deletedAt: now } });
    // Relationships go too: a link to a person nobody can see is a link that
    // renders as a line into nothing.
    await tx.relationship.updateMany({
      where: {
        treeId: context.treeId,
        deletedAt: null,
        OR: [{ sourceId: person.id }, { targetId: person.id }],
      },
      data: { deletedAt: now },
    });

    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'Person',
      entityId: person.id,
      action: 'DELETE',
      actorId: context.actorId,
      before: { displayName: person.displayName },
      summary: `${person.displayName} supprimé`,
      ...(context.batchId ? { batchId: context.batchId } : {}),
    });

    await tx.tree.update({
      where: { id: context.treeId },
      data: { revision: { increment: 1 } },
    });
  });
}

// --- Internals --------------------------------------------------------------

type Tx = Parameters<Parameters<Database['$transaction']>[0]>[0];

function parse(text: string | null | undefined): GenealogicalDate | null {
  return text ? parseGenealogicalDate(text) : null;
}

async function writeVitalEvent(
  tx: Tx,
  treeId: string,
  personId: string,
  type: 'BIRTH' | 'DEATH',
  dateText: string | null | undefined,
  placeName: string | null | undefined,
): Promise<void> {
  if (!dateText && !placeName) return;

  const date = parse(dateText);
  await tx.event.create({
    data: {
      treeId,
      type,
      ...(date ? encodeDate(date) : {}),
      ...(placeName ? { placeId: await resolvePlace(tx, treeId, placeName) } : {}),
      ...(placeName ? { placeOriginalText: placeName } : {}),
      confidence: date?.unparsed ? 'LOW' : 'MEDIUM',
      participants: { create: { personId, role: 'PRINCIPAL' } },
    },
  });
}

/**
 * Replace a person's birth or death event.
 *
 * Soft-deleting the old one rather than updating it keeps the previous value
 * in the record: a correction is a fact about the research, and the version
 * that was there before is exactly what someone will want when the correction
 * turns out to be the mistake.
 */
async function replaceVitalEvent(
  tx: Tx,
  treeId: string,
  personId: string,
  type: 'BIRTH' | 'DEATH',
  dateText: string | null | undefined,
  placeName: string | null | undefined,
): Promise<void> {
  await tx.event.updateMany({
    where: {
      treeId,
      type,
      deletedAt: null,
      participants: { some: { personId, role: 'PRINCIPAL' } },
    },
    data: { deletedAt: new Date() },
  });

  await writeVitalEvent(tx, treeId, personId, type, dateText, placeName);
}

/**
 * Rebuild the derived lifespan for one person.
 *
 * Called on every write that could move either end. The cache is what the
 * Gantt reads, so a write that skipped this would put someone on the timeline
 * at a date they no longer have.
 */
export async function refreshLifespan(tx: Tx, personId: string, todayJdn: number): Promise<void> {
  const person = await tx.person.findUniqueOrThrow({
    where: { id: personId },
    select: {
      livingStatus: true,
      eventRoles: {
        where: { event: { deletedAt: null } },
        select: {
          event: {
            select: {
              type: true,
              dateQualifier: true,
              dateCalendar: true,
              datePrecision: true,
              dateStartYear: true,
              dateStartMonth: true,
              dateStartDay: true,
              dateEndYear: true,
              dateEndMonth: true,
              dateEndDay: true,
              dateOriginalText: true,
              dateUnparsed: true,
            },
          },
        },
      },
      claims: { select: { predicate: true, status: true, value: true } },
    },
  });

  const projection = projectPersonLifespan(
    {
      livingStatus: person.livingStatus,
      events: person.eventRoles.map((role) => role.event),
      claims: person.claims,
    },
    todayJdn,
  );

  await tx.person.update({ where: { id: personId }, data: lifespanColumns(projection) });
}
