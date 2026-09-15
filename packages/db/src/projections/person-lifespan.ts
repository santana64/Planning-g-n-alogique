import {
  parseGenealogicalDate,
  resolveLifespan,
  unknownDate,
  type GenealogicalDate,
} from '@chronolignee/domain';
import { decodeDate, type EncodedDate } from '../date-codec';

/**
 * The derived temporal cache on Person.
 *
 * Person.lifespanEarliestJdn and friends are a projection, never a source of
 * truth. The truth is: an accepted BIRTH_DATE claim, or failing that a birth
 * Event. This module is the only thing allowed to compute those columns, and
 * it is pure so it can be tested without a database.
 *
 * Why the cache exists at all: the Gantt asks for the lifespan of every person
 * in a tree in one query. Resolving that through events and claims per person
 * would make the product's signature view unusable at a few thousand people.
 * The cache is rebuildable from claims at any time, which is what keeps it
 * honest: the seed rebuilds it as a separate pass, and loadGenealogyGraph
 * recomputes rather than trusting it, so a drifted cache shows up as a
 * disagreement instead of silently poisoning a query.
 */

/** Event types that bound a life, in the order we trust them. */
const BIRTH_EVENT_TYPES = ['BIRTH', 'BAPTISM'] as const;
const DEATH_EVENT_TYPES = ['DEATH', 'BURIAL', 'CREMATION'] as const;

export type BirthEventType = (typeof BIRTH_EVENT_TYPES)[number];
export type DeathEventType = (typeof DEATH_EVENT_TYPES)[number];

export interface ProjectionEvent extends Partial<EncodedDate> {
  readonly type: string;
}

export interface ProjectionClaim {
  readonly predicate: string;
  readonly status: string;
  /** Structured value; a date claim carries its GEDCOM text under `date`. */
  readonly value: unknown;
}

export interface PersonProjectionInput {
  readonly livingStatus: 'LIVING' | 'DECEASED' | 'UNKNOWN';
  readonly events: readonly ProjectionEvent[];
  readonly claims: readonly ProjectionClaim[];
}

export interface PersonLifespanProjection {
  readonly lifespanEarliestJdn: number | null;
  readonly lifespanLatestJdn: number | null;
  readonly lifespanLatestInferred: boolean;
  readonly birthSortJdn: number | null;
  /** Resolved dates, for callers that want to render rather than store. */
  readonly birth: GenealogicalDate;
  readonly death: GenealogicalDate;
}

function dateFromClaimValue(value: unknown): GenealogicalDate | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = (value as { date?: unknown }).date;
  return typeof raw === 'string' && raw.length > 0 ? parseGenealogicalDate(raw) : null;
}

/**
 * Pick the date for one end of a life.
 *
 * An accepted claim wins over an event, because a claim is an explicit human
 * judgement about which of several conflicting records to believe. Baptism
 * stands in for an unrecorded birth — a substitution French parish registers
 * force constantly, since baptism was recorded and birth often was not.
 */
function resolveEndpoint(
  input: PersonProjectionInput,
  claimPredicates: readonly string[],
  eventTypes: readonly string[],
): GenealogicalDate {
  for (const predicate of claimPredicates) {
    const accepted = input.claims.find((c) => c.predicate === predicate && c.status === 'ACCEPTED');
    const fromClaim = accepted ? dateFromClaimValue(accepted.value) : null;
    if (fromClaim) return fromClaim;
  }

  for (const type of eventTypes) {
    const event = input.events.find((e) => e.type === type);
    if (!event) continue;
    const decoded = decodeDate(event);
    // An event with no date at all tells us nothing; keep looking.
    if (decoded.interval.earliest !== null || decoded.interval.latest !== null) return decoded;
  }

  return unknownDate();
}

export function projectPersonLifespan(
  input: PersonProjectionInput,
  todayJdn: number,
): PersonLifespanProjection {
  const birth = resolveEndpoint(input, ['BIRTH_DATE', 'BAPTISM_DATE'], BIRTH_EVENT_TYPES);
  const death = resolveEndpoint(input, ['DEATH_DATE', 'BURIAL_DATE'], DEATH_EVENT_TYPES);

  const isDeceased =
    input.livingStatus === 'DECEASED' ? true : input.livingStatus === 'LIVING' ? false : undefined;

  const resolved = resolveLifespan({ birth, death, isDeceased }, todayJdn);

  return {
    lifespanEarliestJdn: resolved.interval.earliest,
    lifespanLatestJdn: resolved.interval.latest,
    lifespanLatestInferred: resolved.latestIsInferred,
    // Ordering uses the earliest possible birth rather than the midpoint, so
    // a list sorted by birth does not reshuffle when a date gains precision.
    birthSortJdn: birth.interval.earliest ?? birth.sortJdn,
    birth,
    death,
  };
}

/** The Prisma update payload, so callers cannot assemble it by hand. */
export function lifespanColumns(projection: PersonLifespanProjection): {
  lifespanEarliestJdn: number | null;
  lifespanLatestJdn: number | null;
  lifespanLatestInferred: boolean;
  birthSortJdn: number | null;
} {
  return {
    lifespanEarliestJdn: projection.lifespanEarliestJdn,
    lifespanLatestJdn: projection.lifespanLatestJdn,
    lifespanLatestInferred: projection.lifespanLatestInferred,
    birthSortJdn: projection.birthSortJdn,
  };
}
