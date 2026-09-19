import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createEvent,
  createPerson,
  createRelationship,
  createTree,
  loadHistory,
  updatePerson,
  type Database,
} from '../src/index';

/**
 * The history, as the pages read it: who changed what, newest first, and
 * which people each change is about — the part the privacy rule needs.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

let db: Database;
let treeId: string;
let userId: string;
let jean: string;
let anne: string;
let paul: string;

beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });

  const user = await db.user.create({
    data: {
      email: `history-${Date.now()}-${Math.random().toString(36).slice(2)}@chronolignee.invalid`,
      name: 'Noah',
      emailVerified: false,
    },
    select: { id: true },
  });
  userId = user.id;
  treeId = (await createTree(db, { name: 'Historique' }, userId)).treeId;
  const ctx = { treeId, actorId: userId };

  const named = (given: string, surname: string) => ({
    names: [{ type: 'BIRTH' as const, given, surname, isPreferred: true }],
  });
  jean = (await createPerson(db, { ...named('Jean', 'Roux'), birthDate: '1877' }, ctx)).personId;
  anne = (await createPerson(db, named('Anne', 'Brun'), ctx)).personId;
  paul = (await createPerson(db, named('Paul', 'Roux'), ctx)).personId;

  await updatePerson(db, { personId: jean, birthDate: '1878' }, ctx);
  await createEvent(
    db,
    {
      type: 'MARRIAGE',
      date: '1902',
      participants: [
        { personId: jean, role: 'SPOUSE' },
        { personId: anne, role: 'SPOUSE' },
      ],
    },
    ctx,
  );
  await createRelationship(db, { sourceId: jean, targetId: paul, type: 'PARENT_BIOLOGICAL' }, ctx);
}, 60_000);

afterAll(async () => {
  if (treeId) await db.tree.delete({ where: { id: treeId } }).catch(() => undefined);
  if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
  await db.$disconnect();
});

describe('loadHistory', () => {
  it('reads newest first, with who did it', async () => {
    const { entries } = await loadHistory(db, { treeId });
    expect(entries[0]).toMatchObject({ entityType: 'Relationship', action: 'CREATE' });
    expect(entries.at(-1)).toMatchObject({ entityType: 'Tree', action: 'CREATE' });
    expect(entries.every((entry) => entry.actorName === 'Noah')).toBe(true);
  });

  it('keeps what a correction changed, before and after', async () => {
    const { entries } = await loadHistory(db, { treeId, personId: jean });
    const correction = entries.find(
      (entry) => entry.entityType === 'Person' && entry.action === 'UPDATE',
    );
    expect(correction?.before).toMatchObject({ birthDate: '1877' });
    expect(correction?.after).toMatchObject({ birthDate: '1878' });
  });

  it('gathers one person’s record, events and links, and nothing else', async () => {
    const { entries } = await loadHistory(db, { treeId, personId: anne });
    expect(entries.map((entry) => `${entry.entityType} ${entry.action}`)).toEqual([
      'Event CREATE',
      'Person CREATE',
    ]);
  });

  it('says which people each change is about', async () => {
    const { entries } = await loadHistory(db, { treeId });
    const about = (type: string) =>
      [...(entries.find((entry) => entry.entityType === type)?.personIds ?? [])].sort();
    expect(about('Event')).toEqual([jean, anne].sort());
    expect(about('Relationship')).toEqual([jean, paul].sort());
    expect(entries.find((entry) => entry.entityType === 'Tree')?.personIds).toEqual([]);
  });

  it('pages without repeating or skipping', async () => {
    const all = (await loadHistory(db, { treeId })).entries.map((entry) => entry.revisionId);
    const first = await loadHistory(db, { treeId, limit: 3 });
    expect(first.nextCursor).not.toBeNull();
    const second = await loadHistory(db, {
      treeId,
      limit: 50,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.nextCursor).toBeNull();
    expect([...first.entries, ...second.entries].map((entry) => entry.revisionId)).toEqual(all);
  });

  it('shows no author once the account is gone', async () => {
    const ghost = await db.user.create({
      data: {
        email: `history-ghost-${Date.now()}@chronolignee.invalid`,
        name: 'Fantôme',
        emailVerified: false,
      },
      select: { id: true },
    });
    await updatePerson(
      db,
      { personId: paul, notes: 'Né à Tours ?' },
      { treeId, actorId: ghost.id },
    );
    await db.user.update({ where: { id: ghost.id }, data: { deletedAt: new Date() } });

    const { entries } = await loadHistory(db, { treeId, personId: paul });
    expect(entries[0]?.actorName).toBeNull();
    await db.user.delete({ where: { id: ghost.id } });
  });
});
