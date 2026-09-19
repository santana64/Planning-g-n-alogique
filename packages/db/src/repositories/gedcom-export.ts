import type {
  ImportEvent,
  ImportName,
  ImportPerson,
  ImportPlan,
  ImportRelationship,
  ImportSource,
} from '@chronolignee/gedcom';
import type { RelationshipType } from '@chronolignee/genealogy';
import type { Database } from '../client';
import { decodeDate } from '../date-codec';

/**
 * A whole tree as a GEDCOM plan, ready for the writer.
 *
 * The same structure an import produces, so the writer that round-trips
 * imported files is the one that writes exports, and every guarantee it
 * carries — a date kept as uncertain as it was recorded, an unreadable date
 * kept as a phrase — applies here too.
 *
 * Everyone in the tree, living and restricted people included: the export is
 * for those allowed to take the whole tree away, and a copy that silently
 * left people out would be a corrupted backup. Archived rows stay out.
 */

const NAME_TYPES: Readonly<Record<string, ImportName['type']>> = {
  BIRTH: 'BIRTH',
  MARRIED: 'MARRIED',
  AKA: 'AKA',
  NICKNAME: 'AKA',
};

export async function buildGedcomPlan(db: Database, treeId: string): Promise<ImportPlan> {
  const [people, relationships, events, sources] = await Promise.all([
    db.person.findMany({
      where: { treeId, deletedAt: null },
      select: {
        id: true,
        recordedSex: true,
        notes: true,
        names: {
          select: {
            type: true,
            prefix: true,
            given: true,
            surnamePrefix: true,
            surname: true,
            suffix: true,
            nickname: true,
            isPreferred: true,
            displayForm: true,
          },
          orderBy: [{ isPreferred: 'desc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.relationship.findMany({
      where: { treeId, deletedAt: null },
      select: { sourceId: true, targetId: true, type: true, startJdn: true, endJdn: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.event.findMany({
      where: { treeId, deletedAt: null },
      select: {
        type: true,
        customType: true,
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
        placeOriginalText: true,
        place: { select: { name: true } },
        description: true,
        participants: { select: { personId: true, role: true } },
        citations: { select: { sourceId: true } },
      },
      orderBy: [{ dateSortJdn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    }),
    db.source.findMany({
      where: { treeId, deletedAt: null },
      select: {
        id: true,
        title: true,
        author: true,
        publisher: true,
        repository: true,
        callNumber: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const personXref = new Map(people.map((person, index) => [person.id, `@I${index + 1}@`]));
  const sourceXref = new Map(sources.map((source, index) => [source.id, `@S${index + 1}@`]));

  const planPeople: ImportPerson[] = people.map((person) => ({
    xref: personXref.get(person.id) as string,
    names: person.names.map((name) => ({
      given: name.given ?? undefined,
      // GEDCOM has one surname field; "de La Fontaine" keeps its particle.
      surname: [name.surnamePrefix, name.surname].filter(Boolean).join(' ') || undefined,
      prefix: name.prefix ?? undefined,
      suffix: name.suffix ?? undefined,
      nickname: name.nickname ?? undefined,
      type: NAME_TYPES[name.type] ?? 'OTHER',
      isPreferred: name.isPreferred,
      original: name.displayForm ?? '',
    })),
    recordedSex: person.recordedSex,
    notes: person.notes ? [person.notes] : [],
    sourceXrefs: [],
    unhandledTags: [],
  }));

  const planEvents: ImportEvent[] = [];
  for (const event of events) {
    const participants = event.participants.flatMap((participant) => {
      const xref = personXref.get(participant.personId);
      return xref ? [{ xref, role: participant.role }] : [];
    });
    // An event whose people are all archived belongs to nobody in the file.
    if (participants.length === 0) continue;
    planEvents.push({
      type: event.type,
      customType: event.customType ?? undefined,
      date: event.dateQualifier ? decodeDate(event) : null,
      placeName: event.place?.name ?? event.placeOriginalText ?? undefined,
      description: event.description ?? undefined,
      participants,
      sourceXrefs: [
        ...new Set(
          event.citations.flatMap((citation) => {
            const xref = sourceXref.get(citation.sourceId);
            return xref ? [xref] : [];
          }),
        ),
      ],
    });
  }

  const planRelationships: ImportRelationship[] = relationships.flatMap((relationship) => {
    const sourceXrefOf = personXref.get(relationship.sourceId);
    const targetXrefOf = personXref.get(relationship.targetId);
    return sourceXrefOf && targetXrefOf
      ? [
          {
            sourceXref: sourceXrefOf,
            targetXref: targetXrefOf,
            type: relationship.type as RelationshipType,
            startJdn: relationship.startJdn,
            endJdn: relationship.endJdn,
          },
        ]
      : [];
  });

  const planSources: ImportSource[] = sources.map((source) => ({
    xref: sourceXref.get(source.id) as string,
    title: source.title,
    author: source.author ?? undefined,
    publication: source.publisher ?? undefined,
    repository: source.repository ?? undefined,
    callNumber: source.callNumber ?? undefined,
  }));

  return {
    people: planPeople,
    relationships: planRelationships,
    events: planEvents,
    sources: planSources,
    places: [],
    warnings: [],
    unknownTags: [],
    counts: {
      people: planPeople.length,
      families: 0,
      events: planEvents.length,
      sources: planSources.length,
      places: 0,
      media: 0,
      relationships: planRelationships.length,
      unparseableDates: planEvents.filter((event) => event.date?.unparsed).length,
    },
  };
}
