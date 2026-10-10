import 'server-only';
import { getLocale } from 'next-intl/server';
import { cache } from 'react';
import {
  dateToJdn,
  formatGenealogicalDate,
  isPresumedLiving,
  type GenealogicalDate,
} from '@chronolignee/domain';
import { decodeDate, loadEvidenceCoverage, loadHistoricalContext } from '@chronolignee/db';
import {
  chooseStoriesByRules,
  findStoryCandidates,
  planLineageAscent,
  type LineChoice,
  type StoryCandidateFacts,
  type StoryDate,
  type StoryFact,
  type StoryHistoricalEvent,
  type StoryOccupation,
  type StoryPerson,
  type StoryPlace,
  type StoryPlan,
  type StorySource,
} from '@chronolignee/engine';
import type { GenealogyGraph } from '@chronolignee/genealogy';
import { db } from '@/lib/db';
import { treeGraph } from './graph-cache';
import { describeCandidate, renderStory, type RenderedChapter } from '@/components/story/sentences';
import {
  REDACTED_LABEL,
  graphSubject,
  hiddenInGraph,
  resolveTreeAccess,
  type TreeAccess,
} from './access';

/**
 * Stories, ready to tell.
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

/** The reader's language, for the words a story is told in. */
async function readerLocale(): Promise<'fr' | 'en'> {
  return (await getLocale()) === 'en' ? 'en' : 'fr';
}

function toStoryDate(
  date: GenealogicalDate | null | undefined,
  locale: 'fr' | 'en',
): StoryDate | null {
  if (!date || date.unparsed || date.qualifier === 'UNKNOWN') return null;
  return {
    label: formatGenealogicalDate(date, { locale }),
    earliestJdn: date.interval.earliest,
    latestJdn: date.interval.latest,
  };
}

/**
 * The facts a story can use, for the given people: projected dates, places,
 * occupations, moves and their sources. Anyone `hidden` says of is present
 * only as a name-less placeholder, so that a line stops before them rather
 * than skipping over them.
 */
async function readStoryRecord(
  treeId: string,
  graph: GenealogyGraph,
  ids: readonly string[],
  hidden: (personId: string) => boolean,
  locale: 'fr' | 'en',
): Promise<{
  people: Map<string, StoryViewPerson>;
  historical: StoryHistoricalEvent[];
}> {
  const [events, historicalRows] = await Promise.all([
    db.event.findMany({
      where: {
        treeId,
        deletedAt: null,
        type: { in: [...VITAL_TYPES] },
        participants: { some: { personId: { in: [...ids] }, role: 'PRINCIPAL' } },
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
        place: {
          select: { id: true, name: true, latitude: true, longitude: true, countryCode: true },
        },
        participants: {
          where: { personId: { in: [...ids] }, role: 'PRINCIPAL' },
          select: { personId: true },
        },
        citations: {
          select: { locator: true, page: true, source: { select: { title: true } } },
        },
      },
    }),
    // Every life of the story is inside the tree's span, so the tree's
    // historical context is the story's.
    loadHistoricalContext(db, treeId, { fromJdn: 0, toJdn: 99_999_999 }),
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
  const placeOf = (event: EventRow | undefined): StoryPlace | null =>
    event?.place
      ? {
          id: event.place.id,
          name: event.place.name,
          latitude: event.place.latitude,
          longitude: event.place.longitude,
          countryCode: event.place.countryCode,
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
    const birthDate = toStoryDate(person.birth, locale);
    const deathDate = toStoryDate(person.death, locale);

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
        date: toStoryDate(decodeDate(event), locale),
        sources: sourcesOf(event),
      }));
    const moves: StoryMove[] = own
      .filter((event) => event.type === 'MIGRATION' || event.type === 'NATURALIZATION')
      .map((event) => ({
        kind: event.type === 'MIGRATION' ? 'migration' : 'naturalization',
        date: toStoryDate(decodeDate(event), locale),
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

  return {
    people,
    historical: historicalRows.map((event) => ({
      ...event,
      countryCodes: [...event.countryCodes],
    })),
  };
}

/** Only what a plan refers to leaves the server, without links to anyone else. */
function referencedBy(
  plan: StoryPlan | null,
  people: ReadonlyMap<string, StoryViewPerson>,
  historical: readonly StoryHistoricalEvent[],
): Pick<StoryView, 'people' | 'history'> {
  const ids = new Set<string>();
  const eventIds = new Set<string>();
  for (const scene of plan?.scenes ?? []) {
    switch (scene.kind) {
      case 'ancestor-step':
      case 'migration':
        ids.add(scene.childId);
        ids.add(scene.parentId);
        break;
      case 'historical-context':
        ids.add(scene.personId);
        eventIds.add(scene.eventId);
        break;
      case 'person-focus':
      case 'end':
        ids.add(scene.personId);
        break;
    }
  }
  return {
    people: Object.fromEntries(
      [...ids].flatMap((id) => {
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
}

export const loadLineageStory = cache(
  async (treeSlug: string, subjectId: string, line: LineChoice): Promise<StoryView | null> => {
    const access = await resolveTreeAccess(treeSlug);
    if (!access) return null;

    const graph = await treeGraph(access.treeId, dateToJdn(new Date()));
    const subject = graph.people.get(subjectId);
    if (!subject) return null;

    const hidden = hiddenInGraph(graph, access);

    const base = { access, subjectId, line, people: {}, history: {} };
    if (hidden(subjectId)) {
      return { ...base, subjectName: REDACTED_LABEL, subjectHidden: true, plan: null };
    }

    // Everyone the ascent could reach, and no one else.
    const ids = [
      subjectId,
      ...graph
        .ancestorsOf(subjectId, { biologicalOnly: true })
        .order.filter((id) => id !== subjectId),
    ];
    const { people, historical } = await readStoryRecord(
      access.treeId,
      graph,
      ids,
      hidden,
      await readerLocale(),
    );
    const plan = planLineageAscent(subjectId, people, historical, line);

    return {
      ...base,
      subjectName: subject.displayName,
      subjectHidden: false,
      plan,
      ...referencedBy(plan, people, historical),
    };
  },
);

export interface StorySuggestion {
  readonly id: string;
  readonly kind: StoryCandidateFacts['kind'];
  readonly title: string;
  readonly reason: string;
  readonly chapters: readonly RenderedChapter[];
}

export interface StorySuggestionsView {
  readonly access: TreeAccess;
  /** Every candidate worth offering, strongest first, each ready to read. */
  readonly suggestions: readonly StorySuggestion[];
  /** The ids the rules would present, in order. */
  readonly rulesChoice: readonly string[];
}

const OFFERED = 8;
const PRESENTED = 4;

/**
 * The Director's candidates for this tree.
 *
 * Living people are left out of every pattern, whoever is looking. A
 * suggestion is family history offered unprompted — and, when an editor asks
 * a model to choose among them, the one thing sent outside — so it keeps to
 * the dead even for the people entitled to see the living.
 */
export const loadStorySuggestions = cache(
  async (treeSlug: string): Promise<StorySuggestionsView | null> => {
    const access = await resolveTreeAccess(treeSlug);
    if (!access) return null;

    const graph = await treeGraph(access.treeId, dateToJdn(new Date()));
    // Presumed living — the same presumption as every redaction — whoever
    // is looking, and anyone this viewer may not see in any case.
    const todayJdn = dateToJdn(new Date());
    const hidden = hiddenInGraph(graph, access);
    const excluded = (personId: string) =>
      hidden(personId) || isPresumedLiving(graphSubject(graph.people.get(personId)), todayJdn);
    const ids = [...graph.people.keys()];
    const locale = await readerLocale();
    const [{ people, historical }, coverage] = await Promise.all([
      readStoryRecord(access.treeId, graph, ids, excluded, locale),
      loadEvidenceCoverage(db, access.treeId),
    ]);

    const candidates = findStoryCandidates({ people, coverage, historical }).slice(0, OFFERED);
    const suggestions = candidates.map((candidate) => {
      const described = describeCandidate(candidate.facts, candidate.subjectId, people, locale);
      const told = referencedBy(candidate.plan, people, historical);
      return {
        id: candidate.id,
        kind: candidate.facts.kind,
        ...described,
        chapters: renderStory({ plan: candidate.plan, ...told, locale }),
      };
    });

    return {
      access,
      suggestions,
      rulesChoice: chooseStoriesByRules(candidates, PRESENTED).map((candidate) => candidate.id),
    };
  },
);
