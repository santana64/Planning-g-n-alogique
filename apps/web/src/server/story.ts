import 'server-only';
import { cache } from 'react';
import { dateToJdn, formatGenealogicalDate, type GenealogicalDate } from '@chronolignee/domain';
import { decodeDate, loadGenealogyGraph } from '@chronolignee/db';
import {
  planLineageAscent,
  type LineChoice,
  type StoryDate,
  type StoryFact,
  type StoryHistoricalEvent,
  type StoryOccupation,
  type StoryPerson,
  type StoryPlace,
  type StoryPlan,
  type StorySource,
} from '@chronolignee/engine';
import { db } from '@/lib/db';
import { REDACTED_LABEL, isHiddenFrom, resolveTreeAccess, type TreeAccess } from './access';

/**
 * "Remonter ma lignée", ready to tell.
 *
 * The record is read once and handed to the planner, which decides the
 * scenes; only the people those scenes refer to leave the server. Dates are
 * the projected ones — an accepted claim wins over the event typed in, as
 * everywhere else — and places, occupations and sources come from the
 * events themselves, never from a proposal nobody has accepted.
 */

export interface StoryViewPerson extends StoryPerson {
  /** The birth was recorded as a baptism, the death as a burial. */
  readonly birthRecordedAs: 'birth' | 'baptism' | null;
  readonly deathRecordedAs: 'death' | 'burial' | null;
  /** Recorded migrations and naturalisations, in date order. */
  readonly moves: readonly StoryMove[];
}

export interface StoryMove {
  readonly kind: 'migration' | 'naturalization';
  readonly date: StoryDate | null;
  readonly place: StoryPlace | null;
  readonly sources: readonly StorySource[];
}

export interface StoryView {
  readonly access: TreeAccess;
  readonly subjectId: string;
  readonly subjectName: string;
  readonly subjectHidden: boolean;
  readonly line: LineChoice;
  readonly plan: StoryPlan | null;
  readonly people: Readonly<Record<string, StoryViewPerson>>;
  readonly history: Readonly<Record<string, StoryHistoricalEvent>>;
}

const VITAL_TYPES = [
  'BIRTH',
  'BAPTISM',
  'DEATH',
  'BURIAL',
  'OCCUPATION',
  'MIGRATION',
  'NATURALIZATION',
] as const;

function toStoryDate(date: GenealogicalDate | null | undefined): StoryDate | null {
  if (!date || date.unparsed || date.qualifier === 'UNKNOWN') return null;
  return {
    label: formatGenealogicalDate(date),
    earliestJdn: date.interval.earliest,
    latestJdn: date.interval.latest,
  };
}

export const loadLineageStory = cache(
  async (treeSlug: string, subjectId: string, line: LineChoice): Promise<StoryView | null> => {
    const access = await resolveTreeAccess(treeSlug);
    if (!access) return null;

    const graph = await loadGenealogyGraph(db, access.treeId, dateToJdn(new Date()));
    const subject = graph.people.get(subjectId);
    if (!subject) return null;

    const hidden = (personId: string) =>
      isHiddenFrom(
        { isLiving: graph.people.get(personId)?.isDeceased === false },
        access.redactLiving,
      );

    const base = { access, subjectId, line, people: {}, history: {} };
    if (hidden(subjectId)) {
      return { ...base, subjectName: REDACTED_LABEL, subjectHidden: true, plan: null };
    }

    // Everyone the ascent could reach, and no one else.
    const reachable = new Set<string>([subjectId]);
    for (const id of graph.ancestorsOf(subjectId, { biologicalOnly: true }).order) {
      reachable.add(id);
    }
    const ids = [...reachable];

    const [events, historicalRows] = await Promise.all([
      db.event.findMany({
        where: {
          treeId: access.treeId,
          deletedAt: null,
          type: { in: [...VITAL_TYPES] },
          participants: { some: { personId: { in: ids }, role: 'PRINCIPAL' } },
        },
        orderBy: [{ dateSortJdn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        select: {
          type: true,
          description: true,
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
          place: { select: { id: true, name: true, latitude: true, longitude: true } },
          participants: {
            where: { personId: { in: ids }, role: 'PRINCIPAL' },
            select: { personId: true },
          },
          citations: {
            select: { locator: true, page: true, source: { select: { title: true } } },
          },
        },
      }),
      db.treeHistoricalEvent.findMany({
        where: { treeId: access.treeId },
        select: {
          historicalEvent: {
            select: {
              id: true,
              title: true,
              startJdn: true,
              endJdn: true,
              significance: true,
              category: true,
            },
          },
        },
      }),
    ]);

    type EventRow = (typeof events)[number];
    const byPerson = new Map<string, EventRow[]>();
    for (const event of events) {
      for (const participant of event.participants) {
        const list = byPerson.get(participant.personId);
        if (list) list.push(event);
        else byPerson.set(participant.personId, [event]);
      }
    }

    const sourcesOf = (event: EventRow | undefined): StorySource[] =>
      (event?.citations ?? []).map((citation) => ({
        title: citation.source.title,
        locator: [citation.locator, citation.page].filter(Boolean).join(', ') || null,
      }));
    const placeOf = (event: EventRow | undefined) =>
      event?.place
        ? {
            id: event.place.id,
            name: event.place.name,
            latitude: event.place.latitude,
            longitude: event.place.longitude,
          }
        : null;

    const people = new Map<string, StoryViewPerson>();
    for (const id of ids) {
      const person = graph.people.get(id);
      if (!person) continue;
      const personHidden = hidden(id);
      const own = byPerson.get(id) ?? [];
      const birthEvent = own.find((event) => event.type === 'BIRTH');
      const baptismEvent = own.find((event) => event.type === 'BAPTISM');
      const deathEvent = own.find((event) => event.type === 'DEATH');
      const burialEvent = own.find((event) => event.type === 'BURIAL');
      const birthSource = birthEvent ?? baptismEvent;
      const deathSource = deathEvent ?? burialEvent;
      const birthDate = toStoryDate(person.birth);
      const deathDate = toStoryDate(person.death);

      const birth: StoryFact | null =
        birthDate || birthSource
          ? { date: birthDate, place: placeOf(birthSource), sources: sourcesOf(birthSource) }
          : null;
      const death: StoryFact | null =
        deathDate || deathSource
          ? { date: deathDate, place: placeOf(deathSource), sources: sourcesOf(deathSource) }
          : null;
      const occupations: StoryOccupation[] = own
        .filter((event) => event.type === 'OCCUPATION' && event.description)
        .map((event) => ({
          label: event.description as string,
          date: toStoryDate(decodeDate(event)),
          sources: sourcesOf(event),
        }));

      const moves: StoryMove[] = own
        .filter((event) => event.type === 'MIGRATION' || event.type === 'NATURALIZATION')
        .map((event) => ({
          kind: event.type === 'MIGRATION' ? 'migration' : 'naturalization',
          date: toStoryDate(decodeDate(event)),
          place: placeOf(event),
          sources: sourcesOf(event),
        }));

      const parents = graph.parentsOf(id, true).map((edge) => edge.sourceId);
      const sexOf = (parentId: string) => graph.people.get(parentId)?.recordedSex ?? null;

      people.set(id, {
        id,
        name: personHidden ? REDACTED_LABEL : person.displayName,
        recordedSex: personHidden ? null : (person.recordedSex ?? null),
        hidden: personHidden,
        birth: personHidden ? null : birth,
        death: personHidden ? null : death,
        occupations: personHidden ? [] : occupations,
        // A parent of unrecorded sex is neither "father" nor "mother": the
        // story would otherwise state something the record does not.
        fatherId: parents.find((parentId) => sexOf(parentId) === 'MALE') ?? null,
        motherId: parents.find((parentId) => sexOf(parentId) === 'FEMALE') ?? null,
        birthRecordedAs:
          personHidden || !birth ? null : birthEvent || !baptismEvent ? 'birth' : 'baptism',
        deathRecordedAs:
          personHidden || !death ? null : deathEvent || !burialEvent ? 'death' : 'burial',
        moves: personHidden ? [] : moves,
        migrated: !personHidden && moves.length > 0,
      });
    }

    const historical = historicalRows.map((row) => row.historicalEvent);
    const plan = planLineageAscent(subjectId, people, historical, line);

    // Only what the scenes refer to leaves the server.
    const referenced = new Set<string>();
    const eventIds = new Set<string>();
    for (const scene of plan?.scenes ?? []) {
      switch (scene.kind) {
        case 'person-focus':
          referenced.add(scene.personId);
          break;
        case 'ancestor-step':
        case 'migration':
          referenced.add(scene.childId);
          referenced.add(scene.parentId);
          break;
        case 'historical-context':
          referenced.add(scene.personId);
          eventIds.add(scene.eventId);
          break;
        case 'end':
          referenced.add(scene.personId);
          break;
      }
    }

    return {
      ...base,
      subjectName: subject.displayName,
      subjectHidden: false,
      plan,
      people: Object.fromEntries(
        [...referenced].flatMap((id) => {
          const person = people.get(id);
          // The links upward did their work in the planner; sent on, they
          // would point at people the scenes never mention.
          return person ? [[id, { ...person, fatherId: null, motherId: null }]] : [];
        }),
      ),
      history: Object.fromEntries(
        historical.filter((event) => eventIds.has(event.id)).map((event) => [event.id, event]),
      ),
    };
  },
);
