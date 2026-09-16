import 'server-only';
import { cache } from 'react';
import {
  dateToJdn,
  formatGenealogicalDate,
  formatYearOnly,
  type GenealogicalDate,
} from '@chronolignee/domain';
import { decodeDate, foldName, loadGenealogyGraph } from '@chronolignee/db';
import { auditPerson, sortBySeverity, type Finding } from '@chronolignee/genealogy';
import { db } from '@/lib/db';
import { REDACTED_LABEL, isHiddenFrom, resolveTreeAccess, type TreeAccess } from './access';

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

  const [rows, total] = await Promise.all([
    db.person.findMany({
      where,
      select: {
        id: true,
        displayName: true,
        recordedSex: true,
        livingStatus: true,
        birthSortJdn: true,
        lifespanEarliestJdn: true,
        lifespanLatestJdn: true,
      },
      // Chronological, because a genealogy list sorted alphabetically tells
      // you nothing about the family; sorted by birth it reads as generations.
      // Nulls last so people with no date do not head the list.
      orderBy: [{ birthSortJdn: { sort: 'asc', nulls: 'last' } }, { displayName: 'asc' }],
      take: PEOPLE_PAGE_SIZE + 1,
    }),
    db.person.count({ where }),
  ]);

  const truncated = rows.length > PEOPLE_PAGE_SIZE;
  const people = rows.slice(0, PEOPLE_PAGE_SIZE).map((row): PersonSummary => {
    const isLiving = row.livingStatus === 'LIVING';
    const hidden = isHiddenFrom({ isLiving }, access.redactLiving);

    return {
      personId: row.id,
      displayName: hidden ? REDACTED_LABEL : row.displayName,
      recordedSex: row.recordedSex,
      // The years go with the name. Publishing "1962 – " next to a hidden
      // name still says when that person was born.
      lifespanLabel: hidden
        ? '—'
        : lifespanLabelOf(row.lifespanEarliestJdn, row.lifespanLatestJdn, isLiving),
      isLiving,
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
  readonly notes: string;
  readonly names: readonly PersonNameRow[];
  readonly birthDateText: string;
  readonly birthPlaceName: string;
  readonly deathDateText: string;
  readonly deathPlaceName: string;
  readonly birthLabel: string;
  readonly deathLabel: string;
  readonly events: readonly PersonEventRow[];
  readonly links: readonly PersonLinkRow[];
  readonly findings: readonly Finding[];
  readonly redacted: boolean;
}

export const EVENT_LABELS: Record<string, string> = {
  BIRTH: 'Naissance',
  BAPTISM: 'Baptême',
  DEATH: 'Décès',
  BURIAL: 'Inhumation',
  CREMATION: 'Crémation',
  MARRIAGE: 'Mariage',
  MARRIAGE_BANN: 'Publication des bans',
  MARRIAGE_CONTRACT: 'Contrat de mariage',
  CIVIL_UNION: 'Union civile',
  DIVORCE: 'Divorce',
  RESIDENCE: 'Résidence',
  OCCUPATION: 'Profession',
  EDUCATION: 'Études',
  MILITARY_SERVICE: 'Service militaire',
  MIGRATION: 'Migration',
  NATURALIZATION: 'Naturalisation',
  CENSUS: 'Recensement',
  PROBATE: 'Succession',
  WILL: 'Testament',
  RELIGIOUS_EVENT: 'Événement religieux',
  CUSTOM: 'Autre',
};

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
        livingStatus: true,
        notes: true,
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

    const isLiving = person.livingStatus === 'LIVING';
    const hidden = isHiddenFrom({ isLiving }, access.redactLiving);

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
        source: { select: { id: true, displayName: true, livingStatus: true } },
        target: { select: { id: true, displayName: true, livingStatus: true } },
      },
    });

    const links = relationshipRows.map((row): PersonLinkRow => {
      const isSource = row.sourceId === person.id;
      const other = isSource ? row.target : row.source;
      const otherLiving = other.livingStatus === 'LIVING';
      const otherHidden = isHiddenFrom({ isLiving: otherLiving }, access.redactLiving);

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
    const graph = await loadGenealogyGraph(db, access.treeId, todayJdn);
    const findings = sortBySeverity(auditPerson(graph, person.id, { todayJdn }));

    const vital = (type: 'BIRTH' | 'DEATH') => eventRows.find((event) => event.type === type);
    const birth = vital('BIRTH');
    const death = vital('DEATH');

    // The whole list goes, not just its dates. Blanking the date while still
    // listing "Divorce", "Naturalisation" or "Service militaire" publishes
    // facts about a living person that the redaction exists to protect — the
    // event type is the sensitive part, and the date was only ever the part
    // that was easy to notice.
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
          };
        });

    return {
      access,
      personId: person.id,
      // A member editing their own tree is never redacted; this branch covers
      // a public visitor who followed a link to a living person's page.
      displayName: hidden ? REDACTED_LABEL : person.displayName,
      recordedSex: person.recordedSex,
      livingStatus: person.livingStatus,
      notes: hidden ? '' : (person.notes ?? ''),
      names: hidden ? [] : person.names.map(toNameRow),
      // The form is seeded with the text the archive actually had, not with a
      // re-rendering of it: round-tripping "vers 1750" through a formatter and
      // back would rewrite the researcher's own words.
      birthDateText: hidden ? '' : (birth?.dateOriginalText ?? ''),
      birthPlaceName: hidden ? '' : (birth?.place?.name ?? ''),
      deathDateText: hidden ? '' : (death?.dateOriginalText ?? ''),
      deathPlaceName: hidden ? '' : (death?.place?.name ?? ''),
      birthLabel: hidden
        ? '—'
        : dateLabelOf(birth ? decodeDate(birth) : null, birth?.dateOriginalText),
      deathLabel: hidden
        ? '—'
        : dateLabelOf(death ? decodeDate(death) : null, death?.dateOriginalText),
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
