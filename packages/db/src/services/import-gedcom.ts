import { dateToJdn } from '@chronolignee/domain';
import type { ImportPlan } from '@chronolignee/gedcom';
import type { Database } from '../client';
import { encodeDate } from '../date-codec';
import {
  buildDisplayForm,
  buildSearchName,
  normaliseGiven,
  normalisePlaceName,
  normaliseSurname,
} from '../normalise';
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
}

/**
 * Timeout for the whole transaction.
 *
 * Generous because a large import is genuinely slow, and bounded because a
 * transaction that never ends holds locks on the tree and blocks every other
 * writer. Files beyond this belong in the worker with a chunked strategy.
 */
const TRANSACTION_TIMEOUT_MS = 120_000;

export async function importGedcomPlan(
  db: Database,
  plan: ImportPlan,
  options: ImportOptions,
): Promise<ImportResult> {
  const todayJdn = dateToJdn(new Date());
  const rejected: Array<{ detail: string; reason: string }> = [];

  const result = await db.$transaction(
    async (tx) => {
      const { treeId } = options;

      // --- Places ---------------------------------------------------------
      const placeIds = new Map<string, string>();
      for (const place of plan.places) {
        const created = await tx.place.create({
          data: {
            treeId,
            name: place.name,
            normalisedName: normalisePlaceName(place.name),
            type: 'OTHER',
            ...(place.latitude !== undefined ? { latitude: place.latitude } : {}),
            ...(place.longitude !== undefined ? { longitude: place.longitude } : {}),
            // Imported places carry the confidence of a name typed by whoever
            // built the original file, which is not high.
            confidence: 'LOW',
          },
        });
        placeIds.set(place.name, created.id);

        if (place.latitude !== undefined && place.longitude !== undefined) {
          await tx.$executeRaw`
            UPDATE places
            SET geom = ST_SetSRID(ST_MakePoint(${place.longitude}, ${place.latitude}), 4326)::geography
            WHERE id = ${created.id}::uuid`;
        }
      }

      // --- Sources --------------------------------------------------------
      const sourceIds = new Map<string, string>();
      for (const source of plan.sources) {
        const created = await tx.source.create({
          data: {
            treeId,
            title: source.title,
            type: 'OTHER',
            ...(source.author ? { author: source.author } : {}),
            ...(source.publication ? { publishedAt: source.publication } : {}),
            ...(source.repository ? { repository: source.repository } : {}),
            ...(source.callNumber ? { callNumber: source.callNumber } : {}),
            reliability: 'MEDIUM',
          },
        });
        sourceIds.set(source.xref, created.id);
      }

      // --- People ---------------------------------------------------------
      const personIds = new Map<string, string>();
      for (const person of plan.people) {
        const preferred = person.names.find((name) => name.isPreferred) ?? person.names[0];
        const nameParts = {
          given: preferred?.given ?? null,
          surname: preferred?.surname ?? null,
          prefix: preferred?.prefix ?? null,
          suffix: preferred?.suffix ?? null,
          nickname: preferred?.nickname ?? null,
        };

        const created = await tx.person.create({
          data: {
            treeId,
            recordedSex: person.recordedSex,
            // Living status is not stated in GEDCOM and must not be guessed.
            // It is derived later from whether a death was recorded.
            livingStatus: 'UNKNOWN',
            displayName: buildDisplayForm(nameParts),
            searchName: buildSearchName(nameParts),
            ...(person.notes.length > 0 ? { notes: person.notes.join('\n\n') } : {}),
            ...(options.actorId ? { createdById: options.actorId } : {}),
          },
        });
        personIds.set(person.xref, created.id);

        for (const name of person.names) {
          await tx.personName.create({
            data: {
              treeId,
              personId: created.id,
              type: name.type === 'AKA' ? 'AKA' : name.type === 'MARRIED' ? 'MARRIED' : 'BIRTH',
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
              confidence: 'MEDIUM',
            },
          });
        }
      }

      // --- Events ---------------------------------------------------------
      let eventCount = 0;
      for (const event of plan.events) {
        const participants = event.participants
          .map((participant) => ({
            personId: personIds.get(participant.xref),
            role: participant.role,
          }))
          .filter((p): p is { personId: string; role: string } => p.personId !== undefined);

        // An event with nobody in it is not an event. The mapper already
        // reported the dangling pointer that caused this.
        if (participants.length === 0) continue;

        const created = await tx.event.create({
          data: {
            treeId,
            type: event.type as 'BIRTH',
            ...(event.customType ? { customType: event.customType } : {}),
            ...(event.date ? encodeDate(event.date) : {}),
            ...(event.placeName ? { placeId: placeIds.get(event.placeName) } : {}),
            ...(event.placeName ? { placeOriginalText: event.placeName } : {}),
            ...(event.description ? { description: event.description } : {}),
            confidence: 'MEDIUM',
            participants: {
              create: participants.map((p) => ({
                personId: p.personId,
                role: p.role as 'PRINCIPAL',
              })),
            },
          },
        });
        eventCount += 1;

        for (const sourceXref of event.sourceXrefs) {
          const sourceId = sourceIds.get(sourceXref);
          if (!sourceId) continue;
          await tx.citation.create({
            data: { treeId, sourceId, eventId: created.id, confidence: 'MEDIUM' },
          });
        }
      }

      // --- Relationships --------------------------------------------------
      // What the database would refuse is refused here, before the statement
      // is sent. In PostgreSQL a refused statement aborts the whole
      // transaction: every write after it fails, and one impossible link in a
      // file of twenty thousand cost the user the other nineteen thousand
      // nine hundred and ninety-nine. The mapper already reports these cases
      // at review; this is the backstop for a plan built any other way.
      let relationshipCount = 0;
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

        await tx.relationship.create({
          data: {
            treeId,
            sourceId,
            targetId,
            type: relationship.type as 'SPOUSE',
            ...(relationship.startJdn !== null ? { startJdn: relationship.startJdn } : {}),
            ...(relationship.endJdn !== null ? { endJdn: relationship.endJdn } : {}),
            confidence: 'MEDIUM',
          },
        });
        written.add(key);
        relationshipCount += 1;
      }

      // --- Derived state ---------------------------------------------------
      await projectImportedLifespans(tx, treeId, [...personIds.values()], todayJdn);
      await tx.tree.update({ where: { id: treeId }, data: { revision: { increment: 1 } } });

      // One entry for the whole file. Eighteen thousand "person created" lines
      // would bury every other change in the history; none at all left an
      // import of eighteen thousand people without a trace of who did it.
      await recordRevision(tx, {
        treeId,
        entityType: 'Tree',
        entityId: treeId,
        action: 'IMPORT',
        actorId: options.actorId,
        after: {
          people: personIds.size,
          relationships: relationshipCount,
          events: eventCount,
          refused: rejected.length,
        },
        summary: `Import GEDCOM : ${personIds.size} personnes, ${relationshipCount} liens, ${eventCount} événements`,
        ...(options.batchId ? { batchId: options.batchId } : {}),
      });

      return {
        treeId,
        people: personIds.size,
        relationships: relationshipCount,
        events: eventCount,
        places: placeIds.size,
        sources: sourceIds.size,
      };
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 10_000 },
  );

  return { ...result, rejected };
}

/**
 * Derive living status and the lifespan cache for the people just imported.
 *
 * Living status comes from whether a death was recorded, which is the only
 * signal GEDCOM reliably carries. Someone with no death date is UNKNOWN, not
 * LIVING — a nineteenth-century ancestor with no recorded death is certainly
 * dead, and marking them living would both be wrong and quietly redact them
 * from every shared view.
 */
async function projectImportedLifespans(
  tx: Pick<Database, 'person'>,
  treeId: string,
  personIds: readonly string[],
  todayJdn: number,
): Promise<void> {
  const people = await tx.person.findMany({
    where: { treeId, id: { in: [...personIds] } },
    select: {
      id: true,
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

  for (const person of people) {
    const hasDeath = person.eventRoles.some(
      (role) => role.event.type === 'DEATH' || role.event.type === 'BURIAL',
    );
    const livingStatus = hasDeath ? 'DECEASED' : 'UNKNOWN';

    const projection = projectPersonLifespan(
      {
        livingStatus,
        events: person.eventRoles.map((role) => role.event),
        claims: person.claims,
      },
      todayJdn,
    );

    await tx.person.update({
      where: { id: person.id },
      data: { livingStatus, ...lifespanColumns(projection) },
    });
  }
}
