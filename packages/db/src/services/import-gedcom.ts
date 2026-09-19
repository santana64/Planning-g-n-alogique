import { dateToJdn } from '@chronolignee/domain';
import type { ImportPlan } from '@chronolignee/gedcom';
import type { Prisma } from '../../generated/client/client';
import type { Database, TransactionClient } from '../client';
import { encodeDate } from '../date-codec';
import {
  buildDisplayForm,
  buildSearchName,
  normaliseGiven,
  normalisePlaceName,
  normaliseSurname,
} from '../normalise';
import { uuidv7 } from '../ids';
import { lifespanColumns, projectPersonLifespan } from '../projections/person-lifespan';
import { recordRevision } from './audit';

/**
 * Commit an import plan into a tree.
 *
 * Everything happens inside one transaction. A GEDCOM import that fails
 * halfway leaves a tree containing people with no parents and marriages with
 * no spouses — a state the user cannot see is wrong and cannot undo, because
 * they have no idea which half arrived. All or nothing is the only defensible
 * behaviour.
 *
 * The plan arrives already validated and already reviewed. This function's
 * only job is to write it faithfully: it makes no genealogical decisions, and
 * anything it would have had to decide was decided in the mapper where a human
 * could see it.
 */

export interface ImportResult {
  readonly treeId: string;
  readonly people: number;
  readonly relationships: number;
  readonly events: number;
  readonly places: number;
  readonly sources: number;
  /** Relationships the database refused, with the reason. */
  readonly rejected: ReadonlyArray<{ detail: string; reason: string }>;
}

export interface ImportOptions {
  readonly treeId: string;
  readonly actorId: string | null;
  /** Correlation id so the whole import reads as one action in the audit log. */
  readonly batchId?: string;
  /**
   * Called after every batch with the rows written so far and the rows there
   * are to write — the only honest progress an import has. The rows only
   * become visible when the transaction commits; the work they measure is
   * already done.
   */
  readonly onProgress?: (written: number, total: number) => Promise<void> | void;
  /**
   * Runs last, inside the import's own transaction, with what was written.
   * Whatever records that the import happened — the job's "done" — belongs
   * here: written after the commit, a failure in between would leave the
   * data in the tree and the job saying it failed, inviting a second import
   * of the same file.
   */
  readonly finalise?: (tx: TransactionClient, result: ImportResult) => Promise<void>;
}

/**
 * Timeout for the whole transaction.
 *
 * Bounded because a transaction that never ends holds locks on the tree and
 * blocks every other writer. Written in batches, 20 000 people import in well
 * under it (docs/PERFORMANCE.md); written one row at a time, they did not
 * finish at all.
 */
const TRANSACTION_TIMEOUT_MS = 120_000;

/** Rows per statement: large enough to amortise a round trip, far below the bind limit. */
const BATCH = 1_000;

async function inBatches<T>(rows: readonly T[], write: (batch: T[]) => Promise<unknown>) {
  for (let start = 0; start < rows.length; start += BATCH) {
    await write(rows.slice(start, start + BATCH));
  }
}

export async function importGedcomPlan(
  db: Database,
  plan: ImportPlan,
  options: ImportOptions,
): Promise<ImportResult> {
  const todayJdn = dateToJdn(new Date());
  const rejected: Array<{ detail: string; reason: string }> = [];
  const { treeId } = options;

  // --- Everything decided in memory first --------------------------------
  // Every row, its id and its derived columns are settled before the
  // transaction opens, so the transaction does nothing but write — in
  // batches. Row by row, 5 000 people took 36 seconds and 20 000 ran out of
  // time; the file was lost either way on a large tree.

  const placeRows = plan.places.map((place) => ({
    id: uuidv7(),
    treeId,
    name: place.name,
    normalisedName: normalisePlaceName(place.name),
    type: 'OTHER' as const,
    ...(place.latitude !== undefined ? { latitude: place.latitude } : {}),
    ...(place.longitude !== undefined ? { longitude: place.longitude } : {}),
    // Imported places carry the confidence of a name typed by whoever
    // built the original file, which is not high.
    confidence: 'LOW' as const,
  }));
  const placeIds = new Map(placeRows.map((row) => [row.name, row.id]));

  const sourceRows = plan.sources.map((source) => ({
    id: uuidv7(),
    treeId,
    title: source.title,
    type: 'OTHER' as const,
    ...(source.author ? { author: source.author } : {}),
    ...(source.publication ? { publishedAt: source.publication } : {}),
    ...(source.repository ? { repository: source.repository } : {}),
    ...(source.callNumber ? { callNumber: source.callNumber } : {}),
    reliability: 'MEDIUM' as const,
  }));
  const sourceIds = new Map(
    plan.sources.map((source, index) => [source.xref, sourceRows[index]?.id]),
  );

  const personIds = new Map(plan.people.map((person) => [person.xref, uuidv7()]));

  // Events, with their participants and citations, and each person's events
  // gathered for the lifespan projection below.
  const eventRows: Prisma.EventCreateManyInput[] = [];
  const participantRows: Prisma.EventParticipantCreateManyInput[] = [];
  const citationRows: Prisma.CitationCreateManyInput[] = [];
  const eventsOf = new Map<string, Array<{ type: string } & ReturnType<typeof encodeDate>>>();
  for (const event of plan.events) {
    const participants = event.participants.flatMap((participant) => {
      const personId = personIds.get(participant.xref);
      return personId ? [{ personId, role: participant.role }] : [];
    });
    // An event with nobody in it is not an event. The mapper already reported
    // the dangling pointer that caused this.
    if (participants.length === 0) continue;

    const eventId = uuidv7();
    const date = encodeDate(event.date);
    eventRows.push({
      id: eventId,
      treeId,
      type: event.type as 'BIRTH',
      ...(event.customType ? { customType: event.customType } : {}),
      ...(event.date ? date : {}),
      ...(event.placeName ? { placeId: placeIds.get(event.placeName) ?? null } : {}),
      ...(event.placeName ? { placeOriginalText: event.placeName } : {}),
      ...(event.description ? { description: event.description } : {}),
      confidence: 'MEDIUM' as const,
    });
    for (const participant of participants) {
      participantRows.push({
        eventId,
        personId: participant.personId,
        role: participant.role as 'PRINCIPAL',
      });
      if (event.date) {
        const list = eventsOf.get(participant.personId) ?? [];
        list.push({ type: event.type, ...date });
        eventsOf.set(participant.personId, list);
      }
    }
    for (const sourceXref of new Set(event.sourceXrefs)) {
      const sourceId = sourceIds.get(sourceXref);
      if (sourceId) citationRows.push({ treeId, sourceId, eventId, confidence: 'MEDIUM' as const });
    }
  }

  // People, with living status and lifespan derived from what was recorded.
  // Living status is not stated in GEDCOM and must not be guessed: a death
  // or a burial makes someone DECEASED; anyone else stays UNKNOWN — never
  // LIVING, which would both be wrong for a nineteenth-century ancestor and
  // quietly redact them from every shared view.
  const personRows: Prisma.PersonCreateManyInput[] = [];
  const nameRows: Prisma.PersonNameCreateManyInput[] = [];
  for (const person of plan.people) {
    const personId = personIds.get(person.xref) as string;
    const preferred = person.names.find((name) => name.isPreferred) ?? person.names[0];
    const nameParts = {
      given: preferred?.given ?? null,
      surname: preferred?.surname ?? null,
      prefix: preferred?.prefix ?? null,
      suffix: preferred?.suffix ?? null,
      nickname: preferred?.nickname ?? null,
    };
    const events = eventsOf.get(personId) ?? [];
    const livingStatus = events.some((event) => event.type === 'DEATH' || event.type === 'BURIAL')
      ? ('DECEASED' as const)
      : ('UNKNOWN' as const);
    const projection = projectPersonLifespan({ livingStatus, events, claims: [] }, todayJdn);

    personRows.push({
      id: personId,
      treeId,
      recordedSex: person.recordedSex,
      livingStatus,
      displayName: buildDisplayForm(nameParts),
      searchName: buildSearchName(nameParts),
      ...(person.notes.length > 0 ? { notes: person.notes.join('\n\n') } : {}),
      ...(options.actorId ? { createdById: options.actorId } : {}),
      ...lifespanColumns(projection),
    });
    for (const name of person.names) {
      nameRows.push({
        treeId,
        personId,
        type:
          name.type === 'AKA'
            ? ('AKA' as const)
            : name.type === 'MARRIED'
              ? ('MARRIED' as const)
              : ('BIRTH' as const),
        ...(name.given ? { given: name.given } : {}),
        ...(name.surname ? { surname: name.surname } : {}),
        ...(name.prefix ? { prefix: name.prefix } : {}),
        ...(name.suffix ? { suffix: name.suffix } : {}),
        ...(name.nickname ? { nickname: name.nickname } : {}),
        normalisedSurname: normaliseSurname(name.surname),
        normalisedGiven: normaliseGiven(name.given),
        // The NAME line as written, so our split stays correctable.
        displayForm: name.original || buildDisplayForm(name),
        isPreferred: name.isPreferred,
        confidence: 'MEDIUM' as const,
      });
    }
  }

  // Relationships. What the database would refuse is refused here, before a
  // statement is sent: in PostgreSQL a refused statement aborts the whole
  // transaction, and one impossible link in a file of twenty thousand cost
  // the user the other nineteen thousand nine hundred and ninety-nine. The
  // mapper already reports these cases at review; this is the backstop for a
  // plan built any other way.
  const relationshipRows: Prisma.RelationshipCreateManyInput[] = [];
  const written = new Set<string>();
  for (const relationship of plan.relationships) {
    const sourceId = personIds.get(relationship.sourceXref);
    const targetId = personIds.get(relationship.targetXref);
    if (!sourceId || !targetId) continue;

    const key = `${sourceId}|${targetId}|${relationship.type}`;
    const refusal =
      sourceId === targetId
        ? 'une personne ne peut pas être liée à elle-même'
        : relationship.startJdn !== null &&
            relationship.endJdn !== null &&
            relationship.startJdn > relationship.endJdn
          ? 'la fin du lien précède son début'
          : written.has(key)
            ? 'lien déclaré deux fois'
            : null;
    if (refusal) {
      rejected.push({
        detail: `${relationship.sourceXref} → ${relationship.targetXref} (${relationship.type})`,
        reason: refusal,
      });
      continue;
    }
    written.add(key);
    relationshipRows.push({
      treeId,
      sourceId,
      targetId,
      type: relationship.type as 'SPOUSE',
      ...(relationship.startJdn !== null ? { startJdn: relationship.startJdn } : {}),
      ...(relationship.endJdn !== null ? { endJdn: relationship.endJdn } : {}),
      confidence: 'MEDIUM' as const,
    });
  }

  // --- Then the writes, all or nothing -----------------------------------
  // One transaction: a GEDCOM import that fails halfway leaves a tree with
  // people who have no parents and marriages with no spouses — a state the
  // user cannot see is wrong and cannot undo.
  const total =
    placeRows.length +
    sourceRows.length +
    personRows.length +
    nameRows.length +
    eventRows.length +
    participantRows.length +
    citationRows.length +
    relationshipRows.length;
  let rowsWritten = 0;
  const counted =
    <T>(write: (batch: T[]) => Promise<unknown>) =>
    async (batch: T[]): Promise<void> => {
      await write(batch);
      rowsWritten += batch.length;
      await options.onProgress?.(rowsWritten, total);
    };

  // Everything the result says is settled before anything is written.
  const result: ImportResult = {
    treeId,
    people: personRows.length,
    relationships: relationshipRows.length,
    events: eventRows.length,
    places: placeRows.length,
    sources: sourceRows.length,
    rejected,
  };

  await db.$transaction(
    async (tx) => {
      await inBatches(
        placeRows,
        counted((batch) => tx.place.createMany({ data: batch })),
      );
      // The spatial column, for every located place, in one statement.
      await tx.$executeRaw`
        UPDATE places
        SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
        WHERE "treeId" = ${treeId}::uuid
          AND latitude IS NOT NULL AND longitude IS NOT NULL AND geom IS NULL`;
      await inBatches(
        sourceRows,
        counted((batch) => tx.source.createMany({ data: batch })),
      );
      await inBatches(
        personRows,
        counted((batch) => tx.person.createMany({ data: batch })),
      );
      await inBatches(
        nameRows,
        counted((batch) => tx.personName.createMany({ data: batch })),
      );
      await inBatches(
        eventRows,
        counted((batch) => tx.event.createMany({ data: batch })),
      );
      await inBatches(
        participantRows,
        counted((batch) => tx.eventParticipant.createMany({ data: batch })),
      );
      await inBatches(
        citationRows,
        counted((batch) => tx.citation.createMany({ data: batch })),
      );
      await inBatches(
        relationshipRows,
        counted((batch) => tx.relationship.createMany({ data: batch })),
      );

      await tx.tree.update({ where: { id: treeId }, data: { revision: { increment: 1 } } });

      // One entry for the whole file. Eighteen thousand "person created"
      // lines would bury every other change in the history; none at all left
      // an import of eighteen thousand people without a trace of who did it.
      await recordRevision(tx, {
        treeId,
        entityType: 'Tree',
        entityId: treeId,
        action: 'IMPORT',
        actorId: options.actorId,
        after: {
          people: personRows.length,
          relationships: relationshipRows.length,
          events: eventRows.length,
          refused: rejected.length,
        },
        summary: `Import GEDCOM : ${personRows.length} personnes, ${relationshipRows.length} liens, ${eventRows.length} événements`,
        ...(options.batchId ? { batchId: options.batchId } : {}),
      });

      await options.finalise?.(tx, result);
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 10_000 },
  );

  return result;
}
