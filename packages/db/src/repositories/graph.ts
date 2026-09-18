import { GenealogyGraph, type GraphEdge, type GraphPerson } from '@chronolignee/genealogy';
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
        recordedSex: true,
        lifespanEarliestJdn: true,
        lifespanLatestJdn: true,
        // Archived events stay in the record — a corrected date is kept, not
        // overwritten — and out of every projection. Without this filter the
        // graph placed people at dates the researcher had corrected.
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

    return {
      id: person.id,
      displayName: person.displayName,
      recordedSex: person.recordedSex,
      birth: projection.birth,
      death: projection.death,
      lifespan: {
        earliest: projection.lifespanEarliestJdn,
        latest: projection.lifespanLatestJdn,
      },
      isDeceased:
        person.livingStatus === 'DECEASED' ? true : person.livingStatus === 'LIVING' ? false : null,
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
