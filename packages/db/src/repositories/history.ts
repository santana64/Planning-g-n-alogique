import type { Database } from '../client';

/**
 * The history of a tree, or of one person in it.
 *
 * Read from the append-only revisions. Each entry carries the people it is
 * about, found through the entity it touched — a person, an event's
 * participants, a link's two ends, a claim's subject — so the caller can
 * apply the privacy rule: a change to a restricted person's record says who
 * they are as surely as their record does.
 *
 * Newest first, by id: revision ids are UUIDv7, ordered by creation time.
 */

export interface HistoryEntry {
  readonly revisionId: string;
  readonly createdAt: Date;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly summary: string | null;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
  /** Null when the change was made by no account, or by one since erased. */
  readonly actorName: string | null;
  /**
   * The member a membership change is about, by their current name; null
   * once their account is erased. Never stored in the revision itself.
   */
  readonly subjectName: string | null;
  readonly personIds: readonly string[];
}

export interface HistoryPage {
  readonly entries: readonly HistoryEntry[];
  /** The id to continue from, or null at the beginning of the tree. */
  readonly nextCursor: string | null;
}

export interface HistoryOptions {
  readonly treeId: string;
  /** Only what concerns this person: their record, events, links and claims. */
  readonly personId?: string;
  /** A revision id from a previous page. */
  readonly cursor?: string;
  readonly limit?: number;
}

export async function loadHistory(db: Database, options: HistoryOptions): Promise<HistoryPage> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const { treeId } = options;

  const entityIds = options.personId ? await entitiesOfPerson(db, treeId, options.personId) : null;

  const rows = await db.revision.findMany({
    where: { treeId, ...(entityIds ? { entityId: { in: entityIds } } : {}) },
    orderBy: { id: 'desc' },
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      createdAt: true,
      action: true,
      entityType: true,
      entityId: true,
      summary: true,
      before: true,
      after: true,
      actor: { select: { name: true, deletedAt: true } },
    },
  });

  const page = rows.slice(0, limit);
  const concerned = await peopleConcerned(db, treeId, page);
  const subjects = await membersNamed(db, page);

  return {
    entries: page.map((row) => ({
      revisionId: row.id,
      createdAt: row.createdAt,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      summary: row.summary,
      before: asRecord(row.before),
      after: asRecord(row.after),
      actorName: row.actor && !row.actor.deletedAt ? row.actor.name : null,
      subjectName: subjects.get(row.id) ?? null,
      personIds: concerned.get(row.id) ?? [],
    })),
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function userIdIn(value: unknown): string | null {
  const record = asRecord(value);
  const userId = record?.['userId'];
  return typeof userId === 'string' ? userId : null;
}

/** The names of the members that membership revisions point at, by account. */
async function membersNamed(
  db: Database,
  rows: ReadonlyArray<{ id: string; entityType: string; before: unknown; after: unknown }>,
): Promise<Map<string, string>> {
  const wanted = new Map<string, string>();
  for (const row of rows) {
    if (row.entityType !== 'TreeMember') continue;
    const userId = userIdIn(row.after) ?? userIdIn(row.before);
    if (userId) wanted.set(row.id, userId);
  }
  const ids = [...new Set(wanted.values())];
  const users = ids.length
    ? await db.user.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, name: true },
      })
    : [];
  const names = new Map(users.map((user) => [user.id, user.name]));
  const result = new Map<string, string>();
  for (const [revisionId, userId] of wanted) {
    const name = names.get(userId);
    if (name) result.set(revisionId, name);
  }
  return result;
}

/** Every entity whose revisions belong in one person's history. */
async function entitiesOfPerson(db: Database, treeId: string, personId: string): Promise<string[]> {
  const [events, relationships, claims] = await Promise.all([
    db.eventParticipant.findMany({
      where: { personId, event: { treeId } },
      select: { eventId: true },
    }),
    db.relationship.findMany({
      where: { treeId, OR: [{ sourceId: personId }, { targetId: personId }] },
      select: { id: true },
    }),
    db.claim.findMany({ where: { treeId, personId }, select: { id: true } }),
  ]);
  const eventIds = events.map((event) => event.eventId);
  const citations = eventIds.length
    ? await db.citation.findMany({
        where: { treeId, eventId: { in: eventIds } },
        select: { id: true },
      })
    : [];
  return [
    personId,
    ...eventIds,
    ...relationships.map((relationship) => relationship.id),
    ...claims.map((claim) => claim.id),
    ...citations.map((citation) => citation.id),
  ];
}

/**
 * The people each revision is about. Soft-deleted rows count: a removed
 * person's history is still about them.
 */
async function peopleConcerned(
  db: Database,
  treeId: string,
  rows: ReadonlyArray<{ id: string; entityType: string; entityId: string }>,
): Promise<Map<string, string[]>> {
  const idsOf = (type: string) => [
    ...new Set(rows.filter((row) => row.entityType === type).map((row) => row.entityId)),
  ];
  const eventIds = idsOf('Event');
  const relationshipIds = idsOf('Relationship');
  const claimIds = idsOf('Claim');
  const citationIds = idsOf('Citation');
  const proposalIds = idsOf('AiProposal');

  const [participants, relationships, claims, citations, proposals] = await Promise.all([
    eventIds.length
      ? db.eventParticipant.findMany({
          where: { eventId: { in: eventIds } },
          select: { eventId: true, personId: true },
        })
      : [],
    relationshipIds.length
      ? db.relationship.findMany({
          where: { treeId, id: { in: relationshipIds } },
          select: { id: true, sourceId: true, targetId: true },
        })
      : [],
    claimIds.length
      ? db.claim.findMany({
          where: { treeId, id: { in: claimIds } },
          select: { id: true, personId: true },
        })
      : [],
    citationIds.length
      ? db.citation.findMany({
          where: { treeId, id: { in: citationIds } },
          select: {
            id: true,
            event: { select: { participants: { select: { personId: true } } } },
            claims: { select: { claim: { select: { personId: true } } } },
          },
        })
      : [],
    proposalIds.length
      ? db.aiProposal.findMany({
          where: { treeId, id: { in: proposalIds } },
          select: { id: true, personId: true },
        })
      : [],
  ]);

  const byEntity = new Map<string, string[]>();
  const add = (entityId: string, personId: string | null | undefined) => {
    if (!personId) return;
    const list = byEntity.get(entityId) ?? [];
    if (!list.includes(personId)) list.push(personId);
    byEntity.set(entityId, list);
  };
  for (const participant of participants) add(participant.eventId, participant.personId);
  for (const relationship of relationships) {
    add(relationship.id, relationship.sourceId);
    add(relationship.id, relationship.targetId);
  }
  for (const claim of claims) add(claim.id, claim.personId);
  for (const citation of citations) {
    for (const participant of citation.event?.participants ?? []) {
      add(citation.id, participant.personId);
    }
    for (const link of citation.claims) add(citation.id, link.claim.personId);
  }
  for (const proposal of proposals) add(proposal.id, proposal.personId);

  const result = new Map<string, string[]>();
  for (const row of rows) {
    result.set(
      row.id,
      row.entityType === 'Person' ? [row.entityId] : (byEntity.get(row.entityId) ?? []),
    );
  }
  return result;
}
