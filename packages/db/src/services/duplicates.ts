import { dateToJdn } from '@chronolignee/domain';
import {
  DEFAULT_DUPLICATE_THRESHOLD,
  DUPLICATE_SCORER_VERSION,
  rankDuplicatePairs,
  type DuplicatePair,
  type DuplicateSubject,
} from '@chronolignee/genealogy';
import type { Database, TransactionClient } from '../client';
import { loadGenealogyGraph } from '../repositories/graph';
import { recordRevision } from './audit';
import { refreshLifespan } from './person';

/**
 * Finding people recorded twice, and — only when a human says so — making
 * them one.
 *
 * The scan proposes, the researcher decides, and nothing is ever merged
 * automatically ([GENEALOGY_RULES.md](../../../../docs/GENEALOGY_RULES.md)).
 * The scoring itself is in `@chronolignee/genealogy`, pure and testable; this
 * file is what talks to the database: which pairs are worth scoring, and what
 * a merge actually moves.
 */

/** Rows a single scan will look at, so one click cannot run for a minute. */
const MAX_PAIRS = 5_000;

/**
 * Rapprochements considered for one person.
 *
 * Without this, a tree where half the men are called Jean Martin turns one
 * query into millions of pairs — measured: the unbounded join passed thirty
 * seconds at twenty thousand people and was cancelled. Eight is generous for
 * a real duplicate, which usually has one twin, not eight.
 */
const MAX_PER_PERSON = 8;

/**
 * How alike two names must be to be worth scoring at all.
 *
 * Stricter than `pg_trgm`'s default of 0.3, which brings "Jean Martin" and
 * "Jeanne Martinet" together and floods the scan with pairs the scorer then
 * rejects one by one.
 */
const NAME_BLOCKING_SIMILARITY = 0.5;

const SCAN_TRANSACTION = { timeout: 30_000, maxWait: 10_000 } as const;

export interface ScanResult {
  /** Pairs the trigram search brought together. */
  readonly examined: number;
  /** Pairs above the threshold. */
  readonly found: number;
  /** Rows written: new pairs, or an existing open pair rescored. */
  readonly recorded: number;
  readonly scorerVersion: string;
}

/**
 * Candidate pairs, from the names alone.
 *
 * Comparing everyone with everyone is quadratic and pointless: two records of
 * one person nearly always agree on a name. PostgreSQL's trigram index does
 * the blocking — `%` uses the similarity threshold of the session — and the
 * scoring then looks at dates, parents, children and places.
 */
async function candidatePairs(db: Database, treeId: string): Promise<Array<[string, string]>> {
  return db.$transaction(async (tx) => {
    // Session settings, for this query only: a stricter blocking threshold,
    // and a bound on the work a lateral join with a very common name could
    // still represent.
    await tx.$executeRawUnsafe(
      `SET LOCAL pg_trgm.similarity_threshold = ${NAME_BLOCKING_SIMILARITY}`,
    );
    const rows = await tx.$queryRaw<Array<{ left: string; right: string }>>`
      SELECT a.id::text AS left, m.id::text AS right
      FROM people a
      CROSS JOIN LATERAL (
        SELECT b.id
        FROM people b
        WHERE b."treeId" = a."treeId"
          AND b.id > a.id
          AND b."deletedAt" IS NULL
          AND b."searchName" % a."searchName"
        LIMIT ${MAX_PER_PERSON}
      ) m
      WHERE a."treeId" = ${treeId}::uuid
        AND a."deletedAt" IS NULL
        AND a."searchName" <> ''
      LIMIT ${MAX_PAIRS}`;
    return rows.map((row) => [row.left, row.right] as [string, string]);
    // Longer than Prisma's five-second default: the query is bounded, but at
    // twenty thousand people it takes a few seconds, and the transaction
    // exists only to keep the session setting from leaking to the next query
    // on a pooled connection.
  }, SCAN_TRANSACTION);
}

/** Everything the scorer reads, for the people a candidate pair names. */
async function subjectsFor(
  db: Database,
  treeId: string,
  ids: ReadonlySet<string>,
  todayJdn: number,
): Promise<Map<string, DuplicateSubject>> {
  const graph = await loadGenealogyGraph(db, treeId, todayJdn);

  const names = await db.personName.findMany({
    where: { treeId, personId: { in: [...ids] } },
    select: {
      personId: true,
      normalisedSurname: true,
      normalisedGiven: true,
      isPreferred: true,
    },
    orderBy: [{ isPreferred: 'desc' }, { createdAt: 'asc' }],
  });
  const nameOf = new Map<string, { surname: string; given: string }>();
  for (const name of names) {
    if (nameOf.has(name.personId)) continue;
    nameOf.set(name.personId, { surname: name.normalisedSurname, given: name.normalisedGiven });
  }

  const births = await db.eventParticipant.findMany({
    where: {
      personId: { in: [...ids] },
      role: 'PRINCIPAL',
      event: {
        treeId,
        type: { in: ['BIRTH', 'BAPTISM'] },
        deletedAt: null,
        placeId: { not: null },
      },
    },
    select: {
      personId: true,
      event: { select: { type: true, place: { select: { normalisedName: true } } } },
    },
  });
  const placeOf = new Map<string, string>();
  for (const birth of births) {
    const place = birth.event.place?.normalisedName;
    if (!place) continue;
    // A birth place beats a baptism place, and the first of each wins.
    if (birth.event.type === 'BIRTH' || !placeOf.has(birth.personId)) {
      placeOf.set(birth.personId, place);
    }
  }

  const subjects = new Map<string, DuplicateSubject>();
  for (const id of ids) {
    const person = graph.people.get(id);
    if (!person) continue;
    const name = nameOf.get(id);
    subjects.set(id, {
      id,
      surname: name?.surname ?? '',
      given: name?.given ?? '',
      recordedSex: person.recordedSex ?? 'UNKNOWN',
      birth: person.birth?.interval ?? null,
      death: person.death?.interval ?? null,
      birthPlace: placeOf.get(id) ?? null,
      parentIds: graph.parentsOf(id).map((edge) => edge.sourceId),
      partnerIds: graph
        .partnersOf(id)
        .map((edge) => (edge.sourceId === id ? edge.targetId : edge.sourceId)),
      childIds: graph.childrenOf(id).map((edge) => edge.targetId),
    });
  }
  return subjects;
}

/**
 * Look for duplicates and record what was found.
 *
 * A pair a human has already answered — merged, or dismissed as two different
 * people — is left alone: re-proposing it after every scan would train the
 * reader to click past the list.
 */
export async function scanDuplicates(
  db: Database,
  options: { treeId: string; threshold?: number; todayJdn?: number },
): Promise<ScanResult> {
  const todayJdn = options.todayJdn ?? dateToJdn(new Date());
  const pairs = await candidatePairs(db, options.treeId);
  if (pairs.length === 0) {
    return { examined: 0, found: 0, recorded: 0, scorerVersion: DUPLICATE_SCORER_VERSION };
  }

  const ids = new Set(pairs.flat());
  const subjects = await subjectsFor(db, options.treeId, ids, todayJdn);
  const ranked = rankDuplicatePairs(subjects, pairs, {
    ...(options.threshold === undefined ? {} : { threshold: options.threshold }),
  });

  const answered = await db.duplicateCandidate.findMany({
    where: { treeId: options.treeId, status: { in: ['MERGED', 'DISMISSED'] } },
    select: { leftId: true, rightId: true },
  });
  const settled = new Set(answered.map((row) => `${row.leftId}|${row.rightId}`));

  let recorded = 0;
  for (const pair of ranked) {
    if (settled.has(`${pair.leftId}|${pair.rightId}`)) continue;
    await db.duplicateCandidate.upsert({
      where: { leftId_rightId: { leftId: pair.leftId, rightId: pair.rightId } },
      create: {
        treeId: options.treeId,
        leftId: pair.leftId,
        rightId: pair.rightId,
        score: pair.score,
        scorerVersion: DUPLICATE_SCORER_VERSION,
        explanation: explanationOf(pair),
        status: 'OPEN',
      },
      update: {
        score: pair.score,
        scorerVersion: DUPLICATE_SCORER_VERSION,
        explanation: explanationOf(pair),
      },
    });
    recorded += 1;
  }

  return {
    examined: pairs.length,
    found: ranked.length,
    recorded,
    scorerVersion: DUPLICATE_SCORER_VERSION,
  };
}

function explanationOf(pair: DuplicatePair): object {
  return {
    threshold: DEFAULT_DUPLICATE_THRESHOLD,
    signals: pair.signals.map((signal) => ({
      name: signal.name,
      value: Number(signal.value.toFixed(3)),
      weight: signal.weight,
    })),
  };
}

export class MergeRefused extends Error {
  constructor(readonly reason: 'NOT_FOUND' | 'SAME_PERSON') {
    super(reason);
    this.name = 'MergeRefused';
  }
}

export interface MergeResult {
  readonly keptId: string;
  readonly mergedId: string;
  readonly names: number;
  readonly events: number;
  readonly relationships: number;
  readonly claims: number;
  readonly documentsAndMedia: number;
}

/**
 * Make two records one.
 *
 * Everything the merged record carries moves to the kept one — names,
 * participations, links, claims, proposals, photograph tags, research tasks —
 * and the merged row is retired, not erased: the history must still be able
 * to say what happened, and an id that appears in an old revision must still
 * resolve to something.
 *
 * Nothing is thrown away on the way: a second birth date arrives as a second
 * birth event, and the record then shows both, with the contradiction the
 * audit reports. Choosing between them is the researcher's next decision, not
 * this function's.
 */
export async function mergePeople(
  db: Database,
  input: { treeId: string; keepId: string; mergeId: string },
  context: { actorId: string | null; todayJdn?: number },
): Promise<MergeResult> {
  if (input.keepId === input.mergeId) throw new MergeRefused('SAME_PERSON');
  const todayJdn = context.todayJdn ?? dateToJdn(new Date());

  return db.$transaction(async (tx) => {
    const [kept, merged] = await Promise.all([
      tx.person.findFirst({
        where: { id: input.keepId, treeId: input.treeId, deletedAt: null },
        select: { id: true, displayName: true },
      }),
      tx.person.findFirst({
        where: { id: input.mergeId, treeId: input.treeId, deletedAt: null },
        select: { id: true, displayName: true },
      }),
    ]);
    if (!kept || !merged) throw new MergeRefused('NOT_FOUND');

    const names = await moveNames(tx, kept.id, merged.id);
    const events = await moveEventRoles(tx, kept.id, merged.id);
    const relationships = await moveRelationships(tx, input.treeId, kept.id, merged.id);
    const claims = await tx.claim.updateMany({
      where: { personId: merged.id },
      data: { personId: kept.id },
    });
    const proposals = await tx.aiProposal.updateMany({
      where: { personId: merged.id },
      data: { personId: kept.id },
    });
    const tasks = await tx.researchTask.updateMany({
      where: { personId: merged.id },
      data: { personId: kept.id },
    });
    const tags = await moveMediaTags(tx, kept.id, merged.id);

    await tx.person.update({ where: { id: merged.id }, data: { deletedAt: new Date() } });
    await refreshLifespan(tx, kept.id, todayJdn);

    // Every pair naming the retired record is answered by this merge.
    await tx.duplicateCandidate.updateMany({
      where: { treeId: input.treeId, OR: [{ leftId: merged.id }, { rightId: merged.id }] },
      data: { status: 'MERGED', reviewedAt: new Date() },
    });

    await recordRevision(tx, {
      treeId: input.treeId,
      entityType: 'Person',
      entityId: kept.id,
      action: 'MERGE',
      actorId: context.actorId,
      before: { mergedId: merged.id, mergedName: merged.displayName },
      after: {
        keptId: kept.id,
        keptName: kept.displayName,
        names,
        events,
        relationships,
        claims: claims.count,
      },
      summary: `${merged.displayName} fusionné dans ${kept.displayName}`,
    });

    await tx.tree.update({ where: { id: input.treeId }, data: { revision: { increment: 1 } } });

    return {
      keptId: kept.id,
      mergedId: merged.id,
      names,
      events,
      relationships,
      claims: claims.count,
      documentsAndMedia: tags + proposals.count + tasks.count,
    };
  });
}

// --- What moves, and what is dropped on the way -----------------------------

/**
 * Names follow their person, none of them preferred any more: the kept
 * record already has the name it displays, and two preferred names is a
 * state the rest of the code would have to choose between.
 */
async function moveNames(tx: TransactionClient, keepId: string, mergeId: string): Promise<number> {
  const [keptNames, movingNames] = await Promise.all([
    tx.personName.findMany({
      where: { personId: keepId },
      select: { normalisedSurname: true, normalisedGiven: true, type: true },
    }),
    tx.personName.findMany({
      where: { personId: mergeId },
      select: { id: true, normalisedSurname: true, normalisedGiven: true, type: true },
    }),
  ]);
  const known = new Set(
    keptNames.map((name) => `${name.type}|${name.normalisedSurname}|${name.normalisedGiven}`),
  );

  let moved = 0;
  for (const name of movingNames) {
    const key = `${name.type}|${name.normalisedSurname}|${name.normalisedGiven}`;
    if (known.has(key)) {
      // The same name written twice is not information worth keeping twice.
      await tx.personName.delete({ where: { id: name.id } });
      continue;
    }
    known.add(key);
    await tx.personName.update({
      where: { id: name.id },
      data: { personId: keepId, isPreferred: false },
    });
    moved += 1;
  }
  return moved;
}

/** Participations move, except where the kept person already plays that part. */
async function moveEventRoles(
  tx: TransactionClient,
  keepId: string,
  mergeId: string,
): Promise<number> {
  const [kept, moving] = await Promise.all([
    tx.eventParticipant.findMany({
      where: { personId: keepId },
      select: { eventId: true, role: true },
    }),
    tx.eventParticipant.findMany({
      where: { personId: mergeId },
      select: { id: true, eventId: true, role: true },
    }),
  ]);
  const taken = new Set(kept.map((role) => `${role.eventId}|${role.role}`));

  let moved = 0;
  for (const role of moving) {
    if (taken.has(`${role.eventId}|${role.role}`)) {
      await tx.eventParticipant.delete({ where: { id: role.id } });
      continue;
    }
    taken.add(`${role.eventId}|${role.role}`);
    await tx.eventParticipant.update({ where: { id: role.id }, data: { personId: keepId } });
    moved += 1;
  }
  return moved;
}

/**
 * Links move, minus the ones the merge would make absurd: a link between the
 * two records themselves, and a link the kept record already has.
 */
async function moveRelationships(
  tx: TransactionClient,
  treeId: string,
  keepId: string,
  mergeId: string,
): Promise<number> {
  const existing = await tx.relationship.findMany({
    where: { treeId, OR: [{ sourceId: keepId }, { targetId: keepId }] },
    select: { sourceId: true, targetId: true, type: true },
  });
  const known = new Set(existing.map((edge) => `${edge.sourceId}|${edge.targetId}|${edge.type}`));

  const moving = await tx.relationship.findMany({
    where: { treeId, OR: [{ sourceId: mergeId }, { targetId: mergeId }] },
    select: { id: true, sourceId: true, targetId: true, type: true },
  });

  let moved = 0;
  for (const edge of moving) {
    const sourceId = edge.sourceId === mergeId ? keepId : edge.sourceId;
    const targetId = edge.targetId === mergeId ? keepId : edge.targetId;
    const key = `${sourceId}|${targetId}|${edge.type}`;
    if (sourceId === targetId || known.has(key)) {
      await tx.relationship.delete({ where: { id: edge.id } });
      continue;
    }
    known.add(key);
    await tx.relationship.update({ where: { id: edge.id }, data: { sourceId, targetId } });
    moved += 1;
  }
  return moved;
}

/** One tag per person and photograph: a doubled tag is dropped, not moved. */
async function moveMediaTags(
  tx: TransactionClient,
  keepId: string,
  mergeId: string,
): Promise<number> {
  const [kept, moving] = await Promise.all([
    tx.personMediaTag.findMany({ where: { personId: keepId }, select: { mediaId: true } }),
    tx.personMediaTag.findMany({
      where: { personId: mergeId },
      select: { id: true, mediaId: true },
    }),
  ]);
  const taken = new Set(kept.map((tag) => tag.mediaId));

  let moved = 0;
  for (const tag of moving) {
    if (taken.has(tag.mediaId)) {
      await tx.personMediaTag.delete({ where: { id: tag.id } });
      continue;
    }
    taken.add(tag.mediaId);
    await tx.personMediaTag.update({ where: { id: tag.id }, data: { personId: keepId } });
    moved += 1;
  }
  return moved;
}

/** The open pairs of a tree, richest first, for the review screen. */
export async function openDuplicates(
  db: Database,
  treeId: string,
  limit = 50,
): Promise<
  Array<{
    id: string;
    score: number;
    explanation: unknown;
    left: { id: string; displayName: string };
    right: { id: string; displayName: string };
  }>
> {
  const rows = await db.duplicateCandidate.findMany({
    where: {
      treeId,
      status: 'OPEN',
      left: { deletedAt: null },
      right: { deletedAt: null },
    },
    orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
    take: limit,
    select: {
      id: true,
      score: true,
      explanation: true,
      left: { select: { id: true, displayName: true } },
      right: { select: { id: true, displayName: true } },
    },
  });
  return rows;
}

/** "These are two different people." Kept, so the scan stops proposing it. */
export async function dismissDuplicate(
  db: Database,
  input: { treeId: string; candidateId: string },
): Promise<void> {
  await db.duplicateCandidate.updateMany({
    where: { id: input.candidateId, treeId: input.treeId, status: 'OPEN' },
    data: { status: 'DISMISSED', reviewedAt: new Date() },
  });
}
