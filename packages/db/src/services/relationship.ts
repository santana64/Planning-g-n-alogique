import { dateToJdn, parseGenealogicalDate } from '@chronolignee/domain';
import {
  hasBlocking,
  sortBySeverity,
  validateRelationshipProposal,
  type Finding,
} from '@chronolignee/genealogy';
import type { Database } from '../client';
import { loadGenealogyGraph } from '../repositories/graph';
import { recordRevision } from './audit';
import { createRelationshipInput, type CreateRelationshipInput } from './schemas';
import type { PersonWriteContext } from './person';

/**
 * Creating a relationship.
 *
 * The only write in the product that can be refused on genealogical grounds,
 * because it is the only one that can put the graph into a state every
 * traversal afterwards assumes cannot happen. Someone who is their own
 * ancestor is not a warning to surface later: it makes ancestor counts
 * meaningless, makes layout non-terminating, and corrupts every answer built
 * on top.
 *
 * Everything else the validator finds — a mother of 58, a parent of 13, a
 * birth close behind a sibling's — is returned and never blocks. Those are
 * what the records say, and a product that refuses them forces the researcher
 * to falsify the register in order to store it.
 */

export interface RelationshipResult {
  readonly relationshipId: string;
  /** Non-blocking findings, for the caller to show. */
  readonly warnings: readonly Finding[];
}

export class RelationshipRefused extends Error {
  readonly findings: readonly Finding[];

  constructor(findings: readonly Finding[]) {
    super('La relation a été refusée par les règles généalogiques.');
    this.name = 'RelationshipRefused';
    this.findings = findings;
  }
}

export async function createRelationship(
  db: Database,
  raw: CreateRelationshipInput,
  context: PersonWriteContext,
): Promise<RelationshipResult> {
  const input = createRelationshipInput.parse(raw);
  const todayJdn = dateToJdn(new Date());

  // Validated against the graph as it stands, before the write. A cycle check
  // after the fact would have to undo the edge that caused it, and by then
  // anything reading concurrently has already seen the corrupt state.
  const graph = await loadGenealogyGraph(db, context.treeId, todayJdn);

  if (!graph.has(input.sourceId) || !graph.has(input.targetId)) {
    throw new Error('Une des deux personnes est introuvable dans cet arbre.');
  }

  const findings = sortBySeverity(
    validateRelationshipProposal(graph, {
      sourceId: input.sourceId,
      targetId: input.targetId,
      type: input.type,
    }),
  );

  if (hasBlocking(findings)) {
    throw new RelationshipRefused(findings.filter((f) => f.severity === 'ERROR'));
  }

  const start = input.startDate ? parseGenealogicalDate(input.startDate) : null;
  const end = input.endDate ? parseGenealogicalDate(input.endDate) : null;

  const relationship = await db.$transaction(async (tx) => {
    const created = await tx.relationship.create({
      data: {
        treeId: context.treeId,
        sourceId: input.sourceId,
        targetId: input.targetId,
        type: input.type,
        ...(start?.interval.earliest != null ? { startJdn: start.interval.earliest } : {}),
        ...(end?.interval.latest != null ? { endJdn: end.interval.latest } : {}),
        confidence: input.confidence,
        ...(input.notes ? { notes: input.notes } : {}),
        ...(context.actorId ? { createdById: context.actorId } : {}),
      },
    });

    const source = graph.people.get(input.sourceId);
    const target = graph.people.get(input.targetId);

    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'Relationship',
      entityId: created.id,
      action: 'CREATE',
      actorId: context.actorId,
      after: { type: input.type, source: source?.displayName, target: target?.displayName },
      summary: `${source?.displayName ?? '?'} → ${target?.displayName ?? '?'} (${input.type})`,
      ...(context.batchId ? { batchId: context.batchId } : {}),
    });

    await tx.tree.update({
      where: { id: context.treeId },
      data: { revision: { increment: 1 } },
    });

    return created;
  });

  return {
    relationshipId: relationship.id,
    warnings: findings.filter((f) => f.severity !== 'ERROR'),
  };
}

export async function deleteRelationship(
  db: Database,
  relationshipId: string,
  context: PersonWriteContext,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const relationship = await tx.relationship.findFirstOrThrow({
      where: { id: relationshipId, treeId: context.treeId, deletedAt: null },
      select: {
        id: true,
        type: true,
        source: { select: { displayName: true } },
        target: { select: { displayName: true } },
      },
    });

    await tx.relationship.update({
      where: { id: relationship.id },
      data: { deletedAt: new Date() },
    });

    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'Relationship',
      entityId: relationship.id,
      action: 'DELETE',
      actorId: context.actorId,
      before: {
        type: relationship.type,
        source: relationship.source.displayName,
        target: relationship.target.displayName,
      },
      summary: `Lien supprimé : ${relationship.source.displayName} → ${relationship.target.displayName}`,
      ...(context.batchId ? { batchId: context.batchId } : {}),
    });

    await tx.tree.update({
      where: { id: context.treeId },
      data: { revision: { increment: 1 } },
    });
  });
}
