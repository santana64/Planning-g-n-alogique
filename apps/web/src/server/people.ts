import 'server-only';
import { cache } from 'react';
import {
  dateToJdn,
  formatGenealogicalDate,
  formatYearOnly,
  type GenealogicalDate,
  type PersonPrivacy,
} from '@chronolignee/domain';
import { decodeDate, foldName, projectPersonLifespan } from '@chronolignee/db';
import { auditPerson, sortBySeverity, type Finding } from '@chronolignee/genealogy';
import { db } from '@/lib/db';
import { treeGraph } from './graph-cache';
import {
  REDACTED_LABEL,
  isHiddenFrom,
  privacySubjectFromColumns,
  resolveTreeAccess,
  type TreeAccess,
} from './access';
import { loadCitationsForPerson, type EventCitation } from './archive';
import { EVENT_LABELS } from '@/lib/labels';

/**
 * Reads for the editing screens.
 *
 * Separate from `timeline.ts` on purpose. The timeline needs positions and
 * certainty for every person at once; an editor needs one person in full —
 * their names, their events, their links, and what the validator thinks of
 * them. Serving one from the other would mean either loading the whole tree
 * to edit one row, or shipping the editor a projection that quietly lacks the
 * fields it has to write back.
 */

export type RecordedSex = 'MALE' | 'FEMALE' | 'INTERSEX' | 'UNKNOWN';
export type LivingStatus = 'LIVING' | 'DECEASED' | 'UNKNOWN';

export interface PersonSummary {
  readonly personId: string;
  readonly displayName: string;
  readonly recordedSex: RecordedSex;
  readonly lifespanLabel: string;
  readonly isLiving: boolean;
  readonly redacted: boolean;
}

export interface PeopleListing {
  readonly access: TreeAccess;
  readonly people: readonly PersonSummary[];
  readonly total: number;
  readonly query: string;
  /** True when more people match than this page shows. */
  readonly truncated: boolean;
}

export const PEOPLE_PAGE_SIZE = 60;

/** What the privacy rule reads from a person row. */
const PRIVACY_COLUMNS = {
  livingStatus: true,
  privacy: true,
  lifespanEarliestJdn: true,
  lifespanLatestJdn: true,
  lifespanLatestInferred: true,
} as const;

/**
 * The person list, optionally filtered.
 *
 * The filter folds the query the same way `searchName` was folded on write —
 * "Lefevre" finds LEFÈVRE — and the substring match rides the trigram index
 * rather than scanning. Folding in only one of the two places is the classic
 * way a search silently stops finding people.
 */
export async function listPeople(
  treeSlug: string,
  rawQuery: string,
): Promise<PeopleListing | null> {
  const access = await resolveTreeAccess(treeSlug);
  if (!access) return null;

  const query = rawQuery.trim();
  const folded = foldName(query);
  const where = {
    treeId: access.treeId,
    deletedAt: null,
    ...(folded ? { searchName: { contains: folded } } : {}),
  };

  const select = {
    id: true,
    displayName: true,
    recordedSex: true,
    birthSortJdn: true,
    ...PRIVACY_COLUMNS,
  } as const;
  // Chronological, because a genealogy list sorted alphabetically tells you
  // nothing about the family; sorted by birth it reads as generations. Nulls
  // last so people with no date do not head the list.
  const orderBy = [
    { birthSortJdn: { sort: 'asc' as const, nulls: 'last' as const } },
    { displayName: 'asc' as const },
  ];
  const hiddenRow = (row: Parameters<typeof privacySubjectFromColumns>[0]) =>
    isHiddenFrom(privacySubjectFromColumns(row), access);

  let rows;
  let total;
  if (folded) {
    // A search by name only looks among the names this viewer may read. A
    // protected row among the results for "valentina" would say a Valentina
    // is in the tree — the one thing the protection is there to keep.
    const matches = await db.person.findMany({ where, select, orderBy });
    const readable = matches.filter((row) => !hiddenRow(row));
    rows = readable.slice(0, PEOPLE_PAGE_SIZE + 1);
    total = readable.length;
  } else {
    [rows, total] = await Promise.all([
      db.person.findMany({ where, select, orderBy, take: PEOPLE_PAGE_SIZE + 1 }),
      db.person.count({ where }),
    ]);
  }

  const truncated = rows.length > PEOPLE_PAGE_SIZE;
  const people = rows.slice(0, PEOPLE_PAGE_SIZE).map((row): PersonSummary => {
    const isLiving = row.livingStatus === 'LIVING';
    const hidden = hiddenRow(row);

    return {
      personId: row.id,
      displayName: hidden ? REDACTED_LABEL : row.displayName,
      // Sex and status go with the name too: a ♀ and "living" beside a hidden
      // row describe the person the row is hiding. The picker receives these
      // rows as data, where no component decides what to show.
      recordedSex: hidden ? 'UNKNOWN' : row.recordedSex,
      // The years go with the name. Publishing "1962 – " next to a hidden
      // name still says when that person was born.
      lifespanLabel: hidden
        ? '—'
        : lifespanLabelOf(row.lifespanEarliestJdn, row.lifespanLatestJdn, isLiving),
      isLiving: hidden ? false : isLiving,
      redacted: hidden,
    };
  });

  return { access, people, total, query, truncated };
}

function lifespanLabelOf(
  earliest: number | null,
  latest: number | null,
  isLiving: boolean,
): string {
  const from = earliest === null ? '?' : String(jdnYear(earliest));
  if (isLiving) return `${from} – `;
  const to = latest === null ? '?' : String(jdnYear(latest));
  return `${from} – ${to}`;
}

/** Year of a JDN, for list labels only; the domain owns real formatting. */
function jdnYear(jdn: number): number {
  // Gregorian proleptic year, derived rather than stored: the list shows a
  // year, not a date, and rounding a year is safe where rounding a day is not.
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return 100 * b + d - 4800 + Math.floor(m / 10);
}

export interface PersonNameRow {
  readonly type: string;
  readonly prefix: string;
  readonly given: string;
  readonly surnamePrefix: string;
  readonly surname: string;
  readonly suffix: string;
  readonly nickname: string;
  readonly isPreferred: boolean;
  readonly confidence: string;
}

export interface PersonEventRow {
  readonly eventId: string;
  readonly type: string;
  readonly label: string;
  readonly dateLabel: string;
  /**
   * What the register actually said, for seeding a correction field.
   *
   * Not the same as `dateLabel`: round-tripping "vers 1750" through a
   * formatter and back would hand the researcher a rewrite of their own
   * words and then save it as though they had typed it.
   */
  readonly dateText: string;
  readonly placeName: string | null;
  /** True when the date was kept verbatim because it could not be read. */
  readonly dateUnparsed: boolean;
  /**
   * What this event rests on.
   *
   * Carried with the event rather than fetched separately by the client,
   * because "is this sourced" is the first question a reader should be able
   * to answer about any fact on the page.
   */
  readonly citations: readonly EventCitation[];
}

export interface PersonLinkRow {
  readonly relationshipId: string;
  readonly otherId: string;
  readonly otherName: string;
  readonly otherRedacted: boolean;
  readonly type: string;
  /** How this person stands in the link, from their own point of view. */
  readonly direction: 'PARENT' | 'CHILD' | 'PEER';
}

export interface PersonDetail {
  readonly access: TreeAccess;
  readonly personId: string;
  readonly displayName: string;
  readonly recordedSex: RecordedSex;
  readonly livingStatus: LivingStatus;
  /** Who may see this person; null when this viewer may not. */
  readonly privacy: PersonPrivacy | null;
  readonly notes: string;
  readonly names: readonly PersonNameRow[];
  readonly birthDateText: string;
  readonly birthPlaceName: string;
  readonly deathDateText: string;
  readonly deathPlaceName: string;
  readonly birthLabel: string;
  readonly deathLabel: string;
  /**
   * Whether the date shown comes from an accepted claim rather than the
   * event typed on the form. When it does and the two differ, the page says
   * so: the disagreement is research information, not an inconsistency to
   * hide.
   */
  readonly birthFromClaim: boolean;
  readonly deathFromClaim: boolean;
  readonly events: readonly PersonEventRow[];
  readonly links: readonly PersonLinkRow[];
  readonly findings: readonly Finding[];
  readonly redacted: boolean;
}

export { EVENT_LABELS } from '@/lib/labels';

const PARENT_TYPES = new Set([
  'PARENT_BIOLOGICAL',
  'PARENT_ADOPTIVE',
  'PARENT_FOSTER',
  'PARENT_STEP',
  'PARENT_GUARDIAN',
  'PARENT_UNKNOWN',
]);

/**
 * One person, everything the editor needs.
 *
 * The findings come from the same validator the write path consults, so what
 * the form warns about and what a save would refuse cannot drift apart.
 */
export const loadPersonDetail = cache(
  async (treeSlug: string, personId: string): Promise<PersonDetail | null> => {
    const access = await resolveTreeAccess(treeSlug);
    if (!access) return null;

    const person = await db.person.findFirst({
      where: { id: personId, treeId: access.treeId, deletedAt: null },
      select: {
        id: true,
        displayName: true,
        recordedSex: true,
        notes: true,
        ...PRIVACY_COLUMNS,
        names: {
          orderBy: [{ isPreferred: 'desc' }, { createdAt: 'asc' }],
          select: {
            type: true,
            prefix: true,
            given: true,
            surnamePrefix: true,
            surname: true,
            suffix: true,
            nickname: true,
            isPreferred: true,
            confidence: true,
          },
        },
      },
    });
    if (!person) return null;

    const hidden = isHiddenFrom(privacySubjectFromColumns(person), access);

    const eventRows = await db.event.findMany({
      where: {
        treeId: access.treeId,
        deletedAt: null,
        participants: { some: { personId: person.id } },
      },
      orderBy: [{ dateSortJdn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      select: {
        id: true,
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
        place: { select: { name: true } },
      },
    });

    const relationshipRows = await db.relationship.findMany({
      where: {
        treeId: access.treeId,
        deletedAt: null,
        OR: [{ sourceId: person.id }, { targetId: person.id }],
      },
      select: {
        id: true,
        type: true,
        sourceId: true,
        targetId: true,
        source: { select: { id: true, displayName: true, ...PRIVACY_COLUMNS } },
        target: { select: { id: true, displayName: true, ...PRIVACY_COLUMNS } },
      },
    });

    const links = relationshipRows.map((row): PersonLinkRow => {
      const isSource = row.sourceId === person.id;
      const other = isSource ? row.target : row.source;
      const otherHidden = isHiddenFrom(privacySubjectFromColumns(other), access);

      return {
        relationshipId: row.id,
        otherId: other.id,
        otherName: otherHidden ? REDACTED_LABEL : other.displayName,
        otherRedacted: otherHidden,
        type: row.type,
        direction: PARENT_TYPES.has(row.type) ? (isSource ? 'PARENT' : 'CHILD') : 'PEER',
      };
    });

    const todayJdn = dateToJdn(new Date());
    const graph = await treeGraph(access.treeId, todayJdn);
    const findings = sortBySeverity(auditPerson(graph, person.id, { todayJdn }));

    const vital = (type: 'BIRTH' | 'DEATH') => eventRows.find((event) => event.type === type);
    const birth = vital('BIRTH');
    const death = vital('DEATH');

    // The dates this page shows come from the same resolution the timeline
    // and the list use: an accepted claim wins over an event, and a baptism
    // stands in for an unrecorded birth. Reading the birth event directly
    // here, as this page once did, meant accepting "12 juin 1822" moved the
    // person on the timeline while their own record still said "1823".
    const acceptedClaims = await db.claim.findMany({
      where: {
        treeId: access.treeId,
        personId: person.id,
        status: 'ACCEPTED',
        predicate: { in: ['BIRTH_DATE', 'BAPTISM_DATE', 'DEATH_DATE', 'BURIAL_DATE'] },
      },
      select: { predicate: true, status: true, value: true },
    });
    const projection = projectPersonLifespan(
      { livingStatus: person.livingStatus, events: eventRows, claims: acceptedClaims },
      todayJdn,
    );
    const claimDated = (predicates: readonly string[]) =>
      acceptedClaims.some(
        (claim) =>
          predicates.includes(claim.predicate) &&
          typeof (claim.value as { date?: unknown } | null)?.date === 'string',
      );
    const resolved = (date: GenealogicalDate) =>
      date.interval.earliest === null && date.interval.latest === null ? null : date;

    // The whole list goes, not just its dates. Blanking the date while still
    // listing "Divorce", "Naturalisation" or "Service militaire" publishes
    // facts about a living person that the redaction exists to protect — the
    // event type is the sensitive part, and the date was only ever the part
    // that was easy to notice.
    // Citations for every one of this person's events, in one query rather
    // than one per row.
    const citationsByEvent = hidden
      ? new Map<string, EventCitation[]>()
      : await loadCitationsForPerson(access.treeId, person.id);

    const events = hidden
      ? []
      : eventRows.map((event): PersonEventRow => {
          const date = decodeDate(event);
          return {
            eventId: event.id,
            type: event.type,
            label:
              event.type === 'CUSTOM'
                ? (event.customType ?? 'Autre')
                : (EVENT_LABELS[event.type] ?? event.type),
            dateLabel: dateLabelOf(date, event.dateOriginalText),
            dateText: event.dateOriginalText,
            placeName: event.place?.name ?? null,
            dateUnparsed: event.dateUnparsed,
            citations: citationsByEvent.get(event.id) ?? [],
          };
        });

    return {
      access,
      personId: person.id,
      // A member editing their own tree is never redacted; this branch covers
      // a public visitor who followed a link to a living person's page.
      displayName: hidden ? REDACTED_LABEL : person.displayName,
      recordedSex: hidden ? 'UNKNOWN' : person.recordedSex,
      livingStatus: hidden ? 'UNKNOWN' : person.livingStatus,
      privacy: hidden ? null : person.privacy,
      notes: hidden ? '' : (person.notes ?? ''),
      names: hidden ? [] : person.names.map(toNameRow),
      // The form is seeded with the text the archive actually had, not with a
      // re-rendering of it: round-tripping "vers 1750" through a formatter and
      // back would rewrite the researcher's own words.
      birthDateText: hidden ? '' : (birth?.dateOriginalText ?? ''),
      birthPlaceName: hidden ? '' : (birth?.place?.name ?? ''),
      deathDateText: hidden ? '' : (death?.dateOriginalText ?? ''),
      deathPlaceName: hidden ? '' : (death?.place?.name ?? ''),
      birthLabel: hidden ? '—' : dateLabelOf(resolved(projection.birth), birth?.dateOriginalText),
      deathLabel: hidden ? '—' : dateLabelOf(resolved(projection.death), death?.dateOriginalText),
      birthFromClaim: !hidden && claimDated(['BIRTH_DATE', 'BAPTISM_DATE']),
      deathFromClaim: !hidden && claimDated(['DEATH_DATE', 'BURIAL_DATE']),
      events,
      links,
      findings: hidden ? [] : findings,
      redacted: hidden,
    };
  },
);

function toNameRow(name: {
  type: string;
  prefix: string | null;
  given: string | null;
  surnamePrefix: string | null;
  surname: string | null;
  suffix: string | null;
  nickname: string | null;
  isPreferred: boolean;
  confidence: string;
}): PersonNameRow {
  return {
    type: name.type,
    prefix: name.prefix ?? '',
    given: name.given ?? '',
    surnamePrefix: name.surnamePrefix ?? '',
    surname: name.surname ?? '',
    suffix: name.suffix ?? '',
    nickname: name.nickname ?? '',
    isPreferred: name.isPreferred,
    confidence: name.confidence,
  };
}

/**
 * A date as a reader should see it.
 *
 * An unreadable date falls back to what the register said, verbatim. Showing
 * "—" there would hide the one piece of evidence a researcher needs in order
 * to fix it.
 */
function dateLabelOf(date: GenealogicalDate | null, original: string | null | undefined): string {
  if (date && !date.unparsed) return formatGenealogicalDate(date);
  if (original) return original;
  return '—';
}

export { formatYearOnly };
