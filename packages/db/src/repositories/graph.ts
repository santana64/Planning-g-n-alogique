import { parseGenealogicalDate } from '@chronolignee/domain';
import {
  GenealogyGraph,
  type GraphDateClaim,
  type GraphEdge,
  type GraphEvent,
  type GraphPerson,
} from '@chronolignee/genealogy';
import { decodeDate } from '../date-codec';
import type { Database } from '../client';
import { projectPersonLifespan } from '../projections/person-lifespan';

/**
 * Load a whole tree as an in-memory graph.
 *
 * Used where the database is the wrong tool (ADR 0001 explains when that is):
 * the layout worker, which needs the entire visible subgraph at once and would
 * otherwise make a round trip per generation; validation, which must reason
 * about an edge that does not exist yet; and the anomaly audit, which walks
 * every person anyway.
 *
 * Two queries, not N. The temptation is to fetch people and then fetch each
 * person's events, which is the N+1 that makes a 20 000-person tree unusable.
 */
export async function loadGenealogyGraph(
  db: Database,
  treeId: string,
  todayJdn: number,
): Promise<GenealogyGraph> {
  const [people, relationships] = await Promise.all([
    db.person.findMany({
      where: { treeId, deletedAt: null },
      select: {
        id: true,
        displayName: true,
        livingStatus: true,
        privacy: true,
        recordedSex: true,
        lifespanEarliestJdn: true,
        lifespanLatestJdn: true,
        // Archived events stay in the record — a corrected date is kept, not
        // overwritten — and out of every projection. Without this filter the
        // graph placed people at dates the researcher had corrected.
        eventRoles: {
          where: { event: { deletedAt: null } },
          select: {
            role: true,
            event: {
              select: {
                id: true,
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
        claims: { select: { id: true, predicate: true, status: true, value: true } },
      },
    }),
    db.relationship.findMany({
      where: { treeId, deletedAt: null },
      select: {
        id: true,
        sourceId: true,
        targetId: true,
        type: true,
        startJdn: true,
        endJdn: true,
      },
    }),
  ]);

  const graphPeople: GraphPerson[] = people.map((person) => {
    // Resolve the dates rather than trusting the cached columns. The cache is
    // a projection and can be stale; validation must not inherit its staleness,
    // and this is also what lets an audit catch a cache that has drifted.
    const projection = projectPersonLifespan(
      {
        livingStatus: person.livingStatus,
        events: person.eventRoles.map((role) => role.event),
        claims: person.claims,
      },
      todayJdn,
    );

    // The person's own events and accepted dated claims, for the audit's
    // life-against-events rules. Undated events are kept: the rules skip
    // them, and "has an undated marriage" is still a fact about the record.
    const events: GraphEvent[] = person.eventRoles.map((role) => ({
      eventId: role.event.id,
      type: role.event.type,
      role: role.role,
      date: decodeDate(role.event),
    }));
    const acceptedDateClaims: GraphDateClaim[] = [];
    for (const claim of person.claims) {
      if (claim.status !== 'ACCEPTED' || !claim.predicate.endsWith('_DATE')) continue;
      const raw =
        typeof claim.value === 'object' && claim.value !== null
          ? (claim.value as { date?: unknown }).date
          : undefined;
      if (typeof raw !== 'string' || raw.length === 0) continue;
      acceptedDateClaims.push({
        claimId: claim.id,
        predicate: claim.predicate,
        date: parseGenealogicalDate(raw),
      });
    }

    return {
      id: person.id,
      displayName: person.displayName,
      events,
      acceptedDateClaims,
      recordedSex: person.recordedSex,
      birth: projection.birth,
      death: projection.death,
      lifespan: {
        earliest: projection.lifespanEarliestJdn,
        latest: projection.lifespanLatestJdn,
      },
      isDeceased:
        person.livingStatus === 'DECEASED' ? true : person.livingStatus === 'LIVING' ? false : null,
      livingStatus: person.livingStatus,
      privacy: person.privacy,
      deathRecorded:
        person.eventRoles.some(
          (role) => role.event.type === 'DEATH' || role.event.type === 'BURIAL',
        ) ||
        person.claims.some(
          (claim) =>
            claim.status === 'ACCEPTED' &&
            (claim.predicate === 'DEATH_DATE' || claim.predicate === 'BURIAL_DATE'),
        ),
    };
  });

  const graphEdges: GraphEdge[] = relationships.map((relationship) => ({
    id: relationship.id,
    sourceId: relationship.sourceId,
    targetId: relationship.targetId,
    type: relationship.type,
    startJdn: relationship.startJdn,
    endJdn: relationship.endJdn,
  }));

  return new GenealogyGraph(graphPeople, graphEdges);
}
